import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MAX_PAGE_BYTES, USER_AGENT, buildSeed, checkRobots, discard, fetchPage, parseHiddenStores, parseSeedTsv, readLimited } from '@saleaway/core';
import type { FetchFn, RobotsResult, SeedCategory } from '@saleaway/core';
import { parseCheckUrlsArgs } from './args';
import {
  blackFridayFlags,
  buildCheckFile,
  canRunNow,
  classOfAnswer,
  classOfRobots,
  estimateMinutes,
  isRequestable,
  pathAndQueryOf,
  planChecks,
  readPreviousCheck,
  renderCheckMarkdown,
  robotsDecisionFor,
} from './check-urls-plan';
import type { CheckClass, Plan, PageResult, PlannedPage, ResultRow } from './check-urls-plan';
import { log } from './log';
import { repoRoot } from './wrangler';

// `pnpm ops:check-urls [--dry-run] [--only <slug> ...] [--delay <seconds>]` (Story 4.3): asks every seeded sale address and Black
// Friday address for its page, once, from this computer, with the pipeline's user-agent, robots.txt and URL-safety rules, and
// writes docs/data/url-check.json and url-check.md. No database and no login. At most one full run in 24 hours.

const SEED_FILE = 'docs/data/retailers-seed.tsv';
const CATEGORIES_FILE = 'db/seed/categories.json';
const HIDDEN_FILE = 'docs/data/hidden-stores.json';
export const RESULT_JSON = 'docs/data/url-check.json';
export const RESULT_MARKDOWN = 'docs/data/url-check.md';

/** Everything the command touches outside itself, so a test can pass fakes (no network, no real wait, no real files). */
export interface CheckUrlsIo {
  root: string;
  /** The text of a file under the repository root, or null when it does not exist. */
  readText: (relativePath: string) => string | null;
  writeFile: (path: string, text: string) => void;
  fetch: FetchFn;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  print: (text: string) => void;
}

const isoSeconds = (date: Date): string => date.toISOString().replace(/\.\d+Z$/, 'Z');

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

/** Asks for one page, step by step as the pipeline does. Never throws: a failure is a result. */
async function checkPage(page: PlannedPage, io: CheckUrlsIo, robotsBySite: Map<string, RobotsResult>): Promise<PageResult> {
  const failed = (cls: CheckClass, error: string | null, httpStatus: number | null = null): PageResult => ({ class: cls, httpStatus, error, blackFriday: null });
  try {
    if (!isRequestable(page.url)) return failed('unsafe_url', 'unsafe_url');

    // robots.txt first, once for the whole site (RFC 9309): a refusal means the page is not requested.
    let robots = robotsBySite.get(page.origin);
    if (robots === undefined) {
      robots = await checkRobots(page.origin, pathAndQueryOf(page.url), io.fetch);
      robotsBySite.set(page.origin, robots);
    }
    const decision = robotsDecisionFor(robots, pathAndQueryOf(page.url));
    const refused = classOfRobots(decision);
    if (refused !== null) return failed(refused, refused);

    const answer = await fetchPage(page.url, io.fetch);
    if (!answer.ok) return failed(answer.reason === 'unsafe_url' ? 'unsafe_url' : 'error', answer.reason);

    const cls = classOfAnswer(page.url, answer.finalUrl, answer.status, page.knownJsShell);
    // The page body is read only for a Black Friday address that answered, and only its title and first heading are kept.
    if (page.wantYear && cls === 'ok') {
      const body = await readLimited(answer.response, MAX_PAGE_BYTES);
      return { class: cls, httpStatus: answer.status, error: null, blackFriday: body === null ? null : blackFridayFlags(body.text) };
    }
    await discard(answer.response);
    return { class: cls, httpStatus: answer.status, error: null, blackFriday: null };
  } catch {
    return failed('error', 'exception');
  }
}

function describe(plan: Plan, delaySeconds: number): string {
  const noAddress = plan.subjects.filter((subject) => subject.url === null).length;
  const hidden = plan.subjects.filter((subject) => subject.kind === 'sale' && subject.hiddenReason !== null).length;
  return (
    `${plan.pages.length} pages on ${plan.sites} sites (${noAddress} stores have no sale address and are not asked; ${hidden} stores are hidden by Story 3.9), ` +
    `${delaySeconds} seconds apart: about ${estimateMinutes(plan.pages.length, delaySeconds)} minutes.\n`
  );
}

export async function runCheckUrls(argv: string[], io: CheckUrlsIo): Promise<number> {
  const args = parseCheckUrlsArgs(argv);
  if (!args.ok) {
    log.error('check_urls_usage', { reason: args.message });
    return 1;
  }

  // Bad input stops here, before any site is asked for anything.
  let plan: Plan;
  let names: Map<string, string>;
  try {
    const seedText = io.readText(SEED_FILE);
    const categoriesText = io.readText(CATEGORIES_FILE);
    const hiddenText = io.readText(HIDDEN_FILE);
    if (seedText === null || categoriesText === null || hiddenText === null) throw new Error('a data file is missing');
    const seed = buildSeed(parseSeedTsv(seedText), JSON.parse(categoriesText) as SeedCategory[]);
    const hidden = parseHiddenStores(JSON.parse(hiddenText));
    if (args.only !== null) {
      const known = new Set(seed.retailers.map((retailer) => retailer.slug));
      const unknown = args.only.filter((slug) => !known.has(slug));
      if (unknown.length > 0) throw new Error(`not in the seed file: ${unknown.join(', ')}`);
    }
    plan = planChecks(seed.retailers, hidden, args.only);
    names = new Map(seed.retailers.map((retailer) => [retailer.slug, retailer.name]));
  } catch (error) {
    log.error('check_urls_invalid', { error });
    return 1;
  }

  if (args.dryRun) {
    io.print(`Dry run: no page was asked for. A real run would ask for ${describe(plan, args.delaySeconds)}`);
    return 0;
  }

  // At most one full run in 24 hours. A short `--only` look does not count and writes nothing.
  if (args.only === null) {
    const previousText = io.readText(RESULT_JSON);
    if (previousText !== null) {
      const previous = readPreviousCheck(previousText);
      if (!previous.ok) {
        log.error('check_urls_previous_unreadable', { reason: previous.message });
        return 1;
      }
      const guard = canRunNow(previous.checkedAt, io.now());
      if (!guard.ok) {
        log.error('check_urls_too_soon', { reason: guard.message });
        return 1;
      }
    }
  }

  log.info('check_urls_start', { pages: plan.pages.length, sites: plan.sites, delaySeconds: args.delaySeconds, only: args.only, minutes: estimateMinutes(plan.pages.length, args.delaySeconds) });
  const answers = new Map<string, PageResult>();
  const robotsBySite = new Map<string, RobotsResult>();
  for (const [index, page] of plan.pages.entries()) {
    if (index > 0) await io.sleep(args.delaySeconds * 1000);
    const result = await checkPage(page, io, robotsBySite);
    answers.set(page.url, result);
    log.info('url_checked', { n: index + 1, of: plan.pages.length, host: hostOf(page.url), class: result.class, status: result.httpStatus, error: result.error });
  }

  const file = buildCheckFile({ plan, answers, checkedAt: isoSeconds(io.now()), userAgent: USER_AGENT, delaySeconds: args.delaySeconds });

  if (args.only !== null) {
    // A short look: print what was found and leave no trace.
    const lines = file.results.map((row: ResultRow) => `${row.slug} ${row.kind} ${row.class}${row.httpStatus === null ? '' : ` ${row.httpStatus}`}${row.error === null ? '' : ` ${row.error}`}${row.blackFriday === null ? '' : ` ${row.blackFriday.year}`}`);
    io.print(`${lines.join('\n')}\nShort look: no file was written and the 24-hour clock was not started.\n`);
    return 0;
  }

  io.writeFile(join(io.root, RESULT_JSON), `${JSON.stringify(file, null, 2)}\n`);
  io.writeFile(join(io.root, RESULT_MARKDOWN), renderCheckMarkdown(file, names));
  log.info('check_urls_done', { pages: file.pages, written: [RESULT_JSON, RESULT_MARKDOWN] });
  return 0;
}

// Runs only when started as the script (`pnpm ops:check-urls`), not when a test imports `runCheckUrls`.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCheckUrls(process.argv.slice(2), {
    root: repoRoot,
    readText: (relativePath) => {
      try {
        return readFileSync(join(repoRoot, relativePath), 'utf-8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    writeFile: (path, text) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text, 'utf-8');
    },
    // The bare global must be wrapped: calling it as `io.fetch(url)` loses its receiver.
    fetch: (input, init) => fetch(input, init),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => new Date(),
    print: (text) => process.stdout.write(text),
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      log.error('check_urls_failed', { error });
      process.exitCode = 1;
    },
  );
}
