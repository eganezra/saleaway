import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractHtmlDiscount } from '../src/extract/html';
import { hostilePages } from './helpers/hostile';

const fixture = (name: string): string => readFileSync(fileURLToPath(new URL(`./fixtures/pages/${name}`, import.meta.url)), 'utf-8');
const manifest = JSON.parse(fixture('index.json')) as Array<{ file: string; store: string; synthetic: boolean; expectPercent: { html: number | null; structured_data: number | null } }>;

const html = (body: string): string => `<!DOCTYPE html><html><head><title>Sale</title></head><body>${body}</body></html>`;
/** A product with a was price in the element `wasMarkup` and a now price. */
const pair = (was: string, now: string, wasMarkup = (amount: string) => `<span class="old-price">${amount}</span>`): string =>
  `<li><span class="price">${now}</span>${wasMarkup(was)}</li>`;

describe('the saved page samples (AC3, AC6)', () => {
  it('has an expected percentage for every sample, and at least five real stores with one', () => {
    const real = new Set(manifest.filter((e) => !e.synthetic && e.expectPercent.html !== null).map((e) => e.store));
    expect(real.size).toBeGreaterThanOrEqual(4); // bash, cotton on, hirsch's, makro (loot reads its data: see the structured test)
    for (const entry of manifest) expect(entry.expectPercent, entry.file).toBeDefined();
  });
  for (const entry of manifest) {
    it(`${entry.file} gives ${String(entry.expectPercent.html)}`, () => {
      expect(extractHtmlDiscount(fixture(entry.file))).toBe(entry.expectPercent.html);
    });
  }
});

describe('was/now pairs', () => {
  it('works out the percentage from the was amount to the now amount, whichever comes first', () => {
    expect(extractHtmlDiscount(html(`<ol>${pair('R200', 'R150')}</ol>`))).toBe(25);
    expect(extractHtmlDiscount(html('<ol><li><span class="old-price">R200</span><span>R150</span></li></ol>'))).toBe(25);
  });
  it('knows each old-price marker', () => {
    const markers: Record<string, (amount: string) => string> = {
      'old-price class': (a) => `<span class="old-price">${a}</span>`,
      'standard-price class': (a) => `<span class="product-standard-price">${a}</span>`,
      'compare price class': (a) => `<span class="compare-at-price">${a}</span>`,
      'original price class': (a) => `<span class="original-price">${a}</span>`,
      'line-through class': (a) => `<span class="text-red line-through">${a}</span>`,
      'data price type': (a) => `<span data-price-type="oldPrice">${a}</span>`,
      's tag': (a) => `<s>${a}</s>`,
      'del tag': (a) => `<del>${a}</del>`,
      'strike tag': (a) => `<strike>${a}</strike>`,
      'upper case': (a) => `<SPAN CLASS="OLD-PRICE">${a}</SPAN>`,
    };
    for (const [name, mark] of Object.entries(markers)) expect(extractHtmlDiscount(html(`<ol>${pair('R200', 'R150', mark)}</ol>`)), name).toBe(25);
  });
  it('reads "was R200" as text', () => {
    expect(extractHtmlDiscount(html('<ol><li>R150 <span>was R200</span></li></ol>'))).toBe(25);
    expect(extractHtmlDiscount(html('<ol><li>Now R150, WAS R 200</li></ol>'))).toBe(25);
  });
  it('reads an aria-label that gives both prices', () => {
    expect(extractHtmlDiscount(html('<ol><li><div aria-label="Standard Price ZAR 599.00, Sale Price ZAR 300.00">x</div></li></ol>'))).toBe(50);
    expect(extractHtmlDiscount(html('<ol><li><div aria-label="Standard Price R 1,200.00; Sale Price R 900.00">x</div></li></ol>'))).toBe(25);
  });
  it('takes the nearest smaller amount as the now price, not a far one', () => {
    const body = `<ol><li><span class="price">R150</span><span class="old-price">R200</span></li><li><span class="price">R10</span></li></ol>`;
    expect(extractHtmlDiscount(html(body))).toBe(25);
  });
  it('ignores a was amount with no smaller amount near it, and one that is not smaller', () => {
    expect(extractHtmlDiscount(html('<ol><li><span class="old-price">R200</span></li></ol>'))).toBeNull();
    expect(extractHtmlDiscount(html('<ol><li><span class="price">R250</span><span class="old-price">R200</span></li></ol>'))).toBeNull();
    expect(extractHtmlDiscount(html('<ol><li><span class="price">R200</span><span class="old-price">R200</span></li></ol>'))).toBeNull();
  });
  it('ignores a now amount that is far from the marker', () => {
    const far = `<span class="old-price">R200</span>${'<p>words </p>'.repeat(120)}<span>R100</span>`;
    expect(extractHtmlDiscount(html(`<ol><li>${far}</li></ol>`))).toBeNull();
  });
  it('does not take a larger amount as the now price, even when it is nearer to the marker than the real one', () => {
    const body = '<ol><li><span>R300</span><span class="old-price">R200</span><span>some words between them to make the real now price farther away</span><span>R150</span></li></ol>';
    expect(extractHtmlDiscount(html(body))).toBe(25);
  });
  it('ignores a marker whose was amount is far after it', () => {
    const farWas = `<span>R150</span><s>x</s>${'<p>words </p>'.repeat(55)}<span>R200</span>`; // the now price is near the marker, the was amount is not
    expect(extractHtmlDiscount(html(`<ol><li>${farWas}</li></ol>`))).toBeNull();
  });
  it('takes the largest pair on the page', () => {
    const body = `<ol>${pair('R100', 'R90')}${pair('R100', 'R60')}${pair('R100', 'R80')}</ol>`;
    expect(extractHtmlDiscount(html(body))).toBe(40);
  });
  it('reads amounts as the stores write them', () => {
    expect(extractHtmlDiscount(html(`<ol>${pair('R 1,299.99', 'R 999.99')}</ol>`))).toBe(23);
    expect(extractHtmlDiscount(html(`<ol>${pair('R1 299', 'R899')}</ol>`))).toBe(31);
    expect(extractHtmlDiscount(html(`<ol>${pair('R&nbsp;200', 'R&nbsp;150')}</ol>`))).toBe(25);
    expect(extractHtmlDiscount(html('<ol><li><span class="old-price">R249<sup>.00</sup></span><span>R140<sup>.00</sup></span></li></ol>'))).toBe(44);
    expect(extractHtmlDiscount(html('<ol><li><span class="old-price"><span>R</span><span>200</span></span><span><span>R</span><span>150</span></span></li></ol>'))).toBe(25);
  });
});

describe('percentage labels', () => {
  it('reads a text element that is only a badge', () => {
    for (const [label, percent] of [['30% off', 30], ['30% OFF', 30], ['-25%', 25], ['−25%', 25], ['Save 25%', 25], ['save up to 40%', 40], ['15% discount', 15]] as const) {
      expect(extractHtmlDiscount(html(`<ol><li><span>${label}</span></li></ol>`)), label).toBe(percent);
    }
  });
  it('takes the largest label on the page', () => {
    expect(extractHtmlDiscount(html('<ol><li><span>10% off</span></li><li><span>45% off</span></li><li><span>30% off</span></li></ol>'))).toBe(45);
  });
  it('ignores a percentage in a sentence, an attribute, a script or a style', () => {
    const noise = '<p>Want 10% off your first order? Sign up</p><a title="50% off" href="/x">x</a><style>.a{margin:-5%}</style><script>var x="60% off"</script>';
    expect(extractHtmlDiscount(html(noise))).toBeNull();
  });
});

describe('pairs before labels', () => {
  it('uses the price pairs even when a label is bigger', () => {
    expect(extractHtmlDiscount(html(`<ol>${pair('R100', 'R80')}<li><span>40% off</span></li></ol>`))).toBe(20);
  });
  it('uses the labels when there is no pair', () => {
    expect(extractHtmlDiscount(html('<ol><li><span class="price">R80</span><span>40% off</span></li></ol>'))).toBe(40);
  });
  it('uses the labels when the only pair is out of range', () => {
    expect(extractHtmlDiscount(html(`<ol>${pair('R100', 'R98')}<li><span>35% off</span></li></ol>`))).toBe(35);
  });
});

describe('what is not a product discount', () => {
  it('ignores a label or a pair in a nav, header or footer block', () => {
    for (const tag of ['nav', 'header', 'footer']) {
      expect(extractHtmlDiscount(html(`<${tag}><a>30% Off</a>${pair('R100', 'R50')}</${tag}><ol><li>R10</li></ol>`)), tag).toBeNull();
    }
    expect(extractHtmlDiscount(html(`<NAV class="menu"><a>30% Off</a></NAV><ol><li><span>20% off</span></li></ol>`))).toBe(20);
  });
  it('does not mistake <navigation> or <headline> for a nav or a header', () => {
    expect(extractHtmlDiscount(html('<navigation><span>30% off</span></navigation>'))).toBe(30);
    expect(extractHtmlDiscount(html('<headline><span>30% off</span></headline>'))).toBe(30);
  });
  it('keeps the page when a nav, header or footer never closes', () => {
    expect(extractHtmlDiscount(html('<nav><ol><li><span>30% off</span></li></ol>'))).toBe(30);
    expect(extractHtmlDiscount(html('<footer><ol><li><span>30% off</span></li></ol>'))).toBe(30);
  });
  it('keeps the <head> of the page (it is not a <header>)', () => {
    expect(extractHtmlDiscount('<html><head><title>x</title></head><body><span>30% off</span></body></html>')).toBe(30);
  });
});

describe('the range (AC4) and nothing readable (AC5)', () => {
  it('ignores below 5 and above 90 and keeps 5 and 90', () => {
    expect(extractHtmlDiscount(html(`<ol>${pair('R100', 'R96')}</ol>`))).toBeNull(); // 4
    expect(extractHtmlDiscount(html(`<ol>${pair('R100', 'R9')}</ol>`))).toBeNull(); // 91
    expect(extractHtmlDiscount(html(`<ol>${pair('R100', 'R95')}</ol>`))).toBe(5);
    expect(extractHtmlDiscount(html(`<ol>${pair('R100', 'R10')}</ol>`))).toBe(90);
    expect(extractHtmlDiscount(html('<span>4% off</span>'))).toBeNull();
    expect(extractHtmlDiscount(html('<span>91% off</span>'))).toBeNull();
    expect(extractHtmlDiscount(html('<span>5% off</span>'))).toBe(5);
    expect(extractHtmlDiscount(html('<span>90% off</span>'))).toBe(90);
  });
  it('uses an in-range value when others are out of range', () => {
    expect(extractHtmlDiscount(html(`<ol>${pair('R100', 'R5')}${pair('R100', 'R75')}</ol>`))).toBe(25);
  });
  it('gives null for a page with nothing to read, an empty page and text that is not a page', () => {
    for (const text of ['', '   ', 'plain text', html('<p>Hello</p>'), html('<ol><li>R100</li><li>R200</li></ol>'), '<div id="root"></div>']) {
      expect(extractHtmlDiscount(text), text.slice(0, 30)).toBeNull();
    }
  });
  it('never throws', () => {
    for (const text of ['<', '<<<', '<s>', '<span class="', 'was R', 'R', '\u0001', '<nav>', '</nav>']) expect(() => extractHtmlDiscount(text), text).not.toThrow();
  });
});

describe('size and safety', () => {
  for (const [name, text] of Object.entries(hostilePages())) {
    it(`handles ${name} (3 MiB) in under a second`, () => {
      const started = Date.now();
      const result = extractHtmlDiscount(text);
      expect(Date.now() - started).toBeLessThan(1000);
      expect(result === null || (result >= 5 && result <= 90)).toBe(true);
    });
  }
  it('handles a real-sized sale page (3 MiB of products) in under a second', () => {
    const page = html(`<ol>${pair('R200', 'R150').repeat(60_000)}</ol>`);
    expect(page.length).toBeGreaterThan(2 * 1024 * 1024);
    const started = Date.now();
    expect(extractHtmlDiscount(page)).toBe(25);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
