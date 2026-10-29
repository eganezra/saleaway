import type {
  ExtractionMethod,
  SeedCategory,
  SeedData,
  SeedRetailer,
  SeedRow,
  SeedStatus,
} from './types';

// Seed rules for `docs/data/retailers-seed.tsv` (architecture/database-schema.md, "Seed data rules").
// Pure functions: no file access, no clock, no SQL. Every value that leaves here has been validated,
// because the ops script puts values into plain SQL text.

const SLUG_PATTERN = /^[a-z0-9-]+$/;
const MANUAL_HOSTS = new Set(['amazon.co.za', 'game.co.za', 'checkers.co.za']);
const ALT_RANK_BASE = 100;

// The status text in the spreadsheet uses an en dash (U+2013).
const STATUS_PREFIXES: ReadonlyArray<readonly [string, SeedStatus]> = [
  ['Verified \u2013 products visible', 'verified_products'],
  ['Verified \u2013 page loads (products load via JS)', 'verified_js_shell'],
  ['Found via search \u2013 not fetched', 'search_only'],
  ['No sale page / not found', 'no_sale_page'],
];

const COLUMNS = {
  category: 'Category',
  rank: 'Rank',
  store: 'Store',
  homepage: 'Homepage',
  primarySaleUrl: 'Primary sale / promo URL',
  blackFridayUrl: 'Secondary / Black Friday URL',
  platform: 'Platform / URL pattern',
} as const;

/** Lowercase, accents and apostrophes removed, other runs of non-alphanumerics become one `-`. */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function fail(row: Pick<SeedRow, 'line' | 'store'>, message: string): never {
  throw new Error(`Seed line ${row.line} (${row.store}): ${message}`);
}

/** Parses the TSV text into rows of text. Checks the header and the shape of every row. */
export function parseSeedTsv(text: string): SeedRow[] {
  const lines = text.split('\n').map((line) => line.replace(/\r$/, ''));
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const headerLine = lines[0];
  if (headerLine === undefined) throw new Error('Seed file is empty');

  const header = headerLine.split('\t').map((cell) => cell.trim());
  const indexOf = (name: string): number => {
    const index = header.indexOf(name);
    if (index === -1) throw new Error(`Seed header is missing the column "${name}"`);
    return index;
  };
  // The status header carries a date, for example "Status (28 Oct 2026)", so match by prefix.
  const statusIndex = header.findIndex((cell) => cell.startsWith('Status'));
  if (statusIndex === -1) throw new Error('Seed header is missing a column starting with "Status"');

  const columns = {
    category: indexOf(COLUMNS.category),
    rank: indexOf(COLUMNS.rank),
    store: indexOf(COLUMNS.store),
    homepage: indexOf(COLUMNS.homepage),
    primarySaleUrl: indexOf(COLUMNS.primarySaleUrl),
    blackFridayUrl: indexOf(COLUMNS.blackFridayUrl),
    platform: indexOf(COLUMNS.platform),
    status: statusIndex,
  };

  return lines.slice(1).map((raw, offset) => {
    const line = offset + 2;
    const cells = raw.split('\t').map((cell) => cell.trim());
    if (cells.length !== header.length) {
      throw new Error(`Seed line ${line}: expected ${header.length} columns, found ${cells.length}`);
    }
    const cell = (index: number): string => cells[index] ?? '';
    const row: SeedRow = {
      line,
      category: cell(columns.category),
      rank: cell(columns.rank),
      store: cell(columns.store),
      homepage: cell(columns.homepage),
      primarySaleUrl: cell(columns.primarySaleUrl),
      blackFridayUrl: cell(columns.blackFridayUrl),
      platform: cell(columns.platform),
      status: cell(columns.status),
    };
    for (const value of Object.values(row)) {
      if (typeof value === 'string' && hasControlCharacter(value)) {
        fail(row, 'a cell contains a control character');
      }
    }
    return row;
  });
}

function validateCategories(categories: SeedCategory[]): void {
  const seen = new Set<string>();
  for (const category of categories) {
    const where = `Category "${category.slug}"`;
    if (!SLUG_PATTERN.test(category.slug)) throw new Error(`${where}: invalid slug`);
    if (seen.has(category.slug)) throw new Error(`${where}: duplicate slug`);
    seen.add(category.slug);
    if (!category.name || hasControlCharacter(category.name)) throw new Error(`${where}: invalid name`);
    if (hasControlCharacter(category.tagline)) throw new Error(`${where}: invalid tagline`);
    if (!Number.isInteger(category.sortOrder)) throw new Error(`${where}: sortOrder must be an integer`);
    if (!SLUG_PATTERN.test(category.colorToken)) throw new Error(`${where}: invalid colorToken`);
  }
}

function httpsUrl(row: SeedRow, label: string, value: string): string {
  if (!value.startsWith('https://')) fail(row, `${label} must start with https://`);
  if (/[\s'"\\]/.test(value) || hasControlCharacter(value)) {
    fail(row, `${label} contains a space, quote, backslash or control character`);
  }
  return value;
}

/** An https URL, or null for the spreadsheet's dash markers (for example "— (not found)"). */
function optionalUrl(row: SeedRow, label: string, value: string): string | null {
  return value.startsWith('https://') ? httpsUrl(row, label, value) : null;
}

function seedStatusOf(row: SeedRow): SeedStatus {
  for (const [prefix, status] of STATUS_PREFIXES) {
    if (row.status.startsWith(prefix)) return status;
  }
  return fail(row, `unknown status "${row.status}"`);
}

function extractionMethodOf(row: SeedRow, homepage: string): ExtractionMethod {
  let host: string;
  try {
    host = new URL(homepage).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return fail(row, `homepage "${homepage}" is not a valid URL`);
  }
  if (MANUAL_HOSTS.has(host)) return 'manual';
  return /shopify/i.test(row.platform) ? 'shopify_json' : 'html';
}

/** Turns parsed rows plus the category list into validated seed rows, in file order. */
export function buildSeed(rows: SeedRow[], categories: SeedCategory[]): SeedData {
  validateCategories(categories);
  const categoryByName = new Map(categories.map((category) => [category.name, category]));
  const usedSlugs = new Set<string>();
  const positionInCategory = new Map<string, number>();

  const retailers = rows.map((row): SeedRetailer => {
    if (!row.store || hasControlCharacter(row.store)) fail(row, 'invalid store name');
    const category = categoryByName.get(row.category);
    if (!category) fail(row, `unknown category "${row.category}"`);

    const position = (positionInCategory.get(category.slug) ?? 0) + 1;
    positionInCategory.set(category.slug, position);

    let slug = slugify(row.store);
    if (usedSlugs.has(slug)) slug = `${slug}-${category.slug}`;
    if (!SLUG_PATTERN.test(slug)) fail(row, `invalid slug "${slug}"`);
    if (usedSlugs.has(slug)) fail(row, `slug "${slug}" is already used`);
    usedSlugs.add(slug);

    let rank: number;
    if (/^\d+$/.test(row.rank)) rank = Number(row.rank);
    else if (row.rank === 'Alt') rank = ALT_RANK_BASE + position;
    else return fail(row, `unsupported rank "${row.rank}"`);
    if (!Number.isInteger(rank) || rank < 1 || rank > 999) fail(row, `rank ${rank} is outside 1 to 999`);

    const homepageUrl = httpsUrl(row, 'homepage', row.homepage);
    const saleUrl = optionalUrl(row, 'primary sale URL', row.primarySaleUrl);
    const platform = row.platform === '' || row.platform.startsWith('\u2014') ? null : row.platform;

    return {
      slug,
      name: row.store,
      homepageUrl,
      categorySlug: category.slug,
      rank,
      platform,
      saleUrl,
      blackFridayUrl: optionalUrl(row, 'Black Friday URL', row.blackFridayUrl),
      extractionMethod: extractionMethodOf(row, homepageUrl),
      seedStatus: seedStatusOf(row),
      isVisible: saleUrl !== null,
    };
  });

  return { categories, retailers };
}
