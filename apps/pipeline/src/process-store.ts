import type { FetchClass } from '@saleaway/core';
import { classifyResponse, isSafeFetchUrl, redirectedAway, toIsoUtc } from '@saleaway/core';
import { discard, fetchPage } from './fetcher';
import { runProbe } from './probe';
import { checkRobots } from './robots';
import { getRetailerForJob, saveRunResult } from './repo';
import type { RetailerForJob } from './repo';
import type { Deps, StoreJob } from './types';

interface Outcome {
  result: FetchClass;
  httpStatus: number | null;
  error: string | null;
}

/** Fetches and classifies one store. Reads no page content; the probe runs only when MEASURE_CPU is on. */
async function fetchAndClassify(
  retailer: RetailerForJob,
  env: Pick<Env, 'MEASURE_CPU'>,
  deps: Deps,
): Promise<Outcome> {
  // A manual store is never fetched, not even its robots.txt.
  if (retailer.extractionMethod === 'manual') return { result: 'skipped_manual', httpStatus: null, error: null };

  const saleUrl = retailer.saleUrl;
  if (saleUrl === null || !isSafeFetchUrl(saleUrl)) return { result: 'error', httpStatus: null, error: 'unsafe_url' };

  // robots.txt first (RFC 9309): a refusal is recorded as blocked, an unreachable file as an error. No page request either way.
  const url = new URL(saleUrl);
  const robots = await checkRobots(url.origin, `${url.pathname}${url.search}`, deps.fetch);
  if (robots === 'disallowed') return { result: 'blocked', httpStatus: null, error: 'robots_disallow' };
  if (robots === 'unreachable') return { result: 'error', httpStatus: null, error: 'robots_unreachable' };

  const page = await fetchPage(saleUrl, deps.fetch);
  if (!page.ok) return { result: 'error', httpStatus: null, error: page.reason };

  const away = redirectedAway(saleUrl, page.finalUrl);
  const result = classifyResponse({
    status: page.status,
    failed: false,
    redirectedAway: away,
    // The spreadsheet says this page loads but its products appear with JavaScript: it can only be URL-verified.
    knownJsShell: retailer.seedStatus === 'verified_js_shell',
  });

  if (env.MEASURE_CPU === 'true' && page.status >= 200 && page.status <= 299) {
    await runProbe({ slug: retailer.slug, extractionMethod: retailer.extractionMethod, saleUrl, response: page.response }, deps);
  } else {
    await discard(page.response);
  }

  let error: string | null = null;
  if (result === 'redirected_away') error = `redirected_to_${new URL(page.finalUrl).hostname}`;
  else if (result !== 'ok' && result !== 'js_only') error = `http_${page.status}`;
  return { result, httpStatus: page.status, error };
}

/**
 * Processes one store of one run (Story 3.2): checks robots.txt, fetches the sale page politely, classifies
 * the answer and records one result. It never validates a page, reads a discount, or touches `sale_records`
 * or `overrides` (Stories 3.3 to 3.5). A blocked or failed store is a returned result, never a thrown error,
 * so the queue does not retry it. It throws only for real bugs and database failures.
 */
export async function processStore(
  env: Pick<Env, 'DB' | 'MEASURE_CPU'>,
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

  const outcome = await fetchAndClassify(retailer, env, deps);

  const finished = deps.clock();
  await saveRunResult(env.DB, {
    runId: job.runId,
    retailerId: job.retailerId,
    result: outcome.result,
    httpStatus: outcome.httpStatus,
    discountPercent: null,
    durationMs: finished.getTime() - started.getTime(),
    error: outcome.error === null ? null : outcome.error.slice(0, 200),
    createdAt: toIsoUtc(finished),
  });
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
