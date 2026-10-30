import type { FetchClass } from './types';
import { recordEffect } from './validate';
import type { ValidationVerdict } from './validate';

// What one night's result does to a store's sale record (Story 3.5). Pure: no I/O, no clock; the caller passes the
// time. The record holds facts only (a state, a validation level, a percentage and times): no URL and no page text
// (NFR7). The URL of a sale is the store's `sale_url` or an active override's.

export interface SaleRecordFields {
  state: 'active' | 'ended' | 'unknown';
  validation: 'content_verified' | 'url_verified' | 'none';
  discountPercent: number | null;
  lastResult: FetchClass;
  firstSeenAt: string | null;
  lastCheckedAt: string;
  lastValidatedAt: string | null;
  endedAt: string | null;
}

export interface FetchEvent {
  /** The class of the fetch (Story 3.2). */
  result: FetchClass;
  /** What Story 3.3 made of the page, or null when the page was not judged. */
  verdict: ValidationVerdict | null;
  /** Story 3.4 will fill this; null until then. Anything outside 5 to 90 is dropped. */
  discountPercent: number | null;
  /** UTC, `YYYY-MM-DDTHH:MM:SSZ`. */
  now: string;
}

const MIN_PERCENT = 5; // sale_records.discount_percent CHECK
const MAX_PERCENT = 90;

type Effect = 'active_content' | 'active_url' | 'ended' | 'keep';

function effectOf(event: FetchEvent): Effect {
  switch (event.result) {
    case 'js_only':
      return 'active_url';
    case 'not_found':
    case 'redirected_away':
      return 'ended';
    case 'ok': {
      if (event.verdict === null) return 'keep'; // the page was not judged: do not change the record
      const effect = recordEffect(event.verdict);
      if (effect.state === 'ended') return 'ended';
      if (effect.state === null) return 'keep'; // a challenge or login page is a block
      return effect.validation === 'content_verified' ? 'active_content' : 'active_url';
    }
    default:
      return 'keep'; // blocked, error: the last good record stays
  }
}

function sanePercent(value: number | null): number | null {
  return value !== null && Number.isInteger(value) && value >= MIN_PERCENT && value <= MAX_PERCENT ? value : null;
}

/**
 * The new sale record after one fetch, or null when nothing is written (a manual store is never fetched).
 *
 * - active (`js_only`, or a valid or unverifiable page): `last_validated_at` is now, `ended_at` is cleared, and
 *   `first_seen_at` is kept unless the record is new or the sale had ended (then it is now: a new sale);
 * - ended (`not_found`, `redirected_away`, or a page with no sale): `ended_at` is kept if already ended, else now;
 *   `last_validated_at` is left alone, because a failed page is not a validation;
 * - keep (`blocked`, `error`, a challenge or login page, an unjudged page): only `last_result` and `last_checked_at`
 *   change, so the site hides the store only after 72 hours without a good check (Story 2.3). A store with no record
 *   gets an `unknown` one.
 */
export function nextSaleRecord(previous: SaleRecordFields | null, event: FetchEvent): SaleRecordFields | null {
  if (event.result === 'skipped_manual') return null;
  const effect = effectOf(event);
  const { now } = event;

  if (effect === 'keep') {
    if (previous === null) {
      return {
        state: 'unknown',
        validation: 'none',
        discountPercent: null,
        lastResult: event.result,
        firstSeenAt: null,
        lastCheckedAt: now,
        lastValidatedAt: null,
        endedAt: null,
      };
    }
    return { ...previous, lastResult: event.result, lastCheckedAt: now };
  }

  if (effect === 'ended') {
    return {
      state: 'ended',
      validation: 'none',
      discountPercent: null,
      lastResult: event.result,
      firstSeenAt: previous?.firstSeenAt ?? null,
      lastCheckedAt: now,
      lastValidatedAt: previous?.lastValidatedAt ?? null,
      endedAt: previous !== null && previous.state === 'ended' && previous.endedAt !== null ? previous.endedAt : now,
    };
  }

  const sameSale = previous !== null && previous.state !== 'ended' && previous.firstSeenAt !== null;
  return {
    state: 'active',
    validation: effect === 'active_content' ? 'content_verified' : 'url_verified',
    discountPercent: sanePercent(event.discountPercent),
    lastResult: event.result,
    firstSeenAt: sameSale ? previous.firstSeenAt : now,
    lastCheckedAt: now,
    lastValidatedAt: now,
    endedAt: null,
  };
}
