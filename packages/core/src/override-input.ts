import { isSafeFetchUrl } from './url-safety';

// What an operator may ask of an override (Story 4.1), validated in one place so the command and, later, an admin
// page agree. Pure: no I/O and no clock (the caller passes today's date). The `overrides` table is the one of
// Story 1.3: a percentage of 1 to 99, a hide flag, a sale URL, an expiry, a note and a creation time.

export interface OverrideChange {
  /** A whole number from 1 to 99, or null to clear it. `undefined` means "leave as it is". */
  percent?: number | null;
  hide?: boolean;
  /** An https address that `isSafeFetchUrl` accepts, or null to clear it. */
  saleUrl?: string | null;
  /** `YYYY-MM-DDT23:59:59Z` (the end of the chosen day, UTC), or null to clear it. */
  expiresAt?: string | null;
  note?: string;
}

export type ChangeResult = { ok: true; change: OverrideChange } | { ok: false; errors: string[] };

export interface RawOverrideChange {
  percent?: string;
  hide?: boolean;
  saleUrl?: string;
  expires?: string;
  note?: string;
}

export interface OverrideRow {
  slug: string;
  discountPercent: number | null;
  hide: boolean;
  saleUrl: string | null;
  expiresAt: string | null;
  note: string;
  createdAt: string;
}

const MIN_PERCENT = 1; // overrides.discount_percent CHECK (wider than an extracted percentage, 5 to 90)
const MAX_PERCENT = 99;
const MAX_NOTE_LENGTH = 200;
const MAX_ROWS = 500;
const SLUG_PATTERN = /^[a-z0-9-]+$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function isRealDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isRealDateTime(value: string): boolean {
  if (!DATE_TIME_PATTERN.test(value)) return false;
  const ms = Date.parse(value);
  return !Number.isNaN(ms) && new Date(ms).toISOString().replace('.000Z', 'Z') === value;
}

/** `2026-11-30` becomes `2026-11-30T23:59:59Z`: an override "until" a date applies through that whole day (UTC). */
export function expiryFromDate(date: string): string {
  return `${date}T23:59:59Z`;
}

/**
 * Turns the raw text of each option into a typed change, or returns every error at once. `today` is
 * `YYYY-MM-DD`: an expiry date in the past is refused, because it would never be active. A change that sets
 * nothing is an error unless `allowEmpty` is true (`--bring-back` creates an override with no field).
 */
export function parseOverrideChange(raw: RawOverrideChange, today: string, options: { allowEmpty?: boolean } = {}): ChangeResult {
  const errors: string[] = [];
  const change: OverrideChange = {};

  if (raw.percent !== undefined) {
    if (raw.percent === 'none') change.percent = null;
    else if (/^\d{1,2}$/.test(raw.percent) && Number(raw.percent) >= MIN_PERCENT && Number(raw.percent) <= MAX_PERCENT) {
      change.percent = Number(raw.percent);
    } else errors.push(`percent must be a whole number from ${MIN_PERCENT} to ${MAX_PERCENT}, or none (got "${raw.percent}")`);
  }

  if (raw.hide !== undefined) change.hide = raw.hide;

  if (raw.saleUrl !== undefined) {
    if (raw.saleUrl === 'none') change.saleUrl = null;
    else if (isSafeFetchUrl(raw.saleUrl)) change.saleUrl = raw.saleUrl;
    else errors.push('url must be an https address of a public website (no IP address, no port, no login in it), or none');
  }

  if (raw.expires !== undefined) {
    if (raw.expires === 'none') change.expiresAt = null;
    else if (!isRealDate(raw.expires)) errors.push(`expires must be a real date as YYYY-MM-DD, or none (got "${raw.expires}")`);
    else if (raw.expires < today) errors.push(`expires is in the past (today is ${today}): the override would never apply`);
    else change.expiresAt = expiryFromDate(raw.expires);
  }

  if (raw.note !== undefined) {
    if (raw.note.length > MAX_NOTE_LENGTH) errors.push(`note is longer than ${MAX_NOTE_LENGTH} characters`);
    else if (hasControlCharacter(raw.note)) errors.push('note contains a control character');
    else change.note = raw.note;
  }

  if (errors.length === 0 && Object.keys(change).length === 0 && options.allowEmpty !== true) errors.push('nothing to change: give at least one of percent, hide, url, expires or note');
  return errors.length > 0 ? { ok: false, errors } : { ok: true, change };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates the export file (`docs/data/overrides.json`). Throws one Error that names every problem. */
export function parseOverridesFile(value: unknown): OverrideRow[] {
  if (!Array.isArray(value)) throw new Error('Overrides file: it must hold a list');
  const problems: string[] = [];
  if (value.length > MAX_ROWS) problems.push(`more than ${MAX_ROWS} overrides`);
  const rows: OverrideRow[] = [];
  const seen = new Set<string>();
  value.slice(0, MAX_ROWS).forEach((entry: unknown, index) => {
    const where = `overrides[${index}]`;
    if (!isObject(entry)) {
      problems.push(`${where} must be an object`);
      return;
    }
    const { slug, discountPercent, hide, saleUrl, expiresAt, note, createdAt } = entry;
    const before = problems.length;
    if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug) || slug.length > 100) problems.push(`${where}: invalid slug`);
    else if (seen.has(slug)) problems.push(`${where} (${slug}): duplicate slug`);
    else seen.add(slug);
    const name = typeof slug === 'string' ? `${where} (${slug})` : where;
    if (discountPercent !== null && !(typeof discountPercent === 'number' && Number.isInteger(discountPercent) && discountPercent >= MIN_PERCENT && discountPercent <= MAX_PERCENT)) {
      problems.push(`${name}: discountPercent must be a whole number from ${MIN_PERCENT} to ${MAX_PERCENT}, or null`);
    }
    if (typeof hide !== 'boolean') problems.push(`${name}: hide must be true or false`);
    if (saleUrl !== null && !(typeof saleUrl === 'string' && isSafeFetchUrl(saleUrl))) problems.push(`${name}: saleUrl must be a safe https address, or null`);
    if (expiresAt !== null && !(typeof expiresAt === 'string' && isRealDateTime(expiresAt))) problems.push(`${name}: expiresAt must be YYYY-MM-DDTHH:MM:SSZ, or null`);
    if (typeof note !== 'string' || note.length > MAX_NOTE_LENGTH || hasControlCharacter(note)) problems.push(`${name}: note must be text of at most ${MAX_NOTE_LENGTH} characters without control characters`);
    if (typeof createdAt !== 'string' || !isRealDateTime(createdAt)) problems.push(`${name}: createdAt must be YYYY-MM-DDTHH:MM:SSZ`);
    if (problems.length === before) {
      rows.push({
        slug: slug as string,
        discountPercent: discountPercent as number | null,
        hide: hide as boolean,
        saleUrl: saleUrl as string | null,
        expiresAt: expiresAt as string | null,
        note: note as string,
        createdAt: createdAt as string,
      });
    }
  });
  if (problems.length > 0) throw new Error(`Overrides file: ${problems.join('; ')}`);
  return rows;
}
