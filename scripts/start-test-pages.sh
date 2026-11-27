#!/usr/bin/env bash
set -euo pipefail
export WRANGLER_SEND_METRICS=false
test_state=$(mktemp -d)
trap 'rm -rf "$test_state"' EXIT

# The initial schema is idempotent. Seed before the later data migrations.
wrangler d1 execute DB --local --persist-to "$test_state" --file migrations/0001_servers.sql >/dev/null
wrangler d1 execute DB --local --persist-to "$test_state" --file seed/servers.sql >/dev/null
wrangler d1 migrations apply DB --local --persist-to "$test_state" >/dev/null
wrangler d1 execute DB --local --persist-to "$test_state" --file tests/fixtures/registry.sql >/dev/null
wrangler d1 execute DB --local --persist-to "$test_state" --file tests/fixtures/admin.sql >/dev/null
wrangler pages dev dist --ip 127.0.0.1 --port 3011 --persist-to "$test_state" \
  --binding ADMIN_ENV=local --binding ADMIN_ORIGIN=http://127.0.0.1:3011 \
  --binding ADMIN_GITHUB_CLIENT_ID=FixtureClient123 --binding ADMIN_GITHUB_CLIENT_SECRET=fixture-only \
  --binding ADMIN_GITHUB_IDS=12345 --binding ADMIN_HISTORY_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA \
  --binding ADMIN_SESSION_SECRET=local-fixture-never-use-in-production &
pages_pid=$!
trap 'kill "$pages_pid" 2>/dev/null || true' INT TERM
wait "$pages_pid"
