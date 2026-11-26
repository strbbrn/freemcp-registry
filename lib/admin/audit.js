import { digest, seal, token, unseal } from './crypto.js';
import { conflict, AdminError } from './http.js';
import { reason } from './validation.js';

export const version = value => digest(JSON.stringify(value ?? null));
export async function assertVersion(snapshot, expected) {
  if (typeof expected !== 'string' || await version(snapshot) !== expected) conflict();
}

export async function auditStatements(config, actor, event, dependent = true) {
  const id = token(), db = config.db;
  const { action, entity, entityId, before, after, revision } = event;
  const statements = [db.prepare(`INSERT INTO admin_audit_log
    (id,actor,action,entity,entity_id,reason,before_json,after_json) SELECT ?,?,?,?,?,?,?,?${dependent === 'any' ? ' WHERE changes()>0' : dependent ? ' WHERE changes()=1' : ''}`)
    .bind(id, actor, action, entity, String(entityId), reason(event.reason),
      JSON.stringify(before ?? null), JSON.stringify(after ?? null))];
  if (revision !== undefined) {
    statements.push(db.prepare('INSERT INTO admin_revisions SELECT ?,? WHERE EXISTS (SELECT 1 FROM admin_audit_log WHERE id=?)')
      .bind(id, await seal(config.historyKey, id, revision), id));
  }
  return { id, statements };
}

export async function commitMutation(config, actor, mutation, event, extra = () => []) {
  const audit = await auditStatements(config, actor, event);
  const [written, logged] = await config.db.batch([mutation, ...audit.statements, ...extra(audit.id)]);
  // D1 may include triggered FTS writes in meta.changes. RETURNING counts
  // matched entity rows independently of the implementation's work.
  if (written.results.length === 0) conflict();
  if (written.results.length !== 1 || logged.meta.changes !== 1) throw new AdminError(500, 'The change could not be verified.');
  return audit.id;
}

export async function loadRevision(config, entity, entityId, id) {
  const row = await config.db.prepare(`SELECT a.id,r.ciphertext FROM admin_audit_log a
    JOIN admin_revisions r ON r.audit_id=a.id WHERE a.id=? AND a.entity=? AND a.entity_id=?`)
    .bind(id, entity, String(entityId)).first();
  if (!row) throw new AdminError(404, 'Revision not found.');
  return unseal(config.historyKey, row.id, row.ciphertext);
}
