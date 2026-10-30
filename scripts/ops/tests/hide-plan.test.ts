import { describe, expect, it } from 'vitest';
import { isApplied, selectSlugs } from '../src/hide-plan';

describe('selectSlugs', () => {
  const listed = ['dis-chem', 'edgars', 'zara-sa'];

  it('uses the whole list when no store is named', () => {
    expect(selectSlugs(listed, [])).toEqual({ ok: true, slugs: listed });
  });
  it('uses only the named stores, in the order given', () => {
    expect(selectSlugs(listed, ['zara-sa', 'dis-chem'])).toEqual({ ok: true, slugs: ['zara-sa', 'dis-chem'] });
  });
  it('refuses a store that is not on the list, and names it, so the command cannot touch any other store', () => {
    const result = selectSlugs(listed, ['edgars', 'shoprite', 'checkers']);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.message).toContain('shoprite, checkers');
  });
  it('does not change the lists it is given', () => {
    const requested = ['edgars'];
    const result = selectSlugs(listed, requested);
    if (result.ok) result.slugs.push('x');
    expect(requested).toEqual(['edgars']);
    expect(listed).toHaveLength(3);
  });
});

describe('isApplied', () => {
  const counts = (selected: number, visibleSelected: number) => ({ selected, visibleSelected, visibleTotal: 57 });

  it('hiding worked when every selected store exists and none is visible', () => {
    expect(isApplied(counts(35, 0), 35, false)).toBe(true);
  });
  it('hiding did not work when some are still visible (for example the confirmation was answered "no")', () => {
    expect(isApplied(counts(35, 35), 35, false)).toBe(false);
    expect(isApplied(counts(35, 1), 35, false)).toBe(false);
  });
  it('showing worked when every selected store exists and all are visible', () => {
    expect(isApplied(counts(35, 35), 35, true)).toBe(true);
    expect(isApplied(counts(1, 1), 1, true)).toBe(true);
  });
  it('showing did not work when some stay hidden', () => {
    expect(isApplied(counts(35, 0), 35, true)).toBe(false);
    expect(isApplied(counts(35, 34), 35, true)).toBe(false);
  });
  it('fails when a listed store is missing from the database, even if the rest look right', () => {
    expect(isApplied(counts(34, 0), 35, false)).toBe(false);
    expect(isApplied(counts(34, 34), 35, true)).toBe(false);
  });
  it('fails when the database could not be read', () => {
    expect(isApplied(null, 35, false)).toBe(false);
  });
});
