// The pure rules of the click counter (Story 2.5). No I/O: randomness and time are passed in.

/** The longest slug accepted (the store slugs are far shorter). */
export const MAX_SLUG_LENGTH = 100;

/** The slug a beacon sent, or null when it is not a plain store slug (lower-case letters, digits and hyphens). */
export function parseSlug(body: string): string | null {
  const slug = body.trim();
  return slug.length > 0 && slug.length <= MAX_SLUG_LENGTH && /^[a-z0-9-]+$/.test(slug) ? slug : null;
}

/** The share of clicks to count, from the `CLICK_SAMPLE_RATE` setting: a number above 0 and at most 1, else 1 (count all). */
export function parseSampleRate(value: string | undefined): number {
  const rate = value === undefined || value.trim() === '' ? Number.NaN : Number(value);
  return Number.isFinite(rate) && rate > 0 && rate <= 1 ? rate : 1;
}

/** Is this click one of the sample that is counted? `random` returns a number from 0 up to (not including) 1. */
export function shouldCount(rate: number, random: () => number): boolean {
  return random() < rate;
}

/** How much a counted click adds, so that a sampled count stays an estimate of the true total (0.5 adds 2, 0.1 adds 10). */
export function clickAmount(rate: number): number {
  return Math.max(1, Math.round(1 / rate));
}

/** The UTC day, `YYYY-MM-DD`, that a click belongs to. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}
