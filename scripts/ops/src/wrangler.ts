import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SeedTarget } from './args';

// How the ops commands talk to the `saleaway` D1 database: through Wrangler, run from the web app's folder so that
// `--local` is the copy `pnpm dev` reads. `wrangler d1 execute` takes plain SQL, so callers validate every value.

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const DATABASE = 'saleaway';

function wrangler(args: string[], capture: boolean) {
  return spawnSync('pnpm', ['--filter', '@saleaway/web', 'exec', 'wrangler', 'd1', 'execute', DATABASE, ...args], {
    cwd: repoRoot,
    encoding: 'utf-8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
}

/** Runs one read-only query and returns its rows, or null when Wrangler or the output failed. */
export function queryRows<T>(target: SeedTarget, sql: string): T[] | null {
  const result = wrangler(['--command', sql, '--json', `--${target}`], true);
  if (result.status !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout) as Array<{ results: T[] }>;
    return parsed[0]?.results ?? null;
  } catch {
    return null;
  }
}

/**
 * Runs SQL text as a file (written outside the repository and deleted afterwards). No `--yes` for `--remote`: in a
 * terminal Wrangler asks before it writes to the live database. Returns Wrangler's exit status.
 */
export function runSql(target: SeedTarget, sql: string): number {
  const directory = mkdtempSync(join(tmpdir(), 'saleaway-ops-'));
  try {
    const file = join(directory, 'change.sql');
    writeFileSync(file, sql, 'utf-8');
    return wrangler(['--file', file, `--${target}`], false).status ?? 1;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
