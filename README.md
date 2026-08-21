# execsim.app

Executive Suite — a corporate career simulation. The entire game is one
self-contained HTML file: no build step, no dependencies, no backend.

    public/index.html   the game
    public/og.png       link preview card (1200x630)
    wrangler.jsonc      static-assets Worker config

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

## Updating the game after that

Replace `public/index.html` and commit. Cloudflare rebuilds and deploys on its
own. GitHub's web editor works from a phone, so updates do not need a computer.

## Deploying by hand instead

    npx wrangler login
    npx wrangler deploy
