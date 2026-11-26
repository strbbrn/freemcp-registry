export function unavailable(message = 'Registry temporarily unavailable') {
  return new Response(message, { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '60' } });
}

export function notFound(message = 'Page not found') {
  return new Response(message, { status: 404, headers: { 'cache-control': 'no-store' } });
}

export function redirect(path, status = 308) {
  return new Response(null, { status, headers: { location: path } });
}

export function htmlHeaders(request, headers = {}) {
  const result = new Headers(headers);
  result.set('content-type', 'text/html; charset=utf-8');
  result.set('cache-control', 'public, max-age=30');
  result.set('x-content-type-options', 'nosniff');
  if (request && /\.freemcp\.pages\.dev$/.test(new URL(request.url).hostname)) {
    result.set('x-robots-tag', 'noindex');
  }
  return result;
}

export function head(get) {
  return async context => {
    const response = await get(context);
    await response.body?.cancel();
    return new Response(null, { status: response.status, headers: response.headers });
  };
}
