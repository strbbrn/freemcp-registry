const {CLOUDFLARE_API_TOKEN:cfToken,CLOUDFLARE_ACCOUNT_ID:account,GITHUB_TOKEN:ghToken}=process.env;
if(!cfToken||!account||!ghToken)throw Error('Missing Cloudflare or GitHub credentials');
const database='21a0f980-a749-4c69-b1b5-3d57d3a646c8';
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
async function d1(sql){
 const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+'/d1/database/'+database+'/query',{method:'POST',headers:{Authorization:'Bearer '+cfToken,'Content-Type':'application/json'},body:JSON.stringify({sql})});
 const body=await response.json();
 if(!response.ok||!body.success||body.result?.[0]?.success===false)throw Error('D1 query failed: '+JSON.stringify(body.errors||body));
 return body.result?.[0]?.results||[];
}
const rows=await d1('SELECT id,github_url FROM servers');
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
  const inactive=data.archived===true||data.disabled===true;
  if(inactive)archived++;
  // Keep updated_at unchanged so metadata refresh does not reorder recent listings.
  updates.push('UPDATE servers SET stars='+data.stargazers_count+
   ", details_json=json_set(CASE WHEN json_valid(details_json) THEN details_json ELSE '{}' END, '$.lifecycle', "+quote(inactive?'archived':'active')+
   ", '$.githubMetadata.checkedAt', "+quote(new Date().toISOString())+
   ", '$.githubMetadata.archived', "+(data.archived===true?1:0)+
   ", '$.githubMetadata.disabled', "+(data.disabled===true?1:0)+
   ") WHERE id="+quote(row.id));
 }catch(error){skipped++;console.warn('Skipped '+row.id+': '+error.message);}
}
if(!updates.length)throw Error('No repositories verified; refusing empty sync');
for(const sql of updates)await d1(sql);
console.log(JSON.stringify({total:rows.length,updated:updates.length,archived,skipped,uniqueRepositories:cache.size}));
