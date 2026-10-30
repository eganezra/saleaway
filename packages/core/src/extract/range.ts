// Story 3.4: the range of a percentage worth showing, and how one is worked out. A percentage outside it is
// ignored and the record falls back to "On sale" (the table's CHECK is the same range: 5 to 90).

export const MIN_DISCOUNT = 5; // [Assumption] PRD, Story 3.4 criterion 4
export const MAX_DISCOUNT = 90;

/** `(was - now) / was`, as a whole percentage, or null when it is not a real discount or is out of range. */
export function percentOff(was: number, now: number): number | null {
  if (!Number.isFinite(was) || !Number.isFinite(now) || was <= 0 || now < 0 || now >= was) return null;
  return inRange(Math.round(((was - now) / was) * 100));
}

/** The number itself when it is a whole percentage inside the range, else null. */
export function inRange(percent: number): number | null {
  return Number.isInteger(percent) && percent >= MIN_DISCOUNT && percent <= MAX_DISCOUNT ? percent : null;
}

/** The largest of the in-range percentages, or null when there are none. */
export function largest(values: ReadonlyArray<number | null>): number | null {
  let best: number | null = null;
  for (const value of values) if (value !== null && (best === null || value > best)) best = value;
  return best;
}
