import { toIsoUtc } from '@saleaway/core';
import { RENDER_GAP_SECONDS, lanesDelays } from './render';
import { getVisibleStores, insertRun } from './repo';
import type { RunStore } from './repo';
import type { Deps, RunTrigger, StoreJob } from './types';

const DEFAULT_STAGGER_SECONDS = 15;
const MAX_STAGGER_SECONDS = 3600;
const SEND_BATCH_LIMIT = 100; // Queues: at most 100 messages per sendBatch call
const MAX_DELAY_SECONDS = 86400; // Queues: a message can be delayed by at most 24 hours

export interface StartRunResult {
  runId: number;
  storesTotal: number;
}

/** A whole number of seconds from 0 to 3600, or null when the value is missing or not valid. */
export function parseStaggerSeconds(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return value <= MAX_STAGGER_SECONDS ? value : null;
}

/**
 * Starts a run: records it, then puts one message per visible store on the queue, each delayed a bit
 * more than the one before so the stores are fetched about STAGGER_SECONDS apart (NFR6). Stores read by a
 * browser (Story 5.1) have their own lane, spaced RENDER_GAP_SECONDS apart (the free plan starts a new browser at most every 20 s).
 * Old results are not purged here: retention is Story 4.6.
 */
export async function startRun(
  env: Pick<Env, 'DB' | 'FETCH_QUEUE' | 'STAGGER_SECONDS'>,
  trigger: RunTrigger,
  deps: Deps,
  options: { retailerId?: number } = {},
): Promise<StartRunResult> {
  const { log, clock } = deps;

  let stagger = parseStaggerSeconds(env.STAGGER_SECONDS);
  if (stagger === null) {
    log.warn('stagger_invalid', { value: env.STAGGER_SECONDS ?? null, usedSeconds: DEFAULT_STAGGER_SECONDS });
    stagger = DEFAULT_STAGGER_SECONDS;
  }

  // A run for one store (POST /admin/run?store=<slug>) has that store only; otherwise every runnable store.
  const stores: RunStore[] = options.retailerId === undefined ? await getVisibleStores(env.DB) : [{ id: options.retailerId, fetchMode: 'plain' }];
  const delays = lanesDelays(stores, stagger, RENDER_GAP_SECONDS);
  const runId = await insertRun(env.DB, toIsoUtc(clock()), trigger, stores.length);

  const queue = env.FETCH_QUEUE as Queue<StoreJob>;
  try {
    for (let offset = 0; offset < stores.length; offset += SEND_BATCH_LIMIT) {
      const chunk = stores.slice(offset, offset + SEND_BATCH_LIMIT);
      await queue.sendBatch(
        chunk.map((store, i) => ({
          body: { runId, retailerId: store.id },
          delaySeconds: Math.min(delays[offset + i] ?? 0, MAX_DELAY_SECONDS),
        })),
      );
    }
  } catch (err) {
    // The run row stays open; the finalize step closes it and the gap shows in its totals.
    log.error('run_enqueue_failed', { runId, trigger, err });
    throw err;
  }

  log.info('run_started', { runId, trigger, storesTotal: stores.length, browserStores: stores.filter((store) => store.fetchMode === 'browser').length });
  return { runId, storesTotal: stores.length };
}
