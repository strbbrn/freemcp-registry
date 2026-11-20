import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareRegistration,sqlQuote} from '../src/lib/registration.mjs';
const manifest={schemaVersion:1,name:"Test's Server",description:'A useful MCP server',repository:'https://github.com/example/mcp-test',category:'Development',transport:'stdio',installation:{command:'npx',args:['-y','example-mcp']}};
test('Generate SQL candidate without executing database writes',()=>{
 const result=prepareRegistration(manifest,42);
 assert.equal(result.id,'example-mcp-test');
 assert.match(result.sql,/Test''s Server/);
 assert.match(result.sql,/REVIEW REQUIRED/);
 assert.match(result.sql,/INSERT INTO servers/);
 assert.match(result.sql,/WHERE NOT EXISTS/);
 assert.match(result.sql,/lower\\(github_url\\)/);
 assert.equal(result.details.review.status,'pending-publication');
});
test('Reject missing installation, invalid manifest and ID collision',()=>{
 assert.throws(()=>prepareRegistration({...manifest,installation:undefined},42),/Installation instructions required/);
 assert.throws(()=>prepareRegistration(manifest,42,['example-mcp-test']),/already exists/);
 assert.throws(()=>prepareRegistration({...manifest,repository:'http:\/\/invalid.test'},42),/Invalid manifest/);
 assert.throws(()=>prepareRegistration(manifest,0),/issue number/);
});
test('Escape SQL literal values',()=>assert.equal(sqlQuote("O'Reilly"),"'O''Reilly'"));
