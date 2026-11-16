import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const html=(path)=>readFileSync(path,'utf8');
const page=(route)=>{const nested=join('dist',route,'index.html');const flat=join('dist',route+'.html');return html(existsSync(nested)?nested:flat);};
const servers=readdirSync('src/data/servers').filter(x=>x.endsWith('.json')).map(x=>JSON.parse(readFileSync(join('src/data/servers',x),'utf8')));
test('Every registry listing generates a server detail page',()=>{
  for(const server of servers){const output=page('servers/'+server.id);assert.ok(output.includes(server.name),server.id);assert.match(output,/id="main-content"/);}
});
test('Homepage links to dedicated directory and preview retains the registry',()=>{
  const home=page('');const directory=page('servers');const preview=page('v2-preview');
  assert.match(home,/href="\/servers"/);
  assert.match(directory,/registry-query/);
  assert.match(directory,/registry-category/);
  assert.match(directory,/registry-sort/);
  assert.match(directory,/next-page/);
  for(const server of servers){assert.ok(!directory.includes(server.description),'directory embeds server data '+server.id);assert.ok(preview.includes(server.name),'preview missing '+server.id);}
  assert.match(directory,/\/api\/servers/);
});
test('Submission and detail pages have navigation and accessible form controls',()=>{
  const submit=page('submit');const detail=page('servers/'+servers[0].id);
  for(const output of [submit,detail]){assert.match(output,/<main\b/);assert.match(output,/href="#main-content"/);assert.match(output,/aria-label="Main navigation"/);}
  for(const field of ['repository','name','description','docs','installation','permissions'])assert.ok(submit.includes('name="'+field+'"'),'missing field '+field);
  assert.match(submit,/role="alert"/);
  assert.match(submit,/aria-live="polite"/);
});
