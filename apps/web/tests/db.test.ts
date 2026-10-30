import { describe, expect, it } from 'vitest';
import { recordClick } from '../src/lib/db';

/** A fake database that records what it is asked to run. */
function fakeDb(changes: number | undefined, fail = false) {
  const calls: Array<{ sql: string; binds: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) {
          return {
            run: async () => {
              calls.push({ sql, binds });
              if (fail) throw new Error('D1_ERROR: database unavailable');
              return { meta: { changes } };
            },
          };
        },
      };
    },
  } as unknown as Pick<D1Database, 'prepare'>;
  return { db, calls };
}

describe('recordClick (Story 2.5)', () => {
  it('runs one statement with bound parameters, in the order the SQL uses them', async () => {
    const { db, calls } = fakeDb(1);
    await recordClick(db, 'takealot', '2026-10-31', 2);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.binds).toEqual(['2026-10-31', 2, 'takealot']);
    // the values are bound, never written into the SQL text
    expect(calls[0]?.sql).not.toContain('takealot');
    expect(calls[0]?.sql).not.toContain('2026-10-31');
    expect(calls[0]?.sql.match(/\?/g)).toHaveLength(3);
  });
  it('is an upsert on the day and the store, adding to the existing count', async () => {
    const { db, calls } = fakeDb(1);
    await recordClick(db, 'takealot', '2026-10-31', 1);
    const sql = calls[0]?.sql ?? '';
    expect(sql).toContain('INSERT INTO click_counts (day, retailer_id, clicks)');
    expect(sql).toContain('FROM retailers WHERE slug = ?');
    expect(sql).toContain('ON CONFLICT (day, retailer_id) DO UPDATE SET clicks = clicks + excluded.clicks');
  });
  it('returns true when a row was written and false when the store does not exist', async () => {
    expect(await recordClick(fakeDb(1).db, 'takealot', '2026-10-31', 1)).toBe(true);
    expect(await recordClick(fakeDb(0).db, 'nobody', '2026-10-31', 1)).toBe(false);
    expect(await recordClick(fakeDb(undefined).db, 'nobody', '2026-10-31', 1)).toBe(false);
  });
  it('passes a database error up', async () => {
    await expect(recordClick(fakeDb(1, true).db, 'takealot', '2026-10-31', 1)).rejects.toThrow('database unavailable');
  });
});
