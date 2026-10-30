# Saleaway Product Requirements Document (PRD)

_Drafted by the PM agent (John) in YOLO mode from `docs/brief.md`. Items marked **[Assumption]** were decided by the PM and need your confirmation._

## Goals and Background Context

### Goals

- Show every current sale from South African online stores on one fast, mobile-friendly website.
- Refresh the data automatically every day, so visitors always see the latest sales without manual curation.
- Show how deep each store's discount goes (for example "Up to 50% off"), and link straight to the store's own sale page.
- Be live on saleaway.online in 3 days (by 31 October 2026), ahead of Black Friday on 27 November 2026.
- Grow search and direct traffic, so ad revenue can follow and affiliate links and featured placement can come later.
- Make adding a store a one-row change, with no code release.

### Background Context

South African shoppers who want a bargain have to check many retailer sites one by one, and sales start and end without notice. Saleaway automates the discovery: a daily job fetches each store's known sale page, checks it is a real sale, works out the headline discount, and saves a small fact record. The site reads from that database and shows one card per store.

A spreadsheet of 106 SA stores (`docs/data/`) provides primary sale URLs for 92 of them (94 if two stores that only have a Black Friday page are counted), and an initial fetch test (`docs/fetch-spike.md`) showed three stores (Amazon.co.za, Game, Checkers) blocking requests, and guessed sale paths failing often. The MVP therefore stores only facts (discount level, sale URL, last checked), seeds hand-picked sale URLs, falls back to "On sale" when a discount can't be read, and supports manual overrides.

### Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-10-28 | 0.1 | First PRD draft from project brief (YOLO mode) | John (PM) |
| 2026-10-28 | 0.2 | PM checklist run and results added | John (PM) |
| 2026-10-28 | 0.3 | Discount-first ordering (FR14), "Biggest discounts today" card (FR23, Story 3.7) | John (PM) |
| 2026-10-29 | 0.4 | PO validation: freshness anchor and override precedence moved into Story 2.3, human prerequisites and launch-critical set added, Stories 3.8 and 4.5 added, test tooling and CPU measurement made explicit | Sarah (PO) |
| 2026-10-29 | 0.5 | Local-first build order: Story 1.1 runs locally, Story 1.2 is now a first deploy to workers.dev, CI/CD and domain moved to new Story 4.4, launch checklist is 4.5, alert and retention is 4.6 | Sarah (PO) |
| 2026-10-30 | 0.6 | After the first live run (Story 3.2): Story 3.4 criterion 8 (repeat the CPU measurement) and new Story 3.9 (hide blocked stores for launch). The domain is `saleaway.online` in the code and architecture docs; the older text of this PRD still says `saleaway.co.za` and is for the PO to update | Bob (SM) |
| 2026-10-30 | 0.7 | Sprint change (correct-course) after the first live run: launch with 57 stores, blocked stores hidden (Story 3.9), edits to Stories 3.4, 3.6, 3.8, 4.1, 4.3 and 4.5, new Story 5.4, domain `saleaway.online` throughout, risk R2 updated (`docs/change-proposals/2026-10-30-blocked-stores.md`) | Sarah (PO) |
| 2026-10-30 | 0.8 | PO validation of Story 2.3: Story 3.5 criterion 6 (a `js_only` result updates `last_validated_at`); any active override counts as a fresh check (FR10, `core-workflows.md`) | Sarah (PO) |
| 2026-10-30 | 0.9 | PO validation of Story 3.3: a challenge or login page is treated like a blocked fetch (Story 3.3 criterion 4, Story 3.5 criterion 7, state table in `core-workflows.md`) | Sarah (PO) |
| 2026-10-30 | 1.0 | PO validation of Story 3.5: criterion 1 says the record points to the store's sale URL (the table has no URL column) | Sarah (PO) |
| 2026-10-30 | 1.1 | PO validation of Story 4.1: FR10 and Story 2.3 criterion 2 say an active override counts as a fresh check for as long as it is active (the rule of Story 2.3 changes in Story 4.1, Task 2) | Sarah (PO) |

## Requirements

### Functional

- **FR1:** The system maintains a Retailers table with, for each store: name, homepage, category, rank, platform, primary sale URL, optional Black Friday URL, extraction method, status, and a visible/hidden flag.
- **FR2:** The Retailers table is seeded from `docs/data/retailers-seed.tsv` (92 stores with primary sale URLs) plus Crocs SA once its sale URL is found. Stores with no sale page are kept but hidden. Stores that block the pipeline are hidden by a recorded decision (`docs/data/hidden-stores.json`, Story 3.9), not deleted, so they can be shown again.
- **FR3:** Adding, changing or hiding a store requires only a database row change (or the override command in FR12), with no code change or redeploy.
- **FR4:** A scheduled job runs once every 24 hours and processes every visible retailer, split into batches so each run stays inside Cloudflare free-tier limits.
- **FR5:** For each store, the job fetches the store's known sale URL with a clear user-agent, a timeout and politeness limits, and respects robots.txt.
- **FR6:** The job classifies each fetch result: OK, blocked, not found, redirected away, JavaScript-only page, or error.
- **FR7:** The job validates that a fetched page is a real, active sale with discounted products (not an error page, a redirect to the home page, or an empty listing). A page whose products load with JavaScript cannot be content-checked, so it is recorded as URL-verified only (the URL loads and the operator checked it in Story 4.3) and shown as "On sale".
- **FR8:** The job extracts the deepest discount on the page using the store's extraction method (Shopify JSON, HTML or structured-data parse, or manual) and stores it as a percentage. If no percentage can be read, the record is stored as "On sale".
- **FR9:** The job saves, per store, a sale record: status, deepest discount percentage (if known), sale URL, first seen, last checked and last validated times. It stores no retailer product content (images, descriptions, layouts).
- **FR10:** A sale that fails validation is marked ended and removed from the site on the next run. A temporary fetch failure keeps the last good record for up to 72 hours **[Assumption]** before the store is hidden. A store that has never been validated is measured from the time it was added, so the first pipeline run has 72 hours to check it, and an active override counts as a fresh check for as long as it is active (until its expiry date, if it has one).
- **FR11:** The job records every run (start, end, per-store result) so problems can be seen and fixed.
- **FR12:** An operator can override a store from a command or script: set a manual discount, hide or show the store, change its sale URL, with an optional expiry date. Overrides win over extracted values.
- **FR13:** The home page shows one row per visible store with an active sale, inside its category card: store name, "Up to X% off" or "On sale", and a link to the store's sale page, opening in a new tab.
- **FR14:** Stores are grouped into one card per category. Within a category, stores are ordered by **biggest known discount first**. Stores with only "On sale" (no percentage) follow, ordered by store rank, and ties are broken by store rank.
- **FR15:** Each row shows when the sale was last checked. Stale records (see FR10) are not shown.
- **FR16:** Cards for stores with a Black Friday URL can show a Black Friday link or badge. **[Stretch for launch]**
- **FR17:** The site has page titles, meta descriptions, Open Graph tags, a sitemap and robots.txt, so search engines can index it.
- **FR18:** The layout includes ad slots that can be switched on once an ad network approves the site.
- **FR19:** The site counts visits and click-outs per store with cookie-free analytics.
- **FR20:** The site has About / How it works, Privacy, and Contact pages. The contact page explains how a retailer can ask to be removed.
- **FR21:** An operator can see a health report: per-store last result, how many stores show a percentage vs "On sale" vs blocked, and the last run's status.
- **FR22:** For a store with no known sale URL, the job can try common paths (`/sale`, `/outlet`, `/specials`) as a fallback. **[Post-launch]**
- **FR23:** The home page shows a "Biggest discounts today" sticker card at the top of the grid, listing the 8 stores with the deepest known discounts across all categories, each with its category name. The card is hidden when fewer than 3 stores have a known percentage.

### Non Functional

- **NFR1:** All services must stay within Cloudflare free-tier limits (Workers, D1, Cron Triggers, Queues if used). Anything that needs a paid plan must be flagged to the user first.
- **NFR2:** Public pages load in under 2 seconds on a typical South African mobile connection, served from the edge or cache.
- **NFR3:** Data freshness: every visible store is re-checked at least every 24 hours, and no record older than 72 hours is shown.
- **NFR4:** The pipeline is resilient: one store's failure, block or timeout never stops the rest of the run. Runs can be safely repeated (idempotent).
- **NFR5:** Pipeline success rate of 95% or higher of scheduled runs completing.
- **NFR6:** Politeness: no more than one page fetch per store per day on the normal path (plus one robots.txt check), a clear user-agent with a contact address, robots.txt respected, and no attempt to evade bot protection.
- **NFR7:** Legal safety: store only facts (name, URL, discount percentage, timestamps). Do not copy or display retailer images, descriptions, logos or page layouts. All cards link out to the retailer.
- **NFR8:** Privacy: no cookies or personal data collected at launch, so no cookie banner is needed. POPIA obligations must be revisited when an ad network adds cookies.
- **NFR9:** Accessibility: meets WCAG AA basics (contrast, keyboard use, labels, semantic headings).
- **NFR10:** No secrets in the repository. Configuration and tokens live in Cloudflare environment settings.
- **NFR11:** Structured logging in the pipeline and site code from the first story, not added at the end.
- **NFR12:** Extraction logic is covered by automated tests that use saved page samples (fixtures), so changes to one store's parser can be tested without hitting the live site.

## User Interface Design Goals

### Overall UX Vision

A fast, clean, deal-focused page where a shopper sees who is running a sale in seconds. It should feel trustworthy and uncluttered, with a bold discount figure on every card and no sign-up needed. Mobile comes first, since most SA shoppers browse on phones.

### Key Interaction Paradigms

- Scroll through category sections of store cards.
- Tap a card to open the store's sale page in a new tab.
- No accounts, no forms, no filters at launch.

### Core Screens and Views

- **Home page:** hero line, category sections of store cards, ad slots, footer links.
- **About / How it works:** one short page explaining what Saleaway does and that discounts are read automatically and may change.
- **Privacy page.**
- **Contact / retailer removal page.**
- **Operator health report** (not public).

### Accessibility: WCAG AA

### Branding

None provided. **[Assumption]** A simple custom wordmark "Saleaway", one bold accent colour for discount figures, and neutral backgrounds. No retailer logos at launch (see NFR7). The UX Expert should propose the visual direction.

### Target Device and Platforms: Web Responsive

Mobile-first responsive web, current Chrome, Safari, Firefox and Edge.

## Technical Assumptions

### Repository Structure: Monorepo

One repository containing the web app, the pipeline Worker(s), shared types and the database migrations and seed data.

### Service Architecture

Serverless on Cloudflare, as set out in the brief:

- **Web:** Astro on Cloudflare Workers (decided 2026-10-29 in `docs/architecture.md`, chosen over Next.js because Cloudflare's Next.js route is still beta and the page is mostly static).
- **Pipeline:** Cloudflare Worker with a Cron Trigger, fanning out batches of stores (for example through Queues or several scheduled runs) to stay within free-tier request limits. **[Assumption]** The free plan currently allows about 50 outbound requests per Worker invocation. The Architect must verify the current limits.
- **Database:** Cloudflare D1 (SQLite).
- **Optional:** Browser Rendering for JavaScript-only stores, limited by its free allowance. R2 only if files are needed.

### Testing Requirements

Unit + Integration. Unit tests for validation and discount extraction using saved page samples. Integration tests for the pipeline against a local D1 database. Manual smoke test after each deploy. No full end-to-end suite for the 3-day MVP.

### Additional Technical Assumptions and Requests

- **Done in Story 3.2 (2026-10-30):** from the deployed Worker, 34 of the 89 stores fetched answered 403 or 429 (12 of the 18 Shopify stores answered 429), although the same pages loaded from a home connection. The honest user-agent is kept and no evasion is attempted (NFR6). Contacting retailers is ruled out. These stores, and one more listing on the same website, are hidden for launch (Story 3.9) and brought back one by one in Story 5.4.
- Known blocked stores (Amazon.co.za, Game, Checkers) default to the manual extraction method. Another 35 stores are hidden by decision (`docs/data/hidden-stores.json`).
- Extraction method is stored per store, so a store can be switched from "manual" to an automated method without a release.
- 19 stores load their products with JavaScript, so a plain fetch may not contain prices. These start as "On sale" until browser rendering or a data endpoint is added (Epic 5).
- The 21 search-only URLs in the spreadsheet must be checked before launch (Story 4.3).
- Some Black Friday URLs still show 2025 content, so FR16 is a stretch item.
- The CPU limit does not stop the Worker: Story 3.2 measured 5 to 108 ms per store, and Cloudflare does not enforce 10 ms on queue consumers. A fallback runner on GitHub Actions or another free network (Story 3.8, conditional) is built only if Story 4.3 or Story 5.4 shows that a different network gets through where the Worker is blocked. See `docs/architecture.md`, "Platform decision".

## Epic List

- **Epic 1: Foundation & First Live Page:** Set up the repository, local development, a first deploy to a free workers.dev address, the database and seeded retailers, and a first working page. The real domain and automatic deploys come at the end (Story 4.4).
- **Epic 2: Public Site:** Turn the first page into the real Saleaway home page with category sections, trustworthy cards, SEO, ad slots, analytics and the legal pages.
- **Epic 3: Daily Discovery Pipeline:** Automatically fetch, validate and extract discounts for every store every day, keep the site's data fresh, and add the "Biggest discounts today" card.
- **Epic 4: Overrides, Operations & Launch Readiness:** Let the operator fix problem stores by hand, see the health of the system, and verify every URL before launch.
- **Epic 5: Coverage & Growth (post-launch, before Black Friday):** Read JavaScript-only stores, discover sale pages for new stores, and add filters.

**Rationale and delivery plan.** The site runs in Epic 1 (locally and on a workers.dev address) with every card showing "On sale", before any extraction exists. This means a working site exists on day 1, and every later epic only improves it. The real domain and automatic deploys are connected near the end (Story 4.4), so register the domain and move its nameservers to Cloudflare in parallel from day 1, because that can take hours. Suggested plan for the 3 days: Day 1, Epics 1 and 2. Day 2, Epic 3. Day 3, Epic 4 and launch checks. Epic 5 follows after launch. If Epic 3 runs long, launch with "On sale" cards and manual discounts for the biggest stores, then keep improving.

## Launch-Critical Set and Human Prerequisites

_Added by the PO on 2026-10-29 after validating all documents._

### Launch-critical vs deferrable

- **Launch-critical (the site cannot go live honestly without these):** Stories 1.1 to 1.4, 2.1 to 2.5, 3.1 to 3.6, 3.9 (added 2026-10-30), 4.1, 4.3, 4.4 and 4.5.
- **Deferrable if time runs short, cut in this order:** 2.6 (Black Friday badge), 3.7 (Biggest discounts card), 4.6 (failure alert and retention), 4.2 (health report; use the run log tables meanwhile), the HTML and structured-data extractors inside 3.4 (keep Shopify and manual), and the anchor menu in 2.2.
- **Conditional:** Story 3.8 (fallback runner), built only if a different network gets through where the Worker is blocked, or the CPU measurement in Story 3.4 fails.
- **Launch store count (decided 2026-10-30):** the site launches with the stores that work from the Worker, 57 of the 92 with a sale page (Story 3.9). The other 35 come back in Story 5.4.
- **Post-launch:** Epic 5.

### Human prerequisites (only you can do these)

| # | What | Needed before |
|---|---|---|
| 1 | A Cloudflare account, with `wrangler login` working on your computer (**done 2026-10-29**; use Node 22) | Story 1.2 |
| 2 | A GitHub repository for the project, with repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (a repository is also a good place for backups before then) | Story 4.4 |
| 3 | The domain `saleaway.online`, registered in Cloudflare (**done 2026-10-30**), so its DNS is already on Cloudflare. Story 4.4 attaches it to the web Worker | Story 4.4 |
| 4 | A monitored email address for retailer removal requests (Cloudflare Email Routing can forward it to your inbox once the domain is on Cloudflare) | Story 4.5 |
| 5 | A webhook URL for failure alerts (for example a Discord or Slack channel) | Story 4.6 |
| 6 | A Cloudflare Web Analytics site token (only usable once the domain is connected) | Story 4.4 |
| 7 | Check the 21 search-only URLs in a browser, and find Crocs SA's sale URL (the agent prepares the list) | Story 4.3 |
| 8 | Keep the `ADMIN_TOKEN` the agent generates in a password manager | Story 3.1 |
| 9 | Apply to an ad network once the site is live | After launch |

## Epic 1 Foundation & First Live Page

**Goal:** Establish the repository, the Cloudflare deployment pipeline and the database, and ship a first live page listing the seeded stores. This gives a working, deployable product on day 1 and a base for everything else.

### Story 1.1 Project Scaffold and Local Canary

As the operator,
I want a monorepo with a web app that runs on my computer,
so that every later story builds on a working base.

#### Acceptance Criteria

1. The repository has a monorepo structure with the web app, a pipeline Worker placeholder, shared code and docs, and is committed to git.
2. The web app runs locally with one command (`pnpm dev`) and serves a canary page with the text "Saleaway" and a `/health` route returning OK.
3. A short README explains how to run, test and deploy locally.
4. Structured logging helper exists and is used by the health route (NFR11).
5. No secrets are in the repository (NFR10).
6. Lint, type-check and test commands exist, and Vitest runs one passing example test in the shared core package, so the CI in Story 4.4 has something to run.
7. Node 22 is pinned (`.nvmrc` and `engines`), because Wrangler needs Node 20 or newer.

### Story 1.2 First Deploy to workers.dev

As the operator,
I want the canary site deployed to a free Cloudflare address,
so that we find Cloudflare-specific problems early, before the domain exists.

#### Acceptance Criteria

1. The web Worker and a pipeline Worker placeholder are deployed with `wrangler deploy`, using the operator's existing Cloudflare login, to `*.workers.dev` addresses. No domain, GitHub repository or CI is needed.
2. The D1 database is created in the Cloudflare account and bound to both Workers, locally and on Cloudflare.
3. `/health` returns OK on the deployed address, and its log line appears in Workers Logs (this also confirms the free logging allowance).
4. The architecture's spike S0 is recorded: whether the Cache API caches responses on `workers.dev`, and the Worker bundle size against the Free plan limit.
5. The README explains the manual deploy and how to roll back (`wrangler rollback`).
6. No secrets are committed (NFR10).

### Story 1.3 Database Schema and Retailer Seed

As the operator,
I want the database and all stores loaded,
so that the site and pipeline have data to work with.

#### Acceptance Criteria

1. D1 migrations create tables for categories, retailers, sale records, overrides, pipeline runs and run results (FR1, FR9, FR11, FR12), and the 10 categories are seeded. The click counts table arrives later with Story 2.5.
2. A seed script loads `docs/data/retailers-seed.tsv` and is safe to run more than once (no duplicates).
3. After seeding, the table holds all 106 spreadsheet stores (plus Crocs SA once its URL is found). The 92 with primary sale URLs are visible, and the 14 without (12 with no sale page, 2 with only a Black Friday page) are hidden (FR2). Stores listed in several categories get unique slugs, and non-numeric ranks ("Alt") are mapped to numbers (see `docs/architecture.md`, "Seed data rules").
4. Adding a store is documented as inserting one row (FR3).
5. Migrations can run locally and in production.

### Story 1.4 First Live Store List

As a bargain hunter,
I want to see a list of stores with sales and click through to them,
so that I can start finding deals right away.

#### Acceptance Criteria

1. The home page reads visible stores from D1 and shows one card per store with the store name and "On sale".
2. Each card links to the store's sale URL in a new tab, with `rel="noopener"`.
3. The page works on a phone-width screen.
4. The page works locally and on the deployed `workers.dev` address.
5. Page reads handle an empty or failing database gracefully, with a friendly message.

## Epic 2 Public Site

**Goal:** Turn the first live page into the real Saleaway home page: organised, trustworthy and ready to attract search traffic and ads. Visitors find sales quickly and the site is ready for Black Friday.

_UX note (2026-10-28, from `docs/front-end-spec.md`): in the design, a "card" is one **category card** that contains a **row per store**. Where the stories below say "store card", read "store row inside a category card". Decided with the user the same day: stores are ordered biggest discount first within a category (Story 2.2), and a "Biggest discounts today" sticker card is added (Story 3.7, because it needs extracted percentages)._

### Story 2.1 Store Row Design

As a bargain hunter,
I want each store row to show how deep the discount is and how fresh it is,
so that I can decide which sale to visit.

#### Acceptance Criteria

1. A store row shows the store name, a bold "Up to X% off" when a percentage is known, or "On sale" when not (FR13).
2. A row shows "Checked today" or "Checked N days ago" (FR15).
3. Rows and cards are text-only. No retailer images, logos or product content (NFR7).
4. Rows meet WCAG AA contrast, are keyboard-focusable, and have a clear tap target of at least 44px (NFR9).
5. Layout is a single column on small phones and a grid on larger screens.

### Story 2.2 Category Sections

As a bargain hunter,
I want stores grouped by category,
so that I can jump to the type of shop I care about.

#### Acceptance Criteria

1. The home page shows one section per category (marketplaces, fashion, sport, tech, home, DIY, beauty and health, grocery and liquor, baby, kids and toys, pets) (FR14).
2. Within a section, stores are ordered by biggest known discount first, then "On sale" stores by rank, with ties broken by rank (FR14). Before extraction exists (Epic 3), every store is "On sale", so the order falls back to rank.
3. A simple anchor menu at the top jumps to each section.
4. Categories with no visible stores are not shown.

### Story 2.3 Visibility, Staleness and Override Rules

As a bargain hunter,
I want only current sales shown,
so that I don't click through to ended sales.

#### Acceptance Criteria

1. Stores flagged hidden are not shown.
2. A store is not shown when it was last validated more than 72 hours ago (FR10, FR15, NFR3). A store that has never been validated is measured from the time it was added, and an active override counts as a fresh check for as long as it is active (until its expiry date, if it has one). Without this, the site would be empty until the first pipeline run (Epic 3).
3. Records marked ended are not shown.
4. Override precedence is built here, so every later story can rely on it: an active override's percentage replaces the extracted one, its hide flag hides the store, its sale URL replaces the stored one, and an expired override is ignored (FR12).
5. A unit test covers each rule, including a never-validated store and an expired override.

### Story 2.4 SEO and Performance

As the operator,
I want search engines to index Saleaway and the site to load fast,
so that traffic can grow.

#### Acceptance Criteria

1. Titles, meta descriptions, Open Graph tags and a canonical URL are set (FR17).
2. `sitemap.xml` and `robots.txt` are served.
3. The home page is server-rendered or static and cached at the edge, so content is present without JavaScript.
4. A Lighthouse mobile run scores 90 or better for performance, accessibility and SEO, or the gaps are documented (NFR2).
5. The caching code is in place, with a unit test. Spike S0 (Story 1.2) measured that the Cache API does cache on `workers.dev` addresses (see `docs/spike-s0-workers-dev.md`). Whether the cache works for the real home page on the real domain is still confirmed in Story 4.4.
6. A Playwright smoke test with an automated accessibility check (axe) runs in CI and finds no violations on the home page (NFR9).

### Story 2.5 Ad Slots, Analytics and Legal Pages

As the operator,
I want ad slots, simple analytics and legal pages,
so that the site is ready to earn and to be trusted.

#### Acceptance Criteria

1. The layout includes clearly marked ad slots (top, between categories, footer) that render nothing until switched on by a configuration flag (FR18).
2. Cookie-free analytics counts visits and click-outs per store (FR19, NFR8). The Web Analytics part is confirmed after the domain is connected (Story 4.4).
3. About / How it works, Privacy and Contact pages exist. The Contact page explains how a retailer can request removal (FR20).
4. A footer links to all three pages.
5. The layout does not shift when ad slots turn on (no large layout jump).

### Story 2.6 Black Friday Badge (Stretch)

As a bargain hunter,
I want to see which stores already have a Black Friday page,
so that I can check those early.

#### Acceptance Criteria

1. Cards for stores with a Black Friday URL show a "Black Friday" link next to the sale link (FR16).
2. Black Friday URLs are only shown after the operator has verified them, because some still show 2025 content.
3. A configuration flag turns the badge off completely.

## Epic 3 Daily Discovery Pipeline

**Goal:** Make the site data automatic. Every day, each visible store's sale page is fetched, validated and read for its deepest discount, and the database is kept fresh and honest.

### Story 3.1 Scheduled Runner with Batching and Run Log

As the operator,
I want a daily job that processes all stores in safe batches,
so that it stays within free-tier limits and one failure never stops the rest.

#### Acceptance Criteria

1. A Cron Trigger starts the pipeline once every 24 hours (FR4).
2. Stores are split into batches (for example through a queue or several scheduled invocations) sized to stay inside free-tier limits (NFR1).
3. Each run and each store result is written to the run log (FR11).
4. A failure for one store is logged and does not stop other stores (NFR4).
5. Running the job twice does not create duplicate records (idempotent).
6. The job can be triggered manually for testing.
7. A second Cron Trigger closes the run: it records the totals (stores total, ok, failed) and the finish time (FR11).
8. The queue, bindings and the `ADMIN_TOKEN` secret are created and documented, and setting a `PIPELINE_ENABLED` variable to `false` makes the job exit without doing anything (a pause switch).

### Story 3.2 Polite Fetcher and Result Classification

As the operator,
I want pages fetched politely and results classified,
so that I know what happened with each store.

#### Acceptance Criteria

1. Requests use a clear user-agent with a contact address, a timeout, and a limited number of redirects (FR5, NFR6).
2. robots.txt is checked and respected.
3. Each result is classified as OK, blocked, not found, redirected away, JavaScript-only, or error (FR6).
4. The fetcher is tested from a deployed Worker, not only from a laptop, and the per-store results are saved to `docs/fetch-spike.md` as a follow-up table.
5. No attempt is made to evade bot protection or solve challenges (NFR6).
6. CPU time per store is measured on the deployed Worker for at least Bash, Woolworths, Takealot and one Shopify store (fetch, classify, validate and extract). If any store regularly exceeds 8 ms of CPU **[Assumption]**, the result and the chosen response are recorded: a streaming parse, the `manual` method for that store, or Story 3.8 (fallback runner).

### Story 3.3 Sale Page Validation

As a bargain hunter,
I want only real sales shown,
so that I can trust Saleaway.

#### Acceptance Criteria

1. A page passes validation only when it shows discounted products, for example was/now prices, percentage-off labels or discount badges (FR7).
2. An error page, a redirect to the home page, a login or challenge page, or an empty listing fails validation.
3. Validation is a pure function with unit tests using saved page samples from at least 5 different stores (NFR12).
4. A failing validation marks the sale ended (FR10), except a challenge or login page, which is treated like a blocked fetch and keeps the last good record.
5. A page whose products load with JavaScript is recorded as URL-verified only, not content-verified, and shown as "On sale" (FR7).
6. Test samples are trimmed to the minimum markup needed (a few KB), not whole retailer pages (NFR7).

### Story 3.4 Discount Extraction

As a bargain hunter,
I want to see how deep a store's discounts go,
so that I can pick the best sales.

#### Acceptance Criteria

1. The extraction method comes from the store's `extraction_method` field: `shopify_json`, `html`, `structured_data`, or `manual` (FR8).
2. Shopify stores use the collection's product JSON to compute the largest percentage from compare-at and current prices.
3. HTML and structured-data stores read was/now prices and "% off" labels and use the largest percentage found.
4. Values outside a sane range (below 5% or above 90%) **[Assumption]** are ignored, and the record falls back to "On sale".
5. If nothing can be read, the record is "On sale", not an error.
6. Each method has unit tests using saved page samples (NFR12).
7. The Shopify stores that answered the Worker in Story 3.2 (`beauty-on-tapp`, `norman-goodfellows`, `toy-kingdom`) are covered as the first examples, after confirming that each one's `/products.json` also answers the Worker. Under Armour SA is a custom storefront with no product feed (Story 3.2) and uses the `html` method. Wellness Warehouse is hidden (blocked).
8. CPU time per store is measured again on the deployed Worker, now with the real validation and extraction, for the same stores as in Story 3.2 (Bash, Woolworths, Takealot and Under Armour SA) and one Shopify store whose product feed answers, because Story 3.2 could only measure a stand-in for these steps and could not measure the JSON path. The result is added to `docs/fetch-spike.md`. If any store regularly exceeds 8 ms of CPU **[Assumption]**, the response is chosen as in Story 3.2, criterion 6: a streaming parse, the `manual` method for that store, or Story 3.8 (fallback runner).

### Story 3.5 Save Sale Records and Expiry

As a bargain hunter,
I want the site to show current data and drop ended sales,
so that I never get sent to a dead sale.

#### Acceptance Criteria

1. Validated results are saved as sale records with percentage, first seen, last checked and last validated (FR9). The record points to the store's sale URL, which is the store's `sale_url` or an active override's, so no URL is copied into the record.
2. A page that fails validation is marked ended (FR10).
3. A temporary failure (blocked, timeout, error) keeps the last good record for up to 72 hours, then the store is hidden, using the visibility rule from Story 2.3 (FR10, NFR3).
4. The home page reads only current records.
5. No retailer product content is stored (NFR7).
6. A `js_only` result (the page answered, products load with JavaScript) saves the record as `active` and `url_verified` and updates `last_validated_at`, so the store stays visible while its page keeps answering (Story 2.3, rule 6).
7. The record's state and validation level come from the verdict of Story 3.3 (`recordEffect`): a valid page is `active` and content-verified, a page with no sale is `ended`, a challenge or login page keeps the last good record, and a page that cannot be judged (a JavaScript page) is `active` and URL-verified. Only `active` results update `last_validated_at`.

### Story 3.6 First Full Run and Coverage Report

As the operator,
I want to run the pipeline across all stores and see what worked,
so that I know where manual overrides are needed.

#### Acceptance Criteria

1. A full run across all visible stores completes inside free-tier limits.
2. A coverage summary lists the count of stores with a percentage, "On sale" only, blocked, not found, errors, and hidden.
3. Stores that need manual handling are listed with their reason, and the stores hidden by Story 3.9 are listed with theirs (from `docs/data/hidden-stores.json`).
4. Extraction methods are updated for stores where a better method is found during this run.
5. The result is saved to `docs/data/first-run-coverage.md`.

### Story 3.7 Biggest Discounts Today Card

As a bargain hunter,
I want one card showing the deepest discounts across all stores,
so that I can reach the best deals in one click.

#### Acceptance Criteria

1. A "Biggest discounts today" sticker card appears at the top of the home page grid (FR23), styled as in `docs/front-end-spec.md`.
2. It lists up to 8 stores with the highest known discount percentages, sorted from highest to lowest, with ties broken by store rank. A store website that appears in several categories is listed once, with its best percentage. Each row shows the store name, its category, the discount pill, and links to the store's sale page.
3. Stores with only "On sale" are not included. Manual overrides with a percentage are included.
4. The card is hidden when fewer than 3 stores have a known percentage.
5. The card follows the same freshness and visibility rules as the rest of the site (Story 2.3).
6. A unit test covers the ranking, the tie-break and the hide rule.

### Story 3.8 Fallback Runner on GitHub Actions (Conditional)

As the operator,
I want the fetch-and-extract step to run on a free GitHub Actions schedule if the Worker cannot read the pages it needs (blocked by the retailer, or too much CPU),
so that big retailer pages can still be read without a paid plan.

#### Acceptance Criteria

1. This story is built only if Story 4.3 or Story 5.4 shows that a different free network gets through for stores that block the Worker, or if the CPU measurement in Story 3.4 (criterion 8) shows the Worker cannot handle the pages it needs. The CPU measurement in Story 3.2 fits, so it is not a reason by itself. Otherwise it is skipped. Retailers are not contacted, and nothing is done to hide who the bot is (NFR6).
2. A scheduled GitHub Actions workflow runs the same shared core code (fetch, classify, validate, extract) for the stores assigned to it and writes results to the same database with a narrowly scoped Cloudflare token.
3. Every store is handled by exactly one runner, so nothing is fetched twice.
4. Results, run log entries and the freshness rules are the same as for the Worker runner.
5. A failed workflow run raises the same failure alert as Story 4.6, or is noted in the health report if that story is not built.
6. The setup, secrets and the 60-day inactivity pause rule for scheduled workflows are documented in the README.

### Story 3.9 Hide Blocked Stores for Launch

_Added by the SM on 2026-10-30 after the first live run (Story 3.2, spike S2): 34 of the 89 fetched stores answered 403 or 429 to the Worker (risk R2). Contacting retailers is not an option, so the blocked stores are hidden for launch and fixed later (Story 3.8, Story 4.1 or Story 4.3)._

As the operator,
I want the stores that block the pipeline hidden from the site and from the daily run, by a recorded and reversible decision,
so that the site launches with stores that work and no store is shown that nobody can check.

#### Acceptance Criteria

1. A list of hidden stores is kept in the repository (`docs/data/hidden-stores.json`). The file records the date of the decision, and each entry has the store's slug and a reason code that is explained in the file, so a later fix knows which stores to cover. The first list is the 35 stores of run 16: the 34 that answered 403 or 429, and the other listing on the same website as one of them (`ackermans-baby-kids-toys`).
2. A documented operator command hides every store on the list in the local or the live database, and the same command with `--undo` makes them visible again. It can be run twice with the same result, it changes nothing else, and it checks its input before writing (FR3).
3. A hidden store is not fetched by the daily run and is not shown on the site. The other 57 stores and all 10 categories are unaffected. Re-running the retailer seed does not undo it.
4. An operator can still fetch one hidden store with `POST /admin/run?store=<slug>`, so a store can be tested again before it is shown.
5. The command is run on the live database, and the live home page shows 57 store cards and none of the 35 hidden ones (the page is not cached yet; once Story 2.4 adds caching, allow about 10 minutes).
6. The README explains how to hide and restore stores, and that blocking can change from day to day.

## Epic 4 Overrides, Operations & Launch Readiness

**Goal:** Give the operator the tools to fix problem stores by hand, see the system's health, and confirm every link before launch, so the site can launch honestly on day 3.

### Story 4.1 Manual Override Command

As the operator,
I want to override a store's discount, visibility or URL,
so that blocked or broken stores still look right.

#### Acceptance Criteria

1. A documented command or script can set a manual discount percentage, hide or show a store, and change its sale URL (FR12). Hiding a store here (an override) is not the same as hiding it with `is_visible` (Story 3.9): an override hide only removes the store from the site, and the pipeline still fetches it.
2. An override can have an expiry date, after which it stops applying.
3. Overrides win over extracted values, and the pipeline never deletes them.
4. Changes take effect on the site without a redeploy, within the page cache lifetime of about 10 minutes (FR3). The override precedence rules themselves are built in Story 2.3.
5. Amazon.co.za, Game and Checkers are set to manual by default.
6. `ops:override --export` saves all overrides to a file in the repository, so the hand-entered data can be restored.
7. Values passed to the command are validated before they are used in SQL (see Coding Standards in `docs/architecture.md`).
8. A store hidden by Story 3.9 can be shown with manual values in one step: the command sets it to the `manual` method (so the pipeline never fetches it again), makes it visible, adds the manual override, and removes the store from `docs/data/hidden-stores.json`. Without the `manual` method, showing it would make the pipeline fetch a blocked store every night.

### Story 4.2 Health Report

As the operator,
I want to see how the system is doing,
so that I can fix problems before visitors notice.

#### Acceptance Criteria

1. A report run from the command line (with no public page) shows the last run's time and status, and each store's last result (FR21).
2. It shows counts for stores with a percentage, "On sale", blocked, hidden and stale.
3. It shows the pipeline success rate (NFR5) and the oldest sale record age (NFR3).
4. The report is not accessible to the public.
5. The report shows the day's Worker requests and D1 rows written against the free limits if the Cloudflare API provides them, or points to the dashboard page where they can be seen. It flags when requests pass 50,000 a day (see "Black Friday traffic decision" in `docs/architecture.md`).

### Story 4.3 URL Verification Pass

As the operator,
I want every seeded sale URL checked,
so that visitors don't land on dead pages.

#### Acceptance Criteria

1. A script flags every seeded URL that does not return a successful page.
2. The 21 search-only URLs are checked in a browser and their status is updated in the Retailers table.
3. The Crocs SA row (seeded hidden, without a URL) gets its sale URL and is made visible.
4. Stores whose URL cannot be fixed are hidden.
5. Black Friday URLs showing 2025 content are marked unverified (supports Story 2.6).
6. The script runs from the operator's computer with the pipeline's user-agent and its `robots.txt` and URL-safety rules (these are shared code in `packages/core`), at most once a day, and records for each store hidden by Story 3.9 whether it answers from there. This is the free test of another network, and its result is the input for Story 5.4 and for Story 3.8.

### Story 4.4 CI/CD and Domain

As the operator,
I want automatic deploys on push and the real domain connected,
so that releases are quick and safe, and the site is reachable at saleaway.online.

#### Acceptance Criteria

1. Pushing to the main branch builds, tests and deploys to Cloudflare automatically, applying new database migrations first.
2. A failing build or test stops the deploy.
3. The repository secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) are set, and no secret is in the repository (NFR10).
4. saleaway.online (and www) points to the deployed site over HTTPS. If the domain is not yet on Cloudflare, the steps are documented and launch uses the temporary `workers.dev` address.
5. Page caching is confirmed to work on the real domain (a repeated request is served from cache), and the result is noted (see Story 2.4, AC5).
6. Cookie-free Web Analytics is confirmed working on the real domain (see Story 2.5, AC2).
7. A deploy takes less than 5 minutes.

### Story 4.5 Launch Checklist

As the operator,
I want a final check before launch,
so that we launch with confidence.

#### Acceptance Criteria

1. The site is live on saleaway.online over HTTPS with the daily job enabled.
2. At least one complete scheduled run has succeeded.
3. The home page, legal pages, sitemap and robots.txt all load correctly on a phone.
4. The retailer contact route works (a monitored email address).
5. A short rollback and "pause the pipeline" note exists in the README.
6. The remaining known issues are listed, including the stores hidden by Story 3.9 and why.

### Story 4.6 Failure Alert and Data Retention

As the operator,
I want to be told when the daily run fails and to keep the database small,
so that problems do not go unnoticed and the free database limit is never reached.

#### Acceptance Criteria

1. When the run is closed (Story 3.1, AC7), a short summary is posted to the alert webhook if more than 20% of stores failed or the run did not complete **[Assumption on the 20%]**.
2. The alert is tested by forcing a failure, and the webhook address is stored as a secret (NFR10).
3. Run results older than 30 days are deleted at the start of each run, covered by a test.

## Epic 5 Coverage & Growth (post-launch, before Black Friday)

**Goal:** Improve how many stores show a real discount, keep sale links healthy, and make the site easier to browse, using what the first live data shows.

### Story 5.1 JavaScript-Only Store Support

As a bargain hunter,
I want discounts shown for stores that load products with JavaScript,
so that big stores such as Takealot show a real percentage.

#### Acceptance Criteria

1. For stores flagged as JavaScript-only, the pipeline either uses a browser render within free-tier limits or a store's data endpoint to read prices.
2. The method is chosen per store through `extraction_method`.
3. The number of stores moving from "On sale" to a percentage is reported.
4. The approach stays within NFR1 and NFR6.

### Story 5.2 Sale Path Fallback and Broken-URL Alerts

As the operator,
I want broken sale URLs noticed and new stores discovered,
so that the data heals instead of going stale.

#### Acceptance Criteria

1. A store whose sale URL fails three days in a row is flagged in the health report.
2. For a store with no known URL, the job tries `/sale`, `/outlet` and `/specials` and records a candidate (FR22).
3. Candidates need operator approval before they go live.

### Story 5.3 Search and Category Filters

As a bargain hunter,
I want to search and filter stores,
so that I can find a store or category faster.

#### Acceptance Criteria

1. A search box filters stores by name as the visitor types.
2. A discount filter lets the visitor sort or filter by "Up to X% off".
3. The page still works without JavaScript for browsing.

### Story 5.4 Bring Blocked Stores Back

As the operator,
I want the stores hidden by Story 3.9 re-tested and returned one by one,
so that coverage grows before Black Friday.

#### Acceptance Criteria

1. Each hidden store is re-tested with `POST /admin/run?store=<slug>`, and from another free network if Story 4.3 showed that it answers there. Blocking is not stable, so each store is judged on a fresh result.
2. A store that answers is shown again and removed from `docs/data/hidden-stores.json`.
3. A store that still blocks is either entered by hand with the `manual` method and an override (Story 4.1, criterion 8) for the biggest names by rank, or stays hidden. The decision for each store is recorded in the list.
4. If another network answers for several stores, Story 3.8 (fallback runner) is built for those stores only, and each store is handled by exactly one runner.
5. Retailers are not contacted, and nothing is done to hide who the bot is (NFR6).
6. The number of visible stores before and after is recorded in the README.

## Checklist Results Report

_PM checklist (`.bmad-core/checklists/pm-checklist.md`) run on 2026-10-28 in comprehensive mode. Percentages are the PM's judgment, not a measured score._

### Executive Summary

- **Overall PRD completeness:** about 85%.
- **MVP scope appropriateness:** **Too large for 3 days** if all 25 stories are counted. Epics 1 to 4 hold 21 stories for one person with AI agents. The PRD is built so that launch still works if Epic 3 is only partly done (see the cut list below).
- **Readiness for architecture phase:** **Ready**, with the refinements below. There are no blockers.
- **Most critical gaps:** no market or competitor evidence, no defined way to judge the MVP's success beyond traffic, no access control for the override command and health report, and no data retention or backup plan.

### Category Analysis

| Category | Status | Critical Issues |
|---|---|---|
| 1. Problem Definition & Context | PARTIAL | Problem impact is not quantified. No user research or competitor analysis exists, and the brief's claim that existing deal sites rely on manual curation is unverified. The 1,000-visitor target is an assumption with no baseline. |
| 2. MVP Scope Definition | PARTIAL | Out-of-scope list and rationale are clear. No criteria for moving beyond the MVP, and no learning goals beyond traffic. Scope is large for the timeline. |
| 3. User Experience Requirements | PASS | Journey is simple and covered. Empty and error states appear in Story 1.4. Accessibility and device support are stated. |
| 4. Functional Requirements | PASS | Requirements are testable and numbered. Minor overlap: FR4 and the "visible" flag mix operator-hidden stores with stale ones. |
| 5. Non-Functional Requirements | PARTIAL | Performance, privacy, politeness and legal safety are covered. Missing: backup and recovery, availability target, data retention, alerting, and access control for operator tools. |
| 6. Epic & Story Structure | PASS | Epic 1 covers setup and ships a live page. Stories are small, sequenced and have testable criteria. Count is high for 3 days. |
| 7. Technical Guidance | PASS | Direction, constraints and risks are clear, and open technical questions are listed for the Architect. |
| 8. Cross-Functional Requirements | PARTIAL | Data entities are named but not related (left to the Architect). No retention policy for the run log or ended sale records. No alerting. |
| 9. Clarity & Communication | PASS | Consistent terms, change log and linked documents. Assumptions are marked. |

### Top Issues by Priority

**BLOCKERS:** none.

**HIGH**
- **Operator tool security:** the override command (FR12) and health report (FR21) can change or reveal data, but no access control is specified. The Architect should protect them, for example with Cloudflare Access or a secret token.
- **Unverified competitor claim:** the brief says existing deal sites rely on manual curation, but no competitor research was done. The brief has been changed to say this is not yet researched. A quick look at SA deal sites is worth doing before relying on that argument.
- **Timeline vs scope:** see the MVP scope assessment.

**MEDIUM**
- **Backup and recovery:** state what happens if the D1 database is lost. The data is mostly re-creatable from the seed file and the daily run, so a seed re-run plus overrides backup may be enough.
- **Data retention:** define how long the run log and ended sale records are kept so the free-tier database does not fill.
- **Alerting:** the health report is passive. At least one alert (for example an email when a run fails) would help during Black Friday.
- **MVP learning goals:** decide what you want to learn in the first 30 days (for example which categories get the most click-outs) and what result would justify Phase 2.
- **robots.txt vs one-request rule:** NFR6 says one request per store per day, but checking robots.txt and following redirects can add requests. Read it as "one page fetch per store per day, plus robots.txt".

**LOW**
- Story 1.3 says "106 stores" but Crocs SA is not in the spreadsheet (fixed below).
- No user feedback mechanism beyond the Contact page.

### MVP Scope Assessment

- **Timeline realism:** 3 days is very tight. Note that Black Friday (27 November 2026) is about 4 weeks away, so a few days of slip on the 3-day target would not miss it.
- **Suggested cut list if time runs short, in this order:**
  1. Story 2.6 (Black Friday badge), already marked stretch.
  2. Story 2.2's anchor menu (keep the category sections).
  3. Story 4.2 (health report), replaced by the pipeline run log in the database.
  4. HTML and structured-data extraction in Story 3.4 (keep Shopify JSON and manual, and show "On sale" for the rest).
  5. Story 3.7 (Biggest discounts card), added after this checklist ran. It hides itself when fewer than 3 percentages are known, so it can also be left out safely.
- **Missing essentials:** none, apart from the HIGH and MEDIUM items above.
- **Complexity concerns:** batching the pipeline within free-tier limits (Story 3.1) and the variety of store pages (Story 3.4) are the two riskiest stories.

### Technical Readiness

- **Clarity of constraints:** good. Free tier only, Cloudflare, D1, 3 days.
- **Technical risks:** bot blocking from Cloudflare IP ranges, free-tier request limits per invocation, 19 JavaScript-only stores, and per-store extraction variety.
- **For the Architect to investigate:** current free-tier limits, the batching approach, Next.js vs a lighter framework, the D1 schema, access control for operator tools, and whether Browser Rendering is usable on the free plan.

### Recommendations

1. Have the Architect add access control for the override command and health report.
2. Add a retention rule and a failure alert as small additions to Epic 4 (see below for the updated stories).
3. Do a short competitor check on SA deal sites before launch, to support the "why Saleaway" message on the About page.
4. Define MVP learning goals and "move to Phase 2" criteria after the first week of data.
5. Use the cut list above if Day 2 ends without a working pipeline.

### Final Decision

**READY FOR ARCHITECT.** The PRD and epics are structured and complete enough for architecture, with the refinements above to be handled during architecture or as small additions to Epic 4.

## Next Steps

### UX Expert Prompt

Review `docs/prd.md` and `docs/brief.md` for Saleaway, a daily-updated list of South African store sale cards. Create the front-end specification (`docs/front-end-spec.md`) for a mobile-first, WCAG AA, text-only card design that shows "Up to X% off" or "On sale", category sections, ad slots and the legal pages. Propose a simple wordmark and colour direction, since no branding exists.

### Architect Prompt

Review `docs/prd.md`, `docs/brief.md`, `docs/fetch-spike.md` and `docs/data/`, and create the full-stack architecture (`docs/architecture.md`) for a Cloudflare-hosted serverless system: web app (Next.js via OpenNext or a lighter alternative), a cron-driven pipeline Worker with batching, and D1. Verify current Cloudflare free-tier limits, choose the batching approach, define the D1 schema and the per-store extraction strategy model, and keep the whole plan achievable in 3 days.
