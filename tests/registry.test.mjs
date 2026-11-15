import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const directory = 'src/data/servers';
const records = readdirSync(directory).filter(name => name.endsWith('.json')).map(name => ({filename:name,server:JSON.parse(readFileSync(join(directory,name),'utf8'))}));
test('Every server has a valid, unique ID and matching filename', () => {
  const ids = new Set();
  for (const {filename,server} of records) {
    assert.match(server.id,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(filename,server.id+'.json');
    assert.ok(!ids.has(server.id),'duplicate ID '+server.id);
    ids.add(server.id);
  }
});
test('Every listing has valid required metadata', () => {
  for (const {server:s} of records) {
    for (const key of ['name','description','category','author']) assert.ok(typeof s[key]==='string'&&s[key].trim(),s.id+': '+key);
    const url = new URL(s.githubUrl);
    assert.equal(url.protocol,'https:');
    assert.equal(url.hostname,'github.com');
    assert.ok(Array.isArray(s.tags)&&s.tags.every(t=>typeof t==='string'));
    assert.ok(typeof s.stars==='number'&&Number.isFinite(s.stars)&&s.stars>=0);
    assert.equal(typeof s.featured,'boolean');
  }
});
test('All original public detail-page slugs are preserved', () => {
  const baseline=JSON.parse(readFileSync('src/data/registry.json','utf8'));
  const current=new Set(records.map(x=>x.server.id));
  for (const item of baseline) assert.ok(current.has(item.id),'missing /servers/'+item.id);
});
test('The submission form opens a review issue, not an automatic publication', () => {
  const page=readFileSync('src/pages/submit.astro','utf8');
  assert.match(page,/issues\/new\?/);
  assert.match(page,/securityHints/);
  assert.match(page,/secretPattern/);
  assert.match(page,/Maintainer confirmation/);
  assert.doesNotMatch(page,/fetch\(['"]\/api\/publish/);
});
