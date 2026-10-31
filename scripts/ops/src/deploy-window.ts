// The nightly run and its closing step happen between 03:00 and 03:45 UTC; a deploy of the pipeline in that stretch could cut a
// store's processing short (Stories 3.6 and 3.10). The quiet window is 02:50:00 up to, not including, 03:50:00 UTC (Story 4.4).
// Pure: the caller passes the time.

const MINUTE = 60_000;
const START_MS = (2 * 60 + 50) * MINUTE;
const END_MS = (3 * 60 + 50) * MINUTE;

/** How long to wait before the pipeline may be deployed: 0 outside the window, the milliseconds to 03:50:00 UTC inside it. */
export function msUntilQuietWindow(now: Date): number {
  const sinceMidnight = ((now.getUTCHours() * 60 + now.getUTCMinutes()) * 60 + now.getUTCSeconds()) * 1000 + now.getUTCMilliseconds();
  return sinceMidnight >= START_MS && sinceMidnight < END_MS ? END_MS - sinceMidnight : 0;
}

export interface WaitIo {
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** Called before each wait, with the milliseconds about to be waited. */
  onWait: (ms: number) => void;
}

/**
 * Waits until the window is over and returns how many times it waited. It looks at the clock again after each sleep (a sleep can
 * end early) and adds a second so that it never returns at 03:49:59.9.
 */
export async function waitForQuietWindow(io: WaitIo): Promise<number> {
  let waits = 0;
  for (;;) {
    const ms = msUntilQuietWindow(io.now());
    if (ms === 0) return waits;
    io.onWait(ms);
    waits += 1;
    await io.sleep(ms + 1000);
  }
}
