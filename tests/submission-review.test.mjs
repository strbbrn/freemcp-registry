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

test('direct GitHub template carries extended listing fields into the admin candidate', async()=>{
 const {readFileSync}=await import('node:fs');
 const {normalizedSubmission}=await import('../lib/admin/submission-candidate.js');
 const template=readFileSync('.github/ISSUE_TEMPLATE/submit-server.md','utf8');
 const templateBody=template.slice(template.indexOf('## MCP server submission'))
   .replace('### Maintainer\nNot supplied','### Maintainer\nMaintainer example')
   .replace('### Overview\nNot supplied','### Overview\nExtended overview')
   .replace('### Tags\nNot supplied','### Tags\n- local\nreference')
   .replace('### Transport\nunknown','### Transport\nstdio')
   .replace('### Additional transports\nNot supplied','### Additional transports\nhttp, sse')
   .replace('### Documentation\nNot supplied','### Documentation\nhttps://example.org/docs')
   .replace('### Additional documentation URLs\nNot supplied','### Additional documentation URLs\nhttps://example.org/security')
   .replace('### Permissions / security considerations\nNot supplied','### Permissions / security considerations\nRead-only access to local files.')
   .replace('### Pricing\nNot supplied','### Pricing\nFree locally')
   .replace('### Service dependencies\nNot supplied','### Service dependencies\n- Optional hosted service')
   .replace('### Implementation key\nNot supplied','### Implementation key\nlocal-server');
 const parsed=parseSubmissionIssue(templateBody);
 assert.ok(reviewSubmission(templateBody).passed);
 const candidate=normalizedSubmission(parsed);
 assert.equal(candidate.author,'Maintainer example');
 assert.deepEqual(candidate.tags,['local','reference']);
 const {details}=candidate;
 assert.equal(details.summary,'Extended overview');
 assert.deepEqual(details.transports,['stdio','http','sse']);
 assert.deepEqual(details.documentationUrls,['https://example.org/security']);
 assert.deepEqual(details.security,['Read-only access to local files.']);
 assert.equal(details.pricing,'Free locally');
 assert.deepEqual(details.serviceDependencies,['Optional hosted service']);
 assert.equal(details.implementationKey,'local-server');
});
