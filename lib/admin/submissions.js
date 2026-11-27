import { parseRepository, readmeHeadings, secretPattern } from '../../src/lib/submission.mjs';
import { parseLegacySubmissionIssue, parseSubmissionIssue, reviewSubmission } from '../../src/lib/submission-review.mjs';
import { manifestFromSubmission, registrationCandidate } from '../../src/lib/registration.mjs';
import { digest } from './crypto.js';
import { AdminError, conflict, invalid } from './http.js';
import { assertVersion, commitMutation, requireRow, version } from './audit.js';
import { options, parsed, reason, text, url } from './validation.js';
import { appEnabled, deliverIssueUpdate, github, project, projectRead } from './github.js';
import { insertServer, serverAudit, serverCandidate, serverRow, updateServer } from './servers.js';
import { assertNoDuplicate, duplicateArgs, duplicateCondition, listingCollision } from './duplicates.js';
import { assertPublicationReady, formPublicationExceptions, publicationExceptions } from './publication.js';
import { evidenceLinks, formCandidate, normalizedSubmission } from './submission-candidate.js';
import { cachedGithubEvidence, githubEvidence } from './github-evidence.js';
import { noIssueDelivery, queueIssueDecision } from './outbox.js';

const recognized = issue => !issue.pull_request && /^(?:\[MCP Submission\]|Add:|Submit:)/i.test(issue.title || '') &&
  (parseSubmissionIssue(issue.body) || parseLegacySubmissionIssue(issue.body));
const seconds = () => Math.floor(Date.now()/1000);
const columns = ['number','status','issue_hash','source_commit','candidate_json','actor','updated_at','server_id'];
export const reviewRow = (db,number) => db.prepare('SELECT * FROM submission_reviews WHERE number=?').bind(number).first();


const issueList = data => data.filter(issue=>recognized(issue)&&!secretPattern.test(issue.title||'')&&!secretPattern.test(issue.body||'')).map(({number,title,state,updated_at})=>({number,title,state,updated_at}));
const sensitiveIssue=issue=>secretPattern.test(issue.title||'')||secretPattern.test(issue.body||'');
const cleanIssue = issue => issue&&({
  number:issue.number,title:sensitiveIssue(issue)?'Redacted issue':issue.title,state:issue.state,locked:issue.locked,updated_at:issue.updated_at,
  pull_request:issue.pull_request?true:undefined,
  body:sensitiveIssue(issue)?null:issue.body,
  redacted:sensitiveIssue(issue),
});
const cleanComments = comments => comments.map(comment=>({
  author:comment.user?.login||'Unknown',body:secretPattern.test(comment.body||'')
    ?'Comment hidden because it may contain a credential.':(comment.body||'').slice(0,5000),date:comment.created_at,
}));
const cleanRepo = repo => repo&&!repo.private?({id:repo.id,full_name:repo.full_name,default_branch:repo.default_branch,
  archived:repo.archived,disabled:repo.disabled,private:repo.private,license:{spdx_id:repo.license?.spdx_id}}):null;
function cleanReadme(doc) {
  if (doc?.encoding!=='base64'||doc.size>96000||!doc.content) return [];
  const content=new TextDecoder().decode(Uint8Array.from(atob(doc.content.replace(/\s/g,'')),char=>char.charCodeAt(0)));
  return secretPattern.test(content)?[]:readmeHeadings(content);
}

export async function listSubmissions(page,readToken,config) {
  const path=project+'/issues?state=all&per_page=40&page='+page;
  if (!config) {
    const {data,next}=await projectRead(path,readToken);
    return {items:issueList(data),next};
  }
  const {data,next,checkedAt,stale,warning}=await githubEvidence(config,readToken,path,{projectData:issueList});
  return {items:data,next,checkedAt,stale,warning};
}
export async function submission(number,{commentsPage,readme=false,readToken,config,fresh=false,refresh=false,cacheOnly=false}={}) {
  const path=project+'/issues/'+number;
  const read=async (endpoint,projectData,optional=false)=>{
    if (config) return cacheOnly?cachedGithubEvidence(config,endpoint):githubEvidence(config,readToken,endpoint,{fresh,refresh,optional,projectData});
    const value=endpoint.startsWith(project+'/issues')?await projectRead(endpoint,readToken,optional)
      :await github(endpoint,{authorization:readToken,optional});
    return {...value,data:projectData(value.data)};
  };
  const issueResult=await read(path,cleanIssue,true);
  const issue=issueResult.data;
  if (issue?.redacted) throw new AdminError(422,'Issue contains a possible credential. Redact the issue before reviewing it.');
  const fields=issue&&recognized(issue);
  if (!fields) throw new AdminError(404,'Submission issue not found.');
  const findings=parseSubmissionIssue(issue.body)?reviewSubmission(issue.body):{
    recognized:true,passed:false,findings:[],warnings:['Legacy submission. Confirm transport and installation evidence explicitly before approval.'],
  };
  let source=null,headings=[],sourceCheckedAt=null,stale=Boolean(issueResult.stale),comments=null;
  if (issueResult.warning) findings.warnings.push(issueResult.warning);
  try {
    const {owner,repo}=parseRepository(evidenceLinks(fields.Repository)[0]??fields.Repository);
    const repoPath='/repos/'+encodeURIComponent(owner)+'/'+encodeURIComponent(repo);
    const metadata=await read(repoPath,cleanRepo,true);
    const {data}=metadata;
    stale ||= Boolean(metadata.stale);
    if (metadata.warning) findings.warnings.push(metadata.warning);
    if (data&&!data.archived&&!data.disabled&&!data.private&&typeof data.default_branch==='string') {
      const commit=await read(repoPath+'/commits/'+encodeURIComponent(data.default_branch),value=>({sha:value?.sha}));
      sourceCheckedAt=Math.min(metadata.checkedAt??seconds(),commit.checkedAt??seconds());
      stale ||= Boolean(commit.stale);
      if (commit.warning) findings.warnings.push(commit.warning);
      if (/^[a-f0-9]{40}$/i.test(commit.data?.sha)) {
        source={sha:commit.data.sha,branch:data.default_branch,license:data.license?.spdx_id||null,repoId:data.id,name:data.full_name};
        if (readme) headings=(await read(repoPath+'/readme?ref='+source.sha,cleanReadme,true)).data??[];
      }
    }
  } catch(error) {
    if (fresh || !config && commentsPage===undefined) throw error;
    findings.warnings.push(error instanceof AdminError?error.message:'Could not verify the upstream source. Retry before approving.');
    stale=true;
  }
  if (commentsPage!==undefined) {
    try {
      const discussion=await read(path+'/comments?per_page=30&page='+commentsPage,cleanComments);
      comments={items:discussion.data,next:discussion.next,checkedAt:discussion.checkedAt,stale:discussion.stale};
      if (discussion.warning) findings.warnings.push(discussion.warning);
    } catch(error) {
      findings.warnings.push(error instanceof AdminError?error.message:'Discussion evidence is unavailable.');
    }
  }
  const fingerprint=await digest(JSON.stringify([issue.number,issue.title,issue.body,issue.state,issue.locked,issue.updated_at,source]));
  return {issue:{number,title:issue.title,state:issue.state,locked:Boolean(issue.locked)},fields,original:issue.body,
    findings,source,headings,fingerprint,comments,checkedAt:issueResult.checkedAt,sourceCheckedAt,stale};
}
function prepareCandidate(evidence,number,installation,prior,sharedEndpoints) {
  const candidate = registrationCandidate(manifestFromSubmission(evidence.fields,installation),number);
  if (evidence.fields.Documentation && evidence.fields.Documentation!=='Not supplied') {
    candidate.details.documentationUrl = url(evidence.fields.Documentation,'documentation URL');
  }
  if (!prior) {
    const draft=serverCandidate({...candidate,sharedEndpoints,confirmSharedEndpoints:'yes'});
    const details=JSON.parse(draft.details_json);
    draft.details_json=JSON.stringify({...details,review:{...details.review,...candidate.details.review}});
    return draft;
  }
  const current=JSON.parse(prior.details_json);
  if (prior.github_url.toLowerCase()!==candidate.github_url.toLowerCase() || current.review?.issue!==number ||
      current.review?.source!=='approved-submission' || current.review?.status!=='pending-publication') {
    invalid('The linked draft must retain this submission and its source repository.');
  }
  const draft=serverCandidate({sharedEndpoints,confirmSharedEndpoints:'yes',details:{transport:candidate.details.transport,installations:candidate.details.installations,
    endpoints:candidate.details.endpoints??[]}},prior);
  return draft;
}
const candidateEnvelope = review => JSON.parse(review?.candidate_json || '{}');
const linkedVersion = async row => row ? version(row) : null;
const requireLinkedVersion = async (saved,row) => {
  if (saved.serverVersion!==await linkedVersion(row)) conflict();
};

export function editableCandidate(evidence,number,data,existing,saved) {
  const input=formCandidate(data);
  const prior=existing??(saved?{...saved,id:input.id??saved.id}:null);
  const draft=serverCandidate({...input,confirmSharedEndpoints:data.confirmSharedEndpoints??input.confirmSharedEndpoints},prior);
  const claimed=new URL(draft.github_url).pathname.split('/').filter(Boolean).slice(0,2).join('/').toLowerCase();
  const original=new URL(evidenceLinks(evidence.fields.Repository)[0]??'https://github.com/').pathname.split('/').filter(Boolean).slice(0,2).join('/').toLowerCase();
  if (!original || claimed!==original) invalid('Repository URL must belong to the submission’s verified repository. A path within that repository is allowed.');
  const details=JSON.parse(draft.details_json);
  details.review={...details.review,status:'pending-publication',issue:number,source:'approved-submission'};
  draft.details_json=JSON.stringify(details);
  return draft;
}

export async function candidateEditorState(config,evidence,prior) {
  const saved=candidateEnvelope(prior);
  const linked=prior?.server_id?await serverRow(config.db,prior.server_id):null;
  const row=saved.candidate??linked;
  const normalized=normalizedSubmission(evidence.fields);
  if (!row) return {candidate:normalized,normalized,saved,linked};
  const details=JSON.parse(row.details_json);
  return {candidate:{id:row.id,name:row.name,description:row.description,category:row.category,author:row.author,
    github_url:row.github_url,stars:row.stars,tags:JSON.parse(row.tags_json),details,sharedEndpoints:details.review?.sharedEndpoints},normalized,saved,linked};
}

function draftEvidence(number,prior) {
  const {candidate,evidence}=candidateEnvelope(prior);
  if (!candidate) return null;
  if (evidence) return {...evidence,stale:true,comments:null};
  return {issue:{number,title:candidate.name,state:'saved'},fields:{Repository:candidate.github_url},
    original:null,source:null,headings:[],comments:null,fingerprint:prior.issue_hash,stale:true,
    findings:{findings:[],warnings:['This draft predates evidence caching. Its original GitHub evidence is unavailable offline.']},
    savedSourceCommit:prior.source_commit};
}

export async function displaySubmission(config,number,prior,options) {
  const fallback=draftEvidence(number,prior);
  if (fallback&&!options.refresh) {
    try {
      const cached=await submission(number,{...options,config,cacheOnly:true});
      if (cached.fingerprint===fallback.fingerprint) return cached;
    } catch(error) {
      if (!(error instanceof AdminError)) throw error;
    }
    return fallback;
  }
  try { return await submission(number,{...options,config}); }
  catch(error) {
    if (!fallback||!(error instanceof AdminError)) throw error;
    return {...fallback,findings:{...fallback.findings,warnings:[...fallback.findings.warnings,error.message]}};
  }
}

async function editingEvidence(config,number,prior,fingerprint) {
  const fallback=draftEvidence(number,prior);
  if (fallback?.fingerprint===fingerprint) return fallback;
  const cached=await submission(number,{config,cacheOnly:true});
  if (cached.fingerprint!==fingerprint) conflict();
  return cached;
}

function editingCandidate(evidence,number,data,linked,prior) {
  try { return editableCandidate(evidence,number,data,linked,candidateEnvelope(prior).candidate); }
  catch(error) {
    if (error.status===400&&!error.issues) {
      const fields=[['candidateJson',/JSON object|Advanced candidate JSON/],['id',/server ID/],
        ['implementationKey',/implementation key/],['sharedEndpoints',/shared endpoint/],
        ['github_url',/repository URL|GitHub repository/i],['documentationUrl',/documentation/i],
        ['endpoints',/MCP endpoint|endpoint transport/],['transport',/transport/],['installations',/installation|configuration/],
        ['tools',/tool/],['prerequisites',/prerequisites/],['security',/security considerations/],
        ['description',/description/],['name',/name/],['category',/category/],['author',/author/],['tags',/tags/]];
      const field=fields.find(([,pattern])=>pattern.test(error.message))?.[0];
      if (field) error.issues=[{field,message:error.message}];
    }
    throw error;
  }
}

export async function checkEditableCandidate(config,number,data) {
  const prior=await reviewRow(config.db,number);
  await assertVersion(prior,data.version);
  if (prior?.status==='published') invalid('Unpublish the existing listing before editing its submission candidate.');
  const evidence=await editingEvidence(config,number,prior,data.fingerprint);
  const linked=prior?.server_id?await serverRow(config.db,prior.server_id):null;
  if (prior?.server_id&&!linked) conflict();
  const row=editingCandidate(evidence,number,data,linked,prior);
  if (data.action==='validate-candidate') {
    assertPublicationReady(row,formPublicationExceptions(data));
    await assertNoDuplicate(config.db,row,Boolean(linked));
  }
  return row;
}

export async function reviewAction(config,actor,number,data,env={}) {
  const db = config.db;
  const action = options(data.action,['save-candidate','clarification','rejected','approved','publish'],'review decision');
  const why = reason(data.reason);
  const prior = await reviewRow(db,number);
  await assertVersion(prior,data.version);
  if (prior?.status==='published') invalid('This submission has already been published.');
  if (action==='publish'&&(data.confirm!=='yes'||prior?.status!=='approved')) {
    invalid('An explicit approval and publication confirmation are required.');
  }
  if (action==='approved'||action==='publish') {
    if (data.confirm!=='yes') invalid('Confirm approval for an eligible issue with verified source.');
    const saved=candidateEnvelope(prior);
    if (saved.candidate) assertPublicationReady(saved.candidate,saved.exceptions);
  }
  const evidence=action==='save-candidate'?await editingEvidence(config,number,prior,data.fingerprint)
    :await submission(number,{config,fresh:true,readToken:env.ADMIN_GITHUB_REVIEW_TOKEN});
  if (evidence.fingerprint!==data.fingerprint) invalid('GitHub evidence changed. Refresh the review before proceeding.');
  let existing=prior?.server_id ? await serverRow(db,prior.server_id) : null;
  if (!prior?.server_id) {
    const safeDetails="CASE WHEN json_valid(details_json) THEN details_json ELSE '{}' END";
    const {results}=await db.prepare(`SELECT * FROM servers WHERE
      json_extract(${safeDetails},'$.review.issue')=? AND json_extract(${safeDetails},'$.review.source')='approved-submission'
      AND json_extract(${safeDetails},'$.review.status')='pending-publication' LIMIT 2`).bind(number).all();
    if (results.length>1) invalid('Multiple private listings claim this submission. Resolve the linkage before approval.');
    [existing]=results;
  }
  if (prior?.server_id && !existing) conflict();
  const acceptable = evidence.source && !evidence.issue.locked && (evidence.issue.state==='open'||existing);
  if (action==='publish') {
    if (!acceptable ||
        prior.issue_hash!==evidence.fingerprint || prior.source_commit!==evidence.source.sha) conflict();
    const approved=candidateEnvelope(prior);
    if (approved.candidate) await requireLinkedVersion(approved,existing);
    else if (existing && approved.serverVersion!==await version(existing)) conflict();
    const row=approved.candidate?{...approved.candidate,updated_at:new Date().toISOString()}
      :prepareCandidate(evidence,number,approved.installation,existing,approved.sharedEndpoints);
    const exceptions=assertPublicationReady(row,approved.exceptions);
    const details = JSON.parse(row.details_json);
    details.review = {...details.review,status:'published',sourceCommit:evidence.source.sha,exceptions};
    row.details_json = JSON.stringify(details);
    await assertNoDuplicate(db,row,Boolean(existing));
    const exact = columns.map(column=>column+' IS ?').join(' AND ');
    const clause='AND '+noIssueDelivery+' AND EXISTS (SELECT 1 FROM submission_reviews WHERE '+exact+')';
    const args=[number,seconds(),...columns.map(key=>prior[key])];
    const next={...prior,status:'published',actor,updated_at:row.updated_at,server_id:row.id};
    const decision=await version(next);
    const mutation=existing?updateServer(db,row,existing,clause,args):insertServer(db,row,clause,args);
    await commitMutation(config,actor,mutation,
      serverAudit('publish-submission',why,existing,row), auditId=>[
        db.prepare("UPDATE submission_reviews SET status='published',server_id=?,actor=?,updated_at=? WHERE number=? AND EXISTS (SELECT 1 FROM admin_audit_log WHERE id=?)")
          .bind(row.id,actor,next.updated_at,number,auditId),
        requireRow(db,"SELECT 1 FROM submission_reviews WHERE number=? AND status='published' AND updated_at=?",number,next.updated_at),
        ...queueIssueDecision(config,auditId,number,'published','Published on FreeMCP at https://freemcp.in/servers/'+row.id,decision),
      ]);
    return { serverId:row.id };
  }
  const row = {number,status:action==='save-candidate'?'clarification':action,issue_hash:evidence.fingerprint,source_commit:evidence.source?.sha || evidence.savedSourceCommit || '',
    candidate_json:'{}',actor,updated_at:new Date().toISOString(),server_id:existing?.id??null};
  let candidate;
  let guards=[];
  if (action==='save-candidate') {
    candidate=editingCandidate(evidence,number,data,existing,prior);
    await assertNoDuplicate(db,candidate,Boolean(existing));
    row.candidate_json=JSON.stringify({candidate,exceptions:publicationExceptions(formPublicationExceptions(data)),
      serverVersion:await linkedVersion(existing),evidence:{...evidence,comments:null}});
  }
  if (action==='approved') {
    if (data.confirm!=='yes'||!acceptable) invalid('Confirm approval for an eligible issue with verified source.');
    const saved=candidateEnvelope(prior);
    if (saved.candidate) {
      if (prior.issue_hash!==evidence.fingerprint || prior.source_commit!==evidence.source.sha) invalid('Source evidence changed. Review it and save the candidate again.');
      await requireLinkedVersion(saved,existing);
      candidate=saved.candidate;
      assertPublicationReady(candidate,saved.exceptions);
      row.candidate_json=prior.candidate_json;
    } else {
      const installation = {command:text(data.command,'command',200,false),endpoint:text(data.endpoint,'endpoint',2048,false),
        args:parsed(data.args || '[]','installation arguments')};
      try {
        const manifest=manifestFromSubmission(evidence.fields,installation);
        candidate=prepareCandidate(evidence,number,manifest.installation,existing,data.sharedEndpoints);
        const exceptions=assertPublicationReady(candidate,data.publicationExceptions);
        row.candidate_json=JSON.stringify({installation:manifest.installation,exceptions,
          sharedEndpoints:JSON.parse(candidate.details_json).review.sharedEndpoints,serverVersion:await linkedVersion(existing)});
      } catch(error) {
        if (error instanceof AdminError) throw error;
        invalid('Installation evidence or candidate fields failed validation. Review the submitted instructions.');
      }
    }
    await assertNoDuplicate(db,candidate,Boolean(existing));
  }
  if (candidate) {
    guards=[
      requireRow(db,'SELECT 1 WHERE '+duplicateCondition,...duplicateArgs(candidate)),
      existing?requireRow(db,'SELECT 1 FROM servers WHERE id=? AND name IS ? AND description IS ? AND category IS ? AND author IS ? AND tags_json IS ? AND github_url IS ? AND stars IS ? AND details_json IS ? AND updated_at IS ?',
        existing.id,existing.name,existing.description,existing.category,existing.author,existing.tags_json,existing.github_url,existing.stars,existing.details_json,existing.updated_at)
        :requireRow(db,'SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM servers WHERE id=?)',candidate.id),
    ];
  }
  const decision=await version(row);
  const mutation = prior
    ? db.prepare(`UPDATE submission_reviews SET ${columns.slice(1).map(key=>key+'=?').join(',')} WHERE ${columns.map(key=>key+' IS ?').join(' AND ')} AND ${noIssueDelivery} RETURNING number`)
      .bind(...columns.slice(1).map(key=>row[key]),...columns.map(key=>prior[key]),number,seconds())
    : db.prepare('INSERT INTO submission_reviews SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM submission_reviews WHERE number=?) RETURNING number')
      .bind(...columns.map(key=>row[key]),number);
  await commitMutation(config,actor,mutation,{action,entity:'submission',entityId:number,reason:why,
    before:prior&&{status:prior.status},after:{status:action}},auditId=>candidate?guards:queueIssueDecision(config,auditId,number,action,why,decision));
  return { status:action };
}

export async function reviewDuplicate(config,evidence,prior) {
  if (prior?.status==='published') return null;
  try {
    const saved=candidateEnvelope(prior);
    if (saved.candidate) return listingCollision(config.db,saved.candidate,Boolean(prior?.server_id));
    const installation=saved.installation;
    const expected=installation?.endpoint??'';
    const fields=evidence.fields, github=fields.Repository;
    const {owner,repo}=parseRepository(evidenceLinks(github)[0]??github);
    const id=prior?.server_id??(owner+'-'+repo).toLowerCase().replace(/[^a-z0-9-]/g,'-').slice(0,100);
    const endpoints=[...new Set((fields['Installation evidence / instructions']||'')
      .match(/https:\/\/[^\s<>"'`]+/g)??[])].slice(0,20);
    if (expected) endpoints.push(expected);
    const listing={id,github_url:github,details_json:JSON.stringify({endpoints:endpoints.map(url=>({url}))})};
    return await listingCollision(config.db,listing,Boolean(prior?.server_id));
  } catch (error) {
    if (error instanceof AdminError) return null;
    throw error;
  }
}

export async function retryIssue(config,env,actor,id,why,send=deliverIssueUpdate) {
  if (!appEnabled(config,env)) throw new AdminError(503,'GitHub issue synchronization is disabled.');
  const db = config.db, now = seconds();
  const item = await db.prepare('SELECT * FROM admin_outbox WHERE id=?').bind(id).first();
  if (!item) throw new AdminError(404,'Queue item not found.');
  const claim = db.prepare(`UPDATE admin_outbox SET status='sending',attempts=attempts+1,lease_until=?
    WHERE id=? AND attempts=? AND ((status IN ('pending','failed') AND next_retry<=?) OR (status='sending' AND lease_until<=?))
    AND NOT EXISTS (SELECT 1 FROM admin_outbox WHERE issue_number=? AND id<>? AND status='sending' AND lease_until>?) RETURNING id`)
    .bind(now+450,id,item.attempts,now,now,item.issue_number,id,now);
  await commitMutation(config,actor,claim,{action:'retry',entity:'outbox',entityId:id,reason:why,before:{status:item.status},after:{status:'sending'}});
  const stillCurrent = async () => {
    const [review,claim] = await Promise.all([reviewRow(db,item.issue_number),
      db.prepare("SELECT id FROM admin_outbox WHERE id=? AND status='sending' AND attempts=? AND lease_until>?")
        .bind(id,item.attempts+1,seconds()+10).first()]);
    if (!claim) throw new AdminError(503,'GitHub delivery lease expired. Retry after the scheduled delay.');
    if (review?.status!==item.action || item.action==='clarification'&&candidateEnvelope(review).candidate) return false;
    // Unscoped legacy decisions cannot prove that they originated in production.
    return item.decision_version==='production:'+await version(review);
  };
  let status = 'sent', resolution='delivered', message = null, retryAt=0;
  try {
    if (await stillCurrent()) await send(env,item,stillCurrent);
    else resolution='superseded';
  } catch (error) {
    if (error instanceof AdminError && error.status===409) resolution='superseded';
    else {
      status = 'failed';
      resolution = null;
      message = error instanceof AdminError ? error.message : 'GitHub synchronization failed. Retry after the scheduled delay.';
      retryAt=Number(error?.retryAt)||0;
    }
  }
  const finish = db.prepare("UPDATE admin_outbox SET status=?,resolution=?,lease_until=NULL,next_retry=?,last_error=? WHERE id=? AND status='sending' AND attempts=? RETURNING id")
    .bind(status,resolution,status==='failed'?Math.max(retryAt,seconds()+Math.min(3600,30*2**Math.min(7,item.attempts))):0,message,id,item.attempts+1);
  const outcome=resolution==='superseded'?resolution:status;
  await commitMutation(config,actor,finish,{action:outcome,entity:'outbox',entityId:id,reason:'GitHub synchronization result',before:{status:'sending'},after:{status:outcome}});
  return {status:outcome};
}
export const submissionVersion = version;
