import { DEFAULT_DELAY_SECONDS, MAX_DELAY_SECONDS, MAX_ONLY, MIN_DELAY_SECONDS } from './check-urls-plan';
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

export interface CoverageOptions {
  target: SeedTarget;
  /** The run to report on, or null for the latest one that has a result. */
  run: number | null;
  /** The file to write (checked by `resolveCoverageOut`), or null to print the report. */
  out: string | null;
}

export type CoverageArgs = ({ ok: true } & CoverageOptions) | { ok: false; message: string };

const COVERAGE_USAGE = 'Usage: pnpm ops:coverage --local | --remote [--run <id>] [--out docs/data/<file>.md]';

/**
 * `ops:coverage` only reads, but it still takes exactly one of `--local` or `--remote` (no default), so that it is always clear
 * which database a report describes. `--run` is a positive whole number; `--out` is a file name (its folder is checked later).
 */
export function parseCoverageArgs(argv: readonly string[]): CoverageArgs {
  const fail = (message: string): CoverageArgs => ({ ok: false, message: `${message} ${COVERAGE_USAGE}` });
  let local = false;
  let remote = false;
  let run: number | null = null;
  let out: string | null = null;
  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg !== '--local' && arg !== '--remote' && arg !== '--run' && arg !== '--out') return fail(`Unknown argument: ${arg}.`);
    if (seen.has(arg)) return fail(`${arg} was given twice.`);
    seen.add(arg);
    if (arg === '--local') local = true;
    else if (arg === '--remote') remote = true;
    else {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return fail(`${arg} needs a value.`);
      i += 1;
      if (arg === '--run') {
        if (!/^[1-9]\d{0,9}$/.test(value)) return fail(`--run must be a positive whole number: ${value}.`);
        run = Number(value);
      } else out = value;
    }
  }
  if (local && remote) return fail('Choose one of --local or --remote, not both.');
  if (!local && !remote) return fail('Say which database to read.');
  return { ok: true, target: local ? 'local' : 'remote', run, out };
}

export interface CheckUrlsOptions {
  /** List what would be asked and ask nothing. */
  dryRun: boolean;
  /** Seconds between pages. */
  delaySeconds: number;
  /** Check only these stores (a short look; writes no file and does not start the 24-hour clock), or null for the full run. */
  only: string[] | null;
}

export type CheckUrlsArgs = ({ ok: true } & CheckUrlsOptions) | { ok: false; message: string };

const CHECK_URLS_USAGE = 'Usage: pnpm ops:check-urls [--dry-run] [--only <slug> ...] [--delay <seconds>]';

/**
 * `ops:check-urls` asks retailers' sites for pages, so its arguments are strict: `--delay` is a whole number of seconds from 5 to
 * 120 (default 15), `--only` takes one to three slugs (each given once), and nothing may be given twice. Whether an `--only` slug
 * is in the seed file is checked by the command, which reads the file.
 */
export function parseCheckUrlsArgs(argv: readonly string[]): CheckUrlsArgs {
  const fail = (message: string): CheckUrlsArgs => ({ ok: false, message: `${message} ${CHECK_URLS_USAGE}` });
  let dryRun = false;
  let delaySeconds = DEFAULT_DELAY_SECONDS;
  let delayGiven = false;
  const only: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--dry-run') {
      if (dryRun) return fail('--dry-run was given twice.');
      dryRun = true;
    } else if (arg === '--delay' || arg === '--only') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return fail(`${arg} needs a value.`);
      i += 1;
      if (arg === '--delay') {
        if (delayGiven) return fail('--delay was given twice.');
        delayGiven = true;
        if (!/^\d{1,3}$/.test(value) || Number(value) < MIN_DELAY_SECONDS || Number(value) > MAX_DELAY_SECONDS) {
          return fail(`--delay must be a whole number of seconds from ${MIN_DELAY_SECONDS} to ${MAX_DELAY_SECONDS}: ${value}.`);
        }
        delaySeconds = Number(value);
      } else {
        if (!SLUG_PATTERN.test(value)) return fail(`--only needs a store slug (lower case letters, digits and hyphens): ${value}.`);
        if (only.includes(value)) return fail(`--only ${value} was given twice.`);
        if (only.length >= MAX_ONLY) return fail(`--only takes at most ${MAX_ONLY} stores.`);
        only.push(value);
      }
    } else {
      return fail(`Unknown argument: ${arg}.`);
    }
  }
  return { ok: true, dryRun, delaySeconds, only: only.length === 0 ? null : only };
}
