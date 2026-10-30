// Which URLs the pipeline may fetch. Pure: no I/O. The pipeline only ever fetches public https sites by name.

const MAX_URL_LENGTH = 2048;
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal'];

/**
 * True only for an https URL with no credentials, port 443 (or none), and a public-looking host name:
 * one trailing dot is ignored (`localhost.` is `localhost`), it must contain a dot, must not be
 * `localhost` or end in `.localhost`, `.local` or `.internal`, must not have an empty label, and must
 * not be an IP address of any kind (the URL parser turns `2130706433`, `0x7f.0.0.1` and `127.1` into
 * dotted-quad form, and IPv6 literals keep their square brackets).
 *
 * This is stricter than "reject private and link-local addresses" because a Worker cannot resolve a
 * name to see its address, and no retailer uses an IP address.
 */
export function isSafeFetchUrl(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '') return false;
  if (url.port !== '' && url.port !== '443') return false;

  const host = url.hostname.replace(/\.$/, '');
  if (host === '' || !host.includes('.')) return false;
  if (host.startsWith('[')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  if (host.split('.').some((label) => label === '')) return false;
  if (host === 'localhost' || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
  return true;
}

/**
 * Resolves a `Location` header (absolute, relative or protocol-relative) against the current URL.
 * Returns the new URL only when it is safe to fetch; otherwise null (never follow it).
 */
export function resolveRedirect(current: string, location: string): string | null {
  let resolved: URL;
  try {
    resolved = new URL(location, current);
  } catch {
    return null;
  }
  return isSafeFetchUrl(resolved.href) ? resolved.href : null;
}
