# Epic 3 Daily Discovery Pipeline

**Goal:** Make the site data automatic. Every day, each visible store's sale page is fetched, validated and read for its deepest discount, and the database is kept fresh and honest.

## Story 3.1 Scheduled Runner with Batching and Run Log

As the operator,
I want a daily job that processes all stores in safe batches,
so that it stays within free-tier limits and one failure never stops the rest.

### Acceptance Criteria

1. A Cron Trigger starts the pipeline once every 24 hours (FR4).
2. Stores are split into batches (for example through a queue or several scheduled invocations) sized to stay inside free-tier limits (NFR1).
3. Each run and each store result is written to the run log (FR11).
4. A failure for one store is logged and does not stop other stores (NFR4).
5. Running the job twice does not create duplicate records (idempotent).
6. The job can be triggered manually for testing.
7. A second Cron Trigger closes the run: it records the totals (stores total, ok, failed) and the finish time (FR11).
8. The queue, bindings and the `ADMIN_TOKEN` secret are created and documented, and setting a `PIPELINE_ENABLED` variable to `false` makes the job exit without doing anything (a pause switch).

## Story 3.2 Polite Fetcher and Result Classification

As the operator,
I want pages fetched politely and results classified,
so that I know what happened with each store.

### Acceptance Criteria

1. Requests use a clear user-agent with a contact address, a timeout, and a limited number of redirects (FR5, NFR6).
2. robots.txt is checked and respected.
3. Each result is classified as OK, blocked, not found, redirected away, JavaScript-only, or error (FR6).
4. The fetcher is tested from a deployed Worker, not only from a laptop, and the per-store results are saved to `docs/fetch-spike.md` as a follow-up table.
5. No attempt is made to evade bot protection or solve challenges (NFR6).
6. CPU time per store is measured on the deployed Worker for at least Bash, Woolworths, Takealot and one Shopify store (fetch, classify, validate and extract). If any store regularly exceeds 8 ms of CPU **[Assumption]**, the result and the chosen response are recorded: a streaming parse, the `manual` method for that store, or Story 3.8 (fallback runner).

## Story 3.3 Sale Page Validation

As a bargain hunter,
I want only real sales shown,
so that I can trust Saleaway.

### Acceptance Criteria

1. A page passes validation only when it shows discounted products, for example was/now prices, percentage-off labels or discount badges (FR7).
2. An error page, a redirect to the home page, a login or challenge page, or an empty listing fails validation.
3. Validation is a pure function with unit tests using saved page samples from at least 5 different stores (NFR12).
4. A failing validation marks the sale ended (FR10), except a challenge or login page, which is treated like a blocked fetch and keeps the last good record.
5. A page whose products load with JavaScript is recorded as URL-verified only, not content-verified, and shown as "On sale" (FR7).
6. Test samples are trimmed to the minimum markup needed (a few KB), not whole retailer pages (NFR7).

## Story 3.4 Discount Extraction

As a bargain hunter,
I want to see how deep a store's discounts go,
so that I can pick the best sales.

### Acceptance Criteria

1. The extraction method comes from the store's `extraction_method` field: `shopify_json`, `html`, `structured_data`, or `manual` (FR8).
2. Shopify stores use the collection's product JSON to compute the largest percentage from compare-at and current prices.
3. HTML and structured-data stores read was/now prices and "% off" labels and use the largest percentage found.
4. Values outside a sane range (below 5% or above 90%) **[Assumption]** are ignored, and the record falls back to "On sale".
5. If nothing can be read, the record is "On sale", not an error.
6. Each method has unit tests using saved page samples (NFR12).
7. The Shopify stores that answered the Worker in Story 3.2 (`beauty-on-tapp`, `norman-goodfellows`, `toy-kingdom`) are covered as the first examples, after confirming that each one's `/products.json` also answers the Worker. Under Armour SA is a custom storefront with no product feed (Story 3.2) and uses the `html` method. Wellness Warehouse is hidden (blocked).
8. CPU time per store is measured again on the deployed Worker, now with the real validation and extraction, for the same stores as in Story 3.2 (Bash, Woolworths, Takealot and Under Armour SA) and one Shopify store whose product feed answers, because Story 3.2 could only measure a stand-in for these steps and could not measure the JSON path. The result is added to `docs/fetch-spike.md`. If any store regularly exceeds 8 ms of CPU **[Assumption]**, the response is chosen as in Story 3.2, criterion 6: a streaming parse, the `manual` method for that store, or Story 3.8 (fallback runner).

## Story 3.5 Save Sale Records and Expiry

As a bargain hunter,
I want the site to show current data and drop ended sales,
so that I never get sent to a dead sale.

### Acceptance Criteria

1. Validated results are saved as sale records with percentage, first seen, last checked and last validated (FR9). The record points to the store's sale URL, which is the store's `sale_url` or an active override's, so no URL is copied into the record.
2. A page that fails validation is marked ended (FR10).
3. A temporary failure (blocked, timeout, error) keeps the last good record for up to 72 hours, then the store is hidden, using the visibility rule from Story 2.3 (FR10, NFR3).
4. The home page reads only current records.
5. No retailer product content is stored (NFR7).
6. A `js_only` result (the page answered, products load with JavaScript) saves the record as `active` and `url_verified` and updates `last_validated_at`, so the store stays visible while its page keeps answering (Story 2.3, rule 6).
7. The record's state and validation level come from the verdict of Story 3.3 (`recordEffect`): a valid page is `active` and content-verified, a page with no sale is `ended`, a challenge or login page keeps the last good record, and a page that cannot be judged (a JavaScript page) is `active` and URL-verified. Only `active` results update `last_validated_at`.

## Story 3.6 First Full Run and Coverage Report

As the operator,
I want to run the pipeline across all stores and see what worked,
so that I know where manual overrides are needed.

### Acceptance Criteria

1. A full run across all visible stores completes inside free-tier limits.
2. A coverage summary lists the count of stores with a percentage, "On sale" only, blocked, not found, errors, and hidden.
3. Stores that need manual handling are listed with their reason, and the stores hidden by Story 3.9 are listed with theirs (from `docs/data/hidden-stores.json`).
4. Extraction methods are updated for stores where a better method is found during this run.
5. The result is saved to `docs/data/first-run-coverage.md`.

## Story 3.7 Biggest Discounts Today Card

As a bargain hunter,
I want one card showing the deepest discounts across all stores,
so that I can reach the best deals in one click.

### Acceptance Criteria

1. A "Biggest discounts today" sticker card appears at the top of the home page grid (FR23), styled as in `docs/front-end-spec.md`.
2. It lists up to 8 stores with the highest known discount percentages, sorted from highest to lowest, with ties broken by store rank. A store website that appears in several categories is listed once, with its best percentage. Each row shows the store name, its category, the discount pill, and links to the store's sale page.
3. Stores with only "On sale" are not included. Manual overrides with a percentage are included.
4. The card is hidden when fewer than 3 stores have a known percentage.
5. The card follows the same freshness and visibility rules as the rest of the site (Story 2.3).
6. A unit test covers the ranking, the tie-break and the hide rule.

## Story 3.8 Fallback Runner on GitHub Actions (Conditional)

As the operator,
I want the fetch-and-extract step to run on a free GitHub Actions schedule if the Worker cannot read the pages it needs (blocked by the retailer, or too much CPU),
so that big retailer pages can still be read without a paid plan.

### Acceptance Criteria

1. This story is built only if Story 4.3 or Story 5.4 shows that a different free network gets through for stores that block the Worker, or if the CPU measurement in Story 3.4 (criterion 8) shows the Worker cannot handle the pages it needs. The CPU measurement in Story 3.2 fits, so it is not a reason by itself. Otherwise it is skipped. Retailers are not contacted, and nothing is done to hide who the bot is (NFR6).
2. A scheduled GitHub Actions workflow runs the same shared core code (fetch, classify, validate, extract) for the stores assigned to it and writes results to the same database with a narrowly scoped Cloudflare token.
3. Every store is handled by exactly one runner, so nothing is fetched twice.
4. Results, run log entries and the freshness rules are the same as for the Worker runner.
5. A failed workflow run raises the same failure alert as Story 4.6, or is noted in the health report if that story is not built.
6. The setup, secrets and the 60-day inactivity pause rule for scheduled workflows are documented in the README.

## Story 3.9 Hide Blocked Stores for Launch

_Added by the SM on 2026-10-30 after the first live run (Story 3.2, spike S2): 34 of the 89 fetched stores answered 403 or 429 to the Worker (risk R2). Contacting retailers is not an option, so the blocked stores are hidden for launch and fixed later (Story 3.8, Story 4.1 or Story 4.3)._

As the operator,
I want the stores that block the pipeline hidden from the site and from the daily run, by a recorded and reversible decision,
so that the site launches with stores that work and no store is shown that nobody can check.

### Acceptance Criteria

1. A list of hidden stores is kept in the repository (`docs/data/hidden-stores.json`). The file records the date of the decision, and each entry has the store's slug and a reason code that is explained in the file, so a later fix knows which stores to cover. The first list is the 35 stores of run 16: the 34 that answered 403 or 429, and the other listing on the same website as one of them (`ackermans-baby-kids-toys`).
2. A documented operator command hides every store on the list in the local or the live database, and the same command with `--undo` makes them visible again. It can be run twice with the same result, it changes nothing else, and it checks its input before writing (FR3).
3. A hidden store is not fetched by the daily run and is not shown on the site. The other 57 stores and all 10 categories are unaffected. Re-running the retailer seed does not undo it.
4. An operator can still fetch one hidden store with `POST /admin/run?store=<slug>`, so a store can be tested again before it is shown.
5. The command is run on the live database, and the live home page shows 57 store cards and none of the 35 hidden ones (the page is not cached yet; once Story 2.4 adds caching, allow about 10 minutes).
6. The README explains how to hide and restore stores, and that blocking can change from day to day.
