import { describe, expect, it } from 'vitest';
import { analyticsToken } from '../src/lib/analytics';

describe('analyticsToken (Story 2.5)', () => {
  it('accepts a token of letters and digits, 16 to 64 long, and trims it', () => {
    expect(analyticsToken('a'.repeat(32))).toBe('a'.repeat(32));
    expect(analyticsToken('0123456789abcdefABCDEF0123456789')).toBe('0123456789abcdefABCDEF0123456789');
    expect(analyticsToken('  ' + 'b'.repeat(16) + '\n')).toBe('b'.repeat(16));
    expect(analyticsToken('c'.repeat(64))).toBe('c'.repeat(64));
  });
  it.each([undefined, '', '   ', 'bad token!', 'a'.repeat(15), 'a'.repeat(65), `${'a'.repeat(31)}"`, `${'a'.repeat(31)}'`, `${'a'.repeat(31)}<`, `${'a'.repeat(15)} ${'a'.repeat(16)}`, `${'a'.repeat(31)}-`])(
    'gives no token for %j',
    (value) => {
      expect(analyticsToken(value)).toBeNull();
    },
  );
});
