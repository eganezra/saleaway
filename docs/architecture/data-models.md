# Data Models

## Category

**Purpose:** group stores into the 10 categories shown as cards.

**Key Attributes:**
- id: number - primary key
- slug: string - URL anchor, for example `sport`
- name: string - display name
- tagline: string - italic line under the card title
- sortOrder: number - card order
- colorToken: string - name of the colour tab token

```typescript
export interface Category {
  id: number;
  slug: string;
  name: string;
  tagline: string;
  sortOrder: number;
  colorToken: string;
}
```

**Relationships:**
- A category has many retailers.

## Retailer

**Purpose:** one row per store. Adding a store is one new row (FR3).

**Key Attributes:**
- slug: string - stable identifier, for example `crocs-sa`
- name: string - display name
- homepageUrl: string
- categoryId: number
- rank: number - approximate popularity rank from the spreadsheet, used for tie-breaks
- platform: string | null - for example `shopify`
- saleUrl: string | null - the hand-picked sale page
- blackFridayUrl: string | null, blackFridayVerified: boolean
- extractionMethod: `shopify_json` | `html` | `structured_data` | `manual`
- seedStatus: how the URL was found in the spreadsheet
- isVisible: boolean - operator switch (stores with no sale page start hidden)

```typescript
export type ExtractionMethod = 'shopify_json' | 'html' | 'structured_data' | 'manual';
export type SeedStatus =
  | 'verified_products' | 'verified_js_shell' | 'search_only' | 'no_sale_page';

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
```

**Relationships:**
- Belongs to one category.
- Has at most one current sale record, at most one override, and many run results.

## SaleRecord

**Purpose:** the current known state of a store's sale (FR9). Facts only, no retailer content (NFR7).

**Key Attributes:**
- retailerId: number
- state: `active` | `ended` | `unknown`
- validation: `content_verified` | `url_verified` | `none`
- discountPercent: number | null - deepest discount found
- lastResult: classification of the last fetch
- firstSeenAt, lastCheckedAt, lastValidatedAt, endedAt: timestamps (ISO 8601, UTC)

```typescript
export type FetchClass =
  | 'ok' | 'blocked' | 'not_found' | 'redirected_away' | 'js_only' | 'error' | 'skipped_manual';

export interface SaleRecord {
  retailerId: number;
  state: 'active' | 'ended' | 'unknown';
  validation: 'content_verified' | 'url_verified' | 'none';
  discountPercent: number | null;
  lastResult: FetchClass;
  firstSeenAt: string | null;
  lastCheckedAt: string | null;
  lastValidatedAt: string | null;
  endedAt: string | null;
}
```

**Relationships:**
- One per retailer. Updated in place by the pipeline.

## Override

**Purpose:** operator decisions that beat extracted data (FR12).

**Key Attributes:**
- retailerId: number
- discountPercent: number | null
- hide: boolean
- saleUrl: string | null
- expiresAt: string | null
- note: string

```typescript
export interface Override {
  retailerId: number;
  discountPercent: number | null;
  hide: boolean;
  saleUrl: string | null;
  expiresAt: string | null;
  note: string;
  createdAt: string;
}
```

**Relationships:**
- At most one per retailer. Ignored after `expiresAt`. Never touched by the pipeline.

## PipelineRun and RunResult

**Purpose:** the run log (FR11, FR21).

```typescript
export interface PipelineRun {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  trigger: 'cron' | 'manual';
  storesTotal: number;
  storesOk: number;
  storesFailed: number;
}

export interface RunResult {
  id: number;
  runId: number;
  retailerId: number;
  result: FetchClass;
  httpStatus: number | null;
  discountPercent: number | null;
  durationMs: number;
  error: string | null;
  createdAt: string;
}
```

**Relationships:**
- A run has many results. Results older than 30 days are deleted at the start of each run (retention).

## ClickCount

**Purpose:** per-day click-outs per store for the KPI (FR19). Counters only, no personal data.

```typescript
export interface ClickCount {
  day: string;          // YYYY-MM-DD, UTC
  retailerId: number;
  clicks: number;
}
```
