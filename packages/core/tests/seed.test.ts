import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildSeed, parseSeedTsv, slugify } from '../src/seed';
import type { SeedCategory, SeedRow } from '../src/types';

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8');

const sampleTsv = read('./fixtures/seed-sample.tsv');

const category = (slug: string, name: string, sortOrder: number): SeedCategory => ({
  slug,
  name,
  tagline: `Tagline for ${name}.`,
  sortOrder,
  colorToken: 'cat-default',
});

const sampleCategories: SeedCategory[] = [
  category('marketplaces-department', 'Marketplaces & department', 1),
  category('fashion-apparel', 'Fashion & apparel', 2),
  category('baby-kids-toys', 'Baby, kids & toys', 3),
];

const baseRow: SeedRow = {
  line: 2,
  category: 'Fashion & apparel',
  rank: '1',
  store: 'Test Store',
  homepage: 'https://www.teststore.co.za',
  primarySaleUrl: 'https://www.teststore.co.za/sale',
  blackFridayUrl: '—',
  platform: 'Custom',
  status: 'Verified – products visible',
};
const row = (overrides: Partial<SeedRow> = {}): SeedRow => ({ ...baseRow, ...overrides });
const build = (rows: SeedRow[]) => buildSeed(rows, sampleCategories);

describe('slugify', () => {
  it('lowercases and joins words with hyphens', () => {
    expect(slugify('Mr Price Home')).toBe('mr-price-home');
  });
  it('deletes apostrophes instead of splitting on them', () => {
    expect(slugify("Hirsch's")).toBe('hirschs');
    expect(slugify('Food Lover’s Market')).toBe('food-lovers-market');
  });
  it('turns dots, brackets, slashes and ampersands into single hyphens', () => {
    expect(slugify('Amazon.co.za')).toBe('amazon-co-za');
    expect(slugify('Bash (TFG)')).toBe('bash-tfg');
    expect(slugify('Cape Union Mart / K-Way')).toBe('cape-union-mart-k-way');
    expect(slugify('House & Home (Lewis Group)')).toBe('house-home-lewis-group');
    expect(slugify('@home (shop on Bash)')).toBe('home-shop-on-bash');
  });
  it('removes accents', () => {
    expect(slugify('Estée Lauder SA')).toBe('estee-lauder-sa');
  });
});

describe('parseSeedTsv', () => {
  it('reads every data row with its line number', () => {
    const rows = parseSeedTsv(sampleTsv);
    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatchObject({ line: 2, store: 'Ackermans', rank: '1' });
    expect(rows[7]).toMatchObject({ line: 9, store: 'Cielo' });
  });

  it('matches the status column by its prefix, whatever date it carries', () => {
    const text = sampleTsv.replace('Status (28 Oct 2026)', 'Status (3 Nov 2026)');
    expect(parseSeedTsv(text)[0]?.status).toContain('products visible');
  });

  it('accepts a file without a final newline and one with Windows line endings', () => {
    expect(parseSeedTsv(sampleTsv.trimEnd())).toHaveLength(8);
    expect(parseSeedTsv(sampleTsv.replace(/\n/g, '\r\n'))).toHaveLength(8);
  });

  it('throws on an empty file', () => {
    expect(() => parseSeedTsv('')).toThrow(/empty/);
  });

  it('throws when a required header column is missing', () => {
    expect(() => parseSeedTsv(sampleTsv.replace('Store\t', 'Shop\t'))).toThrow(/"Store"/);
    expect(() => parseSeedTsv(sampleTsv.replace('Status (28 Oct 2026)', 'State'))).toThrow(/Status/);
  });

  it('throws with the line number when a row has the wrong number of columns', () => {
    const lines = sampleTsv.split('\n');
    lines[2] = 'Fashion & apparel\t2\tToo short';
    expect(() => parseSeedTsv(lines.join('\n'))).toThrow(/line 3: expected 10 columns, found 3/);
  });

  it('throws on a control character inside a cell', () => {
    const text = sampleTsv.replace('Ackermans', 'Ack\u0001ermans');
    expect(() => parseSeedTsv(text)).toThrow(/line 2 .*control character/);
  });
});

describe('buildSeed on the sample file', () => {
  const { categories, retailers } = build(parseSeedTsv(sampleTsv));
  const bySlug = (slug: string) => {
    const found = retailers.find((r) => r.slug === slug);
    if (!found) throw new Error(`no retailer ${slug}`);
    return found;
  };

  it('keeps the file order for categories and retailers', () => {
    expect(categories.map((c) => c.slug)).toEqual(sampleCategories.map((c) => c.slug));
    expect(retailers.map((r) => r.name)).toEqual([
      'Ackermans',
      "Hirsch's",
      'Estée Lauder SA',
      'Ackermans',
      'Naartjie',
      'Toy Kingdom',
      'Amazon.co.za',
      'Cielo',
    ]);
  });

  it('gives the first Ackermans the plain slug and the second one the category suffix', () => {
    expect(retailers.map((r) => r.slug).slice(0, 4)).toEqual([
      'ackermans',
      'hirschs',
      'estee-lauder-sa',
      'ackermans-baby-kids-toys',
    ]);
    expect(bySlug('ackermans').categorySlug).toBe('fashion-apparel');
    expect(bySlug('ackermans-baby-kids-toys').categorySlug).toBe('baby-kids-toys');
    expect(new Set(retailers.map((r) => r.slug)).size).toBe(retailers.length);
  });

  it('keeps numeric ranks and maps Alt to 100 plus the position in its category', () => {
    expect(bySlug('ackermans').rank).toBe(1);
    expect(bySlug('hirschs').rank).toBe(2);
    expect(bySlug('naartjie').rank).toBe(102);
    expect(bySlug('toy-kingdom').rank).toBe(103);
  });

  it('writes null for the spreadsheet dash markers', () => {
    const hirschs = bySlug('hirschs');
    expect(hirschs.saleUrl).toBeNull();
    expect(hirschs.blackFridayUrl).toBeNull();
    expect(hirschs.platform).toBeNull();
    expect(bySlug('naartjie').saleUrl).toBeNull();
    expect(bySlug('estee-lauder-sa').blackFridayUrl).toBeNull();
  });

  it('keeps https URLs and the platform text unchanged', () => {
    const ackermans = bySlug('ackermans');
    expect(ackermans.saleUrl).toBe('https://www.ackermans.co.za/sale');
    expect(ackermans.blackFridayUrl).toBe('https://www.ackermans.co.za/black-friday');
    expect(ackermans.platform).toBe('Shopify /collections/');
  });

  it('is visible exactly when there is a sale URL, even for a search_only row', () => {
    for (const retailer of retailers) {
      expect(retailer.isVisible).toBe(retailer.saleUrl !== null);
    }
    const cielo = bySlug('cielo');
    expect(cielo.seedStatus).toBe('search_only');
    expect(cielo.saleUrl).toBeNull();
    expect(cielo.isVisible).toBe(false);
    expect(cielo.blackFridayUrl).toBe('https://www.cielo.co.za/all-black-friday-deals/');
  });

  it('maps all four statuses', () => {
    expect(bySlug('ackermans').seedStatus).toBe('verified_products');
    expect(bySlug('estee-lauder-sa').seedStatus).toBe('verified_js_shell');
    expect(bySlug('toy-kingdom').seedStatus).toBe('search_only');
    expect(bySlug('hirschs').seedStatus).toBe('no_sale_page');
  });

  it('picks the extraction method: manual hosts, then Shopify, then html', () => {
    expect(bySlug('amazon-co-za').extractionMethod).toBe('manual');
    expect(bySlug('ackermans').extractionMethod).toBe('shopify_json');
    expect(bySlug('ackermans-baby-kids-toys').extractionMethod).toBe('shopify_json');
    expect(bySlug('toy-kingdom').extractionMethod).toBe('html');
    expect(bySlug('estee-lauder-sa').extractionMethod).toBe('html');
  });
});

describe('buildSeed rules', () => {
  it('treats the three blocked stores as manual whatever their platform says', () => {
    const hosts = ['www.amazon.co.za', 'game.co.za', 'www.checkers.co.za'];
    for (const host of hosts) {
      const [retailer] = build([
        row({ store: host, homepage: `https://${host}`, platform: 'Shopify (pretend)' }),
      ]).retailers;
      expect(retailer?.extractionMethod).toBe('manual');
    }
  });

  it('matches Shopify in any letter case', () => {
    const [retailer] = build([row({ platform: 'SHOPIFY /collections/' })]).retailers;
    expect(retailer?.extractionMethod).toBe('shopify_json');
  });

  it('throws when a slug is still taken after the category suffix', () => {
    const rows = [row({ line: 2 }), row({ line: 3 }), row({ line: 4 })];
    expect(() => build(rows)).toThrow(/line 4 \(Test Store\).*already used/);
  });

  it('throws on an unknown status or category', () => {
    expect(() => build([row({ status: 'Something else' })])).toThrow(/unknown status/);
    expect(() => build([row({ category: 'Cars' })])).toThrow(/unknown category/);
  });

  it('throws on a rank that is not a number or Alt, or is out of range', () => {
    expect(() => build([row({ rank: 'first' })])).toThrow(/unsupported rank/);
    expect(() => build([row({ rank: '0' })])).toThrow(/outside 1 to 999/);
    expect(() => build([row({ rank: '1000' })])).toThrow(/outside 1 to 999/);
  });

  it('throws when the homepage is not https or not a URL', () => {
    expect(() => build([row({ homepage: 'http://www.teststore.co.za' })])).toThrow(/https/);
    expect(() => build([row({ homepage: 'https://' })])).toThrow(/valid URL/);
  });

  it('throws when a URL contains a space, quote, backslash or control character', () => {
    for (const bad of ['a b', "a'b", 'a"b', 'a\\b', 'a\u0007b']) {
      expect(() => build([row({ primarySaleUrl: `https://www.teststore.co.za/${bad}` })])).toThrow(
        /contains a space, quote, backslash or control character/,
      );
      expect(() => build([row({ blackFridayUrl: `https://www.teststore.co.za/${bad}` })])).toThrow(
        /Black Friday URL/,
      );
    }
  });

  it('throws on a store name that is empty or has a control character', () => {
    expect(() => build([row({ store: '' })])).toThrow(/invalid store name/);
    expect(() => build([row({ store: 'Bad\nName' })])).toThrow(/invalid store name/);
  });

  it('throws on a slug that would be empty', () => {
    expect(() => build([row({ store: '!!!' })])).toThrow(/invalid slug/);
  });

  it('throws on a bad category list', () => {
    const rows = [row()];
    const bad = (overrides: Partial<SeedCategory>) => buildSeed(rows, [{ ...sampleCategories[1]!, ...overrides }]);
    expect(() => bad({ slug: 'Not A Slug' })).toThrow(/invalid slug/);
    expect(() => bad({ tagline: 'bad\u0000tagline' })).toThrow(/invalid tagline/);
    expect(() => bad({ sortOrder: 1.5 })).toThrow(/sortOrder/);
    expect(() => bad({ colorToken: 'Has Space' })).toThrow(/colorToken/);
    expect(() => buildSeed(rows, [sampleCategories[1]!, sampleCategories[1]!])).toThrow(/duplicate slug/);
  });

  it('puts every Alt row after the numbered ones in the same category', () => {
    const rows = [row({ line: 2, store: 'A', rank: 'Alt' }), row({ line: 3, store: 'B', rank: '10' })];
    const [alt, numbered] = build(rows).retailers;
    expect(alt?.rank).toBeGreaterThan(numbered?.rank ?? 0);
  });
});

describe('buildSeed on the real spreadsheet', () => {
  const categories = JSON.parse(read('../../../db/seed/categories.json')) as SeedCategory[];
  const seed = buildSeed(parseSeedTsv(read('../../../docs/data/retailers-seed.tsv')), categories);

  it('has ten categories with valid, unique slugs and a tagline each', () => {
    expect(seed.categories).toHaveLength(10);
    expect(new Set(seed.categories.map((c) => c.slug)).size).toBe(10);
    for (const c of seed.categories) expect(c.tagline.length).toBeGreaterThan(0);
  });

  it('has unique, valid slugs and every store in a known category', () => {
    const known = new Set(seed.categories.map((c) => c.slug));
    expect(new Set(seed.retailers.map((r) => r.slug)).size).toBe(seed.retailers.length);
    for (const r of seed.retailers) {
      expect(r.slug).toMatch(/^[a-z0-9-]+$/);
      expect(known.has(r.categorySlug)).toBe(true);
    }
  });

  it('shows a store exactly when it has a sale URL, and every URL is https', () => {
    for (const r of seed.retailers) {
      expect(r.isVisible).toBe(r.saleUrl !== null);
      for (const url of [r.homepageUrl, r.saleUrl, r.blackFridayUrl]) {
        if (url !== null) expect(url.startsWith('https://')).toBe(true);
      }
    }
  });

  it('ranks Alt stores after the numbered stores of their category', () => {
    for (const r of seed.retailers) {
      expect(r.rank).toBeGreaterThanOrEqual(1);
    }
    const alt = seed.retailers.filter((r) => r.rank >= 100);
    expect(alt.length).toBeGreaterThan(0);
    for (const r of alt) {
      const numbered = seed.retailers.filter((o) => o.categorySlug === r.categorySlug && o.rank < 100);
      for (const o of numbered) expect(r.rank).toBeGreaterThan(o.rank);
    }
  });

  it('keeps the duplicate-name stores as separate rows with a category suffix', () => {
    const slugs = new Set(seed.retailers.map((r) => r.slug));
    for (const slug of [
      'bash-tfg',
      'bash-tfg-fashion-apparel',
      'superbalist',
      'superbalist-fashion-apparel',
      'ackermans',
      'ackermans-baby-kids-toys',
      'hirschs',
      'hirschs-home-decor-furniture',
      'faithful-to-nature',
      'faithful-to-nature-grocery-liquor',
    ]) {
      expect(slugs.has(slug)).toBe(true);
    }
  });
});
