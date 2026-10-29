# Security and Performance

## Security Requirements

**Frontend Security:**
- CSP Headers: `default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'`. Ad network domains are added only when ads go live. Scripts ship as one same-origin file, so scripts need no `'unsafe-inline'`. Check at build that Astro has not inlined it (if it has, emit an external file or add the script's hash to `script-src`). Styles use `'unsafe-inline'` because Astro inlines scoped styles.
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

**Backend Performance:**
- Response Time Target: cache hit under 50 ms at the edge, cache miss under 300 ms.
- Database Optimization: one query for the home page, indexed on `(category_id, rank)`. Retention deletes keep tables small.
- **Measured home page cost (Story 1.4, 2026-10-29):** the current home query (visible stores with an https sale URL, in category and rank order) reads 290 rows per call on the live database (92 rows returned, under 1 ms). Without caching, each page view uses about 290 of the 5,000,000 rows the Free plan allows to be read a day, so about 17,000 views a day, which is below the 100,000 Worker requests a day. This is why home page caching (Story 2.4) is needed before launch. No D1 writes happen per page view. CPU time of the rendering Worker on the live deployment (30 views seen with `wrangler tail`, 2026-10-29): median 3 ms, 90th percentile 8 ms, maximum 10 ms, with the first requests after a deploy at 17 to 21 ms, against the Free plan's 10 ms CPU limit per invocation. A cache hit skips the rendering, which is a second reason for Story 2.4.
- Caching Strategy: robots.txt results may be cached per store for 24 hours in D1 to save one fetch a day (optional optimisation).
