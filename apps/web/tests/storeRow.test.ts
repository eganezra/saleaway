import { describe, expect, it } from 'vitest';
import type { StoreLink } from '../src/lib/db';
import { toRowData } from '../src/lib/storeRow';

const NOW = new Date('2026-10-31T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const at = (hoursAgo: number): string => new Date(NOW.getTime() - hoursAgo * HOUR).toISOString().replace(/\.\d{3}Z$/, 'Z');

const link = (over: Partial<StoreLink> = {}): StoreLink => ({
  slug: 'crocs-sa',
  name: 'Crocs SA',
  saleUrl: 'https://www.crocs.co.za/sale',
  discountPercent: 50,
  checkedAt: at(1),
  ...over,
});

describe('the figure and the pill tier (AC1)', () => {
  it.each([
    [1, 'warm'],
    [5, 'warm'],
    [49, 'warm'],
    [50, 'hot'],
    [90, 'hot'],
    [99, 'hot'],
  ])('shows %i as the %s tier', (percent, tier) => {
    expect(toRowData(link({ discountPercent: percent }), NOW)).toMatchObject({ percent, tier });
  });
  it.each([0, 100, -5, 12.5, Number.NaN, Number.POSITIVE_INFINITY, null])('shows %s as "On sale" (no figure, plain tier)', (value) => {
    expect(toRowData(link({ discountPercent: value }), NOW)).toMatchObject({ percent: null, tier: 'plain' });
  });
  it('is not fooled by a value that is not a number at all', () => {
    expect(toRowData(link({ discountPercent: '50' as unknown as number }), NOW)).toMatchObject({ percent: null, tier: 'plain' });
  });
  it('copies the name, the slug and the address', () => {
    expect(toRowData(link(), NOW)).toMatchObject({ slug: 'crocs-sa', name: 'Crocs SA', saleUrl: 'https://www.crocs.co.za/sale' });
  });
});

describe('the "Checked" words (AC2)', () => {
  it.each([
    [0, 'Checked today', 'today'],
    [23.99, 'Checked today', 'today'],
    [24, 'Checked 1 day ago', 'older'],
    [47.99, 'Checked 1 day ago', 'older'],
    [48, 'Checked 2 days ago', 'older'],
    [72, 'Checked 3 days ago', 'older'],
  ])('a check %s hours ago reads "%s"', (hours, text, age) => {
    expect(toRowData(link({ checkedAt: at(hours) }), NOW)).toMatchObject({ checkedText: text, checkedAge: age });
  });
  it('counts a time in the future as today', () => {
    expect(toRowData(link({ checkedAt: at(-5) }), NOW)).toMatchObject({ checkedText: 'Checked today', checkedAge: 'today' });
  });
  it.each([null, '', 'not a date', 'yesterday'])('says "Not checked yet" for %j', (value) => {
    expect(toRowData(link({ checkedAt: value }), NOW)).toMatchObject({ checkedText: 'Not checked yet', checkedAge: 'never' });
  });
});

describe('the link\'s accessible name', () => {
  it('reads like the spec: name, up to X% off, checked today, opens in a new tab', () => {
    expect(toRowData(link(), NOW).label).toBe('Crocs SA, up to 50% off, checked today, opens in a new tab');
  });
  it('says "on sale" with no figure, and "checked N days ago" for an older check', () => {
    expect(toRowData(link({ discountPercent: null, checkedAt: at(50) }), NOW).label).toBe('Crocs SA, on sale, checked 2 days ago, opens in a new tab');
  });
  it('says "not checked yet" for a store never checked', () => {
    expect(toRowData(link({ discountPercent: null, checkedAt: null }), NOW).label).toBe('Crocs SA, on sale, not checked yet, opens in a new tab');
  });
  it.each([
    [link()],
    [link({ discountPercent: 5, checkedAt: at(30) })],
    [link({ discountPercent: null, checkedAt: at(80) })],
    [link({ discountPercent: null, checkedAt: null })],
  ])('always contains the words the row shows, so the two never differ (label in name)', (store) => {
    const row = toRowData(store, NOW);
    const shown = (row.percent === null ? 'on sale' : `up to ${row.percent}% off`).toLowerCase();
    expect(row.label.toLowerCase()).toContain(row.name.toLowerCase());
    expect(row.label.toLowerCase()).toContain(shown);
    expect(row.label.toLowerCase()).toContain(row.checkedText.toLowerCase());
  });
  it('passes a name with markup characters through unchanged (Astro escapes it when it draws the page)', () => {
    const name = 'A <b>&"\' store';
    const row = toRowData(link({ name }), NOW);
    expect(row.name).toBe(name);
    expect(row.label.startsWith(`${name}, `)).toBe(true);
  });
});

describe('purity', () => {
  it('does not change its input and gives the same answer twice', () => {
    const store = link();
    const copy = { ...store };
    const first = toRowData(store, NOW);
    expect(toRowData(store, NOW)).toEqual(first);
    expect(store).toEqual(copy);
  });
});
