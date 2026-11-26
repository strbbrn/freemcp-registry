import { isSlug } from '../registry.js';
import { assertVersion, version } from './audit.js';
import { beginOAuth, changeSession, configuration, finishOAuth, rateLimit, requireCsrf, requireOrigin, sessionFor } from './auth.js';
import { AdminError, body, e, hardened, methodNotAllowed, redirect, invalid } from './http.js';
import { activityPage, changePreview, importPage, login, overview, pageNumber, promotionsPage, registryForm, registryList, settingsPage,
  shell, sponsorsPage, submissionPage, submissionsList } from './pages.js';
import { editPromotion, getPromotion } from './promotions.js';
import { editServer, listServers, prepareImport, publicServer, serverCandidate, serverRow } from './servers.js';
import { editSponsor, sponsorRow } from './sponsors.js';
import { listSubmissions, reviewAction, reviewRow, retryIssue, submission } from './submissions.js';
import { object, options, parsed } from './validation.js';

const wantsJson = request => request.headers.get('Content-Type')?.startsWith('application/json') ||
  request.headers.get('Accept')?.includes('application/json');
const notFound = () => { throw new AdminError(404,'Page not found.'); };
const issueNumber = id => /^[1-9][0-9]{0,8}$/.test(id || '') ? Number(id) : notFound();

async function page(config,session,env,pathname,params) {
  const parts=pathname.split('/').slice(2,-1);
  const [area,id] = parts;
  if (parts.length>2) return notFound();
  let title, content;
  switch (area) {
    case undefined: title='Overview'; content=await overview(config); break;
    case 'servers':
      title='Registry';
      if (id && !isSlug(id)) return notFound();
      content=!id?await registryList(config,params):await registryForm(config,session,id==='new'?null:id,params.get('preview')==='1');
      break;
    case 'import': title='Import candidates'; if (id) return notFound(); content=importPage(session); break;
    case 'submissions':
      title='Submissions';
      content=id?await submissionPage(config,session,issueNumber(id),params):await submissionsList(config,params);
      break;
    case 'promotions': title='Promotions'; if (id) return notFound(); content=await promotionsPage(config,session,params); break;
    case 'sponsors': title='Sponsorships'; if (id) return notFound(); content=await sponsorsPage(config,session); break;
    case 'activity': title='Activity'; if (id) return notFound(); content=await activityPage(config,session,env,params); break;
    case 'settings': title='Settings'; if (id) return notFound(); content=settingsPage(config,session,env); break;
    default: return notFound();
  }
  if (!content) return notFound();
  return shell(config,session,title,content,pathname);
}

async function api(config,session,env,request,pathname,params) {
  const parts=pathname.split('/').slice(3,-1);
  if (parts.length>2) return notFound();
  const [area,id] = parts;
  const read = request.method==='GET';
  const getAllowed = ['servers','submissions','promotions','sponsors','session'].includes(area);
  const postAllowed = ['servers','submissions','promotions','sponsors','session','outbox','import'].includes(area);
  if (!getAllowed && !postAllowed) return notFound();
  if (read && !getAllowed || !read && (request.method!=='POST'||!postAllowed)) {
    return methodNotAllowed(...(getAllowed?['GET']:[]),...(postAllowed?['POST']:[]));
  }
  if (read) {
    switch (area) {
      case 'session': if (id) return notFound(); return Response.json({actor:session.actor,login:session.login,csrf:session.csrf,expiresAt:session.expires_at});
      case 'servers': {
        if (!id) return Response.json(await listServers(config.db,params));
        const row=await serverRow(config.db,id);
        if (!row) return notFound();
        return Response.json({listing:publicServer(row),version:await version(row)});
      }
      case 'submissions': {
        if (!id) return Response.json(await listSubmissions(pageNumber(params)));
        const number=issueNumber(id), row=await reviewRow(config.db,number);
        return Response.json({evidence:await submission(number,{commentsPage:pageNumber(params),readme:true}),
          review:row && {status:row.status,sourceCommit:row.source_commit,serverId:row.server_id},version:await version(row)});
      }
      case 'promotions': {
        if (!id) return Response.json((await config.db.prepare('SELECT * FROM promotions ORDER BY id LIMIT 25 OFFSET ?').bind((pageNumber(params)-1)*25).all()).results);
        const row=await getPromotion(config.db,id);
        if (!row) return notFound();
        return Response.json({promotion:row,version:await version(row)});
      }
      case 'sponsors': {
        if (!id) return Response.json((await config.db.prepare('SELECT * FROM sponsorships ORDER BY tier').all()).results);
        if (!['gold','diamond','platinum'].includes(id)) return notFound();
        const row=await sponsorRow(config.db,id);
        return Response.json({sponsor:row,version:await version(row)});
      }
      default: return notFound();
    }
  }
  requireOrigin(config,request);
  const data=await body(request);
  requireCsrf(session,request.headers.get('X-CSRF-Token') || data.csrf);
  await rateLimit(config,session.actor,'mutation',60,60);
  const result=(location,data)=>wantsJson(request)?Response.json({location,data}):redirect(location);
  switch (area) {
    case 'servers': {
      if (id && !isSlug(id) || (!id && data.action!=='create') || id && data.action==='create') return notFound();
      if (data.action==='preview-edit' && id) {
        const current=await serverRow(config.db,id);
        if (!current) return notFound();
        await assertVersion(current,data.version);
        const proposed=serverCandidate(data,current);
        return shell(config,session,'Review proposed edits',await changePreview(session,current,proposed,data),'/admin/servers/'+id+'/');
      }
      if (data.reviewed !== undefined) {
        const reviewed=parsed(data.reviewed,'reviewed edits');
        if (!object(reviewed)) invalid('Expected reviewed edit values.');
        for (const key of ['name','description','category','author','github_url','stars','tags','summary','documentationUrl',
          'transport','implementationKey','installations','tools','endpoints','prerequisites','security']) {
          if (Object.hasOwn(reviewed,key)) data[key]=reviewed[key];
        }
      }
      const row=await editServer(config,session.actor,id,data);
      return result('/admin/servers/'+row.id+'/',{id:row.id,version:await version(row)});
    }
    case 'submissions': {
      const number=issueNumber(id);
      const review=await reviewAction(config,session.actor,number,data);
      return result(review.serverId?'/admin/servers/'+review.serverId+'/':'/admin/submissions/'+number+'/',review);
    }
    case 'import': {
      if (id) return notFound();
      const action=options(data.action,['validate','create'],'import action');
      const items=await prepareImport(config.db,data.input);
      if (action==='validate') return wantsJson(request)?Response.json({items}):shell(config,session,'Import candidates',importPage(session,typeof data.input==='string'?data.input:JSON.stringify(data.input),items),'/admin/import/');
      if (items.length!==1 || items[0].error) invalid(items[0]?.error||'Select one validated candidate.');
      const row=publicServer(items[0].row);
      const created=await editServer(config,session.actor,null,{...row,action:'create',reason:data.reason});
      return result('/admin/servers/'+created.id+'/',{id:created.id});
    }
    case 'promotions': {
      if (id && !isSlug(id) || (!id && data.action!=='create') || id && data.action==='create') return notFound();
      const ids=await editPromotion(config,session.actor,id,data);
      return result(ids.length===1?'/admin/promotions/?id='+encodeURIComponent(ids[0]):'/admin/promotions/',{ids});
    }
    case 'sponsors':
      if (!id) return notFound();
      await editSponsor(config,session.actor,id,data);
      return result('/admin/sponsors/',{tier:id});
    case 'outbox':
      if (!/^[A-Za-z0-9_-]{43}$/.test(id||'') || data.action!=='retry') return notFound();
      return result('/admin/activity/',await retryIssue(config,env,session.actor,id,data.reason));
    case 'session':
      if (id) return notFound();
      options(data.action,['rotate','logout','revoke'],'session action');
      if (data.action==='revoke' && data.confirm!=='yes') invalid('Confirm revocation of all sessions.');
      return changeSession(config,session,data.action);
    default: return notFound();
  }
}

export async function admin(context) {
  const { request,env }=context;
  const url=new URL(request.url);
  const path=url.pathname.endsWith('/')?url.pathname:url.pathname+'/';
  const isApi=path.startsWith('/api/admin/');
  let config,session,response;
  try {
    config=configuration(env,request);
    if (path==='/admin/oauth/start/') {
      response=request.method==='POST'?await beginOAuth(config,request):methodNotAllowed('POST');
    } else if (url.pathname==='/admin/oauth/callback/') {
      response=request.method==='GET'?await finishOAuth(config,request):methodNotAllowed('GET');
    } else {
      session=await sessionFor(config,request);
      if (path==='/admin/login/') {
        response=request.method!=='GET'?methodNotAllowed('GET'):session?redirect('/admin/'):login(config);
      } else if (!session) {
        response=isApi?Response.json({error:'Sign-in required.'},{status:401}):request.method==='GET'?redirect('/admin/login/'):new Response('Sign-in required.',{status:401});
      } else {
        response=isApi?await api(config,session,env,request,path,url.searchParams)
          :request.method==='GET'?await page(config,session,env,path,url.searchParams):methodNotAllowed('GET');
      }
    }
  } catch (error) {
    const status=error instanceof AdminError?error.status:503;
    const message=error instanceof AdminError?error.message:'Administration is temporarily unavailable.';
    // Do not log request URLs, OAuth callbacks, request bodies or exception strings.
    response=isApi&&(!config||wantsJson(request)||request.method==='GET')
      ?Response.json({error:message},{status})
      :shell(config||{},session,'Administration',`<section class="panel"><h1>${e(message)}</h1><p><a href="/admin/">Return to administration</a></p></section>`,path,status);
  }
  return hardened(response,path==='/admin/login/');
}
