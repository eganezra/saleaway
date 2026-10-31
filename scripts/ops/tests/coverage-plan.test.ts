import { describe, expect, it, vi } from 'vitest';
import { parseCoverageArgs } from '../src/args';
import { runCoverage } from '../src/coverage';
import type { CoverageIo } from '../src/coverage';
import { BUCKETS, bucketOf, buildCoverage, cell, renderMarkdown, resolveCoverageOut, storeFromRow } from '../src/coverage-plan';
import type { CoverageRun, CoverageStore, HiddenList, StoreRow } from '../src/coverage-plan';

const run: CoverageRun = {
  id: 17,
  trigger: 'cron',
  startedAt: '2026-10-31T03:00:00Z',
  finishedAt: '2026-10-31T03:20:00Z',
  storesTotal: 12,
  resultCount: 12,
  firstResultAt: '2026-10-31T03:00:05Z',
  lastResultAt: '2026-10-31T03:20:00Z',
};

const store = (overrides: Partial<CoverageStore>): CoverageStore => ({
  slug: 'shop',
  name: 'Shop',
  category: 'Fashion',
  extractionMethod: 'html',
  isVisible: true,
  noSaleUrl: false,
  hasOverride: false,
  result: 'ok',
  httpStatus: 200,
  error: null,
  state: 'active',
  validation: 'content_verified',
  recordPercent: 30,
  recordLastResult: 'ok',
  lastCheckedAt: '2026-10-31T03:10:00Z',
  ...overrides,
});

const hidden: HiddenList = { reasons: { http_403: 'Answered 403.' }, stores: [{ slug: 'locked', reason: 'http_403' }] };

describe('bucketOf', () => {
  it.each([
    [{}, 'percentage'],
    [{ recordPercent: null }, 'on_sale_only'],
    [{ state: 'ended', recordPercent: null }, 'ended'],
    [{ result: 'blocked' }, 'blocked'],
    [{ result: 'not_found', httpStatus: 404 }, 'not_found'],
    [{ result: 'redirected_away' }, 'redirected_away'],
    [{ result: 'error' }, 'error'],
    [{ result: null, state: null }, 'never_checked'],
    [{ state: 'unknown', recordPercent: null }, 'never_checked'],
    [{ result: 'skipped_manual', state: null }, 'manual'],
  ] as Array<[Partial<CoverageStore>, string]>)('%j goes to %s', (given, expected) => {
    expect(bucketOf(store(given))).toBe(expected);
  });
});

describe('buildCoverage', () => {
  const stores = [
    store({ slug: 'a' }),
    store({ slug: 'b', recordPercent: null, validation: 'content_verified' }),
    store({ slug: 'c', recordPercent: null, validation: 'url_verified', result: 'js_only' }),
    store({ slug: 'd', recordPercent: null, validation: 'url_verified' }),
    store({ slug: 'e', state: 'ended', recordPercent: null }),
    store({ slug: 'f', result: 'blocked', httpStatus: 403, error: 'http_403' }),
    store({ slug: 'g', result: 'skipped_manual', state: null, extractionMethod: 'manual' }),
    store({ slug: 'h', result: 'skipped_manual', state: null, extractionMethod: 'manual', hasOverride: true }),
    store({ slug: 'locked', isVisible: false }),
    store({ slug: 'nopage', isVisible: false, noSaleUrl: true }),
  ];
  const coverage = buildCoverage({ run, stores, hidden, madeAt: '2026-10-31T04:00:00Z' });

  it('counts every visible store in exactly one bucket', () => {
    expect(coverage.visible).toBe(8);
    expect(BUCKETS.reduce((sum, bucket) => sum + coverage.counts[bucket], 0)).toBe(coverage.visible);
    expect(coverage.counts).toMatchObject({ percentage: 1, on_sale_only: 3, ended: 1, blocked: 1, manual: 2 });
  });

  it('splits the on-sale-only stores by what is known', () => {
    expect(coverage.onSaleSplit).toEqual({ contentVerifiedNoFigure: 1, jsOnly: 1, otherUrlVerified: 1 });
    expect(coverage.noPercentage.map((item) => item.slug)).toEqual(['b', 'c', 'd']);
  });

  it('lists what needs hand work, leaving out a manual store that has an override', () => {
    expect(coverage.needsHandling.map((item) => item.slug)).toEqual(['b', 'e', 'f', 'g']);
    expect(coverage.needsHandling.find((item) => item.slug === 'g')?.reason).toBe('manual method, no override yet');
    expect(coverage.needsHandling.find((item) => item.slug === 'f')?.reason).toBe('blocked: http_403');
  });

  it('groups hidden stores by reason, with "no sale page" for a store with no address', () => {
    expect(coverage.hidden).toBe(2);
    expect(coverage.hiddenGroups.map((group) => [group.reason, group.slugs])).toEqual([
      ['http_403', ['locked']],
      ['no_sale_page', ['nopage']],
    ]);
  });

  it('takes the records date from the newest check and warns only when it is after the run', () => {
    expect(coverage.recordsAsOf).toBe('2026-10-31T03:10:00Z');
    expect(coverage.recordsNewerThanRun).toBe(false);
    const later = buildCoverage({ run, stores: [store({ lastCheckedAt: '2026-11-01T03:10:00Z' })], hidden, madeAt: '2026-11-01T04:00:00Z' });
    expect(later.recordsNewerThanRun).toBe(true);
    expect(renderMarkdown(later)).toContain('Warning');
    expect(renderMarkdown(coverage)).not.toContain('Warning');
  });

  it('copes with a run that has no results and stores that have no records', () => {
    const empty = buildCoverage({
      run: { ...run, resultCount: 0, firstResultAt: null, lastResultAt: null },
      stores: [store({ result: null, state: null, lastCheckedAt: null })],
      hidden,
      madeAt: '2026-10-31T04:00:00Z',
    });
    expect(empty.recordsAsOf).toBeNull();
    expect(empty.recordsNewerThanRun).toBe(false);
    expect(empty.durationMinutes).toBeNull();
    expect(renderMarkdown(empty)).toContain('Sale records as of none');
  });
});

describe('renderMarkdown', () => {
  const stores = [store({ slug: 'a', name: 'A | <b>Shop</b>' }), store({ slug: 'f', result: 'blocked', error: 'robots|disallow\nx' }), store({ slug: 'locked', isVisible: false })];
  const text = renderMarkdown(buildCoverage({ run, stores, hidden, madeAt: '2026-10-31T04:00:00Z' }));

  it('has the parts in order', () => {
    const order = ['# Coverage report: run 17', 'Sale records as of', '## Summary', '## Stores that need manual handling', '## Stores shown as "On sale" with no percentage', '## Hidden stores'];
    const at = order.map((heading) => text.indexOf(heading));
    expect(at.every((index) => index >= 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(text.trimEnd().endsWith('it reads the database only.')).toBe(true);
  });

  it('keeps table cells safe', () => {
    expect(text).not.toContain('<b>');
    expect(text).toContain('robots/disallow x');
  });

  it('holds no address or page text', () => {
    expect(text).not.toMatch(/https?:\/\//);
  });
});

describe('cell', () => {
  it('removes what breaks a table', () => {
    expect(cell('a|b`c<d>\r\ne')).toBe("a/b'c(d) e");
  });
});

describe('resolveCoverageOut', () => {
  const root = '/repo';
  it('accepts a markdown file in docs/data', () => {
    expect(resolveCoverageOut(root, 'docs/data/first-run-coverage.md')).toEqual({ ok: true, path: '/repo/docs/data/first-run-coverage.md' });
  });
  it.each(['', 'docs/data/x.txt', 'docs/x.md', 'README.md', '/etc/x.md', 'docs/data/../x.md', 'docs/data/../../x.md', 'docs/data', 'docs/data/.md/..'])('refuses %j', (out) => {
    expect(resolveCoverageOut(root, out).ok).toBe(false);
  });
});

describe('parseCoverageArgs', () => {
  it('needs exactly one database', () => {
    expect(parseCoverageArgs([]).ok).toBe(false);
    expect(parseCoverageArgs(['--local', '--remote']).ok).toBe(false);
  });
  it('reads the options', () => {
    expect(parseCoverageArgs(['--remote'])).toEqual({ ok: true, target: 'remote', run: null, out: null });
    expect(parseCoverageArgs(['--local', '--run', '17', '--out', 'docs/data/a.md'])).toEqual({ ok: true, target: 'local', run: 17, out: 'docs/data/a.md' });
  });
  it.each([['--run', 'x'], ['--run', '0'], ['--run', '-1'], ['--run', '1.5'], ['--run', '17; DROP TABLE x'], ['--run'], ['--out'], ['--out', '--local'], ['--bogus', '1']])('refuses %j', (...rest) => {
    expect(parseCoverageArgs(['--local', ...rest]).ok).toBe(false);
  });
  it('refuses an option given twice', () => {
    expect(parseCoverageArgs(['--local', '--local']).ok).toBe(false);
    expect(parseCoverageArgs(['--local', '--run', '1', '--run', '2']).ok).toBe(false);
  });
});

describe('every bucket in one fixture (Story 3.6 QA)', () => {
  const stores = [
    store({ slug: 'p1' }),
    store({ slug: 'o1', recordPercent: null }),
    store({ slug: 'e1', state: 'ended', recordPercent: null }),
    store({ slug: 'b1', result: 'blocked', httpStatus: 429, error: 'http_429' }),
    store({ slug: 'n1', result: 'not_found', httpStatus: 404, error: 'http_404' }),
    store({ slug: 'r1', result: 'redirected_away', error: 'redirected_to_other.example' }),
    store({ slug: 'x1', result: 'error', error: 'unsafe_redirect' }),
    store({ slug: 'u1', state: 'unknown', recordPercent: null, recordLastResult: 'error' }),
    store({ slug: 'm1', result: 'skipped_manual', state: null }),
  ];
  const coverage = buildCoverage({ run, stores, hidden, madeAt: '2026-10-31T04:00:00Z' });

  it('puts one store in each of the nine buckets and the counts add up', () => {
    expect(BUCKETS.map((bucket) => coverage.counts[bucket])).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(coverage.visible).toBe(9);
  });

  it('gives each hand-work group its plain reason', () => {
    const reason = (slug: string) => coverage.needsHandling.find((item) => item.slug === slug)?.reason;
    expect(reason('n1')).toBe('page not found (HTTP 404)');
    expect(reason('r1')).toBe('redirected away from the sale page');
    expect(reason('x1')).toBe('error: unsafe_redirect');
    expect(reason('u1')).toBe('never checked successfully (error)');
    expect(reason('e1')).toBe('judged ended: open the page and check it by hand');
  });

  it('does not call a page it could only judge by address "not readable"', () => {
    const text = renderMarkdown(buildCoverage({ run, stores: [store({ slug: 'js', recordPercent: null, validation: 'url_verified' })], hidden, madeAt: '2026-10-31T04:00:00Z' }));
    expect(text).toContain('page could not be judged, address only');
    expect(text).not.toContain('not readable');
  });
});

describe('storeFromRow: an override counts only while the site would use it', () => {
  const row = (overrides: Partial<StoreRow>): StoreRow => ({
    slug: 'amazon-co-za',
    name: 'Amazon.co.za',
    category: 'General',
    extraction_method: 'manual',
    is_visible: 1,
    sale_url: 'https://example.invalid/deals',
    override_exists: 1,
    override_expires_at: null,
    result: 'skipped_manual',
    http_status: null,
    error: null,
    state: null,
    validation: null,
    discount_percent: null,
    last_result: null,
    last_checked_at: null,
    ...overrides,
  });
  const noon = new Date('2026-11-30T12:00:00Z');

  it.each([
    [{ override_exists: 0 }, false],
    [{ override_exists: 1, override_expires_at: null }, true],
    [{ override_expires_at: '2026-12-01' }, true],
    // A bare date is the start of that day in UTC, so on the expiry day itself the site no longer uses the override.
    [{ override_expires_at: '2026-11-30' }, false],
    [{ override_expires_at: '2026-11-29' }, false],
  ] as Array<[Partial<StoreRow>, boolean]>)('%j has an override: %s', (given, expected) => {
    expect(storeFromRow(row(given), noon).hasOverride).toBe(expected);
  });

  it('maps the other columns', () => {
    const mapped = storeFromRow(row({ is_visible: 0, sale_url: null, discount_percent: 40, last_checked_at: '2026-10-31T03:00:00Z' }), noon);
    expect(mapped).toMatchObject({ isVisible: false, noSaleUrl: true, recordPercent: 40, lastCheckedAt: '2026-10-31T03:00:00Z' });
  });
});

describe('runCoverage', () => {
  const hiddenJson = { decidedOn: '2026-10-30', source: 'test', reasons: { http_403: 'Answered 403.' }, stores: [{ slug: 'locked', reason: 'http_403' }] };
  const runRow = { id: 17, trigger: 'cron', started_at: '2026-10-31T03:00:00Z', finished_at: null, stores_total: 1, result_count: 1, first_result_at: '2026-10-31T03:00:05Z', last_result_at: '2026-10-31T03:01:00Z' };
  const storeRow: StoreRow = {
    slug: 'shop', name: 'Shop', category: 'Fashion', extraction_method: 'html', is_visible: 1, sale_url: 'https://shop.invalid/sale',
    override_exists: 0, override_expires_at: null, result: 'ok', http_status: 200, error: null, state: 'active', validation: 'content_verified',
    discount_percent: 30, last_result: 'ok', last_checked_at: '2026-10-31T03:01:00Z',
  };

  function setup(answers: Array<unknown[] | null>) {
    const queries: string[] = [];
    const written: Array<[string, string]> = [];
    const printed: string[] = [];
    const io: CoverageIo = {
      root: '/repo',
      query: (_target, sql) => {
        queries.push(sql);
        return (answers.shift() ?? null) as never;
      },
      readHiddenList: () => hiddenJson,
      writeFile: (path, text) => written.push([path, text]),
      print: (text) => printed.push(text),
      now: () => new Date('2026-10-31T06:00:00Z'),
    };
    return { io, queries, written, printed };
  }
  const quiet = () => vi.spyOn(console, 'log').mockImplementation(() => undefined);

  it('prints the report and writes nothing without --out', () => {
    const spy = quiet();
    const t = setup([[runRow], [storeRow]]);
    expect(runCoverage(['--remote'], t.io)).toBe(0);
    expect(t.printed.join('')).toContain('# Coverage report: run 17');
    expect(t.written).toEqual([]);
    spy.mockRestore();
  });

  it('writes the file inside docs/data when --out is given', () => {
    const spy = quiet();
    const t = setup([[runRow], [storeRow]]);
    expect(runCoverage(['--remote', '--run', '17', '--out', 'docs/data/x.md'], t.io)).toBe(0);
    expect(t.written.map(([path]) => path)).toEqual(['/repo/docs/data/x.md']);
    expect(t.queries[0]).toContain('WHERE p.id = 17');
    spy.mockRestore();
  });

  it.each([
    ['the run query fails', [null]],
    ['the stores query fails', [[runRow], null]],
    ['the run does not exist', [[]]],
  ] as Array<[string, Array<unknown[] | null>]>)('writes no file and fails when %s', (_name, answers) => {
    const spy = quiet();
    const t = setup(answers);
    expect(runCoverage(['--remote', '--out', 'docs/data/x.md'], t.io)).toBe(1);
    expect(t.written).toEqual([]);
    expect(t.printed).toEqual([]);
    spy.mockRestore();
  });

  it('asks nothing of the database when the arguments or the path are wrong', () => {
    const spy = quiet();
    for (const argv of [[], ['--remote', '--out', 'README.md'], ['--remote', '--out', 'docs/data/../x.md'], ['--remote', '--run', 'abc']]) {
      const t = setup([[runRow], [storeRow]]);
      expect(runCoverage(argv, t.io)).toBe(1);
      expect(t.queries).toEqual([]);
    }
    spy.mockRestore();
  });

  it('only reads: no query changes data', () => {
    const spy = quiet();
    const t = setup([[runRow], [storeRow]]);
    runCoverage(['--local'], t.io);
    expect(t.queries.every((sql) => sql.trimStart().startsWith('SELECT'))).toBe(true);
    expect(t.queries.join(' ')).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i);
    spy.mockRestore();
  });
});
