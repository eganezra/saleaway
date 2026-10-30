import { describe, expect, it } from 'vitest';
import { ROWS_SHOWN, buildCategories } from '../src/lib/categories';
import type { StoreLink } from '../src/lib/db';

const NOW = new Date('2026-10-31T12:00:00Z');
const FASHION = { slug: 'fashion-apparel', name: 'Fashion & apparel', tagline: 'Dress up, pay less.', colorToken: 'cat-default' };
const SPORT = { slug: 'sport-athleisure-outdoor', name: 'Sport, athleisure & outdoor', tagline: 'Move more, spend less.', colorToken: 'cat-default' };
const PETS = { slug: 'pets', name: 'Pets', tagline: 'Happy pets, happy wallet.', colorToken: 'cat-default' };

const store = (slug: string, category: StoreLink['category'], rank: number, discountPercent: number | null = null, over: Partial<StoreLink> = {}): StoreLink => ({
  slug,
  name: slug.toUpperCase(),
  saleUrl: `https://${slug}.example/sale`,
  discountPercent,
  checkedAt: '2026-10-31T06:00:00Z',
  rank,
  category,
  ...over,
});
const slugs = (stores: StoreLink[], index = 0): string[] => (buildCategories(stores, NOW)[index]?.rows ?? []).map((r) => r.slug);

describe('which sections there are (AC1, AC4)', () => {
  it('gives one section per category, in the order the categories first appear', () => {
    const out = buildCategories([store('a', FASHION, 1), store('b', FASHION, 2), store('c', SPORT, 1), store('d', PETS, 1)], NOW);
    expect(out.map((c) => c.slug)).toEqual(['fashion-apparel', 'sport-athleisure-outdoor', 'pets']);
  });
  it('has no section for a category with no visible store, and none at all for no stores', () => {
    expect(buildCategories([], NOW)).toEqual([]);
    expect(buildCategories([store('a', FASHION, 1)], NOW).map((c) => c.slug)).toEqual(['fashion-apparel']);
  });
  it('lets only a plain colour token through (it becomes a CSS class name), else the default', () => {
    const odd = { ...FASHION, colorToken: 'x" onmouseover="alert(1)' };
    expect(buildCategories([store('a', odd, 1)], NOW)[0]?.colorToken).toBe('cat-default');
    expect(buildCategories([store('a', { ...FASHION, colorToken: 'cat-fashion' }, 1)], NOW)[0]?.colorToken).toBe('cat-fashion');
  });
  it('puts every store in exactly one section', () => {
    const stores = [store('a', FASHION, 1), store('b', SPORT, 1), store('c', FASHION, 2), store('d', PETS, 3)];
    const all = buildCategories(stores, NOW).flatMap((c) => c.rows.map((r) => r.slug));
    expect([...all].sort()).toEqual(['a', 'b', 'c', 'd']);
  });
  it('carries the category slug, name, tagline and colour token, and counts its stores', () => {
    const [fashion] = buildCategories([store('a', FASHION, 1), store('b', FASHION, 2)], NOW);
    expect(fashion).toMatchObject({ slug: 'fashion-apparel', name: 'Fashion & apparel', tagline: 'Dress up, pay less.', colorToken: 'cat-default', count: 2 });
  });
});

describe('the order inside a section (AC2, FR14)', () => {
  it('falls back to store rank when every store is "On sale"', () => {
    expect(slugs([store('c', FASHION, 3), store('a', FASHION, 1), store('b', FASHION, 2)])).toEqual(['a', 'b', 'c']);
  });
  it('puts the biggest known percentage first, then "On sale" stores by rank', () => {
    const stores = [store('onsale-1', FASHION, 1), store('p20', FASHION, 9, 20), store('p60', FASHION, 8, 60), store('onsale-2', FASHION, 2), store('p35', FASHION, 7, 35)];
    expect(slugs(stores)).toEqual(['p60', 'p35', 'p20', 'onsale-1', 'onsale-2']);
  });
  it('breaks a tie between equal percentages by rank', () => {
    expect(slugs([store('a', FASHION, 5, 40), store('b', FASHION, 2, 40), store('c', FASHION, 3, 40)])).toEqual(['b', 'c', 'a']);
  });
  it('orders each section on its own', () => {
    const out = buildCategories([store('f1', FASHION, 1), store('f2', FASHION, 2, 50), store('s1', SPORT, 1, 10), store('s2', SPORT, 2)], NOW);
    expect(out.map((c) => c.rows.map((r) => r.slug))).toEqual([['f2', 'f1'], ['s1', 's2']]);
  });
  it('ranks a store whose figure the row cannot show as "On sale", because it is drawn as "On sale"', () => {
    // 100, 0 and 12.5 are not a whole number from 1 to 99, so the row shows "On sale" for them: rank decides, not the number.
    const stores = [store('bad-100', FASHION, 1, 100), store('good-5', FASHION, 9, 5), store('bad-0', FASHION, 2, 0), store('bad-frac', FASHION, 3, 12.5)];
    expect(slugs(stores)).toEqual(['good-5', 'bad-100', 'bad-0', 'bad-frac']);
  });
  it('ranks by the percentage the row shows, which is the override\'s when there is one (core resolves it)', () => {
    // `discountPercent` is what resolveStore returned: an override of 70 over a record of 40.
    expect(slugs([store('rec', FASHION, 1, 40), store('ovr', FASHION, 2, 70)])).toEqual(['ovr', 'rec']);
  });
});

describe('positions and rows', () => {
  it('numbers the rows 1 to N after ordering', () => {
    const [fashion] = buildCategories([store('a', FASHION, 3), store('b', FASHION, 1, 30), store('c', FASHION, 2)], NOW);
    expect(fashion?.rows.map((r) => [r.slug, r.position])).toEqual([['b', 1], ['c', 2], ['a', 3]]);
  });
  it('gives each row the data of Story 2.1 (figure, tier, checked words, label)', () => {
    const [fashion] = buildCategories([store('a', FASHION, 1, 60)], NOW);
    expect(fashion?.rows[0]).toMatchObject({ slug: 'a', percent: 60, tier: 'hot', checkedText: 'Checked today', checkedAge: 'today', label: 'A, up to 60% off, checked today, opens in a new tab' });
  });
  it('gives all the rows: the cut at ROWS_SHOWN is the component\'s job', () => {
    expect(ROWS_SHOWN).toBe(8);
    const stores = Array.from({ length: 11 }, (_, i) => store(`s${i + 1}`, SPORT, i + 1));
    const [sport] = buildCategories(stores, NOW);
    expect(sport?.count).toBe(11);
    expect(sport?.rows).toHaveLength(11);
    expect(sport?.rows[10]?.position).toBe(11);
  });
  it('does not change its input', () => {
    const stores = [store('b', FASHION, 2), store('a', FASHION, 1, 20)];
    const copy = JSON.parse(JSON.stringify(stores)) as StoreLink[];
    buildCategories(stores, NOW);
    expect(stores).toEqual(copy);
  });
});
