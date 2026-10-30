// The order of the stores inside one category (FR14, Story 2.2). Pure: no I/O, no clock.

export interface Rankable {
  /** The percentage the row shows, or null for "On sale". */
  percent: number | null;
  /** `retailers.rank`: the lower the number, the more popular the store. */
  rank: number;
}

/** A rank that is not a real number sorts after every real one (the column is NOT NULL, so this only guards bad data). */
function rankKey(rank: number): number {
  return Number.isFinite(rank) ? rank : Number.POSITIVE_INFINITY;
}

/**
 * Biggest known discount first; stores with only "On sale" follow; within each group, and for equal percentages,
 * the lower `rank` first; stores that tie on both keep the order they came in. Returns a new array and changes
 * neither the array nor its items.
 */
export function rankStores<T extends Rankable>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const known = Number(b.item.percent !== null) - Number(a.item.percent !== null);
      if (known !== 0) return known;
      if (a.item.percent !== null && b.item.percent !== null && a.item.percent !== b.item.percent) return b.item.percent - a.item.percent;
      const rank = rankKey(a.item.rank) - rankKey(b.item.rank);
      // Infinity - Infinity is NaN: two bad ranks tie, and the input order decides.
      if (rank !== 0 && !Number.isNaN(rank)) return rank;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}
