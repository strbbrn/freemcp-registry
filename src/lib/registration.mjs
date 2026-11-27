import {parseRepository} from './submission.mjs';
import {validateManifest} from './manifest.mjs';

export function sqlQuote(value){return "'"+String(value).replaceAll("'","''")+"'";}
export function registrationCandidate(manifest,issueNumber){
 const check=validateManifest(manifest,manifest?.repository);
 if(!check.valid)throw new Error('Invalid manifest: '+check.errors.join('; '));
 if(issueNumber!==undefined&&(!Number.isSafeInteger(issueNumber)||issueNumber<1))throw new Error('Invalid issue number');
 const {owner,repo}=parseRepository(manifest.repository);
 const id=(owner+'-'+repo).toLowerCase().replace(/[^a-z0-9-]/g,'-').slice(0,100);
 if(!manifest.installation)throw new Error('Installation instructions required for registration');
 const installation=manifest.installation;
 const config=installation.command?{mcpServers:{[repo]:{command:installation.command,args:installation.args||[]}}}:{mcpServers:{[repo]:{type:manifest.transport,url:installation.endpoint}}};
 const details={summary:manifest.description,documentationUrl:manifest.repository+'#readme',security:manifest.permissions||[],tools:manifest.tools||[],prerequisites:manifest.prerequisites||[],installations:[{title:installation.command?'Local command':'Remote endpoint',client:'Generic MCP client',config,...(installation.env?{environment:installation.env}:{}),notes:'Submitted configuration; maintainer must verify before publication.'}],review:{status:'pending-publication',...(issueNumber===undefined?{}:{issue:issueNumber,source:'approved-submission'})}};
 return {id,name:manifest.name,description:manifest.description,category:manifest.category,author:owner,tags:[],github_url:manifest.repository,details:{...details,transport:manifest.transport,...(installation.endpoint?{endpoints:[{transport:manifest.transport,url:installation.endpoint}]}:{})}};
}
export function prepareRegistration(manifest,issueNumber,existingIds=[]){
 if(!Number.isSafeInteger(issueNumber)||issueNumber<1)throw new Error('Invalid issue number');
 const {id,details,author}=registrationCandidate(manifest,issueNumber);
 if(existingIds.includes(id))throw new Error('Server ID already exists: '+id);
 const values=[id,manifest.name,manifest.description,manifest.category,author,JSON.stringify([]),manifest.repository,JSON.stringify(details)];
 const sql='-- REVIEW REQUIRED: generated candidate only; do not execute without separate approval.\n'+
  '-- Source GitHub issue #'+issueNumber+'; verify duplicate repository and ID against live D1.\n'+
  'INSERT INTO servers (id,name,description,category,author,tags_json,github_url,details_json)\nSELECT '+values.map(sqlQuote).join(', ')+'\nWHERE NOT EXISTS (SELECT 1 FROM servers WHERE lower(github_url) = '+sqlQuote(manifest.repository.toLowerCase())+');\n';
 return {id,sql,details};
}

export function manifestFromSubmission(fields, installation) {
 const {command,endpoint,args=[]}=installation;
 if(Boolean(command)===Boolean(endpoint))throw Error('Provide exactly one installation command or HTTPS endpoint');
 if(command&&!/^[A-Za-z0-9_.+\/-]{1,200}$/.test(command))throw Error('Use a single executable for an installation command');
 if(!Array.isArray(args)||args.length>20||args.some(a=>typeof a!=='string'||a.length>300))throw Error('Invalid installation args');
 if(endpoint&&args.length)throw Error('Endpoint cannot have command arguments');
 const evidence=fields['Installation evidence / instructions']||'';
 const expected=command?[command,...args].join(' '):endpoint;
 if(!evidence||evidence==='Not supplied'||!evidence.includes(expected))throw Error('Installation configuration must match submitted evidence');
 const transport=fields.Transport;
 if(command&&transport!=='stdio')throw Error('Command installation requires explicitly documented stdio transport');
 if(endpoint&&!['http','sse'].includes(transport))throw Error('Endpoint requires explicitly documented http or sse transport');
 const lines=key=>fields[key]&&fields[key]!=='Not supplied'?fields[key].split('\n').map(line=>line.trim()).filter(Boolean):[];
 const tools=lines('Documented tools').map(line=>{
  const i=line.indexOf('|');
  if(i<1)throw Error('Invalid documented tool entry');
  return {name:line.slice(0,i).trim(),description:line.slice(i+1).trim()};
 });
 return {schemaVersion:1,name:fields.Name,description:fields.Description,repository:fields.Repository,category:fields.Category,
  transport,installation:command?{command,args}:{endpoint},tools,prerequisites:lines('Setup prerequisites'),permissions:lines('Permissions / security considerations')};
}
