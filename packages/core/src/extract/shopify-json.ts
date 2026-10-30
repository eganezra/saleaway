import { largest, percentOff } from './range';

const MAX_PRODUCTS = 250; // the request asks for 250 (`?limit=250`)

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())) return Number(value);
  return null;
}

/**
 * The deepest discount in a Shopify collection's product feed (`/collections/<handle>/products.json`): the largest
 * percentage from a variant's `compare_at_price` down to its `price`, among those from 5 to 90 percent. A variant
 * with no compare-at price, a compare-at price that is not above the price, or values that are not numbers
 * is skipped. Anything that is not a feed gives null. Never throws.
 */
export function extractShopifyDiscount(feedJson: string): number | null {
  let data: unknown;
  try {
    data = JSON.parse(feedJson);
  } catch {
    return null;
  }
  const products = (data as { products?: unknown } | null)?.products;
  if (!Array.isArray(products)) return null;
  const found: Array<number | null> = [];
  for (const product of products.slice(0, MAX_PRODUCTS)) {
    const variants = (product as { variants?: unknown } | null)?.variants;
    if (!Array.isArray(variants)) continue;
    for (const variant of variants) {
      const was = toNumber((variant as { compare_at_price?: unknown } | null)?.compare_at_price);
      const now = toNumber((variant as { price?: unknown } | null)?.price);
      if (was !== null && now !== null) found.push(percentOff(was, now));
    }
  }
  return largest(found);
}
