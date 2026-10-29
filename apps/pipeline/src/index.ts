import { handleFetch, handleQueue, handleScheduled } from './handlers';
import { log } from './log';
import type { Deps, StoreJob } from './types';

const deps: Deps = { log, clock: () => new Date() };

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
