# Frontend Architecture

## Component Organization

```text
apps/web/src/
├── layouts/BaseLayout.astro        # head, SEO tags, skip link, header, footer
├── pages/
│   ├── index.astro                 # home
│   ├── about.astro  privacy.astro  contact.ts   # /contact redirects to /about#our-bot
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

**Built in Story 2.4 (2026-10-30):** the page cache, the search engine basics, the security headers and the smoke test. `src/middleware.ts` serves the home page (`/` only) from the Cache API through `lib/cache.ts` (`cachedPage`): only `GET`; the key is the address **without the visitor's query string plus the build's name** (`__BUILD_ID__`, set when the site is built), so a visitor cannot make a new database query by changing the query string and a deploy never serves the previous build's cached HTML (that HTML points at the previous build's hashed stylesheet, which no longer exists: an unstyled page); a 200 whose `Cache-Control` says `public, max-age=600` is stored (the edge keeps it for 10 minutes, but the browser is told `public, max-age=0, must-revalidate`, so a browser never keeps the HTML of a previous build), the empty page and the 503 say `no-store` and are never stored; every response carries `x-cache: HIT|MISS|BYPASS` (there is no per-view log line); a failing cache is never the visitor's problem; HEAD requests are not cached. `lib/headers.ts` adds the headers on the way out and never into the cache: `X-Robots-Tag: noindex, nofollow` while `ALLOW_INDEXING` is not `"true"`, and in a production build the Content-Security-Policy of the architecture, `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`. `lib/seo.ts`, `pages/robots.txt.ts` and `pages/sitemap.xml.ts`: the canonical address, `robots.txt` (`Disallow: /` while indexing is off, else `Allow: /` and the sitemap line) and the sitemap (the home page; Story 2.5 adds its pages); the layout writes the title, description, canonical, Open Graph and Twitter tags, `lang="en-ZA"`, an inline text-only favicon and, while indexing is off, `<meta name="robots" content="noindex, nofollow">`. `SITE_URL` and `ALLOW_INDEXING` are `vars` in `wrangler.jsonc` (default `"false"`: turning indexing on is an edit and a deploy, a step of the launch checklist; the `<meta name="robots">` of a cached page can stay up to 10 minutes old after that deploy, the headers and `robots.txt` change at once). After a deploy the cache of the previous build is simply not read. The smoke test is `tests/smoke.spec.ts` (Playwright and axe, `pnpm test:smoke`), against the built site started with `astro preview` on its own local database (`.wrangler/smoke`, made from `tests/smoke-fixture.sql`); Vitest runs only `tests/**/*.test.ts` (`vitest.config.ts`). The web app's `types` scripts use `--strict-vars=false`, so the two settings are typed `string`. There is no CI yet: Story 4.4 runs the smoke test before its deploy step.

**Built in Story 2.5 (2026-10-30):** the layout, the legal pages, the click counter and the ad slots. `BaseLayout.astro` now has a skip link ("Skip to content", the first focusable element, targeting `<main id="main" tabindex="-1">` of every page), `Header.astro` (the wordmark and two links, Categories and How it works; not sticky, no menu button) and `Footer.astro` (two links, About and Privacy, the disclaimer and the year; the footer ad slot above them). `pages/about.astro` ("How Saleaway works", with an "Our bot" part that names the bot's user-agent, says it makes a few requests a day at most and obeys `robots.txt`) and `pages/privacy.astro` (no accounts, no cookies, no personal information kept; the visit count is described only while an analytics token is set, and the ads paragraph follows `ADS_ENABLED`) make no database query. There is no Contact page: `pages/contact.ts` answers a 302 to `/about#our-bot` because the bot's user-agent carries `/contact`. The middleware's cached paths are `/`, `/about` and `/privacy` (`CACHED_PATHS`), and the sitemap lists the same three. `POST /api/click` (`pages/api/click.ts`, logic in `lib/clickHandler.ts`) counts a click-out per store per day in `click_counts` (migration `0003_click_counts.sql`, one upsert, `recordClick` in `lib/db.ts`): body a store slug of at most 100 bytes (413), `Origin` of another site refused (403), a slug that does not parse is a 400, an unknown store a 404, success a 204, a database failure a 503 with one `click_failed` log line holding only the slug and the error; every answer is `no-store` and sets no cookie; nothing about the visitor (address, user-agent, referrer, cookie) is read or stored. `CLICK_SAMPLE_RATE` (a var, default `"1"`) counts a share of clicks and adds `round(1 / rate)` to each counted one, so a total stays an estimate. `scripts/site.ts` (the click beacon, `navigator.sendBeacon` on `click` and `auxclick` of `a[data-store]`) is **one separate same-origin file**: `vite.build.assetsInlineLimit` is `0` in `astro.config.mjs` because Astro otherwise puts a script this small into the page and the CSP (`script-src 'self'`) blocks an inline script. The Cloudflare Web Analytics tag (`https://static.cloudflareinsights.com/beacon.min.js`, `defer`, `data-cf-beacon`) is added only when `CF_WEB_ANALYTICS_TOKEN` (a var, empty by default) is a plain token (`lib/analytics.ts`); Story 4.4 confirms it on the real domain. `AdSlot.astro` draws a dashed "Advertisement" frame that reserves its height (top 90px from 640px up, a 250px cell after the third category card, footer 60px or 90px) and **renders nothing and keeps no space** unless `ADS_ENABLED` is exactly `"true"` (default `"false"`); the frames are empty until an ad network is chosen (its snippet and hosts, the CSP and the Privacy page come with that step). A Lighthouse mobile run with the slots on has a layout shift of 0. Each slot is a landmark with its own name ("Advertisement, top of the page" and so on). **Accessibility (found in QA review of Story 2.5):** a store row's rank number and chevron are generated content (`::before` and `::after` with no spoken text), the parts of the link are separated by real spaces, and its accessible name follows the order the row is drawn in (name, checked, figure), so the name holds the visible text (WCAG 2.5.3, Label in Name); the smoke test uses the WCAG 2.0, 2.1 and 2.2 tags including the Level A 2.1 set and turns on axe's Label in Name rule.

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
/contact          redirect to /about#our-bot
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
