import type { Logger } from '@saleaway/core';

/** The queue message: process one store inside one run. */
export interface StoreJob {
  runId: number;
  retailerId: number;
}

export type RunTrigger = 'cron' | 'manual';

/**
 * What the pipeline code needs from the outside world besides `env`: a logger and a clock.
 * Passing them in keeps the logic testable (the clock is never read inside `packages/core`).
 */
export interface Deps {
  log: Logger;
  clock: () => Date;
}
