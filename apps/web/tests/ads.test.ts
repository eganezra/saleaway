import { describe, expect, it } from 'vitest';
import { isAdsEnabled } from '../src/lib/ads';

describe('isAdsEnabled (Story 2.5, FR18)', () => {
  it('is true only for the exact text "true"', () => {
    expect(isAdsEnabled('true')).toBe(true);
    for (const value of [undefined, '', 'false', 'TRUE', 'True', 'yes', '1', ' true', 'true ']) expect(isAdsEnabled(value), String(value)).toBe(false);
  });
});
