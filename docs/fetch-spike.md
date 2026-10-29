# Fetch Spike Results (2026-10-28)

**Method:** one request per path (/sale, /specials, /outlet, /deals) per store, 1 second apart, user-agent `SaleawaySpike/0.1`, run from a home Mac (not Cloudflare Workers). Only HTTP status, size, redirects and a few keyword checks were looked at. Page content was not read, so "reachable" does not mean "discount data extractable".

**Caveat:** Cloudflare Worker IP ranges are often treated more strictly by bot protection, so treat these as best-case results. Re-run from an actual Worker before relying on them.

| Store | Result | Notes |
|---|---|---|
| Takealot | Reachable | /specials redirects to `/all?specials=1`. Pages are small (~18 KB), so likely JavaScript-rendered. |
| Amazon.co.za | **Blocked** | 503 on /sale, /specials, /deals. |
| Makro | Reachable, paths don't exist | 404 on all four guessed paths. Needs the real sale URL. |
| Game | **Blocked** | Redirected to `/blocked` on every path. |
| Woolworths | Reachable, unclear | 200 on all paths with near-identical 1.6 MB pages, so the guessed paths probably return the same page. |
| Checkers | **Blocked** | 403 on every path. |
| Pick n Pay | Reachable, unclear | 200 with an identical ~34 KB page for every path, so probably a JavaScript shell that answers any path. |
| Mr Price | Reachable, unclear | 200 with an identical 16 KB page for every path, same as above. |
| Bash (Superbalist) | **Reachable, best result** | `/sale` returns 200 with discount text. Other paths 404. |
| Incredible Connection | Reachable | Guessed paths redirect to a site search (`?q=sale`), not a dedicated sale page. |
| Under Armour SA | Reachable | `/outlet` redirects to `/collections/outlet`, which looks like Shopify. Shopify stores usually expose product JSON with was/now prices. Not yet checked. |
| Crocs SA | Reachable, paths don't exist | 404 on all four guessed paths. Needs the real sale URL. |
| Wellness Warehouse | Reachable, paths don't exist | 404 on all four guessed paths. Needs the real sale URL. |

## Follow-up (2026-10-28)

The spreadsheet in `docs/data/` shows why the guessed paths failed: the real sale URLs are things like Makro `/promotions-store`, Woolworths `/browse/quality-sale-specials`, Checkers `/all-xtra-savings`, Pick n Pay `/online-specials`, Mr Price `/promos`, Incredible `/deals/clearance-sale`, Under Armour `/collections/sale` and Wellness Warehouse `/collections/deals`. These real URLs have not been re-tested yet. Crocs SA is not in the spreadsheet.

## Takeaways

- Blocked from a normal home connection: **Amazon.co.za, Game, Checkers**. Expect these to be at least as hard from Workers.
- Guessing sale paths does not work reliably. Stores either 404, redirect to search, or return the same page for any path. Each store needs a hand-picked sale URL in the Retailers table.
- Several stores are JavaScript-rendered, so a plain fetch may not contain the discount. Those need a browser render, a store-specific data endpoint, or a manual value.
- Suggested per-store strategies: Shopify JSON (Under Armour, possibly Crocs and others), plain HTML parse (Bash), browser render (JavaScript-heavy stores), manual entry (blocked stores).
