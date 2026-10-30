import type { Logger } from '@saleaway/core';

/** The queue message: process one store inside one run. */
export interface StoreJob {
  runId: number;
  retailerId: number;
}

export type RunTrigger = 'cron' | 'manual';

/** The `fetch` function the pipeline uses. It is injected so tests never touch the network. */
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** The part of `HTMLRewriter` the CPU probe uses. `HTMLRewriter` exists only in Workers, not in Node. */
export interface RewriterLike {
  on(selector: string, handlers: { element(): void }): RewriterLike;
  transform(response: Response): Response;
}

/**
 * What the pipeline code needs from the outside world besides `env`: a logger and a clock.
 * Passing them in keeps the logic testable (the clock is never read inside `packages/core`).
 */
export interface Deps {
  log: Logger;
  clock: () => Date;
  fetch: FetchFn;
  /** Only the CPU probe needs it; production passes `() => new HTMLRewriter()`. */
  createRewriter?: () => RewriterLike;
}
