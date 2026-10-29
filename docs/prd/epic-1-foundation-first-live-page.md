# Epic 1 Foundation & First Live Page

**Goal:** Establish the repository, the Cloudflare deployment pipeline and the database, and ship a first live page listing the seeded stores. This gives a working, deployable product on day 1 and a base for everything else.

## Story 1.1 Project Scaffold and Local Canary

As the operator,
I want a monorepo with a web app that runs on my computer,
so that every later story builds on a working base.

### Acceptance Criteria

1. The repository has a monorepo structure with the web app, a pipeline Worker placeholder, shared code and docs, and is committed to git.
2. The web app runs locally with one command (`pnpm dev`) and serves a canary page with the text "Saleaway" and a `/health` route returning OK.
3. A short README explains how to run, test and deploy locally.
4. Structured logging helper exists and is used by the health route (NFR11).
5. No secrets are in the repository (NFR10).
6. Lint, type-check and test commands exist, and Vitest runs one passing example test in the shared core package, so the CI in Story 4.4 has something to run.
7. Node 22 is pinned (`.nvmrc` and `engines`), because Wrangler needs Node 20 or newer.

## Story 1.2 First Deploy to workers.dev

As the operator,
I want the canary site deployed to a free Cloudflare address,
so that we find Cloudflare-specific problems early, before the domain exists.

### Acceptance Criteria

1. The web Worker and a pipeline Worker placeholder are deployed with `wrangler deploy`, using the operator's existing Cloudflare login, to `*.workers.dev` addresses. No domain, GitHub repository or CI is needed.
2. The D1 database is created in the Cloudflare account and bound to both Workers, locally and on Cloudflare.
3. `/health` returns OK on the deployed address, and its log line appears in Workers Logs (this also confirms the free logging allowance).
4. The architecture's spike S0 is recorded: whether the Cache API caches responses on `workers.dev`, and the Worker bundle size against the Free plan limit.
5. The README explains the manual deploy and how to roll back (`wrangler rollback`).
6. No secrets are committed (NFR10).

## Story 1.3 Database Schema and Retailer Seed

As the operator,
I want the database and all stores loaded,
so that the site and pipeline have data to work with.

### Acceptance Criteria

1. D1 migrations create tables for categories, retailers, sale records, overrides, pipeline runs and run results (FR1, FR9, FR11, FR12), and the 10 categories are seeded. The click counts table arrives later with Story 2.5.
2. A seed script loads `docs/data/retailers-seed.tsv` and is safe to run more than once (no duplicates).
3. After seeding, the table holds all 106 spreadsheet stores (plus Crocs SA once its URL is found). The 92 with primary sale URLs are visible, and the 14 without (12 with no sale page, 2 with only a Black Friday page) are hidden (FR2). Stores listed in several categories get unique slugs, and non-numeric ranks ("Alt") are mapped to numbers (see `docs/architecture.md`, "Seed data rules").
4. Adding a store is documented as inserting one row (FR3).
5. Migrations can run locally and in production.

## Story 1.4 First Live Store List

As a bargain hunter,
I want to see a list of stores with sales and click through to them,
so that I can start finding deals right away.

### Acceptance Criteria

1. The home page reads visible stores from D1 and shows one card per store with the store name and "On sale".
2. Each card links to the store's sale URL in a new tab, with `rel="noopener"`.
3. The page works on a phone-width screen.
4. The page works locally and on the deployed `workers.dev` address.
5. Page reads handle an empty or failing database gracefully, with a friendly message.
