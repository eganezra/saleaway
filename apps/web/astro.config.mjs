import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Server-rendered on Cloudflare Workers (architecture/tech-stack.md).
export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
});
