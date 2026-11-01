import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';

// A real local D1 for tests, through Wrangler's getPlatformProxy (the Workers Vitest pool needs Vitest 4
// and this repository is on Vitest 5). Each test file gets its own empty database in a temporary folder,
// with the real migrations applied, so no test can touch `.wrangler/state` or the live database.

const wranglerConfig = fileURLToPath(new URL('../../wrangler.jsonc', import.meta.url));
const migrationsDir = fileURLToPath(new URL('../../../../db/migrations', import.meta.url));

/** D1's `exec()` runs one statement per line, so split a migration file into one-line statements. */
export function splitStatements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*\n/)
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((statement) => `${statement.replace(/;$/, '')};`);
}

export interface TestDb {
  db: D1Database;
  dispose: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const dir = mkdtempSync(join(tmpdir(), 'saleaway-pipeline-test-'));
  mkdirSync(dir, { recursive: true });
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: wranglerConfig, persist: { path: dir } });
  const db = proxy.env.DB;
  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
    for (const statement of splitStatements(readFileSync(join(migrationsDir, file), 'utf-8'))) {
      await db.exec(statement);
    }
  }
  return {
    db,
    dispose: async () => {
      await proxy.dispose();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Empties every table the pipeline touches, so each test starts from nothing. */
export async function resetData(db: D1Database): Promise<void> {
  for (const table of ['run_results', 'pipeline_runs', 'sale_records', 'overrides', 'retailers', 'categories']) {
    await db.prepare(`DELETE FROM ${table}`).run();
  }
}

export interface RetailerSeed {
  id: number;
  slug?: string;
  seedStatus?: string;
  extractionMethod?: string;
  isVisible?: 0 | 1;
  saleUrl?: string | null;
  /** How the page is obtained (Story 5.1); `plain` unless a test says `browser`. */
  fetchMode?: 'plain' | 'browser';
}

/** Inserts one category (id 1) and the given stores. Slugs are derived from the id. */
export async function seedRetailers(db: D1Database, retailers: RetailerSeed[]): Promise<void> {
  await db.prepare("INSERT OR IGNORE INTO categories (id, slug, name) VALUES (1, 'test', 'Test')").run();
  const statements = retailers.map((r) =>
    db
      .prepare(
        `INSERT INTO retailers (id, slug, name, homepage_url, category_id, extraction_method, sale_url, is_visible, seed_status, fetch_mode)
         VALUES (?1, ?2, ?3, 'https://store.example', 1, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        r.id,
        r.slug ?? `store-${r.id}`,
        `Store ${r.id}`,
        r.extractionMethod ?? 'html',
        r.saleUrl === undefined ? `https://store-${r.id}.example/sale` : r.saleUrl,
        r.isVisible ?? 1,
        r.seedStatus ?? 'search_only',
        r.fetchMode ?? 'plain',
      ),
  );
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
}

export async function rows<T = Record<string, unknown>>(db: D1Database, sql: string): Promise<T[]> {
  const { results } = await db.prepare(sql).all<T>();
  return results;
}

/** A database wrapper whose first `failFirst` calls to `prepare` throw, to simulate an outage. */
export function flakyDb(db: D1Database, failFirst: number): D1Database {
  let calls = 0;
  return new Proxy(db, {
    get(target, property) {
      if (property === 'prepare') {
        return (sql: string) => {
          calls += 1;
          if (calls <= failFirst) throw new Error('D1_ERROR: simulated outage');
          return target.prepare(sql);
        };
      }
      const value = Reflect.get(target, property) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}
