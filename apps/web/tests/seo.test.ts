import { describe, expect, it } from 'vitest';
import { FAVICON_HREF, HOME_DESCRIPTION, HOME_TITLE, SITEMAP_PATHS, canonicalUrl, isIndexingAllowed, robotsTxt, sitemapXml } from '../src/lib/seo';

describe('canonicalUrl (AC1)', () => {
  it('joins the site origin and the path', () => {
    expect(canonicalUrl('https://saleaway.online', '/')).toBe('https://saleaway.online/');
    expect(canonicalUrl('https://saleaway.online', '/about')).toBe('https://saleaway.online/about');
  });
  it('ignores a trailing slash, a path or a query on the site URL', () => {
    expect(canonicalUrl('https://saleaway.online/', '/about')).toBe('https://saleaway.online/about');
    expect(canonicalUrl('https://saleaway.online/some/path?x=1', '/')).toBe('https://saleaway.online/');
  });
  it('drops a query and a fragment from the path, and adds a missing leading slash', () => {
    expect(canonicalUrl('https://saleaway.online', '/?utm_source=x#top')).toBe('https://saleaway.online/');
    expect(canonicalUrl('https://saleaway.online', 'about')).toBe('https://saleaway.online/about');
    expect(canonicalUrl('https://saleaway.online', '')).toBe('https://saleaway.online/');
  });
  it.each([undefined, '', 'saleaway.online', 'http://saleaway.online', 'javascript:alert(1)', 'ftp://x.example', 'https://'])(
    'falls back to the default site for %j',
    (site) => {
      expect(canonicalUrl(site, '/')).toBe('https://saleaway.online/');
    },
  );
  it('keeps another https site, such as a workers.dev address', () => {
    expect(canonicalUrl('https://preview.example.org', '/')).toBe('https://preview.example.org/');
  });
});

describe('isIndexingAllowed', () => {
  it('is true only for the exact text "true"', () => {
    expect(isIndexingAllowed('true')).toBe(true);
    for (const value of [undefined, '', 'false', 'TRUE', 'True', 'yes', '1', ' true']) expect(isIndexingAllowed(value), String(value)).toBe(false);
  });
});

describe('robotsTxt (AC2)', () => {
  it('keeps crawlers out when indexing is not allowed', () => {
    expect(robotsTxt('https://saleaway.online', false)).toBe('User-agent: *\nDisallow: /\n');
  });
  it('allows crawling and names the sitemap when indexing is allowed', () => {
    expect(robotsTxt('https://saleaway.online', true)).toBe('User-agent: *\nAllow: /\n\nSitemap: https://saleaway.online/sitemap.xml\n');
  });
  it('uses the fallback site when the setting is bad', () => {
    expect(robotsTxt('nonsense', true)).toContain('Sitemap: https://saleaway.online/sitemap.xml');
  });
  it('ends with a newline', () => {
    expect(robotsTxt(undefined, true).endsWith('\n')).toBe(true);
    expect(robotsTxt(undefined, false).endsWith('\n')).toBe(true);
  });
});

describe('sitemapXml (AC2)', () => {
  it('is a urlset with one url per path', () => {
    const xml = sitemapXml('https://saleaway.online', ['/', '/about']);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')).toBe(true);
    expect(xml.match(/<loc>/g)).toHaveLength(2);
    expect(xml).toContain('<loc>https://saleaway.online/</loc>');
    expect(xml).toContain('<loc>https://saleaway.online/about</loc>');
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
  });
  it('escapes characters that are special in XML', () => {
    const xml = sitemapXml('https://saleaway.online', ["/a&b<c>d\"e'f"]);
    expect(xml).toContain('<loc>https://saleaway.online/a&amp;b&lt;c&gt;d&quot;e&apos;f</loc>');
    expect(xml).not.toMatch(/<loc>[^<]*&(?!amp;|lt;|gt;|quot;|apos;)[^<]*<\/loc>/);
  });
  it('handles an empty list', () => {
    const xml = sitemapXml('https://saleaway.online', []);
    expect(xml).toContain('<urlset');
    expect(xml).not.toContain('<url>');
  });
  it('lists the home page, About and Privacy (there is no Contact page)', () => {
    expect(SITEMAP_PATHS).toEqual(['/', '/about', '/privacy']);
  });
});

describe('the home page text and the favicon (AC1)', () => {
  it('has a title of at most 60 characters and a description of at most 160', () => {
    expect(HOME_TITLE.length).toBeLessThanOrEqual(60);
    expect(HOME_DESCRIPTION.length).toBeLessThanOrEqual(160);
    expect(HOME_DESCRIPTION.length).toBeGreaterThan(50);
  });
  it('states no count and no time in the description (a cached copy would make them wrong)', () => {
    expect(HOME_DESCRIPTION).not.toMatch(/\d/);
    expect(HOME_TITLE).not.toMatch(/\d/);
  });
  it('has a favicon that is a data URI with nothing that would end the address early', () => {
    expect(FAVICON_HREF.startsWith('data:image/svg+xml,')).toBe(true);
    expect(FAVICON_HREF).not.toMatch(/[#"<>\s]/);
    expect(decodeURIComponent(FAVICON_HREF.slice('data:image/svg+xml,'.length))).toContain('<svg');
  });
});
