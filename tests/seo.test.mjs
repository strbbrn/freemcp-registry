import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { onRequestGet as api } from '../functions/api/servers.js';
import { onRequestGet as homepage } from '../functions/index.js';
import { onRequestGet as directory } from '../functions/servers/index.js';
import { onRequestGet as detail } from '../functions/servers/[id].js';
import { onRequestGet as sitemap } from '../functions/sitemap.xml.js';
import { registryLifecycle, storedRepositoryStatus } from '../lib/lifecycle.js';
import { discoveryManifest, openApi } from '../lib/discovery.js';
import { directoryRow } from '../lib/registry-pages.js';
import { readFilters, registry } from '../lib/registry.js';
import { canonicalUrl, directoryPath, escapeHtml, jsonLd, metadata, safeHttps } from '../lib/seo.js';
import { SITEMAP_SIZE, escapeXml, sitemapIndexXml, sitemapXml } from '../lib/sitemap.js';

const file = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const request = path => new Request('https://freemcp.in' + path);

function fixtureDatabase() {
  const db = new DatabaseSync(':memory:');
  for (const name of ['0001_servers.sql', '0002_server_details.sql', '0003_server_lifecycle.sql']) {
    db.exec(file('../migrations/' + name));
  }
  db.exec(file('../seed/servers.sql'));
  db.exec(file('./fixtures/registry.sql'));
  const statement = (sql, bindings = []) => {
    const prepared = db.prepare(sql);
    return {
      bind: (...args) => statement(sql, args),
      first: async () => prepared.get(...bindings),
      all: async () => ({ results: prepared.all(...bindings) }),
    };
  };
  return { prepare: statement, batch: async statements => Promise.all(statements.map(sql => sql.all())), close: () => db.close() };
}

test('FTS input, bounded filters and normalized directory URLs', () => {
  const filters = readFilters(new URLSearchParams({ q: ' '.concat('a'.repeat(140)), category: ' ', sort: 'constructor' }));
  assert.equal(filters.q.length, 120);
  assert.equal(filters.category, '');
  assert.equal(filters.sort, 'name');
  assert.equal(directoryPath(1), '/servers/');
  assert.equal(directoryPath(2, { q: 'name & tag', category: 'Data', sort: 'category' }), '/servers/?q=name+%26+tag&category=Data&sort=category&page=2');
  assert.equal(canonicalUrl(directoryPath(2)), 'https://freemcp.in/servers/?page=2');
  assert.deepEqual(metadata({ title: 'Listing', description: 'Description', path: '/servers/example', noindex: true }), {
    title: 'Listing', description: 'Description', type: 'website', canonical: 'https://freemcp.in/servers/example', robots: 'noindex, follow',
  });
});

test('HTML, URL, JSON-LD and XML output handle untrusted metadata', () => {
  assert.equal(escapeHtml('<a> "&\''), '&lt;a&gt; &quot;&amp;&#39;');
  const value = { name: '</script><metadata>' };
  const marked = jsonLd(value);
  assert.equal(marked.match(/<\/script>/gi).length, 1);
  assert.deepEqual(JSON.parse(marked.slice(marked.indexOf('>') + 1, marked.lastIndexOf('</script>'))), value);
  for (const invalid of ['http://example.test', 'ftp://example.test', '//example.test', 'https://name@example.test', 'https:// example.test', 'https:\\example.test']) {
    assert.equal(safeHttps(invalid), '', invalid);
  }
  assert.equal(safeHttps('https://github.com/example/project'), 'https://github.com/example/project');
  assert.equal(escapeXml('A&B<"\''), 'A&amp;B&lt;&quot;&apos;');
});

test('every registry query enforces visibility and tolerates malformed tags', async t => {
  const db = fixtureDatabase();
  t.after(() => db.close());
  const store = registry(db);
  const data = await store.directory({ q: 'fixture', category: '', sort: 'name', page: 1, size: 24 });
  assert.equal(data.total, 33);
  assert.equal(data.servers.length, 24);
  assert.ok(!JSON.stringify(data).includes('Hidden'));
  assert.equal(data.pages, 2);
  assert.ok((await store.categories()).includes('Fixture'));
  assert.ok(!(await store.categories()).includes('Pending fixture'));
  const recent = await store.recent();
  assert.equal(recent.total, 54);
  assert.equal(recent.servers[0].id, 'escaping-fixture');
  assert.deepEqual(recent.servers[0].tags, []);
  for (const id of ['draft-fixture', 'test-only-fixture', 'broken-review-fixture']) {
    assert.equal(await store.detail(id), null);
    assert.ok(!(await store.sitemapIds(SITEMAP_SIZE, 0)).includes(id));
  }
  assert.equal(await store.sitemapCount(), 54);
  const related = await store.related(await store.detail('escaping-fixture'));
  assert.equal(related.length, 5);
  assert.ok(related.every(row => /^fixture-/.test(row.id)));
  const symbolsOnly = await store.directory({ q: '"&%', sort: 'name', page: 1, size: 24 });
  assert.equal(symbolsOnly.total, 0);
});

test('API preserves response fields, limits and last-page behavior', async t => {
  const DB = fixtureDatabase();
  t.after(() => DB.close());
  const response = await api({ env: { DB }, request: request('/api/servers?page=10000&limit=30') });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(Object.keys(result).sort(), ['page', 'pageSize', 'pages', 'servers', 'total']);
  assert.deepEqual(Object.keys(result.servers[0]).sort(), ['author','category','description','id','lifecycle','name','tags']);
  assert.equal(result.page, 3);
  assert.equal(result.pageSize, 24);
  assert.equal(result.servers.length, 6);
});

test('real database detail and sitemap agree about public records', async t => {
  const DB = fixtureDatabase();
  t.after(() => DB.close());
  const env = { DB };
  const response = await detail({ env, params: { id: 'escaping-fixture' }, request: request('/servers/escaping-fixture') });
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Example &lt;&amp;&gt; &quot;metadata&quot;/);
  assert.doesNotMatch(html, /not-https|ftp:\/\/example.com/);
  assert.match(html, /"@type":"SoftwareApplication"/);
  const sheet = await sitemap({ env, request: request('/sitemap.xml') });
  const xml = await sheet.text();
  assert.match(sheet.headers.get('content-type'), /^application\/xml/);
  assert.equal((xml.match(/<loc>/g) ?? []).length, 66);
  assert.match(xml, /\/servers\/escaping-fixture/);
  assert.doesNotMatch(xml, /draft-fixture|test-only-fixture|broken-review-fixture|v2-preview|lastmod/);
  const unpublished = await detail({ env, params: { id: 'draft-fixture' }, request: request('/servers/draft-fixture') });
  assert.equal(unpublished.status, 404);
  const moved = await detail({ env, params: { id: 'sqlite-mcp' }, request: request('/servers/sqlite-mcp/') });
  assert.equal(moved.headers.get('location'), '/servers/sqlite-mcp');
});

test('sitemap index and partitions handle bounded discovery', () => {
  assert.match(sitemapIndexXml(2), /sitemapindex[\s\S]+\/sitemap\/1\.xml[\s\S]+\/sitemap\/2\.xml/);
  assert.doesNotMatch(sitemapXml(['example'], false), /\/guides\//);
  assert.match(sitemapXml([], true), /\/guides\//);
});

test('strict HTML pagination and failure response status', async t => {
  const DB = fixtureDatabase();
  t.after(() => DB.close());
  const env = { DB };
  for (const query of ['page=0', 'page=1.5', 'page=10001', 'page=2&page=3', 'page=4', 'page=xyz']) {
    assert.equal((await directory({ env, request: request('/servers/?' + query) })).status, 404, query);
  }
  const normalized = await directory({ env, request: request('/servers/?page=01&sort=name') });
  assert.equal(normalized.status, 308);
  assert.equal(normalized.headers.get('location'), '/servers/');
  t.mock.method(console, 'error', () => {});
  for (const [handler, path, params] of [
    [directory, '/servers/', {}],
    [detail, '/servers/example', { id: 'example' }], [sitemap, '/sitemap.xml', {}],
  ]) {
    const broken = { prepare() { throw new Error('internal fixture'); }, batch() { throw new Error('internal fixture'); } };
    for (const binding of [{}, { DB: broken }]) {
      const response = await handler({ env: binding, request: request(path), params });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.doesNotMatch(await response.text(), /internal fixture/);
    }
  }
});

test('homepage serves the complete static page uncached when D1 fails', async t => {
  t.mock.method(console, 'error', () => {});
  const broken = { batch() { throw new Error('internal fixture'); } };
  const fallback = file('../dist/index.html');
  for (const env of [{}, { DB: broken }]) {
    const response = await homepage({
      env, request: request('/'),
      next: async () => new Response(fallback, { headers: { 'content-type': 'text/html', etag: 'static-version' } }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('etag'), null);
    assert.equal(response.headers.get('retry-after'), null);
    const html = await response.text();
    assert.match(html, /Recent listings are temporarily unavailable/);
    assert.match(html, /Find the right tools/);
    assert.match(html, /href="\/guides\/install-mcp-server\//);
    assert.doesNotMatch(html, /internal fixture|<article class="featured-card"/);
  }
  const missing = await homepage({ env: {}, request: request('/'), next: async () => new Response(null, { status: 404 }) });
  assert.equal(missing.status, 503);
  assert.equal(missing.headers.get('retry-after'), '60');
});

test('campaign-aware normalization and invalid page checks avoid D1', async () => {
  const env = { get DB() { assert.fail('normalization called D1'); } };
  const cases = [
    ['/servers?page=01&sort=name&utm_source=Free+MCP&gclid=abc&unknown=1', '/servers/?utm_source=Free+MCP&gclid=abc'],
    ['/servers/?utm_content=a%26b&x=2&category=Database&page=02', '/servers/?category=Database&page=2&utm_content=a%26b'],
    ['/servers/?page=2&q=%20sqlite%20&utm_campaign=launch', '/servers/?q=sqlite&page=2&utm_campaign=launch'],
  ];
  for (const [from, target] of cases) {
    const response = await directory({ env, request: request(from) });
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('location'), target);
  }
  const invalid = await directory({ env, request: request('/servers/?page=2&page=3&utm_source=example') });
  assert.equal(invalid.status, 404);
});

test('registry lifecycle and last-known GitHub repository status are separate', async t => {
  const DB = fixtureDatabase();
  t.after(() => DB.close());
  const env = { DB };
  const store = registry(DB);
  const synced = await store.detail('fixture-01');
  assert.equal(storedRepositoryStatus(synced.details), 'Archived');
  assert.equal(registryLifecycle(synced.details), null);
  const editorial = await store.detail('fixture-02');
  assert.equal(storedRepositoryStatus(editorial.details), 'Active');
  assert.equal(registryLifecycle(editorial.details), 'archived');
  assert.equal(registryLifecycle({ ...synced.details, lifecycleSource: 'registry' }), 'archived');
  assert.equal(registryLifecycle({ lifecycle: 'archived', lifecycleSource: 'github' }), null);
  assert.equal(storedRepositoryStatus({ githubMetadata: { archived: true, disabled: false } }), null);
  assert.equal(registryLifecycle({ lifecycle: 'archived' }), 'archived');

  const list = await store.directory({ q: '', category: 'Fixture', sort: 'name', page: 1, size: 24 });
  const publicStatus = id => list.servers.find(row => row.id === id)?.lifecycle;
  assert.equal(publicStatus('fixture-01'), 'archived');
  assert.equal(publicStatus('fixture-02'), 'archived');
  assert.equal(publicStatus('fixture-03'), 'active');

  const archivedHtml = await (await detail({ env, params: { id: 'fixture-01' } })).text();
  assert.match(archivedHtml, /Archived \(last checked\)/);
  assert.match(archivedHtml, /At the last check, GitHub reported that this repository is archived/);
  assert.doesNotMatch(archivedHtml, /FreeMCP lists this implementation as archived/);
  const editorialHtml = await (await detail({ env, params: { id: 'fixture-02' } })).text();
  assert.match(editorialHtml, /FreeMCP lists this implementation as archived/);
  assert.match(editorialHtml, /Active \(last checked\)/);
  const combinedHtml = await (await detail({ env, params: { id: 'fixture-04' } })).text();
  assert.equal((combinedHtml.match(/id="lifecycle-badge"/g) ?? []).length, 1);
  assert.equal((combinedHtml.match(/id="lifecycle-warning"/g) ?? []).length, 1);
  assert.match(combinedHtml, /FreeMCP lists this implementation as archived. At the last check, GitHub reported that this repository is archived/);

  const directory = await store.directory({ q: '', category: 'Fixture', sort: 'name', page: 1, size: 24, includeCategories: true });
  const archivedCard = directoryRow(directory.servers.find(row => row.id === 'fixture-04'));
  const disabledCard = directoryRow(directory.servers.find(row => row.id === 'fixture-05'));
  assert.match(archivedCard, /GitHub: Archived \(last checked\)">Archived<\/span>/);
  assert.match(disabledCard, /GitHub: Disabled \(last checked\)">Repository disabled<\/span>/);
});

test('discovery artifacts pass both pinned upstream schemas and describe only the read-only API', () => {
  const ajv = new Ajv2020({ strict: false });
  ajv.addFormat('uri', value => {
    try { return Boolean(new URL(value).protocol); } catch { return false; }
  });
  ajv.addFormat('date-time', value => /^\d{4}-\d{2}-\d{2}T/i.test(value) && Number.isFinite(Date.parse(value)));
  const ard = JSON.parse(file('./fixtures/ard/ard-entry.schema.json'));
  const legacy = JSON.parse(file('./fixtures/ard/ai-catalog.schema.json'));
  ajv.addSchema(ard);
  for (const validate of [ajv.getSchema(ard.$id + '#/$defs/ArdManifest'), ajv.compile(legacy)]) {
    assert.ok(validate(discoveryManifest), JSON.stringify(validate.errors));
  }
  assert.equal(discoveryManifest.entries.length, 1);
  assert.equal(discoveryManifest.entries[0].url, 'https://freemcp.in/api/openapi.json');
  assert.deepEqual(Object.keys(openApi.paths), ['/api/servers']);
  assert.deepEqual(Object.keys(openApi.paths['/api/servers']), ['get']);
  for (const path of ['../dist/.well-known/ard.json', '../dist/.well-known/ai-catalog.json']) {
    assert.deepEqual(JSON.parse(file(path)), discoveryManifest);
  }
  assert.deepEqual(JSON.parse(file('../dist/api/openapi.json')), openApi);
});
