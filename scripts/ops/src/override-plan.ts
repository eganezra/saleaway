import { isOverrideActive, parseHiddenStores } from '@saleaway/core';
import type { OverrideChange } from '@saleaway/core';

// The decisions of `ops:override` that need no database or file, so they can be tested (Story 4.1).

/** The columns of an override as the database holds them (without the creation time). */
export interface OverrideState {
  discountPercent: number | null;
  hide: boolean;
  saleUrl: string | null;
  expiresAt: string | null;
  note: string;
}

export const NEW_OVERRIDE: OverrideState = { discountPercent: null, hide: false, saleUrl: null, expiresAt: null, note: '' };

/** What the override should hold after a change: the old values, with only the named fields replaced. */
export function mergeOverride(previous: OverrideState | null, change: OverrideChange): OverrideState {
  const base = previous ?? NEW_OVERRIDE;
  return {
    discountPercent: change.percent !== undefined ? change.percent : base.discountPercent,
    hide: change.hide !== undefined ? change.hide : base.hide,
    saleUrl: change.saleUrl !== undefined ? change.saleUrl : base.saleUrl,
    expiresAt: change.expiresAt !== undefined ? change.expiresAt : base.expiresAt,
    note: change.note !== undefined ? change.note : base.note,
  };
}

/** The ways the database differs from what was meant (empty when it holds exactly that). */
export function differences(found: OverrideState | null, expected: OverrideState): string[] {
  if (found === null) return ['the override is not there'];
  const out: string[] = [];
  for (const key of ['discountPercent', 'hide', 'saleUrl', 'expiresAt', 'note'] as const) {
    if (found[key] !== expected[key]) out.push(`${key}: expected ${JSON.stringify(expected[key])}, found ${JSON.stringify(found[key])}`);
  }
  return out;
}

export type BringBackCheck = { ok: true } | { ok: false; message: string };

/**
 * A manual store is shown by its address, so a store can be brought back only if it has an https address of its
 * own, or one is given with `--url`. (`--url none` takes the override's address away, so the store's own is used.)
 */
export function canBringBack(storeSaleUrl: string | null, change: OverrideChange): BringBackCheck {
  const given = change.saleUrl;
  const address = typeof given === 'string' ? given : storeSaleUrl;
  if (typeof address === 'string' && address.startsWith('https://')) return { ok: true };
  return { ok: false, message: 'The store has no https sale address: give one with --url' };
}

export interface ListRemoval {
  text: string;
  /** The slug was on the list and has been taken off. */
  removed: boolean;
  /** Why the list was left alone although the slug is on it. */
  refused: 'last_entry' | null;
}

/**
 * Takes a store off the hidden-stores list text, in the same format (two-space indentation, a final newline), and
 * checks that what is left is still a valid list. `parseHiddenStores` refuses an empty list, so the last entry is
 * left in place and the operator is told to delete it by hand.
 */
export function removeFromHiddenList(text: string, slug: string): ListRemoval {
  const data = JSON.parse(text) as { stores?: Array<{ slug: string }> };
  const stores = data.stores ?? [];
  if (!stores.some((store) => store.slug === slug)) return { text, removed: false, refused: null };
  if (stores.length === 1) return { text, removed: false, refused: 'last_entry' };
  const next = { ...data, stores: stores.filter((store) => store.slug !== slug) };
  const out = `${JSON.stringify(next, null, 2)}\n`;
  parseHiddenStores(JSON.parse(out)); // throws if what is left is not a valid list
  return { text: out, removed: true, refused: null };
}

/** `active` or `expired`, decided with the same rule as the site. */
export function overrideStatus(expiresAt: string | null, now: Date): 'active' | 'expired' {
  return isOverrideActive({ discountPercent: null, hide: false, saleUrl: null, expiresAt, createdAt: '' }, now) ? 'active' : 'expired';
}
