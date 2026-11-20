// Refresh repository star counts in the preview D1 registry without touching production.
// Usage: node scripts/sync-github-metadata.mjs --output seed/github-metadata.sql
// Set GITHUB_TOKEN for authenticated API requests (recommended for rate limits).
import {readdirSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
const folder=new URL('../src/data/servers/',import.meta.url);
const records=readdirSync(folder).filter(x=>x.endsWith('.json')).map(x=>JSON.parse(readFileSync(new URL(x,folder),'utf8')));
const outIndex=process.argv.indexOf('--output');
if(outIndex<0||!process.argv[outIndex+1])throw new Error('Pass --output <sql-file>');
const output=resolve(process.argv[outIndex+1]);
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
const statements=['-- GitHub metadata refresh; generated for preview D1 only.','BEGIN TRANSACTION;'];
let updated=0,skipped=0;
const cache=new Map();
for(const record of records){
 try{
  const url=new URL(record.githubUrl);
  const parts=url.pathname.split('/').filter(Boolean);
  if(url.hostname!=='github.com'||parts.length<2)throw new Error('Not a GitHub repository');
  const key=parts.slice(0,2).join('/');
  if(!cache.has(key)){
   const headers={'Accept':'application/vnd.github+json','User-Agent':'freemcp-registry-sync','X-GitHub-Api-Version':'2022-11-28'};
   if(process.env.GITHUB_TOKEN)headers.Authorization='Bearer '+process.env.GITHUB_TOKEN;
   const response=await fetch('https://api.github.com/repos/'+parts.slice(0,2).map(encodeURIComponent).join('/'),{headers});
   if(!response.ok)throw new Error('GitHub HTTP '+response.status+' for '+key);
   cache.set(key,await response.json());
  }
  const data=cache.get(key);
  if(!Number.isSafeInteger(data.stargazers_count)||data.stargazers_count<0)throw new Error('Invalid star count');
  statements.push('UPDATE servers SET stars='+data.stargazers_count+', updated_at=CURRENT_TIMESTAMP WHERE id='+quote(record.id)+';');
  updated++;
 }catch(error){console.warn('Skipping '+record.id+': '+error.message);skipped++;}
}
statements.push('COMMIT;');
if(updated===0)throw new Error('No GitHub metadata could be fetched; refusing to write empty sync');
mkdirSync(dirname(output),{recursive:true});
writeFileSync(output,statements.join('\n')+'\n');
console.log(JSON.stringify({updated,skipped,uniqueRepositories:cache.size,output}));
