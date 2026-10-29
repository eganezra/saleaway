# Tech Stack

Exact versions were recorded in Story 1.1 on 2026-10-29 and are also pinned in the lockfile (`pnpm-lock.yaml`). Rows still marked "latest, pinned" are installed by the story that first needs them.

## Technology Stack Table

| Category | Technology | Version | Purpose | Rationale |
|---|---|---|---|---|
| Frontend Language | TypeScript | 5.9.3 (pinned in Story 1.1; 7.x exists but typescript-eslint does not support it yet) | Type-safe code across web, pipeline and core | One language end to end, shared types |
| Frontend Framework | Astro (SSR on Workers via `@astrojs/cloudflare`) | Astro 7.4.4 with @astrojs/cloudflare 14.4.3 (pinned in Story 1.1; needs Node 22.23.4 or newer) | Server-rendered pages with almost no client JavaScript | Decided 2026-10-29, see "Framework decision" below |
| UI Component Library | None. Astro components with hand-written CSS | - | Category card, store row, pill, chips, strip, ad slot | Spec has about 8 small components, and no library keeps the bundle small |
| State Management | None. Server-rendered. One small same-origin script file | - | Status strip dismiss, active chip, click beacon | No client state worth managing |
| Backend Language | TypeScript | same as above | Pipeline and web Workers | Same as above |
| Backend Framework | Cloudflare Workers runtime (no framework) | `compatibility_date` pinned at scaffold | Cron, queue consumer, admin run endpoint | Smallest possible footprint |
| API Style | No public API. Internal HTTP endpoints only (see below) | - | Click beacon, health check, manual pipeline run | The product is a website, not an API |
| Database | Cloudflare D1 (SQLite) | managed | Retailers, sale records, overrides, run log, clicks | Free tier, SQLite as you proposed, same platform |
| Cache | Cloudflare Cache API in the web Worker | managed | Cache rendered home page HTML | Protects D1 quotas and speeds up pages |
| File Storage | None at launch | - | No images or files stored | Text-only design (NFR7). R2 only if needed later |
| Authentication | None for visitors. Bearer token secret for the manual-run endpoint. Operator CLI uses your Cloudflare login | - | Protect operator actions | No user accounts in the MVP |
| Frontend Testing | Vitest + axe (via Playwright smoke test) | latest, pinned | Component logic, accessibility check of the built page | Spec requires automated axe checks |
| Backend Testing | Vitest with `@cloudflare/vitest-pool-workers` | Vitest 5.0.5 (pinned in Story 1.1; the Workers pool is added in the first story that needs it) | Unit tests with page samples, D1 integration tests | Runs the Worker code and D1 locally (NFR12) |
| E2E Testing | Playwright, smoke only (home loads, links present, axe) | latest, pinned | One or two checks | PRD: no full E2E suite for the MVP |
| Build Tool | pnpm + Astro build + Wrangler | pnpm 9.0.0, Astro 7.4.4, Wrangler 4.155.0 (pinned in Story 1.1) | Build and deploy | Standard for Cloudflare |
| Bundler | Vite (via Astro) and esbuild (via Wrangler) | managed | Bundle Workers | Defaults |
| IaC Tool | `wrangler.jsonc` per Worker, plus SQL migrations in `db/migrations` | - | Bindings, cron schedules, queues | Cloudflare config as code, no Terraform for 3 days |
| CI/CD | GitHub Actions | - | Lint, type check, test, deploy on push to main | Tests gate deploys (Story 4.4) |
| Monitoring | Workers Logs (observability enabled), Cloudflare Web Analytics, health CLI, failure alert webhook | - | Errors, traffic, system health | Free and cookie-free (NFR8). Confirm Workers Logs free allowance at scaffold |
| Logging | Structured JSON logger in `packages/core` | - | One log shape everywhere | NFR11 |
| Linting | ESLint with typescript-eslint and eslint-plugin-astro | ESLint 10.13.0, typescript-eslint 8.72.1, eslint-plugin-astro 3.2.1, @eslint/js 10.0.1 | `pnpm lint`, including no `console.log` outside the logger | Added in Story 1.1: the architecture named a lint command but no tool |
| Type check (web) | @astrojs/check | 0.9.12 | `astro check` in `pnpm typecheck` | Needed by Story 1.1 for the web app |
| CSS Framework | None. CSS custom properties (design tokens) plus scoped component styles | - | Neo-brutalist style from the spec | Smaller than any framework |

## Framework decision (decided 2026-10-29: Astro)

You suggested Next.js and the PRD left the choice to the Architect. **You confirmed Astro**, for these reasons:

1. **Cloudflare's own Next.js path is still beta** (vinext, or the OpenNext adapter with a 1.0 beta migration), and the Free plan bundle limit is 3 MiB compressed. Astro's Cloudflare adapter is a standard supported path.
2. **The page is almost entirely static content.** Astro ships no JavaScript by default, which helps the 2-second goal, the Lighthouse targets and SEO.
3. **Three days is short.** A beta deploy path is the wrong place to spend a day debugging.

The rest of the architecture does not depend on the frontend framework: the web Worker, D1, the pipeline Worker and `packages/core` would work the same with another one.
