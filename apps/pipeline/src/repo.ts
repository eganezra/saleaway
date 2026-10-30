import type { FetchClass, ResultCount, SaleRecordFields } from '@saleaway/core';
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

interface SaleRecordRow {
  state: SaleRecordFields['state'];
  validation: SaleRecordFields['validation'];
  discount_percent: number | null;
  last_result: FetchClass | null;
  first_seen_at: string | null;
  last_checked_at: string | null;
  last_validated_at: string | null;
  ended_at: string | null;
}

/** The store's sale record, or null when it has none. An old row without `last_result` reads as `error`. */
export async function getSaleRecord(db: D1Database, retailerId: number): Promise<SaleRecordFields | null> {
  const row = await db
    .prepare(
      `SELECT state, validation, discount_percent, last_result, first_seen_at, last_checked_at, last_validated_at, ended_at
       FROM sale_records WHERE retailer_id = ?1`,
    )
    .bind(retailerId)
    .first<SaleRecordRow>();
  if (!row) return null;
  return {
    state: row.state,
    validation: row.validation,
    discountPercent: row.discount_percent,
    lastResult: row.last_result ?? 'error',
    firstSeenAt: row.first_seen_at,
    lastCheckedAt: row.last_checked_at ?? '',
    lastValidatedAt: row.last_validated_at,
    endedAt: row.ended_at,
  };
}

/**
 * Saves one store's result and, when there is one, its sale record, in a single batch: D1 runs a batch as one
 * transaction, so the two are saved together or not at all. Saving the same pair twice leaves one row of each.
 * `record` is the whole new record (the rule in `packages/core` has already merged the old values).
 */
export async function saveStoreResult(db: D1Database, r: RunResultInput, record: SaleRecordFields | null): Promise<void> {
  const statements = [
    db
      .prepare(
        `INSERT INTO run_results (run_id, retailer_id, result, http_status, discount_percent, duration_ms, error, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(run_id, retailer_id) DO UPDATE SET
           result = excluded.result, http_status = excluded.http_status,
           discount_percent = excluded.discount_percent, duration_ms = excluded.duration_ms,
           error = excluded.error, created_at = excluded.created_at`,
      )
      .bind(r.runId, r.retailerId, r.result, r.httpStatus, r.discountPercent, r.durationMs, r.error, r.createdAt),
  ];
  if (record !== null) {
    statements.push(
      db
        .prepare(
          `INSERT INTO sale_records (retailer_id, state, validation, discount_percent, last_result,
                                     first_seen_at, last_checked_at, last_validated_at, ended_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
           ON CONFLICT(retailer_id) DO UPDATE SET
             state = excluded.state, validation = excluded.validation, discount_percent = excluded.discount_percent,
             last_result = excluded.last_result, first_seen_at = excluded.first_seen_at,
             last_checked_at = excluded.last_checked_at, last_validated_at = excluded.last_validated_at,
             ended_at = excluded.ended_at`,
        )
        .bind(
          r.retailerId,
          record.state,
          record.validation,
          record.discountPercent,
          record.lastResult,
          record.firstSeenAt,
          record.lastCheckedAt,
          record.lastValidatedAt,
          record.endedAt,
        ),
    );
  }
  await db.batch(statements);
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
