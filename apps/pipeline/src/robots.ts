import { isAllowedByRobots } from '@saleaway/core';
import { discard, fetchPage, readLimited } from './fetcher';
import type { FetchFn } from './types';

export type RobotsDecision = 'allowed' | 'disallowed' | 'unreachable';

const MAX_ROBOTS_BYTES = 500 * 1024; // RFC 9309: a crawler must parse at least 500 KiB

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
    const body = await readLimited(response, MAX_ROBOTS_BYTES);
    if (body === null) return 'unreachable';
    return isAllowedByRobots(body.text, pathAndQuery) ? 'allowed' : 'disallowed';
  }
  await discard(response);
  return status >= 400 && status <= 499 ? 'allowed' : 'unreachable';
}
