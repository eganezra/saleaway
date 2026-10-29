import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSeed, parseSeedTsv } from '@saleaway/core';
import type { SeedCategory } from '@saleaway/core';
import { parseSeedArgs } from './args';
import type { SeedTarget } from './args';
import { log } from './log';
import { buildSeedSql } from './sql';

// `pnpm ops:seed --local | --remote`: loads docs/data/retailers-seed.tsv and db/seed/categories.json
// into the saleaway D1 database. Safe to run again (see buildSeedSql). Needs `wrangler login` for --remote.

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const DATABASE = 'saleaway';

/** Runs Wrangler from the web app's folder, so the local database is the copy `pnpm dev` reads. */
function wrangler(args: string[], capture: boolean) {
  return spawnSync(
    'pnpm',
    ['--filter', '@saleaway/web', 'exec', 'wrangler', 'd1', 'execute', DATABASE, ...args],
    { cwd: repoRoot, encoding: 'utf-8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' },
  );
}

function databaseCounts(target: SeedTarget): Record<string, number> | null {
  const sql =
    'SELECT (SELECT COUNT(*) FROM categories) AS categories, (SELECT COUNT(*) FROM retailers) AS retailers, ' +
    '(SELECT COUNT(*) FROM retailers WHERE is_visible = 1) AS visible, ' +
    '(SELECT COUNT(*) FROM retailers WHERE is_visible = 0) AS hidden';
  const result = wrangler(['--command', sql, '--json', `--${target}`], true);
  if (result.status !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout) as Array<{ results: Array<Record<string, number>> }>;
    return parsed[0]?.results[0] ?? null;
  } catch {
    return null;
  }
}

function main(argv: string[]): number {
  const args = parseSeedArgs(argv);
  if (!args.ok) {
    log.error('seed_usage', { message: args.message });
    return 1;
  }
  const { target } = args;

  const tsv = readFileSync(join(repoRoot, 'docs/data/retailers-seed.tsv'), 'utf-8');
  const categories = JSON.parse(readFileSync(join(repoRoot, 'db/seed/categories.json'), 'utf-8')) as SeedCategory[];
  const seed = buildSeed(parseSeedTsv(tsv), categories);
  const sql = buildSeedSql(seed);

  const visible = seed.retailers.filter((r) => r.isVisible).length;
  log.info('seed_start', {
    target,
    categories: seed.categories.length,
    retailers: seed.retailers.length,
    visible,
    hidden: seed.retailers.length - visible,
  });

  // The SQL file lives outside the repository and is deleted afterwards.
  const directory = mkdtempSync(join(tmpdir(), 'saleaway-seed-'));
  try {
    const file = join(directory, 'seed.sql');
    writeFileSync(file, sql, 'utf-8');
    // No --yes for --remote: in a terminal Wrangler asks before it writes to the live database.
    const result = wrangler(['--file', file, `--${target}`], false);
    if (result.status !== 0) {
      log.error('seed_failed', { target, status: result.status });
      return result.status ?? 1;
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }

  log.info('seed_done', { target, database: databaseCounts(target) });
  return 0;
}

process.exitCode = main(process.argv.slice(2));
