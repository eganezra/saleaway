import { classifyResponse, firstElementText, isAllowedByRobots, isSafeFetchUrl, redirectedAway } from '@saleaway/core';
import type { HiddenStores, RobotsDecision, RobotsResult, SeedRetailer } from '@saleaway/core';
import { cell } from './coverage-plan';

// The URL check (Story 4.3). Pure: no I/O, no clock, no network. The command asks for the pages; this decides what to ask,
// turns each answer into a result, builds the two result files and decides whether a run is allowed.

export type CheckKind = 'sale' | 'black_friday';

/** What became of one address. The first two pass; the rest are flagged (AC1). */
export type CheckClass =
  | 'ok'
  | 'js_only'
  | 'blocked'
  | 'not_found'
  | 'redirected_away'
  | 'error'
  | 'robots_disallow'
  | 'robots_unreachable'
  | 'unsafe_url';

/** A store with no sale address is listed, never requested. */
export type ResultClass = CheckClass | 'no_address';

export const CLASSES: readonly ResultClass[] = ['ok', 'js_only', 'blocked', 'not_found', 'redirected_away', 'error', 'robots_disallow', 'robots_unreachable', 'unsafe_url', 'no_address'];

export const passes = (result: ResultClass): boolean => result === 'ok' || result === 'js_only';

export const MIN_DELAY_SECONDS = 5;
export const MAX_DELAY_SECONDS = 120;
export const DEFAULT_DELAY_SECONDS = 15;
export const MAX_ONLY = 3;
export const MIN_HOURS_BETWEEN_RUNS = 24;

// ---------- the plan ----------

export interface Subject {
  slug: string;
  name: string;
  kind: CheckKind;
  /** null when the store has no address of this kind. */
  url: string | null;
  /** The reason code in docs/data/hidden-stores.json, or null. */
  hiddenReason: string | null;
}

export interface PlannedPage {
  url: string;
  origin: string;
  /** Some store has this as its Black Friday address, so its title and heading are read for the year. */
  wantYear: boolean;
  /** Every store that has this address is a known JavaScript store (seed status `verified_js_shell`) and it is a sale address. */
  knownJsShell: boolean;
}

export interface Plan {
  subjects: Subject[];
  /** Distinct addresses, in the order they first appear. A shared address is asked for once. */
  pages: PlannedPage[];
  sites: number;
}

/**
 * What to ask: every store's sale address, and its Black Friday address when it has one. `only` limits the plan to those stores.
 * Stores with no sale address become `no_address` rows; a store with no Black Friday address has no Black Friday row.
 */
export function planChecks(retailers: readonly SeedRetailer[], hidden: HiddenStores, only: readonly string[] | null = null): Plan {
  const reasonBySlug = new Map(hidden.stores.map((store) => [store.slug, store.reason]));
  const chosen = only === null ? retailers : retailers.filter((retailer) => only.includes(retailer.slug));
  const subjects: Subject[] = [];
  const pages = new Map<string, PlannedPage>();

  for (const retailer of chosen) {
    const hiddenReason = reasonBySlug.get(retailer.slug) ?? null;
    const add = (kind: CheckKind, url: string | null): void => {
      subjects.push({ slug: retailer.slug, name: retailer.name, kind, url, hiddenReason });
      if (url === null) return;
      const jsShell = kind === 'sale' && retailer.seedStatus === 'verified_js_shell';
      const existing = pages.get(url);
      if (existing === undefined) {
        pages.set(url, { url, origin: originOf(url), wantYear: kind === 'black_friday', knownJsShell: jsShell });
      } else {
        existing.wantYear = existing.wantYear || kind === 'black_friday';
        existing.knownJsShell = existing.knownJsShell && jsShell;
      }
    };
    add('sale', retailer.saleUrl);
    if (retailer.blackFridayUrl !== null) add('black_friday', retailer.blackFridayUrl);
  }

  const list = [...pages.values()];
  return { subjects, pages: list, sites: new Set(list.map((page) => page.origin)).size };
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/** The path and query of an address, as `checkRobots` and `isAllowedByRobots` want them. */
export function pathAndQueryOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return '/';
  }
}

/** How long a real run would take: one wait between pages, none before the first. */
export function estimateMinutes(pageCount: number, delaySeconds: number): number {
  return pageCount <= 1 ? 0 : Math.ceil(((pageCount - 1) * delaySeconds) / 60);
}

// ---------- one answer ----------

/** An address that is not safe to request (a private host, a bad scheme) is never requested. */
export const isRequestable = (url: string): boolean => isSafeFetchUrl(url);

/** What the site's robots.txt, read once for the whole site, says about one more page of that site. */
export function robotsDecisionFor(cached: RobotsResult, pathAndQuery: string): RobotsDecision {
  if (cached.decision === 'unreachable') return 'unreachable';
  // The file was read: its rules decide for each path. No file (a 4xx): everything is allowed.
  if (cached.text === null) return 'allowed';
  return isAllowedByRobots(cached.text, pathAndQuery) ? 'allowed' : 'disallowed';
}

export function classOfRobots(decision: RobotsDecision): CheckClass | null {
  if (decision === 'disallowed') return 'robots_disallow';
  if (decision === 'unreachable') return 'robots_unreachable';
  return null;
}

/** The class of a page that answered, by the same rules as the pipeline (`classifyResponse`). */
export function classOfAnswer(expectedUrl: string, finalUrl: string, status: number, knownJsShell: boolean): CheckClass {
  const result = classifyResponse({ status, failed: false, redirectedAway: redirectedAway(expectedUrl, finalUrl), knownJsShell });
  return result === 'skipped_manual' ? 'error' : result;
}

export type YearFlag = 'year_2026' | 'year_2025' | 'no_year';

export interface BlackFridayFlags {
  year: YearFlag;
  /** The title or the first heading says "black friday". */
  words: boolean;
}

/**
 * Which year a Black Friday page claims, from its title and first heading only (footers and scripts say 2025 or 2026 everywhere,
 * so the rest of the page is deliberately not looked at). Nothing of the page is returned but these two facts.
 */
export function blackFridayFlags(markup: string): BlackFridayFlags {
  const lower = markup.toLowerCase();
  const text = `${firstElementText(markup, lower, 'title')} ${firstElementText(markup, lower, 'h1')}`;
  const year: YearFlag = /(?<!\d)2026(?!\d)/.test(text) ? 'year_2026' : /(?<!\d)2025(?!\d)/.test(text) ? 'year_2025' : 'no_year';
  return { year, words: /black\s*friday/i.test(text) };
}

/** What the command records for one address. */
export interface PageResult {
  class: CheckClass;
  httpStatus: number | null;
  /** A short reason word (`timeout`, `too_many_redirects`...), never a message with an address in it. */
  error: string | null;
  /** Only for a Black Friday address that answered. */
  blackFriday: BlackFridayFlags | null;
}

// ---------- the files ----------

export interface ResultRow {
  slug: string;
  kind: CheckKind;
  class: ResultClass;
  httpStatus: number | null;
  error: string | null;
  blackFriday: BlackFridayFlags | null;
  /** The reason code of Story 3.9 when the store is hidden for blocking, else null. */
  hiddenReason: string | null;
}

export interface UrlCheckFile {
  checkedAt: string;
  userAgent: string;
  delaySeconds: number;
  from: 'operator computer';
  pages: number;
  sites: number;
  results: ResultRow[];
}

export function buildCheckFile(input: {
  plan: Plan;
  answers: ReadonlyMap<string, PageResult>;
  checkedAt: string;
  userAgent: string;
  delaySeconds: number;
}): UrlCheckFile {
  const { plan, answers } = input;
  const results: ResultRow[] = plan.subjects.map((subject) => {
    const base = { slug: subject.slug, kind: subject.kind, hiddenReason: subject.hiddenReason };
    if (subject.url === null) return { ...base, class: 'no_address', httpStatus: null, error: null, blackFriday: null };
    const answer = answers.get(subject.url);
    if (answer === undefined) return { ...base, class: 'error', httpStatus: null, error: 'not_checked', blackFriday: null };
    return {
      ...base,
      class: answer.class,
      httpStatus: answer.httpStatus,
      error: answer.error,
      blackFriday: subject.kind === 'black_friday' ? answer.blackFriday : null,
    };
  });
  return { checkedAt: input.checkedAt, userAgent: input.userAgent, delaySeconds: input.delaySeconds, from: 'operator computer', pages: plan.pages.length, sites: plan.sites, results };
}

const utc = (time: string): string => `${time.replace('T', ' ').replace('Z', '')} UTC`;

function table(header: string[], rows: string[][]): string {
  const line = (cols: string[]): string => `| ${cols.join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
}

function countByClass(rows: readonly ResultRow[]): string[][] {
  return CLASSES.filter((name) => name !== 'no_address' || rows.some((row) => row.class === name)).map((name) => [name, String(rows.filter((row) => row.class === name).length)]);
}

const nameOf = (names: ReadonlyMap<string, string>, slug: string): string => `${cell(names.get(slug) ?? slug)} (${slug})`;

/** The report as Markdown. Only store names, slugs, classes, numbers and short reason words: no address, no page text. */
export function renderCheckMarkdown(file: UrlCheckFile, names: ReadonlyMap<string, string>): string {
  const sale = file.results.filter((row) => row.kind === 'sale');
  const friday = file.results.filter((row) => row.kind === 'black_friday');
  const flaggedSale = sale.filter((row) => row.class !== 'no_address' && !passes(row.class));
  const flaggedFriday = friday.filter((row) => !passes(row.class));
  const stale = friday.filter((row) => row.blackFriday?.year === 'year_2025');
  const hiddenRows = sale.filter((row) => row.hiddenReason !== null);
  const answering = hiddenRows.filter((row) => passes(row.class));
  const parts: string[] = [];

  parts.push(
    `# URL check\n\nChecked ${utc(file.checkedAt)} from the operator's computer, with the pipeline's user-agent, ${file.delaySeconds} seconds between pages, ` +
      `${file.pages} pages on ${file.sites} sites. robots.txt was read first for each site and obeyed. Made by \`pnpm ops:check-urls\`.`,
  );
  parts.push(`## Summary\n\n**Sale addresses** (${sale.length} stores)\n\n${table(['Result', 'Stores'], countByClass(sale))}\n\n**Black Friday addresses** (${friday.length} stores)\n\n${table(['Result', 'Stores'], countByClass(friday))}`);

  parts.push(
    `## Sale addresses that did not return a page\n\n` +
      (flaggedSale.length === 0
        ? 'None.'
        : table(['Store', 'Result', 'HTTP status', 'Reason', 'Hidden (Story 3.9)'], flaggedSale.map((row) => [nameOf(names, row.slug), row.class, row.httpStatus === null ? 'none' : String(row.httpStatus), row.error ?? '', row.hiddenReason === null ? 'no' : 'yes']))),
  );
  parts.push(
    `## Black Friday addresses that did not return a page\n\n` +
      (flaggedFriday.length === 0 ? 'None.' : table(['Store', 'Result', 'HTTP status', 'Reason'], flaggedFriday.map((row) => [nameOf(names, row.slug), row.class, row.httpStatus === null ? 'none' : String(row.httpStatus), row.error ?? '']))),
  );
  parts.push(
    `## Black Friday pages that say 2025\n\nA page counts as stale when its title or first heading says 2025 and neither says 2026. These stay unverified (so do all the others: nothing sets the flag).\n\n` +
      (stale.length === 0 ? 'None.' : table(['Store', 'Says "black friday"'], stale.map((row) => [nameOf(names, row.slug), row.blackFriday?.words ? 'yes' : 'no']))),
  );
  parts.push(
    `## Stores hidden by Story 3.9, asked from here\n\n${answering.length} of ${hiddenRows.length} answer from here (a page, or a JavaScript page).\n\n` +
      (hiddenRows.length === 0
        ? 'None.'
        : table(['Store', 'Worker reason', 'From here', 'HTTP status'], hiddenRows.map((row) => [nameOf(names, row.slug), cell(row.hiddenReason ?? ''), row.class, row.httpStatus === null ? 'none' : String(row.httpStatus)]))),
  );
  parts.push(everyStoreSection(file, names));
  parts.push('Made by `pnpm ops:check-urls`; it asks for pages and writes nothing to the database.');
  return `${parts.join('\n\n')}\n`;
}

/** How one row reads in the "every store" table: the class, the HTTP status, and for a Black Friday page the year it claims. */
function answerText(row: ResultRow | undefined): string {
  if (row === undefined) return 'none';
  const status = row.httpStatus === null ? '' : ` ${row.httpStatus}`;
  const reason = row.error === null || row.error === row.class ? '' : ` (${cell(row.error)})`;
  const year = row.blackFriday === null ? '' : `, ${row.blackFriday.year.replace('year_', '')}${row.blackFriday.words ? ', black friday' : ''}`;
  return `${row.class}${status}${reason}${year}`.trim();
}

/** Every store once, with its sale address and its Black Friday address side by side, so a store that worked can be found too. */
function everyStoreSection(file: UrlCheckFile, names: ReadonlyMap<string, string>): string {
  const slugs = [...new Set(file.results.map((row) => row.slug))].sort((a, b) => (names.get(a) ?? a).localeCompare(names.get(b) ?? b) || a.localeCompare(b));
  const rows = slugs.map((slug) => {
    const sale = file.results.find((row) => row.slug === slug && row.kind === 'sale');
    const friday = file.results.find((row) => row.slug === slug && row.kind === 'black_friday');
    return [nameOf(names, slug), answerText(sale), friday === undefined ? 'no address' : answerText(friday), sale?.hiddenReason ?? ''];
  });
  return `## Every store\n\nOne row per store: what its sale address and its Black Friday address answered (class, HTTP status, and for a Black Friday page the year in its title or first heading). The last column is the reason code when Story 3.9 hides the store. This table does not say how long a page took: load times are not recorded.\n\n${table(['Store', 'Sale address', 'Black Friday address', 'Hidden (Story 3.9)'], rows)}`;
}

// ---------- once a day ----------

export type RunGuard = { ok: true } | { ok: false; message: string };

/** A real run is allowed when the previous one finished 24 hours ago or more (or there was none). */
export function canRunNow(previousCheckedAt: string | null, now: Date): RunGuard {
  if (previousCheckedAt === null) return { ok: true };
  const previous = Date.parse(previousCheckedAt);
  if (Number.isNaN(previous)) return { ok: false, message: 'The last check in docs/data/url-check.json has no valid checkedAt time: fix or remove the file by hand, then run again.' };
  const next = previous + MIN_HOURS_BETWEEN_RUNS * 3_600_000;
  if (now.getTime() >= next) return { ok: true };
  return { ok: false, message: `The last full check ran at ${previousCheckedAt}. It runs at most once in 24 hours: try again after ${new Date(next).toISOString().replace(/\.\d+Z$/, 'Z')}.` };
}

/** The `checkedAt` of the file left by the last real run, or an error word when the file cannot be trusted. */
export function readPreviousCheck(text: string): { ok: true; checkedAt: string } | { ok: false; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: 'docs/data/url-check.json is not valid JSON: fix or remove it by hand, then run again.' };
  }
  const checkedAt = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>).checkedAt : undefined;
  if (typeof checkedAt !== 'string' || Number.isNaN(Date.parse(checkedAt))) {
    return { ok: false, message: 'docs/data/url-check.json has no valid checkedAt time: fix or remove it by hand, then run again.' };
  }
  return { ok: true, checkedAt };
}
