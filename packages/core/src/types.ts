export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

export type ExtractionMethod = 'shopify_json' | 'html' | 'structured_data' | 'manual';

export type SeedStatus =
  | 'verified_products'
  | 'verified_js_shell'
  | 'search_only'
  | 'no_sale_page';

export interface Category {
  id: number;
  slug: string;
  name: string;
  tagline: string;
  sortOrder: number;
  colorToken: string;
}

export interface Retailer {
  id: number;
  slug: string;
  name: string;
  homepageUrl: string;
  categoryId: number;
  rank: number;
  platform: string | null;
  saleUrl: string | null;
  blackFridayUrl: string | null;
  blackFridayVerified: boolean;
  extractionMethod: ExtractionMethod;
  seedStatus: SeedStatus;
  isVisible: boolean;
}

/** A category as defined in `db/seed/categories.json` (no database id yet). */
export type SeedCategory = Omit<Category, 'id'>;

/**
 * One store as the seed writes it. `categorySlug` replaces `categoryId` because the id is only
 * known inside the database (the seed SQL looks it up by slug).
 */
export type SeedRetailer = Omit<Retailer, 'id' | 'categoryId' | 'blackFridayVerified'> & {
  categorySlug: string;
};

/** One data row of `docs/data/retailers-seed.tsv`, as text. `line` is the line number in the file. */
export interface SeedRow {
  line: number;
  category: string;
  rank: string;
  store: string;
  homepage: string;
  primarySaleUrl: string;
  blackFridayUrl: string;
  platform: string;
  status: string;
}

export interface SeedData {
  categories: SeedCategory[];
  retailers: SeedRetailer[];
}

/** What happened when a store's sale page was processed (architecture/data-models.md, SaleRecord). */
export type FetchClass =
  | 'ok'
  | 'blocked'
  | 'not_found'
  | 'redirected_away'
  | 'js_only'
  | 'error'
  | 'skipped_manual';
