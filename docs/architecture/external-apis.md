# External APIs

## Retailer sale pages (public websites)

- **Purpose:** read each store's sale page to confirm a real sale and the deepest discount.
- **Documentation:** none. These are public web pages, not APIs.
- **Base URL(s):** the `sale_url` of each retailer.
- **Authentication:** none.
- **Rate Limits:** self-imposed. One page fetch per store per day, plus a robots.txt check, staggered over about 25 minutes (NFR6).

**Key Endpoints Used:**
- `GET {sale_url}` - the sale page.
- `GET {origin}/robots.txt` - checked before the page fetch.
- For Shopify stores: `GET {origin}/collections/{handle}/products.json?limit=250` - read was/now prices. **Asked only when the store's sale address is exactly `/collections/<handle>`** (Story 3.4), after the page has been judged `valid` and only if `robots.txt` (already read) allows the path: once a night, never retried, and a 403, 429 or 404 means the discount is read from the page instead. A store whose sale address is a hub page or a product page, and a store with no feed (Under Armour SA), make no feed request. Measured from a home connection on 2026-10-30: `beauty-on-tapp` answered 429 and `toy-kingdom` 404, so neither feed is known to work yet; the first nightly run shows whether the Worker is treated differently (`discount_extracted`, `feed`).

**Integration Notes:** the user-agent is `SaleawayBot/1.0 (+https://saleaway.online/contact)`, on every request including `robots.txt`, with an `Accept` header and no other header. Each request times out after 10 seconds **[Assumption]**. Only `https` URLs are fetched, redirects are followed by hand and limited to 3, each target is checked first, and a redirect to `http://`, to an IP address or to a local name (`localhost.`, `x.internal`) is never requested. `robots.txt` is asked first and obeyed (RFC 9309): a refusal is recorded as `blocked`, an unreachable file (5xx, timeout) as an error with the page not fetched, and a missing file (4xx) means everything is allowed. A page of a store whose spreadsheet status is `verified_js_shell` is classified `js_only` on a 2xx answer without reading it. No attempt is made to get around bot protection (NFR6): a blocked store is recorded and never retried. Three stores (Amazon.co.za, Game, Checkers) blocked even a home connection, so they default to `manual`. **Measured from a deployed Worker (Story 3.2):** 34 of the 89 other stores also blocked it (see `docs/fetch-spike.md`).

## Cloudflare Web Analytics

- **Purpose:** cookie-free visit counts (FR19, NFR8).
- **Documentation:** Cloudflare dashboard.
- **Authentication:** a site token in the page.
- **Integration Notes:** one small script, permitted in the CSP.

## Ad network (later)

Not integrated in the MVP. The ad slots stay empty until an ad network approves the site (FR18). Adding ads will need CSP changes and a POPIA review.
