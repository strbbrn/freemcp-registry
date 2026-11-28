import { test, expect } from '@playwright/test';
import { renderListing } from '../../functions/servers/[id].js';

const ultra = 'https://github.com/mmxb8/UltraTransfer/blob/main/';
const overleaf = 'https://github.com/yangzichao/mcp-server-overleaf/blob/main/docs/';
const long = 'UninterruptedIdentifier'.repeat(15);
const cases = [
  {id:'ultratransfer',tools:30,links:[ultra+'SECURITY.md',ultra+'PRIVACY.md',ultra+'LICENSE',ultra+'docs/CONTEXT_TOOL_PROFILE.md',
    'https://pypi.org/project/ultratransfer-mcp/0.4.25/',
    'https://registry.modelcontextprotocol.io/v0.1/servers/io.github.mmxb8%2Fultratransfer/versions/0.4.25']},
  {id:'overleaf',tools:15,links:[overleaf+'connect-local-mcp-clients.md',overleaf+'privacy-policy.md',overleaf+'tracked-changes.md']},
  {id:'long-metadata',tools:1,links:['https://example.org/'+long+'.md','https://example.org/'+('long-file-name-'.repeat(25))+'guide',
    'https://example.org/search?section='+long+'&path='+('%2F'.repeat(80))]},
];

for (const width of [320,360,390,414,768,1024,1280,1440]) {
  test('detail metadata fits at '+width+' CSS pixels in both themes',async ({page})=>{
    await page.route('**/*',route=>route.abort());
    await page.setViewportSize({width,height:850});
    for (const fixture of cases) {
      const edge=fixture.id==='long-metadata';
      const record={
        id:fixture.id,name:edge?long:'Synthetic '+fixture.id,author:'Fixture',category:'Fixture',stars:0,
        description:edge?'Description '+long:'Documentation wrapping fixture',github_url:'https://github.com/example/'+fixture.id,
        tags:edge?[long]:['fixture'],
        details:{documentationUrl:'https://example.org/getting-started',documentationUrls:fixture.links,
          tools:Array.from({length:fixture.tools},(_,i)=>({name:edge?long:'fixture_tool_'+i,description:edge?long:'Synthetic tool.'})),
          ...(edge?{summary:long,pricing:long,serviceDependencies:[long],prerequisites:[long],security:[long],
            installations:[{title:long,notes:long,config:{servers:{fixture:{url:'https://example.org/'+long}},arguments:['--local','--test']}}]}:{})},
      };
      await page.setContent(renderListing(record),{waitUntil:'domcontentloaded'});
      await expect(page.locator('#more-documentation a')).toHaveText(fixture.links);
      expect(await page.locator('#more-documentation a').evaluateAll(links=>links.map(a=>a.getAttribute('href')))).toEqual(fixture.links);
      await expect(page.locator('#tools .tool-item')).toHaveCount(fixture.tools);
      await expect(page.locator('.hero-actions a').first()).toHaveAttribute('href',record.github_url);
      for (const theme of ['dark','light']) {
        const layout=await page.evaluate(({edge,theme})=>{
          document.documentElement.dataset.theme=theme;
          const uncontained=(element,container)=>{
            const range=document.createRange();
            range.selectNodeContents(element);
            const box=container.getBoundingClientRect();
            return [...range.getClientRects()].some(line=>line.right>box.right+1||line.left<box.left-1);
          };
          const docs=[...document.querySelectorAll('#more-documentation a')].map(a=>uncontained(a,a.closest('li')));
          const selectors=['.breadcrumb>span','.hero h1','.hero p','#overview .panel-body>p','#overview .tag','#service-requirements li',
            '#service-requirements p','#prerequisites li','#security li','.install h3','.install p:last-of-type','.tool-item code','.tool-item p'];
          const metadata=edge?selectors.filter(selector=>{
            const el=document.querySelector(selector);
            return el&&uncontained(el,el.closest('.panel-body, .breadcrumb, .hero-main')??el.parentElement);
          }):[];
          const pre=document.querySelector('.install pre');
          if (pre) pre.scrollLeft=pre.scrollWidth;
          return {docs,metadata,pageWidth:document.documentElement.scrollWidth,
            configScroll:pre?pre.scrollLeft:0,configWhiteSpace:pre?getComputedStyle(pre).whiteSpace:null};
        },{edge,theme});
        const label=fixture.id+' at '+width+' in '+theme;
        expect(layout.docs,label).not.toContain(true);
        expect(layout.metadata,label).toEqual([]);
        expect(layout.pageWidth,label).toBeLessThanOrEqual(width);
        if (edge) {
          expect(layout.configWhiteSpace).toBe('pre');
          expect(layout.configScroll).toBeGreaterThan(0);
          await expect(page.getByRole('button',{name:'Copy configuration'})).toBeVisible();
          await expect(page.locator('.install pre')).toContainText('--test');
        }
      }
    }
  });
}
