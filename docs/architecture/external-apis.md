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
- For Shopify stores: `GET {origin}/collections/{handle}/products.json?limit=...` - read was/now prices.

**Integration Notes:** the user-agent is `SaleawayBot/1.0 (+https://saleaway.co.za/contact)`. Only `https` URLs are fetched, redirects are limited to 3, and private or local addresses are rejected. No attempt is made to get around bot protection (NFR6). Three stores (Amazon.co.za, Game, Checkers) blocked even a home connection, so they default to `manual`.

## Cloudflare Web Analytics

- **Purpose:** cookie-free visit counts (FR19, NFR8).
- **Documentation:** Cloudflare dashboard.
- **Authentication:** a site token in the page.
- **Integration Notes:** one small script, permitted in the CSP.

## Ad network (later)

Not integrated in the MVP. The ad slots stay empty until an ad network approves the site (FR18). Adding ads will need CSP changes and a POPIA review.
