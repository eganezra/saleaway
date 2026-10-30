// The list of stores hidden for launch (Story 3.9), docs/data/hidden-stores.json. Pure: the ops script reads
// the file and passes the parsed JSON in. Whether each slug exists is checked against the seed and the database.

export interface HiddenStore {
  slug: string;
  reason: string;
}

export interface HiddenStores {
  decidedOn: string;
  source: string;
  reasons: Record<string, string>;
  stores: HiddenStore[];
}

const SLUG_PATTERN = /^[a-z0-9-]+$/;
const REASON_PATTERN = /^[a-z0-9_]+$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_STORES = 200;
const MAX_SLUG_LENGTH = 100;
const MAX_TEXT_LENGTH = 500;

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function isRealDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Checks one text field and records what is wrong with it. */
function checkText(value: unknown, where: string, problems: string[]): value is string {
  if (typeof value !== 'string' || value === '') {
    problems.push(`${where} must be a non-empty text`);
    return false;
  }
  if (value.length > MAX_TEXT_LENGTH) problems.push(`${where} is longer than ${MAX_TEXT_LENGTH} characters`);
  if (hasControlCharacter(value)) problems.push(`${where} contains a control character`);
  return true;
}

/**
 * Validates the parsed hidden-stores file. Throws one Error that names every problem it finds (not only
 * the first: `buildSeed` stops at the first one, and this list is short enough to report all of them).
 */
export function parseHiddenStores(value: unknown): HiddenStores {
  const problems: string[] = [];
  if (!isObject(value)) throw new Error('Hidden stores: the file must hold one object');

  const decidedOn = value.decidedOn;
  if (typeof decidedOn !== 'string' || !isRealDate(decidedOn)) problems.push('decidedOn must be a real date as YYYY-MM-DD');
  checkText(value.source, 'source', problems);

  const reasons: Record<string, string> = {};
  if (!isObject(value.reasons) || Object.keys(value.reasons).length === 0) {
    problems.push('reasons must be an object with at least one reason');
  } else {
    for (const [key, text] of Object.entries(value.reasons)) {
      if (!REASON_PATTERN.test(key)) problems.push(`reasons key "${key}" must match ${String(REASON_PATTERN)}`);
      if (checkText(text, `reasons.${key}`, problems)) reasons[key] = text;
    }
  }

  const stores: HiddenStore[] = [];
  if (!Array.isArray(value.stores) || value.stores.length === 0) {
    problems.push('stores must be a non-empty list');
  } else {
    if (value.stores.length > MAX_STORES) problems.push(`stores has more than ${MAX_STORES} entries`);
    const seen = new Set<string>();
    value.stores.forEach((entry: unknown, index) => {
      const where = `stores[${index}]`;
      if (!isObject(entry)) {
        problems.push(`${where} must be an object with a slug and a reason`);
        return;
      }
      const { slug, reason } = entry;
      if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug) || slug.length > MAX_SLUG_LENGTH) {
        problems.push(`${where}: invalid slug`);
        return;
      }
      if (seen.has(slug)) problems.push(`${where} (${slug}): duplicate slug`);
      seen.add(slug);
      if (typeof reason !== 'string' || !Object.prototype.hasOwnProperty.call(reasons, reason)) {
        problems.push(`${where} (${slug}): reason "${String(reason)}" is not one of the reasons in the file`);
        return;
      }
      stores.push({ slug, reason });
    });
  }

  if (problems.length > 0) throw new Error(`Hidden stores: ${problems.join('; ')}`);
  return { decidedOn: decidedOn as string, source: value.source as string, reasons, stores };
}
