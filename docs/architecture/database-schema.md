# Database Schema

```sql
-- db/migrations/0001_init.sql
CREATE TABLE categories (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  tagline     TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  color_token TEXT NOT NULL DEFAULT 'cat-default'
);

CREATE TABLE retailers (
  id                     INTEGER PRIMARY KEY,
  slug                   TEXT NOT NULL UNIQUE,
  name                   TEXT NOT NULL,
  homepage_url           TEXT NOT NULL,
  category_id            INTEGER NOT NULL REFERENCES categories(id),
  rank                   INTEGER NOT NULL DEFAULT 999,
  platform               TEXT,
  sale_url               TEXT,
  black_friday_url       TEXT,
  black_friday_verified  INTEGER NOT NULL DEFAULT 0 CHECK (black_friday_verified IN (0,1)),
  extraction_method      TEXT NOT NULL DEFAULT 'html'
    CHECK (extraction_method IN ('shopify_json','html','structured_data','manual')),
  seed_status            TEXT NOT NULL DEFAULT 'search_only'
    CHECK (seed_status IN ('verified_products','verified_js_shell','search_only','no_sale_page')),
  is_visible             INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0,1)),
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_retailers_category_rank ON retailers(category_id, rank);

CREATE TABLE sale_records (
  retailer_id       INTEGER PRIMARY KEY REFERENCES retailers(id),
  state             TEXT NOT NULL DEFAULT 'unknown' CHECK (state IN ('active','ended','unknown')),
  validation        TEXT NOT NULL DEFAULT 'none'
    CHECK (validation IN ('content_verified','url_verified','none')),
  discount_percent  INTEGER CHECK (discount_percent BETWEEN 5 AND 90),
  last_result       TEXT,
  first_seen_at     TEXT,
  last_checked_at   TEXT,
  last_validated_at TEXT,
  ended_at          TEXT
);

CREATE TABLE overrides (
  retailer_id      INTEGER PRIMARY KEY REFERENCES retailers(id),
  discount_percent INTEGER CHECK (discount_percent BETWEEN 1 AND 99),
  hide             INTEGER NOT NULL DEFAULT 0 CHECK (hide IN (0,1)),
  sale_url         TEXT,
  expires_at       TEXT,
  note             TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE pipeline_runs (
  id            INTEGER PRIMARY KEY,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  trigger       TEXT NOT NULL CHECK (trigger IN ('cron','manual')),
  stores_total  INTEGER NOT NULL DEFAULT 0,
  stores_ok     INTEGER NOT NULL DEFAULT 0,
  stores_failed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE run_results (
  id               INTEGER PRIMARY KEY,
  run_id           INTEGER NOT NULL REFERENCES pipeline_runs(id),
  retailer_id      INTEGER NOT NULL REFERENCES retailers(id),
  result           TEXT NOT NULL,
  http_status      INTEGER,
  discount_percent INTEGER,
  duration_ms      INTEGER,
  error            TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_run_results_run ON run_results(run_id);
CREATE INDEX idx_run_results_retailer_time ON run_results(retailer_id, created_at);

CREATE TABLE click_counts (
  day         TEXT NOT NULL,
  retailer_id INTEGER NOT NULL REFERENCES retailers(id),
  clicks      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, retailer_id)
);
```

**Notes**

- Per the PRD, schema changes come with the stories that need them. Story 1.3 creates `categories`, `retailers`, `sale_records`, `overrides` and `pipeline_runs`/`run_results`. `click_counts` arrives with Story 2.5.
- `discount_percent BETWEEN 5 AND 90` enforces the sanity range from Story 3.4. A value outside the range is stored as `NULL` ("On sale").
- D1 limits: 100 bound parameters per query, so seeding and batches are chunked. All write volumes are far below 100,000 rows a day.
- The home page query joins `retailers`, `categories`, `sale_records` and `overrides` in a single query (about 110 rows), then `packages/core` applies the visibility and ranking rules.

## Seed data rules (found by checking `docs/data/retailers-seed.tsv`)

The seed script (Story 1.3) must handle these facts about the spreadsheet:

- **Duplicate store names.** Five stores appear in two categories with different sale URLs (Bash (TFG), Superbalist, Ackermans, Hirsch's, Faithful to Nature), and nine websites appear more than once overall (for example Woolworths three times). `slug` must stay unique, so the seed script builds it from the name, and appends the category slug when the name is already taken (for example `ackermans-baby-kids-toys`). These are separate listings on purpose, each with its own category-specific URL.
- **One entry per website where it matters.** The "Biggest discounts today" card and the status strip's store count work by **website (domain)**, so a store sold in several categories is counted and listed once, using its best percentage.
- **Rank values.** The `Rank` column holds 1 to 10 and also the text `Alt` for extra stores. The seed maps `Alt` to 100 plus its row order within the category, so numbered stores always sort first.
- **Rows with no primary sale URL.** 14 of 106 rows have no usable primary URL: 12 are marked "No sale page", and 2 (Cielo, Builders) have only a Black Friday campaign page. All 14 are seeded with `is_visible = 0`. **92 rows have a primary sale URL**, not 94 as the spreadsheet's summary tab suggests (it counts the two Black Friday-only stores).
- **Extraction method.** The seed sets `extraction_method` from the `Platform` column: contains "Shopify" gives `shopify_json` (19 rows today); Amazon.co.za, Game and Checkers get `manual` (blocked in the fetch test); everything else gets `html`. Each can be changed later with the override command.
- **Re-running the seed is safe.** It upserts only seed-owned columns (name, URLs, category, platform, rank, seed status) and never touches `is_visible` or `extraction_method` once an operator has changed them, `sale_records` or `overrides`. Seeding must also insert the 10 categories, with taglines to be written during Story 1.3.
