// The decisions of `ops:hide` that need no database or file, so they can be tested (Story 3.9).

export interface VisibilityCounts {
  /** How many of the selected slugs exist in the database. */
  selected: number;
  /** How many of the selected stores are visible now. */
  visibleSelected: number;
  /** How many stores are visible in all. */
  visibleTotal: number;
}

export type Selection = { ok: true; slugs: string[] } | { ok: false; message: string };

/**
 * Which stores the command acts on: the whole list, or the requested ones, which must all be on the list
 * (so the command can never hide or show a store that the decision does not name).
 */
export function selectSlugs(listed: readonly string[], requested: readonly string[]): Selection {
  const known = new Set(listed);
  const notListed = requested.filter((slug) => !known.has(slug));
  if (notListed.length > 0) {
    return { ok: false, message: `Not on the list in docs/data/hidden-stores.json: ${notListed.join(', ')}` };
  }
  return { ok: true, slugs: requested.length > 0 ? [...requested] : [...listed] };
}

/**
 * Did the change happen? Wrangler exits 0 when the operator answers "no" at its confirmation prompt, so the
 * exit code is not enough: every selected store must exist, and be hidden (0 visible) or shown (all visible).
 */
export function isApplied(after: VisibilityCounts | null, selectedCount: number, undo: boolean): boolean {
  if (after === null) return false;
  return after.selected === selectedCount && after.visibleSelected === (undo ? selectedCount : 0);
}
