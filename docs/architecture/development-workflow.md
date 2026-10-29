# Development Workflow

## Build order: local first (decided 2026-10-29)

The system is built and tested on the developer's computer first. `wrangler dev` provides a local D1 database, local queues and test-triggered crons, so Epics 1 to 3 can be developed without a domain, GitHub repository or CI.

- **Early deploy:** Story 1.2 deploys the canary to a free `*.workers.dev` address, using the existing `wrangler login`. This is needed early because the 10 ms CPU limit and retailer blocking (risks R1 and R2) can only be measured on Cloudflare's network, not locally.
- **Late:** the domain, GitHub Actions deploys and the API token come in Story 4.4, shortly before launch. Start the domain registration and nameserver change in parallel from day 1.
- **Cache behaviour on `workers.dev`:** measured in Story 1.2 (spike S0): the Cache API does cache on `workers.dev`. Caching of the real home page is still confirmed on the production domain in Story 4.4. See `docs/spike-s0-workers-dev.md`.

## Local Development Setup

### Prerequisites

```bash
nvm use             # reads .nvmrc (Node 22). Wrangler needs Node 20 or newer
npm install -g pnpm
npx wrangler login  # opens the browser to authorise your Cloudflare account
```

### Initial Setup

```bash
pnpm install
pnpm --filter pipeline exec wrangler d1 create saleaway           # once, copy the id into both wrangler files
pnpm db:migrate:local                                              # apply migrations to the local D1
pnpm ops:seed --local                                              # load docs/data/retailers-seed.tsv
```

### Development Commands

```bash
# Start everything
pnpm dev

# Start frontend only
pnpm --filter web dev

# Start the pipeline Worker only, with scheduled testing
pnpm --filter pipeline exec wrangler dev --test-scheduled

# Run tests
pnpm test            # unit + integration (Vitest)
pnpm test:smoke      # Playwright smoke + axe, against the built site
pnpm lint && pnpm typecheck
```

## Environment Configuration

### Required Environment Variables

```bash
# Web Worker (wrangler vars)
CLICK_SAMPLE_RATE=1.0
CF_WEB_ANALYTICS_TOKEN=<token>      # public, goes in the page

# Pipeline Worker (wrangler vars)
FINALIZE_CRON="45 3 * * *"
STAGGER_SECONDS=15

# Secrets (wrangler secret put, never committed)
ADMIN_TOKEN=<random 32+ characters>
ALERT_WEBHOOK_URL=<Discord, Slack or similar webhook>

# GitHub Actions secrets
CLOUDFLARE_API_TOKEN=<scoped token>
CLOUDFLARE_ACCOUNT_ID=<id>
```
