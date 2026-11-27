import { githubEvidenceMetrics } from './github-evidence.js';
import { resolveTransport, transportLabels } from './transport.js';
import { evidenceMarkdown } from './submission-candidate.js';
import { AdminError, e, html } from './http.js';
import { entityHistory, version } from './audit.js';
import { placements, statuses, themes, getPromotion, promotionPeers } from './promotions.js';
import { defaultTier, sponsorRow } from './sponsors.js';
import { tiers } from '../sponsorship.js';
import { listingLines, listServers, publicServer, serverHistory, serverRow } from './servers.js';
import { candidateEditorState, displaySubmission, listSubmissions, reviewDuplicate, reviewRow } from './submissions.js';
import { appEnabled } from './github.js';
import { registryLifecycle } from '../lifecycle.js';
import { publicListing } from '../registry.js';

const sections = [
  ['Overview','/admin/'], ['Registry','/admin/servers/'], ['Import','/admin/import/'],
  ['Submissions','/admin/submissions/'], ['Promotions','/admin/promotions/'], ['Sponsors','/admin/sponsors/'],
  ['Activity','/admin/activity/'], ['Settings','/admin/settings/'],
];
const summary = (heading, description, action = '') => `<header class="page-heading"><div><h1>${e(heading)}</h1><p>${e(description)}</p></div>${action}</header>`;
const href = (path,label,cls='')=>`<a class="${cls}" href="${e(path)}">${e(label)}</a>`;
const hidden = (name,value)=>`<input type="hidden" name="${e(name)}" value="${e(value)}">`;
const field = (name,label,value='',type='text')=>`<label>${e(label)}<input name="${e(name)}" type="${type}" value="${e(value)}"></label>`;
const area = (name,label,value='',structured=false)=>`<label>${e(label)}<textarea name="${e(name)}" rows="${structured?5:3}" ${structured?'data-structured':''}>${e(value)}</textarea></label>`;
const select = (name,label,items,value)=>`<label>${e(label)}<select name="${e(name)}">${items.map(item=>`<option value="${e(item)}"${item===value?' selected':''}>${e(item)}</option>`).join('')}</select></label>`;
const checkbox = (name,label)=>`<label class="check"><input name="${e(name)}" type="checkbox" value="yes"> ${e(label)}</label>`;
const confirmation = label=>`<label class="check"><input name="confirm" type="checkbox" value="yes" required> ${e(label)}</label>`;
const button = (label,variant='')=>`<button class="${variant}" type="submit">${e(label)}</button>`;
const justification = ()=>'<label>Reason<input name="reason" required maxlength="200" autocomplete="off"></label>';
function form(session, path, action, content, { version: current, enhanced = true } = {}) {
  return `<form method="post" action="${e(path)}" ${enhanced?'data-admin-mutation':''}>${hidden('csrf',session.csrf)}${hidden('action',action)}${current===undefined?'':hidden('version',current)}${content}<div class="form-feedback" role="status" aria-live="polite" tabindex="-1"></div></form>`;
}
const blank = text=>`<p class="empty">${e(text)}</p>`;
function pager(path,page,next,keep = {}) {
  const to = number=>path+'?'+new URLSearchParams({...keep,page:String(number)});
  return `<nav class="pagination" aria-label="Pagination">${page>1?href(to(page-1),'Previous'):'<span></span>'}<span>Page ${page}</span>${next?href(to(page+1),'Next'):'<span></span>'}</nav>`;
}

export function shell(config, session, title, content, path = '', status = 200) {
  const mode = { production:'Production', preview:'Preview', local:'Local fixture' }[config.mode] || 'Unavailable';
  const navigation = session ? `<details class="nav-drawer"><summary>Menu</summary><nav aria-label="Administration">${sections.map(([label,link])=>
    `<a href="${link}"${path===link || link!=='/admin/'&&path.startsWith(link) ? ' aria-current="page"':''}>${label}</a>`).join('')}</nav></details>` : '';
  const bottom=session?`<nav class="bottom-nav" aria-label="Quick navigation">${sections.filter(([label])=>['Overview','Registry','Submissions','Promotions'].includes(label))
    .map(([label,link])=>`<a href="${link}"${(link==='/admin/'?path===link:path.startsWith(link))?' aria-current="page"':''}>${label}</a>`).join('')}</nav>`:'';
  return html(`<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><title>${e(title)} · FreeMCP Admin</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/admin-ui.css"><link rel="stylesheet" href="/sponsor-layout.css"><link rel="stylesheet" href="/promotion-layout.css"><link rel="stylesheet" href="/detail-promotions.css"><script src="/admin-ui.js" defer></script></head><body>
    <a class="skip" href="#content">Skip to content</a><header class="top"><a class="brand" href="/admin/"><img src="/freemcp-mark.svg" alt="" width="31" height="31">FreeMCP Admin</a><div class="top-actions"><span class="environment ${e(config.mode)}">${mode}</span><button type="button" id="theme-toggle" aria-label="Toggle color theme" aria-pressed="false">Theme</button></div></header>
    <div class="layout">${navigation}<main id="content">${content}</main></div>${bottom}</body></html>`,status);
}

export function login(config) {
  return shell(config,null,'Sign in',`<section class="panel signin"><h1>Sign in to FreeMCP Admin</h1><p>Use an authorized maintainer GitHub account.</p>
    <form method="post" action="/admin/oauth/start/">${button('Continue with GitHub','primary')}</form>${href('/','Return to FreeMCP')}</section>`);
}

export async function overview(config,env={}) {
  const [listings,publicCount,promotions,reviews,sync,recent]=await config.db.batch([
    config.db.prepare(`SELECT details_json FROM servers
      WHERE json_extract(CASE WHEN json_valid(details_json) THEN details_json ELSE '{}' END,'$.lifecycle')='archived'`),
    config.db.prepare(`SELECT count(*) AS total, count(*) FILTER(WHERE ${publicListing}) AS published FROM servers`),
    config.db.prepare(`SELECT count(*) AS assignments,count(DISTINCT json_array(eyebrow,headline,description,cta_text,target_url)) AS creatives
      FROM promotions WHERE status='active' AND (starts_at IS NULL OR datetime(starts_at)<=datetime('now'))
      AND (ends_at IS NULL OR datetime(ends_at)>datetime('now'))`),
    config.db.prepare("SELECT count(*) FILTER(WHERE status='clarification') pending,count(*) FILTER(WHERE status='approved') approved FROM submission_reviews"),
    config.db.prepare("SELECT count(*) FILTER(WHERE status IN ('pending','sending')) pending,count(*) FILTER(WHERE status='failed') failed FROM admin_outbox"),
    config.db.prepare('SELECT actor,action,entity,entity_id,created_at FROM admin_audit_log ORDER BY created_at DESC,rowid DESC LIMIT 7'),
  ]);
  const {total,published}=publicCount.results[0];
  const archived=listings.results.filter(row=>{try{return registryLifecycle(JSON.parse(row.details_json))==='archived';}catch{return false;}}).length;
  const ads=promotions.results[0], queue=reviews.results[0], deliveries=sync.results[0];
  let incoming='Unavailable', incomingLabel='Unreviewed GitHub submissions (latest page)';
  try {
    const {items,next}=await listSubmissions(1,env.ADMIN_GITHUB_REVIEW_TOKEN,config);
    const open=items.filter(item=>item.state==='open');
    const previous=open.length?(await config.db.prepare(`SELECT count(*) AS total FROM submission_reviews WHERE number IN (${open.map(()=>'?').join(',')})`).bind(...open.map(item=>item.number)).first()).total:0;
    incoming=open.length-previous;
    if (next) incomingLabel+=' · more pages exist';
  } catch {}
  const metrics=[
    ['Public listings',published,'/admin/servers/?status=public'],
    ['Private or pending listings',total-published,'/admin/servers/?status=draft'],
    ['Archived listings',archived,'/admin/servers/'],
    ['Saved reviews awaiting a decision',queue.pending,'/admin/submissions/'],
    [incomingLabel,incoming,'/admin/submissions/'],
    ['Approved awaiting publication',queue.approved,'/admin/submissions/'],
    ['Live ads / placement assignments',ads.creatives+' / '+ads.assignments,'/admin/promotions/'],
    ['GitHub updates pending / failed',deliveries.pending+' / '+deliveries.failed,'/admin/activity/'],
  ];
  const quick=[['Add MCP server','/admin/servers/new/'],['Import JSON','/admin/import/'],['Review submissions','/admin/submissions/'],['Manage promotions','/admin/promotions/']];
  return summary('Overview','Manage the registry and what appears on FreeMCP.')+
    `<section class="quick-actions" aria-label="Quick actions">${quick.map(([label,path],index)=>href(path,label,index?'button':'button primary')).join('')}</section>
    <div class="metrics">${metrics.map(([label,value,path])=>`<a class="panel metric" href="${e(path)}"><span>${e(label)}</span><strong>${e(value)}</strong></a>`).join('')}</div>
    <p class="count">Live ads are grouped by identical displayed copy and destination. GitHub issue counts normally reuse evidence checked within five minutes.</p>
    <section class="panel"><h2>Recent administrative activity</h2>${recent.results.map(event=>`<div class="history"><strong>${e(event.action)}</strong> · ${e(event.entity)} ${e(event.entity_id)}<p>${e(event.created_at)} · GitHub ID ${e(event.actor)}</p></div>`).join('')||blank('No recent activity.')}${href('/admin/activity/','View all activity','button')}</section>`;
}
export async function registryList(config,params) {
  const {items,total,page} = await listServers(config.db,params);
  const q=params.get('q')||'', status=params.get('status')||'all';
  return summary('Registry','Find published listings and drafts.',href('/admin/servers/new/','New listing','button primary'))+
    `<form class="filters" method="get">${field('q','Search by name or ID',q,'search')}${select('status','Visibility',['all','public','draft'],status)}${button('Filter')}</form>
    <p class="count">${total} listings</p><div class="items">${items.map(row=>`<article class="item"><div><h2>${href('/admin/servers/'+row.id+'/',row.name)}</h2><p>${e(row.id)} · ${e(row.category)}</p></div><span class="status">${row.published?'Public':'Non-public'}</span></article>`).join('')||blank('No matching listings.')}</div>`+
    pager('/admin/servers/',page,page*24<total,{q,status});
}

const pretty = value => JSON.stringify(value ?? [],null,2);
const section=(title,content,open=false)=>`<details class="editor-section"${open?' open':''}><summary>${e(title)}</summary><div class="editor-section-body">${content}</div></details>`;
function exceptionInputs(values={}) {
  return ['tools','prerequisites','security'].map(key=>field('exception_'+key,'Exception reason for '+key,values[key]??'')).join('');
}
function listingEditor(row,{lockedId,keepTransport=false}={}) {
  const d=row.details??{};
  const resolved=resolveTransport(d);
  const display=resolved.modes.map(mode=>transportLabels[mode]).join(' + ');
  const source=resolved.unsupported.length?'Unsupported legacy representation: '+resolved.unsupported.join(', '):
    resolved.ambiguous?'Remote URL present. Its transport is unspecified.':display?'':'Transport genuinely unknown.';
  const transportOptions=[['',keepTransport?(display?'Keep '+display:'Keep existing transport'):'Select a transport'],['stdio','Local stdio'],
    ['http','Streamable HTTP'],['sse','HTTP + SSE'],['unknown','Unknown']];
  return hidden('listingForm','yes')+section('Overview',`<div class="fields">${lockedId?`<p class="immutable">Listing ID <code>${e(lockedId)}</code></p>`:field('id','Listing ID',row.id)}
    ${field('name','Name',row.name)}${field('category','Category',row.category)}${field('author','Maintainer',row.author)}
    ${field('github_url','Repository URL',row.github_url,'url')}${field('stars','GitHub stars',row.stars??0,'number')}
    ${field('implementationKey','Monorepo implementation key',typeof d.implementationKey==='string'?d.implementationKey:'')}
    ${Object.hasOwn(d,'implementationKey')&&typeof d.implementationKey!=='string'?checkbox('clearImplementationKey','Clear the stored legacy implementation key'):''}
    ${area('tags','Tags, one per line',(row.tags??[]).join('\n'))}</div>
    ${area('description','Description',row.description)}${area('summary','Overview',d.summary)}
    ${field('documentationUrl','Primary documentation URL',d.documentationUrl,'url')}
    ${area('documentationUrls','Additional documentation URLs, one per line',listingLines(d.documentationUrls))}
    ${area('pricing','Pricing',d.pricing)}${area('serviceDependencies','Service dependencies, one per line',listingLines(d.serviceDependencies))}`,true)+
    section('Installation',`<p><strong>${e(display||'No resolved transport')}</strong>${source?' · '+e(source):''}</p>
    <label>Transport<select name="transport">${transportOptions.map(([value,title])=>`<option value="${value}"${value===(!keepTransport?(resolved.modes[0]??''):'')?' selected':''}>${title}</option>`).join('')}</select></label>
    ${area('transports','Transport list, one per line (optional override)',keepTransport?'':resolved.modes.join('\n'))}
    ${area('installations','Installations',pretty(d.installations),true)}${area('endpoints','MCP endpoints',pretty(d.endpoints),true)}
    ${area('prerequisites','Prerequisites, one per line',listingLines(d.prerequisites))}`)+
    section('Tools',area('tools','Tools',pretty(d.tools),true))+
    section('Security',area('security','Security considerations, one per line',listingLines(d.security))+
      area('sharedEndpoints','Reviewed shared endpoints (listing ID and reason)',JSON.stringify(row.sharedEndpoints??d.review?.sharedEndpoints??{},null,2),true)+
      checkbox('confirmSharedEndpoints','Confirm new or changed shared endpoint exceptions'));
}

export async function registryForm(config,session,id) {
  const raw=id?await serverRow(config.db,id):null;
  if (id&&!raw) return null;
  const row=publicServer(raw)||{details:{},tags:[],stars:0};
  const current=await version(raw);
  const d=row.details, api='/api/admin/servers/'+(id?id+'/':'');
  const live=!Object.hasOwn(d,'review')||d.review?.status==='published';
  const fields=listingEditor(row,{lockedId:id,keepTransport:Boolean(id)})+
    `${justification()}${id&&live?confirmation('Apply these edits to the public listing.'):''}
    <div class="row-actions editor-actions"><span class="unsaved" hidden>Unsaved changes</span>
    ${id?'<button type="submit" name="action" value="preview-edit" formnovalidate data-editor-preview>Review proposed edits</button>':''}
    <button type="submit" name="action" value="preview-listing" formnovalidate formtarget="_blank" data-editor-preview>Preview unsaved listing</button>
    ${button(id?'Save changes':'Create draft','primary')}</div>`;
  const edit=summary(id?row.name:'New listing',id?(live?'Public listing':'Private draft'):'Drafts stay private until explicitly published.',id?href('/admin/servers/'+id+'/?preview=1','Preview','button'):'')+
    `<div class="panel">${form(session,api,id?'save':'create',fields,{version:current})}</div>`;
  if (!id) return edit;
  const archived = registryLifecycle(d) === 'archived';
  const viaSubmission = !live && d.review?.source==='approved-submission' && Number.isSafeInteger(d.review?.issue);
  const actions = [
    ...(viaSubmission?[]:[[live?'unpublish':'publish',live?'Unpublish listing':'Publish listing',true]]),
    [archived?'unarchive':'archive',archived?'Mark maintained':'Mark archived',false],
  ];
  const log=(await serverHistory(config.db,id)).results;
  return edit+`<details class="panel editor-section"><summary>Publication and lifecycle</summary><div class="editor-section-body">${viaSubmission?href('/admin/submissions/'+d.review.issue+'/','Return to submission review','button'):''}<div class="forms">${actions.map(([action,label,confirm])=>
    form(session,api,action,`<h3>${label}</h3>${action==='publish'?exceptionInputs(d.review?.exceptions):''}${justification()}${confirm?confirmation('Confirm this publication change.'):''}${button(label)}`,{version:current})).join('')}</div></div></details>
    ${historyPanel(session,api,current,log)}`;
}

function fieldChanges(event) {
  const before=JSON.parse(event.before_json)||{}, after=JSON.parse(event.after_json)||{};
  const changed=after.changedFields;
  if (!Array.isArray(changed)) return `<pre>${e(event.before_json)}\n→ ${e(event.after_json)}</pre>`;
  return changed.length?`<dl>${changed.map(key=>{
    const visible=Object.hasOwn(before,key)||Object.hasOwn(after,key);
    return `<dt>${e(key)}</dt><dd>${visible?e(pretty(before[key]))+' → '+e(pretty(after[key])):'Changed · values hidden'}</dd>`;
  }).join('')}</dl>`:blank('No tracked fields changed.');
}
function historyPanel(session,api,current,log) {
  return `<details class="panel editor-section"><summary>History</summary><div class="editor-section-body">${log.map(event=>`<div class="history"><p><strong>${e(event.action)}</strong> · ${e(event.created_at)} · GitHub ID ${e(event.actor)}</p><p>${e(event.reason)}</p>
    <details><summary>Field changes</summary>${fieldChanges(event)}</details>
    ${event.recoverable&&!['create','create-import','duplicate'].includes(event.action)?`<details><summary>Restore previous values</summary>${form(session,api,'restore',
      hidden('revision',event.id)+justification()+confirmation('Restore the previous editable values.')+button('Restore revision'),{version:current})}</details>`:''}</div>`).join('')||blank('No administrative history yet.')}</div></details>`;
}

export async function changePreview(session, current, next, proposed) {
  const before = publicServer(current), after = publicServer(next);
  const basic = ['name','description','category','author','github_url','stars','tags'];
  const rich = ['summary','documentationUrl','documentationUrls','transport','transports','pricing','serviceDependencies','implementationKey','installations','tools','endpoints','prerequisites','security'];
  const diffValue=value=>value===undefined?'(not set)':JSON.stringify(value,null,2);
  const fields = [...basic.map(key=>[key,before[key],after[key]]),
    ...rich.map(key=>[key,before.details[key],after.details[key]]),
    ['Shared endpoint exceptions',before.details.review?.sharedEndpoints,after.details.review?.sharedEndpoints]]
    .filter(([,from,to])=>JSON.stringify(from)!==JSON.stringify(to));
  const data = Object.fromEntries(Object.entries(proposed).filter(([key])=>!['csrf','action','version','confirm','reason'].includes(key)));
  const content = summary('Review proposed edits','Compare the current listing with the proposed values.',`<a class="button" data-confirm-discard href="/admin/servers/${e(current.id)}/">Back to editor</a>`)+
    `<section class="panel">${fields.map(([label,from,to])=>`<div class="history"><h2>${e(label)}</h2><div class="fields"><div><strong>Current</strong><pre>${e(diffValue(from))}</pre></div><div><strong>Proposed</strong><pre>${e(diffValue(to))}</pre></div></div></div>`).join('')||blank('No editable values changed.')}</section>`+
    `${fields.length?`<section class="panel">${form(session,'/api/admin/servers/'+current.id+'/','save',hidden('reviewed',JSON.stringify(data))+
      justification()+confirmation('Apply these reviewed edits.')+button('Apply edits','primary'),{version:await version(current)})}</section>`:''}`;
  return content;
}

export function importPage(session,input='',results=null,outcomes=null) {
  return summary('Import candidates','Validate a FreeMCP manifest or a list of registry entries against the current database.')+
    `<div class="panel">${form(session,'/api/admin/import/','validate',area('input','Candidate JSON',input)+button('Validate candidates','primary'),{enhanced:false})}</div>`+
    (results?`<section class="panel"><h2>Validation results</h2><p>${results.filter(item=>!item.error).length} of ${results.length} candidates can be selected.</p>
      ${form(session,'/api/admin/import/','create',hidden('input',input)+results.map(item=>item.error
        ? `<p class="error-text">Candidate ${item.index+1} · ${e(item.error)}</p>`
        : `<div class="history"><label class="check"><input type="checkbox" name="candidate_${item.index}" value="yes"> ${e(item.row.name)} · ${e(item.row.id)}</label>
          ${item.unsupported?.length?`<p>Excluded fields: ${item.unsupported.map(e).join(', ')}</p>`:''}</div>`).join('')+
        (results.some(item=>!item.error)?justification()+confirmation('Create the selected listings as private drafts.')+button('Create selected drafts','primary'):''),
        {enhanced:false})}</section>`:'')+
    (outcomes?`<section class="panel"><h2>Import results</h2>${outcomes.map(item=>item.error
      ? `<p class="error-text">Candidate ${item.index+1} · ${e(item.error)}</p>`
      : `<p>Created private draft · ${href('/admin/servers/'+item.id+'/',item.id)}</p>`).join('')}</section>`:'');
}

export async function submissionsList(config,params,env) {
  const page=pageNumber(params);
  let items=[],next=false,notice='';
  try {
    const result=await listSubmissions(page,env.ADMIN_GITHUB_REVIEW_TOKEN,config);
    ({items,next}=result);
    notice=evidenceNotice(result.checkedAt,result.stale,result.warning);
  } catch(error) {
    if (!(error instanceof AdminError)) throw error;
    notice=`<p class="notice">${e(error.message)}</p>`;
  }
  const drafts=(await config.db.prepare(`SELECT number,updated_at,json_extract(candidate_json,'$.candidate.name') title
    FROM submission_reviews WHERE status='clarification' AND json_type(candidate_json,'$.candidate')='object'
    ORDER BY updated_at DESC LIMIT 40`).all()).results;
  const numbers=items.map(item=>item.number);
  const local=numbers.length?(await config.db.prepare(`SELECT number,status,json_type(candidate_json,'$.candidate')='object' AS has_candidate FROM submission_reviews WHERE number IN (${numbers.map(()=>'?').join(',')})`).bind(...numbers).all()).results:[];
  const statuses=new Map(local.map(row=>[row.number,row.status==='clarification'&&row.has_candidate?'Draft':row.status]));
  return summary('Submissions','Review GitHub issue submissions and publish approved candidates.')+notice+
    (drafts.length?`<section class="panel"><h2>Saved drafts</h2><ul>${drafts.map(item=>`<li>${href('/admin/submissions/'+item.number+'/',item.title||'Draft #'+item.number)} · #${item.number}</li>`).join('')}</ul></section>`:'')+`<div class="items">${items.map(item=>
    `<article class="item"><div><h2>${href('/admin/submissions/'+item.number+'/',item.title)}</h2><p>#${e(item.number)} · ${e(item.state)} · ${e(item.updated_at)}</p></div>
     <span class="status">${e(statuses.get(item.number)||'Unreviewed')}</span></article>`).join('')||blank('No matching submissions on this page.')}</div>`+
    pager('/admin/submissions/',page,next);
}
export function pageNumber(params) {
  const raw=params.get('page');
  return raw && /^[1-9][0-9]{0,3}$/.test(raw) ? Number(raw) : 1;
}
function evidenceNotice(checkedAt,stale,warning) {
  const timestamp=checkedAt?new Date(checkedAt*1000).toISOString().replace('T',' ').replace('.000Z',' UTC'):'unavailable';
  return `<p class="${stale?'notice':'count'}">${e((stale?'Cached evidence may be stale. ':'')+'GitHub evidence checked: '+timestamp+'.')} ${e(warning)}</p>`;
}
export async function submissionPage(config,session,number,params,env) {
  const page=pageNumber(params);
  const [prior,history]=await Promise.all([
    reviewRow(config.db,number),
    config.db.prepare("SELECT actor,action,reason,created_at FROM admin_audit_log WHERE entity='submission' AND entity_id=? ORDER BY created_at DESC,rowid DESC LIMIT 30").bind(String(number)).all(),
  ]);
  const evidence=await displaySubmission(config,number,prior,{commentsPage:page,readme:true,
    readToken:env.ADMIN_GITHUB_REVIEW_TOKEN,refresh:params.get('refresh')==='1'});
  const current=await version(prior);
  const duplicate=await reviewDuplicate(config,evidence,prior);
  const api='/api/admin/submissions/'+number+'/';
  const base=hidden('fingerprint',evidence.fingerprint);
  const {candidate,normalized,saved,linked}=await candidateEditorState(config,evidence,prior);
  const published=prior?.status==='published';
  const state=published?'Published':prior?.status==='approved'?'Approved · awaiting publication':
    saved.candidate?'Editable draft':prior?.server_id?'Previously published · needs review':prior?.status??'Unreviewed';
  const editor=published?href('/admin/servers/'+prior.server_id+'/','Open published listing','button'):
    form(session,api,'save-candidate',base+listingEditor(candidate,{lockedId:linked?.id,keepTransport:Boolean(saved.candidate||linked)})+
      section('Advanced JSON editor',area('candidateJson','Candidate JSON',JSON.stringify(candidate,null,2))+
        checkbox('useAdvanced','Use this JSON instead of the structured fields'))+
      section('Reviewed publication exceptions',exceptionInputs(saved.exceptions))+
      justification()+`<div class="row-actions editor-actions"><span class="unsaved" hidden>Unsaved changes</span>
        <button type="submit" name="action" value="validate-candidate" formnovalidate>Validate candidate</button>
        <button type="submit" name="action" value="preview-candidate" formnovalidate formtarget="_blank" data-editor-preview>Preview listing</button>
        ${button('Save candidate draft','primary')}</div>`,{version:current});
  const actions=published?'':`<section class="panel" id="approval"><h2>Approval</h2>
    ${saved.candidate&&prior.status!=='approved'?form(session,api,'approved',base+
      confirmation('Approve the saved candidate and its reviewed source.')+justification()+button('Approve candidate'),{version:current}):
      blank(prior?.status==='approved'?'The saved candidate is approved.':'Save and validate the candidate before approval.')}
    ${section('Other review decisions',[['clarification','Request clarification'],['rejected','Reject submission']].map(([action,label])=>
      form(session,api,action,base+justification()+button(label),{version:current})).join(''))}
    </section><section class="panel" id="publication"><h2>Publication</h2>
    ${prior?.status==='approved'?form(session,api,'publish',base+confirmation('Publish this approved candidate on FreeMCP.')+
      justification()+button('Publish listing','primary'),{version:current}):blank('Publication becomes available after explicit approval.')}</section>`;
  return summary(evidence.issue.title,'#'+number+' · '+state,href('https://github.com/strbbrn/freemcp-registry/issues/'+number,'Open GitHub issue','button'))+
    `<nav class="stage-links" aria-label="Review stages">${[['evidence','Evidence'],['source','Source'],['candidate','Candidate'],['approval','Approval'],['publication','Publication']].filter(([id])=>!published||!['approval','publication'].includes(id)).map(([id,label])=>href('#'+id,label)).join('')}</nav>
    <section class="panel" id="evidence"><h2>Original submission and discussion</h2>
    ${section('Original issue',`<div class="markdown">${evidenceMarkdown(evidence.original)}</div>`+section('Original Markdown','<pre>'+e(evidence.original)+'</pre>'))}
    ${section('Discussion',(evidence.comments?.items??[]).map(c=>`<div class="history"><strong>${e(c.author)}</strong> <time>${e(c.date)}</time><div class="markdown">${evidenceMarkdown(c.body)}</div></div>`).join('')||blank(evidence.comments?'No comments on this page.':'Discussion is unavailable offline.'))}
    ${pager('/admin/submissions/'+number+'/',page,evidence.comments?.next,params.get('refresh')==='1'?{refresh:'1'}:{})}</section>
    <section class="panel" id="source"><h2>Source evidence and automated findings</h2>
    ${evidenceNotice(evidence.checkedAt,evidence.stale)}
    ${href('/admin/submissions/'+number+'/?refresh=1#source','Refresh GitHub evidence','button')}
    ${evidence.sourceCheckedAt?evidenceNotice(evidence.sourceCheckedAt,evidence.stale,'Source repository and commit.') : ''}
    ${evidence.savedSourceCommit?`<p>Saved source commit <code>${e(evidence.savedSourceCommit)}</code></p>`:''}
    ${evidence.source?`<p>${e(evidence.source.name)} · ${e(evidence.source.branch)} · ${e(evidence.source.license||'License not reported')}</p><p><code>${e(evidence.source.sha)}</code></p>`:blank('Upstream source could not be verified.')}
    <ul>${[...evidence.findings.findings,...evidence.findings.warnings].map(line=>'<li>'+e(line)+'</li>').join('')}</ul>
    ${duplicate?`<p class="error-text">Possible live registry duplicate · ${href('/admin/servers/'+duplicate.id+'/',duplicate.id)}</p>`:''}
    ${evidence.headings.length?section('README evidence headings','<ul>'+evidence.headings.map(x=>'<li>'+e(x)+'</li>').join('')+'</ul>'):''}
    ${section('Normalized starting candidate','<pre>'+e(JSON.stringify(normalized,null,2))+'</pre>')}
    </section><section class="panel" id="candidate"><h2>Registration candidate</h2>
    <p>Edits are private. Saving a change clears any earlier approval. Validate the fields and check the public layout before approval.</p>
    ${saved.candidate?section('Saved maintainer changes',`<ul>${Object.keys(normalized).flatMap(key=>key==='details'?Object.keys({...normalized.details,...candidate.details}).filter(field=>field!=='review'&&JSON.stringify(normalized.details[field])!==JSON.stringify(candidate.details[field])).map(field=>'<li>'+e(field)+'</li>'):JSON.stringify(normalized[key])!==JSON.stringify(candidate[key])?['<li>'+e(key)+'</li>']:[]).join('')||'<li>No changes from normalization</li>'}</ul>`):''}
    ${editor}</section>${actions}
    <section class="panel"><h2>Review history</h2>${history.results.map(event=>`<div class="history"><strong>${e(event.action)}</strong> · GitHub ID ${e(event.actor)} · ${e(event.created_at)}<p>${e(event.reason)}</p></div>`).join('')||blank('No previous decisions yet.')}</section>`;
}

const placementCheckboxes = () => `<fieldset><legend>Placements</legend><div class="slot-grid">${placements.map(item=>`<label class="check"><input type="checkbox" name="slot_${item}" value="yes"> ${item.replace('/',' · ')}</label>`).join('')}</div></fieldset>`;
export async function promotionsPage(config,session,params) {
  const id=params.get('id');
  const row=id?await getPromotion(config.db,id):null;
  if (id&&!row) return null;
  if (row && params.get('preview')==='1') return summary(row.headline,'Private promotion preview',href('/admin/promotions/?id='+encodeURIComponent(id),'Back to editor','button'))+
    promotionPreview(row)+`<p class="count">${e(row.placement)} · ${e(row.slot)} · ${e(row.status)}</p>`;
  if (row || params.has('new')) {
    const x=row||{eyebrow:'PROMOTED',cta_text:'Learn more',theme:'violet',weight:1,rotation_seconds:7,status:'draft'};
    const api='/api/admin/promotions/'+(id?encodeURIComponent(id)+'/':'');
    const current=await version(row);
    const peers=row?await promotionPeers(config.db,row):[];
    const otherPlacements=await Promise.all(peers.map(async peer=>checkbox('also_'+peer.id,'Apply to '+peer.placement+' · '+peer.slot+' ('+peer.status+')')+
      hidden('version_'+peer.id,await version(peer))));
    return summary(row?row.headline:'New promotion','Set placement, status and optional schedule in UTC.',row?href('/admin/promotions/?id='+encodeURIComponent(id)+'&preview=1','Preview','button'):'')+
      `<section class="panel">${form(session,api,row?'save':'create',
        `<div class="fields">${row?'':field('id','Promotion ID')}${field('headline','Headline',x.headline)}${field('eyebrow','Eyebrow',x.eyebrow)}
        ${field('cta_text','Button text',x.cta_text)}${field('target_url','HTTPS destination',x.target_url,'url')}
        ${select('theme','Theme',themes,x.theme)}${select('status','Status',statuses,x.status)}
        ${field('weight','Weight',x.weight,'number')}${field('rotation_seconds','Rotation in seconds',x.rotation_seconds,'number')}
        ${field('starts_at','Start time (UTC)',x.starts_at?.replace(' ','T').slice(0,16),'datetime-local')}
        ${field('ends_at','End time (UTC)',x.ends_at?.replace(' ','T').slice(0,16),'datetime-local')}</div>
        ${row?select('selection','Placement',placements,row.placement+'/'+row.slot):placementCheckboxes()}
        ${otherPlacements.length?section('Apply changes to matching placements',otherPlacements.join('')):''}
        ${area('description','Description',x.description)}${justification()}${checkbox('confirm','Confirm changes to public promotions')}${button(row?'Save promotion':'Create promotion','primary')}`,{version:current})}</section>`+
      (row?`<section class="panel"><h2>Actions</h2><div class="forms">${form(session,api,row.status==='active'?'pause':'activate',
        justification()+confirmation(row.status==='active'?'Pause this public promotion.':'Activate this public promotion.')+button(row.status==='active'?'Pause promotion':'Activate promotion'),{version:current})}
        ${form(session,api,'duplicate',field('id','New promotion ID')+placementCheckboxes()+justification()+button('Duplicate as draft'),{version:current})}</div></section>`+
        historyPanel(session,api,current,(await entityHistory(config.db,'promotion',id)).results):'');
  }
  const page=pageNumber(params), term=(params.get('q')||'').slice(0,120), selection=params.get('selection')||'all', status=params.get('status')||'all';
  const [place,slot]=placements.includes(selection)?selection.split('/'):[null,null];
  const selected=statuses.includes(status)?status:null;
  const {results}=await config.db.prepare(`SELECT *,CASE WHEN status='active' AND starts_at IS NOT NULL AND datetime(starts_at)>datetime('now') THEN 'scheduled'
    WHEN status='active' AND ends_at IS NOT NULL AND datetime(ends_at)<=datetime('now') THEN 'ended' ELSE status END AS display_status
    FROM promotions WHERE (?='' OR instr(lower(headline||' '||id),lower(?))>0)
    AND (? IS NULL OR (placement=? AND slot=?)) AND (? IS NULL OR status=?)
    ORDER BY updated_at DESC,id LIMIT 25 OFFSET ?`).bind(term,term,place,place,slot,selected,selected,(page-1)*24).all();
  return summary('Promotions','Manage scheduling and all eight advertising placements.',href('/admin/promotions/?new=1','New promotion','button primary'))+
    `<form method="get" class="filters">${field('q','Search promotions',term,'search')}${select('selection','Placement',['all',...placements],selection)}
    ${select('status','Status',['all',...statuses],status)}${button('Filter')}</form><div class="items">${results.slice(0,24).map(x=>
      `<article class="item"><div><h2>${href('/admin/promotions/?id='+encodeURIComponent(x.id),x.headline)}</h2><p>${e(x.placement)} · ${e(x.slot)}</p></div><span class="status">${e(x.display_status)}</span></article>`).join('')||blank('No matching promotions.')}</div>`+
      pager('/admin/promotions/',page,results.length>24,{q:term,selection,status});
}

function promotionPreview(row) {
  const content=`<span class="promo-label">FreeMCP promotion</span><span class="promo-eyebrow">${e(row.eyebrow)}</span>`;
  if (row.placement==='detail') return `<aside data-detail-promo="${e(row.slot)}"><div class="dp-card" data-theme="${e(row.theme)}"><div class="dp-inner">
    <div class="dp-top"><span class="dp-sponsored">FreeMCP promotion</span><span class="dp-eyebrow">${e(row.eyebrow)}</span></div>
    <h2 class="dp-title">${e(row.headline)}</h2><p class="dp-desc">${e(row.description)}</p><span class="dp-link">${e(row.cta_text)} ↗</span></div></div></aside>`;
  return `<aside class="promo-slot" data-format="${e(row.slot)}"><div class="promo-frame" data-theme="${e(row.theme)}"><div class="promo-orb" aria-hidden="true"></div>
    <div class="promo-content"><div class="promo-top">${content}</div><h2 class="promo-headline">${e(row.headline)}</h2>
    <p class="promo-description">${e(row.description)}</p><span class="promo-link">${e(row.cta_text)} ↗</span></div></div></aside>`;
}
function sponsorPreview(tier,row) {
  const icon={gold:'✦',diamond:'◇',platinum:'✧'}[tier];
  return `<article class="sponsor-tier ${tier}"><span class="tier-shine" aria-hidden="true"></span><div class="tier-icon" aria-hidden="true">${icon}</div>
    <span class="tier-label">${tier.toUpperCase()} SPONSOR</span><h3>${e(row.name)}</h3><p>${e(row.description)}</p>
    <a href="#sponsorship-${tier}" aria-label="Preview of ${e(row.cta_text)}">${e(row.cta_text)} <span aria-hidden="true">↗</span></a></article>`;
}
export async function sponsorsPage(config,session) {
  return summary('Sponsorships','Edit the Gold, Diamond and Platinum tiers. Drafts keep the default public card. Paused tiers are hidden.')+
    (await Promise.all(tiers.map(async tier=>{
      const base=defaultTier(tier), saved=await sponsorRow(config.db,tier), row=saved||base;
      const api='/api/admin/sponsors/'+tier+'/', current=await version(saved);
      const preview=section(row.status==='paused'?'Preview saved card · hidden publicly':row.status==='draft'?'Preview draft card':'Preview active card',sponsorPreview(tier,row));
      const edit=form(session,api,'save',field('name','Tier name',row.name)+area('description','Description',row.description)+field('cta_text','Button text',row.cta_text)+
        field('target_url','Contact link',row.target_url)+select('status','Status',['draft','active','paused'],row.status)+justification()+
        checkbox('confirm','Confirm changes to the public homepage')+button('Save tier'),{version:current});
      return `<details class="panel editor-section" id="sponsorship-${tier}"><summary>${e(base.name)} · ${e(saved?.status??'Default')}</summary>
        <div class="editor-section-body">${preview}${edit}${saved?historyPanel(session,api,current,(await entityHistory(config.db,'sponsor',tier)).results):''}</div></details>`;
    }))).join('');
}

export async function activityPage(config,session,env,params) {
  const page=pageNumber(params);
  const [audit, outbox]=await config.db.batch([
    config.db.prepare('SELECT * FROM admin_audit_log ORDER BY created_at DESC,rowid DESC LIMIT 31 OFFSET ?').bind((page-1)*30),
    config.db.prepare("SELECT * FROM admin_outbox ORDER BY CASE WHEN status='sent' THEN 1 ELSE 0 END,created_at DESC,rowid DESC LIMIT 30"),
  ]);
  const enabled=appEnabled(config,env);
  return summary('Activity','Administrative changes and pending GitHub notifications.')+
    `<section class="panel"><h2>GitHub synchronization</h2><p>${enabled?'Enabled for this repository.':'Disabled in this environment.'}</p>
      ${outbox.results.map(item=>`<div class="history"><p><strong>Issue #${item.issue_number}</strong> · ${e(item.action)} · ${e(item.resolution??(item.status==='sent'?'Completed before outcomes were tracked':item.status))}</p>${item.last_error?`<p>${e(item.last_error)}</p>`:''}
      ${enabled&&item.status!=='sent'?form(session,'/api/admin/outbox/'+item.id+'/','retry',justification()+button('Retry GitHub update')):''}</div>`).join('')||blank('No GitHub updates.')}</section>
    <section class="panel"><h2>Audit log</h2>${audit.results.slice(0,30).map(event=>`<div class="history"><p><strong>${e(event.action)}</strong> · ${e(event.entity)} <code>${e(event.entity_id)}</code></p>
      <p>${e(event.created_at)} · GitHub ID ${e(event.actor)}</p><p>${e(event.reason)}</p>
      <details><summary>Field changes</summary>${fieldChanges(event)}</details></div>`).join('')||blank('No administrative activity yet.')}${pager('/admin/activity/',page,audit.results.length>30)}</section>`;
}

export async function settingsPage(config,session,env) {
  const metrics=await githubEvidenceMetrics(config);
  return summary('Settings','Manage your current session and review environment settings.')+`<section class="panel"><h2>Session</h2><dl><dt>GitHub account</dt><dd>${e(session.login)} · ${e(session.actor)}</dd>
    <dt>Expires</dt><dd>${e(new Date(session.expires_at*1000).toISOString())}</dd><dt>Admin origin</dt><dd>${e(config.origin)}</dd>
    <dt>GitHub synchronization</dt><dd>${appEnabled(config,env)?'Enabled':'Disabled'}</dd></dl><div class="forms">
    ${form(session,'/api/admin/session/','rotate',button('Refresh session'),{enhanced:false})}
    ${form(session,'/api/admin/session/','logout',button('Sign out'),{enhanced:false})}
    ${form(session,'/api/admin/session/','revoke',confirmation('Revoke all sessions for this account.')+button('Revoke all sessions'),{enhanced:false})}</div></section>
    <section class="panel"><h2>GitHub evidence reads</h2><p>Read credential ${env.ADMIN_GITHUB_REVIEW_TOKEN?'configured':'missing · using anonymous requests'}.</p>
    ${metrics?`<dl>${[['Outbound requests',metrics.requests],['Fresh cache hits',metrics.cacheHits],['Stale fallbacks',metrics.staleHits],
      ['Conditional requests',metrics.conditional],['Not modified',metrics.notModified],['Rate-limit responses',metrics.rateLimited]]
      .map(([label,value])=>`<dt>${label}</dt><dd>${value}</dd>`).join('')}</dl>`:blank('No counters available yet.')}</section>`;
}
