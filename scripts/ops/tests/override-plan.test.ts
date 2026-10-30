import { describe, expect, it } from 'vitest';
import { canBringBack, differences, mergeOverride, overrideStatus, removeFromHiddenList } from '../src/override-plan';
import type { OverrideState } from '../src/override-plan';

const state = (over: Partial<OverrideState> = {}): OverrideState => ({ discountPercent: 40, hide: false, saleUrl: 'https://shop.example/a', expiresAt: '2026-11-30T23:59:59Z', note: 'n', ...over });

describe('mergeOverride', () => {
  it('starts from the defaults of a new override', () => {
    expect(mergeOverride(null, { percent: 25 })).toEqual({ discountPercent: 25, hide: false, saleUrl: null, expiresAt: null, note: '' });
    expect(mergeOverride(null, {})).toEqual({ discountPercent: null, hide: false, saleUrl: null, expiresAt: null, note: '' });
  });
  it('changes only the named fields of an existing override', () => {
    expect(mergeOverride(state(), { hide: true })).toEqual(state({ hide: true }));
    expect(mergeOverride(state(), { note: 'new' })).toEqual(state({ note: 'new' }));
    expect(mergeOverride(state(), { percent: 10, expiresAt: '2026-12-01T23:59:59Z' })).toEqual(state({ discountPercent: 10, expiresAt: '2026-12-01T23:59:59Z' }));
  });
  it('null clears a field, and an unnamed field is kept', () => {
    expect(mergeOverride(state(), { percent: null, saleUrl: null, expiresAt: null })).toEqual(state({ discountPercent: null, saleUrl: null, expiresAt: null }));
    expect(mergeOverride(state(), {})).toEqual(state());
  });
  it('does not change its input', () => {
    const previous = state();
    mergeOverride(previous, { percent: 1, hide: true });
    expect(previous).toEqual(state());
  });
});

describe('differences', () => {
  it('is empty when the database holds what was meant', () => {
    expect(differences(state(), state())).toEqual([]);
  });
  it('names each field that differs, and a missing override', () => {
    expect(differences(null, state())).toEqual(['the override is not there']);
    const found = differences(state({ discountPercent: 41, hide: true, note: 'x' }), state());
    expect(found).toHaveLength(3);
    expect(found.join(' ')).toMatch(/discountPercent/);
    expect(found.join(' ')).toMatch(/hide/);
    expect(found.join(' ')).toMatch(/note/);
    expect(differences(state({ saleUrl: null }), state())).toHaveLength(1);
    expect(differences(state({ expiresAt: '2027-01-01T23:59:59Z' }), state())).toHaveLength(1);
  });
});

describe('canBringBack', () => {
  it('is fine with an https address of the store, or one given now', () => {
    expect(canBringBack('https://shop.example/sale', {})).toEqual({ ok: true });
    expect(canBringBack(null, { saleUrl: 'https://shop.example/x' })).toEqual({ ok: true });
    expect(canBringBack('http://shop.example/sale', { saleUrl: 'https://shop.example/x' })).toEqual({ ok: true });
  });
  it('refuses a store with no https address and none given', () => {
    for (const url of [null, '', 'http://shop.example/sale', 'ftp://x']) expect(canBringBack(url, {}), String(url)).toMatchObject({ ok: false });
    expect(canBringBack(null, { saleUrl: null })).toMatchObject({ ok: false });
  });
  it('uses the store address when --url none takes the override address away', () => {
    expect(canBringBack('https://shop.example/sale', { saleUrl: null })).toEqual({ ok: true });
  });
});

describe('removeFromHiddenList', () => {
  const list = (slugs: string[]) =>
    `${JSON.stringify(
      { decidedOn: '2026-10-30', source: 'run 16', reasons: { http_403: 'Forbidden' }, stores: slugs.map((slug) => ({ slug, reason: 'http_403' })) },
      null,
      2,
    )}\n`;

  it('takes the store off and keeps the format: two spaces, a final newline, the same key order', () => {
    const result = removeFromHiddenList(list(['a', 'b', 'c']), 'b');
    expect(result).toEqual({ text: list(['a', 'c']), removed: true, refused: null });
    expect(result.text.endsWith('}\n')).toBe(true);
  });
  it('leaves the text alone when the store is not on the list', () => {
    const text = list(['a', 'b']);
    expect(removeFromHiddenList(text, 'zzz')).toEqual({ text, removed: false, refused: null });
  });
  it('leaves the last entry in place, because an empty list is not valid', () => {
    const text = list(['a']);
    expect(removeFromHiddenList(text, 'a')).toEqual({ text, removed: false, refused: 'last_entry' });
  });
  it('works on the real list: a store comes off and the rest is still valid', () => {
    const real = JSON.stringify(
      { decidedOn: '2026-10-30', source: 's', reasons: { http_403: 'x', http_429: 'y' }, stores: [{ slug: 'zara-sa', reason: 'http_403' }, { slug: 'edgars', reason: 'http_429' }] },
      null,
      2,
    );
    expect(removeFromHiddenList(`${real}\n`, 'zara-sa').text).toContain('edgars');
    expect(removeFromHiddenList(`${real}\n`, 'zara-sa').text).not.toContain('zara-sa');
  });
});

describe('overrideStatus', () => {
  const now = new Date('2026-10-30T12:00:00Z');
  it('is active with no expiry and before it, and expired at it and after it', () => {
    expect(overrideStatus(null, now)).toBe('active');
    expect(overrideStatus('2026-10-30T12:00:01Z', now)).toBe('active');
    expect(overrideStatus('2026-10-30T12:00:00Z', now)).toBe('expired');
    expect(overrideStatus('2026-10-29T23:59:59Z', now)).toBe('expired');
  });
});
