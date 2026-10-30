import { handleFetch, handleQueue, handleScheduled } from './handlers';
import { log } from './log';
import type { Deps, StoreJob } from './types';

// `fetch` must be wrapped: calling the bare global as `deps.fetch(url)` fails in Workers with "Illegal invocation".
const deps: Deps = {
  log,
  clock: () => new Date(),
  fetch: (input, init) => fetch(input, init),
  createRewriter: () => new HTMLRewriter(),
};

// The pipeline Worker (architecture/backend-architecture.md): `scheduled` starts and closes the daily run,
// `queue` processes one store per message, `fetch` serves POST /admin/run only.
export default {
  async scheduled(controller, env) {
    await handleScheduled(controller, env, deps);
  },
  async queue(batch, env) {
    await handleQueue(batch, env, deps);
  },
  async fetch(request, env) {
    return handleFetch(request, env, deps);
  },
} satisfies ExportedHandler<Env, StoreJob>;
