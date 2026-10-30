import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHiddenStores } from '@saleaway/core';
import type { HiddenStores } from '@saleaway/core';
import { parseHideArgs } from './args';
import type { SeedTarget } from './args';
import { isApplied, selectSlugs } from './hide-plan';
import type { VisibilityCounts } from './hide-plan';
import { log } from './log';
import { buildVisibilitySql, sqlString } from './sql';

// `pnpm ops:hide --local | --remote [--undo] [--slug <slug> ...]`: hides the stores on the list in
// docs/data/hidden-stores.json (Story 3.9), or shows them again with --undo. Safe to run again.
// Needs `wrangler login` for --remote.

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

/**
 * Asks the database what it holds now. Wrangler exits 0 when the operator answers "no" at its
 * confirmation prompt, so the exit code alone cannot tell us the change was made. Slugs are validated
 * (`parseHiddenStores`, `parseHideArgs`) and quoted by `sqlString`.
 */
function countSelected(target: SeedTarget, slugs: string[]): VisibilityCounts | null {
  const list = slugs.map(sqlString).join(', ');
  const sql =
    `SELECT (SELECT COUNT(*) FROM retailers WHERE slug IN (${list})) AS selected, ` +
    `(SELECT COUNT(*) FROM retailers WHERE slug IN (${list}) AND is_visible = 1) AS visibleSelected, ` +
    '(SELECT COUNT(*) FROM retailers WHERE is_visible = 1) AS visibleTotal';
  const result = wrangler(['--command', sql, '--json', `--${target}`], true);
  if (result.status !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout) as Array<{ results: VisibilityCounts[] }>;
    return parsed[0]?.results[0] ?? null;
  } catch {
    return null;
  }
}

function main(argv: string[]): number {
  const args = parseHideArgs(argv);
  if (!args.ok) {
    log.error('hide_usage', { reason: args.message });
    return 1;
  }
  const { target, undo } = args;

  // Bad input stops here, before anything is written anywhere.
  let list: HiddenStores;
  try {
    list = parseHiddenStores(JSON.parse(readFileSync(join(repoRoot, 'docs/data/hidden-stores.json'), 'utf-8')));
  } catch (error) {
    log.error('hide_invalid', { error });
    return 1;
  }
  const selection = selectSlugs(list.stores.map((store) => store.slug), args.slugs);
  if (!selection.ok) {
    log.error('hide_usage', { reason: selection.message });
    return 1;
  }
  const { slugs } = selection;
  const action = undo ? 'show' : 'hide';
  const sql = buildVisibilitySql(slugs, undo ? 1 : 0);

  const before = countSelected(target, slugs);
  log.info('hide_start', { target, action, stores: slugs.length, visibleBefore: before?.visibleTotal ?? null });

  // The SQL file lives outside the repository and is deleted afterwards.
  const directory = mkdtempSync(join(tmpdir(), 'saleaway-hide-'));
  try {
    const file = join(directory, 'visibility.sql');
    writeFileSync(file, sql, 'utf-8');
    // No --yes for --remote: in a terminal Wrangler asks before it writes to the live database.
    const result = wrangler(['--file', file, `--${target}`], false);
    if (result.status !== 0) {
      log.error('hide_failed', { target, status: result.status });
      return result.status ?? 1;
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }

  const after = countSelected(target, slugs);
  if (after === null || !isApplied(after, slugs.length, undo)) {
    log.error('hide_not_applied', {
      target,
      action,
      reason: 'The database does not hold the expected state (was the confirmation answered "no", or is a store missing?)',
      expected: { selected: slugs.length, visibleSelected: undo ? slugs.length : 0 },
      found: after,
    });
    return 1;
  }
  log.info('hide_done', { target, action, stores: slugs.length, visibleTotal: after.visibleTotal });
  return 0;
}

process.exitCode = main(process.argv.slice(2));
