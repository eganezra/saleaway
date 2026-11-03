# Browser-read spike (Story 5.1)

The three stores of the spike were read by Cloudflare's browser in the nightly runs 19 (2026-11-02) and 20 (2026-11-03). Source: the `retailer_results` and `sale_records` tables and the Workers Logs of the pipeline (`page_rendered`, `page_validated`).

| Store | Run | Render | Time | Page size | Validator | Prices / "was" prices / % labels | Visible text (characters) | Percentage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| takealot | 19 | ok, 200 | 27,558 ms | 750,219 B | unverifiable, unreadable | 0 / 0 / 0 | 1,848 | none |
| takealot | 20 | ok, 200 | 12,738 ms | 660,509 B | unverifiable, javascript_shell | 0 / 0 / 0 | 1,231 | none |
| woolworths-all-depts | 19 | ok, 200 | 23,591 ms | 1,695,505 B | unverifiable, javascript_shell | 0 / 0 / 0 | 3,909 | none |
| woolworths-all-depts | 20 | ok, 200 | 17,873 ms | 1,692,363 B | unverifiable, javascript_shell | 0 / 0 / 0 | 3,909 | none |
| superbalist | 19 | rate_limited (no browser started) | 32 ms | n/a | n/a | n/a | n/a | none |
| superbalist | 20 | ok, 200 | 4,521 ms | 446,599 B | unverifiable, discounts_not_readable | 4 / 0 / 0 | 11,441 | none |

- **Gate: not passed.** No page was judged `valid`, no percentage was read. Stores moved from "On sale" to a percentage: **0**. All three stay "On sale" and are back on `fetch_mode = 'plain'`.
- **Confirmed:** the user-agent seen by the store is `SaleawayBot/1.0 (+https://saleaway.online/contact)`; browser time was about 51 s (run 19) and 35 s (run 20) of the 480 s budget; no `robots.txt` stop and no 403 or 429 from a store.
- **Not known:** whether the pages held products, a bot check or an unfinished app (the logs hold counts, not the page). Woolworths' visible text was identical on both days.
- **`rate_limited` in run 19:** Takealot's browser closed at 03:01:05 and Superbalist launched 8.5 s later; in run 20 the gaps were 21 s and 20 s and both launched.

Why no store was switched on and what could be tried later (log the page's title and first text; wait between renders from the previous close; a store feed instead of a page) are in the Dev Agent Record of `docs/stories/5.1.story.md`.
