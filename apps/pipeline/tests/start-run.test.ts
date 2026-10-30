import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startRun } from '../src/start-run';
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
});

describe('startRun', () => {
  it('records a cron run with the start time and the number of stores', async () => {
    await seedRetailers(t.db, [{ id: 1 }, { id: 2 }, { id: 3 }]);
    const { deps } = fakeDeps({ start: '2026-10-30T03:00:00.456Z' });
    const { queue } = fakeQueue();
    const out = await startRun(makeEnv(t.db, queue), 'cron', deps);
    expect(out).toEqual({ runId: 1, storesTotal: 3 });
    expect(await rows(t.db, 'SELECT * FROM pipeline_runs')).toEqual([
      { id: 1, started_at: '2026-10-30T03:00:00Z', finished_at: null, trigger: 'cron', stores_total: 3, stores_ok: 0, stores_failed: 0 },
    ]);
  });

  it('records a manual run as manual', async () => {
    await seedRetailers(t.db, [{ id: 1 }]);
    const { deps } = fakeDeps();
    await startRun(makeEnv(t.db, fakeQueue().queue), 'manual', deps);
    expect((await rows<{ trigger: string }>(t.db, 'SELECT trigger FROM pipeline_runs'))[0]?.trigger).toBe('manual');
  });

  it('enqueues one message per visible store, delayed 0, 15, 30, ... seconds, in id order', async () => {
    await seedRetailers(t.db, [{ id: 4 }, { id: 2 }, { id: 9, isVisible: 0 }, { id: 7, saleUrl: null }, { id: 1 }]);
    const { queue, calls } = fakeQueue();
    const { deps } = fakeDeps();
    await startRun(makeEnv(t.db, queue), 'cron', deps);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      { body: { runId: 1, retailerId: 1 }, delaySeconds: 0 },
      { body: { runId: 1, retailerId: 2 }, delaySeconds: 15 },
      { body: { runId: 1, retailerId: 4 }, delaySeconds: 30 },
    ]);
  });

  it('uses the configured stagger', async () => {
    await seedRetailers(t.db, [{ id: 1 }, { id: 2 }, { id: 3 }]);
    const { queue, allMessages } = fakeQueue();
    await startRun(makeEnv(t.db, queue, { STAGGER_SECONDS: '1' }), 'cron', fakeDeps().deps);
    expect(allMessages().map((m) => m.delaySeconds)).toEqual([0, 1, 2]);
  });

  it('splits 250 stores into three sendBatch calls of 100, 100 and 50 with delays that keep counting', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => ({ id: i + 1 }));
    await seedRetailers(t.db, ids);
    const { queue, calls, allMessages } = fakeQueue();
    const out = await startRun(makeEnv(t.db, queue), 'cron', fakeDeps().deps);
    expect(out.storesTotal).toBe(250);
    expect(calls.map((c) => c.length)).toEqual([100, 100, 50]);
    expect(allMessages().map((m) => m.delaySeconds)).toEqual(ids.map((_, i) => i * 15));
    expect(new Set(allMessages().map((m) => m.body.retailerId)).size).toBe(250);
  });

  it('never delays a message by more than the 24 hours the queue allows', async () => {
    await seedRetailers(t.db, Array.from({ length: 120 }, (_, i) => ({ id: i + 1 })));
    const { queue, allMessages } = fakeQueue();
    await startRun(makeEnv(t.db, queue, { STAGGER_SECONDS: '3600' }), 'cron', fakeDeps().deps);
    expect(Math.max(...allMessages().map((m) => m.delaySeconds ?? 0))).toBe(86400);
  });

  it('falls back to 15 seconds and warns when STAGGER_SECONDS is not valid', async () => {
    await seedRetailers(t.db, [{ id: 1 }, { id: 2 }]);
    const { queue, allMessages } = fakeQueue();
    const { deps, named } = fakeDeps();
    await startRun(makeEnv(t.db, queue, { STAGGER_SECONDS: 'soon' }), 'cron', deps);
    expect(allMessages().map((m) => m.delaySeconds)).toEqual([0, 15]);
    expect(named('stagger_invalid')).toHaveLength(1);
    expect(named('stagger_invalid')[0]?.fields).toEqual({ value: 'soon', usedSeconds: 15 });
  });

  it('allows zero stores: a run with a total of 0 and no queue call', async () => {
    const { queue, calls } = fakeQueue();
    const out = await startRun(makeEnv(t.db, queue), 'cron', fakeDeps().deps);
    expect(out.storesTotal).toBe(0);
    expect(calls).toEqual([]);
    expect(await rows(t.db, 'SELECT stores_total FROM pipeline_runs')).toEqual([{ stores_total: 0 }]);
  });

  it('logs run_started once, and uses no field name the logger would drop', async () => {
    await seedRetailers(t.db, [{ id: 1 }]);
    const { deps, named, entries } = fakeDeps();
    await startRun(makeEnv(t.db, fakeQueue().queue), 'manual', deps);
    expect(named('run_started')).toEqual([{ level: 'info', message: 'run_started', fields: { runId: 1, trigger: 'manual', storesTotal: 1 } }]);
    for (const entry of entries) {
      for (const reserved of ['level', 'message', 'time']) expect(Object.keys(entry.fields ?? {})).not.toContain(reserved);
    }
  });

  it('logs and rethrows a queue failure, and leaves the run open so the close step can show the gap', async () => {
    await seedRetailers(t.db, Array.from({ length: 150 }, (_, i) => ({ id: i + 1 })));
    const { queue, calls } = fakeQueue({ failOnCall: 2 });
    const { deps, named } = fakeDeps();
    await expect(startRun(makeEnv(t.db, queue), 'cron', deps)).rejects.toThrow('QUEUE_ERROR');
    expect(calls).toHaveLength(1);
    expect(named('run_enqueue_failed')).toHaveLength(1);
    expect(named('run_started')).toHaveLength(0);
    expect(await rows(t.db, 'SELECT stores_total, finished_at FROM pipeline_runs')).toEqual([{ stores_total: 150, finished_at: null }]);
  });

  it('creates a second run when started twice, never a second copy of anything else', async () => {
    await seedRetailers(t.db, [{ id: 1 }, { id: 2 }]);
    const env = makeEnv(t.db, fakeQueue().queue);
    await startRun(env, 'cron', fakeDeps().deps);
    await startRun(env, 'manual', fakeDeps().deps);
    expect(await rows(t.db, 'SELECT id, trigger FROM pipeline_runs ORDER BY id')).toEqual([
      { id: 1, trigger: 'cron' },
      { id: 2, trigger: 'manual' },
    ]);
    expect(await rows(t.db, 'SELECT COUNT(*) AS n FROM retailers')).toEqual([{ n: 2 }]);
  });
});

describe('startRun for one store', () => {
  it('has only that store, whatever else is visible, and the usual delay of 0', async () => {
    await seedRetailers(t.db, [{ id: 1 }, { id: 2 }, { id: 3 }]);
    const { queue, allMessages } = fakeQueue();
    const out = await startRun(makeEnv(t.db, queue), 'manual', fakeDeps().deps, { retailerId: 2 });
    expect(out).toEqual({ runId: 1, storesTotal: 1 });
    expect(allMessages()).toEqual([{ body: { runId: 1, retailerId: 2 }, delaySeconds: 0 }]);
    expect(await rows(t.db, 'SELECT trigger, stores_total FROM pipeline_runs')).toEqual([{ trigger: 'manual', stores_total: 1 }]);
  });
});

