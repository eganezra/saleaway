import type { Logger } from '@saleaway/core';
import { getVisibleStores } from './db';
import { toRowData } from './storeRow';
import type { StoreRowData } from './storeRow';

export type HomeViewModel =
  | { kind: 'ok'; stores: StoreRowData[] }
  | { kind: 'empty' }
  | { kind: 'error' };

/**
 * Loads what the home page needs. It never throws: a failing database becomes `error`, and the
 * page answers 503 with a friendly message. A healthy database with nothing to show is `empty`.
 * Only failures are logged (a log line per page view would use up the free log allowance).
 * `now` is the time the freshness rules judge against (Story 2.3); tests pass a fixed one.
 */
export async function loadHomeViewModel(
  db: Pick<D1Database, 'prepare'>,
  log: Pick<Logger, 'error'>,
  now: Date = new Date(),
): Promise<HomeViewModel> {
  try {
    const stores = await getVisibleStores(db, now);
    return stores.length === 0 ? { kind: 'empty' } : { kind: 'ok', stores: stores.map((store) => toRowData(store, now)) };
  } catch (err) {
    log.error('home_failed', { err });
    return { kind: 'error' };
  }
}
