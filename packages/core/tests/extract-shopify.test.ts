import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractShopifyDiscount } from '../src/extract/shopify-json';

const feed = (name: string): string => readFileSync(fileURLToPath(new URL(`./fixtures/feeds/${name}`, import.meta.url)), 'utf-8');
const feedsManifest = JSON.parse(feed('index.json')) as Array<{ file: string; store: string; synthetic: boolean; expectPercent: number | null }>;
const json = (products: unknown): string => JSON.stringify({ products });
const variant = (price: unknown, compare: unknown) => ({ products: [{ variants: [{ price, compare_at_price: compare }] }] });

describe('the saved feeds (AC2, AC6)', () => {
  it('has a manifest that names every feed file, with its expected percentage', () => {
    expect(feedsManifest.length).toBeGreaterThanOrEqual(8);
    for (const entry of feedsManifest) expect(entry.expectPercent === null || Number.isInteger(entry.expectPercent), entry.file).toBe(true);
  });
  for (const entry of feedsManifest) {
    it(`${entry.file} gives ${String(entry.expectPercent)}`, () => {
      expect(extractShopifyDiscount(feed(entry.file))).toBe(entry.expectPercent);
    });
  }
});

describe('extractShopifyDiscount', () => {
  it('works out the percentage from compare_at_price down to price', () => {
    expect(extractShopifyDiscount(JSON.stringify(variant('50.00', '100.00')))).toBe(50);
    expect(extractShopifyDiscount(JSON.stringify(variant('499.00', '699.00')))).toBe(29);
  });
  it('takes strings and numbers alike', () => {
    expect(extractShopifyDiscount(JSON.stringify(variant(50, 100)))).toBe(50);
    expect(extractShopifyDiscount(JSON.stringify(variant('50', 100)))).toBe(50);
    expect(extractShopifyDiscount(JSON.stringify(variant(50.0, '100.00')))).toBe(50);
  });
  it('takes the largest of several products and variants', () => {
    const products = [
      { variants: [{ price: '90', compare_at_price: '100' }, { price: '80', compare_at_price: '100' }] },
      { variants: [{ price: '60', compare_at_price: '100' }] },
      { variants: [{ price: '70', compare_at_price: '100' }] },
    ];
    expect(extractShopifyDiscount(json(products))).toBe(40);
  });
  it('rounds to the nearest whole percent', () => {
    expect(extractShopifyDiscount(JSON.stringify(variant('349.00', '499.00')))).toBe(30); // 30.06
    expect(extractShopifyDiscount(JSON.stringify(variant('9.95', '10.00')))).toBeNull(); // 0.5 percent: out of range
    expect(extractShopifyDiscount(JSON.stringify(variant('92.50', '100.00')))).toBe(8); // 7.5 rounds up
  });
  it('skips a variant with no usable compare-at price', () => {
    for (const compare of [null, '', '0.00', '0', 'abc', undefined, {}, [], true]) {
      expect(extractShopifyDiscount(JSON.stringify(variant('100.00', compare))), JSON.stringify(compare)).toBeNull();
    }
  });
  it('skips a compare-at price that is not above the price', () => {
    expect(extractShopifyDiscount(JSON.stringify(variant('100.00', '100.00')))).toBeNull();
    expect(extractShopifyDiscount(JSON.stringify(variant('100.00', '80.00')))).toBeNull();
  });
  it('skips a price that is not a number', () => {
    for (const price of [null, '', 'abc', undefined, '-5']) expect(extractShopifyDiscount(JSON.stringify(variant(price, '100.00'))), String(price)).toBeNull();
  });
  it('ignores percentages below 5 and above 90, and keeps 5 and 90', () => {
    expect(extractShopifyDiscount(JSON.stringify(variant('96.00', '100.00')))).toBeNull(); // 4
    expect(extractShopifyDiscount(JSON.stringify(variant('9.00', '100.00')))).toBeNull(); // 91
    expect(extractShopifyDiscount(JSON.stringify(variant('95.00', '100.00')))).toBe(5);
    expect(extractShopifyDiscount(JSON.stringify(variant('10.00', '100.00')))).toBe(90);
  });
  it('uses an in-range variant even when others are out of range', () => {
    const products = [{ variants: [{ price: '3.00', compare_at_price: '100.00' }, { price: '75.00', compare_at_price: '100.00' }, { price: '99.00', compare_at_price: '100.00' }] }];
    expect(extractShopifyDiscount(json(products))).toBe(25);
  });
  it('gives null, without throwing, for anything that is not a feed', () => {
    for (const text of ['', 'not json', '{', 'null', '[]', '{}', '{"products":null}', '{"products":{}}', '{"products":[]}', '{"products":[null,1,"a",[]]}', '{"products":[{}]}', '{"products":[{"variants":null}]}', '<html></html>', '"text"', '5']) {
      expect(() => extractShopifyDiscount(text), text).not.toThrow();
      expect(extractShopifyDiscount(text), text).toBeNull();
    }
  });
  it('reads only the first 250 products (the request asks for 250)', () => {
    const filler = Array.from({ length: 250 }, () => ({ variants: [{ price: '100', compare_at_price: '100' }] }));
    const late = [...filler, { variants: [{ price: '50', compare_at_price: '100' }] }];
    expect(extractShopifyDiscount(json(late))).toBeNull();
    expect(extractShopifyDiscount(json([...filler.slice(1), { variants: [{ price: '50', compare_at_price: '100' }] }]))).toBe(50);
  });
  it('is fast on a feed of 250 products with many variants', () => {
    const products = Array.from({ length: 250 }, (_, i) => ({ variants: Array.from({ length: 100 }, (_, j) => ({ price: String(50 + ((i + j) % 40)), compare_at_price: '100.00' })) }));
    const started = Date.now();
    expect(extractShopifyDiscount(json(products))).toBe(50);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
