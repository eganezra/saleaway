// robots.txt rules (RFC 9309), pure: the caller fetches the file and passes its text in.

const MAX_TEXT_LENGTH = 500 * 1024; // RFC 9309: a crawler must parse at least 500 KiB
const MAX_PATTERN_LENGTH = 1024;
const MAX_RULES = 2000;
// Upper bound on the matching work for one question (about 100 ms), so a hostile file cannot burn the CPU of a store's turn.
const MAX_STEPS = 5_000_000;

interface Rule {
  allow: boolean;
  pattern: string;
}

interface Group {
  agents: string[];
  rules: Rule[];
}

function parseGroups(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  let ruleCount = 0;

  const lines = text.replace(/^\uFEFF/, '').slice(0, MAX_TEXT_LENGTH).split(/\r\n|\r|\n/);
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (line === '') continue;
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const field = (match[1] ?? '').toLowerCase();
    const value = (match[2] ?? '').trim();

    if (field === 'user-agent') {
      if (!lastWasAgent || current === null) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === 'allow' || field === 'disallow') {
      lastWasAgent = false;
      if (current === null || value === '' || value.length > MAX_PATTERN_LENGTH || ruleCount >= MAX_RULES) continue;
      current.rules.push({ allow: field === 'allow', pattern: value });
      ruleCount += 1;
    }
    // Any other directive (Sitemap, Crawl-delay, ...) is ignored and does not end a group.
  }
  return groups;
}

/**
 * Does `pattern` match the start of `text`? `*` matches any run of characters, and a trailing `$` anchors
 * the end. `reachable` holds every text position at which the pattern read so far can end, so the cost is
 * at most pattern length times text length, whatever the pattern looks like. `budget.left` counts the
 * work still allowed for the whole question: when it runs out, `budget.spent` is set and the answer is false.
 */
function matches(pattern: string, text: string, budget: { left: number; spent: boolean }): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  let reachable = new Set<number>([0]);
  for (const ch of body) {
    const next = new Set<number>();
    if (ch === '*') {
      let first = text.length;
      for (const position of reachable) first = Math.min(first, position);
      budget.left -= reachable.size + (text.length - first + 1);
      if (budget.left < 0) {
        budget.spent = true;
        return false;
      }
      for (let i = first; i <= text.length; i++) next.add(i);
    } else {
      budget.left -= reachable.size;
      if (budget.left < 0) {
        budget.spent = true;
        return false;
      }
      for (const position of reachable) {
        if (position < text.length && text[position] === ch) next.add(position + 1);
      }
    }
    if (next.size === 0) return false;
    reachable = next;
  }
  return anchored ? reachable.has(text.length) : true;
}

/**
 * Is `pathAndQuery` (for example `/sale?x=1`) allowed for the crawler called `agent`?
 * The group naming the agent is used (several groups for it are combined), else the `*` group, else
 * everything is allowed. The longest matching pattern wins and `Allow` wins a tie. No match means allowed.
 * A file whose rules cost more than MAX_STEPS to evaluate is not trusted: the answer is "not allowed".
 */
export function isAllowedByRobots(robotsTxt: string, pathAndQuery: string, agent = 'SaleawayBot'): boolean {
  const groups = parseGroups(robotsTxt);
  const name = agent.toLowerCase();
  let chosen = groups.filter((group) => group.agents.includes(name));
  if (chosen.length === 0) chosen = groups.filter((group) => group.agents.includes('*'));
  if (chosen.length === 0) return true;

  const budget = { left: MAX_STEPS, spent: false };
  let best: Rule | null = null;
  for (const group of chosen) {
    for (const rule of group.rules) {
      if (!matches(rule.pattern, pathAndQuery, budget)) {
        if (budget.spent) return false;
        continue;
      }
      if (best === null || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)) {
        best = rule;
      }
    }
  }
  return best === null ? true : best.allow;
}
