# Deployment Architecture

## Deployment Strategy

**Frontend Deployment:**
- **Platform:** Cloudflare Workers (Astro SSR with static assets).
- **Build Command:** `pnpm --filter web build`.
- **Output Directory:** `apps/web/dist`.
- **CDN/Edge:** Cloudflare edge. Static assets served directly, HTML cached with the Cache API for about 10 minutes.

**Backend Deployment:**
- **Platform:** Cloudflare Workers (pipeline).
- **Build Command:** none beyond Wrangler's own bundling.
- **Deployment Method:** `wrangler deploy` from GitHub Actions, then `wrangler d1 migrations apply --remote` before the deploy when new migrations exist.

## CI/CD Pipeline

**As built in Story 4.4 (2026-10-31).** Two workflows in `.github/workflows/`:

- **`ci.yml`** runs on every pull request, and `deploy.yml` calls it. One job on `ubuntu-latest`: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, then the Playwright browser (`playwright install --with-deps chromium`) and `pnpm test:smoke` (the smoke test with the axe check). Node comes from `.nvmrc` and pnpm from the `packageManager` field of `package.json`. It uses no secret.
- **`deploy.yml`** runs on a push to `main` and by hand (`workflow_dispatch`). It calls `ci.yml`; its `deploy` job `needs` that job, so a failing build or test stops the deploy. The deploy job runs only when the branch is `main` **and** the repository variable `DEPLOY_ENABLED` is the text `true` (the launch switch: without it a push runs the checks and stops). Its steps, in this order: `pnpm db:migrate:remote` (new migrations first; they are additive), `pnpm deploy:web`, `pnpm ci:wait-for-quiet-window`, `pnpm deploy:pipeline`. Only the three steps that talk to Cloudflare receive the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Deploys never run at the same time and a running one is never cancelled (`concurrency`).
- **The quiet window.** The nightly run is on between 03:00 and 03:45 UTC, and a deploy of the pipeline then could cut a store short. `ci:wait-for-quiet-window` (`scripts/ops/src/wait-for-quiet-window.ts`, with the pure `msUntilQuietWindow` in `deploy-window.ts`) returns at once outside 02:50:00 to 03:49:59 UTC and inside it waits until 03:50 UTC. The web app is deployed before the wait; only the pipeline waits. The deploy job's limit is 90 minutes and each step has its own limit.
- **Checked as text** by `scripts/ops/tests/workflows.test.ts`: the deploy needs the checks, is gated on the branch and the variable, applies migrations before the web deploy and waits before the pipeline deploy, gives the secrets only to the three Cloudflare steps, uses actions at a major version, and holds no literal secret.

The token for `CLOUDFLARE_API_TOKEN` is made from Cloudflare's "Edit Cloudflare Workers" template plus Account D1 Edit, Account Queues Edit, and Zone DNS Edit and Zone Read for `saleaway.online`.

## Environments

| Environment | Frontend URL | Backend URL | Purpose |
|---|---|---|---|
| Development | http://localhost:4321 | local Wrangler, local D1 | Local development |
| Staging | `*.workers.dev` URL, used until the domain is connected | `saleaway-pipeline.<account>.workers.dev` | Pre-launch testing. No separate staging database for the MVP |
| Production | https://saleaway.online | `saleaway-pipeline.<account>.workers.dev/admin/run` (token only) | Live |

The domain `saleaway.online` is registered in Cloudflare and uses its nameservers. `apps/web/wrangler.jsonc` lists `saleaway.online` and `www.saleaway.online` as custom domains of the web Worker (each hostname is its own entry: a custom domain is an exact match, with no wildcard), and the first deploy creates the DNS records and the certificates. The Worker sends `www` to the apex with a 301 (`apps/web/src/lib/host.ts`). Only the web Worker has a domain: the pipeline stays on its `workers.dev` address (its one endpoint, `/admin/run`, needs the bearer token). The Workers Cache API that holds the page cache works on custom domains, so a cache hit (`x-cache: HIT`) can only be seen on the real domain.

## Rollback, pause and dependency upkeep

- **Rollback:** `wrangler rollback` returns a Worker to its previous version. Migrations are written to be additive (new tables and columns only), so rolling the code back never needs a database rollback.
- **Pause the pipeline:** the `scheduled` handler checks a `PIPELINE_ENABLED` variable and returns immediately when it is exactly `false`, and the manual run endpoint answers 409. A paused pipeline starts no run (cron or manual) and closes none, and an open run is closed by the first close step after resuming; messages already on the queue are still processed. Change it in `apps/pipeline/wrangler.jsonc` and redeploy (a dashboard edit is overwritten by the next deploy). The README documents this (Story 3.1 and PRD Story 4.5).
- **Database recovery:** the database can be rebuilt from the seed file plus the next pipeline run. Only overrides are hand-entered, and `ops:override --export` saves them to the repository. D1 also offers point-in-time restore (Time Travel). It is always on and, per Cloudflare's docs, keeps 7 days of history on the Free plan (30 on Paid); `wrangler d1 time-travel info saleaway` returned a current bookmark on 2026-10-29 (Story 1.3). A restore (`wrangler d1 time-travel restore`) overwrites the database in place.
- **Dependency upkeep:** enable Dependabot (or Renovate) for weekly update pull requests, and run `pnpm audit` in CI. Any new retailer or ad script that is added to the page needs a CSP review.
