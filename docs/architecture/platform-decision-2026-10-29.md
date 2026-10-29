# Platform decision (2026-10-29)

**Stay on Cloudflare. Do not move the whole project to another platform.**

| Option | Verdict | Why |
|---|---|---|
| **Cloudflare Workers + D1 (chosen)** | Keep | Free, global edge, cron and queues included, and the only real constraint (10 ms CPU) affects one part of the system, the pipeline. |
| Vercel (free Hobby plan) | No | As I understand it, the Hobby plan is for non-commercial use, and an ad-funded site is commercial. Confirm in their terms if you want to be sure. |
| Netlify free | No | Function and build-minute allowances are small, and it has no cron-plus-queue pipeline or database included. |
| Render | No | Free web services sleep when idle, cron jobs are paid, and the free Postgres database expires. |
| Cheap VPS (about 4 euros a month) or Oracle Cloud free VM | Not now | No CPU limit and one machine for everything, but you maintain it yourself (updates, security, backups), and a VPS is not free. A reasonable later move if the site outgrows Cloudflare Free. |

**The weak spot is the pipeline, not the website.** The website (cached pages, one database query) is light work that suits Cloudflare's edge. Parsing big retailer pages is the heavy work that could exceed 10 ms.

**Fallback runner: GitHub Actions (free).** If spike S1 shows big pages exceed 10 ms, keep everything on Cloudflare but run the fetch-and-extract step as a scheduled GitHub Actions workflow instead of the queue consumer:

- It has no 10 ms CPU limit, and a normal Node.js process can parse a 1.6 MB page without trouble.
- It can run a real browser (Playwright) to read JavaScript-only stores. That avoids Cloudflare Browser Rendering's 10-minute daily cap and makes Epic 5 Story 5.1 much easier.
- It reuses `packages/core` unchanged, because that package does no I/O. This is the reason the logic is kept there.
- It writes results to the same D1 database through Wrangler or the Cloudflare API, so the website does not change.
- Caveats: scheduled workflows can start a few minutes late, GitHub pauses scheduled workflows on public repositories after 60 days without activity, and GitHub's IP ranges may be blocked by some retailers just as Cloudflare's may. Spike S2 will test both.
