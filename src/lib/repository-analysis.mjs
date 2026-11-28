import { adaptManifest, repositoryId, validateCandidate, parseCandidateJson } from './submission-candidate.mjs';
import { implementationRepository, readmeHeadings, securityHints, secretPattern } from './submission.mjs';

function validBranch(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(value)&&!value.includes('..')&&!value.includes('//')&&
    !value.endsWith('/')&&!value.endsWith('.lock');
}

async function githubDocument(path,max,signal,raw=false,fetcher=fetch) {
  const response=await fetcher('https://api.github.com'+path,{signal,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',
    headers:{Accept:raw?'application/vnd.github.raw+json':'application/vnd.github+json'}});
  if (response.status===404) return null;
  if (response.status===429||(response.status===403&&(response.headers.has('retry-after')||response.headers.get('x-ratelimit-remaining')==='0'))) {
    throw new Error('GitHub API rate limit reached. Retry later or continue manually.');
  }
  if (!response.ok) throw new Error('GitHub returned HTTP '+response.status+'.');
  const reader=response.body?.getReader();
  if (!reader) throw new Error('GitHub returned an empty response.');
  let result='', total=0;
  const decoder=new TextDecoder();
  for (;;) {
    const {done,value}=await reader.read();
    if (done) break;
    total+=value.byteLength;
    if (total>max) {
      await reader.cancel();
      throw new Error('GitHub response exceeds the supported size.');
    }
    result+=decoder.decode(value,{stream:true});
  }
  return result+decoder.decode();
}

export async function analyzeRepository(repository,requestedBranch,{signal,fetcher=fetch}={}) {
  const {owner,repo,root,url:github_url,path:implementation}=implementationRepository(repository);
  const starsFor=metadata=>Number.isSafeInteger(metadata.stargazers_count)&&metadata.stargazers_count>=0?metadata.stargazers_count:undefined;
  if (requestedBranch&&!validBranch(requestedBranch)) throw new Error('Enter a valid Git branch name.');
  const path='/repos/'+encodeURIComponent(owner)+'/'+encodeURIComponent(repo);
  const raw=await githubDocument(path,64000,signal,false,fetcher);
  if (!raw) throw new Error('Repository not found or not public.');
  let metadata;
  try { metadata=JSON.parse(raw); } catch { throw new Error('GitHub returned invalid repository metadata.'); }
  if (metadata.private||typeof metadata.name!=='string') throw new Error('Enter a public GitHub repository.');
  const branch=requestedBranch||metadata.default_branch;
  if (!validBranch(branch??'')) throw new Error('GitHub did not return a supported branch name.');
  const ref='?ref='+encodeURIComponent(branch);
  const flags=[],notes=[];
  if (metadata.archived) flags.push('GitHub marks this repository archived.');
  if (metadata.disabled) flags.push('GitHub marks this repository disabled.');
  if (metadata.fork) flags.push('This is a fork. Identify the implementation and its maintainer.');
  if (!metadata.license?.spdx_id||metadata.license.spdx_id==='NOASSERTION') flags.push('License is missing or not machine-readable.');
  if (Date.now()-Date.parse(metadata.pushed_at)>365*86400000) flags.push('No repository push detected in over one year.');
  if (metadata.open_issues_count>100) flags.push('High open issue count. Review maintenance context.');
  const safe=(value,max)=>typeof value==='string'&&value.trim().length<=max&&!secretPattern.test(value)?value.trim():'';
  const repositoryStatus=metadata.disabled?'Disabled':metadata.archived?'Archived':'Active';
  const derived={id:repositoryId(github_url),author:owner,github_url};
  if (implementation) {
    // Root files may describe another MCP server in this repository.
    notes.push('GitHub metadata is for the repository. Add documentation and configuration for this implementation.');
    return {fields:{...derived,details:{documentationUrl:github_url}},sourceUrl:github_url,
      origin:'GitHub metadata',branch,flags,notes,stars:starsFor(metadata),repositoryStatus};
  }
  let fields={...derived,name:safe(metadata.name,120),description:safe(metadata.description,1200),
    details:{documentationUrl:github_url+'#readme'}};
  let origin='GitHub metadata';
  const [manifest,readme]=await Promise.allSettled([
    githubDocument(path+'/contents/freemcp.json'+ref,30000,signal,true,fetcher),
    githubDocument(path+'/readme'+ref,120000,signal,true,fetcher),
  ]);
  if (signal?.aborted) throw signal.reason;
  if (manifest.status==='fulfilled'&&manifest.value) {
    try {
      const validation=validateCandidate(adaptManifest(parseCandidateJson(manifest.value),root));
      if (validation.errors.length) throw new Error('Invalid manifest.');
      fields=validation.candidate;
      origin='freemcp.json v1';
    } catch {
      notes.push('The root freemcp.json was rejected. Review it at the source or enter the details manually.');
    }
  } else if (manifest.status==='rejected') {
    notes.push(manifest.reason.message.includes('rate limit')?'GitHub rate-limited the manifest request.':'The manifest could not be read.');
  } else notes.push('No root freemcp.json found.');
  if (readme.status==='fulfilled'&&readme.value) {
    const headings=readmeHeadings(readme.value).filter(line=>!secretPattern.test(line));
    if (headings.length) notes.push('README sections: '+headings.join(', ')+'.');
    flags.push(...securityHints(readme.value));
    if (!fields.description) fields.description=readme.value.split(/\r?\n\r?\n/)
      .map(value=>safe(value,500)).find(value=>value.length>=40&&!/[#<>`\[\]]|https?:/.test(value))??'';
  } else if (readme.status==='rejected') notes.push('README hints are unavailable.');
  return {fields,origin,branch,flags:[...new Set(flags)],notes,stars:starsFor(metadata),repositoryStatus,
    sourceUrl:root+'/tree/'+branch.split('/').map(encodeURIComponent).join('/')};
}
