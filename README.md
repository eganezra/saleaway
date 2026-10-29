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
| `apps/pipeline` | Cloudflare Worker for the daily job (placeholder until Story 3.1, but deployed and bound to the database) |
| `packages/core` | Pure shared logic with no I/O, starting with the structured logger |
| `docs/` | Brief, PRD, front-end spec, architecture, stories |

## Deploying

Both Workers run on Cloudflare's Free plan at `workers.dev` addresses, deployed by hand from this computer. CI/CD and the real domain (`saleaway.co.za`) come in Story 4.4.

| Worker | Address |
|---|---|
| `saleaway-web` | `https://saleaway-web.<account>.workers.dev` |
| `saleaway-pipeline` | `https://saleaway-pipeline.<account>.workers.dev` (placeholder, answers 404) |

`<account>` is the `workers.dev` subdomain of the Cloudflare account. It is not stored in the repository.

### One-time setup

```bash
pnpm --filter @saleaway/web exec wrangler login     # opens the browser to authorise your Cloudflare account
pnpm --filter @saleaway/web exec wrangler whoami    # confirms the login
```

The D1 database `saleaway` already exists (created with `wrangler d1 create saleaway --location weur`). Both `wrangler.jsonc` files bind it as `DB`. The database ID in them is not a secret. A new machine only needs `wrangler login`.

### Deploy

```bash
nvm use
pnpm deploy:all         # builds and deploys the web Worker, then deploys the pipeline Worker
```

Or one at a time: `pnpm deploy:web` (builds first) and `pnpm deploy:pipeline`. Wrangler prints each Worker's address and its bindings (`env.DB` must be listed).

Check it worked:

```bash
curl -i https://saleaway-web.<account>.workers.dev/health        # 200 and "ok"
curl -i https://saleaway-pipeline.<account>.workers.dev/         # 404 (placeholder)
```

The `/health` log line appears in the Cloudflare dashboard under Workers & Pages, `saleaway-web`, Observability, Logs. For a live view use `pnpm --filter @saleaway/web exec wrangler tail saleaway-web`.

### Roll back

`wrangler rollback` returns a Worker to its previous version. Run it from the Worker's own folder, or pass `--name`:

```bash
pnpm --filter @saleaway/web exec wrangler rollback --name saleaway-web
pnpm --filter @saleaway/pipeline exec wrangler rollback --name saleaway-pipeline
```

To go to a specific version, add its version ID (shown by `wrangler deployments list --name <worker>`). Database migrations will be additive only, so rolling code back never needs a database rollback.

The results of the first deploy (Cache API on `workers.dev`, bundle size, logs) are in [`docs/spike-s0-workers-dev.md`](docs/spike-s0-workers-dev.md).

## Rules that matter

- Never put secrets in the repository. Real values live in Cloudflare settings or a git-ignored `.dev.vars` file. `.env.example` lists variable names only.
- Log only through the logger in `packages/core`, never with `console.log` directly.
- `packages/core` does no I/O and never reads the clock.
