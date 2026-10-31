import { describe, expect, it } from 'vitest';
import { MAX_PAGE_BYTES } from '@saleaway/core';
import { fetchShopifyFeed, isShopifyCollection, productsJsonUrl } from '../src/shopify';
import { fakeDeps, fakeFetch } from './helpers/fakes';

const SALE = 'https://shop.example/collections/sale';
const FEED = 'https://shop.example/collections/sale/products.json?limit=250';
const FEED_JSON = JSON.stringify({ products: [{ variants: [{ price: '50.00', compare_at_price: '100.00' }] }] });
const OPEN = 'User-agent: *\nDisallow: /cart\n';

describe('productsJsonUrl', () => {
  it('appends /products.json to the path, sets limit=250, and drops any query or fragment', () => {
    expect(productsJsonUrl('https://underarmour.co.za/collections/sale')).toBe('https://underarmour.co.za/collections/sale/products.json?limit=250');
    expect(productsJsonUrl('https://shop.example/collections/sale/')).toBe('https://shop.example/collections/sale/products.json?limit=250');
    expect(productsJsonUrl('https://shop.example/collections/sale?sort=price#top')).toBe('https://shop.example/collections/sale/products.json?limit=250');
  });
});

describe('isShopifyCollection', () => {
  it('is true only for exactly /collections/<handle>, with or without a final slash', () => {
    for (const url of ['https://shop.example/collections/sale', 'https://shop.example/collections/sale/', 'https://shop.example/collections/clearance-sale', 'https://SHOP.example/collections/a_b']) expect(isShopifyCollection(url), url).toBe(true);
  });
  it('is false for a hub page, a product page, the home page, a deeper path, a query, a bare /collections and anything that is not an address', () => {
    for (const url of ['https://ngf.co.za/pages/promotions', 'https://benjiandmoon.co.za/products/sale', 'https://shop.example/', 'https://shop.example/collections', 'https://shop.example/collections/', 'https://shop.example/collections/sale/extra', 'https://shop.example/collections/sale?sort=price', 'https://shop.example/collection/sale', '', 'not a url']) {
      expect(isShopifyCollection(url), url).toBe(false);
    }
  });
});

describe('fetchShopifyFeed', () => {
  const run = (routes: Parameters<typeof fakeFetch>[0], robotsText: string | null = OPEN, saleUrl = SALE) => {
    const network = fakeFetch(routes);
    const { deps } = fakeDeps({ fetch: network.fetch });
    return fetchShopifyFeed(saleUrl, robotsText, deps).then((result) => ({ result, network }));
  };

  it('asks for the feed once, with the pipeline user-agent, and returns its text', async () => {
    const { result, network } = await run({ [FEED]: { status: 200, body: FEED_JSON } });
    expect(result).toEqual({ text: FEED_JSON, state: 'used', bytes: FEED_JSON.length });
    expect(network.urls()).toEqual([FEED]);
    expect((network.requests[0]?.init?.headers as Record<string, string>)['User-Agent']).toContain('SaleawayBot/1.0');
  });
  it('makes no request for an address that is not a collection', async () => {
    for (const url of ['https://ngf.co.za/pages/promotions', 'https://benjiandmoon.co.za/products/sale', 'https://shop.example/']) {
      const { result, network } = await run({}, OPEN, url);
      expect(result, url).toEqual({ text: null, state: 'none', bytes: 0 });
      expect(network.requests, url).toEqual([]);
    }
  });
  it('makes no request when robots.txt forbids the feed path, using the text already read', async () => {
    for (const rule of ['Disallow: /collections/*/products.json', 'Disallow: /collections/', 'Disallow: /']) {
      const { result, network } = await run({}, `User-agent: *\n${rule}\n`);
      expect(result, rule).toEqual({ text: null, state: 'not_allowed', bytes: 0 });
      expect(network.requests, rule).toEqual([]);
    }
  });
  it('asks when robots.txt did not exist (no text), and when it allows the path', async () => {
    expect((await run({ [FEED]: { status: 200, body: FEED_JSON } }, null)).result.state).toBe('used');
    expect((await run({ [FEED]: { status: 200, body: FEED_JSON } }, 'User-agent: *\nDisallow: /cart\nAllow: /collections/\n')).result.state).toBe('used');
  });
  it('is blocked on 401, 403, 429 and 503, and never asks twice', async () => {
    for (const status of [401, 403, 429, 503]) {
      const { result, network } = await run({ [FEED]: { status } });
      expect(result, String(status)).toEqual({ text: null, state: 'blocked', bytes: 0 });
      expect(network.urls(), String(status)).toEqual([FEED]);
    }
  });
  it('falls back on 404, 500, a timeout, a network failure and an endless redirect', async () => {
    for (const spec of [{ status: 404 }, { status: 500 }, { throws: 'timeout' as const }, { throws: 'network' as const }, { status: 301, headers: { Location: FEED } }]) {
      const { result, network } = await run({ [FEED]: spec });
      expect(result, JSON.stringify(spec)).toEqual({ text: null, state: 'fallback', bytes: 0 });
      expect(network.requests.length, JSON.stringify(spec)).toBeLessThanOrEqual(4); // at most the redirect chain of one request
    }
  });
  it('reads at most 3 MiB of the feed', async () => {
    const big = 'x'.repeat(MAX_PAGE_BYTES + 1000);
    const { result } = await run({ [FEED]: { status: 200, body: big } });
    expect(result.bytes).toBe(MAX_PAGE_BYTES);
    expect(result.state).toBe('used');
  });
});
