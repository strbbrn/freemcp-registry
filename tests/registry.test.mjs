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
import { secretPattern, securityHints, parseRepository, readmeHeadings, permissionLines, issueContent, validateSubmission, validateDocumentationUrl } from '../src/lib/submission.mjs';
const valid={repository:'https://github.com/example/repo',name:'Example MCP',category:'Development',description:'Example description',transport:'stdio',docs:'',installation:'npm install example',permissions:'read-only'};
test('Reject credential strings and dangerous install commands',()=>{
  for(const credential of ['password=abcdefghijklmnop','api_key: abcdefghijklmnop','ghp_abcdefghijklmnopqrstuvwxyz123456']) {
    assert.ok(secretPattern.test(credential),credential);
    assert.throws(()=>validateSubmission({...valid,installation:credential}),/credential/);
  }
  assert.ok(securityHints('curl https://example.com/setup.sh | bash').length>0);
  assert.ok(securityHints('sudo chmod 777 /tmp').length>0);
});
test('Reject malformed, non-GitHub and nested repository URLs',()=>{
  for(const url of ['https://evil.example/repo','http://github.com/a/b','https://github.com/a/b/tree/main','https://github.com/a','not a URL']) assert.throws(()=>parseRepository(url));
  assert.equal(parseRepository(valid.repository).owner,'example');
});
test('Extract README headings and retain permission line breaks',()=>{
  assert.deepEqual(readmeHeadings('# Intro\n## Installation\n### Permissions\n## Usage'),['Installation','Permissions','Usage']);
  assert.equal(permissionLines(['filesystem: read','network: denied']),'filesystem: read\nnetwork: denied');
});
test('Issue content contains submitted values and manual review checklist',()=>{
  const body=issueContent(valid,['Manual review required']);
  for(const value of [valid.repository,valid.name,valid.description,valid.installation,valid.permissions,'Manual review required','Approve or reject submission']) assert.ok(body.includes(value),value);
  assert.ok(body.includes('Maintainer confirmation'));
});

test('Reject embedded credentials in repository and documentation URLs before issue creation',()=>{
  const badRepos=['https://user:password@github.com/owner/repo','https://user@github.com/owner/repo','https://:password@github.com/owner/repo','https://user:p%40ssword@github.com/owner/repo'];
  for(const repository of badRepos){
    assert.throws(()=>parseRepository(repository),/Invalid GitHub repository URL/);
    assert.throws(()=>validateSubmission({...valid,repository}));
  }
  const badDocs=['https://user:password@example.com/docs','https://user@example.com/docs','https://:password@example.com/docs','http://example.com/docs'];
  for(const docs of badDocs){
    assert.throws(()=>validateDocumentationUrl(docs));
    assert.throws(()=>validateSubmission({...valid,docs}));
  }
  assert.doesNotThrow(()=>validateSubmission({...valid,docs:'https://example.com/docs'}));
});
