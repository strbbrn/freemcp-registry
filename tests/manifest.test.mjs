import test from 'node:test';
import assert from 'node:assert/strict';
import schema from '../schemas/freemcp-v1.schema.json' with { type: 'json' };
import { validateManifest } from '../src/lib/manifest.mjs';

const base={schemaVersion:1,name:'Example',description:'Example server',repository:'https://github.com/example/server',category:'Development',transport:'stdio',installation:{command:'npx',args:['-y','example']}};
const check=(v,expected=base.repository)=>validateManifest(v,expected);
test('v1 schema declares required fields and strict object definitions',()=>{
 assert.equal(schema.additionalProperties,false);
 assert.deepEqual(schema.required,['schemaVersion','name','description','repository','category','transport']);
 assert.equal(schema.properties.installation.oneOf.length,2);
 assert.equal(schema.$defs.env.additionalProperties.additionalProperties,false);
 assert.match(base.repository,new RegExp(schema.properties.repository.pattern));
});
test('valid stdio and remote HTTP manifests',()=>{
 assert.equal(check(base).valid,true);
 assert.equal(check({...base,installation:{...base.installation,env:{API_KEY:{required:true,secret:true,description:'User-provided key'}}},tools:[{name:'search',description:'Search records'}],permissions:['Read records']}).valid,true);
 assert.equal(check({...base,transport:'http',installation:{endpoint:'https://mcp.example.com/mcp'}}).valid,true);
 assert.equal(check({...base,transport:'sse',installation:{endpoint:'https://mcp.example.com/sse'}}).valid,true);
 assert.equal(check({...base,transport:'unknown',installation:undefined}).valid,true);
 assert.equal(check({...base,repository:'https://github.com/Example/Server/'},base.repository).valid,true);
});
test('reject invalid structures and incompatible transports',()=>{
 const invalid=[
 {...base,schemaVersion:2},{...base,extra:true},{...base,category:'Hacking'},
 {...base,transport:'http'},{...base,installation:{command:'npx',args:[],endpoint:'https://example.com'}},
 {...base,installation:{endpoint:'https://example.com'}},
 {...base,transport:'http',installation:{endpoint:'http://example.com'}},
 {...base,tools:[{name:'x'}]},{...base,permissions:['']},
 {...base,installation:{...base.installation,env:{TOKEN:{required:true,secret:true,description:'x',value:'secret'}}}},
 {...base,installation:{command:'npx',args:['abc'],env:{'BAD-KEY':{required:true,secret:true,description:'x'}}}},
 {...base,description:'password=abcdefghijklmnop'},
 {...base,repository:'https://github.com/other/repo'}
 ];
 for(const item of invalid)assert.equal(check(item).valid,false,JSON.stringify(item));
});
