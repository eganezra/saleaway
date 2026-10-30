import type { ExtractionMethod } from '../types';
import { extractHtmlDiscount } from './html';
import { MAX_DISCOUNT, MIN_DISCOUNT } from './range';
import { extractShopifyDiscount } from './shopify-json';
import { extractStructuredDiscount } from './structured-data';

export { MAX_DISCOUNT, MIN_DISCOUNT };
export { extractHtmlDiscount, extractShopifyDiscount, extractStructuredDiscount };

/**
 * The deepest discount of a store, from 5 to 90 percent, by the store's extraction method (FR8), or null when
 * nothing can be read (the record is then "On sale", never an error). A `shopify_json` store uses its product feed
 * when one was read and gave a percentage, else its page. `manual` and any unknown method give null: the operator's
 * override supplies the number. Never throws.
 */
export function extractDiscount(method: ExtractionMethod | string, input: { page: string; feed?: string | null }): number | null {
  try {
    switch (method) {
      case 'shopify_json':
        return (input.feed ? extractShopifyDiscount(input.feed) : null) ?? extractHtmlDiscount(input.page);
      case 'html':
        return extractHtmlDiscount(input.page);
      case 'structured_data':
        return extractStructuredDiscount(input.page);
      default:
        return null;
    }
  } catch {
    return null;
  }
}
