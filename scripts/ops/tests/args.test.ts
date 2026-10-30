import { describe, expect, it } from 'vitest';
import { parseHideArgs, parseOverrideArgs, parseSeedArgs } from '../src/args';

describe('parseSeedArgs', () => {
  it('accepts --local', () => {
    expect(parseSeedArgs(['--local'])).toEqual({ ok: true, target: 'local' });
  });
  it('accepts --remote', () => {
    expect(parseSeedArgs(['--remote'])).toEqual({ ok: true, target: 'remote' });
  });
  it('has no default: no flag is an error', () => {
    const result = parseSeedArgs([]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/Say which database/);
  });
  it('rejects both flags together', () => {
    const result = parseSeedArgs(['--local', '--remote']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/not both/);
  });
  it('rejects anything else, even next to a valid flag', () => {
    for (const argv of [['--yes'], ['--local', '--yes'], ['local'], ['--remote=1']]) {
      const result = parseSeedArgs(argv);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/Unknown argument/);
    }
  });
});

describe('parseHideArgs', () => {
  it('accepts --local and --remote, each on its own', () => {
    expect(parseHideArgs(['--local'])).toEqual({ ok: true, target: 'local', undo: false, slugs: [] });
    expect(parseHideArgs(['--remote'])).toEqual({ ok: true, target: 'remote', undo: false, slugs: [] });
  });
  it('accepts --undo in either place', () => {
    expect(parseHideArgs(['--local', '--undo'])).toEqual({ ok: true, target: 'local', undo: true, slugs: [] });
    expect(parseHideArgs(['--undo', '--remote'])).toEqual({ ok: true, target: 'remote', undo: true, slugs: [] });
  });
  it('collects --slug values, once each', () => {
    expect(parseHideArgs(['--remote', '--slug', 'dis-chem', '--slug', 'edgars', '--slug', 'dis-chem'])).toEqual({
      ok: true,
      target: 'remote',
      undo: false,
      slugs: ['dis-chem', 'edgars'],
    });
  });
  it('has no default database: neither or both is an error with the usage text', () => {
    for (const argv of [[], ['--undo'], ['--slug', 'edgars'], ['--local', '--remote']]) {
      const result = parseHideArgs(argv);
      expect(result.ok, argv.join(' ')).toBe(false);
      if (!result.ok) expect(result.message).toContain('Usage: pnpm ops:hide --local | --remote [--undo] [--slug <slug> ...]');
    }
  });
  it('rejects an unknown argument', () => {
    const result = parseHideArgs(['--local', '--yes']);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.message).toContain('Unknown argument: --yes');
  });
  it('rejects --slug with no value, or with another flag as its value', () => {
    expect(parseHideArgs(['--local', '--slug'])).toMatchObject({ ok: false });
    expect(parseHideArgs(['--local', '--slug', '--undo'])).toMatchObject({ ok: false });
  });
  it('rejects a slug that is not lowercase letters, digits and hyphens', () => {
    for (const slug of ['Bad Slug', "a'b", 'UPPER', 'a_b', '', 'a;b']) {
      expect(parseHideArgs(['--local', '--slug', slug]), slug).toMatchObject({ ok: false });
    }
  });
});

describe('parseOverrideArgs', () => {
  const ok = (argv: string[]) => {
    const result = parseOverrideArgs(argv);
    if (!result.ok) throw new Error(result.message);
    return result;
  };
  const bad = (argv: string[]): string => {
    const result = parseOverrideArgs(argv);
    if (result.ok) throw new Error(`expected an error for: ${argv.join(' ')}`);
    return result.message;
  };

  it('a change needs a database, --slug and at least one change option', () => {
    expect(ok(['--local', '--slug', 'zara-sa', '--percent', '40'])).toMatchObject({ target: 'local', mode: 'change', slug: 'zara-sa', raw: { percent: '40' }, bringBack: false });
    expect(ok(['--remote', '--slug', 'zara-sa', '--url', 'https://x.example/a'])).toMatchObject({ target: 'remote', raw: { saleUrl: 'https://x.example/a' } });
    expect(bad(['--local', '--slug', 'zara-sa'])).toContain('Nothing to change');
    expect(bad(['--local', '--percent', '40'])).toContain('Name the store with --slug');
  });
  it('takes every change option, with a note that has spaces', () => {
    const result = ok(['--local', '--slug', 'a', '--percent', 'none', '--hide', '--url', 'none', '--expires', '2026-11-30', '--note', "it's a note with spaces"]);
    expect(result.raw).toEqual({ percent: 'none', hide: true, saleUrl: 'none', expires: '2026-11-30', note: "it's a note with spaces" });
  });
  it('--hide and --unhide set the hide flag, and not together', () => {
    expect(ok(['--local', '--slug', 'a', '--hide']).raw).toEqual({ hide: true });
    expect(ok(['--local', '--slug', 'a', '--unhide']).raw).toEqual({ hide: false });
    expect(bad(['--local', '--slug', 'a', '--hide', '--unhide'])).toContain('cannot be used together');
  });
  it('--bring-back counts as a change, and cannot be used with --hide', () => {
    expect(ok(['--remote', '--slug', 'a', '--bring-back'])).toMatchObject({ mode: 'change', bringBack: true, raw: {} });
    expect(ok(['--remote', '--slug', 'a', '--bring-back', '--percent', '30', '--expires', '2026-12-01']).raw).toEqual({ percent: '30', expires: '2026-12-01' });
    expect(ok(['--local', '--slug', 'a', '--bring-back', '--unhide']).raw).toEqual({ hide: false });
    expect(bad(['--local', '--slug', 'a', '--bring-back', '--hide'])).toContain('cannot be used with --hide');
  });
  it('--clear needs --slug and takes no change option', () => {
    expect(ok(['--local', '--slug', 'a', '--clear'])).toMatchObject({ mode: 'clear', slug: 'a' });
    expect(bad(['--local', '--clear'])).toContain('--clear needs --slug');
    expect(bad(['--local', '--slug', 'a', '--clear', '--percent', '5'])).toContain('takes no change options');
  });
  it('--list, --export and --import take no slug and no change option', () => {
    for (const mode of ['list', 'export', 'import'] as const) {
      expect(ok(['--remote', `--${mode}`]), mode).toMatchObject({ mode, slug: null, target: 'remote' });
      expect(bad(['--remote', `--${mode}`, '--slug', 'a']), mode).toContain('takes no --slug');
      expect(bad(['--remote', `--${mode}`, '--percent', '5']), mode).toContain('takes no change options');
    }
  });
  it('needs exactly one database and exactly one mode', () => {
    expect(bad(['--list'])).toContain('Say which database');
    expect(bad(['--local', '--remote', '--list'])).toContain('not both');
    expect(bad(['--local', '--list', '--export'])).toContain('Choose one mode');
    expect(bad(['--local', '--slug', 'a', '--clear', '--list'])).toContain('Choose one mode');
    expect(bad([])).toContain('Say which database');
  });
  it('refuses an option given twice, an unknown option, a missing value and a value that is another option', () => {
    expect(bad(['--local', '--slug', 'a', '--percent', '5', '--percent', '6'])).toContain('--percent was given twice');
    expect(bad(['--local', '--list', '--list'])).toContain('--list was given twice');
    expect(bad(['--local', '--slug', 'a', '--yes'])).toContain('Unknown argument: --yes');
    expect(bad(['--local', '--slug', 'a', '--percent'])).toContain('--percent needs a value');
    expect(bad(['--local', '--slug', 'a', '--note', '--hide'])).toContain('--note needs a value');
    expect(bad(['--local', '--slug'])).toContain('--slug needs a value');
  });
  it('refuses a slug that is not lowercase letters, digits and hyphens', () => {
    for (const slug of ['Bad Slug', "a'b", 'UPPER', 'a_b', 'a;b', '../x']) expect(bad(['--local', '--slug', slug, '--hide']), slug).toContain('Not a valid store slug');
  });
  it('shows the usage text with every error', () => {
    expect(bad(['--local', '--yes'])).toContain('Usage: pnpm ops:override');
  });
});
