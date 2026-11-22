import test from 'node:test';
import assert from 'node:assert/strict';
import {issueContent} from '../src/lib/submission.mjs';
import {parseSubmissionIssue,parseLegacySubmissionIssue,reviewSubmission,formatReview} from '../src/lib/submission-review.mjs';
import {prepareRegistration} from '../src/lib/registration.mjs';

const manifest={schemaVersion:1,name:'Integration MCP',description:'Integration-only example',repository:'https://github.com/example/integration-mcp',category:'Development',transport:'stdio',installation:{command:'npx',args:['-y','integration-mcp']},permissions:['Read-only'],tools:[{name:'list_items',description:'List available items'}],prerequisites:['Node.js 20+']};
const fields={repository:manifest.repository,name:manifest.name,description:manifest.description,category:manifest.category,transport:manifest.transport,docs:'',installation:'npx -y integration-mcp',permissions:'Read-only',tools:'list_items | List available items',prerequisites:'Node.js 20+'};

test('Submission → issue → automated triage → SQL candidate (no D1 writes)',()=>{
 const body=issueContent(fields,[]);
 const parsed=parseSubmissionIssue(body);
 assert.equal(parsed.Repository,manifest.repository);
 assert.equal(parsed['Documented tools'],'list_items | List available items');
 assert.equal(parsed['Setup prerequisites'],'Node.js 20+');
 const triage=reviewSubmission(body);
 assert.equal(triage.recognized,true);
 assert.equal(triage.passed,true,JSON.stringify(triage.findings));
 assert.match(formatReview(triage),/No automatic publication or approval/);
 const candidate=prepareRegistration(manifest,123);
 assert.match(candidate.sql,/INSERT INTO servers/);
 assert.match(candidate.sql,/REVIEW REQUIRED/);
 assert.equal(candidate.details.review.status,'pending-publication');
 assert.deepEqual(candidate.details.tools,manifest.tools);
 assert.deepEqual(candidate.details.prerequisites,manifest.prerequisites);
 assert.deepEqual(candidate.details.security,manifest.permissions);
});
test('Duplicate or suspicious submission cannot pass preliminary triage',()=>{
 const body=issueContent(fields,[]);
 assert.equal(reviewSubmission(body,[{id:'existing',githubUrl:manifest.repository}]).passed,false);
 assert.equal(reviewSubmission(body.replace('npx -y integration-mcp','password=abcdefghijklmnop')).passed,false);
});

test('Legacy QuelLLM-style issue can produce a candidate without freemcp.json',()=>{
 const body=[
  '## Server Details',
  '**Server Name:** QuelLLM MCP',
  '**GitHub Repository URL:** https://github.com/MGM-FALCON/quelllm-mcp',
  '**Short Description:** Free model catalogue and VRAM estimation MCP server.',
  '**Category:** Utilities',
  'The server uses stdio transport.',
  '## Additional Context',
  'Run quelllm-mcp in an MCP-compatible client.'
 ].join('\n');
 const parsed=parseLegacySubmissionIssue(body);
 assert.equal(parsed.Name,'QuelLLM MCP');
 assert.equal(parsed.Transport,'stdio');
 assert.ok(parsed['Installation evidence / instructions'].includes('quelllm-mcp'));
 const candidate=prepareRegistration({schemaVersion:1,name:parsed.Name,repository:parsed.Repository,description:parsed.Description,category:parsed.Category,transport:parsed.Transport,installation:{command:'quelllm-mcp',args:[]}},3);
 assert.equal(candidate.id,'mgm-falcon-quelllm-mcp');
 assert.equal(candidate.details.review.status,'pending-publication');
 assert.match(candidate.sql,/REVIEW REQUIRED/);
});
