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

## Follow-up (2026-10-30): fetched from a deployed Worker (Story 3.2)

**Method:** one full run of the deployed `saleaway-pipeline` Worker (run 16, started 2026-10-30 07:13 UTC, 15 seconds between stores, about 25 minutes). For each store the Worker asked `robots.txt`, then fetched the sale page once, with the user-agent `SaleawayBot/1.0 (+https://saleaway.co.za/contact)` (the code now says `saleaway.online`, the registered domain; the run happened before the change and the two differ only in the address inside the brackets), a 10 second timeout, at most 3 redirects, `https` only, and no attempt to look like a browser. The page content was not read or stored: only the HTTP status and the classification were saved. Manual stores (Amazon.co.za, Game, Checkers / Sixty60) were skipped and never contacted. (The user-agent contact address was changed to `saleaway.online` after this run.)

**Result: 34 of the 89 stores that were fetched (38 percent) were blocked.** That is more than the one third that the story treats as a change to the plan (risk R2).

| Result | Stores | What it means |
|---|---|---|
| `ok` | 39 | The page answered 200 and the store is not flagged as a JavaScript page. |
| `js_only` | 14 | The page answered 2xx and the spreadsheet says its products load with JavaScript, so it can only be checked by address. |
| `blocked` | 34 | HTTP 403 for 21 stores, HTTP 429 for 13 stores. |
| `error` | 2 | One HTTP 500 (`ackermans-baby-kids-toys`) and one redirect to a plain `http://` address that the fetcher refuses (`benji-moon`). |
| `skipped_manual` | 3 | Never contacted. |
| `not_found`, `redirected_away` | 0 | |

`robots.txt` caused **no** refusal and no failure: every site's `robots.txt` was reachable (or absent) and none forbade its sale page. Time per store: average 1358 ms, median 835 ms, longest 5934 ms.

**Where the blocking is**

- **Shopify stores (the `shopify_json` method): 12 of 18 blocked, all with HTTP 429** (blocked 12, ok 4, error 2). Shopify throttles requests from the Worker's addresses, and even the first request to a site gets it. A product feed (`/collections/<name>/products.json`) was also checked once from a home connection for three of these stores (Wellness Warehouse, Hi-Tec, Decofurn) and answered 429 there too. Under Armour SA is a custom storefront with no product feed at all (404). So the Shopify JSON method that Story 3.4 relies on looks unusable with an honest user-agent.
- **Other stores (`html`): 22 of 71 blocked, all with HTTP 403** (bot protection at the retailer's edge). The rest: ok 35, js_only 14.
- **The spreadsheet's "verified" status does not predict it.** Of the 54 stores marked `verified_products` (their pages loaded with products from a home connection), 24 were blocked from the Worker. The stores that answer well include Bash (4 listings), Makro (2), Cotton On (2), Hirsch's (2), Faithful to Nature (2), Woolworths, Superbalist and Takealot.
- **Two stores on one site can differ.** `ackermans` answered 429 and `ackermans-baby-kids-toys` (the same address) answered 500 in the same run.
- **Cape Union Mart answered HTTP 202**, which can be a bot-check page, and is recorded as `js_only` because the spreadsheet flags it. Story 3.3 should not treat every 2xx as a real page.

**Other findings**

- `benji-moon`: its sale address (`https://benjiandmoon.co.za/products/sale`) redirects to `http://benjiandmoon.co.za/products/sale/` (plain http, with a trailing slash). The fetcher refuses to follow it. The fix is a data one for Story 4.3: use the `https://` address with the trailing slash.
- Woolworths: `woolworths-all-depts` and `woolworths-fashion` have the same address. The first is flagged JavaScript-only (`js_only`), the second is not (`ok`), so one page is judged two different ways. Story 3.3 should settle this.

**CPU measured on the deployed Worker (spike S1, with a stand-in for the real parsing)**

A queue consumer invocation that checked `robots.txt`, fetched the page and streamed the whole body through one `HTMLRewriter` pass with five selectors (the stand-in for validation and extraction), three runs per store, read from `wrangler tail`:

| Store | Page size | CPU per run (ms) | Wall time (ms) | Outcome |
|---|---|---|---|---|
| `bash-tfg` | 760,676 bytes | 81, 108, 37 | 1753, 3023, 874 | all `ok` |
| `woolworths-fashion` | 1,646,709 bytes | 55, 40, 24 | 4921, 5170, 2864 | all `ok` |
| `under-armour-sa` | 325,467 bytes (its product feed does not exist) | 29, 27, 20 | 2204, 1166, 2294 | all `ok` |
| `takealot` | 19,381 bytes (a JavaScript page) | 5, 7, 9 | 517, 481, 573 | all `ok` |

- **No invocation was stopped.** All 12 ended `ok`, although 9 of them used more than 10 ms of CPU and the largest used 108 ms. So the Free plan's 10 ms limit is **not enforced on queue consumers**, which fits Cloudflare's Queues documentation (30 second default). It still applies to the web Worker's page requests and to the scheduled handler.
- Bash, Woolworths and Under Armour exceed 8 ms in every run, so by the PRD's assumption they "regularly exceed" it. Since nothing is cut off, no store needs the fallback runner (Story 3.8) for CPU. The first run of each store was the slowest.
- These numbers are an upper bound: they include `robots.txt` parsing and a deliberately broad probe. They must be **repeated with the real validation and extraction** (Story 3.4, criterion 8).
- **A Shopify product feed could not be measured**: none of the Shopify stores checked offers one to an honest user-agent (see above).

**What the operator should decide** (these are decisions, not done yet): how to treat the 34 blocked stores. Options: give them the `manual` method and enter percentages by hand (Story 4.1); try the fallback runner on GitHub Actions to see whether its addresses are treated differently (Story 3.8, a test is needed first); ask the biggest retailers to allow the user-agent; or hide them at launch. This list feeds Story 3.6 and Story 4.3.

**Decision (2026-10-30, Story 3.9):** the user ruled out contacting retailers and chose to **hide the blocked stores for launch**. The 34 blocked stores and one more listing on the same website (`ackermans-baby-kids-toys`, which answered 500 from the site that blocks `ackermans`) are listed in [`hidden-stores.json`](data/hidden-stores.json) and hidden with `pnpm ops:hide`. The site and the daily run now use 57 stores (53 that answer, 3 `manual`, and `benji-moon`, an error that is a data fix). The hidden stores come back one by one in Story 5.4; Story 4.3's script, run from a home connection, gives a free test of another network.

### Product feeds from a home connection (Story 3.4, 2026-10-30)

Before writing the Shopify extractor, the two Shopify stores whose sale address is a collection were asked once for their product feed (`/collections/<handle>/products.json?limit=250`), from a home connection, after reading their `robots.txt`, with the pipeline's user-agent and no retry:

| Store | Feed address | Answer |
|---|---|---|
| `beauty-on-tapp` | `/collections/clearance-sale/products.json` | **429** (Shopify's rate limit; not asked again) |
| `toy-kingdom` | `/collections/sale/products.json` | **404** (the store's own not-found page; no feed there) |

So **neither feed answered from a home connection**, and the Shopify extractor was tested on hand-made feeds in the real Shopify shape. The other three `shopify_json` stores were not asked: `under-armour-sa` has no feed (Story 3.2) and was set to the `html` method; `norman-goodfellows` has a hub page as its sale address and `benji-moon` a single product page, so no feed address can be derived from them (a data fix, Story 4.3). The pipeline asks `beauty-on-tapp` and `toy-kingdom` for their feed once a night and reads the page when the feed does not answer; the first nightly run (`discount_extracted`, field `feed`) shows whether the Worker is treated differently, and if both keep failing an operator can switch them to `html`.

### All 92 stores in this run

| # | Store | Site | Method | Result | HTTP | Reason | ms |
|---|---|---|---|---|---|---|---|
| 1 | `takealot` | takealot.com | html | js_only | 200 |  | 354 |
| 2 | `temu-sa-storefront` | temu.com | html | js_only | 200 |  | 768 |
| 3 | `bash-tfg` | bash.com | html | ok | 200 |  | 1352 |
| 4 | `makro` | makro.co.za | html | ok | 200 |  | 1532 |
| 5 | `bob-shop` | bobshop.co.za | html | js_only | 200 |  | 835 |
| 6 | `superbalist` | superbalist.com | html | js_only | 200 |  | 569 |
| 7 | `woolworths-all-depts` | woolworths.co.za | html | js_only | 200 |  | 3708 |
| 8 | `amazon-co-za` | amazon.co.za | manual | skipped_manual |  |  | 146 |
| 9 | `game-massmart` | game.co.za | manual | skipped_manual |  |  | 160 |
| 10 | `onedayonly` | onedayonly.co.za | html | ok | 200 |  | 4407 |
| 11 | `loot` | loot.co.za | html | ok | 200 |  | 3530 |
| 12 | `shein-sa` | za.shein.com | html | js_only | 200 |  | 724 |
| 13 | `bash-tfg-fashion-apparel` | bash.com | html | ok | 200 |  | 1327 |
| 14 | `superbalist-fashion-apparel` | superbalist.com | html | js_only | 200 |  | 257 |
| 15 | `mr-price` | mrp.com | html | ok | 200 |  | 643 |
| 16 | `woolworths-fashion` | woolworths.co.za | html | ok | 200 |  | 3426 |
| 17 | `cotton-on-sa` | cottonon.com | html | ok | 200 |  | 733 |
| 18 | `truworths` | truworths.co.za | html | blocked | 403 | http_403 | 293 |
| 19 | `edgars` | edgars.co.za | shopify_json | blocked | 429 | http_429 | 517 |
| 20 | `ackermans` | ackermans.co.za | shopify_json | blocked | 429 | http_429 | 202 |
| 21 | `zara-sa` | zara.com | html | blocked | 403 | http_403 | 331 |
| 22 | `sportscene-on-bash` | bash.com | html | ok | 200 |  | 1690 |
| 23 | `totalsports-on-bash` | bash.com | html | ok | 200 |  | 1232 |
| 24 | `sportsmans-warehouse` | sportsmanswarehouse.co.za | html | blocked | 403 | http_403 | 495 |
| 25 | `nike-sa` | nike.com | html | ok | 200 |  | 1036 |
| 26 | `adidas-sa` | adidas.co.za | html | blocked | 403 | http_403 | 1182 |
| 27 | `cape-union-mart-k-way` | capeunionmart.co.za | html | js_only | 202 |  | 546 |
| 28 | `studio-88` | studio-88.co.za | html | ok | 200 |  | 2717 |
| 29 | `puma-sa` | za.puma.com | html | ok | 200 |  | 570 |
| 30 | `under-armour-sa` | underarmour.co.za | shopify_json | ok | 200 |  | 748 |
| 31 | `outdoor-warehouse` | outdoorwarehouse.co.za | html | blocked | 403 | http_403 | 182 |
| 32 | `side-step` | side-step.co.za | html | ok | 200 |  | 3636 |
| 33 | `new-balance-sa` | newbalance.co.za | html | blocked | 403 | http_403 | 439 |
| 34 | `hi-tec-sa` | hi-tec.co.za | shopify_json | blocked | 429 | http_429 | 280 |
| 35 | `incredible-connection` | incredible.co.za | html | blocked | 403 | http_403 | 224 |
| 36 | `hifi-corp` | hificorp.co.za | html | blocked | 403 | http_403 | 201 |
| 37 | `samsung-sa` | samsung.com | html | js_only | 200 |  | 793 |
| 38 | `evetech` | evetech.co.za | html | ok | 200 |  | 1124 |
| 39 | `istore` | istore.co.za | html | blocked | 403 | http_403 | 204 |
| 40 | `wootware` | wootware.co.za | html | blocked | 403 | http_403 | 128 |
| 41 | `computer-mania` | computermania.co.za | shopify_json | blocked | 429 | http_429 | 499 |
| 42 | `hirschs` | hirschs.co.za | html | ok | 200 |  | 611 |
| 43 | `matrix-warehouse` | matrixwarehouse.co.za | shopify_json | blocked | 429 | http_429 | 519 |
| 44 | `dreamware-tech` | dreamwaretech.co.za | html | ok | 200 |  | 3077 |
| 45 | `mr-price-home` | mrphome.com | html | ok | 200 |  | 736 |
| 46 | `fair-price` | fairprice.co.za | html | blocked | 429 | http_429 | 450 |
| 47 | `decofurn` | decofurnsa.co.za | shopify_json | blocked | 429 | http_429 | 453 |
| 49 | `house-home-lewis-group` | houseandhome.co.za | html | ok | 200 |  | 1124 |
| 50 | `sheet-street` | sheetstreet.com | html | ok | 200 |  | 2760 |
| 51 | `hirschs-home-decor-furniture` | hirschs.co.za | html | ok | 200 |  | 222 |
| 52 | `home-shop-on-bash` | athome.co.za | html | js_only | 200 |  | 1705 |
| 53 | `coricraft` | coricraft.co.za | shopify_json | blocked | 429 | http_429 | 173 |
| 54 | `yuppiechef` | yuppiechef.com | html | blocked | 403 | http_403 | 203 |
| 55 | `bradlows` | bradlows.co.za | html | blocked | 403 | http_403 | 158 |
| 57 | `leroy-merlin-sa` | leroymerlin.co.za | html | blocked | 403 | http_403 | 271 |
| 58 | `cashbuild` | cashbuild.co.za | html | js_only | 200 |  | 2162 |
| 60 | `ctm` | ctm.co.za | html | blocked | 403 | http_403 | 160 |
| 61 | `gelmar` | gelmar.co.za | html | ok | 200 |  | 4417 |
| 65 | `tile-africa` | tileafrica.co.za | html | ok | 200 |  | 1677 |
| 66 | `adendorff-machinery-mart` | adendorff.co.za | html | blocked | 403 | http_403 | 172 |
| 67 | `clicks` | clicks.co.za | html | js_only | 200 |  | 904 |
| 68 | `dis-chem` | dischem.co.za | html | blocked | 403 | http_403 | 165 |
| 69 | `edgars-beauty` | edgars.co.za | shopify_json | blocked | 429 | http_429 | 213 |
| 70 | `faithful-to-nature` | faithful-to-nature.co.za | html | ok | 200 |  | 1677 |
| 71 | `wellness-warehouse` | wellnesswarehouse.com | shopify_json | blocked | 429 | http_429 | 197 |
| 72 | `mac-cosmetics-sa` | maccosmetics.co.za | html | blocked | 403 | http_403 | 923 |
| 73 | `the-body-shop-sa` | thebodyshop.co.za | html | ok | 200 |  | 853 |
| 74 | `estee-lauder-sa` | esteelauder.co.za | html | blocked | 403 | http_403 | 1027 |
| 75 | `beauty-on-tapp` | beautyontapp.com | shopify_json | ok | 200 |  | 1017 |
| 77 | `checkers-sixty60` | checkers.co.za | manual | skipped_manual |  |  | 128 |
| 78 | `pick-n-pay` | pnp.co.za | html | ok | 200 |  | 1412 |
| 79 | `woolworths-food` | woolworths.co.za | html | js_only | 200 |  | 3549 |
| 80 | `shoprite` | shoprite.co.za | html | blocked | 403 | http_403 | 919 |
| 81 | `makro-food-liquor` | makro.co.za | html | ok | 200 |  | 1677 |
| 82 | `spar` | spar.co.za | html | ok | 200 |  | 5516 |
| 83 | `food-lovers-market` | foodloversmarket.co.za | html | js_only | 200 |  | 3350 |
| 84 | `faithful-to-nature-grocery-liquor` | faithful-to-nature.co.za | html | ok | 200 |  | 1892 |
| 85 | `norman-goodfellows` | ngf.co.za | shopify_json | ok | 200 |  | 891 |
| 86 | `liquor-city` | liquorcity.co.za | html | ok | 200 |  | 1742 |
| 87 | `ackermans-baby-kids-toys` | ackermans.co.za | shopify_json | error | 500 | http_500 | 3371 |
| 89 | `toys-r-us-sa` | toysrus.co.za | html | ok | 200 |  | 5093 |
| 90 | `cotton-on-kids-sa` | cottonon.com | html | ok | 200 |  | 856 |
| 91 | `babies-r-us-sa` | babiesrus.co.za | html | ok | 200 |  | 5934 |
| 92 | `toy-kingdom` | toykingdom.co.za | shopify_json | ok | 200 |  | 557 |
| 97 | `pet-heaven` | petheaven.co.za | html | blocked | 403 | http_403 | 198 |
| 98 | `petshop-science-on-checkers-sixty60` | checkers.co.za | html | blocked | 403 | http_403 | 302 |
| 99 | `absolute-pets` | absolutepets.com | html | ok | 200 |  | 4435 |
| 100 | `petworld` | petworld.co.za | shopify_json | blocked | 429 | http_429 | 806 |
| 101 | `epetstore` | epetstore.co.za | html | ok | 200 |  | 4644 |
| 102 | `canine-co` | canineandco.co.za | shopify_json | blocked | 429 | http_429 | 490 |
| 103 | `family-pet-centre` | familypetcentre.co.za | shopify_json | blocked | 429 | http_429 | 851 |
| 106 | `benji-moon` | benjiandmoon.co.za | shopify_json | error |  | unsafe_redirect | 912 |

## Takeaways

_Update 2026-10-30: the fetch from a deployed Worker (section above) shows much more blocking than the home connection did, and Shopify product feeds are throttled. These takeaways were written before that._

- Blocked from a normal home connection: **Amazon.co.za, Game, Checkers**. Expect these to be at least as hard from Workers.
- Guessing sale paths does not work reliably. Stores either 404, redirect to search, or return the same page for any path. Each store needs a hand-picked sale URL in the Retailers table.
- Several stores are JavaScript-rendered, so a plain fetch may not contain the discount. Those need a browser render, a store-specific data endpoint, or a manual value.
- Suggested per-store strategies: Shopify JSON (Under Armour, possibly Crocs and others), plain HTML parse (Bash), browser render (JavaScript-heavy stores), manual entry (blocked stores).
