// Cloudflare Pages Function: bind a D1 database as DB in the preview environment.
const json = (body, status=200) => new Response(JSON.stringify(body), {status,headers:{'content-type':'application/json; charset=utf-8','cache-control':status===200?'public, max-age=30':'no-store'}});
export async function onRequestGet({request,env}) {
 if (!env.DB) return json({error:'Registry database is not configured'},503);
 const url=new URL(request.url);
 if(url.searchParams.get('meta')==='categories'){
  try{
   const rows=await env.DB.prepare(`SELECT DISTINCT category FROM servers WHERE COALESCE(json_extract(details_json, '$.review.status'), 'published') NOT IN ('pending-publication', 'test-only') ORDER BY category COLLATE NOCASE`).all();
   return json({categories:rows.results.map(row=>row.category)});
  }catch(e){console.error('Registry categories failed',e);return json({error:'Registry categories failed'},500);}
 }
 const q=(url.searchParams.get('q')||'').trim().slice(0,120);
 const category=(url.searchParams.get('category')||'').trim().slice(0,100);
 const sort=url.searchParams.get('sort')==='category'?'category':'name';
 const page=Math.min(10000,Math.max(1,Number.parseInt(url.searchParams.get('page')||'1',10)||1));
 const size=24, conditions=["COALESCE(json_extract(details_json, '$.review.status'), 'published') NOT IN ('pending-publication', 'test-only')"], bindings=[];
 if(category){conditions.push('category = ?');bindings.push(category);}
 if(q){
  // FTS5 tokens are escaped as quoted phrases; no raw user-supplied FTS operators.
  const tokens=q.match(/[\p{L}\p{N}]+/gu)?.slice(0,8)||[];
  if(!tokens.length)return json({servers:[],total:0,page,pages:1,pageSize:size});
  conditions.push('id IN (SELECT id FROM servers_search WHERE servers_search MATCH ?)');
  bindings.push(tokens.map(t=>'"'+t.replaceAll('"','""')+'"*').join(' AND '));
 }
 const where=conditions.length?' WHERE '+conditions.join(' AND '):'';
 try {
  const count=await env.DB.prepare('SELECT COUNT(*) AS total FROM servers'+where).bind(...bindings).first();
  const total=count?.total||0,pages=Math.max(1,Math.ceil(total/size)),current=Math.min(page,pages);
  const order=sort==='category'?'category COLLATE NOCASE, name COLLATE NOCASE, id':'name COLLATE NOCASE, id';
  const data=await env.DB.prepare('SELECT id,name,description,category,author,tags_json,json_extract(details_json, \'$.lifecycle\') AS lifecycle FROM servers'+where+' ORDER BY '+order+' LIMIT ? OFFSET ?').bind(...bindings,size,(current-1)*size).all();
  return json({servers:data.results.map(s=>({id:s.id,name:s.name,description:s.description,category:s.category,author:s.author,tags:JSON.parse(s.tags_json),lifecycle:s.lifecycle||null})),total,page:current,pages,pageSize:size});
 }catch(e){console.error('Registry query failed',e);return json({error:'Registry query failed'},500);}
}
