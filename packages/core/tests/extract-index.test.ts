import { describe, expect, it } from 'vitest';
import { MAX_DISCOUNT, MIN_DISCOUNT, extractDiscount } from '../src/extract';

const page = '<html><body><ol><li><span class="old-price">R200</span><span>R150</span></li></ol></body></html>'; // 25 by its markup
const dataPage = '<html><body><script>{"listPrice":200,"price":100}</script></body></html>'; // 50 by its data
const feed = JSON.stringify({ products: [{ variants: [{ price: '60.00', compare_at_price: '100.00' }] }] }); // 40 by its feed

describe('the range', () => {
  it('is 5 to 90', () => {
    expect(MIN_DISCOUNT).toBe(5);
    expect(MAX_DISCOUNT).toBe(90);
  });
});

describe('extractDiscount (AC1)', () => {
  it('html reads the page', () => {
    expect(extractDiscount('html', { page })).toBe(25);
    expect(extractDiscount('html', { page, feed })).toBe(25); // a feed is not used by this method
  });
  it('structured_data reads the data in the page, else the markup', () => {
    expect(extractDiscount('structured_data', { page: dataPage })).toBe(50);
    expect(extractDiscount('structured_data', { page })).toBe(25);
  });
  it('shopify_json uses the feed when it gives a percentage', () => {
    expect(extractDiscount('shopify_json', { page, feed })).toBe(40);
  });
  it('shopify_json falls back to the page when there is no feed, or the feed is empty, broken or gives nothing', () => {
    for (const bad of [undefined, null, '', 'not json', '{"products":[]}', JSON.stringify({ products: [{ variants: [{ price: '100', compare_at_price: '100' }] }] })]) {
      expect(extractDiscount('shopify_json', { page, feed: bad }), String(bad)).toBe(25);
    }
  });
  it('shopify_json gives null when neither the feed nor the page has anything', () => {
    expect(extractDiscount('shopify_json', { page: '<html></html>', feed: null })).toBeNull();
  });
  it('manual and an unknown method give null whatever the input', () => {
    for (const method of ['manual', 'unknown', '', 'HTML']) expect(extractDiscount(method, { page, feed }), method).toBeNull();
  });
  it('never throws', () => {
    for (const method of ['html', 'structured_data', 'shopify_json', 'manual']) {
      expect(() => extractDiscount(method, { page: '<<<', feed: '{' }), method).not.toThrow();
    }
  });
});
