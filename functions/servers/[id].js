// Every server detail page is rendered from D1.
import { head, htmlHeaders, notFound, redirect, unavailable } from '../../lib/http.js';
import { isSlug, registry } from '../../lib/registry.js';
import { listingPath } from '../../lib/seo.js';
import { renderListing } from '../../lib/listing-renderer.js';

export { renderListing } from '../../lib/listing-renderer.js';

export async function onRequestGet(context) {
 const id = context.params.id;
 if (!isSlug(id)) return notFound('Server not found');
 const path = listingPath(id);
 if (context.request) {
  const url = new URL(context.request.url);
  if (url.pathname !== path) return redirect(path + url.search);
 }
 if (!context.env.DB) return unavailable();
 const store = registry(context.env.DB);
 let s;
 try { s = await store.detail(id); }
 catch (error) { console.error('Server detail lookup failed', error); return unavailable(); }
 if (!s) return notFound('Server not found');
 let related = [];
 try { related = await store.related(s); }
 catch (error) { console.warn('Related server lookup unavailable', error); }
 return new Response(renderListing(s,{path,related}), { headers: htmlHeaders(context.request) });
}

export const onRequestHead = head(onRequestGet);
