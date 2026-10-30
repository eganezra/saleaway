import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { SITEMAP_PATHS, sitemapXml } from '../lib/seo';

// Served whether or not indexing is allowed (the robots rules decide what crawlers do with it).
export const GET: APIRoute = () =>
  new Response(sitemapXml(env.SITE_URL, SITEMAP_PATHS), {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
