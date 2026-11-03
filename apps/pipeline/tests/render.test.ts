import { MAX_PAGE_BYTES, USER_AGENT } from '@saleaway/core';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BROWSER_BUDGET_SECONDS,
  RENDER_GAP_SECONDS,
  RENDER_MAX_MS,
  createBrowserRenderer,
  cutToBytes,
  lanesDelays,
  parseBrowserBudgetSeconds,
  renderAllowed,
  startOfUtcDay,
} from '../src/render';
import type { BrowserLike, Launch, PageLike, RequestLike } from '../src/render';

describe('parseBrowserBudgetSeconds', () => {
  it('reads a whole number of seconds from 0 to 600', () => {
    expect(parseBrowserBudgetSeconds('480')).toBe(480);
    expect(parseBrowserBudgetSeconds('0')).toBe(0);
    expect(parseBrowserBudgetSeconds('600')).toBe(600);
  });
  it.each([[undefined], [''], ['abc'], ['-5'], ['1.5'], ['601'], ['1e3'], [' 480'], ['4 80']])('falls back to the default for %j', (raw) => {
    expect(parseBrowserBudgetSeconds(raw as string | undefined)).toBe(DEFAULT_BROWSER_BUDGET_SECONDS);
  });
  it('keeps a margin under the free plan\'s 600 seconds by default', () => {
    expect(DEFAULT_BROWSER_BUDGET_SECONDS).toBe(480);
  });
});

describe('renderAllowed', () => {
  it('allows a render while the time used today plus the longest render stays within the budget', () => {
    expect(renderAllowed(0, 480)).toBe(true);
    expect(renderAllowed(100_000, 480)).toBe(true);
  });
  it('allows exactly up to the budget and refuses one millisecond more', () => {
    expect(renderAllowed(480_000 - RENDER_MAX_MS, 480)).toBe(true);
    expect(renderAllowed(480_000 - RENDER_MAX_MS + 1, 480)).toBe(false);
  });
  it('refuses when the budget is smaller than one render, or the day is already over budget', () => {
    expect(renderAllowed(0, 0)).toBe(false);
    expect(renderAllowed(0, 29)).toBe(false);
    expect(renderAllowed(600_000, 480)).toBe(false);
  });
  it('does not trust a used time that is not a plain non-negative number: the answer is no', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) expect(renderAllowed(bad, 480), String(bad)).toBe(false);
  });
});

describe('startOfUtcDay', () => {
  it('is midnight UTC of the day, in the stored time format', () => {
    expect(startOfUtcDay(new Date('2026-10-31T22:43:12.345Z'))).toBe('2026-10-31T00:00:00Z');
    expect(startOfUtcDay(new Date('2026-11-01T00:00:00.000Z'))).toBe('2026-11-01T00:00:00Z');
    expect(startOfUtcDay(new Date('2026-11-01T23:59:59.999Z'))).toBe('2026-11-01T00:00:00Z');
  });
  it('uses UTC, not the time zone of the machine', () => {
    expect(startOfUtcDay(new Date('2026-11-01T01:30:00+02:00'))).toBe('2026-10-31T00:00:00Z');
  });
});

describe('lanesDelays', () => {
  const stores = (...modes: Array<'plain' | 'browser'>) => modes.map((fetchMode) => ({ fetchMode }));
  it('spaces plain stores 15 apart and browser stores 25 apart, each lane from 0', () => {
    expect(lanesDelays(stores('plain', 'browser', 'plain', 'browser', 'plain', 'browser'), 15, RENDER_GAP_SECONDS)).toEqual([0, 0, 15, RENDER_GAP_SECONDS, 30, 2 * RENDER_GAP_SECONDS]);
  });
  it('is the old single lane when no store is read by a browser', () => {
    expect(lanesDelays(stores('plain', 'plain', 'plain'), 15, RENDER_GAP_SECONDS)).toEqual([0, 15, 30]);
  });
  it('handles only browser stores, one store and none', () => {
    expect(lanesDelays(stores('browser', 'browser'), 15, RENDER_GAP_SECONDS)).toEqual([0, RENDER_GAP_SECONDS]);
    expect(lanesDelays(stores('browser'), 15, RENDER_GAP_SECONDS)).toEqual([0]);
    expect(lanesDelays([], 15, RENDER_GAP_SECONDS)).toEqual([]);
  });
  it('keeps the two lanes independent: the plain lane does not shift when a browser store comes between', () => {
    expect(lanesDelays(stores('plain', 'plain', 'plain'), 15, 25)).toEqual(lanesDelays(stores('plain', 'browser', 'plain', 'browser', 'plain'), 15, 25).filter((_, i) => i % 2 === 0));
  });
  it('leaves at least 20 seconds between one browser CLOSING and the next one starting, even when a render takes the whole 30 seconds (the free plan\'s limit)', () => {
    // Cloudflare counts the 20 seconds from when the previous browser closes, not from when it started (Story 5.1 spike: a render of
    // 27 s followed 25 s later by the next launch was refused with `rate_limited`). A render never runs past RENDER_MAX_MS.
    expect(RENDER_GAP_SECONDS - RENDER_MAX_MS / 1000).toBeGreaterThanOrEqual(20);
  });
  it('keeps the whole lane of 21 stores well inside the 45 minutes between the nightly start and the finalising run', () => {
    const delays = lanesDelays(stores(...Array.from({ length: 21 }, () => 'browser' as const)), 15, RENDER_GAP_SECONDS);
    expect(delays[delays.length - 1]).toBeLessThan(30 * 60);
  });
});

describe('cutToBytes', () => {
  it('leaves a text within the limit as it is, including one of exactly the limit', () => {
    expect(cutToBytes('abc', 10)).toEqual({ text: 'abc', bytes: 3, truncated: false });
    expect(cutToBytes('abcde', 5)).toEqual({ text: 'abcde', bytes: 5, truncated: false });
  });
  it('cuts a longer text at the limit and says so', () => {
    expect(cutToBytes('abcdef', 4)).toEqual({ text: 'abcd', bytes: 4, truncated: true });
  });
  it('counts bytes, not characters, and survives a character cut in half', () => {
    const cut = cutToBytes('aé€', 3); // a (1) + é (2) fits; the euro sign (3) does not
    expect(cut).toEqual({ text: 'aé', bytes: 3, truncated: true });
    expect(() => cutToBytes('€€€', 4)).not.toThrow();
    expect(cutToBytes('€€€', 4).truncated).toBe(true);
  });
});

// ---------- the adapter, against a fake browser ----------

interface Script {
  /** What `goto` does: a status, null, or an error to throw. */
  goto?: { status: number } | null | Error;
  content?: string;
  finalUrl?: string;
  userAgent?: string;
  waitForFunction?: Error;
  launch?: Error;
  newPage?: Error;
  close?: Error;
}

function setup(script: Script = {}) {
  const calls: string[] = [];
  const state = { closed: 0, pages: 0, gotos: 0, launched: 0, handler: undefined as ((request: RequestLike) => void) | undefined, gotoArgs: undefined as unknown, waitArgs: undefined as unknown, bindingSeen: undefined as unknown, userAgentSet: undefined as string | undefined };
  const page: PageLike = {
    async setUserAgent(userAgent) {
      calls.push('setUserAgent');
      state.userAgentSet = userAgent;
    },
    async setRequestInterception(enabled) {
      calls.push(`interception:${enabled}`);
    },
    on(event, handler) {
      calls.push(`on:${event}`);
      state.handler = handler;
    },
    async goto(url, options) {
      calls.push('goto');
      state.gotos += 1;
      state.gotoArgs = { url, ...options };
      const answer = script.goto === undefined ? { status: 200 } : script.goto;
      if (answer instanceof Error) throw answer;
      return answer === null ? null : { status: () => answer.status };
    },
    async waitForFunction(expression, options) {
      calls.push('waitForFunction');
      state.waitArgs = { expression, ...options };
      if (script.waitForFunction) throw script.waitForFunction;
    },
    async evaluate() {
      return script.userAgent ?? USER_AGENT;
    },
    async content() {
      calls.push('content');
      return script.content ?? '<html>page</html>';
    },
    url: () => script.finalUrl ?? 'https://shop.example/sale',
  };
  const browser: BrowserLike = {
    async newPage() {
      if (script.newPage) throw script.newPage;
      state.pages += 1;
      return page;
    },
    async close() {
      state.closed += 1;
      if (script.close) throw script.close;
    },
  };
  const launch: Launch = async (binding) => {
    state.launched += 1;
    state.bindingSeen = binding;
    if (script.launch) throw script.launch;
    return browser;
  };
  let time = 1_000;
  const renderer = createBrowserRenderer({ fetch: (() => Promise.reject(new Error('no'))) as typeof fetch }, launch, () => (time += 250));
  return { renderer, state, calls };
}

const request = (type: string) => {
  const seen = { aborted: 0, continued: 0 };
  const value: RequestLike = { resourceType: () => type, abort: () => void (seen.aborted += 1), continue: () => void (seen.continued += 1) };
  return { value, seen };
};

describe('createBrowserRenderer', () => {
  it('sets the bot\'s user-agent before it loads anything, and asks for exactly one page and one navigation', async () => {
    const { renderer, state, calls } = setup();
    const result = await renderer.render('https://shop.example/sale');
    expect(result.ok).toBe(true);
    expect(state.userAgentSet).toBe(USER_AGENT);
    expect(calls.indexOf('setUserAgent')).toBeLessThan(calls.indexOf('goto'));
    expect(calls.indexOf('interception:true')).toBeLessThan(calls.indexOf('goto'));
    expect(state.launched).toBe(1);
    expect(state.pages).toBe(1);
    expect(state.gotos).toBe(1);
  });

  it('goes to the address with a 20 second limit and does not wait for every download', async () => {
    const { renderer, state } = setup();
    await renderer.render('https://shop.example/sale');
    expect(state.gotoArgs).toEqual({ url: 'https://shop.example/sale', waitUntil: 'domcontentloaded', timeout: 20_000 });
  });

  it('stops images, fonts, media and style sheets from downloading, and lets the document, scripts and data calls through', async () => {
    const { renderer, state } = setup();
    await renderer.render('https://shop.example/sale');
    for (const type of ['image', 'font', 'media', 'stylesheet']) {
      const r = request(type);
      state.handler?.(r.value);
      expect(r.seen, type).toEqual({ aborted: 1, continued: 0 });
    }
    for (const type of ['document', 'script', 'xhr', 'fetch', 'other']) {
      const r = request(type);
      state.handler?.(r.value);
      expect(r.seen, type).toEqual({ aborted: 0, continued: 1 });
    }
  });

  it('does not raise an unhandled rejection when a request can no longer be answered (the page has gone)', async () => {
    const { renderer, state } = setup();
    await renderer.render('https://shop.example/sale');
    const gone = (type: string): RequestLike => ({
      resourceType: () => type,
      abort: () => Promise.reject(new Error('Target closed')),
      continue: () => Promise.reject(new Error('Request is already handled')),
    });
    state.handler?.(gone('image'));
    state.handler?.(gone('script'));
    await new Promise((resolve) => setTimeout(resolve, 0)); // a rejection nobody handles would fail the test run here
  });

  it('waits at most 8 seconds for a price to show in the text', async () => {
    const { renderer, state } = setup();
    await renderer.render('https://shop.example/sale');
    const wait = state.waitArgs as { expression: string; timeout: number };
    expect(wait.timeout).toBe(8_000);
    // The expression runs in the browser: a price is `R` and digits, not inside a word.
    const looksForPrice = new Function('document', `return ${wait.expression}`);
    expect(looksForPrice({ body: { innerText: 'Was R199 now R99' } })).toBe(true);
    expect(looksForPrice({ body: { innerText: 'Now R 99' } })).toBe(true);
    expect(looksForPrice({ body: { innerText: 'SAVE BIG, ZAR is not it, FOR 10' } })).toBe(false);
    expect(looksForPrice({ body: null })).toBe(false);
  });

  it('takes the page as it is when no price shows within the time, and still returns it', async () => {
    const { renderer } = setup({ waitForFunction: Object.assign(new Error('Waiting failed: 8000ms exceeded'), { name: 'TimeoutError' }), content: '<html>shell</html>' });
    const result = await renderer.render('https://shop.example/sale');
    expect(result).toMatchObject({ ok: true, html: '<html>shell</html>', status: 200 });
  });

  it('returns the status, the final address, the html, its size, the user-agent the page saw and the time taken', async () => {
    const { renderer } = setup({ goto: { status: 200 }, content: '<html>é</html>', finalUrl: 'https://shop.example/collections/sale' });
    const result = await renderer.render('https://shop.example/sale');
    expect(result).toEqual({ ok: true, status: 200, finalUrl: 'https://shop.example/collections/sale', html: '<html>é</html>', truncated: false, bytes: 15, userAgent: USER_AGENT, ms: expect.any(Number) });
    expect((result as { ms: number }).ms).toBeGreaterThan(0);
  });

  it('cuts a page longer than the read limit and says so', async () => {
    const { renderer } = setup({ content: 'x'.repeat(MAX_PAGE_BYTES + 10) });
    const result = await renderer.render('https://shop.example/sale');
    expect(result).toMatchObject({ ok: true, truncated: true, bytes: MAX_PAGE_BYTES });
    expect((result as { html: string }).html.length).toBe(MAX_PAGE_BYTES);
  });

  it('reports the status the store answered, even a refusal, so the caller can classify it', async () => {
    for (const status of [403, 404, 429, 500]) {
      const { renderer } = setup({ goto: { status } });
      expect(await renderer.render('https://shop.example/sale'), String(status)).toMatchObject({ ok: true, status });
    }
  });

  it('closes the browser after a success, after a navigation timeout, after a thrown error and when there is no answer', async () => {
    const cases: Script[] = [
      {},
      { goto: Object.assign(new Error('Navigation timeout of 20000 ms exceeded'), { name: 'TimeoutError' }) },
      { goto: new Error('net::ERR_FAILED') },
      { goto: null },
      { newPage: new Error('page failed') },
    ];
    for (const script of cases) {
      const { renderer, state } = setup(script);
      await renderer.render('https://shop.example/sale');
      expect(state.closed, JSON.stringify(script, (_, v) => (v instanceof Error ? v.message : v))).toBe(1);
    }
  });

  it('gives a short reason for each way it can fail, and never throws', async () => {
    const timeout = Object.assign(new Error('Navigation timeout of 20000 ms exceeded'), { name: 'TimeoutError' });
    const cases: Array<[Script, string]> = [
      [{ launch: new Error('Unable to create new browser: code: 429: message: Rate limit exceeded') }, 'rate_limited'],
      [{ launch: new Error('429') }, 'rate_limited'],
      [{ launch: new Error('Too many requests') }, 'rate_limited'],
      [{ launch: new Error('Unable to create new browser') }, 'launch_failed'],
      [{ goto: null }, 'navigation_failed'],
      [{ goto: timeout }, 'timeout'],
      [{ goto: new Error('net::ERR_NAME_NOT_RESOLVED') }, 'render_failed'],
      [{ newPage: new Error('Target closed') }, 'render_failed'],
    ];
    for (const [script, reason] of cases) {
      const { renderer } = setup(script);
      const result = await renderer.render('https://shop.example/sale');
      expect(result, reason).toMatchObject({ ok: false, reason });
      expect((result as { ms: number }).ms).toBeGreaterThanOrEqual(0);
    }
  });

  it('does not start a page when the browser could not be launched, and has nothing to close', async () => {
    const { renderer, state } = setup({ launch: new Error('Unable to create new browser') });
    await renderer.render('https://shop.example/sale');
    expect(state.pages).toBe(0);
    expect(state.closed).toBe(0);
  });

  it('still returns the page when closing the browser fails', async () => {
    const { renderer } = setup({ close: new Error('already closed') });
    expect(await renderer.render('https://shop.example/sale')).toMatchObject({ ok: true });
  });

  it('hands the Worker\'s browser binding to the launcher', async () => {
    const { renderer, state } = setup();
    await renderer.render('https://shop.example/sale');
    expect(typeof (state.bindingSeen as { fetch: unknown }).fetch).toBe('function');
  });
});
