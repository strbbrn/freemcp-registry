import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateCandidate, importCandidate, parseCandidateJson } from '../src/lib/submission-candidate.mjs';
import { composeSubmission, prefillUrlLimit, readStructuredSubmission } from '../src/lib/structured-submission.mjs';
import { parseSubmissionIssue, reviewSubmission } from '../src/lib/submission-review.mjs';
import { analyzeRepository } from '../src/lib/repository-analysis.mjs';
import { renderListing } from '../lib/listing-renderer.js';

test('all documented submission examples validate and survive GitHub handoff',()=>{
  const guide=readFileSync(new URL('../docs/SUBMISSION_SCHEMA.md',import.meta.url),'utf8');
  const examples=[...guide.matchAll(/^```json\n([\s\S]+?)^\x60{3}$/gm)];
  const documents=examples.map(([,json])=>JSON.parse(json));
  assert.deepEqual(documents.map(document=>document.schemaVersion??document.details.transports),[
    ['stdio'],['http'],['stdio','http'],1,1,
  ]);
  const [local,remote,,localManifest,remoteManifest]=documents;
  for (const [listing,manifest] of [[local,localManifest],[remote,remoteManifest]]) {
    assert.equal(manifest.repository,listing.github_url);
    assert.equal(manifest.name,listing.name);
    assert.equal(manifest.description,listing.description);
    assert.equal(manifest.category,listing.category);
    assert.equal(manifest.transport,listing.details.transport);
    assert.deepEqual(manifest.permissions,listing.details.security);
    assert.deepEqual(manifest.tools,listing.details.tools);
    assert.deepEqual(manifest.prerequisites,listing.details.prerequisites);
  }
  const localConfig=local.details.installations[0].config.mcpServers.notes;
  assert.deepEqual(localManifest.installation,localConfig);
  const remoteConfig=remote.details.installations[0].config.mcpServers.notes;
  assert.equal(remoteManifest.installation.endpoint,remoteConfig.url);
  assert.deepEqual(Object.keys(remoteManifest.installation.env).map(name=>'${'+name+'}'),
    [remoteConfig.headers.Authorization]);
  for(const [,json] of examples) {
    const {candidate,errors,warnings}=importCandidate(json);
    assert.deepEqual(errors,[]);
    assert.deepEqual(warnings,[]);
    assert.deepEqual(readStructuredSubmission(composeSubmission(candidate).body).candidate,candidate);
  }
});

const endpoint='https://mcp.example.org/mcp';
function example(count=2) {
  return {id:'fixture-mcp',name:'Example & MCP',description:'Search and edit fixtures.',category:'Development',author:'Example',
    github_url:'https://github.com/example/mcp',tags:['search','fixture'],
    details:{summary:'Overview\nwith instructions',documentationUrl:'https://example.org/docs',
      documentationUrls:['https://example.org/long%20path'],transport:'stdio',transports:['stdio','http'],
      endpoints:[{transport:'http',url:endpoint}],installations:[
        {title:'Local config',client:'Fixture desktop',os:'Linux',notes:'Run the documented example.',
          config:{mcpServers:{fixture:{command:'fixture',args:['--test'],env:{API_KEY:'${API_KEY}'}}}}},
        {title:'Remote config',client:'Fixture browser',transport:'http',config:{servers:{fixture:{url:endpoint,type:'http'}}}},
      ],tools:Array.from({length:count},(_,i)=>({name:'fixture_'+i,description:'A documented example tool '+i+'.'})),
      prerequisites:['A test account'],security:['Read-only access'],pricing:'Free test data',
      serviceDependencies:['Optional external service'],implementationKey:'fixture-mcp'},
  };
}

test('15, 30 and 80 tools, nested configurations and review fields round-trip via versioned issues',()=>{
  for (const count of [15,30,80]) {
    const {candidate,errors}=validateCandidate(example(count));
    assert.deepEqual(errors,[]);
    assert.equal(candidate.details.tools.length,count);
    const issue=composeSubmission(candidate,{branch:'feature/test'});
    assert.match(issue.title,/^\[MCP Submission\] Example & MCP$/);
    assert.deepEqual(readStructuredSubmission(issue.body).candidate,candidate);
    assert.equal(parseSubmissionIssue(issue.body).Repository,candidate.github_url);
    assert.equal(reviewSubmission(issue.body).passed,true);
    assert.match(issue.body,/tree\/feature\/test/);
  }
  assert.ok(validateCandidate(example(81)).errors.some(issue=>issue.field==='tools'));
});

test('large payloads preserve the body and fall back below the conservative encoded URL budget',()=>{
  const small=composeSubmission(example(1));
  assert.ok(small.url.length<=prefillUrlLimit);
  assert.equal(new URL(small.url).searchParams.get('body'),small.body);
  const draft=example(80);
  for(const tool of draft.details.tools) tool.description='Example'.repeat(70);
  const large=composeSubmission(draft);
  assert.equal(large.url,null);
  assert.equal(readStructuredSubmission(large.body).candidate.details.tools.length,80);
  draft.details.installations[0].config.custom='x'.repeat(30000);
  assert.throws(()=>composeSubmission(draft),/exceeds GitHub/);
});

test('invalid, ambiguous and conflicting structured issue payloads do not fall back to the human fields',()=>{
  const {body}=composeSubmission(example());
  for(const variant of [
    body.replace('submission:v1','submission:v2'),
    body.replace('### Name\nExample &amp; MCP','### Name\nA different name'),
    body.replace('"id":"fixture-mcp"','"id":"fixture-mcp","id":"duplicate"'),
    body.replace('"description":"Search','"review":{"status":"published"},"description":"Search'),
    body.replace('```json','```'),
    body+'\n<!-- freemcp:submission:v1 -->',
  ]) {
    assert.ok(readStructuredSubmission(variant).error);
    assert.equal(parseSubmissionIssue(variant),null);
    assert.equal(reviewSubmission(variant).passed,false);
  }
  assert.throws(()=>parseCandidateJson('{"looks":[{"a":1,"\\u0061":2}]}'),/duplicate property/);
  assert.throws(()=>parseCandidateJson('{'),/valid JSON/);
});

test('reject unsafe URLs, privileges, configuration credentials and duplicates; report missing evidence as warnings',()=>{
  const broken=[
    {...example(),stars:250},
    {...example(),details:{...example().details,review:{status:'published'}}},
    {...example(),details:{...example().details,tools:[{name:'same'},{name:'Same'}]}},
    {...example(),details:{...example().details,documentationUrl:'https://fixture:password@example.org/docs'}},
    {...example(),details:{...example().details,documentationUrl:'https://example.org/?token=fixture'}},
    {...example(),details:{...example().details,documentationUrl:'javascript:alert(1)'}},
    {...example(),details:{...example().details,transports:['sse']}},
    {...example(),details:{...example().details,installations:[{title:'Unsafe',config:{command:'fixture',env:{CUSTOM:'ordinary-value'}}}]}},
    JSON.parse('{"__proto__":{"polluted":true}}'),
  ];
  for (const input of broken) assert.ok(validateCandidate(input).errors.length);
  const incomplete={...example(),details:{}};
  const result=validateCandidate(incomplete);
  assert.deepEqual(result.errors,[]);
  assert.ok(result.warnings.some(w=>w.includes('documentation')));
  assert.ok(composeSubmission(incomplete).url);
});

test('freemcp.json v1 adapter preserves environment declarations, tools and install configuration',()=>{
  const v1={schemaVersion:1,name:'V1 fixture',description:'Synthetic',category:'Development',repository:'https://github.com/example/v1',
    transport:'stdio',installation:{command:'fixture',args:['--sample'],env:{API_KEY:{required:true,secret:true,description:'A placeholder'}}},
    tools:[{name:'hello',description:'Does a test'}],permissions:['Reads fixtures'],prerequisites:['Test runtime']};
  const {candidate,errors}=importCandidate(JSON.stringify(v1));
  assert.deepEqual(errors,[]);
  assert.deepEqual(candidate.details.installations[0].environment,v1.installation.env);
  assert.deepEqual(candidate.details.installations[0].config.mcpServers.v1.args,v1.installation.args);
  assert.deepEqual(candidate.details.tools,v1.tools);
  assert.deepEqual(candidate.details.security,v1.permissions);
});

test('repository analysis handles 429 responses, invalid manifests and README evidence without commands',async()=>{
  const flags=await analyzeRepository('https://github.com/example/mcp','feature/test',{fetcher:async (target,options)=>{
    const address=new URL(target);
    assert.equal(address.hostname,'api.github.com');
    assert.equal(options.credentials,'omit');
    if(address.pathname.endsWith('freemcp.json')) {
      assert.equal(address.searchParams.get('ref'),'feature/test');
      return new Response('{"broken"');
    }
    if(address.pathname.endsWith('/readme')) return new Response('## Installation\n\nRun sudo as an example.');
    return Response.json({name:'Fixture',description:'Synthetic metadata',default_branch:'main',stargazers_count:4});
  }});
  assert.equal(flags.stars,4);
  assert.ok(flags.notes.some(note=>note.includes('rejected')));
  assert.ok(flags.flags.some(flag=>flag.includes('Elevated privileges')));
  assert.equal(flags.fields.details.installations,undefined);
  await assert.rejects(()=>analyzeRepository('https://github.com/example/mcp','',{fetcher:async()=>new Response(null,{status:429})}),/rate limit/);
});

test('preview shares listing tools and configs while omitting external resources and escaping submitted HTML',()=>{
  const malicious=example();
  malicious.description='<img src=x onerror=alert(1)> <script>alert(1)</script>';
  malicious.details.tools[0].description='</script><script>window.bad=true</script>';
  const {candidate,errors}=validateCandidate(malicious);
  assert.deepEqual(errors,[]);
  const publicHtml=renderListing({...candidate,stars:0});
  const draft=renderListing(candidate,{submissionPreview:true,theme:'light'});
  for(const html of [publicHtml,draft]) {
    assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html,/fixture_0/);
  }
  assert.match(draft,/Unpublished submission preview — not verified by FreeMCP/);
  assert.match(draft,/data-theme="light"/);
  assert.match(draft,/Supported transports/);
  assert.doesNotMatch(draft,/<script\b|<(?:img|link)\b|href="(?!about:srcdoc#)|data-detail-promo=|application\/ld\+json/);
});
