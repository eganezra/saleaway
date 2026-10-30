import { isAllowedByRobots } from '@saleaway/core';
import { discard, fetchPage } from './fetcher';
import type { FetchFn } from './types';

export type RobotsDecision = 'allowed' | 'disallowed' | 'unreachable';

const MAX_ROBOTS_BYTES = 500 * 1024; // RFC 9309: a crawler must parse at least 500 KiB

/** Reads at most `maxBytes` of a body as text, or null when the read fails (for example a timeout). */
async function readLimited(response: Response, maxBytes: number): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
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
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes.subarray(0, maxBytes));
}

/**
 * Asks a site's robots.txt whether the page may be fetched (RFC 9309).
 * - a file that arrives: its rules decide
 * - a 4xx answer, including 404 and 403: the file is "unavailable", so everything is allowed
 * - a 5xx answer, a timeout, a network failure or an endless redirect: "unreachable", so the page is not fetched
 */
export async function checkRobots(origin: string, pathAndQuery: string, fetchFn: FetchFn): Promise<RobotsDecision> {
  const result = await fetchPage(`${origin}/robots.txt`, fetchFn);
  if (!result.ok) return 'unreachable';

  const { status, response } = result;
  if (status >= 200 && status <= 299) {
    const text = await readLimited(response, MAX_ROBOTS_BYTES);
    if (text === null) return 'unreachable';
    return isAllowedByRobots(text, pathAndQuery) ? 'allowed' : 'disallowed';
  }
  await discard(response);
  return status >= 400 && status <= 499 ? 'allowed' : 'unreachable';
}
