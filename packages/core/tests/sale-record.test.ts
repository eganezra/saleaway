import { describe, expect, it } from 'vitest';
import { nextSaleRecord } from '../src/sale-record';
import type { FetchEvent, SaleRecordFields } from '../src/sale-record';
import { resolveStore } from '../src/visibility';
import type { FetchClass } from '../src/types';
import type { ValidationVerdict } from '../src/validate';

const NOW = '2026-10-31T03:10:00Z';
const HOUR = 60 * 60 * 1000;
const ago = (hours: number): string => new Date(Date.parse(NOW) - hours * HOUR).toISOString().replace(/\.\d{3}Z$/, 'Z');

const event = (result: FetchClass, verdict: ValidationVerdict | null = null, over: Partial<FetchEvent> = {}): FetchEvent => ({
  result,
  verdict,
  discountPercent: null,
  now: NOW,
  ...over,
});
const record = (over: Partial<SaleRecordFields> = {}): SaleRecordFields => ({
  state: 'active',
  validation: 'content_verified',
  discountPercent: 30,
  lastResult: 'ok',
  firstSeenAt: ago(24 * 5),
  lastCheckedAt: ago(24),
  lastValidatedAt: ago(24),
  endedAt: null,
  ...over,
});
const next = (previous: SaleRecordFields | null, e: FetchEvent): SaleRecordFields => {
  const result = nextSaleRecord(previous, e);
  if (result === null) throw new Error('expected a record');
  return result;
};

const PREVIOUS: Array<[string, SaleRecordFields | null]> = [
  ['no record', null],
  ['an unknown record', record({ state: 'unknown', validation: 'none', discountPercent: null, firstSeenAt: null, lastValidatedAt: null })],
  ['an active record', record()],
  ['an ended record', record({ state: 'ended', validation: 'none', discountPercent: null, endedAt: ago(48) })],
];

describe('a manual store', () => {
  it('writes nothing', () => {
    for (const [name, previous] of PREVIOUS) expect(nextSaleRecord(previous, event('skipped_manual')), name).toBeNull();
  });
});

describe('an active result (AC1, AC6, AC7)', () => {
  const cases: Array<[string, FetchEvent, 'content_verified' | 'url_verified']> = [
    ['an ok page with a valid verdict', event('ok', 'valid'), 'content_verified'],
    ['an ok page that cannot be judged', event('ok', 'unverifiable'), 'url_verified'],
    ['a js_only answer', event('js_only'), 'url_verified'],
  ];
  for (const [name, e, validation] of cases) {
    for (const [from, previous] of PREVIOUS) {
      it(`${name}, from ${from}: active, ${validation}, validated now, not ended`, () => {
        expect(next(previous, e)).toMatchObject({
          state: 'active',
          validation,
          lastResult: e.result,
          lastCheckedAt: NOW,
          lastValidatedAt: NOW,
          endedAt: null,
        });
      });
    }
  }
});

describe('an ended result (AC2)', () => {
  const cases: Array<[string, FetchEvent]> = [
    ['a page with no sale', event('ok', 'ended')],
    ['a 404', event('not_found')],
    ['a redirect away', event('redirected_away')],
  ];
  for (const [name, e] of cases) {
    for (const [from, previous] of PREVIOUS) {
      it(`${name}, from ${from}: ended, validation none, no percentage`, () => {
        const result = next(previous, e);
        expect(result).toMatchObject({ state: 'ended', validation: 'none', discountPercent: null, lastResult: e.result, lastCheckedAt: NOW });
      });
    }
  }
  it('is not a validation: last_validated_at is left as it was', () => {
    expect(next(record({ lastValidatedAt: ago(30) }), event('ok', 'ended')).lastValidatedAt).toBe(ago(30));
    expect(next(null, event('not_found')).lastValidatedAt).toBeNull();
  });
  it('sets ended_at once and keeps it while the record stays ended', () => {
    expect(next(record(), event('not_found')).endedAt).toBe(NOW);
    expect(next(record({ state: 'unknown', firstSeenAt: null, lastValidatedAt: null }), event('not_found')).endedAt).toBe(NOW);
    const already = record({ state: 'ended', endedAt: ago(72) });
    expect(next(already, event('not_found')).endedAt).toBe(ago(72));
    expect(next(record({ state: 'ended', endedAt: null }), event('not_found')).endedAt).toBe(NOW); // an ended record with no date gets one
  });
  it('keeps first_seen_at as it was', () => {
    expect(next(record(), event('not_found')).firstSeenAt).toBe(ago(24 * 5));
    expect(next(null, event('not_found')).firstSeenAt).toBeNull();
  });
});

describe('a result that keeps the last good record (AC3, AC7)', () => {
  const cases: Array<[string, FetchEvent]> = [
    ['blocked', event('blocked')],
    ['an error', event('error')],
    ['a challenge or login page (blocked verdict)', event('ok', 'blocked')],
    ['an ok page that was not judged', event('ok', null)],
  ];
  for (const [name, e] of cases) {
    it(`${name}: only last_result and last_checked_at change`, () => {
      const previous = record({ discountPercent: 40, validation: 'content_verified' });
      expect(next(previous, e)).toEqual({ ...previous, lastResult: e.result, lastCheckedAt: NOW });
      const ended = record({ state: 'ended', validation: 'none', discountPercent: null, endedAt: ago(10) });
      expect(next(ended, e)).toEqual({ ...ended, lastResult: e.result, lastCheckedAt: NOW });
    });
    it(`${name}: with no record it creates an unknown one that holds only the last result`, () => {
      expect(next(null, e)).toEqual({
        state: 'unknown',
        validation: 'none',
        discountPercent: null,
        lastResult: e.result,
        firstSeenAt: null,
        lastCheckedAt: NOW,
        lastValidatedAt: null,
        endedAt: null,
      });
    });
    it(`${name}: never ends a sale and never refreshes last_validated_at`, () => {
      const result = next(record(), e);
      expect(result.state).toBe('active');
      expect(result.lastValidatedAt).toBe(ago(24));
    });
  }
});

describe('first seen', () => {
  it('is now for a new record and for an unknown one', () => {
    expect(next(null, event('ok', 'valid')).firstSeenAt).toBe(NOW);
    expect(next(PREVIOUS[1]![1], event('ok', 'valid')).firstSeenAt).toBe(NOW);
  });
  it('is kept across nights while the sale stays active', () => {
    expect(next(record(), event('ok', 'valid')).firstSeenAt).toBe(ago(24 * 5));
    expect(next(record(), event('js_only')).firstSeenAt).toBe(ago(24 * 5));
  });
  it('starts again when a sale comes back after it ended (a new sale)', () => {
    const ended = record({ state: 'ended', validation: 'none', endedAt: ago(48) });
    expect(next(ended, event('ok', 'valid')).firstSeenAt).toBe(NOW);
  });
  it('is now when an active record somehow has none', () => {
    expect(next(record({ firstSeenAt: null }), event('ok', 'valid')).firstSeenAt).toBe(NOW);
  });
});

describe('the percentage (Story 3.4 will fill it)', () => {
  it('keeps a whole number from 5 to 90', () => {
    for (const percent of [5, 6, 50, 89, 90]) expect(next(null, event('ok', 'valid', { discountPercent: percent })).discountPercent, String(percent)).toBe(percent);
  });
  it('drops anything the table would refuse: below 5, above 90, not whole, not a number', () => {
    for (const percent of [4, 91, 0, -5, 50.5, Number.NaN, Infinity, 100]) {
      expect(next(null, event('ok', 'valid', { discountPercent: percent })).discountPercent, String(percent)).toBeNull();
    }
    expect(next(null, event('ok', 'valid')).discountPercent).toBeNull();
  });
  it('follows the state: active keeps a given percentage, unverifiable has none unless given, ended always has none', () => {
    expect(next(record(), event('ok', 'unverifiable')).discountPercent).toBeNull();
    expect(next(record(), event('js_only', null, { discountPercent: 40 })).discountPercent).toBe(40); // js_only is active: a given percentage is kept
    expect(next(record(), event('not_found', null, { discountPercent: 40 })).discountPercent).toBeNull();
    expect(next(record(), event('ok', 'ended', { discountPercent: 40 })).discountPercent).toBeNull();
  });
});

describe('every result sets last_result and last_checked_at', () => {
  const all: FetchClass[] = ['ok', 'blocked', 'not_found', 'redirected_away', 'js_only', 'error'];
  it('for each class, from each previous record', () => {
    for (const result of all) {
      const verdict: ValidationVerdict | null = result === 'ok' ? 'valid' : null;
      for (const [from, previous] of PREVIOUS) {
        const written = next(previous, event(result, verdict));
        expect(written.lastResult, `${result} from ${from}`).toBe(result);
        expect(written.lastCheckedAt, `${result} from ${from}`).toBe(NOW);
      }
    }
  });
});

describe('with the Story 2.3 rules (AC3, AC4)', () => {
  const store = (rec: SaleRecordFields) => ({
    isVisible: true,
    saleUrl: 'https://shop.example/sale',
    createdAt: ago(24 * 20),
    record: { state: rec.state, discountPercent: rec.discountPercent, lastValidatedAt: rec.lastValidatedAt },
    override: null,
  });
  const at = (hours: number) => new Date(Date.parse(NOW) + hours * HOUR);

  it('an ended record is hidden and a valid one is shown', () => {
    expect(resolveStore(store(next(record(), event('ok', 'ended'))), at(0))).toMatchObject({ visible: false, hiddenBecause: 'ended' });
    expect(resolveStore(store(next(null, event('ok', 'valid'))), at(0)).visible).toBe(true);
  });
  it('a store kept after a blocked night is shown for 72 hours after its last good check, then hidden', () => {
    const kept = next(record({ lastValidatedAt: NOW }), event('blocked', null, { now: ago(-1) }));
    expect(kept.lastValidatedAt).toBe(NOW);
    expect(resolveStore(store(kept), at(71)).visible).toBe(true);
    expect(resolveStore(store(kept), at(73))).toMatchObject({ visible: false, hiddenBecause: 'stale' });
  });
  it('a good night after blocked nights shows the store again', () => {
    const kept = next(record({ lastValidatedAt: NOW }), event('error', null, { now: ago(-24) }));
    const back = next(kept, event('ok', 'valid', { now: ago(-48) }));
    expect(resolveStore(store(back), at(49)).visible).toBe(true);
  });
  it('a store first seen blocked is judged from the time it was added, as Story 2.3 says', () => {
    const unknown = next(null, event('blocked'));
    expect(resolveStore({ ...store(unknown), createdAt: ago(10) }, at(0)).visible).toBe(true);
    expect(resolveStore({ ...store(unknown), createdAt: ago(80) }, at(0))).toMatchObject({ visible: false, hiddenBecause: 'stale' });
  });
});

describe('purity and content (AC5)', () => {
  it('does not change its input and gives the same answer twice', () => {
    const previous = record();
    const copy = JSON.parse(JSON.stringify(previous)) as SaleRecordFields;
    const first = nextSaleRecord(previous, event('ok', 'valid'));
    expect(nextSaleRecord(previous, event('ok', 'valid'))).toEqual(first);
    expect(previous).toEqual(copy);
  });
  it('returns only the eight record fields, none of them text from a page', () => {
    const result = next(null, event('ok', 'valid', { discountPercent: 30 }));
    expect(Object.keys(result).sort()).toEqual(['discountPercent', 'endedAt', 'firstSeenAt', 'lastCheckedAt', 'lastResult', 'lastValidatedAt', 'state', 'validation']);
  });
});
