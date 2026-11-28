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
  for (const name of ['0001_servers','0002_server_details','0007_promotions','0008_promotion_slots','0010_admin','0011_admin_outbox_decisions','0012_admin_github_evidence','0013_promotion_campaigns']) {
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
  const featureEnv={...env,CF_PAGES_BRANCH:'feature/registry-json-revisions'};
  const featureOrigin='https://feature-registry-json-revisi.freemcp.pages.dev';
  assert.equal((await run(featureEnv,'/admin/login/',{},featureOrigin)).status,200);
  assert.equal((await run(featureEnv,'/admin/login/',{},preview)).status,404);
  assert.equal((await run(env,'/admin/login/',{},featureOrigin)).status,404);
  const fixEnv={...env,CF_PAGES_BRANCH:'fix/admin-candidate-validation-and-url-overflow'};
  const fixOrigin='https://fix-admin-candidate-validati.freemcp.pages.dev';
  assert.equal((await run(fixEnv,'/admin/login/',{},fixOrigin)).status,200);
  assert.equal((await run(fixEnv,'/admin/login/',{},featureOrigin)).status,404);
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
  assert.deepEqual(items.map(item=>[item.number,item.kind]),[[42,'recognized'],[10,'unrelated']]);
  const first=await submission(42,{commentsPage:2,readme:true});
  assert.equal(first.comments.next,true);
  assert.equal(first.comments.items[0].body,'<em>comment</em>');
  const before=await version(null);
  const {reviewDuplicate,savedCandidateRevision}=await import('../lib/admin/submissions.js');
  await submission(42,{config});
  const submitted=candidate('example-submitted','https://github.com/example/submitted');
  const save=(data={})=>reviewAction(config,'12345',42,{action:'save-candidate',candidate:submitted,reason,
    version:before,fingerprint:first.fingerprint,...data});
  const duplicate=await editServer(config,'12345',null,{...candidate('alternate-submission','https://github.com/example/submitted'),action:'create',reason});
  assert.equal((await reviewDuplicate(config,first,null)).id,duplicate.id);
  await assert.rejects(()=>save(),/already listed under alternate-submission/);
  sqlite.prepare('DELETE FROM servers WHERE id=?').run(duplicate.id);
  await save();
  const saved=await reviewRow(config.db,42);
  const revision=await savedCandidateRevision(saved);
  await reviewAction(config,'12345',42,{action:'approved',revision,confirm:'yes',version:await version(saved),fingerprint:first.fingerprint,reason});
  const review=await reviewRow(config.db,42);
  assert.equal(review.status,'approved');
  assert.equal(await serverRow(config.db,'example-submitted'),null);
  const approvedVersion=await version(review);
  sha='b'.repeat(40);
  const moved=await submission(42);
  await assert.rejects(()=>reviewAction(config,'12345',42,{action:'publish',revision,confirm:'yes',version:approvedVersion,fingerprint:moved.fingerprint,reason}),{status:409});
  sha='a'.repeat(40);
  issueText=issueBody.replace('Synthetic submission','New description');
  const revised=await submission(42);
  await assert.rejects(()=>reviewAction(config,'12345',42,{action:'publish',revision,confirm:'yes',version:approvedVersion,fingerprint:revised.fingerprint,reason}),{status:409});
  issueText=issueBody;
  const result=await reviewAction(config,'12345',42,{action:'publish',revision,confirm:'yes',version:approvedVersion,fingerprint:first.fingerprint,reason});
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
  const latest=await submission(42,{config,refresh:true});
  await assert.rejects(async()=>reviewAction(config,'12345',42,{action:'publish',confirm:'yes',version:await version(hidden),fingerprint:latest.fingerprint,reason}),/explicit approval/);
  await save({version:await version(hidden),fingerprint:latest.fingerprint,candidate:{...submitted,name:'Corrected listing'}});
  const corrected=await reviewRow(config.db,42);
  const correctedRevision=await savedCandidateRevision(corrected);
  await reviewAction(config,'12345',42,{action:'approved',revision:correctedRevision,confirm:'yes',reason,
    version:await version(corrected),fingerprint:latest.fingerprint});
  const approvedAgain=await reviewRow(config.db,42);
  const republished=await reviewAction(config,'12345',42,{action:'publish',revision:correctedRevision,confirm:'yes',version:await version(approvedAgain),fingerprint:latest.fingerprint,reason});
  assert.equal(republished.serverId,server.id);
  assert.equal((await registry(config.db).detail(server.id)).name,'Corrected listing');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM servers WHERE id=?').get(server.id).n,1);

});

test('outbox is disabled in preview and supports a retry after failure without repeating success', async t=>{
  const {config,sqlite}=fixture(t);
  const id=token();
  sqlite.prepare('INSERT INTO submission_reviews VALUES(?,?,?,?,?,?,?,?)')
    .run(42,'published','hash','commit','{}','12345','date','fixture');
  const decision='production:'+await version(await reviewRow(config.db,42));
  sqlite.prepare('INSERT INTO admin_outbox(id,issue_number,action,message,decision_version) VALUES(?,?,?,?,?)').run(id,42,'published','Fixture',decision);
  const env={ADMIN_GITHUB_SYNC:'enabled',ADMIN_GITHUB_APP_ID:'11',ADMIN_GITHUB_INSTALLATION_ID:'22',ADMIN_GITHUB_APP_PRIVATE_KEY:'fixture'};
  let deliveries=0;
  const send=async()=>{if (++deliveries===1) throw Error('fixture failure');};
  await assert.rejects(()=>retryIssue(config,env,'12345',id,reason,send),{status:503});
  const production={...config,mode:'production'};
  assert.deepEqual(await retryIssue(production,env,'12345',id,reason,send),{status:'failed'});
  assert.ok(sqlite.prepare('SELECT next_retry FROM admin_outbox WHERE id=?').get(id).next_retry>now());
  sqlite.prepare("UPDATE admin_outbox SET next_retry=0,status='sending',lease_until=? WHERE id=?").run(now()+120,id);
  await assert.rejects(()=>retryIssue(production,env,'12345',id,reason,send),{status:409});
  sqlite.prepare('UPDATE admin_outbox SET lease_until=? WHERE id=?').run(now()-1,id);
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
    starts_at,placements:['home/primary'],reason,confirm:'yes'});
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
  const env={ADMIN_ENV:'production',CF_PAGES_BRANCH:'main',ADMIN_GITHUB_SYNC:'enabled',ADMIN_GITHUB_APP_ID:'11',ADMIN_GITHUB_INSTALLATION_ID:'22',
    ADMIN_GITHUB_APP_PRIVATE_KEY:'-----BEGIN PRIVATE KEY-----\n'+btoa(String.fromCharCode(...bytes))+'\n-----END PRIVATE KEY-----'};
  const item={id:'delivery-fixture',issue_number:42,action:'published',message:'Fixture notification'};
  const calls=[];
  let commentPosted=true,failLabels=false;
  t.mock.method(globalThis,'fetch',async (path,options)=>{
    const url=new URL(path);
    assert.equal(url.origin,'https://api.github.com');
    calls.push([options.method,url.pathname,options.body&&JSON.parse(options.body)]);
    if (url.pathname==='/app') return Response.json({slug:'fixture-app'});
    if (url.pathname.endsWith('/access_tokens')) {
      assert.deepEqual(JSON.parse(options.body),{repositories:['freemcp-registry'],permissions:{issues:'write'}});
      return Response.json({token:'fixture-app-token'});
    }
    if (url.pathname.endsWith('/comments')&&options.method==='GET') {
      const marker='<!-- freemcp-admin:delivery-fixture -->';
      return Response.json(commentPosted?[{body:marker,user:{login:'fixture-app[bot]'}}]:[]);
    }
    if (url.pathname.endsWith('/comments')&&options.method==='POST') commentPosted=true;
    if(failLabels&&url.pathname.endsWith('/labels')&&options.method==='POST') return Response.json({},{status:502});
    return Response.json({});
  });
  await assert.rejects(()=>deliverIssueUpdate({...env,ADMIN_ENV:'preview'},item),{status:503});
  assert.equal(calls.length,0);
  await deliverIssueUpdate(env,item);
  assert.ok(!calls.some(([method,path])=>method==='POST'&&path.endsWith('/comments')));
  assert.ok(calls.some(([method,path])=>method==='POST'&&path.endsWith('/labels')));
  assert.deepEqual(calls.filter(([method])=>method==='DELETE').map(([,path])=>path.split('/').at(-1)),
    ['freemcp-needs-clarification','freemcp-rejected']);
  assert.ok(calls.some(([method,path,body])=>method==='PATCH'&&path.endsWith('/issues/42')&&body.state_reason==='completed'));
  calls.length=0;
  commentPosted=false;
  failLabels=true;
  await assert.rejects(()=>deliverIssueUpdate(env,{...item,action:'clarification'}),{status:502});
  failLabels=false;
  await deliverIssueUpdate(env,{...item,action:'clarification'});
  assert.equal(calls.filter(([method,path])=>method==='POST'&&path.endsWith('/comments')).length,1);
  assert.deepEqual(calls.at(-1),['PATCH','/repos/strbbrn/freemcp-registry/issues/42',{state:'open'}]);
  assert.ok(calls.some(([method,path,body])=>method==='POST'&&path.endsWith('/labels')&&body.labels.includes('freemcp-needs-clarification')));
  calls.length=0;
  await assert.rejects(()=>deliverIssueUpdate(env,item,async()=>false),{status:409});
  assert.ok(calls.every(([method,path])=>method==='GET'||path.endsWith('/access_tokens')));
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
  for (const fingerprint of ['preview:'+await version(await reviewRow(config.db,42)),null]) {
    const copied=token();
    sqlite.prepare('INSERT INTO admin_outbox(id,issue_number,action,message,decision_version) VALUES(?,?,?,?,?)')
      .run(copied,42,'published','Fixture',fingerprint);
    assert.deepEqual(await retryIssue({...config,mode:'production'},env,'12345',copied,reason,async()=>{called=true;}),{status:'superseded'});
  }
  assert.equal(called,false);
});

test('transport resolution uses Agenterm and legacy install shapes and preserves raw values on unrelated edits',async ()=>{
  const {resolveTransport}=await import('../lib/admin/transport.js');
  const {serverCandidate}=await import('../lib/admin/servers.js');
  const remote={title:'Hosted Streamable HTTP endpoint',config:{mcpServers:{agenterm:{type:'http',url:'https://agenterm.example/mcp'}}}};
  const local={title:'Local command',config:{servers:{agenterm:{command:'fixture'}}}};
  assert.deepEqual(resolveTransport({installations:[remote]}).modes,['http']);
  assert.deepEqual(resolveTransport({installations:[remote,local]}).modes,['http','stdio']);
  assert.deepEqual(resolveTransport({transport:'Local stdio / Legacy SSE'}).modes,['stdio','sse']);
  assert.deepEqual(resolveTransport({description:'Streamable HTTP available'}).modes,[]);
  assert.deepEqual(resolveTransport({transport:'websocket',installations:[remote]}).unsupported,['websocket']);
  const original=serverCandidate(candidate('fixture-agenterm','https://github.com/Heming9/agenterm'));
  original.details_json=JSON.stringify({transport:'legacy-wire-mode',installations:[remote],external:{keep:true}});
  const updated=serverCandidate({name:'Updated',transport:'',transports:'',installations:JSON.stringify([remote])},original);
  assert.equal(updated.details_json,original.details_json);
});

test('Overleaf-style submissions normalize links, aliases, tools and paragraphs and escape active Markdown',async ()=>{
  const {normalizedSubmission,evidenceMarkdown}=await import('../lib/admin/submission-candidate.js');
  const original={Repository:'https://github.com/yangzichao/mcp-server-overleaf',Name:'Overleaf MCP',Transport:'Local stdio',
    Documentation:'[Install](https://github.com/yangzichao/mcp-server-overleaf#install) · [Workflows](https://example.com/docs)',
    'Documented tools':'`list_projects`, **read_file**, `edit_file`.','Setup prerequisites':'Node.js 22.14 or later, npm, and project access. '.repeat(6),
    'Installation evidence / instructions':'Run `npx --yes mcp-server-overleaf@0.6.3 --stdio`.'};
  const before=structuredClone(original);
  const parsed=normalizedSubmission(original);
  assert.equal(parsed.details.transport,'stdio');
  assert.equal(parsed.details.documentationUrls.length,1);
  assert.deepEqual(parsed.details.tools.map(tool=>tool.name),['list_projects','read_file','edit_file']);
  assert.deepEqual(parsed.details.installations[0].config.mcpServers['mcp-server-overleaf'].args,['--yes','mcp-server-overleaf@0.6.3','--stdio']);
  assert.equal(parsed.details.prerequisites.length,6);
  assert.deepEqual(original,before);
  const html=evidenceMarkdown('**review** [docs](https://example.org/) [bad](javascript:alert%281%29)\n\n<img src=x onerror=alert(1)>');
  assert.match(html,/<strong>review<\/strong>/);
  assert.match(html,/<a href="https:\/\/example.org\//);
  assert.doesNotMatch(html,/<img|href="javascript/);
});

test('saving a revised full candidate invalidates its approval and binds publication to the exact saved fields',async t=>{
  const {config,sqlite}=fixture(t);
  const {issueContent}=await import('../src/lib/submission.mjs');
  const body=issueContent({repository:'https://github.com/example/reviewed',name:'Registry fixture',category:'Other',
    description:'Synthetic submission',transport:'stdio',installation:'fixture-mcp'},[]);
  t.mock.method(globalThis,'fetch',async (path,opts)=>{
    assert.equal(opts.method,'GET');
    const url=new URL(path);
    if (url.pathname.endsWith('/issues/145')) return Response.json({number:145,title:'[MCP Submission] Fixture',state:'open',body});
    if (url.pathname.endsWith('/commits/main')) return Response.json({sha:'d'.repeat(40)});
    return Response.json({id:545,full_name:'example/reviewed',default_branch:'main'});
  });
  const {savedCandidateRevision}=await import('../lib/admin/submissions.js');
  const evidence=await submission(145,{config});
  const current=()=>reviewRow(config.db,145);
  const submit=async data=>{
    const row=await current();
    return reviewAction(config,'12345',145,{reason,version:await version(row),revision:await savedCandidateRevision(row),
      fingerprint:evidence.fingerprint,...data});
  };
  const draft=candidate('reviewed-custom-id','https://github.com/example/reviewed');
  draft.details.documentationUrls=['https://example.org/workflows'];
  draft.details.tools=Array.from({length:7},(_,i)=>({name:'fixture_'+i,description:'Documented action '+i}));
  await submit({action:'save-candidate',candidate:draft});
  assert.equal(await serverRow(config.db,draft.id),null);
  await submit({action:'approved',confirm:'yes'});
  assert.equal((await reviewRow(config.db,145)).status,'approved');
  const oldApproval=await current();
  const oldRevision=await savedCandidateRevision(oldApproval);
  const corrected={...draft,name:'Corrected candidate',description:'A corrected description.',
    details:{...draft.details,tools:Array.from({length:15},(_,i)=>({name:'fixture_'+i,description:'Documented action '+i}))}};
  await assert.rejects(()=>submit({action:'save-candidate',candidate:draft,candidateJson:JSON.stringify(corrected)}),/JSON editor has changes/);
  await submit({action:'save-candidate',candidateJson:JSON.stringify(corrected),useAdvanced:'yes'});
  await assert.rejects(async()=>submit({action:'publish',confirm:'yes',version:await version(oldApproval),revision:oldRevision}),{status:409});
  assert.equal((await reviewRow(config.db,145)).status,'clarification');
  await assert.rejects(()=>submit({action:'publish',confirm:'yes'}),/explicit approval/);
  await assert.rejects(()=>submit({action:'approved',confirm:'yes',revision:oldRevision}),/revision changed/);
  await submit({action:'approved',confirm:'yes'});
  await assert.rejects(()=>submit({action:'publish',confirm:'yes',candidate:{...draft,name:'Injected name'}}),/Save candidate edits/);
  assert.equal((await submit({action:'publish',confirm:'yes'})).serverId,draft.id);
  const publicRow=await registry(config.db).detail(draft.id);
  assert.equal(publicRow.name,'Corrected candidate');
  assert.equal(publicRow.description,'A corrected description.');
  assert.equal(publicRow.details.tools.length,15);
  assert.equal(publicRow.details.documentationUrls[0],'https://example.org/workflows');
  assert.equal(sqlite.prepare("SELECT count(*) n FROM admin_audit_log WHERE action='save-candidate'").get().n,2);
});

test('multi-placement edits are checked, confirmed and audited together',async t=>{
  const {config,sqlite}=fixture(t);
  const {getPromotion}=await import('../lib/admin/promotions.js');
  const data={action:'create',id:'placement-edit-fixture',headline:'Original',eyebrow:'Fixture',description:'Fixture',
    cta_text:'Learn more',target_url:'https://example.org/',theme:'violet',weight:1,rotation_seconds:7,status:'draft',
    placements:['home/primary','detail/bottom'],reason};
  const [primary,other]=await editPromotion(config,'12345',null,data);
  const base={...data,action:'save',selection:'home/primary',headline:'Edited',
    version:await version(await getPromotion(config.db,primary)),['also_'+other]:'yes',['version_'+other]:await version(await getPromotion(config.db,other))};
  await assert.rejects(()=>editPromotion(config,'12345',primary,{...base,status:'active'}),/Confirm changes/);
  sqlite.exec("CREATE TRIGGER omit_placement BEFORE INSERT ON admin_audit_log WHEN NEW.action='save' AND NEW.entity_id LIKE '%detail-bottom' BEGIN SELECT RAISE(IGNORE); END;");
  await assert.rejects(()=>editPromotion(config,'12345',primary,base),{status:409});
  assert.equal((await getPromotion(config.db,primary)).headline,'Original');
  sqlite.exec('DROP TRIGGER omit_placement');
  assert.deepEqual(await editPromotion(config,'12345',primary,base),[primary,other]);
  assert.equal((await getPromotion(config.db,other)).headline,'Edited');
});
test('GitHub evidence caches by environment, uses ETags, and persists cooldown across callers', async t=>{
  const {config,sqlite}=fixture(t);
  const { githubEvidence, githubEvidenceMetrics }=await import('../lib/admin/github-evidence.js');
  const endpoint='/repos/example/cache-fixture';
  let requests=0, rateStatus=0, mode='200';
  t.mock.method(globalThis,'fetch',async (path,options)=>{
    requests++;
    assert.equal(path,'https://api.github.com'+endpoint);
    assert.equal(options.headers.Authorization,'Bearer fixture-read-token');
    assert.equal(options.redirect,'manual');
    if (rateStatus) return Response.json({message:'Undisclosed upstream details'},{status:rateStatus,headers:{'Retry-After':'60'}});
    if (mode==='304') {
      assert.equal(options.headers['If-None-Match'],'"fixture"');
      return new Response(null,{status:304});
    }
    return Response.json({id:9},{headers:{ETag:'"fixture"'}});
  });
  const request=(opts={},scope=config)=>githubEvidence(scope,'fixture-read-token',endpoint,opts);
  assert.deepEqual((await request()).data,{id:9});
  assert.equal((await request()).cached,true);
  assert.equal(requests,1);
  mode='304';
  assert.equal((await request({fresh:true})).stale,false);
  assert.equal(requests,2);
  sqlite.prepare("UPDATE admin_github_cache SET checked_at=0 WHERE scope='preview'").run();
  rateStatus=403;
  assert.equal((await request()).stale,true);
  rateStatus=429;
  assert.equal((await request()).stale,true);
  await assert.rejects(()=>request({fresh:true}),/Retry in about [12] minute/);
  assert.equal(requests,3);
  await assert.rejects(()=>request({}, {...config,mode:'production'}),/rate limit/);
  assert.equal(requests,4);
  await assert.rejects(()=>githubEvidence(config,'fixture-read-token','/user'),/Invalid evidence endpoint/);
  assert.deepEqual(await githubEvidenceMetrics(config),{requests:3,cacheHits:1,staleHits:2,conditional:2,
    notModified:1,rateLimited:1,retryAt:(await githubEvidenceMetrics(config)).retryAt});
});

test('legacy HTML form no-op preserves missing, empty and structured values and produces no audit write',async t=>{
  const {config,sqlite}=fixture(t);
  const {serverCandidate}=await import('../lib/admin/servers.js');
  const draft=await editServer(config,'12345',null,{...candidate('heming9-agenterm','https://github.com/Heming9/agenterm'),action:'create',reason});
  const installations=[{title:'Hosted Streamable HTTP endpoint',config:{mcpServers:{agenterm:{type:'http',url:'https://host.example/mcp'}}}}];
  for (const representation of [undefined,'',[],null,'legacy-key']) {
    const details={installations,additional:{preserve:'yes'},...(representation===undefined?{}:{implementationKey:representation})};
    sqlite.prepare('UPDATE servers SET details_json=?,tags_json=? WHERE id=?').run(JSON.stringify(details,null,2),'[ "fixture" ]',draft.id);
    const row=await serverRow(config.db,draft.id);
    const fields={listingForm:'yes',name:row.name,description:row.description,category:row.category,author:row.author,
      github_url:row.github_url,stars:String(row.stars),tags:'fixture',summary:'',documentationUrl:'',documentationUrls:'',
      pricing:'',serviceDependencies:'',transport:'',transports:'',implementationKey:String(representation??''),
      prerequisites:'',security:'',installations:JSON.stringify(installations),tools:'[]',endpoints:'[]',sharedEndpoints:'{}'};
    assert.deepEqual(serverCandidate(fields,row),{...row});
    await editServer(config,'12345',row.id,{...fields,action:'save',confirm:'yes',reason,version:await version(row)});
    assert.deepEqual(await serverRow(config.db,row.id),row);
    if (Array.isArray(representation)) {
      const cleared=serverCandidate({...fields,clearImplementationKey:'yes'},row);
      assert.equal(JSON.parse(cleared.details_json).implementationKey,'');
    }
    if (representation==='legacy-key') {
      const edited=serverCandidate({...fields,implementationKey:''},row);
      assert.equal(JSON.parse(edited.details_json).implementationKey,'');
    }
  }
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='save'").get().n,0);
});

for (const quotaStatus of [403,429]) test('saved draft operations make zero GitHub calls during '+quotaStatus+' cooldown',async t=>{
  const {config,sqlite,env}=fixture(t);
  const {checkEditableCandidate,displaySubmission,savedCandidateRevision}=await import('../lib/admin/submissions.js');
  const {githubEvidence,githubEvidenceMetrics}=await import('../lib/admin/github-evidence.js');
  const {serverCandidate}=await import('../lib/admin/servers.js');
  const draft=serverCandidate(candidate('offline-draft','https://github.com/example/reviewed'));
  let requests=0;
  t.mock.method(globalThis,'fetch',async()=>{
    requests++;
    return Response.json({message:'rate-limited response'},{status:quotaStatus,headers:{'X-RateLimit-Remaining':'0','Retry-After':'120'}});
  });
  const review={number:177,status:'clarification',issue_hash:'saved-fingerprint',source_commit:'b'.repeat(40),
    candidate_json:JSON.stringify({candidate:draft,exceptions:{},serverVersion:null}),actor:'12345',updated_at:'2026-11-27',server_id:null};
  sqlite.prepare('INSERT INTO submission_reviews VALUES(?,?,?,?,?,?,?,?)').run(...Object.values(review));
  const latestPage='/repos/strbbrn/freemcp-registry/issues?state=all&per_page=40&page=1';
  await assert.rejects(()=>githubEvidence(config,'fixture-token',latestPage),/rate limit/);
  const evidence=await displaySubmission(config,177,review,{commentsPage:1,readToken:'fixture-token'});
  assert.equal(evidence.stale,true);
  const fields={version:await version(review),fingerprint:review.issue_hash,reason,candidate:{
    ...candidate('offline-draft','https://github.com/example/reviewed'),name:'Edited offline'}};
  const raw=await seedSession(sqlite,config);
  const cookie=sessionCookie(raw);
  const identity=await (await run(env,'/api/admin/session/',{headers:{Cookie:cookie}})).json();
  const post=(action,payload=fields)=>run(env,'/api/admin/submissions/177/',{method:'POST',
    headers:{Cookie:cookie,Origin:preview,'Content-Type':'application/json'},body:JSON.stringify({...payload,action,csrf:identity.csrf})});
  assert.equal((await run(env,'/admin/submissions/177/',{headers:{Cookie:cookie}})).status,200);
  assert.match(await (await run(env,'/admin/submissions/',{headers:{Cookie:cookie}})).text(),/Saved drafts/);
  assert.equal((await post('validate-candidate')).status,200);
  const rendered=await post('preview-candidate');
  assert.equal(rendered.status,200);
  assert.match(await rendered.text(),/Edited offline/);
  assert.equal((await post('save-candidate')).status,200);
  const saved=await reviewRow(config.db,177);
  assert.equal(JSON.parse(saved.candidate_json).candidate.name,'Edited offline');
  assert.equal(saved.source_commit,review.source_commit);
  assert.equal(requests,1);
  const correct={...fields,version:await version(saved),fingerprint:saved.issue_hash,confirm:'yes',revision:await savedCandidateRevision(saved)};
  const decision={version:correct.version,fingerprint:correct.fingerprint,confirm:'yes',revision:correct.revision,reason};
  assert.equal((await post('approved',decision)).status,503);
  const invalidInput={...correct,candidate:{...candidate('offline-draft','https://github.com/example/reviewed'),details:{
    documentationUrl:'',transport:'unknown',transports:[],installations:[],tools:[],prerequisites:[],security:[]}}};
  const failed=await post('validate-candidate',invalidInput);
  assert.equal(failed.status,400);
  assert.deepEqual((await failed.json()).issues.map(issue=>issue.field),['documentationUrl','transport','installations','tools','prerequisites','security']);
  await post('save-candidate',invalidInput).then(response=>assert.equal(response.status,200));
  const incomplete=await reviewRow(config.db,177);
  const reject=await post('approved',{...decision,version:await version(incomplete),revision:await savedCandidateRevision(incomplete)});
  assert.equal(reject.status,400);
  assert.match((await reject.json()).error,/Publication readiness/);
  assert.equal(requests,1);
  await post('save-candidate',{...correct,version:await version(incomplete)}).then(response=>assert.equal(response.status,200));
  const ready=await reviewRow(config.db,177);
  const readyRevision=await savedCandidateRevision(ready);
  sqlite.prepare("UPDATE submission_reviews SET status='approved',candidate_json=json_set(candidate_json,'$.approvedRevision',?) WHERE number=177").run(readyRevision);
  const approved=await reviewRow(config.db,177);
  assert.equal((await post('publish',{...decision,version:await version(approved),revision:readyRevision})).status,503);
  assert.equal(await serverRow(config.db,draft.id),null);
  assert.equal(requests,1);
  assert.equal((await githubEvidenceMetrics(config)).requests,1);
  const uncached=await checkEditableCandidate(config,177,{...correct,version:await version(approved),action:'preview-candidate'});
  assert.equal(uncached.id,draft.id);
});

test('expired cooldown allows one probe across different evidence keys', async t=>{
  const {config,sqlite}=fixture(t);
  const {githubEvidence}=await import('../lib/admin/github-evidence.js');
  sqlite.prepare('INSERT INTO admin_github_rate(scope,blocked_until) VALUES(?,?)').run(config.mode,now()-1);
  let count=0;
  let observed,respond;
  const started=new Promise(resolve=>{observed=resolve;});
  const gate=new Promise(resolve=>{respond=resolve;});
  t.mock.method(globalThis,'fetch',async()=>{
    count++;
    observed();
    await gate;
    return Response.json({id:1});
  });
  const first=githubEvidence(config,'fixture-token','/repos/example/first');
  await started;
  try {
    await assert.rejects(()=>githubEvidence(config,'fixture-token','/repos/example/second'),/rate limit/);
    assert.equal(count,1);
  } finally { respond(); }
  assert.deepEqual((await first).data,{id:1});
  assert.equal(sqlite.prepare('SELECT blocked_until FROM admin_github_rate WHERE scope=?').get(config.mode).blocked_until,0);
});

test('individual detail restore preserves the campaign through synchronized pause, activation and revision restoration',async t=>{
  const {config,sqlite}=fixture(t),db=config.db;
  const {getPromotion,promotionPeers}=await import('../lib/admin/promotions.js');
  const input={action:'create',id:'uat-campaign',headline:'Before',eyebrow:'Fixture',description:'Before description',
    cta_text:'Before button',target_url:'https://example.org/',theme:'violet',weight:1,rotation_seconds:7,status:'draft',
    placements:['home/primary','directory/primary','detail/primary'],reason};
  const ids=await editPromotion(config,'12345',null,input);
  const [home,directory,detail]=ids;
  const unrelated=(await editPromotion(config,'12345',null,{...input,id:'same-copy-independent',placements:['home/strip']}))[0];
  const snapshot=id=>getPromotion(db,id);
  const submit=async (id,action,others=[],extra={})=>{
    const posts={reason,action,confirm:'yes',version:await version(await snapshot(id)),...extra};
    for(const peer of others) {
      posts['also_'+peer]='yes';
      posts['version_'+peer]=await version(await snapshot(peer));
    }
    return editPromotion(config,'12345',id,posts);
  };
  await submit(home,'activate',[directory,detail]);
  await submit(home,'save',[directory,detail],{...input,action:'save',headline:'After',description:'After description',cta_text:'After button',status:'active'});
  const revision=(id,action)=>sqlite.prepare("SELECT id FROM admin_audit_log WHERE entity='promotion' AND entity_id=? AND action=? ORDER BY rowid DESC LIMIT 1").get(id,action).id;
  await submit(detail,'restore',[],{revision:revision(detail,'save')});
  assert.deepEqual((await Promise.all(ids.map(snapshot))).map(row=>[row.headline,row.description,row.cta_text]),[
    ['After','After description','After button'],['After','After description','After button'],['Before','Before description','Before button']]);
  for (const id of ids) {
    assert.deepEqual(new Set((await promotionPeers(db,await snapshot(id))).map(row=>row.id)),new Set(ids.filter(other=>other!==id)));
    assert.notEqual((await snapshot(id)).campaign_id,(await snapshot(unrelated)).campaign_id);
  }
  await submit(detail,'pause');
  await submit(home,'save',[detail],{...input,action:'save',headline:'Save while mixed',status:'active'});
  assert.equal((await snapshot(detail)).status,'paused');
  await submit(directory,'pause',[home,detail]);
  assert.deepEqual((await Promise.all(ids.map(snapshot))).map(row=>row.status),['paused','paused','paused']);
  await submit(home,'activate',[directory,detail]);
  const oldCampaign=(await snapshot(home)).campaign_id;
  const priorRows=await Promise.all(ids.map(snapshot));
  const restore={revision:revision(home,'pause'),['revision_'+directory]:revision(directory,'pause'),['revision_'+detail]:revision(detail,'pause')};
  sqlite.exec("CREATE TRIGGER ignore_detail_restore BEFORE INSERT ON admin_audit_log WHEN NEW.entity_id='uat-campaign-detail-primary' AND NEW.action='restore' BEGIN SELECT RAISE(IGNORE); END;");
  await assert.rejects(()=>submit(home,'restore',[directory,detail],restore),{status:409});
  assert.deepEqual(await Promise.all(ids.map(snapshot)),priorRows);
  sqlite.exec('DROP TRIGGER ignore_detail_restore');
  await submit(home,'restore',[directory,detail],restore);
  const restored=await Promise.all(ids.map(snapshot));
  assert.deepEqual(restored.map(row=>row.status),['active','active','paused']);
  assert.ok(restored.every(row=>row.campaign_id===oldCampaign));
  const audit=sqlite.prepare("SELECT json_extract(after_json,'$.operationId') AS operation FROM admin_audit_log WHERE action='restore' ORDER BY rowid DESC LIMIT 3").all();
  assert.ok(audit[0].operation);
  assert.equal(new Set(audit.map(row=>row.operation)).size,1);
});

test('campaign migration preserves production seed payloads, existing UAT records and unrelated legacy identities',async t=>{
  const sqlite=new DatabaseSync(':memory:');
  t.after(()=>sqlite.close());
  const apply=name=>sqlite.exec(readFileSync(new URL('../migrations/'+name+'.sql',import.meta.url),'utf8'));
  for(const name of ['0007_promotions','0008_promotion_slots','0009_directory_footer_promotion','0010_admin']) apply(name);
  const add=sqlite.prepare(`INSERT INTO promotions(id,placement,slot,eyebrow,headline,description,cta_text,target_url,theme,status)
    VALUES(?,?,'primary','Fixture','Identical','Same text','Open','https://example.org/','violet',?)`);
  add.run('independent-home','home','active');
  add.run('independent-detail','detail','paused');
  for(const placement of ['home','directory','detail']) {
    const id='preview-test-promo-'+placement+'-primary';
    add.run(id,placement,placement==='detail'?'paused':'active');
    sqlite.prepare(`INSERT INTO admin_audit_log(id,actor,action,entity,entity_id,reason,before_json,after_json,created_at)
      VALUES(?,'12345','create','promotion',?,'UAT fixture','null','{}','2026-11-27 18:52:03')`).run(id,id);
  }
  const before=sqlite.prepare('SELECT * FROM promotions ORDER BY id').all();
  apply('0013_promotion_campaigns');
  const rows=sqlite.prepare('SELECT * FROM promotions ORDER BY id').all();
  assert.deepEqual(rows.map(({campaign_id,...row})=>row),before.map(row=>({...row})));
  assert.equal(rows.filter(row=>row.campaign_id==='catalog:agentagi').length,8);
  assert.equal(rows.filter(row=>row.campaign_id==='uat:preview-test-promo').length,3);
  assert.equal(rows.find(row=>row.id==='independent-home').campaign_id,'legacy:independent-home');
  assert.equal(rows.find(row=>row.id==='independent-detail').campaign_id,'legacy:independent-detail');
  assert.throws(()=>sqlite.exec("UPDATE promotions SET campaign_id='unrelated' WHERE id='agentagi-home'"),/immutable/);
  add.run('old-deploy-insert','home','draft');
  assert.equal(sqlite.prepare("SELECT campaign_id FROM promotions WHERE id='old-deploy-insert'").get().campaign_id,'legacy:old-deploy-insert');
});

test('all mutation routes reject missing CSRF and cross-origin authenticated requests',async t=>{
  const {config,sqlite,env}=fixture(t);
  const raw=await seedSession(sqlite,config);
  const headers={Cookie:sessionCookie(raw),'Content-Type':'application/json'};
  const {csrf}=await (await run(env,'/api/admin/session/',{headers})).json();
  for(const path of ['/api/admin/servers/','/api/admin/submissions/47/','/api/admin/promotions/','/api/admin/sponsors/gold/',
    '/api/admin/import/','/api/admin/outbox/'+token()+'/','/api/admin/session/']) {
    assert.equal((await run(env,path,{method:'POST',headers:{...headers,Origin:preview},body:'{}'})).status,403,path);
    assert.equal((await run(env,path,{method:'POST',headers:{...headers,Origin:prod},body:JSON.stringify({csrf})})).status,403,path);
  }
  for (const path of ['/api/admin/servers/draft-fixture/','/api/admin/submissions/47/']) {
    assert.equal((await run(env,path,{method:'POST',headers:{Origin:preview,'Content-Type':'application/json'},
      body:'{"action":"preview-candidate"}'})).status,401);
  }
});

test('a preview cookie and write stay on the preview binding',async t=>{
  const localPreview=fixture(t), localProduction=fixture(t);
  const raw=await seedSession(localPreview.sqlite,localPreview.config);
  const headers={Cookie:sessionCookie(raw),'Content-Type':'application/json',Origin:preview};
  const {csrf}=await (await run(localPreview.env,'/api/admin/session/',{headers})).json();
  const payload={...candidate('isolated-preview-only','https://github.com/example/isolated-preview'),csrf,action:'create',reason};
  const opts={method:'POST',headers,body:JSON.stringify(payload)};
  const productionEnv={...localProduction.env,ADMIN_ENV:'production',CF_PAGES_BRANCH:'main'};
  assert.equal((await run(productionEnv,'/api/admin/servers/',opts,preview)).status,404);
  assert.equal((await run(productionEnv,'/api/admin/servers/',opts,prod)).status,401);
  assert.equal((await run(localPreview.env,'/api/admin/servers/',opts)).status,200);
  assert.ok(await serverRow(localPreview.config.db,payload.id));
  assert.equal(await serverRow(localProduction.config.db,payload.id),null);
});

test('published listing JSON edits preserve protected metadata and restore complete content atomically',async t=>{
  const {config,sqlite}=fixture(t);
  const {listingDocument}=await import('../lib/admin/servers.js');
  const {renderListing}=await import('../functions/servers/[id].js');
  const makeTools=count=>Array.from({length:count},(_,index)=>({name:'fixture_'+index,description:'Documented action '+index}));
  const original=candidate('json-listing','https://github.com/example/json-listing');
  original.details.tools=makeTools(7);
  await editServer(config,'12345',null,{...original,action:'create',reason});
  sqlite.prepare("UPDATE servers SET details_json=json_set(details_json,'$.review',json(?),'$.lifecycle','archived','$.lifecycleSource','registry','$.githubMetadata',json(?),'$.partner',json(?)) WHERE id=?")
    .run(JSON.stringify({status:'published',source:'approved-submission',issue:987,sourceCommit:'a'.repeat(40)}),
      JSON.stringify({archived:false,disabled:false}),JSON.stringify({retained:true}),original.id);
  const old=await serverRow(config.db,original.id);
  const document=listingDocument(old);
  const replacement={...document,description:'New public JSON description',tags:['updated'],
    details:{...document.details,tools:makeTools(15),prerequisites:['Synthetic client'],security:['Only synthetic records'],
      installations:[{title:'New client',client:'Fixture',config:{mcpServers:{fixture:{command:'fixture-v2',args:['--local']}}}}],
      newMetadata:{version:2}}};
  delete replacement.details.partner;
  const save=async (value,extra={})=>editServer(config,'12345',old.id,{action:'save',useAdvanced:'yes',candidateJson:
    typeof value==='string'?value:JSON.stringify(value),reason,confirm:'yes',version:await version(old),...extra});
  await assert.rejects(()=>save('{'),/valid JSON/);
  await assert.rejects(()=>save({...replacement,details:[]}),/details must be an object/);
  await assert.rejects(()=>save({...replacement,id:'different-id'}),/immutable/);
  await assert.rejects(()=>save({...replacement,details:{...replacement.details,review:{status:'test-only'}}}),/protected details.review/);
  await assert.rejects(()=>save({...replacement,removeDetails:['githubMetadata']}),/editable details keys/);
  await assert.rejects(()=>save({...replacement,details:{...replacement.details,tools:[]}}),/Publication readiness/);
  const other=await editServer(config,'12345',null,{...candidate('other-json','https://github.com/example/other-json'),action:'create',reason});
  await assert.rejects(()=>save({...replacement,github_url:other.github_url}),/already listed/);
  sqlite.exec("CREATE TRIGGER ignore_json_audit BEFORE INSERT ON admin_audit_log WHEN NEW.action='save-json' AND NEW.reason='Audit fixture ignore' BEGIN SELECT RAISE(IGNORE); END");
  await assert.rejects(()=>save(replacement,{reason:'Audit fixture ignore'}),{status:409});
  assert.deepEqual(await serverRow(config.db,old.id),old);
  const edited=await save(replacement);
  const active=await registry(config.db).detail(old.id);
  assert.equal(active.details.tools.length,15);
  assert.equal(active.description,replacement.description);
  assert.deepEqual(active.tags,replacement.tags);
  assert.deepEqual(active.details.review,document.details.review);
  assert.deepEqual(active.details.githubMetadata,document.details.githubMetadata);
  assert.equal(active.details.lifecycle,'archived');
  assert.deepEqual(active.details.partner,{retained:true});
  assert.deepEqual(active.details.newMetadata,{version:2});
  const html=renderListing(active);
  for (const content of ['Explore tools (15)','New public JSON description','Synthetic client','Only synthetic records','fixture-v2']) assert.ok(html.includes(content));
  await assert.rejects(()=>save(replacement),{status:409});
  const history=sqlite.prepare("SELECT * FROM admin_audit_log WHERE action='save-json'").get();
  assert.equal(JSON.parse(history.before_json).toolCount,7);
  assert.equal(JSON.parse(history.after_json).toolCount,15);
  const restored=await editServer(config,'12345',old.id,{action:'restore',revision:history.id,confirm:'yes',version:await version(edited),reason});
  assert.deepEqual(listingDocument(restored),document);
});

test('issue discovery includes issue #48 format, legacy, unrelated and redacted issues with pagination',async t=>{
  const {config,env,sqlite}=fixture(t);
  const {listSubmissions}=await import('../lib/admin/submissions.js');
  const {issueContent}=await import('../src/lib/submission.mjs');
  const title='MCP server submission: UltraTransfer (MIT, local stdio)';
  const body='## Server details\n- Name: UltraTransfer\n- Repository: https://github.com/mmxb8/UltraTransfer\n- Category: Development / Utilities\n- Transport: local stdio\n- Description: Verified file exchange.\n\n## Installation evidence\nInstallation guide: https://github.com/mmxb8/UltraTransfer/blob/main/AGENT_INSTALL.md';
  const standard=issueContent({repository:'https://github.com/example/standard',name:'Fixture',category:'Other',
    description:'Synthetic',transport:'stdio',installation:'fixture-mcp'},[]);
  const issue=(number,title,body,state='open')=>({number,title,body,state,updated_at:'2026-11-27'});
  const items=[issue(48,title,body),issue(49,'Standard',standard),issue(50,'Old format','## Server Details\n**Server Name:** Old format\n**GitHub Repository URL:** https://github.com/example/legacy\n**Short Description:** Legacy example\n**Category:** Other\n','closed'),
    issue(51,'Historical task','Fix footer','closed'),{...issue(52,'Code change','Example'),pull_request:{}},
    issue(53,'MCP secret sample','-----BEGIN PRIVATE KEY-----')];
  let listRequests=0;
  t.mock.method(globalThis,'fetch',async input=>{
    const u=new URL(input);
    if (u.pathname.endsWith('/issues')) {
      listRequests++;
      const state=u.searchParams.get('state');
      return Response.json(items.filter(item=>state==='all'||item.state===state),{headers:{Link:'<https://api.github.com/example>; rel="next"'}});
    }
    if (u.pathname.endsWith('/issues/48')) return Response.json(items[0]);
    if (u.pathname.endsWith('/issues/53')) return Response.json(items[5]);
    if (u.pathname.endsWith('/commits/main')) return Response.json({sha:'c'.repeat(40)});
    return Response.json({id:540,full_name:'mmxb8/UltraTransfer',default_branch:'main'});
  });
  const page=await listSubmissions(1,null,config);
  assert.equal(page.next,true);
  assert.deepEqual(page.items.map(item=>[item.number,item.kind]),[[48,'unrecognized'],[49,'recognized'],[50,'recognized'],[51,'unrelated'],[53,'unrecognized']]);
  assert.equal(page.items.at(-1).title,'Redacted issue');
  await listSubmissions(1,null,config);
  assert.equal(listRequests,1);
  const closed=await listSubmissions(1,null,config,'closed');
  assert.deepEqual(closed.items.map(item=>item.number),[50,51]);
  const raw=await seedSession(sqlite,config);
  const list=await run(env,'/admin/submissions/?state=closed&review=historical&kind=unrelated',{headers:{Cookie:sessionCookie(raw)}});
  const html=await list.text();
  assert.match(html,/Historical task/);
  assert.match(html,/Closed · no recorded review/);
  assert.match(html,/state=closed&amp;kind=unrelated&amp;review=historical/);
  assert.doesNotMatch(html,/Old format/);
  await assert.rejects(()=>submission(53,{config}),{status:422});
  const evidence=await submission(48,{config});
  assert.equal(evidence.fields.Repository,'https://github.com/mmxb8/UltraTransfer');
  assert.equal(evidence.source.sha,'c'.repeat(40));
  assert.match(evidence.findings.warnings.join(' '),/Missing submission field: Documented tools/);
  const draft=candidate('synthetic-issue48','https://github.com/mmxb8/UltraTransfer');
  const saved=await reviewAction(config,'12345',48,{action:'save-candidate',useAdvanced:'yes',candidateJson:JSON.stringify(draft),
    fingerprint:evidence.fingerprint,version:await version(null),reason});
  assert.equal(saved.status,'save-candidate');
  assert.equal(await serverRow(config.db,draft.id),null);
});

test('first UltraTransfer candidate retains normalized documentation and evidence through sync, save, and publication',async t=>{
  const {config,env,sqlite}=fixture(t);
  const {candidateEditorState,savedCandidateRevision}=await import('../lib/admin/submissions.js');
  const number=48;
  const repository='https://github.com/mmxb8/UltraTransfer';
  const primary=repository+'/blob/main/AGENT_INSTALL.md';
  const secondary=repository+'/blob/main/docs/DIRECTORY_LISTING.md';
  const issue={number,title:'MCP server submission: UltraTransfer (MIT, local stdio)',state:'open',body:[
    '## Server details','- Name: UltraTransfer','- Repository: '+repository,'- Category: Development / Utilities',
    '- Transport: local stdio','- Description: Verified file exchange.',
    'Installation guide: '+primary+' '+secondary,
    '- Documented tools: lookup | Search synthetic files', '- Setup prerequisites: Python 3.11.',
    '- Security considerations: Use a dedicated test directory.',
  ].join('\n')};
  t.mock.method(globalThis,'fetch',async path=>{
    const {pathname}=new URL(path);
    if (pathname.endsWith('/issues/48')) return Response.json(issue);
    if (pathname.endsWith('/commits/main')) return Response.json({sha:'c'.repeat(40)});
    return Response.json({id:540,full_name:'mmxb8/UltraTransfer',default_branch:'main'});
  });
  const evidence=await submission(number,{config});
  const {candidate:normalized}=await candidateEditorState(config,evidence,null);
  assert.equal(normalized.details.documentationUrl,primary);
  const {editableCandidate}=await import('../lib/admin/submissions.js');
  const structuredEvidence={...evidence,fields:{...evidence.fields,
    'Installation evidence / instructions':'`python -m ultra_agent.mcp_server`'}};
  const {candidate:withInstallation}=await candidateEditorState(config,structuredEvidence,null);
  assert.equal(withInstallation.details.installations.length,1);
  const unchanged=editableCandidate(structuredEvidence,number,{useAdvanced:'yes',candidateJson:JSON.stringify(withInstallation)},null,null);
  const unchangedDetails=JSON.parse(unchanged.details_json);
  assert.equal(unchangedDetails.documentationUrl,primary);
  assert.deepEqual(unchangedDetails.installations[0].config,withInstallation.details.installations[0].config);
  assert.deepEqual(unchangedDetails.tools,withInstallation.details.tools);
  assert.deepEqual(unchangedDetails.prerequisites,withInstallation.details.prerequisites);
  assert.deepEqual(unchangedDetails.security,withInstallation.details.security);

  const initial={...normalized,details:{...normalized.details,installations:withInstallation.details.installations,
    pricing:'Free for the synthetic workflow',serviceDependencies:['Local runtime'],extraMetadata:{fixture:true}}};
  const cookie=sessionCookie(await seedSession(sqlite,config));
  const {csrf}=await (await run(env,'/api/admin/session/',{headers:{Cookie:cookie}})).json();
  const post=async (action,payload={},row=null)=>run(env,'/api/admin/submissions/48/',{method:'POST',
    headers:{Cookie:cookie,Origin:preview,'Content-Type':'application/json'},body:JSON.stringify({
      csrf,fingerprint:evidence.fingerprint,version:await version(row),reason,action,...payload})});
  const advanced=value=>({useAdvanced:'yes',candidateJson:JSON.stringify(value)});
  assert.equal((await post('validate-candidate',advanced(initial))).status,200);
  const sync=await post('sync-json',advanced(initial));
  assert.equal(sync.status,200);
  const intoStructured=await sync.json();
  assert.match(intoStructured.structured,/value="https:\/\/github\.com\/mmxb8\/UltraTransfer\/blob\/main\/AGENT_INSTALL\.md"/);
  const back=await post('sync-structured',{listingForm:'yes',baseJson:JSON.stringify(intoStructured.document),name:'UltraTransfer fixture',transport:''});
  assert.equal(back.status,200);
  const {document}=await back.json();
  for(const key of ['summary','documentationUrl','documentationUrls','transport','transports','tools','prerequisites','security','pricing','serviceDependencies','extraMetadata']) {
    assert.deepEqual(document.details[key],initial.details[key],key);
  }
  assert.equal(document.name,'UltraTransfer fixture');
  for(const documentationUrl of ['','http://example.org/unsafe','https://fixture:password@example.org/docs']) {
    assert.equal((await post('validate-candidate',advanced({...document,details:{...document.details,documentationUrl}}))).status,400);
  }
  assert.equal((await post('save-candidate',advanced(document))).status,200);
  const first=await reviewRow(config.db,number);
  const reopened=await candidateEditorState(config,evidence,first);
  assert.equal(reopened.candidate.details.documentationUrl,primary);
  assert.deepEqual(reopened.candidate.details.documentationUrls,[secondary]);
  const {id}=reopened.candidate;
  assert.equal((await post('save-candidate',advanced({id,description:'Corrected synthetic description',removeDetails:['extraMetadata']}),first)).status,200);
  const updated=await reviewRow(config.db,number);
  const updatedCandidate=(await candidateEditorState(config,evidence,updated)).candidate;
  assert.equal(updatedCandidate.description,'Corrected synthetic description');
  assert.equal(updatedCandidate.details.documentationUrl,primary);
  assert.deepEqual(updatedCandidate.details.tools,initial.details.tools);
  assert.equal(Object.hasOwn(updatedCandidate.details,'extraMetadata'),false);
  const revision=await savedCandidateRevision(updated);
  assert.equal((await post('approved',{confirm:'yes',revision:'incorrect'},updated)).status,409);
  assert.equal((await post('approved',{confirm:'yes',revision},updated)).status,200);
  const approved=await reviewRow(config.db,number);
  assert.equal((await post('publish',{confirm:'yes',revision},approved)).status,200);
  const published=await registry(config.db).detail(id);
  assert.equal(published.details.documentationUrl,primary);
  assert.deepEqual(published.details.tools,initial.details.tools);
});

test('structured issues initialize the full canonical admin candidate and retain the exact candidate on save', async t=>{
  const {config}=fixture(t);
  const {composeSubmission}=await import('../src/lib/structured-submission.mjs');
  const {candidateEditorState}=await import('../lib/admin/submissions.js');
  const submitted=candidate('structured-candidate','https://github.com/example/submitted/tree/main/implementations/notes');
  submitted.details.tools=Array.from({length:30},(_,i)=>({name:'tool_'+i,description:'Test inventory entry '+i}));
  submitted.details.documentationUrls=['https://example.org/more'];
  submitted.details.serviceDependencies=['Synthetic API'];
  const issue=composeSubmission(submitted);
  t.mock.method(globalThis,'fetch',async (path,opts)=>{
    assert.equal(opts.method,'GET');
    if(path.endsWith('/issues/72'))return Response.json({number:72,title:issue.title,body:issue.body,state:'open'});
    if(path.endsWith('/issues/73'))return Response.json({number:73,title:issue.title,body:issue.body.replace('submission:v1','submission:v9'),state:'open'});
    if(path.endsWith('/commits/main'))return Response.json({sha:'c'.repeat(40)});
    assert.equal(new URL(path).pathname,'/repos/example/submitted');
    return Response.json({full_name:'example/submitted',id:110,default_branch:'main'});
  });
  const evidence=await submission(72,{config});
  const prepared=await candidateEditorState(config,evidence,null);
  assert.deepEqual(prepared.candidate,evidence.structuredCandidate);
  assert.equal(prepared.candidate.details.tools.length,30);
  assert.equal(prepared.candidate.github_url,submitted.github_url);
  await reviewAction(config,'12345',72,{action:'save-candidate',listingForm:'yes',reason,version:await version(null),fingerprint:evidence.fingerprint});
  const saved=await reviewRow(config.db,72);
  const {candidate:stored}=await candidateEditorState(config,evidence,saved);
  const {review,...details}=stored.details;
  assert.deepEqual(details,prepared.candidate.details);
  assert.deepEqual(review,{status:'pending-publication',issue:72,source:'approved-submission'});
  await assert.rejects(()=>submission(73,{config}),{status:422});
});

test('public duplicate check sees published repositories and endpoints only and limits requests', async t=>{
  const {config}=fixture(t);
  const {onRequest}=await import('../functions/api/submission-duplicates.js');
  const hidden=await editServer(config,'12345',null,{...candidate('secret-draft','https://github.com/example/hidden'),action:'create',reason});
  const publicConfig=candidate('visible-server','https://github.com/example/visible');
  publicConfig.details.transport='http';
  publicConfig.details.installations=[{title:'Remote fixture',config:{url:'https://mcp.example.org/path',type:'http'}}];
  const row=await editServer(config,'12345',null,{...publicConfig,action:'create',reason});
  await editServer(config,'12345',row.id,{action:'publish',version:await version(row),confirm:'yes',reason});
  const check=(data,ip='192.0.2.44',env={DB:config.db})=>onRequest({env,request:new Request('https://freemcp.in/api/submission-duplicates',{
    method:'POST',headers:{'Content-Type':'application/json',Origin:'https://freemcp.in','CF-Connecting-IP':ip},
    body:JSON.stringify({repository:'https://github.com/example/unknown',implementationKey:'',endpoints:[],...data}),
  })});
  assert.deepEqual(await (await check({repository:hidden.github_url})).json(),{match:false});
  assert.deepEqual(await (await check({repository:row.github_url.toUpperCase().replace('HTTPS','https')})).json(),{match:true});
  assert.deepEqual(await (await check({repository:row.github_url,implementationKey:'another-implementation'})).json(),{match:false});
  assert.deepEqual(await (await check({endpoints:['https://mcp.example.org/path/']})).json(),{match:true});
  assert.equal((await check({},'192.0.2.45',{})).status,503);
  for(let i=0;i<6;i++) await check({});
  assert.equal((await check({})).status,429);
});

test('distinct monorepo paths do not collide in admin or public checks',async t=>{
  const {config}=fixture(t);
  const {onRequest}=await import('../functions/api/submission-duplicates.js');
  const base='https://github.com/example/workspace/tree/main/packages/';
  const first=candidate('monorepo-one',base+'Search');
  first.details.implementationKey='search';
  const second={...first,id:'monorepo-two',github_url:base+'search'};
  const {prepareImport}=await import('../lib/admin/servers.js');
  const imported=await prepareImport(config.db,JSON.stringify([first,second]));
  assert.deepEqual(imported.map(entry=>entry.row?.github_url),[first.github_url,second.github_url]);
  const row=await editServer(config,'12345',null,{...first,action:'create',reason});
  await editServer(config,'12345',row.id,{action:'publish',version:await version(row),confirm:'yes',reason});
  const check=repository=>onRequest({env:{DB:config.db},request:new Request('https://freemcp.in/api/submission-duplicates',{
    method:'POST',headers:{'Content-Type':'application/json',Origin:'https://freemcp.in','CF-Connecting-IP':'192.0.2.101'},
    body:JSON.stringify({repository,implementationKey:'search',endpoints:[]}),
  })}).then(response=>response.json());
  assert.deepEqual(await check('https://github.com/EXAMPLE/WORKSPACE.GIT/tree/main/packages/Search'),{match:true});
  assert.deepEqual(await check(second.github_url),{match:false});
  const another=await editServer(config,'12345',null,{...second,action:'create',reason});
  assert.equal(another.github_url,second.github_url);
  assert.deepEqual(await check(second.github_url),{match:false});
  await assert.rejects(()=>editServer(config,'12345',null,{...first,id:'another-copy',action:'create',reason}),/already listed/);
});

test('duplicate checks bound bodies and endpoint count before querying and redact storage failures',async()=>{
  const {onRequest}=await import('../functions/api/submission-duplicates.js');
  const data={repository:'https://github.com/example/test',implementationKey:'',endpoints:[]};
  let queries=0;
  const env={DB:{prepare(){queries++;throw Error('internal failure with private listing details');}}};
  const request=(payload,headers={})=>onRequest({env,request:new Request('https://freemcp.in/api/submission-duplicates',{
    method:'POST',headers:{'Content-Type':'application/json',Origin:'https://freemcp.in','CF-Connecting-IP':'192.0.2.102',...headers},
    body:JSON.stringify(payload),
  })});
  assert.equal((await request(data,{Origin:'https://example.org'})).status,403);
  assert.equal((await request(data,{'Content-Type':'text/plain'})).status,415);
  assert.equal((await request({...data,repository:'x'.repeat(12*1024)})).status,413);
  assert.equal((await request({...data,endpoints:Array(13).fill('https://example.org/mcp')})).status,400);
  assert.equal(queries,0);
  const unavailable=await request(data);
  assert.equal(unavailable.status,503);
  assert.deepEqual(await unavailable.json(),{error:'Duplicate check unavailable.'});
  assert.equal(queries,1);
});
