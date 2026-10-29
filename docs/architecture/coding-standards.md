# Coding Standards

## Critical Fullstack Rules

- **Shared logic lives in `packages/core`:** validation, extraction, ranking and visibility are pure functions there. Never copy them into an app.
- **No I/O in core:** `packages/core` never calls `fetch`, D1 or the clock. The caller passes data and the current time in.
- **Facts only:** never store or render retailer images, descriptions, logos or page text (NFR7). Extractors return a number or `null`.
- **Data access through repo functions:** no SQL outside `repo.ts`, `lib/db.ts` and the ops scripts.
- **Config through the `Env` type:** read variables from `env`, never from globals.
- **Logging:** use the structured logger only, never `console.log` directly (NFR11).
- **Never throw out of a store job:** one store's failure is recorded as a result and never stops the run (NFR4).
- **Time is UTC ISO 8601:** store `YYYY-MM-DDTHH:MM:SSZ`. Convert to South African time only in the UI.
- **Every extractor and validator change needs a fixture test.**
- **Free-tier guard:** any new feature that adds D1 writes per page view or more Worker requests needs a note on its daily quota impact.
- **Safe SQL in the operator CLI:** `wrangler d1 execute` takes a plain SQL string with no bound parameters, so every value interpolated by an ops script must be validated first (slug against `^[a-z0-9-]+$`, percentages as integers in range, dates as ISO strings) and free text must have quotes escaped. Prefer the Cloudflare D1 API with bound parameters if an ops script grows beyond simple writes.
- **Record pinned versions:** when scaffolding (Story 1.1), write the exact versions of Astro, the adapter, Wrangler, Vitest and Playwright into the Tech Stack table in this document.

## Naming Conventions

| Element | Frontend | Backend | Example |
|---|---|---|---|
| Components | PascalCase | - | `StoreRow.astro` |
| Functions and variables | camelCase | camelCase | `biggestDiscounts` |
| Core module files | - | kebab-case | `biggest-discounts.ts` |
| Routes | kebab-case | kebab-case | `/api/click`, `/admin/run` |
| Database tables and columns | - | snake_case | `sale_records.last_validated_at` |
| Environment variables | - | UPPER_SNAKE_CASE | `ALERT_WEBHOOK_URL` |
| CSS tokens | kebab-case | - | `--color-ink` |
