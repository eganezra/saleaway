import { discard, fetchPage } from '@saleaway/core';
import { productsJsonUrl } from './shopify';
import type { Deps } from './types';

// MEASUREMENT ONLY (Story 3.2). Switched on by MEASURE_CPU=true. It stands in for the page validation and
// the discount extraction of Stories 3.3 and 3.4, which do not exist yet, so the CPU a real page costs can
// be measured on the deployed Worker. It keeps only counts: no page text is stored or logged.

interface ProbeInput {
  slug: string;
  extractionMethod: string;
  saleUrl: string;
  response: Response;
}

async function countBytes(body: ReadableStream<Uint8Array> | null): Promise<number> {
  if (!body) return 0;
  const reader = body.getReader();
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return bytes;
    bytes += value.byteLength;
  }
}

function countShopifyProducts(data: unknown): { products: number; comparePriced: number } {
  const products = (data as { products?: unknown })?.products;
  if (!Array.isArray(products)) return { products: 0, comparePriced: 0 };
  let comparePriced = 0;
  for (const product of products) {
    const variants = (product as { variants?: unknown })?.variants;
    if (!Array.isArray(variants)) continue;
    for (const variant of variants) {
      const compare = (variant as { compare_at_price?: unknown })?.compare_at_price;
      if (compare !== null && compare !== undefined && compare !== '') comparePriced += 1;
    }
  }
  return { products: products.length, comparePriced };
}

/** Does representative work on a real page and logs one `cpu_probe` line. Never throws and never changes a result. */
export async function runProbe(input: ProbeInput, deps: Deps): Promise<void> {
  const { slug, extractionMethod, saleUrl, response } = input;
  try {
    if (!deps.createRewriter) {
      deps.log.warn('cpu_probe_skipped', { slug, reason: 'no HTMLRewriter available' });
      await discard(response);
      return;
    }
    const counts = { anchors: 0, scripts: 0, spans: 0, priceElements: 0, jsonLd: 0 };
    const rewriter = deps
      .createRewriter()
      .on('a', { element: () => void (counts.anchors += 1) })
      .on('script', { element: () => void (counts.scripts += 1) })
      .on('span', { element: () => void (counts.spans += 1) })
      .on('[class*="price"]', { element: () => void (counts.priceElements += 1) })
      .on('script[type="application/ld+json"]', { element: () => void (counts.jsonLd += 1) });
    const bytes = await countBytes(rewriter.transform(response).body);

    let shopify = { products: 0, comparePriced: 0 };
    if (extractionMethod === 'shopify_json') {
      const page = await fetchPage(productsJsonUrl(saleUrl), deps.fetch);
      if (page.ok && page.status >= 200 && page.status <= 299) {
        shopify = countShopifyProducts(await page.response.json());
      } else if (page.ok) {
        await discard(page.response);
      }
    }
    deps.log.info('cpu_probe', { slug, bytes, ...counts, ...shopify });
  } catch (err) {
    deps.log.warn('cpu_probe_failed', { slug, err });
  }
}
