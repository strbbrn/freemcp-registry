import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
const folder=new URL('../src/data/servers/',import.meta.url);
const escape=value=>"'"+String(value).replaceAll("'","''")+"'";
const rows=readdirSync(folder).filter(x=>x.endsWith('.json')).map(name=>JSON.parse(readFileSync(new URL(name,folder),'utf8')));
const sql=['-- Generated from version-controlled server records; re-run after metadata changes.','BEGIN TRANSACTION;'];
for(const s of rows){
 const values=[s.id,s.name,s.description,s.category,s.author,JSON.stringify(s.tags),s.githubUrl,s.stars||0,JSON.stringify(s.details||{})];
 sql.push('INSERT INTO servers (id,name,description,category,author,tags_json,github_url,stars,details_json) VALUES ('+values.map((v,i)=>i===7?Number(v):escape(v)).join(',')+') ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,category=excluded.category,author=excluded.author,tags_json=excluded.tags_json,github_url=excluded.github_url,stars=excluded.stars,details_json=excluded.details_json;');
}
sql.push('COMMIT;');
mkdirSync(new URL('../seed/',import.meta.url),{recursive:true});
writeFileSync(new URL('../seed/servers.sql',import.meta.url),sql.join('\n')+'\n');
console.log('Generated seed SQL for '+rows.length+' servers');
