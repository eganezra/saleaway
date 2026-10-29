/**
 * True when the request carries `Authorization: Bearer <token>` matching the configured token.
 * The comparison goes through every character of the token (constant time for equal lengths), and a
 * missing or empty configured token never matches anything.
 */
export function isAuthorized(req: Request, token: string | undefined): boolean {
  const header = req.headers.get('Authorization') ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || supplied.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ supplied.charCodeAt(i);
  return diff === 0;
}
