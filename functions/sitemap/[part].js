import { head, notFound, unavailable } from '../../lib/http.js';
import { MAX_PAGE, registry } from '../../lib/registry.js';
import { SITEMAP_SIZE, sitemapResponse, sitemapXml } from '../../lib/sitemap.js';

export async function onRequestGet({ env, params, request }) {
  if (!/^[1-9]\d{0,4}\.xml$/.test(params.part)) return notFound();
  const part = Number(params.part.slice(0, -4));
  if (part > MAX_PAGE) return notFound();
  try {
    const ids = await registry(env.DB).sitemapIds(SITEMAP_SIZE, (part - 1) * SITEMAP_SIZE);
    if (!ids.length) return notFound();
    return sitemapResponse(sitemapXml(ids, part === 1), request);
  } catch (error) {
    console.error('Sitemap part generation failed', error);
    return unavailable('Sitemap temporarily unavailable');
  }
}

export const onRequestHead = head(onRequestGet);
