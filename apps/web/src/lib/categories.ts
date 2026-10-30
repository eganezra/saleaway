// The page's sections (Story 2.2): the visible stores grouped by category, each category ordered by FR14.
// Pure: no I/O, the caller passes `now`. A category with no visible store is never in the result.

import { rankStores } from '@saleaway/core';
import type { StoreLink } from './db';
import { toRowData } from './storeRow';
import type { StoreRowData } from './storeRow';

/** The card shows this many rows, then "Show all N" (cards with fewer never show the control). */
export const ROWS_SHOWN = 8;

/** The colour token becomes a CSS class name, so only the plain form is let through (a seeded value always is). */
const TOKEN_PATTERN = /^[a-z0-9-]+$/;
const DEFAULT_TOKEN = 'cat-default';

/** A row and its place in its card (1, 2, 3 ...), which is not `retailers.rank`. */
export type PositionedRow = StoreRowData & { position: number };

export interface CategoryData {
  slug: string;
  name: string;
  tagline: string;
  colorToken: string;
  /** How many stores it has (every visible store is on sale). */
  count: number;
  /** All the rows, in FR14 order; the card cuts them at `ROWS_SHOWN`. */
  rows: PositionedRow[];
}

/**
 * Groups the stores by category, in the order the categories first appear (the query is ordered by `sort_order`), and
 * orders each category: the biggest percentage the row shows first, then "On sale" by store rank, ties by rank.
 * A store whose figure the row cannot show ranks as "On sale", because it is drawn as "On sale".
 */
export function buildCategories(stores: readonly StoreLink[], now: Date): CategoryData[] {
  const groups = new Map<string, { category: StoreLink['category']; items: Array<{ row: StoreRowData; percent: number | null; rank: number }> }>();
  for (const store of stores) {
    let group = groups.get(store.category.slug);
    if (group === undefined) {
      group = { category: store.category, items: [] };
      groups.set(store.category.slug, group);
    }
    const row = toRowData(store, now);
    group.items.push({ row, percent: row.percent, rank: store.rank });
  }
  return [...groups.values()].map(({ category, items }) => {
    const rows = rankStores(items).map(({ row }, index): PositionedRow => ({ ...row, position: index + 1 }));
    return { slug: category.slug, name: category.name, tagline: category.tagline, colorToken: TOKEN_PATTERN.test(category.colorToken) ? category.colorToken : DEFAULT_TOKEN, count: rows.length, rows };
  });
}
