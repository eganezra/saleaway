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

export type OverrideMode = 'change' | 'clear' | 'list' | 'export' | 'import';

export interface OverrideOptions {
  target: SeedTarget;
  mode: OverrideMode;
  slug: string | null;
  /** The raw text of each change option; `parseOverrideChange` in core checks the values. */
  raw: { percent?: string; hide?: boolean; saleUrl?: string; expires?: string; note?: string };
  /** `--bring-back`: also make the store manual and visible, and take it off the hidden list. */
  bringBack: boolean;
}

export type OverrideArgs = ({ ok: true } & OverrideOptions) | { ok: false; message: string };

const OVERRIDE_USAGE =
  'Usage: pnpm ops:override --local | --remote  ( --slug <slug> [--percent <1-99|none>] [--hide | --unhide] [--url <https url|none>] [--expires <YYYY-MM-DD|none>] [--note <text>] [--bring-back] | --slug <slug> --clear | --list | --export | --import )';

/**
 * `ops:override` takes exactly one of `--local` or `--remote` (no default) and exactly one mode: change one store's
 * override (the default, with `--slug`), `--clear` it, `--list`, `--export` or `--import`. An option given twice, a
 * missing value, two modes, or a change option with a mode that takes none is a usage error that writes nothing.
 * The values themselves are checked by `parseOverrideChange` in core.
 */
export function parseOverrideArgs(argv: readonly string[]): OverrideArgs {
  const fail = (message: string): OverrideArgs => ({ ok: false, message: `${message} ${OVERRIDE_USAGE}` });
  const seen = new Set<string>();
  const raw: OverrideOptions['raw'] = {};
  let local = false;
  let remote = false;
  let slug: string | null = null;
  let hide = false;
  let unhide = false;
  let bringBack = false;
  const modes: OverrideMode[] = [];
  const valueOptions = new Set(['--slug', '--percent', '--url', '--expires', '--note']);
  const flags = new Set(['--local', '--remote', '--hide', '--unhide', '--bring-back', '--clear', '--list', '--export', '--import']);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (!valueOptions.has(arg) && !flags.has(arg)) return fail(`Unknown argument: ${arg}.`);
    if (seen.has(arg)) return fail(`${arg} was given twice.`);
    seen.add(arg);
    if (valueOptions.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return fail(`${arg} needs a value.`);
      i += 1;
      if (arg === '--slug') {
        if (!SLUG_PATTERN.test(value)) return fail(`Not a valid store slug: ${value}.`);
        slug = value;
      } else if (arg === '--percent') raw.percent = value;
      else if (arg === '--url') raw.saleUrl = value;
      else if (arg === '--expires') raw.expires = value;
      else raw.note = value;
    } else if (arg === '--local') local = true;
    else if (arg === '--remote') remote = true;
    else if (arg === '--hide') hide = true;
    else if (arg === '--unhide') unhide = true;
    else if (arg === '--bring-back') bringBack = true;
    else modes.push(arg.slice(2) as OverrideMode);
  }

  if (local && remote) return fail('Choose one of --local or --remote, not both.');
  if (!local && !remote) return fail('Say which database to use.');
  if (hide && unhide) return fail('--hide and --unhide cannot be used together.');
  if (hide) raw.hide = true;
  if (unhide) raw.hide = false;
  if (modes.length > 1) return fail(`Choose one mode, not several: ${modes.map((m) => `--${m}`).join(' ')}.`);

  const target: SeedTarget = local ? 'local' : 'remote';
  const changeOptions = Object.keys(raw).length > 0 || bringBack;
  const mode: OverrideMode = modes[0] ?? 'change';

  if (mode === 'change') {
    if (slug === null) return fail('Name the store with --slug.');
    if (!changeOptions) return fail('Nothing to change: give at least one change option, or --bring-back.');
    if (bringBack && hide) return fail('--bring-back shows the store, so it cannot be used with --hide.');
    return { ok: true, target, mode, slug, raw, bringBack };
  }
  if (changeOptions) return fail(`--${mode} takes no change options.`);
  if (mode === 'clear') {
    if (slug === null) return fail('--clear needs --slug.');
    return { ok: true, target, mode, slug, raw, bringBack };
  }
  if (slug !== null) return fail(`--${mode} works on every override: it takes no --slug.`);
  return { ok: true, target, mode, slug: null, raw, bringBack };
}
