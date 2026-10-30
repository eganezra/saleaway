// What search engines are told (Story 2.4). Pure: no I/O, the caller passes the site URL and the indexing switch.

const DEFAULT_SITE_URL = 'https://saleaway.online';

/** The pages the sitemap lists. One place (Story 2.5 added About and Privacy; there is no Contact page). */
export const SITEMAP_PATHS: readonly string[] = ['/', '/about', '/privacy'];

export const HOME_TITLE = 'Saleaway: current sales from South African online stores';
// Plain facts, no store count and no time: a cached copy would make them wrong.
export const HOME_DESCRIPTION =
  'Saleaway lists South African online stores that have a sale on, shows the biggest discount we found and when each store was last checked.';

// A text-only mark (a yellow square with an ink S): no image file is shipped (NFR7). `img-src` allows `data:`.
const FAVICON_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='#ffd23f'/><text x='16' y='24' font-size='24' font-weight='800' text-anchor='middle' font-family='sans-serif' fill='#111111'>S</text></svg>";
export const FAVICON_HREF = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`;

/** True only for the exact text `"true"`: anything else (missing, `"TRUE"`, `"yes"`) keeps indexing off. */
export function isIndexingAllowed(value: string | undefined): boolean {
  return value === 'true';
}

/** The site's own address (scheme and host only), or the default when the setting is missing, invalid or not https. */
function siteOrigin(siteUrl: string | undefined): string {
  try {
    const url = new URL(siteUrl ?? '');
    return url.protocol === 'https:' && url.hostname !== '' ? url.origin : DEFAULT_SITE_URL;
  } catch {
    return DEFAULT_SITE_URL;
  }
}

/** The canonical address of a page: the site's origin and the path, without a query or a fragment. */
export function canonicalUrl(siteUrl: string | undefined, path: string): string {
  const clean = path.split(/[?#]/, 1)[0] ?? '';
  return `${siteOrigin(siteUrl)}${clean.startsWith('/') ? clean : `/${clean}`}`;
}

/** `robots.txt`: crawling and the sitemap when indexing is allowed, nothing at all when it is not. */
export function robotsTxt(siteUrl: string | undefined, allowIndexing: boolean): string {
  if (!allowIndexing) return 'User-agent: *\nDisallow: /\n';
  return `User-agent: *\nAllow: /\n\nSitemap: ${siteOrigin(siteUrl)}/sitemap.xml\n`;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** `sitemap.xml`: one `<url>` per path. */
export function sitemapXml(siteUrl: string | undefined, paths: readonly string[]): string {
  const urls = paths.map((path) => `  <url><loc>${escapeXml(canonicalUrl(siteUrl, path))}</loc></url>\n`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}</urlset>\n`;
}
