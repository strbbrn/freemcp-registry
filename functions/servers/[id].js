// D1-backed detail pages for records added after the Astro static build.
// Existing pre-rendered detail pages continue to be served unchanged.
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export async function onRequestGet(context){
 const staticResponse=await context.next();
 if(staticResponse.status!==404)return staticResponse;
 const id=context.params.id;
 if(typeof id!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)||!context.env.DB)return staticResponse;
 let server;
 try{server=await context.env.DB.prepare('SELECT id,name,description,category,author,tags_json,github_url,stars FROM servers WHERE id=?').bind(id).first();}
 catch(error){console.error('Server detail lookup failed',error);return new Response('Registry temporarily unavailable',{status:503});}
 if(!server)return staticResponse;
 const tags=JSON.parse(server.tags_json);
 const githubUrl=String(server.github_url);
 let safeUrl='';
 try{const parsed=new URL(githubUrl);if(parsed.protocol==='https:'&&parsed.hostname==='github.com')safeUrl=parsed.href;}catch{}
 const title=escapeHtml(server.name),description=escapeHtml(server.description);
 const tagHtml=(Array.isArray(tags)?tags:[]).map(tag=>'<span class="tag">'+escapeHtml(tag)+'</span>').join(' ');
 const source=safeUrl?'<a class="button" href="'+escapeHtml(safeUrl)+'" target="_blank" rel="noopener noreferrer">View source repository</a>':'';
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — FreeMCP</title><meta name="description" content="${description}"><style>body{margin:0;background:#0b1020;color:#eef2ff;font:16px/1.7 system-ui,sans-serif}main{max-width:900px;margin:auto;padding:32px 22px 100px}a{color:#93c5fd}h1{font-size:clamp(2rem,5vw,3.5rem);line-height:1.1}h2{margin-top:40px}.muted{color:#a5b4cf}.tag{display:inline-block;padding:4px 10px;margin:4px;border:1px solid #475569;border-radius:8px}.button{display:inline-block;background:#dbeafe;color:#0f172a;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold}section{border-top:1px solid #334155;margin-top:35px;padding-top:12px}</style></head><body><main><nav><a href="/servers">← Browse MCP servers</a></nav><p class="muted">${escapeHtml(server.category)} · OPEN SOURCE LISTING</p><h1>${title}</h1><p>${description}</p>${source}<section><h2>Overview</h2><p>${description}</p><h3>Related topics</h3>${tagHtml}</section><section><h2>Installation and security</h2><p>Review the upstream repository's installation instructions, permissions, and security guidance before using this MCP server. Tool definitions and compatibility are not independently verified.</p></section><section><h2>Repository details</h2><p>Maintainer: ${escapeHtml(server.author)}</p><p>GitHub stars (last synchronized): ${Number(server.stars)||0}</p><p>Review status: Unverified</p></section></main></body></html>`;
 return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=60','x-content-type-options':'nosniff'}});
}
