import { describe, expect, it } from 'vitest';
import { isSafeFetchUrl, resolveRedirect } from '../src/url-safety';

describe('isSafeFetchUrl', () => {
  it('accepts ordinary https sale URLs', () => {
    for (const url of [
      'https://bash.com/sale',
      'https://www.takealot.com/deals?x=1',
      'https://underarmour.co.za/collections/sale',
      'https://www.woolworths.co.za/browse/food-south-africa/promotions-specials',
      'https://clicks.co.za/beauty/c/OH10001?q=%3Arelevance&text=&count=20',
      'https://xn--bcher-kva.example/',
      'https://example.com:443/',
      'https://example.com./',
    ]) {
      expect(isSafeFetchUrl(url), url).toBe(true);
    }
  });

  it('rejects anything that is not https', () => {
    for (const url of ['http://example.com/', 'ftp://example.com/', 'javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'HTTP://EXAMPLE.COM/']) {
      expect(isSafeFetchUrl(url), url).toBe(false);
    }
  });

  it('rejects credentials and ports other than 443', () => {
    for (const url of ['https://user:pw@example.com/', 'https://user@example.com/', 'https://example.com:8443/', 'https://example.com:80/']) {
      expect(isSafeFetchUrl(url), url).toBe(false);
    }
  });

  it('rejects local names, with or without a trailing dot, in any letter case', () => {
    for (const url of [
      'https://localhost/', 'https://LOCALHOST/', 'https://a.localhost/', 'https://x.local/', 'https://x.internal/',
      'https://metadata.google.internal/',
      'https://localhost./', 'https://a.localhost./', 'https://x.local./', 'https://x.internal./',
      'https://intranet/', 'https://intranet./',
    ]) {
      expect(isSafeFetchUrl(url), url).toBe(false);
    }
  });

  it('rejects every IP address, in every way the URL parser writes one', () => {
    for (const url of [
      'https://127.0.0.1/', 'https://127.1/', 'https://2130706433/', 'https://0x7f.0.0.1/', 'https://017700000001/',
      'https://10.0.0.1/', 'https://169.254.169.254/latest/meta-data', 'https://192.168.1.1/', 'https://172.16.0.1/',
      'https://8.8.8.8/', 'https://127.0.0.1./',
      'https://[::1]/', 'https://[::ffff:127.0.0.1]/', 'https://[fe80::1]/', 'https://[2001:db8::1]/',
    ]) {
      expect(isSafeFetchUrl(url), url).toBe(false);
    }
  });

  it('rejects hosts with an empty label and text that is not a URL', () => {
    for (const url of ['https://example.com../', 'https://.example.com/', 'https://a..b.com/', '', 'not a url', '//example.com/', '/relative/path', 'https://']) {
      expect(isSafeFetchUrl(url), url).toBe(false);
    }
  });

  it('rejects a URL longer than 2048 characters', () => {
    expect(isSafeFetchUrl(`https://example.com/${'a'.repeat(2000)}`)).toBe(true); // 2,020 characters
    expect(isSafeFetchUrl(`https://example.com/${'a'.repeat(2028)}`)).toBe(true); // exactly 2,048
    expect(isSafeFetchUrl(`https://example.com/${'a'.repeat(2029)}`)).toBe(false); // 2,049
  });

  it('does not let a backslash or an encoded slash move the host', () => {
    expect(isSafeFetchUrl('https://example.com\\@127.0.0.1/')).toBe(true); // the host is example.com
    expect(isSafeFetchUrl('https://127.0.0.1\\@example.com/')).toBe(false); // the host is 127.0.0.1
    expect(isSafeFetchUrl('https://example.com%2f@evil.test/')).toBe(false); // credentials
  });

  it('rejects a value that is not a string', () => {
    expect(isSafeFetchUrl(undefined as unknown as string)).toBe(false);
    expect(isSafeFetchUrl(null as unknown as string)).toBe(false);
  });
});

describe('resolveRedirect', () => {
  const current = 'https://shop.example/sale/shoes?page=2';

  it('resolves a relative, path-relative, query-only and absolute Location', () => {
    expect(resolveRedirect(current, '/collections/sale')).toBe('https://shop.example/collections/sale');
    expect(resolveRedirect(current, 'boots')).toBe('https://shop.example/sale/boots');
    expect(resolveRedirect(current, '?page=3')).toBe('https://shop.example/sale/shoes?page=3');
    expect(resolveRedirect(current, 'https://www.shop.example/sale')).toBe('https://www.shop.example/sale');
    expect(resolveRedirect(current, 'https://other.example/x')).toBe('https://other.example/x');
  });

  it('resolves a protocol-relative Location to https', () => {
    expect(resolveRedirect(current, '//other.example/x')).toBe('https://other.example/x');
  });

  it('refuses a Location that is not safe to fetch', () => {
    for (const location of ['http://shop.example/sale', 'https://127.0.0.1/', 'https://169.254.169.254/', 'https://localhost./', 'ftp://shop.example/', 'javascript:alert(1)', 'https://u:p@shop.example/', 'https://']) {
      expect(resolveRedirect(current, location), location).toBeNull();
    }
  });
});
