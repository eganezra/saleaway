import { describe, expect, it } from 'vitest';
import type { SeedData } from '@saleaway/core';
import { buildBringBackSql, buildClearOverrideSql, buildImportSql, buildOverrideSql, buildSeedSql, buildVisibilitySql, sqlInt, sqlNullable, sqlString } from '../src/sql';

describe('sqlString', () => {
  it('wraps text in single quotes', () => {
    expect(sqlString('Pets')).toBe("'Pets'");
  });
  it('doubles single quotes', () => {
    expect(sqlString("Hirsch's")).toBe("'Hirsch''s'");
    expect(sqlString("'; DROP TABLE retailers; --")).toBe("'''; DROP TABLE retailers; --'");
  });
  it('rejects a newline, a tab and a null character', () => {
    expect(() => sqlString('a\nb')).toThrow(/control character/);
    expect(() => sqlString('a\tb')).toThrow(/control character/);
    expect(() => sqlString('a\u0000b')).toThrow(/control character/);
  });
  it('rejects a value that is not a string', () => {
    expect(() => sqlString(5 as unknown as string)).toThrow(/needs a string/);
  });
});

describe('sqlNullable', () => {
  it('writes NULL for null and a quoted literal otherwise', () => {
    expect(sqlNullable(null)).toBe('NULL');
    expect(sqlNullable("Food Lover's")).toBe("'Food Lover''s'");
  });
});

describe('sqlInt', () => {
  it('writes integers as digits', () => {
    expect(sqlInt(0)).toBe('0');
    expect(sqlInt(111)).toBe('111');
    expect(sqlInt(-3)).toBe('-3');
  });
  it('rejects floats, NaN, Infinity and strings', () => {
    expect(() => sqlInt(1.5)).toThrow(/not an integer/);
    expect(() => sqlInt(Number.NaN)).toThrow(/not an integer/);
    expect(() => sqlInt(Number.POSITIVE_INFINITY)).toThrow(/not an integer/);
    expect(() => sqlInt('1; DROP TABLE x' as unknown as number)).toThrow(/not an integer/);
  });
});

const seed: SeedData = {
  categories: [
    { slug: 'home-decor-furniture', name: 'Home, decor & furniture', tagline: 'Make it home for less.', sortOrder: 5, colorToken: 'cat-default' },
    { slug: 'pets', name: 'Pets', tagline: 'Happy pets, happy wallet.', sortOrder: 10, colorToken: 'cat-default' },
  ],
  retailers: [
    {
      slug: 'hirschs', name: "Hirsch's", homepageUrl: 'https://www.hirschs.co.za', categorySlug: 'home-decor-furniture',
      rank: 6, platform: null, saleUrl: 'https://www.hirschs.co.za/sale', blackFridayUrl: null,
      extractionMethod: 'html', seedStatus: 'search_only', isVisible: true,
    },
    {
      slug: 'zuki', name: 'Zuki', homepageUrl: 'https://www.zuki.co.za', categorySlug: 'pets',
      rank: 111, platform: 'Custom', saleUrl: null, blackFridayUrl: null,
      extractionMethod: 'manual', seedStatus: 'no_sale_page', isVisible: false,
    },
  ],
};

describe('buildSeedSql', () => {
  const sql = buildSeedSql(seed);

  it('writes all categories before any retailer', () => {
    const lastCategory = sql.lastIndexOf('INSERT INTO categories');
    const firstRetailer = sql.indexOf('INSERT INTO retailers');
    expect(lastCategory).toBeGreaterThan(-1);
    expect(firstRetailer).toBeGreaterThan(lastCategory);
  });

  it('looks the category up by slug instead of using an id', () => {
    expect(sql).toContain("(SELECT id FROM categories WHERE slug = 'home-decor-furniture')");
    expect(sql).toContain("(SELECT id FROM categories WHERE slug = 'pets')");
  });

  it('is an upsert on the unique slug, one per row', () => {
    expect(sql.match(/ON CONFLICT\(slug\) DO UPDATE SET/g)).toHaveLength(4);
  });

  it('escapes the apostrophe in a store name and writes NULL for missing values', () => {
    expect(sql).toContain("'Hirsch''s'");
    expect(sql).toContain('NULL');
    expect(sql).toContain('111');
  });

  it('never updates the columns an operator may have changed', () => {
    const updates = [...sql.matchAll(/DO UPDATE SET([\s\S]*?);/g)].map((m) => m[1] ?? '');
    expect(updates).toHaveLength(4);
    for (const update of updates) {
      expect(update).not.toMatch(/is_visible|extraction_method|black_friday_verified/);
    }
  });

  it('updates updated_at with an ISO timestamp expression on the retailers', () => {
    expect(sql).toContain("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')");
  });

  it('does not touch sale_records, overrides or any other table', () => {
    expect(sql).not.toMatch(/sale_records|overrides|pipeline_runs|run_results|DELETE|DROP|UPDATE retailers/i);
  });

  it('refuses a value with a control character', () => {
    const bad: SeedData = { ...seed, retailers: [{ ...seed.retailers[0]!, name: 'Bad\nName' }] };
    expect(() => buildSeedSql(bad)).toThrow(/control character/);
  });
});

describe('buildVisibilitySql', () => {
  it('hides the named stores with one statement that touches only is_visible and updated_at', () => {
    expect(buildVisibilitySql(['dis-chem', 'edgars'], 0)).toBe(
      "UPDATE retailers SET is_visible = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE slug IN ('dis-chem', 'edgars');",
    );
  });
  it('shows them again with 1', () => {
    expect(buildVisibilitySql(['edgars'], 1)).toBe(
      "UPDATE retailers SET is_visible = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE slug IN ('edgars');",
    );
  });
  it('doubles quotes in a slug and rejects a control character', () => {
    expect(buildVisibilitySql(["a'b"], 0)).toContain("IN ('a''b')");
    expect(() => buildVisibilitySql(['a\nb'], 0)).toThrow(/control character/);
  });
  it('rejects an empty list and a value other than 0 or 1', () => {
    expect(() => buildVisibilitySql([], 0)).toThrow(/at least one slug/);
    expect(() => buildVisibilitySql(['edgars'], 2 as unknown as 0)).toThrow(/0 or 1/);
    expect(() => buildVisibilitySql(['edgars'], true as unknown as 0)).toThrow(/0 or 1/);
  });
});

describe('buildOverrideSql (Story 4.1)', () => {
  const NOW = "strftime('%Y-%m-%dT%H:%M:%SZ','now')";
  it('creates an override with only the named columns, and on a conflict changes only those, plus created_at', () => {
    expect(buildOverrideSql(7, { percent: 40, expiresAt: '2026-11-30T23:59:59Z' })).toBe(
      `INSERT INTO overrides (retailer_id, discount_percent, expires_at) VALUES (7, 40, '2026-11-30T23:59:59Z') ON CONFLICT(retailer_id) DO UPDATE SET discount_percent = excluded.discount_percent, expires_at = excluded.expires_at, created_at = ${NOW};`,
    );
  });
  it('a change with no column still renews created_at (a bring back with no option)', () => {
    expect(buildOverrideSql(7, {})).toBe(`INSERT INTO overrides (retailer_id) VALUES (7) ON CONFLICT(retailer_id) DO UPDATE SET created_at = ${NOW};`);
  });
  it('writes null to clear a column, and the hide flag as 1 or 0', () => {
    const sql = buildOverrideSql(1, { percent: null, saleUrl: null, expiresAt: null, hide: true });
    expect(sql).toContain('(retailer_id, discount_percent, hide, sale_url, expires_at) VALUES (1, NULL, 1, NULL, NULL)');
    expect(buildOverrideSql(1, { hide: false })).toContain('VALUES (1, 0)');
  });
  it('doubles quotes in a note and an address, and rejects a control character', () => {
    expect(buildOverrideSql(1, { note: "Hirsch's sale" })).toContain("'Hirsch''s sale'");
    expect(buildOverrideSql(1, { saleUrl: "https://shop.example/it's" })).toContain("'https://shop.example/it''s'");
    expect(() => buildOverrideSql(1, { note: 'a\nb' })).toThrow(/control character/);
    expect(buildOverrideSql(1, { note: "'; DROP TABLE overrides; --" })).toContain("'''; DROP TABLE overrides; --'");
  });
  it('names the store by a whole number only', () => {
    for (const id of [1.5, Number.NaN, '7' as unknown as number, Infinity]) expect(() => buildOverrideSql(id, { hide: true }), String(id)).toThrow(/integer/);
  });
  it('does not name a column that was not given', () => {
    const sql = buildOverrideSql(3, { note: 'x' });
    for (const column of ['discount_percent', 'hide', 'sale_url', 'expires_at']) expect(sql).not.toContain(column);
  });
});

describe('buildClearOverrideSql', () => {
  it('deletes the one store, by its number', () => {
    expect(buildClearOverrideSql(7)).toBe('DELETE FROM overrides WHERE retailer_id = 7;');
    expect(() => buildClearOverrideSql(1.5)).toThrow(/integer/);
  });
});

describe('buildBringBackSql', () => {
  it('writes the override first, with the hide flag cleared, and the store update second, in one text', () => {
    const sql = buildBringBackSql(7, { percent: 30, hide: true });
    const lines = sql.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^INSERT INTO overrides \(retailer_id, discount_percent, hide\) VALUES \(7, 30, 0\)/);
    expect(lines[1]).toBe("UPDATE retailers SET extraction_method = 'manual', is_visible = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = 7;");
  });
  it('works with no change at all', () => {
    const lines = buildBringBackSql(7, {}).split('\n');
    expect(lines[0]).toMatch(/\(retailer_id, hide\) VALUES \(7, 0\)/);
    expect(lines[1]).toContain('WHERE id = 7');
  });
});

describe('buildImportSql', () => {
  const row = { id: 3, discountPercent: 40, hide: false, saleUrl: 'https://shop.example/a', expiresAt: '2026-11-30T23:59:59Z', note: "it's", createdAt: '2026-10-30T10:00:00Z' };
  it('writes every column, with the saved created_at, one statement per row', () => {
    const sql = buildImportSql([row, { ...row, id: 4, discountPercent: null, saleUrl: null, expiresAt: null, hide: true }]);
    const lines = sql.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("VALUES (3, 40, 0, 'https://shop.example/a', '2026-11-30T23:59:59Z', 'it''s', '2026-10-30T10:00:00Z')");
    expect(lines[1]).toContain("VALUES (4, NULL, 1, NULL, NULL, 'it''s', '2026-10-30T10:00:00Z')");
    expect(lines[0]).toContain('created_at = excluded.created_at');
  });
  it('refuses an empty list, a control character and a bad number', () => {
    expect(() => buildImportSql([])).toThrow(/at least one row/);
    expect(() => buildImportSql([{ ...row, note: 'a\tb' }])).toThrow(/control character/);
    expect(() => buildImportSql([{ ...row, id: 1.2 }])).toThrow(/integer/);
  });
});
