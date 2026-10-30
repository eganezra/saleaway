import { toIsoUtc } from '@saleaway/core';
import { isAuthorized } from './auth';
import { isPaused } from './config';
import { findRunnableRetailerIdBySlug } from './repo';
import { startRun } from './start-run';
import type { Deps } from './types';

/** The architecture's error shape for the two internal endpoints (error-handling-strategy.md). */
function apiError(status: number, code: string, message: string, deps: Deps): Response {
  return Response.json(
    { error: { code, message, requestId: crypto.randomUUID(), timestamp: toIsoUtc(deps.clock()) } },
    { status },
  );
}

/**
 * POST /admin/run: starts a run by hand. The token is checked first, so a wrong token never learns
 * whether the pipeline is paused. Messages never include technical detail.
 */
export async function handleAdminRun(
  request: Request,
  env: Pick<Env, 'DB' | 'FETCH_QUEUE' | 'STAGGER_SECONDS' | 'PIPELINE_ENABLED' | 'ADMIN_TOKEN'>,
  deps: Deps,
): Promise<Response> {
  if (!isAuthorized(request, env.ADMIN_TOKEN)) {
    return apiError(401, 'unauthorized', 'Missing or invalid token.', deps);
  }
  if (isPaused(env)) {
    return apiError(409, 'paused', 'The pipeline is paused (PIPELINE_ENABLED is false).', deps);
  }
  try {
    // `?store=<slug>` runs one store only, so one store can be tested without fetching every store again.
    const slug = new URL(request.url).searchParams.get('store');
    let retailerId: number | undefined;
    if (slug !== null) {
      if (!/^[a-z0-9-]+$/.test(slug)) return apiError(400, 'bad_store', 'The store must be a slug such as bash-tfg.', deps);
      const found = await findRunnableRetailerIdBySlug(env.DB, slug);
      if (found === null) return apiError(404, 'store_not_found', 'No visible store has that slug.', deps);
      retailerId = found;
    }
    const { runId, storesTotal } = await startRun(env, 'manual', deps, retailerId === undefined ? {} : { retailerId });
    return Response.json({ ok: true, runId, storesTotal });
  } catch (err) {
    deps.log.error('run_failed', { err });
    return apiError(500, 'run_failed', 'The run could not be started.', deps);
  }
}
