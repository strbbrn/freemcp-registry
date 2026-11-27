import { requireRow } from './audit.js';
import { token } from './crypto.js';

export const noIssueDelivery = "NOT EXISTS (SELECT 1 FROM admin_outbox WHERE issue_number=? AND status='sending' AND lease_until>?)";
export function queueIssueDecision(db,auditId,number,action,message,decision) {
  const id=token();
  return [
    db.prepare('INSERT INTO admin_outbox(id,issue_number,action,message,decision_version) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM admin_audit_log WHERE id=?)')
      .bind(id,number,action,message,decision,auditId),
    requireRow(db,'SELECT 1 FROM admin_outbox WHERE id=?',id),
  ];
}
