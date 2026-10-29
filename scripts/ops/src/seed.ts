import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSeed, parseSeedTsv } from '@saleaway/core';
import type { SeedCategory, SeedData } from '@saleaway/core';
import { parseSeedArgs } from './args';
import type { SeedTarget } from './args';
import { log } from './log';
import { buildSeedSql, sqlString } from './sql';

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

interface SeededCounts {
  categories: number;
  retailers: number;
  visible: number;
  hidden: number;
}

/**
 * Asks the database how many of the seeded rows it holds. Wrangler exits 0 when the operator
 * answers "no" at its confirmation prompt, so the exit code alone cannot tell us the seed ran.
 * Slugs were validated by `buildSeed` and are quoted by `sqlString`.
 */
function seededCounts(target: SeedTarget, seed: SeedData): SeededCounts | null {
  const list = (slugs: string[]) => slugs.map(sqlString).join(', ');
  const sql =
    `SELECT (SELECT COUNT(*) FROM categories WHERE slug IN (${list(seed.categories.map((c) => c.slug))})) AS categories, ` +
    `(SELECT COUNT(*) FROM retailers WHERE slug IN (${list(seed.retailers.map((r) => r.slug))})) AS retailers, ` +
    '(SELECT COUNT(*) FROM retailers WHERE is_visible = 1) AS visible, ' +
    '(SELECT COUNT(*) FROM retailers WHERE is_visible = 0) AS hidden';
  const result = wrangler(['--command', sql, '--json', `--${target}`], true);
  if (result.status !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout) as Array<{ results: SeededCounts[] }>;
    return parsed[0]?.results[0] ?? null;
  } catch {
    return null;
  }
}

function main(argv: string[]): number {
  const args = parseSeedArgs(argv);
  if (!args.ok) {
    log.error('seed_usage', { reason: args.message });
    return 1;
  }
  const { target } = args;

  // Bad input stops here, before anything is written anywhere.
  let seed: SeedData;
  let sql: string;
  try {
    const tsv = readFileSync(join(repoRoot, 'docs/data/retailers-seed.tsv'), 'utf-8');
    const categories = JSON.parse(readFileSync(join(repoRoot, 'db/seed/categories.json'), 'utf-8')) as SeedCategory[];
    seed = buildSeed(parseSeedTsv(tsv), categories);
    sql = buildSeedSql(seed);
  } catch (error) {
    log.error('seed_invalid', { error });
    return 1;
  }

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

  const counts = seededCounts(target, seed);
  if (counts?.categories !== seed.categories.length || counts.retailers !== seed.retailers.length) {
    log.error('seed_not_applied', {
      target,
      reason: 'The database does not hold every seeded row (was the confirmation answered "no"?)',
      expected: { categories: seed.categories.length, retailers: seed.retailers.length },
      found: counts,
    });
    return 1;
  }
  log.info('seed_done', { target, database: counts });
  return 0;
}

process.exitCode = main(process.argv.slice(2));
