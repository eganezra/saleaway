import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Story 4.4: the rules of the two workflows, checked as text (no YAML library: the files are small and kept in one plain shape).
// A rule that is broken by an edit fails here, before it fails in GitHub.

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string): string => readFileSync(`${root}${path}`, 'utf-8');
const ci = read('.github/workflows/ci.yml');
const deploy = read('.github/workflows/deploy.yml');
const pkg = JSON.parse(read('package.json')) as { packageManager?: string; scripts: Record<string, string> };

/** The text of the steps of the job named `job`, one string per step. */
function steps(file: string, job: string): string[] {
  const start = file.indexOf(`\n  ${job}:\n`);
  expect(start, `job ${job}`).toBeGreaterThan(-1);
  const rest = file.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z-]+:\n/);
  const body = next === -1 ? rest : rest.slice(0, next + 1);
  const from = body.indexOf('    steps:\n');
  expect(from, `steps of ${job}`).toBeGreaterThan(-1);
  return body
    .slice(from + '    steps:\n'.length)
    .split(/\n(?= {6}- )/)
    .map((step) => step.trimEnd());
}

const deploySteps = steps(deploy, 'deploy');
const runOf = (step: string): string => /run: (.+)/.exec(step)?.[1]?.trim() ?? '';
const timeoutOf = (step: string): number => Number(/timeout-minutes: (\d+)/.exec(step)?.[1] ?? 0);

describe('deploy.yml', () => {
  it('runs on a push to main and by hand, and calls the checks first', () => {
    expect(deploy).toMatch(/on:\n {2}push:\n {4}branches: \[main\]\n {2}workflow_dispatch:/);
    expect(deploy).toMatch(/jobs:\n {2}ci:\n {4}uses: \.\/\.github\/workflows\/ci\.yml/);
  });

  it('deploys only after the checks passed (a failing build or test stops the deploy)', () => {
    expect(deploy).toMatch(/ {2}deploy:\n {4}needs: ci\n/);
  });

  it('deploys only from main and only when DEPLOY_ENABLED is the text true', () => {
    const condition = /\n {4}if: (.+)\n/.exec(deploy.slice(deploy.indexOf('  deploy:')))?.[1] ?? '';
    expect(condition).toContain("github.ref == 'refs/heads/main'");
    expect(condition).toContain("vars.DEPLOY_ENABLED == 'true'");
    expect(condition).toContain('&&');
  });

  it('never runs two deploys at once and never cancels one that has started', () => {
    expect(deploy).toMatch(/concurrency:\n {2}group: deploy\n {2}cancel-in-progress: false/);
  });

  it('applies the migrations, then deploys the web app, then waits out the nightly run, then deploys the pipeline', () => {
    const order = ['pnpm db:migrate:remote', 'pnpm deploy:web', 'pnpm ci:wait-for-quiet-window', 'pnpm deploy:pipeline'].map((command) => deploySteps.findIndex((s) => runOf(s) === command));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('gives the job room for the quiet-window wait, and every step its own limit', () => {
    const job = Number(/ {4}timeout-minutes: (\d+)/.exec(deploy.slice(deploy.indexOf('  deploy:')))?.[1] ?? 0);
    expect(job).toBeGreaterThanOrEqual(80);
    for (const step of deploySteps) expect(timeoutOf(step), step).toBeGreaterThan(0);
    const wait = deploySteps.find((s) => runOf(s) === 'pnpm ci:wait-for-quiet-window') as string;
    expect(timeoutOf(wait)).toBeGreaterThanOrEqual(61);
    expect(timeoutOf(wait)).toBeLessThan(job);
  });

  it('gives the Cloudflare secrets to the three steps that talk to Cloudflare and to no other', () => {
    const withSecrets = deploySteps.filter((s) => s.includes('secrets.')).map(runOf);
    expect(withSecrets).toEqual(['pnpm db:migrate:remote', 'pnpm deploy:web', 'pnpm deploy:pipeline']);
    for (const step of deploySteps.filter((s) => s.includes('secrets.'))) {
      expect(step).toContain('CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}');
      expect(step).toContain('CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}');
    }
  });
});

describe('ci.yml', () => {
  const ciSteps = steps(ci, 'ci');
  const runs = ciSteps.map(runOf);

  it('runs on pull requests and when deploy.yml calls it, with no secret', () => {
    expect(ci).toMatch(/on:\n {2}pull_request:\n {2}workflow_call:/);
    expect(ci).not.toContain('secrets.');
    expect(ci).not.toContain('vars.');
  });

  it('runs lint, type check and the tests', () => {
    for (const command of ['pnpm lint', 'pnpm typecheck', 'pnpm test']) expect(runs).toContain(command);
  });

  it('installs the Playwright browser with its system libraries before the smoke test, and runs the smoke test', () => {
    const install = runs.indexOf('pnpm --filter @saleaway/web exec playwright install --with-deps chromium');
    const smoke = runs.indexOf('pnpm test:smoke');
    expect(install).toBeGreaterThan(-1);
    expect(smoke).toBeGreaterThan(install);
  });

  it('has a time limit', () => {
    expect(Number(/ {4}timeout-minutes: (\d+)/.exec(ci)?.[1] ?? 0)).toBeGreaterThan(0);
  });
});

describe('both workflows', () => {
  const both = { 'ci.yml': ci, 'deploy.yml': deploy };

  it('use the Node version of the repository and the pnpm cache', () => {
    expect(existsSync(`${root}.nvmrc`)).toBe(true);
    for (const [name, text] of Object.entries(both)) {
      if (name === 'ci.yml' || text.includes('actions/setup-node')) {
        expect(text, name).toContain('node-version-file: .nvmrc');
        expect(text, name).toContain('cache: pnpm');
        expect(text, name).not.toMatch(/node-version: /);
      }
    }
  });

  it('use only actions at a major version, never a branch', () => {
    for (const [name, text] of Object.entries(both)) {
      const uses = [...text.matchAll(/uses: (\S+)/g)].map((m) => m[1] as string);
      expect(uses.length, name).toBeGreaterThan(0);
      for (const action of uses) expect(action.startsWith('./') || /@v\d+$/.test(action), `${name}: ${action}`).toBe(true);
    }
  });

  it('call only scripts that exist in package.json', () => {
    for (const [name, text] of Object.entries(both)) {
      for (const match of text.matchAll(/run: pnpm ([a-z][a-z0-9:-]*)/g)) {
        const script = match[1] as string;
        if (['install', 'exec'].includes(script)) continue;
        expect(pkg.scripts[script], `${name}: pnpm ${script}`).toBeDefined();
      }
    }
  });

  it('hold no literal secret, token or account ID', () => {
    for (const [name, text] of Object.entries(both)) {
      expect(text, name).not.toMatch(/\b[0-9a-f]{32}\b/);
      expect(text, name).not.toMatch(/ghp_|github_pat_|gho_/);
      expect(text, name).not.toMatch(/[A-Za-z0-9_-]{40,}/);
      expect(text, name).not.toMatch(/workers\.dev/);
    }
    // The secrets are only ever read through `secrets.`, and the two names are the ones the story names.
    const names = new Set([...deploy.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]));
    expect([...names].sort()).toEqual(['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']);
  });
});

describe('the repository', () => {
  it('names the pnpm version the workflows use and has the quiet-window script', () => {
    expect(pkg.packageManager).toBe('pnpm@9.0.0');
    expect(pkg.scripts['ci:wait-for-quiet-window']).toContain('wait-for-quiet-window.ts');
  });
});
