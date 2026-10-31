import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseHiddenStores } from '@saleaway/core';
import { parseCoverageArgs } from './args';
import { buildCoverage, renderMarkdown, resolveCoverageOut } from './coverage-plan';
import type { CoverageRun, CoverageStore } from './coverage-plan';
import { log } from './log';
import { queryRows, repoRoot } from './wrangler';

// `pnpm ops:coverage --local | --remote [--run <id>] [--out docs/data/<file>.md]`: the coverage report of one pipeline run
// (Story 3.6). Only reads the database; writes a file only when --out is given and every query worked.

interface RunRow {
  id: number;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  stores_total: number;
  result_count: number;
  first_result_at: string | null;
  last_result_at: string | null;
}

interface StoreRow {
  slug: string;
  name: string;
  category: string;
  extraction_method: string;
  is_visible: number;
  sale_url: string | null;
  has_override: number;
  result: string | null;
  http_status: number | null;
  error: string | null;
  state: 'active' | 'ended' | 'unknown' | null;
  validation: 'content_verified' | 'url_verified' | 'none' | null;
  discount_percent: number | null;
  last_result: string | null;
  last_checked_at: string | null;
}

const RUN_SQL = (run: number | null): string =>
  'SELECT p.id, p.trigger, p.started_at, p.finished_at, p.stores_total, ' +
  '(SELECT COUNT(*) FROM run_results r WHERE r.run_id = p.id) AS result_count, ' +
  '(SELECT MIN(created_at) FROM run_results r WHERE r.run_id = p.id) AS first_result_at, ' +
  '(SELECT MAX(created_at) FROM run_results r WHERE r.run_id = p.id) AS last_result_at ' +
  'FROM pipeline_runs p ' +
  (run === null ? 'WHERE EXISTS (SELECT 1 FROM run_results r WHERE r.run_id = p.id) ORDER BY p.id DESC LIMIT 1' : `WHERE p.id = ${run}`);

// `run` is a validated whole number. The override counts only while it has not expired.
const STORES_SQL = (run: number): string =>
  'SELECT t.slug, t.name, c.name AS category, t.extraction_method, t.is_visible, t.sale_url, ' +
  "(SELECT COUNT(*) FROM overrides o WHERE o.retailer_id = t.id AND (o.expires_at IS NULL OR o.expires_at >= strftime('%Y-%m-%d','now'))) AS has_override, " +
  'rr.result, rr.http_status, rr.error, s.state, s.validation, s.discount_percent, s.last_result, s.last_checked_at ' +
  'FROM retailers t JOIN categories c ON c.id = t.category_id ' +
  `LEFT JOIN run_results rr ON rr.retailer_id = t.id AND rr.run_id = ${run} ` +
  'LEFT JOIN sale_records s ON s.retailer_id = t.id ORDER BY t.slug';

function toStore(row: StoreRow): CoverageStore {
  return {
    slug: row.slug,
    name: row.name,
    category: row.category,
    extractionMethod: row.extraction_method,
    isVisible: row.is_visible === 1,
    noSaleUrl: row.sale_url === null,
    hasOverride: row.has_override > 0,
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

function main(argv: string[]): number {
  const args = parseCoverageArgs(argv);
  if (!args.ok) {
    log.error('coverage_usage', { reason: args.message });
    return 1;
  }
  const { target, run: wanted } = args;

  // Bad input stops here, before the database is asked anything.
  let out: string | null = null;
  if (args.out !== null) {
    const resolved = resolveCoverageOut(repoRoot, args.out);
    if (!resolved.ok) {
      log.error('coverage_usage', { reason: resolved.message });
      return 1;
    }
    out = resolved.path;
  }
  let hidden;
  try {
    hidden = parseHiddenStores(JSON.parse(readFileSync(join(repoRoot, 'docs/data/hidden-stores.json'), 'utf-8')));
  } catch (error) {
    log.error('coverage_invalid', { error });
    return 1;
  }

  const runs = queryRows<RunRow>(target, RUN_SQL(wanted));
  const found = runs?.[0];
  if (runs === null) {
    log.error('coverage_query_failed', { target, what: 'run' });
    return 1;
  }
  if (found === undefined) {
    log.error('coverage_no_run', { target, run: wanted });
    return 1;
  }
  const rows = queryRows<StoreRow>(target, STORES_SQL(found.id));
  if (rows === null) {
    log.error('coverage_query_failed', { target, what: 'stores' });
    return 1;
  }

  const run: CoverageRun = {
    id: found.id,
    trigger: found.trigger,
    startedAt: found.started_at,
    finishedAt: found.finished_at,
    storesTotal: found.stores_total,
    resultCount: found.result_count,
    firstResultAt: found.first_result_at,
    lastResultAt: found.last_result_at,
  };
  const coverage = buildCoverage({ run, stores: rows.map(toStore), hidden, madeAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z') });
  const markdown = renderMarkdown(coverage);

  if (out === null) {
    process.stdout.write(markdown);
  } else {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, markdown, 'utf-8');
  }
  log.info('coverage_done', { target, run: run.id, visible: coverage.visible, hidden: coverage.hidden, written: out !== null, counts: coverage.counts });
  return 0;
}

process.exitCode = main(process.argv.slice(2));
