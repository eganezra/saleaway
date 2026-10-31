import { describe, expect, it } from 'vitest';
import { msUntilQuietWindow, waitForQuietWindow } from '../src/deploy-window';

const at = (time: string, day = '2026-11-02'): Date => new Date(`${day}T${time}Z`);

describe('msUntilQuietWindow', () => {
  it.each([
    ['00:00:00.000', 0],
    ['02:49:59.999', 0],
    ['02:50:00.000', 3_600_000],
    ['02:50:01.000', 3_599_000],
    ['03:00:00.000', 3_000_000],
    ['03:45:00.000', 300_000],
    ['03:49:59.000', 1_000],
    ['03:49:59.999', 1],
    ['03:50:00.000', 0],
    ['03:50:01.000', 0],
    ['12:00:00.000', 0],
    ['23:59:59.999', 0],
  ])('at %s waits %i ms', (time, expected) => {
    expect(msUntilQuietWindow(at(time))).toBe(expected);
  });

  it('does not depend on the date', () => {
    for (const day of ['2026-01-01', '2026-02-28', '2026-03-29', '2026-10-25', '2028-02-29']) {
      expect(msUntilQuietWindow(at('03:10:00.000', day))).toBe(2_400_000);
      expect(msUntilQuietWindow(at('04:10:00.000', day))).toBe(0);
    }
  });

  it('uses UTC, not the local time zone of the machine', () => {
    // 05:10 in South Africa (UTC+2) is 03:10 UTC.
    expect(msUntilQuietWindow(new Date('2026-11-02T05:10:00+02:00'))).toBe(2_400_000);
    expect(msUntilQuietWindow(new Date('2026-11-02T03:10:00-05:00'))).toBe(0);
  });
});

describe('waitForQuietWindow', () => {
  function fakeIo(start: string, earlyWakeMs = 0) {
    let time = at(start).getTime();
    const sleeps: number[] = [];
    const announced: number[] = [];
    let first = true;
    return {
      sleeps,
      announced,
      io: {
        now: () => new Date(time),
        // The first sleep can end early (a timer that fires before it should).
        sleep: async (ms: number) => {
          sleeps.push(ms);
          time += first && earlyWakeMs > 0 ? earlyWakeMs : ms;
          first = false;
        },
        onWait: (ms: number) => void announced.push(ms),
      },
      clock: () => new Date(time),
    };
  }

  it('returns at once outside the window and never sleeps', async () => {
    const t = fakeIo('12:00:00.000');
    expect(await waitForQuietWindow(t.io)).toBe(0);
    expect(t.sleeps).toEqual([]);
    expect(t.announced).toEqual([]);
  });

  it('waits until 03:50 inside the window, one second past it', async () => {
    const t = fakeIo('03:10:00.000');
    expect(await waitForQuietWindow(t.io)).toBe(1);
    expect(t.announced).toEqual([2_400_000]);
    expect(t.sleeps).toEqual([2_401_000]);
    expect(t.clock().toISOString()).toBe('2026-11-02T03:50:01.000Z');
  });

  it('looks at the clock again after a sleep that ended early', async () => {
    const t = fakeIo('03:10:00.000', 60_000);
    expect(await waitForQuietWindow(t.io)).toBe(2);
    expect(t.clock().getTime()).toBeGreaterThanOrEqual(at('03:50:00.000').getTime());
    expect(msUntilQuietWindow(t.clock())).toBe(0);
  });

  it('waits the whole hour from the first second of the window', async () => {
    const t = fakeIo('02:50:00.000');
    await waitForQuietWindow(t.io);
    expect(t.announced).toEqual([3_600_000]);
  });
});
