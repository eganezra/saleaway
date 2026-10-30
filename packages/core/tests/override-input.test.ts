import { describe, expect, it } from 'vitest';
import { expiryFromDate, parseOverrideChange, parseOverridesFile } from '../src/override-input';
import type { RawOverrideChange } from '../src/override-input';

const TODAY = '2026-10-30';
const parse = (raw: RawOverrideChange, options?: { allowEmpty?: boolean }) => parseOverrideChange(raw, TODAY, options);
const okChange = (raw: RawOverrideChange) => {
  const result = parse(raw);
  if (!result.ok) throw new Error(`expected ok: ${result.errors.join('; ')}`);
  return result.change;
};
const errors = (raw: RawOverrideChange): string[] => {
  const result = parse(raw);
  if (result.ok) throw new Error('expected errors');
  return result.errors;
};

describe('expiryFromDate', () => {
  it('is the end of that day in UTC', () => {
    expect(expiryFromDate('2026-11-30')).toBe('2026-11-30T23:59:59Z');
  });
});

describe('parseOverrideChange: percent', () => {
  it('takes a whole number from 1 to 99', () => {
    for (const percent of ['1', '50', '99', '05']) expect(okChange({ percent }).percent, percent).toBe(Number(percent));
  });
  it('clears with none', () => {
    expect(okChange({ percent: 'none' })).toEqual({ percent: null });
  });
  it('refuses 0, 100, a decimal, text, empty, negative and signed numbers', () => {
    for (const percent of ['0', '100', '5.5', 'abc', '', '-3', '+5', '1e1', ' 5']) {
      expect(errors({ percent }).join(' '), percent).toMatch(/percent must be a whole number from 1 to 99/);
    }
  });
});

describe('parseOverrideChange: hide', () => {
  it('passes true and false through', () => {
    expect(okChange({ hide: true })).toEqual({ hide: true });
    expect(okChange({ hide: false })).toEqual({ hide: false });
  });
});

describe('parseOverrideChange: url', () => {
  it('takes a safe https address and clears with none', () => {
    expect(okChange({ saleUrl: 'https://shop.example/outlet?x=1' })).toEqual({ saleUrl: 'https://shop.example/outlet?x=1' });
    expect(okChange({ saleUrl: 'none' })).toEqual({ saleUrl: null });
  });
  it('refuses http, an IP address, a local name, a script, a login in the address, a port, empty text and a very long address', () => {
    const bad = ['http://shop.example/x', 'https://127.0.0.1/', 'https://localhost./', 'javascript:alert(1)', 'https://u:p@shop.example/', 'https://shop.example:8443/', '', 'not a url', `https://shop.example/${'a'.repeat(2050)}`];
    for (const saleUrl of bad) expect(errors({ saleUrl }).join(' '), saleUrl.slice(0, 40)).toMatch(/url must be an https:\/\/ address/);
  });
});

describe('parseOverrideChange: an address must be usable exactly as typed', () => {
  it('refuses an address with a space, a tab, a newline or another blank anywhere, because the URL parser would quietly drop it', () => {
    const bad = [' https://shop.example/sale', 'https://shop.example/sale ', 'https://shop.example/a\nb', 'https://shop.example/a\tb', 'https://shop.example/a b', 'https://shop.example/\u00a0x', 'https://shop.example/a\u0001b'];
    for (const saleUrl of bad) expect(errors({ saleUrl }).join(' '), JSON.stringify(saleUrl)).toMatch(/url must be an https:\/\/ address/);
  });
  it('refuses an address that does not start with lower-case https://, because the site checks the start of the stored text', () => {
    for (const saleUrl of ['HTTPS://shop.example/x', 'Https://shop.example/x', '//shop.example/x']) expect(errors({ saleUrl }).join(' '), saleUrl).toMatch(/url must be/);
  });
  it('keeps a query, a fragment and a capital in the host name', () => {
    expect(okChange({ saleUrl: 'https://SHOP.example/x?a=1&b=2#top' }).saleUrl).toBe('https://SHOP.example/x?a=1&b=2#top');
  });
});

describe('parseOverrideChange: expires', () => {
  it('takes today and a future date, as the end of that day', () => {
    expect(okChange({ expires: '2026-10-30' })).toEqual({ expiresAt: '2026-10-30T23:59:59Z' });
    expect(okChange({ expires: '2026-11-30' })).toEqual({ expiresAt: '2026-11-30T23:59:59Z' });
    expect(okChange({ expires: '2028-02-29' })).toEqual({ expiresAt: '2028-02-29T23:59:59Z' });
  });
  it('clears with none', () => {
    expect(okChange({ expires: 'none' })).toEqual({ expiresAt: null });
  });
  it('refuses yesterday, an unreal date, another format and empty text', () => {
    expect(errors({ expires: '2026-10-29' }).join(' ')).toMatch(/in the past/);
    for (const expires of ['2026-02-30', '2026-13-01', '30-11-2026', '2026-11-30T10:00:00Z', '', '2026-1-5', 'tomorrow']) {
      expect(errors({ expires }).join(' '), expires).toMatch(/expires must be a real date/);
    }
  });
});

describe('parseOverrideChange: note', () => {
  it('takes up to 200 characters, a quote and an empty note', () => {
    expect(okChange({ note: 'a'.repeat(200) }).note).toHaveLength(200);
    expect(okChange({ note: "Hirsch's sale" })).toEqual({ note: "Hirsch's sale" });
    expect(okChange({ note: '' })).toEqual({ note: '' });
  });
  it('refuses 201 characters and control characters', () => {
    expect(errors({ note: 'a'.repeat(201) }).join(' ')).toMatch(/longer than 200/);
    for (const note of ['a\nb', 'a\tb', 'a\u0000b', 'a\u007fb']) expect(errors({ note }).join(' '), JSON.stringify(note)).toMatch(/control character/);
  });
});

describe('parseOverrideChange: the whole change', () => {
  it('keeps only the fields that were given', () => {
    expect(okChange({ percent: '40', hide: false, expires: '2026-12-01', note: 'x', saleUrl: 'https://shop.example/a' })).toEqual({
      percent: 40,
      hide: false,
      expiresAt: '2026-12-01T23:59:59Z',
      note: 'x',
      saleUrl: 'https://shop.example/a',
    });
    expect(Object.keys(okChange({ percent: '40' }))).toEqual(['percent']);
  });
  it('reports every error at once', () => {
    const all = errors({ percent: '0', saleUrl: 'http://x.example', expires: '2020-01-01', note: 'a\nb' });
    expect(all).toHaveLength(4);
  });
  it('refuses a change that sets nothing, unless an empty one is allowed (bring back)', () => {
    expect(errors({}).join(' ')).toMatch(/nothing to change/);
    expect(parse({}, { allowEmpty: true })).toEqual({ ok: true, change: {} });
  });
  it('does not call an invalid change empty: it reports the real error', () => {
    expect(errors({ percent: 'x' })).toHaveLength(1);
  });
});

describe('parseOverridesFile', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    slug: 'zara-sa',
    discountPercent: 40,
    hide: false,
    saleUrl: 'https://www.zara.com/za/sale',
    expiresAt: '2026-11-30T23:59:59Z',
    note: 'checked by hand',
    createdAt: '2026-10-30T10:00:00Z',
    ...over,
  });
  const problems = (value: unknown): string => {
    try {
      parseOverridesFile(value);
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error('expected a throw');
  };

  it('accepts a valid file and an empty one, returning the rows', () => {
    expect(parseOverridesFile([row(), row({ slug: 'bash-tfg', discountPercent: null, saleUrl: null, expiresAt: null, note: '', hide: true })])).toHaveLength(2);
    expect(parseOverridesFile([])).toEqual([]);
    expect(parseOverridesFile([row()])[0]).toEqual(row());
  });
  it('refuses anything that is not a list, and a row that is not an object', () => {
    for (const value of [null, {}, 'x', 5]) expect(problems(value)).toMatch(/must hold a list/);
    expect(problems([5])).toMatch(/must be an object/);
  });
  it('refuses a bad slug and a duplicate slug', () => {
    for (const slug of ['Bad Slug', "a'b", '', 5, undefined]) expect(problems([row({ slug })]), String(slug)).toMatch(/invalid slug/);
    expect(problems([row(), row()])).toMatch(/duplicate slug/);
  });
  it('refuses a percent outside 1 to 99, a decimal and a missing one', () => {
    for (const discountPercent of [0, 100, 7.5, '40', undefined]) expect(problems([row({ discountPercent })]), String(discountPercent)).toMatch(/discountPercent/);
  });
  it('refuses a hide that is not a boolean', () => {
    for (const hide of [0, 'true', null, undefined]) expect(problems([row({ hide })]), String(hide)).toMatch(/hide must be true or false/);
  });
  it('refuses an unsafe address, and one with a blank in it', () => {
    for (const saleUrl of ['http://x.example', 'https://127.0.0.1/', '', 5, undefined, ' https://x.example/a', 'https://x.example/a\n', 'HTTPS://x.example/a']) expect(problems([row({ saleUrl })]), String(saleUrl)).toMatch(/saleUrl/);
  });
  it('refuses an expiry or a creation time that is not a real date and time', () => {
    for (const expiresAt of ['2026-11-30', '2026-13-01T00:00:00Z', '2026-02-30T00:00:00Z', 'soon', 5, undefined]) expect(problems([row({ expiresAt })]), String(expiresAt)).toMatch(/expiresAt/);
    for (const createdAt of [null, '2026-10-30', '2026-10-30T25:00:00Z', undefined]) expect(problems([row({ createdAt })]), String(createdAt)).toMatch(/createdAt/);
  });
  it('refuses a note that is long, has a control character or is missing', () => {
    for (const note of ['a'.repeat(201), 'a\nb', null, undefined]) expect(problems([row({ note })]), String(note).slice(0, 10)).toMatch(/note must be/);
  });
  it('refuses more than 500 rows', () => {
    const many = Array.from({ length: 501 }, (_, i) => row({ slug: `store-${i}` }));
    expect(problems(many)).toMatch(/more than 500/);
    expect(parseOverridesFile(many.slice(0, 500))).toHaveLength(500);
  });
  it('names every problem in one error', () => {
    const message = problems([row({ slug: 'A B', hide: 1 }), row({ discountPercent: 0 }), row({ slug: 'x', note: 'a\nb' })]);
    expect(message).toMatch(/invalid slug/);
    expect(message).toMatch(/hide must be/);
    expect(message).toMatch(/discountPercent/);
    expect(message).toMatch(/note must be/);
  });
});
