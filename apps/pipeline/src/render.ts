import { MAX_PAGE_BYTES, USER_AGENT } from '@saleaway/core';
import type { FetchMode } from './repo';

// Browser rendering for stores that load their products with JavaScript (Story 5.1). Only the pure helpers and the adapter live
// here; the decision to render is in `process-store.ts`. NFR6: at most one page load per store per day, `robots.txt` read first
// (by the caller), the bot's own user-agent, no attempt to hide the browser, no images, fonts, media or style sheets downloaded,
// no other page visited, and the browser always closed.

/** The most one render may take: navigation 20 s, a bounded wait for a price (8 s), then closing. */
export const RENDER_MAX_MS = 30_000;
/**
 * Render stores are spaced this far apart, in their own lane. The free plan allows a new browser only 20 seconds after the previous
 * one has CLOSED (Story 5.1 spike: a render of 27 s followed 25 s later by the next launch was refused as `rate_limited`), and a
 * render may take up to RENDER_MAX_MS, so the gap is that plus 25 seconds of margin.
 */
export const RENDER_GAP_SECONDS = RENDER_MAX_MS / 1000 + 25;
/** Of the free plan's 600 browser seconds a day, the pipeline plans for 480 and leaves a margin for test runs. */
export const DEFAULT_BROWSER_BUDGET_SECONDS = 480;
const MAX_BROWSER_BUDGET_SECONDS = 600;
const NAVIGATION_TIMEOUT_MS = 20_000;
const SETTLE_TIMEOUT_MS = 8_000;
const BLOCKED_RESOURCES: ReadonlySet<string> = new Set(['image', 'font', 'media', 'stylesheet']);

// The page counts as settled when its visible text holds a price (`R` and digits, not inside a word): the same shape the validator
// looks for. A string, because it runs in the browser.
const PRICE_IN_TEXT = '/(?<![A-Za-z0-9])R\\s?\\d/.test(document.body ? document.body.innerText : "")';

export type RenderFailure = 'launch_failed' | 'rate_limited' | 'navigation_failed' | 'timeout' | 'render_failed';

export type RenderResult =
  | {
      ok: true;
      status: number;
      finalUrl: string;
      html: string;
      /** The page was longer than the read limit, so the rest was cut. */
      truncated: boolean;
      bytes: number;
      /** The user-agent the page itself sees (it must be the bot's). */
      userAgent: string;
      ms: number;
    }
  | { ok: false; reason: RenderFailure; ms: number };

/** Renders one address in a browser. Injected through `Deps`, so tests never start a browser. It never throws. */
export interface Renderer {
  render(url: string): Promise<RenderResult>;
}

// ---------- pure helpers ----------

/** `BROWSER_BUDGET_SECONDS` as a whole number of seconds from 0 to 600, or the default when it is missing or not valid. */
export function parseBrowserBudgetSeconds(raw: string | undefined): number {
  if (raw === undefined || !/^\d+$/.test(raw)) return DEFAULT_BROWSER_BUDGET_SECONDS;
  const value = Number(raw);
  return value <= MAX_BROWSER_BUDGET_SECONDS ? value : DEFAULT_BROWSER_BUDGET_SECONDS;
}

/**
 * May one more render start? Only when the time already used today plus the most a render can take stays within the budget.
 * A used time that is not a whole, non-negative number is not trusted: the answer is no (the store keeps "On sale").
 */
export function renderAllowed(usedMs: number, budgetSeconds: number): boolean {
  if (!Number.isFinite(usedMs) || usedMs < 0) return false;
  return usedMs + RENDER_MAX_MS <= budgetSeconds * 1000;
}

/** The first moment of the UTC day of `now`, as `YYYY-MM-DDTHH:MM:SSZ`: where the free daily allowance starts counting. */
export function startOfUtcDay(now: Date): string {
  return `${now.toISOString().slice(0, 10)}T00:00:00Z`;
}

/**
 * The delay of each store's message, in the order given. Plain stores are spaced `staggerSeconds` apart; stores read by a browser
 * have their own lane, `renderGapSeconds` apart, because the free plan starts a new browser at most every 20 seconds. Both lanes
 * start at 0 and run side by side.
 */
export function lanesDelays(stores: ReadonlyArray<{ fetchMode: FetchMode }>, staggerSeconds: number, renderGapSeconds: number): number[] {
  let plain = 0;
  let browser = 0;
  return stores.map((store) => {
    if (store.fetchMode === 'browser') return renderGapSeconds * browser++;
    return staggerSeconds * plain++;
  });
}

/** `text` cut to at most `maxBytes` bytes of UTF-8 (a character cut in half becomes a replacement character). */
export function cutToBytes(text: string, maxBytes: number): { text: string; bytes: number; truncated: boolean } {
  const encoded = new TextEncoder().encode(text);
  if (encoded.byteLength <= maxBytes) return { text, bytes: encoded.byteLength, truncated: false };
  return { text: new TextDecoder().decode(encoded.subarray(0, maxBytes)), bytes: maxBytes, truncated: true };
}

// ---------- the adapter ----------

/** The small part of a browser page the adapter uses. The real `@cloudflare/puppeteer` objects have these methods. */
export interface PageLike {
  setUserAgent(userAgent: string): Promise<void>;
  setRequestInterception(enabled: boolean): Promise<void>;
  on(event: 'request', handler: (request: RequestLike) => void): unknown;
  goto(url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<{ status(): number } | null>;
  waitForFunction(expression: string, options: { timeout: number }): Promise<unknown>;
  evaluate(expression: string): Promise<unknown>;
  content(): Promise<string>;
  url(): string;
}

export interface RequestLike {
  resourceType(): string;
  abort(): Promise<void> | void;
  continue(): Promise<void> | void;
}

export interface BrowserLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

/** Starts a browser through the Worker's `BROWSER` binding. */
export type Launch = (binding: { fetch: typeof fetch }) => Promise<BrowserLike>;

/** The real launcher. The package is loaded when it is first needed, so tests and every non-render store never load it. */
export const launchCloudflareBrowser: Launch = async (binding) => {
  const { default: puppeteer } = await import('@cloudflare/puppeteer');
  return (await puppeteer.launch(binding)) as unknown as BrowserLike;
};

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const isTimeout = (err: unknown): boolean => err instanceof Error && (err.name === 'TimeoutError' || /timed? ?out|timeout/i.test(err.message));
const isRateLimit = (err: unknown): boolean => /\b429\b|rate.?limit|too many/i.test(message(err));

/**
 * The renderer for production: one browser, one page, one navigation, then the browser is closed whatever happens. It sets the bot's
 * user-agent before it loads anything, stops images, fonts, media and style sheets from downloading, waits at most 8 seconds for a
 * price to show in the text, and returns the page's HTML (cut at the read limit). It never throws.
 */
export function createBrowserRenderer(binding: { fetch: typeof fetch }, launch: Launch = launchCloudflareBrowser, now: () => number = Date.now): Renderer {
  return {
    async render(url) {
      const started = now();
      const failed = (reason: RenderFailure): RenderResult => ({ ok: false, reason, ms: now() - started });
      let browser: BrowserLike | undefined;
      try {
        try {
          browser = await launch(binding);
        } catch (err) {
          return failed(isRateLimit(err) ? 'rate_limited' : 'launch_failed');
        }
        const page = await browser.newPage();
        await page.setUserAgent(USER_AGENT);
        await page.setRequestInterception(true);
        page.on('request', (request) => {
          // Answering a request can fail once the page has gone ("Target closed", "already handled"); that is not an error of ours,
          // and a rejection nobody handles would be reported by the runtime.
          void (async () => {
            try {
              if (BLOCKED_RESOURCES.has(request.resourceType())) await request.abort();
              else await request.continue();
            } catch {
              // nothing left to answer
            }
          })();
        });
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
        if (response === null) return failed('navigation_failed');
        try {
          await page.waitForFunction(PRICE_IN_TEXT, { timeout: SETTLE_TIMEOUT_MS });
        } catch {
          // No price within the time: the page is taken as it is, and the validator judges it.
        }
        const html = cutToBytes(await page.content(), MAX_PAGE_BYTES);
        const userAgent = String(await page.evaluate('navigator.userAgent'));
        return { ok: true, status: response.status(), finalUrl: page.url(), html: html.text, truncated: html.truncated, bytes: html.bytes, userAgent, ms: now() - started };
      } catch (err) {
        return failed(isTimeout(err) ? 'timeout' : 'render_failed');
      } finally {
        if (browser !== undefined) {
          try {
            await browser.close();
          } catch {
            // nothing more to free
          }
        }
      }
    },
  };
}
