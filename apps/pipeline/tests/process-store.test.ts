import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { USER_AGENT } from '../src/fetcher';
import { processStore, recordStoreError } from '../src/process-store';
import { insertRun } from '../src/repo';
import { createTestDb, resetData, rows, seedRetailers } from './helpers/db';
import type { RetailerSeed, TestDb } from './helpers/db';
import { fakeDeps, fakeFetch, fakeFetchWithTrackedBody, fakeQueue, makeEnv } from './helpers/fakes';
import type { Spec } from './helpers/fakes';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 30_000);
afterAll(async () => {
  await t.dispose();
});

const SALE = 'https://shop.example/sale';
const ROBOTS = 'https://shop.example/robots.txt';
const OK_ROBOTS: Spec = { status: 200, body: 'User-agent: *\nDisallow: /cart\n' };

beforeEach(async () => {
  await resetData(t.db);
  await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 1);
});

async function runStore(seed: Partial<RetailerSeed>, routes: Record<string, Spec | Spec[]>, env: Record<string, string> = {}) {
  await seedRetailers(t.db, [{ id: 1, saleUrl: SALE, ...seed }]);
  const network = fakeFetch(routes);
  const { deps, named } = fakeDeps({ fetch: network.fetch, stepMs: 5 });
  const result = await processStore(makeEnv(t.db, fakeQueue().queue, env), { runId: 1, retailerId: 1 }, deps);
  const saved = await rows<{ result: string; http_status: number | null; error: string | null; duration_ms: number | null; discount_percent: number | null }>(
    t.db,
    'SELECT result, http_status, error, duration_ms, discount_percent FROM run_results',
  );
  return { result, saved, network, named };
}

describe('processStore: the requests', () => {
  it('asks for robots.txt first and then the page, once each, with the user-agent', async () => {
    const { network, result } = await runStore({}, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200 } });
    expect(result).toBe('ok');
    expect(network.urls()).toEqual([ROBOTS, SALE]);
    for (const request of network.requests) {
      expect((request.init?.headers as Record<string, string>)['User-Agent']).toBe(USER_AGENT);
    }
  });

  it('a manual store records skipped_manual and makes no request at all', async () => {
    const { saved, network } = await runStore({ extractionMethod: 'manual' }, {});
    expect(saved).toMatchObject([{ result: 'skipped_manual', http_status: null, error: null }]);
    expect(network.requests).toEqual([]);
  });
});

describe('processStore: each class of result', () => {
  it('200 is ok, with the status and the duration saved, and no error text', async () => {
    const { saved } = await runStore({}, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200 } });
    expect(saved).toEqual([{ result: 'ok', http_status: 200, error: null, duration_ms: 5, discount_percent: null }]);
  });

  it('200 on a store flagged verified_js_shell is js_only, and its page is never read', async () => {
    await seedRetailers(t.db, [{ id: 1, saleUrl: SALE, seedStatus: 'verified_js_shell' }]);
    const network = fakeFetchWithTrackedBody(SALE, { [ROBOTS]: OK_ROBOTS });
    await processStore(makeEnv(t.db, fakeQueue().queue), { runId: 1, retailerId: 1 }, fakeDeps({ fetch: network.fetch }).deps);
    expect(await rows(t.db, 'SELECT result, http_status, error FROM run_results')).toEqual([{ result: 'js_only', http_status: 200, error: null }]);
    expect(network.stats).toEqual({ pulls: 0, cancelled: true });
  });

  it('an ordinary ok page is not read either (reading is for the measurement probe only)', async () => {
    await seedRetailers(t.db, [{ id: 1, saleUrl: SALE }]);
    const network = fakeFetchWithTrackedBody(SALE, { [ROBOTS]: OK_ROBOTS });
    await processStore(makeEnv(t.db, fakeQueue().queue), { runId: 1, retailerId: 1 }, fakeDeps({ fetch: network.fetch }).deps);
    expect(await rows(t.db, 'SELECT result FROM run_results')).toEqual([{ result: 'ok' }]);
    expect(network.stats).toEqual({ pulls: 0, cancelled: true });
  });

  it('401, 403, 429 and 503 are blocked with the status in the error text', async () => {
    for (const status of [401, 403, 429, 503]) {
      await resetData(t.db);
      await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 1);
      const { saved } = await runStore({}, { [ROBOTS]: OK_ROBOTS, [SALE]: { status } });
      expect(saved, String(status)).toMatchObject([{ result: 'blocked', http_status: status, error: `http_${status}` }]);
    }
  });

  it('404 and 410 are not_found', async () => {
    for (const status of [404, 410]) {
      await resetData(t.db);
      await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 1);
      const { saved } = await runStore({}, { [ROBOTS]: OK_ROBOTS, [SALE]: { status } });
      expect(saved, String(status)).toMatchObject([{ result: 'not_found', http_status: status, error: `http_${status}` }]);
    }
  });

  it('500, 502 and 405 are errors', async () => {
    for (const status of [500, 502, 405]) {
      await resetData(t.db);
      await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 1);
      const { saved } = await runStore({}, { [ROBOTS]: OK_ROBOTS, [SALE]: { status } });
      expect(saved, String(status)).toMatchObject([{ result: 'error', http_status: status, error: `http_${status}` }]);
    }
  });

  it('a redirect to another site is redirected_away, and says where', async () => {
    const { saved } = await runStore({}, {
      [ROBOTS]: OK_ROBOTS,
      [SALE]: { status: 302, headers: { Location: 'https://other.example/landing' } },
      'https://other.example/landing': { status: 200 },
    });
    expect(saved).toMatchObject([{ result: 'redirected_away', http_status: 200, error: 'redirected_to_other.example' }]);
  });

  it('a redirect to the home page is redirected_away', async () => {
    const { saved } = await runStore({}, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 301, headers: { Location: '/' } }, 'https://shop.example/': { status: 200 } });
    expect(saved).toMatchObject([{ result: 'redirected_away', error: 'redirected_to_shop.example' }]);
  });

  it('a redirect to another page of the same site is ok', async () => {
    const { saved } = await runStore({}, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 301, headers: { Location: '/collections/sale' } }, 'https://shop.example/collections/sale': { status: 200 } });
    expect(saved).toMatchObject([{ result: 'ok', http_status: 200, error: null }]);
  });

  it('a timeout, a network failure and too many redirects are errors with their reason', async () => {
    const cases: Array<[string, Spec | Spec[], string]> = [
      ['timeout', { throws: 'timeout' }, 'timeout'],
      ['network', { throws: 'network' }, 'network'],
      ['loop', { status: 302, headers: { Location: SALE } }, 'too_many_redirects'],
      ['unsafe redirect', { status: 302, headers: { Location: 'http://shop.example/sale' } }, 'unsafe_redirect'],
    ];
    for (const [name, spec, reason] of cases) {
      await resetData(t.db);
      await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 1);
      const { saved } = await runStore({}, { [ROBOTS]: OK_ROBOTS, [SALE]: spec });
      expect(saved, name).toMatchObject([{ result: 'error', http_status: null, error: reason }]);
    }
  });

  it('a missing or unsafe sale URL is an error and nothing is requested', async () => {
    for (const saleUrl of [null, 'http://shop.example/sale', 'https://127.0.0.1/sale', 'https://localhost./sale']) {
      await resetData(t.db);
      await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 1);
      const { saved, network } = await runStore({ saleUrl }, {});
      expect(saved, String(saleUrl)).toMatchObject([{ result: 'error', error: 'unsafe_url' }]);
      expect(network.requests, String(saleUrl)).toEqual([]);
    }
  });
});

describe('processStore: robots.txt', () => {
  it('a robots.txt that forbids the page records blocked and never requests the page', async () => {
    const { saved, network } = await runStore({}, { [ROBOTS]: { status: 200, body: 'User-agent: *\nDisallow: /sale\n' }, [SALE]: { status: 200 } });
    expect(saved).toMatchObject([{ result: 'blocked', http_status: null, error: 'robots_disallow' }]);
    expect(network.urls()).toEqual([ROBOTS]);
  });

  it('a rule for SaleawayBot by name is obeyed', async () => {
    const { saved } = await runStore({}, { [ROBOTS]: { status: 200, body: 'User-agent: SaleawayBot\nDisallow: /\n' } });
    expect(saved).toMatchObject([{ result: 'blocked', error: 'robots_disallow' }]);
  });

  it('a robots.txt that cannot be reached records an error and never requests the page', async () => {
    for (const spec of [{ status: 503 }, { status: 500 }, { throws: 'timeout' }, { throws: 'network' }] as Spec[]) {
      await resetData(t.db);
      await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 1);
      const { saved, network } = await runStore({}, { [ROBOTS]: spec, [SALE]: { status: 200 } });
      expect(saved, JSON.stringify(spec)).toMatchObject([{ result: 'error', error: 'robots_unreachable' }]);
      expect(network.urls(), JSON.stringify(spec)).toEqual([ROBOTS]);
    }
  });

  it('a missing robots.txt (404 or 403) lets the page be fetched', async () => {
    for (const status of [404, 403]) {
      await resetData(t.db);
      await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 1);
      const { saved, network } = await runStore({}, { [ROBOTS]: { status }, [SALE]: { status: 200 } });
      expect(saved, String(status)).toMatchObject([{ result: 'ok' }]);
      expect(network.urls(), String(status)).toEqual([ROBOTS, SALE]);
    }
  });

  it('matches the rule against the path and the query of the sale URL', async () => {
    const url = 'https://shop.example/sale?sort=price';
    const { saved } = await runStore({ saleUrl: url }, { [ROBOTS]: { status: 200, body: 'User-agent: *\nDisallow: /*?sort=\n' }, [url]: { status: 200 } });
    expect(saved).toMatchObject([{ result: 'blocked', error: 'robots_disallow' }]);
  });
});

describe('processStore: what it must never do', () => {
  it('a blocked store is returned, not thrown, so the queue does not retry it', async () => {
    const { result } = await runStore({}, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 403 } });
    expect(result).toBe('blocked');
  });

  it('never retries a blocked page: exactly one page request even for a 403', async () => {
    const { network } = await runStore({}, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 403 } });
    expect(network.urls().filter((url) => url === SALE)).toHaveLength(1);
  });

  it('the same job twice leaves one row, and two runs keep two rows', async () => {
    await seedRetailers(t.db, [{ id: 1, saleUrl: SALE }]);
    const network = fakeFetch({ [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200 } });
    const env = makeEnv(t.db, fakeQueue().queue);
    const { deps } = fakeDeps({ fetch: network.fetch });
    await processStore(env, { runId: 1, retailerId: 1 }, deps);
    await processStore(env, { runId: 1, retailerId: 1 }, deps);
    expect(await rows(t.db, 'SELECT run_id FROM run_results')).toHaveLength(1);
    await insertRun(t.db, '2026-10-30T09:00:00Z', 'manual', 1);
    await processStore(env, { runId: 2, retailerId: 1 }, deps);
    expect(await rows(t.db, 'SELECT run_id FROM run_results ORDER BY run_id')).toEqual([{ run_id: 1 }, { run_id: 2 }]);
  });

  it('never writes sale_records or overrides, and never changes the store', async () => {
    await runStore({ seedStatus: 'verified_js_shell' }, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200 } });
    expect(await rows(t.db, 'SELECT COUNT(*) AS n FROM sale_records')).toEqual([{ n: 0 }]);
    expect(await rows(t.db, 'SELECT COUNT(*) AS n FROM overrides')).toEqual([{ n: 0 }]);
    expect(await rows(t.db, 'SELECT extraction_method, is_visible, sale_url FROM retailers')).toEqual([{ extraction_method: 'html', is_visible: 1, sale_url: SALE }]);
  });

  it('logs a store that no longer exists and writes nothing, without throwing', async () => {
    const { deps, named } = fakeDeps();
    await expect(processStore(makeEnv(t.db, fakeQueue().queue), { runId: 1, retailerId: 999 }, deps)).resolves.toBe('error');
    expect(named('retailer_not_found')).toHaveLength(1);
    expect(await rows(t.db, 'SELECT COUNT(*) AS n FROM run_results')).toEqual([{ n: 0 }]);
  });

  it('cuts a long error text to 200 characters', async () => {
    const host = `${'a'.repeat(190)}.example`;
    const url = `https://shop.example/x`;
    const { saved } = await runStore({ saleUrl: url }, { 'https://shop.example/robots.txt': OK_ROBOTS, [url]: { status: 302, headers: { Location: `https://${host}/` } }, [`https://${host}/`]: { status: 200 } });
    expect(saved[0]?.error?.length).toBeLessThanOrEqual(200);
    expect(saved[0]?.result).toBe('redirected_away');
  });
});

describe('recordStoreError', () => {
  beforeEach(async () => {
    await seedRetailers(t.db, [{ id: 1 }]);
  });
  const env = () => makeEnv(t.db, fakeQueue().queue);
  const saved = () => rows(t.db, 'SELECT retailer_id, result, duration_ms, error FROM run_results');

  it('records an error result with the text, cut to 200 characters', async () => {
    await recordStoreError(env(), { runId: 1, retailerId: 1 }, 'x'.repeat(500), fakeDeps().deps);
    const [row] = await saved();
    expect(row).toMatchObject({ retailer_id: 1, result: 'error', duration_ms: null });
    expect(String(row?.error)).toHaveLength(200);
  });

  it('replaces an earlier result for the same run and store', async () => {
    const network = fakeFetch({ [`https://store-1.example/robots.txt`]: { status: 200, body: '' }, 'https://store-1.example/sale': { status: 200 } });
    await processStore(env(), { runId: 1, retailerId: 1 }, fakeDeps({ fetch: network.fetch }).deps);
    await recordStoreError(env(), { runId: 1, retailerId: 1 }, 'boom', fakeDeps().deps);
    expect(await saved()).toMatchObject([{ retailer_id: 1, result: 'error', error: 'boom' }]);
  });
});
