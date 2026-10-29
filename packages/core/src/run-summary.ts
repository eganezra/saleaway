// Totals for a finished pipeline run. Pure: the caller counts the results with SQL and passes them in.

/** Results that count as a store handled properly. Everything else counts as failed. */
const OK_RESULTS: ReadonlySet<string> = new Set(['ok', 'js_only', 'skipped_manual']);

export interface ResultCount {
  result: string;
  n: number;
}

export interface RunSummary {
  storesOk: number;
  storesFailed: number;
}

/**
 * OK is `ok`, `js_only` and `skipped_manual`. Failed is every other result: `blocked`, `not_found`,
 * `redirected_away`, `error`, and any value that is not a known class, so an unexpected value shows up
 * as a failure and is never silently dropped. Stories 4.2 (health report) and 4.6 (failure alert) use
 * these totals.
 */
export function summariseRun(counts: readonly ResultCount[]): RunSummary {
  let storesOk = 0;
  let storesFailed = 0;
  for (const { result, n } of counts) {
    if (OK_RESULTS.has(result)) storesOk += n;
    else storesFailed += n;
  }
  return { storesOk, storesFailed };
}
