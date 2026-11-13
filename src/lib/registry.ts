import registry from '../data/registry.json';
export type RegistryServer = (typeof registry)[number];
export function getServers(): RegistryServer[] { return registry; }
export function getServer(id: string): RegistryServer | undefined { return registry.find(server => server.id === id); }
export function getCategories(): string[] { return [...new Set(registry.map(server => server.category))].sort(); }
export function validateRegistry(): string[] {
 const errors:string[]=[];const ids=new Set<string>();
 registry.forEach((s,index)=>{const prefix='Entry '+(index+1);if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.id))errors.push(prefix+': invalid ID');if(ids.has(s.id))errors.push(prefix+': duplicate ID '+s.id);ids.add(s.id);if(!s.name.trim()||!s.description.trim()||!s.category.trim()||!s.author.trim())errors.push(prefix+': missing required text');try{const u=new URL(s.githubUrl);if(u.protocol!=='https:'||u.hostname!=='github.com')errors.push(prefix+': invalid GitHub URL')}catch{errors.push(prefix+': malformed GitHub URL')}if(!Array.isArray(s.tags)||!s.tags.every(tag=>typeof tag==='string'))errors.push(prefix+': invalid tags');if(!Number.isFinite(s.stars)||s.stars<0)errors.push(prefix+': invalid stars')});return errors;
}
