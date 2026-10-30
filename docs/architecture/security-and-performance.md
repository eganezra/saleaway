# Security and Performance

## Security Requirements

**Frontend Security:**
- CSP Headers (built in Story 2.4, production builds only): `default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'`. Ad network domains are added only when ads go live. Scripts ship as one same-origin file, so scripts need no `'unsafe-inline'`. Check at build that Astro has not inlined it (if it has, emit an external file or add the script's hash to `script-src`). Styles use `'unsafe-inline'` because Astro inlines scoped styles.
- XSS Prevention: Astro escapes output by default, and no database value is rendered as raw HTML.
- Secure Storage: no sensitive data in the browser. `localStorage` holds only the strip dismissal flag.
- Outbound links: `rel="noopener noreferrer"` and `target="_blank"`.

**Backend Security:**
- Input Validation: the click endpoint accepts only an existing store slug. The pipeline fetches only `https` URLs, rejects `localhost`, private and link-local addresses, and caps redirects at 3, so a bad row cannot make the Worker call internal services.
- Rate Limiting: `CLICK_SAMPLE_RATE` plus Cloudflare's own edge protections. No other public write endpoint exists.
- CORS Policy: none needed. Endpoints are same-origin.

**Authentication Security:**
- Token Storage: `ADMIN_TOKEN` and `ALERT_WEBHOOK_URL` as Wrangler secrets only.
- Session Management: no sessions.
- Password Policy: not applicable. The operator uses a Cloudflare login, so enable two-factor authentication on that account.

## Performance Optimization

**Frontend Performance:**
- Bundle Size Target: under 50 KB of JavaScript in total (one small script file), HTML under 100 KB compressed.
- Loading Strategy: server-rendered HTML, one subset web font with `font-display: swap`, no images, inline SVG icons.
- Caching Strategy: HTML in the Cache API for about 10 minutes, static assets with long cache lifetimes and hashed file names.
- **As built (Story 2.4, 2026-10-30):** the home page is stored for 600 seconds, keyed by the address without the query string and by the build; only a 200 that says `public` is stored; the browser is told to revalidate every time (`max-age=0, must-revalidate`); `x-cache` shows HIT, MISS or BYPASS. The home query read 334 rows for 57 stores on the live database (read-only check, 2026-10-30), so a view that misses the cache costs about 334 of the 5,000,000 daily row reads, and a hit costs none; with the cache that is about 334 rows per data centre per 10 minutes. The HTML of the page with 92 stores is about 75 KB, 5.9 KB gzipped. A Lighthouse mobile run (13.5.0, headless Chrome on the built site, local): performance 100, accessibility 100, best practices 100, SEO 100 with indexing allowed (66 while it is off: Lighthouse reports "Page is blocked from indexing", which is the intended state before launch). The three security headers are added by the Worker in a production build; HSTS waits for the real domain.

**Backend Performance:**
- Response Time Target: cache hit under 50 ms at the edge, cache miss under 300 ms.
- Database Optimization: one query for the home page, indexed on `(category_id, rank)`. Retention deletes keep tables small.
- **Measured home page cost (Story 1.4, 2026-10-29):** the current home query (visible stores with an https sale URL, in category and rank order) reads 290 rows per call on the live database (92 rows returned, under 1 ms). Without caching, each page view uses about 290 of the 5,000,000 rows the Free plan allows to be read a day, so about 17,000 views a day, which is below the 100,000 Worker requests a day. This is why home page caching (Story 2.4) is needed before launch. No D1 writes happen per page view. CPU time of the rendering Worker on the live deployment (30 views seen with `wrangler tail`, 2026-10-29): median 3 ms, 90th percentile 8 ms, maximum 10 ms, with the first requests after a deploy at 17 to 21 ms, against the Free plan's 10 ms CPU limit per invocation. A cache hit skips the rendering, which is a second reason for Story 2.4. **After Story 2.3 (2026-10-30):** the home query also joins `sale_records` and `overrides`; on the live database (57 visible stores, both tables empty) it returns 57 rows and reads **334 rows** per call (0.5 ms), so about 15,000 uncached views a day would use the 5,000,000 free row-reads. The rules run in the Worker (a few comparisons per store). **Deploy hazard:** every store's `created_at` is 2026-10-29 12:58:38 UTC, so with the 72 hour rule in force and no `sale_records` (Story 3.5) or overrides, the home page would be empty from 2026-11-01 12:58:38 UTC; the web app with these rules is therefore not deployed until that is decided.
- Caching Strategy: robots.txt results may be cached per store for 24 hours in D1 to save one fetch a day (optional optimisation).
