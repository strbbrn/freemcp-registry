// Local SQLite/FTS5 scalability smoke test (not a Cloudflare D1 latency benchmark).
// Run on Node 22+: node --disable-warning=ExperimentalWarning scripts/benchmark-d1.mjs
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
const db=new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../migrations/0001_servers.sql',import.meta.url),'utf8'));
const insert=db.prepare('INSERT INTO servers(id,name,description,category,author,tags_json,github_url,stars) VALUES (?,?,?,?,?,?,?,?)');
const start=performance.now();
db.exec('BEGIN');
for(let i=0;i<10000;i++)insert.run('bench-'+i,'Benchmark server '+i,'Cloud and security automation server '+i,i%2?'Cloud':'Security','benchmark','["benchmark","automation"]','https://github.com/example/benchmark',i);
db.exec('COMMIT');
const seeded=performance.now();
const count=db.prepare('SELECT COUNT(*) AS total FROM servers').get().total;
const indexed=db.prepare('SELECT COUNT(*) AS total FROM servers_search').get().total;
if(count!==10000||indexed!==10000)throw new Error('FTS index mismatch');
const startQuery=performance.now();
const found=db.prepare('SELECT id FROM servers WHERE id IN (SELECT id FROM servers_search WHERE servers_search MATCH ?) ORDER BY name COLLATE NOCASE,id LIMIT 24 OFFSET 240').all('"benchmark"*');
const queryMs=performance.now()-startQuery;
if(found.length!==24)throw new Error('Unexpected pagination length: '+found.length);
const category=db.prepare('SELECT COUNT(*) AS total FROM servers WHERE category=?').get('Security').total;
if(category!==5000)throw new Error('Category filter mismatch');
console.log(JSON.stringify({records:count,ftsRecords:indexed,pageSize:found.length,securityCount:category,seedMs:Math.round(seeded-start),queryMs:Number(queryMs.toFixed(2))},null,2));
// Compare equivalent published-directory searches against the same indexed data.
db.exec("ALTER TABLE servers ADD COLUMN details_json TEXT NOT NULL DEFAULT '{}'");
db.exec(`UPDATE servers SET details_json = '{"review":{"status":"pending-publication"}}' WHERE stars % 20 = 0`);
const legacyCount = db.prepare(`SELECT COUNT(*) AS total FROM servers
  WHERE COALESCE(json_extract(details_json, '$.review.status'), 'published') NOT IN ('pending-publication', 'test-only')
  AND id IN (SELECT id FROM servers_search WHERE servers_search MATCH ?)`);
const legacyPage = db.prepare(`SELECT id FROM servers
  WHERE COALESCE(json_extract(details_json, '$.review.status'), 'published') NOT IN ('pending-publication', 'test-only')
  AND id IN (SELECT id FROM servers_search WHERE servers_search MATCH ?)
  ORDER BY name COLLATE NOCASE, id LIMIT ? OFFSET ?`);
const adapter = { prepare(sql) {
  const statement = db.prepare(sql);
  return { bind(...params) { return {
    first: async () => statement.get(...params),
    all: async () => ({ results: statement.all(...params) }),
  }; } };
} };
const { registry } = await import('../lib/registry.js');
const current = registry(adapter);
const query = '"benchmark"*';
const measurements = [];
for (const page of [11, 375]) {
  const times = { legacy: [], current: [] };
  for (let i = 0; i < 7; i++) {
    const beforeLegacy = performance.now();
    const count = legacyCount.get(query).total;
    const oldRows = legacyPage.all(query, 24, (page - 1) * 24);
    times.legacy.push(performance.now() - beforeLegacy);
    const beforeCurrent = performance.now();
    const newRows = await current.directory({ q: 'benchmark', category: '', sort: 'name', page, size: 24 });
    times.current.push(performance.now() - beforeCurrent);
    if (count !== newRows.total || oldRows.map(row => row.id).join() !== newRows.servers.map(row => row.id).join()) {
      throw new Error('Public registry search mismatch');
    }
  }
  const median = samples => Number(samples.sort((a, b) => a - b)[3].toFixed(2));
  measurements.push({ page, previousMedianMs: median(times.legacy), currentMedianMs: median(times.current) });
}
console.log(JSON.stringify({ description: 'Local SQLite search only, seven samples per variant', measurements }, null, 2));
db.close();
