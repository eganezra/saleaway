-- db/migrations/0004_fetch_mode.sql
-- Story 5.1: how a store's sale page is obtained. 'plain' (the default) is a normal fetch; 'browser' means the page is
-- rendered by Cloudflare's browser first, for a store that loads its products with JavaScript. Additive only: every
-- store stays 'plain' until an operator switches it, and the seed never changes this column (like extraction_method).
ALTER TABLE retailers ADD COLUMN fetch_mode TEXT NOT NULL DEFAULT 'plain' CHECK (fetch_mode IN ('plain','browser'));
