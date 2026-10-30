// D1 queries for the web app. SQL lives here and nowhere else in `apps/web`.
// Functions take the database as a parameter (the page reads `env.DB`), so tests can pass a stub.

import { resolveStore } from '@saleaway/core';
import type { StoreInput } from '@saleaway/core';

type Database = Pick<D1Database, 'prepare'>;

export interface StoreLink {
  slug: string;
  name: string;
  saleUrl: string;
  /** The percentage to show, or null for "On sale" (shown by Story 2.1, not yet). */
  discountPercent: number | null;
}

// One query for the whole page (one round trip). Stores the operator has hidden (`is_visible = 0`) are not
// read at all; every other rule (ended, stale, an override that hides, the https URL rule) is applied by
// `resolveStore` in `packages/core`, so the rules live in one place (Story 2.3). Ordered by category and
// then store rank; ranking by discount is Stories 2.1 and 2.2.
const STORES_SQL = `SELECT r.slug, r.name, r.sale_url, r.created_at,
       s.state AS record_state, s.discount_percent AS record_percent, s.last_validated_at,
       o.discount_percent AS override_percent, o.hide AS override_hide, o.sale_url AS override_url,
       o.expires_at AS override_expires_at, o.created_at AS override_created_at
FROM retailers r
JOIN categories c ON c.id = r.category_id
LEFT JOIN sale_records s ON s.retailer_id = r.id
LEFT JOIN overrides o ON o.retailer_id = r.id
WHERE r.is_visible = 1
ORDER BY c.sort_order, r.rank, r.id`;

interface StoreRow {
  slug: string;
  name: string;
  sale_url: string | null;
  created_at: string;
  record_state: 'active' | 'ended' | 'unknown' | null;
  record_percent: number | null;
  last_validated_at: string | null;
  override_percent: number | null;
  override_hide: number | null;
  override_url: string | null;
  override_expires_at: string | null;
  override_created_at: string | null;
}

function toStoreInput(row: StoreRow): StoreInput {
  return {
    isVisible: true,
    saleUrl: row.sale_url,
    createdAt: row.created_at,
    record:
      row.record_state === null || row.record_state === undefined
        ? null
        : { state: row.record_state, discountPercent: row.record_percent ?? null, lastValidatedAt: row.last_validated_at ?? null },
    override:
      row.override_created_at === null || row.override_created_at === undefined
        ? null
        : {
            discountPercent: row.override_percent ?? null,
            hide: row.override_hide === 1,
            saleUrl: row.override_url ?? null,
            expiresAt: row.override_expires_at ?? null,
            createdAt: row.override_created_at,
          },
  };
}

/** The stores the page shows, in the query's order. `now` is passed in so tests can fix the time. */
export async function getVisibleStores(db: Database, now: Date = new Date()): Promise<StoreLink[]> {
  const { results } = await db.prepare(STORES_SQL).all<StoreRow>();
  return results.flatMap((row) => {
    const view = resolveStore(toStoreInput(row), now);
    // Second line of defence: only https links ever reach an href, whatever the database holds.
    if (!view.visible || typeof view.saleUrl !== 'string' || !view.saleUrl.startsWith('https://')) return [];
    return [{ slug: row.slug, name: row.name, saleUrl: view.saleUrl, discountPercent: view.discountPercent }];
  });
}
