import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Server-rendered on Cloudflare Workers (architecture/tech-stack.md).
// No images and no sessions: the adapter would otherwise add an IMAGES and a SESSION (KV)
// binding, and the architecture uses neither.
export default defineConfig({
  output: 'server',
  adapter: cloudflare({ imageService: 'passthrough' }),
  session: false,
});
