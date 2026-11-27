CREATE TABLE admin_github_cache (
  scope TEXT NOT NULL,
  path TEXT NOT NULL,
  payload TEXT,
  etag TEXT,
  checked_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, path)
);
CREATE INDEX admin_github_cache_age ON admin_github_cache(scope, checked_at);
CREATE TABLE admin_github_rate (
  scope TEXT PRIMARY KEY,
  blocked_until INTEGER NOT NULL DEFAULT 0,
  probe_until INTEGER NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0,
  cache_hits INTEGER NOT NULL DEFAULT 0,
  stale_hits INTEGER NOT NULL DEFAULT 0,
  conditional_requests INTEGER NOT NULL DEFAULT 0,
  not_modified INTEGER NOT NULL DEFAULT 0,
  rate_limited INTEGER NOT NULL DEFAULT 0
);
