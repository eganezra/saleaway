# Epic 2 Public Site

**Goal:** Turn the first live page into the real Saleaway home page: organised, trustworthy and ready to attract search traffic and ads. Visitors find sales quickly and the site is ready for Black Friday.

_UX note (2026-10-28, from `docs/front-end-spec.md`): in the design, a "card" is one **category card** that contains a **row per store**. Where the stories below say "store card", read "store row inside a category card". Decided with the user the same day: stores are ordered biggest discount first within a category (Story 2.2), and a "Biggest discounts today" sticker card is added (Story 3.7, because it needs extracted percentages)._

## Story 2.1 Store Row Design

As a bargain hunter,
I want each store row to show how deep the discount is and how fresh it is,
so that I can decide which sale to visit.

### Acceptance Criteria

1. A store row shows the store name, a bold "Up to X% off" when a percentage is known, or "On sale" when not (FR13).
2. A row shows "Checked today" or "Checked N days ago" (FR15).
3. Rows and cards are text-only. No retailer images, logos or product content (NFR7).
4. Rows meet WCAG AA contrast, are keyboard-focusable, and have a clear tap target of at least 44px (NFR9).
5. Layout is a single column on small phones and a grid on larger screens.

## Story 2.2 Category Sections

As a bargain hunter,
I want stores grouped by category,
so that I can jump to the type of shop I care about.

### Acceptance Criteria

1. The home page shows one section per category (marketplaces, fashion, sport, tech, home, DIY, beauty and health, grocery and liquor, baby, kids and toys, pets) (FR14).
2. Within a section, stores are ordered by biggest known discount first, then "On sale" stores by rank, with ties broken by rank (FR14). Before extraction exists (Epic 3), every store is "On sale", so the order falls back to rank.
3. A simple anchor menu at the top jumps to each section.
4. Categories with no visible stores are not shown.

## Story 2.3 Visibility, Staleness and Override Rules

As a bargain hunter,
I want only current sales shown,
so that I don't click through to ended sales.

### Acceptance Criteria

1. Stores flagged hidden are not shown.
2. A store is not shown when it was last validated more than 72 hours ago (FR10, FR15, NFR3). A store that has never been validated is measured from the time it was added, and an active override counts as a fresh check. Without this, the site would be empty until the first pipeline run (Epic 3).
3. Records marked ended are not shown.
4. Override precedence is built here, so every later story can rely on it: an active override's percentage replaces the extracted one, its hide flag hides the store, its sale URL replaces the stored one, and an expired override is ignored (FR12).
5. A unit test covers each rule, including a never-validated store and an expired override.

## Story 2.4 SEO and Performance

As the operator,
I want search engines to index Saleaway and the site to load fast,
so that traffic can grow.

### Acceptance Criteria

1. Titles, meta descriptions, Open Graph tags and a canonical URL are set (FR17).
2. `sitemap.xml` and `robots.txt` are served.
3. The home page is server-rendered or static and cached at the edge, so content is present without JavaScript.
4. A Lighthouse mobile run scores 90 or better for performance, accessibility and SEO, or the gaps are documented (NFR2).
5. The caching code is in place, with a unit test. Whether the cache works on the real domain is confirmed in Story 4.4, because caching may not apply on temporary `workers.dev` addresses.
6. A Playwright smoke test with an automated accessibility check (axe) runs in CI and finds no violations on the home page (NFR9).

## Story 2.5 Ad Slots, Analytics and Legal Pages

As the operator,
I want ad slots, simple analytics and legal pages,
so that the site is ready to earn and to be trusted.

### Acceptance Criteria

1. The layout includes clearly marked ad slots (top, between categories, footer) that render nothing until switched on by a configuration flag (FR18).
2. Cookie-free analytics counts visits and click-outs per store (FR19, NFR8). The Web Analytics part is confirmed after the domain is connected (Story 4.4).
3. About / How it works, Privacy and Contact pages exist. The Contact page explains how a retailer can request removal (FR20).
4. A footer links to all three pages.
5. The layout does not shift when ad slots turn on (no large layout jump).

## Story 2.6 Black Friday Badge (Stretch)

As a bargain hunter,
I want to see which stores already have a Black Friday page,
so that I can check those early.

### Acceptance Criteria

1. Cards for stores with a Black Friday URL show a "Black Friday" link next to the sale link (FR16).
2. Black Friday URLs are only shown after the operator has verified them, because some still show 2025 content.
3. A configuration flag turns the badge off completely.
