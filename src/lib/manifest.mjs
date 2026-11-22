import schema from '../../schemas/freemcp-v1.schema.json' with { type: 'json' };
import { parseRepository, secretPattern } from './submission.mjs';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validString = (value,max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const keysAllowed = (obj,allowed) => Object.keys(obj).every(key=>allowed.includes(key));
const categories = schema.properties.category.enum;
const transports = schema.properties.transport.enum;

export function validateManifest(value, expectedRepository) {
 const errors=[];
 const fail = message => errors.push(message);
 if(!record(value)) return {valid:false,errors:['Manifest must be a JSON object']};
 if(!keysAllowed(value,Object.keys(schema.properties))) fail('Unknown manifest fields');
 for(const key of schema.required) if(!(key in value)) fail('Missing '+key);
 if(value.schemaVersion!==1) fail('Unsupported schemaVersion');
 if(!validString(value.name,120)) fail('Invalid name');
 if(!validString(value.description,1200)) fail('Invalid description');
 if(!categories.includes(value.category)) fail('Invalid category');
 if(!transports.includes(value.transport)) fail('Invalid transport');
 let canonical='';
 try { const parsed=parseRepository(value.repository);canonical=parsed.url.origin+'/'+parsed.owner+'/'+parsed.repo; }
 catch { fail('Invalid repository URL'); }
 if(expectedRepository){
  try { const parsed=parseRepository(expectedRepository);if(canonical.toLowerCase()!==(parsed.url.origin+'/'+parsed.owner+'/'+parsed.repo).toLowerCase())fail('Repository does not match analyzed project'); }
  catch { fail('Invalid expected repository'); }
 }
 if(value.tools!==undefined){
  if(!Array.isArray(value.tools)||value.tools.length>50)fail('Invalid tools');
  else for(const tool of value.tools)if(!record(tool)||!keysAllowed(tool,['name','description'])||!validString(tool.name,100)||!validString(tool.description,500))fail('Invalid tool definition');
 }
 if(value.prerequisites!==undefined&&(!Array.isArray(value.prerequisites)||value.prerequisites.length>30||!value.prerequisites.every(p=>validString(p,200))))fail('Invalid prerequisites');
 if(value.permissions!==undefined&&(!Array.isArray(value.permissions)||value.permissions.length>30||!value.permissions.every(p=>validString(p,200))))fail('Invalid permissions');
 if(value.installation!==undefined){
  const x=value.installation;
  if(!record(x)||!keysAllowed(x,['command','args','endpoint','env']))fail('Invalid installation');
  else{
   const hasCommand='command' in x,hasEndpoint='endpoint' in x;
   if(hasCommand===hasEndpoint)fail('Installation must contain exactly one of command or endpoint');
   if(hasCommand){
    if(!validString(x.command,200)||!Array.isArray(x.args)||x.args.length>20||!x.args.every(a=>typeof a==='string'&&a.length<=300))fail('Invalid command or args');
    if(value.transport==='http'||value.transport==='sse')fail('Remote transport requires endpoint installation');
   }
   if(hasEndpoint){
    try{const u=new URL(x.endpoint);if(u.protocol!=='https:'||u.username||u.password||x.endpoint.length>2048||/\s/.test(x.endpoint))throw Error();}catch{fail('Invalid HTTPS endpoint');}
    if(value.transport==='stdio')fail('stdio transport requires command installation');
   }
   if(x.env!==undefined){
    if(!record(x.env)||Object.keys(x.env).length>30)fail('Invalid env definitions');
    else for(const [key,def] of Object.entries(x.env)){
     if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)||!record(def)||!keysAllowed(def,['required','secret','description'])||typeof def.required!=='boolean'||typeof def.secret!=='boolean'||!validString(def.description,200))fail('Invalid env definition: '+key);
    }
   }
  }
 }
 // This is a heuristic, not comprehensive secret detection.
 if(secretPattern.test(JSON.stringify(value)))fail('Possible credential or private key detected');
 return {valid:errors.length===0,errors};
}
