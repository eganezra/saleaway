import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { handleClick } from '../../lib/clickHandler';
import { log } from '../../lib/log';

// Story 2.5: the click-out counter. All the rules are in `lib/clickHandler.ts`; this only supplies what it needs.
export const POST: APIRoute = ({ request }) =>
  handleClick(request, { db: env.DB, log, random: Math.random, now: () => new Date(), sampleRate: env.CLICK_SAMPLE_RATE });

// Any other method is refused.
export const ALL: APIRoute = () => new Response('method_not_allowed', { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
