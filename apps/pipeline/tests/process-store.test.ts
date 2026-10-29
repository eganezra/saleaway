import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processStore, recordStoreError } from '../src/process-store';
import { insertRun } from '../src/repo';
import { createTestDb, resetData, rows, seedRetailers } from './helpers/db';
import type { TestDb } from './helpers/db';
import { fakeDeps, fakeQueue, makeEnv } from './helpers/fakes';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 30_000);
afterAll(async () => {
  await t.dispose();
});
beforeEach(async () => {
  await resetData(t.db);
  await seedRetailers(t.db, [{ id: 1, extractionMethod: 'manual' }, { id: 2, extractionMethod: 'html' }, { id: 3, extractionMethod: 'shopify_json' }]);
  await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 3);
});

const env = () => makeEnv(t.db, fakeQueue().queue);
const results = () => rows(t.db, 'SELECT retailer_id, result, http_status, discount_percent, duration_ms, error, created_at FROM run_results ORDER BY retailer_id');

describe('processStore (placeholder)', () => {
  it('skips a manual store without fetching anything', async () => {
    const out = await processStore(env(), { runId: 1, retailerId: 1 }, fakeDeps({ stepMs: 7 }).deps);
    expect(out).toBe('skipped_manual');
    expect(await results()).toEqual([
      { retailer_id: 1, result: 'skipped_manual', http_status: null, discount_percent: null, duration_ms: 7, error: null, created_at: '2026-10-30T03:00:00Z' },
    ]);
  });

  it('records that the fetcher is not built yet for any other store', async () => {
    for (const retailerId of [2, 3]) await processStore(env(), { runId: 1, retailerId }, fakeDeps().deps);
    expect(await results()).toMatchObject([
      { retailer_id: 2, result: 'error', error: 'fetcher_not_built_yet' },
      { retailer_id: 3, result: 'error', error: 'fetcher_not_built_yet' },
    ]);
  });

  it('logs a store that no longer exists and writes nothing, without throwing', async () => {
    const { deps, named } = fakeDeps();
    await expect(processStore(env(), { runId: 1, retailerId: 999 }, deps)).resolves.toBe('error');
    expect(named('retailer_not_found')).toEqual([{ level: 'error', message: 'retailer_not_found', fields: { runId: 1, retailerId: 999 } }]);
    expect(await results()).toEqual([]);
  });

  it('processing the same job twice leaves one result row, not two', async () => {
    const job = { runId: 1, retailerId: 2 };
    await processStore(env(), job, fakeDeps().deps);
    await processStore(env(), job, fakeDeps().deps);
    expect(await results()).toHaveLength(1);
  });

  it('keeps separate rows for the same store in two runs', async () => {
    await insertRun(t.db, '2026-10-30T09:00:00Z', 'manual', 3);
    await processStore(env(), { runId: 1, retailerId: 2 }, fakeDeps().deps);
    await processStore(env(), { runId: 2, retailerId: 2 }, fakeDeps().deps);
    expect(await rows(t.db, 'SELECT run_id FROM run_results ORDER BY run_id')).toEqual([{ run_id: 1 }, { run_id: 2 }]);
  });

  it('never writes sale_records or overrides, and never changes the stores', async () => {
    for (const retailerId of [1, 2, 3]) await processStore(env(), { runId: 1, retailerId }, fakeDeps().deps);
    expect(await rows(t.db, 'SELECT COUNT(*) AS n FROM sale_records')).toEqual([{ n: 0 }]);
    expect(await rows(t.db, 'SELECT COUNT(*) AS n FROM overrides')).toEqual([{ n: 0 }]);
    expect(await rows(t.db, 'SELECT id, extraction_method, is_visible FROM retailers ORDER BY id')).toEqual([
      { id: 1, extraction_method: 'manual', is_visible: 1 },
      { id: 2, extraction_method: 'html', is_visible: 1 },
      { id: 3, extraction_method: 'shopify_json', is_visible: 1 },
    ]);
  });
});

describe('recordStoreError', () => {
  it('records an error result with the text, cut to 200 characters', async () => {
    await recordStoreError(env(), { runId: 1, retailerId: 2 }, 'x'.repeat(500), fakeDeps().deps);
    const [row] = await results();
    expect(row).toMatchObject({ retailer_id: 2, result: 'error', duration_ms: null });
    expect(String(row?.error)).toHaveLength(200);
  });

  it('replaces an earlier result for the same run and store', async () => {
    await processStore(env(), { runId: 1, retailerId: 2 }, fakeDeps().deps);
    await recordStoreError(env(), { runId: 1, retailerId: 2 }, 'boom', fakeDeps().deps);
    expect(await results()).toMatchObject([{ retailer_id: 2, result: 'error', error: 'boom' }]);
  });
});
