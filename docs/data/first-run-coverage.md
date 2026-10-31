# Coverage report: run 17

Run 17 (cron) started 2026-10-31 03:00:35 UTC; its last result was saved 2026-10-31 03:14:39 UTC, about 14 minutes from the start; 57 of 57 stores have a result. Made 2026-10-31 06:18:25 UTC by `pnpm ops:coverage`.

Sale records as of 2026-10-31 03:14:39 UTC.

## Summary

| What | Stores |
| --- | --- |
| With a percentage | 21 |
| "On sale" only (no percentage) | 22 |
| &nbsp;&nbsp;of which: valid page with no figure / JavaScript page / page not readable | 1 / 14 / 7 |
| Judged ended | 8 |
| Blocked | 2 |
| Not found | 0 |
| Redirected away | 0 |
| Errors | 1 |
| Never checked successfully | 0 |
| Manual (never fetched) | 3 |
| **Visible stores** | **57** |
| Hidden stores | 49 |

## Stores that need manual handling

| Store | Group | Reason |
| --- | --- | --- |
| Loot (loot) | "On sale" only (no percentage) | valid page, no figure found (method html) |
| Evetech (evetech) | Judged ended | judged ended: open the page and check it by hand |
| Faithful to Nature (faithful-to-nature) | Judged ended | judged ended: open the page and check it by hand |
| Faithful to Nature (faithful-to-nature-grocery-liquor) | Judged ended | judged ended: open the page and check it by hand |
| Gelmar (gelmar) | Judged ended | judged ended: open the page and check it by hand |
| House & Home (Lewis Group) (house-home-lewis-group) | Judged ended | judged ended: open the page and check it by hand |
| Mr Price (mr-price) | Judged ended | judged ended: open the page and check it by hand |
| SPAR (spar) | Judged ended | judged ended: open the page and check it by hand |
| The Body Shop SA (the-body-shop-sa) | Judged ended | judged ended: open the page and check it by hand |
| Beauty On Tapp (beauty-on-tapp) | Blocked | blocked: http_429 |
| Norman Goodfellows (norman-goodfellows) | Blocked | blocked: http_429 |
| Benji + Moon (benji-moon) | Errors | error: unsafe_redirect |
| Amazon.co.za (amazon-co-za) | Manual (never fetched) | manual method, no override yet |
| Checkers / Sixty60 (checkers-sixty60) | Manual (never fetched) | manual method, no override yet |
| Game (Massmart) (game-massmart) | Manual (never fetched) | manual method, no override yet |

## Stores shown as "On sale" with no percentage

| Store | Method | Why no figure |
| --- | --- | --- |
| Absolute Pets (absolute-pets) | html | page not readable, address only |
| Bob Shop (bob-shop) | html | JavaScript page, address only |
| Cape Union Mart / K-Way (cape-union-mart-k-way) | html | JavaScript page, address only |
| Cashbuild (cashbuild) | html | JavaScript page, address only |
| Clicks (clicks) | html | JavaScript page, address only |
| DreamWare Tech (dreamware-tech) | html | page not readable, address only |
| ePETstore (epetstore) | html | page not readable, address only |
| Food Lover's Market (food-lovers-market) | html | JavaScript page, address only |
| @home (shop on Bash) (home-shop-on-bash) | html | JavaScript page, address only |
| Liquor City (liquor-city) | html | page not readable, address only |
| Loot (loot) | html | valid page, no figure |
| Pick n Pay (pick-n-pay) | html | page not readable, address only |
| Samsung SA (samsung-sa) | html | JavaScript page, address only |
| SHEIN SA (shein-sa) | html | JavaScript page, address only |
| Superbalist (superbalist) | html | JavaScript page, address only |
| Superbalist (superbalist-fashion-apparel) | html | JavaScript page, address only |
| Takealot (takealot) | html | JavaScript page, address only |
| Temu (SA storefront) (temu-sa-storefront) | html | JavaScript page, address only |
| Under Armour SA (under-armour-sa) | html | page not readable, address only |
| Woolworths (all depts) (woolworths-all-depts) | html | JavaScript page, address only |
| Woolworths (fashion) (woolworths-fashion) | html | page not readable, address only |
| Woolworths Food (woolworths-food) | html | JavaScript page, address only |

## Hidden stores

### http_403 (21)

The store answered 403 Forbidden (bot protection) on 2026-10-30.

`adendorff-machinery-mart`, `adidas-sa`, `bradlows`, `ctm`, `dis-chem`, `estee-lauder-sa`, `hifi-corp`, `incredible-connection`, `istore`, `leroy-merlin-sa`, `mac-cosmetics-sa`, `new-balance-sa`, `outdoor-warehouse`, `pet-heaven`, `petshop-science-on-checkers-sixty60`, `shoprite`, `sportsmans-warehouse`, `truworths`, `wootware`, `yuppiechef`, `zara-sa`

### no_sale_page (14)

The store has no sale address (nothing to fetch).

`babies-galore`, `buco`, `build-it`, `builders`, `chamberlain`, `cielo`, `hamleys-sa`, `kids-emporium`, `naartjie`, `pep`, `plumblink`, `skin-renewal-online-skin-shop`, `turf-pet-hyper`, `zuki`

### http_429 (13)

The store answered 429 Too Many Requests on 2026-10-30.

`ackermans`, `canine-co`, `computer-mania`, `coricraft`, `decofurn`, `edgars`, `edgars-beauty`, `fair-price`, `family-pet-centre`, `hi-tec-sa`, `matrix-warehouse`, `petworld`, `wellness-warehouse`

### same_site_as_blocked (1)

Another listing on the same website was blocked on 2026-10-30, and this one answered 500 from the same site.

`ackermans-baby-kids-toys`

Made by `pnpm ops:coverage`; it reads the database only.

## Free-tier check

Written by hand after the report was generated (the command does not make this part). Limits are from `docs/architecture/verified-platform-limits-cloudflare-free-plan-checked-2026-10-29.md`; "used" is what run 17 (57 stores) needed, worked out from the tables and the code in `apps/pipeline/src`.

| What | Free-tier limit | Run 17 used | How the figure was worked out |
| --- | --- | --- | --- |
| Worker requests per day | 100,000 | 59, at most 116 with one retry each | 2 crons + 1 queue invocation per store; `max_retries` is 1 |
| D1 rows written per day | 100,000 | about 113 rows, a few hundred if index entries are counted | 1 `pipeline_runs` row + 57 `run_results` rows + 54 `sale_records` rows (the 3 manual stores have none) + 1 closing update. The click counter (Story 2.5) writes one row per click at sample rate 1, so it shares this budget: about 99,000 clicks a day before sampling matters |
| D1 rows read per day | 5,000,000 | about 2,000 | start cron scans about 106 stores; each store reads 2 rows; closing reads at most 10 runs of about 57 results each |
| Queue operations per day | 10,000 | about 171, at most about 342 | one message per store: a write, a read and an acknowledge (about 3 each), doubled if every store retried |
| Workers Logs events per day | 200,000 | a few hundred | per store: the invocation line, `page_validated` and `discount_extracted` (about 3), plus the run lines |
| D1 queries in one invocation | 50 | 4 per store; 21 when closing 10 runs | store: retailer lookup, sale record read, then the result and the record in one batch of 2 (`repo.ts`). Closing: 1 list + 2 per run (the cap `MAX_RUNS_PER_FINALIZE` is 10) |
| Subrequests in one invocation | 50 | at most 12 fetches per store, typically 2 or 3 | robots.txt and the page, each up to 1 + 3 redirects, and one feed request for a Shopify collection store (it reuses the robots text). Even counting the 4 D1 queries as subrequests that is 16 |
| Time | the 45 minutes between the start and the closing cron | about 14 minutes | first result 2026-10-31 03:00 UTC, last 03:14:39 UTC |

**Inside free-tier limits.** No daily figure is above about 4% of its limit (queue operations at the retry worst case), and the per-invocation counts are below 50 by a wide margin (4 and 21 queries, at most 16 subrequests).

## Extraction methods changed in this story

| Store | Before | After | Evidence |
| --- | --- | --- | --- |
| loot | html | structured_data | The only valid store with no figure in run 17 (table above). Story 3.4's saved page sample and raw-page check: its prices are in a script (`listPrice`, `price`), which `structured_data` reads (64% on that sample) and `html` does not. One-row update on the live database, read back on 2026-10-31. |

No other valid store had no figure, so no other method was changed. The 21 other "On sale" stores have no figure because their page is a JavaScript page (14) or could not be read (7); that is not a method problem and is not changed here.
