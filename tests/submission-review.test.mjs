import test from 'node:test';
import assert from 'node:assert/strict';
import {issueContent} from '../src/lib/submission.mjs';
import {parseSubmissionIssue,reviewSubmission,formatReview} from '../src/lib/submission-review.mjs';
const fields={repository:'https://github.com/example/server',name:'Example Server',category:'Development',description:'An example MCP server',transport:'stdio',docs:'https://example.com/docs',installation:'npx -y example-server',permissions:'Read-only'};
const body=issueContent(fields,[]);
test('Recognize actual generated GitHub submission format',()=>{
 const parsed=parseSubmissionIssue(body);
 assert.equal(parsed.Repository,fields.repository);
 assert.equal(parsed.Name,fields.name);
 assert.equal(reviewSubmission(body).passed,true);
});
test('Reject malformed, credential-bearing and duplicate submissions',()=>{
 assert.equal(reviewSubmission('unrelated issue').recognized,false);
 assert.equal(reviewSubmission(body.replace(fields.repository,'http://example.com/a')).passed,false);
 assert.equal(reviewSubmission(body.replace(fields.description,'password=abcdefghijklmnop')).passed,false);
 assert.equal(reviewSubmission(body,[{id:'example-server',githubUrl:fields.repository}]).passed,false);
 assert.equal(reviewSubmission(body.replace('### Category\nDevelopment','### Category\nWrong')).passed,false);
});
test('Report is preliminary and never claims approval',()=>{
 const report=formatReview(reviewSubmission(body));
 assert.match(report,/Preliminary format checks passed/);
 assert.match(report,/live D1/);
 assert.match(report,/No automatic publication or approval/);
});

test('Legacy submission is recognized as legacy evidence only',async()=>{
 const {parseLegacySubmissionIssue}=await import('../src/lib/submission-review.mjs');
 const legacy='## Server Details\n\n**Server Name:** Example\n**GitHub Repository URL:** https://github.com/example/server\n**Short Description:** Example MCP server\n**Category:** Development\n\n## Additional Context\nNo installation details';
 assert.equal(parseLegacySubmissionIssue(legacy).Name,'Example');
 assert.equal(reviewSubmission(legacy).recognized,false);
});
