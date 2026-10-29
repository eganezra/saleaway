# Testing Strategy

## Testing Pyramid

```text
        Playwright smoke + axe (1 to 2 tests)
       /                                    \
   Integration (Worker + local D1)       Pipeline integration
     /                                         \
  Core unit tests (page samples)       Web unit tests
```

## Test Organization

### Frontend Tests

```text
apps/web/tests/
├── view-model.test.ts       # homeViewModel with fixture rows
└── smoke.spec.ts            # Playwright: home loads, rows link out, axe has no violations
```

### Backend Tests

```text
packages/core/tests/
├── fixtures/                # trimmed samples from at least 5 stores
├── validate.test.ts  classify.test.ts
├── extract-shopify.test.ts  extract-html.test.ts  extract-structured.test.ts
├── rank.test.ts  visibility.test.ts  biggest-discounts.test.ts
apps/pipeline/tests/
├── process-store.test.ts    # with a stubbed fetch and local D1
└── fetcher.test.ts          # URL safety, redirect cap, robots.txt
```

### E2E Tests

```text
apps/web/tests/smoke.spec.ts   # the only browser test for the MVP
```

## Test Examples

### Frontend Component Test

```typescript
import { describe, it, expect } from 'vitest';
import { buildHomeViewModel } from '../src/lib/homeViewModel';

describe('home view model', () => {
  it('orders a category by biggest discount, then On sale by rank', () => {
    const vm = buildHomeViewModel(fixtureRows, new Date('2026-10-30T06:00:00Z'));
    const names = vm.categories[0].rows.map((r) => r.name);
    expect(names).toEqual(['Bash', 'Mr Price', 'Woolworths']);
  });
  it('hides the biggest-discounts card with fewer than 3 known percentages', () => {
    expect(buildHomeViewModel(twoPercentRows, now).biggestDiscounts).toEqual([]);
  });
});
```

### Backend API Test

```typescript
import { describe, it, expect } from 'vitest';
import { extractShopifyDiscount } from '../src/extract/shopify-json';

describe('shopify extractor', () => {
  it('returns the largest percentage from compare_at_price and price', () => {
    const json = { products: [{ variants: [{ price: '500.00', compare_at_price: '1000.00' }] },
                              { variants: [{ price: '90.00',  compare_at_price: '100.00' }] }] };
    expect(extractShopifyDiscount(json)).toBe(50);
  });
  it('ignores values outside 5 to 90 percent', () => {
    const json = { products: [{ variants: [{ price: '1.00', compare_at_price: '1000.00' }] }] };
    expect(extractShopifyDiscount(json)).toBeNull();
  });
});
```

### E2E Test

```typescript
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('home page lists sales and has no accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('a[data-store]').first()).toHaveAttribute('target', '_blank');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
```
