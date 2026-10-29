import { describe, expect, it } from 'vitest';
import { summariseRun } from '../src/run-summary';

describe('summariseRun', () => {
  it('counts ok, js_only and skipped_manual as ok', () => {
    expect(
      summariseRun([
        { result: 'ok', n: 40 },
        { result: 'js_only', n: 19 },
        { result: 'skipped_manual', n: 3 },
      ]),
    ).toEqual({ storesOk: 62, storesFailed: 0 });
  });

  it('counts blocked, not_found, redirected_away and error as failed', () => {
    expect(
      summariseRun([
        { result: 'blocked', n: 2 },
        { result: 'not_found', n: 3 },
        { result: 'redirected_away', n: 1 },
        { result: 'error', n: 4 },
      ]),
    ).toEqual({ storesOk: 0, storesFailed: 10 });
  });

  it('counts a result that is not a known class as failed, never dropping it', () => {
    expect(summariseRun([{ result: 'surprise', n: 2 }, { result: 'ok', n: 1 }])).toEqual({
      storesOk: 1,
      storesFailed: 2,
    });
  });

  it('gives zero and zero for no results', () => {
    expect(summariseRun([])).toEqual({ storesOk: 0, storesFailed: 0 });
  });

  it('adds up the same result appearing in several rows', () => {
    expect(summariseRun([{ result: 'ok', n: 1 }, { result: 'ok', n: 2 }, { result: 'error', n: 1 }, { result: 'error', n: 1 }])).toEqual({
      storesOk: 3,
      storesFailed: 2,
    });
  });

  it('matches the first live run: 3 manual stores ok and 89 not-built errors failed', () => {
    expect(summariseRun([{ result: 'skipped_manual', n: 3 }, { result: 'error', n: 89 }])).toEqual({
      storesOk: 3,
      storesFailed: 89,
    });
  });
});
