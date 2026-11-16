import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestGet} from '../functions/api/servers.js';
import {onRequestGet as detail} from '../functions/servers/[id].js';
function database(total=10000){
 const calls=[];
 return {calls,prepare(sql){return {bind(...args){calls.push({sql,args});return this;},async first(){return {total};},async all(){if(sql.includes('DISTINCT category'))return {results:[{category:'Cloud'},{category:'Security'}]};return {results:Array.from({length:24},(_,i)=>({id:'server-'+i,name:'Server '+i,description:'Test',category:'Cloud',author:'Example',tags_json:'[]'}))};}};}};
}
test('missing preview DB yields 503',async()=>{const r=await onRequestGet({request:new Request('https://preview.example/api/servers'),env:{}});assert.equal(r.status,503);});
test('10,000 records paginate via LIMIT/OFFSET, never load full registry',async()=>{
 const db=database();const r=await onRequestGet({request:new Request('https://preview.example/api/servers?page=2'),env:{DB:db}});
 const body=await r.json();assert.equal(body.total,10000);assert.equal(body.pages,417);assert.equal(body.page,2);assert.equal(body.servers.length,24);
 assert.match(db.calls[1].sql,/LIMIT \? OFFSET \?/);assert.deepEqual(db.calls[1].args.slice(-2),[24,24]);
});
test('search and category parameters remain bound, not interpolated',async()=>{
 const db=database(1);const r=await onRequestGet({request:new Request('https://preview.example/api/servers?q=github%20repo&category=Security'),env:{DB:db}});
 assert.equal(r.status,200);assert.match(db.calls[0].sql,/servers_search MATCH \?/);assert.deepEqual(db.calls[0].args,['Security','"github"* AND "repo"*']);
});
test('categories are retrieved from D1',async()=>{const db=database();const r=await onRequestGet({request:new Request('https://preview.example/api/servers?meta=categories'),env:{DB:db}});assert.deepEqual(await r.json(),{categories:['Cloud','Security']});});
test('D1-only detail pages escape HTML and preserve static pages',async()=>{
 const unchanged=new Response('static guide');
 assert.equal(await (await detail({next:async()=>unchanged})).text(),'static guide');
 const db={prepare(){return {bind(){return this;},async first(){return {name:'<script>alert(1)</script>',description:'Safe & sound',id:'new-mcp',category:'Cloud',author:'<admin>',tags_json:'["<tag>"]',github_url:'https://github.com/example/repo',stars:5};}};}};
 const r=await detail({next:async()=>new Response('not found',{status:404}),params:{id:'new-mcp'},env:{DB:db}});
 assert.equal(r.status,200);const html=await r.text();assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>alert(1)</script>'));assert.ok(html.includes('Safe &amp; sound'));
});
