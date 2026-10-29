import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/logger';

const fixedNow = () => new Date('2026-10-29T08:15:30.000Z');

function setup() {
  const lines: string[] = [];
  const logger = createLogger({ now: fixedNow, write: (line) => lines.push(line) });
  return { lines, logger };
}

describe('createLogger', () => {
  it('writes exactly one JSON line with level, message, UTC time and the extra fields', () => {
    const { lines, logger } = setup();

    logger.info('health_checked', { route: '/health', count: 2 });

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] as string);
    expect(parsed).toEqual({
      level: 'info',
      message: 'health_checked',
      time: '2026-10-29T08:15:30.000Z',
      route: '/health',
      count: 2,
    });
    expect(parsed.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  });

  it('serialises an Error with its name and message instead of {}', () => {
    const { lines, logger } = setup();

    logger.error('store_failed', { err: new TypeError('boom') });

    const parsed = JSON.parse(lines[0] as string);
    expect(parsed.err).toEqual({ name: 'TypeError', message: 'boom' });
  });

  it('does not let extra fields overwrite level, message or time', () => {
    const { lines, logger } = setup();

    logger.warn('real_message', { level: 'fake', message: 'fake', time: 'fake' });

    const parsed = JSON.parse(lines[0] as string);
    expect(parsed.level).toBe('warn');
    expect(parsed.message).toBe('real_message');
    expect(parsed.time).toBe('2026-10-29T08:15:30.000Z');
  });

  it.each(['debug', 'info', 'warn', 'error'] as const)(
    'writes one line with level "%s"',
    (level) => {
      const { lines, logger } = setup();

      logger[level]('something_happened');

      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] as string).level).toBe(level);
    },
  );

  it('writes a bigint field as a string instead of throwing', () => {
    const { lines, logger } = setup();

    logger.info('big_number', { rows: 12345678901234567890n });

    expect(JSON.parse(lines[0] as string).rows).toBe('12345678901234567890');
  });

  it('never throws on unserialisable fields', () => {
    const { lines, logger } = setup();
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    expect(() => logger.debug('circular', { circular })).not.toThrow();

    const parsed = JSON.parse(lines[0] as string);
    expect(parsed.fields_unserialisable).toBe(true);
    expect(parsed.message).toBe('circular');
  });
});
