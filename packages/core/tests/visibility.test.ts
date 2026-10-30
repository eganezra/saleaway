import { describe, expect, it } from 'vitest';
import { STALE_AFTER_HOURS, isOverrideActive, isVisible, resolveStore } from '../src/visibility';
import type { StoreInput, VisibilityOverride, VisibilityRecord } from '../src/visibility';

const NOW = new Date('2026-10-30T12:00:00Z');
const HOUR = 60 * 60 * 1000;
/** The time `hours` before NOW, in the stored format. */
const ago = (hours: number, extraSeconds = 0): string =>
  new Date(NOW.getTime() - hours * HOUR - extraSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const inFuture = (hours: number): string => new Date(NOW.getTime() + hours * HOUR).toISOString().replace(/\.\d{3}Z$/, 'Z');

const record = (over: Partial<VisibilityRecord> = {}): VisibilityRecord => ({
  state: 'active',
  discountPercent: null,
  lastValidatedAt: ago(1),
  ...over,
});
const override = (over: Partial<VisibilityOverride> = {}): VisibilityOverride => ({
  discountPercent: null,
  hide: false,
  saleUrl: null,
  expiresAt: null,
  createdAt: ago(1),
  ...over,
});
/** A store that is shown: visible flag, an https URL, added long ago, validated an hour ago. */
const store = (over: Partial<StoreInput> = {}): StoreInput => ({
  isVisible: true,
  saleUrl: 'https://shop.example/sale',
  createdAt: ago(24 * 10),
  record: record(),
  override: null,
  ...over,
});

describe('STALE_AFTER_HOURS', () => {
  it('is 72', () => {
    expect(STALE_AFTER_HOURS).toBe(72);
  });
});

describe('a store that is shown', () => {
  it('is visible, with its stored URL and percentage', () => {
    const view = resolveStore(store({ record: record({ discountPercent: 40 }) }), NOW);
    expect(view).toEqual({ visible: true, hiddenBecause: null, discountPercent: 40, saleUrl: 'https://shop.example/sale', freshAt: ago(1) });
  });
  it('has a null percentage ("On sale") when nothing gives one', () => {
    expect(resolveStore(store(), NOW).discountPercent).toBeNull();
    expect(resolveStore(store({ record: null, createdAt: ago(1) }), NOW).discountPercent).toBeNull();
  });
});

describe('AC1: stores flagged hidden are not shown', () => {
  it('hides a store whose flag is off, even with an override that sets a percentage', () => {
    expect(resolveStore(store({ isVisible: false }), NOW)).toMatchObject({ visible: false, hiddenBecause: 'flag' });
    expect(resolveStore(store({ isVisible: false, override: override({ discountPercent: 50 }) }), NOW)).toMatchObject({
      visible: false,
      hiddenBecause: 'flag',
    });
  });
});

describe('AC2: staleness', () => {
  it('shows a store validated an hour ago', () => {
    expect(isVisible(store(), NOW)).toBe(true);
  });
  it('shows a store validated exactly 72 hours ago, and hides it one second later', () => {
    expect(isVisible(store({ record: record({ lastValidatedAt: ago(72) }) }), NOW)).toBe(true);
    const late = resolveStore(store({ record: record({ lastValidatedAt: ago(72, 1) }) }), NOW);
    expect(late).toMatchObject({ visible: false, hiddenBecause: 'stale' });
  });
  it('measures a never-validated store from the time it was added (a record without a validation)', () => {
    expect(isVisible(store({ createdAt: ago(71), record: record({ lastValidatedAt: null }) }), NOW)).toBe(true);
    expect(resolveStore(store({ createdAt: ago(73), record: record({ lastValidatedAt: null }) }), NOW)).toMatchObject({
      visible: false,
      hiddenBecause: 'stale',
    });
  });
  it('measures a store with no record at all from the time it was added', () => {
    expect(resolveStore(store({ createdAt: ago(71), record: null }), NOW)).toMatchObject({ visible: true, freshAt: ago(71) });
    expect(resolveStore(store({ createdAt: ago(73), record: null }), NOW)).toMatchObject({ visible: false, hiddenBecause: 'stale' });
  });
  it('uses the validation, not the time it was added, once the store has been validated', () => {
    const view = resolveStore(store({ createdAt: ago(73), record: record({ lastValidatedAt: ago(1) }) }), NOW);
    expect(view).toMatchObject({ visible: true, freshAt: ago(1) });
  });
  it('judges a validated store by its validation date, even if it was added more recently than that', () => {
    const view = resolveStore(store({ createdAt: ago(1), record: record({ lastValidatedAt: ago(100) }) }), NOW);
    expect(view).toMatchObject({ visible: false, hiddenBecause: 'stale', freshAt: ago(100) });
  });
  it('keeps a store fresh while an override is active, whether it sets a percentage or only a URL', () => {
    const old = record({ lastValidatedAt: ago(5 * 24) });
    const withPercent = resolveStore(store({ record: old, override: override({ discountPercent: 30, createdAt: ago(1) }) }), NOW);
    expect(withPercent).toMatchObject({ visible: true, freshAt: ago(0) });
    const urlOnly = resolveStore(
      store({ record: old, override: override({ saleUrl: 'https://shop.example/outlet', createdAt: ago(1) }) }),
      NOW,
    );
    expect(urlOnly).toMatchObject({ visible: true, freshAt: ago(0) });
  });
  it('keeps a never-validated store shown for as long as its override is active, however old the override is (Story 4.1)', () => {
    const created = ago(24 * 20); // a manual store: no record, added 20 days ago
    const oldOverride = override({ discountPercent: 30, createdAt: ago(24 * 10) });
    expect(resolveStore(store({ record: null, createdAt: created, override: oldOverride }), NOW).visible).toBe(true);
    // an override with no expiry, and one that expires in the future, both keep it shown
    expect(resolveStore(store({ record: null, createdAt: created, override: { ...oldOverride, expiresAt: null } }), NOW).visible).toBe(true);
    expect(resolveStore(store({ record: null, createdAt: created, override: { ...oldOverride, expiresAt: inFuture(48) } }), NOW).visible).toBe(true);
    // once it has expired the store is judged as before: stale
    expect(resolveStore(store({ record: null, createdAt: created, override: { ...oldOverride, expiresAt: ago(1) } }), NOW)).toMatchObject({ visible: false, hiddenBecause: 'stale' });
    // and the same store without an override is stale
    expect(resolveStore(store({ record: null, createdAt: created, override: null }), NOW)).toMatchObject({ visible: false, hiddenBecause: 'stale' });
  });
  it('an active override does not undo the other rules: an override hide, a missing address and the flag still hide, and ended still hides without a percentage', () => {
    const old = record({ lastValidatedAt: ago(5 * 24) });
    expect(resolveStore(store({ record: old, override: override({ hide: true }) }), NOW).hiddenBecause).toBe('override_hide');
    expect(resolveStore(store({ saleUrl: null, record: old, override: override({ discountPercent: 30 }) }), NOW).hiddenBecause).toBe('no_sale_url');
    expect(resolveStore(store({ isVisible: false, record: old, override: override({ discountPercent: 30 }) }), NOW).hiddenBecause).toBe('flag');
    expect(resolveStore(store({ record: record({ state: 'ended' }), override: override({ saleUrl: 'https://shop.example/x' }) }), NOW).hiddenBecause).toBe('ended');
  });
  it('does not count an expired override as a fresh check', () => {
    const old = record({ lastValidatedAt: ago(5 * 24) });
    const expired = override({ discountPercent: 30, createdAt: ago(1), expiresAt: ago(0.5) });
    expect(resolveStore(store({ record: old, override: expired }), NOW)).toMatchObject({ visible: false, hiddenBecause: 'stale' });
  });
  it('shows a stale store while its override is active, even when the override is older than 72 hours', () => {
    const view = resolveStore(store({ record: null, createdAt: ago(100), override: override({ createdAt: ago(80) }) }), NOW);
    expect(view).toMatchObject({ visible: true, freshAt: ago(0) });
  });
});

describe('AC3: ended records are not shown', () => {
  it('hides an ended record', () => {
    expect(resolveStore(store({ record: record({ state: 'ended' }) }), NOW)).toMatchObject({ visible: false, hiddenBecause: 'ended' });
  });
  it('shows an unknown or an active record', () => {
    expect(isVisible(store({ record: record({ state: 'unknown' }) }), NOW)).toBe(true);
    expect(isVisible(store({ record: record({ state: 'active' }) }), NOW)).toBe(true);
  });
  it('shows an ended record when an active override sets a percentage (the operator says it is on sale)', () => {
    const view = resolveStore(store({ record: record({ state: 'ended', discountPercent: 20 }), override: override({ discountPercent: 45 }) }), NOW);
    expect(view).toMatchObject({ visible: true, discountPercent: 45 });
  });
  it('keeps an ended record hidden for an override that only changes the URL, a hide, or that has expired', () => {
    const ended = record({ state: 'ended' });
    expect(resolveStore(store({ record: ended, override: override({ saleUrl: 'https://shop.example/x' }) }), NOW).hiddenBecause).toBe('ended');
    expect(resolveStore(store({ record: ended, override: override({ discountPercent: 45, expiresAt: ago(1) }) }), NOW).hiddenBecause).toBe('ended');
  });
});

describe('AC4: override precedence', () => {
  it('replaces the extracted percentage with the active override percentage', () => {
    const view = resolveStore(store({ record: record({ discountPercent: 20 }), override: override({ discountPercent: 50 }) }), NOW);
    expect(view.discountPercent).toBe(50);
  });
  it('keeps the extracted percentage when the override sets none, and is null when neither has one', () => {
    expect(resolveStore(store({ record: record({ discountPercent: 20 }), override: override() }), NOW).discountPercent).toBe(20);
    expect(resolveStore(store({ override: override() }), NOW).discountPercent).toBeNull();
  });
  it('hides a store whose active override has the hide flag', () => {
    expect(resolveStore(store({ override: override({ hide: true }) }), NOW)).toMatchObject({ visible: false, hiddenBecause: 'override_hide' });
  });
  it('ignores an expired override: percentage, hide and URL', () => {
    const expired = override({ discountPercent: 70, hide: true, saleUrl: 'https://shop.example/other', expiresAt: ago(1) });
    const view = resolveStore(store({ record: record({ discountPercent: 20 }), override: expired }), NOW);
    expect(view).toEqual({ visible: true, hiddenBecause: null, discountPercent: 20, saleUrl: 'https://shop.example/sale', freshAt: ago(1) });
  });
  it('treats an expiry exactly at now as expired, and one second later as active', () => {
    expect(resolveStore(store({ override: override({ hide: true, expiresAt: ago(0) }) }), NOW).visible).toBe(true);
    expect(resolveStore(store({ override: override({ hide: true, expiresAt: inFuture(0.001) }) }), NOW).visible).toBe(false);
  });
  it('counts the expiry to the second: one second after now is still active, now itself is expired', () => {
    const oneSecondLater = new Date(NOW.getTime() + 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    expect(resolveStore(store({ override: override({ hide: true, expiresAt: oneSecondLater }) }), NOW).hiddenBecause).toBe('override_hide');
    expect(resolveStore(store({ override: override({ hide: true, expiresAt: ago(0) }) }), NOW).visible).toBe(true);
  });
  it('keeps an override with no expiry active', () => {
    expect(resolveStore(store({ override: override({ hide: true, expiresAt: null }) }), NOW).hiddenBecause).toBe('override_hide');
  });
  it('keeps an override active when its expiry is not a valid date', () => {
    expect(resolveStore(store({ override: override({ hide: true, expiresAt: 'soon' }) }), NOW).hiddenBecause).toBe('override_hide');
  });
  it('replaces the stored sale URL with the active override URL', () => {
    const view = resolveStore(store({ override: override({ saleUrl: 'https://shop.example/outlet' }) }), NOW);
    expect(view).toMatchObject({ visible: true, saleUrl: 'https://shop.example/outlet' });
  });
  it('falls back to the stored URL when the override URL has expired', () => {
    const view = resolveStore(store({ override: override({ saleUrl: 'https://shop.example/outlet', expiresAt: ago(1) }) }), NOW);
    expect(view.saleUrl).toBe('https://shop.example/sale');
  });
  it('shows a store that has no URL of its own when an active override gives one', () => {
    const view = resolveStore(store({ saleUrl: null, override: override({ saleUrl: 'https://shop.example/outlet' }) }), NOW);
    expect(view).toMatchObject({ visible: true, saleUrl: 'https://shop.example/outlet' });
  });
});

describe('a sale URL must be https', () => {
  it('hides a store whose URL is missing, empty, not https, or unsafe', () => {
    for (const saleUrl of [null, '', 'http://shop.example/sale', 'javascript:alert(1)', ' https://shop.example', 'HTTPS://shop.example', 'ftp://x']) {
      expect(resolveStore(store({ saleUrl }), NOW), String(saleUrl)).toMatchObject({ visible: false, hiddenBecause: 'no_sale_url' });
    }
  });
  it('hides a store whose override URL is not https (the override URL replaces the good one)', () => {
    for (const saleUrl of ['http://shop.example/x', 'javascript:alert(1)', '']) {
      expect(resolveStore(store({ override: override({ saleUrl }) }), NOW), saleUrl).toMatchObject({ visible: false, hiddenBecause: 'no_sale_url' });
    }
  });
});

describe('the order of the reasons', () => {
  it('reports the flag first, then no URL, then the override hide, then ended, then stale', () => {
    const stale = record({ state: 'ended', lastValidatedAt: ago(500) });
    const all = store({ isVisible: false, saleUrl: null, record: stale, override: override({ hide: true }) });
    expect(resolveStore(all, NOW).hiddenBecause).toBe('flag');
    expect(resolveStore({ ...all, isVisible: true }, NOW).hiddenBecause).toBe('no_sale_url');
    expect(resolveStore({ ...all, isVisible: true, saleUrl: 'https://shop.example/sale' }, NOW).hiddenBecause).toBe('override_hide');
    expect(resolveStore({ ...all, isVisible: true, saleUrl: 'https://shop.example/sale', override: null }, NOW).hiddenBecause).toBe('ended');
    expect(resolveStore({ ...all, isVisible: true, saleUrl: 'https://shop.example/sale', override: null, record: { ...stale, state: 'active' } }, NOW).hiddenBecause).toBe('stale');
  });
});

describe('bad data fails closed', () => {
  it('hides a store with no usable time at all', () => {
    expect(resolveStore(store({ createdAt: 'yesterday', record: record({ lastValidatedAt: null }) }), NOW)).toMatchObject({
      visible: false,
      hiddenBecause: 'stale',
      freshAt: null,
    });
    expect(resolveStore(store({ createdAt: '', record: null }), NOW)).toMatchObject({ visible: false, hiddenBecause: 'stale', freshAt: null });
  });
  it('falls back to the time it was added when the validation date does not parse', () => {
    expect(resolveStore(store({ createdAt: ago(10), record: record({ lastValidatedAt: 'not a date' }) }), NOW)).toMatchObject({ visible: true, freshAt: ago(10) });
  });
  it('does not need the override creation time to be valid: an active override keeps the store fresh whatever it says', () => {
    const view = resolveStore(store({ record: record({ lastValidatedAt: ago(100) }), override: override({ createdAt: 'nope', discountPercent: 30 }) }), NOW);
    expect(view).toMatchObject({ visible: true, freshAt: ago(0) });
  });
});

describe('purity', () => {
  it('does not change its input and gives the same answer twice', () => {
    const input = store({ record: record({ discountPercent: 20 }), override: override({ discountPercent: 40, saleUrl: 'https://shop.example/o' }) });
    const copy = JSON.parse(JSON.stringify(input)) as StoreInput;
    const first = resolveStore(input, NOW);
    expect(resolveStore(input, NOW)).toEqual(first);
    expect(input).toEqual(copy);
  });
  it('isVisible equals resolveStore(...).visible', () => {
    for (const input of [store(), store({ isVisible: false }), store({ record: record({ state: 'ended' }) })]) {
      expect(isVisible(input, NOW)).toBe(resolveStore(input, NOW).visible);
    }
  });
  it('depends on the time it is given, not the clock', () => {
    const input = store({ record: record({ lastValidatedAt: ago(71) }) });
    expect(isVisible(input, NOW)).toBe(true);
    expect(isVisible(input, new Date(NOW.getTime() + 2 * HOUR))).toBe(false);
  });
});

describe('isOverrideActive', () => {
  it('is false for no override and true for one with no expiry', () => {
    expect(isOverrideActive(null, NOW)).toBe(false);
    expect(isOverrideActive(override(), NOW)).toBe(true);
  });
  it('is active before the expiry, expired at it, and expired after it', () => {
    expect(isOverrideActive(override({ expiresAt: inFuture(1) }), NOW)).toBe(true);
    expect(isOverrideActive(override({ expiresAt: ago(0) }), NOW)).toBe(false);
    expect(isOverrideActive(override({ expiresAt: ago(1) }), NOW)).toBe(false);
  });
  it('treats an expiry that is not a date as not expired, as the site does', () => {
    expect(isOverrideActive(override({ expiresAt: 'soon' }), NOW)).toBe(true);
  });
});
