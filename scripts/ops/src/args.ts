export type SeedTarget = 'local' | 'remote';

export type SeedArgs = { ok: true; target: SeedTarget } | { ok: false; message: string };

/**
 * `ops:seed` must be told which database to write: exactly one of `--local` or `--remote`, and
 * nothing else. There is no default, so the live database is never written by accident.
 */
export function parseSeedArgs(argv: readonly string[]): SeedArgs {
  const usage = 'Usage: pnpm ops:seed --local | --remote';
  const unknown = argv.filter((arg) => arg !== '--local' && arg !== '--remote');
  if (unknown.length > 0) return { ok: false, message: `Unknown argument: ${unknown.join(' ')}. ${usage}` };
  const local = argv.includes('--local');
  const remote = argv.includes('--remote');
  if (local && remote) return { ok: false, message: `Choose one of --local or --remote, not both. ${usage}` };
  if (!local && !remote) return { ok: false, message: `Say which database to seed. ${usage}` };
  return { ok: true, target: local ? 'local' : 'remote' };
}
