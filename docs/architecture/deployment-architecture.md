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

```yaml
# .github/workflows/deploy.yml (shape; built in Story 4.4, after the local-first build)
name: deploy
on:
  push: { branches: [main] }
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: lts/*, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint && pnpm typecheck && pnpm test
  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: lts/*, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm db:migrate:remote
        env: { CLOUDFLARE_API_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}", CLOUDFLARE_ACCOUNT_ID: "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}" }
      - run: pnpm deploy:all
        env: { CLOUDFLARE_API_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}", CLOUDFLARE_ACCOUNT_ID: "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}" }
```

## Environments

| Environment | Frontend URL | Backend URL | Purpose |
|---|---|---|---|
| Development | http://localhost:4321 | local Wrangler, local D1 | Local development |
| Staging | `*.workers.dev` URL, used until the domain is connected | `saleaway-pipeline.<account>.workers.dev` | Pre-launch testing. No separate staging database for the MVP |
| Production | https://saleaway.co.za | `saleaway-pipeline.<account>.workers.dev/admin/run` (token only) | Live |

The domain `saleaway.co.za` must have its DNS on Cloudflare for a custom domain on a Worker. This is still an open question (PRD Story 4.4). Until then the site runs locally and on a `workers.dev` address (Story 1.2).

## Rollback, pause and dependency upkeep

- **Rollback:** `wrangler rollback` returns a Worker to its previous version. Migrations are written to be additive (new tables and columns only), so rolling the code back never needs a database rollback.
- **Pause the pipeline:** the `scheduled` handler checks a `PIPELINE_ENABLED` variable and returns immediately when it is `false`. Change it in the Cloudflare dashboard or with a redeploy. The README documents this (PRD Story 4.5).
- **Database recovery:** the database can be rebuilt from the seed file plus the next pipeline run. Only overrides are hand-entered, and `ops:override --export` saves them to the repository. D1 also offers point-in-time restore (Time Travel). It is always on and, per Cloudflare's docs, keeps 7 days of history on the Free plan (30 on Paid); `wrangler d1 time-travel info saleaway` returned a current bookmark on 2026-10-29 (Story 1.3). A restore (`wrangler d1 time-travel restore`) overwrites the database in place.
- **Dependency upkeep:** enable Dependabot (or Renovate) for weekly update pull requests, and run `pnpm audit` in CI. Any new retailer or ad script that is added to the page needs a CSP review.
