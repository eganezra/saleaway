import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isAllowedByRobots } from '../src/robots';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/robots/${name}`, import.meta.url)), 'utf-8');
const allowed = (name: string, path: string, agent?: string) => isAllowedByRobots(fixture(name), path, agent);

describe('isAllowedByRobots on whole files', () => {
  it('allows everything for an empty Disallow and for an empty file', () => {
    expect(allowed('allow-all.txt', '/anything')).toBe(true);
    expect(isAllowedByRobots('', '/sale')).toBe(true);
    expect(isAllowedByRobots('   \n\n', '/sale')).toBe(true);
  });

  it('disallows everything for Disallow: /', () => {
    expect(allowed('disallow-all.txt', '/')).toBe(false);
    expect(allowed('disallow-all.txt', '/sale')).toBe(false);
    expect(allowed('disallow-all.txt', '/sale?x=1')).toBe(false);
  });

  it('a group naming SaleawayBot replaces the * group completely', () => {
    expect(allowed('retailer.txt', '/cart')).toBe(true); // the * rules do not apply to SaleawayBot
    expect(allowed('retailer.txt', '/private/page')).toBe(false);
    expect(allowed('retailer.txt', '/private/sale/shoes')).toBe(true); // longer Allow beats Disallow
    expect(allowed('retailer.txt', '/sale')).toBe(true);
  });

  it('uses the * group for a crawler with no group of its own, with wildcards and $', () => {
    for (const [path, expected] of [
      ['/sale', true], ['/cart', false], ['/cart/items', false], ['/checkout', false],
      ['/search', false], ['/search/sale', true], ['/search/sale/x', true], ['/search/other', false],
      ['/shoes?sort=price', false], ['/shoes', true],
      ['/account', false], ['/account/orders', true],
    ] as const) {
      expect(allowed('retailer.txt', path, 'OtherBot'), path).toBe(expected);
    }
  });

  it('ignores groups for other crawlers and uses * for us', () => {
    expect(allowed('other-agents.txt', '/nogoogle')).toBe(true);
    expect(allowed('other-agents.txt', '/sale')).toBe(false);
    expect(allowed('other-agents.txt', '/salesman')).toBe(false); // a rule is a prefix match
  });

  it('combines several groups for the same agent, in any letter case (RFC 9309)', () => {
    expect(allowed('repeated-agent.txt', '/a')).toBe(true); // the * group is not used, we have our own
    expect(allowed('repeated-agent.txt', '/b')).toBe(false);
    expect(allowed('repeated-agent.txt', '/c')).toBe(false);
  });

  it('a group with several User-agent lines applies to each of them', () => {
    expect(allowed('several-agents.txt', '/multi')).toBe(false);
    expect(allowed('several-agents.txt', '/multi', 'Googlebot')).toBe(false);
    expect(allowed('several-agents.txt', '/other')).toBe(true);
    expect(allowed('several-agents.txt', '/multi', 'SomeoneElse')).toBe(true);
  });

  it('copes with a byte order mark, CRLF line endings, comments and blank lines', () => {
    expect(allowed('bom-crlf.txt', '/crlf')).toBe(false);
    expect(allowed('bom-crlf.txt', '/crlf/ok')).toBe(true);
    expect(allowed('bom-crlf.txt', '/elsewhere')).toBe(true);
  });

  it('allows everything for a file that is not robots.txt (for example an HTML error page)', () => {
    expect(allowed('not-robots.txt', '/sale')).toBe(true);
  });

  it('ignores rules before any User-agent line and directives it does not know', () => {
    expect(allowed('orphan-and-unknown.txt', '/orphan')).toBe(true);
    expect(allowed('orphan-and-unknown.txt', '/x')).toBe(false);
    expect(allowed('orphan-and-unknown.txt', '/y')).toBe(false); // the unknown line did not end the group
  });
});

describe('isAllowedByRobots rule matching', () => {
  const rules = (body: string) => `User-agent: *\n${body}\n`;

  it('the longest pattern wins, and Allow wins a tie', () => {
    expect(isAllowedByRobots(rules('Disallow: /a\nAllow: /a/b'), '/a/b/c')).toBe(true);
    expect(isAllowedByRobots(rules('Disallow: /a/b\nAllow: /a'), '/a/b/c')).toBe(false);
    expect(isAllowedByRobots(rules('Disallow: /same\nAllow: /same'), '/same')).toBe(true);
    expect(isAllowedByRobots(rules('Allow: /same\nDisallow: /same'), '/same')).toBe(true);
  });

  it('a pattern matches only the start of the path', () => {
    expect(isAllowedByRobots(rules('Disallow: /sale'), '/shop/sale')).toBe(true);
    expect(isAllowedByRobots(rules('Disallow: /sale'), '/sale/shoes')).toBe(false);
    expect(isAllowedByRobots(rules('Disallow: /sale'), '/salesman')).toBe(false);
  });

  it('* matches any run of characters, including none, and across slashes', () => {
    expect(isAllowedByRobots(rules('Disallow: /*.pdf'), '/files/a/b.pdf')).toBe(false);
    expect(isAllowedByRobots(rules('Disallow: /*.pdf'), '/.pdf')).toBe(false);
    expect(isAllowedByRobots(rules('Disallow: /*.pdf'), '/files/a.html')).toBe(true);
    expect(isAllowedByRobots(rules('Disallow: /a*b*c'), '/a--b--c--')).toBe(false);
    expect(isAllowedByRobots(rules('Disallow: /a*b*c'), '/a--c--b')).toBe(true);
    expect(isAllowedByRobots(rules('Disallow: *'), '/anything')).toBe(false);
  });

  it('a trailing $ anchors the end of the path and query', () => {
    expect(isAllowedByRobots(rules('Disallow: /*.pdf$'), '/a.pdf')).toBe(false);
    expect(isAllowedByRobots(rules('Disallow: /*.pdf$'), '/a.pdf?download=1')).toBe(true);
    expect(isAllowedByRobots(rules('Disallow: /end$'), '/end')).toBe(false);
    expect(isAllowedByRobots(rules('Disallow: /end$'), '/end/more')).toBe(true);
  });

  it('matches the query string as part of the text', () => {
    expect(isAllowedByRobots(rules('Disallow: /*?'), '/p?x=1')).toBe(false);
    expect(isAllowedByRobots(rules('Disallow: /*?'), '/p')).toBe(true);
    expect(isAllowedByRobots(rules('Disallow: /p?x='), '/p?x=1')).toBe(false);
  });

  it('is not case-sensitive for field names and the agent, but is for paths', () => {
    expect(isAllowedByRobots('USER-AGENT: *\nDISALLOW: /Sale\n', '/Sale')).toBe(false);
    expect(isAllowedByRobots('USER-AGENT: *\nDISALLOW: /Sale\n', '/sale')).toBe(true);
    expect(isAllowedByRobots('User-agent: SALEAWAYBOT\nDisallow: /x\n', '/x')).toBe(false);
  });

  it('a very long or very numerous rule set stays fast and correct', () => {
    const many = Array.from({ length: 5000 }, (_, i) => `Disallow: /r${i}x`).join('\n');
    const started = Date.now();
    expect(isAllowedByRobots(rules(many), '/r1x')).toBe(false);
    expect(isAllowedByRobots(rules(many), '/r1999x')).toBe(false); // the 2000th rule is still read
    expect(isAllowedByRobots(rules(many), '/r4999x')).toBe(true); // rules past the 2000 limit are ignored
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('a hostile pattern with many wildcards does not hang', () => {
    const hostile = `Disallow: ${'*a'.repeat(200)}b`;
    const started = Date.now();
    expect(isAllowedByRobots(rules(hostile), `/${'a'.repeat(500)}`)).toBe(true);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('only reads the first 500 KiB', () => {
    const padding = `# ${'x'.repeat(100)}\n`.repeat(6000); // about 600 KiB of comments
    expect(isAllowedByRobots(`${padding}User-agent: *\nDisallow: /late\n`, '/late')).toBe(true);
    expect(isAllowedByRobots(`User-agent: *\nDisallow: /early\n${padding}`, '/early')).toBe(false);
  });
});
