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
pnpm db:migrate:local   # first time only: create the local database tables
pnpm ops:seed --local   # first time only: load the stores (see "Database" below)
pnpm dev                # starts the web app at http://localhost:4321
```

Then open http://localhost:4321 for the store list: one card per visible store (92 after seeding), each opening the store's sale page in a new tab. The page is deliberately plain for now. Epic 2 adds categories, discounts and the real design. Also try http://localhost:4321/health, which returns `ok` and writes one structured JSON log line.

If the database cannot be read, the page answers **503** with "Sales are loading, check back soon." and logs one `home_failed` line with the real error. If the database works but has no visible stores, it shows the same message with a normal 200. The message never contains technical detail.

Stop the dev server with `pnpm --filter @saleaway/web exec astro dev stop`.

## Test and check

```bash
pnpm test         # Vitest (core, ops scripts, web app and pipeline; the pipeline tests use a real local D1)
pnpm lint         # ESLint, including a ban on console.log outside the logger
pnpm typecheck    # astro check for the web app, tsc for the other packages
```

## Layout

| Path | What it is |
|---|---|
| `apps/web` | Astro site (server-rendered on Cloudflare Workers): `src/pages` (routes), `src/components`, `src/layouts`, `src/lib` (database access and page data), `src/styles` |
| `apps/pipeline` | Cloudflare Worker for the daily job: schedule, queue and run log (it does not fetch any page yet, that is Story 3.2) |
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

## Pipeline

The pipeline Worker (`saleaway-pipeline`) runs the daily job. **Today it is the skeleton only: it does not fetch any store page yet** (Stories 3.2 to 3.5 add the fetcher, validation, extraction and saving of sale records). Every run records one result per store, so the plumbing can be checked end to end.

| What | When |
|---|---|
| Start a run | every day at **03:00 UTC** (05:00 South African time) |
| Close the run (record the totals) | every day at **03:45 UTC** (05:45 South African time) |

- **How a run works:** the start cron records a run and puts one message per visible store on the queue `saleaway-fetch`, each delayed a bit more than the one before (`STAGGER_SECONDS`, 15 by default, so about 23 minutes for 92 stores). A queue consumer handles one store per message and records one result in `run_results`. A store that fails is retried once and then recorded as an `error`, so one store never stops the others. The close cron writes the finish time and the totals (`stores_ok`, `stores_failed`) into `pipeline_runs`. For now, the 3 manual stores record `skipped_manual` and the other stores record `error` with `fetcher_not_built_yet`.
- **Settings:** the variables `FINALIZE_CRON`, `STAGGER_SECONDS` and `PIPELINE_ENABLED` are in `apps/pipeline/wrangler.jsonc`. The only secret is `ADMIN_TOKEN` (set with `wrangler secret put ADMIN_TOKEN`, never in the repository, kept in your password manager).
- **Queue allowance:** the Free plan includes 10,000 queue operations a day. A delivered message costs about 3, so a run of 92 stores uses about 280, plus one more for each retry.

### Run it by hand

```bash
export ADMIN_TOKEN='...'      # from your password manager; never put it in a file in this repository
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://saleaway-pipeline.<account>.workers.dev/admin/run
# 200 {"ok":true,"runId":12,"storesTotal":92}   401 wrong or missing token   409 the pipeline is paused
```

A manual run starts a **new** run. Once the fetcher exists (Story 3.2) it will fetch every store again, which breaks the "one page fetch per store per day" politeness rule, so use it sparingly. A manual run is closed by the next 03:45 UTC close cron.

### Pause and resume

Set `"PIPELINE_ENABLED": "false"` in `apps/pipeline/wrangler.jsonc` and run `pnpm deploy:pipeline`. Only the exact text `false` pauses it. While paused, no run starts (cron or manual, the manual endpoint answers 409) and no run is closed. Messages already on the queue are still processed, and an open run is closed by the first close cron after you resume (set it back to `"true"` and redeploy). A change made only in the Cloudflare dashboard is overwritten by the next deploy.

### Check a run

```bash
pnpm --filter @saleaway/web exec wrangler d1 execute saleaway --remote --command \
"SELECT id, trigger, started_at, finished_at, stores_total, stores_ok, stores_failed FROM pipeline_runs ORDER BY id DESC LIMIT 5"
```

A healthy run has a `finished_at` and `stores_ok + stores_failed = stores_total`. A smaller sum means some stores have no result (the Worker or the queue failed part way). Per-store detail is in `run_results` (`WHERE run_id = <id>`). Watch the live Worker with `pnpm --filter @saleaway/pipeline exec wrangler tail saleaway-pipeline --format json`.

### Try it on your computer

```bash
pnpm db:migrate:local                    # once, and after new migrations
printf 'ADMIN_TOKEN=local-test-token-not-a-secret\n' > apps/pipeline/.dev.vars     # git-ignored
pnpm --filter @saleaway/pipeline exec wrangler dev --test-scheduled --persist-to ../web/.wrangler/state --var STAGGER_SECONDS:1
# in another terminal (the port is printed; 8787 is the default):
curl "http://localhost:8787/__scheduled?cron=0+3+*+*+*"     # start a run
curl "http://localhost:8787/__scheduled?cron=45+3+*+*+*"    # close it
```

`--persist-to ../web/.wrangler/state` makes the pipeline use the same local database as `pnpm dev` (with the seeded stores). Add `--var PIPELINE_ENABLED:false` to try the pause. To roll the deployed Worker back: `pnpm --filter @saleaway/pipeline exec wrangler rollback --name saleaway-pipeline`.

## Rules that matter

- Never put secrets in the repository. Real values live in Cloudflare settings or a git-ignored `.dev.vars` file. `.env.example` lists variable names only.
- Log only through the logger in `packages/core`, never with `console.log` directly.
- `packages/core` does no I/O and never reads the clock.
