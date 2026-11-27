import { localEndpoint, transportAlias, transports } from './transport.js';
import { isSlug, publicListing } from '../registry.js';
import { AdminError, invalid } from './http.js';
import { assertVersion, commitMutation, entityHistory, fieldDiff, loadRevision, requireRow, version } from './audit.js';
import { checkSecrets, integer, object, options, parsed, reason, strings, text, url } from './validation.js';
import { registrationCandidate } from '../../src/lib/registration.mjs';
import { assertNoDuplicate, duplicateArgs, duplicateCondition, earlierImportEndpoint, endpointExceptions, listingCollision } from './duplicates.js';
import { assertPublicationReady, formPublicationExceptions } from './publication.js';
import { noIssueDelivery, queueIssueDecision } from './outbox.js';

const columns = ['id','name','description','category','author','tags_json','github_url','stars','updated_at','details_json'];
const editable = columns.slice(1);
const detailKeys = ['summary','documentationUrl','documentationUrls','transport','transports','pricing','serviceDependencies','implementationKey','installations','tools','prerequisites','security','endpoints','lifecycle','lifecycleSource','review'];
export const protectedDetails = key => /^(?:review|lifecycle(?:Source)?|github(?:Metadata)?|admin.*|publication.*|submission.*|sourceCommit)$/i.test(key);
const editableDetails = detailKeys.filter(key=>!protectedDetails(key));
const listingFields = ['id','name','description','category','author','github_url','stars'];
const endpointConfig = details => JSON.stringify([details.endpoints,
  (Array.isArray(details.installations)?details.installations:[]).map(item=>item?.config)]);
const oldDetails = row => {
  try {
    const details = JSON.parse(row?.details_json || '{}');
    if (object(details)) return details;
  } catch {}
  invalid('Stored metadata is malformed. Review this record before editing.');
};
export function listingDocument(row) {
  return {...Object.fromEntries(listingFields.map(key=>[key,row[key]])),tags:JSON.parse(row.tags_json),details:oldDetails(row)};
}
const sameJson = (a,b) => JSON.stringify(a)===JSON.stringify(b);
export function editorJson(data, baseline) {
  if (data.useAdvanced!=='yes') {
    if (data.candidateJson!==undefined) {
      const {removeDetails,...document}=parsed(data.candidateJson,'Listing JSON')??{};
      if (removeDetails!==undefined || !sameJson(document,baseline)) {
        invalid('The JSON editor has changes. Select “Use JSON instead of structured fields” or synchronize the editors.');
      }
    }
    return null;
  }
  const input=parsed(data.candidateJson,'Listing JSON');
  if (!object(input)) invalid('Listing JSON must be an object.');
  return input;
}
export function listingJsonCandidate(input, prior, data, baseline=oldDetails(prior)) {
  if (Object.keys(input).some(key=>![...listingFields,'tags','details','sharedEndpoints','removeDetails'].includes(key))) {
    invalid('Use the exported listing fields and place additional metadata inside details.');
  }
  if (input.details!==undefined&&!object(input.details)) invalid('Listing JSON details must be an object.');
  const changes={...input.details};
  const removed=input.removeDetails??[];
  if (!Array.isArray(removed)||removed.some(key=>typeof key!=='string'||protectedDetails(key))) invalid('removeDetails must list editable details keys.');
  for (const [key,value] of Object.entries(changes)) {
    if (protectedDetails(key) && !sameJson(value,baseline[key])) invalid('Listing JSON cannot change protected details.'+key+'.');
    if (sameJson(value,baseline[key])) delete changes[key];
  }
  checkSecrets(changes);
  checkSecrets(removed);
  const row=serverCandidate({...input,details:Object.fromEntries(Object.entries(changes).filter(([key])=>editableDetails.includes(key))),
    confirmSharedEndpoints:data.confirmSharedEndpoints??input.confirmSharedEndpoints},prior);
  const details=oldDetails(row);
  for (const [key,value] of Object.entries(changes)) {
    if (!editableDetails.includes(key)&&!protectedDetails(key)) details[key]=value;
  }
  for (const key of removed) delete details[key];
  const encoded=JSON.stringify(details);
  if (encoded.length>70000) invalid('Registry metadata is too large.');
  if (encoded!==JSON.stringify(oldDetails(row))) {
    row.details_json=encoded;
    row.updated_at=new Date().toISOString();
  }
  return row;
}
export function editListingCandidate(data,prior) {
  if (!prior) return serverCandidate(data);
  const input=editorJson(data,listingDocument(prior));
  if (input) return listingJsonCandidate(input,prior,data);
  const base=data.baseJson===undefined?prior:listingJsonCandidate(editorJson({useAdvanced:'yes',candidateJson:data.baseJson}),prior,data);
  return serverCandidate(data,base);
}
const visibility = details => Object.hasOwn(details,'review') ? details.review?.status ?? 'unknown' : 'legacy';
const summary = row => {
  if (!row) return null;
  const details = oldDetails(row);
  const state = visibility(details);
  return { name:row.name,description:row.description,category:row.category,author:row.author,
    tags:JSON.parse(row.tags_json),stars:row.stars,transport:details.transport ?? null,implementationKey:details.implementationKey ?? null,
    ...Object.fromEntries(['summary','documentationUrl','documentationUrls','transports','pricing','serviceDependencies','prerequisites','security']
      .filter(key=>Object.hasOwn(details,key)).map(key=>[key,details[key]])),
    tools:Array.isArray(details.tools)?details.tools.map(tool=>tool?.name).filter(name=>typeof name==='string'):[],
    installations:Array.isArray(details.installations)?details.installations.map(installation=>installation?.title).filter(title=>typeof title==='string'):[],
    installationCount:Array.isArray(details.installations)?details.installations.length:0,
    toolCount:Array.isArray(details.tools)?details.tools.length:0,
    endpointCount:Array.isArray(details.endpoints)?details.endpoints.length:0,
    publication: ['legacy','published','pending-publication','test-only'].includes(state) ? state : 'unknown',
    lifecycle: ['archived','maintained','active'].includes(details.lifecycle) ? details.lifecycle : null };
};

export function repository(value) {
  const safe = url(value, 'repository URL');
  const repo = new URL(safe);
  const parts = repo.pathname.split('/').filter(Boolean);
  if (repo.host !== 'github.com' || parts.length < 2 || !parts.every(part => /^[a-zA-Z0-9_.@+-]+$/.test(part)) ||
      (parts.length > 2 && !['tree', 'blob'].includes(parts[2]))) invalid('Enter a GitHub repository or explicit implementation path.');
  return 'https://github.com/' + parts.join('/').replace(/\.git$/i, '');
}

function list(value, name, max, item) {
  const entries = parsed(value, name);
  if (!Array.isArray(entries) || entries.length > max) invalid('Enter a valid ' + name + ' list.');
  return entries.map(item);
}
function structuredConfig(value) {
  if (!object(value)) invalid('Each installation needs a configuration object.');
  checkSecrets(value);
  const specs=[value];
  for (const group of [value.mcpServers, value.servers]) {
    if (group === undefined) continue;
    if (!object(group)) invalid('Invalid MCP server configuration.');
    specs.push(...Object.values(group));
  }
  for (const spec of specs) {
    if (!object(spec)) invalid('Invalid MCP server configuration entry.');
    if (spec.localEndpoint!==undefined && (!localEndpoint(spec.localEndpoint)||!['http','sse'].includes(transportAlias(spec.transport??spec.type)))) {
      invalid('Local MCP endpoint must use loopback HTTP, an explicit port, and HTTP or SSE transport.');
    }
    if (spec.url !== undefined) url(spec.url, 'MCP endpoint');
    if (spec.endpoint !== undefined) url(spec.endpoint, 'MCP endpoint');
    if (spec.command !== undefined &&
      (typeof spec.command !== 'string' || !/^[a-zA-Z0-9_.+\/-]{1,200}$/.test(spec.command))) invalid('Use a single executable for an installation command.');
    if (spec.args !== undefined && (!Array.isArray(spec.args) || spec.args.length > 30 ||
      !spec.args.every(arg => typeof arg === 'string' && arg.length <= 300))) invalid('Enter valid installation arguments.');
  }
  return value;
}
function editedDetails(input, prior) {
  const changes = {};
  if (input.summary !== undefined) changes.summary = text(input.summary, 'summary', 1200, false);
  if (input.documentationUrl !== undefined) changes.documentationUrl = url(input.documentationUrl, 'documentation URL', false);
  if (input.documentationUrls !== undefined) {
    const primary=changes.documentationUrl??prior.documentationUrl;
    changes.documentationUrls=[...new Set(strings(input.documentationUrls,'documentation links',12,2048)
      .map(link=>url(link,'documentation link')).filter(link=>link!==primary))];
  }
  if (input.pricing !== undefined) changes.pricing = text(input.pricing,'pricing',800,false);
  if (input.serviceDependencies !== undefined) changes.serviceDependencies = strings(input.serviceDependencies,'service dependencies',20,500);
  if (input.transport !== undefined && input.transport !== '') {
    changes.transport = input.transport==='unknown'?'unknown':options(transportAlias(input.transport),transports,'transport');
    if (input.transports===undefined && changes.transport!==prior.transport) changes.transports=changes.transport==='unknown'?[]:[changes.transport];
  }
  if (input.transports !== undefined && input.transports !== '') {
    const modes=[...new Set(strings(input.transports,'additional transports',3,60).map(value=>options(transportAlias(value),transports,'transport')))];
    const primary=changes.transport??transportAlias(prior.transport);
    changes.transports=[...new Set([...(primary&&primary!=='unknown'?[primary]:[]),...modes])];
    changes.transport=changes.transports[0]??'unknown';
  }
  if (input.implementationKey !== undefined) {
    const value = text(input.implementationKey, 'implementation key', 100, false);
    if (value && !isSlug(value)) invalid('Use a lowercase hyphenated implementation key.');
    changes.implementationKey = value;
  }
  for (const key of ['prerequisites', 'security']) {
    if (input[key] !== undefined) changes[key] = strings(input[key], key, 30, 500);
  }
  if (input.tools !== undefined) changes.tools = list(input.tools, 'tools', 80, tool => {
    if (!object(tool)) invalid('Enter a structured tool.');
    return { ...tool, name: text(tool.name, 'tool name', 100), description: text(tool.description, 'tool description', 500, false) };
  });
  if (input.endpoints !== undefined) changes.endpoints = list(input.endpoints, 'endpoints', 20, endpoint => {
    if (!object(endpoint)) invalid('Enter a structured endpoint.');
    return { ...endpoint, url: url(endpoint.url, 'MCP endpoint'), transport: options(transportAlias(endpoint.transport ?? endpoint.type), ['http','sse'], 'endpoint transport') };
  });
  if (input.installations !== undefined) changes.installations = list(input.installations, 'installations', 20, installation => {
    if (!object(installation)) invalid('Enter a structured installation.');
    return { ...installation, title: text(installation.title, 'installation title', 200), client: text(installation.client, 'client', 160, false),
      os: text(installation.os, 'operating system', 100, false), notes: text(installation.notes, 'installation notes', 3000, false),
      config: structuredConfig(installation.config) };
  });
  checkSecrets(changes);
  if (JSON.stringify(changes).length > 70000) invalid('Registry metadata is too large.');
  return { ...prior, ...changes };
}

const lineFields=['tags','documentationUrls','serviceDependencies','prerequisites','security'];
const jsonFields=['installations','endpoints','tools','sharedEndpoints'];
export const listingLines=value=>Array.isArray(value)?value.filter(item=>typeof item==='string').join('\n'):typeof value==='string'?value:'';

function listingFormChanges(data,prior,details) {
  const current={...details,...prior,tags:JSON.parse(prior.tags_json),sharedEndpoints:details.review?.sharedEndpoints??{}};
  const changes={...data};
  for (const key of ['name','description','category','author','github_url','stars','summary','documentationUrl','pricing',
    'implementationKey',...lineFields,...jsonFields]) {
    if (typeof data[key]!=='string') continue;
    const raw=current[key];
    const unchanged=jsonFields.includes(key)?JSON.stringify(parsed(data[key],key))===JSON.stringify(raw??[]):
      data[key]===(lineFields.includes(key)?listingLines(raw):key==='implementationKey'&&typeof raw!=='string'?'':String(raw??''));
    if (unchanged) delete changes[key];
  }
  return changes;
}

export function serverCandidate(input, prior) {
  const id = prior?.id ?? input.id;
  if (!isSlug(id) || (prior && input.id !== undefined && input.id !== prior.id)) invalid('Use an immutable lowercase hyphenated server ID.');
  const previousDetails=oldDetails(prior);
  if (prior && input.listingForm==='yes' && input.details===undefined) input=listingFormChanges(input,prior,previousDetails);
  const edit={...(input.details??input)};
  if (input.clearImplementationKey==='yes') edit.implementationKey='';
  if (prior) {
    if (Object.hasOwn(edit,'implementationKey')&&JSON.stringify(edit.implementationKey)===JSON.stringify(previousDetails.implementationKey)) delete edit.implementationKey;
    for (const key of ['documentationUrls','serviceDependencies','pricing']) {
      if (edit[key]===''&&(previousDetails[key]===undefined||
        typeof previousDetails[key]!=='string'&&!Array.isArray(previousDetails[key]))) delete edit[key];
    }
    for (const key of ['installations','endpoints','tools']) {
      if (edit[key]!==undefined && JSON.stringify(parsed(edit[key],key))===JSON.stringify(previousDetails[key]??[])) delete edit[key];
    }
  }
  const details = editedDetails(edit, previousDetails);
  if (!prior) details.review = { status: 'pending-publication' };
  const oldSharing=previousDetails.review?.sharedEndpoints;
  if (input.sharedEndpoints !== undefined || oldSharing) {
    const sharedEndpoints=endpointExceptions(input.sharedEndpoints??oldSharing);
    const changed=JSON.stringify(sharedEndpoints)!==JSON.stringify(oldSharing) || endpointConfig(details)!==endpointConfig(previousDetails);
    if (changed && Object.keys(sharedEndpoints).length && input.confirmSharedEndpoints!=='yes') {
      invalid('Confirm the reviewed shared endpoint exceptions for these configurations.');
    }
    if (details.review || Object.keys(sharedEndpoints).length) details.review={...details.review,
      status:visibility(details)==='legacy'?'published':visibility(details),sharedEndpoints};
  }
  const detailsJson=JSON.stringify(details);
  const listing={
    id,
    name:input.name===undefined&&prior?prior.name:text(input.name,'name',120),
    description:input.description===undefined&&prior?prior.description:text(input.description,'description',1200),
    category:input.category===undefined&&prior?prior.category:text(input.category,'category',100),
    author:input.author===undefined&&prior?prior.author:text(input.author,'author',160),
    tags_json:input.tags===undefined&&prior?prior.tags_json:JSON.stringify(strings(input.tags??[],'tags',50,100)),
    github_url:input.github_url===undefined&&input.githubUrl===undefined&&prior?prior.github_url:repository(input.github_url??input.githubUrl),
    stars:input.stars===undefined&&prior?prior.stars:integer(input.stars??0,'stars',0,2147483647),
    details_json:prior&&JSON.stringify(previousDetails)===detailsJson?prior.details_json:detailsJson,
  };
  const unchanged=prior&&Object.keys(listing).every(key=>listing[key]===prior[key]);
  const {details_json,...fields}=listing;
  return {...fields,updated_at:unchanged?prior.updated_at:new Date().toISOString(),details_json};
}
export const serverRow = (db, id) => db.prepare('SELECT * FROM servers WHERE id=?').bind(id).first();
export const serverHistory = (db,id) => entityHistory(db,'server',id);

export function publicServer(row) {
  if (!row) return null;
  return { ...row, tags: JSON.parse(row.tags_json), details: oldDetails(row) };
}
export async function listServers(db, params) {
  const term = (params.get('q') || '').trim().slice(0, 120).replace(/[\\%_]/g, char => '\\' + char);
  const page = Math.max(1, Math.min(1000, Number(params.get('page')) || 1));
  const status = params.get('status');
  const where = `WHERE (name LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\')${status === 'public' ? ' AND ('+publicListing+')' : status === 'draft' ? ' AND NOT COALESCE(('+publicListing+'),0)' : ''}`;
  const args = ['%'+term+'%', '%'+term+'%'];
  const [count,rows] = await db.batch([
    db.prepare('SELECT COUNT(*) AS total FROM servers '+where).bind(...args),
    db.prepare('SELECT id,name,category,github_url,CASE WHEN '+publicListing+' THEN 1 ELSE 0 END AS published FROM servers '+where+' ORDER BY name COLLATE NOCASE,id LIMIT 24 OFFSET ?')
      .bind(...args, (Math.floor(page)-1)*24),
  ]);
  return { items: rows.results, total: count.results[0].total, page: Math.floor(page) };
}

export function insertServer(db, row, condition = '', conditionArgs = []) {
  return db.prepare(`INSERT INTO servers (${columns.join(',')}) SELECT ${columns.map(()=>'?').join(',')}
    WHERE NOT EXISTS (SELECT 1 FROM servers WHERE id=?) AND ${duplicateCondition} ${condition} RETURNING id`)
    .bind(...columns.map(column=>row[column]),row.id,...duplicateArgs(row),...conditionArgs);
}
export function updateServer(db,row,prior,condition='',args=[],duplicates=true) {
  return db.prepare(`UPDATE servers SET ${editable.map(column=>column+'=?').join(',')}
    WHERE ${columns.map(column=>column+' IS ?').join(' AND ')}${duplicates?' AND '+duplicateCondition:''} ${condition} RETURNING id`)
    .bind(...editable.map(column=>row[column]),...columns.map(column=>prior[column]),...(duplicates?duplicateArgs(row):[]),...args);
}
export function serverAudit(action, why, before, after) {
  const from=summary(before), to=summary(after);
  const changedFields=[...new Set([...fieldDiff(from,to),...fieldDiff(oldDetails(before),oldDetails(after)),
    ...(before?.github_url!==after.github_url?['github_url']:[])])];
  return {entity:'server',entityId:after.id,action,reason:why,before:from,after:{...to,changedFields},revision:before??null};
}
export async function editServer(config, actor, id, data) {
  const db = config.db;
  const action = options(data.action, ['create','save','publish','unpublish','archive','unarchive','restore'], 'registry action');
  const prior = id ? await serverRow(db,id) : null;
  if (action === 'create') {
    const draft = serverCandidate(data);
    await assertNoDuplicate(db,draft);
    await commitMutation(config,actor,insertServer(db,draft),serverAudit('create',data.reason,null,draft));
    return draft;
  }
  if (!prior) throw new AdminError(404,'Listing not found.');
  await assertVersion(prior,data.version);
  let row = { ...prior, updated_at: new Date().toISOString() };
  let details = oldDetails(prior);
  let submissionReview;
  if (action === 'save') {
    if (['legacy','published'].includes(visibility(details)) && data.confirm !== 'yes') invalid('Confirm edits to this public listing.');
    row = editListingCandidate(data,prior);
    if (columns.every(key=>row[key]===prior[key])) return prior;
    details = oldDetails(row);
    if (visibility(details)==='published'||(visibility(details)==='legacy'&&(data.useAdvanced==='yes'||data.baseJson))) assertPublicationReady(row);
  }
  if (action === 'publish' || action === 'unpublish') {
    if (data.confirm !== 'yes') invalid('Confirm the publication change.');
    if (action === 'publish') {
      if (details.review?.issue && details.review?.source === 'approved-submission') invalid('Publish this candidate through its submission review.');
      const exceptions = assertPublicationReady(prior,formPublicationExceptions(data));
      details.review = {...details.review,exceptions};
    } else if (details.review?.source==='approved-submission') {
      submissionReview = await db.prepare("SELECT * FROM submission_reviews WHERE number=? AND server_id=? AND status='published'")
        .bind(details.review.issue,id).first();
    }
    details.review = { ...details.review, status: action === 'publish' ? 'published' : 'pending-publication' };
  }
  if (action === 'archive' || action === 'unarchive') {
    details.lifecycle = action === 'archive' ? 'archived' : 'maintained';
    details.lifecycleSource = 'registry';
  }
  if (action === 'restore') {
    if (data.confirm !== 'yes') invalid('Confirm this revision restore.');
    const saved = await loadRevision(config,'server',id,data.revision);
    if (!saved) invalid('The first revision has no previous listing.');
    const snapshot = oldDetails(saved);
    const previous=oldDetails(prior);
    for (const key of new Set([...Object.keys(details),...Object.keys(snapshot)])) {
      if (protectedDetails(key)) continue;
      if (Object.hasOwn(snapshot,key)) {
        if (!sameJson(snapshot[key],previous[key])) checkSecrets({[key]:snapshot[key]});
        details[key] = snapshot[key];
      }
      else delete details[key];
    }
    checkSecrets(Object.fromEntries(Object.entries(details).filter(([key])=>detailKeys.includes(key))));
    // Restoration must preserve current visibility and submission linkage.
    details.review = oldDetails(prior).review;
    if (details.review===undefined) delete details.review;
    else if (endpointConfig(details)!==endpointConfig(oldDetails(prior)) && details.review.sharedEndpoints) {
      details.review={...details.review,sharedEndpoints:{}};
    }
    const { name, description, category, author, tags_json, github_url } = saved;
    Object.assign(row,{name,description,category,author,tags_json,github_url});
  }
  if (action!=='save') row.details_json = JSON.stringify(details);
  if (action==='restore' && visibility(details)==='published') assertPublicationReady(row);
  const duplicates = ['save','publish','restore'].includes(action);
  if (duplicates) await assertNoDuplicate(db,row,true);
  const when = submissionReview ? "AND EXISTS (SELECT 1 FROM submission_reviews WHERE number=? AND server_id=? AND status='published' AND updated_at=?) AND "+noIssueDelivery : '';
  const update = updateServer(db,row,prior,when,submissionReview?[submissionReview.number,id,submissionReview.updated_at,
    submissionReview.number,Math.floor(Date.now()/1000)]:[],duplicates);
  const decision=submissionReview&&await version({...submissionReview,status:'clarification',candidate_json:'{}',actor,updated_at:row.updated_at});
  await commitMutation(config,actor,update,serverAudit(action==='save'&&(data.useAdvanced==='yes'||data.baseJson)?'save-json':action,data.reason,prior,row),auditId=>submissionReview?[
    db.prepare("UPDATE submission_reviews SET status='clarification',candidate_json='{}',actor=?,updated_at=? WHERE number=? AND EXISTS (SELECT 1 FROM admin_audit_log WHERE id=?)")
      .bind(actor,row.updated_at,submissionReview.number,auditId),
    requireRow(db,"SELECT 1 FROM submission_reviews WHERE number=? AND status='clarification' AND updated_at=?",submissionReview.number,row.updated_at),
    ...queueIssueDecision(config,auditId,submissionReview.number,'clarification','The FreeMCP listing was withdrawn for review.',decision),
  ]:[]);
  return row;
}

export async function prepareImport(db, raw) {
  const input = parsed(raw,'Import');
  const entries = Array.isArray(input) ? input : [input];
  if (!entries.length || entries.length > 25) invalid('Provide between 1 and 25 candidates.');
  const seen = new Set(), implementations = new Set(), results = [], accepted=[];
  for (const [index,value] of entries.entries()) {
    try {
      if (!object(value)) invalid('Expected a candidate object.');
      const data = value.schemaVersion === 1 ? registrationCandidate(value) : {...value};
      const details = data.details ?? (data.details_json === undefined ? {} : parsed(data.details_json,'details_json'));
      if (!object(details)) invalid('Expected a details object.');
      if (data.tags === undefined && data.tags_json !== undefined) data.tags = parsed(data.tags_json,'tags_json');
      const row = serverCandidate({...data,details,sharedEndpoints:undefined});
      const unsupported = Object.keys(value).filter(key=>!(value.schemaVersion===1
        ? ['schemaVersion','name','description','repository','category','transport','installation','tools','prerequisites','permissions']
        : ['id','name','description','category','author','github_url','githubUrl','stars','tags','tags_json','details','details_json',...detailKeys]).includes(key));
      const safeDetails = {...(data.details || (data.details_json===undefined?data:{})),...details};
      const reserved = ['review','lifecycle','lifecycleSource','github','githubMetadata'];
      if (data.details!==undefined && data.details_json!==undefined) unsupported.push('details_json (shadowed by details)');
      for (const [key,content] of Object.entries(safeDetails)) {
        if (reserved.includes(key)) { if (value.schemaVersion!==1 || key!=='review') unsupported.push('details.'+key); continue; }
        if (detailKeys.includes(key) || !Object.hasOwn(details,key)) continue;
        checkSecrets({[key]:content});
        const parsedDetails=oldDetails(row);
        row.details_json=JSON.stringify({...parsedDetails,[key]:content});
      }
      if (row.details_json.length>70000) invalid('Registry metadata is too large.');
      const identity = row.github_url.toLowerCase() + '#' + (oldDetails(row).implementationKey || '');
      if (seen.has(row.id) || implementations.has(identity)) invalid('Duplicate ID or implementation in this import.');
      const collision = await listingCollision(db,row)??await earlierImportEndpoint(db,row,accepted);
      if (collision) invalid('A listing with this ID, implementation or MCP endpoint already exists under '+collision.id+'.');
      seen.add(row.id);
      implementations.add(identity);
      accepted.push(row);
      results.push({ index, row, unsupported });
    } catch (error) {
      results.push({ index, error: error instanceof AdminError ? error.message : value?.schemaVersion === 1 ? 'Invalid submission manifest or installation evidence.' : 'Candidate could not be validated.' });
    }
  }
  return results;
}

export async function createImportedDrafts(config,actor,items,selection,data) {
  const why = reason(data.reason);
  if (data.confirm!=='yes') invalid('Confirm creation of the selected private drafts.');
  if (!Array.isArray(selection) || !selection.length || new Set(selection).size!==selection.length ||
      selection.some(index=>!Number.isInteger(index)||index<0||index>=items.length)) invalid('Select one or more candidates.');
  const outcomes = [];
  for (const index of selection) {
    const item = items[index];
    if (item.error) { outcomes.push(item); continue; }
    try {
      await commitMutation(config,actor,insertServer(config.db,item.row),serverAudit('create-import',why,null,item.row));
      outcomes.push({index,id:item.row.id,created:true});
    } catch (error) {
      outcomes.push({index,id:item.row.id,error:error instanceof AdminError&&error.status===409
        ? 'The listing could not be created because it changed or conflicted during import.'
        : 'The draft and audit entry could not be saved. Retry this candidate.'});
    }
  }
  return outcomes;
}
