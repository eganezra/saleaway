# Verified platform limits (Cloudflare Free plan, checked 2026-10-29)

These numbers shape the design. They come from the official Cloudflare docs pages for Workers limits, D1 limits and pricing, Queues pricing, Browser Rendering limits and static assets. Where a page was unclear, it is marked.

| Area | Free plan limit | Effect on Saleaway |
|---|---|---|
| Worker requests | 100,000 per day | Each page view that reaches a Worker counts. This caps the site at roughly 100k Worker-served requests a day (see Risk R3). |
| Subrequests per invocation | 50 | One cron run cannot fetch ~95 stores. Work is fanned out so each invocation handles one store. |
| CPU time per invocation | **10 ms** (HTTP requests and Cron Triggers) | The tightest limit. Parsing large pages may exceed it (see Risk R1). Waiting for a network response does not count as CPU time. |
| Cron Triggers | 5 per account, 15 minutes wall time | Two are used. |
| Queue consumer wall time | 15 minutes | Fine. A free-plan CPU limit for consumers was not stated on the page, so it is assumed to be 10 ms. |
| Queues | Available on Free: 10,000 operations per day, 24 hour retention | About 3 operations per store per day, so roughly 300 a day. |
| D1 | 500 MB per database, 5 GB per account, 10 databases, **5 million rows read per day, 100,000 rows written per day**, 50 queries per invocation, 100 bound parameters | Pipeline writes about 500 rows a day. Reads must be cached, so the home page cannot query D1 on every view. |
| Browser Rendering | 10 minutes of browser time per day, 3 concurrent browsers | Enough for only a handful of JavaScript-only stores a day (Epic 5). |
| Static assets | Free and unlimited per the docs. Whether they count toward the 100,000 requests a day was not stated. | CSS, JavaScript and fonts are served as static assets. |
| Worker bundle size | The Workers limits page summary read "64 MiB uncompressed". The OpenNext docs state a **3 MiB compressed** Free limit. These disagree. | Treat 3 MiB compressed as the working limit and confirm at scaffold time. Astro fits easily. |

**Next.js on Cloudflare (relevant to the framework choice):** Cloudflare's current Next.js guide recommends "vinext", a beta Vite plugin, as the default path. The OpenNext Cloudflare adapter is the other route, and its docs reference a 1.0 beta migration and the 3 MiB compressed Free limit. Both paths are beta or in flux.
