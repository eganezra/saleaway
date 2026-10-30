import { describe, expect, it } from 'vitest';
import { getVisibleStores } from '../src/lib/db';
import { loadHomeViewModel } from '../src/lib/homeViewModel';

type Database = Pick<D1Database, 'prepare'>;
type Row = {
  slug: string;
  name: string;
  sale_url: string | null;
  created_at: string;
  record_state: 'active' | 'ended' | 'unknown' | null;
  record_percent: number | null;
  last_validated_at: string | null;
  override_percent: number | null;
  override_hide: number | null;
  override_url: string | null;
  override_expires_at: string | null;
  override_created_at: string | null;
};

/** A stand-in for env.DB: records the SQL it is given and returns the rows (or fails). */
function fakeDb(rows: Row[], failAt?: 'prepare' | 'all') {
  const queries: string[] = [];
  const db = {
    prepare(sql: string) {
      if (failAt === 'prepare') throw new Error('D1_ERROR: no such table: retailers');
      queries.push(sql);
      return {
        all: async () => {
          if (failAt === 'all') throw new Error('D1_ERROR: database unavailable');
          return { results: rows };
        },
      };
    },
  } as unknown as Database;
  return { db, queries };
}

function fakeLog() {
  const errors: Array<{ message: string; fields?: Record<string, unknown> }> = [];
  return { log: { error: (message: string, fields?: Record<string, unknown>) => errors.push({ message, fields }) }, errors };
}

const NOW = new Date('2026-10-30T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const ago = (hours: number): string => new Date(NOW.getTime() - hours * HOUR).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** A store row as the query returns it: added an hour ago, no record, no override. */
const row = (slug: string, name: string, sale_url: string | null, over: Partial<Row> = {}): Row => ({
  slug,
  name,
  sale_url,
  created_at: ago(1),
  record_state: null,
  record_percent: null,
  last_validated_at: null,
  override_percent: null,
  override_hide: null,
  override_url: null,
  override_expires_at: null,
  override_created_at: null,
  ...over,
});
const takealot = row('takealot', 'Takealot', 'https://www.takealot.com/deals');
const temu = row('temu-sa-storefront', 'Temu (SA storefront)', 'https://www.temu.com/za/channel/lightning-deals.html');

describe('getVisibleStores', () => {
  it('maps sale_url to saleUrl and keeps the order the database returned', async () => {
    const { db } = fakeDb([temu, takealot]);
    expect(await getVisibleStores(db, NOW)).toEqual([
      { slug: 'temu-sa-storefront', name: 'Temu (SA storefront)', saleUrl: 'https://www.temu.com/za/channel/lightning-deals.html', discountPercent: null, checkedAt: null },
      { slug: 'takealot', name: 'Takealot', saleUrl: 'https://www.takealot.com/deals', discountPercent: null, checkedAt: null },
    ]);
  });

  it('asks for the operator-visible stores in one query, joined to records and overrides, in category order then rank', async () => {
    const { db, queries } = fakeDb([takealot]);
    await getVisibleStores(db, NOW);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('r.is_visible = 1');
    expect(queries[0]).toContain('LEFT JOIN sale_records');
    expect(queries[0]).toContain('LEFT JOIN overrides');
    expect(queries[0]).toMatch(/ORDER BY c\.sort_order, r\.rank/);
    // The https rule moved into core, so an override URL can show a store that has no URL of its own.
    expect(queries[0]).not.toContain('sale_url LIKE');
  });

  it('drops a row whose URL is not https, whatever the database returned', async () => {
    const { db } = fakeDb([
      row('a', 'A', 'javascript:alert(1)'),
      row('b', 'B', 'http://insecure.example/sale'),
      row('c', 'C', ''),
      row('d', 'D', null),
      row('e', 'E', ' https://leading-space.example'),
      takealot,
    ]);
    expect((await getVisibleStores(db, NOW)).map((s) => s.slug)).toEqual(['takealot']);
  });

  describe('the visibility rules (Story 2.3)', () => {
    const slugs = async (rows: Row[], now = NOW) => (await getVisibleStores(fakeDb(rows).db, now)).map((s) => s.slug);

    it('keeps a store with no record and no override that was added recently', async () => {
      expect(await slugs([takealot])).toEqual(['takealot']);
    });
    it('drops a store with no record that was added more than 72 hours ago, and keeps one added 71 hours ago', async () => {
      expect(await slugs([{ ...takealot, created_at: ago(73) }])).toEqual([]);
      expect(await slugs([{ ...takealot, created_at: ago(71) }])).toEqual(['takealot']);
    });
    it('drops a stale record and keeps a fresh one', async () => {
      expect(await slugs([{ ...takealot, record_state: 'active', last_validated_at: ago(80) }])).toEqual([]);
      expect(await slugs([{ ...takealot, created_at: ago(500), record_state: 'active', last_validated_at: ago(2) }])).toEqual(['takealot']);
    });
    it('drops an ended record', async () => {
      expect(await slugs([{ ...takealot, record_state: 'ended', last_validated_at: ago(1) }])).toEqual([]);
    });
    it('drops a store whose active override hides it (override_hide 1), and keeps one with override_hide 0', async () => {
      expect(await slugs([{ ...takealot, override_hide: 1, override_created_at: ago(1) }])).toEqual([]);
      expect(await slugs([{ ...takealot, override_hide: 0, override_created_at: ago(1) }])).toEqual(['takealot']);
    });
    it('ignores an expired override', async () => {
      const expired = { override_hide: 1, override_created_at: ago(5), override_expires_at: ago(1) };
      expect(await slugs([{ ...takealot, ...expired }])).toEqual(['takealot']);
    });
    it('uses the override URL instead of the stored one, and shows a store that has no URL of its own', async () => {
      const stores = await getVisibleStores(
        fakeDb([
          { ...takealot, override_url: 'https://www.takealot.com/outlet', override_created_at: ago(1) },
          row('no-url', 'No URL', null, { override_url: 'https://shop.example/sale', override_created_at: ago(1) }),
        ]).db,
        NOW,
      );
      expect(stores.map((s) => s.saleUrl)).toEqual(['https://www.takealot.com/outlet', 'https://shop.example/sale']);
    });
    it('never lets a non-https override URL reach the result', async () => {
      expect(await slugs([{ ...takealot, override_url: 'javascript:alert(1)', override_created_at: ago(1) }])).toEqual([]);
    });
    it('gives the override percentage, else the record percentage, else null', async () => {
      const stores = await getVisibleStores(
        fakeDb([
          row('a', 'A', 'https://a.example/s', { record_state: 'active', record_percent: 20, last_validated_at: ago(1), override_percent: 50, override_created_at: ago(1) }),
          row('b', 'B', 'https://b.example/s', { record_state: 'active', record_percent: 30, last_validated_at: ago(1) }),
          row('c', 'C', 'https://c.example/s'),
        ]).db,
        NOW,
      );
      expect(stores.map((s) => s.discountPercent)).toEqual([50, 30, null]);
    });
    it('gives checkedAt: the last validation, now for an active override, null for a store never checked', async () => {
      const stores = await getVisibleStores(
        fakeDb([
          row('a', 'A', 'https://a.example/s', { record_state: 'active', last_validated_at: ago(30) }),
          row('b', 'B', 'https://b.example/s', { override_percent: 35, override_created_at: ago(1) }),
          row('c', 'C', 'https://c.example/s'),
        ]).db,
        NOW,
      );
      expect(stores.map((s) => s.checkedAt)).toEqual([ago(30), ago(0), null]);
    });
    it('judges a store with no record by its own created_at, not by the time an override was made', async () => {
      // Added an hour ago, with an old override that does not hide it: fresh, so shown.
      const r = { ...takealot, created_at: ago(1), override_created_at: ago(100) };
      expect(await slugs([r])).toEqual(['takealot']);
    });
    it('keeps the order of the rows it is given', async () => {
      expect(await slugs([temu, takealot])).toEqual(['temu-sa-storefront', 'takealot']);
    });
    it('uses the time it is given: the same row is shown now and hidden three days later', async () => {
      const r = { ...takealot, record_state: 'active' as const, last_validated_at: ago(60) };
      expect(await slugs([r])).toEqual(['takealot']);
      expect(await slugs([r], new Date(NOW.getTime() + 24 * HOUR))).toEqual([]);
    });
  });

  it('returns an empty list when there are no rows', async () => {
    expect(await getVisibleStores(fakeDb([]).db, NOW)).toEqual([]);
  });
});

describe('loadHomeViewModel', () => {
  it('returns ok with the stores when rows come back, and logs nothing', async () => {
    const { log, errors } = fakeLog();
    const vm = await loadHomeViewModel(fakeDb([takealot, temu]).db, log, NOW);
    expect(vm.kind).toBe('ok');
    if (vm.kind === 'ok') expect(vm.stores.map((s) => s.slug)).toEqual(['takealot', 'temu-sa-storefront']);
    expect(errors).toEqual([]);
  });

  it('turns each store into a row: the figure, the pill tier and the "Checked" words, judged at the same time as the rules', async () => {
    const { log } = fakeLog();
    const vm = await loadHomeViewModel(
      fakeDb([
        row('a', 'A', 'https://a.example/s', { record_state: 'active', record_percent: 60, last_validated_at: ago(1) }),
        row('b', 'B', 'https://b.example/s', { record_state: 'active', record_percent: 20, last_validated_at: ago(50) }),
        row('c', 'C', 'https://c.example/s', { record_state: 'active', last_validated_at: ago(2) }),
        row('d', 'D', 'https://d.example/s'),
        row('e', 'E', 'https://e.example/s', { override_percent: 35, override_created_at: ago(1) }),
      ]).db,
      log,
      NOW,
    );
    if (vm.kind !== 'ok') throw new Error('expected ok');
    expect(vm.stores.map((s) => [s.slug, s.percent, s.tier, s.checkedText])).toEqual([
      ['a', 60, 'hot', 'Checked today'],
      ['b', 20, 'warm', 'Checked 2 days ago'],
      ['c', null, 'plain', 'Checked today'],
      ['d', null, 'plain', 'Not checked yet'],
      ['e', 35, 'warm', 'Checked today'],
    ]);
  });

  it('returns empty, not error, when the database works but has nothing to show', async () => {
    const { log, errors } = fakeLog();
    expect(await loadHomeViewModel(fakeDb([]).db, log, NOW)).toEqual({ kind: 'empty' });
    expect(errors).toEqual([]);
  });

  it('returns empty when every row is dropped for an unsafe URL', async () => {
    const { log } = fakeLog();
    expect(await loadHomeViewModel(fakeDb([row('a', 'A', 'javascript:alert(1)')]).db, log, NOW)).toEqual({ kind: 'empty' });
  });

  it('judges the stores against the time it is given (a store shown now is hidden three days later)', async () => {
    const { log } = fakeLog();
    const db = fakeDb([takealot]).db;
    expect((await loadHomeViewModel(db, log, NOW)).kind).toBe('ok');
    expect(await loadHomeViewModel(db, log, new Date(NOW.getTime() + 4 * 24 * HOUR))).toEqual({ kind: 'empty' });
  });

  it('returns empty, not error, when the rules hide every store (all stale)', async () => {
    const { log, errors } = fakeLog();
    const stale = [{ ...takealot, created_at: ago(100) }, { ...temu, created_at: ago(100) }];
    expect(await loadHomeViewModel(fakeDb(stale).db, log, NOW)).toEqual({ kind: 'empty' });
    expect(errors).toEqual([]);
  });

  for (const failAt of ['prepare', 'all'] as const) {
    it(`returns error without throwing, and logs home_failed once, when ${failAt} fails`, async () => {
      const { log, errors } = fakeLog();
      const vm = await loadHomeViewModel(fakeDb([takealot], failAt).db, log, NOW);
      expect(vm).toEqual({ kind: 'error' });
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toBe('home_failed');
      expect(errors[0]?.fields?.err).toBeInstanceOf(Error);
    });
  }

  it('does not use a field name the logger would drop', async () => {
    const { log, errors } = fakeLog();
    await loadHomeViewModel(fakeDb([], 'all').db, log, NOW);
    const names = Object.keys(errors[0]?.fields ?? {});
    for (const reserved of ['level', 'message', 'time']) expect(names).not.toContain(reserved);
  });
});
