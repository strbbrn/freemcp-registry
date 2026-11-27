const theme = document.getElementById('theme-toggle');
if (theme) {
  const apply = preference => {
    document.documentElement.dataset.theme = preference;
    theme.setAttribute('aria-pressed', String(preference === 'light'));
  };
  try { apply(localStorage.getItem('freemcp-theme') === 'light' ? 'light' : 'dark'); } catch {}
  theme.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    apply(next);
    try { localStorage.setItem('freemcp-theme', next); } catch {}
  });
}

const drawer=document.querySelector('.nav-drawer');
if (drawer) {
  const wide=matchMedia('(min-width:950px)');
  const apply=()=>{drawer.open=wide.matches;};
  wide.addEventListener('change',apply);
  apply();
}
function showChanges(input) { input.dispatchEvent(new Event('input',{bubbles:true})); }
function controlFor(container,label,value,update,{multi=false}={}) {
  const wrapper=document.createElement('label');
  wrapper.textContent=label;
  const control=document.createElement(multi?'textarea':'input');
  control.value=value;
  control.addEventListener('input',()=>update(control.value));
  wrapper.append(control);
  container.append(wrapper);
  return control;
}
function disclosure(label,open=false) {
  const block=document.createElement('details');
  block.className='editor-section';
  block.open=open;
  const header=document.createElement('summary');
  header.textContent=label;
  const content=document.createElement('div');
  content.className='editor-section-body';
  block.append(header,content);
  return [block,content];
}

const editors = {
  tools: [['name','Tool name'],['description','Tool description']],
  endpoints: [['transport','Transport'],['url','HTTPS endpoint']],
  installations: [['title','Title'],['client','Client'],['os','Operating system'],['notes','Notes']],
};
for (const input of document.querySelectorAll('textarea[data-structured]')) {
  const fields = editors[input.name];
  let entries;
  try { entries = JSON.parse(input.value); } catch { continue; }
  if (!fields || !Array.isArray(entries) || entries.some(value => !value || typeof value !== 'object' || Array.isArray(value))) continue;
  const panel = document.createElement('div');
  panel.className = 'record-editor';
  const list = document.createElement('div');
  list.className = 'record-editor';
  const add = document.createElement('button');
  add.type = 'button';
  add.textContent = 'Add ' + ({ tools:'tool', endpoints:'endpoint', installations:'installation' })[input.name];
  panel.append(list,add);
  input.parentElement.hidden = true;
  input.parentElement.after(panel);
  const sync = () => { input.value = JSON.stringify(entries); showChanges(input); };
  const draw = (added=-1) => {
    list.replaceChildren();
    entries.forEach((entry,index) => {
      const group = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = input.parentElement.firstChild.textContent.trim() + ' ' + (index+1);
      group.append(legend);
      for (const [key,title] of fields) {
        const label = document.createElement('label');
        label.textContent = title;
        const control = document.createElement(key === 'config' || key === 'notes' || key === 'description' ? 'textarea' : 'input');
        control.value = key === 'config' ? JSON.stringify(entry[key] ?? {},null,2) : entry[key] || '';
        control.addEventListener('input', () => {
          try {
            entry[key] = key === 'config' ? JSON.parse(control.value) : control.value;
            control.setCustomValidity('');
            sync();
          } catch { control.setCustomValidity('Enter valid JSON.'); }
        });
        label.append(control);
        group.append(label);
      }
      if (input.name==='installations') {
        const config=entry.config??{};
        const specs=Object.entries(config.mcpServers||config.servers||{});
        if (!specs.length && (config.command||!Object.keys(config).length)) specs.push(['Server',config]);
        const [advanced,advancedBody]=disclosure('Advanced client configuration');
        const textarea=controlFor(advancedBody,'Client configuration (JSON)',JSON.stringify(config,null,2),value=>{
          try { entry.config=JSON.parse(value); textarea.setCustomValidity(''); sync(); }
          catch { textarea.setCustomValidity('Enter valid client configuration JSON.'); }
        },{multi:true});
        for (const [name,spec] of specs.filter(([,spec])=>spec&&typeof spec==='object'&&(!spec.url||spec.command))) {
          const fieldset=document.createElement('fieldset');
          fieldset.setAttribute('aria-label','Command for '+name);
          const update=()=>{
            entry.config=config;
            textarea.value=JSON.stringify(config,null,2);
            sync();
          };
          controlFor(fieldset,'Executable for '+name,spec.command??'',value=>{spec.command=value;update();});
          controlFor(fieldset,'Arguments for '+name+' (one per line)',(spec.args??[]).join('\n'),value=>{
            spec.args=value.split('\n').filter(arg=>arg.length);
            update();
          },{multi:true});
          group.append(fieldset);
        }
        group.append(advanced);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove ' + legend.textContent.toLowerCase();
      remove.addEventListener('click', () => {
        entries.splice(index,1);
        sync();
        draw();
        add.focus();
      });
      group.append(remove);
      const [record,content]=disclosure(entry.title||entry.name||legend.textContent,index===added);
      content.append(group);
      list.append(record);
    });
  };
  add.addEventListener('click', () => {
    entries.push(input.name === 'installations' ? {config:{}} : {});
    sync();
    draw(entries.length-1);
    list.lastElementChild?.querySelector('input')?.focus();
  });
  draw();
}

for (const input of document.querySelectorAll('textarea[data-structured][name="sharedEndpoints"]')) {
  const panel=document.createElement('div');
  panel.className='record-editor';
  let entries;
  try { entries=Object.entries(JSON.parse(input.value)); } catch { continue; }
  const list=document.createElement('div');
  list.className='record-editor';
  const add=document.createElement('button');
  add.type='button';
  add.textContent='Add shared endpoint exception';
  const sync=()=>{
    input.value=JSON.stringify(Object.fromEntries(entries.filter(([id,why])=>id||why)));
    showChanges(input);
  };
  const draw=()=>{
    list.replaceChildren();
    for(const entry of entries) {
      const group=document.createElement('fieldset');
      controlFor(group,'Shared listing ID',entry[0],value=>{entry[0]=value;sync();});
      controlFor(group,'Reason for sharing',entry[1],value=>{entry[1]=value;sync();});
      const remove=document.createElement('button');
      remove.type='button';
      remove.textContent='Remove shared endpoint exception';
      remove.addEventListener('click',()=>{entries=entries.filter(item=>item!==entry);sync();draw();add.focus();});
      group.append(remove);
      list.append(group);
    }
  };
  add.addEventListener('click',()=>{entries.push(['','']);draw();list.lastElementChild.querySelector('input').focus();});
  input.parentElement.hidden=true;
  input.parentElement.after(panel);
  panel.append(list,add);
  draw();
}

for (const link of document.querySelectorAll('[data-confirm-discard]')) {
  link.addEventListener('click',event=>{if (!window.confirm('Discard the proposed listing changes?')) event.preventDefault();});
}
const editorsWithChanges=new Set();
const tracked=new Set(document.querySelectorAll('form:has(.unsaved)'));
for (const form of tracked) {
  const notice=form.querySelector('.unsaved');
  form.addEventListener('input',()=>{
    editorsWithChanges.add(form);
    notice.hidden=false;
  });
  if (!form.hasAttribute('data-admin-mutation')) form.addEventListener('submit',event=>{
    if (!event.submitter?.hasAttribute('data-editor-preview')) editorsWithChanges.delete(form);
  });
}
window.addEventListener('beforeunload',event=>{
  if (editorsWithChanges.size) {event.preventDefault();event.returnValue='';}
});
document.addEventListener('submit',event=>{
  if (['approved','publish'].includes(new FormData(event.target).get('action'))&&editorsWithChanges.size) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const feedback=event.target.querySelector('.form-feedback');
    if (feedback) {feedback.dataset.error='true';feedback.textContent='Save or discard your unsaved candidate changes first.';}
  }
},true);
for (const form of document.querySelectorAll('form[data-admin-mutation]')) {
  form.addEventListener('submit', async event => {
    if (event.submitter?.hasAttribute('data-editor-preview')) {
      if (event.submitter.value==='preview-edit'&&editorsWithChanges.has(form)) {
        editorsWithChanges.delete(form);
      }
      return;
    }
    event.preventDefault();
    const feedback = form.querySelector('.form-feedback');
    const submit = event.submitter;
    const fields=new FormData(form);
    if (submit?.name==='action') fields.set('action',submit.value);
    const validating=fields.get('action')==='validate-candidate';
    if (submit) submit.disabled = true;
    for (const field of form.querySelectorAll('[data-validation-error]')) {
      field.removeAttribute('aria-invalid');
      field.removeAttribute('data-validation-error');
    }
    feedback.removeAttribute('data-error');
    feedback.textContent = validating?'Validating…':'Saving…';
    try {
      const response = await fetch(form.getAttribute('action'),{method:'POST',credentials:'same-origin',headers:{Accept:'application/json'},
        body:new URLSearchParams(fields)});
      const result = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
      if (response.redirected) throw new Error('This session or form has expired. Reload the page.');
      if (!response.ok && Array.isArray(result.issues) && result.issues.length) {
        feedback.dataset.error='true';
        feedback.replaceChildren();
        const label=document.createElement('strong');
        label.textContent='Review these fields';
        const list=document.createElement('ul');
        for (const issue of result.issues) {
          const row=document.createElement('li');
          const control=form.elements.namedItem(fields.get('useAdvanced')==='yes'?'candidateJson':issue.field);
          if (control instanceof HTMLElement) {
            control.setAttribute('aria-invalid','true');
            control.dataset.validationError='true';
            const locate=document.createElement('button');
            locate.type='button';
            locate.textContent=issue.message;
            locate.addEventListener('click',()=>{
              for(let parent=control.parentElement;parent&&parent!==form;parent=parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open=true;
              const target=control.getClientRects().length?control:control.parentElement?.nextElementSibling?.querySelector('input, textarea, button');
              (target??feedback).focus();
            });
            row.append(locate);
          } else row.textContent=issue.message;
          list.append(row);
        }
        feedback.append(label,list);
        feedback.focus();
        return;
      }
      if (!response.ok) throw new Error(result.error || 'The request failed.');
      if (validating) {
        feedback.textContent='Validation and duplicate checks passed. Save the candidate before approval.';
        return;
      }
      editorsWithChanges.delete(form);
      if (typeof result.location === 'string' && result.location.startsWith('/admin/')) location.assign(result.location);
      else feedback.textContent = 'Saved.';
    } catch (error) {
      feedback.dataset.error = 'true';
      feedback.textContent = error.message || 'Unable to save the change.';
    } finally { if (submit) submit.disabled = false; }
  });
}
