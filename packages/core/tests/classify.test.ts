import { describe, expect, it } from 'vitest';
import { classifyResponse, redirectedAway } from '../src/classify';
import type { FetchOutcome } from '../src/classify';

const outcome = (status: number | null, over: Partial<FetchOutcome> = {}): FetchOutcome => ({
  status,
  failed: false,
  redirectedAway: false,
  knownJsShell: false,
  ...over,
});

describe('classifyResponse', () => {
  it('2xx is ok', () => {
    for (const status of [200, 201, 204, 299]) expect(classifyResponse(outcome(status)), String(status)).toBe('ok');
  });

  it('401, 403, 429 and 503 are blocked', () => {
    for (const status of [401, 403, 429, 503]) expect(classifyResponse(outcome(status)), String(status)).toBe('blocked');
  });

  it('404 and 410 are not_found', () => {
    for (const status of [404, 410]) expect(classifyResponse(outcome(status)), String(status)).toBe('not_found');
  });

  it('every other status is an error: 5xx, other 4xx, redirects that were not followed, 1xx', () => {
    for (const status of [100, 300, 301, 304, 400, 405, 408, 451, 500, 502, 504, 599]) {
      expect(classifyResponse(outcome(status)), String(status)).toBe('error');
    }
  });

  it('a failed request or no status is an error whatever else is set', () => {
    expect(classifyResponse(outcome(null))).toBe('error');
    expect(classifyResponse(outcome(200, { failed: true }))).toBe('error');
    expect(classifyResponse(outcome(null, { failed: true, redirectedAway: true, knownJsShell: true }))).toBe('error');
  });

  it('a 2xx on another site or the home page is redirected_away, even for a known JavaScript shell', () => {
    expect(classifyResponse(outcome(200, { redirectedAway: true }))).toBe('redirected_away');
    expect(classifyResponse(outcome(200, { redirectedAway: true, knownJsShell: true }))).toBe('redirected_away');
  });

  it('a 2xx on a known JavaScript shell is js_only', () => {
    expect(classifyResponse(outcome(200, { knownJsShell: true }))).toBe('js_only');
  });

  it('the flags never change a status that is not 2xx', () => {
    expect(classifyResponse(outcome(404, { knownJsShell: true, redirectedAway: true }))).toBe('not_found');
    expect(classifyResponse(outcome(403, { knownJsShell: true }))).toBe('blocked');
    expect(classifyResponse(outcome(500, { redirectedAway: true }))).toBe('error');
  });
});

describe('redirectedAway', () => {
  it('is false for the same page and for another path on the same site', () => {
    expect(redirectedAway('https://bash.com/sale', 'https://bash.com/sale')).toBe(false);
    expect(redirectedAway('https://underarmour.co.za/outlet', 'https://underarmour.co.za/collections/outlet')).toBe(false);
    expect(redirectedAway('https://shop.example/sale', 'https://shop.example/sale?page=1')).toBe(false);
  });

  it('ignores a leading www. and letter case in the host', () => {
    expect(redirectedAway('https://shop.example/sale', 'https://www.shop.example/sale')).toBe(false);
    expect(redirectedAway('https://www.shop.example/sale', 'https://shop.example/sale')).toBe(false);
    expect(redirectedAway('https://Shop.Example/sale', 'https://shop.example/sale')).toBe(false);
  });

  it('is true for another site, including a sub-site', () => {
    expect(redirectedAway('https://shop.example/sale', 'https://other.example/sale')).toBe(true);
    expect(redirectedAway('https://shop.example/sale', 'https://m.shop.example/sale')).toBe(true);
    expect(redirectedAway('https://shop.example/sale', 'https://shop.example.evil.test/sale')).toBe(true);
  });

  it('is true for the home page when the expected page was not the home page', () => {
    expect(redirectedAway('https://shop.example/sale', 'https://shop.example/')).toBe(true);
    expect(redirectedAway('https://shop.example/a/b/c', 'https://shop.example')).toBe(true);
  });

  it('is false when the expected page already was the home page', () => {
    expect(redirectedAway('https://shop.example/', 'https://shop.example/')).toBe(false);
    expect(redirectedAway('https://shop.example', 'https://shop.example/')).toBe(false);
  });

  it('is false for values it cannot read', () => {
    expect(redirectedAway('not a url', 'https://shop.example/')).toBe(false);
    expect(redirectedAway('https://shop.example/', '')).toBe(false);
  });
});
