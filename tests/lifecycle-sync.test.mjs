import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { registryLifecycle, storedRepositoryStatus } from '../lib/lifecycle.js';

test('GitHub sync preserves editorial lifecycle and updates repository status independently', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE servers (id TEXT PRIMARY KEY, github_url TEXT, stars INTEGER, details_json TEXT)');
  const insert = db.prepare('INSERT INTO servers VALUES (?, ?, 0, ?)');
  const archive = { checkedAt: '2026-01-01T00:00:00Z', archived: 1, disabled: 0 };
  for (const [id, details] of [
    ['editorial', { lifecycle: 'archived' }],
    ['old-sync', { lifecycle: 'archived', githubMetadata: archive }],
    ['invalid', '{'],
    ['failed', { lifecycle: 'active' }],
  ]) {
    insert.run(id, 'https://github.com/example/' + id, typeof details === 'string' ? details : JSON.stringify(details));
  }
  const environment = {
    CLOUDFLARE_API_TOKEN: 'fixture',
    CLOUDFLARE_ACCOUNT_ID: 'fixture',
    GITHUB_TOKEN: 'fixture',
    D1_DATABASE_ID: '1d3540c0-d836-4f8e-b048-fd22d780b46b',
  };
  for (const [key, value] of Object.entries(environment)) {
    const previous = process.env[key];
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
    process.env[key] = value;
  }
  const logs = t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const location = new URL(url);
    if (location.hostname === 'api.cloudflare.com') {
      const { sql, params } = JSON.parse(options.body);
      return Response.json({ success: true, result: [{ success: true, results: db.prepare(sql).all(...params) }] });
    }
    assert.equal(location.hostname, 'api.github.com');
    if (location.pathname.endsWith('/failed')) return Response.json({}, { status: 503 });
    return Response.json({ stargazers_count: 19, archived: false, disabled: false });
  });

  await import('../scripts/sync-live-d1-metadata.mjs');

  const row = db.prepare('SELECT stars, details_json FROM servers WHERE id = ?');
  const editorial = JSON.parse(row.get('editorial').details_json);
  assert.equal(registryLifecycle(editorial), 'archived');
  assert.equal(storedRepositoryStatus(editorial), 'Active');
  assert.equal(editorial.lifecycleSource, 'registry');
  const oldSync = JSON.parse(row.get('old-sync').details_json);
  assert.equal(registryLifecycle(oldSync), null);
  assert.equal(storedRepositoryStatus(oldSync), 'Active');
  assert.equal(row.get('old-sync').stars, 19);
  assert.equal(row.get('invalid').details_json, '{');
  assert.equal(row.get('failed').details_json, '{"lifecycle":"active"}');
  assert.equal(JSON.parse(logs.mock.calls[0].arguments[0]).updated, 2);
});
