import { defineConfig } from 'vitest/config';

// Only the unit tests: the Playwright smoke test (`tests/smoke.spec.ts`) has its own runner (`pnpm test:smoke`).
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'] },
});
