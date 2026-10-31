import { pathToFileURL } from 'node:url';
import { waitForQuietWindow } from './deploy-window';
import { log } from './log';

// `pnpm ci:wait-for-quiet-window` (Story 4.4): returns at once outside 02:50 to 03:50 UTC, and inside it waits until 03:50 UTC.
// The deploy workflow runs it before the pipeline is deployed, so a push at 03:10 cannot deploy in the middle of the nightly run.

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  waitForQuietWindow({
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    onWait: (ms) => log.info('quiet_window_wait', { minutes: Math.ceil(ms / 60_000), reason: 'the nightly run is on (02:50 to 03:50 UTC); the pipeline is deployed after it' }),
  }).then(
    (waits) => log.info('quiet_window_clear', { waited: waits > 0 }),
    (error: unknown) => {
      log.error('quiet_window_failed', { error });
      process.exitCode = 1;
    },
  );
}
