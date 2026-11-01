import { USER_AGENT } from '@saleaway/core';
import type { Logger } from '@saleaway/core';
import type { Renderer, RenderResult } from '../../src/render';
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

export { fakeFetch, fakeFetchWithTrackedBody } from '../../../../packages/core/tests/helpers/fake-fetch';
export type { RecordedRequest, Spec } from '../../../../packages/core/tests/helpers/fake-fetch';
import { fakeFetch } from '../../../../packages/core/tests/helpers/fake-fetch';

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
    BROWSER_BUDGET_SECONDS: '480',
    BROWSER: { fetch: () => Promise.reject(new Error('the test browser binding must not be used')) },
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

/**
 * A renderer that never starts a browser (Story 5.1). It answers with `answer` (or what `answer(url)` returns), and records
 * every address it was asked to render, so a test can say exactly how many renders happened.
 */
export function fakeRenderer(answer: RenderResult | ((url: string) => RenderResult)) {
  const urls: string[] = [];
  const renderer: Renderer = {
    async render(url) {
      urls.push(url);
      return typeof answer === 'function' ? answer(url) : answer;
    },
  };
  return { renderer, urls };
}

/** A page as the browser returns it: status 200 and the given HTML, in 40 ms, with the bot's user-agent. */
export function renderedPage(html: string, overrides: Partial<Extract<RenderResult, { ok: true }>> = {}): RenderResult {
  const bytes = new TextEncoder().encode(html).byteLength;
  return { ok: true, status: 200, finalUrl: 'https://shop.example/sale', html, truncated: false, bytes, userAgent: USER_AGENT, ms: 40, ...overrides };
}
