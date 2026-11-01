# Coverage report: run 18

Run 18 (cron) started 2026-11-01 03:00:34 UTC; its last result was saved 2026-11-01 03:14:54 UTC, about 14 minutes from the start; 58 of 58 stores have a result. Made 2026-11-01 05:44:31 UTC by `pnpm ops:coverage`.

Sale records as of 2026-11-01 03:14:54 UTC.

## What changed between run 17 and run 18

Run 18 (2026-11-01) is the first run with Story 3.10's rules, `loot` read as `structured_data` (Story 3.6) and the seed changes of Story 4.3. Written by hand after the report was generated.

| | Run 17 | Run 18 | Why |
| --- | --- | --- | --- |
| With a percentage | 21 | **22** | `loot` now shows 64%: its method was changed to `structured_data` and its page gives a figure that way |
| Judged ended | 8 | **0** | The eight stores that were wrongly judged ended in run 17 (`evetech`, `faithful-to-nature` and `faithful-to-nature-grocery-liquor`, `gelmar`, `house-home-lewis-group`, `mr-price`, `spar`, `the-body-shop-sa`) are all `ok` and active again (Story 3.10's rules): seven show "On sale" with no figure, and `spar` is a valid page with no figure |
| Errors | 1 | **0** | `benji-moon` answers: its address now ends in a slash (Story 4.3) |
| Visible stores | 57 | **58** | Crocs SA was added (Story 4.3); it answered the Worker (`ok`) and shows "On sale" with no figure |
| "On sale" only | 22 | 31 | The eight stores above that came back, and Crocs SA, are "On sale" without a figure; `loot` moved up to a percentage |
| Blocked | 2 | 2 | `beauty-on-tapp` and `norman-goodfellows` (HTTP 429), as before |

So **the number of stores with a figure did not grow much (21 to 22): what grew is the "On sale only" group**, because eight good stores are no longer wrongly hidden. Those 31 are the candidates for Story 5.1: the 17 JavaScript pages and the 13 pages that answered but could not be judged (the reason for each is in the Workers Logs, not in the database), plus `spar`. Which of them a browser can read is what Story 5.1 finds out.

## Summary

| What | Stores |
| --- | --- |
| With a percentage | 22 |
| "On sale" only (no percentage) | 31 |
| &nbsp;&nbsp;of which: valid page with no figure / JavaScript page / page could not be judged | 1 / 17 / 13 |
| Judged ended | 0 |
| Blocked | 2 |
| Not found | 0 |
| Redirected away | 0 |
| Errors | 0 |
| Never checked successfully | 0 |
| Manual (never fetched) | 3 |
| **Visible stores** | **58** |
| Hidden stores | 49 |

## Stores that need manual handling

| Store | Group | Reason |
| --- | --- | --- |
| SPAR (spar) | "On sale" only (no percentage) | valid page, no figure found (method html) |
| Beauty On Tapp (beauty-on-tapp) | Blocked | blocked: http_429 |
| Norman Goodfellows (norman-goodfellows) | Blocked | blocked: http_429 |
| Amazon.co.za (amazon-co-za) | Manual (never fetched) | manual method, no override yet |
| Checkers / Sixty60 (checkers-sixty60) | Manual (never fetched) | manual method, no override yet |
| Game (Massmart) (game-massmart) | Manual (never fetched) | manual method, no override yet |

## Stores shown as "On sale" with no percentage

| Store | Method | Why no figure |
| --- | --- | --- |
| Absolute Pets (absolute-pets) | html | page could not be judged, address only |
| Benji + Moon (benji-moon) | shopify_json | page could not be judged, address only |
| Bob Shop (bob-shop) | html | JavaScript page, address only |
| Cape Union Mart / K-Way (cape-union-mart-k-way) | html | JavaScript page, address only |
| Cashbuild (cashbuild) | html | JavaScript page, address only |
| Clicks (clicks) | html | JavaScript page, address only |
| Crocs SA (crocs-sa) | shopify_json | page could not be judged, address only |
| DreamWare Tech (dreamware-tech) | html | page could not be judged, address only |
| ePETstore (epetstore) | html | page could not be judged, address only |
| Evetech (evetech) | html | page could not be judged, address only |
| Faithful to Nature (faithful-to-nature) | html | page could not be judged, address only |
| Faithful to Nature (faithful-to-nature-grocery-liquor) | html | page could not be judged, address only |
| Food Lover's Market (food-lovers-market) | html | JavaScript page, address only |
| Gelmar (gelmar) | html | page could not be judged, address only |
| @home (shop on Bash) (home-shop-on-bash) | html | JavaScript page, address only |
| House & Home (Lewis Group) (house-home-lewis-group) | html | page could not be judged, address only |
| Liquor City (liquor-city) | html | JavaScript page, address only |
| Mr Price (mr-price) | html | page could not be judged, address only |
| Pick n Pay (pick-n-pay) | html | JavaScript page, address only |
| Samsung SA (samsung-sa) | html | JavaScript page, address only |
| SHEIN SA (shein-sa) | html | JavaScript page, address only |
| SPAR (spar) | html | valid page, no figure |
| Superbalist (superbalist) | html | JavaScript page, address only |
| Superbalist (superbalist-fashion-apparel) | html | JavaScript page, address only |
| Takealot (takealot) | html | JavaScript page, address only |
| Temu (SA storefront) (temu-sa-storefront) | html | JavaScript page, address only |
| The Body Shop SA (the-body-shop-sa) | html | page could not be judged, address only |
| Under Armour SA (under-armour-sa) | html | page could not be judged, address only |
| Woolworths (all depts) (woolworths-all-depts) | html | JavaScript page, address only |
| Woolworths (fashion) (woolworths-fashion) | html | JavaScript page, address only |
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
