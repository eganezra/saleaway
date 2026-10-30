import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { isIndexingAllowed, robotsTxt } from '../lib/seo';

export const GET: APIRoute = () =>
  new Response(robotsTxt(env.SITE_URL, isIndexingAllowed(env.ALLOW_INDEXING)), {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
