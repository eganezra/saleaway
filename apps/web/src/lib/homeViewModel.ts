import type { Logger } from '@saleaway/core';
import { getVisibleStores } from './db';
import type { StoreLink } from './db';

export type HomeViewModel =
  | { kind: 'ok'; stores: StoreLink[] }
  | { kind: 'empty' }
  | { kind: 'error' };

/**
 * Loads what the home page needs. It never throws: a failing database becomes `error`, and the
 * page answers 503 with a friendly message. A healthy database with nothing to show is `empty`.
 * Only failures are logged (a log line per page view would use up the free log allowance).
 */
export async function loadHomeViewModel(
  db: Pick<D1Database, 'prepare'>,
  log: Pick<Logger, 'error'>,
): Promise<HomeViewModel> {
  try {
    const stores = await getVisibleStores(db);
    return stores.length === 0 ? { kind: 'empty' } : { kind: 'ok', stores };
  } catch (err) {
    log.error('home_failed', { err });
    return { kind: 'error' };
  }
}
