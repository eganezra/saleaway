import { handleAdminRun } from './admin-run';
import { isPaused } from './config';
import { finalizeRun } from './finalize-run';
import { processStore, recordStoreError } from './process-store';
import { startRun } from './start-run';
import type { Deps, StoreJob } from './types';

// The three entry points of the pipeline Worker. `index.ts` only wires them to the real logger and clock.

// The queue gives a message `max_retries` retries after its first delivery (wrangler.jsonc sets 1),
// so a message is delivered at most twice. Keep the two numbers together.
const MAX_ATTEMPTS = 2;

export async function handleScheduled(
  controller: Pick<ScheduledController, 'cron'>,
  env: Env,
  deps: Deps,
): Promise<void> {
  if (isPaused(env)) {
    deps.log.info('pipeline_paused', { cron: controller.cron });
    return;
  }
  // Two crons: the start (03:00 UTC) and the close (03:45 UTC, the value of FINALIZE_CRON).
  if (controller.cron === env.FINALIZE_CRON) {
    await finalizeRun(env, deps);
    return;
  }
  await startRun(env, 'cron', deps);
}

function parseStoreJob(body: unknown): StoreJob | null {
  if (typeof body !== 'object' || body === null) return null;
  const { runId, retailerId } = body as Record<string, unknown>;
  if (!Number.isInteger(runId) || !Number.isInteger(retailerId)) return null;
  return { runId: runId as number, retailerId: retailerId as number };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * One store per message. A failure never stops the other stores: the first failure is retried, and on
 * the last delivery an error result is recorded instead, so every store of a run ends with a result.
 */
export async function handleQueue(batch: MessageBatch<unknown>, env: Env, deps: Deps): Promise<void> {
  for (const message of batch.messages) {
    const job = parseStoreJob(message.body);
    if (!job) {
      // A message we cannot read will never become readable: do not retry it.
      deps.log.error('bad_job', { messageId: message.id });
      message.ack();
      continue;
    }
    try {
      await processStore(env, job, deps);
      message.ack();
    } catch (err) {
      if (message.attempts < MAX_ATTEMPTS) {
        deps.log.error('process_store_failed', { ...job, attempts: message.attempts, err });
        message.retry();
        continue;
      }
      deps.log.error('process_store_gave_up', { ...job, attempts: message.attempts, err });
      try {
        await recordStoreError(env, job, errorText(err), deps);
      } catch (recordErr) {
        deps.log.error('result_not_recorded', { ...job, err: recordErr });
      }
      message.ack();
    }
  }
}

export async function handleFetch(request: Request, env: Env, deps: Deps): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'POST' && url.pathname === '/admin/run') {
    return handleAdminRun(request, env, deps);
  }
  return new Response('Not found', { status: 404 });
}
