import { isSafeFetchUrl, resolveRedirect } from '@saleaway/core';
import type { FetchFn } from './types';

// The polite fetcher (NFR6): a clear user-agent on every request, a timeout, at most 3 redirects, https only,
// every redirect target checked before it is requested, and no attempt to look like a browser.

export const USER_AGENT = 'SaleawayBot/1.0 (+https://saleaway.online/contact)';
export const ACCEPT = 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8';
export const FETCH_TIMEOUT_MS = 10_000; // [Assumption] no document sets a timeout
export const MAX_REDIRECTS = 3;
export const MAX_PAGE_BYTES = 3 * 1024 * 1024; // [Assumption] the largest sale page seen was 1.6 MB (Woolworths)

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type FetchFailure =
  | 'unsafe_url'
  | 'unsafe_redirect'
  | 'too_many_redirects'
  | 'bad_redirect'
  | 'timeout'
  | 'network';

export type FetchPageResult =
  | { ok: true; status: number; finalUrl: string; hops: number; response: Response }
  | { ok: false; reason: FetchFailure };

/** Frees the connection of a response whose body is not needed. Never throws. */
export async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // nothing to free
  }
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

/**
 * Requests a page, following up to 3 redirects by hand so that each target can be checked first.
 * The final response is returned with its body **unread**; the caller reads it or calls `discard`.
 * A 3xx answer that is not followed (no Location, an unsafe target, too many hops) is a failure,
 * so a caller never sees a redirect status.
 */
export async function fetchPage(url: string, fetchFn: FetchFn): Promise<FetchPageResult> {
  if (!isSafeFetchUrl(url)) return { ok: false, reason: 'unsafe_url' };

  let current = url;
  for (let hops = 0; ; hops += 1) {
    let response: Response;
    try {
      response = await fetchFn(current, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': USER_AGENT, Accept: ACCEPT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      return { ok: false, reason: isTimeout(err) ? 'timeout' : 'network' };
    }

    if (!REDIRECT_STATUSES.has(response.status)) {
      return { ok: true, status: response.status, finalUrl: current, hops, response };
    }

    await discard(response);
    const location = response.headers.get('location');
    if (!location) return { ok: false, reason: 'bad_redirect' };
    if (hops >= MAX_REDIRECTS) return { ok: false, reason: 'too_many_redirects' };
    const next = resolveRedirect(current, location);
    if (next === null) return { ok: false, reason: 'unsafe_redirect' };
    current = next;
  }
}

export interface BodyText {
  text: string;
  /** How many bytes of the body the text holds (at most the limit). */
  bytes: number;
  /** The body was longer than the limit, so the rest was not read. */
  truncated: boolean;
}

/**
 * Reads at most `maxBytes` of a body as text and frees the rest. Returns null when the read fails (for example
 * a timeout while streaming). The reader is always cancelled, so an endless body cannot hold the connection.
 */
export async function readLimited(response: Response, maxBytes: number): Promise<BodyText | null> {
  const reader = response.body?.getReader();
  if (!reader) return { text: '', bytes: 0, truncated: false };
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      if (total >= maxBytes) {
        // At the limit: one more look tells whether the body ended exactly here or carries on.
        truncated = !(await reader.read()).done;
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (total > maxBytes) truncated = true;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const kept = bytes.subarray(0, maxBytes);
  return { text: new TextDecoder().decode(kept), bytes: kept.byteLength, truncated };
}
