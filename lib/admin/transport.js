export const transports = ['stdio','http','sse'];
export const transportLabels = {stdio:'Local stdio',http:'Streamable HTTP',sse:'HTTP + SSE'};
const list = value => Array.isArray(value) ? value : value == null ? [] : [value];
export function transportAlias(value) {
  if (typeof value !== 'string') return null;
  const key=value.trim().toLowerCase().replace(/[^a-z0-9]/g,'');
  if (['stdio','localstdio','standardio','standardinputoutput'].includes(key)) return 'stdio';
  if (['http','streamablehttp','httpstreamable','remotehttp'].includes(key)) return 'http';
  if (['sse','httpsse','ssehttp','serversentevents','legacysse'].includes(key)) return 'sse';
  return null;
}
export function transportTokens(value) {
  return list(value).flatMap(item=>typeof item==='string'&&!transportAlias(item)
    ?item.split(/[,|;\n]|\s+(?:and|or|\/)\s+/i).map(part=>part.trim()).filter(Boolean):[item]);
}
export function installationSpecs(config) {
  if (!config || typeof config!=='object' || Array.isArray(config)) return [];
  return [config,...[config.mcpServers,config.servers].flatMap(group=>group&&typeof group==='object'&&!Array.isArray(group)?Object.values(group):[])]
    .filter(value=>value&&typeof value==='object'&&!Array.isArray(value));
}
// Loopback installation examples are private to each operator. They are not
// shared endpoints and are never fetched by FreeMCP.
export const localEndpoint = value => typeof value==='string' &&
  /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):[1-9]\d{0,4}\/[a-zA-Z0-9_./~-]*$/.test(value) &&
  Number(value.match(/:(\d+)\//)?.[1])<=65535;

export function resolveTransport(details={}) {
  const declared=[...transportTokens(details.transport),...transportTokens(details.transports)];
  const selected=declared.map(transportAlias).filter(Boolean);
  const unsupported=declared.filter(value=>!transportAlias(value)&&!['','unknown','unspecified'].includes(String(value).toLowerCase()));
  const found=new Set(selected);
  let structured=false, ambiguous=false;
  for(const installation of list(details.installations)) {
    for(const spec of installationSpecs(installation?.config)) {
      const label=spec.transport??spec.type??installation?.transport;
      const mode=transportAlias(label);
      const url=spec.url??spec.endpoint;
      if ((mode==='stdio'||label==null)&&typeof spec.command==='string'&&spec.command.trim()&&!url) {found.add('stdio');structured=true;}
      if ((mode==='http'||mode==='sse')&&((typeof url==='string'&&url.trim()&&!spec.command)||localEndpoint(spec.localEndpoint))) {found.add(mode);structured=true;}
      else if (url && !mode) ambiguous=true;
      if (label && !mode && (url||spec.command)) unsupported.push(label);
    }
  }
  for(const endpoint of list(details.endpoints)) {
    const label=endpoint?.transport??endpoint?.type;
    const mode=transportAlias(label);
    if ((mode==='http'||mode==='sse')&&endpoint.url) {found.add(mode);structured=true;}
    else if(endpoint?.url) ambiguous=true;
    if (label&&!mode) unsupported.push(label);
  }
  return {modes:[...found],unsupported:[...new Set(unsupported.map(String))],ambiguous,structured,declared:selected.length>0};
}
