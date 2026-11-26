import { canonicalUrl, listingPath } from './seo.js';

export const SITEMAP_SIZE = 2000;
const staticPaths = [
  '/', '/servers/', '/submit/', '/about/', '/faq/', '/privacy/', '/terms/', '/contact/',
  '/guides/', '/guides/what-is-mcp/', '/guides/install-mcp-server/', '/guides/mcp-vs-api/',
];
export const sitemapPartPath = part => '/sitemap/' + part + '.xml';

export const escapeXml = value => value.replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[char]);

export function sitemapXml(ids, includeStatic) {
  return xml('urlset', 'url', [...(includeStatic ? staticPaths : []), ...ids.map(listingPath)]);
}

export function sitemapIndexXml(parts) {
  return xml('sitemapindex', 'sitemap', Array.from({ length: parts }, (_, index) => sitemapPartPath(index + 1)));
}

function xml(type, item, paths) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<${type} xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    paths.map(path => `  <${item}><loc>${escapeXml(canonicalUrl(path))}</loc></${item}>`).join('\n') +
    `\n</${type}>\n`;
}

export function sitemapResponse(content, request) {
  const hostname = request && new URL(request.url).hostname;
  return new Response(content, { headers: {
    'content-type': 'application/xml; charset=utf-8',
    'cache-control': 'public, max-age=300',
    'x-content-type-options': 'nosniff',
    ...(hostname && /\.freemcp\.pages\.dev$/.test(hostname) ? { 'x-robots-tag': 'noindex' } : {}),
  } });
}
