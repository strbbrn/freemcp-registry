import { digest, seal, token, unseal } from './crypto.js';
import { conflict, AdminError } from './http.js';
import { checkSecrets, reason } from './validation.js';

export const version = value => digest(JSON.stringify(value ?? null));
export async function assertVersion(snapshot, expected) {
  if (typeof expected !== 'string' || await version(snapshot) !== expected) conflict();
}

export async function auditStatements(config, actor, event, dependent = true) {
  const id = token(), db = config.db;
  const { action, entity, entityId, before, after, revision } = event;
  const statements = [db.prepare(`INSERT INTO admin_audit_log
    (id,actor,action,entity,entity_id,reason,before_json,after_json) SELECT ?,?,?,?,?,?,?,?${dependent === 'any' ? ' WHERE changes()>0' : dependent ? ' WHERE changes()=1' : ''} RETURNING id`)
    .bind(id, actor, action, entity, String(entityId), reason(event.reason),
      JSON.stringify(safeProjection(before)), JSON.stringify(safeProjection(after)))];
  if (revision !== undefined) {
    statements.push(db.prepare('INSERT INTO admin_revisions SELECT ?,? WHERE EXISTS (SELECT 1 FROM admin_audit_log WHERE id=?)')
      .bind(id, await seal(config.historyKey, id, revision), id));
  }
  statements.push(requireRow(db,'SELECT 1 FROM admin_audit_log WHERE id=?',id));
  if (revision !== undefined) statements.push(requireRow(db,'SELECT 1 FROM admin_revisions WHERE audit_id=?',id));
  return { id, statements };
}

function safeProjection(value) {
  if (!value) return null;
  return Object.fromEntries(Object.entries(value).map(([key,entry])=>{
    try { checkSecrets({[key]:entry}); return [key,entry]; }
    catch { return [key,'[redacted]']; }
  }));
}

// Force a SQLite error inside the transaction, where D1 can still roll back.
// A SELECT guard cannot be silently skipped by an INSERT trigger.
export const requireRow = (db, query, ...args) => db.prepare(
  `SELECT CASE WHEN EXISTS (${query}) THEN 1 ELSE json_extract('[]','$[freemcp_write_missing]') END AS verified`
).bind(...args);

export async function commitMutation(config, actor, mutation, event, extra = () => []) {
  const audit = await auditStatements(config, actor, event);
  try {
    await config.db.batch([mutation, ...audit.statements, ...extra(audit.id)]);
  } catch (error) {
    if (String(error.message).includes('freemcp_write_missing')) conflict();
    throw error;
  }
  return audit.id;
}

export const fieldDiff = (before, after) => [...new Set([...Object.keys(before??{}),...Object.keys(after)])].filter(key =>
  JSON.stringify(before?.[key]) !== JSON.stringify(after[key]));

export const entityHistory = (db,entity,id) => db.prepare(`SELECT a.*,r.audit_id AS recoverable
  FROM admin_audit_log a LEFT JOIN admin_revisions r ON r.audit_id=a.id
  WHERE a.entity=? AND a.entity_id=? ORDER BY a.created_at DESC,a.rowid DESC LIMIT 30`).bind(entity,id).all();

export async function loadRevision(config, entity, entityId, id) {
  const row = await config.db.prepare(`SELECT a.id,r.ciphertext FROM admin_audit_log a
    JOIN admin_revisions r ON r.audit_id=a.id WHERE a.id=? AND a.entity=? AND a.entity_id=?`)
    .bind(id, entity, String(entityId)).first();
  if (!row) throw new AdminError(404, 'Revision not found.');
  return unseal(config.historyKey, row.id, row.ciphertext);
}
