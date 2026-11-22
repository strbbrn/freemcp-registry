const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':status===200?'public, max-age=60':'no-store'}});
export async function onRequestGet({request,env}){
 if(!env.DB)return respond({ads:[]});
 const placement=new URL(request.url).searchParams.get('placement')||'home';
 if(!['home','directory','detail'].includes(placement))return respond({error:'Invalid placement'},400);
 try{
  const {results}=await env.DB.prepare(`SELECT id,eyebrow,headline,description,cta_text,target_url,theme,weight,rotation_seconds
   FROM promotions WHERE placement=? AND status='active'
   AND (starts_at IS NULL OR datetime(starts_at)<=datetime('now'))
   AND (ends_at IS NULL OR datetime(ends_at)>datetime('now'))
   ORDER BY id LIMIT 30`).bind(placement).all();
  return respond({ads:results.filter(a=>/^https:\/\/[a-z0-9.-]+(?:\/|$)/i.test(a.target_url))});
 }catch(e){console.error('Promotions unavailable',e);return respond({ads:[]});}
}
