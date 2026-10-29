# Core Workflows

## Daily pipeline

```mermaid
sequenceDiagram
    participant Cron as Cron 03:00 UTC
    participant P as Pipeline (scheduled)
    participant Q as Queue
    participant C as Pipeline (consumer)
    participant R as Retailer site
    participant D as D1
    Cron->>P: trigger
    P->>D: purge results older than 30 days
    P->>D: insert pipeline_run, load visible retailers
    P->>Q: sendBatch (one message per store, delaySeconds staggered)
    loop each store, about 15 s apart
        Q->>C: deliver message
        alt extraction_method is manual
            C->>D: record skipped_manual, keep override
        else
            C->>R: GET robots.txt then sale_url
            R-->>C: response
            C->>C: classify, validate, extract
            C->>D: upsert sale_record and insert run_result
        end
    end
    Note over Cron,D: 03:45 UTC - second cron
    Cron->>P: finalize
    P->>D: totals for the run
    P-->>P: if failures above threshold, POST alert webhook
```

## State rules per fetch result

| Result | Effect on sale record |
|---|---|
| `ok` and validated with discounted products | `active`, `content_verified`, percentage set (or null for "On sale"), `last_validated_at` updated |
| `ok` but no discounted products | `ended`, `ended_at` set (FR10) |
| `js_only` (page loads but products render with JavaScript) | `active`, `url_verified`, shown as "On sale" |
| `blocked`, `error` | last good record is kept, only `last_checked_at` and `last_result` change |
| `not_found`, `redirected_away` | `ended` |

A record is hidden when it is `ended`, when its freshness time is older than 72 hours, or when an active override hides it. The **freshness time** is the latest of `last_validated_at`, the time an active override that sets a percentage was created, and, only for a store that has never been validated, the time the retailer row was created. Without that last part the site would be empty until the first pipeline run. These rules live in `isVisible` in `packages/core` and are built in Story 2.3, together with override precedence (an active override's percentage and sale URL replace the extracted ones).

## Page view

```mermaid
sequenceDiagram
    participant B as Browser
    participant E as Edge cache
    participant W as Web Worker
    participant D as D1
    B->>E: GET /
    E->>W: Worker runs
    W->>W: cache.match(request)
    alt cache hit
        W-->>B: cached HTML
    else miss
        W->>D: one query for visible sales plus overrides
        W->>W: rank, build view model, render
        W->>W: cache.put (about 10 minutes)
        W-->>B: HTML
    end
    B->>W: POST /api/click (sendBeacon, optional)
```

## Operator override

`pnpm ops:override --slug crocs-sa --percent 50 --expires 2026-11-30` writes one row to `overrides` through `wrangler d1 execute --remote`. The site reflects it when the cached page expires (about 10 minutes at most).
