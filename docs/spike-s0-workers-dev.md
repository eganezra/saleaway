# Spike S0 Results: first deploy to workers.dev (2026-10-29)

**Method:** the canary web Worker and the pipeline placeholder were deployed with `wrangler deploy` (Wrangler 4.155.0, Node 22.23.4) to `https://saleaway-web.<account>.workers.dev` and `https://saleaway-pipeline.<account>.workers.dev`, using the operator's existing `wrangler login`. A temporary route `/spike-s0` on the web Worker ran `SELECT 1` against D1 and stored its response with the Cache API (`Cache-Control: public, max-age=60`), then reported `HIT` or `MISS` in an `x-spike-cache` header. The route was removed after the measurements (see "Cleanup"). Requests were made with `curl` from a home Mac in South Africa.

## Result in one line

**The Cache API does cache on `workers.dev`.** The earlier belief in `risks-and-spikes.md` (that it does not) was wrong for this account and plan. The bundle is far below the working limit, and both Workers deployed on the Free plan.

## 1. Cache API on workers.dev

Requests to `/spike-s0` (one entry cached for 60 seconds). Times are UTC.

| Time | `x-spike-cache` | `cf-cache-status` | `age` | Note |
|---|---|---|---|---|
| 11:53:01 | MISS | - | - | First request, stored by the Worker |
| 11:53:58 | HIT | HIT | 57 | Same entry, served from cache |
| 11:54:01 | MISS | - | - | Entry had expired after 60 seconds, so it was stored again |
| 11:54:03 | HIT | HIT | 2 | |
| 11:54:05 | HIT | HIT | 4 | |
| 11:54:08 | HIT | HIT | 7 | |
| 11:54:10 | HIT | HIT | 9 | |
| 11:56:02 | MISS | - | - | Repeat check about 2 minutes later: the entry had expired, so it was stored again |
| 11:56:03 | HIT | HIT | 1 | |

All requests were served from the Johannesburg data centre (`cf-ray` ending `JNB`). Cache entries are per data centre (Cloudflare docs), so other locations will have their own entries.

**What this means:** the edge-cached home page design (about 10 minutes of cached HTML, architecture "Performance Optimization") can work on `workers.dev` as well as on the custom domain, so the home page does not have to read D1 on every view before the domain is connected. This was measured with a small JSON response from the Cache API. The real home page is cached in Story 2.4, which still confirms caching on the production domain.

## 2. Worker bundle size

From the Wrangler deploy output:

| Worker | Total Upload | gzip |
|---|---|---|
| `saleaway-web` (with the temporary spike route) | 614.85 KiB | 159.00 KiB |
| `saleaway-pipeline` (placeholder) | 0.19 KiB | 0.16 KiB |

- The Free plan **accepted both deploys**. Neither Wrangler nor the deploy output showed a plan size limit.
- Against the working limit of 3 MiB compressed, the web Worker uses about 5%.
- Worker startup time reported by Wrangler: 26 ms (web), 2 ms (pipeline). The live tail showed `cpuTime: 0` for `/health`.
- The disagreement in `verified-platform-limits-cloudflare-free-plan-checked-2026-10-29.md` (64 MiB uncompressed vs 3 MiB compressed) is **not resolved** by this test, since neither limit was reached. 3 MiB compressed stays as the working limit.

## 3. D1 database and bindings

- Database `saleaway` created with location hint **`weur`** (Western Europe). The hints offered by Wrangler 4.155.0 were `weur`, `eeur`, `apac`, `oc`, `wnam`, `enam`. None is in Africa. `weur` was chosen as the nearest to South Africa. The hint cannot be changed after creation.
- Binding `DB` is configured in `apps/web/wrangler.jsonc` and `apps/pipeline/wrangler.jsonc`.
- **On Cloudflare:** the deploy output of both Workers lists `env.DB (saleaway) D1 Database`. The web Worker also lists `env.ASSETS`. On the deployed web Worker `/spike-s0` returned `"db":1`, which shows the binding works.
- **Locally:** `pnpm dev` returned `"db":1` from `/spike-s0`, and `wrangler dev` for the pipeline listed `env.DB (saleaway) D1 Database local`.
- The adapter's `IMAGES` and `SESSION` (KV) bindings are switched off (`imageService: 'passthrough'`, `session: false`). The deployed web Worker lists only `DB` and `ASSETS`.

## 4. Workers Logs

- `/health` on the deployed web Worker returned 200 `ok`.
- **Live tail** (`wrangler tail saleaway-web`) showed the `health_checked` JSON log line for each request.
- **Dashboard (Workers Logs):** confirmed by the operator on 2026-10-29: the `health_checked` lines appear under Workers & Pages, `saleaway-web`, Observability, Logs, and the free allowance shown matches the docs figure below.
- **Free allowance** (Cloudflare Workers Logs docs, checked 2026-10-29): 200,000 log events a day, 3 days retention. The docs do not say what happens at the limit. They also say Workers Logs moves to Cloudflare Observability pricing on 1 December 2026, so re-check the allowance then.
- `/health` still logs at `info` on every request. With no monitor polling it yet, the level was left alone.

## Cleanup

The `/spike-s0` route and its `lib/db.ts` helper were deleted and the web Worker redeployed (612.26 KiB total, 158.56 KiB gzip; `/health` still 200 `ok`, `/spike-s0` now 404), so no spike endpoint stays public. The `DB` binding stays in both wrangler files. Story 1.4 builds the real data access.
