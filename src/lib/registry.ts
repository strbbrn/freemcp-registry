import type legacyRegistry from '../data/registry.json';

export type RegistryServer = (typeof legacyRegistry)[number];

// Each MCP server is maintained independently; Astro/Vite bundles these JSON records at build time.
const modules = import.meta.glob<{ default: RegistryServer }>('../data/servers/*.json', { eager: true });
const registry: RegistryServer[] = Object.values(modules).map(module => module.default);
const originalOrder = ["sqlite-mcp","github-mcp","filesystem-mcp","brave-search-mcp","shodan-mcp","nmap-mcp","postgres-mcp","docker-mcp","semgrep-mcp","slack-mcp","puppeteer-mcp","aws-kb-mcp","sequential-thinking-mcp","memory-mcp","fetch-mcp","notion-mcp","linear-mcp","gitlab-mcp","sentry-mcp","google-maps-mcp","remotify-mcp"];
registry.sort((a,b) => { const ai = originalOrder.indexOf(a.id); const bi = originalOrder.indexOf(b.id); return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi) || a.id.localeCompare(b.id); });

export function getServers(): RegistryServer[] { return registry; }
export function getServer(id: string): RegistryServer | undefined { return registry.find(server => server.id === id); }
export function getCategories(): string[] { return [...new Set(registry.map(server => server.category))].sort(); }
export function validateRegistry(): string[] {
 const errors:string[]=[];const ids=new Set<string>();
 registry.forEach((s,index)=>{const prefix='Entry '+(index+1);if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.id))errors.push(prefix+': invalid ID');if(ids.has(s.id))errors.push(prefix+': duplicate ID '+s.id);ids.add(s.id);if(!s.name.trim()||!s.description.trim()||!s.category.trim()||!s.author.trim())errors.push(prefix+': missing required text');try{const u=new URL(s.githubUrl);if(u.protocol!=='https:'||u.hostname!=='github.com')errors.push(prefix+': invalid GitHub URL')}catch{errors.push(prefix+': malformed GitHub URL')}if(!Array.isArray(s.tags)||!s.tags.every(tag=>typeof tag==='string'))errors.push(prefix+': invalid tags');if(!Number.isFinite(s.stars)||s.stars<0)errors.push(prefix+': invalid stars')});return errors;
}
