# Monitoring and Observability

## Monitoring Stack

- **Frontend Monitoring:** Cloudflare Web Analytics (cookie-free visits and Core Web Vitals).
- **Backend Monitoring:** Workers Logs with observability enabled, the `pipeline_runs` and `run_results` tables, and `pnpm ops:health`. Confirm the Workers Logs free allowance at scaffold time.
- **Error Tracking:** structured error logs plus the failure alert webhook. No third-party error service at launch.
- **Performance Monitoring:** Lighthouse mobile checks in Story 2.4 and Web Analytics vitals.

## Key Metrics

**Frontend Metrics:**
- Core Web Vitals
- JavaScript errors (none expected, since there is almost no JavaScript)
- Click-outs per store per day
- Unique visitors per day

**Backend Metrics:**
- Pipeline success rate (target 95% or higher, NFR5)
- Oldest validated sale record age (target under 24 hours, NFR3)
- Stores by result class: percentage found, "On sale" only, blocked, not found, error
- D1 rows written and read per day, and Worker requests per day, against the free-tier limits
