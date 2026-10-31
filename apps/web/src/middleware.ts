import { env } from 'cloudflare:workers';
import { defineMiddleware } from 'astro:middleware';
import { CACHED_PATHS, cachedPage } from './lib/cache';
import type { PageCache } from './lib/cache';
import { withSiteHeaders } from './lib/headers';
import { wwwRedirectTarget } from './lib/host';
import { isIndexingAllowed } from './lib/seo';

// Story 2.4: the home page (and, since Story 2.5, the About and Privacy pages) come from the cache when they can, and every response gets the site's headers on its way out.
// No log line per request (the free log allowance): `x-cache` shows what happened.
export const onRequest = defineMiddleware(async (context, next) => {
  // Story 4.4: `www.<site>` goes to the site's own address (a 301 for GET and HEAD). First, so a redirect is never cached under a page's key.
  const method = context.request.method;
  const target = method === 'GET' || method === 'HEAD' ? wwwRedirectTarget(context.request.url, env.SITE_URL) : null;
  if (target !== null) {
    return withSiteHeaders(Response.redirect(target, 301), { production: import.meta.env.PROD, allowIndexing: isIndexingAllowed(env.ALLOW_INDEXING) });
  }
  const cache = typeof caches === 'undefined' ? undefined : (caches as unknown as { default: PageCache }).default;
  const waitUntil = context.locals.cfContext?.waitUntil.bind(context.locals.cfContext);
  const response =
    CACHED_PATHS.has(context.url.pathname) && cache !== undefined && waitUntil !== undefined
      ? await cachedPage(context.request, () => next(), { cache, waitUntil, version: __BUILD_ID__ })
      : await next();
  return withSiteHeaders(response, { production: import.meta.env.PROD, allowIndexing: isIndexingAllowed(env.ALLOW_INDEXING) });
});
