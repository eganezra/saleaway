/**
 * `YYYY-MM-DDTHH:MM:SSZ` in UTC: the format stored in the database (coding standards). Seconds
 * precision, so the milliseconds that `Date#toISOString` adds are dropped.
 */
export function toIsoUtc(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
