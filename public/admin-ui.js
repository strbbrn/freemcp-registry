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

const editors = {
  tools: [['name','Name'],['description','Description']],
  endpoints: [['transport','Transport'],['url','HTTPS endpoint']],
  installations: [['title','Title'],['client','Client'],['os','Operating system'],['notes','Notes'],['config','Client configuration (JSON)']],
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
  const sync = () => { input.value = JSON.stringify(entries); };
  const draw = () => {
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
      list.append(group);
    });
  };
  add.addEventListener('click', () => {
    entries.push(input.name === 'installations' ? {config:{}} : {});
    sync();
    draw();
    list.lastElementChild?.querySelector('input')?.focus();
  });
  draw();
}

for (const form of document.querySelectorAll('form[data-admin-mutation]')) {
  form.addEventListener('submit', async event => {
    if (event.submitter?.value === 'preview-edit') return;
    event.preventDefault();
    const feedback = form.querySelector('.form-feedback');
    const submit = event.submitter;
    if (submit) submit.disabled = true;
    feedback.removeAttribute('data-error');
    feedback.textContent = 'Saving…';
    try {
      const response = await fetch(form.getAttribute('action'),{method:'POST',credentials:'same-origin',headers:{Accept:'application/json'},
        body:new URLSearchParams(new FormData(form))});
      const result = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
      if (response.redirected) throw new Error('This session or form has expired. Reload the page.');
      if (!response.ok) throw new Error(result.error || 'The request failed.');
      if (typeof result.location === 'string' && result.location.startsWith('/admin/')) location.assign(result.location);
      else feedback.textContent = 'Saved.';
    } catch (error) {
      feedback.dataset.error = 'true';
      feedback.textContent = error.message || 'Unable to save the change.';
    } finally { if (submit) submit.disabled = false; }
  });
}
