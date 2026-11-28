import { localEndpoint, transportAlias } from './admin/transport.js';
import { checkSecrets, object, url } from './admin/validation.js';
import { invalid } from './admin/http.js';

export function structuredConfig(value) {
  if (!object(value)) invalid('Each installation needs a configuration object.');
  checkSecrets(value);
  const specs=[value];
  for (const group of [value.mcpServers, value.servers]) {
    if (group === undefined) continue;
    if (!object(group)) invalid('Invalid MCP server configuration.');
    specs.push(...Object.values(group));
  }
  for (const spec of specs) {
    if (!object(spec)) invalid('Invalid MCP server configuration entry.');
    if (spec.localEndpoint!==undefined && (!localEndpoint(spec.localEndpoint)||!['http','sse'].includes(transportAlias(spec.transport??spec.type)))) {
      invalid('Local MCP endpoint must use loopback HTTP, an explicit port, and HTTP or SSE transport.');
    }
    if (spec.url !== undefined) url(spec.url, 'MCP endpoint');
    if (spec.endpoint !== undefined) url(spec.endpoint, 'MCP endpoint');
    if (spec.command !== undefined &&
      (typeof spec.command !== 'string' || !/^[a-zA-Z0-9_.+\/-]{1,200}$/.test(spec.command))) invalid('Use a single executable for an installation command.');
    if (spec.args !== undefined && (!Array.isArray(spec.args) || spec.args.length > 30 ||
      !spec.args.every(arg => typeof arg === 'string' && arg.length <= 300))) invalid('Enter valid installation arguments.');
  }
  return value;
}
