import {writeFileSync} from 'node:fs';
import {parseSubmissionIssue} from '../src/lib/submission-review.mjs';
import {prepareRegistration} from '../src/lib/registration.mjs';
import {parseRepository,secretPattern} from '../src/lib/submission.mjs';

const number=Number(process.env.ISSUE_NUMBER);
const token=process.env.GITHUB_TOKEN;
const repository=process.env.GITHUB_REPOSITORY;
if(!Number.isSafeInteger(number)||number<1||!token||!repository)throw Error('Missing issue number or GitHub context');
const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
const api=process.env.GITHUB_API_URL||'https://api.github.com';
async function github(path){const r=await fetch(api+path,{headers});if(!r.ok)throw Error('GitHub request failed '+r.status+': '+path);return r.json();}
function legacyFields(body){
 if(!body.startsWith('## Server Details\n'))return null;
 const field=(label)=>{const match=body.match(new RegExp('\\*\\*'+label+':\\*\\*\\s*([^\n]+)','i'));return match?.[1]?.trim()||'';};
 const name=field('Server Name'),repository=field('GitHub Repository URL'),description=field('Short Description'),category=field('Category');
 if(!name||!repository||!description||!category)return null;
 const context=body.split('## Additional Context')[1]||'';
 return {Repository:repository,Name:name,Description:description,Category:category,Transport:/\bstdio\b/i.test(body)?'stdio':/streamable.http|https?:\/\/[^\s]+\/mcp/i.test(body)?'http':'unknown','Installation evidence / instructions':context};
}
const actor=await github('/repos/'+repository+'/collaborators/'+encodeURIComponent(process.env.GITHUB_ACTOR)+'/permission');
if(!['admin','maintain','write'].includes(actor.permission))throw Error('Maintainer write access required');
const issue=await github('/repos/'+repository+'/issues/'+number);
if(issue.pull_request||issue.state!=='open'||issue.locked)throw Error('Expected an open, unlocked submission issue');
if(!issue.labels.some(l=>l.name==='freemcp-approved'))throw Error('Explicit freemcp-approved label required');
const fields=parseSubmissionIssue(issue.body||'')||legacyFields(issue.body||'');
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
if(Boolean(command)===Boolean(endpoint))throw Error('Provide exactly one installation command or HTTPS endpoint');
if(command&&!/^[A-Za-z0-9_.+\/-]{1,200}$/.test(command))throw Error('Installation command must be a single executable, not shell syntax');
if(!Array.isArray(args)||args.length>20||args.some(a=>typeof a!=='string'||a.length>300))throw Error('Invalid installation args');
if(endpoint&&args.length)throw Error('Endpoint cannot have command arguments');
const evidence=fields['Installation evidence / instructions']||'';
const expected=command?[command,...args].join(' '):endpoint;
if(!evidence||evidence==='Not supplied'||!evidence.includes(expected))throw Error('Installation configuration must match submitted evidence; request clarification before approval');
const transport=fields.Transport;
if(command&&transport!=='stdio')throw Error('Command installation requires explicitly documented stdio transport');
if(endpoint&&!['http','sse'].includes(transport))throw Error('Endpoint requires explicitly documented http or sse transport');
const manifest={schemaVersion:1,name:fields.Name,description:fields.Description,repository:fields.Repository,category:fields.Category,transport,installation:command?{command,args}:{endpoint}};
const registration=prepareRegistration(manifest,number);
writeFileSync('registration-candidate.sql',registration.sql,{mode:0o600});
writeFileSync('registration-review.json',JSON.stringify({issue:number,repository:fields.Repository,sourceBranch:metadata.default_branch,sourceCommit:sourceSha,serverId:registration.id,source:'approved-github-issue',installation:manifest.installation,reviewedBy:process.env.GITHUB_ACTOR,warning:'NOT DEPLOYED. Verify issue claims, source commit, live D1 duplicates, installation safety and SQL before applying.'},null,2)+'\n',{mode:0o600});
console.log('Created registration candidate for '+registration.id+'. No database writes performed.');
