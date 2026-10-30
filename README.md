# Saleaway

Saleaway (saleaway.online) shows current sales from South African online stores in one place. A daily job reads each store's sale page and the website lists which stores have a sale and how deep the discounts go.

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

Then open http://localhost:4321 for the store list: one card per visible store (92 after seeding, 57 once the stores that block the pipeline are hidden, see [Hidden stores](#hidden-stores)), each opening the store's sale page in a new tab. The page is deliberately plain for now. Epic 2 adds categories, discounts and the real design. Also try http://localhost:4321/health, which returns `ok` and writes one structured JSON log line.

If the database cannot be read, the page answers **503** with "Sales are loading, check back soon." and logs one `home_failed` line with the real error. If the database works but has no visible stores, it shows the same message with a normal 200. The message never contains technical detail.

### Which stores the page shows

A store is shown unless one of these hides it (rules in `packages/core/src/visibility.ts`, tested): the operator has hidden it (`is_visible` 0, see [Hidden stores](#hidden-stores)); it has no `https://` sale address; an active override hides it; its sale record is `ended` (unless an active override sets a percentage); or it has not been checked for **more than 72 hours** (a store that has never been checked counts from the time it was added). **A store with an active override is not judged stale while the override is active** (see [Overrides](#overrides)). An override's percentage and sale address replace the stored ones, and an expired override is ignored. **Nothing is ever deleted when a store disappears**: it is only hidden, and it comes back when it is checked again. The rules take the current time as an input, so they can be tested.

> **Not deployed yet.** This code is in the repository but the live web app does not use it: every store was added on 2026-10-29, nothing records checks until Story 3.5, and the 72 hour rule would empty the live page from 2026-11-01 12:58 UTC. Deploy it together with Story 3.5, or decide otherwise with the project owner.

Stop the dev server with `pnpm --filter @saleaway/web exec astro dev stop`.

## Test and check

```bash
pnpm test         # Vitest (core, ops scripts, web app and pipeline; the pipeline tests use a real local D1)
pnpm lint         # ESLint, including a ban on console.log outside the logger
pnpm typecheck    # astro check for the web app, tsc for the other packages
pnpm test:smoke   # Playwright and axe on the built site (needs a browser once: `pnpm --filter @saleaway/web exec playwright install chromium`)
```

The smoke test starts the built site on its own small local database (`apps/web/.wrangler/smoke`), so it never changes the data `pnpm dev` shows. `pnpm test` does not run it.

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

### Hidden stores

On 2026-10-30 the first fetch from the deployed Worker found that 34 of the 89 stores fetched answer it with 403 or 429 (`docs/fetch-spike.md`). Contacting retailers is ruled out and the pipeline never tries to hide who it is, so those stores, and one more listing on the same website, are **hidden for launch**: not fetched by the daily run and not shown on the site. The decision is a recorded list, [`docs/data/hidden-stores.json`](docs/data/hidden-stores.json) (the slug of each store, a reason code and the date), and **not a rule**: blocking can change from day to day, so nothing hides or shows a store by itself.

```bash
pnpm ops:hide --local                  # hide every store on the list in the local database
pnpm ops:hide --remote                 # the same in the live database (Wrangler asks before it writes, when it can)
pnpm ops:hide --undo --remote          # show them all again
pnpm ops:hide --undo --remote --slug dis-chem   # show one store only (it must be on the list)
```

- **It changes nothing else.** One `UPDATE` sets `is_visible` (and `updated_at`) for the listed stores. Running it twice gives the same result, and re-running the seed never undoes it. The command reads the list, checks it, makes the change, then asks the database whether it really happened and exits with an error if not. The result is 92 visible stores before and **57 after**, with at least 3 stores in every category.
- **To test a hidden store again:** `POST /admin/run?store=<slug>` (see "Run it by hand"). If the result is `ok`, show it with `pnpm ops:hide --undo --remote --slug <slug>` and delete its entry from the list in the same commit.
- **Showing a store is not fixing it.** `--undo` only makes the store visible. It keeps its extraction method, so the nightly run fetches it again, and a store that still blocks would be blocked again. Use `--undo` only for a store that has just answered. To show a store that still blocks with hand-entered values, it has to be set to the `manual` method with an override (Story 4.1, criterion 8, and Story 5.4).
- **`--undo` shows every store you name**, including one an operator had hidden for another reason.
- **Caching:** the home page is not cached yet, so a change shows at once. Once Story 2.4 adds caching, allow about 10 minutes.

### Overrides

An override is the operator's own answer for one store: a percentage, a sale address, a hide flag and an expiry date. It beats what the pipeline found (a percentage also beats an `ended` record, so it is the quick fix for a store that was wrongly ended), and **the pipeline never changes or deletes it**. A store has at most one. The command is `pnpm ops:override`, with `--local` (the database `pnpm dev` reads) or `--remote` (the live one) and one mode. Every value is checked before anything is written, and afterwards the database is read back to be sure.

```bash
# set a percentage and an expiry (a store with no override gets one; with one, only the named fields change)
pnpm ops:override --remote --slug amazon-co-za --percent 35 --expires 2026-11-30 --note "checked by hand 2026-10-31"
pnpm ops:override --remote --slug amazon-co-za --url https://www.amazon.co.za/deals   # change only the address
pnpm ops:override --remote --slug makro --hide                  # remove a store from the site (the pipeline still fetches it)
pnpm ops:override --remote --slug makro --unhide
pnpm ops:override --remote --slug amazon-co-za --percent none   # clear one field (also --url none, --expires none)
pnpm ops:override --remote --slug amazon-co-za --clear          # delete the override
pnpm ops:override --remote --list                               # every override, active or expired
pnpm ops:override --remote --export                             # write them to docs/data/overrides.json (commit it)
pnpm ops:override --remote --import                             # restore them from that file
# show a store that Story 3.9 hid, with manual values (see "Hidden stores")
pnpm ops:override --remote --slug zara-sa --bring-back --percent 30 --expires 2026-11-30
```

- **What is accepted.** A percentage is a whole number from 1 to 99. An address must start with `https://` (lower case) and be one piece with no space in it, to a public website (no IP address, no port, no login in it). An expiry is a date `YYYY-MM-DD` that is today or later; the override applies **through the end of that day (UTC)**, which is two hours into the next morning in South Africa. A note is at most 200 characters. Anything else is refused and nothing is written.
- **`created_at` is the time of the last change.** Running the command again on a store updates it.
- **While an override is active, the store is not judged stale** (the 72 hour rule), because you are vouching for it. **Always give an `--expires`** (a month at most): an override with no expiry keeps the store on the site until you clear it, and the command warns when you leave it out. After the expiry the override is ignored and the store is judged by the pipeline's records again; the row stays until you clear it.
- **`--hide` hides only on the site.** It is not the hide of Story 3.9: the pipeline still fetches the store. To stop fetching a store that blocks the pipeline use `pnpm ops:hide`.
- **`--bring-back` is the way to show a store that blocks the pipeline.** `pnpm ops:hide --undo` only makes it visible, and the nightly run would ask it again. `--bring-back` writes the override (hide flag cleared) and then makes the store `manual` (never fetched) and visible, and, with `--remote`, takes it off `docs/data/hidden-stores.json`; commit that file. It refuses a store that has no `https://` sale address unless you give one with `--url`. If it is the last store on the list the file keeps it: delete the file by hand.
- **The three manual stores** (Amazon.co.za, Game, Checkers Sixty60) are never fetched and have no record, so they appear on the site only while they have an active override. Give each one.
- **Backup.** `--export` writes `docs/data/overrides.json` (the slug, the fields, the note and the time of every override). Commit it after you change overrides. `--import` puts them back with their saved times and leaves other overrides alone.
- **When the site sees it.** The web app reads overrides on every page view today (no page cache yet), but the live web app does not use overrides until it is deployed (Story 2.3 and Story 3.5: after the morning check).

### Recovery

D1 Time Travel is always on and keeps 7 days of history on the Free plan. `wrangler d1 time-travel info saleaway` shows the current bookmark, and `wrangler d1 time-travel restore saleaway --bookmark=<id>` (or `--timestamp=<unix time>`) rolls the database back. **A restore overwrites the database in place**, so note the current bookmark first. Applying a migration also captures a backup. The store list can always be rebuilt with `pnpm ops:seed --remote`. Only overrides (Story 4.1) are hand-entered data.

### Search engines and the page cache

**Indexing is off until launch.** While `ALLOW_INDEXING` in `apps/web/wrangler.jsonc` is `"false"` (the default), every page sends `X-Robots-Tag: noindex, nofollow` and `robots.txt` says `Disallow: /`, so the `workers.dev` page does not end up in a search engine. At launch (the launch checklist, Story 4.5) set it to `"true"` and deploy the web app. The home page is kept in Cloudflare's cache for about 10 minutes (`x-cache: HIT` in the response headers shows it), so a change in the data shows within 10 minutes. A deploy starts a new cache: the pages of the previous build are never served.

## Deploying

Both Workers run on Cloudflare's Free plan at `workers.dev` addresses, deployed by hand from this computer. CI/CD and the real domain (`saleaway.online`) come in Story 4.4.

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

The pipeline Worker (`saleaway-pipeline`) runs the daily job. **Today it fetches each store's sale page politely and classifies the answer** (Story 3.2). It does not yet check that the page shows a real sale, read a discount, or save sale records (Stories 3.3 to 3.5). Every run records one result per store, with the HTTP status, how long it took, and a short reason when the result is not `ok`.

| What | When |
|---|---|
| Start a run | every day at **03:00 UTC** (05:00 South African time) |
| Close the run (record the totals) | every day at **03:45 UTC** (05:45 South African time) |

- **How a run works:** the start cron records a run and puts one message per visible store on the queue `saleaway-fetch`, each delayed a bit more than the one before (`STAGGER_SECONDS`, 15 by default, so about 23 minutes for 92 stores and about 14 for the 57 visible at launch). **Keep (number of stores - 1) x `STAGGER_SECONDS` under about 40 minutes** (26 seconds or less for 92 stores): the close cron runs 45 minutes after the start, and a run that is still going then is closed with the missing stores counted as a gap. A queue consumer handles one store per message and records one result in `run_results`. A store that fails is retried once and then recorded as an `error`, so one store never stops the others. The close cron writes the finish time and the totals (`stores_ok`, `stores_failed`) into `pipeline_runs`. Each store's result is one of `ok`, `js_only` (the page is known to load its products with JavaScript, so it can only be checked by address), `blocked`, `not_found`, `redirected_away`, `error`, or `skipped_manual` (a manual store is never fetched).
- **Settings:** the variables `FINALIZE_CRON`, `STAGGER_SECONDS`, `PIPELINE_ENABLED` and `MEASURE_CPU` (leave it `false`: it is a measurement switch, see below) are in `apps/pipeline/wrangler.jsonc`. The only secret is `ADMIN_TOKEN` (set with `wrangler secret put ADMIN_TOKEN`, never in the repository, kept in your password manager).
- **Queue allowance:** the Free plan includes 10,000 queue operations a day. A delivered message costs about 3, so a run of 92 stores uses about 280 (about 175 for the 57 visible at launch), plus one more for each retry.

### Run it by hand

```bash
export ADMIN_TOKEN='...'      # from your password manager; never put it in a file in this repository
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://saleaway-pipeline.<account>.workers.dev/admin/run
# 200 {"ok":true,"runId":12,"storesTotal":92}   401 wrong or missing token   409 the pipeline is paused
```

A manual run starts a **new** run and fetches **every store again**, which breaks the "one page fetch per store per day" politeness rule, so do it rarely. To test one store, add `?store=<slug>` (for example `.../admin/run?store=bash-tfg`): that runs only that store. The slug must be the store's slug from the `retailers` table; a bad slug gives 400 and an unknown or non-https store gives 404. A **hidden** store is accepted, so it can be tested again before it is shown (see [Hidden stores](#hidden-stores)). A manual run is closed by the next 03:45 UTC close cron.

### How the fetcher behaves (and what it will never do)

- It asks the site's `robots.txt` first and obeys it. A page that `robots.txt` forbids is recorded as `blocked` (reason `robots_disallow`) and is not requested. A `robots.txt` that cannot be reached (a 5xx answer or a timeout) is recorded as an `error` (`robots_unreachable`) and the page is not requested. A missing `robots.txt` (a 4xx answer) means everything is allowed.
- Every request says who it is: `SaleawayBot/1.0 (+https://saleaway.online/contact)`. It waits at most 10 seconds, follows at most 3 redirects, and only ever requests `https` addresses (a redirect to `http` or to an IP address is not followed).
- **It does not try to get past bot protection.** No disguised user-agent, no cookies, no solving of challenge pages, and no second attempt after a `blocked` answer. A blocked store is recorded and an operator decides: usually the `manual` method (Story 4.1).
- A store with the `manual` method is never contacted, not even for `robots.txt`. It never saves any page content (a page is read only to be judged, and only counts and a verdict are logged).
- Each store makes one `robots.txt` request and one page request per run, spaced out by the stagger.

### How a page is judged

Since Story 3.3 the pipeline reads each sale page it fetched (an ordinary `ok` answer, at most 3 MiB) and decides what it is. The rules are in `packages/core/src/validate.ts` and are tested on small trimmed samples of real pages (`packages/core/tests/fixtures/pages/`, with a manifest `index.json`). There are four answers:

- **valid**: the page shows discounted products (percentage-off labels, old and new prices, or price fields in its data, and at least two prices);
- **ended**: the page is up but there is no sale on it (an error page, an empty listing, products with no discount, or it sent us to the home page);
- **blocked**: the page is a robot check or a login page, which is treated like a blocked request (the last good record is kept);
- **unverifiable**: the page cannot be judged, for example a JavaScript application whose products are not in the HTML, or a page that was cut at the size limit. Such a store is shown as "On sale", checked by its address only.

A page is called "not a sale" only when something on it says so. For now the answer is only **written to the log** (one `page_validated` line per store, with counts and the answer, never page text); saving it is Story 3.5, and the live site does not change.

### Check the first records

Since Story 3.5 the nightly run saves a **sale record** for each store it fetches: whether the sale is `active` or `ended`, how it was checked (`content_verified` for a page that shows discounted products, `url_verified` for a page that cannot be read, such as a JavaScript application), and when it was first seen, last checked and last validated. A blocked or failed night keeps the last good record. The live web app does **not** use the records yet (Story 2.3 is not deployed), so nothing on the site changes.

**The morning check, before the web app is deployed.** The rules of Story 3.3 are new and were tested on 7 real pages, and a store judged `ended` would disappear from the site once the web app uses the records. After a run, look (read-only, nothing is changed):

```bash
pnpm --filter @saleaway/web exec wrangler d1 execute saleaway --remote --command \
"SELECT state, validation, COUNT(*) AS n FROM sale_records GROUP BY state, validation"

pnpm --filter @saleaway/web exec wrangler d1 execute saleaway --remote --command \
"SELECT r.slug, s.last_result, s.last_checked_at FROM sale_records s JOIN retailers r ON r.id = s.retailer_id WHERE s.state = 'ended' ORDER BY r.slug"
```

Open a few of the stores in the second list in a browser. If one still shows a real sale, the rule is wrong for that store: do not deploy the web app yet, and tell the developer which store. Stores with a `last_result` of `blocked` or `error` and the state `unknown` have never been checked successfully.

### How the discount is read

For a page that was judged **valid**, the pipeline also works out the deepest discount (Story 3.4), by the store's extraction method, and saves it as a whole percentage from 5 to 90 (anything else is ignored, and a store with nothing readable is shown as "On sale"):

- **`html`:** the page's was and now prices (an old price marked as `old-price`, `line-through`, `<s>` and so on, with the nearest lower price), and only if there are none, its "30% off" style labels. A label in a menu, header or footer is ignored, and a price pair beats a label because a label can come from a banner.
- **`structured_data`:** the price fields in the page's data (a list price and a price), then the page as above.
- **`shopify_json`:** the store's product feed (`/collections/<name>/products.json`), asked once a night, only when the store's address is a collection, and never retried; if it does not answer, the page is used.
- **`manual`:** nothing is read: the number comes from an override (see [Overrides](#overrides)).

A page that cannot be judged (a JavaScript page, a cut page) or that shows no sale has no percentage. Each night's result is one `discount_extracted` log line per store (the method, the percentage and what happened to the feed), never any page text. The live site does not show percentages yet (Story 2.1).

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
pnpm ops:seed --local                    # once: load the stores (without them a run has 0 stores)
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
