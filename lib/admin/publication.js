import { installationSpecs, localEndpoint, resolveTransport, transportAlias } from './transport.js';
import { AdminError, invalid } from './http.js';
import { checkSecrets, object, parsed, text, url } from './validation.js';

export const evidenceFields = ['tools','prerequisites','security'];
export function formPublicationExceptions(data) {
  if (data.publicationExceptions!==undefined) return data.publicationExceptions;
  const supplied=evidenceFields.filter(key=>Object.hasOwn(data,'exception_'+key));
  if (!supplied.length) return undefined;
  return Object.fromEntries(supplied.filter(key=>data['exception_'+key]!=='').map(key=>[key,data['exception_'+key]]));
}

export function publicationExceptions(value) {
  const input = parsed(value ?? {},'Publication exceptions');
  if (!object(input) || Object.keys(input).some(key=>!evidenceFields.includes(key))) invalid('Exceptions may cover only tools, prerequisites or security guidance.');
  return Object.fromEntries(Object.entries(input).map(([key,why])=>[key,text(why,key+' exception reason',300)]));
}

export function assertPublicationReady(row, rawExceptions) {
  const details = JSON.parse(row.details_json);
  const exceptions = publicationExceptions(rawExceptions ?? details.review?.exceptions);
  checkSecrets({name:row.name,description:row.description,category:row.category,author:row.author,
    github_url:row.github_url,tags:JSON.parse(row.tags_json),details});
  const issues=[];
  const finding=(field,message)=>issues.push({field,message});
  if (!details.documentationUrl) finding('documentationUrl','provide a maintainer documentation URL');
  else url(details.documentationUrl,'documentation URL');
  const {modes}=resolveTransport(details);
  if (!modes.length) finding('transport','select a documented transport');
  const installs = Array.isArray(details.installations) ? details.installations : [];
  const specs = installs.filter(item=>item?.title && object(item.config)).flatMap(item=>
    installationSpecs(item.config).map(spec=>({...spec,transport:spec.transport??spec.type??item.transport})));
  const endpoints = Array.isArray(details.endpoints) ? details.endpoints : [];
  const endpointKey = endpoint => {
    const normalized=new URL(url(endpoint,'MCP endpoint'));
    return normalized.origin+normalized.pathname.replace(/\/+$/,'')+normalized.search;
  };
  const remoteModes=modes.filter(mode=>mode!=='stdio');
  const configEndpoints=specs.filter(spec=>spec.url||spec.endpoint).map(spec=>({
    mode:transportAlias(spec.transport)??(spec.transport==null&&remoteModes.length===1?remoteModes[0]:null),
    key:endpointKey(spec.url??spec.endpoint),
  }));
  const validCommand = spec => typeof spec.command==='string' && /^[a-zA-Z0-9_.+\/-]{1,200}$/.test(spec.command) &&
    (spec.args===undefined || Array.isArray(spec.args)&&spec.args.length<=30&&spec.args.every(arg=>typeof arg==='string'&&arg.length<=300));
  if (!modes.length || modes.some(mode=>mode==='stdio'?!specs.some(spec=>validCommand(spec)&&!spec.localEndpoint&&(!spec.transport||transportAlias(spec.transport)==='stdio'))
    :!configEndpoints.some(endpoint=>endpoint.mode===mode)&&!specs.some(spec=>
      transportAlias(spec.transport)===mode&&localEndpoint(spec.localEndpoint)&&validCommand(spec)))) {
    finding('installations','provide an installation configuration for every selected transport');
  }
  if (endpoints.length) {
    const advertised=endpoints.map(item=>({mode:transportAlias(item?.transport??item?.type),key:endpointKey(item?.url)}));
    if (advertised.some(item=>!configEndpoints.some(config=>item.mode && config.mode===item.mode && config.key===item.key))) {
      finding('endpoints','match each listed MCP endpoint to a documented installation');
    }
  }
  for (const key of evidenceFields) {
    const entries = details[key];
    const valid = Array.isArray(entries) && entries.length && entries.every(item=>key==='tools'
      ? typeof item?.name==='string' && item.name.trim() && typeof item?.description==='string' && item.description.trim()
      : typeof item==='string' && item.trim());
    if (!valid && !exceptions[key]) finding(key,'document '+key+' or record a reviewed exception');
  }
  if (issues.length) {
    const error=new AdminError(400,'Publication readiness: '+issues.map(issue=>issue.message).join(', ')+'.');
    error.issues=issues;
    throw error;
  }
  return exceptions;
}
