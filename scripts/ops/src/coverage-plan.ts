import { isAbsolute, relative, resolve } from 'node:path';
import { isOverrideActive } from '@saleaway/core';

// The coverage report of a pipeline run (Story 3.6). Pure: no I/O, no clock. The command reads the rows, this turns them into
// the buckets and the Markdown. A store's record is the latest night's (`sale_records` is rewritten by every run), so the
// report says which night its records are from and warns when they are newer than the run it describes.

export type Bucket = 'percentage' | 'on_sale_only' | 'ended' | 'blocked' | 'not_found' | 'redirected_away' | 'error' | 'never_checked' | 'manual';

/** The order of the buckets in every table. */
export const BUCKETS: readonly Bucket[] = ['percentage', 'on_sale_only', 'ended', 'blocked', 'not_found', 'redirected_away', 'error', 'never_checked', 'manual'];

const BUCKET_LABEL: Record<Bucket, string> = {
  percentage: 'With a percentage',
  on_sale_only: '"On sale" only (no percentage)',
  ended: 'Judged ended',
  blocked: 'Blocked',
  not_found: 'Not found',
  redirected_away: 'Redirected away',
  error: 'Errors',
  never_checked: 'Never checked successfully',
  manual: 'Manual (never fetched)',
};

export interface CoverageRun {
  id: number;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  storesTotal: number;
  /** Results saved for the run, and when the first and the last was saved (null when there are none). */
  resultCount: number;
  firstResultAt: string | null;
  lastResultAt: string | null;
}

export interface CoverageStore {
  slug: string;
  name: string;
  category: string;
  extractionMethod: string;
  isVisible: boolean;
  /** The store has no sale address at all. */
  noSaleUrl: boolean;
  /** An override is in force now. */
  hasOverride: boolean;
  /** The run's result for the store, or null when it has none. */
  result: string | null;
  httpStatus: number | null;
  error: string | null;
  /** The store's sale record as it is now (null when it has none). */
  state: 'active' | 'ended' | 'unknown' | null;
  validation: 'content_verified' | 'url_verified' | 'none' | null;
  recordPercent: number | null;
  recordLastResult: string | null;
  lastCheckedAt: string | null;
}

/** One row of the stores query, as the database returns it. */
export interface StoreRow {
  slug: string;
  name: string;
  category: string;
  extraction_method: string;
  is_visible: number;
  sale_url: string | null;
  override_exists: number;
  override_expires_at: string | null;
  result: string | null;
  http_status: number | null;
  error: string | null;
  state: 'active' | 'ended' | 'unknown' | null;
  validation: 'content_verified' | 'url_verified' | 'none' | null;
  discount_percent: number | null;
  last_result: string | null;
  last_checked_at: string | null;
}

/**
 * The store as the report sees it. An override counts only while the site would use it: the same rule as the site and `ops:override`
 * (`isOverrideActive`, so an expiry date is the start of that day in UTC), not a comparison of text in the query.
 */
export function storeFromRow(row: StoreRow, now: Date): CoverageStore {
  return {
    slug: row.slug,
    name: row.name,
    category: row.category,
    extractionMethod: row.extraction_method,
    isVisible: row.is_visible === 1,
    noSaleUrl: row.sale_url === null,
    hasOverride:
      row.override_exists === 1 &&
      isOverrideActive({ discountPercent: null, hide: false, saleUrl: null, expiresAt: row.override_expires_at, createdAt: '' }, now),
    result: row.result,
    httpStatus: row.http_status,
    error: row.error,
    state: row.state,
    validation: row.validation,
    recordPercent: row.discount_percent,
    recordLastResult: row.last_result,
    lastCheckedAt: row.last_checked_at,
  };
}

export interface HiddenList {
  reasons: Record<string, string>;
  stores: Array<{ slug: string; reason: string }>;
}

export interface NeedsHandling {
  slug: string;
  name: string;
  bucket: Bucket;
  reason: string;
}

export interface NoPercentage {
  slug: string;
  name: string;
  method: string;
  how: string;
}

export interface HiddenGroup {
  reason: string;
  meaning: string;
  slugs: string[];
}

export interface Coverage {
  run: CoverageRun;
  madeAt: string;
  recordsAsOf: string | null;
  /** Some record was written after the run's last result: the state buckets show a later night. */
  recordsNewerThanRun: boolean;
  visible: number;
  hidden: number;
  counts: Record<Bucket, number>;
  /** The "On sale only" stores, split by what is known about them. */
  onSaleSplit: { contentVerifiedNoFigure: number; jsOnly: number; otherUrlVerified: number };
  needsHandling: NeedsHandling[];
  noPercentage: NoPercentage[];
  hiddenGroups: HiddenGroup[];
  durationMinutes: number | null;
}

/** The bucket of one visible store. A result of the night decides first (blocked, error ...), then the record. */
export function bucketOf(store: CoverageStore): Bucket {
  switch (store.result) {
    case 'skipped_manual':
      return 'manual';
    case 'blocked':
      return 'blocked';
    case 'not_found':
      return 'not_found';
    case 'redirected_away':
      return 'redirected_away';
    case 'error':
      return 'error';
    case null:
      return 'never_checked';
    default:
      break;
  }
  if (store.state === 'ended') return 'ended';
  if (store.state === 'active') return store.recordPercent === null ? 'on_sale_only' : 'percentage';
  return 'never_checked';
}

function needsReason(store: CoverageStore, bucket: Bucket): string | null {
  switch (bucket) {
    case 'blocked':
      return `blocked: ${store.error ?? (store.httpStatus === null ? 'no answer' : `HTTP ${store.httpStatus}`)}`;
    case 'error':
      return `error: ${store.error ?? 'unknown'}`;
    case 'not_found':
      return `page not found${store.httpStatus === null ? '' : ` (HTTP ${store.httpStatus})`}`;
    case 'redirected_away':
      return 'redirected away from the sale page';
    case 'never_checked':
      return `never checked successfully (${store.recordLastResult ?? store.result ?? 'no result'})`;
    case 'ended':
      return 'judged ended: open the page and check it by hand';
    case 'manual':
      return store.hasOverride ? null : 'manual method, no override yet';
    case 'on_sale_only':
      return store.validation === 'content_verified' ? `valid page, no figure found (method ${store.extractionMethod})` : null;
    case 'percentage':
      return null;
  }
}

function hiddenReason(store: CoverageStore, list: HiddenList): string {
  const entry = list.stores.find((item) => item.slug === store.slug);
  if (entry !== undefined) return entry.reason;
  return store.noSaleUrl ? 'no_sale_page' : 'hidden_other';
}

const EXTRA_REASONS: Record<string, string> = {
  no_sale_page: 'The store has no sale address (nothing to fetch).',
  hidden_other: 'Hidden, and not on the hidden list: check it.',
};

function minutesBetween(from: string, to: string | null): number | null {
  if (to === null) return null;
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isNaN(ms) || ms < 0 ? null : Math.round(ms / 60_000);
}

export function buildCoverage(input: { run: CoverageRun; stores: readonly CoverageStore[]; hidden: HiddenList; madeAt: string }): Coverage {
  const { run, stores, hidden, madeAt } = input;
  const counts = Object.fromEntries(BUCKETS.map((bucket) => [bucket, 0])) as Record<Bucket, number>;
  const onSaleSplit = { contentVerifiedNoFigure: 0, jsOnly: 0, otherUrlVerified: 0 };
  const needsHandling: NeedsHandling[] = [];
  const noPercentage: NoPercentage[] = [];
  const hiddenBySlug = new Map<string, string[]>();
  let visible = 0;
  let hiddenCount = 0;

  for (const store of stores) {
    if (!store.isVisible) {
      hiddenCount += 1;
      const reason = hiddenReason(store, hidden);
      hiddenBySlug.set(reason, [...(hiddenBySlug.get(reason) ?? []), store.slug]);
      continue;
    }
    visible += 1;
    const bucket = bucketOf(store);
    counts[bucket] += 1;
    if (bucket === 'on_sale_only') {
      const how = store.validation === 'content_verified' ? 'valid page, no figure' : store.result === 'js_only' ? 'JavaScript page, address only' : 'page could not be judged, address only';
      if (store.validation === 'content_verified') onSaleSplit.contentVerifiedNoFigure += 1;
      else if (store.result === 'js_only') onSaleSplit.jsOnly += 1;
      else onSaleSplit.otherUrlVerified += 1;
      noPercentage.push({ slug: store.slug, name: store.name, method: store.extractionMethod, how });
    }
    const reason = needsReason(store, bucket);
    if (reason !== null) needsHandling.push({ slug: store.slug, name: store.name, bucket, reason });
  }

  needsHandling.sort((a, b) => BUCKETS.indexOf(a.bucket) - BUCKETS.indexOf(b.bucket) || a.slug.localeCompare(b.slug));
  noPercentage.sort((a, b) => a.slug.localeCompare(b.slug));
  const hiddenGroups = [...hiddenBySlug.entries()]
    .map(([reason, slugs]) => ({ reason, meaning: hidden.reasons[reason] ?? EXTRA_REASONS[reason] ?? '', slugs: [...slugs].sort() }))
    .sort((a, b) => b.slugs.length - a.slugs.length || a.reason.localeCompare(b.reason));

  const checked = stores.map((store) => store.lastCheckedAt).filter((time): time is string => time !== null);
  const recordsAsOf = checked.length === 0 ? null : checked.reduce((latest, time) => (time > latest ? time : latest));
  const recordsNewerThanRun = recordsAsOf !== null && run.lastResultAt !== null && recordsAsOf > run.lastResultAt;

  return {
    run,
    madeAt,
    recordsAsOf,
    recordsNewerThanRun,
    visible,
    hidden: hiddenCount,
    counts,
    onSaleSplit,
    needsHandling,
    noPercentage,
    hiddenGroups,
    durationMinutes: minutesBetween(run.startedAt, run.lastResultAt),
  };
}

/** Text that is safe inside a Markdown table cell: no pipe, no angle bracket, no backtick, no line break. */
export function cell(text: string): string {
  return text.replace(/\|/g, '/').replace(/</g, '(').replace(/>/g, ')').replace(/`/g, "'").replace(/[\r\n]+/g, ' ').trim();
}

const utc = (time: string | null): string => (time === null ? 'none' : `${time.replace('T', ' ').replace('Z', '')} UTC`);

function table(header: string[], rows: string[][]): string {
  const line = (cols: string[]): string => `| ${cols.join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
}

/** The report as Markdown: the six parts, in order. Only slugs, names, numbers and short reason words. */
export function renderMarkdown(coverage: Coverage): string {
  const { run } = coverage;
  const parts: string[] = [];

  const duration = coverage.durationMinutes === null ? '' : `, about ${coverage.durationMinutes} minutes from the start`;
  parts.push(
    `# Coverage report: run ${run.id}\n\n` +
      `Run ${run.id} (${cell(run.trigger)}) started ${utc(run.startedAt)}; its last result was saved ${utc(run.lastResultAt)}${duration}; ` +
      `${run.resultCount} of ${run.storesTotal} stores have a result. Made ${utc(coverage.madeAt)} by \`pnpm ops:coverage\`.\n\n` +
      `Sale records as of ${utc(coverage.recordsAsOf)}.` +
      (coverage.recordsNewerThanRun ? '\n\n> **Warning:** these records were written after this run, so the state buckets below show a later night, not the night of the run.' : ''),
  );

  const summaryRows = BUCKETS.map((bucket) => [BUCKET_LABEL[bucket], String(coverage.counts[bucket])]);
  const split = coverage.onSaleSplit;
  summaryRows.splice(2, 0, [
    '&nbsp;&nbsp;of which: valid page with no figure / JavaScript page / page could not be judged',
    `${split.contentVerifiedNoFigure} / ${split.jsOnly} / ${split.otherUrlVerified}`,
  ]);
  summaryRows.push(['**Visible stores**', `**${coverage.visible}**`], ['Hidden stores', String(coverage.hidden)]);
  parts.push(`## Summary\n\n${table(['What', 'Stores'], summaryRows)}`);

  parts.push(
    `## Stores that need manual handling\n\n` +
      (coverage.needsHandling.length === 0
        ? 'None.'
        : table(['Store', 'Group', 'Reason'], coverage.needsHandling.map((item) => [`${cell(item.name)} (${item.slug})`, BUCKET_LABEL[item.bucket], cell(item.reason)]))),
  );

  parts.push(
    `## Stores shown as "On sale" with no percentage\n\n` +
      (coverage.noPercentage.length === 0 ? 'None.' : table(['Store', 'Method', 'Why no figure'], coverage.noPercentage.map((item) => [`${cell(item.name)} (${item.slug})`, item.method, item.how]))),
  );

  parts.push(
    `## Hidden stores\n\n` +
      (coverage.hiddenGroups.length === 0
        ? 'None.'
        : coverage.hiddenGroups
            .map((group) => `### ${cell(group.reason)} (${group.slugs.length})\n\n${cell(group.meaning)}\n\n${group.slugs.map((slug) => `\`${slug}\``).join(', ')}`)
            .join('\n\n')),
  );

  parts.push('Made by `pnpm ops:coverage`; it reads the database only.');
  return `${parts.join('\n\n')}\n`;
}

/**
 * Where a report may be written: a `.md` file inside `docs/data/` of the repository, worked out from the repository root, so
 * `docs/data/../README.md`, an absolute path and a path through a parent folder are refused.
 */
export function resolveCoverageOut(root: string, out: string): { ok: true; path: string } | { ok: false; message: string } {
  if (out.trim() === '') return { ok: false, message: '--out needs a file name.' };
  if (isAbsolute(out)) return { ok: false, message: `--out must be a path inside docs/data/, not an absolute one: ${out}` };
  if (!out.endsWith('.md')) return { ok: false, message: `--out must end in .md: ${out}` };
  const path = resolve(root, out);
  const inside = relative(resolve(root, 'docs/data'), path);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return { ok: false, message: `--out must be inside docs/data/: ${out}` };
  return { ok: true, path };
}
