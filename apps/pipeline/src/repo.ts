import type { FetchClass, ResultCount } from '@saleaway/core';
import type { RunTrigger } from './types';

// Data access for the pipeline. All SQL for the pipeline lives here (coding standards).
// Every function takes the database as a parameter.

/** Stores to process: visible, with an https sale URL (the pipeline only ever fetches https). */
export async function getVisibleRetailerIds(db: D1Database): Promise<number[]> {
  const { results } = await db
    .prepare(
      `SELECT id FROM retailers
       WHERE is_visible = 1 AND substr(sale_url, 1, 8) = 'https://'
       ORDER BY id`,
    )
    .all<{ id: number }>();
  return results.map((row) => row.id);
}

export async function insertRun(
  db: D1Database,
  startedAt: string,
  trigger: RunTrigger,
  storesTotal: number,
): Promise<number> {
  const result = await db
    .prepare('INSERT INTO pipeline_runs (started_at, trigger, stores_total) VALUES (?1, ?2, ?3)')
    .bind(startedAt, trigger, storesTotal)
    .run();
  return result.meta.last_row_id;
}

export interface RetailerForJob {
  id: number;
  slug: string;
  extractionMethod: string;
  saleUrl: string | null;
  seedStatus: string;
}

export async function getRetailerForJob(db: D1Database, retailerId: number): Promise<RetailerForJob | null> {
  const row = await db
    .prepare('SELECT id, slug, extraction_method, sale_url, seed_status FROM retailers WHERE id = ?1')
    .bind(retailerId)
    .first<{ id: number; slug: string; extraction_method: string; sale_url: string | null; seed_status: string }>();
  return row
    ? { id: row.id, slug: row.slug, extractionMethod: row.extraction_method, saleUrl: row.sale_url, seedStatus: row.seed_status }
    : null;
}

/**
 * The id of a store that has an https sale URL, or null. Visibility is **not** checked: a store hidden for
 * launch (Story 3.9) can still be fetched by hand with `POST /admin/run?store=<slug>`, so it can be tested
 * again. A normal run uses `getVisibleRetailerIds` and skips hidden stores.
 */
export async function findRunnableRetailerIdBySlug(db: D1Database, slug: string): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT id FROM retailers
       WHERE slug = ?1 AND substr(sale_url, 1, 8) = 'https://'`,
    )
    .bind(slug)
    .first<{ id: number }>();
  return row ? row.id : null;
}

export interface RunResultInput {
  runId: number;
  retailerId: number;
  result: FetchClass;
  httpStatus: number | null;
  discountPercent: number | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
}

/** One result per store per run. A redelivered queue message updates its row instead of adding a second. */
export async function saveRunResult(db: D1Database, r: RunResultInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO run_results (run_id, retailer_id, result, http_status, discount_percent, duration_ms, error, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(run_id, retailer_id) DO UPDATE SET
         result = excluded.result, http_status = excluded.http_status,
         discount_percent = excluded.discount_percent, duration_ms = excluded.duration_ms,
         error = excluded.error, created_at = excluded.created_at`,
    )
    .bind(r.runId, r.retailerId, r.result, r.httpStatus, r.discountPercent, r.durationMs, r.error, r.createdAt)
    .run();
}

export async function countResultsByClass(db: D1Database, runId: number): Promise<ResultCount[]> {
  const { results } = await db
    .prepare('SELECT result, COUNT(*) AS n FROM run_results WHERE run_id = ?1 GROUP BY result ORDER BY result')
    .bind(runId)
    .all<ResultCount>();
  return results;
}

export interface UnfinishedRun {
  id: number;
  storesTotal: number;
}

// D1 allows 50 queries per invocation; closing a run takes 2, so 10 runs at a time is far inside it.
const MAX_RUNS_PER_FINALIZE = 10;

/** Runs with no finish time, oldest first. Normally exactly one: today's. */
export async function listUnfinishedRuns(db: D1Database): Promise<UnfinishedRun[]> {
  const { results } = await db
    .prepare('SELECT id, stores_total FROM pipeline_runs WHERE finished_at IS NULL ORDER BY id LIMIT ?1')
    .bind(MAX_RUNS_PER_FINALIZE)
    .all<{ id: number; stores_total: number }>();
  return results.map((row) => ({ id: row.id, storesTotal: row.stores_total }));
}

/** Closes a run that is still open. Returns false when it was already closed, so a repeat changes nothing. */
export async function closeRun(
  db: D1Database,
  runId: number,
  finishedAt: string,
  storesOk: number,
  storesFailed: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE pipeline_runs SET finished_at = ?1, stores_ok = ?2, stores_failed = ?3
       WHERE id = ?4 AND finished_at IS NULL`,
    )
    .bind(finishedAt, storesOk, storesFailed, runId)
    .run();
  return result.meta.changes > 0;
}
