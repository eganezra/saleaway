import { toIsoUtc } from './time';

// Which stores the site shows, and with what (Story 2.3). Pure: no I/O, no clock, no SQL. The caller passes `now`.
// Rules (architecture/core-workflows.md): a store is hidden when the operator flag hides it, it has no https
// sale URL, an active override hides it, its record is ended, or it has not been validated for more than 72 hours.
// An active override's percentage and sale URL replace the stored ones, and an expired override is ignored.

export const STALE_AFTER_HOURS = 72;
const STALE_AFTER_MS = STALE_AFTER_HOURS * 60 * 60 * 1000;

/** One `sale_records` row, or null when the store has none. */
export interface VisibilityRecord {
  state: 'active' | 'ended' | 'unknown';
  discountPercent: number | null;
  lastValidatedAt: string | null;
}

/** One `overrides` row, or null when the store has none. */
export interface VisibilityOverride {
  discountPercent: number | null;
  hide: boolean;
  saleUrl: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface StoreInput {
  /** `retailers.is_visible`: the operator's switch. */
  isVisible: boolean;
  /** `retailers.sale_url`. */
  saleUrl: string | null;
  /** `retailers.created_at`. */
  createdAt: string;
  record: VisibilityRecord | null;
  override: VisibilityOverride | null;
}

export type HiddenBecause = 'flag' | 'no_sale_url' | 'override_hide' | 'ended' | 'stale';

export interface StoreView {
  visible: boolean;
  /** Why the store is hidden, or null when it is shown. */
  hiddenBecause: HiddenBecause | null;
  /** The active override's percentage, else the record's, else null ("On sale"). */
  discountPercent: number | null;
  /** The active override's sale URL, else the retailer's. */
  saleUrl: string | null;
  /** The freshness time used for the 72 hour rule (UTC, `YYYY-MM-DDTHH:MM:SSZ`), or null when there is none. */
  freshAt: string | null;
}

/** Milliseconds for a valid date text, or null for a missing or invalid one. */
function time(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * An override is active when it exists and has not expired. `expiresAt` equal to `now` is expired.
 * An `expiresAt` that is not a valid date is treated as not expired: the operator's intent stays
 * (the override command validates dates, so this does not happen in practice).
 */
function isActive(override: VisibilityOverride | null, now: number): override is VisibilityOverride {
  if (override === null) return false;
  if (override.expiresAt === null) return true;
  const expires = time(override.expiresAt);
  return expires === null || expires > now;
}

/** What the page needs to know about one store: whether to show it, and the percentage and URL to show. */
export function resolveStore(input: StoreInput, now: Date): StoreView {
  const nowMs = now.getTime();
  const override = isActive(input.override, nowMs) ? input.override : null;
  const record = input.record;

  const discountPercent = override !== null && override.discountPercent !== null ? override.discountPercent : (record?.discountPercent ?? null);
  const saleUrl = override !== null && override.saleUrl !== null ? override.saleUrl : input.saleUrl;

  // The freshness time: the last validation, or (never validated) the time the store was added, or the
  // time an active override was made, whichever is latest. A date that does not parse counts as missing.
  const candidates = [time(record?.lastValidatedAt) ?? time(input.createdAt), override === null ? null : time(override.createdAt)];
  const known = candidates.filter((value): value is number => value !== null);
  const freshMs = known.length > 0 ? Math.max(...known) : null;
  const freshAt = freshMs === null ? null : toIsoUtc(new Date(freshMs));

  let hiddenBecause: HiddenBecause | null = null;
  if (!input.isVisible) hiddenBecause = 'flag';
  else if (typeof saleUrl !== 'string' || !saleUrl.startsWith('https://')) hiddenBecause = 'no_sale_url';
  else if (override !== null && override.hide) hiddenBecause = 'override_hide';
  else if (record?.state === 'ended' && !(override !== null && override.discountPercent !== null)) hiddenBecause = 'ended';
  else if (freshMs === null || nowMs - freshMs > STALE_AFTER_MS) hiddenBecause = 'stale';

  return { visible: hiddenBecause === null, hiddenBecause, discountPercent, saleUrl, freshAt };
}

/** True when the page should show the store. */
export function isVisible(input: StoreInput, now: Date): boolean {
  return resolveStore(input, now).visible;
}
