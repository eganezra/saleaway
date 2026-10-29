# Next Steps

## UX Expert Prompt

Review `docs/prd.md` and `docs/brief.md` for Saleaway, a daily-updated list of South African store sale cards. Create the front-end specification (`docs/front-end-spec.md`) for a mobile-first, WCAG AA, text-only card design that shows "Up to X% off" or "On sale", category sections, ad slots and the legal pages. Propose a simple wordmark and colour direction, since no branding exists.

## Architect Prompt

Review `docs/prd.md`, `docs/brief.md`, `docs/fetch-spike.md` and `docs/data/`, and create the full-stack architecture (`docs/architecture.md`) for a Cloudflare-hosted serverless system: web app (Next.js via OpenNext or a lighter alternative), a cron-driven pipeline Worker with batching, and D1. Verify current Cloudflare free-tier limits, choose the batching approach, define the D1 schema and the per-store extraction strategy model, and keep the whole plan achievable in 3 days.
