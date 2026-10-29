import { describe, expect, it } from 'vitest';
import { parseSeedArgs } from '../src/args';

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
