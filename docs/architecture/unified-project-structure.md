# Unified Project Structure

```text
saleaway/
├── .github/workflows/
│   ├── ci.yml                      # lint, typecheck, test on every push and PR
│   └── deploy.yml                  # deploy web and pipeline on main after CI passes
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
│       │   ├── classify.ts  validate.ts
│       │   ├── extract/ shopify-json.ts  html.ts  structured-data.ts  index.ts
│       │   └── rank.ts  visibility.ts  biggest-discounts.ts  hidden-stores.ts  override-input.ts
│       ├── tests/fixtures/         # small trimmed page samples, not whole pages (pages/ with index.json, robots/)
│       └── package.json
├── db/
│   ├── migrations/                 # 0001_init.sql, then one file per later story
│   └── seed/                       # seed script reads docs/data/retailers-seed.tsv
├── scripts/ops/                    # seed, hide (Story 3.9), override (Story 4.1: override.ts, override-plan.ts), health, check-urls, run
├── docs/                           # brief, prd, front-end-spec, architecture, data (incl. hidden-stores.json, overrides.json)
├── .env.example                    # variable names only, no values
├── pnpm-workspace.yaml  package.json  tsconfig.base.json
└── README.md                       # run, test, deploy, pause the pipeline, rollback
```
