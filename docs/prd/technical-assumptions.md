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

- The first fetch test came from a home connection. Re-run it from a real Worker early (Story 3.2), since Cloudflare IP ranges may be blocked more often.
- Known blocked stores (Amazon.co.za, Game, Checkers) default to the manual extraction method.
- Extraction method is stored per store, so a store can be switched from "manual" to an automated method without a release.
- 19 stores load their products with JavaScript, so a plain fetch may not contain prices. These start as "On sale" until browser rendering or a data endpoint is added (Epic 5).
- The 21 search-only URLs in the spreadsheet must be checked before launch (Story 4.3).
- Some Black Friday URLs still show 2025 content, so FR16 is a stretch item.
- If the CPU measurement in Story 3.2 shows that big pages exceed the Free plan's 10 ms limit, the fetch-and-extract step moves to a scheduled GitHub Actions workflow (Story 3.8, conditional). See `docs/architecture.md`, "Platform decision".
