import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { admin } from '../lib/admin/router.js';
import { configuration, sessionFor } from '../lib/admin/auth.js';
import { version } from '../lib/admin/audit.js';
import { digest, token } from '../lib/admin/crypto.js';
import { editServer, prepareImport, serverRow } from '../lib/admin/servers.js';
import { editPromotion, promotionCandidate, placements } from '../lib/admin/promotions.js';
import { reviewAction, reviewRow, retryIssue, submission } from '../lib/admin/submissions.js';
import { registry } from '../lib/registry.js';

const preview='https://feature-admin-dashboard.freemcp.pages.dev';
const prod='https://freemcp.in';
const now=()=>Math.floor(Date.now()/1000);
function fixture(t) {
  const sqlite=new DatabaseSync(':memory:');
  t.after(()=>sqlite.close());
  for (const name of ['0001_servers','0002_server_details','0007_promotions','0008_promotion_slots','0010_admin','0011_admin_outbox_decisions']) {
    sqlite.exec(readFileSync(new URL('../migrations/'+name+'.sql',import.meta.url),'utf8'));
  }
  const statement=(sql,args=[])=>({
    bind(...values){return statement(sql,values);},
    async all(){
      return execute(sql,args);
    },
    async first(){
      return sqlite.prepare(sql).get(...args)??null;
    },
    async run(){return execute(sql,args);},
    execute:()=>execute(sql,args),
  });
  function execute(sql,args) {
    const results=sqlite.prepare(sql).all(...args);
    const changes=sqlite.prepare('SELECT changes() AS n').get().n;
    return {results,meta:{changes}};
  }
  const DB={prepare:statement,async batch(items){
    sqlite.exec('BEGIN');
    try {
      const results=items.map(item=>item.execute());
      sqlite.exec('COMMIT');
      return results;
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  }};
  const env={DB,ADMIN_ENV:'preview',CF_PAGES_BRANCH:'feature/admin-dashboard',ADMIN_GITHUB_IDS:'12345',
    ADMIN_GITHUB_CLIENT_ID:'FixtureClient123',ADMIN_GITHUB_CLIENT_SECRET:'fixture-only-oauth',
    ADMIN_SESSION_SECRET:token(),ADMIN_HISTORY_KEY:token()};
  return {sqlite,env,config:configuration(env,new Request(preview+'/admin/'))};
}
const request=(path,opts={},origin=preview)=>new Request(origin+path,opts);
const run=(env,path,opts,origin)=>admin({env,request:request(path,opts,origin)});
const cookie=(name,value)=>name+'='+value;
const sessionCookie=raw=>cookie('__Host-freemcp-admin',raw);

test('every admin page and API and alternate hostname is protected', async t=>{
  const {env}=fixture(t);
  for (const route of ['/admin/','/admin','/admin/servers/','/admin/servers/new/','/admin/servers/example/','/admin/import/',
    '/admin/submissions/','/admin/submissions/123/','/admin/promotions/','/admin/sponsors/','/admin/activity/','/admin/settings/']) {
    const result=await run(env,route);
    assert.equal(result.status,303,route);
    assert.equal(result.headers.get('Location'),'/admin/login/');
    assert.match(result.headers.get('Cache-Control'),/no-store/);
    assert.match(result.headers.get('X-Robots-Tag'),/noindex/);
  }
  for (const route of ['/api/admin/','/api/admin/servers/','/api/admin/servers/x/','/api/admin/session/',
    '/api/admin/import/','/api/admin/promotions/x/','/api/admin/sponsors/gold/','/api/admin/submissions/1/','/api/admin/outbox/x/']) {
    for (const method of ['GET','POST']) assert.equal((await run(env,route,{method})).status,401,route);
  }
  for (const origin of [prod,'https://freemcp.pages.dev','https://random.freemcp.pages.dev']) {
    assert.equal((await run(env,'/admin/login/',{},origin)).status,404);
  }
  assert.equal((await run({...env,ADMIN_GITHUB_CLIENT_SECRET:undefined},'/admin/login/')).status,503);
  assert.equal((await run({...env,CF_PAGES_BRANCH:'main'},'/admin/login/')).status,404);
  assert.equal((await run({...env,ADMIN_ENV:'production',CF_PAGES_BRANCH:'main'},'/admin/login/',{},prod)).status,200);
  assert.equal((await run(env,'/admin/oauth/start/',{method:'GET'})).status,405);
});
async function loginStart(env) {
  const result=await run(env,'/admin/oauth/start/',{method:'POST',headers:{Origin:preview}});
  assert.equal(result.status,303);
  const location=new URL(result.headers.get('Location'));
  assert.equal(location.searchParams.get('scope'),'');
  assert.equal(location.searchParams.get('code_challenge_method'),'S256');
  assert.equal(location.searchParams.get('redirect_uri'),preview+'/admin/oauth/callback/');
  assert.match(result.headers.get('Set-Cookie'),/Secure; HttpOnly; SameSite=Lax/);
  return {state:location.searchParams.get('state'),challenge:location.searchParams.get('code_challenge')};
}
const callback=(env,state,using=state)=>run(env,'/admin/oauth/callback/?code=fixture&state='+state,
  {headers:{Cookie:cookie('__Host-freemcp-state',using)}});
test('OAuth validates PKCE, authorized numeric ID, state expiry and single use', async t=>{
  const {env,sqlite}=fixture(t);
  let id=12345, verifier;
  t.mock.method(globalThis,'fetch',async (path,options)=>{
    if (path==='https://github.com/login/oauth/access_token') {
      const body=new URLSearchParams(options.body);
      verifier=body.get('code_verifier');
      assert.equal(body.get('redirect_uri'),preview+'/admin/oauth/callback/');
      return Response.json({access_token:'fixture-github-token'});
    }
    assert.equal(path,'https://api.github.com/user');
    assert.equal(options.redirect,'manual');
    assert.equal(options.headers.Authorization,'Bearer fixture-github-token');
    return Response.json({id,login:'fixture'});
  });
  assert.equal((await run(env,'/admin/oauth/start/',{method:'POST',headers:{Origin:prod}})).status,403);
  const {state,challenge}=await loginStart(env);
  assert.equal((await callback(env,state,token())).status,403);
  const result=await callback(env,state);
  assert.equal(result.status,303);
  assert.equal(await digest(verifier),challenge);
  const session=result.headers.getSetCookie().find(value=>value.startsWith('__Host-freemcp-admin'));
  assert.match(session,/Secure; HttpOnly; SameSite=Lax/);
  assert.equal((await callback(env,state)).status,403);
  const expired=await loginStart(env);
  sqlite.prepare('UPDATE admin_oauth_states SET expires_at=0 WHERE state_hash=?').run(await digest(expired.state));
  assert.equal((await callback(env,expired.state)).status,403);
  id=99999;
  const unauthorized=await loginStart(env);
  assert.equal((await callback(env,unauthorized.state)).status,403);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS total FROM admin_sessions').get().total,1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM admin_audit_log WHERE action='sign-in'").get().total,1);
  assert.doesNotMatch(JSON.stringify(sqlite.prepare('SELECT * FROM admin_sessions').all()),/fixture-github-token/);
});

test('OAuth refuses GitHub identity redirects without exposing provider details', async t=>{
  const {env,sqlite}=fixture(t);
  const fetchMock=t.mock.method(globalThis,'fetch',async (url,options)=>{
    if (url==='https://github.com/login/oauth/access_token') return Response.json({access_token:'fixture-github-token'});
    assert.equal(url,'https://api.github.com/user');
    assert.equal(options.redirect,'manual');
    return Response.redirect('https://example.com/private-provider-detail',302);
  });
  const {state}=await loginStart(env);
  const result=await callback(env,state);
  assert.equal(result.status,502);
  const body=await result.text();
  assert.match(body,/GitHub identity lookup returned HTTP 302/);
  assert.doesNotMatch(body,/private-provider-detail|fixture-github-token/);
  assert.equal(fetchMock.mock.callCount(),2);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS total FROM admin_sessions').get().total,0);
});
async function seedSession(sqlite,config,mode='preview',expires=now()+4000) {
  const raw=token();
  sqlite.prepare('INSERT INTO admin_sessions VALUES(?,?,?,?,?,?)').run(await digest(config.secret+'\nsession\n'+raw),'12345','fixture',mode,expires,now()+7000);
  return raw;
}
test('session expiry, environment, rotation, logout and CSRF', async t=>{
  const {env,config,sqlite}=fixture(t);
  const raw=await seedSession(sqlite,config);
  const other=await seedSession(sqlite,config,'production');
  const expired=await seedSession(sqlite,config,'preview',now()-1);
  for (const disallowed of [other,expired]) {
    assert.equal(await sessionFor(config,request('/admin/',{headers:{Cookie:sessionCookie(disallowed)}})),null);
  }
  assert.equal(await sessionFor({...config,allowlist:['99999']},request('/admin/',{headers:{Cookie:sessionCookie(raw)}})),null);
  const view=await run(env,'/api/admin/session/',{headers:{Cookie:sessionCookie(raw)}});
  const {csrf}=await view.json();
  const post=(id,action,origin=preview,anti=csrf)=>run(env,'/api/admin/session/',{method:'POST',
    headers:{Cookie:sessionCookie(id),Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({csrf:anti,action})});
  assert.equal((await post(raw,'logout',prod)).status,403);
  assert.equal((await post(raw,'logout',preview,'invalid')).status,403);
  const rotated=await post(raw,'rotate');
  assert.equal(rotated.status,303);
  assert.equal((await run(env,'/api/admin/session/',{headers:{Cookie:sessionCookie(raw)}})).status,401);
  const replacement=rotated.headers.get('Set-Cookie').split(';')[0].split('=')[1];
  const next=await (await run(env,'/api/admin/session/',{headers:{Cookie:sessionCookie(replacement)}})).json();
  assert.notEqual(csrf,next.csrf);
  assert.equal((await post(replacement,'logout',preview,next.csrf)).status,303);
  assert.equal((await run(env,'/api/admin/session/',{headers:{Cookie:sessionCookie(replacement)}})).status,401);
  const current=await seedSession(sqlite,config), peer=await seedSession(sqlite,config);
  const identity=await (await run(env,'/api/admin/session/',{headers:{Cookie:sessionCookie(current)}})).json();
  const revoke=await run(env,'/api/admin/session/',{method:'POST',headers:{Cookie:sessionCookie(current),Origin:preview,'Content-Type':'application/json'},
    body:JSON.stringify({action:'revoke',confirm:'yes',csrf:identity.csrf})});
  assert.equal(revoke.status,303);
  assert.equal(await sessionFor(config,request('/admin/',{headers:{Cookie:sessionCookie(peer)}})),null);
});
const candidate=(id='fixture-registry',github_url='https://github.com/example/registry')=>({id,github_url,
  name:'Registry fixture',description:'Synthetic content for tests',category:'Other',author:'Fixture',tags:['fixture'],
  details:{summary:'First version',documentationUrl:github_url+'#readme',transport:'stdio',
    installations:[{title:'Local',config:{mcpServers:{fixture:{command:'fixture-mcp'}}}}],
    tools:[{name:'lookup',description:'Searches fixture items'}],endpoints:[],prerequisites:['A compatible runtime'],security:['Use synthetic data']}});
const reason='Fixture review completed';
test('registry lifecycle, drafts, preserve metadata, immutable IDs and version conflicts', async t=>{
  const {config,sqlite}=fixture(t);
  const {db}=config;
  const draft=await editServer(config,'12345',null,{...candidate(),action:'create',reason});
  assert.equal(await registry(db).detail(draft.id),null);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS total FROM servers_search').get().total,1);
  const published=await editServer(config,'12345',draft.id,{action:'publish',version:await version(draft),confirm:'yes',reason});
  assert.ok(await registry(db).detail(draft.id));
  const publishedVersion=await version(published);
  sqlite.prepare("UPDATE servers SET stars=10,details_json=json_set(details_json,'$.githubMetadata.archived',0,'$.externalField',?) WHERE id=?")
    .run('preserve',draft.id);
  await assert.rejects(()=>editServer(config,'12345',draft.id,{action:'archive',version:publishedVersion,reason}),{status:409});
  const latest=await serverRow(db,draft.id);
  const revision=await version(latest);
  await assert.rejects(()=>editServer(config,'12345',draft.id,{action:'save',id:'different',version:revision,confirm:'yes',reason}),{status:400});
  const edited=await editServer(config,'12345',draft.id,{action:'save',name:'Edited title',version:revision,confirm:'yes',reason});
  assert.equal(JSON.parse(edited.details_json).externalField,'preserve');
  assert.equal(JSON.parse(edited.details_json).githubMetadata.archived,0);
  assert.equal(edited.stars,10);
  const archived=await editServer(config,'12345',draft.id,{action:'archive',version:await version(edited),reason});
  assert.equal(JSON.parse(archived.details_json).lifecycleSource,'registry');
  const saved=sqlite.prepare("SELECT id FROM admin_audit_log WHERE action='save'").get().id;
  const restored=await editServer(config,'12345',draft.id,{action:'restore',version:await version(archived),reason,confirm:'yes',revision:saved});
  assert.equal(restored.name,draft.name);
  assert.equal(JSON.parse(restored.details_json).externalField,'preserve');
  const hidden=await editServer(config,'12345',draft.id,{action:'unpublish',version:await version(restored),reason,confirm:'yes'});
  assert.equal(await registry(db).detail(hidden.id),null);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM admin_audit_log WHERE entity='server'").get().total,6);
});
test('duplicate import checks implementation identity and failed audit rolls back the listing', async t=>{
  const {config,sqlite}=fixture(t);
  await editServer(config,'12345',null,{...candidate(),action:'create',reason});
  const same=candidate('same-root'), component=candidate('component','https://github.com/example/registry/tree/main/packages/one');
  const results=await prepareImport(config.db,[same,component,component]);
  assert.ok(results[0].error);
  assert.ok(results[1].row);
  assert.ok(results[2].error);
  await assert.rejects(()=>editServer(config,'12345',null,{...same,action:'create',reason}),{status:400});
  sqlite.exec("CREATE TRIGGER block_audit BEFORE INSERT ON admin_audit_log WHEN NEW.reason='Fixture audit unavailable' BEGIN SELECT RAISE(ABORT,'fixture audit'); END");
  await assert.rejects(()=>editServer(config,'12345',null,{...component,action:'create',reason:'Fixture audit unavailable'}));
  assert.equal(await serverRow(config.db,component.id),null);
});
test('promotions validate all slots and reject unsafe scheduling or URL input', async t=>{
  const {config,sqlite}=fixture(t);
  const data={action:'create',id:'fixture-promotion',headline:'Fixture',eyebrow:'Promoted',description:'Example',
    cta_text:'Learn more',target_url:'https://example.com/',theme:'violet',weight:1,rotation_seconds:7,status:'draft',
    starts_at:'2027-01-02T12:00',ends_at:'2027-01-02T14:00',placements,reason};
  assert.equal((await editPromotion(config,'12345',null,data)).length,8);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM admin_audit_log WHERE entity='promotion'").get().count,8);
  for (const invalid of [{starts_at:'2027-02-30T12:00'},{ends_at:'2027-01-01T00:00'},{target_url:'http://example.com/'},{weight:21},{rotation_seconds:4}]) {
    assert.throws(()=>promotionCandidate({...data,...invalid},'home/primary'),{status:400});
  }
});

test('GitHub reviews verify issue and source revisions before atomic publication', async t=>{
  const {config,sqlite}=fixture(t);
  const {issueContent}=await import('../src/lib/submission.mjs');
  const issueBody=issueContent({repository:'https://github.com/example/submitted',name:'Submission fixture',category:'Other',
    description:'Synthetic submission',transport:'stdio',installation:'fixture-mcp',permissions:''},[]);
  let sha='a'.repeat(40), issueText=issueBody;
  const issue={number:42,title:'[MCP Submission] Fixture',state:'open',locked:false,updated_at:'2026-01-01T00:00:00Z'};
  t.mock.method(globalThis,'fetch',async path=>{
    const url=new URL(path);
    if (url.pathname.endsWith('/issues/42')) return Response.json({...issue,body:issueText});
    if (url.pathname.endsWith('/issues/42/comments')) {
      assert.equal(url.searchParams.get('page'),'2');
      return Response.json([{user:{login:'fixture'},body:'<em>comment</em>',created_at:issue.updated_at}],
        {headers:{Link:'<https://api.github.com/example>; rel="next"'}});
    }
    if (url.pathname.endsWith('/issues')) return Response.json([{...issue,body:issueText},{...issue,pull_request:{},body:issueText},{number:10,title:'Unrelated'}]);
    if (url.pathname==='/repos/example/submitted') return Response.json({id:88,full_name:'example/submitted',default_branch:'main'});
    if (url.pathname.endsWith('/commits/main')) return Response.json({sha});
    if (url.pathname.endsWith('/readme')) return Response.json({}, {status:404});
    throw Error(url.pathname);
  });
  const {items}=await (await import('../lib/admin/submissions.js')).listSubmissions(1);
  assert.deepEqual(items.map(item=>item.number),[42]);
  const first=await submission(42,{commentsPage:2,readme:true});
  assert.equal(first.comments.next,true);
  assert.equal(first.comments.items[0].body,'<em>comment</em>');
  const before=await version(null);
  const {reviewDuplicate}=await import('../lib/admin/submissions.js');
  const duplicate=await editServer(config,'12345',null,{...candidate('alternate-submission','https://github.com/example/submitted'),action:'create',reason});
  assert.equal((await reviewDuplicate(config,first,null)).id,duplicate.id);
  await assert.rejects(()=>reviewAction(config,'12345',42,{action:'approved',command:'fixture-mcp',args:'[]',
    confirm:'yes',version:before,fingerprint:first.fingerprint,reason,
    publicationExceptions:{tools:'Fixture only',prerequisites:'Fixture only',security:'Fixture only'}}),/already listed under alternate-submission/);
  sqlite.prepare('DELETE FROM servers WHERE id=?').run(duplicate.id);
  await reviewAction(config,'12345',42,{action:'approved',command:'fixture-mcp',args:'[]',publicationExceptions:{tools:'Fixture has no tools',prerequisites:'Fixture has no prerequisites',security:'Fixture uses synthetic data'},confirm:'yes',version:before,fingerprint:first.fingerprint,reason});
  const review=await reviewRow(config.db,42);
  assert.equal(review.status,'approved');
  assert.equal(await serverRow(config.db,'example-submitted'),null);
  const approvedVersion=await version(review);
  sha='b'.repeat(40);
  const moved=await submission(42);
  await assert.rejects(()=>reviewAction(config,'12345',42,{action:'publish',confirm:'yes',version:approvedVersion,fingerprint:moved.fingerprint,reason}),{status:409});
  sha='a'.repeat(40);
  issueText=issueBody.replace('Synthetic submission','New description');
  const revised=await submission(42);
  await assert.rejects(()=>reviewAction(config,'12345',42,{action:'publish',confirm:'yes',version:approvedVersion,fingerprint:revised.fingerprint,reason}),{status:409});
  issueText=issueBody;
  const result=await reviewAction(config,'12345',42,{action:'publish',confirm:'yes',version:approvedVersion,fingerprint:first.fingerprint,reason});
  assert.ok(await registry(config.db).detail(result.serverId));
  assert.equal((await reviewRow(config.db,42)).status,'published');
  const queued=sqlite.prepare('SELECT * FROM admin_outbox').get();
  assert.equal(queued.status,'pending');
  assert.equal(queued.issue_number,42);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action='publish-submission'").get().count,1);
  const server=await serverRow(config.db,result.serverId);
  await editServer(config,'12345',server.id,{action:'unpublish',confirm:'yes',reason,version:await version(server)});
  assert.equal(await registry(config.db).detail(server.id),null);
  const hidden=await reviewRow(config.db,42);
  assert.equal(hidden.status,'clarification');
  assert.equal(hidden.server_id,server.id);
  const draft=await serverRow(config.db,server.id);
  await assert.rejects(()=>editServer(config,'12345',draft.id,{action:'publish',confirm:'yes',reason,version:'stale'}),{status:409});
  await assert.rejects(async()=>editServer(config,'12345',draft.id,{action:'publish',confirm:'yes',reason,version:await version(draft)}),/through its submission review/);
  await editServer(config,'12345',draft.id,{action:'save',name:'Corrected listing',reason,version:await version(draft)});
  issue.state='closed';
  const latest=await submission(42);
  await assert.rejects(async()=>reviewAction(config,'12345',42,{action:'publish',confirm:'yes',version:await version(hidden),fingerprint:latest.fingerprint,reason}),/explicit approval/);
  await reviewAction(config,'12345',42,{action:'approved',command:'fixture-mcp',args:'[]',confirm:'yes',reason,
    version:await version(hidden),fingerprint:latest.fingerprint,
    publicationExceptions:{tools:'Fixture has no tools',prerequisites:'Fixture has no prerequisites',security:'Fixture uses synthetic data'}});
  const approvedAgain=await reviewRow(config.db,42);
  const republished=await reviewAction(config,'12345',42,{action:'publish',confirm:'yes',version:await version(approvedAgain),fingerprint:latest.fingerprint,reason});
  assert.equal(republished.serverId,server.id);
  assert.equal((await registry(config.db).detail(server.id)).name,'Corrected listing');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM servers WHERE id=?').get(server.id).n,1);

});

test('outbox is disabled in preview and supports a retry after failure without repeating success', async t=>{
  const {config,sqlite}=fixture(t);
  const id=token();
  sqlite.prepare('INSERT INTO submission_reviews VALUES(?,?,?,?,?,?,?,?)')
    .run(42,'published','hash','commit','{}','12345','date','fixture');
  sqlite.prepare('INSERT INTO admin_outbox(id,issue_number,action,message) VALUES(?,?,?,?)').run(id,42,'published','Fixture');
  const env={ADMIN_GITHUB_SYNC:'enabled',ADMIN_GITHUB_APP_ID:'11',ADMIN_GITHUB_INSTALLATION_ID:'22',ADMIN_GITHUB_APP_PRIVATE_KEY:'fixture'};
  let deliveries=0;
  const send=async()=>{if (++deliveries===1) throw Error('fixture failure');};
  await assert.rejects(()=>retryIssue(config,env,'12345',id,reason,send),{status:503});
  const production={...config,mode:'production'};
  assert.deepEqual(await retryIssue(production,env,'12345',id,reason,send),{status:'failed'});
  assert.ok(sqlite.prepare('SELECT next_retry FROM admin_outbox WHERE id=?').get(id).next_retry>now());
  sqlite.prepare('UPDATE admin_outbox SET next_retry=0 WHERE id=?').run(id);
  assert.deepEqual(await retryIssue(production,env,'12345',id,reason,send),{status:'sent'});
  await assert.rejects(()=>retryIssue(production,env,'12345',id,reason,send),{status:409});
  assert.equal(deliveries,2);
});

test('simultaneous edits make one compare-and-swap win and one conflict', async t=>{
  const {config,sqlite}=fixture(t);
  const draft=await editServer(config,'12345',null,{...candidate(),action:'create',reason});
  const expected=await version(draft);
  const updates=await Promise.allSettled(['First edit','Second edit'].map(name=>
    editServer(config,'12345',draft.id,{action:'save',name,version:expected,reason})));
  assert.equal(updates.filter(item=>item.status==='fulfilled').length,1);
  assert.equal(updates.find(item=>item.status==='rejected').reason.status,409);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='save'").get().n,1);
});

test('a scheduled promotion and paused promotion stay out of the public ad API', async t=>{
  const {config}=fixture(t);
  const {onRequestGet}=await import('../functions/api/ads.js');
  const offer=(id,status,starts_at)=>({action:'create',id,headline:id,eyebrow:'Fixture',description:'Test',
    cta_text:'Learn more',target_url:'https://example.com/',theme:'violet',weight:1,rotation_seconds:7,status,
    starts_at,placements:['home/primary'],reason});
  await editPromotion(config,'12345',null,offer('fixture-active-ad','active',null));
  await editPromotion(config,'12345',null,offer('fixture-future-ad','active',new Date(Date.now()+86400000).toISOString()));
  await editPromotion(config,'12345',null,offer('fixture-paused-ad','paused',null));
  const response=await onRequestGet({request:new Request(prod+'/api/ads?placement=home&slot=primary'),env:{DB:config.db}});
  const ids=(await response.json()).ads.map(row=>row.id);
  assert.ok(ids.includes('fixture-active-ad'));
  assert.ok(!ids.includes('fixture-future-ad')&&!ids.includes('fixture-paused-ad'));
});

test('GitHub retry recognizes a bot-authored delivery marker before posting another comment', async t=>{
  const {deliverIssueUpdate}=await import('../lib/admin/github.js');
  const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
    publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const bytes=new Uint8Array(await crypto.subtle.exportKey('pkcs8',pair.privateKey));
  const env={ADMIN_GITHUB_APP_ID:'11',ADMIN_GITHUB_INSTALLATION_ID:'22',
    ADMIN_GITHUB_APP_PRIVATE_KEY:'-----BEGIN PRIVATE KEY-----\n'+btoa(String.fromCharCode(...bytes))+'\n-----END PRIVATE KEY-----'};
  const item={id:'delivery-fixture',issue_number:42,action:'published',message:'Fixture notification'};
  const calls=[];
  t.mock.method(globalThis,'fetch',async (path,options)=>{
    const url=new URL(path);
    assert.equal(url.origin,'https://api.github.com');
    calls.push([options.method,url.pathname]);
    if (url.pathname==='/app') return Response.json({slug:'fixture-app'});
    if (url.pathname.endsWith('/access_tokens')) {
      assert.deepEqual(JSON.parse(options.body),{repositories:['freemcp-registry'],permissions:{issues:'write'}});
      return Response.json({token:'fixture-app-token'});
    }
    if (url.pathname.endsWith('/comments')&&options.method==='GET') {
      const marker='<!-- freemcp-admin:delivery-fixture -->';
      return Response.json([{body:marker,user:{login:'fixture-app[bot]'}}]);
    }
    return Response.json({});
  });
  await deliverIssueUpdate(env,item);
  assert.ok(!calls.some(([method,path])=>method==='POST'&&path.endsWith('/comments')));
  assert.ok(calls.some(([method,path])=>method==='POST'&&path.endsWith('/labels')));
  assert.deepEqual(calls.filter(([method])=>method==='DELETE').map(([,path])=>path.split('/').at(-1)),
    ['freemcp-needs-clarification','freemcp-rejected']);
  assert.ok(calls.some(([method,path])=>method==='PATCH'&&path.endsWith('/issues/42')));
});

test('OAuth callback reports safe stage errors and consumes failed states', async t=>{
  const {env,sqlite}=fixture(t);
  const exchange=t.mock.method(globalThis,'fetch',async ()=>{ throw new Error('fixture private provider detail'); });
  const provider=await loginStart(env);
  const failed=await callback(env,provider.state);
  assert.equal(failed.status,502);
  const message=await failed.text();
  assert.match(message,/Could not reach GitHub to exchange the sign-in code/);
  assert.doesNotMatch(message,/fixture private provider detail/);
  assert.equal((await callback(env,provider.state)).status,403);
  const cases=[
    [401,'incorrect_client_credentials',503,/OAuth app credentials/],
    [200,'redirect_uri_mismatch',503,/OAuth callback URL/],
    [200,'bad_verification_code',400,/rejected this sign-in request/],
    [404,'unknown',502,/returned HTTP 404/],
  ];
  for (const [providerStatus,error,status,expected] of cases) {
    exchange.mock.mockImplementation(async (_url,options)=>{
      assert.equal(options.redirect,'manual');
      return Response.json({error,error_description:'fixture private provider detail'},{status:providerStatus});
    });
    const attempt=await loginStart(env);
    const result=await callback(env,attempt.state);
    assert.equal(result.status,status);
    const body=await result.text();
    assert.match(body,expected);
    assert.doesNotMatch(body,/fixture private provider detail/);
  }
  const stored=await loginStart(env);
  sqlite.prepare('UPDATE admin_oauth_states SET verifier=? WHERE state_hash=?').run('invalid-test-verifier',await digest(stored.state));
  const unreadable=await callback(env,stored.state);
  assert.equal(unreadable.status,503);
  assert.match(await unreadable.text(),/saved sign-in request could not be read/);
});

test('publication requires matching installation and documented evidence, with scoped exceptions', async t=>{
  const {config}=fixture(t);
  const data=candidate();
  data.details.tools=[];
  data.details.prerequisites=[];
  const draft=await editServer(config,'12345',null,{...data,action:'create',reason});
  const publish={action:'publish',reason,confirm:'yes',version:await version(draft)};
  await assert.rejects(()=>editServer(config,'12345',draft.id,publish),/document tools.*document prerequisites/);
  await assert.rejects(()=>editServer(config,'12345',draft.id,{...publish,publicationExceptions:{transport:'Skip checks'}}),/Exceptions may cover only/);
  const exceptions={tools:'The server only exposes resources.',prerequisites:'No dependencies beyond the MCP client.'};
  const visible=await editServer(config,'12345',draft.id,{...publish,publicationExceptions:exceptions});
  assert.deepEqual(JSON.parse(visible.details_json).review.exceptions,exceptions);
  const current=await version(visible);
  await assert.rejects(()=>editServer(config,'12345',draft.id,{action:'save',reason,confirm:'yes',version:current,
    details:{transport:'http'}}),/installation configuration/);
});

test('normalized endpoints match across direct and nested configurations and require a reviewed exception', async t=>{
  const {config,sqlite}=fixture(t);
  const original=candidate('original-remote','https://github.com/example/remote');
  original.details={...original.details,transport:'http',installations:[{
    title:'Remote',config:{servers:{demo:{type:'http',url:'https://example.org/Mcp/'}}}
  }]};
  const saved=await editServer(config,'12345',null,{...original,action:'create',reason});
  sqlite.prepare("UPDATE servers SET details_json=json_set(details_json,'$.installations[0].config.servers.demo.url',?) WHERE id=?")
    .run('HTTPS://EXAMPLE.org:443/Mcp/#docs',saved.id);
  const proposed=candidate('second-remote','https://github.com/example/another');
  proposed.details={...proposed.details,transport:'http',endpoints:[{transport:'http',url:'https://example.org/Mcp'}],
    installations:[{title:'Remote',config:{endpoint:'https://example.org/Mcp',transport:'http'}}]};
  assert.match((await prepareImport(config.db,proposed))[0].error,/original-remote/);
  await assert.rejects(()=>editServer(config,'12345',null,{...proposed,action:'create',reason}),/original-remote/);
  const draft=await editServer(config,'12345',null,{...proposed,action:'create',reason,
    confirmSharedEndpoints:'yes',sharedEndpoints:{'original-remote':'Both clients intentionally use the upstream gateway.'}});
  await assert.rejects(async()=>editServer(config,'12345',draft.id,{action:'save',version:await version(draft),reason,
    sharedEndpoints:{}}),/original-remote/);
  assert.ok(await editServer(config,'12345',draft.id,{action:'publish',version:await version(draft),reason,confirm:'yes'}));
});

test('a zero-row audit rolls back registry and all placements in a promotion batch', async t=>{
  const {config,sqlite}=fixture(t);
  sqlite.exec(`CREATE TRIGGER omit_audit BEFORE INSERT ON admin_audit_log
    WHEN NEW.entity='server' OR NEW.entity_id LIKE '%detail-bottom' BEGIN SELECT RAISE(IGNORE); END;`);
  await assert.rejects(()=>editServer(config,'12345',null,{...candidate(),action:'create',reason}),{status:409});
  assert.equal(await serverRow(config.db,candidate().id),null);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM servers_search').get().n,0);
  const inputs={action:'create',id:'fixture-audit-batch',headline:'Fixture',eyebrow:'Promoted',description:'Example',
    cta_text:'Learn more',target_url:'https://example.com/',theme:'violet',weight:1,rotation_seconds:7,status:'draft',
    placements:['home/primary','detail/bottom'],reason};
  await assert.rejects(()=>editPromotion(config,'12345',null,inputs),{status:409});
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM promotions WHERE id LIKE 'fixture-audit-batch%'").get().n,0);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM admin_audit_log').get().n,0);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM admin_revisions').get().n,0);
});

test('selectable import preserves unknown details, flags control metadata and handles concurrent conflicts', async t=>{
  const {config,sqlite}=fixture(t);
  const {createImportedDrafts}=await import('../lib/admin/servers.js');
  const items=await prepareImport(config.db,[
    {...candidate('bulk-first','https://github.com/example/bulk-first'),unknownTopLevel:true,
      details:{descriptionNotes:'Extra documented context',review:{status:'published'}}},
    candidate('bulk-second','https://github.com/example/bulk-second'),
    candidate('bulk-third','https://github.com/example/bulk-third'),
  ]);
  assert.deepEqual(items[0].unsupported,['unknownTopLevel','details.review']);
  assert.deepEqual(JSON.parse(items[0].row.details_json),{review:{status:'pending-publication'},descriptionNotes:'Extra documented context'});
  await assert.rejects(()=>createImportedDrafts(config,'12345',items,[0],{reason}),{status:400});
  const results=await Promise.all([
    createImportedDrafts(config,'12345',items,[0,1],{reason,confirm:'yes'}),
    createImportedDrafts(config,'12345',items,[0],{reason,confirm:'yes'}),
  ]);
  assert.equal(results.flat().filter(outcome=>outcome.created).length,2);
  assert.equal(results.flat().filter(outcome=>outcome.error).length,1);
  assert.equal(await registry(config.db).detail('bulk-first'),null);
  assert.equal(await serverRow(config.db,'bulk-third'),null);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='create-import'").get().n,2);
});

test('promotion and sponsorship restores use encrypted snapshots and new audit events', async t=>{
  const {config,sqlite}=fixture(t);
  const {getPromotion}=await import('../lib/admin/promotions.js');
  const {editSponsor,sponsorRow}=await import('../lib/admin/sponsors.js');
  const input={action:'create',id:'fixture-recovery',headline:'Initial promotion',eyebrow:'Promoted',description:'Example',
    cta_text:'Learn more',target_url:'https://example.com/private-destination',theme:'violet',weight:1,rotation_seconds:7,
    status:'draft',placements:['home/primary'],reason};
  await editPromotion(config,'12345',null,input);
  const old=await getPromotion(config.db,input.id);
  await editPromotion(config,'12345',input.id,{...input,action:'save',headline:'Updated promotion',version:await version(old)});
  const saved=sqlite.prepare("SELECT * FROM admin_audit_log WHERE entity='promotion' AND action='save'").get();
  assert.match(saved.after_json,/Updated promotion/);
  assert.doesNotMatch(saved.before_json,/private-destination/);
  await assert.rejects(()=>editPromotion(config,'12345',input.id,{action:'restore',confirm:'yes',reason,revision:saved.id,version:'stale'}),{status:409});
  await editPromotion(config,'12345',input.id,{action:'restore',confirm:'yes',reason,revision:saved.id,version:await version(await getPromotion(config.db,input.id))});
  assert.equal((await getPromotion(config.db,input.id)).headline,old.headline);

  const sponsor={name:'Fixture tier',description:'Private tier draft',cta_text:'Contact',target_url:'https://example.com/',status:'draft',reason};
  await editSponsor(config,'12345','gold',{...sponsor,version:await version(null)});
  const prior=await sponsorRow(config.db,'gold');
  await editSponsor(config,'12345','gold',{...sponsor,name:'Revised tier',version:await version(prior)});
  const event=sqlite.prepare("SELECT id FROM admin_audit_log WHERE entity='sponsor' AND action='save' ORDER BY rowid DESC").get();
  await editSponsor(config,'12345','gold',{action:'restore',confirm:'yes',reason,revision:event.id,version:await version(await sponsorRow(config.db,'gold'))});
  assert.equal((await sponsorRow(config.db,'gold')).name,prior.name);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM admin_audit_log WHERE action='restore'").get().n,2);
});

test('rotating the environment session secret rejects existing sessions',async t=>{
  const {config,sqlite}=fixture(t);
  const raw=await seedSession(sqlite,config);
  const req=request('/admin/',{headers:{Cookie:sessionCookie(raw)}});
  assert.ok(await sessionFor(config,req));
  assert.equal(await sessionFor({...config,secret:token()},req),null);
});

test('superseded outbox decisions do not call GitHub and remain distinct from delivery', async t=>{
  const {config,sqlite}=fixture(t);
  const id=token();
  sqlite.prepare('INSERT INTO submission_reviews VALUES(?,?,?,?,?,?,?,?)')
    .run(42,'published','hash','commit','{}','12345','date','fixture');
  sqlite.prepare('INSERT INTO admin_outbox(id,issue_number,action,message,decision_version) VALUES(?,?,?,?,?)')
    .run(id,42,'published','Fixture','earlier-decision');
  const env={ADMIN_GITHUB_SYNC:'enabled',ADMIN_GITHUB_APP_ID:'11',ADMIN_GITHUB_INSTALLATION_ID:'22',ADMIN_GITHUB_APP_PRIVATE_KEY:'fixture'};
  let called=false;
  const result=await retryIssue({...config,mode:'production'},env,'12345',id,reason,async()=>{called=true;});
  assert.equal(called,false);
  assert.equal(result.status,'superseded');
  assert.equal(sqlite.prepare('SELECT resolution FROM admin_outbox WHERE id=?').get(id).resolution,'superseded');
});

test('GitHub review token is scoped to project issues, public evidence is cached and rate limits back off', async t=>{
  const {github,project,projectRead}=await import('../lib/admin/github.js');
  let requests=0;
  t.mock.method(globalThis,'fetch',async (path,opts)=>{
    requests++;
    if (path.endsWith('/issues/9')) {
      assert.equal(opts.headers.Authorization,'Bearer fixture-read-token');
      return Response.json({number:9});
    }
    assert.equal(opts.headers.Authorization,undefined);
    if (path.endsWith('/limited')) return Response.json({message:'Private provider detail'},{status:429,headers:{'Retry-After':'1'}});
    return Response.json({id:9});
  });
  await projectRead(project+'/issues/9','fixture-read-token');
  assert.throws(()=>projectRead('/repos/example/a/issues/1','fixture-read-token'),/Invalid GitHub issue path/);
  await github('/repos/example/cache-fixture',{cache:true});
  await github('/repos/example/cache-fixture',{cache:true});
  assert.equal(requests,2);
  await assert.rejects(()=>github('/repos/example/limited'),/Retry in about 1 minute/);
  await assert.rejects(()=>github('/repos/example/backoff'),/Retry in about 1 minute/);
  assert.equal(requests,3);
});
