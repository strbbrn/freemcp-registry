import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {reviewSubmission,formatReview} from '../src/lib/submission-review.mjs';

const event=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
const issue=event.issue;
if(!issue||issue.pull_request||!/^\[MCP Submission\]/i.test(issue.title||'')){console.log('Not an MCP submission issue; skipping');process.exit(0);}
const existing=readdirSync('src/data/servers').filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(join('src/data/servers',f),'utf8')));
const review=reviewSubmission(issue.body||'',existing);
const body=formatReview(review);
console.log(body);
if(!process.env.GITHUB_TOKEN){console.log('No token: dry-run only');process.exit(0);}
const repo=process.env.GITHUB_REPOSITORY;
const api=process.env.GITHUB_API_URL||'https://api.github.com';
const headers={Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'};
const url=api+'/repos/'+repo+'/issues/'+issue.number+'/comments';
const existingComments=await fetch(url+'?per_page=100',{headers});
if(!existingComments.ok)throw new Error('Cannot inspect existing review comments: '+existingComments.status);
const comments=await existingComments.json();
const marker='### FreeMCP automated submission triage';
const prior=comments.find(c=>c.user?.type==='Bot'&&c.body?.startsWith(marker));
const target=prior?api+'/repos/'+repo+'/issues/comments/'+prior.id:url;
const response=await fetch(target,{method:prior?'PATCH':'POST',headers,body:JSON.stringify({body})});
if(!response.ok)throw new Error('Cannot post review comment: '+response.status);
console.log('Review comment '+(prior?'updated':'created')+'. No labels, approvals or database changes.');
