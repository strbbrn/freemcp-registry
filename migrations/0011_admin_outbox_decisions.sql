ALTER TABLE admin_outbox ADD COLUMN decision_version TEXT;
ALTER TABLE admin_outbox ADD COLUMN resolution TEXT CHECK (resolution IN ('delivered','superseded'));
CREATE INDEX admin_outbox_issue_claim ON admin_outbox(issue_number,status,lease_until);
