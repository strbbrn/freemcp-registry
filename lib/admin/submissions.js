import { parseRepository, readmeHeadings, secretPattern } from '../../src/lib/submission.mjs';
import { parseLegacySubmissionIssue, parseSubmissionIssue, reviewSubmission } from '../../src/lib/submission-review.mjs';
import { manifestFromSubmission, registrationCandidate } from '../../src/lib/registration.mjs';
import { digest, token } from './crypto.js';
import { AdminError, conflict, invalid } from './http.js';
import { assertVersion, commitMutation, version } from './audit.js';
import { options, parsed, reason, text, url } from './validation.js';
import { appEnabled, deliverIssueUpdate, github, project } from './github.js';
import { insertServer, serverAudit, serverCandidate } from './servers.js';

const recognized = issue => !issue.pull_request && /^(?:\[MCP Submission\]|Add:|Submit:)/i.test(issue.title || '') &&
  (parseSubmissionIssue(issue.body) || parseLegacySubmissionIssue(issue.body));
const seconds = () => Math.floor(Date.now()/1000);
const columns = ['number','status','issue_hash','source_commit','candidate_json','actor','updated_at','server_id'];
export const reviewRow = (db,number) => db.prepare('SELECT * FROM submission_reviews WHERE number=?').bind(number).first();

export async function listSubmissions(page) {
  const {data,next} = await github(project+'/issues?state=all&per_page=40&page='+page);
  return {items:data.filter(recognized).map(({number,title,state,updated_at})=>({number,title,state,updated_at})),next};
}
export async function submission(number, { commentsPage, readme = false } = {}) {
  const path = project+'/issues/'+number;
  const [{data:issue}, comments] = await Promise.all([
    github(path,{optional:true}),
    commentsPage === undefined ? null : github(path+'/comments?per_page=30&page='+commentsPage),
  ]);
  const fields = issue && recognized(issue);
  if (!fields) throw new AdminError(404,'Submission issue not found.');
  if (secretPattern.test(issue.body)) throw new AdminError(422,'Issue contains a possible credential. Redact the issue before reviewing it.');
  const findings = parseSubmissionIssue(issue.body) ? reviewSubmission(issue.body) : {
    recognized:true,passed:false,findings:[],warnings:['Legacy submission. Confirm transport and installation evidence explicitly before approval.'],
  };
  let source = null, headings = [];
  try {
    const {owner,repo} = parseRepository(fields.Repository);
    const repoPath = '/repos/'+encodeURIComponent(owner)+'/'+encodeURIComponent(repo);
    const {data} = await github(repoPath,{optional:true});
    if (data && !data.archived && !data.disabled && !data.private && typeof data.default_branch==='string') {
      const {data:commit} = await github(repoPath+'/commits/'+encodeURIComponent(data.default_branch));
      if (/^[a-f0-9]{40}$/i.test(commit?.sha)) {
        source = { sha:commit.sha, branch:data.default_branch, license:data.license?.spdx_id || null, repoId:data.id, name:data.full_name };
        if (readme) {
          const {data:doc} = await github(repoPath+'/readme?ref='+source.sha,{optional:true});
          if (doc?.encoding==='base64' && doc.size<=96000 && doc.content) {
            const readmeText = new TextDecoder().decode(Uint8Array.from(atob(doc.content.replace(/\s/g,'')),char=>char.charCodeAt(0)));
            headings = readmeHeadings(readmeText);
          }
        }
      }
    }
  } catch (error) {
    if (!comments) throw error;
    findings.warnings.push('Could not verify the upstream source. Retry before approving.');
  }
  const fingerprint = await digest(JSON.stringify([issue.number,issue.title,issue.body,issue.state,issue.locked,issue.updated_at,source]));
  return { issue:{number,title:issue.title,state:issue.state,locked:Boolean(issue.locked)},
    fields, findings, source, headings, fingerprint, comments:comments && {
      items:comments.data.map(comment=>({author:comment.user?.login || 'Unknown',body:secretPattern.test(comment.body||'')
        ? 'Comment hidden because it may contain a credential.' : (comment.body||'').slice(0,65000),date:comment.created_at})),
      next:comments.next,
    } };
}
function outbox(db,auditId,number,action,message) {
  return db.prepare('INSERT INTO admin_outbox(id,issue_number,action,message) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM admin_audit_log WHERE id=?)')
    .bind(token(),number,action,message,auditId);
}
export async function reviewAction(config,actor,number,data) {
  const db = config.db;
  const action = options(data.action,['clarification','rejected','approved','publish'],'review decision');
  const why = reason(data.reason);
  const prior = await reviewRow(db,number);
  await assertVersion(prior,data.version);
  const evidence = await submission(number);
  if (evidence.fingerprint !== data.fingerprint) conflict();
  if (prior?.status==='published') invalid('This submission has already been published.');
  if (action==='publish') {
    if (data.confirm!=='yes'||prior?.status!=='approved') invalid('An explicit approval and publication confirmation are required.');
    if (!evidence.source || evidence.issue.state!=='open' || evidence.issue.locked ||
        prior.issue_hash!==evidence.fingerprint || prior.source_commit!==evidence.source.sha) conflict();
    const approved = JSON.parse(prior.candidate_json);
    const candidate = registrationCandidate(manifestFromSubmission(evidence.fields,approved.installation),number);
    const row = serverCandidate(candidate);
    const details = JSON.parse(row.details_json);
    details.review = {...candidate.details.review,status:'published',sourceCommit:evidence.source.sha};
    if (evidence.fields.Documentation && evidence.fields.Documentation!=='Not supplied') details.documentationUrl = url(evidence.fields.Documentation,'documentation URL');
    row.details_json = JSON.stringify(details);
    const exact = columns.map(column=>column+' IS ?').join(' AND ');
    await commitMutation(config,actor,insertServer(db,row,'AND EXISTS (SELECT 1 FROM submission_reviews WHERE '+exact+')',columns.map(key=>prior[key])),
      serverAudit('publish-submission',why,null,row), auditId=>[
        db.prepare("UPDATE submission_reviews SET status='published',server_id=?,actor=?,updated_at=? WHERE number=? AND EXISTS (SELECT 1 FROM admin_audit_log WHERE id=?)")
          .bind(row.id,actor,new Date().toISOString(),number,auditId),
        outbox(db,auditId,number,'published','Published on FreeMCP at https://freemcp.in/servers/'+row.id),
      ]);
    return { serverId:row.id };
  }
  const row = {number,status:action,issue_hash:evidence.fingerprint,source_commit:evidence.source?.sha || '',
    candidate_json:'{}',actor,updated_at:new Date().toISOString(),server_id:null};
  if (action==='approved') {
    if (data.confirm!=='yes'||!evidence.source||evidence.issue.state!=='open'||evidence.issue.locked) invalid('Confirm approval for an open issue with verified source.');
    const installation = {command:text(data.command,'command',200,false),endpoint:text(data.endpoint,'endpoint',2048,false),
      args:parsed(data.args || '[]','installation arguments')};
    try {
      const manifest = manifestFromSubmission(evidence.fields,installation);
      const candidate = registrationCandidate(manifest,number);
      if (evidence.fields.Documentation && evidence.fields.Documentation!=='Not supplied') candidate.details.documentationUrl = evidence.fields.Documentation;
      serverCandidate(candidate);
      row.candidate_json = JSON.stringify({installation:manifest.installation});
    } catch (error) {
      if (error instanceof AdminError) throw error;
      invalid('Installation evidence or candidate fields failed validation. Review the submitted instructions.');
    }
  }
  const mutation = prior
    ? db.prepare(`UPDATE submission_reviews SET ${columns.slice(1).map(key=>key+'=?').join(',')} WHERE ${columns.map(key=>key+' IS ?').join(' AND ')} RETURNING number`)
      .bind(...columns.slice(1).map(key=>row[key]),...columns.map(key=>prior[key]))
    : db.prepare('INSERT INTO submission_reviews SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM submission_reviews WHERE number=?) RETURNING number')
      .bind(...columns.map(key=>row[key]),number);
  await commitMutation(config,actor,mutation,{action,entity:'submission',entityId:number,reason:why,
    before:prior&&{status:prior.status},after:{status:action}},auditId=>action==='approved'?[]:[outbox(db,auditId,number,action,why)]);
  return { status:action };
}

export async function retryIssue(config,env,actor,id,why,send=deliverIssueUpdate) {
  if (!appEnabled(config,env)) throw new AdminError(503,'GitHub issue synchronization is disabled.');
  const db = config.db, now = seconds();
  const item = await db.prepare('SELECT * FROM admin_outbox WHERE id=?').bind(id).first();
  if (!item) throw new AdminError(404,'Queue item not found.');
  const claim = db.prepare(`UPDATE admin_outbox SET status='sending',attempts=attempts+1,lease_until=?
    WHERE id=? AND attempts=? AND ((status IN ('pending','failed') AND next_retry<=?) OR (status='sending' AND lease_until<=?)) RETURNING id`)
    .bind(now+240,id,item.attempts,now,now);
  await commitMutation(config,actor,claim,{action:'retry',entity:'outbox',entityId:id,reason:why,before:{status:item.status},after:{status:'sending'}});
  let status = 'sent', message = null;
  try {
    const review = await reviewRow(db,item.issue_number);
    if (review?.status===item.action) await send(env,item);
  } catch {
    status = 'failed';
    message = 'GitHub synchronization failed. Retry after the scheduled delay.';
  }
  const finish = db.prepare("UPDATE admin_outbox SET status=?,lease_until=NULL,next_retry=?,last_error=? WHERE id=? AND status='sending' AND attempts=? RETURNING id")
    .bind(status, status==='failed'?seconds()+Math.min(3600,30*2**Math.min(7,item.attempts)):0,message,id,item.attempts+1);
  await commitMutation(config,actor,finish,{action:status,entity:'outbox',entityId:id,reason:'GitHub synchronization result',before:{status:'sending'},after:{status}});
  return { status };
}
export const submissionVersion = version;
