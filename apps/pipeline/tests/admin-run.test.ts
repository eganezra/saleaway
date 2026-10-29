import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleFetch } from '../src/handlers';
import { createTestDb, flakyDb, resetData, rows, seedRetailers } from './helpers/db';
import type { TestDb } from './helpers/db';
import { fakeDeps, fakeQueue, makeEnv } from './helpers/fakes';
import type { EnvOverrides } from './helpers/fakes';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 30_000);
afterAll(async () => {
  await t.dispose();
});
beforeEach(async () => {
  await resetData(t.db);
  await seedRetailers(t.db, [{ id: 1 }, { id: 2 }, { id: 3 }]);
});

const TOKEN = 'a-long-test-token-0123456789abcdef0123456789';
const post = (token?: string, path = '/admin/run') =>
  new Request(`https://pipeline.example${path}`, { method: 'POST', headers: token === undefined ? {} : { Authorization: `Bearer ${token}` } });

async function call(request: Request, overrides: EnvOverrides = {}, db: D1Database = t.db) {
  const queue = fakeQueue();
  const logger = fakeDeps({ start: '2026-10-30T10:00:00Z' });
  const response = await handleFetch(request, makeEnv(db, queue.queue, { ADMIN_TOKEN: TOKEN, ...overrides }), logger.deps);
  return { response, queue, ...logger };
}
const runs = () => rows(t.db, 'SELECT id, trigger, stores_total FROM pipeline_runs ORDER BY id');

describe('POST /admin/run', () => {
  it('starts a manual run with the right token and says what it started', async () => {
    const { response, queue, named } = await call(post(TOKEN));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, runId: 1, storesTotal: 3 });
    expect(await runs()).toEqual([{ id: 1, trigger: 'manual', stores_total: 3 }]);
    expect(queue.allMessages()).toHaveLength(3);
    expect(named('run_started')).toHaveLength(1);
  });

  it('rejects a missing, wrong or empty token with 401 and the error shape, and starts nothing', async () => {
    for (const token of [undefined, 'wrong', '', TOKEN.slice(0, -1), `${TOKEN}x`]) {
      const { response, queue } = await call(post(token));
      expect(response.status).toBe(401);
      const body = (await response.json()) as { error: Record<string, string> };
      expect(Object.keys(body.error).sort()).toEqual(['code', 'message', 'requestId', 'timestamp']);
      expect(body.error.code).toBe('unauthorized');
      expect(body.error.timestamp).toBe('2026-10-30T10:00:00Z');
      expect(body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(queue.calls).toEqual([]);
    }
    expect(await runs()).toEqual([]);
  });

  it('rejects everything when no token is configured', async () => {
    const { response } = await call(post(TOKEN), { ADMIN_TOKEN: '' });
    expect(response.status).toBe(401);
    expect(await runs()).toEqual([]);
  });

  it('answers 409 "paused" for a correct token, and 401 for a wrong token even when paused', async () => {
    const paused = await call(post(TOKEN), { PIPELINE_ENABLED: 'false' });
    expect(paused.response.status).toBe(409);
    expect(((await paused.response.json()) as { error: { code: string } }).error.code).toBe('paused');
    const wrong = await call(post('wrong'), { PIPELINE_ENABLED: 'false' });
    expect(wrong.response.status).toBe(401);
    expect(await runs()).toEqual([]);
  });

  it('answers 500 "run_failed" with no technical detail when the run cannot start, and logs the error', async () => {
    const { response, named } = await call(post(TOKEN), {}, flakyDb(t.db, 1));
    expect(response.status).toBe(500);
    const text = JSON.stringify(await response.json());
    expect(text).toContain('run_failed');
    expect(text).not.toMatch(/D1_ERROR|simulated|outage/);
    expect(named('run_failed')).toHaveLength(1);
  });
});

describe('every other request', () => {
  it('answers a plain 404 for other paths and methods, with no hint that /admin/run exists', async () => {
    const requests = [
      new Request('https://pipeline.example/'),
      new Request('https://pipeline.example/health'),
      new Request('https://pipeline.example/admin/run'),
      new Request('https://pipeline.example/admin/run', { method: 'PUT', headers: { Authorization: `Bearer ${TOKEN}` } }),
      post(TOKEN, '/admin/run/'),
      post(TOKEN, '/admin'),
    ];
    for (const request of requests) {
      const { response } = await call(request);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('Not found');
    }
    expect(await runs()).toEqual([]);
  });
});
