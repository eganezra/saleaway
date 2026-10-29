import type { FetchClass } from '@saleaway/core';
import { toIsoUtc } from '@saleaway/core';
import { getRetailerForJob, saveRunResult } from './repo';
import type { Deps, StoreJob } from './types';

/**
 * Processes one store of one run. PLACEHOLDER (Story 3.1): nothing is fetched yet. The polite fetcher,
 * classification, validation and extraction arrive in Stories 3.2 to 3.5 and replace the last branch.
 *
 * - a store whose method is `manual` is skipped (its override is kept, and it is never fetched)
 * - any other store records an error saying that the fetcher is not built yet
 * - a store that no longer exists is logged and nothing is written (there is no row to attach a result to)
 *
 * It does not touch `sale_records` or `overrides`. It throws only for real bugs.
 */
export async function processStore(env: Pick<Env, 'DB'>, job: StoreJob, deps: Deps): Promise<FetchClass> {
  const started = deps.clock();
  const retailer = await getRetailerForJob(env.DB, job.retailerId);
  if (!retailer) {
    // `run_results.retailer_id` is a foreign key, so a result cannot be attached to a store that no
    // longer exists. Log it and write nothing: the gap shows in the run's totals.
    deps.log.error('retailer_not_found', { ...job });
    return 'error';
  }

  let result: FetchClass;
  let error: string | null = null;
  if (retailer.extractionMethod === 'manual') {
    result = 'skipped_manual';
  } else {
    result = 'error';
    error = 'fetcher_not_built_yet';
  }

  const finished = deps.clock();
  await saveRunResult(env.DB, {
    runId: job.runId,
    retailerId: job.retailerId,
    result,
    httpStatus: null,
    discountPercent: null,
    durationMs: finished.getTime() - started.getTime(),
    error,
    createdAt: toIsoUtc(finished),
  });
  return result;
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
