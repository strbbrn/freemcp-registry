import {parseRepository,secretPattern,securityHints,validateDocumentationUrl} from './submission.mjs';

const sectionNames=['Repository','Name','Category','Description','Transport','Documentation','Installation evidence / instructions','Permissions / security considerations'];
const enrichmentSections=['Documented tools','Setup prerequisites'];
const categories=['Development','Database','Security','Search','Productivity','Communication','Cloud','Utilities','Other'];
const transports=['stdio','http','sse','unknown'];
export function parseSubmissionIssue(body){
 if(typeof body!=='string'||body.length>65000||!body.startsWith('## MCP server submission\n'))return null;
 const sections=new Map();
 for(const match of body.matchAll(/^### ([^\n]+)\n([\s\S]*?)(?=\n### |$(?![\s\S]))/gm)){
  if(sections.has(match[1]))return null;
  sections.set(match[1],match[2].trim());
 }
 if(!sectionNames.every(key=>sections.has(key)))return null;
 return Object.fromEntries([...sectionNames,...enrichmentSections].map(key=>[key,sections.get(key)||'Not supplied']));
}
export function reviewSubmission(body,existing=[]){
 const fields=parseSubmissionIssue(body);
 if(!fields)return {recognized:false,passed:false,findings:['Submission format not recognized']};
 const findings=[],warnings=[];
 let canonical='';
 try{
  const parsed=parseRepository(fields.Repository);
  canonical=(parsed.owner+'/'+parsed.repo).toLowerCase();
 }catch{findings.push('Invalid GitHub repository URL');}
 if(!fields.Name||fields.Name.length>120)findings.push('Invalid server name');
 if(!fields.Description||fields.Description.length>1200)findings.push('Invalid description');
 if(!categories.includes(fields.Category))findings.push('Invalid category');
 if(!transports.includes(fields.Transport))findings.push('Invalid transport');
 if(fields.Documentation!=='Not supplied')try{validateDocumentationUrl(fields.Documentation);}catch{findings.push('Invalid documentation URL');}
 const submitted=[fields.Name,fields.Description,fields['Installation evidence / instructions'],fields['Permissions / security considerations'],fields['Documented tools'],fields['Setup prerequisites']].join('\n');
 const tools=fields['Documented tools']==='Not supplied'?[]:fields['Documented tools'].split('\n').filter(Boolean);
 if(tools.length>50||tools.some(line=>{const i=line.indexOf('|');return i<1||!line.slice(0,i).trim()||!line.slice(i+1).trim()||line.slice(0,i).trim().length>100||line.slice(i+1).trim().length>500;}))findings.push('Invalid documented tools format');
 const prerequisites=fields['Setup prerequisites']==='Not supplied'?[]:fields['Setup prerequisites'].split('\n').filter(Boolean);
 if(prerequisites.length>30||prerequisites.some(x=>x.trim().length===0||x.length>200))findings.push('Invalid setup prerequisites');
 if(secretPattern.test(body))findings.push('Possible credential or private key detected; redact issue immediately');
 warnings.push(...securityHints(submitted));
 if(canonical){
  const duplicates=existing.filter(s=>{
   try{const p=parseRepository(s.githubUrl||s.repository||'');return (p.owner+'/'+p.repo).toLowerCase()===canonical;}catch{return false;}
  });
  if(duplicates.length)findings.push('Possible duplicate repository in checked registry snapshot: '+duplicates.map(s=>s.id||s.name).join(', '));
 }
 if(fields['Installation evidence / instructions']==='Not supplied')warnings.push('Installation evidence not supplied');
 warnings.push('D1 duplicate check, ownership, licensing and MCP compatibility require maintainer verification');
 return {recognized:true,passed:findings.length===0,findings,warnings,repository:fields.Repository};
}
export function formatReview(result){
 const heading='### FreeMCP automated submission triage\n\n';
 if(!result.recognized)return heading+'Submission format not recognized; maintainer review required.\n\n_No automatic publication or approval._';
 const status=result.passed?'Preliminary format checks passed':'Manual action required';
 const lines=[heading+'**'+status+'**','',...result.findings.map(x=>'- ❌ '+x),...result.warnings.map(x=>'- ⚠️ '+x),'','**Maintainer checklist:** Verify repository ownership, license, actual MCP functionality, installation instructions, security and duplicates against live D1 before approval.','','_Automated heuristics are not a security certification. No automatic publication or approval._'];
 return lines.join('\n');
}

export function parseLegacySubmissionIssue(body){
 if(typeof body!=='string'||body.length>65000||!body.startsWith('## Server Details\n'))return null;
 const field=label=>body.match(new RegExp('\\*\\*'+label+':\\*\\*\\s*([^\\n]+)','i'))?.[1]?.trim()||'';
 const Name=field('Server Name'),Repository=field('GitHub Repository URL'),Description=field('Short Description'),Category=field('Category');
 if(!Name||!Repository||!Description||!Category)return null;
 const evidence=body.split('## Additional Context')[1]||'';
 const Transport=/\bstdio\b/i.test(body)?'stdio':/streamable.http|https?:\/\/[^\s]+\/mcp/i.test(body)?'http':'unknown';
 return {Name,Repository,Description,Category,Transport,'Installation evidence / instructions':evidence};
}
