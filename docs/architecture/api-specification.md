# API Specification

Saleaway has no public API. The only HTTP endpoints are internal, so no OpenAPI document is needed.

| Endpoint | Worker | Auth | Purpose |
|---|---|---|---|
| `GET /` and static pages | web | none | Server-rendered pages, edge-cached |
| `POST /api/click` | web | none, rate-limited by a sampling switch | Records a click-out for a store slug (FR19) |
| `GET /health` | web | none | Canary: returns `ok` (Story 1.1) |
| `POST /admin/run` | pipeline | `Authorization: Bearer <ADMIN_TOKEN>`, compared in constant time | Start a manual pipeline run (Story 3.1, AC6). `?store=<slug>` runs one store only (Story 3.2): 400 `bad_store` for a bad slug, 404 `store_not_found` for an unknown or non-https store. A store hidden for launch is accepted, so it can be tested again (Story 3.9) |

`/api/click` validates that the slug exists and increments the day's counter. A `CLICK_SAMPLE_RATE` setting (default 1.0) can reduce writes if D1's 100,000 rows-written-per-day limit is at risk.
