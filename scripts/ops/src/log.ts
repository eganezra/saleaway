import { createLogger } from '@saleaway/core';

// The one place the ops scripts hand the clock and the console to the shared logger.
// Everything else imports `log` and never calls console.log directly (coding standards).
export const log = createLogger({
  now: () => new Date(),
  write: (line) => console.log(line),
});
