import type { FetchClass, ValidationResult } from '@saleaway/core';
import {
  MAX_PAGE_BYTES,
  checkRobots,
  classifyResponse,
  discard,
  extractDiscount,
  extractShopifyDiscount,
  fetchPage,
  isSafeFetchUrl,
  nextSaleRecord,
  readLimited,
  redirectedAway,
  toIsoUtc,
  validateSalePage,
} from '@saleaway/core';
import { runProbe } from './probe';
import { RENDER_MAX_MS, createBrowserRenderer, parseBrowserBudgetSeconds, renderAllowed, startOfUtcDay } from './render';
import { fetchShopifyFeed } from './shopify';
import type { FeedState } from './shopify';
import { browserMsSince, getResultInRun, getRetailerForJob, getSaleRecord, saveRunResult, saveStoreResult } from './repo';
import type { RetailerForJob } from './repo';
import type { Deps, StoreJob } from './types';

interface Outcome {
  result: FetchClass;
  httpStatus: number | null;
  error: string | null;
  /** What the page said about the sale (Story 3.3). Logged only; Story 3.5 saves it. Null when the page was not read. */
  validation: ValidationResult | null;
  /** The deepest discount, from 5 to 90 percent (Story 3.4), or null ("On sale"). Only a `valid` page has one. */
  discountPercent: number | null;
}

/** A judged page: the verdict, and the text that was read (so the discount is read from it without reading it twice). */
interface JudgedPage {
  validation: ValidationResult;
  text: string;
}

/**
 * Reads a fetched sale page and judges it (Story 3.3). Logs one `page_validated` line with counts and a verdict,
 * never page text. It never throws: a failed read or a failing validator is logged and the store carries on.
 */
async function validatePage(slug: string, response: Response, saleUrl: string, finalUrl: string, deps: Deps): Promise<JudgedPage | null> {
  try {
    const body = await readLimited(response, MAX_PAGE_BYTES);
    if (body === null) {
      deps.log.warn('page_read_failed', { slug });
      return null;
    }
    return judgeText(slug, body, saleUrl, finalUrl, deps);
  } catch (err) {
    deps.log.warn('validation_failed', { slug, err });
    await discard(response);
    return null;
  }
}

/**
 * Judges the text of a page (the validator, unchanged) and logs one `page_validated` line. A page that was read by a plain fetch
 * and a page rendered by a browser are judged the same way. It never throws: a failing validator is logged and the store carries on.
 */
function judgeText(slug: string, body: { text: string; bytes: number; truncated: boolean }, saleUrl: string, finalUrl: string, deps: Deps): JudgedPage | null {
  try {
    const verdict = (deps.validate ?? validateSalePage)({ text: body.text, expectedUrl: saleUrl, finalUrl, truncated: body.truncated });
    deps.log.info('page_validated', { slug, verdict: verdict.verdict, reason: verdict.reason, bytes: body.bytes, truncated: body.truncated, ...verdict.signals });
    return { validation: verdict, text: body.text };
  } catch (err) {
    deps.log.warn('validation_failed', { slug, err });
    return null;
  }
}

/**
 * Reads the deepest discount of a `valid` page by the store's extraction method (Story 3.4). A `shopify_json` store whose
 * sale address is a collection first asks for its product feed (once, never retried, checked against the robots.txt
 * already read); anything else reads the page. Logs one `discount_extracted` line (numbers and short words, never text).
 * It never throws: a failure is logged and the store stays "On sale".
 */
async function readPercent(retailer: RetailerForJob, saleUrl: string, page: string, robotsText: string | null, deps: Deps): Promise<number | null> {
  try {
    let feed: string | null = null;
    let state: FeedState = 'none';
    let feedBytes = 0;
    if (retailer.extractionMethod === 'shopify_json') {
      const result = await fetchShopifyFeed(saleUrl, robotsText, deps);
      feed = result.text;
      state = result.state;
      feedBytes = result.bytes;
    }
    const percent = (deps.extract ?? extractDiscount)(retailer.extractionMethod, { page, feed });
    if (state === 'used' && (feed === null || extractShopifyDiscount(feed) === null)) state = 'fallback'; // the feed gave no percentage
    deps.log.info('discount_extracted', { slug: retailer.slug, method: retailer.extractionMethod, percent, feed: state, feedBytes });
    return percent;
  } catch (err) {
    deps.log.warn('extraction_failed', { slug: retailer.slug, err });
    return null;
  }
}

/** What the pipeline needs from `env` to process a store. */
type ProcessEnv = Pick<Env, 'DB' | 'MEASURE_CPU' | 'BROWSER' | 'BROWSER_BUDGET_SECONDS'>;

/**
 * Reads a store through a browser (Story 5.1). The day's browser time is checked first (the free plan allows 10 minutes; the
 * pipeline stops at its budget), then the page is rendered once, and the rendered HTML is classified, judged and read exactly as a
 * plain page is. A render that cannot happen or fails leaves the store as it is today (`js_only`, "On sale") with a short reason
 * word; it is a result, never an error that makes the queue retry (a retry would load the page twice).
 */
async function renderStore(retailer: RetailerForJob, saleUrl: string, robotsText: string | null, env: ProcessEnv, deps: Deps): Promise<Outcome> {
  const onSale = (error: string): Outcome => ({ result: 'js_only', httpStatus: null, error, validation: null, discountPercent: null });

  const usedMs = await browserMsSince(env.DB, startOfUtcDay(deps.clock()));
  if (!renderAllowed(usedMs, parseBrowserBudgetSeconds(env.BROWSER_BUDGET_SECONDS))) {
    deps.log.warn('render_skipped', { slug: retailer.slug, reason: 'browser_budget', usedMs, maxRenderMs: RENDER_MAX_MS });
    return onSale('browser_budget');
  }

  let rendered;
  try {
    rendered = await (deps.createRenderer ?? ((e) => createBrowserRenderer(e.BROWSER)))(env).render(saleUrl);
  } catch (err) {
    deps.log.warn('render_threw', { slug: retailer.slug, err });
    return onSale('render_failed');
  }
  if (!rendered.ok) {
    deps.log.warn('page_rendered', { slug: retailer.slug, ok: false, reason: rendered.reason, ms: rendered.ms });
    return onSale(rendered.reason);
  }
  deps.log.info('page_rendered', { slug: retailer.slug, ok: true, status: rendered.status, bytes: rendered.bytes, truncated: rendered.truncated, ms: rendered.ms, userAgent: rendered.userAgent });

  const result = classifyResponse({
    status: rendered.status,
    failed: false,
    redirectedAway: redirectedAway(saleUrl, rendered.finalUrl),
    knownJsShell: false, // the browser has run the page's JavaScript, so a 2xx is a page to read
  });
  let validation: ValidationResult | null = null;
  let discountPercent: number | null = null;
  if (result === 'ok') {
    const judged = judgeText(retailer.slug, { text: rendered.html, bytes: rendered.bytes, truncated: rendered.truncated }, saleUrl, rendered.finalUrl, deps);
    validation = judged?.validation ?? null;
    if (judged !== null && judged.validation.verdict === 'valid') discountPercent = await readPercent(retailer, saleUrl, judged.text, robotsText, deps);
  }
  let error: string | null = null;
  if (result === 'redirected_away') error = `redirected_to_${new URL(rendered.finalUrl).hostname}`;
  else if (result !== 'ok') error = `http_${rendered.status}`;
  return { result, httpStatus: rendered.status, error, validation, discountPercent };
}

/** Fetches and classifies one store, and judges the page when it is a plain `ok` answer. The probe runs only when MEASURE_CPU is on. */
async function fetchAndClassify(
  retailer: RetailerForJob,
  env: ProcessEnv,
  deps: Deps,
): Promise<Outcome> {
  // A manual store is never fetched, not even its robots.txt.
  if (retailer.extractionMethod === 'manual') return { result: 'skipped_manual', httpStatus: null, error: null, validation: null, discountPercent: null };

  const saleUrl = retailer.saleUrl;
  if (saleUrl === null || !isSafeFetchUrl(saleUrl)) return { result: 'error', httpStatus: null, error: 'unsafe_url', validation: null, discountPercent: null };

  // robots.txt first (RFC 9309): a refusal is recorded as blocked, an unreachable file as an error. No page request either way.
  const url = new URL(saleUrl);
  const { decision: robots, text: robotsText } = await checkRobots(url.origin, `${url.pathname}${url.search}`, deps.fetch);
  if (robots === 'disallowed') return { result: 'blocked', httpStatus: null, error: 'robots_disallow', validation: null, discountPercent: null };
  if (robots === 'unreachable') return { result: 'error', httpStatus: null, error: 'robots_unreachable', validation: null, discountPercent: null };

  // A store that loads its products with JavaScript is read by a browser (Story 5.1) instead of a plain fetch: robots.txt has
  // been read, and the page is loaded once.
  if (retailer.fetchMode === 'browser') return renderStore(retailer, saleUrl, robotsText, env, deps);

  const page = await fetchPage(saleUrl, deps.fetch);
  if (!page.ok) return { result: 'error', httpStatus: null, error: page.reason, validation: null, discountPercent: null };

  const away = redirectedAway(saleUrl, page.finalUrl);
  const result = classifyResponse({
    status: page.status,
    failed: false,
    redirectedAway: away,
    // The spreadsheet says this page loads but its products appear with JavaScript: it can only be URL-verified.
    knownJsShell: retailer.seedStatus === 'verified_js_shell',
  });

  // The body is read only for a plain `ok` page (to judge it) or for the CPU probe; every other answer is freed unread.
  let validation: ValidationResult | null = null;
  let discountPercent: number | null = null;
  if (env.MEASURE_CPU === 'true' && page.status >= 200 && page.status <= 299) {
    await runProbe({ slug: retailer.slug, extractionMethod: retailer.extractionMethod, saleUrl, response: page.response }, deps);
  } else if (result === 'ok') {
    const judged = await validatePage(retailer.slug, page.response, saleUrl, page.finalUrl, deps);
    validation = judged?.validation ?? null;
    // Only a page that shows discounted products has a percentage; any other verdict is shown as "On sale".
    if (judged !== null && judged.validation.verdict === 'valid') discountPercent = await readPercent(retailer, saleUrl, judged.text, robotsText, deps);
  } else {
    await discard(page.response);
  }

  let error: string | null = null;
  if (result === 'redirected_away') error = `redirected_to_${new URL(page.finalUrl).hostname}`;
  else if (result !== 'ok' && result !== 'js_only') error = `http_${page.status}`;
  return { result, httpStatus: page.status, error, validation, discountPercent };
}

/**
 * Processes one store of one run (Story 3.2): checks robots.txt, fetches the sale page politely, classifies
 * the answer and records one result. Since Story 3.3 it also reads an `ok` page and judges it, and since Story 3.5 it
 * saves the sale record together with the result. Since Story 3.4 it also reads the discount of a `valid` page. It never touches `overrides`.
 * A blocked or failed store is a returned result, never a thrown error,
 * so the queue does not retry it. It throws only for real bugs and database failures.
 */
export async function processStore(
  env: ProcessEnv,
  job: StoreJob,
  deps: Deps,
): Promise<FetchClass> {
  const started = deps.clock();
  const retailer = await getRetailerForJob(env.DB, job.retailerId);
  if (!retailer) {
    // `run_results.retailer_id` is a foreign key, so a result cannot be attached to a store that no
    // longer exists. Log it and write nothing: the gap shows in the run's totals.
    deps.log.error('retailer_not_found', { ...job });
    return 'error';
  }

  // A store read by a browser is never rendered twice in one run: queue delivery is at least once and saving a result overwrites.
  if (retailer.fetchMode === 'browser') {
    const already = await getResultInRun(env.DB, job.runId, job.retailerId);
    if (already !== null) {
      deps.log.info('render_skipped', { slug: retailer.slug, reason: 'already_has_result', runId: job.runId });
      return already;
    }
  }

  const outcome = await fetchAndClassify(retailer, env, deps);

  const finished = deps.clock();
  // The result row and the sale record are saved together (Story 3.5). A manual store has no record to write.
  const previous = await getSaleRecord(env.DB, job.retailerId);
  const record = nextSaleRecord(previous, {
    result: outcome.result,
    verdict: outcome.validation?.verdict ?? null,
    discountPercent: outcome.discountPercent,
    now: toIsoUtc(finished),
  });
  await saveStoreResult(
    env.DB,
    {
      runId: job.runId,
      retailerId: job.retailerId,
      result: outcome.result,
      httpStatus: outcome.httpStatus,
      discountPercent: outcome.discountPercent,
      durationMs: finished.getTime() - started.getTime(),
      error: outcome.error === null ? null : outcome.error.slice(0, 200),
      createdAt: toIsoUtc(finished),
    },
    record,
  );
  return outcome.result;
}

/** Records that a store could not be processed, so the run still has one result for it. */
export async function recordStoreError(
  env: Pick<Env, 'DB'>,
  job: StoreJob,
  errorText: string,
  deps: Deps,
): Promise<void> {
  await saveRunResult(env.DB, {
    runId: job.runId,
    retailerId: job.retailerId,
    result: 'error',
    httpStatus: null,
    discountPercent: null,
    durationMs: null,
    error: errorText.slice(0, 200),
    createdAt: toIsoUtc(deps.clock()),
  });
}
