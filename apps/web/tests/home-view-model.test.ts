import { describe, expect, it } from 'vitest';
import { getVisibleStores } from '../src/lib/db';
import { loadHomeViewModel } from '../src/lib/homeViewModel';

type Database = Pick<D1Database, 'prepare'>;
type Row = { slug: string; name: string; sale_url: string | null };

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

const row = (slug: string, name: string, sale_url: string | null): Row => ({ slug, name, sale_url });
const takealot = row('takealot', 'Takealot', 'https://www.takealot.com/deals');
const temu = row('temu-sa-storefront', 'Temu (SA storefront)', 'https://www.temu.com/za/channel/lightning-deals.html');

describe('getVisibleStores', () => {
  it('maps sale_url to saleUrl and keeps the order the database returned', async () => {
    const { db } = fakeDb([temu, takealot]);
    expect(await getVisibleStores(db)).toEqual([
      { slug: 'temu-sa-storefront', name: 'Temu (SA storefront)', saleUrl: 'https://www.temu.com/za/channel/lightning-deals.html' },
      { slug: 'takealot', name: 'Takealot', saleUrl: 'https://www.takealot.com/deals' },
    ]);
  });

  it('asks for visible stores with an https URL, in category order then rank', async () => {
    const { db, queries } = fakeDb([takealot]);
    await getVisibleStores(db);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('r.is_visible = 1');
    expect(queries[0]).toContain("r.sale_url LIKE 'https://%'");
    expect(queries[0]).toMatch(/ORDER BY c\.sort_order, r\.rank/);
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
    expect((await getVisibleStores(db)).map((s) => s.slug)).toEqual(['takealot']);
  });

  it('returns an empty list when there are no rows', async () => {
    expect(await getVisibleStores(fakeDb([]).db)).toEqual([]);
  });
});

describe('loadHomeViewModel', () => {
  it('returns ok with the stores when rows come back, and logs nothing', async () => {
    const { log, errors } = fakeLog();
    const vm = await loadHomeViewModel(fakeDb([takealot, temu]).db, log);
    expect(vm.kind).toBe('ok');
    if (vm.kind === 'ok') expect(vm.stores.map((s) => s.slug)).toEqual(['takealot', 'temu-sa-storefront']);
    expect(errors).toEqual([]);
  });

  it('returns empty, not error, when the database works but has nothing to show', async () => {
    const { log, errors } = fakeLog();
    expect(await loadHomeViewModel(fakeDb([]).db, log)).toEqual({ kind: 'empty' });
    expect(errors).toEqual([]);
  });

  it('returns empty when every row is dropped for an unsafe URL', async () => {
    const { log } = fakeLog();
    expect(await loadHomeViewModel(fakeDb([row('a', 'A', 'javascript:alert(1)')]).db, log)).toEqual({ kind: 'empty' });
  });

  for (const failAt of ['prepare', 'all'] as const) {
    it(`returns error without throwing, and logs home_failed once, when ${failAt} fails`, async () => {
      const { log, errors } = fakeLog();
      const vm = await loadHomeViewModel(fakeDb([takealot], failAt).db, log);
      expect(vm).toEqual({ kind: 'error' });
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toBe('home_failed');
      expect(errors[0]?.fields?.err).toBeInstanceOf(Error);
    });
  }

  it('does not use a field name the logger would drop', async () => {
    const { log, errors } = fakeLog();
    await loadHomeViewModel(fakeDb([], 'all').db, log);
    const names = Object.keys(errors[0]?.fields ?? {});
    for (const reserved of ['level', 'message', 'time']) expect(names).not.toContain(reserved);
  });
});
