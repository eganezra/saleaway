import { createLogger } from '@saleaway/core';

// The one place the web app supplies the clock and the output to the shared logger.
// Everything else imports `log` and never calls console.log directly (coding standards).
export const log = createLogger({
  now: () => new Date(),
  write: (line) => console.log(line),
});
