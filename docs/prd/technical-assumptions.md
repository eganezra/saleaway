# Technical Assumptions

## Repository Structure: Monorepo

One repository containing the web app, the pipeline Worker(s), shared types and the database migrations and seed data.

## Service Architecture

Serverless on Cloudflare, as set out in the brief:

- **Web:** Astro on Cloudflare Workers (decided 2026-10-29 in `docs/architecture.md`, chosen over Next.js because Cloudflare's Next.js route is still beta and the page is mostly static).
- **Pipeline:** Cloudflare Worker with a Cron Trigger, fanning out batches of stores (for example through Queues or several scheduled runs) to stay within free-tier request limits. **[Assumption]** The free plan currently allows about 50 outbound requests per Worker invocation. The Architect must verify the current limits.
- **Database:** Cloudflare D1 (SQLite).
- **Optional:** Browser Rendering for JavaScript-only stores, limited by its free allowance. R2 only if files are needed.

## Testing Requirements

Unit + Integration. Unit tests for validation and discount extraction using saved page samples. Integration tests for the pipeline against a local D1 database. Manual smoke test after each deploy. No full end-to-end suite for the 3-day MVP.

## Additional Technical Assumptions and Requests

- **Done in Story 3.2 (2026-10-30):** from the deployed Worker, 34 of the 89 stores fetched answered 403 or 429 (12 of the 18 Shopify stores answered 429), although the same pages loaded from a home connection. The honest user-agent is kept and no evasion is attempted (NFR6). Contacting retailers is ruled out. These stores, and one more listing on the same website, are hidden for launch (Story 3.9) and brought back one by one in Story 5.4.
- Known blocked stores (Amazon.co.za, Game, Checkers) default to the manual extraction method. Another 35 stores are hidden by decision (`docs/data/hidden-stores.json`).
- Extraction method is stored per store, so a store can be switched from "manual" to an automated method without a release.
- 19 stores load their products with JavaScript, so a plain fetch may not contain prices. These start as "On sale" until browser rendering or a data endpoint is added (Epic 5).
- The 21 search-only URLs in the spreadsheet must be checked before launch (Story 4.3).
- Some Black Friday URLs still show 2025 content, so FR16 is a stretch item.
- The CPU limit does not stop the Worker: Story 3.2 measured 5 to 108 ms per store, and Cloudflare does not enforce 10 ms on queue consumers. A fallback runner on GitHub Actions or another free network (Story 3.8, conditional) is built only if Story 4.3 or Story 5.4 shows that a different network gets through where the Worker is blocked. See `docs/architecture.md`, "Platform decision".
