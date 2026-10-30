# Epic 4 Overrides, Operations & Launch Readiness

**Goal:** Give the operator the tools to fix problem stores by hand, see the system's health, and confirm every link before launch, so the site can launch honestly on day 3.

## Story 4.1 Manual Override Command

As the operator,
I want to override a store's discount, visibility or URL,
so that blocked or broken stores still look right.

### Acceptance Criteria

1. A documented command or script can set a manual discount percentage, hide or show a store, and change its sale URL (FR12). Hiding a store here (an override) is not the same as hiding it with `is_visible` (Story 3.9): an override hide only removes the store from the site, and the pipeline still fetches it.
2. An override can have an expiry date, after which it stops applying.
3. Overrides win over extracted values, and the pipeline never deletes them.
4. Changes take effect on the site without a redeploy, within the page cache lifetime of about 10 minutes (FR3). The override precedence rules themselves are built in Story 2.3.
5. Amazon.co.za, Game and Checkers are set to manual by default.
6. `ops:override --export` saves all overrides to a file in the repository, so the hand-entered data can be restored.
7. Values passed to the command are validated before they are used in SQL (see Coding Standards in `docs/architecture.md`).
8. A store hidden by Story 3.9 can be shown with manual values in one step: the command sets it to the `manual` method (so the pipeline never fetches it again), makes it visible, adds the manual override, and removes the store from `docs/data/hidden-stores.json`. Without the `manual` method, showing it would make the pipeline fetch a blocked store every night.

## Story 4.2 Health Report

As the operator,
I want to see how the system is doing,
so that I can fix problems before visitors notice.

### Acceptance Criteria

1. A report run from the command line (with no public page) shows the last run's time and status, and each store's last result (FR21).
2. It shows counts for stores with a percentage, "On sale", blocked, hidden and stale.
3. It shows the pipeline success rate (NFR5) and the oldest sale record age (NFR3).
4. The report is not accessible to the public.
5. The report shows the day's Worker requests and D1 rows written against the free limits if the Cloudflare API provides them, or points to the dashboard page where they can be seen. It flags when requests pass 50,000 a day (see "Black Friday traffic decision" in `docs/architecture.md`).

## Story 4.3 URL Verification Pass

As the operator,
I want every seeded sale URL checked,
so that visitors don't land on dead pages.

### Acceptance Criteria

1. A script flags every seeded URL that does not return a successful page.
2. The 21 search-only URLs are checked in a browser and their status is updated in the Retailers table.
3. The Crocs SA row (seeded hidden, without a URL) gets its sale URL and is made visible.
4. Stores whose URL cannot be fixed are hidden.
5. Black Friday URLs showing 2025 content are marked unverified (supports Story 2.6).
6. The script runs from the operator's computer with the pipeline's user-agent and its `robots.txt` and URL-safety rules (these are shared code in `packages/core`), at most once a day, and records for each store hidden by Story 3.9 whether it answers from there. This is the free test of another network, and its result is the input for Story 5.4 and for Story 3.8.

## Story 4.4 CI/CD and Domain

As the operator,
I want automatic deploys on push and the real domain connected,
so that releases are quick and safe, and the site is reachable at saleaway.online.

### Acceptance Criteria

1. Pushing to the main branch builds, tests and deploys to Cloudflare automatically, applying new database migrations first.
2. A failing build or test stops the deploy.
3. The repository secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) are set, and no secret is in the repository (NFR10).
4. saleaway.online (and www) points to the deployed site over HTTPS. If the domain is not yet on Cloudflare, the steps are documented and launch uses the temporary `workers.dev` address.
5. Page caching is confirmed to work on the real domain (a repeated request is served from cache), and the result is noted (see Story 2.4, AC5).
6. Cookie-free Web Analytics is confirmed working on the real domain (see Story 2.5, AC2).
7. A deploy takes less than 5 minutes.
8. The workflow installs the Playwright browser and runs `pnpm test:smoke` (the smoke test with the axe check of Story 2.4) before the deploy step; a failure stops the deploy.

## Story 4.5 Launch Checklist

As the operator,
I want a final check before launch,
so that we launch with confidence.

### Acceptance Criteria

1. The site is live on saleaway.online over HTTPS with the daily job enabled.
2. At least one complete scheduled run has succeeded.
3. The home page, legal pages, sitemap and robots.txt all load correctly on a phone.
4. The retailer contact route works (a monitored email address).
5. A short rollback and "pause the pipeline" note exists in the README.
6. The remaining known issues are listed, including the stores hidden by Story 3.9 and why.
7. Indexing is switched on: `ALLOW_INDEXING` is set to `"true"` in `apps/web/wrangler.jsonc` and deployed (Story 2.4 ships it off, so the site is not indexed before launch), and `robots.txt` then allows crawling and lists the sitemap.

## Story 4.6 Failure Alert and Data Retention

As the operator,
I want to be told when the daily run fails and to keep the database small,
so that problems do not go unnoticed and the free database limit is never reached.

### Acceptance Criteria

1. When the run is closed (Story 3.1, AC7), a short summary is posted to the alert webhook if more than 20% of stores failed or the run did not complete **[Assumption on the 20%]**.
2. The alert is tested by forcing a failure, and the webhook address is stored as a secret (NFR10).
3. Run results older than 30 days are deleted at the start of each run, covered by a test.
