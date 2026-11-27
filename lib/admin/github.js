import { AdminError } from './http.js';
import { base64url } from './crypto.js';

export const project = '/repos/strbbrn/freemcp-registry';
const api = 'https://api.github.com';
export const waitMessage = until => 'GitHub’s API rate limit was reached. Retry in about '+Math.max(1,Math.ceil((until-Date.now())/60000))+' minute(s).';
export async function github(path, { authorization, method = 'GET', data, optional = false, etag } = {}) {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid GitHub path');
  let response;
  try {
    response=await fetch(api+path,{
      method, redirect:'manual', signal:AbortSignal.timeout(8000),
      headers:{ Accept:'application/vnd.github+json', 'User-Agent':'FreeMCP-Admin', 'X-GitHub-Api-Version':'2022-11-28',
        ...(etag ? { 'If-None-Match':etag } : {}),
        ...(authorization ? { Authorization:'Bearer '+authorization } : {}),
        ...(data ? { 'Content-Type':'application/json' } : {}) },
      ...(data ? {body:JSON.stringify(data)} : {}),
    });
  } catch {
    throw new AdminError(502,'Could not reach GitHub. Retry shortly.');
  }
  const validator=response.headers.get('ETag');
  if (response.status===304 && etag) return {notModified:true,etag:validator??etag};
  if (optional && response.status === 404) return { data:null, next:false,etag:validator };
  const retryAfter=response.headers.get('Retry-After'), remaining=response.headers.get('X-RateLimit-Remaining');
  if (response.status===429 || (response.status===403 && (retryAfter||remaining==='0'))) {
    const now=Date.now();
    const wait=(retryAfter&&(Number.isFinite(Number(retryAfter))?Number(retryAfter)*1000:Date.parse(retryAfter)-now)) || (Number(response.headers.get('X-RateLimit-Reset'))*1000-now);
    const until=now+Math.max(1000,wait>0?wait:60000);
    const error=new AdminError(503,waitMessage(until));
    error.retryAt=Math.ceil(until/1000);
    error.githubRateLimited=true;
    throw error;
  }
  if (!response.ok) throw new AdminError(502, 'GitHub returned HTTP ' + response.status + '.');
  return {data:response.status===204?null:await response.json(),next:/rel="next"/.test(response.headers.get('Link')||''),etag:validator};
}

export function projectRead(path,token,optional=false) {
  const url=new URL(path,api);
  if (url.origin!==api || !url.pathname.startsWith(project+'/') ||
      !/^issues(?:\/[1-9]\d*(?:\/comments)?)?$/.test(url.pathname.slice(project.length+1))) throw new Error('Invalid GitHub issue path');
  return github(path,{authorization:token,optional});
}

export function appEnabled(config, env) {
  return config.mode === 'production' && env.ADMIN_GITHUB_SYNC === 'enabled' &&
    /^\d+$/.test(env.ADMIN_GITHUB_APP_ID || '') && /^\d+$/.test(env.ADMIN_GITHUB_INSTALLATION_ID || '') &&
    typeof env.ADMIN_GITHUB_APP_PRIVATE_KEY === 'string';
}
async function installationCredential(env) {
  const secret = env.ADMIN_GITHUB_APP_PRIVATE_KEY.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(secret),char=>char.charCodeAt(0)),
    {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const now = Math.floor(Date.now()/1000);
  const encode = object => base64url(new TextEncoder().encode(JSON.stringify(object)));
  const unsigned = encode({alg:'RS256',typ:'JWT'}) + '.' + encode({iat:now-30,exp:now+540,iss:env.ADMIN_GITHUB_APP_ID});
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(unsigned)));
  const jwt = unsigned + '.' + base64url(signature);
  const {data: app} = await github('/app',{authorization:jwt});
  const {data} = await github('/app/installations/'+env.ADMIN_GITHUB_INSTALLATION_ID+'/access_tokens',{
    authorization:jwt,method:'POST',data:{repositories:['freemcp-registry'],permissions:{issues:'write'}},
  });
  if (!data?.token || !/^[\w-]+$/.test(app?.slug || '')) throw new Error('Invalid installation response');
  return { authorization:data.token, bot:app.slug+'[bot]' };
}

export async function deliverIssueUpdate(env, item, current=async()=>true) {
  const { authorization,bot } = await installationCredential(env);
  const path = project+'/issues/'+item.issue_number;
  const marker = '<!-- freemcp-admin:' + item.id + ' -->';
  const mutate = async (target,inputs) => {
    if (!await current()) throw new AdminError(409,'This GitHub decision was superseded.');
    return github(target,{authorization,...inputs});
  };
  let found = false, page = 1;
  for (;;) {
    const {data,next} = await github(path+'/comments?per_page=100&page='+page,{authorization});
    if (data.some(entry=>entry.user?.login===bot && entry.body?.includes(marker))) { found=true; break; }
    if (!next) break;
    if (++page>40) throw new Error('Comment pagination limit reached');
  }
  if (!found) {
    const headings = { clarification:'FreeMCP needs clarification', rejected:'FreeMCP submission decision', published:'FreeMCP listing published' };
    const message = item.message.replace(/[@<>]/g,'');
    await mutate(path+'/comments',{method:'POST',data:{body:marker+'\n### '+headings[item.action]+'\n\n'+message}});
  }
  const labels = { clarification:'freemcp-needs-clarification',rejected:'freemcp-rejected',published:'freemcp-published' };
  const label = labels[item.action];
  await mutate(path+'/labels',{method:'POST',data:{labels:[label]}});
  for (const obsolete of Object.values(labels).filter(name=>name!==label)) {
    await mutate(path+'/labels/'+obsolete,{method:'DELETE',optional:true});
  }
  if (item.action !== 'clarification') await mutate(path,{method:'PATCH',data:{
    state:'closed',state_reason:item.action==='published'?'completed':'not_planned',
  }});
}
