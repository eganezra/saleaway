// Which address a visitor should end up on (Story 4.4). Pure: the caller passes the request address and the site's own address.
import { siteOrigin } from './seo';

/**
 * Where a visitor of `www.<the site's host>` is sent: the same path and query on the site's own address. Returns null for every
 * other host (the site itself, `wwwxsaleaway.online`, `www.www.saleaway.online`, any other site), so nothing but the one `www`
 * name is ever redirected. The target always starts with the site's own origin, so the path cannot change where it leads.
 * The caller redirects only `GET` and `HEAD`.
 */
export function wwwRedirectTarget(requestUrl: string, siteUrl: string | undefined): string | null {
  let request: URL;
  try {
    request = new URL(requestUrl);
  } catch {
    return null;
  }
  const site = new URL(siteOrigin(siteUrl));
  if (request.hostname !== `www.${site.hostname}`) return null;
  return `${site.origin}${request.pathname}${request.search}`;
}
