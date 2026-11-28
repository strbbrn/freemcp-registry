import { mkdir } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { readStructuredSubmission } from '../../src/lib/structured-submission.mjs';

const candidate=(tools=30)=>({id:'wizard-fixture',name:'Fixture MCP',description:'Synthetic submission for browser testing.',
  category:'Development',author:'Fixture maintainer',github_url:'https://github.com/example/wizard-fixture',
  tags:['sample'],details:{summary:'Structured overview',documentationUrl:'https://example.org/docs',
    documentationUrls:['https://example.org/'+('longIdentifier'.repeat(20))],
    transport:'stdio',transports:['stdio','http'],
    installations:[{title:'Desktop setup',client:'Test client',os:'Linux',config:{command:'fixture',args:['longArgument'.repeat(20)]}},
      {title:'Web setup',config:{url:'https://mcp.example.org/api',type:'http'}}],
    endpoints:[{transport:'http',url:'https://mcp.example.org/api'}],
    tools:Array.from({length:tools},(_,i)=>({name:'tool_'+i,description:'Synthetic tool description for entry '+i})),
    prerequisites:['Fixture runtime'],security:['Local only'],serviceDependencies:['Optional test service'],pricing:'Free test data'}});
const opening=async page=>{
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//,route=>route.abort());
  await page.addInitScript(()=>{window.open=()=>null;});
  await page.goto('/submit/');
};
async function paste(page,data) {
  await page.getByText('Upload or paste JSON',{exact:true}).click();
  await page.getByLabel('Paste JSON').fill(JSON.stringify(data));
  await page.getByRole('button',{name:'Apply JSON import'}).click();
  await expect(page.getByRole('heading',{name:'Listing details',exact:true})).toBeVisible();
}

for(const width of [320,360,390,768,1440]) {
  test('wizard renders a complete sandboxed listing at '+width+' CSS pixels',async ({page})=>{
    await page.setViewportSize({width,height:900});
    await opening(page);
    const count=width===320?80:width===360?15:30;
    const data=candidate(count);
    await paste(page,data);
    await page.getByRole('button',{name:'Advanced JSON',exact:true}).click();
    const source=page.getByLabel('Listing JSON');
    const edited=JSON.parse(await source.inputValue());
    edited.description='<img src=x onerror=alert(1)> Updated fixture';
    await source.fill(JSON.stringify(edited));
    await page.getByRole('button',{name:'Structured editor',exact:true}).click();
    await expect(page.getByLabel('Description',{exact:true})).toHaveValue(edited.description);
    await page.getByRole('button',{name:'Preview listing',exact:true}).click();
    const frame=page.frameLocator('#listing-preview');
    await expect(frame.getByText('Unpublished submission preview — not verified by FreeMCP.')).toBeVisible();
    await expect(frame.locator('#tools .tool-item')).toHaveCount(count);
    await expect(frame.getByText(edited.description,{exact:true})).toBeVisible();
    await expect(frame.locator('script, img, [data-detail-promo], [href]:not([href^="about:srcdoc#"]), link[rel=canonical]')).toHaveCount(0);
    await expect(page.locator('#listing-preview')).toHaveAttribute('sandbox','');
    const frameLayout=await frame.locator('html').evaluate(root=>{
      const link=root.querySelector('#more-documentation a');
      const range=document.createRange();
      range.selectNodeContents(link);
      const max=link.closest('li').getBoundingClientRect().right;
      const code=root.querySelector('.install pre');
      return {overflow:root.scrollWidth>root.clientWidth||[...range.getClientRects()].some(rect=>rect.right>max+1),
        scrolls:code.scrollWidth>code.clientWidth};
    });
    expect(frameLayout.overflow).toBe(false);
    if(width<=390) expect(frameLayout.scrolls).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.evaluate(()=>document.documentElement.dataset.theme='light');
    await expect(frame.locator('html')).toHaveAttribute('data-theme','light');
    await page.getByRole('button',{name:'Desktop preview'}).click();
    expect(await frame.locator('html').evaluate(root=>root.clientWidth)).toBeGreaterThan(800);
    await page.getByRole('button',{name:'Mobile preview'}).click();
    expect((await page.locator('#listing-preview').boundingBox()).width).toBeLessThanOrEqual(390);
    if(process.env.FREEMCP_WIZARD_SCREENSHOTS&&[390,1440].includes(width)){
      const directory=process.env.FREEMCP_WIZARD_SCREENSHOTS;
      await mkdir(directory,{recursive:true});
      if(width===1440) await page.getByRole('button',{name:'Desktop preview'}).click();
      await page.getByRole('heading',{name:'Preview',exact:true}).scrollIntoViewIfNeeded();
      await page.screenshot({path:directory+'/submission-preview-'+width+'.png',animations:'disabled'});
    }
    await page.getByRole('button',{name:'Back to listing details'}).click();
    await page.getByLabel('Server name').fill('Edited after preview');
    await page.getByRole('button',{name:'Preview listing',exact:true}).click();
    await expect(frame.locator('h1')).toHaveText('Edited after preview');
    await page.getByRole('button',{name:'Continue to submission'}).click();
    await page.getByRole('checkbox',{name:/I have permission/}).check();
    await page.getByRole('button',{name:'Review submission on GitHub'}).click();
    const link=page.getByRole('link',{name:'Open GitHub issue creation',exact:true});
    const target=new URL(await link.getAttribute('href'));
    expect(target.hostname).toBe('github.com');
    if(target.searchParams.has('body')) {
      const parsed=readStructuredSubmission(target.searchParams.get('body'));
      expect(parsed.candidate.details.tools).toEqual(data.details.tools);
    } else {
      expect(target.search).toBe('');
      const downloadEvent=page.waitForEvent('download');
      await page.getByRole('button',{name:'Download issue Markdown'}).click();
      expect((await downloadEvent).suggestedFilename()).toBe('freemcp-submission.md');
    }
  });
}

test('analysis ignores stale results, honors the selected branch and keeps manual entries',async ({page})=>{
  let unblock;
  const release=new Promise(resolve=>{unblock=resolve;});
  await page.route('https://api.github.com/repos/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('/old')) {await release;await route.fulfill({json:{name:'Stale name',default_branch:'main'}}).catch(()=>{});return;}
    if(url.pathname.endsWith('/rate')) {await route.fulfill({status:429});return;}
    if(url.pathname.endsWith('/readme')) {await route.fulfill({body:'## Configuration\n\nReads test records.'});return;}
    if(url.pathname.endsWith('/freemcp.json')) {
      expect(url.searchParams.get('ref')).toBe('feature/demo');
      await route.fulfill({json:{schemaVersion:1,name:'Manifest fixture',description:'Manifest test content',repository:'https://github.com/example/new',
        category:'Development',transport:'stdio',installation:{command:'fixture',args:[]}}});return;
    }
    await route.fulfill({json:{name:'Fresh metadata',default_branch:'main',stargazers_count:12}});
  });
  await opening(page);
  const repo=page.getByLabel('GitHub repository URL');
  await repo.fill('https://github.com/example/rate');
  await page.getByRole('button',{name:'Analyze GitHub repository'}).click();
  await expect(page.getByText('GitHub API rate limit reached.',{exact:false})).toBeVisible();
  await repo.fill('https://github.com/example/old');
  await page.getByRole('button',{name:'Analyze GitHub repository'}).click();
  await expect(page.getByText('Reading public GitHub metadata…')).toBeVisible();
  await repo.fill('https://github.com/example/new');
  await page.getByLabel('Git branch',{exact:false}).fill('feature/demo');
  await page.getByRole('button',{name:'Continue to listing details'}).click();
  await page.getByLabel('Server name').fill('Manual name');
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await page.getByRole('button',{name:'Analyze GitHub repository'}).click();
  await expect(page.getByText(/freemcp.json v1 on feature\/demo/)).toBeVisible();
  unblock();
  await page.getByRole('button',{name:'Fill untouched fields'}).click();
  await page.getByRole('button',{name:'Continue to listing details'}).click();
  await expect(page.getByLabel('Server name')).toHaveValue('Manual name');
  await expect(page.getByRole('textbox',{name:'Description',exact:true})).toHaveValue('Manifest test content');
});

test('structured collection controls persist and invalid JSON never previews stale values',async ({page})=>{
  await opening(page);
  await paste(page,candidate(2));
  await page.getByText('Documented tools (2)',{exact:true}).click();
  await page.getByRole('button',{name:'Move tool 2 up'}).click();
  expect(await page.getByLabel('Tool name').evaluateAll(inputs=>inputs.map(input=>input.value))).toEqual(['tool_1','tool_0']);
  await page.getByRole('button',{name:'Add tool',exact:true}).click();
  await page.getByLabel('Tool name').last().fill('tool_2');
  await page.getByRole('button',{name:'Remove tool 1',exact:true}).click();
  await page.getByRole('button',{name:'Advanced JSON',exact:true}).click();
  const text=page.getByLabel('Listing JSON'), raw=await text.inputValue();
  expect(JSON.parse(raw).details.tools.map(tool=>tool.name)).toEqual(['tool_0','tool_2']);
  await text.fill('{ malformed');
  await page.getByRole('button',{name:'Preview listing',exact:true}).click();
  await expect(page.getByRole('alert').getByText('Enter valid JSON.')).toBeVisible();
  await expect(page.locator('#listing-preview')).toBeHidden();
  await text.fill(raw);
  await page.getByRole('button',{name:'Preview listing',exact:true}).click();
  await expect(page.frameLocator('#listing-preview').locator('#tools .tool-item')).toHaveCount(2);
  const check=page.getByRole('button',{name:'Check published registry for duplicates'});
  await page.route('**/api/submission-duplicates',route=>route.fulfill({json:{match:true}}));
  await check.click();
  await expect(page.getByText('Possible duplicate found',{exact:false})).toBeVisible();
  await page.unroute('**/api/submission-duplicates');
  await page.route('**/api/submission-duplicates',route=>route.fulfill({status:503}));
  await check.click();
  await expect(page.getByText('Duplicate check unavailable',{exact:false})).toBeVisible();
});

test('a v1 JSON upload fills the editable listing and its installation',async ({page})=>{
  await opening(page);
  await page.getByText('Upload or paste JSON',{exact:true}).click();
  await page.getByLabel('Upload JSON file').setInputFiles({name:'freemcp.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({
    schemaVersion:1,name:'Uploaded fixture',description:'Synthetic manifest',category:'Development',repository:'https://github.com/example/demo',
    transport:'stdio',tools:[{name:'fixture_lookup',description:'Search examples'}],installation:{command:'fixture',args:['--demo']},
  }))});
  await expect(page.getByLabel('Paste JSON')).toHaveValue(/Uploaded fixture/);
  await page.getByRole('button',{name:'Apply JSON import'}).click();
  await page.getByRole('button',{name:'Preview listing',exact:true}).click();
  const frame=page.frameLocator('#listing-preview');
  await expect(frame.locator('h1')).toHaveText('Uploaded fixture');
  await expect(frame.locator('.install pre')).toContainText('--demo');
  await expect(frame.locator('#tools .tool-item')).toHaveCount(1);
});

test('mobile preview sticky navigation jumps to local sections without covering their headings',async ({page})=>{
  await page.setViewportSize({width:390,height:850});
  await opening(page);
  await paste(page,candidate(15));
  await page.getByRole('button',{name:'Preview listing',exact:true}).click();
  const frame=page.frameLocator('#listing-preview');
  const nav=frame.getByRole('navigation',{name:'Server page sections'});
  for (const [label,id] of [['Security','security'],['Install','installation'],['Overview','overview']]) {
    await nav.getByRole('link',{name:label,exact:true}).click();
    await expect.poll(()=>frame.locator('#'+id).evaluate(section=>{
      const bar=document.querySelector('.detail-tabs').getBoundingClientRect();
      const top=section.getBoundingClientRect().top;
      return location.hash==='#'+section.id && bar.top>=-1 && top>=bar.bottom-1 && top<innerHeight;
    })).toBe(true);
  }
  expect(new URL(page.url()).hash).toBe('');
  await expect(frame.locator('a[href]:not([href^="about:srcdoc#"])')).toHaveCount(0);
});
