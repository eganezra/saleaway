import { redirectedAway } from './classify';
import { AMOUNT, PERCENT_NODE, SAVE_NODE, STRUCTURED, WAS_MARKER, WAS_TAG, WAS_TEXT, count, firstElementText, removeBlocks, textNodes } from './page-scan';

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
  | 'discounts_not_readable'
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
  /** Saving labels: a text element that is only "Save R 15.00" (Story 3.10). */
  saveLabels: number;
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

// Not "no items": it matches "You have no items in your wish list" and "no items to compare", which are site furniture (Story 3.10).
const NO_PRODUCTS = ['no products', '0 results', 'nothing found', 'no results', "sorry, we couldn't find", 'sorry, we could not find'];
// A page, a heading or an address that calls itself a sale (Story 3.10): whole words, also in the plural, so "wholesale", "ideal",
// "dealer" and "specialist" do not count.
const SALE_WORDS = /\b(?:sale|special|deal|offer|promo|promotion|clearance|discount|outlet|saving)s?\b/i;
const CHALLENGE = ['just a moment', 'attention required', 'checking your browser', 'access denied', 'pardon our interruption', 'verify you are human', 'captcha'];
const ERROR_TITLE = /\b(?:404|not found|page not found|no longer available|oops|error|something went wrong)\b/i;
const LOGIN_TITLE = /\b(?:sign in|log in|login)\b/i;

function includesAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

/** Does the page's title, main heading or address path say it is a sale, a special, a deal, an offer, a promotion ...? */
function callsItselfASale(title: string, heading: string, expectedUrl: string): boolean {
  let path = '';
  try {
    // an escape (%20 is a space) turns into a space first, or it would glue itself to the next word: `/Summer%20Sale` is "Summer 20Sale" otherwise
    path = new URL(expectedUrl).pathname.replace(/%[0-9A-Fa-f]{2}/g, ' ').replace(/[^A-Za-z0-9]+/g, ' ');
  } catch {
    // an address that does not parse has no path to read
  }
  return SALE_WORDS.test(title) || SALE_WORDS.test(heading) || SALE_WORDS.test(path);
}

/**
 * Judges one fetched sale page. The first rule that matches decides (see docs/stories/3.3.story.md, "The rules"):
 * 1 redirected away, 2 challenge page, 3 login page, 4 error page, 5 discounts found, 6 JavaScript shell,
 * 7 empty listing, 8 no discounts (or, on a page that calls itself a sale, discounts not readable), 9 unreadable.
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
  const saveLabels = nodes.reduce((n, node) => (node.length <= 40 && SAVE_NODE.test(node) ? n + 1 : n), 0);
  const amounts = count(AMOUNT, visible);
  const signals: ValidationSignals = { amounts, percentLabels, wasPrices, structured, saveLabels, scripts, textLength: visible.length };
  const discountSignals = percentLabels + wasPrices + structured + saveLabels;
  const result = (verdict: ValidationVerdict, reason: ValidationReason): ValidationResult => ({ verdict, reason, signals });

  // 1. The address the fetch ended on is another site, or the home page of the same site.
  if (redirectedAway(page.expectedUrl, page.finalUrl)) return result('ended', 'redirected_away');

  // 2. A bot challenge is a block, not a missing sale.
  // A marker in the title is always a challenge. A marker in the body counts only on a page that lists no priced
  // products: a real sale page can mention "reCAPTCHA" or "access denied" in a banner or a help line near its top.
  const challengeTitle = includesAny(title.toLowerCase(), CHALLENGE);
  const challengeBody = amounts < MIN_AMOUNTS_FOR_LISTING && includesAny(lowerVisible.slice(0, CHALLENGE_WINDOW), CHALLENGE);
  if (challengeTitle || challengeBody) return result('blocked', 'challenge_page');

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
    // 7. The page says there is nothing to show (and holds no discount signal at all: a page with discounts is not empty).
    if (amounts < MIN_AMOUNTS_FOR_LISTING && discountSignals === 0 && includesAny(lowerVisible, NO_PRODUCTS)) return result('ended', 'empty_listing');
    // 8. The page lists priced products and none is discounted. A page that calls itself a sale (its title, its heading or its
    // address says so) may show its discounts in a way this check cannot read, so it is not called ended (Story 3.10).
    if (amounts >= MIN_AMOUNTS_FOR_LISTING && discountSignals === 0) {
      const h1 = firstElementText(markup, lowerMarkup, 'h1');
      return callsItselfASale(title, h1, page.expectedUrl) ? result('unverifiable', 'discounts_not_readable') : result('ended', 'no_discounts');
    }
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
