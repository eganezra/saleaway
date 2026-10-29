import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleQueue } from '../src/handlers';
import { insertRun } from '../src/repo';
import { createTestDb, flakyDb, resetData, rows, seedRetailers } from './helpers/db';
import type { TestDb } from './helpers/db';
import { fakeBatch, fakeDeps, fakeMessage, fakeQueue, makeEnv } from './helpers/fakes';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 30_000);
afterAll(async () => {
  await t.dispose();
});
beforeEach(async () => {
  await resetData(t.db);
  await seedRetailers(t.db, [{ id: 1, extractionMethod: 'manual' }, { id: 2 }, { id: 3 }]);
  await insertRun(t.db, '2026-10-30T03:00:00Z', 'cron', 3);
});

const results = () => rows(t.db, 'SELECT retailer_id, result, error FROM run_results ORDER BY retailer_id');
const envWith = (db: D1Database) => makeEnv(db, fakeQueue().queue);

describe('handleQueue', () => {
  it('processes a good message, acknowledges it, and logs nothing for a success', async () => {
    const { message, state } = fakeMessage({ runId: 1, retailerId: 1 });
    const { deps, entries } = fakeDeps();
    await handleQueue(fakeBatch([message]), envWith(t.db), deps);
    expect(state).toEqual({ acked: 1, retried: 0 });
    expect(await results()).toEqual([{ retailer_id: 1, result: 'skipped_manual', error: null }]);
    expect(entries).toEqual([]);
  });

  it('retries a message that fails on its first delivery, and writes no result yet', async () => {
    const { message, state } = fakeMessage({ runId: 1, retailerId: 2 }, 1);
    const { deps, named } = fakeDeps();
    await handleQueue(fakeBatch([message]), envWith(flakyDb(t.db, 1)), deps);
    expect(state).toEqual({ acked: 0, retried: 1 });
    expect(await results()).toEqual([]);
    expect(named('process_store_failed')).toHaveLength(1);
    expect(named('process_store_failed')[0]?.fields).toMatchObject({ runId: 1, retailerId: 2, attempts: 1 });
  });

  it('on the last delivery records an error result and acknowledges, so the store still has a result', async () => {
    // The first database call (inside processStore) fails; the second (recording the error) works.
    const { message, state } = fakeMessage({ runId: 1, retailerId: 2 }, 2);
    const { deps, named } = fakeDeps();
    await handleQueue(fakeBatch([message]), envWith(flakyDb(t.db, 1)), deps);
    expect(state).toEqual({ acked: 1, retried: 0 });
    expect(await results()).toEqual([{ retailer_id: 2, result: 'error', error: 'D1_ERROR: simulated outage' }]);
    expect(named('process_store_gave_up')).toHaveLength(1);
  });

  it('acknowledges even when the error result cannot be recorded, and logs that it could not', async () => {
    const { message, state } = fakeMessage({ runId: 1, retailerId: 2 }, 2);
    const { deps, named } = fakeDeps();
    await handleQueue(fakeBatch([message]), envWith(flakyDb(t.db, 2)), deps);
    expect(state).toEqual({ acked: 1, retried: 0 });
    expect(await results()).toEqual([]);
    expect(named('result_not_recorded')).toHaveLength(1);
  });

  it('acknowledges a message it cannot read, without a retry, and logs bad_job', async () => {
    const bodies: unknown[] = [null, 'text', 42, {}, { runId: 1 }, { runId: '1', retailerId: 2 }, { runId: 1.5, retailerId: 2 }];
    for (const body of bodies) {
      const { message, state } = fakeMessage(body, 1, 'bad-1');
      const { deps, named } = fakeDeps();
      await handleQueue(fakeBatch([message]), envWith(t.db), deps);
      expect(state).toEqual({ acked: 1, retried: 0 });
      expect(named('bad_job')).toEqual([{ level: 'error', message: 'bad_job', fields: { messageId: 'bad-1' } }]);
    }
    expect(await results()).toEqual([]);
  });

  it('keeps going through a batch when one message fails', async () => {
    const first = fakeMessage({ runId: 1, retailerId: 2 }, 1, 'a');
    const second = fakeMessage({ runId: 1, retailerId: 3 }, 1, 'b');
    const third = fakeMessage({ runId: 1, retailerId: 1 }, 1, 'c');
    await handleQueue(fakeBatch([first.message, second.message, third.message]), envWith(flakyDb(t.db, 1)), fakeDeps().deps);
    expect(first.state).toEqual({ acked: 0, retried: 1 });
    expect(second.state).toEqual({ acked: 1, retried: 0 });
    expect(third.state).toEqual({ acked: 1, retried: 0 });
    expect((await results()).map((r) => r.retailer_id)).toEqual([1, 3]);
  });

  it('a redelivered message does not add a second result', async () => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const { message } = fakeMessage({ runId: 1, retailerId: 2 }, attempt);
      await handleQueue(fakeBatch([message]), envWith(t.db), fakeDeps().deps);
    }
    expect(await results()).toHaveLength(1);
  });
});
