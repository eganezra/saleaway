# Project Brief: Saleaway

_Created by the Analyst agent in YOLO mode from `docs/idea.md` and the answers given on 2026-10-28. Items marked **[Assumption]** were decided by the analyst and need your confirmation._

## Executive Summary

Saleaway (saleaway.online) is a website that automatically finds sales at South African online stores and shows them all in one place. Once a day a scheduled job checks each store for a sale page, verifies it is a real active sale, works out how deep the discounts go, and saves a clean record to a database. Visitors browse a list of store cards such as "Crocs SA: Up to 50% off" and click through to the store's own sale page.

- **Problem:** South African bargain hunters have to visit many retailer sites one by one to find out who is running a sale.
- **Target market:** South African bargain hunters.
- **Value proposition:** every current sale from the biggest SA stores on one page, always up to date, with no manual curation.
- **Business model:** ads first, as a high-traffic site. Affiliate links and featured retailer placement come later.

## Problem Statement

**Current state.** Sales at SA retailers are announced through each store's own site, email and social media. A shopper who wants the best deal has to check /sale or /specials on many sites, and sales start and end without notice.

**Impact.** Shoppers waste time or miss sales. Retailers' sale pages are scattered and formatted differently, so they can't be compared quickly.

**Why existing solutions fall short.** _Not yet researched._ The working hypothesis is that SA price-comparison and deal sites depend on manual curation, retailer feeds or affiliate data, while Saleaway discovers sale pages automatically. This needs a quick competitor check before it is used in marketing.

**Urgency.** The Black Friday period (Friday 27 November 2026) is the biggest SA sale event of the year and a natural traffic peak. **[Assumption]** The 3-day launch target is aimed at being live before it. Please confirm.

## Proposed Solution

**Core concept.** A daily pipeline (see `docs/architecture-diagram.jpg`):

1. **Cron job** runs every 24 hours.
2. **Fetch sale pages.** For each store in the Retailers table, request its known sale URL (seeded from `docs/data/`). Probing common paths such as `/sale`, `/outlet` and `/specials` is only a fallback for new stores with no known URL, because the 2026-10-28 fetch test showed guessed paths are unreliable (see `docs/fetch-spike.md`).
3. **Validate pages.** Check that the page is a real, active sale with discounted products (for example visible was/now prices or discount percentages), not an error page, redirect to the home page, or empty category.
4. **Extract and beautify.** Work out the headline discount (for example "Up to 50% off") and save a clean, consistent record to the Sale pages table. If the discount can't be extracted, the card says "On sale" and still links to the sale page.
5. **Saleaway.co.za** reads from the database. Sales that are no longer found or validated are removed on the next cycle.

**Visitor experience.** A list of store cards, each showing the store and how deep its discounts go (for example "Crocs SA: Up to 50% off"). Clicking a card goes to the store's own sale page.

**Key differentiators.** Fully automated discovery, a consistent clean layout across all stores, and no retailer integration needed.

**Copyright approach (decided 2026-10-28).** Copying retailers' product listings (images, descriptions, layouts) carries copyright and terms-of-service risk, so the MVP does not reproduce them. Saleaway stores only facts: store name, sale page URL, the deepest discount found, and when it was last checked. Cards link out to the retailer's own sale page. This replaces the diagram's "Web PDF" snapshot. Showing product-level listings is a Phase 2 option, through affiliate feeds or retailer partnerships.

**Extensibility.** Retailers live in the Retailers table, so adding a store means adding a row (domain, name, category, known sale URL, optional extraction method), with no code change.

**Retailer data (added 2026-10-28).** A spreadsheet of 106 SA online stores across 10 categories is saved at `docs/data/SA_Top_Online_Stores_Sale_Pages.xlsx`, with the main sheet also as `docs/data/retailers-seed.tsv`. Sale or campaign URLs were found for 94 stores, of which 92 have a primary sale URL and 2 (Cielo, Builders) only a Black Friday campaign URL. In 54 of them the sale page was opened and discounted products were visible. In 19 the page loads but products render with JavaScript. 21 URLs came from search only and are not fetched. The other 12 stores have no online sale page. Ranks are approximate. The 21 search-only URLs need a manual browser check, and some Black Friday URLs still show 2025 copy.

## Target Users

### Primary User Segment: South African bargain hunters

- **Profile:** South African online shoppers, mostly on mobile, who actively look for discounts across categories.
- **Current behaviour:** visit several retailer sites, follow store newsletters and social pages, search "[store] sale".
- **Needs and pain points:** a quick way to see who has a sale right now, and to jump straight to the product.
- **Goals:** save money, and not miss a sale.

## Goals & Success Metrics

### Business Objectives

- Launch a working MVP publicly within 3 days (target date 31 October 2026).
- Launch with all 92 stores that have a primary sale URL (plus Crocs SA, which is not in the spreadsheet), refreshed daily, and make adding more a one-row change.
- Build organic and search traffic, since traffic is the core asset for ad revenue. **[Assumption]** The initial target is 1,000 unique visitors in the first 30 days, to be confirmed.

### User Success Metrics

- A visitor can go from landing page to a retailer's product page in 3 clicks or fewer.
- Pages load in under 2 seconds on a mobile connection.

### Key Performance Indicators (KPIs)

- **Active sales listed:** number of stores with a validated sale page. Target: most of the launch stores at any given time.
- **Discount coverage:** share of listed stores showing a real "Up to X% off" instead of "On sale". Target: grows over time, starting with the stores whose pages are easiest to read.
- **Pipeline success rate:** share of daily runs that complete without errors. Target: 95% or higher.
- **Data freshness:** age of the oldest sale record shown. Target: under 24 hours.
- **Unique visitors and click-outs per day:** traffic and the number of clicks to retailers.

## MVP Scope

### Core Features (Must Have)

- **Retailers table:** seeded from the spreadsheet (92 stores with primary sale URLs, plus Crocs SA), with category, platform, sale URL, Black Friday URL and status. Adding a retailer is a new row, not a code change.
- **Daily cron job:** runs the pipeline once every 24 hours. With about 95 stores the work needs splitting into several smaller jobs or a queue to stay inside free-tier limits.
- **Fetching with timeouts and polite request rates:** use each store's known sale URL. Path probing is only a fallback for new stores.
- **Manual override:** a way to set a store's discount or hide a store by hand, for blocked stores and stores with a broken URL.
- **Page validation:** rule-based checks for real discounted products.
- **Discount extraction:** read the sale page and work out the headline discount, shown as "Up to X% off" (the deepest discount found, from was/now prices or discount labels).
- **Public website:** home page listing a card per store with an active sale, showing store name and "Up to X% off", with a click-out link to the retailer's sale page.
- **Expiry:** sale records that fail validation or disappear are removed or hidden on the next run.
- **Mobile-friendly design and basic SEO:** titles, descriptions and a sitemap.
- **Ad slots:** placeholders in the layout, with ad code added once an ad network approves the site.

### Out of Scope for MVP

- Affiliate links and featured retailer placement.
- User accounts, alerts, wishlists and email or WhatsApp notifications.
- Search and filtering by category or price (beyond a simple store list).
- Retailer self-service portal.
- Price history and trend tracking.
- Reproducing retailer product listings (images, descriptions, page layouts) on Saleaway.
- An admin UI (retailers are managed through the database for now).

### MVP Success Criteria

The site is live on saleaway.online. At least one full automated daily cycle has run successfully across the seeded retailers. The home page lists current sales, each with its deepest discount where it could be extracted and "On sale" where not. Visitors can click a card and land on the retailer's real sale page.

## Post-MVP Vision

### Phase 2 Features

Affiliate links, search and category filters, more retailers (50 or more), an admin dashboard, and email or push alerts for new sales.

### Long-term Vision

The default place South Africans check before buying online. It would be a large, search-driven traffic site with several revenue streams: ads, affiliate links and paid featured placement.

### Expansion Opportunities

Price history, deal-of-the-day features, a Black Friday landing hub, and other African markets.

## Technical Considerations

### Platform Requirements

- **Target Platforms:** responsive web, mobile-first.
- **Browser/OS Support:** current versions of Chrome, Safari, Firefox and Edge.
- **Performance Requirements:** fast mobile loads, with pages served from cache or edge.

### Technology Preferences

- **Frontend:** Next.js, as you suggested. **[Assumption]** It deploys to Cloudflare Workers through the OpenNext Cloudflare adapter. A simpler, more SEO-friendly option such as Astro is worth considering. The Architect should decide.
- **Backend:** Cloudflare Workers, with Cron Triggers for the daily job.
- **Database:** "MySQL lite" is read as **SQLite**. Cloudflare D1 is SQLite-compatible and fits the free tier, so yes, it works.
- **Hosting/Infrastructure:** Cloudflare free tier (Workers, D1, and R2 only if files are needed, such as store logos). Cloudflare Browser Rendering, for reading JavaScript-heavy pages, has a limited free allowance.

### Architecture Considerations

- **Repository Structure:** single repository (monorepo) with the web app and the cron or worker code.
- **Service Architecture:** serverless. Workers cron fetches and validates the pages, D1 stores the data and R2 stores any files.
- **Integration Requirements:** none with the retailers beyond fetching their public pages. An ad network is needed later.
- **Security/Compliance:** respect each site's robots.txt and rate limits, with a clear user-agent. Link out to retailers and don't copy more than needed. Handle South African data protection (POPIA) when analytics or ads add cookies.

## Constraints & Assumptions

### Constraints

- **Budget:** none (free tiers only).
- **Timeline:** 3 days to launch.
- **Resources:** one person, with AI agents helping.
- **Technical:** Cloudflare free-tier limits apply. These include a small number of outbound requests per Worker invocation, limited CPU time per request, a small number of cron triggers, and a limited Browser Rendering allowance. Fetching about 95 stores a day may need the work split into several smaller jobs or queued.

### Key Assumptions

- Most stores can be fetched by a Cloudflare Worker without being blocked. The home-connection test already showed Amazon.co.za, Game and Checkers blocking requests, so some will need manual values.
- Product price and link data can be extracted reliably enough from many pages, but not all. Cards fall back to "On sale".
- Ad networks will approve the site after launch.
- **Launch retailers (decided 2026-10-28):** all 92 stores with a primary sale URL in the spreadsheet (this includes the original 10 top stores plus Under Armour SA and Wellness Warehouse), plus Crocs SA, whose sale URL still needs to be found. Stores with no sale page (12) are kept in the table but not shown. Temu's SA storefront is in the spreadsheet, but its page renders only with JavaScript.

## Risks & Open Questions

### Key Risks

- **Bot blocking:** big retailers use bot protection, and requests from Cloudflare Workers may be blocked or served challenge pages. This is the biggest technical risk. A fallback is a browser-based fetch for blocked sites, or a manually entered discount for any store that can't be fetched.
- **3-day timeline:** very tight. The MVP must stay small, and the order of work should be pipeline for 2 to 3 stores first, then the site, then the rest of the stores.
- **Page variety:** every store formats sales differently, so validation and extraction may need per-store rules.
- **Legal and terms of service:** fetching retailer pages may still breach some site terms. The MVP reduces this by storing only facts (discount level, sale URL), never copying product content, respecting robots.txt, and fetching each store only about once a day. A retailer's discount headline is a fact, but wording and images are not, so they are not reused.
- **Ad approval:** ad networks such as AdSense need review time and some content, so ad revenue will not start on day 3.
- **Free-tier limits:** Workers and Browser Rendering limits may cap how much can run daily.

### Open Questions

- Is the target launch before Black Friday (27 November 2026)?
- What is Crocs SA's sale URL? It is not in the spreadsheet.
- Who checks the 21 search-only URLs in a browser before launch?
- Should the Phase 2 plan include affiliate feeds or retailer partnerships to allow richer product-level listings?
- Is the domain saleaway.online already registered and on Cloudflare?
- Which ad network will be used?

### Areas Needing Further Research

- Which stores can be fetched from Cloudflare Workers (the first test was from a home connection, with guessed paths).
- The markup of each store's real sale page, to decide the extraction method per store: Shopify JSON, HTML parse, browser render, or manual.
- Current Cloudflare free-tier limits (Workers, D1, R2, Browser Rendering, Cron Triggers).
- Legal position on fetching retailer pages and showing discount information in South Africa.

## Appendices

### C. References

- `docs/idea.md`: original idea description.
- `docs/architecture-diagram.jpg`: pipeline diagram.
- `docs/fetch-spike.md`: fetch test of the first 13 stores with guessed paths.
- `docs/data/SA_Top_Online_Stores_Sale_Pages.xlsx` and `docs/data/retailers-seed.tsv`: 106 SA stores with sale URLs, platforms and status.

## Next Steps

### Immediate Actions

1. Review and confirm the **[Assumption]** items above, especially the retailer list, the structured-cards approach and the launch date.
2. Re-run the fetch test using the real sale URLs from the spreadsheet, from an actual Cloudflare Worker.
3. Hand off to the PM agent to create the PRD (`docs/prd.md`).
4. Continue with UX Expert (front-end spec), Architect, PO validation, then story creation and development.

### PM Handoff

This Project Brief provides the full context for Saleaway. Please start in 'PRD Generation Mode', review the brief thoroughly to work with the user to create the PRD section by section as the template indicates, asking for any necessary clarification or suggesting improvements.
