// Linear scanners for fetched pages, shared by the page validator (Story 3.3) and the discount extractors
// (Story 3.4). Pure: no I/O, no clock. Every loop only ever moves forward with `indexOf`, so a hostile 3 MiB page
// takes time in proportion to its size and no more. (QA found a quadratic version in Story 3.3: do not undo this.)

export const MAX_COUNT = 100_000;

// Amounts as South African stores write them: "R199", "R 1 299.00", "R1,299". Not a letter or a digit on either side.
export const AMOUNT = /(?<![A-Za-z0-9])R[ ]?\d{1,3}(?:[ ,]\d{3})*(?:\.\d{2})?(?![A-Za-z0-9])/g;
// The same amounts for the extractors, which also take a price with no thousands separator ("R1299.00"). The validator's
// `AMOUNT` stays as it was (it only counts), but an extractor that skipped "R1299" would pair the neighbouring product's
// price with a marker and report a wrong percentage.
export const PRICE = /(?<![A-Za-z0-9])R[ ]?(?:\d{1,3}(?:[ ,]\d{3})+|\d+)(?:\.\d{2})?(?![A-Za-z0-9])/g;
// A text element that is only a percentage-off badge: "30% off", "-50%", "save 25%", "up to 40% off".
export const PERCENT_NODE = /^(?:(?:save|up to|extra)\s+)*[-\u2212]?\s?\d{1,2}\s?%(?:\s*(?:off|discount))?$/i;
// A class, a data attribute or a label that marks an old (was) price.
export const WAS_MARKER =
  /(?:class|data-price-type|aria-label)=["'][^"'<>]{0,200}?(?:old[-_]?price|oldprice|was[-_]?price|price[-_]?was|price--old|price-old|standard[-_ ]?price|compare[-_]?(?:at[-_])?price|original[-_]?price|price[-_]?before|strike[a-z-]*|line-through|list[-_]?price|rrp)/gi;
export const WAS_TAG = /<(?:s|del|strike)(?=[\s>])/gi;
export const WAS_TEXT = /\bwas\s+R\s?\d/gi;
export const STRUCTURED =
  /["'](?:compare_at_price|compareAtPrice|originalPrice|wasPrice|oldPrice|listPrice|priceBeforeDiscount|strikePrice)["']\s*:\s*["']?[1-9]/gi;

/** How many matches a pattern has in a text, counting at most `MAX_COUNT`. The pattern must have the `g` flag. */
export function count(pattern: RegExp, text: string): number {
  let n = 0;
  const matches = text.matchAll(pattern);
  for (let next = matches.next(); next.done !== true; next = matches.next()) {
    n += 1;
    if (n >= MAX_COUNT) break;
  }
  return n;
}

export interface Parsed {
  /** The page without the removed blocks (always `<script>` and `<style>`, and any extra tags asked for). */
  markup: string;
  /** What was inside the script blocks, joined (for structured data). */
  scriptText: string;
  /** How many `<script>` blocks there were. */
  scripts: number;
}

interface BlockKind {
  open: string;
  close: string;
  /** Keep what is inside (script data) instead of dropping it. */
  capture: boolean;
  /** An opening with no closing tag swallows the rest of the page (script, style), else the tag is just left alone. */
  unclosedIsRest: boolean;
  /** The character after the tag name must end the name (so `<nav` is not `<navigation`). */
  needsBoundary: boolean;
}

const SCRIPT: BlockKind = { open: '<script', close: '</script', capture: true, unclosedIsRest: true, needsBoundary: false };
const STYLE: BlockKind = { open: '<style', close: '</style', capture: false, unclosedIsRest: true, needsBoundary: false };

function extraKind(tag: string): BlockKind {
  return { open: `<${tag}`, close: `</${tag}`, capture: false, unclosedIsRest: false, needsBoundary: true };
}

/** The next real opening of a block at or after `from`, or -1. */
function findOpen(lower: string, kind: BlockKind, from: number): number {
  let at = lower.indexOf(kind.open, from);
  while (at !== -1 && kind.needsBoundary) {
    const after = lower.charAt(at + kind.open.length);
    if (after === '>' || after === '/' || after === ' ' || after === '\n' || after === '\t' || after === '\r') break;
    at = lower.indexOf(kind.open, at + 1);
  }
  return at;
}

/**
 * Removes the script and style blocks of a page, and the blocks of `extraTags` (for example `nav`, `header` and
 * `footer`), with `indexOf`. The next opening of each kind is remembered and looked up again only once `pos` has
 * passed it, so an unclosed or missing tag cannot make the work quadratic.
 */
export function removeBlocks(page: string, extraTags: readonly string[] = []): Parsed {
  const lower = page.toLowerCase();
  const kinds = [SCRIPT, STYLE, ...extraTags.map(extraKind)];
  const next = kinds.map((kind) => findOpen(lower, kind, 0));
  const kept: string[] = [];
  const scriptParts: string[] = [];
  let scripts = 0;
  let pos = 0;
  while (pos < page.length) {
    let pick = -1;
    for (let i = 0; i < kinds.length; i++) {
      const kind = kinds[i] as BlockKind;
      if (next[i] !== -1 && (next[i] as number) < pos) next[i] = findOpen(lower, kind, pos);
      if (next[i] !== -1 && (pick === -1 || (next[i] as number) < (next[pick] as number))) pick = i;
    }
    if (pick === -1) {
      kept.push(page.slice(pos));
      break;
    }
    const kind = kinds[pick] as BlockKind;
    const start = next[pick] as number;
    kept.push(page.slice(pos, start));
    const bodyStart = lower.indexOf('>', start);
    if (bodyStart === -1) break;
    const end = lower.indexOf(kind.close, bodyStart);
    if (kind.capture) {
      scripts += 1;
      scriptParts.push(page.slice(bodyStart + 1, end === -1 ? page.length : end));
    }
    if (end === -1) {
      if (kind.unclosedIsRest) break;
      next[pick] = -1; // no closing tag anywhere after this: there will be none for a later opening either
      pos = bodyStart + 1; // keep the content, drop only the opening tag
      continue;
    }
    const close = lower.indexOf('>', end);
    pos = close === -1 ? page.length : close + 1;
  }
  return { markup: kept.join(''), scriptText: scriptParts.join('\n'), scripts };
}

/** The visible text nodes of the markup, in order. Linear: `indexOf` only ever moves forward. */
export function textNodes(markup: string): string[] {
  const nodes: string[] = [];
  let pos = 0;
  while (pos < markup.length) {
    const lt = markup.indexOf('<', pos);
    if (lt === -1) {
      nodes.push(markup.slice(pos));
      break;
    }
    if (lt > pos) nodes.push(markup.slice(pos, lt));
    const gt = markup.indexOf('>', lt);
    if (gt === -1) break;
    pos = gt + 1;
  }
  return nodes.map((node) => node.replace(/&nbsp;|&#160;|&#xa0;|\u00a0/gi, ' ').trim()).filter((node) => node !== '');
}

/** The text of the first `<title>` or `<h1>`, with tags removed and at most 300 characters. */
export function firstElementText(markup: string, lower: string, tag: string): string {
  const open = lower.indexOf(`<${tag}`);
  if (open === -1) return '';
  const start = lower.indexOf('>', open);
  if (start === -1) return '';
  const end = lower.indexOf(`</${tag}`, start);
  const raw = markup.slice(start + 1, end === -1 ? start + 301 : Math.min(end, start + 301));
  return textNodes(raw).join(' ');
}

export interface AmountAt {
  /** The number: `R 1,299.99` is 1299.99 and `R1 299` is 1299. */
  value: number;
  /** Where it starts in the text it was found in. */
  index: number;
}

/** Every amount in a text, with its number and its position (at most `MAX_COUNT`). */
export function amountsWithPositions(text: string): AmountAt[] {
  const out: AmountAt[] = [];
  const matches = text.matchAll(PRICE);
  for (let next = matches.next(); next.done !== true && out.length < MAX_COUNT; next = matches.next()) {
    const value = Number(next.value[0].replace(/[R ,]/g, ''));
    if (Number.isFinite(value)) out.push({ value, index: next.value.index ?? 0 });
  }
  return out;
}
