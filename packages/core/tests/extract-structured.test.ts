import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractStructuredDiscount } from '../src/extract/structured-data';
import { hostilePages } from './helpers/hostile';

const fixture = (name: string): string => readFileSync(fileURLToPath(new URL(`./fixtures/pages/${name}`, import.meta.url)), 'utf-8');
const manifest = JSON.parse(fixture('index.json')) as Array<{ file: string; expectPercent: { html: number | null; structured_data: number | null } }>;
const page = (script: string, body = ''): string => `<html><head><title>x</title></head><body>${body}<script type="application/json">${script}</script></body></html>`;

describe('the saved page samples (AC3, AC6)', () => {
  for (const entry of manifest) {
    it(`${entry.file} gives ${String(entry.expectPercent.structured_data)}`, () => {
      expect(extractStructuredDiscount(fixture(entry.file))).toBe(entry.expectPercent.structured_data);
    });
  }
  it('reads the Loot sample from the data in its script, which its markup does not give', () => {
    expect(extractStructuredDiscount(fixture('loot.html'))).toBe(64);
  });
});

describe('list price and price fields', () => {
  it('works out the percentage for each key pair', () => {
    for (const key of ['listPrice', 'compare_at_price', 'compareAtPrice', 'originalPrice', 'wasPrice', 'oldPrice', 'priceBeforeDiscount', 'strikePrice']) {
      expect(extractStructuredDiscount(page(`{"${key}":200,"price":150}`)), key).toBe(25);
    }
  });
  it('takes the other price field names', () => {
    for (const key of ['price', 'salePrice', 'currentPrice', 'sellingPrice', 'specialPrice']) {
      expect(extractStructuredDiscount(page(`{"listPrice":200,"${key}":150}`)), key).toBe(25);
    }
  });
  it('takes quoted numbers, decimals and other fields between the two', () => {
    expect(extractStructuredDiscount(page('{"listPrice":"1354.00","price":"504.00"}'))).toBe(63);
    expect(extractStructuredDiscount(page('{"listPrice":1354,"sku":"A1","name":"Product","price":504}'))).toBe(63);
  });
  it('takes the largest of several products', () => {
    expect(extractStructuredDiscount(page('[{"listPrice":100,"price":90},{"listPrice":100,"price":60},{"listPrice":100,"price":80}]'))).toBe(40);
  });
  it('does not pair two fields that are far apart', () => {
    expect(extractStructuredDiscount(page(`{"listPrice":200,"filler":"${'x'.repeat(400)}","price":100}`))).toBeNull();
  });
  it('reads a field in a ld+json block too', () => {
    const ld = '<script type="application/ld+json">{"@type":"Offer","listPrice":200,"price":120}</script>';
    expect(extractStructuredDiscount(`<html><body>${ld}</body></html>`)).toBe(40);
  });
});

describe('schema.org AggregateOffer', () => {
  it('works out the percentage from highPrice to lowPrice, in either order', () => {
    expect(extractStructuredDiscount(page('{"@type":"AggregateOffer","highPrice":"200.00","lowPrice":"150.00"}'))).toBe(25);
    expect(extractStructuredDiscount(page('{"@type":"AggregateOffer","lowPrice":150,"highPrice":200}'))).toBe(25);
  });
});

describe('the range and what falls back', () => {
  it('ignores below 5 and above 90, and keeps 5 and 90', () => {
    expect(extractStructuredDiscount(page('{"listPrice":100,"price":96}'))).toBeNull();
    expect(extractStructuredDiscount(page('{"listPrice":100,"price":9}'))).toBeNull();
    expect(extractStructuredDiscount(page('{"listPrice":100,"price":95}'))).toBe(5);
    expect(extractStructuredDiscount(page('{"listPrice":100,"price":10}'))).toBe(90);
  });
  it('ignores a list price that is not above the price, and a zero', () => {
    expect(extractStructuredDiscount(page('{"listPrice":100,"price":100}'))).toBeNull();
    expect(extractStructuredDiscount(page('{"listPrice":80,"price":100}'))).toBeNull();
    expect(extractStructuredDiscount(page('{"listPrice":0,"price":0}'))).toBeNull();
  });
  it('falls back to the markup when the data holds nothing', () => {
    expect(extractStructuredDiscount(page('{"other":1}', '<ol><li><span>35% off</span></li></ol>'))).toBe(35);
    expect(extractStructuredDiscount(page('{"other":1}', '<ol><li><span class="old-price">R200</span><span>R150</span></li></ol>'))).toBe(25);
  });
  it('prefers the data when it gives a percentage', () => {
    expect(extractStructuredDiscount(page('{"listPrice":100,"price":50}', '<span>20% off</span>'))).toBe(50);
  });
  it('gives null for nothing readable, and never throws', () => {
    for (const text of ['', 'text', '<script>', page('{"listPrice":'), page('null')]) {
      expect(() => extractStructuredDiscount(text), text).not.toThrow();
      expect(extractStructuredDiscount(text), text).toBeNull();
    }
  });
});

describe('size and safety', () => {
  for (const [name, text] of Object.entries(hostilePages())) {
    it(`handles ${name} (3 MiB) in under a second`, () => {
      const started = Date.now();
      const result = extractStructuredDiscount(text);
      expect(Date.now() - started).toBeLessThan(1000);
      expect(result === null || (result >= 5 && result <= 90)).toBe(true);
    });
  }
  it('handles 3 MiB of price fields in under a second', () => {
    const data = `[${'{"listPrice":200,"price":150},'.repeat(100_000)}{}]`;
    const started = Date.now();
    expect(extractStructuredDiscount(page(data))).toBe(25);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
