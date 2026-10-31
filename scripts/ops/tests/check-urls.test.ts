import { USER_AGENT } from '@saleaway/core';
import { describe, expect, it, vi } from 'vitest';
import { fakeFetch } from '../../../packages/core/tests/helpers/fake-fetch';
import type { Spec } from '../../../packages/core/tests/helpers/fake-fetch';
import { RESULT_JSON, RESULT_MARKDOWN, runCheckUrls } from '../src/check-urls';
import type { CheckUrlsIo } from '../src/check-urls';

const HEADER = 'Category\tRank\tStore\tHomepage\tPrimary sale / promo URL\tLabel used on site\tSecondary / Black Friday URL\tPlatform / URL pattern\tStatus (28 Oct 2026)\tHow it was found';
const PRODUCTS = 'Verified – products visible';
const JS = 'Verified – page loads (products load via JS)';
const row = (rank: number, store: string, home: string, sale: string, bf: string, status: string): string =>
  ['Fashion & apparel', String(rank), store, home, sale, 'Sale', bf, '', status, 'test'].join('\t');

const SEED = [
  HEADER,
  row(1, 'Good Shop', 'https://good.example', 'https://good.example/sale', 'https://good.example/bf', PRODUCTS),
  row(2, 'Js Shop', 'https://js.example', 'https://js.example/sale', '—', JS),
  row(3, 'Locked Shop', 'https://locked.example', 'https://locked.example/deals', '—', PRODUCTS),
  row(4, 'Nope Shop', 'https://nope.example', '— (no page found)', '—', 'No sale page / not found'),
  row(5, 'Second Shop', 'https://good.example', 'https://good.example/more', '—', PRODUCTS),
].join('\n');
const CATEGORIES = JSON.stringify([{ slug: 'fashion-apparel', name: 'Fashion & apparel', tagline: 'Dress up.', sortOrder: 1, colorToken: 'cat-default' }]);
const HIDDEN = JSON.stringify({ decidedOn: '2026-10-30', source: 'test', reasons: { http_403: 'Answered 403.' }, stores: [{ slug: 'locked-shop', reason: 'http_403' }] });

const ROUTES: Record<string, Spec | Spec[]> = {
  'https://good.example/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /private\n' },
  'https://good.example/sale': { status: 200, body: '<html><title>Sale</title></html>' },
  'https://good.example/bf': { status: 200, body: '<html><head><title>Black Friday 2025</title></head><body><footer>2026</footer></body></html>' },
  'https://good.example/more': { status: 200, body: 'page' },
  'https://js.example/robots.txt': { status: 404 },
  'https://js.example/sale': { status: 200, body: 'shell' },
  'https://locked.example/robots.txt': { status: 403 },
  'https://locked.example/deals': { status: 403 },
};

interface Setup {
  files?: Record<string, string>;
  routes?: Record<string, Spec | Spec[]>;
  now?: string;
  sleepThrows?: boolean;
}

function setup(options: Setup = {}) {
  const files: Record<string, string> = { 'docs/data/retailers-seed.tsv': SEED, 'db/seed/categories.json': CATEGORIES, 'docs/data/hidden-stores.json': HIDDEN, ...options.files };
  const net = fakeFetch(options.routes ?? ROUTES);
  const written = new Map<string, string>();
  const sleeps: number[] = [];
  const printed: string[] = [];
  const io: CheckUrlsIo = {
    root: '/repo',
    readText: (path) => files[path] ?? null,
    writeFile: (path, text) => void written.set(path, text),
    fetch: net.fetch,
    sleep: async (ms) => {
      if (options.sleepThrows) throw new Error('interrupted');
      sleeps.push(ms);
    },
    now: () => new Date(options.now ?? '2026-11-02T12:00:00Z'),
    print: (text) => void printed.push(text),
  };
  return { io, net, written, sleeps, printed };
}

const quiet = () => vi.spyOn(console, 'log').mockImplementation(() => undefined);
const readJson = (t: ReturnType<typeof setup>) => JSON.parse(t.written.get(`/repo/${RESULT_JSON}`) as string) as { results: Array<Record<string, unknown>>; pages: number; checkedAt: string };

describe('runCheckUrls: a full run', () => {
  it('asks each distinct address once, writes both files, and records every class', async () => {
    const spy = quiet();
    const t = setup();
    expect(await runCheckUrls([], t.io)).toBe(0);
    const file = readJson(t);
    const rowOf = (slug: string, kind = 'sale') => file.results.find((r) => r.slug === slug && r.kind === kind);
    expect(file.pages).toBe(5);
    expect(rowOf('good-shop')).toMatchObject({ class: 'ok', httpStatus: 200 });
    expect(rowOf('js-shop')).toMatchObject({ class: 'js_only' });
    expect(rowOf('locked-shop')).toMatchObject({ class: 'blocked', httpStatus: 403, hiddenReason: 'http_403' });
    expect(rowOf('nope-shop')).toMatchObject({ class: 'no_address' });
    expect(rowOf('good-shop', 'black_friday')).toMatchObject({ class: 'ok', blackFriday: { year: 'year_2025', words: true } });
    expect(rowOf('good-shop')?.blackFriday).toBeNull();
    expect(t.written.has(`/repo/${RESULT_MARKDOWN}`)).toBe(true);
    spy.mockRestore();
  });

  it('sends the pipeline\'s user-agent on every request, robots.txt included', async () => {
    const spy = quiet();
    const t = setup();
    await runCheckUrls([], t.io);
    expect(t.net.requests.length).toBeGreaterThan(0);
    for (const request of t.net.requests) expect((request.init?.headers as Record<string, string>)['User-Agent']).toBe(USER_AGENT);
    spy.mockRestore();
  });

  it('reads one site\'s robots.txt once, however many of its pages it asks for', async () => {
    const spy = quiet();
    const t = setup();
    await runCheckUrls([], t.io);
    expect(t.net.urls().filter((url) => url === 'https://good.example/robots.txt')).toHaveLength(1);
    expect(t.net.urls().filter((url) => url.startsWith('https://good.example/') && !url.endsWith('robots.txt'))).toHaveLength(3);
    spy.mockRestore();
  });

  it('waits between pages and not before the first', async () => {
    const spy = quiet();
    const t = setup();
    await runCheckUrls(['--delay', '7'], t.io);
    expect(t.sleeps).toEqual([7000, 7000, 7000, 7000]);
    spy.mockRestore();
  });

  it('writes no address, no page text and no HTML to either file', async () => {
    const spy = quiet();
    const t = setup();
    await runCheckUrls([], t.io);
    for (const text of t.written.values()) {
      // The one address in the files is the bot's own contact address inside its user-agent; no store address appears.
      expect(text.replaceAll(USER_AGENT, '')).not.toMatch(/https?:\/\//);
      expect(text).not.toContain('<title>');
      expect(text).not.toContain('shell');
    }
    spy.mockRestore();
  });

  it('does not request a page its robots.txt forbids, nor a robots.txt that cannot be read', async () => {
    const spy = quiet();
    const t = setup({
      routes: {
        ...ROUTES,
        'https://good.example/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /sale\nDisallow: /bf\nDisallow: /more\n' },
        'https://js.example/robots.txt': { status: 500 },
      },
    });
    await runCheckUrls([], t.io);
    const file = readJson(t);
    expect(file.results.find((r) => r.slug === 'good-shop' && r.kind === 'sale')).toMatchObject({ class: 'robots_disallow' });
    expect(file.results.find((r) => r.slug === 'js-shop')).toMatchObject({ class: 'robots_unreachable' });
    expect(t.net.urls()).not.toContain('https://good.example/sale');
    expect(t.net.urls()).not.toContain('https://js.example/sale');
    spy.mockRestore();
  });

  it('turns a redirect to another site, a missing page and a timeout into their classes', async () => {
    const spy = quiet();
    const t = setup({
      routes: {
        ...ROUTES,
        'https://good.example/sale': { status: 302, headers: { location: 'https://elsewhere.example/home' } },
        'https://elsewhere.example/home': { status: 200, body: 'x' },
        'https://js.example/sale': { status: 404 },
        'https://locked.example/deals': { throws: 'timeout' },
      },
    });
    await runCheckUrls([], t.io);
    const file = readJson(t);
    const cls = (slug: string) => file.results.find((r) => r.slug === slug && r.kind === 'sale');
    expect(cls('good-shop')).toMatchObject({ class: 'redirected_away' });
    expect(cls('js-shop')).toMatchObject({ class: 'not_found', httpStatus: 404 });
    expect(cls('locked-shop')).toMatchObject({ class: 'error', error: 'timeout' });
    spy.mockRestore();
  });

  it('never asks for an address that is not safe', async () => {
    const spy = quiet();
    const seed = [HEADER, row(1, 'Lan Shop', 'https://lan.example', 'https://192.168.0.1/sale', '—', PRODUCTS)].join('\n');
    const t = setup({ files: { 'docs/data/retailers-seed.tsv': seed } });
    await runCheckUrls([], t.io);
    expect(t.net.requests).toEqual([]);
    expect(readJson(t).results[0]).toMatchObject({ class: 'unsafe_url' });
    spy.mockRestore();
  });

  it('writes nothing when the run is cut short', async () => {
    const spy = quiet();
    const t = setup({ sleepThrows: true });
    await expect(runCheckUrls([], t.io)).rejects.toThrow('interrupted');
    expect(t.written.size).toBe(0);
    spy.mockRestore();
  });
});

describe('runCheckUrls: once a day', () => {
  const previous = (checkedAt: string) => ({ [RESULT_JSON]: JSON.stringify({ checkedAt, results: [] }) });

  it('refuses 23 hours after the last run and makes no request', async () => {
    const spy = quiet();
    const t = setup({ files: previous('2026-11-01T13:00:00Z') });
    expect(await runCheckUrls([], t.io)).toBe(1);
    expect(t.net.requests).toEqual([]);
    expect(t.written.size).toBe(0);
    spy.mockRestore();
  });

  it('runs 25 hours after, and when there is no previous file', async () => {
    const spy = quiet();
    const later = setup({ files: previous('2026-11-01T11:00:00Z') });
    expect(await runCheckUrls([], later.io)).toBe(0);
    expect(later.written.size).toBe(2);
    const first = setup();
    expect(await runCheckUrls([], first.io)).toBe(0);
    spy.mockRestore();
  });

  it('stops, and asks nothing, when the previous file cannot be trusted', async () => {
    const spy = quiet();
    for (const text of ['', 'not json', '{}', '{"checkedAt":"soon"}']) {
      const t = setup({ files: { [RESULT_JSON]: text } });
      expect(await runCheckUrls([], t.io), text).toBe(1);
      expect(t.net.requests).toEqual([]);
    }
    spy.mockRestore();
  });
});

describe('runCheckUrls: --dry-run and --only', () => {
  it('--dry-run asks for nothing, writes nothing and says how big the run would be', async () => {
    const spy = quiet();
    const t = setup({ files: { [RESULT_JSON]: JSON.stringify({ checkedAt: '2026-11-02T11:00:00Z' }) } });
    expect(await runCheckUrls(['--dry-run'], t.io)).toBe(0);
    expect(t.net.requests).toEqual([]);
    expect(t.written.size).toBe(0);
    expect(t.printed.join('')).toContain('5 pages on 3 sites');
    spy.mockRestore();
  });

  it('--only asks for just those stores, prints the answers, writes no file and leaves the clock alone', async () => {
    const spy = quiet();
    // A full run finished an hour ago, and a short look is still allowed.
    const t = setup({ files: { [RESULT_JSON]: JSON.stringify({ checkedAt: '2026-11-02T11:00:00Z' }) } });
    expect(await runCheckUrls(['--only', 'locked-shop'], t.io)).toBe(0);
    expect(t.written.size).toBe(0);
    expect(t.net.urls()).toEqual(['https://locked.example/robots.txt', 'https://locked.example/deals']);
    expect(t.printed.join('')).toContain('locked-shop sale blocked 403');
    expect(t.printed.join('')).toContain('no file was written');
    spy.mockRestore();
  });

  it('--only with a slug that is not in the seed file asks for nothing', async () => {
    const spy = quiet();
    const t = setup();
    expect(await runCheckUrls(['--only', 'nobody'], t.io)).toBe(1);
    expect(t.net.requests).toEqual([]);
    spy.mockRestore();
  });
});

describe('runCheckUrls: bad input', () => {
  it('stops before asking anything when an argument is wrong or a data file is missing or broken', async () => {
    const spy = quiet();
    for (const [argv, files] of [
      [['--delay', '1'], {}],
      [['--wat'], {}],
      [[], { 'docs/data/hidden-stores.json': '{"nope":true}' }],
      [[], { 'db/seed/categories.json': 'not json' }],
      [[], { 'docs/data/retailers-seed.tsv': 'garbage' }],
    ] as Array<[string[], Record<string, string>]>) {
      const t = setup({ files });
      expect(await runCheckUrls(argv, t.io), JSON.stringify(argv)).toBe(1);
      expect(t.net.requests).toEqual([]);
    }
    const missing = setup();
    missing.io.readText = () => null;
    expect(await runCheckUrls([], missing.io)).toBe(1);
    spy.mockRestore();
  });
});
