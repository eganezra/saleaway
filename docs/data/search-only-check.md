# Check of the 21 search-only sale addresses and Crocs SA (Story 4.3)

On 2026-10-31 the operator said "you make a call" about the browser check, so the Dev settled each store **on the evidence of the real runs** (the pipeline's run 17 and the URL check made from the operator's computer, `url-check.md`). **No one has looked at these pages in a browser**: that is a limit of this record, and the last section lists what is still worth a person's eyes.

## Decided on the evidence (11 stores moved off "Found via search")

| Store | Now | Evidence |
| --- | --- | --- |
| Bash (TFG), both listings | Verified – products visible | 80% read from the page by run 17 |
| Makro and Makro (food & liquor) | Verified – products visible | 70% read from the page by run 17 |
| Mr Price Home | Verified – products visible | 20% read from the page by run 17 |
| Sportscene (on Bash) | Verified – products visible | 54% read from the page by run 17 |
| Totalsports (on Bash) | Verified – products visible | 55% read from the page by run 17 |
| Pick n Pay | Verified – page loads (products load via JS) | answers (200); the Worker saw a JavaScript page, nothing read; the seed already said "JS-only" |
| Woolworths (fashion) | Verified – page loads (products load via JS) | answers (200); the Worker saw a JavaScript page, nothing read |
| Liquor City | Verified – page loads (products load via JS) | answers (200); a 1 KB page, a JavaScript page; the seed already said "JS-only" |
| Mr Price | Verified – page loads (products load via JS) | answers (200); the seed says it renders empty without JS; run 17's "ended" verdict was a false one (Story 3.10), run 18 gives the new one |

The first seven have the strongest proof: a discount figure was read from the page itself. The last four only show that the address answers and what kind of page it is; whether it shows a sale is not proven.

## Other changes made from the same evidence

- **Benji + Moon:** its address now ends in a slash (`https://benjiandmoon.co.za/products/sale/`). The old address redirected to plain `http`, which the bot refuses; the new one answers 200 from the operator's computer (a short `--only` look, 2026-10-31). Status unchanged.
- **Crocs SA (new):** added with the address the operator gave (`https://crocssa.co.za/collections/sale-footwear-1`), category Fashion & apparel, ranked 11th, platform "Shopify /collections/" (so the seed gives it the `shopify_json` method), status "Verified – products visible". It answers 200 from the operator's computer; its products were not looked at. It is visible, so tonight's run fetches it. If the Worker is throttled like most Shopify stores, it will show as blocked and go stale after 72 hours; the next coverage report says.
- **No store was hidden** in this story: every visible store's address answers, so no address "cannot be fixed" (AC4). The 14 stores with no address (including `builders` and `cielo`) were already hidden by the seed.

## Still worth a person's eyes (not done)

| Store | Why it was not settled |
| --- | --- |
| Amazon.co.za (`amazon-co-za`), Game (`game-massmart`) | Manual stores: the bot never reads them and they still need **overrides** (a percentage and an expiry). Opening each page to read the percentage settles the address too. Both answer 200 from the operator's computer. |
| Norman Goodfellows (`norman-goodfellows`) | Blocks both networks (429), and its address is a hub page. Only a look says if it is a sale page. It stays visible; it will go stale and hide itself after 72 hours without a record. |
| Hifi Corp, Incredible, Outdoor Warehouse, Sportsmans Warehouse | Hidden because the Worker was blocked; **they answer from the operator's computer** (200). Left as "Found via search" for Story 5.4, which would bring them back and re-check them then. |
| Pet Heaven, Truworths | Hidden, and blocked from the operator's computer too (403). Left as "Found via search". |
| Builders, Cielo | No standing sale page was found (only a Black Friday page). A year-round "sale" or "clearance" page address would let them be shown. |

## Seen by the check, nothing done

- **Blocked from the operator's computer, left as they are** (bot protection, not dead pages): `faithful-to-nature` (two listings, 403; they answered the Worker), `checkers-sixty60` (403, a manual store).
- **Black Friday pages with a problem:** `family-pet-centre` (404, a hidden store), `woolworths-fashion` (redirects to another page), `bradlows` (timed out), `clicks` (its title says 2025). They stay unverified, like all 68.
