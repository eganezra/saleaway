import { describe, expect, it } from 'vitest';
import { ACCEPT, FETCH_TIMEOUT_MS, MAX_REDIRECTS, USER_AGENT, discard, fetchPage } from '../src/fetcher';
import { fakeFetch } from './helpers/fakes';

const SALE = 'https://shop.example/sale';

describe('fetchPage', () => {
  it('has the user-agent with a contact address, the limits of the story, and no other header', async () => {
    const { fetch, requests } = fakeFetch({ [SALE]: { status: 200, body: 'page' } });
    await fetchPage(SALE, fetch);
    expect(USER_AGENT).toBe('SaleawayBot/1.0 (+https://saleaway.online/contact)');
    expect(MAX_REDIRECTS).toBe(3);
    expect(FETCH_TIMEOUT_MS).toBe(10_000);
    expect(requests).toHaveLength(1);
    const init = requests[0]?.init;
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('manual');
    expect(init?.headers).toEqual({ 'User-Agent': USER_AGENT, Accept: ACCEPT });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns a 200 with the body unread, and the final URL', async () => {
    const { fetch } = fakeFetch({ [SALE]: { status: 200, body: 'page' } });
    const result = await fetchPage(SALE, fetch);
    expect(result).toMatchObject({ ok: true, status: 200, finalUrl: SALE, hops: 0 });
    if (result.ok) {
      expect(result.response.bodyUsed).toBe(false);
      expect(await result.response.text()).toBe('page');
    }
  });

  it('returns other statuses as they are, with the body unread', async () => {
    for (const status of [403, 404, 429, 500, 503]) {
      const { fetch } = fakeFetch({ [SALE]: { status } });
      expect(await fetchPage(SALE, fetch), String(status)).toMatchObject({ ok: true, status, hops: 0 });
    }
  });

  it('follows 1, 2 and 3 redirects (absolute and relative) and reports the final URL and the hops', async () => {
    const three = fakeFetch({
      [SALE]: { status: 301, headers: { Location: '/a' } },
      'https://shop.example/a': { status: 302, headers: { Location: 'https://www.shop.example/b' } },
      'https://www.shop.example/b': { status: 308, headers: { Location: '//www.shop.example/c' } },
      'https://www.shop.example/c': { status: 200 },
    });
    expect(await fetchPage(SALE, three.fetch)).toMatchObject({ ok: true, status: 200, finalUrl: 'https://www.shop.example/c', hops: 3 });
    expect(three.urls()).toEqual([SALE, 'https://shop.example/a', 'https://www.shop.example/b', 'https://www.shop.example/c']);

    const one = fakeFetch({ [SALE]: { status: 303, headers: { Location: '/collections/sale' } }, 'https://shop.example/collections/sale': { status: 200 } });
    expect(await fetchPage(SALE, one.fetch)).toMatchObject({ ok: true, finalUrl: 'https://shop.example/collections/sale', hops: 1 });
  });

  it('sends the user-agent on every hop', async () => {
    const { fetch, requests } = fakeFetch({
      [SALE]: { status: 307, headers: { Location: '/a' } },
      'https://shop.example/a': { status: 200 },
    });
    await fetchPage(SALE, fetch);
    expect(requests.map((r) => (r.init?.headers as Record<string, string>)['User-Agent'])).toEqual([USER_AGENT, USER_AGENT]);
  });

  it('a fourth redirect is too many, and it is never requested', async () => {
    const { fetch, urls } = fakeFetch({
      [SALE]: { status: 301, headers: { Location: '/1' } },
      'https://shop.example/1': { status: 301, headers: { Location: '/2' } },
      'https://shop.example/2': { status: 301, headers: { Location: '/3' } },
      'https://shop.example/3': { status: 301, headers: { Location: '/4' } },
      'https://shop.example/4': { status: 200 },
    });
    expect(await fetchPage(SALE, fetch)).toEqual({ ok: false, reason: 'too_many_redirects' });
    expect(urls()).toEqual([SALE, 'https://shop.example/1', 'https://shop.example/2', 'https://shop.example/3']);
  });

  it('an endless loop of redirects ends as too many', async () => {
    const { fetch } = fakeFetch({ [SALE]: { status: 302, headers: { Location: SALE } } });
    expect(await fetchPage(SALE, fetch)).toEqual({ ok: false, reason: 'too_many_redirects' });
  });

  it('never requests an unsafe redirect target', async () => {
    for (const location of ['http://shop.example/sale', 'https://127.0.0.1/', 'https://169.254.169.254/latest', 'https://localhost./', 'ftp://shop.example/', 'https://u:p@shop.example/', 'javascript:alert(1)']) {
      const { fetch, urls } = fakeFetch({ [SALE]: { status: 302, headers: { Location: location } } });
      expect(await fetchPage(SALE, fetch), location).toEqual({ ok: false, reason: 'unsafe_redirect' });
      expect(urls(), location).toEqual([SALE]);
    }
  });

  it('a redirect without a Location is a bad redirect', async () => {
    const { fetch } = fakeFetch({ [SALE]: { status: 302 } });
    expect(await fetchPage(SALE, fetch)).toEqual({ ok: false, reason: 'bad_redirect' });
  });

  it('an unsafe start URL makes no request at all', async () => {
    for (const url of ['http://shop.example/sale', 'https://127.0.0.1/', 'https://localhost./', 'not a url', '']) {
      const { fetch, requests } = fakeFetch({});
      expect(await fetchPage(url, fetch), url).toEqual({ ok: false, reason: 'unsafe_url' });
      expect(requests, url).toEqual([]);
    }
  });

  it('a timeout is reported as timeout, and any other failure as network', async () => {
    expect(await fetchPage(SALE, fakeFetch({ [SALE]: { throws: 'timeout' } }).fetch)).toEqual({ ok: false, reason: 'timeout' });
    expect(await fetchPage(SALE, fakeFetch({ [SALE]: { throws: 'network' } }).fetch)).toEqual({ ok: false, reason: 'network' });
    expect(await fetchPage(SALE, fakeFetch({}).fetch)).toEqual({ ok: false, reason: 'network' }); // no route: refused
  });

  it('a failure on a later hop is still reported', async () => {
    const { fetch } = fakeFetch({ [SALE]: { status: 301, headers: { Location: '/a' } }, 'https://shop.example/a': { throws: 'timeout' } });
    expect(await fetchPage(SALE, fetch)).toEqual({ ok: false, reason: 'timeout' });
  });

  it('gives every request a timeout signal that is not yet aborted', async () => {
    const { fetch, requests } = fakeFetch({ [SALE]: { status: 301, headers: { Location: '/a' } }, 'https://shop.example/a': { status: 200 } });
    await fetchPage(SALE, fetch);
    for (const request of requests) expect((request.init?.signal as AbortSignal).aborted).toBe(false);
  });

  it('discard frees a body without reading it and never throws', async () => {
    const response = new Response('x'.repeat(10));
    await expect(discard(response)).resolves.toBeUndefined();
    const broken = { body: { cancel: () => Promise.reject(new Error('already closed')) } } as unknown as Response;
    await expect(discard(broken)).resolves.toBeUndefined();
    await expect(discard(new Response(null))).resolves.toBeUndefined();
  });
});
