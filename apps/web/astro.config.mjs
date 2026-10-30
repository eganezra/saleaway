import process from 'node:process';
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Server-rendered on Cloudflare Workers (architecture/tech-stack.md).
// No images and no sessions: the adapter would otherwise add an IMAGES and a SESSION (KV)
// binding, and the architecture uses neither.
//
// `SMOKE_PERSIST` is set only by `pnpm test:smoke`: the built site then reads a separate local database (Story 2.4), so the
// smoke test never touches the one `pnpm dev` uses and works where there is none (CI).
export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    imageService: 'passthrough',
    ...(process.env.SMOKE_PERSIST ? { persistState: { path: process.env.SMOKE_PERSIST } } : {}),
  }),
  session: false,
  // Names this build: part of the page cache key (Story 2.4), so a deploy never serves the previous build's cached HTML.
  // `assetsInlineLimit: 0` keeps the click script (Story 2.5) a separate file: Astro would otherwise put a script this small
  // into the page, and the site's CSP (`script-src 'self'`, no 'unsafe-inline') blocks an inline script.
  vite: { define: { __BUILD_ID__: JSON.stringify(String(Date.now())) }, build: { assetsInlineLimit: 0 } },
});
