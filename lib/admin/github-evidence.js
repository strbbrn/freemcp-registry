import { AdminError } from './http.js';
import { github, project, waitMessage } from './github.js';

const origin='https://api.github.com';
const seconds=()=>Math.floor(Date.now()/1000);
const mutableTtl=300;
const cacheRetention=30*86400;
const leaseSeconds=14;
const state = (db,scope)=>db.prepare('SELECT * FROM admin_github_rate WHERE scope=?').bind(scope).first();

export function evidencePath(path) {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid evidence endpoint');
  const url=new URL(path,origin);
  const query=[...url.searchParams];
  const issues=url.pathname===project+'/issues';
  const discussion=url.pathname.startsWith(project+'/')&&/^issues\/[1-9]\d*\/comments$/.test(url.pathname.slice(project.length+1));
  const issue=url.pathname.startsWith(project+'/')&&/^issues\/[1-9]\d*$/.test(url.pathname.slice(project.length+1));
  const pageQuery=query.length<=(issues?3:2)&&new Set(query.map(([key])=>key)).size===query.length&&query.every(([key,value])=>
    (key==='page'&&/^[1-9]\d{0,3}$/.test(value))||(key==='per_page'&&/^[1-9]\d?$|^100$/.test(value))||(issues&&key==='state'&&['all','open','closed'].includes(value)));
  const upstream=url.pathname.match(/^\/repos\/[\w.-]+\/[\w.-]+(?:\/(commits\/[\w.%+-]+|readme))?$/)?.[1];
  const root=/^\/repos\/[\w.-]+\/[\w.-]+$/.test(url.pathname);
  const pinned=upstream==='readme'&&query.length===1&&query[0][0]==='ref'&&/^[a-f0-9]{40}$/i.test(query[0][1]);
  if (url.origin!==origin||url.hash||url.pathname!==path.split('?')[0]||
      !(((issues||discussion)&&pageQuery)||(issue&&!query.length)||((root||upstream?.startsWith('commits/'))&&!query.length)||pinned)) {
    throw new Error('Invalid evidence endpoint');
  }
  return {path:url.pathname+url.search,immutable:pinned};
}

const bounded = body=>JSON.stringify(body.data===undefined?null:{data:body.data,next:body.next});
const mark = (db,scope,sql)=>db.prepare('UPDATE admin_github_rate SET '+sql+' WHERE scope=?').bind(scope).run();
const lookup = (db,scope,key)=>db.prepare('SELECT * FROM admin_github_cache WHERE scope=? AND path=?').bind(scope,key).first();
function cacheUnavailable(error) {
  if (/no such table.*admin_github_(?:cache|rate)/i.test(String(error?.message))) {
    return new AdminError(503,'GitHub evidence cache is unavailable. Apply the admin cache migration. Saved drafts are still available.');
  }
  return error;
}

export async function githubEvidence(config,token,path,{fresh=false,refresh=false,optional=false,projectData=value=>value,projection}={}) {
  const route=evidencePath(path);
  // One stable quota scope per database/environment, independent of secret rotation.
  const {db,mode:scope}=config;
  const key=(projection?projection+':':route.immutable?'commit:':'mutable:')+route.path;
  try { return await read(db,scope,key,route,{token,fresh,refresh,optional,projectData}); }
  catch(error) { throw cacheUnavailable(error); }
}
async function read(db,scope,key,route,{token,fresh,refresh,optional,projectData}) {
  const now=seconds();
  await db.prepare('INSERT INTO admin_github_rate(scope) VALUES(?) ON CONFLICT DO NOTHING').bind(scope).run();
  const cached=await lookup(db,scope,key);
  const hasCache=Boolean(cached?.payload);
  const result=(row,stale)=>({...JSON.parse(row.payload),checkedAt:row.checked_at,stale,cached:true});
  if (!fresh && hasCache && (route.immutable || !refresh && now-cached.checked_at<mutableTtl)) {
    await mark(db,scope,'cache_hits=cache_hits+1');
    return result(cached,false);
  }
  const unavailable=async error=>{
    if (!fresh&&hasCache) {
      await mark(db,scope,'stale_hits=stale_hits+1');
      return {...result(cached,true),warning:error.message};
    }
    throw error;
  };
  const limited=until=>{
    const error=new AdminError(503,waitMessage(until*1000)+' Saved drafts can still be edited.');
    error.retryAt=until;
    return error;
  };
  const rate=await state(db,scope);
  if (rate.blocked_until>now) return unavailable(limited(rate.blocked_until));
  const lease=now+leaseSeconds;
  const acquired=await db.prepare(`INSERT INTO admin_github_cache(scope,path,lease_until) VALUES(?,?,?)
    ON CONFLICT(scope,path) DO UPDATE SET lease_until=excluded.lease_until
    WHERE admin_github_cache.lease_until<=? AND (?=1 OR admin_github_cache.checked_at<=?) RETURNING lease_until`)
    .bind(scope,key,lease,now,fresh||refresh?1:0,now-mutableTtl).first();
  if (!acquired) {
    const updated=await lookup(db,scope,key);
    if (!fresh&&updated?.payload&&now-updated.checked_at<mutableTtl) return result(updated,false);
    return unavailable(new AdminError(503,'GitHub evidence is already refreshing. Retry shortly.'));
  }

  let probe=false;
  try {
    // When a cooldown expires, one isolate probes GitHub before the quota reopens.
    const ready=await db.prepare(`UPDATE admin_github_rate SET probe_until=CASE WHEN blocked_until>0 THEN ? ELSE 0 END
      WHERE scope=? AND blocked_until<=? AND probe_until<=? RETURNING blocked_until`).bind(lease,scope,now,now).first();
    if (!ready) {
      const current=await state(db,scope);
      return unavailable(limited(Math.max(current.blocked_until,current.probe_until)));
    }
    probe=ready.blocked_until>0;
    const etag=cached?.etag??undefined;
    await mark(db,scope,'requests=requests+1'+(etag?',conditional_requests=conditional_requests+1':''));
    const value=await github(route.path,{authorization:token,etag,optional});
    const checkedAt=seconds();
    if (value.notModified&&!hasCache) throw new AdminError(502,'GitHub did not return usable evidence.');
    const payload=value.notModified?cached.payload:bounded({...value,data:projectData(value.data)});
    if (payload.length<=180000) {
      await db.prepare(`UPDATE admin_github_cache SET payload=?,etag=?,checked_at=? WHERE scope=? AND path=? AND lease_until=?`)
        .bind(payload,value.etag,checkedAt,scope,key,lease).run();
    }
    if (value.notModified) await mark(db,scope,'not_modified=not_modified+1');
    if (probe) await db.prepare('UPDATE admin_github_rate SET blocked_until=0,probe_until=0 WHERE scope=? AND probe_until=?')
      .bind(scope,lease).run();
    if (rate.requests % 64===0) await db.prepare('DELETE FROM admin_github_cache WHERE scope=? AND checked_at<? AND lease_until=0')
      .bind(scope,now-cacheRetention).run();
    return {...JSON.parse(payload),checkedAt,stale:false,cached:Boolean(value.notModified)};
  } catch(error) {
    if (error.githubRateLimited) {
      await db.prepare(`UPDATE admin_github_rate SET blocked_until=max(blocked_until,?),probe_until=0,rate_limited=rate_limited+1 WHERE scope=?`)
        .bind(error.retryAt,scope).run();
      return unavailable(limited(error.retryAt));
    }
    return unavailable(error instanceof AdminError?error:new AdminError(503,'GitHub evidence could not be refreshed. Retry shortly.'));
  } finally {
    await db.prepare('UPDATE admin_github_cache SET lease_until=0 WHERE scope=? AND path=? AND lease_until=?').bind(scope,key,lease).run();
  }
}

export async function githubEvidenceMetrics(config) {
  try {
    const row=await state(config.db,config.mode);
    return row&&{requests:row.requests,cacheHits:row.cache_hits,staleHits:row.stale_hits,conditional:row.conditional_requests,
      notModified:row.not_modified,rateLimited:row.rate_limited,retryAt:row.blocked_until};
  } catch(error) {
    if (cacheUnavailable(error) instanceof AdminError) return null;
    throw error;
  }
}

export async function cachedGithubEvidence(config,path) {
  const route=evidencePath(path);
  try {
    const row=await lookup(config.db,config.mode,(route.immutable?'commit:':'mutable:')+route.path);
    if (row?.payload) return {...JSON.parse(row.payload),checkedAt:row.checked_at,cached:true,
      stale:!route.immutable&&seconds()-row.checked_at>=mutableTtl};
  } catch(error) { throw cacheUnavailable(error); }
  throw new AdminError(503,'No cached GitHub evidence is available yet. Open the review and refresh its evidence.');
}
