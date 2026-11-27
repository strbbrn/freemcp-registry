import { mkdir } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const local = !process.env.FREEMCP_TEST_URL;
const origin = 'http://127.0.0.1:3011';
const session = '__Host-freemcp-admin=' + 'L'.repeat(43);

test('admin Pages routes fail closed and carry security headers', async ({ request }) => {
  for (const path of ['/admin','/admin/','/admin/servers/new/','/admin/servers/sqlite-mcp/','/admin/import/',
    '/admin/submissions/','/admin/submissions/42/','/admin/promotions/','/admin/sponsors/','/admin/activity/','/admin/settings/']) {
    const response = await request.get(path,{maxRedirects:0});
    expect([303,404,503], path).toContain(response.status());
    expect(response.headers()['cache-control'],path).toMatch(/no-store/);
    expect(response.headers()['x-robots-tag'],path).toMatch(/noindex/);
  }
  const response = await request.get('/api/admin/servers/',{maxRedirects:0});
  expect([401,404,503]).toContain(response.status());
  expect(response.headers()['cache-control']).toMatch(/no-store/);
});

async function authenticated(context) {
  await context.addCookies([{name:'__Host-freemcp-admin',value:'L'.repeat(43),url:'https://127.0.0.1:3011/',
    secure:true,httpOnly:true,sameSite:'Lax'}]);
}
test('real D1 rolls back changes when the audit insert fails', async ({request})=>{
  test.skip(!local,'Requires isolated test D1 and a seeded fixture session');
  const headers={Cookie:session,Origin:origin};
  const identity=await request.get('/api/admin/session/',{headers});
  expect(identity.status(),await identity.text()).toBe(200);
  const {csrf}=await identity.json();
  const draft={csrf,action:'create',reason:'Fixture audit rejected',id:'admin-audit-rollback',
    name:'Atomic fixture',description:'This change is expected to roll back.',category:'Other',author:'Fixture',
    tags:['synthetic'],github_url:'https://github.com/example/admin-audit-rollback'};
  const response=await request.post('/api/admin/servers/',{headers,data:draft});
  expect(response.status()).toBe(503);
  expect((await request.get('/api/admin/servers/admin-audit-rollback/',{headers})).status()).toBe(404);
  const omitted={...draft,id:'admin-audit-omitted',github_url:'https://github.com/example/admin-audit-omitted',reason:'Fixture audit omitted'};
  expect((await request.post('/api/admin/servers/',{headers,data:omitted})).status()).toBe(409);
  expect((await request.get('/api/admin/servers/admin-audit-omitted/',{headers})).status()).toBe(404);
  const promotion={csrf,action:'create',reason:'Fixture placement audit omitted',id:'admin-omit-promo',headline:'Omitted',
    eyebrow:'Fixture',description:'Rollback',cta_text:'Visit',target_url:'https://example.com/',theme:'violet',
    weight:1,rotation_seconds:7,status:'draft',placements:['home/primary','detail/bottom']};
  expect((await request.post('/api/admin/promotions/',{headers,data:promotion})).status()).toBe(409);
  for (const slot of ['home-primary','detail-bottom']) {
    expect((await request.get('/api/admin/promotions/admin-omit-promo-'+slot+'/',{headers})).status()).toBe(404);
  }
  const noCsrf=await request.post('/api/admin/servers/',{headers,data:{...draft,csrf:'invalid'}});
  expect(noCsrf.status()).toBe(403);
  const badOrigin=await request.post('/api/admin/servers/',{headers:{...headers,Origin:'https://example.com'},data:draft});
  expect(badOrigin.status()).toBe(403);
});

for (const [device,width,height] of [['mobile',390,844],['desktop',1440,900]]) {
  test(`admin registry and promotions flow on ${device}`, async ({page,context,request})=>{
    test.skip(!local,'Authenticated browser testing uses isolated local D1 fixtures');
    test.setTimeout(55000);
    const id='admin-ui-'+device, title='Maintainer\'s <em>listing</em> '+device;
    await page.setViewportSize({width,height});
    await authenticated(context);
    await page.goto('/admin/');
    await expect(page.getByRole('heading',{name:'Overview'})).toBeVisible();
    await expect(page.locator('.environment')).toHaveText('Local fixture');
    await expect(page.locator('.metric')).toHaveCount(8);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (process.env.FREEMCP_ADMIN_SCREENSHOTS) {
      await mkdir(process.env.FREEMCP_ADMIN_SCREENSHOTS,{recursive:true});
      await page.screenshot({path:process.env.FREEMCP_ADMIN_SCREENSHOTS+'/'+device+'-overview.png', animations:'disabled'});
    }
    await page.getByRole('link',{name:'Registry',exact:true}).click();
    await page.getByRole('link',{name:'New listing'}).click();
    await page.getByLabel('Listing ID',{exact:true}).fill(id);
    await page.getByLabel('Name',{exact:true}).fill(title);
    await page.getByLabel('Category',{exact:true}).fill('Other');
    await page.getByLabel('Maintainer',{exact:true}).fill('Fixture');
    await page.getByLabel('Repository URL').fill('https://github.com/example/'+id);
    await page.getByLabel('Description',{exact:true}).fill('A synthetic fixture.');
    await page.locator('details.editor-section').filter({has:page.locator('summary',{hasText:/^Installation$/})}).locator('summary').first().click();
    await page.getByRole('combobox',{name:'Transport',exact:true}).selectOption('stdio');
    await page.getByLabel('Primary documentation URL',{exact:true}).fill('https://github.com/example/'+id+'#readme');
    await page.getByRole('button',{name:'Add installation',exact:true}).click();
    const installation=page.getByRole('group',{name:'Installations 1'});
    await installation.getByLabel('Title',{exact:true}).fill('Fixture installation');
    await installation.getByLabel('Executable for Server').fill('fixture-command');
    await installation.getByLabel('Arguments for Server (one per line)').fill('--dry-run');
    await page.getByLabel('Prerequisites, one per line').fill('Compatible fixture runtime');
    await page.locator('summary',{hasText:/^Security$/}).click();
    await page.getByLabel('Security considerations, one per line').fill('Only use synthetic fixture data.');
    await page.locator('summary',{hasText:/^Tools$/}).click();
    await page.getByRole('button',{name:'Add tool',exact:true}).click();
    const entry=page.getByRole('group',{name:'Tools 1'});
    await entry.getByLabel('Tool name',{exact:true}).fill('fixture_tool');
    await entry.getByLabel('Tool description',{exact:true}).fill('Returns a synthetic result.');
    await page.getByLabel('Reason',{exact:true}).fill('Browser fixture');
    await page.getByRole('button',{name:'Create draft'}).click();
    await expect(page).toHaveURL(new RegExp('/admin/servers/'+id+'/$'));
    await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
    expect(await page.locator('h1 em').count()).toBe(0);
    if (process.env.FREEMCP_ADMIN_SCREENSHOTS) {
      await page.screenshot({path:process.env.FREEMCP_ADMIN_SCREENSHOTS+'/'+device+'-registry.png', animations:'disabled'});
    }
    expect((await request.get('/servers/'+id)).status()).toBe(404);
    await page.getByLabel('Name',{exact:true}).fill(title+' proposed');
    const popupEvent=page.waitForEvent('popup');
    await page.getByRole('button',{name:'Preview unsaved listing'}).click();
    const popup=await popupEvent;
    await expect(popup.getByRole('heading',{name:title+' proposed',exact:true})).toBeVisible();
    await expect(popup.getByText('fixture_tool',{exact:true})).toBeVisible();
    await expect(popup.locator('link[rel=canonical]')).toHaveCount(0);
    await popup.close();
    await page.getByRole('button',{name:'Review proposed edits'}).click();
    await expect(page.getByRole('heading',{name:'Review proposed edits'})).toBeVisible();
    await expect(page.getByText(title+' proposed',{exact:false})).toBeVisible();
    page.once('dialog',dialog=>dialog.accept());
    await page.getByRole('link',{name:'Back to editor'}).click();
    await expect(page.getByLabel('Name',{exact:true})).toHaveValue(title);
    await page.getByRole('link',{name:'Preview',exact:true}).click();
    await expect(page.getByText('fixture_tool',{exact:true})).toBeVisible();
    await page.getByRole('link',{name:'Back to the listing editor'}).click();
    await page.locator('summary',{hasText:/^Publication and lifecycle$/}).click();
    const publish=page.locator('form').filter({has:page.getByRole('button',{name:'Publish listing',exact:true})});
    await publish.getByLabel('Reason',{exact:true}).fill('Publish test candidate');
    await publish.getByLabel('Confirm this publication change.').check();
    await publish.getByRole('button',{name:'Publish listing'}).click();
    await expect(page.locator('input[name="action"][value="unpublish"]')).toHaveCount(1);
    await page.locator('summary',{hasText:/^Publication and lifecycle$/}).click();
    const unpublish=page.locator('form').filter({has:page.getByRole('button',{name:'Unpublish listing',exact:true})});
    await expect(unpublish).toBeVisible();
    expect((await request.get('/servers/'+id)).status()).toBe(200);
    await unpublish.getByLabel('Reason',{exact:true}).fill('Unpublish test candidate');
    await unpublish.getByLabel('Confirm this publication change.').check();
    await unpublish.getByRole('button',{name:'Unpublish listing'}).click();
    await expect(page.locator('input[name="action"][value="publish"]')).toHaveCount(1);
    await page.locator('summary',{hasText:/^Publication and lifecycle$/}).click();
    await expect(page.getByRole('button',{name:'Publish listing',exact:true})).toBeVisible();
    expect((await request.get('/servers/'+id)).status()).toBe(404);

    await page.getByRole('link',{name:'Promotions',exact:true}).click();
    await page.getByRole('link',{name:'New promotion'}).click();
    await page.getByLabel('Promotion ID').fill(id+'-promo');
    await page.getByLabel('Headline').fill('Fixture promotion '+device);
    await page.getByLabel('HTTPS destination').fill('https://example.com/');
    await page.getByLabel('home · primary').check();
    await page.getByLabel('detail · bottom').check();
    await page.getByLabel('Reason',{exact:true}).fill('Promotion layout test');
    await page.getByRole('button',{name:'Create promotion'}).click();
    await expect(page.getByRole('link',{name:'Fixture promotion '+device,exact:true})).toHaveCount(2);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.getByRole('button',{name:'Toggle color theme'}).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  });
}

test('sponsorship edits preserve the public three-tier layout', async ({page,context,request})=>{
  test.skip(!local,'Requires isolated test D1 and a seeded fixture session');
  await authenticated(context);
  await page.goto('/admin/sponsors/');
  const gold=page.locator('#sponsorship-gold');
  await gold.locator('summary').first().click();
  await gold.getByLabel('Tier name').fill('Gold fixture');
  await gold.getByLabel('Status').selectOption('active');
  await gold.getByLabel('Reason',{exact:true}).fill('Sponsorship browser fixture');
  await gold.getByLabel('Confirm changes to the public homepage').check();
  const saved=page.waitForResponse(response=>response.url().endsWith('/api/admin/sponsors/gold/') && response.status()===200);
  await gold.getByRole('button',{name:'Save tier'}).click();
  await saved;
  const publicPage=await request.get('/');
  const text=await publicPage.text();
  expect(text).toContain('Gold fixture');
  expect(text).toMatch(/sponsor-tier (gold|diamond|platinum)/);
  expect((text.match(/class="sponsor-tier (?:gold|diamond|platinum)"/g)||[]).length).toBe(3);
});

test('mobile bulk import validates, selects and confirms private drafts', async ({page,context,request})=>{
  test.skip(!local,'Requires isolated test D1 and a seeded fixture session');
  await page.setViewportSize({width:390,height:844});
  await authenticated(context);
  await page.goto('/admin/import/');
  const entry=id=>({id,name:id,description:'Isolated bulk browser fixture',category:'Other',author:'Fixture',
    github_url:'https://github.com/example/'+id});
  await page.getByLabel('Candidate JSON').fill(JSON.stringify([entry('mobile-bulk-a'),entry('mobile-bulk-b'),entry('mobile-bulk-c'),{id:'invalid'}]));
  await page.getByRole('button',{name:'Validate candidates'}).click();
  await expect(page.getByText('3 of 4 candidates can be selected.')).toBeVisible();
  await page.getByLabel('mobile-bulk-a · mobile-bulk-a').check();
  await page.getByLabel('mobile-bulk-c · mobile-bulk-c').check();
  await page.getByLabel('Reason',{exact:true}).fill('Mobile bulk fixture');
  await page.getByLabel('Create the selected listings as private drafts.').check();
  await page.getByRole('button',{name:'Create selected drafts'}).click();
  await expect(page.getByRole('heading',{name:'Import results',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'mobile-bulk-a',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'mobile-bulk-c',exact:true})).toBeVisible();
  expect((await request.get('/api/admin/servers/mobile-bulk-b/',{headers:{Cookie:session}})).status()).toBe(404);
  expect((await request.get('/servers/mobile-bulk-a/')).status()).toBe(404);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

for (const width of [320,360,390,430,768,1440]) {
  test('dashboard stays usable at '+width+' CSS pixels',async ({page,context})=>{
    test.skip(!local,'Requires the isolated authenticated fixture');
    await authenticated(context);
    await page.setViewportSize({width,height:850});
    await page.goto('/admin/');
    await expect(page.getByRole('heading',{name:'Recent administrative activity'})).toBeVisible();
    const nav=page.getByRole('navigation',{name:'Quick navigation'});
    if (width<=760) {
      await expect(nav).toBeVisible();
      for(const link of await nav.getByRole('link').all()) expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
    } else await expect(nav).toBeHidden();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (process.env.FREEMCP_ADMIN_SCREENSHOTS) {
      await mkdir(process.env.FREEMCP_ADMIN_SCREENSHOTS,{recursive:true});
      await page.screenshot({path:process.env.FREEMCP_ADMIN_SCREENSHOTS+'/'+width+'-overview.png',animations:'disabled'});
    }
    await page.getByRole('link',{name:'Add MCP server',exact:true}).click();
    const installation=page.locator('summary',{hasText:/^Installation$/});
    await expect(installation).toBeVisible();
    await expect(page.getByRole('button',{name:'Add installation',exact:true})).toBeHidden();
    await page.getByLabel('Name',{exact:true}).fill('Unsaved fixture');
    await expect(page.locator('.unsaved')).toBeVisible();
    await installation.click();
    await expect(page.getByRole('button',{name:'Add installation',exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.getByRole('button',{name:'Toggle color theme'}).click();
    const theme=await page.locator('html').getAttribute('data-theme');
    expect(theme).toBe('light');
    if (process.env.FREEMCP_ADMIN_SCREENSHOTS) {
      await page.screenshot({path:process.env.FREEMCP_ADMIN_SCREENSHOTS+'/'+width+'-editor.png',animations:'disabled'});
    }
  });
}

for (const width of [320,390,430,1440]) {
  test('saved submission keeps inline validation and layout at '+width+' CSS pixels',async ({page,context})=>{
    test.skip(!local,'Requires the isolated authenticated fixture');
    await authenticated(context);
    await page.setViewportSize({width,height:850});
    await page.goto('/admin/submissions/901/');
    await expect(page.getByText('Cached evidence may be stale.',{exact:false})).toBeVisible();
    await expect(page.locator('meta[name="viewport"]')).toHaveCount(1);
    expect(await page.locator('meta[name="viewport"]').getAttribute('content')).toContain('width=device-width');
    await page.getByLabel('Name',{exact:true}).fill('Unsaved text survives validation');
    await page.locator('summary',{hasText:/^Advanced JSON editor$/}).click();
    const json=page.getByRole('textbox',{name:'Candidate JSON',exact:true});
    await json.fill('{ invalid advanced JSON');
    await page.getByLabel('Use this JSON instead of the structured fields').check();
    await page.getByRole('button',{name:'Validate candidate',exact:true}).click();
    await expect(page.getByRole('button',{name:/Advanced candidate JSON must be valid JSON/})).toBeVisible();
    await expect(json).toHaveValue('{ invalid advanced JSON');
    await page.getByLabel('Use this JSON instead of the structured fields').uncheck();
    await page.getByRole('button',{name:'Validate candidate',exact:true}).click();
    await expect(page.getByRole('button',{name:/provide a maintainer documentation URL/})).toBeVisible();
    await expect(page.getByRole('button',{name:/select a documented transport/})).toBeVisible();
    await expect(page.getByLabel('Name',{exact:true})).toHaveValue('Unsaved text survives validation');
    await expect(json).toHaveValue('{ invalid advanced JSON');
    await expect(page.locator('.unsaved')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if(process.env.FREEMCP_ADMIN_SCREENSHOTS) {
      await mkdir(process.env.FREEMCP_ADMIN_SCREENSHOTS,{recursive:true});
      await page.screenshot({path:process.env.FREEMCP_ADMIN_SCREENSHOTS+'/'+width+'-inline-validation.png',animations:'disabled'});
    }
    page.once('dialog',dialog=>dialog.accept());
    await page.goto('/admin/unknown-fixture/');
    await expect(page.getByRole('heading',{name:'Page not found.'})).toBeVisible();
    expect(await page.locator('meta[name="viewport"]').getAttribute('content')).toContain('width=device-width');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
