import type { Logger } from '@saleaway/core';
import { clickAmount, parseSampleRate, parseSlug, shouldCount, utcDay } from './click';
import { recordClick } from './db';

// The click beacon's endpoint (Story 2.5), written so that it needs nothing from Astro or Cloudflare: everything comes in as
// arguments, so it is unit-tested. It reads, logs and stores nothing about the visitor: no address, user-agent, cookie or referrer.

/** A beacon body is one store slug: anything longer than this is refused. */
export const MAX_BODY_BYTES = 100;
const READ_LIMIT = 128;

export interface ClickDeps {
  db: Parameters<typeof recordClick>[0];
  log: Pick<Logger, 'error'>;
  random: () => number;
  now: () => Date;
  /** The `CLICK_SAMPLE_RATE` setting, as text. */
  sampleRate: string | undefined;
}

function answer(status: number, body: string | null = null): Response {
  return new Response(body, { status, headers: { 'Cache-Control': 'no-store', ...(body === null ? {} : { 'Content-Type': 'text/plain; charset=utf-8' }) } });
}

/** The body as text, or null when it is longer than the limit. Reads no more than the limit plus one chunk. */
async function readSmallBody(request: Request): Promise<string | null> {
  if (request.body === null) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    size += next.value.byteLength;
    if (size > READ_LIMIT) {
      await reader.cancel();
      return null;
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Handles one `POST /api/click`. Never throws. */
export async function handleClick(request: Request, deps: ClickDeps): Promise<Response> {
  try {
    const length = Number(request.headers.get('content-length'));
    if (request.headers.has('content-length') && Number.isFinite(length) && length > MAX_BODY_BYTES) return answer(413, 'too_large');

    // A browser sends `Origin` on a POST; one from another site is refused. A request with none (a script) is allowed: this
    // only increments a counter.
    const origin = request.headers.get('origin');
    if (origin !== null && origin !== new URL(request.url).origin) return answer(403, 'wrong_origin');

    const text = await readSmallBody(request);
    if (text === null || new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return answer(413, 'too_large');
    const slug = parseSlug(text);
    if (slug === null) return answer(400, 'bad_slug');

    const rate = parseSampleRate(deps.sampleRate);
    if (!shouldCount(rate, deps.random)) return answer(204);

    try {
      return (await recordClick(deps.db, slug, utcDay(deps.now()), clickAmount(rate))) ? answer(204) : answer(404, 'unknown_store');
    } catch (err) {
      deps.log.error('click_failed', { slug, err });
      return answer(503, 'unavailable');
    }
  } catch {
    return answer(400, 'bad_request');
  }
}
