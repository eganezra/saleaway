import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { productsJsonUrl, runProbe } from '../src/probe';
import { processStore } from '../src/process-store';
import { insertRun } from '../src/repo';
import { createTestDb, resetData, rows, seedRetailers } from './helpers/db';
import type { TestDb } from './helpers/db';
import { fakeDeps, fakeFetch, fakeFetchWithTrackedBody, fakeQueue, fakeRewriter, makeEnv } from './helpers/fakes';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 30_000);
afterAll(async () => {
  await t.dispose();
});
beforeEach(async () => {
  await resetData(t.db);
  await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 1);
});

const SALE = 'https://shop.example/collections/sale';
const ROBOTS = 'https://shop.example/robots.txt';
const OK_ROBOTS = { status: 200, body: 'User-agent: *\nDisallow:\n' };

describe('productsJsonUrl', () => {
  it('appends /products.json to the path, sets limit=250, and drops any query or fragment', () => {
    expect(productsJsonUrl('https://underarmour.co.za/collections/sale')).toBe('https://underarmour.co.za/collections/sale/products.json?limit=250');
    expect(productsJsonUrl('https://shop.example/collections/sale/')).toBe('https://shop.example/collections/sale/products.json?limit=250');
    expect(productsJsonUrl('https://shop.example/collections/sale?sort=price#top')).toBe('https://shop.example/collections/sale/products.json?limit=250');
  });
});

describe('the probe switch (MEASURE_CPU)', () => {
  it('off by default: no cpu_probe is logged, and the page is read only to be judged (Story 3.3)', async () => {
    await seedRetailers(t.db, [{ id: 1, saleUrl: SALE }]);
    const network = fakeFetchWithTrackedBody(SALE, { [ROBOTS]: OK_ROBOTS });
    const { deps, entries, named } = fakeDeps({ fetch: network.fetch, createRewriter: fakeRewriter({ a: 3 }) });
    await processStore(makeEnv(t.db, fakeQueue().queue), { runId: 1, retailerId: 1 }, deps);
    expect(named('cpu_probe')).toEqual([]);
    expect(entries.map((e) => e.message)).toEqual(['page_validated']);
  });

  it('any value other than the exact text "true" leaves it off', async () => {
    for (const value of ['false', 'TRUE', '1', '', 'yes']) {
      await resetData(t.db);
      await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 1);
      await seedRetailers(t.db, [{ id: 1, saleUrl: SALE }]);
      const network = fakeFetchWithTrackedBody(SALE, { [ROBOTS]: OK_ROBOTS });
      const { deps, named } = fakeDeps({ fetch: network.fetch, createRewriter: fakeRewriter() });
      await processStore(makeEnv(t.db, fakeQueue().queue, { MEASURE_CPU: value }), { runId: 1, retailerId: 1 }, deps);
      expect(named('cpu_probe'), value).toEqual([]);
      expect(named('page_validated'), value).toHaveLength(1);
    }
  });

  it('on: the body is read once, one cpu_probe line is logged with counts only, and the result is unchanged', async () => {
    await seedRetailers(t.db, [{ id: 1, slug: 'bash-tfg', saleUrl: SALE }]);
    const network = fakeFetchWithTrackedBody(SALE, { [ROBOTS]: OK_ROBOTS }, 200, 'x'.repeat(1234));
    const rewriter = fakeRewriter({ a: 3, script: 2, span: 5, '[class*="price"]': 4, 'script[type="application/ld+json"]': 1 });
    const { deps, named, entries } = fakeDeps({ fetch: network.fetch, createRewriter: rewriter });
    const result = await processStore(makeEnv(t.db, fakeQueue().queue, { MEASURE_CPU: 'true' }), { runId: 1, retailerId: 1 }, deps);
    expect(result).toBe('ok');
    expect(await rows(t.db, 'SELECT result, http_status FROM run_results')).toEqual([{ result: 'ok', http_status: 200 }]);
    expect(network.stats.pulls).toBeGreaterThan(0);
    expect(named('cpu_probe')).toEqual([
      { level: 'info', message: 'cpu_probe', fields: { slug: 'bash-tfg', bytes: 1234, anchors: 3, scripts: 2, spans: 5, priceElements: 4, jsonLd: 1, products: 0, comparePriced: 0 } },
    ]);
    // only the one line (the page is not also judged), and no field holds page text
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries)).not.toContain('xxxx');
  });

  it('on: a page that is not 2xx is not probed, and a manual store is never fetched', async () => {
    await seedRetailers(t.db, [{ id: 1, saleUrl: SALE }, { id: 2, extractionMethod: 'manual' }]);
    const blocked = fakeFetchWithTrackedBody(SALE, { [ROBOTS]: OK_ROBOTS }, 403);
    const a = fakeDeps({ fetch: blocked.fetch, createRewriter: fakeRewriter() });
    await processStore(makeEnv(t.db, fakeQueue().queue, { MEASURE_CPU: 'true' }), { runId: 1, retailerId: 1 }, a.deps);
    expect(blocked.stats.pulls).toBe(0);
    expect(a.named('cpu_probe')).toEqual([]);
    const none = fakeFetch({});
    const b = fakeDeps({ fetch: none.fetch, createRewriter: fakeRewriter() });
    await processStore(makeEnv(t.db, fakeQueue().queue, { MEASURE_CPU: 'true' }), { runId: 1, retailerId: 2 }, b.deps);
    expect(none.requests).toEqual([]);
  });
});

describe('runProbe', () => {
  const page = (body = 'page') => new Response(body, { status: 200 });

  it('a Shopify store makes the one extra products.json request and counts compare-at prices', async () => {
    const products = { products: [{ variants: [{ compare_at_price: '100.00' }, { compare_at_price: null }, { compare_at_price: '' }, {}] }, { variants: [{ compare_at_price: '50.00' }] }, { variants: [] }] };
    const network = fakeFetch({ 'https://shop.example/collections/sale/products.json?limit=250': { status: 200, body: JSON.stringify(products) } });
    const { deps, named } = fakeDeps({ fetch: network.fetch, createRewriter: fakeRewriter() });
    await runProbe({ slug: 'under-armour-sa', extractionMethod: 'shopify_json', saleUrl: SALE, response: page() }, deps);
    expect(network.urls()).toEqual(['https://shop.example/collections/sale/products.json?limit=250']);
    expect(named('cpu_probe')[0]?.fields).toMatchObject({ slug: 'under-armour-sa', products: 3, comparePriced: 2 });
  });

  it('a non-Shopify store makes no extra request', async () => {
    const network = fakeFetch({});
    const { deps } = fakeDeps({ fetch: network.fetch, createRewriter: fakeRewriter() });
    await runProbe({ slug: 'x', extractionMethod: 'html', saleUrl: SALE, response: page() }, deps);
    expect(network.requests).toEqual([]);
  });

  it('a products.json that fails or is not JSON is logged as a failed probe and never throws', async () => {
    const bad = fakeFetch({ 'https://shop.example/collections/sale/products.json?limit=250': { status: 200, body: 'not json' } });
    const a = fakeDeps({ fetch: bad.fetch, createRewriter: fakeRewriter() });
    await expect(runProbe({ slug: 'x', extractionMethod: 'shopify_json', saleUrl: SALE, response: page() }, a.deps)).resolves.toBeUndefined();
    expect(a.named('cpu_probe_failed')).toHaveLength(1);
    const down = fakeFetch({ 'https://shop.example/collections/sale/products.json?limit=250': { status: 503 } });
    const b = fakeDeps({ fetch: down.fetch, createRewriter: fakeRewriter() });
    await runProbe({ slug: 'x', extractionMethod: 'shopify_json', saleUrl: SALE, response: page() }, b.deps);
    expect(b.named('cpu_probe')[0]?.fields).toMatchObject({ products: 0, comparePriced: 0 });
  });

  it('without a rewriter it warns, frees the body and logs no probe line', async () => {
    const { deps, named } = fakeDeps();
    await runProbe({ slug: 'x', extractionMethod: 'html', saleUrl: SALE, response: page() }, deps);
    expect(named('cpu_probe_skipped')).toHaveLength(1);
    expect(named('cpu_probe')).toEqual([]);
  });

  it('keeps no log field the logger would drop', async () => {
    const { deps, entries } = fakeDeps({ createRewriter: fakeRewriter({ a: 1 }) });
    await runProbe({ slug: 'x', extractionMethod: 'html', saleUrl: SALE, response: page() }, deps);
    for (const entry of entries) for (const reserved of ['level', 'message', 'time']) expect(Object.keys(entry.fields ?? {})).not.toContain(reserved);
  });
});
