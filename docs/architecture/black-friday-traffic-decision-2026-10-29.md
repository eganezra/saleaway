# Black Friday traffic decision (2026-10-29)

**Recommendation, accepted: launch on the Free plan with a tripwire, and pre-approve a $5 upgrade.**

- **Do nothing special now.** Your 30-day goal is about 1,000 visitors, far below 100,000 Worker requests a day. Building a static-site rebuild pipeline now would cost a day of the 3-day timeline to guard against a problem you may not have.
- **Watch it.** The health report and Cloudflare dashboard show daily Worker requests. Set a dashboard alert, or check daily, at **50,000 requests a day (50% of the limit)**.
- **If the tripwire is hit, upgrade to Workers Paid ($5 a month).** It takes minutes, raises the request and CPU limits by a wide margin, and costs far less than a Black Friday outage: at the limit, every visitor gets an error until midnight UTC (02:00 in South Africa).
- **Cheap levers to pull first:** lower `CLICK_SAMPLE_RATE` (each counted click is an extra request) and lengthen the home page cache from 10 minutes to 1 hour.
- **Longer term (post-launch story):** pre-build the home page as a static file rebuilt after each pipeline run. Static assets are served without running a Worker, which removes this limit for page views.
