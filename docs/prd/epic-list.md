# Epic List

- **Epic 1: Foundation & First Live Page:** Set up the repository, local development, a first deploy to a free workers.dev address, the database and seeded retailers, and a first working page. The real domain and automatic deploys come at the end (Story 4.4).
- **Epic 2: Public Site:** Turn the first page into the real Saleaway home page with category sections, trustworthy cards, SEO, ad slots, analytics and the legal pages.
- **Epic 3: Daily Discovery Pipeline:** Automatically fetch, validate and extract discounts for every store every day, keep the site's data fresh, and add the "Biggest discounts today" card.
- **Epic 4: Overrides, Operations & Launch Readiness:** Let the operator fix problem stores by hand, see the health of the system, and verify every URL before launch.
- **Epic 5: Coverage & Growth (post-launch, before Black Friday):** Read JavaScript-only stores, discover sale pages for new stores, and add filters.

**Rationale and delivery plan.** The site runs in Epic 1 (locally and on a workers.dev address) with every card showing "On sale", before any extraction exists. This means a working site exists on day 1, and every later epic only improves it. The real domain and automatic deploys are connected near the end (Story 4.4), so register the domain and move its nameservers to Cloudflare in parallel from day 1, because that can take hours. Suggested plan for the 3 days: Day 1, Epics 1 and 2. Day 2, Epic 3. Day 3, Epic 4 and launch checks. Epic 5 follows after launch. If Epic 3 runs long, launch with "On sale" cards and manual discounts for the biggest stores, then keep improving.
