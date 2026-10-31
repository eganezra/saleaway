import type { FetchFn } from '../../src/fetcher';

// A fake `fetch` for tests that must never touch the network. Shared by the core, pipeline and ops tests
// (the pipeline's `helpers/fakes.ts` re-exports it).

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
