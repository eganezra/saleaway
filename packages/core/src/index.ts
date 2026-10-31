export { createLogger } from './logger';
export type { Logger, LoggerOptions } from './logger';
export type { LogFields, LogLevel } from './types';
export { buildSeed, parseSeedTsv, slugify } from './seed';
export { summariseRun } from './run-summary';
export type { ResultCount, RunSummary } from './run-summary';
export { toIsoUtc } from './time';
export type {
  Category,
  ExtractionMethod,
  FetchClass,
  Retailer,
  SeedCategory,
  SeedData,
  SeedRetailer,
  SeedRow,
  SeedStatus,
} from './types';
export { isSafeFetchUrl, resolveRedirect } from './url-safety';
export { classifyResponse, redirectedAway } from './classify';
export { firstElementText } from './page-scan';
export type { FetchOutcome } from './classify';
export { checkRobots, isAllowedByRobots } from './robots';
export type { RobotsDecision, RobotsResult } from './robots';
export { ACCEPT, FETCH_TIMEOUT_MS, MAX_PAGE_BYTES, MAX_REDIRECTS, USER_AGENT, discard, fetchPage, readLimited } from './fetcher';
export type { BodyText, FetchFailure, FetchFn, FetchPageResult } from './fetcher';
export { parseHiddenStores } from './hidden-stores';
export type { HiddenStore, HiddenStores } from './hidden-stores';
export { rankStores } from './rank';
export type { Rankable } from './rank';
export { STALE_AFTER_HOURS, isOverrideActive, isVisible, resolveStore } from './visibility';
export type { HiddenBecause, StoreInput, StoreView, VisibilityOverride, VisibilityRecord } from './visibility';
export { recordEffect, validateSalePage } from './validate';
export type { PageInput, ValidationReason, ValidationResult, ValidationSignals, ValidationVerdict } from './validate';
export { nextSaleRecord } from './sale-record';
export type { FetchEvent, SaleRecordFields } from './sale-record';
export { expiryFromDate, parseOverrideChange, parseOverridesFile } from './override-input';
export type { ChangeResult, OverrideChange, OverrideRow, RawOverrideChange } from './override-input';
export { MAX_DISCOUNT, MIN_DISCOUNT, extractDiscount, extractHtmlDiscount, extractShopifyDiscount, extractStructuredDiscount } from './extract';
