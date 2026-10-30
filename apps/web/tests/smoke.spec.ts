import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Story 2.4: the one browser test. The built site runs against `tests/smoke-fixture.sql` (3 categories, 16 stores, one
// category with more than 8 stores). Two widths: a desktop and a phone.
const WIDTHS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'phone', width: 360, height: 740 },
] as const;

/** Collects what the browser complains about while the page loads (a CSP violation shows up as a console error). */
function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  return problems;
}

for (const { name, width, height } of WIDTHS) {
  test(`the home page lists sales and has no accessibility violations (${name})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    const problems = watchProblems(page);

    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Categories' })).toBeVisible();
    expect(await page.getByRole('heading', { level: 2 }).count()).toBe(3);
    const first = page.locator('a[data-store]').first();
    await expect(first).toHaveAttribute('target', '_blank');
    await expect(first).toHaveAttribute('rel', /noopener/);

    // headers: the security policy, and indexing off (the fixture runs with the default ALLOW_INDEXING "false")
    const headers = response?.headers() ?? {};
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-robots-tag']).toBe('noindex, nofollow');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://saleaway.online/');

    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
    expect(problems).toEqual([]);
    await context.close();
  });
}

test('the rows are in the page without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/');
  expect(await page.locator('a[data-store]').count()).toBe(16);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await context.close();
});

test('the page cache answers the second request, and the endpoints are served', async ({ request }) => {
  const first = await request.get('/');
  const second = await request.get('/?utm_source=smoke');
  expect(['MISS', 'HIT']).toContain(first.headers()['x-cache']);
  expect(second.headers()['x-cache']).toBe('HIT');
  expect(second.headers()['cache-control']).toBe('public, max-age=600');
  expect(await second.text()).toBe(await first.text());

  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  expect(robots.headers()['content-type']).toContain('text/plain');
  expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n');

  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.status()).toBe(200);
  expect(sitemap.headers()['content-type']).toContain('application/xml');
  expect(await sitemap.text()).toContain('<loc>https://saleaway.online/</loc>');
});

test('on a phone, a focused row is never hidden behind the sticky chip row, and "Show all" opens with Enter', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const page = await context.newPage();
  await page.goto('/');
  const chips = page.locator('nav[aria-label="Categories"]');
  await expect(chips).toBeVisible();

  // Forward, a new row arrives at the bottom edge; backward (Shift+Tab) it arrives at the top edge, where the sticky chip row
  // would cover it without `scroll-padding-top`. So both directions are checked.
  const hidden: string[] = [];
  const check = async (label: string) => {
    const state = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Categories"]')?.getBoundingClientRect();
      const active = document.activeElement;
      if (!nav || !active || active === document.body) return null;
      const box = active.getBoundingClientRect();
      const insideNav = active.closest('nav[aria-label="Categories"]') !== null;
      const overlaps = !insideNav && box.bottom > nav.top && box.top < nav.bottom;
      const inView = box.bottom > 0 && box.top < window.innerHeight;
      return { text: (active.textContent ?? '').trim().slice(0, 30), overlaps, inView };
    });
    if (state !== null && (state.overlaps || !state.inView)) hidden.push(`${label}: ${state.text} (overlaps ${state.overlaps}, in view ${state.inView})`);
  };
  for (let step = 1; step <= 40; step++) {
    await page.keyboard.press('Tab');
    await check(`Tab ${step}`);
  }
  for (let step = 1; step <= 30; step++) {
    await page.keyboard.press('Shift+Tab');
    await check(`Shift+Tab ${step}`);
  }
  expect(hidden).toEqual([]);

  const summary = page.locator('details > summary').first();
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('details').first()).toHaveAttribute('open', '');
  await context.close();
});
