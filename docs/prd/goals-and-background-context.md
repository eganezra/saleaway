# Goals and Background Context

## Goals

- Show every current sale from South African online stores on one fast, mobile-friendly website.
- Refresh the data automatically every day, so visitors always see the latest sales without manual curation.
- Show how deep each store's discount goes (for example "Up to 50% off"), and link straight to the store's own sale page.
- Be live on saleaway.online in 3 days (by 31 October 2026), ahead of Black Friday on 27 November 2026.
- Grow search and direct traffic, so ad revenue can follow and affiliate links and featured placement can come later.
- Make adding a store a one-row change, with no code release.

## Background Context

South African shoppers who want a bargain have to check many retailer sites one by one, and sales start and end without notice. Saleaway automates the discovery: a daily job fetches each store's known sale page, checks it is a real sale, works out the headline discount, and saves a small fact record. The site reads from that database and shows one card per store.

A spreadsheet of 106 SA stores (`docs/data/`) provides primary sale URLs for 92 of them (94 if two stores that only have a Black Friday page are counted), and an initial fetch test (`docs/fetch-spike.md`) showed three stores (Amazon.co.za, Game, Checkers) blocking requests, and guessed sale paths failing often. The MVP therefore stores only facts (discount level, sale URL, last checked), seeds hand-picked sale URLs, falls back to "On sale" when a discount can't be read, and supports manual overrides.

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-10-28 | 0.1 | First PRD draft from project brief (YOLO mode) | John (PM) |
| 2026-10-28 | 0.2 | PM checklist run and results added | John (PM) |
| 2026-10-28 | 0.3 | Discount-first ordering (FR14), "Biggest discounts today" card (FR23, Story 3.7) | John (PM) |
| 2026-10-29 | 0.4 | PO validation: freshness anchor and override precedence moved into Story 2.3, human prerequisites and launch-critical set added, Stories 3.8 and 4.5 added, test tooling and CPU measurement made explicit | Sarah (PO) |
| 2026-10-29 | 0.5 | Local-first build order: Story 1.1 runs locally, Story 1.2 is now a first deploy to workers.dev, CI/CD and domain moved to new Story 4.4, launch checklist is 4.5, alert and retention is 4.6 | Sarah (PO) |
