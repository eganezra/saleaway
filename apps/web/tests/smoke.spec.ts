import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Story 2.4: the one browser test. The built site runs against `tests/smoke-fixture.sql` (3 categories, 16 stores, one
// category with more than 8 stores). Two widths: a desktop and a phone.
const WIDTHS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'phone', width: 360, height: 740 },
] as const;

// WCAG 2.0 and 2.1 Level A and AA and 2.2 AA. `wcag21a` holds 2.5.3 Label in Name, whose rule axe keeps behind an "experimental" switch, so
// it is turned on by name (it was missing until QA's review of Story 2.5: the row links failed it).
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const AXE_OPTIONS = { rules: { 'label-content-name-mismatch': { enabled: true } } };

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

    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).options(AXE_OPTIONS).analyze();
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
  // the edge keeps it for 600 seconds; the browser is told to ask again (it must not keep a previous build's page)
  expect(second.headers()['cache-control']).toBe('public, max-age=0, must-revalidate');
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

// ---- Story 2.5: the layout, the pages, the beacon and the flags ----

const BOT_USER_AGENT = 'SaleawayBot/1.0 (+https://saleaway.online/contact)';

for (const path of ['/', '/about']) {
  test(`the skip link is the first thing Tab reaches on ${path}, and Enter moves focus to the main part`, async ({ page }) => {
    await page.goto(path);
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveText('Skip to content');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('main');
  });
}

for (const { name, width, height } of WIDTHS) {
  test(`the header and footer are there and nothing overflows (${name})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await page.goto('/');
    const header = page.locator('header');
    await expect(header.getByRole('link', { name: 'Saleaway' })).toHaveAttribute('href', '/');
    await expect(header.getByRole('link', { name: 'Categories' })).toHaveAttribute('href', '/#categories');
    await expect(header.getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '/about');
    const footerLinks = page.locator('footer a');
    await expect(footerLinks).toHaveCount(2);
    await expect(footerLinks.nth(0)).toHaveText('About');
    await expect(footerLinks.nth(1)).toHaveText('Privacy');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await context.close();
  });

  test(`/about and /privacy have no accessibility violations and no console errors (${name})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height } });
    for (const path of ['/about', '/privacy']) {
      const page = await context.newPage();
      const problems = watchProblems(page);
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).options(AXE_OPTIONS).analyze();
      expect(results.violations.map((v) => `${path} ${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
      expect(problems, path).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${path} overflows`).toBe(true);
      await page.close();
    }
    await context.close();
  });
}

test('the About page names the bot and has the "Our bot" part; the Privacy page says no cookies and names the visit count that is running', async ({ page }) => {
  await page.goto('/about');
  await expect(page.locator('h2#our-bot')).toHaveText('Our bot');
  await expect(page.locator('main')).toContainText(BOT_USER_AGENT);
  await expect(page.locator('main')).toContainText('robots.txt');
  await page.goto('/privacy');
  await expect(page.locator('main')).toContainText("we don't use cookies");
  // Cloudflare adds its own cookie-free Web Analytics to the real domain (Story 4.4), so the page says visits are counted
  await expect(page.locator('main')).toContainText('Cloudflare Web Analytics');
});

test('/contact forwards to the "Our bot" part of the About page', async ({ request }) => {
  const response = await request.get('/contact', { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  expect(response.headers()['location']).toBe('/about#our-bot');
});

test('the page has no inline script, loads the click script from this site, and has no ad slot or analytics tag by default', async ({ page }) => {
  const scripts: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/_astro/') && response.url().endsWith('.js')) scripts.push(`${response.status()} ${response.url()}`);
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect(await page.locator('script:not([src])').count()).toBe(0);
  expect(await page.locator('script[src*="/_astro/"]').count()).toBe(1);
  expect(scripts).toHaveLength(1);
  expect(scripts[0]).toMatch(/^200 /);
  expect(await page.locator('[data-ad-slot]').count()).toBe(0);
  expect(await page.locator('script[src*="cloudflareinsights"]').count()).toBe(0);
});

test('following a store link sends the beacon, and the database counts it', async ({ browser, request }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  // no real request leaves the machine: the store's address is answered here
  await context.route('https://fashion-1.example/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>store</p>' }));
  await page.goto('/');
  const beacon = page.waitForResponse((r) => r.url().endsWith('/api/click') && r.request().method() === 'POST');
  const [store] = await Promise.all([context.waitForEvent('page'), page.locator('a[data-store="fashion-1"]').click()]);
  expect((await beacon).status()).toBe(204);
  await store.close();

  const today = new Date().toISOString().slice(0, 10);
  const out = execFileSync(
    'pnpm',
    ['exec', 'wrangler', 'd1', 'execute', 'saleaway', '--local', '--persist-to', '.wrangler/smoke', '--json', '--command', `SELECT clicks FROM click_counts WHERE day = '${today}' AND retailer_id = (SELECT id FROM retailers WHERE slug = 'fashion-1')`],
    { encoding: 'utf-8' },
  );
  const rows = (JSON.parse(out.slice(out.indexOf('['))) as Array<{ results: Array<{ clicks: number }> }>)[0]?.results ?? [];
  expect(rows).toEqual([{ clicks: 1 }]);

  // the endpoint's refusals
  const post = (data: string, headers: Record<string, string> = {}) => request.post('/api/click', { data, headers: { 'content-type': 'text/plain', ...headers } });
  expect((await post('no-such-store')).status()).toBe(404);
  expect((await post('Bad Slug!')).status()).toBe(400);
  expect((await post('fashion-1', { origin: 'https://evil.example' })).status()).toBe(403);
  expect((await post('a'.repeat(300))).status()).toBe(413);
  const get = await request.get('/api/click');
  expect(get.status()).toBe(405);
  expect(get.headers()['allow']).toBe('POST');
  const ok = await post('fashion-1');
  expect(ok.headers()['cache-control']).toBe('no-store');
  expect(ok.headers()['set-cookie']).toBeUndefined();
  await context.close();
});

test('the sitemap lists the home page, About and Privacy', async ({ request }) => {
  const xml = await (await request.get('/sitemap.xml')).text();
  for (const path of ['/', '/about', '/privacy']) expect(xml).toContain(`<loc>https://saleaway.online${path}</loc>`);
  expect(xml.match(/<loc>/g)).toHaveLength(3);
});
