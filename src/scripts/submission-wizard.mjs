import { canonicalRepository, repositoryId, importCandidate, parseCandidateJson, validateCandidate, manifestFields } from '../lib/submission-candidate.mjs';
import { implementationRepository } from '../lib/submission.mjs';
import { composeSubmission, issueCreationUrl } from '../lib/structured-submission.mjs';
import { analyzeRepository } from '../lib/repository-analysis.mjs';
import { renderListing } from '../../lib/listing-renderer.js';
import { installationSpecs, transportLabels } from '../../lib/admin/transport.js';

const identity=[
  ['id','Listing ID'],['name','Server name'],['description','Description',true],
  ['category','Category'],['author','Maintainer'],
];
const details=[
  ['summary','Overview',true],['documentationUrl','Primary documentation URL'],
  ['pricing','Pricing',true],['implementationKey','Implementation key'],
];
const collections=[
  ['tags','Tags','tag'],['documentationUrls','Additional documentation URLs','documentation URL'],
  ['transports','Supported transports','transport'],['installations','Installation configurations','installation'],
  ['endpoints','MCP endpoints','endpoint'],['tools','Documented tools','tool'],
  ['prerequisites','Prerequisites','prerequisite'],['security','Security considerations','security consideration'],
  ['serviceDependencies','Service dependencies','service dependency'],
];
const collectionLimits={tags:50,documentationUrls:12,transports:3,installations:20,endpoints:20,tools:80,prerequisites:30,security:30,serviceDependencies:20};
const modes=Object.entries(transportLabels);

function element(tag,text) {
  const node=document.createElement(tag);
  if (text!==undefined) node.textContent=text;
  return node;
}
function button(label,handler,accessibleName=label) {
  const node=element('button',label);
  node.type='button';
  node.setAttribute('aria-label',accessibleName);
  node.addEventListener('click',handler);
  return node;
}
function control(labelText,value,onChange,{field,multiline=false,choices}={}) {
  const label=element('label',labelText);
  const input=element(choices?'select':multiline?'textarea':'input');
  if (multiline) input.rows=4;
  if (choices) {
    for (const [key,title] of choices) {
      const option=element('option',title);
      option.value=key;
      input.add(option);
    }
  }
  input.value=value??'';
  if (field) {
    input.dataset.field=field;
    input.setAttribute('aria-label',labelText);
  }
  input.addEventListener('input',()=>onChange(input.value,label));
  label.append(input);
  return label;
}

export function initSubmissionWizard(form) {
  const $=selector=>form.querySelector(selector);
  const repo=form.elements.repository, branch=form.elements.branch;
  const steps=[...form.querySelectorAll('[data-step]')];
  const progress=[...form.parentElement.querySelectorAll('.wizard-steps li')];
  const fields=$('#structured-fields'), json=$('#listing-json');
  let frame=$('#listing-preview');
  const viewport=frame.parentElement;
  const analysisOutput=$('#analyze-status'), applyAnalysis=$('#apply-analysis'), sourceLink=$('#analysis-source');
  const rawConfigs=new Map(), provenance=new Map();
  const derivedIdentity=['id','author'];
  const changedNotice=$('#repository-change');
  let draft={category:'Development',details:{}};
  let stage=0, mode='structured', analysis, analysisAbort, fileRead=0;
  let previewIssue, confirmedIssue=null, duplicateRequest=0, branchRepository;
  form.hidden=false;

  function findIssues(errors,warnings=[]) {
    const alert=$('#wizard-errors'), notices=$('#wizard-warnings');
    alert.replaceChildren();
    notices.replaceChildren();
    alert.hidden=!errors.length;
    notices.hidden=!warnings.length;
    if (errors.length) {
      const list=element('ul');
      for (const {field,message} of errors) {
        const item=element('li'), link=element('a',message);
        link.href='#step-details';
        link.addEventListener('click',event=>{
          event.preventDefault();
          const target=field==='github_url'||(field==='json'&&stage===0)?0:field==='confirm'?3:1;
          showStep(target);
          const input=field==='github_url'?repo:target===0?$('#import-json'):target===3?form.elements.confirm:
            mode==='json'?json:[...fields.querySelectorAll('[data-field]')].find(input=>input.dataset.field===field);
          if (input) {
            for (let parent=input.parentElement; parent&&parent!==form; parent=parent.parentElement) {
              if (parent.tagName==='DETAILS') parent.open=true;
            }
            input.focus();
          }
        });
        item.append(link);
        list.append(item);
      }
      alert.append(list);
      alert.focus();
    }
    if (warnings.length) {
      const list=element('ul');
      for (const warning of warnings) list.append(element('li',warning));
      notices.append(element('strong','Review warnings'),list);
    }
  }
  function showStep(next) {
    stage=next;
    steps.forEach((step,index)=>{step.hidden=index!==next;});
    progress.forEach((item,index)=>{
      if(index===next) item.setAttribute('aria-current','step');
      else item.removeAttribute('aria-current');
    });
    steps[next].querySelector('h2').focus();
  }
  function changed(key,label) {
    provenance.set(key,{kind:'manual'});
    label?.querySelector('small')?.remove();
    label?.querySelector('[aria-describedby]')?.removeAttribute('aria-describedby');
    form.elements.confirm.checked=false;
    previewIssue=undefined;
    duplicateRequest++;
  }
  const badge=(label,key)=>{
    const source=provenance.get(key)?.source;
    if(source) {
      const origin=element('small','Imported from '+source);
      origin.id='wizard-origin-'+key;
      label.querySelector('[data-field]').setAttribute('aria-describedby',origin.id);
      label.append(origin);
    }
    return label;
  };
  function drawFields() {
    const basics=element('div'); basics.className='wizard-grid';
    for(const [key,label,multiline] of identity) {
      const choices=key==='category'?[...new Set([...manifestFields.categories,draft.category].filter(Boolean))].map(v=>[v,v]):undefined;
      basics.append(badge(control(label,draft[key],(v,node)=>{draft[key]=v;changed(key,node);},{field:key,multiline,choices}),key));
    }
    fields.replaceChildren(basics);
    for(const [key,label,multiline] of details) {
      fields.append(badge(control(label,draft.details[key],(v,node)=>{draft.details[key]=v;changed(key,node);},{field:key,multiline}),key));
    }
    fields.append(badge(control('Primary transport',draft.details.transport??'unknown',(v,node)=>{
      draft.details.transport=v;changed('transport',node);
    },{field:'transport',choices:[['unknown','Not specified'],...modes]}),'transport'));
    for(const [key,label,singular] of collections) drawCollection(key,label,singular);
  }
  function drawCollection(key,label,singular) {
    const group=element('details');
    group.className='wizard-disclosure';
    group.dataset.collection=key;
    const items=draft[key]??draft.details[key]??[];
    const isRoot=key==='tags';
    const summary=element('summary',label+' ('+items.length+')');
    summary.dataset.field=key;
    group.append(summary);
    const source=provenance.get(key)?.source;
    if(source) group.append(element('small','Imported from '+source));
    const replace=(list,focusIndex,action)=>{
      (isRoot?draft:draft.details)[key]=list;
      changed(key,group);
      const newGroup=drawCollection(key,label,singular);
      group.replaceWith(newGroup);
      newGroup.open=true;
      const fieldset=newGroup.querySelectorAll('fieldset')[focusIndex];
      const focus=action?fieldset?.querySelector('[data-action="'+action+'"]:not([disabled])'):fieldset?.querySelector('input,select,textarea');
      (focus??fieldset?.querySelector('input,select,textarea')??newGroup.querySelector('[data-add]'))?.focus();
    };
    const template={installations:()=>({title:'',config:{}}),endpoints:()=>({transport:'http',url:''}),tools:()=>({name:'',description:''})};
    items.forEach((item,index)=>{
      const card=element('fieldset'); card.className='wizard-record';
      const number=index+1;
      card.append(element('legend',singular[0].toUpperCase()+singular.slice(1)+' '+number));
      const edit=(prop,newValue)=>{item[prop]=newValue;changed(key,group);};
      if(key==='tools') {
        card.append(control('Tool name',item.name,v=>edit('name',v)),control('Tool description',item.description,v=>edit('description',v),{multiline:true}));
      } else if(key==='installations') {
        for(const [prop,title] of [['title','Installation title'],['client','Client'],['os','Operating system'],['notes','Instructions and notes']]) {
          card.append(control(title,item[prop],v=>edit(prop,v),{multiline:prop==='notes'}));
        }
        card.append(control('Installation transport (optional)',item.transport,v=>{
          if(v) edit('transport',v);
          else {delete item.transport;changed(key,group);}
        },{choices:[['','Use the configuration’s transport'],...modes]}));
        card.append(control('MCP client configuration (JSON)',rawConfigs.get(item)??JSON.stringify(item.config,null,2),v=>{
          rawConfigs.set(item,v);
          changed(key,group);
        },{multiline:true}));
        if (item.environment) card.append(element('small','Imported v1 environment declarations are retained. Edit them under Advanced JSON.'));
      } else if(key==='endpoints') {
        card.append(control('Endpoint transport',item.transport,v=>edit('transport',v),{choices:modes.filter(([name])=>name!=='stdio')}),
          control('HTTPS endpoint URL',item.url,v=>edit('url',v)));
      } else {
        const title=singular[0].toUpperCase()+singular.slice(1);
        card.append(control(title,item,v=>{items[index]=v;changed(key,group);},{choices:key==='transports'?modes:undefined}));
      }
      const actions=element('div'); actions.className='wizard-actions';
      const move=(offset,action)=>{
        const copy=[...items];
        [copy[index],copy[index+offset]]=[copy[index+offset],copy[index]];
        replace(copy,index+offset,action);
      };
      const up=button('Move up',()=>move(-1,'up'),'Move '+singular+' '+number+' up');
      up.dataset.action='up'; up.disabled=index===0;
      const down=button('Move down',()=>move(1,'down'),'Move '+singular+' '+number+' down');
      down.dataset.action='down'; down.disabled=index===items.length-1;
      actions.append(up,down,button('Remove',()=>{
        rawConfigs.delete(item); replace(items.filter((_,i)=>i!==index),Math.min(index,items.length-2));
      },'Remove '+singular+' '+number));
      card.append(actions); group.append(card);
    });
    const add=button('Add '+singular,()=>replace([...items,template[key]?.()??(key==='transports'?'stdio':'')],items.length));
    add.dataset.add='';
    add.disabled=items.length>=collectionLimits[key];
    group.append(add);
    if(!fields.querySelector('[data-collection="'+key+'"]')) fields.append(group);
    return group;
  }

  function synchronizeStructured() {
    for(const item of draft.details.installations??[]) {
      if(rawConfigs.has(item)) {
        try {item.config=parseCandidateJson(rawConfigs.get(item));}
        catch {return [{field:'installations',message:'Correct the invalid MCP client configuration JSON.'}];}
      }
    }
    return [];
  }
  const fieldKeys=document=>[...Object.keys(document).filter(key=>!['details','github_url'].includes(key)),...Object.keys(document.details)];
  const getField=(document,key)=>Object.hasOwn(document,key)?document[key]:document.details[key];
  const clearField=(document,key)=>{delete document[key]; delete document.details[key];};
  const repositoryKey=value=>{
    const {root,path}=implementationRepository(value);
    return root.toLowerCase()+path;
  };
  function applyRepository(document,origins) {
    const next=document.github_url, previous=draft.github_url;
    const different=previous&&repositoryKey(previous)!==repositoryKey(next);
    if(different) {
      const retained=fieldKeys(document).filter(key=>{
        const kind=origins.get(key)?.kind;
        return kind==='manual'||(kind==='imported'&&derivedIdentity.includes(key));
      });
      if(retained.length&&!window.confirm('Change repository? Untouched imported fields will be cleared. Keep the custom identity and manually edited fields for the new repository? Review them before submitting.')) return false;
      for(const [key,{kind}] of origins) {
        if(kind!=='imported'||derivedIdentity.includes(key)) continue;
        if(key==='installations') for(const item of document.details.installations??[]) rawConfigs.delete(item);
        clearField(document,key);
        origins.delete(key);
      }
      for(const key of retained) origins.set(key,{kind:'manual'});
      cancelAnalysis();
      if(branchRepository!==repositoryKey(next)) branch.value='';
      $('#import-json').value='';
      $('#import-file').value='';
      ++fileRead;
      changedNotice.textContent=retained.length?'Repository changed. Untouched imports from the previous repository were cleared. Review the custom identity and edited fields you kept.':
        'Repository changed. Derived identity was refreshed and untouched imports from the previous repository were cleared.';
    }
    const {owner}=implementationRepository(next);
    for(const [key,value] of [['id',repositoryId(next)],['author',owner]]) {
      if(!document[key]||origins.get(key)?.kind==='derived') {
        document[key]=value;
        origins.set(key,{kind:'derived'});
      }
    }
    draft=document;
    if(origins!==provenance) {
      provenance.clear();
      for(const [key,origin] of origins) provenance.set(key,origin);
    }
    repo.value=next;
    return true;
  }
  function commitRepositoryInput() {
    const next=canonicalRepository(repo.value);
    if(applyRepository({...draft,details:{...draft.details},github_url:next},new Map(provenance))) return true;
    repo.value=draft.github_url;
    changedNotice.textContent='Repository change cancelled. The draft still uses the original repository.';
    return false;
  }
  function commitJson(document) {
    const origins=new Map(provenance);
    for(const key of new Set([...fieldKeys(draft),...fieldKeys(document)])) {
      if(JSON.stringify(getField(draft,key))!==JSON.stringify(getField(document,key))) origins.set(key,{kind:'manual'});
    }
    if(!applyRepository(document,origins)) return false;
    rawConfigs.clear();
    json.value=JSON.stringify(draft,null,2);
    return true;
  }

  function validated() {
    if(mode==='json') {
      try { return validateCandidate(parseCandidateJson(json.value),{allowRepositoryMetadata:true}); }
      catch(error){return {errors:[{field:'json',message:error.message}]};}
    }
    const errors=synchronizeStructured();
    return errors.length?{errors}:validateCandidate(draft);
  }
  function setMode(next) {
    mode=next;
    fields.hidden=next==='json';
    $('#advanced-fields').hidden=next!=='json';
    for(const node of form.querySelectorAll('[data-mode]')) node.setAttribute('aria-pressed',String(node.dataset.mode===next));
  }
  for(const node of form.querySelectorAll('[data-mode]')) node.addEventListener('click',()=>{
    if(node.dataset.mode===mode) return;
    if(mode==='structured') {
      const errors=synchronizeStructured();
      if(errors.length) {findIssues(errors);return;}
      json.value=JSON.stringify(draft,null,2);
      setMode('json');
      json.focus();
    } else {
      const result=validated();
      if(result.errors.length) {
        if(!window.confirm('The JSON has validation errors. Discard those edits and return to the structured editor?')) {findIssues(result.errors);return;}
      } else {
        if(!commitJson(result.candidate)) return;
        setMode('structured');drawFields();findIssues([],result.warnings);
        return;
      }
      setMode('structured'); drawFields();
    }
    findIssues([]);
  });
  json.addEventListener('input',()=>changed('json'));

  function cancelAnalysis() {
    analysisAbort?.abort();
    analysisAbort=null; analysis=null;
    applyAnalysis.hidden=true; sourceLink.hidden=true;
    $('#analyze-repo').disabled=false;
    analysisOutput.textContent='';
  }
  repo.addEventListener('input',()=>{
    cancelAnalysis();
    changed('github_url');
    changedNotice.textContent=draft.github_url?'Changing repository refreshes derived identity and clears untouched imports. You’ll confirm whether to keep any edited fields.':'';
  });
  branch.addEventListener('input',()=>{
    try {branchRepository=repositoryKey(repo.value);}
    catch {branchRepository=undefined;}
    cancelAnalysis();
  });
  $('#analyze-repo').addEventListener('click',async()=>{
    try {if(!commitRepositoryInput()) return;}
    catch(error) {findIssues([{field:'github_url',message:error.message}]);return;}
    cancelAnalysis();
    const pending=new AbortController();
    analysisAbort=pending;
    const timeout=setTimeout(()=>pending.abort(),12000);
    $('#analyze-repo').disabled=true;
    analysisOutput.textContent='Reading public GitHub metadata…';
    try {
      const result=await analyzeRepository(repo.value,branch.value.trim(),{signal:pending.signal});
      if(analysisAbort!==pending||pending.signal.aborted) return;
      analysis=result;
      applyAnalysis.hidden=false;
      sourceLink.href=result.sourceUrl;
      sourceLink.hidden=false;
      analysisOutput.textContent=[result.origin+' on '+result.branch+'.',...result.notes,...result.flags].join(' ');
    } catch(error) {
      if(analysisAbort===pending) analysisOutput.textContent=pending.signal.aborted?'GitHub took too long. Retry or continue manually.':
        error instanceof TypeError?'Could not reach GitHub. Continue manually or retry.':error.message;
    } finally {
      clearTimeout(timeout);
      if(analysisAbort===pending) $('#analyze-repo').disabled=false;
    }
  });
  applyAnalysis.addEventListener('click',()=>{
    if(!analysis) return;
    const {details:importedDetails,...base}=analysis.fields;
    for(const [target,values] of [[draft,base],[draft.details,importedDetails]]) {
      for(const [key,value] of Object.entries(values)) {
        const kind=provenance.get(key)?.kind;
        if(key==='github_url'||derivedIdentity.includes(key)||kind==='manual'||value===''||
            (kind!=='imported'&&target[key]!==undefined&&target[key]!==''&&!(key==='category'&&target[key]==='Development'))) continue;
        target[key]=value; provenance.set(key,{kind:'imported',source:analysis.origin});
      }
    }
    analysisOutput.textContent='Imported untouched fields. Confirm the source details before submitting.';
    applyAnalysis.hidden=true;
  });
  $('#import-json').addEventListener('input',()=>{fileRead++;});
  $('#import-file').addEventListener('change',async event=>{
    const file=event.target.files[0], generation=++fileRead;
    if(!file) return;
    if(file.size>96*1024){findIssues([{field:'json',message:'Upload a JSON file under 96 KiB.'}]);return;}
    try {
      const value=await file.text();
      if(generation===fileRead) $('#import-json').value=value;
    } catch {if(generation===fileRead)findIssues([{field:'json',message:'Could not read the selected file.'}]);}
  });
  $('#apply-import').addEventListener('click',()=>{
    try {
      const result=importCandidate($('#import-json').value);
      if(result.errors.length){findIssues(result.errors);return;}
      if((Object.keys(draft).length>2||Object.keys(draft.details).length||json.value)&&!window.confirm('Replace the current listing with the imported JSON?')) return;
      cancelAnalysis(); rawConfigs.clear(); provenance.clear();
      ++fileRead;
      changedNotice.textContent='';
      branch.value='';branchRepository=undefined;
      draft=result.candidate;
      repo.value=draft.github_url; json.value=''; $('#import-json').value=''; $('#import-file').value='';
      for(const key of fieldKeys(draft)) {
        provenance.set(key,result.derivedIdentity&&derivedIdentity.includes(key)?{kind:'derived'}:{kind:'imported',source:'JSON'});
      }
      setMode('structured'); drawFields(); showStep(1);findIssues([],result.warnings);
    } catch(error) {findIssues([{field:'json',message:error.message}]);}
  });

  function sizePreview() {
    if (stage!==2) return;
    const available=viewport.clientWidth;
    const desktop=frame.dataset.device==='desktop';
    const width=desktop?Math.max(860,available):Math.min(390,available);
    const scale=width?Math.min(1,available/width):1;
    frame.style.width=width+'px';
    frame.style.height=viewport.clientHeight/scale+'px';
    frame.style.transform=scale<1?'scale('+scale+')':'';
  }
  function setDevice(device) {
    frame.dataset.device=device;
    for(const node of form.querySelectorAll('[data-frame]')) node.setAttribute('aria-pressed',String(node.dataset.frame===device));
    sizePreview();
  }
  setDevice(matchMedia('(max-width:650px)').matches?'mobile':'desktop');
  new ResizeObserver(sizePreview).observe(viewport);
  function showPreview(candidate) {
    const verified=analysis?.fields.github_url.toLowerCase()===candidate.github_url.toLowerCase()?analysis:undefined;
    // A fresh opaque document avoids retaining focus or scroll from the old draft.
    const next=frame.cloneNode(false);
    next.srcdoc=renderListing({...candidate,tags:candidate.tags??[],stars:verified?.stars,repositoryStatus:verified?.repositoryStatus},
      {submissionPreview:true,theme:document.documentElement.dataset.theme});
    frame.replaceWith(next);
    frame=next;
    sizePreview();
  }
  new MutationObserver(()=>{
    if(stage===2) {
      const result=validated();
      if(!result.errors.length) showPreview(result.candidate);
    }
  }).observe(document.documentElement,{attributeFilter:['data-theme']});
  for(const toggle of form.querySelectorAll('[data-frame]')) toggle.addEventListener('click',()=>setDevice(toggle.dataset.frame));
  function prepareIssue(candidate) {
    return composeSubmission(candidate,analysis?.fields.github_url===candidate.github_url?analysis:undefined);
  }
  function showReview(issue) {
    confirmedIssue=issue;
    $('#handoff-note').textContent=issue.url?'GitHub will open with a prefilled title and body. Review it and submit there.':
      'This issue is too large to prefill. Copy the title and complete body, then open GitHub and paste them.';
    $('#manual-copy').hidden=true;
    form.elements.confirm.checked=false;
  }
  for(const next of form.querySelectorAll('[data-next]')) next.addEventListener('click',()=>{
    if(stage===0) {
      try {
        if(!commitRepositoryInput()) return;
      } catch(error){findIssues([{field:'github_url',message:error.message}]);return;}
      drawFields(); showStep(1); findIssues([]); return;
    }
    let result=validated();
    if(result.errors.length){findIssues(result.errors);return;}
    if(stage===1&&mode==='json') {
      const {warnings}=result;
      if(!commitJson(result.candidate)) return;
      result=validated();
      result.warnings=[...new Set([...warnings,...(result.warnings??[])])];
      if(result.errors.length){findIssues(result.errors,result.warnings);return;}
    }
    if(stage===1) {
      try {previewIssue=prepareIssue(result.candidate);}
      catch(error) {findIssues([{field:'json',message:error.message}],result.warnings);return;}
      showPreview(result.candidate);
      $('#duplicate-status').textContent='Optional check sends the repository, implementation key and endpoint URLs to FreeMCP.';
      showStep(2);
      sizePreview();
    } else {
      showReview(previewIssue);
      showStep(3);
    }
    findIssues([],result.warnings);
  });
  for(const back of form.querySelectorAll('[data-back]')) back.addEventListener('click',()=>{
    if(stage===1&&mode==='json') {
      const result=validated();
      if(result.errors.length) {
        findIssues(result.errors);
        return;
      }
      if(!commitJson(result.candidate)) return;
      setMode('structured');drawFields();
    }
    showStep(stage-1);findIssues([]);
  });
  $('#check-duplicates').addEventListener('click',async()=>{
    const result=validated();
    if(result.errors.length){findIssues(result.errors);return;}
    const {github_url,details:d}=result.candidate;
    const urls=new Set((d.endpoints??[]).map(item=>item.url));
    for(const item of d.installations??[]) for(const spec of installationSpecs(item.config)) {
      if(spec.url||spec.endpoint) urls.add(spec.url??spec.endpoint);
    }
    const request=++duplicateRequest, status=$('#duplicate-status');
    status.textContent='Checking published listings…';
    try {
      const response=await fetch('/api/submission-duplicates',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({repository:github_url,implementationKey:d.implementationKey??'',endpoints:[...urls]}),referrerPolicy:'no-referrer'});
      if(!response.ok) throw Error();
      const {match}=await response.json();
      if(typeof match!=='boolean') throw Error();
      if(request===duplicateRequest) status.textContent=match?'Possible duplicate found in published listings. Explain the difference in the GitHub issue.':
        'No duplicate found in published listings. Maintainers will check again during review.';
    } catch {if(request===duplicateRequest) status.textContent='Duplicate check unavailable. You can still submit for review.';}
  });
  const copy=async value=>{
    try {await navigator.clipboard.writeText(value);$('#handoff-note').textContent='Copied. Review and submit the issue on GitHub.';}
    catch {const fallback=$('#manual-copy');fallback.hidden=false;const area=fallback.querySelector('textarea');area.value=value;area.focus();area.select();}
  };
  $('#copy-title').addEventListener('click',()=>copy(confirmedIssue.title));
  $('#copy-body').addEventListener('click',()=>copy(confirmedIssue.body));
  for(const node of form.querySelectorAll('[data-download]')) node.addEventListener('click',()=>{
    const result=validated();
    if(result.errors.length){findIssues(result.errors);return;}
    const markdown=node.dataset.download==='markdown';
    const output=markdown?confirmedIssue?.body:JSON.stringify(result.candidate,null,2);
    if(!output)return;
    const blob=URL.createObjectURL(new Blob([output],{type:markdown?'text/markdown':'application/json'}));
    const link=element('a');link.href=blob;link.download=markdown?'freemcp-submission.md':'freemcp-candidate.json';
    link.click();setTimeout(()=>URL.revokeObjectURL(blob),1000);
  });
  form.addEventListener('submit',event=>{
    event.preventDefault();
    if(stage!==3||!confirmedIssue)return;
    if(!form.elements.confirm.checked){findIssues([{field:'confirm',message:'Confirm permission and credential removal before opening GitHub.'}]);form.elements.confirm.focus();return;}
    const target=confirmedIssue.url??issueCreationUrl;
    window.open(target,'_blank','noopener,noreferrer');
    const note=$('#handoff-note'),link=element('a','Open GitHub issue creation');
    link.href=target;link.target='_blank';link.rel='noopener noreferrer';
    note.replaceChildren(confirmedIssue.url?'Review and submit on GitHub. ':'Paste the copied title and complete issue body on GitHub. ',link);
  });
}
