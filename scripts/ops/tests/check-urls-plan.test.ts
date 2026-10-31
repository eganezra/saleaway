import type { HiddenStores, SeedRetailer } from '@saleaway/core';
import { describe, expect, it } from 'vitest';
import {
  MAX_ONLY,
  blackFridayFlags,
  buildCheckFile,
  canRunNow,
  classOfAnswer,
  classOfRobots,
  estimateMinutes,
  isRequestable,
  passes,
  pathAndQueryOf,
  planChecks,
  readPreviousCheck,
  renderCheckMarkdown,
  robotsDecisionFor,
} from '../src/check-urls-plan';
import type { PageResult } from '../src/check-urls-plan';

const retailer = (overrides: Partial<SeedRetailer>): SeedRetailer => ({
  slug: 'shop',
  name: 'Shop',
  homepageUrl: 'https://shop.example',
  rank: 1,
  platform: null,
  saleUrl: 'https://shop.example/sale',
  blackFridayUrl: null,
  extractionMethod: 'html',
  seedStatus: 'verified_products',
  isVisible: true,
  categorySlug: 'fashion-apparel',
  ...overrides,
});

const hidden: HiddenStores = {
  decidedOn: '2026-10-30',
  source: 'test',
  reasons: { http_403: 'Answered 403.' },
  stores: [{ slug: 'locked', reason: 'http_403' }],
};

describe('planChecks', () => {
  const stores = [
    retailer({ slug: 'a', saleUrl: 'https://a.example/sale', blackFridayUrl: 'https://a.example/black-friday' }),
    retailer({ slug: 'b', saleUrl: 'https://a.example/sale' }),
    retailer({ slug: 'c', saleUrl: null, seedStatus: 'no_sale_page', isVisible: false }),
    retailer({ slug: 'locked', saleUrl: 'https://locked.example/deals', isVisible: false }),
    retailer({ slug: 'js', saleUrl: 'https://js.example/sale', seedStatus: 'verified_js_shell' }),
  ];
  const plan = planChecks(stores, hidden);

  it('asks for each distinct address once, in the order it first appears', () => {
    expect(plan.pages.map((page) => page.url)).toEqual([
      'https://a.example/sale',
      'https://a.example/black-friday',
      'https://locked.example/deals',
      'https://js.example/sale',
    ]);
    expect(plan.sites).toBe(3);
  });

  it('lists a store with no address and does not request it', () => {
    const subject = plan.subjects.find((item) => item.slug === 'c');
    expect(subject).toMatchObject({ kind: 'sale', url: null });
    expect(plan.pages.some((page) => page.url === 'null')).toBe(false);
  });

  it('checks a store\'s Black Friday address as well as its sale address, and none for a store without one', () => {
    expect(plan.subjects.filter((item) => item.slug === 'a').map((item) => item.kind)).toEqual(['sale', 'black_friday']);
    expect(plan.subjects.filter((item) => item.slug === 'b').map((item) => item.kind)).toEqual(['sale']);
  });

  it('marks the stores hidden by Story 3.9 with their reason', () => {
    expect(plan.subjects.find((item) => item.slug === 'locked')?.hiddenReason).toBe('http_403');
    expect(plan.subjects.find((item) => item.slug === 'a')?.hiddenReason).toBeNull();
  });

  it('knows a JavaScript store, and reads the year only of a Black Friday address', () => {
    const page = (url: string) => plan.pages.find((item) => item.url === url);
    expect(page('https://js.example/sale')?.knownJsShell).toBe(true);
    expect(page('https://a.example/sale')?.knownJsShell).toBe(false);
    expect(page('https://a.example/black-friday')?.wantYear).toBe(true);
    expect(page('https://a.example/sale')?.wantYear).toBe(false);
  });

  it('is not a JavaScript page when a store that is not one shares the address', () => {
    const shared = planChecks([retailer({ slug: 'x', saleUrl: 'https://s.example/p', seedStatus: 'verified_js_shell' }), retailer({ slug: 'y', saleUrl: 'https://s.example/p' })], hidden);
    expect(shared.pages).toHaveLength(1);
    expect(shared.pages[0]?.knownJsShell).toBe(false);
  });

  it('limits the plan to the stores named with `only`', () => {
    const small = planChecks(stores, hidden, ['js']);
    expect(small.subjects.map((item) => item.slug)).toEqual(['js']);
    expect(small.pages).toHaveLength(1);
  });

  it('plans the real numbers of the seed file when given them', () => {
    expect(MAX_ONLY).toBe(3);
    expect(estimateMinutes(148, 15)).toBe(37);
    expect(estimateMinutes(1, 15)).toBe(0);
    expect(estimateMinutes(0, 15)).toBe(0);
  });
});

describe('one answer', () => {
  const URL_ = 'https://shop.example/sale';
  it.each([
    [200, URL_, false, 'ok'],
    [200, URL_, true, 'js_only'],
    [403, URL_, false, 'blocked'],
    [429, URL_, false, 'blocked'],
    [503, URL_, false, 'blocked'],
    [404, URL_, false, 'not_found'],
    [410, URL_, false, 'not_found'],
    [500, URL_, false, 'error'],
    [200, 'https://other.example/sale', false, 'redirected_away'],
    [200, 'https://shop.example/', false, 'redirected_away'],
    [200, 'https://shop.example/collections/sale', false, 'ok'],
  ] as Array<[number, string, boolean, string]>)('status %i ending at %s (js shell %s) is %s', (status, finalUrl, jsShell, expected) => {
    expect(classOfAnswer(URL_, finalUrl, status, jsShell)).toBe(expected);
  });

  it('turns a robots answer into a class, and an allowed one into none', () => {
    expect(classOfRobots('disallowed')).toBe('robots_disallow');
    expect(classOfRobots('unreachable')).toBe('robots_unreachable');
    expect(classOfRobots('allowed')).toBeNull();
  });

  it('uses one site\'s robots.txt for every page of that site', () => {
    const file = { decision: 'allowed' as const, text: 'User-agent: *\nDisallow: /cart\n' };
    expect(robotsDecisionFor(file, '/sale')).toBe('allowed');
    expect(robotsDecisionFor(file, '/cart/items')).toBe('disallowed');
    expect(robotsDecisionFor({ decision: 'allowed', text: null }, '/cart')).toBe('allowed');
    expect(robotsDecisionFor({ decision: 'unreachable', text: null }, '/sale')).toBe('unreachable');
  });

  it('never requests an address that is not safe', () => {
    expect(isRequestable('https://shop.example/sale')).toBe(true);
    expect(isRequestable('http://shop.example/sale')).toBe(false);
    expect(isRequestable('https://192.168.0.1/sale')).toBe(false);
    expect(isRequestable('https://localhost/sale')).toBe(false);
    expect(isRequestable('not a url')).toBe(false);
  });

  it('gives the path and query for the robots rules', () => {
    expect(pathAndQueryOf('https://shop.example/sale?x=1')).toBe('/sale?x=1');
    expect(pathAndQueryOf('https://shop.example')).toBe('/');
    expect(passes('ok') && passes('js_only') && !passes('blocked') && !passes('no_address')).toBe(true);
  });
});

describe('blackFridayFlags: only the title and the first heading count', () => {
  const page = (title: string, h1: string, rest = ''): string => `<html><head><title>${title}</title></head><body>${rest}<h1>${h1}</h1></body></html>`;
  it.each([
    [page('Black Friday 2026 deals', 'Welcome'), 'year_2026', true],
    [page('Welcome', 'BLACK FRIDAY 2025'), 'year_2025', true],
    [page('Black Friday 2025', 'Black Friday 2026'), 'year_2026', true],
    [page('Sale', 'Hot deals'), 'no_year', false],
    [page('Black Friday', 'Deals'), 'no_year', true],
    [page('Black-Friday', 'Deals'), 'no_year', false],
    [page('Sale', 'Deals', '<footer>© 2025 Shop. Black Friday 2025</footer>'), 'no_year', false],
    [page('Sale 12025', 'Deals'), 'no_year', false],
    ['', 'no_year', false],
  ])('%#', (markup, year, words) => {
    expect(blackFridayFlags(markup)).toEqual({ year, words });
  });
});

describe('the files', () => {
  const stores = [
    retailer({ slug: 'good', name: 'Good Shop', saleUrl: 'https://good.example/sale', blackFridayUrl: 'https://good.example/bf' }),
    retailer({ slug: 'stale', name: 'Stale <script> | Shop', saleUrl: 'https://stale.example/sale', blackFridayUrl: 'https://stale.example/bf' }),
    retailer({ slug: 'dead', name: 'Dead Shop', saleUrl: 'https://dead.example/sale' }),
    retailer({ slug: 'none', name: 'None Shop', saleUrl: null }),
    retailer({ slug: 'locked', name: 'Locked Shop', saleUrl: 'https://locked.example/deals' }),
  ];
  const plan = planChecks(stores, hidden);
  const ok = (extra: Partial<PageResult> = {}): PageResult => ({ class: 'ok', httpStatus: 200, error: null, blackFriday: null, ...extra });
  const answers = new Map<string, PageResult>([
    ['https://good.example/sale', ok()],
    ['https://good.example/bf', ok({ blackFriday: { year: 'year_2026', words: true } })],
    ['https://stale.example/sale', ok()],
    ['https://stale.example/bf', ok({ blackFriday: { year: 'year_2025', words: false } })],
    ['https://dead.example/sale', { class: 'not_found', httpStatus: 404, error: null, blackFriday: null }],
    ['https://locked.example/deals', ok()],
  ]);
  const file = buildCheckFile({ plan, answers, checkedAt: '2026-11-01T10:00:00Z', userAgent: 'SaleawayBot/1.0', delaySeconds: 15 });
  const names = new Map(stores.map((store) => [store.slug, store.name]));
  const text = renderCheckMarkdown(file, names);

  it('has one row per store and kind, with the hidden reason and the Black Friday flags only on Black Friday rows', () => {
    expect(file.results).toHaveLength(7);
    expect(file.results.find((row) => row.slug === 'none')).toMatchObject({ class: 'no_address', httpStatus: null });
    expect(file.results.find((row) => row.slug === 'locked')?.hiddenReason).toBe('http_403');
    expect(file.results.find((row) => row.slug === 'good' && row.kind === 'sale')?.blackFriday).toBeNull();
    expect(file.results.find((row) => row.slug === 'stale' && row.kind === 'black_friday')?.blackFriday).toEqual({ year: 'year_2025', words: false });
    expect(file).toMatchObject({ pages: 6, sites: 4, from: 'operator computer', delaySeconds: 15 });
  });

  it('records an address nobody answered for as an error, never as a pass', () => {
    const missing = buildCheckFile({ plan, answers: new Map(), checkedAt: '2026-11-01T10:00:00Z', userAgent: 'x', delaySeconds: 15 });
    expect(missing.results.filter((row) => row.class === 'ok')).toHaveLength(0);
    expect(missing.results.find((row) => row.slug === 'dead')).toMatchObject({ class: 'error', error: 'not_checked' });
  });

  it('flags the sale address that did not answer and lists the stale Black Friday page', () => {
    expect(text).toContain('## Sale addresses that did not return a page');
    expect(text).toMatch(/Dead Shop \(dead\) \| not_found \| 404/);
    expect(text).not.toMatch(/Good Shop \(good\) \| not_found/);
    expect(text).toMatch(/## Black Friday pages that say 2025[\s\S]*Stale \(script\) \/ Shop \(stale\)/);
  });

  it('counts the hidden stores that answer from here', () => {
    expect(text).toContain('1 of 1 answer from here');
    expect(text).toMatch(/Locked Shop \(locked\) \| http_403 \| ok \| 200/);
  });

  it('holds no address, no page text and no HTML, and a hostile name does not break a table', () => {
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toContain('<script>');
    expect(JSON.stringify(file)).not.toMatch(/https?:\/\//);
    // The pipe in the hostile name was turned into a slash, so every row has as many cells as the header of its own table.
    const lines = text.split('\n');
    const staleRows = lines.filter((l) => l.startsWith('| Stale'));
    expect(staleRows).toHaveLength(2);
    for (const line of staleRows) {
      const header = lines.slice(0, lines.indexOf(line)).reverse().find((l) => l.startsWith('| Store')) as string;
      expect(line.split(' | ')).toHaveLength(header.split(' | ').length);
    }
  });

  it('lists every store once with both answers, the ones that worked included, sorted by name', () => {
    const section = text.slice(text.indexOf('## Every store'));
    const lines = section.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| ---') && !l.startsWith('| Store'));
    expect(lines.map((l) => l.split(' | ')[0]?.replace('| ', ''))).toEqual(['Dead Shop (dead)', 'Good Shop (good)', 'Locked Shop (locked)', 'None Shop (none)', 'Stale (script) / Shop (stale)']);
    expect(lines[0]).toContain('not_found 404');
    expect(lines[1]).toContain('ok 200 | ok 200, 2026, black friday');
    expect(lines[2]).toContain('| http_403');
    expect(lines[3]).toContain('no_address');
    expect(lines[4]).toContain('ok 200, 2025');
    expect(section).toContain('load times are not recorded');
  });

  it('has the parts in order and the closing line', () => {
    const order = ['# URL check', '## Summary', '## Sale addresses that did not return a page', '## Black Friday addresses that did not return a page', '## Black Friday pages that say 2025', '## Stores hidden by Story 3.9', '## Every store'];
    const at = order.map((heading) => text.indexOf(heading));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(text.trimEnd().endsWith('writes nothing to the database.')).toBe(true);
  });
});

describe('once a day', () => {
  const now = new Date('2026-11-02T12:00:00Z');
  it('refuses 23 hours after the last run, and says when it may run', () => {
    const guard = canRunNow('2026-11-01T13:00:00Z', now);
    expect(guard.ok).toBe(false);
    if (!guard.ok) expect(guard.message).toContain('2026-11-02T13:00:00Z');
  });
  it('allows exactly 24 hours and 25 hours after, and when there was no run', () => {
    expect(canRunNow('2026-11-01T12:00:00Z', now).ok).toBe(true);
    expect(canRunNow('2026-11-01T11:00:00Z', now).ok).toBe(true);
    expect(canRunNow(null, now).ok).toBe(true);
  });
  it('does not treat a broken time as permission', () => {
    expect(canRunNow('yesterday', now).ok).toBe(false);
  });
  it('reads the last run from the file, and refuses a file it cannot trust', () => {
    expect(readPreviousCheck('{"checkedAt":"2026-11-01T10:00:00Z","results":[]}')).toEqual({ ok: true, checkedAt: '2026-11-01T10:00:00Z' });
    for (const bad of ['', 'not json', '[]', '{}', '{"checkedAt":5}', '{"checkedAt":"soon"}', 'null']) expect(readPreviousCheck(bad).ok, bad).toBe(false);
  });
});
