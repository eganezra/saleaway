# Saleaway

Saleaway (saleaway.co.za) shows current sales from South African online stores in one place. A daily job reads each store's sale page and the website lists which stores have a sale and how deep the discounts go.

This repository is a pnpm monorepo. Planning documents are in [`docs/`](docs/): the project brief, PRD, front-end spec, architecture and stories (`docs/stories/`).

## Requirements

- **Node 22.23.4 or newer.** Astro 7 and Wrangler need a recent Node. The version is pinned in `.nvmrc` and `engines`. This machine's default Node is older, so run `nvm use` in every new terminal.
- **pnpm.** Install with `npm install -g pnpm` if `pnpm --version` fails.

## Run it locally

```bash
nvm use                 # reads .nvmrc
pnpm install
pnpm dev                # starts the web app at http://localhost:4321
```

Then open http://localhost:4321 for the canary page, and http://localhost:4321/health, which returns `ok` and writes one structured JSON log line.

Stop the dev server with `pnpm --filter @saleaway/web exec astro dev stop`.

## Test and check

```bash
pnpm test         # Vitest (currently the shared core package)
pnpm lint         # ESLint, including a ban on console.log outside the logger
pnpm typecheck    # astro check for the web app, tsc for the other packages
```

## Layout

| Path | What it is |
|---|---|
| `apps/web` | Astro site (server-rendered on Cloudflare Workers) |
| `apps/pipeline` | Cloudflare Worker for the daily job (placeholder until Story 3.1) |
| `packages/core` | Pure shared logic with no I/O, starting with the structured logger |
| `docs/` | Brief, PRD, front-end spec, architecture, stories |

## Deploying

Nothing is deployed from this story. Deploying to a free `workers.dev` address comes in Story 1.2, and CI/CD with the real domain in Story 4.4.

## Rules that matter

- Never put secrets in the repository. Real values live in Cloudflare settings or a git-ignored `.dev.vars` file. `.env.example` lists variable names only.
- Log only through the logger in `packages/core`, never with `console.log` directly.
- `packages/core` does no I/O and never reads the clock.
