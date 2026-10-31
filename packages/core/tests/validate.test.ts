import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { recordEffect, validateSalePage } from '../src/validate';
import type { PageInput, ValidationReason, ValidationVerdict } from '../src/validate';
import { hostilePages } from './helpers/hostile';

const fixtureUrl = (name: string): URL => new URL(`./fixtures/pages/${name}`, import.meta.url);
const fixture = (name: string): string => readFileSync(fileURLToPath(fixtureUrl(name)), 'utf-8');

interface Sample {
  file: string;
  store: string;
  savedOn: string;
  synthetic: boolean;
  expectedUrl: string;
  finalUrl: string;
  expect: { verdict: ValidationVerdict; reason: ValidationReason };
  note?: string;
}
const manifest = JSON.parse(fixture('index.json')) as Sample[];

const URL_OK = 'https://shop.example/sale';
/** Wraps a body in a small page with a title. */
const html = (body: string, title = 'Sale | Shop'): string => `<!DOCTYPE html><html><head><title>${title}</title></head><body>${body}</body></html>`;
const judge = (text: string, over: Partial<PageInput> = {}) =>
  validateSalePage({ text, expectedUrl: URL_OK, finalUrl: URL_OK, truncated: false, ...over });
const product = (n: number, extra = ''): string => `<li><a href="/p/${n}">Product ${n}</a><span class="price">R${n}99.00</span>${extra}</li>`;
/** A listing of `count` priced products; `extra` is added to each. */
const listing = (count: number, extra = ''): string => `<ol>${Array.from({ length: count }, (_, i) => product(i + 1, extra)).join('')}</ol>`;
const WAS = '<span class="old-price">R999.00</span>';
// A page and an address that do not call themselves a sale (Story 3.10): the default title and address above do, so a listing with no
// discounts is `unverifiable` there; `no_discounts` (ended) needs these.
const PLAIN_URL = 'https://shop.example/women';
const PLAIN_TITLE = "Women's Tops | Shop";
const plain = (body: string, over: Partial<PageInput> = {}) => judge(html(body, PLAIN_TITLE), { expectedUrl: PLAIN_URL, finalUrl: PLAIN_URL, ...over });

describe('the saved page samples (AC3, AC6)', () => {
  it('has samples from at least 5 different real stores and at least 5 hand-made ones', () => {
    const real = new Set(manifest.filter((s) => !s.synthetic).map((s) => s.store));
    expect(real.size).toBeGreaterThanOrEqual(5);
    expect(manifest.filter((s) => s.synthetic).length).toBeGreaterThanOrEqual(5);
  });

  it('keeps every sample trimmed to a few KB (16 KiB at most), and names each one in the manifest', () => {
    for (const sample of manifest) expect(statSync(fixtureUrl(sample.file)).size, sample.file).toBeLessThanOrEqual(16 * 1024);
    for (const sample of manifest) expect(sample.savedOn, sample.file).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  for (const sample of manifest) {
    const name = `${sample.file}${sample.finalUrl !== sample.expectedUrl ? ' (ended elsewhere)' : ''} gives ${sample.expect.verdict} / ${sample.expect.reason}`;
    it(name, () => {
      const result = judge(fixture(sample.file), { expectedUrl: sample.expectedUrl, finalUrl: sample.finalUrl });
      expect({ verdict: result.verdict, reason: result.reason }).toEqual(sample.expect);
    });
  }

  it('covers every verdict and every reason except the ones that need no markup', () => {
    const reasons = new Set(manifest.map((s) => s.expect.reason));
    for (const reason of ['discounts_found', 'redirected_away', 'error_page', 'empty_listing', 'no_discounts', 'discounts_not_readable', 'challenge_page', 'login_page', 'javascript_shell'] as const) {
      expect(reasons.has(reason), reason).toBe(true);
    }
  });
});

describe('rule 1: redirected away', () => {
  it('ends the sale when the fetch ended on another site or on the home page', () => {
    const page = html(listing(4, WAS));
    expect(judge(page, { finalUrl: 'https://other.example/sale' })).toMatchObject({ verdict: 'ended', reason: 'redirected_away' });
    expect(judge(page, { finalUrl: 'https://shop.example/' })).toMatchObject({ verdict: 'ended', reason: 'redirected_away' });
  });
  it('does not end it for another path on the same site, or the same address with www', () => {
    const page = html(listing(4, WAS));
    expect(judge(page, { finalUrl: 'https://shop.example/collections/sale' }).verdict).toBe('valid');
    expect(judge(page, { finalUrl: 'https://www.shop.example/sale' }).verdict).toBe('valid');
  });
});

describe('rule 2: challenge pages are blocks, not missing sales', () => {
  for (const marker of ['Just a moment...', 'Attention Required! | Cloudflare', 'Checking your browser', 'Access Denied', 'Pardon Our Interruption', 'Please verify you are human', 'Complete the CAPTCHA']) {
    it(`"${marker}" in the title is challenge_page`, () => {
      expect(judge(html('<h1>Hello</h1>', marker))).toMatchObject({ verdict: 'blocked', reason: 'challenge_page' });
    });
  }
  it('finds the marker in the first part of the text, case-insensitively', () => {
    expect(judge(html('<p>CHECKING YOUR BROWSER before accessing the site</p>')).reason).toBe('challenge_page');
  });
  it('ignores a body marker on a page that lists priced products: a real sale page can mention reCAPTCHA or "access denied"', () => {
    for (const notice of ['This site is protected by reCAPTCHA', 'Access denied to unregistered users? Register', 'Complete the captcha to subscribe']) {
      const page = html(`<p>${notice}</p>${listing(8, WAS)}`);
      expect(judge(page).verdict, notice).toBe('valid');
    }
  });
  it('still treats a marker in the title as a challenge even on a page with prices', () => {
    expect(judge(html(listing(8, WAS), 'Access Denied')).reason).toBe('challenge_page');
  });
  it('ignores a marker that is far down a long page', () => {
    const page = html(`${listing(6, WAS)}<p>${'x '.repeat(3000)} just a moment</p>`);
    expect(judge(page).verdict).toBe('valid');
  });
  it('comes before the discount rules: a challenge page with "% off" text is still a challenge page', () => {
    expect(judge(html('<span>30% off</span><span>40% off</span><span>R100</span><span>R200</span>', 'Just a moment...')).reason).toBe('challenge_page');
  });
});

describe('rule 3: login pages', () => {
  const form = '<form><input type="email"><input type="password"><button>Go</button></form>';
  it('is a login page: a sign-in title, a password field and no prices', () => {
    for (const title of ['Sign in', 'Log in to Shop', 'Customer Login']) {
      expect(judge(html(form, title)), title).toMatchObject({ verdict: 'blocked', reason: 'login_page' });
    }
  });
  it('is not a login page without a password field, or when the page is full of prices', () => {
    expect(judge(html('<p>Welcome</p>', 'Sign in')).reason).not.toBe('login_page');
    expect(judge(html(form + listing(10, WAS), 'Sign in')).verdict).toBe('valid');
  });
});

describe('rule 4: error pages', () => {
  it('is an error page: an error title or heading, no prices and no discount signal', () => {
    for (const title of ['404', 'Page not found', 'Oops!', 'Error', 'Something went wrong', 'No longer available']) {
      expect(judge(html('<p>Sorry.</p>', title)), title).toMatchObject({ verdict: 'ended', reason: 'error_page' });
    }
    expect(judge(html('<h1>Page not found</h1>', 'Shop')).reason).toBe('error_page');
  });
  it('is not an error page when the page shows a discount signal, even with an error title and no prices', () => {
    const result = judge(html('<span class="old-price">was</span><p>Oops</p>', 'Oops'));
    expect(result.reason).not.toBe('error_page');
    expect(result.verdict).toBe('unverifiable');
  });
  it('matches whole words only', () => {
    expect(judge(html('<p>Hello</p>', 'Terror Trading Co')).reason).not.toBe('error_page');
    expect(judge(html('<p>Hello</p>', 'Mirror Mirror')).reason).not.toBe('error_page');
  });
  it('is not an error page when the page has prices or discounts', () => {
    expect(judge(html(listing(5, WAS), 'Error: 404 prices dropped')).verdict).toBe('valid');
    expect(judge(html(listing(4), 'Oops, no errors here'), { expectedUrl: PLAIN_URL, finalUrl: PLAIN_URL }).reason).toBe('no_discounts');
  });
});

describe('rule 5: discounted products (AC1)', () => {
  it('needs two discount signals and two prices: one signal is not a sale, two are', () => {
    expect(judge(html(listing(3, WAS))).verdict).toBe('valid');
    const one = html(listing(1, WAS));
    expect(judge(one).verdict).not.toBe('valid');
    expect(judge(html(listing(2, WAS))).verdict).toBe('valid');
  });
  it('does not make a sale of two signals and one price', () => {
    expect(judge(html('<span class="old-price">was</span><span>30% off</span><span>R100</span>')).verdict).not.toBe('valid');
    expect(judge(html('<span class="old-price">was</span><span>30% off</span><span>R100</span><span>R50</span>')).verdict).toBe('valid');
  });
  it('counts percentage labels that are a whole text element', () => {
    for (const label of ['30% off', '30% OFF', '-40%', '\u221240%', 'Save 25%', 'save up to 50%', '25% discount', '12 %']) {
      const result = judge(html(listing(3, `<span>${label}</span>`)));
      expect(result.signals.percentLabels, label).toBe(3);
    }
  });
  it('ignores a percentage inside a sentence, an attribute, a script or a style', () => {
    const noise = '<p>Want 10% off your first order? Sign up</p><a title="50% off" href="/x">Shop</a><style>.a{margin:-1%}</style><script>var x="30% off"</script>';
    expect(judge(html(noise + listing(3))).signals.percentLabels).toBe(0);
  });
  it('counts was-price markers: old-price and standard-price classes, price types, strike tags, "was R" text, aria labels', () => {
    const cases: Record<string, string> = {
      'old-price class': '<span class="old-price">R10</span>',
      'standard-price class': '<span class="product-standard-price">R10</span>',
      'price type': '<span data-price-type="oldPrice">R10</span>',
      'line-through class': '<span class="flex line-through">R10</span>',
      's tag': '<s>R10</s>',
      'del tag': '<del>R10</del>',
      'strike tag': '<strike>R10</strike>',
      'was text': '<span>was R10</span>',
      'aria label': '<div aria-label="Standard Price ZAR 10.00, Sale Price ZAR 5.00">x</div>',
    };
    for (const [name, markup] of Object.entries(cases)) {
      expect(judge(html(listing(2, markup))).signals.wasPrices, name).toBeGreaterThanOrEqual(2);
    }
    expect(judge(html(listing(2, '<span class="price-box special-price">R10</span>'))).signals.wasPrices).toBe(0);
  });
  it('counts structured price fields with a value, and not null or zero', () => {
    const withValue = html(`${listing(3)}<script type="application/json">{"items":[{"listPrice":1354,"price":504},{"compare_at_price":"499.00"}]}</script>`);
    expect(judge(withValue).signals.structured).toBe(2);
    expect(judge(withValue).verdict).toBe('valid');
    const none = html(`${listing(3)}<script>{"compare_at_price":null,"listPrice":0,"originalPrice":""}</script>`);
    expect(judge(none).signals.structured).toBe(0);
  });
  it('counts amounts as the sites write them: R199, R 1 299.00, R1,299, R&nbsp;99, and split across tags', () => {
    const text = html('<p>R199</p><p>R 1 299.00</p><p>R1,299</p><p>R&nbsp;99</p><p><span>R</span><span>504</span></p>');
    expect(judge(text).signals.amounts).toBe(5);
  });
  it('does not count letters or digits next to an R as an amount', () => {
    const text = html('<p>BR100 FOR200 R2D2 Rand R</p>');
    expect(judge(text).signals.amounts).toBe(0);
  });
  it('does not count amounts that only appear in scripts or styles', () => {
    expect(judge(html('<script>var p="R100 R200 R300"</script><style>.x{content:"R400"}</style>')).signals.amounts).toBe(0);
  });
  it('counts signals case-insensitively', () => {
    expect(judge(html(listing(2, '<SPAN CLASS="OLD-PRICE">R10</SPAN>'))).signals.wasPrices).toBe(2);
  });
});

describe('rule 6: pages that need JavaScript', () => {
  it('is javascript_shell with a root container and no prices', () => {
    for (const root of ['<div id="root"></div>', '<div id="app"></div>', '<div id="__next"></div>', '<div id="__nuxt"></div>', '<app-root></app-root>']) {
      expect(judge(html(root)), root).toMatchObject({ verdict: 'unverifiable', reason: 'javascript_shell' });
    }
  });
  it('is javascript_shell when a noscript message asks to enable JavaScript', () => {
    expect(judge(html('<noscript>Please enable JavaScript to view this site</noscript>')).reason).toBe('javascript_shell');
  });
  it('is javascript_shell for a page of many scripts and almost no text', () => {
    const scripts = '<script src="/a.js"></script>'.repeat(8);
    expect(judge(html(scripts)).reason).toBe('javascript_shell');
    expect(judge(html(scripts.slice(0, -30))).reason).not.toBe('javascript_shell'); // 7 scripts: too few
    expect(judge(html(scripts + `<p>${'word '.repeat(400)}</p>`)).reason).not.toBe('javascript_shell'); // plenty of text
  });
  it('is not a shell when the page lists priced products, even with a root container', () => {
    expect(plain('<div id="root">' + listing(5) + '</div>').reason).toBe('no_discounts');
  });
  it('a shell is still a shell when it was truncated', () => {
    expect(judge(html('<div id="root"></div>'), { truncated: true }).reason).toBe('javascript_shell');
  });
});

describe('rule 7: empty listings', () => {
  it('says so in words, case-insensitively', () => {
    for (const phrase of ['No products found', '0 results for sale', 'Nothing found here', 'There are no products', 'No results', "Sorry, we couldn't find anything"]) {
      expect(judge(html(`<p>${phrase}</p>`)), phrase).toMatchObject({ verdict: 'ended', reason: 'empty_listing' });
    }
    expect(judge(html('<p>NO PRODUCTS FOUND</p>')).reason).toBe('empty_listing');
  });
  it('is not an empty listing when the page has prices', () => {
    expect(judge(html('<p>No products found in Shoes</p>' + listing(5, WAS))).verdict).toBe('valid');
  });
});

describe('rule 8: no discounts', () => {
  it('is no_discounts for a page of priced products with no discount signal', () => {
    expect(plain(listing(3))).toMatchObject({ verdict: 'ended', reason: 'no_discounts' });
    expect(plain(listing(2)).reason).not.toBe('no_discounts'); // 2 amounts is not "a listing"
  });
  it('is not no_discounts when there is some discount signal, even if too few to be a sale', () => {
    expect(judge(html(listing(5, ''))  .replace('</ol>', WAS + '</ol>')).reason).toBe('unreadable');
  });
});

describe('rule 9 and truncation: when in doubt it cannot be judged', () => {
  it('is unreadable for an unknown short page', () => {
    expect(judge(html('<p>Hello</p>'))).toMatchObject({ verdict: 'unverifiable', reason: 'unreadable' });
    expect(judge('')).toMatchObject({ verdict: 'unverifiable', reason: 'unreadable' });
    expect(judge('just some text')).toMatchObject({ verdict: 'unverifiable', reason: 'unreadable' });
  });
  it('never ends a sale from a truncated page: no_discounts and empty_listing become unreadable', () => {
    expect(judge(html(listing(5)), { truncated: true })).toMatchObject({ verdict: 'unverifiable', reason: 'unreadable' });
    expect(judge(html('<p>No products found</p>'), { truncated: true })).toMatchObject({ verdict: 'unverifiable', reason: 'unreadable' });
  });
  it('still accepts a truncated page that already shows discounts, and still reports a challenge, an error title or a redirect', () => {
    expect(judge(html(listing(5, WAS)), { truncated: true }).verdict).toBe('valid');
    expect(judge(html('', 'Just a moment...'), { truncated: true }).reason).toBe('challenge_page');
    expect(judge(html('<p>Sorry</p>', 'Page not found'), { truncated: true }).reason).toBe('error_page');
    expect(judge(html(listing(3, WAS)), { truncated: true, finalUrl: 'https://shop.example/' }).reason).toBe('redirected_away');
  });
});

describe('the order of the rules', () => {
  it('redirected away beats a challenge page, which beats a login page, which beats an error page', () => {
    const challenge = html('<input type="password">', 'Just a moment, sign in');
    expect(judge(challenge, { finalUrl: 'https://shop.example/' }).reason).toBe('redirected_away');
    expect(judge(challenge).reason).toBe('challenge_page');
    expect(judge(html('<input type="password">', 'Sign in error')).reason).toBe('login_page');
  });
  it('an error title with discount words only in the footer is still an error page', () => {
    expect(judge(html('<h1>Page not found</h1><footer>Enjoy 30% off</footer>', 'Page not found')).reason).toBe('error_page');
  });
});

describe('what the function returns', () => {
  it('returns counts and a verdict, never page text', () => {
    const result = judge(html(listing(3, WAS) + '<p>Secret retailer sentence</p>'));
    expect(JSON.stringify(result)).not.toContain('Secret retailer sentence');
    expect(Object.keys(result).sort()).toEqual(['reason', 'signals', 'verdict']);
    expect(Object.keys(result.signals).sort()).toEqual(['amounts', 'percentLabels', 'saveLabels', 'scripts', 'structured', 'textLength', 'wasPrices']);
  });
  it('does not change its input and gives the same answer twice', () => {
    const input: PageInput = { text: html(listing(3, WAS)), expectedUrl: URL_OK, finalUrl: URL_OK, truncated: false };
    const copy = { ...input };
    const first = validateSalePage(input);
    expect(validateSalePage(input)).toEqual(first);
    expect(input).toEqual(copy);
  });
});

describe('size and safety', () => {
  const MIB = 1024 * 1024;
  const hostile = hostilePages();
  for (const [name, text] of Object.entries(hostile)) {
    it(`handles ${name} (3 MiB) in under a second`, () => {
      const started = Date.now();
      const result = judge(text);
      expect(Date.now() - started).toBeLessThan(1000);
      expect(['valid', 'ended', 'blocked', 'unverifiable']).toContain(result.verdict);
    });
  }
  it('stops counting at 100,000 so a hostile page cannot make a huge number', () => {
    const page = html('<p>R1</p>'.repeat(120_000));
    expect(judge(page).signals.amounts).toBe(100_000);
  });
  it('handles a real-sized sale page (3 MiB of products) in under a second, and counts are capped', () => {
    const page = html(listing(30_000, WAS));
    expect(page.length).toBeGreaterThan(2 * MIB);
    const started = Date.now();
    const result = judge(page);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result.verdict).toBe('valid');
    expect(result.signals.amounts).toBeLessThanOrEqual(100_000);
  });
});

describe('recordEffect (AC4, AC5)', () => {
  it('maps each verdict to what the sale record becomes', () => {
    expect(recordEffect('valid')).toEqual({ state: 'active', validation: 'content_verified' });
    expect(recordEffect('ended')).toEqual({ state: 'ended', validation: null });
    expect(recordEffect('blocked')).toEqual({ state: null, validation: null });
    expect(recordEffect('unverifiable')).toEqual({ state: 'active', validation: 'url_verified' });
  });
  it('never ends a sale because of a block, and never calls an unjudged page content-verified', () => {
    expect(recordEffect('blocked').state).toBeNull();
    expect(recordEffect('unverifiable').validation).toBe('url_verified');
    for (const verdict of ['valid', 'ended', 'blocked', 'unverifiable'] as const) {
      if (verdict !== 'valid') expect(recordEffect(verdict).validation).not.toBe('content_verified');
    }
  });
});

describe('Story 3.10: fewer false "ended" verdicts', () => {
  describe('amounts with a currency code (AC1)', () => {
    it.each(['ZAR 69.00', 'ZAR69', 'ZAR 1 299.00', 'ZAR1,299.00', 'R 69.00', 'R1,299'])('counts %s as an amount', (price) => {
      const page = html(`<span>${price}</span><span>${price}</span><span>${price}</span>`, PLAIN_TITLE);
      expect(judge(page, { expectedUrl: PLAIN_URL, finalUrl: PLAIN_URL }).signals.amounts).toBe(3);
    });
    it('does not count a word that only ends in zar, or a prefix inside a word', () => {
      const result = judge(html('<span>BAZAR 69</span><span>LAZAR 12.00</span><span>XZAR 5</span>', PLAIN_TITLE));
      expect(result.signals.amounts).toBe(0);
    });
    it('reads Gelmar-style prices: two special and regular prices make a sale', () => {
      const pair = (now: string, was: string) => `<span class="special-price"><span class="price">ZAR ${now}</span></span><span class="old-price"><span class="price">ZAR ${was}</span></span>`;
      expect(judge(html(pair('69.00', '80.00') + pair('45.00', '60.00'), 'Specials'))).toMatchObject({ verdict: 'valid', reason: 'discounts_found' });
    });
  });

  describe('"Save R" labels (AC2)', () => {
    it.each(['Save R 15.00', 'SAVE R15', 'Save ZAR 15.00', 'save r 1 299.00'])('counts "%s" as a saving label', (label) => {
      expect(judge(html(`<span>${label}</span>`)).signals.saveLabels).toBe(1);
    });
    it.each(['Save the date', 'Save 20 R', 'Save R', 'Saved R 15.00', 'Please save R 15.00 now', 'Save R 15.00 on every pack of milk we sell this week'])('does not count "%s"', (label) => {
      expect(judge(html(`<span>${label}</span>`)).signals.saveLabels).toBe(0);
    });
    it.each(['Save R50 when you spend R500', 'Save R15 today', 'Save R 15.00 off', 'Save R 15.00!', 'Save R 15.00 per pack'])('does not count a banner that goes on after the amount: "%s" (found in QA review)', (label) => {
      expect(judge(html(`<span>${label}</span>`)).signals.saveLabels).toBe(0);
    });
    it('does not count a saving label that is longer than 40 characters', () => {
      const long = `Save R 1${' 111'.repeat(12)}`;
      expect(long.length).toBeGreaterThan(40);
      expect(judge(html(`<span>${long}</span>`)).signals.saveLabels).toBe(0);
      expect(judge(html('<span>Save R 1 111 111</span>')).signals.saveLabels).toBe(1);
    });
    it('makes a page with two labels and two prices a sale', () => {
      const card = (n: number) => `<li><span>Product ${n}</span><span class="label">Save R 15.00</span><span class="price">R 89.99</span></li>`;
      const result = judge(html(`<ol>${card(1)}${card(2)}</ol>`, 'SPAR Specials'));
      expect(result).toMatchObject({ verdict: 'valid', reason: 'discounts_found', signals: { saveLabels: 2 } });
      expect(result.signals.amounts).toBeGreaterThanOrEqual(2); // the saving's own amount counts too
    });
    it('counts one label as a signal, but one signal alone is not enough for a sale', () => {
      const result = judge(html('<span>Save R 15.00</span>' + listing(3), 'Offers'));
      expect(result.verdict).not.toBe('valid');
    });
  });

  describe('empty listing is not triggered by site furniture (AC3)', () => {
    const furniture = '<div class="empty">You have no items in your wish list.</div><div class="empty">You have no items to compare.</div><p>You have no items in your cart.</p>';
    it('is not an empty listing when the only "no items" words are wish list, compare and cart widgets', () => {
      const result = plain(furniture);
      expect(result.reason).not.toBe('empty_listing');
      expect(result.verdict).toBe('unverifiable');
    });
    it('is still an empty listing for "no products" and no discount signal', () => {
      expect(plain('<p>No products found</p>')).toMatchObject({ verdict: 'ended', reason: 'empty_listing' });
    });
    it('is never an empty listing when the page holds a discount signal', () => {
      const result = plain('<p>No products found</p><span class="old-price">R100</span>');
      expect(result.reason).not.toBe('empty_listing');
    });
  });

  describe('a page that calls itself a sale is not called ended (AC4)', () => {
    const noDiscounts = listing(4);
    const WORDS = ['sale', 'special', 'deal', 'offer', 'promo', 'promotion', 'clearance', 'discount', 'outlet', 'saving'];
    it.each(WORDS)('"%s" in the title makes it unverifiable, in capitals and in the plural too', (word) => {
      for (const title of [`Shop ${word}`, `SHOP ${word.toUpperCase()}S`, `${word}s | Shop`]) {
        expect(judge(html(noDiscounts, title), { expectedUrl: PLAIN_URL, finalUrl: PLAIN_URL }), title).toMatchObject({ verdict: 'unverifiable', reason: 'discounts_not_readable' });
      }
    });
    it('also when only the main heading says so', () => {
      expect(judge(html(`<h1>Big Clearance</h1>${noDiscounts}`, PLAIN_TITLE), { expectedUrl: PLAIN_URL, finalUrl: PLAIN_URL })).toMatchObject({ verdict: 'unverifiable', reason: 'discounts_not_readable' });
    });
    it.each(['https://shop.example/sale', 'https://shop.example/region-and-national-specials', 'https://shop.example/special.html', 'https://shop.example/co-sale/', 'https://shop.example/promos', 'https://shop.example/store/Deals?x=1'])(
      'also when only the address path says so: %s',
      (url) => {
        expect(judge(html(noDiscounts, PLAIN_TITLE), { expectedUrl: url, finalUrl: url })).toMatchObject({ verdict: 'unverifiable', reason: 'discounts_not_readable' });
      },
    );
    it('is still ended when none of the three says so', () => {
      expect(plain(noDiscounts)).toMatchObject({ verdict: 'ended', reason: 'no_discounts' });
    });
    it.each(['Wholesale Tiles', 'Ideal Home', "A Specialist's Shop", 'Dealer Locator', 'Specialty Foods', 'Resale Cars', 'Salesforce Partners'])('a look-alike title ("%s") does not count', (title) => {
      expect(judge(html(noDiscounts, title), { expectedUrl: PLAIN_URL, finalUrl: PLAIN_URL })).toMatchObject({ verdict: 'ended', reason: 'no_discounts' });
    });
    it.each(['/dealers', '/specialty-foods', '/wholesale', '/ideal-home'])('a look-alike path (%s) does not count', (path) => {
      const url = `https://shop.example${path}`;
      expect(judge(html(noDiscounts, PLAIN_TITLE), { expectedUrl: url, finalUrl: url })).toMatchObject({ verdict: 'ended', reason: 'no_discounts' });
    });
    it.each(['https://shop.example/big_sale_items', 'https://shop.example/deals_of_the_day', 'https://shop.example/store/Clearance_Rack.html', 'https://shop.example/%7Especials', 'https://shop.example/Summer%20Sale', 'https://shop.example/deals%20and%20offers', 'https://shop.example/%E2%9C%A8Promos'])(
      'reads a word in the path that is set off by an underscore or an escape: %s (found in QA review)',
      (url) => {
        expect(judge(html(noDiscounts, PLAIN_TITLE), { expectedUrl: url, finalUrl: url })).toMatchObject({ verdict: 'unverifiable', reason: 'discounts_not_readable' });
      },
    );
    it('a sale word in the body text only does not save it', () => {
      expect(plain('<p>Our big sale starts soon, special offers every day</p>' + noDiscounts)).toMatchObject({ verdict: 'ended', reason: 'no_discounts' });
    });
    it('keeps the order of the rules: a redirect, challenge, login or error page still wins', () => {
      expect(judge(html(noDiscounts, 'Sale'), { finalUrl: 'https://other.example/sale' })).toMatchObject({ verdict: 'ended', reason: 'redirected_away' });
      expect(judge(html(noDiscounts, 'Just a moment... sale'))).toMatchObject({ verdict: 'blocked', reason: 'challenge_page' });
    });
    it('does not change what recordEffect does with unverifiable', () => {
      expect(recordEffect('unverifiable')).toEqual({ state: 'active', validation: 'url_verified' });
    });
    it('an address that does not parse is not a reason to throw', () => {
      expect(() => judge(html(noDiscounts, PLAIN_TITLE), { expectedUrl: 'not a url', finalUrl: 'not a url' })).not.toThrow();
    });
  });
});
