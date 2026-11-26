import { isSlug, publicListing } from '../registry.js';
import { AdminError, invalid } from './http.js';
import { assertVersion, commitMutation, loadRevision } from './audit.js';
import { checkSecrets, integer, object, options, parsed, strings, text, url } from './validation.js';
import { registrationCandidate } from '../../src/lib/registration.mjs';

const columns = ['id','name','description','category','author','tags_json','github_url','stars','updated_at','details_json'];
const editable = columns.slice(1);
const transport = ['stdio', 'http', 'sse', 'unknown'];
const detailKeys = ['summary','documentationUrl','transport','implementationKey','installations','tools','prerequisites','security','endpoints','lifecycle','lifecycleSource','review'];
const oldDetails = row => {
  try {
    const details = JSON.parse(row?.details_json || '{}');
    if (object(details)) return details;
  } catch {}
  invalid('Stored metadata is malformed. Review this record before editing.');
};
const visibility = details => Object.hasOwn(details,'review') ? details.review?.status ?? 'unknown' : 'legacy';
const summary = row => {
  if (!row) return null;
  const details = oldDetails(row);
  const state = visibility(details);
  return { publication: ['legacy','published','pending-publication','test-only'].includes(state) ? state : 'unknown',
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
  for (const group of [value.mcpServers, value.servers]) {
    if (group === undefined) continue;
    if (!object(group)) invalid('Invalid MCP server configuration.');
    for (const spec of Object.values(group)) {
      if (!object(spec)) invalid('Invalid MCP server configuration entry.');
      if (spec.url !== undefined) url(spec.url, 'MCP endpoint');
      if (spec.endpoint !== undefined) url(spec.endpoint, 'MCP endpoint');
      if (spec.command !== undefined &&
        (typeof spec.command !== 'string' || !/^[a-zA-Z0-9_.+\/-]{1,200}$/.test(spec.command))) invalid('Use a single executable for an installation command.');
      if (spec.args !== undefined && (!Array.isArray(spec.args) || spec.args.length > 30 ||
        !spec.args.every(arg => typeof arg === 'string' && arg.length <= 300))) invalid('Enter valid installation arguments.');
    }
  }
  return value;
}
function editedDetails(input, prior) {
  const changes = {};
  if (input.summary !== undefined) changes.summary = text(input.summary, 'summary', 1200, false);
  if (input.documentationUrl !== undefined) changes.documentationUrl = url(input.documentationUrl, 'documentation URL', false);
  if (input.transport !== undefined) changes.transport = options(input.transport, transport, 'transport');
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
    return { ...endpoint, url: url(endpoint.url, 'MCP endpoint'), transport: options(endpoint.transport, ['http','sse'], 'endpoint transport') };
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

export function serverCandidate(input, prior) {
  const id = prior?.id ?? input.id;
  if (!isSlug(id) || (prior && input.id !== undefined && input.id !== prior.id)) invalid('Use an immutable lowercase hyphenated server ID.');
  const details = editedDetails(input.details ?? input, oldDetails(prior));
  if (!prior) details.review = { status: 'pending-publication' };
  return {
    id, name: text(input.name ?? prior?.name, 'name', 120), description: text(input.description ?? prior?.description, 'description', 1200),
    category: text(input.category ?? prior?.category, 'category', 100), author: text(input.author ?? prior?.author, 'author', 160),
    tags_json: JSON.stringify(strings(input.tags ?? JSON.parse(prior?.tags_json ?? '[]'), 'tags', 50, 100)),
    github_url: input.github_url === undefined && prior ? prior.github_url : repository(input.github_url ?? input.githubUrl),
    stars: integer(input.stars ?? prior?.stars ?? 0, 'stars', 0, 2147483647),
    updated_at: new Date().toISOString(), details_json: JSON.stringify(details),
  };
}
export const serverRow = (db, id) => db.prepare('SELECT * FROM servers WHERE id=?').bind(id).first();
export const serverHistory = (db,id) => db.prepare("SELECT id,actor,action,created_at,reason,before_json,after_json FROM admin_audit_log WHERE entity='server' AND entity_id=? ORDER BY created_at DESC,rowid DESC LIMIT 30").bind(id).all();

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

const duplicateCondition = `NOT EXISTS (SELECT 1 FROM servers
  WHERE id<>? AND lower(rtrim(substr(github_url,1,MIN(instr(github_url||'#','#'),instr(github_url||'?','?'))-1),'/'))
    IN (lower(?),lower(?||'.git'))
  AND COALESCE(json_extract(CASE WHEN json_valid(details_json) THEN details_json ELSE '{}' END,'$.implementationKey'),'')=?)`;
const duplicateArgs = row => [row.id,row.github_url,row.github_url,oldDetails(row).implementationKey || ''];
export function insertServer(db, row, condition = '', conditionArgs = []) {
  return db.prepare(`INSERT INTO servers (${columns.join(',')}) SELECT ${columns.map(()=>'?').join(',')}
    WHERE NOT EXISTS (SELECT 1 FROM servers WHERE id=?) AND ${duplicateCondition} ${condition}`)
    .bind(...columns.map(column=>row[column]),row.id,...duplicateArgs(row),...conditionArgs);
}
export const serverAudit = (action, why, before, after) => ({
  entity:'server',entityId:after.id,action,reason:why,before:summary(before),after:summary(after),revision:before ?? null,
});
export async function editServer(config, actor, id, data) {
  const db = config.db;
  const action = options(data.action, ['create','save','publish','unpublish','archive','unarchive','restore'], 'registry action');
  const prior = id ? await serverRow(db,id) : null;
  if (action === 'create') {
    const draft = serverCandidate(data);
    await commitMutation(config,actor,insertServer(db,draft),serverAudit('create',data.reason,null,draft));
    return draft;
  }
  if (!prior) throw new AdminError(404,'Listing not found.');
  await assertVersion(prior,data.version);
  let row = { ...prior, updated_at: new Date().toISOString() };
  let details = oldDetails(prior);
  if (action === 'save') {
    if (['legacy','published'].includes(visibility(details)) && data.confirm !== 'yes') invalid('Confirm edits to this public listing.');
    row = serverCandidate(data,prior);
    details = oldDetails(row);
  }
  if (action === 'publish' || action === 'unpublish') {
    if (data.confirm !== 'yes') invalid('Confirm the publication change.');
    if (action === 'publish') {
      checkSecrets(Object.fromEntries(Object.entries(details).filter(([key])=>detailKeys.includes(key))));
      if (details.review?.issue && details.review?.source === 'approved-submission') invalid('Publish this candidate through its submission review.');
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
    for (const key of detailKeys) {
      if (Object.hasOwn(snapshot,key)) details[key] = snapshot[key];
      else delete details[key];
    }
    checkSecrets(Object.fromEntries(Object.entries(details).filter(([key])=>detailKeys.includes(key))));
    const restoringPublic = ['legacy','published'].includes(visibility(details));
    if (restoringPublic && !['legacy','published'].includes(visibility(oldDetails(prior)))) {
      if (details.review?.issue) invalid('Re-approve and publish this submission before making it public again.');
      details.review = { ...details.review, status: 'pending-publication' };
    }
    const { name, description, category, author, tags_json, github_url } = saved;
    Object.assign(row,{name,description,category,author,tags_json,github_url});
  }
  row.details_json = JSON.stringify(details);
  const duplicate = row.github_url !== prior.github_url || details.implementationKey !== oldDetails(prior).implementationKey;
  const update = db.prepare(`UPDATE servers SET ${editable.map(column=>column+'=?').join(',')}
    WHERE ${columns.map(column=>column+' IS ?').join(' AND ')}${duplicate?' AND '+duplicateCondition:''}`)
    .bind(...editable.map(column=>row[column]),...columns.map(column=>prior[column]),...(duplicate?duplicateArgs(row):[]));
  await commitMutation(config,actor,update,serverAudit(action,data.reason,prior,row));
  return row;
}

export async function prepareImport(db, raw) {
  const input = parsed(raw,'Import');
  const entries = Array.isArray(input) ? input : [input];
  if (!entries.length || entries.length > 25) invalid('Provide between 1 and 25 candidates.');
  const seen = new Set(), implementations = new Set(), results = [];
  for (const [index,value] of entries.entries()) {
    try {
      if (!object(value)) invalid('Expected a candidate object.');
      const data = value.schemaVersion === 1 ? registrationCandidate(value) : value;
      const details = data.details ?? (data.details_json === undefined ? {} : parsed(data.details_json,'details_json'));
      if (!object(details)) invalid('Expected a details object.');
      if (data.tags === undefined && data.tags_json !== undefined) data.tags = parsed(data.tags_json,'tags_json');
      const row = serverCandidate({...data,details});
      const identity = row.github_url.toLowerCase() + '#' + (oldDetails(row).implementationKey || '');
      if (seen.has(row.id) || implementations.has(identity)) invalid('Duplicate ID or implementation in this import.');
      seen.add(row.id);
      implementations.add(identity);
      const collision = await db.prepare(`SELECT id FROM servers WHERE id=? OR NOT (${duplicateCondition}) LIMIT 1`)
        .bind(row.id,...duplicateArgs(row)).first();
      if (collision) invalid('A listing with this ID or implementation already exists.');
      results.push({ index, row });
    } catch (error) {
      results.push({ index, error: error instanceof AdminError ? error.message : value?.schemaVersion === 1 ? 'Invalid submission manifest or installation evidence.' : 'Candidate could not be validated.' });
    }
  }
  return results;
}
