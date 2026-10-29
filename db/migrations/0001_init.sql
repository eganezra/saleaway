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
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
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
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
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
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_run_results_run ON run_results(run_id);
CREATE INDEX idx_run_results_retailer_time ON run_results(retailer_id, created_at);
