import { invalid } from './http.js';
import { checkSecrets, object, parsed, text, url } from './validation.js';

export const evidenceFields = ['tools','prerequisites','security'];
export function publicationExceptions(value) {
  const input = parsed(value ?? {},'Publication exceptions');
  if (!object(input) || Object.keys(input).some(key=>!evidenceFields.includes(key))) invalid('Exceptions may cover only tools, prerequisites or security guidance.');
  return Object.fromEntries(Object.entries(input).map(([key,why])=>[key,text(why,key+' exception reason',300)]));
}

function installationSpecs(config) {
  return [config, ...Object.values(config?.mcpServers || {}), ...Object.values(config?.servers || {})].filter(object);
}

export function assertPublicationReady(row, rawExceptions) {
  const details = JSON.parse(row.details_json);
  const exceptions = publicationExceptions(rawExceptions ?? details.review?.exceptions);
  checkSecrets({name:row.name,description:row.description,category:row.category,author:row.author,
    github_url:row.github_url,tags:JSON.parse(row.tags_json),details});
  const errors = [];
  if (!details.documentationUrl) errors.push('provide a maintainer documentation URL');
  else url(details.documentationUrl,'documentation URL');
  const mode = details.transport;
  if (!['stdio','http','sse'].includes(mode)) errors.push('select a documented transport');
  const installs = Array.isArray(details.installations) ? details.installations : [];
  const specs = installs.filter(item=>item?.title && object(item.config)).flatMap(item=>installationSpecs(item.config));
  const endpoints = Array.isArray(details.endpoints) ? details.endpoints : [];
  const endpointKey = endpoint => {
    const normalized=new URL(url(endpoint,'MCP endpoint'));
    return normalized.origin+normalized.pathname.replace(/\/+$/,'')+normalized.search;
  };
  const configEndpoints = specs.filter(spec=>spec.url || spec.endpoint).map(spec=>({
    mode:spec.type ?? spec.transport ?? mode,key:endpointKey(spec.url ?? spec.endpoint),
  }));
  const validCommand = spec => typeof spec.command==='string' && /^[a-zA-Z0-9_.+\/-]{1,200}$/.test(spec.command) &&
    (spec.args===undefined || Array.isArray(spec.args)&&spec.args.length<=30&&spec.args.every(arg=>typeof arg==='string'&&arg.length<=300));
  const configMatches = mode==='stdio' ? specs.some(validCommand) : configEndpoints.some(endpoint=>endpoint.mode===mode);
  if (!configMatches) errors.push('provide an installation configuration for the selected transport');
  if (['http','sse'].includes(mode) && endpoints.length) {
    const advertised=endpoints.map(item=>({mode:item?.transport,key:endpointKey(item?.url)}));
    if (advertised.some(item=>!configEndpoints.some(config=>config.mode===item.mode && config.key===item.key))) {
      errors.push('match each listed MCP endpoint to a documented installation');
    }
  }
  for (const key of evidenceFields) {
    const entries = details[key];
    const valid = Array.isArray(entries) && entries.length && entries.every(item=>key==='tools'
      ? typeof item?.name==='string' && item.name.trim() && typeof item?.description==='string' && item.description.trim()
      : typeof item==='string' && item.trim());
    if (!valid && !exceptions[key]) errors.push('document '+key+' or record a reviewed exception');
  }
  if (errors.length) invalid('Publication readiness: '+errors.join(', ')+'.');
  return exceptions;
}
