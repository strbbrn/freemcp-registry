import {writeFileSync} from 'node:fs';
import {parseSubmissionIssue,parseLegacySubmissionIssue} from '../src/lib/submission-review.mjs';
import {manifestFromSubmission,prepareRegistration} from '../src/lib/registration.mjs';
import {parseRepository,secretPattern} from '../src/lib/submission.mjs';

const number=Number(process.env.ISSUE_NUMBER);
const token=process.env.GITHUB_TOKEN;
const repository=process.env.GITHUB_REPOSITORY;
if(!Number.isSafeInteger(number)||number<1||!token||!repository)throw Error('Missing issue number or GitHub context');
const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
const api=process.env.GITHUB_API_URL||'https://api.github.com';
async function github(path){const r=await fetch(api+path,{headers});if(!r.ok)throw Error('GitHub request failed '+r.status+': '+path);return r.json();}
const actor=await github('/repos/'+repository+'/collaborators/'+encodeURIComponent(process.env.GITHUB_ACTOR)+'/permission');
if(!['admin','maintain','write'].includes(actor.permission))throw Error('Maintainer write access required');
const issue=await github('/repos/'+repository+'/issues/'+number);
if(issue.pull_request||issue.state!=='open'||issue.locked)throw Error('Expected an open, unlocked submission issue');
if(!issue.labels.some(l=>l.name==='freemcp-approved'))throw Error('Explicit freemcp-approved label required');
const fields=parseSubmissionIssue(issue.body||'')||parseLegacySubmissionIssue(issue.body||'');
if(!fields||!/^(?:\[MCP Submission\]|Add:|Submit:)/i.test(issue.title))throw Error('Unrecognized submission issue');
if(secretPattern.test(issue.body||''))throw Error('Potential secret in submission; review and redact first');
const parsed=parseRepository(fields.Repository);
const metadata=await github('/repos/'+parsed.owner+'/'+parsed.repo);
if(metadata.archived||metadata.disabled||metadata.private)throw Error('Source repository unavailable, archived or disabled');
const source=await github('/repos/'+parsed.owner+'/'+parsed.repo+'/commits/'+encodeURIComponent(metadata.default_branch));
const sourceSha=source.sha;
if(!/^[a-f0-9]{40}$/i.test(sourceSha))throw Error('Cannot resolve immutable source commit');
const command=(process.env.INSTALL_COMMAND||'').trim();
const endpoint=(process.env.INSTALL_ENDPOINT||'').trim();
let args;
try{args=JSON.parse(process.env.INSTALL_ARGS_JSON||'[]');}catch{throw Error('Installation args must be a JSON array');}
const manifest=manifestFromSubmission(fields,{command,endpoint,args});
const registration=prepareRegistration(manifest,number);
writeFileSync('registration-candidate.sql',registration.sql,{mode:0o600});
writeFileSync('registration-review.json',JSON.stringify({issue:number,repository:fields.Repository,sourceBranch:metadata.default_branch,sourceCommit:sourceSha,serverId:registration.id,source:'approved-github-issue',installation:manifest.installation,tools:manifest.tools,prerequisites:manifest.prerequisites,permissions:manifest.permissions,reviewedBy:process.env.GITHUB_ACTOR,warning:'NOT DEPLOYED. Verify issue claims, source commit, live D1 duplicates, installation safety and SQL before applying.'},null,2)+'\n',{mode:0o600});
console.log('Created registration candidate for '+registration.id+'. No database writes performed.');
