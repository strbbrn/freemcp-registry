import {parseRepository} from './submission.mjs';
import {validateManifest} from './manifest.mjs';

export function sqlQuote(value){return "'"+String(value).replaceAll("'","''")+"'";}
export function prepareRegistration(manifest,issueNumber,existingIds=[]){
 const check=validateManifest(manifest,manifest?.repository);
 if(!check.valid)throw new Error('Invalid manifest: '+check.errors.join('; '));
 if(!Number.isSafeInteger(issueNumber)||issueNumber<1)throw new Error('Invalid issue number');
 const {owner,repo}=parseRepository(manifest.repository);
 const id=(owner+'-'+repo).toLowerCase().replace(/[^a-z0-9-]/g,'-').slice(0,100);
 if(existingIds.includes(id))throw new Error('Server ID already exists: '+id);
 if(!manifest.installation)throw new Error('Installation instructions required for registration');
 const installation=manifest.installation;
 const config=installation.command?{mcpServers:{[repo]:{command:installation.command,args:installation.args||[]}}}:{mcpServers:{[repo]:{type:manifest.transport,url:installation.endpoint}}};
 const details={summary:manifest.description,documentationUrl:manifest.repository+'#readme',security:manifest.permissions||[],installations:[{title:installation.command?'Local command':'Remote endpoint',client:'Generic MCP client',config,notes:'Submitted configuration; maintainer must verify before publication.'}],review:{issue:issueNumber,status:'pending-publication',source:'approved-submission'}};
 const values=[id,manifest.name,manifest.description,manifest.category,owner,JSON.stringify([]),manifest.repository,JSON.stringify(details)];
 const sql='-- REVIEW REQUIRED: generated candidate only; do not execute without separate approval.\n'+
  '-- Source GitHub issue #'+issueNumber+'; verify duplicate repository and ID against live D1.\n'+
  'INSERT INTO servers (id,name,description,category,author,tags_json,github_url,details_json)\nSELECT '+values.map(sqlQuote).join(', ')+'\nWHERE NOT EXISTS (SELECT 1 FROM servers WHERE lower(github_url) = '+sqlQuote(manifest.repository.toLowerCase())+');\n';
 return {id,sql,details};
}
