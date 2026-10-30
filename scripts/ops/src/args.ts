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

export interface HideOptions {
  target: SeedTarget;
  /** Show the stores again instead of hiding them. */
  undo: boolean;
  /** Only these stores (they must be on the list). Empty means every store on the list. */
  slugs: string[];
}

export type HideArgs = ({ ok: true } & HideOptions) | { ok: false; message: string };

const SLUG_PATTERN = /^[a-z0-9-]+$/;

/**
 * `ops:hide` must be told which database to write: exactly one of `--local` or `--remote`, no default.
 * `--undo` shows the stores again, and `--slug <slug>` (repeatable) limits the command to some stores.
 * Whether a slug is on the list is checked by the command, which has the list.
 */
export function parseHideArgs(argv: readonly string[]): HideArgs {
  const usage = 'Usage: pnpm ops:hide --local | --remote [--undo] [--slug <slug> ...]';
  let local = false;
  let remote = false;
  let undo = false;
  const slugs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--local') local = true;
    else if (arg === '--remote') remote = true;
    else if (arg === '--undo') undo = true;
    else if (arg === '--slug') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return { ok: false, message: `--slug needs a store slug. ${usage}` };
      if (!SLUG_PATTERN.test(value)) return { ok: false, message: `Not a valid store slug: ${value}. ${usage}` };
      if (!slugs.includes(value)) slugs.push(value);
      i += 1;
    } else return { ok: false, message: `Unknown argument: ${String(arg)}. ${usage}` };
  }
  if (local && remote) return { ok: false, message: `Choose one of --local or --remote, not both. ${usage}` };
  if (!local && !remote) return { ok: false, message: `Say which database to change. ${usage}` };
  return { ok: true, target: local ? 'local' : 'remote', undo, slugs };
}
