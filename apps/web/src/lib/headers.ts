// The headers the site adds to every response (Story 2.4). Pure: it returns a copy of the response it is given.

// The architecture's policy. Styles need 'unsafe-inline' because Astro inlines scoped styles; scripts do not. The
// Cloudflare Insights host is for Story 2.5's analytics; ad network hosts are added when ads go live.
export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'";

export interface SiteHeaderOptions {
  /** A production build: `astro dev` injects inline scripts and a websocket that the policy would block. */
  production: boolean;
  /** `ALLOW_INDEXING` is `"true"`: when it is not, every response tells crawlers to stay away. */
  allowIndexing: boolean;
}

/**
 * A copy of the response with the site's headers. Added on the way out and never stored in the page cache, so a cached
 * page cannot keep the previous deploy's policy or its `X-Robots-Tag`.
 */
export function withSiteHeaders(response: Response, options: SiteHeaderOptions): Response {
  const copy = new Response(response.body, response);
  if (!options.allowIndexing) copy.headers.set('X-Robots-Tag', 'noindex, nofollow');
  if (options.production) {
    copy.headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    copy.headers.set('X-Content-Type-Options', 'nosniff');
    copy.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  }
  return copy;
}
