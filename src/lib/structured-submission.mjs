import { issueBodyLimit, parseCandidateJson, validateCandidate } from './submission-candidate.mjs';
import { implementationRepository, issueContent } from './submission.mjs';

export const issueCreationUrl='https://github.com/strbbrn/freemcp-registry/issues/new';
// Leave headroom beneath an 8 KiB request-target limit used by common proxies.
export const prefillUrlLimit=7000;
const marker='<!-- freemcp:submission';
const open=marker+':v1 -->';
const close='<!-- /freemcp:submission -->';
const heading='## MCP server submission\n';
const block='### Structured listing (v1)\n';
const encode = value => JSON.stringify(value).replace(/[<>`]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
const plain = value => value.replace(/[\r\n\t]+/g,' ').replace(/[<>&]/g,char=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[char]))
  .replace(/[\[\]()!*_`|\\]/g,'\\$&');
const previewFields = candidate => {
  const d=candidate.details;
  return {
    repository:candidate.github_url,name:plain(candidate.name),category:plain(candidate.category),description:plain(candidate.description),
    transport:d.transport??d.transports?.[0]??'unknown',docs:d.documentationUrl,
    installation:d.installations?.length?d.installations.length+' configuration(s) in the structured listing.':'',
    tools:d.tools?.length?d.tools.length+' documented tool(s) in the structured listing.':'',
    prerequisites:d.prerequisites?.length?d.prerequisites.length+' prerequisite(s) in the structured listing.':'',
    permissions:d.security?.length?d.security.length+' security consideration(s) in the structured listing.':'',
  };
};
export const hasStructuredSubmission = body => typeof body==='string'&&(
  body.includes(marker) || body.includes('<!-- /freemcp:submission') || /^### Structured listing\b/m.test(body));

export class IssueBodyTooLargeError extends Error {
  constructor() {
    super('The GitHub issue body is too large. Download the complete JSON to keep a copy, then shorten the submission before previewing it again.');
  }
}

export function composeSubmission(input, evidence) {
  const {candidate,errors,warnings}=validateCandidate(input);
  if (errors.length) throw new Error(errors[0].message);
  const fields=previewFields(candidate);
  const title='[MCP Submission] '+candidate.name.replace(/[\r\n\t]+/g,' ');
  const branch=evidence?.branch;
  const repository=implementationRepository(candidate.github_url);
  const source=typeof branch==='string'&&/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(branch)
    ? '\n\n### Analyzed source (unverified)\n'+(repository.path?repository.url:
      repository.root+'/tree/'+branch.split('/').map(encodeURIComponent).join('/'))
    :'';

  const flags=Array.isArray(evidence?.flags)?evidence.flags.filter(flag=>typeof flag==='string'&&/^[\w .;,-]{1,155}$/.test(flag)).slice(0,12):[];
  const body=issueContent(fields,[...new Set([...warnings,...flags])])+source+'\n\n'+block+'\n'+open+'\n```json\n'+
    encode(candidate)+'\n```\n'+close;
  if (body.length>issueBodyLimit) throw new IssueBodyTooLargeError();
  const url=issueCreationUrl+'?'+new URLSearchParams({title,body});
  return {title,body,url:url.length<=prefillUrlLimit?url:null};
}

export function readStructuredSubmission(body) {
  if (!hasStructuredSubmission(body)) return null;
  const error = message => ({error:message});
  if (body.length>issueBodyLimit) return error('Structured submission exceeds the supported GitHub issue body limit.');
  const lines=body.replace(/\r\n/g,'\n').split('\n');
  const start=lines.indexOf(open), end=lines.indexOf(close);
  if (!lines.join('\n').startsWith(heading)||start<1||end!==start+4||lines[start+1]!=='```json'||lines[end-1]!=='```'||
      lines.filter(line=>line.includes(marker)||line.includes('<!-- /freemcp:submission')).length!==2||
      lines.filter(line=>/^### Structured listing\b/.test(line)).length!==1||
      lines.slice(end+1).some(line=>line.trim())) {
    return error('Structured listing delimiters or version are missing, ambiguous or unsupported.');
  }
  try {
    const {candidate,errors,warnings}=validateCandidate(parseCandidateJson(lines[start+2]));
    if (errors.length) return error('Structured listing is invalid. Check '+errors.map(item=>item.field).join(', ')+'.');
    const fields=previewFields(candidate);
    const expected={Repository:fields.repository,Name:fields.name,Category:fields.category,Description:fields.description,
      Transport:fields.transport,Documentation:fields.docs||'Not supplied',
      'Installation evidence / instructions':fields.installation||'Not supplied',
      'Documented tools':fields.tools||'Not supplied','Setup prerequisites':fields.prerequisites||'Not supplied',
      'Permissions / security considerations':fields.permissions||'Not supplied'};
    const visible=lines.slice(0,start-1).join('\n');
    for (const [key,value] of Object.entries(expected)) {
      const occurrences=[...visible.matchAll(new RegExp('^### '+key+'\\n([^\\n]*)','gm'))];
      if (occurrences.length!==1||occurrences[0][1]!==value) return error('Structured listing conflicts with or repeats the '+key+' heading.');
    }
    return {candidate,fields:expected,warnings};
  } catch {
    return error('Structured listing contains malformed or ambiguous JSON.');
  }
}
