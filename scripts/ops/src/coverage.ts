import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHiddenStores } from '@saleaway/core';
import { parseCoverageArgs } from './args';
import type { SeedTarget } from './args';
import { buildCoverage, renderMarkdown, resolveCoverageOut, storeFromRow } from './coverage-plan';
import type { CoverageRun, StoreRow } from './coverage-plan';
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

const RUN_SQL = (run: number | null): string =>
  'SELECT p.id, p.trigger, p.started_at, p.finished_at, p.stores_total, ' +
  '(SELECT COUNT(*) FROM run_results r WHERE r.run_id = p.id) AS result_count, ' +
  '(SELECT MIN(created_at) FROM run_results r WHERE r.run_id = p.id) AS first_result_at, ' +
  '(SELECT MAX(created_at) FROM run_results r WHERE r.run_id = p.id) AS last_result_at ' +
  'FROM pipeline_runs p ' +
  (run === null ? 'WHERE EXISTS (SELECT 1 FROM run_results r WHERE r.run_id = p.id) ORDER BY p.id DESC LIMIT 1' : `WHERE p.id = ${run}`);

// `run` is a validated whole number. `overrides` has one row per store; whether it is still in force is decided in code.
const STORES_SQL = (run: number): string =>
  'SELECT t.slug, t.name, c.name AS category, t.extraction_method, t.is_visible, t.sale_url, ' +
  'o.retailer_id IS NOT NULL AS override_exists, o.expires_at AS override_expires_at, ' +
  'rr.result, rr.http_status, rr.error, s.state, s.validation, s.discount_percent, s.last_result, s.last_checked_at ' +
  'FROM retailers t JOIN categories c ON c.id = t.category_id ' +
  'LEFT JOIN overrides o ON o.retailer_id = t.id ' +
  `LEFT JOIN run_results rr ON rr.retailer_id = t.id AND rr.run_id = ${run} ` +
  'LEFT JOIN sale_records s ON s.retailer_id = t.id ORDER BY t.slug';

/** Everything the command touches outside itself, so a test can pass fakes. */
export interface CoverageIo {
  root: string;
  query: <T>(target: SeedTarget, sql: string) => T[] | null;
  readHiddenList: () => unknown;
  writeFile: (path: string, text: string) => void;
  print: (text: string) => void;
  now: () => Date;
}

export function runCoverage(argv: string[], io: CoverageIo): number {
  const args = parseCoverageArgs(argv);
  if (!args.ok) {
    log.error('coverage_usage', { reason: args.message });
    return 1;
  }
  const { target, run: wanted } = args;

  // Bad input stops here, before the database is asked anything.
  let out: string | null = null;
  if (args.out !== null) {
    const resolved = resolveCoverageOut(io.root, args.out);
    if (!resolved.ok) {
      log.error('coverage_usage', { reason: resolved.message });
      return 1;
    }
    out = resolved.path;
  }
  let hidden;
  try {
    hidden = parseHiddenStores(io.readHiddenList());
  } catch (error) {
    log.error('coverage_invalid', { error });
    return 1;
  }

  const runs = io.query<RunRow>(target, RUN_SQL(wanted));
  if (runs === null) {
    log.error('coverage_query_failed', { target, what: 'run' });
    return 1;
  }
  const found = runs[0];
  if (found === undefined) {
    log.error('coverage_no_run', { target, run: wanted });
    return 1;
  }
  const rows = io.query<StoreRow>(target, STORES_SQL(found.id));
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
  const now = io.now();
  const coverage = buildCoverage({
    run,
    stores: rows.map((row) => storeFromRow(row, now)),
    hidden,
    madeAt: now.toISOString().replace(/\.\d+Z$/, 'Z'),
  });
  const markdown = renderMarkdown(coverage);

  if (out === null) io.print(markdown);
  else io.writeFile(out, markdown);
  log.info('coverage_done', { target, run: run.id, visible: coverage.visible, hidden: coverage.hidden, written: out !== null, counts: coverage.counts });
  return 0;
}

// Runs only when started as the script (`pnpm ops:coverage`), not when a test imports `runCoverage`.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runCoverage(process.argv.slice(2), {
    root: repoRoot,
    query: queryRows,
    readHiddenList: () => JSON.parse(readFileSync(join(repoRoot, 'docs/data/hidden-stores.json'), 'utf-8')),
    writeFile: (path, text) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text, 'utf-8');
    },
    print: (text) => process.stdout.write(text),
    now: () => new Date(),
  });
}
