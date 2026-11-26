import { e, html } from './http.js';
import { version } from './audit.js';
import { placements, statuses, themes, getPromotion } from './promotions.js';
import { defaultTier, sponsorRow } from './sponsors.js';
import { tiers } from '../sponsorship.js';
import { listServers, publicServer, serverHistory, serverRow } from './servers.js';
import { listSubmissions, reviewRow, submission } from './submissions.js';
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
const confirmation = label=>`<label class="check"><input name="confirm" type="checkbox" value="yes" required> ${e(label)}</label>`;
const button = (label,variant='')=>`<button class="${variant}" type="submit">${e(label)}</button>`;
const justification = ()=>'<label>Reason<input name="reason" required maxlength="200" autocomplete="off"></label>';
function form(session, path, action, content, { version: current, enhanced = true } = {}) {
  return `<form method="post" action="${e(path)}" ${enhanced?'data-admin-mutation':''}>${hidden('csrf',session.csrf)}${hidden('action',action)}${current===undefined?'':hidden('version',current)}${content}<p class="form-feedback" role="status" aria-live="polite"></p></form>`;
}
const blank = text=>`<p class="empty">${e(text)}</p>`;
function pager(path,page,next,keep = {}) {
  const to = number=>path+'?'+new URLSearchParams({...keep,page:String(number)});
  return `<nav class="pagination" aria-label="Pagination">${page>1?href(to(page-1),'Previous'):'<span></span>'}<span>Page ${page}</span>${next?href(to(page+1),'Next'):'<span></span>'}</nav>`;
}

export function shell(config, session, title, content, path = '', status = 200) {
  const mode = { production:'Production', preview:'Preview', local:'Local fixture' }[config.mode] || 'Unavailable';
  const navigation = session ? `<nav aria-label="Administration">${sections.map(([label,link])=>
    `<a href="${link}"${path===link || link!=='/admin/'&&path.startsWith(link) ? ' aria-current="page"':''}>${label}</a>`).join('')}</nav>` : '';
  return html(`<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${e(title)} · FreeMCP Admin</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/admin-ui.css"><script src="/admin-ui.js" defer></script></head><body>
    <a class="skip" href="#content">Skip to content</a><header class="top"><a class="brand" href="/admin/"><img src="/freemcp-mark.svg" alt="" width="31" height="31">FreeMCP Admin</a><div class="top-actions"><span class="environment ${e(config.mode)}">${mode}</span><button type="button" id="theme-toggle" aria-label="Toggle color theme" aria-pressed="false">Theme</button></div></header>
    <div class="layout">${navigation}<main id="content">${content}</main></div></body></html>`,status);
}

export function login(config) {
  return shell(config,null,'Sign in',`<section class="panel signin"><h1>Sign in to FreeMCP Admin</h1><p>Use an authorized maintainer GitHub account.</p>
    <form method="post" action="/admin/oauth/start/">${button('Continue with GitHub','primary')}</form>${href('/','Return to FreeMCP')}</section>`);
}

export async function overview(config) {
  const [servers, promotions, submissions, sync] = await config.db.batch([
    config.db.prepare(`SELECT count(*) AS total,sum(CASE WHEN ${publicListing} THEN 1 ELSE 0 END) AS published FROM servers`),
    config.db.prepare("SELECT count(*) AS total,sum(CASE WHEN status='active' AND (starts_at IS NULL OR datetime(starts_at)<=datetime('now')) AND (ends_at IS NULL OR datetime(ends_at)>datetime('now')) THEN 1 ELSE 0 END) AS active FROM promotions"),
    config.db.prepare("SELECT count(*) AS total FROM submission_reviews WHERE status='approved'"),
    config.db.prepare("SELECT count(*) AS total FROM admin_outbox WHERE status<>'sent'"),
  ]);
  const listing = servers.results[0], ads = promotions.results[0];
  const metrics = [
    ['Public listings',listing.published || 0,'/admin/servers/?status=public'],
    ['Non-public listings',listing.total-(listing.published || 0),'/admin/servers/?status=draft'],
    ['Live promotions',ads.active||0,'/admin/promotions/'],
    ['Approved submissions',submissions.results[0].total,'/admin/submissions/'],
    ['Pending GitHub updates',sync.results[0].total,'/admin/activity/'],
  ];
  return summary('Overview','Manage the registry and what appears on FreeMCP.')+`<div class="metrics">${metrics.map(([label,value,path])=>
    `<a class="panel metric" href="${e(path)}"><span>${label}</span><strong>${value}</strong></a>`).join('')}</div>`;
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
export async function registryForm(config,session,id,preview) {
  const raw=id?await serverRow(config.db,id):null;
  if (id&&!raw) return null;
  const row=publicServer(raw)||{details:{},tags:[],stars:0};
  const current=await version(raw);
  const d=row.details, api='/api/admin/servers/'+(id?id+'/':'');
  const live=!Object.hasOwn(d,'review')||d.review?.status==='published';
  if (preview && id) {
    return summary(row.name,'Private listing preview',href('/admin/servers/'+id+'/','Back to editor','button'))+
      `<article class="panel preview"><p>${e(row.category)} · ${e(row.author)}</p><h2>Overview</h2><p>${e(row.description)}</p><p>${e(d.summary)}</p>
        <h2>Installation</h2>${(d.installations||[]).map(item=>`<h3>${e(item.title)}</h3><p>${e(item.notes)}</p><pre>${e(pretty(item.config))}</pre>`).join('')||blank('No installations supplied.')}
        <h2>Tools and requirements</h2><ul>${(d.tools||[]).map(x=>'<li>'+e(x.name)+' · '+e(x.description)+'</li>').join('')}${(d.prerequisites||[]).map(x=>'<li>'+e(x)+'</li>').join('')}</ul>
        <h2>Security</h2><ul>${(d.security||[]).map(x=>'<li>'+e(x)+'</li>').join('')}</ul></article>`;
  }
  const fields = `<div class="fields">${id?`<p class="immutable">Listing ID <code>${e(id)}</code></p>`:field('id','Listing ID')}${field('name','Name',row.name)}
    ${field('category','Category',row.category)}${field('author','Maintainer',row.author)}
    ${field('github_url','Repository URL',row.github_url,'url')}${field('stars','GitHub stars',row.stars,'number')}
    ${select('transport','Transport',['unknown','stdio','http','sse'],d.transport||'unknown')}${field('implementationKey','Monorepo implementation key',d.implementationKey)}
    ${field('documentationUrl','Documentation URL',d.documentationUrl,'url')}${area('tags','Tags, one per line',row.tags.join('\n'))}</div>
    ${area('description','Description',row.description)}${area('summary','Overview',d.summary)}
    ${area('prerequisites','Prerequisites, one per line',d.prerequisites?.join('\n'))}${area('security','Security considerations, one per line',d.security?.join('\n'))}
    ${area('installations','Installations',pretty(d.installations),true)}${area('tools','Tools',pretty(d.tools),true)}${area('endpoints','MCP endpoints',pretty(d.endpoints),true)}
    ${justification()}${id&&live?confirmation('Apply these edits to the public listing.'):''}<div class="row-actions">${id?'<button type="submit" name="action" value="preview-edit" formnovalidate>Review proposed edits</button>':''}${button(id?'Save changes':'Create draft','primary')}</div>`;
  const edit=summary(id?row.name:'New listing',id?(live?'Public listing':'Private draft'):'Drafts stay private until explicitly published.',id?href('/admin/servers/'+id+'/?preview=1','Preview','button'):'')+
    `<div class="panel">${form(session,api,id?'save':'create',fields,{version:current})}</div>`;
  if (!id) return edit;
  const archived = registryLifecycle(d) === 'archived';
  const actions = [
    [live?'unpublish':'publish',live?'Unpublish listing':'Publish listing',true],
    [archived?'unarchive':'archive',archived?'Mark maintained':'Mark archived',false],
  ];
  const log=(await serverHistory(config.db,id)).results;
  return edit+`<section class="panel"><h2>Publication and lifecycle</h2><div class="forms">${actions.map(([action,label,confirm])=>
    form(session,api,action,`<h3>${label}</h3>${justification()}${confirm?confirmation('Confirm this publication change.'):''}${button(label)}`,{version:current})).join('')}</div></section>
    <section class="panel"><h2>History</h2>${log.map(event=>`<div class="history"><p><strong>${e(event.action)}</strong> · ${e(event.created_at)} · GitHub ID ${e(event.actor)}</p><p>${e(event.reason)}</p>
    ${event.action==='create'||event.action==='publish-submission'?'':`<details><summary>Restore previous values</summary>${form(session,api,'restore',
      hidden('revision',event.id)+justification()+confirmation('Restore the previous editable values.')+button('Restore revision'),{version:current})}</details>`}</div>`).join('')||blank('No administrative history for this listing.')}</section>`;
}

export async function changePreview(session, current, next, proposed) {
  const before = publicServer(current), after = publicServer(next);
  const basic = ['name','description','category','author','github_url','stars','tags'];
  const rich = ['summary','documentationUrl','transport','implementationKey','installations','tools','endpoints','prerequisites','security'];
  const fields = [...basic.map(key=>[key,before[key],after[key]]),
    ...rich.map(key=>[key,before.details[key],after.details[key]])]
    .filter(([,from,to])=>JSON.stringify(from)!==JSON.stringify(to));
  const data = Object.fromEntries(Object.entries(proposed).filter(([key])=>!['csrf','action','version','confirm','reason'].includes(key)));
  const content = summary('Review proposed edits','Compare the current listing with the proposed values.',href('/admin/servers/'+current.id+'/','Back to editor','button'))+
    `<section class="panel">${fields.map(([label,from,to])=>`<div class="history"><h2>${e(label)}</h2><div class="fields"><div><strong>Current</strong><pre>${e(pretty(from))}</pre></div><div><strong>Proposed</strong><pre>${e(pretty(to))}</pre></div></div></div>`).join('')||blank('No editable values changed.')}</section>`+
    `<section class="panel">${form(session,'/api/admin/servers/'+current.id+'/','save',hidden('reviewed',JSON.stringify(data))+
      justification()+confirmation('Apply these reviewed edits.')+button('Apply edits','primary'),{version:await version(current)})}</section>`;
  return content;
}

export function importPage(session,input='',results=null) {
  return summary('Import candidates','Validate a FreeMCP manifest or a list of registry entries against the current database.')+
    `<div class="panel">${form(session,'/api/admin/import/','validate',area('input','Candidate JSON',input)+button('Validate candidates','primary'),{enhanced:false})}</div>`+
    (results?`<section class="panel"><h2>Validation results</h2>${results.map(item=>item.error
      ? `<p class="error-text">Candidate ${item.index+1} · ${e(item.error)}</p>`
      : `<div class="history"><p><strong>${e(item.row.name)}</strong> · ${e(item.row.id)}</p>
          ${form(session,'/api/admin/import/','create',hidden('input',JSON.stringify(JSON.parse(input) instanceof Array?JSON.parse(input)[item.index]:JSON.parse(input)))+
             justification()+button('Create private draft'))}</div>`).join('')}</section>`:'');
}

export async function submissionsList(config,params) {
  const page=pageNumber(params);
  const {items,next}=await listSubmissions(page);
  const numbers=items.map(item=>item.number);
  const local=numbers.length?(await config.db.prepare('SELECT number,status FROM submission_reviews WHERE number IN ('+numbers.map(()=>'?').join(',')+')').bind(...numbers).all()).results:[];
  const statuses=new Map(local.map(row=>[row.number,row.status]));
  return summary('Submissions','Review GitHub issue submissions and publish approved candidates.')+`<div class="items">${items.map(item=>
    `<article class="item"><div><h2>${href('/admin/submissions/'+item.number+'/',item.title)}</h2><p>#${e(item.number)} · ${e(item.state)} · ${e(item.updated_at)}</p></div>
     <span class="status">${e(statuses.get(item.number)||'Unreviewed')}</span></article>`).join('')||blank('No matching submissions on this page.')}</div>`+
    pager('/admin/submissions/',page,next);
}
export function pageNumber(params) {
  const raw=params.get('page');
  return raw && /^[1-9][0-9]{0,3}$/.test(raw) ? Number(raw) : 1;
}
export async function submissionPage(config,session,number,params) {
  const page=pageNumber(params);
  const [evidence, prior, history]=await Promise.all([
    submission(number,{commentsPage:page,readme:true}),reviewRow(config.db,number),
    config.db.prepare("SELECT actor,action,reason,created_at FROM admin_audit_log WHERE entity='submission' AND entity_id=? ORDER BY created_at DESC,rowid DESC LIMIT 30").bind(String(number)).all(),
  ]);
  const current=await version(prior);
  const api='/api/admin/submissions/'+number+'/';
  const base=hidden('fingerprint',evidence.fingerprint);
  const review = prior?.status==='published' ? (prior.server_id?href('/admin/servers/'+prior.server_id+'/','Open published listing','button'):'') :
    [['clarification','Request clarification'],['rejected','Reject submission'],['approved','Approve candidate'],...(prior?.status==='approved'?[['publish','Publish listing']]:[])].map(([action,label])=>
      form(session,api,action,`<h3>${label}</h3>${base}${action==='approved'?
        field('command','Installation command')+field('endpoint','HTTPS endpoint','','url')+area('args','Command arguments as a JSON array','[]')+confirmation('Approve this candidate and its reviewed source.')
        :action==='publish'?confirmation('Publish this approved candidate on FreeMCP.') : ''}${justification()}${button(label)}`,{version:current})).join('');
  return summary(evidence.issue.title,'#'+number+' · '+(prior?.status||'Unreviewed'),href('https://github.com/strbbrn/freemcp-registry/issues/'+number,'Open GitHub issue','button'))+
    `<section class="panel"><h2>Source and validation</h2>${evidence.source?`<p>${e(evidence.source.name)} · ${e(evidence.source.branch)} · ${e(evidence.source.license||'License not reported')}</p><p><code>${e(evidence.source.sha)}</code></p>`:blank('Upstream source could not be verified.')}
      <ul>${[...evidence.findings.findings,...evidence.findings.warnings].map(line=>'<li>'+e(line)+'</li>').join('')}</ul>
      ${evidence.headings.length?`<h3>README evidence headings</h3><ul>${evidence.headings.map(x=>'<li>'+e(x)+'</li>').join('')}</ul>`:''}</section>
    <section class="panel"><h2>Submitted evidence</h2><dl>${Object.entries(evidence.fields).map(([key,value])=>`<dt>${e(key)}</dt><dd class="prewrap">${e(value)}</dd>`).join('')}</dl></section>
    <section class="panel"><h2>Discussion</h2>${evidence.comments.items.map(c=>`<div class="history"><strong>${e(c.author)}</strong> <time>${e(c.date)}</time><p class="prewrap">${e(c.body)}</p></div>`).join('')||blank('No comments on this page.')}${pager('/admin/submissions/'+number+'/',page,evidence.comments.next)}</section>
    <section class="panel"><h2>Review decision</h2><div class="forms">${review}</div></section>
    <section class="panel"><h2>Review history</h2>${history.results.map(event=>`<div class="history"><strong>${e(event.action)}</strong> · GitHub ID ${e(event.actor)} · ${e(event.created_at)}<p>${e(event.reason)}</p></div>`).join('')||blank('No previous decisions yet.')}</section>`;
}

const placementCheckboxes = () => `<fieldset><legend>Placements</legend><div class="slot-grid">${placements.map(item=>`<label class="check"><input type="checkbox" name="slot_${item}" value="yes"> ${item.replace('/',' · ')}</label>`).join('')}</div></fieldset>`;
export async function promotionsPage(config,session,params) {
  const id=params.get('id');
  const row=id?await getPromotion(config.db,id):null;
  if (id&&!row) return null;
  if (row && params.get('preview')==='1') return summary(row.headline,'Private promotion preview',href('/admin/promotions/?id='+encodeURIComponent(id),'Back to editor','button'))+
    `<article class="panel ad-preview ${themes.includes(row.theme)?row.theme:'violet'}"><small>${e(row.placement)} · ${e(row.slot)} · ${e(row.eyebrow)}</small><h2>${e(row.headline)}</h2><p>${e(row.description)}</p><span class="button">${e(row.cta_text)} ↗</span></article>`;
  if (row || params.has('new')) {
    const x=row||{eyebrow:'PROMOTED',cta_text:'Learn more',theme:'violet',weight:1,rotation_seconds:7,status:'draft'};
    const api='/api/admin/promotions/'+(id?encodeURIComponent(id)+'/':'');
    const current=await version(row);
    return summary(row?row.headline:'New promotion','Set placement, status and optional schedule in UTC.',row?href('/admin/promotions/?id='+encodeURIComponent(id)+'&preview=1','Preview','button'):'')+
      `<section class="panel">${form(session,api,row?'save':'create',
        `<div class="fields">${row?'':field('id','Promotion ID')}${field('headline','Headline',x.headline)}${field('eyebrow','Eyebrow',x.eyebrow)}
        ${field('cta_text','Button text',x.cta_text)}${field('target_url','HTTPS destination',x.target_url,'url')}
        ${select('theme','Theme',themes,x.theme)}${select('status','Status',statuses,x.status)}
        ${field('weight','Weight',x.weight,'number')}${field('rotation_seconds','Rotation in seconds',x.rotation_seconds,'number')}
        ${field('starts_at','Start time (UTC)',x.starts_at?.replace(' ','T').slice(0,16),'datetime-local')}
        ${field('ends_at','End time (UTC)',x.ends_at?.replace(' ','T').slice(0,16),'datetime-local')}</div>
        ${row?select('selection','Placement',placements,row.placement+'/'+row.slot):placementCheckboxes()}
        ${area('description','Description',x.description)}${justification()}${button(row?'Save promotion':'Create promotion','primary')}`,{version:current})}</section>`+
      (row?`<section class="panel"><h2>Actions</h2><div class="forms">${form(session,api,row.status==='active'?'pause':'activate',
        justification()+button(row.status==='active'?'Pause promotion':'Activate promotion'),{version:current})}
        ${form(session,api,'duplicate',field('id','New promotion ID')+placementCheckboxes()+justification()+button('Duplicate as draft'),{version:current})}</div></section>`:'');
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

export async function sponsorsPage(config,session) {
  return summary('Sponsorships','Edit the Gold, Diamond and Platinum tier cards. Paused tiers are hidden on the homepage.')+
    (await Promise.all(tiers.map(async tier=>{
      const saved=await sponsorRow(config.db,tier), row=saved||defaultTier(tier);
      return `<section class="panel"><h2>${e(defaultTier(tier).name)}</h2>${form(session,'/api/admin/sponsors/'+tier+'/','save',
        field('name','Tier name',row.name)+area('description','Description',row.description)+field('cta_text','Button text',row.cta_text)+
        field('target_url','Contact link',row.target_url)+select('status','Status',['draft','active','paused'],row.status)+justification()+button('Save tier'),
        {version:await version(saved)})}</section>`;
    }))).join('');
}

export async function activityPage(config,session,env,params) {
  const page=pageNumber(params);
  const [audit, outbox]=await config.db.batch([
    config.db.prepare('SELECT * FROM admin_audit_log ORDER BY created_at DESC,rowid DESC LIMIT 31 OFFSET ?').bind((page-1)*30),
    config.db.prepare("SELECT * FROM admin_outbox WHERE status<>'sent' ORDER BY created_at DESC,rowid DESC LIMIT 30"),
  ]);
  const enabled=appEnabled(config,env);
  return summary('Activity','Administrative changes and pending GitHub notifications.')+
    `<section class="panel"><h2>GitHub synchronization</h2><p>${enabled?'Enabled for this repository.':'Disabled in this environment.'}</p>
      ${outbox.results.map(item=>`<div class="history"><p><strong>Issue #${item.issue_number}</strong> · ${e(item.action)} · ${e(item.status)}</p>${item.last_error?`<p>${e(item.last_error)}</p>`:''}
      ${enabled?form(session,'/api/admin/outbox/'+item.id+'/','retry',justification()+button('Retry GitHub update')):''}</div>`).join('')||blank('No pending updates.')}</section>
    <section class="panel"><h2>Audit log</h2>${audit.results.slice(0,30).map(event=>`<div class="history"><p><strong>${e(event.action)}</strong> · ${e(event.entity)} <code>${e(event.entity_id)}</code></p>
      <p>${e(event.created_at)} · GitHub ID ${e(event.actor)}</p><p>${e(event.reason)}</p>
      <details><summary>Before and after</summary><pre>${e(event.before_json)}\n→ ${e(event.after_json)}</pre></details></div>`).join('')||blank('No administrative activity yet.')}${pager('/admin/activity/',page,audit.results.length>30)}</section>`;
}

export function settingsPage(config,session,env) {
  return summary('Settings','Manage your current session and review environment settings.')+`<section class="panel"><h2>Session</h2><dl><dt>GitHub account</dt><dd>${e(session.login)} · ${e(session.actor)}</dd>
    <dt>Expires</dt><dd>${e(new Date(session.expires_at*1000).toISOString())}</dd><dt>Admin origin</dt><dd>${e(config.origin)}</dd>
    <dt>GitHub synchronization</dt><dd>${appEnabled(config,env)?'Enabled':'Disabled'}</dd></dl><div class="forms">
    ${form(session,'/api/admin/session/','rotate',button('Refresh session'),{enhanced:false})}
    ${form(session,'/api/admin/session/','logout',button('Sign out'),{enhanced:false})}
    ${form(session,'/api/admin/session/','revoke',confirmation('Revoke all sessions for this account.')+button('Revoke all sessions'),{enhanced:false})}</div></section>`;
}
