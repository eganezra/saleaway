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
