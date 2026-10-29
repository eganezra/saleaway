# Launch-Critical Set and Human Prerequisites

_Added by the PO on 2026-10-29 after validating all documents._

## Launch-critical vs deferrable

- **Launch-critical (the site cannot go live honestly without these):** Stories 1.1 to 1.4, 2.1 to 2.5, 3.1 to 3.6, 4.1, 4.3, 4.4 and 4.5.
- **Deferrable if time runs short, cut in this order:** 2.6 (Black Friday badge), 3.7 (Biggest discounts card), 4.6 (failure alert and retention), 4.2 (health report; use the run log tables meanwhile), the HTML and structured-data extractors inside 3.4 (keep Shopify and manual), and the anchor menu in 2.2.
- **Conditional:** Story 3.8 (fallback runner), built only if the CPU measurement in Story 3.2 fails.
- **Post-launch:** Epic 5.

## Human prerequisites (only you can do these)

| # | What | Needed before |
|---|---|---|
| 1 | A Cloudflare account, with `wrangler login` working on your computer (**done 2026-10-29**; use Node 22) | Story 1.2 |
| 2 | A GitHub repository for the project, with repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (a repository is also a good place for backups before then) | Story 4.4 |
| 3 | The domain saleaway.co.za registered, with its nameservers pointed at Cloudflare (otherwise a temporary address is used, and page caching may not work on it). Start this early, since nameserver changes can take hours | Story 4.4 |
| 4 | A monitored email address for retailer removal requests (Cloudflare Email Routing can forward it to your inbox once the domain is on Cloudflare) | Story 4.5 |
| 5 | A webhook URL for failure alerts (for example a Discord or Slack channel) | Story 4.6 |
| 6 | A Cloudflare Web Analytics site token (only usable once the domain is connected) | Story 4.4 |
| 7 | Check the 21 search-only URLs in a browser, and find Crocs SA's sale URL (the agent prepares the list) | Story 4.3 |
| 8 | Keep the `ADMIN_TOKEN` the agent generates in a password manager | Story 3.1 |
| 9 | Apply to an ad network once the site is live | After launch |
