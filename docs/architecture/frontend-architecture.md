# Frontend Architecture

## Component Organization

```text
apps/web/src/
├── layouts/BaseLayout.astro        # head, SEO tags, skip link, header, footer
├── pages/
│   ├── index.astro                 # home
│   ├── about.astro  privacy.astro  contact.astro
│   ├── health.ts                   # GET /health
│   └── api/click.ts                # POST /api/click
├── components/
│   ├── Header.astro  Footer.astro  StatusStrip.astro
│   ├── CategoryChips.astro
│   ├── CategoryCard.astro          # standard and sticker variants
│   ├── StoreRow.astro  DiscountPill.astro
│   ├── BiggestDiscountsCard.astro
│   ├── BlackFridayLink.astro       # stretch, FR16
│   └── AdSlot.astro
├── lib/
│   ├── db.ts                       # D1 queries, returns plain rows
│   ├── homeViewModel.ts            # builds the page data using packages/core
│   └── cache.ts                    # Cache API helper
└── styles/
    ├── tokens.css                  # colours, spacing, type scale from the spec
    └── global.css
```

**Built in Story 2.1 (2026-10-30):** the store row. `lib/storeRow.ts` (`toRowData`, pure: the figure, the pill tier, the "Checked" words and the link's accessible name), `components/DiscountPill.astro`, a changed `StoreRow.astro` (one link: name, a "Checked" line, the pill, a chevron; text only) and `pages/index.astro` (the grid has 1 column below 640px, then 2, 3 and 4 from 640, 1024 and 1440px; a row whose name would get less than 7rem lets its pill drop to its own line, as on a 320px phone). The pill shows a whole number from 1 to 99 (an extracted percentage is 5 to 90, an override's is 1 to 99), pink from 50 and yellow below, else a dashed "On sale". The "Checked" words use rolling 24 hour periods since `StoreView.checkedAt`: "Checked today" under 24 hours, "Checked N days ago" after, "Not checked yet" when the store was never checked. `--color-subtle` (`#6b6b6b`) is a new token. No web font, no rank number and no category cards yet (Story 2.2). `homeViewModel.ts` now returns the rows.

**Built in Story 2.2 (2026-10-30):** the category sections. `rankStores` in `packages/core/src/rank.ts` (FR14: the biggest percentage first, then "On sale" stores by `retailers.rank`, ties by rank, stable; the pure rule); in `apps/web`, the home query also selects the category's slug, name, tagline and colour token and the store's `rank` (same tables, no extra rows read), `lib/categories.ts` (`buildCategories`: groups the visible stores by category in `sort_order`, ranks each by the figure its row shows, numbers the rows; `ROWS_SHOWN` is 8), `CategoryCard.astro` (header with the name, a count badge, the tagline and a colour tab; the first 8 rows; a native `<details>` "Show all N" for the rest, no JavaScript, every row in the HTML), `CategoryChips.astro` (the anchor menu: a link per category that has stores; below 640px it scrolls sideways and sticks to the top, and `html` gets `scroll-padding-top` so a jump or a keyboard focus clears it) and a flat `StoreRow.astro` (a rank number, a line between rows, 48px high). `HomeViewModel.ok` now holds `categories`. The cards are a plain grid (not a masonry) with as many columns as fit, none narrower than 21rem: 1 on a phone, 2 on a tablet, 3 on a desktop and never 4, because a row's rank, name, "Checked" label and pill need about 290px inside the card and four cards in the 1280px content would be about 250px each. A category with no visible store is not drawn. The tab colour is `--cat-default` for every category (the seed gives all ten `cat-default`; a class of the same name carries it). Not built: the active-chip highlight (needs a script), the "Biggest discounts today" card, the status strip, header, footer, skip link and ad slots.

## Component Template

```astro
---
// components/DiscountPill.astro
interface Props { percent: number | null }
const { percent } = Astro.props;
const tier = percent === null ? 'plain' : percent >= 50 ? 'hot' : 'warm';
---
<span class={`pill pill--${tier}`}>
  {percent === null ? 'On sale' : <><small>Up to</small> {percent}% off</>}
</span>
<style>
  .pill { border: 2px solid var(--ink); padding: 4px 10px; font: 700 18px/1 var(--font-heading); }
  .pill--hot { background: var(--pink); }
  .pill--warm { background: var(--yellow); }
  .pill--plain { background: #fff; border-style: dashed; }
</style>
```

## State Management Architecture

There is no client state store. Pages are rendered on the server from one view model. One small same-origin script file (not inlined, so the CSP stays strict) handles interaction.

```typescript
export interface HomeViewModel {
  updatedAt: string;                 // newest last_validated_at, for the status strip
  storesOnSaleCount: number;
  biggestDiscounts: StoreRowData[];  // empty when fewer than 3 known percentages
  categories: Array<{
    slug: string; name: string; tagline: string; colorToken: string;
    onSaleCount: number; rows: StoreRowData[];   // already ordered (FR14)
  }>;
}
```

**State Management Patterns**

- Server renders everything. All rows are in the HTML, so the page works without JavaScript.
- "Show all" is a native `<details>` element.
- The status strip dismissal is saved in `localStorage` inside try/catch, and the page works if storage is blocked.
- The active category chip uses an `IntersectionObserver`.

## Routing Architecture

```text
/                 home (SSR, cached)
/about            static
/privacy          static
/contact          static
/health           canary
/api/click        POST beacon
/sitemap.xml      generated from the fixed page list
/robots.txt       static
```

**Protected routes:** none in the web Worker. Operator functions are not exposed there.

## Frontend Services Layer

There is no client API layer. The only client call is the click beacon.

```typescript
// apps/web/src/scripts/site.ts, bundled to one same-origin file
document.addEventListener('click', (e) => {
  const a = (e.target as Element).closest<HTMLAnchorElement>('a[data-store]');
  if (!a) return;
  try { navigator.sendBeacon('/api/click', a.dataset.store!); } catch { /* ignore */ }
});
```
