import { test, expect } from '@playwright/test';

const local = !process.env.FREEMCP_TEST_URL;
const noIndex = /noindex/;

test.beforeEach(async ({ page }) => {
  // Keep external fonts and GitHub availability out of navigation and layout assertions.
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.route('https://api.github.com/repos/**', route => route.fulfill({
    json: { stargazers_count: 42, archived: false, disabled: false },
  }));
});

test('initial HTML, HTTP errors, canonicals and redirects', async ({ request }) => {
  const home = await request.get('/');
  expect(home.status()).toBe(200);
  expect(await home.text()).toMatch(/id="recent-servers"[^>]*><article class="featured-card"/);
  const directory = await request.get('/servers/');
  const directoryHtml = await directory.text();
  expect(directoryHtml).toContain('class="server-row"');
  expect(directoryHtml).toContain('https://freemcp.in/servers/');
  expect(directoryHtml).toMatch(/href="\/servers\/\?page=2"/);
  const second = await request.get('/servers/?page=2');
  const secondHtml = await second.text();
  expect(second.status()).toBe(200);
  expect(secondHtml).toMatch(/rel="canonical" href="https:\/\/freemcp.in\/servers\/\?page=2"/);
  expect(secondHtml).toMatch(/rel="prev" href="\/servers\/"/);
  expect(secondHtml).toContain('Browse MCP servers, page 2');
  expect(secondHtml).toContain('"@type":"ItemList"');
  const filtered = await request.get('/servers/?q=sqlite');
  expect(await filtered.text()).toMatch(/name="robots" content="noindex, follow"/);
  const paths = [['/v2-preview', '/servers/', 301], ['/v2-preview/', '/servers/', 301],
    ['/servers/?page=1', '/servers/', 308], ['/servers/sqlite-mcp/', '/servers/sqlite-mcp', 308]];
  for (const [from, to, status] of paths) {
    const response = await request.get(from, { maxRedirects: 0 });
    expect(response.status(), from).toBe(status);
    expect(new URL(response.headers().location, response.url()).pathname).toBe(to);
  }
  for (const path of ['/missing-registry-test-page', '/servers/?page=9999', '/servers/?page=-1', '/servers/nonexistent-test-listing']) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
  for (const path of ['/', '/servers/', '/servers/sqlite-mcp', '/api/servers', '/sitemap.xml']) {
    expect((await request.head(path)).status(), path).toBe(200);
  }
  if (!local && new URL(home.url()).hostname.endsWith('.pages.dev')) {
    expect(home.headers()['x-robots-tag']).toMatch(noIndex);
    expect((await request.get('/guides/')).headers()['x-robots-tag']).toMatch(noIndex);
  }
});

test('well-known resources and sitemap have real document types', async ({ request }) => {
  const llms = await request.get('/llms.txt');
  expect(llms.headers()['content-type']).toMatch(/^text\/plain/);
  expect(await llms.text()).toMatch(/^# FreeMCP\n\n> /);
  const ard = await request.get('/.well-known/ard.json');
  const legacy = await request.get('/.well-known/ai-catalog.json');
  for (const result of [ard, legacy]) {
    expect(result.status()).toBe(200);
    expect(result.headers()['content-type']).toMatch(/^application\/json/);
  }
  expect(await ard.json()).toEqual(await legacy.json());
  const openApi = await request.get('/api/openapi.json');
  expect(openApi.headers()['content-type']).toMatch(/^application\/vnd.oai.openapi\+json/);
  expect(Object.keys((await openApi.json()).paths)).toEqual(['/api/servers']);
  const sitemap = await request.get('/sitemap.xml');
  const xml = await sitemap.text();
  expect(sitemap.headers()['content-type']).toMatch(/^application\/xml/);
  expect(xml).toContain('<loc>https://freemcp.in/servers/sqlite-mcp</loc>');
  expect(xml).not.toMatch(/v2-preview|draft-fixture|test-only-fixture|broken-review-fixture/);
});

test('desktop search, filters, sorting, pagination and history', async ({ page }) => {
  const registryApiCalls = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/servers') registryApiCalls.push(request.url());
  });
  await page.goto('/servers/');
  await expect(page.locator('.server-row')).toHaveCount(24);
  await page.locator('#next-page a').click();
  await expect(page).toHaveURL(/page=2$/);
  await expect(page.locator('#page-indicator')).toHaveText(/Page 2 of/);
  await page.goBack();
  await expect(page).toHaveURL(/\/servers\/$/);
  await page.goForward();
  await expect(page).toHaveURL(/page=2$/);
  await page.goto('/servers/?page=2');
  await expect(page.locator('.server-row h2').first()).toBeVisible();

  await page.locator('#registry-query').fill('SQLite');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/q=SQLite$/);
  await expect(page.locator('.server-row h2').filter({ hasText: /sqlite/i }).first()).toBeVisible();
  await page.goto('/servers/');
  await page.locator('#registry-sort').selectOption('category');
  await expect(page).toHaveURL(/sort=category$/);
  const categories = await page.locator('#registry-category option').allTextContents();
  const chosen = categories.find(category => category === 'Fixture') || categories[1];
  await page.locator('#registry-category').selectOption(chosen);
  await expect(page).toHaveURL(/category=.*&sort=category$/);
  for (const button of await page.locator('.server-category').allTextContents()) expect(button).toBe(chosen);
  expect(registryApiCalls).toEqual([]);
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('reads home and lists, paginates, and submits a search', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#recent-servers a').first()).toBeVisible();
    await page.goto('/servers/');
    await page.locator('#next-page a').click();
    await expect(page.locator('#page-indicator')).toHaveText(/Page 2 of/);
    await page.locator('#registry-query').fill('sqlite');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.locator('a[href="/servers/sqlite-mcp"]').first()).toBeVisible();
    await page.locator('a[href="/servers/sqlite-mcp"]').first().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/SQLite/i);
  });
});

test('mobile themes, sponsorship, archive state, copy and badges', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await expect(page.locator('#sponsor .sponsor-tier')).toHaveCount(3);
  await expect(page.locator('a.support-beer')).toHaveAttribute('href', 'https://buymeacoffee.com/strbbrn');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Toggle color theme' }).click();
  await page.goto('/servers/sqlite-mcp');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('#github-stars')).toHaveText('42');
  await expect(page.locator('#lifecycle-badge')).toHaveText('Archived');
  await expect(page.locator('#lifecycle-warning')).toContainText('FreeMCP lists this implementation as archived.');
  await expect(page.locator('#lifecycle-warning')).not.toContainText('GitHub reports');
  await expect(page.locator('#github-lifecycle-value')).toHaveText('Active');
  await expect(page.locator('#freemcp-badge img')).toBeVisible();
  const loader = page.locator('#install-0');
  await expect(loader).toBeVisible();
  await page.getByRole('button', { name: 'Copy configuration' }).first().click();
  await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await loader.textContent());
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Toggle color theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('promotions render across the homepage, directory pages and detail', async ({ page }) => {
  await page.goto('/');
  for (const slot of ['primary', 'strip']) {
    await expect(page.locator(`[data-promo-placement=home][data-promo-slot=${slot}]`)).toBeVisible();
  }
  for (const route of ['/servers/', '/servers/?page=2']) {
    await page.goto(route);
    for (const slot of ['primary', 'footer']) {
      await expect(page.locator(`[data-promo-placement=directory][data-promo-slot=${slot}]`)).toBeVisible();
    }
    await expect(page.locator('[data-inline-position="7"]')).toBeVisible();
    expect(await page.locator('[data-registry-start="0"] .server-row').count()).toBe(7);
  }
  await page.goto('/servers/?q=sqlite');
  await expect(page.locator('[data-inline-position]')).toHaveCount(0);
  await page.goto('/servers/');
  await expect(page.locator('[data-inline-position="7"]')).toBeVisible();
  await page.goto('/servers/sqlite-mcp');
  for (const slot of ['primary', 'sidebar', 'bottom']) {
    await expect(page.locator(`[data-detail-promo=${slot}]`)).toBeVisible();
  }
});

test('submission form opens a prefilled issue review without sending it', async ({ page }) => {
  await page.addInitScript(() => { window.open = () => null; });
  await page.goto('/submit/');
  await page.locator('[name=repository]').fill('https://github.com/example/test');
  await page.locator('[name=name]').fill('Test server');
  await page.locator('textarea[name=description]').fill('An example server for checking the submission form.');
  const category = page.locator('[name=category]');
  if (await category.isVisible()) await category.selectOption({ index: 1 });
  await page.locator('input[type=checkbox][required]').check();
  await page.getByRole('button', { name: 'Review submission on GitHub' }).click();
  const link = page.getByRole('link', { name: 'Open your prefilled GitHub issue' });
  await expect(link).toBeVisible();
  const target = new URL(await link.getAttribute('href'));
  expect(target.origin + target.pathname).toBe('https://github.com/strbbrn/freemcp-registry/issues/new');
  expect(target.searchParams.get('title')).toContain('Test server');
  expect(target.searchParams.get('body')).toContain('https://github.com/example/test');
});

test('local rendered pages hide draft and malformed fixture rows', async ({ request }) => {
  test.skip(!local, 'Requires synthetic local fixture data');
  for (const id of ['draft-fixture', 'test-only-fixture', 'broken-review-fixture']) {
    expect((await request.get('/servers/' + id)).status()).toBe(404);
  }
  const page = await request.get('/servers/escaping-fixture');
  const html = await page.text();
  expect(html).toContain('Escaped &lt;asset&gt; description.');
  expect(html).not.toContain('http://example.com/not-https');
  expect(html).not.toMatch(/draft-fixture|test-only-fixture|broken-review-fixture/);
});

test('campaign tags survive landing and redirects without changing canonical links', async ({ request }) => {
  const landing = await request.get('/servers/?utm_source=launch&gclid=campaign-1', { maxRedirects: 0 });
  expect(landing.status()).toBe(200);
  const html = await landing.text();
  expect(html).toMatch(/rel="canonical" href="https:\/\/freemcp.in\/servers\/"/);
  expect(html).toMatch(/href="\/servers\/\?page=2"/);
  expect(html).not.toMatch(/utm_source|gclid/);
  const response = await request.get('/servers/?page=1&utm_source=launch&gclid=campaign-1', { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  const destination = new URL(response.headers().location, response.url());
  expect(destination.pathname + destination.search).toBe('/servers/?utm_source=launch&gclid=campaign-1');
});

test('live GitHub status supersedes synced status and failures retain labelled cached data', async ({ page }) => {
  test.skip(!local, 'Requires synthetic local lifecycle fixtures');
  let status = 200;
  let metadata = { stargazers_count: 71, archived: false, disabled: false };
  await page.route('https://api.github.com/repos/example/fixture', route => route.fulfill({ status, json: metadata }));
  await page.goto('/servers/fixture-01');
  await expect(page.locator('#github-lifecycle-value')).toHaveText('Active');
  await expect(page.locator('#lifecycle-badge')).toBeHidden();
  await expect(page.locator('#lifecycle-warning')).toBeHidden();
  await expect(page.locator('#summary-stars')).toHaveText('71');
  await page.evaluate(() => sessionStorage.clear());

  metadata = { stargazers_count: 72, archived: false, disabled: true };
  await page.goto('/servers/fixture-03');
  await expect(page.locator('#lifecycle-badge')).toHaveText('Repository disabled');
  await expect(page.locator('#lifecycle-warning')).toContainText('GitHub reports that this repository is disabled.');
  await page.evaluate(() => sessionStorage.clear());

  status = 503;
  for (const [id, expected, archived] of [
    ['fixture-01', 'Archived (last checked)', true],
    ['fixture-02', 'Active (last checked)', false],
  ]) {
    const failed = page.waitForResponse('https://api.github.com/repos/example/fixture');
    await page.goto('/servers/' + id);
    expect((await failed).status()).toBe(503);
    await expect(page.locator('#github-lifecycle-value')).toHaveText(expected);
    await expect(page.locator('#summary-stars')).toHaveText('0');
    await expect(page.locator('#lifecycle-badge')).toHaveText('Archived');
    if (archived) {
      await expect(page.locator('#lifecycle-warning')).toContainText('At the last check, GitHub reported that this repository is archived.');
    } else {
      await expect(page.locator('#lifecycle-warning')).toContainText('FreeMCP lists this implementation as archived.');
    }
  }

  const failed = page.waitForResponse('https://api.github.com/repos/example/fixture');
  await page.goto('/servers/fixture-06');
  await failed;
  await expect(page.locator('#github-lifecycle-value')).toHaveText('Unavailable');
  await expect(page.locator('#lifecycle-badge')).toBeHidden();
  await expect(page.locator('#lifecycle-warning')).toBeHidden();
});

for (const width of [390, 1440]) {
  test(`SQLite uses one lifecycle badge and warning at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('https://api.github.com/repos/modelcontextprotocol/servers-archived', route => route.fulfill({
      json: { stargazers_count: 42, archived: true, disabled: false },
    }));
    await page.goto('/servers/sqlite-mcp');
    await expect(page.locator('#github-lifecycle-value')).toHaveText('Archived');
    await expect(page.locator('.meta .badge:visible')).toHaveCount(1);
    await expect(page.locator('main > .notice:visible')).toHaveCount(1);
    const warning = page.locator('#lifecycle-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('FreeMCP lists this implementation as archived. GitHub reports that this repository is archived.');
    await expect(page.locator('#lifecycle-badge')).toHaveText('Archived');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.reload();
    await expect(page.locator('#github-lifecycle-value')).toHaveText('Archived (last checked)');
    await expect(warning).toContainText('At the last check, GitHub reported');
    await expect(page.locator('main > .notice:visible')).toHaveCount(1);
    await page.goto('/servers/?q=sqlite');
    await expect(page.locator('.server-row').filter({ has: page.locator('a[href="/servers/sqlite-mcp"]') }).locator('.status-pill')).toHaveText('Archived');
  });
}
