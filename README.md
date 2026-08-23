# execsim.app

Executive Suite — a corporate career simulation. The game itself is one
self-contained HTML file: no build step, no dependencies, no browser storage.
A small Worker sits alongside it for the leaderboard.

    public/index.html   the game
    public/og.png       link preview card (1200x630)
    src/index.js        leaderboard API (the only server-side code)
    wrangler.jsonc      Worker + static assets + D1 config

The Worker runs **only** for `/api/*`. Every other request is served straight
from the static asset store and never touches server code, so the game loads
exactly as fast as it did when it was a single file — and keeps working if the
leaderboard is down.

## One-time setup: connect this repo to Cloudflare

1. Push this repo to GitHub.
2. Cloudflare dashboard -> **Workers & Pages** -> select your Worker
3. **Settings** -> **Builds** -> **Connect** -> authorize GitHub, pick this repo
4. Push a commit. That triggers the first build.

**The one thing that breaks this:** the `name` in `wrangler.jsonc` must match
the Worker's name in the dashboard exactly. If your Worker is not called
`execsim`, change the name here to match it.

Build command: leave empty (there is nothing to build).
Deploy command: `npx wrangler deploy`

## The leaderboard

Scores live in a D1 database called `execsim-scores`, already created and
referenced by id in `wrangler.jsonc`. If it is ever recreated, the schema is:

```sql
CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, score INTEGER NOT NULL, earned INTEGER NOT NULL,
  integ INTEGER NOT NULL, quarters INTEGER NOT NULL, rank INTEGER NOT NULL,
  ending TEXT NOT NULL, kicker TEXT NOT NULL, bg TEXT NOT NULL,
  diff TEXT NOT NULL, ts INTEGER NOT NULL, ip TEXT
);
CREATE INDEX idx_runs_score ON runs (score DESC);
CREATE INDEX idx_runs_ts ON runs (ts DESC);
CREATE INDEX idx_runs_ts_score ON runs (ts DESC, score DESC);
```

Two endpoints:

    GET  /api/board?range=all|week|day&limit=30
    POST /api/submit

### The Meridian Index

Compensation earned, in thousands, is the base. Everything else multiplies it:

| Factor | Range | Why |
|---|---|---|
| Integrity | x0.60 - x1.60 | the hidden stat, revealed at the end |
| Difficulty | x1.00 / x1.60 | Hard is roughly one run in four |
| Pace | x0.85 - x1.45 | the same career in five years beats eight |
| Outcome | x0.12 - x1.30 | terminated for cause, up to chief executive |
| Standing | +900 each | people who would still take your call |

The point of the shape is that a ruthless run earns more money and scores less.

Across 12,000 simulated careers played every way the engine allows, the best
run scored **99,890**, the best earned **$40.5M**, and no run ever earned more
than **$1.38M per quarter**. Those measurements set the server's bounds, which
sit above them: all 12,000 pass, none are wrongly refused.

### On cheating

This repository is public, so anything shipped in `index.html` can be read by
anyone. The submission signature is therefore a speed bump: it stops someone
poking at the endpoint with curl, not someone willing to open the source.

The real defence is that the server ignores the score the client claims and
**recomputes it** from the parts, then refuses any combination a real career
could not produce — a CEO ending at Senior Director, the chair reached in
eighteen months, earnings above `min($45M, quarters x $1.55M)`, more than six
allies. Someone who reads this file can still assemble a consistent forgery,
and the most it can be worth is about **132,000** against an honest ceiling of
99,890. They cannot post a million.

Tightening that 33% gap further would start refusing real careers, which is a
worse failure than an inflated top entry, so the bounds stay where they are.

Submissions are rate-limited to 20 per hour per address, and addresses are
stored as a truncated salted hash rather than in the clear.

## Updating the game after that

Replace `public/index.html` and commit. Cloudflare rebuilds and deploys on its
own. GitHub's web editor works from a phone, so updates do not need a computer.

## Deploying by hand instead

    npx wrangler login
    npx wrangler deploy
