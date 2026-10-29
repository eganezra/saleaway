import { describe, expect, it } from 'vitest';
import { toIsoUtc } from '../src/time';

describe('toIsoUtc', () => {
  it('gives YYYY-MM-DDTHH:MM:SSZ with no milliseconds', () => {
    expect(toIsoUtc(new Date('2026-10-30T03:00:00.123Z'))).toBe('2026-10-30T03:00:00Z');
    expect(toIsoUtc(new Date('2026-10-30T03:00:00.999Z'))).toBe('2026-10-30T03:00:00Z');
    expect(toIsoUtc(new Date('2026-10-30T03:00:00Z'))).toBe('2026-10-30T03:00:00Z');
  });

  it('is always UTC, whatever offset the input was written with', () => {
    expect(toIsoUtc(new Date('2026-10-30T05:00:00+02:00'))).toBe('2026-10-30T03:00:00Z');
  });

  it('matches the shape of the timestamps SQLite writes by default in this database', () => {
    expect(toIsoUtc(new Date(0))).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});
