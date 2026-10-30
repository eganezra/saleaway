// Cloudflare Web Analytics (Story 2.5): cookie-free visit counts. The tag is only added when a token is set.

/** The token if it looks like one (letters and digits, 16 to 64 of them), else null: nothing else may reach the page. */
export function analyticsToken(value: string | undefined): string | null {
  const token = (value ?? '').trim();
  return /^[A-Za-z0-9]{16,64}$/.test(token) ? token : null;
}
