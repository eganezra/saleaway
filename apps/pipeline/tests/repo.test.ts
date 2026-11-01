import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  browserMsSince,
  closeRun,
  countResultsByClass,
  findRunnableRetailerIdBySlug,
  getResultInRun,
  getRetailerForJob,
  getSaleRecord,
  getVisibleStores,
  insertRun,
  listUnfinishedRuns,
  saveRunResult,
  saveStoreResult,
} from '../src/repo';
import type { RunResultInput } from '../src/repo';
import type { SaleRecordFields } from '@saleaway/core';
import { createTestDb, resetData, rows, seedRetailers } from './helpers/db';
import type { TestDb } from './helpers/db';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 30_000);
afterAll(async () => {
  await t.dispose();
});
beforeEach(async () => {
  await resetData(t.db);
});

const result = (over: Partial<RunResultInput> = {}): RunResultInput => ({
  runId: 1,
  retailerId: 1,
  result: 'ok',
  httpStatus: null,
  discountPercent: null,
  durationMs: 5,
  error: null,
  createdAt: '2026-10-30T03:00:01Z',
  ...over,
});

describe('the test database', () => {
  it('is a fresh, empty copy with the real migrations applied (never the live or the local database)', async () => {
    expect((await rows<{ n: number }>(t.db, 'SELECT COUNT(*) AS n FROM retailers'))[0]?.n).toBe(0);
    const indexes = await rows<{ name: string }>(t.db, "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_run_results%'");
    expect(indexes.map((i) => i.name)).toContain('idx_run_results_run_retailer');
  });
});

describe('getVisibleStores', () => {
  it('returns visible stores with an https URL, in id order, and skips the rest', async () => {
    await seedRetailers(t.db, [
      { id: 5 },
      { id: 2 },
      { id: 3, isVisible: 0 },
      { id: 4, saleUrl: null },
      { id: 6, saleUrl: 'http://insecure.example/sale' },
      { id: 7, saleUrl: 'HTTPS://UPPER.example/sale' },
      { id: 1 },
    ]);
    expect(await getVisibleStores(t.db)).toEqual([
      { id: 1, fetchMode: 'plain' },
      { id: 2, fetchMode: 'plain' },
      { id: 5, fetchMode: 'plain' },
    ]);
  });

  it('says how each store is obtained (Story 5.1)', async () => {
    await seedRetailers(t.db, [{ id: 1, fetchMode: 'browser' }, { id: 2 }]);
    expect(await getVisibleStores(t.db)).toEqual([
      { id: 1, fetchMode: 'browser' },
      { id: 2, fetchMode: 'plain' },
    ]);
  });

  it('returns an empty list when there are no stores', async () => {
    expect(await getVisibleStores(t.db)).toEqual([]);
  });
});

describe('insertRun and getRetailerForJob', () => {
  it('inserts a run and returns its id', async () => {
    const first = await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 92);
    const second = await insertRun(t.db, '2026-10-30T04:00:00Z', 'manual', 0);
    expect(second).toBe(first + 1);
    const [run] = await rows(t.db, `SELECT * FROM pipeline_runs WHERE id = ${first}`);
    expect(run).toMatchObject({ started_at: '2026-10-30T03:00:00Z', trigger: 'cron', stores_total: 92, finished_at: null });
  });

  it('rejects a trigger the schema does not allow', async () => {
    await expect(insertRun(t.db, '2026-10-30T03:00:00Z', 'weird' as never, 1)).rejects.toThrow();
  });

  it('reads a store for a job, or null when it does not exist', async () => {
    await seedRetailers(t.db, [{ id: 1, extractionMethod: 'manual', seedStatus: 'verified_js_shell', saleUrl: 'https://store-1.example/sale' }]);
    expect(await getRetailerForJob(t.db, 1)).toEqual({
      id: 1,
      slug: 'store-1',
      extractionMethod: 'manual',
      saleUrl: 'https://store-1.example/sale',
      seedStatus: 'verified_js_shell',
      fetchMode: 'plain',
    });
    expect(await getRetailerForJob(t.db, 999)).toBeNull();
  });
});

describe('findRunnableRetailerIdBySlug', () => {
  it('finds a store with an https sale URL by its slug, hidden or not, and nothing else', async () => {
    await seedRetailers(t.db, [
      { id: 1 },
      { id: 2, isVisible: 0 },
      { id: 3, saleUrl: null },
      { id: 4, saleUrl: 'http://insecure.example/sale' },
      { id: 5, saleUrl: 'HTTPS://UPPER.example/sale' },
    ]);
    expect(await findRunnableRetailerIdBySlug(t.db, 'store-1')).toBe(1);
    expect(await findRunnableRetailerIdBySlug(t.db, 'store-2')).toBe(2); // hidden for launch (Story 3.9): still found
    for (const slug of ['store-3', 'store-4', 'store-5', 'store-999', '']) {
      expect(await findRunnableRetailerIdBySlug(t.db, slug), slug).toBeNull();
    }
  });

  it('does not change what a normal run processes: hidden stores are still skipped there', async () => {
    await seedRetailers(t.db, [{ id: 1 }, { id: 2, isVisible: 0 }]);
    expect(await getVisibleStores(t.db)).toEqual([{ id: 1, fetchMode: 'plain' }]);
  });
});

describe('saveRunResult', () => {
  beforeEach(async () => {
    await seedRetailers(t.db, [{ id: 1 }, { id: 2 }]);
    await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 2);
    await insertRun(t.db, '2026-10-30T04:00:00Z', 'manual', 2);
  });

  it('writes one row for a store in a run', async () => {
    await saveRunResult(t.db, result());
    expect(await rows(t.db, 'SELECT run_id, retailer_id, result, duration_ms, error FROM run_results')).toEqual([
      { run_id: 1, retailer_id: 1, result: 'ok', duration_ms: 5, error: null },
    ]);
  });

  it('saving the same store in the same run again updates the row and never adds a second', async () => {
    await saveRunResult(t.db, result({ result: 'error', error: 'first try', createdAt: '2026-10-30T03:00:01Z' }));
    await saveRunResult(t.db, result({ result: 'skipped_manual', error: null, durationMs: 9, createdAt: '2026-10-30T03:00:09Z' }));
    const all = await rows(t.db, 'SELECT result, error, duration_ms, created_at FROM run_results');
    expect(all).toEqual([{ result: 'skipped_manual', error: null, duration_ms: 9, created_at: '2026-10-30T03:00:09Z' }]);
  });

  it('keeps a separate row for the same store in a different run', async () => {
    await saveRunResult(t.db, result({ runId: 1 }));
    await saveRunResult(t.db, result({ runId: 2 }));
    expect(await rows(t.db, 'SELECT run_id FROM run_results ORDER BY run_id')).toEqual([{ run_id: 1 }, { run_id: 2 }]);
  });

  it('rejects a result for a run or a store that does not exist (foreign keys)', async () => {
    await expect(saveRunResult(t.db, result({ runId: 999 }))).rejects.toThrow();
    await expect(saveRunResult(t.db, result({ retailerId: 999 }))).rejects.toThrow();
  });

  it('stores a discount percentage on a result (the range limit applies to sale records, not to the run log)', async () => {
    await expect(saveRunResult(t.db, result({ discountPercent: 40 }))).resolves.toBeUndefined();
  });
});

const saleRecord = (over: Partial<SaleRecordFields> = {}): SaleRecordFields => ({
  state: 'active',
  validation: 'content_verified',
  discountPercent: 30,
  lastResult: 'ok',
  firstSeenAt: '2026-10-29T03:00:00Z',
  lastCheckedAt: '2026-10-30T03:10:00Z',
  lastValidatedAt: '2026-10-30T03:10:00Z',
  endedAt: null,
  ...over,
});
const SALE_COLUMNS = 'SELECT retailer_id, state, validation, discount_percent, last_result, first_seen_at, last_checked_at, last_validated_at, ended_at FROM sale_records ORDER BY retailer_id';

describe('getSaleRecord', () => {
  beforeEach(async () => {
    await seedRetailers(t.db, [{ id: 1 }, { id: 2 }]);
  });

  it('is null for a store with no record', async () => {
    expect(await getSaleRecord(t.db, 1)).toBeNull();
    expect(await getSaleRecord(t.db, 999)).toBeNull();
  });
  it('returns the record of that store only, in camel case', async () => {
    await t.db
      .prepare(
        `INSERT INTO sale_records (retailer_id, state, validation, discount_percent, last_result, first_seen_at, last_checked_at, last_validated_at, ended_at)
         VALUES (1, 'ended', 'none', NULL, 'not_found', '2026-10-01T03:00:00Z', '2026-10-30T03:00:00Z', '2026-10-20T03:00:00Z', '2026-10-30T03:00:00Z'),
                (2, 'active', 'url_verified', 25, 'js_only', '2026-10-02T03:00:00Z', '2026-10-30T03:05:00Z', '2026-10-30T03:05:00Z', NULL)`,
      )
      .run();
    expect(await getSaleRecord(t.db, 1)).toEqual({
      state: 'ended',
      validation: 'none',
      discountPercent: null,
      lastResult: 'not_found',
      firstSeenAt: '2026-10-01T03:00:00Z',
      lastCheckedAt: '2026-10-30T03:00:00Z',
      lastValidatedAt: '2026-10-20T03:00:00Z',
      endedAt: '2026-10-30T03:00:00Z',
    });
    expect(await getSaleRecord(t.db, 2)).toMatchObject({ state: 'active', validation: 'url_verified', discountPercent: 25, lastResult: 'js_only', endedAt: null });
  });
  it('reads a row that has no last_result as an error, and a default row as unknown', async () => {
    await t.db.prepare('INSERT INTO sale_records (retailer_id) VALUES (1)').run();
    expect(await getSaleRecord(t.db, 1)).toMatchObject({ state: 'unknown', validation: 'none', lastResult: 'error', discountPercent: null });
  });
});

describe('saveStoreResult', () => {
  beforeEach(async () => {
    await seedRetailers(t.db, [{ id: 1 }, { id: 2 }]);
    await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 2);
    await insertRun(t.db, '2026-10-31T03:00:00Z', 'cron', 2);
  });

  it('writes the result row and the record together', async () => {
    await saveStoreResult(t.db, result(), saleRecord());
    expect(await rows(t.db, 'SELECT run_id, retailer_id, result FROM run_results')).toEqual([{ run_id: 1, retailer_id: 1, result: 'ok' }]);
    expect(await rows(t.db, SALE_COLUMNS)).toEqual([
      { retailer_id: 1, state: 'active', validation: 'content_verified', discount_percent: 30, last_result: 'ok', first_seen_at: '2026-10-29T03:00:00Z', last_checked_at: '2026-10-30T03:10:00Z', last_validated_at: '2026-10-30T03:10:00Z', ended_at: null },
    ]);
  });
  it('writes only the result when there is no record to write (a manual store)', async () => {
    await saveStoreResult(t.db, result({ retailerId: 2, result: 'skipped_manual' }), null);
    expect(await rows(t.db, 'SELECT retailer_id FROM run_results')).toEqual([{ retailer_id: 2 }]);
    expect(await rows(t.db, 'SELECT COUNT(*) AS n FROM sale_records')).toEqual([{ n: 0 }]);
  });
  it('saving the same pair twice leaves one row of each', async () => {
    await saveStoreResult(t.db, result(), saleRecord());
    await saveStoreResult(t.db, result(), saleRecord());
    expect(await rows(t.db, 'SELECT COUNT(*) AS n FROM run_results')).toEqual([{ n: 1 }]);
    expect(await rows(t.db, 'SELECT COUNT(*) AS n FROM sale_records')).toEqual([{ n: 1 }]);
  });
  it('replaces the whole record on the next night, every column', async () => {
    await saveStoreResult(t.db, result(), saleRecord());
    const ended = saleRecord({ state: 'ended', validation: 'none', discountPercent: null, lastResult: 'not_found', lastCheckedAt: '2026-10-31T03:10:00Z', endedAt: '2026-10-31T03:10:00Z' });
    await saveStoreResult(t.db, result({ runId: 2, result: 'not_found' }), ended);
    expect(await rows(t.db, SALE_COLUMNS)).toEqual([
      { retailer_id: 1, state: 'ended', validation: 'none', discount_percent: null, last_result: 'not_found', first_seen_at: '2026-10-29T03:00:00Z', last_checked_at: '2026-10-31T03:10:00Z', last_validated_at: '2026-10-30T03:10:00Z', ended_at: '2026-10-31T03:10:00Z' },
    ]);
    expect(await rows(t.db, 'SELECT run_id FROM run_results ORDER BY run_id')).toEqual([{ run_id: 1 }, { run_id: 2 }]);
  });
  it('writes neither when the record is refused: the result row is rolled back too', async () => {
    await expect(saveStoreResult(t.db, result(), saleRecord({ discountPercent: 3 }))).rejects.toThrow();
    expect(await rows(t.db, 'SELECT COUNT(*) AS n FROM run_results')).toEqual([{ n: 0 }]);
    expect(await rows(t.db, 'SELECT COUNT(*) AS n FROM sale_records')).toEqual([{ n: 0 }]);
  });
  it('does not touch another store, an override or a retailer row', async () => {
    await t.db.prepare("INSERT INTO overrides (retailer_id, hide) VALUES (2, 1)").run();
    await saveStoreResult(t.db, result(), saleRecord());
    expect(await rows(t.db, 'SELECT retailer_id, hide FROM overrides')).toEqual([{ retailer_id: 2, hide: 1 }]);
    expect(await rows(t.db, 'SELECT id, is_visible FROM retailers ORDER BY id')).toEqual([{ id: 1, is_visible: 1 }, { id: 2, is_visible: 1 }]);
  });
});

describe('countResultsByClass', () => {
  it('groups the results of one run by class and ignores other runs', async () => {
    await seedRetailers(t.db, [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
    await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 4);
    await insertRun(t.db, '2026-10-30T04:00:00Z', 'manual', 4);
    await saveRunResult(t.db, result({ retailerId: 1, result: 'error' }));
    await saveRunResult(t.db, result({ retailerId: 2, result: 'error' }));
    await saveRunResult(t.db, result({ retailerId: 3, result: 'skipped_manual' }));
    await saveRunResult(t.db, result({ runId: 2, retailerId: 4, result: 'ok' }));
    expect(await countResultsByClass(t.db, 1)).toEqual([
      { result: 'error', n: 2 },
      { result: 'skipped_manual', n: 1 },
    ]);
    expect(await countResultsByClass(t.db, 2)).toEqual([{ result: 'ok', n: 1 }]);
    expect(await countResultsByClass(t.db, 3)).toEqual([]);
  });
});

describe('listUnfinishedRuns and closeRun', () => {
  it('lists runs without a finish time, newest first, with their store totals', async () => {
    const a = await insertRun(t.db, '2026-10-29T03:00:00Z', 'cron', 10);
    const b = await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 92);
    expect(await listUnfinishedRuns(t.db)).toEqual([
      { id: b, storesTotal: 92 },
      { id: a, storesTotal: 10 },
    ]);
  });

  it('closes an open run once and reports whether it changed anything', async () => {
    const id = await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 92);
    expect(await closeRun(t.db, id, '2026-10-30T03:45:00Z', 3, 89)).toBe(true);
    expect(await closeRun(t.db, id, '2026-10-30T09:00:00Z', 0, 0)).toBe(false);
    expect(await rows(t.db, `SELECT finished_at, stores_ok, stores_failed FROM pipeline_runs WHERE id = ${id}`)).toEqual([
      { finished_at: '2026-10-30T03:45:00Z', stores_ok: 3, stores_failed: 89 },
    ]);
    expect(await listUnfinishedRuns(t.db)).toEqual([]);
  });

  it('lists at most 10 runs at a time (D1 allows 50 queries per invocation), and they are the 10 newest', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 12; i++) ids.push(await insertRun(t.db, `2026-10-${String(10 + i).padStart(2, '0')}T03:00:00Z`, 'cron', 1));
    expect((await listUnfinishedRuns(t.db)).map((r) => r.id)).toEqual(ids.slice(2).reverse());
  });
});

describe('fetch_mode (Story 5.1, migration 0004)', () => {
  it('defaults to plain for a store that does not say, and refuses a value that is not plain or browser', async () => {
    await t.db.prepare("INSERT OR IGNORE INTO categories (id, slug, name) VALUES (1, 'test', 'Test')").run();
    await t.db
      .prepare("INSERT INTO retailers (id, slug, name, homepage_url, category_id) VALUES (9, 'nine', 'Nine', 'https://nine.example', 1)")
      .run();
    const [row] = await rows<{ fetch_mode: string }>(t.db, 'SELECT fetch_mode FROM retailers WHERE id = 9');
    expect(row?.fetch_mode).toBe('plain');
    await expect(t.db.prepare("UPDATE retailers SET fetch_mode = 'headless' WHERE id = 9").run()).rejects.toThrow();
    await t.db.prepare("UPDATE retailers SET fetch_mode = 'browser' WHERE id = 9").run();
    expect((await rows<{ fetch_mode: string }>(t.db, 'SELECT fetch_mode FROM retailers WHERE id = 9'))[0]?.fetch_mode).toBe('browser');
  });

  it('getRetailerForJob returns it', async () => {
    await seedRetailers(t.db, [{ id: 1, fetchMode: 'browser' }, { id: 2 }]);
    expect((await getRetailerForJob(t.db, 1))?.fetchMode).toBe('browser');
    expect((await getRetailerForJob(t.db, 2))?.fetchMode).toBe('plain');
  });
});

describe('getResultInRun', () => {
  it('returns the result saved for this store in this run, and null for another store or another run', async () => {
    await seedRetailers(t.db, [{ id: 1 }, { id: 2 }]);
    const run = await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 2);
    await saveRunResult(t.db, { runId: run, retailerId: 1, result: 'ok', httpStatus: 200, discountPercent: null, durationMs: 10, error: null, createdAt: '2026-10-30T03:00:05Z' });
    expect(await getResultInRun(t.db, run, 1)).toBe('ok');
    expect(await getResultInRun(t.db, run, 2)).toBeNull();
    expect(await getResultInRun(t.db, run + 1, 1)).toBeNull();
  });
});

describe('browserMsSince', () => {
  async function result(runId: number, retailerId: number, durationMs: number | null, createdAt: string) {
    await saveRunResult(t.db, { runId, retailerId, result: 'ok', httpStatus: 200, discountPercent: null, durationMs, error: null, createdAt });
  }

  it('is 0 when nothing was rendered', async () => {
    expect(await browserMsSince(t.db, '2026-10-31T00:00:00Z')).toBe(0);
  });

  it('adds up the time of browser stores since the given moment, and only theirs', async () => {
    await seedRetailers(t.db, [{ id: 1, fetchMode: 'browser' }, { id: 2, fetchMode: 'browser' }, { id: 3 }]);
    const run = await insertRun(t.db, '2026-10-31T03:00:00Z', 'cron', 3);
    const old = await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 1);
    await result(run, 1, 12_000, '2026-10-31T03:00:20Z');
    await result(run, 2, 8_500, '2026-10-31T03:00:45Z');
    await result(run, 3, 90_000, '2026-10-31T03:00:30Z'); // a plain store: not counted
    await result(old, 1, 20_000, '2026-10-30T03:00:20Z'); // yesterday: not counted
    expect(await browserMsSince(t.db, '2026-10-31T00:00:00Z')).toBe(20_500);
  });

  it('ignores a result with no duration', async () => {
    await seedRetailers(t.db, [{ id: 1, fetchMode: 'browser' }]);
    const run = await insertRun(t.db, '2026-10-31T03:00:00Z', 'cron', 1);
    await result(run, 1, null, '2026-10-31T03:00:20Z');
    expect(await browserMsSince(t.db, '2026-10-31T00:00:00Z')).toBe(0);
  });
});
