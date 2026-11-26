CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  login TEXT NOT NULL,
  environment TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  absolute_expires_at INTEGER NOT NULL
);
CREATE INDEX admin_sessions_expiry ON admin_sessions(expires_at);
CREATE INDEX admin_sessions_actor ON admin_sessions(environment, actor);
CREATE TABLE admin_oauth_states (
  state_hash TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX admin_oauth_expiry ON admin_oauth_states(expires_at);
CREATE TABLE admin_rate_limits (
  id TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX admin_rate_expiry ON admin_rate_limits(expires_at);
CREATE TABLE admin_audit_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL
);
CREATE INDEX admin_audit_entity ON admin_audit_log(entity, entity_id, created_at DESC);
CREATE TABLE admin_revisions (
  audit_id TEXT PRIMARY KEY REFERENCES admin_audit_log(id),
  ciphertext TEXT NOT NULL
);
CREATE TABLE submission_reviews (
  number INTEGER PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('clarification','rejected','approved','published')),
  issue_hash TEXT NOT NULL,
  source_commit TEXT NOT NULL,
  candidate_json TEXT NOT NULL,
  actor TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  server_id TEXT
);
CREATE TABLE admin_outbox (
  id TEXT PRIMARY KEY,
  issue_number INTEGER NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('clarification','rejected','published')),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','failed','sent')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER,
  next_retry INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX admin_outbox_status ON admin_outbox(status, created_at);
CREATE TABLE sponsorships (
  tier TEXT PRIMARY KEY CHECK(tier IN ('gold','diamond','platinum')),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  cta_text TEXT NOT NULL,
  target_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','active','paused')),
  updated_at TEXT NOT NULL
);
