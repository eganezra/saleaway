import type { Logger } from '@saleaway/core';
import type { Deps, FetchFn, RewriterLike, StoreJob } from '../../src/types';

type Level = 'debug' | 'info' | 'warn' | 'error';
export interface LogEntry {
  level: Level;
  message: string;
  fields?: Record<string, unknown>;
}

/** A logger that records what it is given. */
export function fakeLogger() {
  const entries: LogEntry[] = [];
  const make = (level: Level) => (message: string, fields?: Record<string, unknown>) => {
    entries.push({ level, message, fields });
  };
  const log: Logger = { debug: make('debug'), info: make('info'), warn: make('warn'), error: make('error') };
  return { log, entries, named: (message: string) => entries.filter((entry) => entry.message === message) };
}

/** A clock that returns `start`, then moves forward `stepMs` on every call. */
export function fakeClock(start = '2026-10-30T03:00:00.000Z', stepMs = 0): () => Date {
  let time = new Date(start).getTime();
  return () => {
    const now = new Date(time);
    time += stepMs;
    return now;
  };
}

export interface RecordedRequest {
  url: string;
  init?: RequestInit;
}

/** What a fake `fetch` answers for one URL: a status (with optional body and headers), or a failure. */
export type Spec =
  | { status: number; body?: string; headers?: Record<string, string> }
  | { throws: 'timeout' | 'network' };

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * A `fetch` that never touches the network. `routes` maps an exact URL to a Spec, or to a list of Specs
 * used in order (the last one repeats). A URL that is not in `routes` fails like a network error, and every
 * request is recorded, so a test can say exactly which requests were made.
 */
export function fakeFetch(routes: Record<string, Spec | Spec[]> = {}) {
  const requests: RecordedRequest[] = [];
  const used = new Map<string, number>();
  const fetchFn: FetchFn = async (input, init) => {
    requests.push({ url: input, init });
    const entry = routes[input];
    if (entry === undefined) throw new TypeError(`fetch failed: no route for ${input}`);
    const list = Array.isArray(entry) ? entry : [entry];
    const index = used.get(input) ?? 0;
    used.set(input, index + 1);
    const spec = list[Math.min(index, list.length - 1)] as Spec;
    if ('throws' in spec) {
      if (spec.throws === 'timeout') {
        const error = new Error('The operation was aborted due to timeout');
        error.name = 'TimeoutError';
        throw error;
      }
      throw new TypeError('fetch failed');
    }
    const body = NULL_BODY_STATUSES.has(spec.status) ? null : (spec.body ?? '');
    return new Response(body, { status: spec.status, headers: spec.headers });
  };
  return { fetch: fetchFn, requests, urls: () => requests.map((request) => request.url) };
}

/**
 * A fetch whose answer for `pageUrl` has a body that records what happens to it: `pulls` counts reads
 * (a stream with a zero high-water mark is not read until someone asks) and `cancelled` says it was freed.
 * Every other URL is answered from `routes`.
 */
export function fakeFetchWithTrackedBody(pageUrl: string, routes: Record<string, Spec | Spec[]>, status = 200, text = 'page') {
  const stats = { pulls: 0, cancelled: false };
  const inner = fakeFetch(routes);
  const fetchFn: FetchFn = async (input, init) => {
    if (input !== pageUrl) return inner.fetch(input, init);
    inner.requests.push({ url: input, init });
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          stats.pulls += 1;
          controller.enqueue(new TextEncoder().encode(text));
          controller.close();
        },
        cancel() {
          stats.cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    return new Response(body, { status });
  };
  return { fetch: fetchFn, requests: inner.requests, urls: () => inner.requests.map((r) => r.url), stats };
}

/** A rewriter that counts nothing; it stands in for `HTMLRewriter`, which does not exist in Node. */
export function fakeRewriter(counts: Partial<Record<string, number>> = {}): () => RewriterLike {
  return () => {
    const handlers: Array<{ selector: string; element(): void }> = [];
    const rewriter: RewriterLike = {
      on(selector, handler) {
        handlers.push({ selector, ...handler });
        return rewriter;
      },
      transform(response) {
        for (const handler of handlers) {
          for (let i = 0; i < (counts[handler.selector] ?? 0); i++) handler.element();
        }
        return response;
      },
    };
    return rewriter;
  };
}

export function fakeDeps(
  options: { start?: string; stepMs?: number; fetch?: FetchFn; createRewriter?: () => RewriterLike } = {},
) {
  const logger = fakeLogger();
  const noNetwork = fakeFetch({});
  const deps: Deps = {
    log: logger.log,
    clock: fakeClock(options.start, options.stepMs),
    fetch: options.fetch ?? noNetwork.fetch,
    ...(options.createRewriter ? { createRewriter: options.createRewriter } : {}),
  };
  return { deps, ...logger, noNetworkRequests: noNetwork.requests };
}

export interface SentMessage {
  body: StoreJob;
  delaySeconds?: number;
}

/** A queue that records every `sendBatch` call, and can fail on a chosen call (counting from 1). */
export function fakeQueue(options: { failOnCall?: number } = {}) {
  const calls: SentMessage[][] = [];
  let count = 0;
  const queue = {
    sendBatch: async (messages: Iterable<SentMessage>) => {
      count += 1;
      if (count === options.failOnCall) throw new Error('QUEUE_ERROR: simulated failure');
      calls.push([...messages]);
    },
  } as unknown as Queue<StoreJob>;
  return { queue, calls, allMessages: () => calls.flat() };
}

export interface EnvOverrides {
  STAGGER_SECONDS?: string;
  PIPELINE_ENABLED?: string;
  FINALIZE_CRON?: string;
  ADMIN_TOKEN?: string;
  MEASURE_CPU?: string;
}

/** An `Env` built from a real database, a fake queue and the configured variables. */
export function makeEnv(db: D1Database, queue: Queue<StoreJob>, overrides: EnvOverrides = {}): Env {
  return {
    DB: db,
    FETCH_QUEUE: queue,
    FINALIZE_CRON: '45 3 * * *',
    STAGGER_SECONDS: '15',
    PIPELINE_ENABLED: 'true',
    MEASURE_CPU: 'false',
    ADMIN_TOKEN: 'test-token',
    ...overrides,
  } as unknown as Env;
}

/** A queue message that records whether it was acknowledged or retried. */
export function fakeMessage(body: unknown, attempts = 1, id = 'msg-1') {
  const state = { acked: 0, retried: 0 };
  const message = {
    id,
    body,
    attempts,
    timestamp: new Date(),
    ack: () => {
      state.acked += 1;
    },
    retry: () => {
      state.retried += 1;
    },
  } as unknown as Message<unknown>;
  return { message, state };
}

export function fakeBatch(messages: Array<Message<unknown>>): MessageBatch<unknown> {
  return { queue: 'saleaway-fetch', messages, ackAll() {}, retryAll() {} } as unknown as MessageBatch<unknown>;
}
