const state = { meta: null, runs: [], run: null };
const main = document.querySelector('#execution-main');
const list = document.querySelector('#run-list');
const toast = document.querySelector('#execution-toast');

function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [name, value] of Object.entries(options.attrs ?? {})) node.setAttribute(name, value);
  for (const child of Array.isArray(children) ? children : [children]) if (child) node.append(child);
  return node;
}

async function api(route, options = {}) {
  const response = await fetch(route, { ...options, headers: { 'content-type': 'application/json', ...(options.headers ?? {}) } });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Request failed.');
  return value;
}

function notify(message) {
  toast.textContent = message; toast.hidden = false; clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { toast.hidden = true; }, 4000);
}

async function refresh() { state.runs = (await api('/api/execution/runs')).runs; renderList(); }

function renderList() {
  list.replaceChildren();
  if (!state.runs.length) return list.append(el('p', { className: 'muted', text: 'No execution runs yet.' }));
  for (const run of state.runs) {
    const button = el('button', { className: `run-link${state.run?.id === run.id ? ' active' : ''}`, attrs: { type: 'button' } }, [
      el('strong', { text: run.title }), el('span', { text: run.status.replaceAll('_', ' ') }), el('small', { text: run.profile.label }),
    ]);
    button.addEventListener('click', () => load(run.id)); list.append(button);
  }
}

function showNew() {
  state.run = null; main.replaceChildren(document.querySelector('#new-run-template').content.cloneNode(true)); renderList();
  const select = document.querySelector('#profile');
  if (!state.meta.profiles.length) {
    select.append(el('option', { text: 'No execution profile enabled', attrs: { value: '' } }));
    document.querySelector('#run-form button').disabled = true;
  } else for (const profile of state.meta.profiles) select.append(el('option', { text: `${profile.label} — ${profile.description}`, attrs: { value: profile.id } }));
  document.querySelector('#run-form').addEventListener('submit', createRun);
}

async function createRun(event) {
  event.preventDefault();
  const form = event.currentTarget; const button = form.querySelector('button'); button.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(form));
    values.requirements = values.requirements.split('\n').map((entry) => entry.trim()).filter(Boolean);
    state.run = await api('/api/execution/runs', { method: 'POST', body: JSON.stringify(values) });
    await refresh(); renderRun(); notify('Execution request created. Independent approval is required.');
  } catch (error) { notify(error.message); button.disabled = false; }
}

async function load(id) {
  try { state.run = await api(`/api/execution/runs/${id}`); renderRun(); renderList(); }
  catch (error) { notify(error.message); }
}

async function command(action, body) {
  const button = document.querySelector(`[data-action="${action}"]`); if (button) button.disabled = true;
  try {
    state.run = await api(`/api/execution/runs/${state.run.id}/${action}`, { method: 'POST', body: JSON.stringify({ version: state.run.version, ...body }) });
    await refresh(); renderRun(); notify(action === 'execute' ? 'Execution finished and evidence was saved.' : 'Independent approval recorded.');
  } catch (error) { notify(error.message); if (button) button.disabled = false; }
}

function section(title, children) { return el('section', { className: 'run-section' }, [el('h3', { text: title }), ...(Array.isArray(children) ? children : [children])]); }

function renderRun() {
  const run = state.run; main.replaceChildren();
  const panel = el('section', { className: 'execution-panel' }, [
    el('div', { className: 'run-heading' }, [el('div', {}, [el('span', { className: 'eyebrow', text: `${run.profile.kind} · run revision ${run.version}` }), el('h2', { text: run.title })]), el('span', { className: `run-status status-${run.status}`, text: run.status.replaceAll('_', ' ') })]),
    el('p', { className: 'objective', text: run.workItem.objective }),
  ]);
  panel.append(section('Approval boundary', approvalControls(run)));
  panel.append(section('Requirements', run.workItem.requirements.length ? el('ul', { className: 'requirements' }, run.workItem.requirements.map((entry) => el('li', { text: entry }))) : el('p', { className: 'muted', text: 'No acceptance requirements supplied.' })));
  if (run.execution) panel.append(section('Execution evidence', executionEvidence(run.execution)));
  panel.append(section('Append-only activity', el('div', { className: 'run-events' }, run.events.slice().reverse().map((entry) => el('div', {}, [el('b', { text: entry.type }), el('span', { text: `${new Date(entry.at).toLocaleString()} · ${entry.actor}` })])))));
  main.append(panel);
}

function approvalControls(run) {
  if (run.status === 'AWAITING_APPROVAL') {
    const wrap = el('div', { className: 'approval-box' }, [el('p', { text: `Requested by ${run.requestedBy}. A different identity with execution-approver authority must approve the immutable request.` })]);
    const input = el('input', { attrs: { value: 'studio-governor', 'aria-label': 'Approver identity', maxlength: '120' } });
    const button = el('button', { className: 'button primary', text: 'Approve execution', attrs: { type: 'button', 'data-action': 'approve' } });
    button.addEventListener('click', () => command('approve', { principal: input.value, roles: ['execution-approver'] }));
    wrap.append(el('div', { className: 'inline-action' }, [input, button])); return wrap;
  }
  if (run.status === 'APPROVED') {
    const button = el('button', { className: 'button primary', text: 'Execute approved profile', attrs: { type: 'button', 'data-action': 'execute' } });
    button.addEventListener('click', () => command('execute', { principal: 'local-execution-worker' }));
    return [el('p', { text: `Approved by ${run.approval.principal}. The profile executable and arguments are server-controlled.` }), button];
  }
  return el('p', { text: run.approval ? `Approved by ${run.approval.principal} at ${new Date(run.approval.approvedAt).toLocaleString()}.` : 'No approval recorded.' });
}

function executionEvidence(execution) {
  const wrap = el('div', { className: 'evidence-grid' }, [
    el('div', {}, [el('b', { text: 'Result' }), el('span', { text: execution.status ?? 'FAILED' })]),
    el('div', {}, [el('b', { text: 'Exit code' }), el('span', { text: String(execution.exitCode ?? 'n/a') })]),
    el('div', {}, [el('b', { text: 'Artifacts' }), el('span', { text: String(execution.changedArtifacts?.length ?? 0) })]),
    el('div', {}, [el('b', { text: 'Evidence hash' }), el('span', { text: execution.evidenceHash?.slice(0, 18) ?? 'n/a' })]),
  ]);
  if (execution.changedArtifacts?.length) wrap.append(el('ul', { className: 'artifact-list' }, execution.changedArtifacts.map((entry) => el('li', { text: `${entry.path} · ${entry.contentHash.slice(0, 14)}…` }))));
  if (execution.stdout) wrap.append(el('pre', { text: execution.stdout }));
  if (execution.stderr || execution.error) wrap.append(el('pre', { className: 'error-log', text: execution.stderr || execution.error }));
  return wrap;
}

document.querySelector('#new-run').addEventListener('click', showNew);
try {
  state.meta = await api('/api/execution/meta'); await refresh();
  if (state.runs.length) await load(state.runs[0].id); else showNew();
} catch (error) { notify(error.message); }
