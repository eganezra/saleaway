import { summariseRun, toIsoUtc } from '@saleaway/core';
import { closeRun, countResultsByClass, listUnfinishedRuns } from './repo';
import type { Deps } from './types';

/**
 * Closes every run that has no finish time (normally exactly one: today's), recording its totals from
 * its own results. A run with fewer results than stores is still closed; the gap shows in the totals
 * (stores_ok + stores_failed below stores_total). Closing a closed run changes nothing.
 * Returns how many runs were closed. The failure alert is Story 4.6.
 */
export async function finalizeRun(env: Pick<Env, 'DB'>, deps: Deps): Promise<number> {
  const finishedAt = toIsoUtc(deps.clock());
  let closed = 0;
  for (const run of await listUnfinishedRuns(env.DB)) {
    const { storesOk, storesFailed } = summariseRun(await countResultsByClass(env.DB, run.id));
    if (await closeRun(env.DB, run.id, finishedAt, storesOk, storesFailed)) {
      closed += 1;
      deps.log.info('run_finalized', {
        runId: run.id,
        storesTotal: run.storesTotal,
        storesOk,
        storesFailed,
        missing: run.storesTotal - storesOk - storesFailed,
      });
    }
  }
  return closed;
}
