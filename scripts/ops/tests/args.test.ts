import { describe, expect, it } from 'vitest';
import { parseHideArgs, parseSeedArgs } from '../src/args';

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
