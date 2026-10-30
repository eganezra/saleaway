import { removeBlocks } from '../page-scan';
import { extractHtmlDiscount } from './html';
import { largest, percentOff } from './range';

// Story 3.4: the deepest discount from the data in a page (script blocks, including `ld+json`), for a store whose
// page carries its prices as data rather than in its markup. Falls back to the markup when the data holds none.

const WINDOW = 200; // the two fields are within this many characters of each other
const NUMBER = String.raw`["']?(\d+(?:\.\d+)?)["']?`;
// a list price (or was price) field, then a price field: {"listPrice":1354,"price":504}
const LIST_THEN_PRICE = new RegExp(
  String.raw`["'](?:compare_at_price|compareAtPrice|originalPrice|wasPrice|oldPrice|listPrice|priceBeforeDiscount|strikePrice)["']\s*:\s*${NUMBER}[^]{0,${WINDOW}}?["'](?:price|salePrice|currentPrice|sellingPrice|specialPrice)["']\s*:\s*${NUMBER}`,
  'gi',
);
// schema.org AggregateOffer, in either order
const HIGH_THEN_LOW = new RegExp(String.raw`["']highPrice["']\s*:\s*${NUMBER}[^]{0,${WINDOW}}?["']lowPrice["']\s*:\s*${NUMBER}`, 'gi');
const LOW_THEN_HIGH = new RegExp(String.raw`["']lowPrice["']\s*:\s*${NUMBER}[^]{0,${WINDOW}}?["']highPrice["']\s*:\s*${NUMBER}`, 'gi');
const MAX_MATCHES = 100_000;

function collect(pattern: RegExp, text: string, reversed: boolean, out: Array<number | null>): void {
  const matches = text.matchAll(pattern);
  let n = 0;
  for (let next = matches.next(); next.done !== true && n < MAX_MATCHES; next = matches.next()) {
    n += 1;
    const first = Number(next.value[1]);
    const second = Number(next.value[2]);
    out.push(reversed ? percentOff(second, first) : percentOff(first, second));
  }
}

/** The deepest discount in the page's data, from 5 to 90 percent; else what the markup gives; else null. Never throws. */
export function extractStructuredDiscount(page: string): number | null {
  const { scriptText } = removeBlocks(page);
  const found: Array<number | null> = [];
  collect(LIST_THEN_PRICE, scriptText, false, found);
  collect(HIGH_THEN_LOW, scriptText, false, found);
  collect(LOW_THEN_HIGH, scriptText, true, found);
  return largest(found) ?? extractHtmlDiscount(page);
}
