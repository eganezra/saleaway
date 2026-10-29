# PO Master Checklist Report: Saleaway

_Run by the PO agent (Sarah) on 2026-10-29 in comprehensive mode against `docs/brief.md`, `docs/prd.md`, `docs/front-end-spec.md`, `docs/architecture.md`, `docs/fetch-spike.md` and `docs/data/retailers-seed.tsv`. Percentages are the PO's judgment, not a measured score. The "Before" column describes the documents as they were when this check started. Every must-fix item has been applied to the documents unless stated otherwise._

## Executive Summary

- **Project type:** greenfield, with a UI. Brownfield-only items were skipped: 1.2, section 7 (all of it), and the brownfield bullets in other sections.
- **Overall readiness:** about 88% after the fixes (about 75% before).
- **Recommendation:** **APPROVED to shard and start development**, once human prerequisites 1 to 3 are done (see the PRD).
- **Critical blocking issues found:** 3, all fixed in the documents (see Must-fix).

## Category Results

| Category | Before | After | Notes |
|---|---|---|---|
| 1. Project setup and initialization | PARTIAL | PASS | Story 1.1 had no test tooling, so the CI had nothing to run (CI is now Story 4.4). Added. |
| 2. Infrastructure and deployment | PASS | PASS | Database, schema and seed come before use. CI/CD before deploys. The queue and secrets creation is now explicit in Story 3.1. |
| 3. External dependencies and integrations | PARTIAL | PASS | Accounts, tokens, webhook and domain are now listed as human prerequisites with the story that needs each. |
| 4. UI/UX considerations | PASS | PASS | Spec, components, flows and accessibility are consistent with the architecture. The "card" vs "row" wording is now aligned. |
| 5. User and agent responsibility | **FAIL** | PASS | Nothing in the PRD said what only the human can do (Cloudflare account, domain, GitHub secrets, alert webhook, checking 21 URLs). Added. |
| 6. Feature sequencing and dependencies | **FAIL** | PASS | Two sequencing bugs, see Must-fix. |
| 7. Risk management (brownfield) | skipped | skipped | Not applicable. |
| 8. MVP scope alignment | PARTIAL | PARTIAL | Still large for 3 days. A launch-critical set and cut order are now in the PRD. |
| 9. Documentation and handoff | PARTIAL | PARTIAL | `core-config.yaml` still points at another project's shard file names (see Should-fix). Exact package versions are pinned during Story 1.1. |
| 10. Post-MVP considerations | PASS | PASS | Clear MVP/future split, Epic 5, and extension points (one row per store, extraction method per store). |

## Must-fix issues found, and how they were resolved

1. **The site would have been empty on day 1.** Story 2.3 hid any store not validated in the last 72 hours, but no validation exists until the pipeline (Epic 3) runs. The "live site in Epic 1" plan would have shown nothing. **Fix:** a never-validated store is measured from the time it was added, so the first pipeline run has 72 hours, and an active override counts as a fresh check (PRD FR10 and Story 2.3, architecture visibility rule).
2. **Override precedence was built too late.** "Overrides win over extracted values" lived in Story 4.1, but Stories 3.7 and the visibility rules depend on it earlier. **Fix:** precedence rules (percentage, hide, URL, expiry) moved into Story 2.3. Story 4.1 is now only the operator command.
3. **The human's tasks were not assigned (checklist section 5).** **Fix:** a "Human prerequisites" table in the PRD, with the story that needs each item.

## Other fixes applied

- **Story 1.3** now lists the categories and run results tables (the PRD omitted them) and seeds the 10 categories.
- **Story 1.1** now requires lint, type-check and test commands and one passing test.
- **Story 2.4** now confirms page caching on the production domain (it may not work on `workers.dev`) and adds an automated accessibility smoke test in CI.
- **Story 3.1** now includes closing the run with a second cron, creating the queue and secrets, and a `PIPELINE_ENABLED` pause switch.
- **Story 3.2** now includes the CPU measurement (Architecture spike S1) with a recorded decision. Before, this key risk had no story.
- **Story 3.3** now says JavaScript-only pages are URL-verified only, and test samples must be trimmed.
- **Story 3.8 (new, conditional):** the GitHub Actions fallback runner, built only if the CPU measurement fails.
- **Story 4.1** adds an override export (backup) and SQL input validation. **Story 4.2** is now a command-line report and shows quota use. **Story 4.5 (new):** failure alert and 30-day retention.
- **Wording:** FR13 and FR15 and Story 2.1 now say "row" where a store is meant. NFR6 now counts the robots.txt check separately from the one page fetch.
- **Counts:** 92 stores with primary sale URLs, not 94 (fixed in the brief, PRD and architecture).

## Risk Assessment (top 5)

1. **10 ms CPU limit on parsing big pages.** Mitigation: the measurement in Story 3.2, then streaming parse, `manual` for that store, or Story 3.8. Timeline impact: up to half a day.
2. **Retailers blocking requests.** Three stores already block. Mitigation: `manual` method and overrides.
3. **The 3-day timeline.** 26 stories (18 launch-critical, 1 conditional). Mitigation: the cut order in the PRD, and the site is live from Epic 1.
4. **Domain and account readiness.** If the domain is not on Cloudflare, launch happens on a temporary address where caching may not work. Mitigation: do prerequisites 1 to 3 first.
5. **Black Friday traffic cap.** Mitigation: the 50,000 requests a day tripwire and the pre-approved $5 plan.

## MVP Completeness

- **Core features covered:** daily discovery, validation, discount extraction, category cards with discount-first rows, biggest-discounts card, overrides, SEO, ad slots, analytics, legal pages.
- **Missing essentials:** none after the fixes.
- **Scope creep:** the "Biggest discounts today" card (Story 3.7) and the Black Friday badge (Story 2.6) go beyond the minimum. Both were your decisions, and both are first in the cut order.
- **True MVP vs over-engineering:** the design is lean (no admin UI, no accounts, no images). The queue fan-out is needed by the free-tier limits, not by ambition.

## Implementation Readiness

- **Developer clarity score:** 8 out of 10.
- **Ambiguous requirements:** 3 remaining: the 72-hour and 20% thresholds (both marked as assumptions), the exact CPU threshold of 8 ms, and the category taglines (to be written in Story 1.3).
- **Missing technical details:** exact package versions (pinned in Story 1.1), the heading font (assumed Space Grotesk).

## Recommendations

**Must-fix before development (done):** the three items above.

**Should-fix:**
- After sharding, update `devLoadAlwaysFiles` in `.bmad-core/core-config.yaml`. It currently lists `docs/architecture/15-section-15-of-16-coding-standards.md` and two similar names copied from another project, which will not exist after sharding. The developer agent would fail to load its standards. I will set the real file names right after the shard.
- Complete human prerequisites 1 to 3 before Story 1.1.
- Commit the documents to git before development starts, so the plan has a history.

**Consider:**
- A quick check of SA deal sites to support the "why Saleaway" copy (the brief's competitor claim is still unverified).
- Define learning goals and Phase 2 criteria after the first week of data.

**Post-MVP deferrals:** Epic 5, the static home page build, a staging environment, affiliate links, product-level listings.

## Final Decision

**APPROVED** for sharding and development, on the condition that human prerequisites 1 to 3 are completed before Story 1.1 starts.
