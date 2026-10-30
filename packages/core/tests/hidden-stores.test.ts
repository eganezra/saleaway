import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseHiddenStores } from '../src/hidden-stores';
import { buildSeed, parseSeedTsv } from '../src/seed';
import type { SeedCategory } from '../src/types';

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8');

const valid = () => ({
  decidedOn: '2026-10-30',
  source: 'Run 16',
  reasons: { http_403: 'Forbidden', http_429: 'Too many requests' },
  stores: [
    { slug: 'dis-chem', reason: 'http_403' },
    { slug: 'edgars', reason: 'http_429' },
  ],
});

describe('parseHiddenStores', () => {
  it('returns a valid list as it is', () => {
    expect(parseHiddenStores(valid())).toEqual(valid());
  });

  it('rejects a value that is not an object', () => {
    for (const value of [null, undefined, 'text', 5, [], [valid()]]) {
      expect(() => parseHiddenStores(value), String(value)).toThrow(/must hold one object/);
    }
  });

  it('rejects a missing or wrongly typed field', () => {
    expect(() => parseHiddenStores({ ...valid(), source: undefined })).toThrow(/source must be a non-empty text/);
    expect(() => parseHiddenStores({ ...valid(), source: 5 })).toThrow(/source must be a non-empty text/);
    expect(() => parseHiddenStores({ ...valid(), reasons: [] })).toThrow(/reasons must be an object/);
    expect(() => parseHiddenStores({ ...valid(), reasons: {} })).toThrow(/reasons must be an object/);
    expect(() => parseHiddenStores({ ...valid(), decidedOn: undefined })).toThrow(/decidedOn/);
    expect(() => parseHiddenStores({ ...valid(), stores: 'dis-chem' })).toThrow(/stores must be a non-empty list/);
  });

  it('rejects a date that is not a real calendar date', () => {
    for (const decidedOn of ['2026-02-30', '2026-13-01', '30-10-2026', '2026-10-30T00:00:00Z', '', 20261030]) {
      expect(() => parseHiddenStores({ ...valid(), decidedOn }), String(decidedOn)).toThrow(/decidedOn/);
    }
    expect(parseHiddenStores({ ...valid(), decidedOn: '2028-02-29' }).decidedOn).toBe('2028-02-29');
  });

  it('rejects an empty list of stores and one with more than 200', () => {
    expect(() => parseHiddenStores({ ...valid(), stores: [] })).toThrow(/stores must be a non-empty list/);
    const many = Array.from({ length: 201 }, (_, i) => ({ slug: `store-${i}`, reason: 'http_403' }));
    expect(() => parseHiddenStores({ ...valid(), stores: many })).toThrow(/more than 200/);
    expect(parseHiddenStores({ ...valid(), stores: many.slice(0, 200) }).stores).toHaveLength(200);
  });

  it('rejects a bad slug, including quotes, spaces and capitals', () => {
    for (const slug of ['Bad Slug', "a'b", 'UPPER', 'a_b', '', 'a;b', 5, null]) {
      const bad = { ...valid(), stores: [{ slug, reason: 'http_403' }] };
      expect(() => parseHiddenStores(bad), String(slug)).toThrow(/invalid slug/);
    }
    const long = { ...valid(), stores: [{ slug: 'a'.repeat(101), reason: 'http_403' }] };
    expect(() => parseHiddenStores(long)).toThrow(/invalid slug/);
    const ok = { ...valid(), stores: [{ slug: 'a'.repeat(100), reason: 'http_403' }] };
    expect(parseHiddenStores(ok).stores).toHaveLength(1);
  });

  it('rejects a duplicate slug', () => {
    const dup = { ...valid(), stores: [{ slug: 'edgars', reason: 'http_403' }, { slug: 'edgars', reason: 'http_429' }] };
    expect(() => parseHiddenStores(dup)).toThrow(/edgars\): duplicate slug/);
  });

  it('rejects a reason that the file does not explain, and a bad reason key', () => {
    const unknown = { ...valid(), stores: [{ slug: 'edgars', reason: 'http_500' }] };
    expect(() => parseHiddenStores(unknown)).toThrow(/reason "http_500" is not one of the reasons/);
    const missing = { ...valid(), stores: [{ slug: 'edgars' }] };
    expect(() => parseHiddenStores(missing)).toThrow(/reason "undefined"/);
    const inherited = { ...valid(), stores: [{ slug: 'edgars', reason: 'toString' }] };
    expect(() => parseHiddenStores(inherited)).toThrow(/reason "toString"/);
    expect(() => parseHiddenStores({ ...valid(), reasons: { 'Bad Key': 'text' } })).toThrow(/reasons key "Bad Key"/);
  });

  it('rejects text with a control character or that is too long', () => {
    expect(() => parseHiddenStores({ ...valid(), source: 'a\nb' })).toThrow(/source contains a control character/);
    expect(() => parseHiddenStores({ ...valid(), source: 'x'.repeat(501) })).toThrow(/source is longer than 500/);
    expect(() => parseHiddenStores({ ...valid(), reasons: { http_403: 'a\tb' } })).toThrow(/reasons.http_403 contains a control/);
    expect(parseHiddenStores({ ...valid(), source: 'x'.repeat(500) }).source).toHaveLength(500);
  });

  it('names every problem in one Error', () => {
    const bad = { decidedOn: '2026-02-30', source: '', reasons: { http_403: 'ok' }, stores: [{ slug: 'Bad Slug', reason: 'http_403' }, { slug: 'a', reason: 'nope' }] };
    let message = '';
    try {
      parseHiddenStores(bad);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/decidedOn/);
    expect(message).toMatch(/source must be a non-empty text/);
    expect(message).toMatch(/stores\[0\]: invalid slug/);
    expect(message).toMatch(/stores\[1\] \(a\): reason "nope"/);
  });
});

describe('the committed docs/data/hidden-stores.json', () => {
  const list = parseHiddenStores(JSON.parse(read('../../../docs/data/hidden-stores.json')));
  const categories = JSON.parse(read('../../../db/seed/categories.json')) as SeedCategory[];
  const seed = buildSeed(parseSeedTsv(read('../../../docs/data/retailers-seed.tsv')), categories);

  it('lists the 35 stores of the decision of 2026-10-30', () => {
    expect(list.decidedOn).toBe('2026-10-30');
    expect(list.stores).toHaveLength(35);
    expect(list.stores.filter((s) => s.reason === 'http_403')).toHaveLength(21);
    expect(list.stores.filter((s) => s.reason === 'http_429')).toHaveLength(13);
    expect(list.stores.filter((s) => s.reason === 'same_site_as_blocked').map((s) => s.slug)).toEqual(['ackermans-baby-kids-toys']);
  });

  it('names only stores that are in the seed, and every reason is explained', () => {
    const known = new Map(seed.retailers.map((r) => [r.slug, r]));
    for (const { slug, reason } of list.stores) {
      expect(known.has(slug), slug).toBe(true);
      expect(list.reasons[reason], slug).toBeTruthy();
    }
  });

  it('leaves 57 of the 92 visible stores, and no category empty', () => {
    const hidden = new Set(list.stores.map((s) => s.slug));
    const visibleBefore = seed.retailers.filter((r) => r.isVisible);
    expect(visibleBefore).toHaveLength(92);
    for (const slug of hidden) expect(visibleBefore.some((r) => r.slug === slug), slug).toBe(true);
    const left = visibleBefore.filter((r) => !hidden.has(r.slug));
    expect(left).toHaveLength(57);
    for (const category of seed.categories) {
      expect(left.some((r) => r.categorySlug === category.slug), category.slug).toBe(true);
    }
  });
});
