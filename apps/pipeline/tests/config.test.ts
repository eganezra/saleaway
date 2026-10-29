import { describe, expect, it } from 'vitest';
import { isPaused } from '../src/config';
import { parseStaggerSeconds } from '../src/start-run';

describe('isPaused', () => {
  it('is paused only for the exact text "false"', () => {
    expect(isPaused({ PIPELINE_ENABLED: 'false' })).toBe(true);
    for (const value of ['true', 'False', 'FALSE', '0', 'no', '', ' false']) {
      expect(isPaused({ PIPELINE_ENABLED: value })).toBe(false);
    }
  });
});

describe('parseStaggerSeconds', () => {
  it('accepts whole numbers from 0 to 3600', () => {
    expect(parseStaggerSeconds('15')).toBe(15);
    expect(parseStaggerSeconds('0')).toBe(0);
    expect(parseStaggerSeconds('3600')).toBe(3600);
  });

  it('rejects anything else', () => {
    for (const value of ['3601', '-1', '1.5', 'abc', '', ' 15', '15s', '1e3']) {
      expect(parseStaggerSeconds(value)).toBeNull();
    }
    expect(parseStaggerSeconds(undefined)).toBeNull();
  });
});
