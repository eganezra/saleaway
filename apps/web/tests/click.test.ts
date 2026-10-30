import { describe, expect, it } from 'vitest';
import { MAX_SLUG_LENGTH, clickAmount, parseSampleRate, parseSlug, shouldCount, utcDay } from '../src/lib/click';

describe('parseSlug', () => {
  it.each(['takealot', 'a-b-1', 'bash-tfg-fashion-apparel', '1', 'a'.repeat(MAX_SLUG_LENGTH)])('accepts %s', (slug) => {
    expect(parseSlug(slug)).toBe(slug);
  });
  it('trims whitespace around a slug', () => {
    expect(parseSlug('  takealot\n')).toBe('takealot');
  });
  it.each(['', '   ', 'Takealot', 'take a lot', 'take;lot', "take'lot", 'take/lot', '<script>', 'café', 'a'.repeat(MAX_SLUG_LENGTH + 1), 'a\u0000b'])('rejects %j', (body) => {
    expect(parseSlug(body)).toBeNull();
  });
});

describe('parseSampleRate', () => {
  it.each([
    ['1', 1],
    ['0.5', 0.5],
    ['0.01', 0.01],
    [' 0.25 ', 0.25],
  ])('reads %j as %d', (value, rate) => {
    expect(parseSampleRate(value)).toBe(rate);
  });
  it.each([undefined, '', '  ', '0', '-1', '2', '1.0001', 'abc', 'NaN', 'Infinity'])('counts everything for %j', (value) => {
    expect(parseSampleRate(value)).toBe(1);
  });
});

describe('shouldCount', () => {
  it('counts when the random number is below the rate and not at or above it', () => {
    expect(shouldCount(0.5, () => 0)).toBe(true);
    expect(shouldCount(0.5, () => 0.4999)).toBe(true);
    expect(shouldCount(0.5, () => 0.5)).toBe(false);
    expect(shouldCount(0.5, () => 0.99)).toBe(false);
  });
  it('counts every click at a rate of 1', () => {
    expect(shouldCount(1, () => 0.999999)).toBe(true);
  });
});

describe('clickAmount', () => {
  it.each([
    [1, 1],
    [0.5, 2],
    [0.1, 10],
    [0.3, 3],
    [0.01, 100],
  ])('rate %d adds %d', (rate, amount) => {
    expect(clickAmount(rate)).toBe(amount);
  });
  it('adds at least 1', () => {
    expect(clickAmount(1)).toBeGreaterThanOrEqual(1);
  });
});

describe('utcDay', () => {
  it('is the UTC date, not the local one', () => {
    expect(utcDay(new Date('2026-10-31T23:59:59Z'))).toBe('2026-10-31');
    expect(utcDay(new Date('2026-11-01T00:00:00Z'))).toBe('2026-11-01');
    expect(utcDay(new Date('2026-11-01T01:30:00+02:00'))).toBe('2026-10-31');
  });
});
