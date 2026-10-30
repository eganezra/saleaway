import { describe, expect, it } from 'vitest';
import { USER_AGENT } from '../src/fetcher';
import { checkRobots } from '../src/robots';
import { fakeFetch } from './helpers/fakes';

const ORIGIN = 'https://shop.example';
const ROBOTS = `${ORIGIN}/robots.txt`;

describe('checkRobots', () => {
  it('asks for robots.txt of the site with the user-agent, before anything else', async () => {
    const { fetch, requests } = fakeFetch({ [ROBOTS]: { status: 200, body: 'User-agent: *\nDisallow:\n' } });
    await checkRobots(ORIGIN, '/sale', fetch);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(ROBOTS);
    expect((requests[0]?.init?.headers as Record<string, string>)['User-Agent']).toBe(USER_AGENT);
  });

  it('uses the rules of a file that arrives', async () => {
    const body = 'User-agent: *\nDisallow: /cart\nDisallow: /sale\nAllow: /sale/ok\n';
    const { fetch } = fakeFetch({ [ROBOTS]: { status: 200, body } });
    expect(await checkRobots(ORIGIN, '/sale', fetch)).toBe('disallowed');
    expect(await checkRobots(ORIGIN, '/sale/ok', fakeFetch({ [ROBOTS]: { status: 200, body } }).fetch)).toBe('allowed');
    expect(await checkRobots(ORIGIN, '/deals', fakeFetch({ [ROBOTS]: { status: 200, body } }).fetch)).toBe('allowed');
  });

  it('obeys a rule written for SaleawayBot by name', async () => {
    const body = 'User-agent: *\nDisallow:\n\nUser-agent: SaleawayBot\nDisallow: /\n';
    expect(await checkRobots(ORIGIN, '/sale', fakeFetch({ [ROBOTS]: { status: 200, body } }).fetch)).toBe('disallowed');
  });

  it('a missing or forbidden robots.txt (any 4xx) means everything is allowed', async () => {
    for (const status of [400, 401, 403, 404, 410, 429, 451]) {
      expect(await checkRobots(ORIGIN, '/sale', fakeFetch({ [ROBOTS]: { status } }).fetch), String(status)).toBe('allowed');
    }
  });

  it('an unreachable robots.txt (5xx, timeout, network, endless redirect) means the page must not be fetched', async () => {
    for (const status of [500, 502, 503, 504]) {
      expect(await checkRobots(ORIGIN, '/sale', fakeFetch({ [ROBOTS]: { status } }).fetch), String(status)).toBe('unreachable');
    }
    expect(await checkRobots(ORIGIN, '/sale', fakeFetch({ [ROBOTS]: { throws: 'timeout' } }).fetch)).toBe('unreachable');
    expect(await checkRobots(ORIGIN, '/sale', fakeFetch({ [ROBOTS]: { throws: 'network' } }).fetch)).toBe('unreachable');
    expect(await checkRobots(ORIGIN, '/sale', fakeFetch({ [ROBOTS]: { status: 301, headers: { Location: ROBOTS } } }).fetch)).toBe('unreachable');
  });

  it('follows a redirect of robots.txt on the same site', async () => {
    const { fetch, urls } = fakeFetch({
      [ROBOTS]: { status: 301, headers: { Location: 'https://www.shop.example/robots.txt' } },
      'https://www.shop.example/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /\n' },
    });
    expect(await checkRobots(ORIGIN, '/sale', fetch)).toBe('disallowed');
    expect(urls()).toHaveLength(2);
  });

  it('an unsafe origin makes no request and is unreachable', async () => {
    const { fetch, requests } = fakeFetch({});
    expect(await checkRobots('https://127.0.0.1', '/sale', fetch)).toBe('unreachable');
    expect(requests).toEqual([]);
  });

  it('reads at most 500 KiB of a large file, so rules past that point are not seen', async () => {
    const padding = `# ${'x'.repeat(100)}\n`.repeat(6000); // about 600 KiB of comments
    const late = `${padding}User-agent: *\nDisallow: /late\n`;
    expect(await checkRobots(ORIGIN, '/late', fakeFetch({ [ROBOTS]: { status: 200, body: late } }).fetch)).toBe('allowed');
    const early = `User-agent: *\nDisallow: /early\n${padding}`;
    expect(await checkRobots(ORIGIN, '/early', fakeFetch({ [ROBOTS]: { status: 200, body: early } }).fetch)).toBe('disallowed');
  });

  it('treats an HTML error page served as robots.txt as no rules', async () => {
    const { fetch } = fakeFetch({ [ROBOTS]: { status: 200, body: '<html><body>Not found</body></html>' } });
    expect(await checkRobots(ORIGIN, '/sale', fetch)).toBe('allowed');
  });
});
