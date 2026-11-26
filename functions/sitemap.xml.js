import { head, unavailable } from '../lib/http.js';
import { registry } from '../lib/registry.js';
import { SITEMAP_SIZE, sitemapIndexXml, sitemapResponse, sitemapXml } from '../lib/sitemap.js';

export async function onRequestGet({ env, request }) {
  try {
    const store = registry(env.DB);
    const ids = await store.sitemapIds(SITEMAP_SIZE + 1, 0);
    const xml = ids.length > SITEMAP_SIZE
      ? sitemapIndexXml(Math.ceil(await store.sitemapCount() / SITEMAP_SIZE))
      : sitemapXml(ids, true);
    return sitemapResponse(xml, request);
  } catch (error) {
    console.error('Sitemap generation failed', error);
    return unavailable('Sitemap temporarily unavailable');
  }
}

export const onRequestHead = head(onRequestGet);
