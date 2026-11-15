import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const directory = 'src/data/servers';
const files = readdirSync(directory).filter(file => file.endsWith('.json')).sort();
const baseline = JSON.parse(readFileSync('src/data/registry.json', 'utf8'));
assert.ok(files.length >= baseline.length, 'Migration lost server records');
const byId = new Map();
for (const file of files) {
  const server = JSON.parse(readFileSync(join(directory, file), 'utf8'));
  assert.equal(file, server.id + '.json', 'Filename must match server ID');
  assert.match(server.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(!byId.has(server.id), 'Duplicate server ID: ' + server.id);
  byId.set(server.id, server);
}
for (const server of baseline) {
  assert.ok(byId.has(server.id), 'Original server slug missing: ' + server.id);
}
console.log('Validated ' + files.length + ' individual MCP server records against the original catalogue.');
