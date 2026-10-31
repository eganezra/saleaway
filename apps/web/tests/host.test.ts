import { describe, expect, it } from 'vitest';
import { wwwRedirectTarget } from '../src/lib/host';

const SITE = 'https://saleaway.online';

describe('wwwRedirectTarget', () => {
  it('sends www to the same page on the site address', () => {
    expect(wwwRedirectTarget('https://www.saleaway.online/', SITE)).toBe('https://saleaway.online/');
    expect(wwwRedirectTarget('https://www.saleaway.online/about', SITE)).toBe('https://saleaway.online/about');
    expect(wwwRedirectTarget('https://www.saleaway.online', SITE)).toBe('https://saleaway.online/');
  });

  it('keeps the query string', () => {
    expect(wwwRedirectTarget('https://www.saleaway.online/?utm_source=x&a=1', SITE)).toBe('https://saleaway.online/?utm_source=x&a=1');
  });

  it('does not touch the site itself or any other host', () => {
    for (const url of [
      'https://saleaway.online/',
      'https://wwwxsaleaway.online/',
      'https://www.www.saleaway.online/',
      'https://www.evil.com/',
      'https://saleaway.online.evil.com/',
      'https://sub.saleaway.online/',
      'https://saleaway-web.example.workers.dev/',
      'http://localhost:4321/',
    ]) {
      expect(wwwRedirectTarget(url, SITE), url).toBeNull();
    }
  });

  it('is not case sensitive about the host and ignores a port', () => {
    expect(wwwRedirectTarget('https://WWW.SaleAway.Online/x', SITE)).toBe('https://saleaway.online/x');
  });

  it('cannot be made to lead anywhere but the site: the target always starts with the site origin', () => {
    for (const path of ['//evil.com/x', '/\\evil.com', '/..//evil.com', '/%2F%2Fevil.com', '/@evil.com']) {
      const target = wwwRedirectTarget(`https://www.saleaway.online${path}`, SITE);
      expect(target, path).not.toBeNull();
      expect(new URL(target as string).origin, path).toBe(SITE);
    }
  });

  it('uses the default address when the setting is missing or not https, and never redirects for a broken request address', () => {
    expect(wwwRedirectTarget('https://www.saleaway.online/a', undefined)).toBe('https://saleaway.online/a');
    expect(wwwRedirectTarget('https://www.saleaway.online/a', 'http://saleaway.online')).toBe('https://saleaway.online/a');
    expect(wwwRedirectTarget('https://www.saleaway.online/a', 'not a url')).toBe('https://saleaway.online/a');
    expect(wwwRedirectTarget('not a url', SITE)).toBeNull();
    expect(wwwRedirectTarget('', SITE)).toBeNull();
  });

  it('follows the configured address when the site moves', () => {
    expect(wwwRedirectTarget('https://www.example.test/p?q=1', 'https://example.test')).toBe('https://example.test/p?q=1');
    expect(wwwRedirectTarget('https://www.saleaway.online/p', 'https://example.test')).toBeNull();
  });
});
