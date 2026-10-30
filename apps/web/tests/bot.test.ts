import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BOT_USER_AGENT } from '../src/lib/bot';

describe('the bot named on the About page (Story 2.5)', () => {
  it('is the user-agent the pipeline sends', () => {
    const source = readFileSync(fileURLToPath(new URL('../../pipeline/src/fetcher.ts', import.meta.url)), 'utf-8');
    const sent = /export const USER_AGENT = '([^']+)'/.exec(source)?.[1];
    expect(sent).toBe(BOT_USER_AGENT);
  });
  it('names the product token the pipeline matches robots.txt groups with', () => {
    expect(BOT_USER_AGENT.startsWith('SaleawayBot/')).toBe(true);
  });
});
