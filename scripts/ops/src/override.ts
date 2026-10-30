import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseOverrideChange, parseOverridesFile, toIsoUtc } from '@saleaway/core';
import type { OverrideChange, OverrideRow } from '@saleaway/core';
import { parseOverrideArgs } from './args';
import type { OverrideOptions, SeedTarget } from './args';
import { log } from './log';
import { canBringBack, differences, mergeOverride, overrideStatus, removeFromHiddenList } from './override-plan';
import type { OverrideState } from './override-plan';
import { buildBringBackSql, buildClearOverrideSql, buildImportSql, buildOverrideSql, sqlInt, sqlString } from './sql';
import { queryRows, repoRoot, runSql } from './wrangler';

// `pnpm ops:override --local | --remote ...`: the operator's override command (Story 4.1). See README, "Overrides".
// It checks everything before it writes, writes through Wrangler, then reads the database back to be sure.

const CLOCK_TOLERANCE_MS = 2 * 60 * 1000;
const OVERRIDES_FILE = 'docs/data/overrides.json';
const HIDDEN_FILE = 'docs/data/hidden-stores.json';

interface StoreRow {
  id: number;
  slug: string;
  sale_url: string | null;
  extraction_method: string;
  is_visible: number;
}
interface OverrideDbRow {
  discount_percent: number | null;
  hide: number;
  sale_url: string | null;
  expires_at: string | null;
  note: string;
  created_at: string;
}
interface JoinedRow extends OverrideDbRow {
  slug: string;
}

const toState = (row: OverrideDbRow): OverrideState => ({
  discountPercent: row.discount_percent,
  hide: row.hide === 1,
  saleUrl: row.sale_url,
  expiresAt: row.expires_at,
  note: row.note,
});

const OVERRIDE_COLUMNS = 'discount_percent, hide, sale_url, expires_at, note, created_at';

function findStore(target: SeedTarget, slug: string): StoreRow | null | 'unreadable' {
  const rows = queryRows<StoreRow>(target, `SELECT id, slug, sale_url, extraction_method, is_visible FROM retailers WHERE slug = ${sqlString(slug)}`);
  if (rows === null) return 'unreadable';
  return rows[0] ?? null;
}

function readOverride(target: SeedTarget, id: number): OverrideDbRow | null | 'unreadable' {
  const rows = queryRows<OverrideDbRow>(target, `SELECT ${OVERRIDE_COLUMNS} FROM overrides WHERE retailer_id = ${sqlInt(id)}`);
  if (rows === null) return 'unreadable';
  return rows[0] ?? null;
}

function readAll(target: SeedTarget): OverrideRow[] | null {
  const rows = queryRows<JoinedRow & { retailer_id: number }>(
    target,
    `SELECT r.slug AS slug, o.discount_percent, o.hide, o.sale_url, o.expires_at, o.note, o.created_at FROM overrides o JOIN retailers r ON r.id = o.retailer_id ORDER BY r.slug`,
  );
  if (rows === null) return null;
  return rows.map((r) => ({
    slug: r.slug,
    discountPercent: r.discount_percent,
    hide: r.hide === 1,
    saleUrl: r.sale_url,
    expiresAt: r.expires_at,
    note: r.note,
    createdAt: r.created_at,
  }));
}

function change(options: OverrideOptions, today: string): number {
  const parsed = parseOverrideChange(options.raw, today, { allowEmpty: options.bringBack });
  if (!parsed.ok) {
    log.error('override_invalid', { errors: parsed.errors });
    return 1;
  }
  const requested: OverrideChange = parsed.change;
  const slug = options.slug as string;
  const store = findStore(options.target, slug);
  if (store === 'unreadable') return fail('override_unreadable', { slug });
  if (store === null) return fail('override_unknown_store', { slug });

  if (options.bringBack) {
    const check = canBringBack(store.sale_url, requested);
    if (!check.ok) return fail('override_cannot_bring_back', { slug, reason: check.message });
  }
  const previous = readOverride(options.target, store.id);
  if (previous === 'unreadable') return fail('override_unreadable', { slug });

  const effective: OverrideChange = options.bringBack ? { ...requested, hide: false } : requested;
  const expected = mergeOverride(previous === null ? null : toState(previous), effective);
  if (expected.expiresAt === null && (options.bringBack || expected.discountPercent !== null)) {
    log.warn('override_no_expiry', { slug, advice: 'it applies until it is cleared: give --expires, a month at most' });
  }

  const started = toIsoUtc(new Date());
  log.info('override_start', { target: options.target, slug, mode: options.bringBack ? 'bring_back' : 'change' });
  const sql = options.bringBack ? buildBringBackSql(store.id, effective) : buildOverrideSql(store.id, effective);
  const status = runSql(options.target, sql);
  if (status !== 0) return fail('override_failed', { target: options.target, status });

  const after = readOverride(options.target, store.id);
  const problems = after === 'unreadable' ? ['could not read the override back'] : differences(after === null ? null : toState(after), expected);
  // The database sets `created_at` with its own clock: allow two minutes between it and this computer's clock.
  if (after !== 'unreadable' && after !== null && Date.parse(after.created_at) < Date.parse(started) - CLOCK_TOLERANCE_MS) problems.push(`created_at was not renewed (${after.created_at})`);
  if (options.bringBack) {
    const storeAfter = findStore(options.target, slug);
    if (storeAfter === 'unreadable' || storeAfter === null || storeAfter.extraction_method !== 'manual' || storeAfter.is_visible !== 1) {
      problems.push('the store is not manual and visible');
    }
  }
  if (problems.length > 0) return fail('override_not_applied', { target: options.target, slug, problems });

  let listNote: string | undefined;
  if (options.bringBack && options.target === 'remote') listNote = updateHiddenList(slug);
  // The note is not logged: it is free text.
  log.info('override_done', { target: options.target, slug, ...expected, note: undefined, ...(listNote ? { list: listNote } : {}) });
  return 0;
}

/** Takes a brought-back store off the hidden list file (live runs only). Returns a short message for the log. */
function updateHiddenList(slug: string): string {
  const path = join(repoRoot, HIDDEN_FILE);
  try {
    const result = removeFromHiddenList(readFileSync(path, 'utf-8'), slug);
    if (result.refused === 'last_entry') {
      log.warn('hidden_list_last_entry', { slug, advice: `${HIDDEN_FILE} would be left empty: delete the file or the entry by hand` });
      return 'last entry left in place';
    }
    if (!result.removed) return 'not on the list';
    writeFileSync(path, result.text, 'utf-8');
    return `removed from ${HIDDEN_FILE}: commit it`;
  } catch (error) {
    log.warn('hidden_list_not_updated', { slug, error });
    return 'list not updated: edit it by hand';
  }
}

function clear(options: OverrideOptions): number {
  const slug = options.slug as string;
  const store = findStore(options.target, slug);
  if (store === 'unreadable') return fail('override_unreadable', { slug });
  if (store === null) return fail('override_unknown_store', { slug });
  const before = readOverride(options.target, store.id);
  if (before === 'unreadable') return fail('override_unreadable', { slug });
  if (before === null) {
    log.info('override_none', { target: options.target, slug });
    return 0;
  }
  const status = runSql(options.target, buildClearOverrideSql(store.id));
  if (status !== 0) return fail('override_failed', { target: options.target, status });
  const after = readOverride(options.target, store.id);
  if (after !== null) return fail('override_not_applied', { target: options.target, slug, problems: ['the override is still there'] });
  log.info('override_done', { target: options.target, slug, cleared: true });
  return 0;
}

function list(options: OverrideOptions): number {
  const rows = readAll(options.target);
  if (rows === null) return fail('override_unreadable', {});
  const now = new Date();
  for (const row of rows) {
    log.info('override_listed', { slug: row.slug, status: overrideStatus(row.expiresAt, now), discountPercent: row.discountPercent, hide: row.hide, saleUrl: row.saleUrl, expiresAt: row.expiresAt, createdAt: row.createdAt });
  }
  log.info('override_list_done', { target: options.target, count: rows.length });
  return 0;
}

function exportFile(options: OverrideOptions): number {
  const rows = readAll(options.target);
  if (rows === null) return fail('override_unreadable', {});
  try {
    parseOverridesFile(rows);
  } catch (error) {
    return fail('override_export_invalid', { error });
  }
  writeFileSync(join(repoRoot, OVERRIDES_FILE), `${JSON.stringify(rows, null, 2)}\n`, 'utf-8');
  log.info('override_export_done', { target: options.target, file: OVERRIDES_FILE, count: rows.length });
  return 0;
}

function importFile(options: OverrideOptions): number {
  let rows: OverrideRow[];
  try {
    rows = parseOverridesFile(JSON.parse(readFileSync(join(repoRoot, OVERRIDES_FILE), 'utf-8')));
  } catch (error) {
    return fail('override_import_invalid', { file: OVERRIDES_FILE, error });
  }
  if (rows.length === 0) {
    log.info('override_import_done', { target: options.target, count: 0 });
    return 0;
  }
  const slugs = rows.map((r) => sqlString(r.slug)).join(', ');
  const stores = queryRows<{ id: number; slug: string }>(options.target, `SELECT id, slug FROM retailers WHERE slug IN (${slugs})`);
  if (stores === null) return fail('override_unreadable', {});
  const ids = new Map(stores.map((s) => [s.slug, s.id]));
  const missing = rows.filter((r) => !ids.has(r.slug)).map((r) => r.slug);
  if (missing.length > 0) return fail('override_unknown_store', { slugs: missing });

  const status = runSql(options.target, buildImportSql(rows.map((r) => ({ ...r, id: ids.get(r.slug) as number }))));
  if (status !== 0) return fail('override_failed', { target: options.target, status });

  const after = readAll(options.target);
  const wrong = after === null ? ['could not read the overrides back'] : rows.filter((r) => JSON.stringify(after.find((a) => a.slug === r.slug)) !== JSON.stringify(r)).map((r) => `${r.slug} differs`);
  if (wrong.length > 0) return fail('override_not_applied', { target: options.target, problems: wrong });
  log.info('override_import_done', { target: options.target, count: rows.length });
  return 0;
}

function fail(message: string, fields: Record<string, unknown>): number {
  log.error(message, fields);
  return 1;
}

function main(argv: string[]): number {
  const args = parseOverrideArgs(argv);
  if (!args.ok) {
    log.error('override_usage', { reason: args.message });
    return 1;
  }
  try {
    return run(args);
  } catch (error) {
    // Anything unexpected (for example a value the SQL builder refuses) ends with a log line and exit 1, not a stack trace.
    log.error('override_crashed', { error });
    return 1;
  }
}

function run(args: OverrideOptions): number {
  const today = toIsoUtc(new Date()).slice(0, 10);
  switch (args.mode) {
    case 'change':
      return change(args, today);
    case 'clear':
      return clear(args);
    case 'list':
      return list(args);
    case 'export':
      return exportFile(args);
    case 'import':
      return importFile(args);
  }
}

process.exitCode = main(process.argv.slice(2));
