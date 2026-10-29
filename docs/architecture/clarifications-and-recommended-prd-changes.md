# Clarifications and recommended PRD changes

These came out of the architecture work and should be reviewed by the PO.

1. **FR7 validation for JavaScript-only pages.** A page whose products load with JavaScript cannot show discounted products in its HTML. The architecture treats these as `url_verified`: the URL loads and was checked by a person (Story 4.3), but content was not read. They appear as "On sale". The PRD's wording should say this.
2. **Alerting (PRD checklist MEDIUM).** Add a small story to Epic 4: "Failure alert and data retention", covering the finalize cron, the alert webhook when more than 20% of stores fail, and the 30-day result purge.
3. **Operator security (PRD checklist HIGH).** Resolved by design: no admin web page, CLI only, token-protected `/admin/run`. Story 4.2 should say the health report is a CLI command.
4. **Backup (PRD checklist MEDIUM).** D1 data is mostly re-creatable from `docs/data/retailers-seed.tsv` and the next pipeline run. Overrides are the only hand-entered data, so `pnpm ops:override --export` should save them to a file in the repository after each change. Add as an AC to Story 4.1.
5. **Quota alert.** Add an AC to Story 4.2: the health report shows Worker requests and D1 rows written for the day, if the Cloudflare API makes this available, or links to the dashboard.
6. **Story 2.5 click tracking** should note that D1 write volume is capped by `CLICK_SAMPLE_RATE`, and that Workers Analytics Engine is an alternative that needs its free allowance confirmed.
7. **Story 3.1 AC2** is now specific: one message per store, staggered by `STAGGER_SECONDS`, `max_batch_size` 1.
8. **FR22 (path-probing fallback)** is not built for launch. It belongs to Epic 5 Story 5.2, and the pipeline layout has room for a `probe.ts` module.
9. **Story 3.7** should show one entry per website, using the best percentage (see "Seed data rules").
10. **Store counts.** The spreadsheet has 92 rows with a primary sale URL, not 94. The brief and PRD have been corrected.
