# Epic 5 Coverage & Growth (post-launch, before Black Friday)

**Goal:** Improve how many stores show a real discount, keep sale links healthy, and make the site easier to browse, using what the first live data shows.

## Story 5.1 JavaScript-Only Store Support

As a bargain hunter,
I want discounts shown for stores that load products with JavaScript,
so that big stores such as Takealot show a real percentage.

### Acceptance Criteria

1. For stores flagged as JavaScript-only, the pipeline either uses a browser render within free-tier limits or a store's data endpoint to read prices.
2. The method is chosen per store through `extraction_method`.
3. The number of stores moving from "On sale" to a percentage is reported.
4. The approach stays within NFR1 and NFR6.

## Story 5.2 Sale Path Fallback and Broken-URL Alerts

As the operator,
I want broken sale URLs noticed and new stores discovered,
so that the data heals instead of going stale.

### Acceptance Criteria

1. A store whose sale URL fails three days in a row is flagged in the health report.
2. For a store with no known URL, the job tries `/sale`, `/outlet` and `/specials` and records a candidate (FR22).
3. Candidates need operator approval before they go live.

## Story 5.3 Search and Category Filters

As a bargain hunter,
I want to search and filter stores,
so that I can find a store or category faster.

### Acceptance Criteria

1. A search box filters stores by name as the visitor types.
2. A discount filter lets the visitor sort or filter by "Up to X% off".
3. The page still works without JavaScript for browsing.
