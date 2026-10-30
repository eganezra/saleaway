import { describe, expect, it } from 'vitest';
import { MAX_BODY_BYTES, handleClick } from '../src/lib/clickHandler';
import type { ClickDeps } from '../src/lib/clickHandler';

const URL_ = 'https://saleaway.example/api/click';
const NOW = new Date('2026-10-31T10:00:00Z');

function harness(over: { changes?: number; fail?: boolean; random?: number; rate?: string } = {}) {
  const writes: Array<{ binds: unknown[] }> = [];
  const logs: Array<{ message: string; fields?: Record<string, unknown> }> = [];
  const db = {
    prepare() {
      return {
        bind: (...binds: unknown[]) => ({
          run: async () => {
            if (over.fail) throw new Error('D1_ERROR: database unavailable');
            writes.push({ binds });
            return { meta: { changes: over.changes ?? 1 } };
          },
        }),
      };
    },
  } as unknown as ClickDeps['db'];
  const deps: ClickDeps = {
    db,
    log: { error: (message, fields) => void logs.push({ message, fields }) },
    random: () => over.random ?? 0,
    now: () => NOW,
    sampleRate: over.rate,
  };
  return { deps, writes, logs };
}
const post = (body: string, headers: Record<string, string> = {}) => new Request(URL_, { method: 'POST', body, headers: { 'content-type': 'text/plain;charset=UTF-8', ...headers } });

describe('handleClick (Story 2.5)', () => {
  it('counts a click for a store: 204, one write with today and the amount', async () => {
    const { deps, writes } = harness();
    const response = await handleClick(post('takealot'), deps);
    expect(response.status).toBe(204);
    expect(writes).toEqual([{ binds: ['2026-10-31', 1, 'takealot'] }]);
  });

  it('answers 404 when the store is unknown', async () => {
    const { deps } = harness({ changes: 0 });
    expect((await handleClick(post('nobody'), deps)).status).toBe(404);
  });

  it.each(['', '   ', 'Bad Slug!', '<script>', 'a'.repeat(101)])('answers 400 for the body %j', async (body) => {
    const { deps, writes } = harness();
    const response = await handleClick(post(body), deps);
    expect([400, 413]).toContain(response.status);
    expect(writes).toEqual([]);
  });
  it('answers 400 for an empty body', async () => {
    const { deps } = harness();
    expect((await handleClick(new Request(URL_, { method: 'POST' }), deps)).status).toBe(400);
  });

  it('answers 413 for a body over 100 bytes, announced or not', async () => {
    const { deps, writes } = harness();
    expect((await handleClick(post('a'.repeat(MAX_BODY_BYTES + 1)), deps)).status).toBe(413);
    // no content-length: a streamed body that is too long
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('a'.repeat(200)));
        controller.close();
      },
    });
    const streamed = new Request(URL_, { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    expect((await handleClick(streamed, deps)).status).toBe(413);
    expect(writes).toEqual([]);
  });
  it('accepts a body of exactly 100 bytes only if it is a slug (and a slug that long is a valid one)', async () => {
    const { deps } = harness();
    expect((await handleClick(post('a'.repeat(MAX_BODY_BYTES)), deps)).status).toBe(204);
  });

  it('answers 403 for an Origin that is another site, and allows the same site or none', async () => {
    const { deps, writes } = harness();
    expect((await handleClick(post('takealot', { origin: 'https://evil.example' }), deps)).status).toBe(403);
    expect((await handleClick(post('takealot', { origin: 'null' }), deps)).status).toBe(403);
    expect(writes).toEqual([]);
    expect((await handleClick(post('takealot', { origin: 'https://saleaway.example' }), deps)).status).toBe(204);
    expect((await handleClick(post('takealot'), deps)).status).toBe(204);
  });

  it('counts only a sample when the rate is below 1, and adds 1 / rate: no write when the random number is at or above the rate', async () => {
    const skipped = harness({ rate: '0.5', random: 0.5 });
    expect((await handleClick(post('takealot'), skipped.deps)).status).toBe(204);
    expect(skipped.writes).toEqual([]);
    const counted = harness({ rate: '0.5', random: 0.49 });
    expect((await handleClick(post('takealot'), counted.deps)).status).toBe(204);
    expect(counted.writes).toEqual([{ binds: ['2026-10-31', 2, 'takealot'] }]);
  });
  it('estimates the true total when sampling: 1000 clicks at rate 0.1 write about 100 times and add about 1000', async () => {
    let seed = 7;
    const random = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const { deps, writes } = harness({ rate: '0.1' });
    deps.random = random;
    for (let n = 0; n < 1000; n++) await handleClick(post('takealot'), deps);
    const total = writes.reduce((sum, w) => sum + (w.binds[1] as number), 0);
    expect(writes.length).toBeGreaterThan(60);
    expect(writes.length).toBeLessThan(140);
    expect(total).toBeGreaterThan(600);
    expect(total).toBeLessThan(1400);
  });

  it('answers 503 and logs once, with the slug and the error and nothing of the visitor, when the database fails', async () => {
    const { deps, logs } = harness({ fail: true });
    const request = post('takealot', { 'user-agent': 'SecretBrowser/9', referer: 'https://elsewhere.example/page', 'cf-connecting-ip': '203.0.113.7', cookie: 'a=b' });
    const response = await handleClick(request, deps);
    expect(response.status).toBe(503);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.message).toBe('click_failed');
    expect(Object.keys(logs[0]?.fields ?? {}).sort()).toEqual(['err', 'slug']);
    expect(JSON.stringify(logs)).not.toMatch(/SecretBrowser|elsewhere|203\.0\.113|a=b/);
  });

  it('never sets a cookie and always says no-store', async () => {
    for (const run of [
      handleClick(post('takealot'), harness().deps),
      handleClick(post('nobody'), harness({ changes: 0 }).deps),
      handleClick(post('Bad!'), harness().deps),
      handleClick(post('takealot', { origin: 'https://evil.example' }), harness().deps),
      handleClick(post('takealot'), harness({ fail: true }).deps),
      handleClick(post('takealot'), harness({ rate: '0.5', random: 0.9 }).deps),
    ]) {
      const response = await run;
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('set-cookie')).toBeNull();
    }
  });

  it('never throws, even when the request body cannot be read', async () => {
    const { deps } = harness();
    const broken = new Request(URL_, { method: 'POST', body: 'takealot' });
    Object.defineProperty(broken, 'body', {
      get() {
        throw new Error('cannot read');
      },
    });
    const response = await handleClick(broken, deps);
    expect(response.status).toBe(400);
  });
});
