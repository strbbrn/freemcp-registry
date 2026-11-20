import test from 'node:test';
import assert from 'node:assert/strict';
import {issueContent} from '../src/lib/submission.mjs';
import {parseSubmissionIssue,reviewSubmission,formatReview} from '../src/lib/submission-review.mjs';
import {prepareRegistration} from '../src/lib/registration.mjs';

const manifest={schemaVersion:1,name:'Integration MCP',description:'Integration-only example',repository:'https://github.com/example/integration-mcp',category:'Development',transport:'stdio',installation:{command:'npx',args:['-y','integration-mcp']},permissions:['Read-only']};
const fields={repository:manifest.repository,name:manifest.name,description:manifest.description,category:manifest.category,transport:manifest.transport,docs:'',installation:'npx -y integration-mcp',permissions:'Read-only'};

test('Submission → issue → automated triage → SQL candidate (no D1 writes)',()=>{
 const body=issueContent(fields,[]);
 const parsed=parseSubmissionIssue(body);
 assert.equal(parsed.Repository,manifest.repository);
 const triage=reviewSubmission(body);
 assert.equal(triage.recognized,true);
 assert.equal(triage.passed,true,JSON.stringify(triage.findings));
 assert.match(formatReview(triage),/No automatic publication or approval/);
 const candidate=prepareRegistration(manifest,123);
 assert.match(candidate.sql,/INSERT INTO servers/);
 assert.match(candidate.sql,/REVIEW REQUIRED/);
 assert.equal(candidate.details.review.status,'pending-publication');
});
test('Duplicate or suspicious submission cannot pass preliminary triage',()=>{
 const body=issueContent(fields,[]);
 assert.equal(reviewSubmission(body,[{id:'existing',githubUrl:manifest.repository}]).passed,false);
 assert.equal(reviewSubmission(body.replace('npx -y integration-mcp','password=abcdefghijklmnop')).passed,false);
});
