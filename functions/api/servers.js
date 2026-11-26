import { head } from '../../lib/http.js';
import { MAX_PAGE, PAGE_SIZE, readFilters, registry } from '../../lib/registry.js';

const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': status === 200 ? 'public, max-age=30' : 'no-store', 'x-content-type-options': 'nosniff' },
});

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ error: 'Registry database is not configured' }, 503);
  const params = new URL(request.url).searchParams;
  const categories = params.get('meta') === 'categories';
  try {
    const store = registry(env.DB);
    if (categories) return json({ categories: await store.categories() });
    const page = Math.min(MAX_PAGE, Math.max(1, Number.parseInt(params.get('page'), 10) || 1));
    const limit = Number.parseInt(params.get('limit'), 10);
    const size = Number.isFinite(limit) ? Math.min(PAGE_SIZE, Math.max(1, limit)) : PAGE_SIZE;
    return json(await store.directory({ ...readFilters(params), page, size, clampPage: true }));
  } catch (error) {
    console.error('Registry API query failed', error);
    return json({ error: categories ? 'Registry categories failed' : 'Registry query failed' }, 500);
  }
}

export const onRequestHead = head(onRequestGet);
