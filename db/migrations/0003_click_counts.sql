-- db/migrations/0003_click_counts.sql
-- Story 2.5: click-outs per store per day (FR19). Counters only: nothing about the visitor is stored. Additive.
CREATE TABLE click_counts (
  day         TEXT NOT NULL,
  retailer_id INTEGER NOT NULL REFERENCES retailers(id),
  clicks      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, retailer_id)
);
