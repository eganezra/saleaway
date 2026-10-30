import { describe, expect, it } from 'vitest';
import { PAGE_CACHE_SECONDS, cachedPage } from '../src/lib/cache';
import type { PageCache } from '../src/lib/cache';

/** A fake cache that keeps what it is given, by address. */
function fakeCache(over: Partial<PageCache> = {}) {
  const store = new Map<string, Response>();
  const puts: string[] = [];
  const cache: PageCache = {
    match: async (request) => store.get(request.url)?.clone(),
    put: async (request, response) => {
      puts.push(request.url);
      store.set(request.url, response);
    },
    ...over,
  };
  return { cache, store, puts };
}

function harness(over: Partial<PageCache> = {}) {
  const { cache, store, puts } = fakeCache(over);
  const waited: Array<Promise<unknown>> = [];
  const deps = { cache, version: 'b1', waitUntil: (p: Promise<unknown>) => void waited.push(p) };
  return { deps, store, puts, waited };
}

const page = (body = '<h1>Saleaway</h1>', init: ResponseInit = {}): (() => Promise<Response>) => {
  const render = async () =>
    new Response(body, { status: 200, headers: { 'cache-control': 'public, max-age=600', 'content-type': 'text/html' }, ...init });
  return render;
};
const counting = (render: () => Promise<Response>) => {
  const state = { calls: 0 };
  return { state, next: async () => (state.calls++, render()) };
};
const get = (url: string, method = 'GET') => new Request(url, { method });

describe('cachedPage (AC3, AC5)', () => {
  it('renders on a miss, stores a copy, and says MISS', async () => {
    const { deps, store, puts, waited } = harness();
    const { state, next } = counting(page('<h1>hello</h1>'));
    const response = await cachedPage(get('https://saleaway.example/'), next, deps);
    expect(state.calls).toBe(1);
    expect(response.headers.get('x-cache')).toBe('MISS');
    expect(await response.text()).toBe('<h1>hello</h1>');
    await Promise.all(waited);
    expect(puts).toEqual(['https://saleaway.example/?v=b1']);
    expect(await store.get('https://saleaway.example/?v=b1')?.text()).toBe('<h1>hello</h1>');
  });

  it('serves the next request from the cache without rendering, and says HIT', async () => {
    const { deps, waited } = harness();
    const { state, next } = counting(page('<h1>once</h1>'));
    await cachedPage(get('https://saleaway.example/'), next, deps);
    await Promise.all(waited);
    const again = await cachedPage(get('https://saleaway.example/'), next, deps);
    expect(state.calls).toBe(1);
    expect(again.headers.get('x-cache')).toBe('HIT');
    expect(await again.text()).toBe('<h1>once</h1>');
  });

  it('keeps the stored status, body and Cache-Control', async () => {
    const { deps, waited } = harness();
    const { next } = counting(page('<p>x</p>'));
    await cachedPage(get('https://saleaway.example/'), next, deps);
    await Promise.all(waited);
    const hit = await cachedPage(get('https://saleaway.example/'), next, deps);
    expect(hit.status).toBe(200);
    expect(hit.headers.get('cache-control')).toBe('public, max-age=600');
    expect(hit.headers.get('content-type')).toBe('text/html');
  });

  it('ignores the query string in the key, and keeps different paths apart', async () => {
    const { deps, puts, waited } = harness();
    const { state, next } = counting(page());
    await cachedPage(get('https://saleaway.example/?a=1'), next, deps);
    await Promise.all(waited);
    expect(puts).toEqual(['https://saleaway.example/?v=b1']);
    const other = await cachedPage(get('https://saleaway.example/?utm_source=x&b=2'), next, deps);
    expect(other.headers.get('x-cache')).toBe('HIT');
    expect(state.calls).toBe(1);
    const elsewhere = await cachedPage(get('https://saleaway.example/about'), next, deps);
    expect(elsewhere.headers.get('x-cache')).toBe('MISS');
    expect(state.calls).toBe(2);
  });

  it('never serves the page of another build: the build is part of the key', async () => {
    const { cache, puts } = fakeCache();
    const waited: Array<Promise<unknown>> = [];
    const waitUntil = (p: Promise<unknown>) => void waited.push(p);
    const old = counting(page('<link href="/_astro/old.css">'));
    const fresh = counting(page('<link href="/_astro/new.css">'));
    await cachedPage(get('https://saleaway.example/'), old.next, { cache, version: 'build-1', waitUntil });
    await Promise.all(waited);
    const afterDeploy = await cachedPage(get('https://saleaway.example/'), fresh.next, { cache, version: 'build-2', waitUntil });
    expect(afterDeploy.headers.get('x-cache')).toBe('MISS');
    expect(fresh.state.calls).toBe(1);
    expect(await afterDeploy.text()).toContain('new.css');
    await Promise.all(waited);
    expect(puts).toEqual(['https://saleaway.example/?v=build-1', 'https://saleaway.example/?v=build-2']);
    const sameBuild = await cachedPage(get('https://saleaway.example/'), fresh.next, { cache, version: 'build-1', waitUntil });
    expect(sameBuild.headers.get('x-cache')).toBe('HIT');
    expect(await sameBuild.text()).toContain('old.css');
  });

  it('encodes a build name that has characters special in an address', async () => {
    const { cache, puts } = fakeCache();
    const waited: Array<Promise<unknown>> = [];
    await cachedPage(get('https://saleaway.example/'), page(), { cache, version: 'a b&c', waitUntil: (p) => void waited.push(p) });
    await Promise.all(waited);
    expect(puts).toEqual(['https://saleaway.example/?v=a%20b%26c']);
  });

  it('does not store a 503, or a 200 that says no-store, or a 200 that is not public', async () => {
    for (const render of [
      page('down', { status: 503, headers: { 'cache-control': 'no-store' } }),
      page('empty', { status: 200, headers: { 'cache-control': 'no-store' } }),
      page('private', { status: 200, headers: { 'cache-control': 'private, max-age=600' } }),
      page('none', { status: 200, headers: {} }),
      page('public but 503', { status: 503, headers: { 'cache-control': 'public, max-age=600' } }),
    ]) {
      const { deps, store, waited } = harness();
      const { state, next } = counting(render);
      const first = await cachedPage(get('https://saleaway.example/'), next, deps);
      expect(first.headers.get('x-cache')).toBe('BYPASS');
      await Promise.all(waited);
      expect(store.size).toBe(0);
      const second = await cachedPage(get('https://saleaway.example/'), next, deps);
      expect(second.headers.get('x-cache')).toBe('BYPASS');
      expect(state.calls).toBe(2);
    }
  });

  it('keeps the status of what it does not store', async () => {
    const { deps } = harness();
    const response = await cachedPage(get('https://saleaway.example/'), page('down', { status: 503, headers: { 'cache-control': 'no-store' } }), deps);
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it.each(['POST', 'PUT', 'DELETE', 'HEAD'])('sends a %s request straight to the renderer and never touches the cache', async (method) => {
    let touched = 0;
    const { deps } = harness({
      match: async () => (touched++, undefined),
      put: async () => void touched++,
    });
    const { state, next } = counting(page());
    const response = await cachedPage(get('https://saleaway.example/', method), next, deps);
    expect(state.calls).toBe(1);
    expect(touched).toBe(0);
    expect(response.headers.get('x-cache')).toBeNull();
  });

  it('renders and returns the page when the cache lookup throws (BYPASS)', async () => {
    const { deps, puts } = harness({
      match: async () => {
        throw new Error('cache down');
      },
    });
    const { state, next } = counting(page('<p>fine</p>'));
    const response = await cachedPage(get('https://saleaway.example/'), next, deps);
    expect(state.calls).toBe(1);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-cache')).toBe('BYPASS');
    expect(await response.text()).toBe('<p>fine</p>');
    expect(puts).toEqual([]);
  });

  it('returns the page when put throws at once (BYPASS)', async () => {
    const { deps } = harness({
      put: () => {
        throw new Error('put exploded');
      },
    });
    const { next } = counting(page('<p>still fine</p>'));
    const response = await cachedPage(get('https://saleaway.example/'), next, deps);
    expect(response.headers.get('x-cache')).toBe('BYPASS');
    expect(await response.text()).toBe('<p>still fine</p>');
  });

  it('returns the page when put fails later, without an unhandled rejection', async () => {
    const { deps, waited } = harness({ put: async () => Promise.reject(new Error('quota')) });
    const { next } = counting(page('<p>ok</p>'));
    const response = await cachedPage(get('https://saleaway.example/'), next, deps);
    expect(response.headers.get('x-cache')).toBe('MISS');
    expect(await response.text()).toBe('<p>ok</p>');
    await expect(Promise.all(waited)).resolves.toBeDefined();
  });

  it('hands put to waitUntil and does not wait for it before answering', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const waited: Array<Promise<unknown>> = [];
    const cache: PageCache = { match: async () => undefined, put: async () => gate };
    const response = await cachedPage(get('https://saleaway.example/'), page('<p>quick</p>'), { cache, version: 'b1', waitUntil: (p) => void waited.push(p) });
    expect(response.headers.get('x-cache')).toBe('MISS');
    expect(waited).toHaveLength(1);
    release();
    await Promise.all(waited);
  });

  it('can tag a response whose headers are read-only', async () => {
    const readOnly = new Response('<p>frozen</p>', { headers: { 'cache-control': 'public, max-age=600' } });
    Object.defineProperty(readOnly.headers, 'set', {
      value: () => {
        throw new TypeError('immutable');
      },
    });
    const { deps } = harness({ match: async () => readOnly });
    const response = await cachedPage(get('https://saleaway.example/'), page(), deps);
    expect(response.headers.get('x-cache')).toBe('HIT');
  });

  it('keeps pages for 600 seconds', () => {
    expect(PAGE_CACHE_SECONDS).toBe(600);
  });
});
