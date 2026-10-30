import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  closeRun,
  countResultsByClass,
  findRunnableRetailerIdBySlug,
  getRetailerForJob,
  getVisibleRetailerIds,
  insertRun,
  listUnfinishedRuns,
  saveRunResult,
} from '../src/repo';
import type { RunResultInput } from '../src/repo';
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

describe('getVisibleRetailerIds', () => {
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
    expect(await getVisibleRetailerIds(t.db)).toEqual([1, 2, 5]);
  });

  it('returns an empty list when there are no stores', async () => {
    expect(await getVisibleRetailerIds(t.db)).toEqual([]);
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
    });
    expect(await getRetailerForJob(t.db, 999)).toBeNull();
  });
});

describe('findRunnableRetailerIdBySlug', () => {
  it('finds a visible store with an https sale URL by its slug, and nothing else', async () => {
    await seedRetailers(t.db, [
      { id: 1 },
      { id: 2, isVisible: 0 },
      { id: 3, saleUrl: null },
      { id: 4, saleUrl: 'http://insecure.example/sale' },
      { id: 5, saleUrl: 'HTTPS://UPPER.example/sale' },
    ]);
    expect(await findRunnableRetailerIdBySlug(t.db, 'store-1')).toBe(1);
    for (const slug of ['store-2', 'store-3', 'store-4', 'store-5', 'store-999', '']) {
      expect(await findRunnableRetailerIdBySlug(t.db, slug), slug).toBeNull();
    }
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
  it('lists runs without a finish time, oldest first, with their store totals', async () => {
    const a = await insertRun(t.db, '2026-10-29T03:00:00Z', 'cron', 10);
    const b = await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 92);
    expect(await listUnfinishedRuns(t.db)).toEqual([
      { id: a, storesTotal: 10 },
      { id: b, storesTotal: 92 },
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

  it('lists at most 10 runs at a time (D1 allows 50 queries per invocation)', async () => {
    for (let i = 0; i < 12; i++) await insertRun(t.db, `2026-10-${String(10 + i).padStart(2, '0')}T03:00:00Z`, 'cron', 1);
    expect(await listUnfinishedRuns(t.db)).toHaveLength(10);
  });
});
