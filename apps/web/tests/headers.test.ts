import { describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY, withSiteHeaders } from '../src/lib/headers';

const page = () => new Response('<p>hi</p>', { status: 200, headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=600' } });

describe('withSiteHeaders (Story 2.4)', () => {
  it('adds the three security headers in a production build', () => {
    const response = withSiteHeaders(page(), { production: true, allowIndexing: true });
    expect(response.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });
  it('adds none of them outside a production build (astro dev injects scripts the policy would block)', () => {
    const response = withSiteHeaders(page(), { production: false, allowIndexing: true });
    expect(response.headers.get('content-security-policy')).toBeNull();
    expect(response.headers.get('x-content-type-options')).toBeNull();
  });
  it('tells crawlers to stay away unless indexing is allowed, in any build', () => {
    expect(withSiteHeaders(page(), { production: true, allowIndexing: false }).headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(withSiteHeaders(page(), { production: false, allowIndexing: false }).headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(withSiteHeaders(page(), { production: true, allowIndexing: true }).headers.get('x-robots-tag')).toBeNull();
  });
  it('keeps the status, body and the headers it was given', async () => {
    const response = withSiteHeaders(new Response('down', { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '60' } }), { production: true, allowIndexing: false });
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('down');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('retry-after')).toBe('60');
  });
  it('returns a copy and leaves the response it was given alone', () => {
    const original = page();
    const response = withSiteHeaders(original, { production: true, allowIndexing: false });
    expect(response).not.toBe(original);
    expect(original.headers.get('content-security-policy')).toBeNull();
    expect(original.headers.get('x-robots-tag')).toBeNull();
  });
  it('works on a response whose headers are read-only', () => {
    const frozen = page();
    Object.defineProperty(frozen.headers, 'set', {
      value: () => {
        throw new TypeError('immutable');
      },
    });
    expect(() => withSiteHeaders(frozen, { production: true, allowIndexing: false })).not.toThrow();
  });
  it('has the architecture\'s policy: self only, the Insights host for scripts and connect, no inline script, no framing', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self' https://static.cloudflareinsights.com");
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'self' https://cloudflareinsights.com");
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });
});
