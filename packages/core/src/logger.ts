import type { LogFields, LogLevel } from './types';

export interface LoggerOptions {
  /** Supplied by the caller: core never reads the clock. */
  now: () => Date;
  /** Supplied by the caller: core never touches the console. Receives one JSON line. */
  write: (line: string) => void;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

const RESERVED_KEYS = new Set(['level', 'message', 'time']);

/** Makes values JSON-safe: Errors keep their name and message, bigints become strings. */
function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

/**
 * Creates the structured logger used by every app.
 * Each call writes exactly one line of JSON: { level, message, time, ...fields }.
 * Logging never throws.
 */
export function createLogger(options: LoggerOptions): Logger {
  const emit = (level: LogLevel, message: string, fields?: LogFields): void => {
    const entry: Record<string, unknown> = {
      level,
      message,
      time: options.now().toISOString(),
    };
    for (const [key, value] of Object.entries(fields ?? {})) {
      if (!RESERVED_KEYS.has(key)) {
        entry[key] = value;
      }
    }

    let line: string;
    try {
      line = JSON.stringify(entry, replacer);
    } catch {
      // Circular or otherwise unserialisable fields: keep the core keys and say so.
      line = JSON.stringify({
        level,
        message,
        time: entry['time'],
        fields_unserialisable: true,
      });
    }
    options.write(line);
  };

  return {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
  };
}
