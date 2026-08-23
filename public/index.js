/* ============================================================
   execsim — leaderboard API
   Runs only for /api/*; everything else is served straight from
   the static asset store without touching this code.
   ============================================================ */

const MAX_NAME = 22;
const MAX_KICKER = 40;
const BOARD_LIMIT = 50;
const SUBMITS_PER_HOUR = 20;

/* The score formula, duplicated from the game. This is the actual defence:
   the client's claimed score is ignored and recomputed here from the parts.
   Anyone wanting a fake number has to submit a fake career that survives the
   bounds below, which is a great deal more work than editing one integer. */
const OUTCOME_MULT = {
  ceo_builder: 1.30, ceo_plain: 1.15, ceo_operator: 1.00, ceo_ousted: 0.80,
  board_rejects: 0.62, poached: 0.55, plateau: 0.45,
  fired_perf: 0.30, burnout: 0.28, scandal_out: 0.12,
};
const CEO_ENDINGS = ['ceo_builder', 'ceo_plain', 'ceo_operator', 'ceo_ousted'];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round2 = (v) => Math.round(v * 100) / 100;

function computeScore(p) {
  const base = Math.round(p.earned / 1000);
  const mInteg = round2(0.60 + p.integ / 100);
  const mDiff = p.diff === 'hard' ? 1.60 : 1.00;
  const mPace = clamp(round2(1.45 - p.quarters / 42), 0.85, 1.45);
  const mOut = OUTCOME_MULT[p.ending];
  return Math.max(0, Math.round(base * mInteg * mDiff * mPace * mOut) + p.allies * 900);
}

/* Same signature as the game computes. The repository is public, so this
   only stops someone poking at the endpoint with curl. */
const SIG_SALT = 'meridian-1946-brayton';
function scoreSig(p) {
  const str = [p.name, p.score, p.earned, p.integ, p.quarters,
               p.rank, p.ending, p.diff, SIG_SALT].join('|');
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  let g = 5381;
  for (let i = str.length - 1; i >= 0; i--) { g = (Math.imul(g, 33) ^ str.charCodeAt(i)) >>> 0; }
  return (h >>> 0).toString(36) + '.' + (g >>> 0).toString(36);
}

const json = (obj, status) => new Response(JSON.stringify(obj), {
  status: status || 200,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const bad = (msg, status) => json({ ok: false, error: msg }, status || 400);

function clean(raw, max) {
  return String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
/* Names and ending labels have different lengths — routing the label through
   the name cleaner truncated "Chief Executive Officer" to 22 characters. */
function cleanName(raw) { return clean(raw, MAX_NAME) || 'Anonymous'; }

async function ipHash(request) {
  const ip = request.headers.get('cf-connecting-ip') || '0.0.0.0';
  const data = new TextEncoder().encode(ip + '|' + SIG_SALT);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

const WINDOW = { all: 0, week: 7 * 864e5, day: 864e5 };

async function board(env, range, limit) {
  const since = WINDOW[range] ? Date.now() - WINDOW[range] : 0;
  const { results } = await env.DB.prepare(
    `SELECT id, name, score, integ, quarters, ending, kicker, bg, diff, ts
       FROM runs WHERE ts >= ?1
       ORDER BY score DESC, ts ASC LIMIT ?2`
  ).bind(since, limit).all();
  return results || [];
}

async function rankIn(env, range, score) {
  const since = WINDOW[range] ? Date.now() - WINDOW[range] : 0;
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM runs WHERE ts >= ?1 AND score > ?2`
  ).bind(since, score).first();
  return ((row && row.n) || 0) + 1;
}

async function handleSubmit(request, env) {
  let p;
  try { p = await request.json(); } catch (e) { return bad('Malformed request.'); }
  if (!p || typeof p !== 'object') return bad('Malformed request.');

  const name = cleanName(p.name);
  const earned = Math.round(Number(p.earned));
  const integ = Math.round(Number(p.integ));
  const quarters = Math.round(Number(p.quarters));
  const rank = Math.round(Number(p.rank));
  const allies = Math.round(Number(p.allies));
  const ending = String(p.ending || '');
  const diff = p.diff === 'hard' ? 'hard' : 'standard';
  const bg = ['acquihire', 'banker', 'lifer'].indexOf(String(p.bg)) >= 0 ? String(p.bg) : 'acquihire';
  const kicker = clean(p.kicker, MAX_KICKER);

  /* --- bounds. Anything outside these is not a career this game can produce.
     The earnings ceiling is measured rather than guessed: across 12,000
     simulated careers, played every way the engine allows, the best any run
     earned was $40.5M, the most any run earned per quarter was $1.38M, and
     the best Index was 99,890. The bounds sit above those. Earnings are bounded
     per quarter as well as absolutely, because the only way to earn a
     fortune here is to serve the time — and serving the time costs pace,
     which costs score. --- */
  if (!Number.isFinite(integ) || integ < 0 || integ > 100) return bad('Implausible integrity.');
  if (!Number.isFinite(quarters) || quarters < 1 || quarters > 60) return bad('Implausible tenure.');
  if (!Number.isFinite(rank) || rank < 0 || rank > 6) return bad('Implausible rank.');
  if (!Number.isFinite(allies) || allies < 0 || allies > 6) return bad('Implausible standing.');
  if (!OUTCOME_MULT[ending]) return bad('Unknown ending.');

  /* --- cross-checks: the parts have to agree with each other. --- */
  const isCeo = CEO_ENDINGS.indexOf(ending) >= 0;
  if (isCeo && rank !== 6) return bad('That ending does not match that rank.');
  if (!isCeo && rank === 6) return bad('That rank does not match that ending.');
  if (isCeo && quarters < 20) return bad('Nobody reaches the chair that fast.');

  if (!Number.isFinite(earned) || earned < 0) return bad('Implausible earnings.');
  if (earned > Math.min(45e6, quarters * 1.55e6)) return bad('Implausible earnings.');

  const score = computeScore({ earned, integ, quarters, diff, ending, allies });

  /* The signature is checked against what the client claimed, so a tampered
     payload fails here; the stored score is the one recomputed above. */
  const claimed = Math.round(Number(p.score));
  if (p.sig !== scoreSig({ name, score: claimed, earned, integ, quarters, rank, ending, diff })) {
    return bad('That result could not be verified.');
  }
  if (Math.abs(claimed - score) > 2) return bad('That result could not be verified.');

  const ip = await ipHash(request);
  const recent = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM runs WHERE ip = ?1 AND ts >= ?2`
  ).bind(ip, Date.now() - 36e5).first();
  if (((recent && recent.n) || 0) >= SUBMITS_PER_HOUR) {
    return bad('That is a lot of careers in one hour. Try again later.', 429);
  }

  const ts = Date.now();
  const res = await env.DB.prepare(
    `INSERT INTO runs (name, score, earned, integ, quarters, rank, ending, kicker, bg, diff, ts, ip)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`
  ).bind(name, score, earned, integ, quarters, rank, ending, kicker, bg, diff, ts, ip).run();

  const id = res.meta && res.meta.last_row_id;
  const [all, week, day] = await Promise.all([
    rankIn(env, 'all', score), rankIn(env, 'week', score), rankIn(env, 'day', score),
  ]);
  return json({ ok: true, id, score, ranks: { all, week, day } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/board' && request.method === 'GET') {
      const range = WINDOW[url.searchParams.get('range')] !== undefined
        ? url.searchParams.get('range') : 'all';
      const limit = clamp(parseInt(url.searchParams.get('limit'), 10) || 30, 1, BOARD_LIMIT);
      try {
        return json({ ok: true, range, rows: await board(env, range, limit) });
      } catch (e) {
        return bad('The leaderboard is unavailable.', 503);
      }
    }

    if (url.pathname === '/api/submit' && request.method === 'POST') {
      try { return await handleSubmit(request, env); }
      catch (e) { return bad('The leaderboard is unavailable.', 503); }
    }

    return bad('Not found.', 404);
  },
};
