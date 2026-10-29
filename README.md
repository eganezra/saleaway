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
pnpm test         # Vitest (the shared core package and the ops scripts)
pnpm lint         # ESLint, including a ban on console.log outside the logger
pnpm typecheck    # astro check for the web app, tsc for the other packages
```

## Layout

| Path | What it is |
|---|---|
| `apps/web` | Astro site (server-rendered on Cloudflare Workers) |
| `apps/pipeline` | Cloudflare Worker for the daily job (placeholder until Story 3.1, but deployed and bound to the database) |
| `packages/core` | Pure shared logic with no I/O: the structured logger and the seed rules |
| `scripts/ops` | Operator commands (`pnpm ops:seed`) and their SQL helpers, with tests |
| `db/migrations` | SQL migrations for the D1 database (`0001_init.sql`) |
| `db/seed` | Category data for the seed (`categories.json`) |
| `docs/` | Brief, PRD, front-end spec, architecture, stories |

## Database

The data lives in Cloudflare D1, database `saleaway`, bound as `DB` in both Workers. The schema is in [`db/migrations`](db/migrations). Stores come from [`docs/data/retailers-seed.tsv`](docs/data/retailers-seed.tsv) and the 10 categories from [`db/seed/categories.json`](db/seed/categories.json).

```bash
pnpm db:migrate:local         # apply migrations to the local database that `pnpm dev` reads
pnpm ops:seed --local         # load the 10 categories and 106 stores locally

pnpm db:migrate:remote        # apply migrations to the live database
pnpm ops:seed --remote        # load the same data into the live database
```

- **Two copies of the data.** Local commands use a copy kept in `apps/web/.wrangler/state` (git-ignored), which is the one `pnpm dev` reads. The commands run from the web app's folder for that reason. The live database is separate.
- **`ops:seed` needs `--local` or `--remote`.** With neither, or both, it stops without writing anything. In a terminal, Wrangler asks "Ok to proceed?" before it writes to the live database, and warns that the database may be unavailable to serve queries while the file runs. The run takes well under a second at today's size, but once the site is live, seed at a quiet time. If you answer no, Wrangler exits normally, so the command checks that the seeded rows are really in the database and reports `seed_not_applied` (exit code 1) when they are not.
- **Running the seed again is safe.** It updates the stores and categories it knows (name, URLs, category, platform, rank, seed status) and adds nothing twice. It never changes `is_visible`, `extraction_method` or `black_friday_verified` on a store that already exists, and it never touches `sale_records` or `overrides`. So to show a store that was hidden, update its row (see below).
- **After a seed** you should have 10 categories and 106 stores: 92 visible and 14 hidden (stores with no sale page yet). Crocs SA is not in the spreadsheet and is added when its sale URL is found (Story 4.3).
- **Migrations are additive only** (new tables and columns), so rolling code back never needs a database rollback.

### Adding or changing a store

A store is one row in `retailers`, so adding one needs no code change and no deploy (FR3). Try it on the local database first (`--local`), then run the same command with `--remote`:

```bash
pnpm --filter @saleaway/web exec wrangler d1 execute saleaway --local --command \
"INSERT INTO retailers (slug, name, homepage_url, category_id, rank, sale_url, seed_status)
 VALUES ('example-store', 'Example Store', 'https://www.example-store.co.za',
         (SELECT id FROM categories WHERE slug = 'fashion-apparel'), 50,
         'https://www.example-store.co.za/sale', 'search_only')"
```

Required: `slug`, `name`, `homepage_url`, `category_id`. The rest has defaults (rank 999, `extraction_method` `html`, visible). Category slugs are in `db/seed/categories.json`. Other changes are plain updates, for example `UPDATE retailers SET is_visible = 0 WHERE slug = 'example-store'` hides a store, and `DELETE FROM retailers WHERE slug = 'example-store'` removes a test row.

`wrangler d1 execute --command` takes plain SQL with no bound parameters, so **check every value before you paste it in**: the slug against `^[a-z0-9-]+$`, URLs starting with `https://` and without quotes or spaces, numbers as plain integers in range, and any single quote inside text written twice (`Hirsch''s`). A store added by hand with a slug that is not in the seed file is never touched by the seed.

### Recovery

D1 Time Travel is always on and keeps 7 days of history on the Free plan. `wrangler d1 time-travel info saleaway` shows the current bookmark, and `wrangler d1 time-travel restore saleaway --bookmark=<id>` (or `--timestamp=<unix time>`) rolls the database back. **A restore overwrites the database in place**, so note the current bookmark first. Applying a migration also captures a backup. The store list can always be rebuilt with `pnpm ops:seed --remote`. Only overrides (Story 4.1) are hand-entered data.

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
