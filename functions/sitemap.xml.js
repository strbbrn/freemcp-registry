// Dynamic sitemap: public D1 listings only. Never expose pending/test-only entries.
const origin = 'https://freemcp.in';
const escapeXml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export async function onRequestGet({env}) {
  if (!env.DB) return new Response('Sitemap temporarily unavailable', {status:503,headers:{'cache-control':'no-store'}});
  try {
    const {results} = await env.DB.prepare(
      "SELECT id FROM servers WHERE COALESCE(json_extract(details_json, '$.review.status'), 'published') NOT IN ('pending-publication', 'test-only') ORDER BY id"
    ).all();
    const urls = ['/', '/servers/', '/submit/', '/about/', '/faq/', '/privacy/', '/terms/', '/contact/', '/guides/', '/guides/what-is-mcp/', '/guides/install-mcp-server/', '/guides/mcp-vs-api/', ...results
      .filter(row => typeof row.id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.id))
      .map(row => '/servers/' + row.id)];
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + urls.map(path => '  <url><loc>' + escapeXml(origin + path) + '</loc></url>').join('\n')
      + '\n</urlset>\n';
    return new Response(xml, {headers:{'content-type':'application/xml; charset=utf-8','cache-control':'public, max-age=300'}});
  } catch (error) {
    console.error('Sitemap generation failed', error);
    return new Response('Sitemap temporarily unavailable', {status:503,headers:{'cache-control':'no-store'}});
  }
}
