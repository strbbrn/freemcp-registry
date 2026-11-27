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
import { noIssueDelivery, queueIssueDecision } from './outbox.js';

const recognized = issue => !issue.pull_request && /^(?:\[MCP Submission\]|Add:|Submit:)/i.test(issue.title || '') &&
  (parseSubmissionIssue(issue.body) || parseLegacySubmissionIssue(issue.body));
const seconds = () => Math.floor(Date.now()/1000);
const columns = ['number','status','issue_hash','source_commit','candidate_json','actor','updated_at','server_id'];
export const reviewRow = (db,number) => db.prepare('SELECT * FROM submission_reviews WHERE number=?').bind(number).first();


export async function listSubmissions(page,readToken) {
  const {data,next} = await projectRead(project+'/issues?state=all&per_page=40&page='+page,readToken,true);
  return {items:data.filter(recognized).map(({number,title,state,updated_at})=>({number,title,state,updated_at})),next};
}
export async function submission(number, { commentsPage, readme = false, readToken } = {}) {
  const path = project+'/issues/'+number;
  const [{data:issue}, comments] = await Promise.all([
    projectRead(path,readToken,false,true),
    commentsPage === undefined ? null : projectRead(path+'/comments?per_page=30&page='+commentsPage,readToken,true),
  ]);
  const fields = issue && recognized(issue);
  if (!fields) throw new AdminError(404,'Submission issue not found.');
  if (secretPattern.test(issue.body)) throw new AdminError(422,'Issue contains a possible credential. Redact the issue before reviewing it.');
  const findings = parseSubmissionIssue(issue.body) ? reviewSubmission(issue.body) : {
    recognized:true,passed:false,findings:[],warnings:['Legacy submission. Confirm transport and installation evidence explicitly before approval.'],
  };
  let source = null, headings = [];
  try {
    const {owner,repo} = parseRepository(evidenceLinks(fields.Repository)[0]??fields.Repository);
    const repoPath = '/repos/'+encodeURIComponent(owner)+'/'+encodeURIComponent(repo);
    const {data} = await github(repoPath,{optional:true,cache:readme});
    if (data && !data.archived && !data.disabled && !data.private && typeof data.default_branch==='string') {
      const {data:commit} = await github(repoPath+'/commits/'+encodeURIComponent(data.default_branch));
      if (/^[a-f0-9]{40}$/i.test(commit?.sha)) {
        source = { sha:commit.sha, branch:data.default_branch, license:data.license?.spdx_id || null, repoId:data.id, name:data.full_name };
        if (readme) {
          const {data:doc} = await github(repoPath+'/readme?ref='+source.sha,{optional:true,cache:true});
          if (doc?.encoding==='base64' && doc.size<=96000 && doc.content) {
            const readmeText = new TextDecoder().decode(Uint8Array.from(atob(doc.content.replace(/\s/g,'')),char=>char.charCodeAt(0)));
            headings = readmeHeadings(readmeText);
          }
        }
      }
    }
  } catch (error) {
    if (!comments) throw error;
    findings.warnings.push(error instanceof AdminError ? error.message : 'Could not verify the upstream source. Retry before approving.');
  }
  const fingerprint = await digest(JSON.stringify([issue.number,issue.title,issue.body,issue.state,issue.locked,issue.updated_at,source]));
  return { issue:{number,title:issue.title,state:issue.state,locked:Boolean(issue.locked)},
    fields, original:issue.body, findings, source, headings, fingerprint, comments:comments && {
      items:comments.data.map(comment=>({author:comment.user?.login || 'Unknown',body:secretPattern.test(comment.body||'')
        ? 'Comment hidden because it may contain a credential.' : (comment.body||'').slice(0,65000),date:comment.created_at})),
      next:comments.next,
    } };
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

export async function checkEditableCandidate(config,number,data,env) {
  const prior=await reviewRow(config.db,number);
  await assertVersion(prior,data.version);
  if (prior?.status==='published') invalid('Unpublish the existing listing before editing its submission candidate.');
  const evidence=await submission(number,{readToken:env.ADMIN_GITHUB_REVIEW_TOKEN});
  if (evidence.fingerprint!==data.fingerprint) conflict();
  const linked=prior?.server_id?await serverRow(config.db,prior.server_id):null;
  if (prior?.server_id&&!linked) conflict();
  const row=editableCandidate(evidence,number,data,linked,candidateEnvelope(prior).candidate);
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
  const evidence = await submission(number,{readToken:env.ADMIN_GITHUB_REVIEW_TOKEN});
  if (evidence.fingerprint !== data.fingerprint) conflict();
  if (prior?.status==='published') invalid('This submission has already been published.');
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
    if (data.confirm!=='yes'||prior?.status!=='approved') invalid('An explicit approval and publication confirmation are required.');
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
        ...queueIssueDecision(db,auditId,number,'published','Published on FreeMCP at https://freemcp.in/servers/'+row.id,decision),
      ]);
    return { serverId:row.id };
  }
  const row = {number,status:action==='save-candidate'?'clarification':action,issue_hash:evidence.fingerprint,source_commit:evidence.source?.sha || '',
    candidate_json:'{}',actor,updated_at:new Date().toISOString(),server_id:existing?.id??null};
  let candidate;
  let guards=[];
  if (action==='save-candidate') {
    candidate=editableCandidate(evidence,number,data,existing,candidateEnvelope(prior).candidate);
    await assertNoDuplicate(db,candidate,Boolean(existing));
    row.candidate_json=JSON.stringify({candidate,exceptions:publicationExceptions(formPublicationExceptions(data)),
      serverVersion:await linkedVersion(existing)});
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
    before:prior&&{status:prior.status},after:{status:action}},auditId=>candidate?guards:queueIssueDecision(db,auditId,number,action,why,decision));
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
    const {owner,repo}=parseRepository(github);
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
    if (item.decision_version) return item.decision_version===await version(review);
    const latest=await db.prepare('SELECT id FROM admin_outbox WHERE issue_number=? ORDER BY rowid DESC LIMIT 1')
      .bind(item.issue_number).first();
    return latest?.id===id;
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
