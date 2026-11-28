import { escapeHtml } from '../seo.js';

export const e = escapeHtml;
export class AdminError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const invalid = message => { throw new AdminError(400, message); };
export const conflict = () => { throw new AdminError(409, 'This record changed. Reload it and review the latest version before trying again.'); };
export function hardened(response, { oauth = false, oauthEndpoint = false } = {}) {
  const headers = new Headers(response.headers);
  const previewStyle = headers.get('X-FreeMCP-Preview-Style');
  headers.delete('X-FreeMCP-Preview-Style');
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  headers.set('X-Content-Type-Options', 'nosniff');
  // HTML form navigation needs a same-origin policy to send a usable Origin.
  // Never carry OAuth callback parameters into the redirected request.
  headers.set('Referrer-Policy', oauthEndpoint || previewStyle ? 'no-referrer' : 'same-origin');
  headers.set('Content-Security-Policy', `default-src 'none'; style-src 'self'${previewStyle ? " 'sha256-"+previewStyle+"'" : ''}; script-src ${previewStyle?"'none'":"'self'"}; connect-src ${previewStyle?"'none'":"'self'"}; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'${oauth ? ' https://github.com' : ''}; frame-ancestors 'none'`);
  headers.set('X-Frame-Options', 'DENY');
  return new Response(response.body, { status: response.status, headers });
}
export const html = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
export function redirect(path, cookies = []) {
  const response = new Response(null, { status: 303, headers: { location: path } });
  for (const cookie of cookies) response.headers.append('Set-Cookie', cookie);
  return response;
}
export function methodNotAllowed(...allowed) {
  return new Response('Method not allowed', { status: 405, headers: { Allow: allowed.join(', ') } });
}
export async function body(request, { max = 192 * 1024 } = {}) {
  const type = request.headers.get('Content-Type')?.split(';')[0];
  if (!['application/json', 'application/x-www-form-urlencoded'].includes(type)) throw new AdminError(415, 'Unsupported request format.');
  const declared = request.headers.get('Content-Length');
  if (declared && Number(declared) > max) throw new AdminError(413, 'Request is too large.');
  const reader = request.body?.getReader();
  if (!reader) invalid('Missing request body.');
  const decoder = new TextDecoder();
  let raw = '', size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new AdminError(413, 'Request is too large.');
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally { reader.releaseLock(); }
  let value;
  try {
    value = type === 'application/json' ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
  } catch { invalid('Invalid request body.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Expected a request object.');
  return value;
}
