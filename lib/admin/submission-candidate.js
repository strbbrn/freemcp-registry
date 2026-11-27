import { escapeHtml as escape, safeHttps } from '../seo.js';
import { object, parsed } from './validation.js';
import { transportAlias, transportTokens } from './transport.js';
import { invalid } from './http.js';

const supplied = value => typeof value==='string'&&value.trim()&&!/^not supplied$/i.test(value.trim())?value.trim():'';
export function evidenceLinks(value) {
  return [...new Set((supplied(value).match(/https:\/\/[^\s<>"')\x60]+/gi)??[])
    .map(link=>safeHttps(link.replace(/[.,;]+$/,''))).filter(Boolean))].slice(0,12);
}
function paragraphs(value) {
  const result=[];
  for (const paragraph of supplied(value).split(/\n+/)) {
    let line=paragraph.trim().replace(/^[-*]\s+/,'');
    while(line.length>500) {
      const space=line.lastIndexOf(' ',500);
      const end=space>0?space:500;
      result.push(line.slice(0,end));
      line=line.slice(end).trim();
    }
    if (line) result.push(line);
  }
  return result.slice(0,30);
}
function toolsFromEvidence(value) {
  const tools=new Map();
  for (const line of supplied(value).split('\n')) {
    const entry=line.trim().replace(/^[-*]\s+/,'');
    const index=entry.indexOf('|');
    const names=index>0?[entry.slice(0,index)]:entry.split(',');
    for(const raw of names) {
      const name=raw.trim().replace(/^[*\x60\s]+|[*\x60.\s]+$/g,'');
      if (/^[\w.-]{1,100}$/.test(name) && !tools.has(name)) {
        tools.set(name,{name,description:index>0?entry.slice(index+1).trim().slice(0,500):''});
      }
    }
  }
  return [...tools.values()].slice(0,80);
}
export function normalizedSubmission(fields) {
  const repository=evidenceLinks(fields.Repository)[0]??'';
  const [owner,repo]=repository?new URL(repository).pathname.split('/').filter(Boolean):[];
  const modes=[...new Set(transportTokens(fields.Transport).map(transportAlias).filter(Boolean))];
  const docs=evidenceLinks(fields.Documentation);
  const installations=[];
  // Use only a single explicitly code-formatted command with simple, literal arguments.
  const instructions=supplied(fields['Installation evidence / instructions']);
  const commands=[...instructions.matchAll(/\x60([^\x60\n]+)\x60/g)].map(match=>match[1].trim()).filter(line=>/^[-\w./+]+(?: +[-\w./@+=:]+)+$/.test(line));
  if (modes.includes('stdio')&&commands.length===1&&repo) {
    const [command,...args]=commands[0].split(/ +/);
    installations.push({title:'Local stdio',client:'Generic MCP client',config:{mcpServers:{[repo]:{command,args}}}});
  }
  return {id:owner&&repo?(owner+'-'+repo).toLowerCase().replace(/[^a-z0-9-]/g,'-').slice(0,100):'',
    name:supplied(fields.Name),description:supplied(fields.Description),category:supplied(fields.Category),author:owner??'',github_url:repository,tags:[],
    details:{summary:supplied(fields.Description),documentationUrl:docs[0]??'',documentationUrls:docs,
      ...(modes.length?{transport:modes[0],transports:modes}:{}),installations,tools:toolsFromEvidence(fields['Documented tools']),
      prerequisites:paragraphs(fields['Setup prerequisites']),security:paragraphs(fields['Permissions / security considerations'])}};
}
export function formCandidate(data) {
  const candidate=data.useAdvanced==='yes'?parsed(data.candidateJson,'Advanced candidate JSON'):data.candidate??data;
  if (!object(candidate)) invalid('Candidate must be a JSON object.');
  return candidate;
}

function inline(markdown) {
  return markdown.split(/(\x60[^\x60\n]+\x60|\[[^\]\n]+\]\([^\s)]+\)|\*\*[^*\n]+\*\*|(?<!\w)\*[^*\n]+\*)/).map(part=>{
    if (part.startsWith('\x60')&&part.endsWith('\x60')&&part.length>2) return '<code>'+escape(part.slice(1,-1))+'</code>';
    const link=part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const href=safeHttps(link[2]);
      return href?'<a href="'+escape(href)+'" rel="noopener noreferrer">'+escape(link[1])+'</a>':escape(link[1]);
    }
    if (part.startsWith('**')&&part.endsWith('**')&&part.length>4) return '<strong>'+escape(part.slice(2,-2))+'</strong>';
    if (part.startsWith('*')&&part.endsWith('*')&&part.length>2) return '<em>'+escape(part.slice(1,-1))+'</em>';
    return escape(part);
  }).join('');
}
export function evidenceMarkdown(value) {
  return String(value??'').split(/^\x60{3}[^\n]*\n|^\x60{3}\s*$/m).map((block,index)=>{
    if(index%2) return '<pre><code>'+escape(block.trimEnd())+'</code></pre>';
    return block.trim().split(/\n\s*\n/).filter(Boolean).map(group=>{
      const lines=group.split('\n');
      if (lines.every(line=>/^\s*[-*] /.test(line))) {
        return '<ul>'+lines.map(line=>'<li>'+inline(line.replace(/^\s*[-*] /,''))+'</li>').join('')+'</ul>';
      }
      return '<p>'+lines.map(line=>inline(line.replace(/^#{1,6}\s+/,''))).join('<br>')+'</p>';
    }).join('');
  }).join('');
}
