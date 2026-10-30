import { isAllowedByRobots } from '@saleaway/core';
import { MAX_PAGE_BYTES, discard, fetchPage, readLimited } from './fetcher';
import type { Deps } from './types';

// A Shopify store's product feed (Story 3.4): `GET <collection>/products.json?limit=250`, asked once a night at most,
// only for a store whose sale address is a collection, only if robots.txt allows it, and never asked again after a
// refusal. A feed that does not answer is not an error: the discount is read from the page instead.

const MAX_PRODUCTS_LIMIT = 250;

/** `<sale_url>/products.json?limit=250`, built from the path so any query on the sale URL is dropped. */
export function productsJsonUrl(saleUrl: string): string {
  const url = new URL(saleUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/products.json`;
  url.search = `?limit=${MAX_PRODUCTS_LIMIT}`;
  url.hash = '';
  return url.href;
}

/** True only for exactly `/collections/<handle>` (a final slash is fine), with no query: the one address that has a feed. */
export function isShopifyCollection(saleUrl: string): boolean {
  try {
    const url = new URL(saleUrl);
    return url.search === '' && /^\/collections\/[^/]+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

/** What happened to the feed: used (it gave a percentage), fallback (read the page instead), blocked, not allowed, or none. */
export type FeedState = 'used' | 'fallback' | 'blocked' | 'not_allowed' | 'none';

export interface FeedResult {
  text: string | null;
  state: FeedState;
  bytes: number;
}

const BLOCKED_STATUSES = new Set([401, 403, 429, 503]);

/**
 * Asks for the feed once. `robotsText` is the robots.txt already read for this store (null when the site has none),
 * so no second robots.txt request is made. Never throws, never retries, never reads more than 3 MiB.
 */
export async function fetchShopifyFeed(saleUrl: string, robotsText: string | null, deps: Deps): Promise<FeedResult> {
  const none: FeedResult = { text: null, state: 'none', bytes: 0 };
  if (!isShopifyCollection(saleUrl)) return none;
  const feedUrl = productsJsonUrl(saleUrl);
  const feed = new URL(feedUrl);
  if (robotsText !== null && !isAllowedByRobots(robotsText, `${feed.pathname}${feed.search}`)) return { ...none, state: 'not_allowed' };

  const answer = await fetchPage(feedUrl, deps.fetch);
  if (!answer.ok) return { ...none, state: 'fallback' };
  if (answer.status < 200 || answer.status > 299) {
    await discard(answer.response);
    return { ...none, state: BLOCKED_STATUSES.has(answer.status) ? 'blocked' : 'fallback' };
  }
  const body = await readLimited(answer.response, MAX_PAGE_BYTES);
  if (body === null) return { ...none, state: 'fallback' };
  // The state is `used` here; the caller turns it into `fallback` when the feed gave no percentage.
  return { text: body.text, state: 'used', bytes: body.bytes };
}

