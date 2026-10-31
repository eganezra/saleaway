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

describe('processStore: page validation (Story 3.3)', () => {
  const SALE_PAGE = '<html><head><title>Sale</title></head><body><ol><li><span class="old-price">R999</span><span class="price">R499</span></li><li><span class="old-price">R599</span><span class="price">R299</span></li></ol></body></html>';

  /** A fetch that answers robots.txt and serves `body` as the page, counting how many reads the page body gets. */
  function streamFetch(body: ReadableStream<Uint8Array>) {
    const requests: string[] = [];
    const fetchFn = async (input: string) => {
      requests.push(input);
      if (input === ROBOTS) return new Response('User-agent: *\nDisallow: /cart\n', { status: 200 });
      if (input === SALE) return new Response(body, { status: 200 });
      throw new TypeError(`no route for ${input}`);
    };
    return { fetch: fetchFn, requests };
  }

  it('reads an ok page once, judges it and logs one page_validated line with counts only', async () => {
    await seedRetailers(t.db, [{ id: 1, slug: 'shop', saleUrl: SALE }]);
    const network = fakeFetchWithTrackedBody(SALE, { [ROBOTS]: OK_ROBOTS }, 200, SALE_PAGE);
    const { deps, named, entries } = fakeDeps({ fetch: network.fetch });
    const result = await processStore(makeEnv(t.db, fakeQueue().queue), { runId: 1, retailerId: 1 }, deps);
    expect(result).toBe('ok');
    expect(network.stats.pulls).toBeGreaterThan(0);
    const lines = named('page_validated');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe('info');
    expect(lines[0]?.fields).toMatchObject({ slug: 'shop', verdict: 'valid', reason: 'discounts_found', bytes: SALE_PAGE.length, truncated: false, amounts: 4, wasPrices: 2, percentLabels: 0, structured: 0, saveLabels: 0, scripts: 0 });
    expect(Object.keys(lines[0]?.fields ?? {}).sort()).toEqual(
      ['amounts', 'bytes', 'percentLabels', 'reason', 'saveLabels', 'scripts', 'slug', 'structured', 'textLength', 'truncated', 'verdict', 'wasPrices'].sort(),
    );
    // no field holds page text, and no field uses a name the logger would drop
    expect(JSON.stringify(entries)).not.toContain('old-price');
    expect(JSON.stringify(entries)).not.toContain('Sale');
    for (const reserved of ['level', 'message', 'time']) expect(Object.keys(lines[0]?.fields ?? {})).not.toContain(reserved);
  });

  it('saves the result row as before, with the discount read from the page, and the record with it', async () => {
    const { saved } = await runStore({}, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200, body: SALE_PAGE } });
    // since Story 3.4 the deepest discount of a valid page is saved with the result (two old-price pairs of 50 percent)
    expect(saved).toMatchObject([{ result: 'ok', http_status: 200, error: null, discount_percent: 50 }]);
    // since Story 3.5 the page also makes a sale record, saved with the result
    expect(await rows(t.db, 'SELECT state, validation FROM sale_records')).toEqual([{ state: 'active', validation: 'content_verified' }]);
  });

  it('a page that says no sale is only logged: the class stays ok and the row is unchanged', async () => {
    const { saved, named } = await runStore({}, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200, body: '<html><title>Page not found</title></html>' } });
    expect(saved).toMatchObject([{ result: 'ok', error: null }]);
    expect(named('page_validated')[0]?.fields).toMatchObject({ verdict: 'ended', reason: 'error_page' });
  });

  it('reads at most 3 MiB: a longer page is cut, logged as truncated, and the rest is never read', async () => {
    await seedRetailers(t.db, [{ id: 1, slug: 'big', saleUrl: SALE }]);
    const chunk = new TextEncoder().encode(`${'x'.repeat(1023)}\n`); // 1 KiB
    let pulls = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          controller.enqueue(chunk); // endless
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const network = streamFetch(stream);
    const { deps, named } = fakeDeps({ fetch: network.fetch });
    await processStore(makeEnv(t.db, fakeQueue().queue), { runId: 1, retailerId: 1 }, deps);
    expect(named('page_validated')[0]?.fields).toMatchObject({ slug: 'big', truncated: true, bytes: 3 * 1024 * 1024 });
    expect(pulls).toBeLessThanOrEqual(3 * 1024 + 2);
    expect(cancelled).toBe(true);
    expect(named('page_validated')[0]?.fields).toMatchObject({ verdict: 'unverifiable', reason: 'unreadable' });
  });

  it('judges a cut page as unreadable, not as "no discounts": the truncated flag reaches the validator', async () => {
    // Priced products and no discount, longer than 3 MiB: whole, it would be no_discounts; cut, it cannot be judged.
    const text = `<html><body>${'<p>R10</p>'.repeat(Math.ceil((3 * 1024 * 1024 + 100) / 9))}</body></html>`;
    const { named } = await runStore({}, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200, body: text } });
    expect(named('page_validated')[0]?.fields).toMatchObject({ truncated: true, verdict: 'unverifiable', reason: 'unreadable' });
    // whole: the store's address says /sale, so a listing with no discount signal is "not readable" (Story 3.10), not ended
    const whole = await runStore2(`<html><body>${'<p>R10</p>'.repeat(10)}</body></html>`);
    expect(whole.named('page_validated')[0]?.fields).toMatchObject({ truncated: false, verdict: 'unverifiable', reason: 'discounts_not_readable' });
  });

  /** A second ok store run, after clearing the database. */
  async function runStore2(body: string) {
    await resetData(t.db);
    await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 1);
    return runStore({}, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200, body } });
  }

  it('never reads the body of a js_only, blocked, not found, redirected away or error answer', async () => {
    const cases: Array<[string, Partial<RetailerSeed>, number]> = [
      ['js_only', { seedStatus: 'verified_js_shell' }, 200],
      ['blocked', {}, 403],
      ['not_found', {}, 404],
      ['error', {}, 500],
    ];
    for (const [name, seed, status] of cases) {
      await resetData(t.db);
      await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 1);
      await seedRetailers(t.db, [{ id: 1, saleUrl: SALE, ...seed }]);
      const network = fakeFetchWithTrackedBody(SALE, { [ROBOTS]: OK_ROBOTS }, status);
      const { deps, named } = fakeDeps({ fetch: network.fetch });
      await processStore(makeEnv(t.db, fakeQueue().queue), { runId: 1, retailerId: 1 }, deps);
      expect(network.stats, name).toEqual({ pulls: 0, cancelled: true });
      expect(named('page_validated'), name).toEqual([]);
    }
    // redirected away: the final page is on another site
    await resetData(t.db);
    await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 1);
    const { named, network } = await runStore({}, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 301, headers: { Location: 'https://other.example/' } }, 'https://other.example/': { status: 200, body: SALE_PAGE } });
    expect(named('page_validated')).toEqual([]);
    expect(network.urls()).toContain('https://other.example/');
  });

  it('a page whose body fails mid-read is logged as page_read_failed, the result is unchanged and nothing is thrown', async () => {
    await seedRetailers(t.db, [{ id: 1, slug: 'shop', saleUrl: SALE }]);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('timeout'));
      },
    });
    const { deps, named } = fakeDeps({ fetch: streamFetch(stream).fetch });
    const result = await processStore(makeEnv(t.db, fakeQueue().queue), { runId: 1, retailerId: 1 }, deps);
    expect(result).toBe('ok');
    expect(named('page_read_failed')[0]?.fields).toEqual({ slug: 'shop' });
    expect(named('page_validated')).toEqual([]);
    expect(await rows(t.db, 'SELECT result FROM run_results')).toEqual([{ result: 'ok' }]);
  });

  it('a validator that throws is logged as validation_failed and the store is still recorded', async () => {
    await seedRetailers(t.db, [{ id: 1, slug: 'shop', saleUrl: SALE }]);
    const network = fakeFetch({ [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200, body: SALE_PAGE } });
    const { deps, named } = fakeDeps({ fetch: network.fetch });
    deps.validate = () => {
      throw new Error('boom');
    };
    const result = await processStore(makeEnv(t.db, fakeQueue().queue), { runId: 1, retailerId: 1 }, deps);
    expect(result).toBe('ok');
    expect(named('validation_failed')[0]?.fields).toMatchObject({ slug: 'shop' });
    expect(named('validation_failed')[0]?.level).toBe('warn');
    expect(await rows(t.db, 'SELECT result FROM run_results')).toEqual([{ result: 'ok' }]);
  });

  it('with MEASURE_CPU on the probe runs and the page is not judged', async () => {
    const { named } = await runStore({}, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200, body: SALE_PAGE } }, { MEASURE_CPU: 'true' });
    expect(named('page_validated')).toEqual([]);
  });
});

describe('processStore: sale records (Story 3.5)', () => {
  const NIGHT1 = '2026-10-30T03:10:00.000Z';
  const NIGHT2 = '2026-10-31T03:10:00.000Z';
  const PAGE_OK = '<html><head><title>Sale</title></head><body><ol><li><span class="old-price">R999</span><span>R499</span></li><li><span class="old-price">R599</span><span>R299</span></li></ol></body></html>';
  // A plain listing: no discount, and neither its title nor the address (/women) calls it a sale, so it ends the sale (Story 3.10).
  const PLAIN = 'https://shop.example/women';
  const PAGE_NO_SALE = '<html><head><title>Women\'s Tops</title></head><body><ol><li>R100</li><li>R200</li><li>R300</li></ol></body></html>';
  type SaleRow = { state: string; validation: string; discount_percent: number | null; last_result: string; first_seen_at: string | null; last_checked_at: string; last_validated_at: string | null; ended_at: string | null };
  const records = () => rows<SaleRow>(t.db, 'SELECT state, validation, discount_percent, last_result, first_seen_at, last_checked_at, last_validated_at, ended_at FROM sale_records');

  /** One night: a new run, then the store processed with the clock at `start`. */
  async function night(runId: number, start: string, routes: Record<string, Spec | Spec[]>) {
    if (runId > 1) await insertRun(t.db, start.replace('.000', ''), 'cron', 1);
    const network = fakeFetch(routes);
    const { deps, named } = fakeDeps({ start, fetch: network.fetch });
    const result = await processStore(makeEnv(t.db, fakeQueue().queue), { runId, retailerId: 1 }, deps);
    return { result, named, network };
  }

  it('a valid page saves an active, content-verified record, validated at the time of the run, with its percentage', async () => {
    await seedRetailers(t.db, [{ id: 1, saleUrl: SALE }]);
    await night(1, NIGHT1, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200, body: PAGE_OK } });
    expect(await records()).toEqual([
      { state: 'active', validation: 'content_verified', discount_percent: 50, last_result: 'ok', first_seen_at: '2026-10-30T03:10:00Z', last_checked_at: '2026-10-30T03:10:00Z', last_validated_at: '2026-10-30T03:10:00Z', ended_at: null },
    ]);
  });

  it('a page with no sale ends the sale, and a valid page on the next night starts a new one', async () => {
    await seedRetailers(t.db, [{ id: 1, saleUrl: PLAIN }]);
    await night(1, NIGHT1, { [ROBOTS]: OK_ROBOTS, [PLAIN]: { status: 200, body: PAGE_OK } });
    await night(2, NIGHT2, { [ROBOTS]: OK_ROBOTS, [PLAIN]: { status: 200, body: PAGE_NO_SALE } });
    expect(await records()).toMatchObject([{ state: 'ended', validation: 'none', last_result: 'ok', ended_at: '2026-10-31T03:10:00Z', last_validated_at: '2026-10-30T03:10:00Z', first_seen_at: '2026-10-30T03:10:00Z' }]);
    await insertRun(t.db, '2026-11-01T03:10:00Z', 'cron', 1);
    const network = fakeFetch({ [ROBOTS]: OK_ROBOTS, [PLAIN]: { status: 200, body: PAGE_OK } });
    await processStore(makeEnv(t.db, fakeQueue().queue), { runId: 3, retailerId: 1 }, fakeDeps({ start: '2026-11-01T03:10:00.000Z', fetch: network.fetch }).deps);
    expect(await records()).toMatchObject([{ state: 'active', validation: 'content_verified', ended_at: null, first_seen_at: '2026-11-01T03:10:00Z', last_validated_at: '2026-11-01T03:10:00Z' }]);
  });

  it('a page priced in ZAR with was prices is valid and saves its percentage (Story 3.10)', async () => {
    await seedRetailers(t.db, [{ id: 1, saleUrl: SALE }]);
    const ZAR_PAGE = '<html><head><title>Specials</title></head><body><ol><li><span class="special-price">ZAR 69.00</span><span class="old-price">ZAR 80.00</span></li><li><span class="special-price">ZAR 45.00</span><span class="old-price">ZAR 60.00</span></li></ol></body></html>';
    await night(1, NIGHT1, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200, body: ZAR_PAGE } });
    expect(await records()).toMatchObject([{ state: 'active', validation: 'content_verified', discount_percent: 25 }]);
  });

  it('a specials page with priced products and no readable discount stays active, URL-verified, with no percentage (Story 3.10)', async () => {
    await seedRetailers(t.db, [{ id: 1, saleUrl: SALE }]);
    const SPECIALS = '<html><head><title>Tech Deals &amp; Specials</title></head><body><ol><li>R 99</li><li>R 1,299</li><li>R 8,499</li></ol></body></html>';
    await night(1, NIGHT1, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200, body: SPECIALS } });
    expect(await records()).toMatchObject([{ state: 'active', validation: 'url_verified', discount_percent: null, ended_at: null }]);
  });

  it('a 404 ends the sale', async () => {
    await seedRetailers(t.db, [{ id: 1, saleUrl: SALE }]);
    await night(1, NIGHT1, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 404 } });
    expect(await records()).toMatchObject([{ state: 'ended', last_result: 'not_found', ended_at: '2026-10-30T03:10:00Z' }]);
  });

  it('a js_only store gets an active, URL-verified record, validated now', async () => {
    await seedRetailers(t.db, [{ id: 1, saleUrl: SALE, seedStatus: 'verified_js_shell' }]);
    await night(1, NIGHT1, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200, body: '<div id="root"></div>' } });
    expect(await records()).toMatchObject([{ state: 'active', validation: 'url_verified', last_result: 'js_only', last_validated_at: '2026-10-30T03:10:00Z' }]);
  });

  it('a page that cannot be judged (a JavaScript application) is active and URL-verified', async () => {
    await seedRetailers(t.db, [{ id: 1, saleUrl: SALE }]);
    await night(1, NIGHT1, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200, body: '<html><body><div id="root"></div></body></html>' } });
    expect(await records()).toMatchObject([{ state: 'active', validation: 'url_verified', last_result: 'ok' }]);
  });

  it('a blocked or error night keeps the last good record and changes only last_result and last_checked_at', async () => {
    for (const [status, last] of [[403, 'blocked'], [500, 'error']] as const) {
      await resetData(t.db);
      await seedRetailers(t.db, [{ id: 1, saleUrl: SALE }]);
      await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 1);
      await night(1, NIGHT1, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200, body: PAGE_OK } });
      const before = (await records())[0];
      await night(2, NIGHT2, { [ROBOTS]: OK_ROBOTS, [SALE]: { status } });
      expect((await records())[0], String(status)).toEqual({ ...before, last_result: last, last_checked_at: '2026-10-31T03:10:00Z' });
    }
  });

  it('a first night that is blocked makes an unknown record; a robots refusal and a timeout do the same', async () => {
    const cases: Array<[Record<string, Spec | Spec[]>, string]> = [
      [{ [ROBOTS]: OK_ROBOTS, [SALE]: { status: 429 } }, 'blocked'],
      [{ [ROBOTS]: { status: 200, body: 'User-agent: *\nDisallow: /\n' } }, 'blocked'],
      [{ [ROBOTS]: OK_ROBOTS, [SALE]: { throws: 'timeout' } }, 'error'],
    ];
    for (const [routes, last] of cases) {
      await resetData(t.db);
      await seedRetailers(t.db, [{ id: 1, saleUrl: SALE }]);
      await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 1);
      await night(1, NIGHT1, routes);
      expect(await records(), last).toEqual([
        { state: 'unknown', validation: 'none', discount_percent: null, last_result: last, first_seen_at: null, last_checked_at: '2026-10-30T03:10:00Z', last_validated_at: null, ended_at: null },
      ]);
    }
  });

  it('a validator that throws keeps the record: it is not a validation', async () => {
    await seedRetailers(t.db, [{ id: 1, saleUrl: SALE }]);
    await night(1, NIGHT1, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200, body: PAGE_OK } });
    const before = (await records())[0];
    await insertRun(t.db, '2026-10-31T03:10:00Z', 'cron', 1);
    const network = fakeFetch({ [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200, body: PAGE_OK } });
    const { deps } = fakeDeps({ start: NIGHT2, fetch: network.fetch });
    deps.validate = () => {
      throw new Error('boom');
    };
    await processStore(makeEnv(t.db, fakeQueue().queue), { runId: 2, retailerId: 1 }, deps);
    expect((await records())[0]).toEqual({ ...before, last_checked_at: '2026-10-31T03:10:00Z' });
  });

  it('a manual store writes no record and makes no request', async () => {
    await seedRetailers(t.db, [{ id: 1, extractionMethod: 'manual' }]);
    const { network } = await night(1, NIGHT1, {});
    expect(network.requests).toEqual([]);
    expect(await records()).toEqual([]);
    expect(await rows(t.db, 'SELECT result FROM run_results')).toEqual([{ result: 'skipped_manual' }]);
  });

  it('saving the same job twice leaves one record', async () => {
    await seedRetailers(t.db, [{ id: 1, saleUrl: SALE }]);
    await night(1, NIGHT1, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200, body: PAGE_OK } });
    await night(1, NIGHT1, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200, body: PAGE_OK } });
    expect(await records()).toHaveLength(1);
    expect(await rows(t.db, 'SELECT COUNT(*) AS n FROM run_results')).toEqual([{ n: 1 }]);
  });

  it('stamps the record with the same time as the result row: the end of the store job, not its start', async () => {
    await seedRetailers(t.db, [{ id: 1, saleUrl: SALE }]);
    const network = fakeFetch({ [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200, body: PAGE_OK } });
    const { deps } = fakeDeps({ start: NIGHT1, stepMs: 2000, fetch: network.fetch }); // every clock read is 2 seconds later
    await processStore(makeEnv(t.db, fakeQueue().queue), { runId: 1, retailerId: 1 }, deps);
    const [result] = await rows<{ created_at: string }>(t.db, 'SELECT created_at FROM run_results');
    const [record] = await records();
    expect(record?.last_checked_at).toBe(result?.created_at);
    expect(record?.last_validated_at).toBe(result?.created_at);
    expect(result?.created_at).not.toBe('2026-10-30T03:10:00Z'); // it is later than the start
  });

  it('the result row is the same as before whatever the record does', async () => {
    await seedRetailers(t.db, [{ id: 1, saleUrl: SALE }]);
    await night(1, NIGHT1, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200, body: PAGE_NO_SALE } });
    expect(await rows(t.db, 'SELECT result, http_status, error, discount_percent FROM run_results')).toEqual([{ result: 'ok', http_status: 200, error: null, discount_percent: null }]);
  });

  it('never writes an override or changes the store, and no record column holds page text', async () => {
    await seedRetailers(t.db, [{ id: 1, saleUrl: SALE }]);
    await night(1, NIGHT1, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200, body: PAGE_OK } });
    expect(await rows(t.db, 'SELECT COUNT(*) AS n FROM overrides')).toEqual([{ n: 0 }]);
    expect(await rows(t.db, 'SELECT extraction_method, is_visible, sale_url FROM retailers')).toEqual([{ extraction_method: 'html', is_visible: 1, sale_url: SALE }]);
    const text = JSON.stringify(await records());
    for (const word of ['old-price', 'Sale', 'html', 'R999', 'R499']) expect(text).not.toContain(word);
  });
});

describe('processStore: discount extraction (Story 3.4)', () => {
  const COLLECTION = 'https://shop.example/collections/sale';
  const FEED = 'https://shop.example/collections/sale/products.json?limit=250';
  const pairs = (...percents: number[]) =>
    `<html><head><title>Sale</title></head><body><ol>${percents.map((p) => `<li><span class="old-price">R100</span><span>R${100 - p}</span></li>`).join('')}</ol></body></html>`; // a valid page: old-price pairs
  const FEED_40 = JSON.stringify({ products: [{ variants: [{ price: '60.00', compare_at_price: '100.00' }] }] });
  const records = () => rows<{ discount_percent: number | null }>(t.db, 'SELECT discount_percent FROM sale_records');
  const results = () => rows<{ discount_percent: number | null }>(t.db, 'SELECT discount_percent FROM run_results');

  async function run(seed: Partial<RetailerSeed>, routes: Record<string, Spec | Spec[]>, tweak?: (deps: ReturnType<typeof fakeDeps>['deps']) => void) {
    await seedRetailers(t.db, [{ id: 1, saleUrl: SALE, ...seed }]);
    const network = fakeFetch(routes);
    const made = fakeDeps({ start: '2026-10-30T03:10:00.000Z', fetch: network.fetch });
    tweak?.(made.deps);
    const result = await processStore(makeEnv(t.db, fakeQueue().queue), { runId: 1, retailerId: 1 }, made.deps);
    return { result, network, ...made };
  }

  it('an html store saves the deepest pair of its page, in the record and in the result row', async () => {
    const { named } = await run({}, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200, body: pairs(25, 40, 10) } });
    expect(await records()).toEqual([{ discount_percent: 40 }]);
    expect(await results()).toEqual([{ discount_percent: 40 }]);
    expect(named('discount_extracted')[0]?.fields).toEqual({ slug: 'store-1', method: 'html', percent: 40, feed: 'none', feedBytes: 0 });
  });

  it('a structured_data store reads the data in its page', async () => {
    const body = '<html><body><p>R100</p><p>R200</p><script>[{"listPrice":200,"price":100},{"listPrice":300,"price":225}]</script></body></html>';
    await run({ extractionMethod: 'structured_data' }, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200, body } });
    expect(await records()).toEqual([{ discount_percent: 50 }]);
  });

  it('a manual store is never fetched and has no percentage', async () => {
    const { network } = await run({ extractionMethod: 'manual' }, {});
    expect(network.requests).toEqual([]);
    expect(await results()).toEqual([{ discount_percent: null }]);
  });

  it('a shopify_json store whose address is a collection asks for its feed once, after robots.txt and the page, and uses it', async () => {
    const { network, named } = await run({ extractionMethod: 'shopify_json', saleUrl: COLLECTION }, { 'https://shop.example/robots.txt': OK_ROBOTS, [COLLECTION]: { status: 200, body: pairs(25, 20) }, [FEED]: { status: 200, body: FEED_40 } });
    expect(network.urls()).toEqual(['https://shop.example/robots.txt', COLLECTION, FEED]); // robots.txt exactly once
    expect((network.requests[2]?.init?.headers as Record<string, string>)['User-Agent']).toContain('SaleawayBot/1.0');
    expect(await records()).toEqual([{ discount_percent: 40 }]);
    expect(await results()).toEqual([{ discount_percent: 40 }]);
    expect(named('discount_extracted')[0]?.fields).toEqual({ slug: 'store-1', method: 'shopify_json', percent: 40, feed: 'used', feedBytes: FEED_40.length });
  });

  it('a feed that is refused, missing, slow, empty or useless falls back to the page and is never asked twice', async () => {
    const cases: Array<[string, Spec, string]> = [
      ['429', { status: 429 }, 'blocked'],
      ['403', { status: 403 }, 'blocked'],
      ['404', { status: 404 }, 'fallback'],
      ['500', { status: 500 }, 'fallback'],
      ['timeout', { throws: 'timeout' }, 'fallback'],
      ['network', { throws: 'network' }, 'fallback'],
      ['no percentage in it', { status: 200, body: '{"products":[]}' }, 'fallback'],
      ['not json', { status: 200, body: 'oops' }, 'fallback'],
    ];
    for (const [name, spec, state] of cases) {
      await resetData(t.db);
      await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 1);
      const { network, named } = await run({ extractionMethod: 'shopify_json', saleUrl: COLLECTION }, { 'https://shop.example/robots.txt': OK_ROBOTS, [COLLECTION]: { status: 200, body: pairs(25, 20) }, [FEED]: spec });
      expect(network.urls().filter((u) => u === FEED), name).toHaveLength(1);
      expect(await records(), name).toEqual([{ discount_percent: 25 }]); // the page's own pair
      expect((named('discount_extracted')[0]?.fields as { feed: string }).feed, name).toBe(state);
    }
  });

  it('does not ask for the feed when robots.txt forbids it, and reads the page', async () => {
    const forbid = { status: 200, body: 'User-agent: *\nDisallow: /collections/*/products.json\n' };
    const { network, named } = await run({ extractionMethod: 'shopify_json', saleUrl: COLLECTION }, { 'https://shop.example/robots.txt': forbid, [COLLECTION]: { status: 200, body: pairs(25, 20) } });
    expect(network.urls()).toEqual(['https://shop.example/robots.txt', COLLECTION]);
    expect(await records()).toEqual([{ discount_percent: 25 }]);
    expect((named('discount_extracted')[0]?.fields as { feed: string }).feed).toBe('not_allowed');
  });

  it('a shopify_json store whose address is a hub page, a product page or another path makes no feed request', async () => {
    for (const saleUrl of ['https://shop.example/pages/promotions', 'https://shop.example/products/sale', 'https://shop.example/collections/sale/extra', 'https://shop.example/collections/sale?sort=price']) {
      await resetData(t.db);
      await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 1);
      const { network, named } = await run({ extractionMethod: 'shopify_json', saleUrl }, { 'https://shop.example/robots.txt': OK_ROBOTS, [saleUrl]: { status: 200, body: pairs(30, 20) } });
      expect(network.urls(), saleUrl).toEqual(['https://shop.example/robots.txt', saleUrl]);
      expect(await records(), saleUrl).toEqual([{ discount_percent: 30 }]);
      expect((named('discount_extracted')[0]?.fields as { feed: string }).feed, saleUrl).toBe('none');
    }
  });

  it('an html store never asks for a feed, whatever its address looks like', async () => {
    const { network } = await run({ extractionMethod: 'html', saleUrl: COLLECTION }, { 'https://shop.example/robots.txt': OK_ROBOTS, [COLLECTION]: { status: 200, body: pairs(25, 20) } });
    expect(network.urls()).toEqual(['https://shop.example/robots.txt', COLLECTION]);
  });

  it('only a valid page gets a percentage and a feed request: an unverifiable or ended page, a js_only store and a blocked answer get none', async () => {
    const cases: Array<[string, Partial<RetailerSeed>, Spec]> = [
      ['a JavaScript page', { extractionMethod: 'shopify_json', saleUrl: COLLECTION }, { status: 200, body: '<html><body><div id="root"></div></body></html>' }],
      ['a page with no sale', { extractionMethod: 'shopify_json', saleUrl: COLLECTION }, { status: 200, body: '<html><title>Page not found</title></html>' }],
      ['a js_only store', { extractionMethod: 'shopify_json', saleUrl: COLLECTION, seedStatus: 'verified_js_shell' }, { status: 200, body: pairs(30, 20) }],
      ['a blocked answer', { extractionMethod: 'shopify_json', saleUrl: COLLECTION }, { status: 403 }],
      ['a not found answer', { extractionMethod: 'shopify_json', saleUrl: COLLECTION }, { status: 404 }],
    ];
    for (const [name, seed, page] of cases) {
      await resetData(t.db);
      await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 1);
      const { network, named } = await run(seed, { 'https://shop.example/robots.txt': OK_ROBOTS, [COLLECTION]: page, [FEED]: { status: 200, body: FEED_40 } });
      expect(network.urls().includes(FEED), name).toBe(false);
      expect(named('discount_extracted'), name).toEqual([]);
      expect(await results(), name).toEqual([{ discount_percent: null }]);
    }
  });

  it('an extraction that throws is logged and the store is saved as "On sale"', async () => {
    const { named } = await run({}, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200, body: pairs(25, 20) } }, (deps) => {
      deps.extract = () => {
        throw new Error('boom');
      };
    });
    expect(named('extraction_failed')[0]?.fields).toMatchObject({ slug: 'store-1' });
    expect(named('extraction_failed')[0]?.level).toBe('warn');
    expect(await records()).toEqual([{ discount_percent: null }]);
    expect(await rows(t.db, 'SELECT state, validation FROM sale_records')).toEqual([{ state: 'active', validation: 'content_verified' }]);
  });

  it('a percentage outside 5 to 90 from the extractor is dropped before it is saved', async () => {
    for (const bad of [4, 91, 0, 150, 50.5]) {
      await resetData(t.db);
      await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 1);
      await run({}, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200, body: pairs(25, 20) } }, (deps) => {
        deps.extract = () => bad;
      });
      expect((await records())[0]?.discount_percent, String(bad)).toBeNull();
    }
  });

  it('reads the page once, and the validator and the extractor see the same text', async () => {
    await seedRetailers(t.db, [{ id: 1, saleUrl: SALE }]);
    const body = pairs(25, 30);
    const network = fakeFetchWithTrackedBody(SALE, { [ROBOTS]: OK_ROBOTS }, 200, body);
    const { deps } = fakeDeps({ fetch: network.fetch });
    let validated = '';
    let extracted = '';
    deps.validate = (page) => {
      validated = page.text;
      return { verdict: 'valid', reason: 'discounts_found', signals: { amounts: 4, percentLabels: 0, wasPrices: 2, structured: 0, saveLabels: 0, scripts: 0, textLength: 10 } };
    };
    deps.extract = (_method, input) => {
      extracted = input.page;
      return 30;
    };
    await processStore(makeEnv(t.db, fakeQueue().queue), { runId: 1, retailerId: 1 }, deps);
    expect(validated).toBe(body);
    expect(extracted).toBe(body);
    expect(network.stats.pulls).toBeLessThanOrEqual(2); // one chunk and the end
  });

  it('writes no page or feed text to any log field, and no field has a name the logger would drop', async () => {
    const { entries } = await run({ extractionMethod: 'shopify_json', saleUrl: COLLECTION }, { 'https://shop.example/robots.txt': OK_ROBOTS, [COLLECTION]: { status: 200, body: pairs(25, 20) }, [FEED]: { status: 200, body: FEED_40 } });
    const text = JSON.stringify(entries);
    for (const word of ['old-price', 'compare_at_price', 'variants', 'Sale']) expect(text).not.toContain(word);
    for (const entry of entries) for (const reserved of ['level', 'message', 'time']) expect(Object.keys(entry.fields ?? {})).not.toContain(reserved);
  });

  it('never writes an override or changes the store', async () => {
    await run({}, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200, body: pairs(25, 20) } });
    expect(await rows(t.db, 'SELECT COUNT(*) AS n FROM overrides')).toEqual([{ n: 0 }]);
    expect(await rows(t.db, 'SELECT extraction_method, is_visible FROM retailers')).toEqual([{ extraction_method: 'html', is_visible: 1 }]);
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

  it('never writes overrides, and never changes the store', async () => {
    await runStore({ seedStatus: 'verified_js_shell' }, { [ROBOTS]: OK_ROBOTS, [SALE]: { status: 200 } });
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
