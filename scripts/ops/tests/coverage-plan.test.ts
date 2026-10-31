import { describe, expect, it } from 'vitest';
import { parseCoverageArgs } from '../src/args';
import { BUCKETS, bucketOf, buildCoverage, cell, renderMarkdown, resolveCoverageOut } from '../src/coverage-plan';
import type { CoverageRun, CoverageStore, HiddenList } from '../src/coverage-plan';

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
