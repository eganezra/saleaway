import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { finalizeRun } from '../src/finalize-run';
import { insertRun, saveRunResult } from '../src/repo';
import type { RunResultInput } from '../src/repo';
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
  await seedRetailers(t.db, Array.from({ length: 6 }, (_, i) => ({ id: i + 1 })));
});

const env = () => makeEnv(t.db, fakeQueue().queue);
const save = (runId: number, retailerId: number, result: RunResultInput['result']) =>
  saveRunResult(t.db, { runId, retailerId, result, httpStatus: null, discountPercent: null, durationMs: null, error: null, createdAt: '2026-10-30T03:10:00Z' });
const runs = () => rows(t.db, 'SELECT id, finished_at, stores_total, stores_ok, stores_failed FROM pipeline_runs ORDER BY id');

describe('finalizeRun', () => {
  it('closes an open run with totals from its own results', async () => {
    const id = await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 6);
    await save(id, 1, 'skipped_manual');
    await save(id, 2, 'skipped_manual');
    await save(id, 3, 'ok');
    await save(id, 4, 'error');
    await save(id, 5, 'blocked');
    await save(id, 6, 'not_found');
    const { deps } = fakeDeps({ start: '2026-10-30T03:45:00.900Z' });
    expect(await finalizeRun(env(), deps)).toBe(1);
    expect(await runs()).toEqual([{ id, finished_at: '2026-10-30T03:45:00Z', stores_total: 6, stores_ok: 3, stores_failed: 3 }]);
  });

  it('gives the first live shape: 3 manual stores ok and the rest failed', async () => {
    const id = await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 6);
    for (const retailerId of [1, 2, 3]) await save(id, retailerId, 'skipped_manual');
    for (const retailerId of [4, 5, 6]) await save(id, retailerId, 'error');
    await finalizeRun(env(), fakeDeps().deps);
    expect(await runs()).toMatchObject([{ stores_ok: 3, stores_failed: 3 }]);
  });

  it('closes every open run, each with its own totals', async () => {
    const a = await insertRun(t.db, '2026-10-29T09:00:00Z', 'manual', 2);
    const b = await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 2);
    await save(a, 1, 'ok');
    await save(a, 2, 'ok');
    await save(b, 1, 'error');
    await save(b, 2, 'skipped_manual');
    expect(await finalizeRun(env(), fakeDeps().deps)).toBe(2);
    expect(await runs()).toMatchObject([
      { id: a, stores_ok: 2, stores_failed: 0 },
      { id: b, stores_ok: 1, stores_failed: 1 },
    ]);
  });

  it('leaves a run that is already closed untouched', async () => {
    const id = await insertRun(t.db, '2026-10-29T03:00:00Z', 'cron', 2);
    await t.db.prepare("UPDATE pipeline_runs SET finished_at = '2026-10-29T03:45:00Z', stores_ok = 2, stores_failed = 0 WHERE id = ?1").bind(id).run();
    const { deps, named } = fakeDeps();
    expect(await finalizeRun(env(), deps)).toBe(0);
    expect(await runs()).toEqual([{ id, finished_at: '2026-10-29T03:45:00Z', stores_total: 2, stores_ok: 2, stores_failed: 0 }]);
    expect(named('run_finalized')).toEqual([]);
  });

  it('closes a run with missing results and shows the gap in the totals and the log', async () => {
    const id = await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 6);
    await save(id, 1, 'ok');
    await save(id, 2, 'error');
    const { deps, named } = fakeDeps();
    await finalizeRun(env(), deps);
    expect(await runs()).toMatchObject([{ id, stores_total: 6, stores_ok: 1, stores_failed: 1 }]);
    expect(named('run_finalized')).toEqual([
      { level: 'info', message: 'run_finalized', fields: { runId: id, storesTotal: 6, storesOk: 1, storesFailed: 1, missing: 4 } },
    ]);
  });

  it('closes a run that has no results at all', async () => {
    const id = await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 0);
    await finalizeRun(env(), fakeDeps().deps);
    expect(await runs()).toMatchObject([{ id, stores_ok: 0, stores_failed: 0 }]);
  });

  it('a second call changes nothing', async () => {
    const id = await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 1);
    await save(id, 1, 'ok');
    await finalizeRun(env(), fakeDeps({ start: '2026-10-30T03:45:00Z' }).deps);
    const first = await runs();
    const { deps, named } = fakeDeps({ start: '2026-10-30T09:00:00Z' });
    expect(await finalizeRun(env(), deps)).toBe(0);
    expect(await runs()).toEqual(first);
    expect(named('run_finalized')).toEqual([]);
  });

  it('does nothing when there are no runs', async () => {
    expect(await finalizeRun(env(), fakeDeps().deps)).toBe(0);
  });
});
