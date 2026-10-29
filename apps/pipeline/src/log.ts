import { createLogger } from '@saleaway/core';

// The one place the pipeline hands the clock and the console to the shared logger.
// Everything else imports `log` and never calls console.log directly (coding standards).
// The logger drops fields named `level`, `message` or `time`: use other names.
export const log = createLogger({
  now: () => new Date(),
  write: (line) => console.log(line),
});
