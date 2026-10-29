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
4. A failing validation marks the sale ended (FR10).
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
7. Under Armour SA and Wellness Warehouse (both Shopify) are covered as the first examples.

## Story 3.5 Save Sale Records and Expiry

As a bargain hunter,
I want the site to show current data and drop ended sales,
so that I never get sent to a dead sale.

### Acceptance Criteria

1. Validated results are saved as sale records with percentage, URL, first seen, last checked and last validated (FR9).
2. A page that fails validation is marked ended (FR10).
3. A temporary failure (blocked, timeout, error) keeps the last good record for up to 72 hours, then the store is hidden, using the visibility rule from Story 2.3 (FR10, NFR3).
4. The home page reads only current records.
5. No retailer product content is stored (NFR7).

## Story 3.6 First Full Run and Coverage Report

As the operator,
I want to run the pipeline across all stores and see what worked,
so that I know where manual overrides are needed.

### Acceptance Criteria

1. A full run across all visible stores completes inside free-tier limits.
2. A coverage summary lists the count of stores with a percentage, "On sale" only, blocked, not found, and errors.
3. Stores that need manual handling are listed with their reason.
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
I want the fetch-and-extract step to run on a free GitHub Actions schedule if Cloudflare's CPU limit is too tight,
so that big retailer pages can still be read without a paid plan.

### Acceptance Criteria

1. This story is built only if the CPU measurement in Story 3.2 (AC6) shows the Worker cannot handle the pages it needs to. Otherwise it is skipped.
2. A scheduled GitHub Actions workflow runs the same shared core code (fetch, classify, validate, extract) for the stores assigned to it and writes results to the same database with a narrowly scoped Cloudflare token.
3. Every store is handled by exactly one runner, so nothing is fetched twice.
4. Results, run log entries and the freshness rules are the same as for the Worker runner.
5. A failed workflow run raises the same failure alert as Story 4.6, or is noted in the health report if that story is not built.
6. The setup, secrets and the 60-day inactivity pause rule for scheduled workflows are documented in the README.
