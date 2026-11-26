import { registryLifecycle } from '../lib/lifecycle.js';

const {CLOUDFLARE_API_TOKEN:cfToken,CLOUDFLARE_ACCOUNT_ID:account,GITHUB_TOKEN:ghToken}=process.env;
if(!cfToken||!account||!ghToken)throw Error('Missing Cloudflare or GitHub credentials');
const database=process.env.D1_DATABASE_ID;
if(!['21a0f980-a749-4c69-b1b5-3d57d3a646c8','1d3540c0-d836-4f8e-b048-fd22d780b46b'].includes(database))throw Error('Unrecognized D1 database ID');
async function d1(sql,params=[]){
 const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+'/d1/database/'+database+'/query',{method:'POST',headers:{Authorization:'Bearer '+cfToken,'Content-Type':'application/json'},body:JSON.stringify({sql,params})});
 const body=await response.json();
 if(!response.ok||!body.success||body.result?.[0]?.success===false)throw Error('D1 query failed: '+JSON.stringify(body.errors||body));
 return body.result?.[0]?.results||[];
}
const rows=await d1(`SELECT id,github_url,details_json FROM servers WHERE CASE WHEN json_valid(details_json) THEN json_type(details_json) = 'object' ELSE 0 END`);
const cache=new Map(),updates=[];
let skipped=0,archived=0;
for(const row of rows){
 try{
  const url=new URL(row.github_url),parts=url.pathname.split('/').filter(Boolean);
  if(url.hostname!=='github.com'||parts.length<2)throw Error('Not a GitHub repository');
  const key=parts.slice(0,2).join('/').toLowerCase();
  if(!cache.has(key)){
   const response=await fetch('https://api.github.com/repos/'+parts.slice(0,2).map(encodeURIComponent).join('/'),{headers:{Authorization:'Bearer '+ghToken,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'freemcp-metadata-sync'}});
   if(!response.ok)throw Error('GitHub HTTP '+response.status);
   cache.set(key,await response.json());
  }
  const data=cache.get(key);
  if(!Number.isSafeInteger(data.stargazers_count)||data.stargazers_count<0)throw Error('Invalid GitHub stars');
  if(typeof data.archived!=='boolean'||typeof data.disabled!=='boolean')throw Error('Invalid GitHub repository status');
  const inactive=data.archived||data.disabled;
  if(inactive)archived++;
  const details=JSON.parse(row.details_json);
  // Preserve explicit classifications and remember the provenance of old mirrors
  // before replacing the flags from which their provenance was inferred.
  const source = typeof details.lifecycle === 'string' && !['registry','github'].includes(details.lifecycleSource)
   ? (registryLifecycle(details) === null ? 'github' : 'registry') : null;
  // Keep updated_at unchanged. Skip a row if its metadata changed during the fetch.
  const currentDetails = source ? "json_set(details_json, '$.lifecycleSource', ?)" : 'details_json';
  updates.push({
   sql: `UPDATE servers SET stars = ?, details_json = json_set(${currentDetails},
    '$.githubMetadata.checkedAt', ?, '$.githubMetadata.archived', ?, '$.githubMetadata.disabled', ?)
    WHERE id = ? AND details_json = ? RETURNING id`,
   params: [data.stargazers_count, ...(source ? [source] : []), new Date().toISOString(),
    Number(data.archived), Number(data.disabled), row.id, row.details_json],
  });
 }catch(error){skipped++;console.warn('Skipped '+row.id+': '+error.message);}
}
if(!updates.length)throw Error('No repositories verified; refusing empty sync');
let updated=0;
for(const {sql,params} of updates)updated+=(await d1(sql,params)).length;
console.log(JSON.stringify({total:rows.length,updated,archived,skipped,concurrentChanges:updates.length-updated,uniqueRepositories:cache.size}));
