import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

// The smoke test (Story 2.4): the built site, started with `astro preview` against its own small local database (made by
// `pnpm smoke:prepare`), so it never touches the database `pnpm dev` uses and works where there is none (CI).
const PORT = 4331;

export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, channel: process.env.PLAYWRIGHT_CHANNEL || undefined },
  webServer: {
    command: `pnpm exec astro preview --ignore-lock --host 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { SMOKE_PERSIST: resolve('.wrangler/smoke') },
  },
});
