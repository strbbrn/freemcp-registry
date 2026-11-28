import { AdminError, body } from '../../lib/admin/http.js';
import { publishedCollision } from '../../lib/admin/duplicates.js';
import { isSlug } from '../../lib/registry.js';
import { object } from '../../lib/admin/validation.js';
import { canonicalRepository, submissionUrl } from '../../src/lib/submission-candidate.mjs';

// Best-effort per-isolate guard. It stores only a bounded table of short-lived
// request counters and never persists a draft, endpoint or repository.
const quotas=new Map();
const bodyLimit=12*1024;
const endpointLimit=12;
function allow(address,now=Date.now()) {
  for (const [key,quota] of quotas) if (quota.expires<=now) quotas.delete(key);
  const prior=quotas.get(address);
  if (prior) return ++prior.count<=10;
  if (quotas.size>=1024) return false;
  quotas.set(address,{count:1,expires:now+60000});
  return true;
}
const json=(data,status=200)=>Response.json(data,{status,headers:{
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex',
  ...(status===429?{'Retry-After':'60'}:{}),
}});
export async function onRequest({request,env}) {
  if (request.method!=='POST') return new Response(null,{status:405,headers:{Allow:'POST'}});
  if (request.headers.get('Origin')!==new URL(request.url).origin) return json({error:'Request must come from FreeMCP.'},403);
  if (!allow(request.headers.get('CF-Connecting-IP')??'local')) return json({error:'Try again in one minute.'},429);
  if (!env.DB) return json({error:'Duplicate check unavailable.'},503);
  let row;
  try {
    if (request.headers.get('Content-Type')?.split(';')[0]?.toLowerCase()!=='application/json') {
      return json({error:'Send a JSON object.'},415);
    }
    const input=await body(request,{max:bodyLimit});
    if (!object(input)||Object.keys(input).some(key=>!['repository','implementationKey','endpoints'].includes(key))||
        typeof input.implementationKey!=='string'||input.implementationKey.length>100||
        (input.implementationKey&&!isSlug(input.implementationKey))||!Array.isArray(input.endpoints)||input.endpoints.length>endpointLimit) throw Error();
    const endpoints=[...new Set(input.endpoints.map(value=>submissionUrl(value,'endpoint')))].map(url=>({url}));
    row={id:'',github_url:canonicalRepository(input.repository),
      details_json:JSON.stringify({implementationKey:input.implementationKey,endpoints})};
  } catch(error) {
    if (error instanceof AdminError&&error.status===413) return json({error:'Duplicate check exceeds the request limit.'},413);
    return json({error:'Invalid duplicate check.'},400);
  }
  try { return json({match:Boolean(await publishedCollision(env.DB,row))}); }
  catch { return json({error:'Duplicate check unavailable.'},503); }
}
