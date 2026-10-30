import type { FetchClass } from './types';

export interface FetchOutcome {
  /** The final HTTP status, or null when no answer arrived. */
  status: number | null;
  /** The request threw, timed out or was refused. */
  failed: boolean;
  /** The final address is on another site, or is that site's home page (see `redirectedAway`). */
  redirectedAway: boolean;
  /** The store's page is known to render its products with JavaScript (seed status `verified_js_shell`). */
  knownJsShell: boolean;
}

/**
 * What happened to one store's fetch (FR6). `blocked`, `error` and `redirected_away` do not read the page:
 * the caller decides what each class does to the sale record (architecture/core-workflows.md).
 * 401, 403, 429 and 503 are `blocked`; 404 and 410 are `not_found`; any other status outside 2xx is `error`.
 */
export function classifyResponse(outcome: FetchOutcome): FetchClass {
  const { status } = outcome;
  if (outcome.failed || status === null) return 'error';
  if (status === 401 || status === 403 || status === 429 || status === 503) return 'blocked';
  if (status === 404 || status === 410) return 'not_found';
  if (status >= 200 && status <= 299) {
    if (outcome.redirectedAway) return 'redirected_away';
    return outcome.knownJsShell ? 'js_only' : 'ok';
  }
  return 'error';
}

function siteOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '');
}

function isRoot(url: URL): boolean {
  return url.pathname === '' || url.pathname === '/';
}

/**
 * True when a fetch ended on another site (ignoring a leading `www.`), or on the home page of the same
 * site although the expected page was not the home page. Another path on the same site is not "away"
 * (for example `/outlet` to `/collections/outlet`). Search, login and challenge pages are Story 3.3.
 */
export function redirectedAway(expectedUrl: string, finalUrl: string): boolean {
  let expected: URL;
  let final: URL;
  try {
    expected = new URL(expectedUrl);
    final = new URL(finalUrl);
  } catch {
    return false;
  }
  if (siteOf(expected) !== siteOf(final)) return true;
  return isRoot(final) && !isRoot(expected);
}
