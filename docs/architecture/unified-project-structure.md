# Unified Project Structure

```text
saleaway/
├── .github/workflows/
│   ├── ci.yml                      # lint, typecheck, test and the smoke test on every PR; deploy.yml calls it (Story 4.4)
│   └── deploy.yml                  # on main: the checks, then (when DEPLOY_ENABLED is true) migrations, web, the quiet-window wait, pipeline
├── apps/
│   ├── web/                        # Astro site (see Frontend Architecture)
│   │   ├── src/  public/  tests/
│   │   ├── astro.config.mjs  wrangler.jsonc  package.json
│   └── pipeline/                   # cron + queue Worker (see Backend Architecture)
│       ├── src/  tests/
│       └── wrangler.jsonc  package.json
├── packages/
│   └── core/
│       ├── src/
│       │   ├── types.ts  logger.ts  url-safety.ts
│       │   ├── fetcher.ts  (the polite fetcher, moved here from the pipeline in Story 4.3; robots.ts holds checkRobots too)
│       │   ├── classify.ts  validate.ts
│       │   ├── page-scan.ts  (the linear scanners the validator and the extractors share)
│       │   ├── extract/ shopify-json.ts  html.ts  structured-data.ts  range.ts  index.ts
│       │   └── rank.ts  visibility.ts  biggest-discounts.ts  hidden-stores.ts  override-input.ts
│       ├── tests/fixtures/         # small trimmed page samples, not whole pages (pages/ with index.json and expectPercent per method, feeds/ with index.json, robots/)
│       └── package.json
├── db/
│   ├── migrations/                 # 0001_init.sql, then one file per later story
│   └── seed/                       # seed script reads docs/data/retailers-seed.tsv
├── scripts/ops/                    # seed, hide (Story 3.9), override (Story 4.1: override.ts, override-plan.ts), coverage (Story 3.6: coverage.ts, coverage-plan.ts), check-urls (Story 4.3: check-urls.ts, check-urls-plan.ts), deploy-window (Story 4.4: deploy-window.ts, wait-for-quiet-window.ts, the CI helper), health, run
├── docs/                           # brief, prd, front-end-spec, architecture, data (incl. hidden-stores.json, overrides.json)
├── .env.example                    # variable names only, no values
├── pnpm-workspace.yaml  package.json  tsconfig.base.json
└── README.md                       # run, test, deploy, pause the pipeline, rollback
```
