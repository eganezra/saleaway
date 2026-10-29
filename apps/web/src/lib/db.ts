// D1 queries for the web app. SQL lives here and nowhere else in `apps/web`.
// Functions take the database as a parameter (the page reads `env.DB`), so tests can pass a stub.

type Database = Pick<D1Database, 'prepare'>;

export interface StoreLink {
  slug: string;
  name: string;
  saleUrl: string;
}

// One query for the whole page. Visible stores with an https sale URL, in category order and then
// store rank. Nothing here reads sale_records or overrides yet (Story 2.3 adds those rules).
const VISIBLE_STORES_SQL = `SELECT r.slug, r.name, r.sale_url
FROM retailers r
JOIN categories c ON c.id = r.category_id
WHERE r.is_visible = 1 AND r.sale_url LIKE 'https://%'
ORDER BY c.sort_order, r.rank, r.id`;

interface VisibleStoreRow {
  slug: string;
  name: string;
  sale_url: string | null;
}

export async function getVisibleStores(db: Database): Promise<StoreLink[]> {
  const { results } = await db.prepare(VISIBLE_STORES_SQL).all<VisibleStoreRow>();
  // Second line of defence: only https links ever reach an href, whatever the database holds.
  return results.flatMap((row) =>
    typeof row.sale_url === 'string' && row.sale_url.startsWith('https://')
      ? [{ slug: row.slug, name: row.name, saleUrl: row.sale_url }]
      : [],
  );
}
