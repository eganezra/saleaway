import { redirectedAway } from './classify';

// Sale page validation (Story 3.3): is this fetched page a real sale? Pure: no I/O, no clock. The caller reads
// the page and passes its text in. A page is called "not a sale" only on positive evidence; when it cannot be
// judged (a JavaScript application, a page cut at the size limit) the answer is "unverifiable" (FR7).
//
// All scanning is linear in the text: no pattern here can backtrack badly, and every loop moves forward with
// `indexOf`, so a hostile 3 MiB page cannot make the work grow faster than the page.

export type ValidationVerdict = 'valid' | 'ended' | 'blocked' | 'unverifiable';

export type ValidationReason =
  | 'discounts_found'
  | 'redirected_away'
  | 'error_page'
  | 'empty_listing'
  | 'no_discounts'
  | 'challenge_page'
  | 'login_page'
  | 'javascript_shell'
  | 'unreadable';

export interface ValidationSignals {
  /** Price-like amounts in the visible text, for example "R 1 299.00" or "R199". */
  amounts: number;
  /** Percentage-off labels or badges: a text element that is only "30% off", "save 25%" or "-40%". */
  percentLabels: number;
  /** Was/now pairs: an old, strike-through or "was" price element. */
  wasPrices: number;
  /** Structured-data hints: a price-before-discount field with a value. */
  structured: number;
  /** `<script>` tags. */
  scripts: number;
  /** Length of the visible text. */
  textLength: number;
}

export interface ValidationResult {
  verdict: ValidationVerdict;
  reason: ValidationReason;
  signals: ValidationSignals;
}

export interface PageInput {
  text: string;
  expectedUrl: string;
  finalUrl: string;
  /** The page was cut at the size limit, so the missing part may hold the discounts. */
  truncated: boolean;
}

/** A discount signal is not enough alone (a banner in a footer), so a sale needs this many ... */
const MIN_DISCOUNT_SIGNALS = 2; // [Assumption]
/** ... and this many price-like amounts. */
const MIN_AMOUNTS_FOR_SALE = 2; // [Assumption]
/** A page with at least this many amounts lists priced products. */
const MIN_AMOUNTS_FOR_LISTING = 3; // [Assumption]
const MIN_SCRIPTS_FOR_SHELL = 8; // [Assumption]
const SHELL_TEXT_LENGTH = 1500; // [Assumption]
const CHALLENGE_WINDOW = 4096;
const MAX_COUNT = 100_000;

const AMOUNT = /(?<![A-Za-z0-9])R[ ]?\d{1,3}(?:[ ,]\d{3})*(?:\.\d{2})?(?![A-Za-z0-9])/g;
// A text element that is only a percentage-off badge: "30% off", "-50%", "save 25%", "up to 40% off".
const PERCENT_NODE = /^(?:(?:save|up to|extra)\s+)*[-\u2212]?\s?\d{1,2}\s?%(?:\s*(?:off|discount))?$/i;
// A class, a data attribute or a label that marks an old (was) price.
const WAS_MARKER =
  /(?:class|data-price-type|aria-label)=["'][^"'<>]{0,200}?(?:old[-_]?price|oldprice|was[-_]?price|price[-_]?was|price--old|price-old|standard[-_ ]?price|compare[-_]?(?:at[-_])?price|original[-_]?price|price[-_]?before|strike[a-z-]*|line-through|list[-_]?price|rrp)/gi;
const WAS_TAG = /<(?:s|del|strike)(?=[\s>])/gi;
const WAS_TEXT = /\bwas\s+R\s?\d/gi;
const STRUCTURED =
  /["'](?:compare_at_price|compareAtPrice|originalPrice|wasPrice|oldPrice|listPrice|priceBeforeDiscount|strikePrice)["']\s*:\s*["']?[1-9]/gi;
const NO_PRODUCTS = ['no products', '0 results', 'nothing found', 'no items', 'no results', "sorry, we couldn't find", 'sorry, we could not find'];
const CHALLENGE = ['just a moment', 'attention required', 'checking your browser', 'access denied', 'pardon our interruption', 'verify you are human', 'captcha'];
const ERROR_TITLE = /\b(?:404|not found|page not found|no longer available|oops|error|something went wrong)\b/i;
const LOGIN_TITLE = /\b(?:sign in|log in|login)\b/i;

function count(pattern: RegExp, text: string): number {
  let n = 0;
  const matches = text.matchAll(pattern);
  for (let next = matches.next(); next.done !== true; next = matches.next()) {
    n += 1;
    if (n >= MAX_COUNT) break;
  }
  return n;
}

interface Parsed {
  /** The page without `<script>` and `<style>` blocks. */
  markup: string;
  /** What was inside the script blocks, joined (for structured data). */
  scriptText: string;
  scripts: number;
}

/** Removes script and style blocks with `indexOf`, so an unclosed tag cannot make the work quadratic. */
function removeBlocks(page: string): Parsed {
  const lower = page.toLowerCase();
  const kept: string[] = [];
  const scriptParts: string[] = [];
  let scripts = 0;
  let pos = 0;
  while (pos < page.length) {
    const nextScript = lower.indexOf('<script', pos);
    const nextStyle = lower.indexOf('<style', pos);
    const useScript = nextScript !== -1 && (nextStyle === -1 || nextScript < nextStyle);
    const start = useScript ? nextScript : nextStyle;
    if (start === -1) {
      kept.push(page.slice(pos));
      break;
    }
    kept.push(page.slice(pos, start));
    const closeTag = useScript ? '</script' : '</style';
    const bodyStart = lower.indexOf('>', start);
    if (bodyStart === -1) break;
    const end = lower.indexOf(closeTag, bodyStart);
    if (useScript) {
      scripts += 1;
      scriptParts.push(page.slice(bodyStart + 1, end === -1 ? page.length : end));
    }
    if (end === -1) break;
    const close = lower.indexOf('>', end);
    pos = close === -1 ? page.length : close + 1;
  }
  return { markup: kept.join(''), scriptText: scriptParts.join('\n'), scripts };
}

/** The visible text nodes of the markup, in order. Linear: `indexOf` only ever moves forward. */
function textNodes(markup: string): string[] {
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
function firstElementText(markup: string, lower: string, tag: string): string {
  const open = lower.indexOf(`<${tag}`);
  if (open === -1) return '';
  const start = lower.indexOf('>', open);
  if (start === -1) return '';
  const end = lower.indexOf(`</${tag}`, start);
  const raw = markup.slice(start + 1, end === -1 ? start + 301 : Math.min(end, start + 301));
  return textNodes(raw).join(' ');
}

function includesAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

/**
 * Judges one fetched sale page. The first rule that matches decides (see docs/stories/3.3.story.md, "The rules"):
 * 1 redirected away, 2 challenge page, 3 login page, 4 error page, 5 discounts found, 6 JavaScript shell,
 * 7 empty listing, 8 no discounts, 9 unreadable.
 */
export function validateSalePage(page: PageInput): ValidationResult {
  const { markup, scriptText, scripts } = removeBlocks(page.text);
  const nodes = textNodes(markup);
  const visible = nodes.join(' ');
  const lowerMarkup = markup.toLowerCase();
  const lowerVisible = visible.toLowerCase();
  const title = firstElementText(markup, lowerMarkup, 'title');

  const percentLabels = nodes.reduce((n, node) => (node.length <= 40 && PERCENT_NODE.test(node) ? n + 1 : n), 0);
  const wasPrices =
    count(WAS_MARKER, markup) + count(WAS_TAG, markup) + count(WAS_TEXT, visible);
  const structured = count(STRUCTURED, scriptText) + count(STRUCTURED, markup);
  const amounts = count(AMOUNT, visible);
  const signals: ValidationSignals = { amounts, percentLabels, wasPrices, structured, scripts, textLength: visible.length };
  const discountSignals = percentLabels + wasPrices + structured;
  const result = (verdict: ValidationVerdict, reason: ValidationReason): ValidationResult => ({ verdict, reason, signals });

  // 1. The address the fetch ended on is another site, or the home page of the same site.
  if (redirectedAway(page.expectedUrl, page.finalUrl)) return result('ended', 'redirected_away');

  // 2. A bot challenge is a block, not a missing sale.
  const head = `${title.toLowerCase()} ${lowerVisible.slice(0, CHALLENGE_WINDOW)}`;
  if (includesAny(head, CHALLENGE)) return result('blocked', 'challenge_page');

  // 3. A login wall: a sign-in title, a password field and (almost) no prices.
  if (LOGIN_TITLE.test(title) && lowerMarkup.includes('type="password"') && amounts < MIN_AMOUNTS_FOR_LISTING) {
    return result('blocked', 'login_page');
  }

  // 4. An error page: an error title or heading, no prices and no discount signal.
  if (amounts < MIN_AMOUNTS_FOR_LISTING && discountSignals === 0) {
    const h1 = firstElementText(markup, lowerMarkup, 'h1');
    if (ERROR_TITLE.test(title) || ERROR_TITLE.test(h1)) return result('ended', 'error_page');
  }

  // 5. Discounted products: at least two discount signals and at least two prices.
  if (discountSignals >= MIN_DISCOUNT_SIGNALS && amounts >= MIN_AMOUNTS_FOR_SALE) return result('valid', 'discounts_found');

  // 6. An application that has not rendered its products: its prices are not in the page, so it cannot be judged.
  if (amounts < MIN_AMOUNTS_FOR_LISTING) {
    const rootContainer = /\bid=["'](?:root|app|__next|__nuxt)["']|<app-root/i.test(lowerMarkup);
    const enableJs = lowerMarkup.includes('enable javascript') || lowerMarkup.includes('requires javascript');
    if (rootContainer || enableJs || (scripts >= MIN_SCRIPTS_FOR_SHELL && visible.length < SHELL_TEXT_LENGTH)) {
      return result('unverifiable', 'javascript_shell');
    }
  }

  // 7 and 8 need the whole page: a truncated page may hold the discounts in the part that was cut.
  if (!page.truncated) {
    // 7. The page says there is nothing to show.
    if (amounts < MIN_AMOUNTS_FOR_LISTING && includesAny(lowerVisible, NO_PRODUCTS)) return result('ended', 'empty_listing');
    // 8. The page lists priced products and none is discounted.
    if (amounts >= MIN_AMOUNTS_FOR_LISTING && discountSignals === 0) return result('ended', 'no_discounts');
  }

  // 9. Anything else cannot be judged.
  return result('unverifiable', 'unreadable');
}

/**
 * What a verdict does to the sale record (Story 3.5 applies it): `valid` is active and content-verified,
 * `ended` ends the sale, `blocked` (a challenge or login page) keeps the last good record like a blocked fetch,
 * `unverifiable` is active and URL-verified only, shown as "On sale".
 */
export function recordEffect(verdict: ValidationVerdict): {
  state: 'active' | 'ended' | null;
  validation: 'content_verified' | 'url_verified' | null;
} {
  switch (verdict) {
    case 'valid':
      return { state: 'active', validation: 'content_verified' };
    case 'ended':
      return { state: 'ended', validation: null };
    case 'blocked':
      return { state: null, validation: null };
    case 'unverifiable':
      return { state: 'active', validation: 'url_verified' };
  }
}
