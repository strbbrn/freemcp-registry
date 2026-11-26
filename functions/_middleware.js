import { onRequestGet as registry } from './api/servers.js';
const origin='https://freemcp.in';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pageUrl=p=>'/servers/'+(p>1?'?page='+p:'');
export async function onRequest(context){
 const url=new URL(context.request.url);
 if(!['GET','HEAD'].includes(context.request.method))return context.next();
 if(/^\/v2-preview\/?$/.test(url.pathname))return Response.redirect(origin+'/servers/',301);
 if(url.pathname!=='/servers/'&&url.pathname!=='/servers')return context.next();
 if(url.pathname==='/servers')return Response.redirect(origin+'/servers/'+url.search,301);
 const apiUrl=new URL('/api/servers',url);
 for(const k of ['q','category','sort','page'])if(url.searchParams.has(k))apiUrl.searchParams.set(k,url.searchParams.get(k));
 const response=await registry({request:new Request(apiUrl),env:context.env});
 if(!response.ok)return new Response('Registry temporarily unavailable',{status:503,headers:{'cache-control':'no-store','retry-after':'60'}});
 const data=await response.json();
 const requested=Number(url.searchParams.get('page')||1);
 if(!Number.isSafeInteger(requested)||requested<1||requested>data.pages)return new Response('Page not found',{status:404});
 const filtered=['q','category','sort'].some(k=>url.searchParams.has(k));
 const canonical=origin+pageUrl(data.page);
 const rows=data.servers.map(s=>'<article class="server-row"><div class="server-identity"><span class="server-mark" aria-hidden="true">'+esc(s.name.charAt(0).toUpperCase())+'</span><div class="server-main"><h2><a href="/servers/'+encodeURIComponent(s.id)+'">'+esc(s.name)+'</a></h2><p class="server-description">'+esc(s.description)+'</p><span class="server-author">by '+esc(s.author)+'</span></div></div><div class="server-category"><span class="category-pill">'+esc(s.category)+'</span></div><div class="server-status">'+(s.lifecycle==='archived'?'<span class="status-pill archived">Archived</span>':'')+'</div><a class="server-action" href="/servers/'+encodeURIComponent(s.id)+'">View details →</a></article>').join('');
 const pagination=(data.page>1?'<a href="'+pageUrl(data.page-1)+'">Previous page</a> ':'')+(data.page<data.pages?'<a href="'+pageUrl(data.page+1)+'">Next page</a>':'');
 const asset=await context.next();
 if(!asset.ok||!asset.headers.get('content-type')?.includes('text/html'))return asset;
 return new HTMLRewriter()
 .on('#registry-results',{element(e){e.setInnerContent(rows||'<p>No matching servers.</p>',{html:true});}})
 .on('#registry-count',{element(e){e.setInnerContent(data.total+' matching servers');}})
 .on('#page-indicator',{element(e){e.setInnerContent('Page '+data.page+' of '+data.pages);}})
 .on('nav.pagination',{element(e){e.append('<span class="crawl-pagination">'+pagination+'</span>',{html:true});}})
 .on('link[rel="canonical"]',{element(e){e.setAttribute('href',canonical);}})
 .on('meta[property="og:url"]',{element(e){e.setAttribute('content',canonical);}})
 .on('head',{element(e){if(filtered)e.append('<meta name="robots" content="noindex,follow">',{html:true});}})
 .transform(asset);
}
