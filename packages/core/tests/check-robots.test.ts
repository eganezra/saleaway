import { describe, expect, it } from 'vitest';
import type { FetchFn } from '../src/fetcher';
import { USER_AGENT } from '../src/fetcher';
import { checkRobots } from '../src/robots';
import { fakeFetch } from './helpers/fake-fetch';

/** The decision only: most tests are about that. */
const decide = async (origin: string, pathAndQuery: string, fetchFn: FetchFn) => (await checkRobots(origin, pathAndQuery, fetchFn)).decision;
const ORIGIN = 'https://shop.example';
const ROBOTS = `${ORIGIN}/robots.txt`;

describe('checkRobots', () => {
  it('asks for robots.txt of the site with the user-agent, before anything else', async () => {
    const { fetch, requests } = fakeFetch({ [ROBOTS]: { status: 200, body: 'User-agent: *\nDisallow:\n' } });
    await decide(ORIGIN, '/sale', fetch);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(ROBOTS);
    expect((requests[0]?.init?.headers as Record<string, string>)['User-Agent']).toBe(USER_AGENT);
  });

  it('uses the rules of a file that arrives', async () => {
    const body = 'User-agent: *\nDisallow: /cart\nDisallow: /sale\nAllow: /sale/ok\n';
    const { fetch } = fakeFetch({ [ROBOTS]: { status: 200, body } });
    expect(await decide(ORIGIN, '/sale', fetch)).toBe('disallowed');
    expect(await decide(ORIGIN, '/sale/ok', fakeFetch({ [ROBOTS]: { status: 200, body } }).fetch)).toBe('allowed');
    expect(await decide(ORIGIN, '/deals', fakeFetch({ [ROBOTS]: { status: 200, body } }).fetch)).toBe('allowed');
  });

  it('obeys a rule written for SaleawayBot by name', async () => {
    const body = 'User-agent: *\nDisallow:\n\nUser-agent: SaleawayBot\nDisallow: /\n';
    expect(await decide(ORIGIN, '/sale', fakeFetch({ [ROBOTS]: { status: 200, body } }).fetch)).toBe('disallowed');
  });

  it('a missing or forbidden robots.txt (any 4xx) means everything is allowed', async () => {
    for (const status of [400, 401, 403, 404, 410, 429, 451]) {
      expect(await decide(ORIGIN, '/sale', fakeFetch({ [ROBOTS]: { status } }).fetch), String(status)).toBe('allowed');
    }
  });

  it('an unreachable robots.txt (5xx, timeout, network, endless redirect) means the page must not be fetched', async () => {
    for (const status of [500, 502, 503, 504]) {
      expect(await decide(ORIGIN, '/sale', fakeFetch({ [ROBOTS]: { status } }).fetch), String(status)).toBe('unreachable');
    }
    expect(await decide(ORIGIN, '/sale', fakeFetch({ [ROBOTS]: { throws: 'timeout' } }).fetch)).toBe('unreachable');
    expect(await decide(ORIGIN, '/sale', fakeFetch({ [ROBOTS]: { throws: 'network' } }).fetch)).toBe('unreachable');
    expect(await decide(ORIGIN, '/sale', fakeFetch({ [ROBOTS]: { status: 301, headers: { Location: ROBOTS } } }).fetch)).toBe('unreachable');
  });

  it('follows a redirect of robots.txt on the same site', async () => {
    const { fetch, urls } = fakeFetch({
      [ROBOTS]: { status: 301, headers: { Location: 'https://www.shop.example/robots.txt' } },
      'https://www.shop.example/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /\n' },
    });
    expect(await decide(ORIGIN, '/sale', fetch)).toBe('disallowed');
    expect(urls()).toHaveLength(2);
  });

  it('an unsafe origin makes no request and is unreachable', async () => {
    const { fetch, requests } = fakeFetch({});
    expect(await decide('https://127.0.0.1', '/sale', fetch)).toBe('unreachable');
    expect(requests).toEqual([]);
  });

  it('reads at most 500 KiB of a large file, so rules past that point are not seen', async () => {
    const padding = `# ${'x'.repeat(100)}\n`.repeat(6000); // about 600 KiB of comments
    const late = `${padding}User-agent: *\nDisallow: /late\n`;
    expect(await decide(ORIGIN, '/late', fakeFetch({ [ROBOTS]: { status: 200, body: late } }).fetch)).toBe('allowed');
    const early = `User-agent: *\nDisallow: /early\n${padding}`;
    expect(await decide(ORIGIN, '/early', fakeFetch({ [ROBOTS]: { status: 200, body: early } }).fetch)).toBe('disallowed');
  });

  it('stops reading a long body at 500 KiB and frees it', async () => {
    const chunk = new TextEncoder().encode(`${'# padding '.repeat(100)}\n`); // about 1 KiB
    const state = { pulls: 0, cancelled: false };
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          state.pulls += 1;
          controller.enqueue(chunk);
        },
        cancel() {
          state.cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    expect(await decide(ORIGIN, '/sale', async () => new Response(stream, { status: 200 }))).toBe('allowed');
    expect(state.cancelled).toBe(true);
    expect(state.pulls).toBeLessThan(Math.ceil((500 * 1024) / chunk.byteLength) + 2); // an endless body does not hang
  });

  it('does not use text beyond 500 KiB even when one chunk carries it', async () => {
    const head = 'User-agent: *\n# ';
    const filler = 'x'.repeat(500 * 1024 - head.length - 1);
    const body = `${head}${filler}\nDisallow: /sale\n`; // the rule starts after the 500 KiB mark
    const { fetch } = fakeFetch({ [ROBOTS]: { status: 200, body } });
    expect(await decide(ORIGIN, '/sale', fetch)).toBe('allowed');
  });

  it('treats an HTML error page served as robots.txt as no rules', async () => {
    const { fetch } = fakeFetch({ [ROBOTS]: { status: 200, body: '<html><body>Not found</body></html>' } });
    expect(await decide(ORIGIN, '/sale', fetch)).toBe('allowed');
  });

  it('returns the robots.txt text when it was read, so another path can be checked without a second request', async () => {
    const body = 'User-agent: *\nDisallow: /collections/*/products.json\n';
    const { fetch, urls } = fakeFetch({ [ROBOTS]: { status: 200, body } });
    const result = await checkRobots(ORIGIN, '/sale', fetch);
    expect(result).toEqual({ decision: 'allowed', text: body });
    expect(urls()).toEqual([ROBOTS]);
  });
  it('returns no text when there was no file or it could not be read', async () => {
    expect(await checkRobots(ORIGIN, '/sale', fakeFetch({ [ROBOTS]: { status: 404 } }).fetch)).toEqual({ decision: 'allowed', text: null });
    expect(await checkRobots(ORIGIN, '/sale', fakeFetch({ [ROBOTS]: { status: 503 } }).fetch)).toEqual({ decision: 'unreachable', text: null });
    expect(await checkRobots(ORIGIN, '/sale', fakeFetch({ [ROBOTS]: { throws: 'network' } }).fetch)).toEqual({ decision: 'unreachable', text: null });
  });
  it('returns the text of a file that forbids the page too', async () => {
    const body = 'User-agent: *\nDisallow: /sale\n';
    expect(await checkRobots(ORIGIN, '/sale', fakeFetch({ [ROBOTS]: { status: 200, body } }).fetch)).toEqual({ decision: 'disallowed', text: body });
  });
});
