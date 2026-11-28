import { checkSecrets, object, text, url } from '../../lib/admin/validation.js';
import { structuredConfig } from '../../lib/mcp-config.js';
import { transports, transportAlias, installationSpecs, resolveTransport } from '../../lib/admin/transport.js';
import { assertPublicationReady } from '../../lib/admin/publication.js';
import { manifestFields, validateManifest } from './manifest.mjs';
import { implementationRepository, parseRepository, securityHints } from './submission.mjs';

export const issueBodyLimit = 65000;
const maxJson = 96 * 1024;
const root = ['id','name','description','category','author','github_url','tags','details'];
const detail = ['summary','documentationUrl','documentationUrls','transport','transports','installations','endpoints',
  'tools','prerequisites','security','pricing','serviceDependencies','implementationKey'];
const placeholders = /^(?:\${[A-Z0-9_.-]+}|<[A-Z0-9_. -]+>|YOUR[-_ A-Z0-9]+|REPLACE[-_ A-Z0-9]+)$/;
const utf8 = value => new TextEncoder().encode(value).length;
const fail = message => { throw new Error(message); };
const shape = (value,keys) => {
  if (!object(value) || Object.keys(value).some(key=>!keys.includes(key))) fail('Use only supported fields. Remove administrative or unknown properties.');
};
const array = (value,limit,map) => {
  if (!Array.isArray(value) || value.length>limit) fail('Use a list with at most '+limit+' items.');
  return value.map(map);
};
const fieldText = (value,label,limit,required=true) => text(value,label,limit,required);
const slug = (value,label,required=true) => {
  const name=fieldText(value,label,200,required);
  if (name && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) fail('Use lowercase letters, numbers and single hyphens.');
  return name;
};
export const canonicalRepository = value => implementationRepository(fieldText(value,'GitHub repository URL',2048)).url;
export function repositoryId(value) {
  const {owner,repo,path}=implementationRepository(value);
  const parts=path?path.split('/').slice(3):[];
  return [owner,repo,...parts].join('-').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,200).replace(/-$/,'');
}
const mode = value => transportAlias(value) ?? fail('Choose stdio, Streamable HTTP or legacy SSE.');
export function submissionUrl(value,label,required=true) {
  const target=url(value,label,required);
  if (target && [...new URL(target).searchParams.keys()].some(key=>/^(token|key|sig|signature|auth|x-amz-credential|x-amz-signature)$/i.test(key))) {
    fail('Remove credential parameters from the '+label+'.');
  }
  return target;
}
const endpoint = value => {
  shape(value,['transport','url']);
  const transport=mode(value.transport);
  if (transport==='stdio') fail('HTTPS endpoints require HTTP or SSE.');
  return {transport,url:submissionUrl(value.url,'MCP endpoint')};
};
function configuration(value) {
  const config=structuredConfig(value);
  const visit=(node,depth=0)=>{
    if (depth>16) fail('Installation configuration is nested too deeply.');
    if (Array.isArray(node)) { for (const child of node) visit(child,depth+1); return; }
    if (typeof node==='number'&&(!Number.isFinite(node)||(Number.isInteger(node)&&!Number.isSafeInteger(node)))) {
      fail('Use finite configuration numbers and safe integers.');
    }
    if (!object(node)) return;
    for (const [key,child] of Object.entries(node)) {
      if (/^(env|environment|headers)$/i.test(key)) {
        if (!object(child)||Object.values(child).some(v=>typeof v!=='string'||!placeholders.test(v))) fail('Use placeholders such as ${VARIABLE} for environment variables and headers.');
      }
      if (/^(url|endpoint|baseUrl)$/i.test(key)) submissionUrl(child,'installation URL');
      visit(child,depth+1);
    }
  };
  visit(config);
  for (const spec of installationSpecs(config)) {
    const command=Boolean(spec.command), remote=Boolean(spec.url||spec.endpoint);
    if (command&&remote) fail('Each client entry must use a command or an endpoint, not both.');
    if (spec.type!==undefined||spec.transport!==undefined) {
      const label=mode(spec.transport??spec.type);
      if ((remote&&label==='stdio') || (command&&label!=='stdio'&&!spec.localEndpoint)) fail('Client configuration does not match its transport.');
    }
  }
  return config;
}
function install(value) {
  shape(value,['title','client','os','notes','transport','config','environment']);
  const result={title:fieldText(value.title,'installation title',200),config:configuration(value.config)};
  for (const [key,length] of Object.entries({client:160,os:100,notes:3000})) {
    result[key]=fieldText(value[key],key,length,false);
  }
  if (Object.hasOwn(value,'transport')) result.transport=mode(value.transport);
  if (Object.hasOwn(value,'environment')) {
    if (!object(value.environment)||Object.keys(value.environment).length>30) fail('Invalid v1 environment declarations.');
    result.environment=Object.fromEntries(Object.entries(value.environment).map(([key,entry])=>{
      shape(entry,['required','secret','description']);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)||typeof entry.required!=='boolean'||typeof entry.secret!=='boolean') fail('Invalid v1 environment declaration.');
      return [key,{required:entry.required,secret:entry.secret,description:fieldText(entry.description,'environment description',200)}];
    }));
  }
  return result;
}
const unique = (items,key) => {
  if (new Set(items.map(key)).size!==items.length) fail('Remove duplicate entries.');
  return items;
};

// Require unique JSON object keys. JSON.parse otherwise keeps only the last value.
export function parseCandidateJson(raw) {
  if (typeof raw!=='string'||raw.length>maxJson||utf8(raw)>maxJson) fail('JSON must be under 96 KiB.');
  let value;
  try { value=JSON.parse(raw); } catch { fail('Enter valid JSON.'); }
  const tokens=/(?:"(?:[^"\\]|\\.)*"|[{}[\],:]|[^\s{}[\],:"]+)/g;
  const stack=[];
  let match;
  while ((match=tokens.exec(raw))) {
    const token=match[0];
    if (token==='{') stack.push(new Set());
    if (token==='[') stack.push(null);
    if (token==='}'||token===']') stack.pop();
    if (token.startsWith('"') && stack.at(-1) && /^\s*:/.test(raw.slice(tokens.lastIndex))) {
      const keys=stack.at(-1), key=JSON.parse(token);
      if (keys.has(key)) fail('JSON contains a duplicate property.');
      keys.add(key);
    }
    if (stack.length>16) fail('JSON is nested too deeply.');
  }
  return value;
}

export function validateCandidate(value,{allowRepositoryMetadata=false}={}) {
  const errors=[], warnings=[], candidate={details:{}};
  const collect=(field,resolve,apply)=>{
    try { apply(resolve()); } catch (error) { errors.push({field,message:error.message}); }
  };
  collect('json',()=>{
    shape(value,allowRepositoryMetadata?[...root,'stars']:root);
    checkSecrets(value);
    if (Object.hasOwn(value,'stars')) warnings.push('Ignored imported GitHub stars. Analyze the repository to retrieve current GitHub metadata.');
    if (utf8(JSON.stringify(value))>maxJson) fail('Submission JSON must be under 96 KiB.');
    if (value.details!==undefined) shape(value.details,detail);
  },()=>{});
  if (errors.length) return {errors,warnings};
  const get=(key,fn)=>collect(key,()=>fn(value[key]),result=>{candidate[key]=result;});
  get('id',v=>slug(v,'listing ID'));
  get('name',v=>fieldText(v,'name',120));
  get('description',v=>fieldText(v,'description',1200));
  get('category',v=>fieldText(v,'category',100));
  get('author',v=>fieldText(v,'maintainer',160));
  get('github_url',canonicalRepository);
  if (value.tags!==undefined) get('tags',v=>array(v,50,item=>fieldText(item,'tag',100)));
  const rules={
    summary:v=>fieldText(v,'overview',1200,false),
    documentationUrl:v=>submissionUrl(v,'documentation URL',false),
    documentationUrls:v=>array(v,12,item=>submissionUrl(item,'documentation URL')),
    transport:v=>v==='unknown'?'unknown':mode(v),
    transports:v=>unique(array(v,3,mode),v=>v),
    installations:v=>array(v,20,install),
    endpoints:v=>unique(array(v,20,endpoint),v=>v.transport+' '+v.url),
    tools:v=>unique(array(v,80,item=>{
      shape(item,['name','description']);
      return {name:fieldText(item.name,'tool name',100),description:fieldText(item.description,'tool description',500,false)};
    }),v=>v.name.toLowerCase()),
    prerequisites:v=>array(v,30,item=>fieldText(item,'prerequisite',500)),
    security:v=>array(v,30,item=>fieldText(item,'security consideration',500)),
    pricing:v=>fieldText(v,'pricing',800,false),
    serviceDependencies:v=>array(v,20,item=>fieldText(item,'service dependency',500)),
    implementationKey:v=>{
      const key=slug(v,'implementation key',false);
      return fieldText(key,'implementation key',100,false);
    },
  };
  for(const [key,raw] of Object.entries(value.details??{})) {
    collect(key,()=>rules[key](raw),result=>{candidate.details[key]=result;});
  }
  if (errors.length) return {errors,warnings};
  const d=candidate.details;
  const docs=[...(d.documentationUrl?[d.documentationUrl]:[]),...(d.documentationUrls??[])];
  if (new Set(docs).size!==docs.length) {
    errors.push({field:'documentationUrls',message:'Remove repeated documentation URLs, including the primary URL.'});
  }
  const primary=d.transport && d.transport!=='unknown'?d.transport:undefined;
  const modes=new Set([...(primary?[primary]:[]),...(d.transports??[])]);
  if (d.transports!==undefined || d.transport!==undefined) {
    d.transports=[...modes];
    d.transport=d.transports[0]??'unknown';
  }
  if (modes.size && (resolveTransport(d).modes.some(transport=>!modes.has(transport))||d.endpoints?.some(e=>!modes.has(e.transport)))) {
    errors.push({field:'transports',message:'Include the transports used by the supplied endpoints and configurations.'});
  }
  try { assertPublicationReady({...candidate,tags_json:JSON.stringify(candidate.tags??[]),details_json:JSON.stringify(d)}); }
  catch (error) {
    if (!error.issues) errors.push({field:'installations',message:error.message});
    else for (const issue of error.issues) {
      const suppliedInstallation=d.installations?.length&&issue.field==='endpoints';
      if (suppliedInstallation) errors.push(issue);
      else warnings.push(issue.message);
    }
  }
  warnings.push(...securityHints(JSON.stringify(candidate)));
  return {candidate,errors,warnings:[...new Set(warnings)]};
}

export function importCandidate(raw) {
  const input=parseCandidateJson(raw);
  if (!object(input) || !Object.hasOwn(input,'schemaVersion')) return validateCandidate(input,{allowRepositoryMetadata:true});
  return {...validateCandidate(adaptManifest(input)),derivedIdentity:true};
}

export function adaptManifest(input,expectedRepository) {
  const result=validateManifest(input,expectedRepository);
  if (!result.valid) fail(result.errors.join(' · '));
  const github_url=canonicalRepository(input.repository);
  const {repo,owner}=parseRepository(github_url);
  const details={summary:input.description,documentationUrl:github_url+'#readme',transport:input.transport,
    tools:input.tools??[],prerequisites:input.prerequisites??[],security:input.permissions??[]};
  const entry=input.installation;
  if (entry) {
    const spec=entry.command?{command:entry.command,args:entry.args}:{url:entry.endpoint,
      ...(transports.includes(input.transport)?{type:input.transport}:{})};
    details.installations=[{title:entry.command?'Local command':'Remote endpoint',client:'Generic MCP client',
      config:{mcpServers:{[repo]:spec}},...(entry.env?{environment:entry.env}:{})}];
    if (entry.endpoint&&['http','sse'].includes(input.transport)) details.endpoints=[{transport:input.transport,url:entry.endpoint}];
  }
  return {id:repositoryId(github_url),name:input.name,description:input.description,category:input.category,author:owner,github_url,tags:[],details};
}
export { manifestFields };
