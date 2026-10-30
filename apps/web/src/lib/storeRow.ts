// What one store row shows (Story 2.1): the figure, the pill's tier, the "Checked" words and the link's accessible
// name. Pure: no I/O, the caller passes `now`. Kept apart from the Astro components so it can be unit-tested.

import type { StoreLink } from './db';

export type PillTier = 'hot' | 'warm' | 'plain';
export type CheckedAge = 'today' | 'older' | 'never';

export interface StoreRowData {
  slug: string;
  name: string;
  saleUrl: string;
  /** A whole number from 1 to 99, or null ("On sale"). */
  percent: number | null;
  /** 50 or more is `hot`, below that `warm`, no figure `plain`. */
  tier: PillTier;
  /** `Checked today`, `Checked 2 days ago` or `Not checked yet`. */
  checkedText: string;
  checkedAge: CheckedAge;
  /** The link's accessible name. It contains the visible words, so the two never differ. */
  label: string;
}

// An extracted percentage is 5 to 90 (`sale_records`), an operator's override is 1 to 99 (`overrides`): the page
// shows either, so it accepts the wider range and shows anything else as "On sale".
const MIN_SHOWN = 1;
const MAX_SHOWN = 99;
const HOT_FROM = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

function shownPercent(value: number | null): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_SHOWN && value <= MAX_SHOWN ? value : null;
}

/** Whole 24 hour periods since the check (rolling, not calendar days); 0 for a time in the future. Null when there is none. */
function daysSince(checkedAt: string | null, now: Date): number | null {
  if (checkedAt === null) return null;
  const ms = Date.parse(checkedAt);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.floor((now.getTime() - ms) / DAY_MS));
}

export function toRowData(store: StoreLink, now: Date): StoreRowData {
  const percent = shownPercent(store.discountPercent);
  const tier: PillTier = percent === null ? 'plain' : percent >= HOT_FROM ? 'hot' : 'warm';
  const days = daysSince(store.checkedAt, now);
  const checkedAge: CheckedAge = days === null ? 'never' : days === 0 ? 'today' : 'older';
  const checkedText = days === null ? 'Not checked yet' : days === 0 ? 'Checked today' : `Checked ${days} ${days === 1 ? 'day' : 'days'} ago`;
  const figure = percent === null ? 'on sale' : `up to ${percent}% off`;
  // The words follow the order they are drawn in (name, checked, figure), so the name holds the visible text (WCAG 2.5.3).
  const label = `${store.name}, ${checkedText.toLowerCase()}, ${figure}, opens in a new tab`;
  return { slug: store.slug, name: store.name, saleUrl: store.saleUrl, percent, tier, checkedText, checkedAge, label };
}
