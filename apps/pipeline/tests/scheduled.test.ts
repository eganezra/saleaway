import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleScheduled } from '../src/handlers';
import { insertRun, saveRunResult } from '../src/repo';
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
  await seedRetailers(t.db, [{ id: 1 }, { id: 2 }]);
});

const START = { cron: '0 3 * * *' };
const FINALIZE = { cron: '45 3 * * *' };
const runs = () => rows(t.db, 'SELECT id, trigger, finished_at, stores_ok, stores_failed FROM pipeline_runs ORDER BY id');

describe('handleScheduled', () => {
  it('the start cron starts a cron run and puts the stores on the queue', async () => {
    const { queue, allMessages } = fakeQueue();
    await handleScheduled(START, makeEnv(t.db, queue), fakeDeps().deps);
    expect(await runs()).toMatchObject([{ id: 1, trigger: 'cron', finished_at: null }]);
    expect(allMessages()).toHaveLength(2);
  });

  it('the finalize cron closes the open run and starts nothing', async () => {
    const id = await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 2);
    await saveRunResult(t.db, { runId: id, retailerId: 1, result: 'ok', httpStatus: null, discountPercent: null, durationMs: null, error: null, createdAt: '2026-10-30T03:01:00Z' });
    const { queue, calls } = fakeQueue();
    await handleScheduled(FINALIZE, makeEnv(t.db, queue), fakeDeps({ start: '2026-10-30T03:45:00Z' }).deps);
    expect(await runs()).toMatchObject([{ id, finished_at: '2026-10-30T03:45:00Z', stores_ok: 1, stores_failed: 0 }]);
    expect(calls).toEqual([]);
  });

  it('follows the configured FINALIZE_CRON value, not a fixed one', async () => {
    const id = await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 0);
    const { queue, calls } = fakeQueue();
    await handleScheduled({ cron: '15 4 * * *' }, makeEnv(t.db, queue, { FINALIZE_CRON: '15 4 * * *' }), fakeDeps().deps);
    expect((await runs())[0]).toMatchObject({ id, finished_at: expect.any(String) });
    expect(calls).toEqual([]);
  });

  it('paused: neither cron does anything, and the pause is logged', async () => {
    const id = await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 2);
    const { queue, calls } = fakeQueue();
    const { deps, named } = fakeDeps();
    const env = makeEnv(t.db, queue, { PIPELINE_ENABLED: 'false' });
    await handleScheduled(START, env, deps);
    await handleScheduled(FINALIZE, env, deps);
    expect(await runs()).toEqual([{ id, trigger: 'cron', finished_at: null, stores_ok: 0, stores_failed: 0 }]);
    expect(calls).toEqual([]);
    expect(named('pipeline_paused').map((e) => e.fields)).toEqual([{ cron: '0 3 * * *' }, { cron: '45 3 * * *' }]);
  });

  it('resumes after a pause: the next finalize closes the run that stayed open', async () => {
    const id = await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 2);
    const { queue } = fakeQueue();
    await handleScheduled(FINALIZE, makeEnv(t.db, queue, { PIPELINE_ENABLED: 'false' }), fakeDeps().deps);
    expect((await runs())[0]?.finished_at).toBeNull();
    await handleScheduled(FINALIZE, makeEnv(t.db, queue, { PIPELINE_ENABLED: 'true' }), fakeDeps().deps);
    expect((await runs())[0]).toMatchObject({ id, finished_at: expect.any(String) });
  });

  it('any value other than the exact text "false" keeps the pipeline running', async () => {
    for (const value of ['true', 'False', '0', '']) {
      await resetData(t.db);
      await seedRetailers(t.db, [{ id: 1 }]);
      await handleScheduled(START, makeEnv(t.db, fakeQueue().queue, { PIPELINE_ENABLED: value }), fakeDeps().deps);
      expect(await runs()).toHaveLength(1);
    }
  });
});
