// The switch for the ad slots (Story 2.5, FR18): off until an ad network approves the site.

/** True only for the exact text `"true"` (like `ALLOW_INDEXING`): anything else keeps every slot off and out of the page. */
export function isAdsEnabled(value: string | undefined): boolean {
  return value === 'true';
}
