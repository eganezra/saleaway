# Requirements

## Functional

- **FR1:** The system maintains a Retailers table with, for each store: name, homepage, category, rank, platform, primary sale URL, optional Black Friday URL, extraction method, status, and a visible/hidden flag.
- **FR2:** The Retailers table is seeded from `docs/data/retailers-seed.tsv` (92 stores with primary sale URLs) plus Crocs SA once its sale URL is found. Stores with no sale page are kept but hidden.
- **FR3:** Adding, changing or hiding a store requires only a database row change (or the override command in FR12), with no code change or redeploy.
- **FR4:** A scheduled job runs once every 24 hours and processes every visible retailer, split into batches so each run stays inside Cloudflare free-tier limits.
- **FR5:** For each store, the job fetches the store's known sale URL with a clear user-agent, a timeout and politeness limits, and respects robots.txt.
- **FR6:** The job classifies each fetch result: OK, blocked, not found, redirected away, JavaScript-only page, or error.
- **FR7:** The job validates that a fetched page is a real, active sale with discounted products (not an error page, a redirect to the home page, or an empty listing). A page whose products load with JavaScript cannot be content-checked, so it is recorded as URL-verified only (the URL loads and the operator checked it in Story 4.3) and shown as "On sale".
- **FR8:** The job extracts the deepest discount on the page using the store's extraction method (Shopify JSON, HTML or structured-data parse, or manual) and stores it as a percentage. If no percentage can be read, the record is stored as "On sale".
- **FR9:** The job saves, per store, a sale record: status, deepest discount percentage (if known), sale URL, first seen, last checked and last validated times. It stores no retailer product content (images, descriptions, layouts).
- **FR10:** A sale that fails validation is marked ended and removed from the site on the next run. A temporary fetch failure keeps the last good record for up to 72 hours **[Assumption]** before the store is hidden. A store that has never been validated is measured from the time it was added, so the first pipeline run has 72 hours to check it, and an active override counts as a fresh check.
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

## Non Functional

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
