import { describe, expect, it } from 'vitest';
import type { SeedData } from '@saleaway/core';
import { buildSeedSql, sqlInt, sqlNullable, sqlString } from '../src/sql';

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
