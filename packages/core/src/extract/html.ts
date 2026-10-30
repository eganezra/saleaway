import { PERCENT_NODE, WAS_MARKER, WAS_TAG, WAS_TEXT, amountsWithPositions, removeBlocks, textNodes } from '../page-scan';
import type { AmountAt } from '../page-scan';
import { inRange, largest, percentOff } from './range';

// Story 3.4: the deepest discount on a sale page, read from its markup. Pure and linear (see page-scan.ts).
//   1. was/now price pairs: price-based, so the strongest evidence;
//   2. percentage labels (a text element that is only "30% off", "-25%", "save 25%").
// A pair wins over a label even when the label is bigger: a label can come from a banner, a price pair cannot.

const PAIR_WAS_WINDOW = 300; // the was amount is the first one this close after the marker
const PAIR_NOW_WINDOW = 400; // the now amount is the nearest smaller one this close to the marker
const WAS_TOKEN = '\u0001';
const NO_BLOCKS = ['nav', 'header', 'footer'] as const; // a menu link such as "30% Off" is not a product discount
// aria-label="Standard Price ZAR 249.00, Sale Price ZAR 140.00"
const LABELLED_PAIR = /standard price\s*(?:zar|r)?\s*([\d][\d ,.]*?)\s*[,;]\s*sale price\s*(?:zar|r)?\s*([\d][\d ,.]*)/i;

function amountNumber(text: string): number | null {
  const value = Number(text.replace(/[ ,]/g, ''));
  return Number.isFinite(value) ? value : null;
}

/**
 * The markup as flat text: every tag becomes a space, and a tag that marks an old price puts a token in front of it,
 * so that an amount and the old-price marker next to it can be told apart by their positions. Also returns the
 * pairs that an aria-label gives in full.
 */
function flatten(markup: string): { flat: string; labelled: number[] } {
  const parts: string[] = [];
  const labelled: number[] = [];
  let pos = 0;
  while (pos < markup.length) {
    const lt = markup.indexOf('<', pos);
    if (lt === -1) {
      parts.push(markup.slice(pos));
      break;
    }
    if (lt > pos) parts.push(markup.slice(pos, lt));
    const gt = markup.indexOf('>', lt);
    if (gt === -1) break;
    const tag = markup.slice(lt, gt + 1);
    parts.push(isWasTag(tag) ? ` ${WAS_TOKEN} ` : ' ');
    const pair = LABELLED_PAIR.exec(tag);
    if (pair !== null) {
      const was = amountNumber(pair[1] as string);
      const now = amountNumber(pair[2] as string);
      if (was !== null && now !== null) {
        const percent = percentOff(was, now);
        if (percent !== null) labelled.push(percent);
      }
    }
    pos = gt + 1;
  }
  // one space between neighbours, so "R" and "200" in two tags read as "R 200"
  return { flat: parts.join('').replace(/&nbsp;|&#160;|&#xa0;/gi, ' ').replace(/\s+/g, ' '), labelled };
}

function isWasTag(tag: string): boolean {
  WAS_MARKER.lastIndex = 0;
  WAS_TAG.lastIndex = 0;
  const hit = WAS_MARKER.test(tag) || WAS_TAG.test(tag);
  WAS_MARKER.lastIndex = 0;
  WAS_TAG.lastIndex = 0;
  return hit;
}

/** The percentages of the was/now pairs in a flattened page, and of the pairs an aria-label gave in full. */
function pairPercents(flat: string, labelled: number[]): Array<number | null> {
  // The "was R499" text form carries its marker in the text itself: turn it into a token too.
  const text = flat.replace(WAS_TEXT, (match) => `${WAS_TOKEN} ${match.slice(3)}`);
  const amounts: AmountAt[] = amountsWithPositions(text);
  const out: Array<number | null> = [...labelled];
  let from = 0;
  for (let at = text.indexOf(WAS_TOKEN); at !== -1; at = text.indexOf(WAS_TOKEN, at + 1)) {
    // amounts are in position order: the was amount is the first one at or after the marker
    while (from < amounts.length && (amounts[from] as AmountAt).index < at) from += 1;
    const was = amounts[from];
    if (was === undefined || was.index - at > PAIR_WAS_WINDOW) continue;
    let now: AmountAt | undefined;
    // the now amount is the nearest smaller one: it is among the few amounts around the was amount
    for (let i = Math.max(0, from - 6); i < Math.min(amounts.length, from + 7); i++) {
      const candidate = amounts[i] as AmountAt;
      if (candidate === was || candidate.value >= was.value || Math.abs(candidate.index - at) > PAIR_NOW_WINDOW) continue;
      if (now === undefined || Math.abs(candidate.index - at) < Math.abs(now.index - at)) now = candidate;
    }
    if (now !== undefined) out.push(percentOff(was.value, now.value));
  }
  return out;
}

/** The deepest discount on a page, from 5 to 90 percent, or null when nothing can be read. Never throws. */
export function extractHtmlDiscount(page: string): number | null {
  const { markup } = removeBlocks(page, NO_BLOCKS);
  const { flat, labelled } = flatten(markup);
  const pairs = largest(pairPercents(flat, labelled));
  if (pairs !== null) return pairs;
  const labels: Array<number | null> = [];
  for (const node of textNodes(markup)) {
    if (node.length > 40 || !PERCENT_NODE.test(node)) continue;
    const digits = /\d{1,2}/.exec(node);
    labels.push(digits === null ? null : inRange(Number(digits[0])));
  }
  return largest(labels);
}
