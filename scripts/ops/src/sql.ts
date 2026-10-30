import type { SeedData } from '@saleaway/core';

// SQL text for the seed. `wrangler d1 execute` takes plain SQL with no bound parameters, so every
// value is checked here and text has its single quotes doubled (coding standards, "Safe SQL in the
// operator CLI"). `packages/core` has already validated the values; this is the second line of defence.

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/** A SQL string literal: quotes doubled. Rejects control characters (newline, tab, null). */
export function sqlString(value: string): string {
  if (typeof value !== 'string') throw new Error('sqlString needs a string');
  if (hasControlCharacter(value)) throw new Error('A SQL text value contains a control character');
  return `'${value.replace(/'/g, "''")}'`;
}

export function sqlNullable(value: string | null): string {
  return value === null ? 'NULL' : sqlString(value);
}

/** An integer literal. Rejects floats, NaN, Infinity and anything that is not a number. */
export function sqlInt(value: number): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`A SQL integer value is not an integer: ${String(value)}`);
  }
  return String(value);
}

const UPDATED_AT_NOW = "strftime('%Y-%m-%dT%H:%M:%SZ','now')";

/**
 * The whole seed as SQL: categories first, then retailers (foreign key). Every statement is an
 * upsert on the unique slug, so running it again changes nothing that is already right.
 *
 * Seed-owned columns are updated on every run. `is_visible`, `extraction_method` and
 * `black_friday_verified` are set only when the row is first inserted, so an operator's hand
 * edits survive a re-seed. Nothing here touches `sale_records` or `overrides`.
 */
export function buildSeedSql(seed: SeedData): string {
  const statements: string[] = [];

  for (const c of seed.categories) {
    statements.push(
      `INSERT INTO categories (slug, name, tagline, sort_order, color_token)
VALUES (${sqlString(c.slug)}, ${sqlString(c.name)}, ${sqlString(c.tagline)}, ${sqlInt(c.sortOrder)}, ${sqlString(c.colorToken)})
ON CONFLICT(slug) DO UPDATE SET
  name = excluded.name, tagline = excluded.tagline,
  sort_order = excluded.sort_order, color_token = excluded.color_token;`,
    );
  }

  for (const r of seed.retailers) {
    statements.push(
      `INSERT INTO retailers (slug, name, homepage_url, category_id, rank, platform, sale_url,
                       black_friday_url, extraction_method, seed_status, is_visible)
VALUES (${sqlString(r.slug)}, ${sqlString(r.name)}, ${sqlString(r.homepageUrl)},
        (SELECT id FROM categories WHERE slug = ${sqlString(r.categorySlug)}),
        ${sqlInt(r.rank)}, ${sqlNullable(r.platform)}, ${sqlNullable(r.saleUrl)},
        ${sqlNullable(r.blackFridayUrl)}, ${sqlString(r.extractionMethod)}, ${sqlString(r.seedStatus)},
        ${sqlInt(r.isVisible ? 1 : 0)})
ON CONFLICT(slug) DO UPDATE SET
  name = excluded.name, homepage_url = excluded.homepage_url, category_id = excluded.category_id,
  rank = excluded.rank, platform = excluded.platform, sale_url = excluded.sale_url,
  black_friday_url = excluded.black_friday_url, seed_status = excluded.seed_status,
  updated_at = ${UPDATED_AT_NOW};`,
    );
  }

  return `${statements.join('\n\n')}\n`;
}

/**
 * Sets `is_visible` for the named stores (Story 3.9): one statement that changes only `is_visible` and
 * `updated_at`, and only the rows with these slugs. Running it twice gives the same result.
 */
export function buildVisibilitySql(slugs: readonly string[], visible: 0 | 1): string {
  if (slugs.length === 0) throw new Error('buildVisibilitySql needs at least one slug');
  if (visible !== 0 && visible !== 1) throw new Error('visible must be 0 or 1');
  const list = slugs.map(sqlString).join(', ');
  return `UPDATE retailers SET is_visible = ${sqlInt(visible)}, updated_at = ${UPDATED_AT_NOW} WHERE slug IN (${list});`;
}

// ---- Overrides (Story 4.1). Every value has been checked by `parseOverrideChange` or `parseOverridesFile` in core;
// `sqlString` and `sqlInt` are the second line of defence. The store is always named by its numeric id.

export interface OverrideColumns {
  percent?: number | null;
  hide?: boolean;
  saleUrl?: string | null;
  expiresAt?: string | null;
  note?: string;
}

/** The columns that were named, in a fixed order, as `[column, SQL literal]`. */
function namedColumns(change: OverrideColumns): Array<[string, string]> {
  const columns: Array<[string, string]> = [];
  if (change.percent !== undefined) columns.push(['discount_percent', change.percent === null ? 'NULL' : sqlInt(change.percent)]);
  if (change.hide !== undefined) columns.push(['hide', change.hide ? '1' : '0']);
  if (change.saleUrl !== undefined) columns.push(['sale_url', sqlNullable(change.saleUrl)]);
  if (change.expiresAt !== undefined) columns.push(['expires_at', sqlNullable(change.expiresAt)]);
  if (change.note !== undefined) columns.push(['note', sqlString(change.note)]);
  return columns;
}

/**
 * Creates the store's override, or changes **only the named columns** of the one it has, and sets `created_at` to
 * now (the time the operator last looked). Columns that are not named keep their value, or the table's default
 * on a new row. One statement.
 */
export function buildOverrideSql(retailerId: number, change: OverrideColumns): string {
  const id = sqlInt(retailerId);
  const columns = namedColumns(change);
  const names = ['retailer_id', ...columns.map(([name]) => name)].join(', ');
  const values = [id, ...columns.map(([, value]) => value)].join(', ');
  const updates = [...columns.map(([name]) => `${name} = excluded.${name}`), `created_at = ${UPDATED_AT_NOW}`].join(', ');
  return `INSERT INTO overrides (${names}) VALUES (${values}) ON CONFLICT(retailer_id) DO UPDATE SET ${updates};`;
}

/** Deletes the store's override (the pipeline never does). */
export function buildClearOverrideSql(retailerId: number): string {
  return `DELETE FROM overrides WHERE retailer_id = ${sqlInt(retailerId)};`;
}

/**
 * Brings a store back with manual values (Story 4.1, criterion 8): the override first (with the hide flag
 * cleared), then the store made `manual` and visible, so a run that stops half way never shows a store without
 * its override. Wrangler does not promise that a file runs as one transaction.
 */
export function buildBringBackSql(retailerId: number, change: OverrideColumns): string {
  const id = sqlInt(retailerId);
  return [
    buildOverrideSql(retailerId, { ...change, hide: false }),
    `UPDATE retailers SET extraction_method = 'manual', is_visible = 1, updated_at = ${UPDATED_AT_NOW} WHERE id = ${id};`,
  ].join('\n');
}

export interface ImportRow {
  id: number;
  discountPercent: number | null;
  hide: boolean;
  saleUrl: string | null;
  expiresAt: string | null;
  note: string;
  createdAt: string;
}

/** Restores overrides from the export file: every column, with the saved `created_at`. Other overrides stay. */
export function buildImportSql(rows: readonly ImportRow[]): string {
  if (rows.length === 0) throw new Error('buildImportSql needs at least one row');
  return rows
    .map((r) => {
      const values = [
        sqlInt(r.id),
        r.discountPercent === null ? 'NULL' : sqlInt(r.discountPercent),
        r.hide ? '1' : '0',
        sqlNullable(r.saleUrl),
        sqlNullable(r.expiresAt),
        sqlString(r.note),
        sqlString(r.createdAt),
      ].join(', ');
      return `INSERT INTO overrides (retailer_id, discount_percent, hide, sale_url, expires_at, note, created_at) VALUES (${values}) ON CONFLICT(retailer_id) DO UPDATE SET discount_percent = excluded.discount_percent, hide = excluded.hide, sale_url = excluded.sale_url, expires_at = excluded.expires_at, note = excluded.note, created_at = excluded.created_at;`;
    })
    .join('\n');
}
