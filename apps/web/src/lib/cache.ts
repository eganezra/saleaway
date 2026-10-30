// The home page cache (Story 2.4): the rendered HTML is kept in the Cache API for about 10 minutes, so most views never
// touch D1. Everything it needs is passed in (the cache, `waitUntil`, the renderer), so a unit test uses fakes.

/** How long a stored page is kept. The page says it too, in its `Cache-Control: public, max-age=600`. */
export const PAGE_CACHE_SECONDS = 600;

/** The pages kept in the cache: the home page and the two text pages. Nothing else (not `/contact`, not `/api/click`). */
export const CACHED_PATHS: ReadonlySet<string> = new Set(['/', '/about', '/privacy']);

/** The shape of `caches.default` that this file uses. */
export interface PageCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface CacheDeps {
  cache: PageCache;
  /**
   * Names the build that renders the page. It is part of the cache key, so a deploy never serves the previous build's
   * HTML: that HTML points at the previous build's hashed stylesheet, which no longer exists after a deploy (an unstyled page).
   */
  version: string;
  /** Keeps the Worker alive until the promise settles, without making the visitor wait for it. */
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * What the visitor's browser is told about a page the edge cache holds: ask again every time (a cheap cache hit). The stored
 * copy says `max-age=600` for the edge, but a browser that kept the HTML for 10 minutes would keep a page of a previous build,
 * which links a hashed stylesheet that a deploy has removed (an unstyled page).
 */
export const BROWSER_CACHE_CONTROL = 'public, max-age=0, must-revalidate';

/**
 * A copy with `x-cache` set (and, for a page the edge cache holds, the browser's `Cache-Control`): a response from the cache
 * (or a fetch) can have read-only headers in the Workers runtime.
 */
function tagged(response: Response, value: 'HIT' | 'MISS' | 'BYPASS'): Response {
  const copy = new Response(response.body, response);
  copy.headers.set('x-cache', value);
  if (value !== 'BYPASS') copy.headers.set('cache-control', BROWSER_CACHE_CONTROL);
  return copy;
}

/** Only a successful page that says `public` may be stored: `no-store` (the empty page, a 503) never is. */
function isStorable(response: Response): boolean {
  return response.status === 200 && /\bpublic\b/i.test(response.headers.get('cache-control') ?? '');
}

/**
 * Serves a GET request from the cache when it can, else renders it with `next()` and stores the result.
 * The key is the address without the visitor's query string (plus the build's name), so `/?utm=x` and `/?a=1` share one entry
 * and a visitor cannot make a new database query by changing the query string. A failing cache is never the visitor's problem: the page is rendered
 * and returned with `x-cache: BYPASS`. Adds no per-view log line (the header is how to see what happened).
 */
export async function cachedPage(request: Request, next: () => Promise<Response>, deps: CacheDeps): Promise<Response> {
  if (request.method !== 'GET') return next();

  const url = new URL(request.url);
  const key = new Request(`${url.origin}${url.pathname}?v=${encodeURIComponent(deps.version)}`, { method: 'GET' });

  let hit: Response | undefined;
  try {
    hit = await deps.cache.match(key);
  } catch {
    return tagged(await next(), 'BYPASS');
  }
  if (hit !== undefined) return tagged(hit, 'HIT');

  const response = await next();
  if (!isStorable(response)) return tagged(response, 'BYPASS');

  try {
    deps.waitUntil(deps.cache.put(key, response.clone()).catch(() => undefined));
  } catch {
    return tagged(response, 'BYPASS');
  }
  return tagged(response, 'MISS');
}
