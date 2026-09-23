import { getOrCreatePlanRevisionCommand, getOrCreateProcessPlanCommand, processPlanCommandKey, processPlanFailureDisposition } from './process-plan-command.mjs';

const state = {
  meta: null, projects: [], runs: [], run: null, authenticated: false, planningProject: null,
  actorBindingRows: [], actorBindingProjectId: null, actorBindingReadAvailable: false,
};
state.pendingProcessPlans = new Map();
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
  if (!response.ok) {
    const failure = value.error;
    const error = new Error(typeof failure === 'string' ? failure : failure?.message || 'Request failed.');
    error.status = response.status;
    error.code = failure && typeof failure === 'object' ? failure.code : null;
    error.retryable = failure && typeof failure === 'object' ? failure.retryable : response.status >= 500;
    throw error;
  }
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
  const projectSelect = document.querySelector('#project');
  const planProjectSelect = document.querySelector('#plan-project');
  for (const project of state.projects) projectSelect.append(el('option', { text: project.name, attrs: { value: project.id } }));
  for (const project of state.projects) planProjectSelect.append(el('option', { text: project.name, attrs: { value: project.id } }));
  if (!state.projects.length) document.querySelector('#run-form button').disabled = true;
  if (state.authenticated) document.querySelector('[name="requestedBy"]').closest('label').hidden = true;
  if (!state.meta.profiles.length) {
    select.append(el('option', { text: 'No execution profile enabled', attrs: { value: '' } }));
    document.querySelector('#run-form button').disabled = true;
  } else for (const profile of state.meta.profiles) select.append(el('option', { text: `${profile.label} — ${profile.description}`, attrs: { value: profile.id } }));
  document.querySelector('#run-form').addEventListener('submit', createRun);
  planProjectSelect.addEventListener('change', () => { void loadPlanningProject(planProjectSelect.value); });
  document.querySelector('#process-plan-form').addEventListener('submit', createProcessPlan);
  document.querySelector('#plan-process').addEventListener('change', updatePlanButtonLabel);
  if (state.projects.length) void loadPlanningProject(planProjectSelect.value);
}

async function loadPlanningProject(projectId, preferredProcessId = null) {
  const processSelect = document.querySelector('#plan-process');
  const plansPanel = document.querySelector('#process-plans');
  if (!processSelect || !plansPanel) return;
  processSelect.replaceChildren(); plansPanel.replaceChildren(); state.planningProject = null;
  if (!projectId) return;
  try {
    const project = (await api(`/api/v1/projects/${encodeURIComponent(projectId)}`)).data;
    if (document.querySelector('#plan-project')?.value !== projectId) return;
    state.planningProject = project;
    const processes = Object.values(project.latestBlueprint?.areas ?? {}).flatMap((area) => area.items ?? [])
      .filter((item) => item.type === 'process');
    if (!processes.length) processSelect.append(el('option', { text: 'No saved processes', attrs: { value: '' } }));
    else for (const process of processes) processSelect.append(el('option', { text: process.name, attrs: { value: process.id } }));
    if (preferredProcessId && processes.some((process) => process.id === preferredProcessId)) processSelect.value = preferredProcessId;
    state.actorBindingRows = [];
    state.actorBindingProjectId = projectId;
    state.actorBindingReadAvailable = false;
    if (state.authenticated) {
      try {
        const registry = await api(`/api/v1/projects/${encodeURIComponent(projectId)}/actor-bindings/proposals`);
        if (document.querySelector('#plan-project')?.value !== projectId) return;
        state.actorBindingRows = registry.data.proposals ?? [];
        state.actorBindingReadAvailable = true;
      } catch { /* Registry identity details remain unavailable to readers; project plans still render. */ }
    }
    renderProcessPlans(plansPanel, project.processPlans ?? [], project);
    updatePlanButtonLabel();
  } catch (error) { notify(error.message); }
}

async function createProcessPlan(event) {
  event.preventDefault();
  const form = event.currentTarget; const button = form.querySelector('button');
  const projectId = form.querySelector('#plan-project').value;
  const processId = form.querySelector('#plan-process').value;
  if (!projectId || !processId) return notify('Choose a project and saved process first.');
  button.disabled = true;
  const key = processPlanCommandKey(projectId, processId);
  try {
    let pending = state.pendingProcessPlans.get(key);
    if (!pending) {
      const project = (await api(`/api/v1/projects/${encodeURIComponent(projectId)}`)).data;
      const sourceProcess = Object.values(project.latestBlueprint?.areas ?? {}).flatMap((area) => area.items ?? [])
        .find((item) => item.id === processId && item.type === 'process');
      if (!sourceProcess) {
        await loadPlanningProject(projectId);
        return notify('The saved blueprint changed. Review the current process list and submit again.');
      }
      pending = getOrCreateProcessPlanCommand(state.pendingProcessPlans, projectId, processId, project, () => `process-plan-${crypto.randomUUID()}`);
    }
    const result = await api(`/api/v1/projects/${encodeURIComponent(projectId)}/process-plans`, {
      method: 'POST', body: JSON.stringify({
        schemaVersion: pending.schemaVersion, commandId: pending.commandId,
        expectedVersion: pending.expectedVersion, payload: pending.payload,
      }),
    });
    state.pendingProcessPlans.delete(key);
    state.planningProject = result.data;
    renderProcessPlans(document.querySelector('#process-plans'), result.data.processPlans ?? [], result.data);
    updatePlanButtonLabel();
    notify('Planning graph saved. No execution run was created and no work was dispatched.');
  } catch (error) {
    const disposition = processPlanFailureDisposition(error);
    if (disposition === 'reload') {
      state.pendingProcessPlans.delete(key);
      await loadPlanningProject(projectId, processId);
      notify('The workspace version changed. Current data is loaded; review and submit the plan again.');
    } else if (disposition === 'retry' && state.pendingProcessPlans.has(key)) {
      notify('The save result is uncertain. Retry this same project and process to safely recover the saved result.');
    } else {
      state.pendingProcessPlans.delete(key);
      notify(error.message);
    }
    updatePlanButtonLabel();
  }
  finally { button.disabled = false; }
}

function updatePlanButtonLabel() {
  const projectId = document.querySelector('#plan-project')?.value;
  const processId = document.querySelector('#plan-process')?.value;
  const button = document.querySelector('#process-plan-form button');
  if (!button) return;
  button.textContent = projectId && processId
    && state.pendingProcessPlans.has(processPlanCommandKey(projectId, processId))
    ? 'Retry graph save' : 'Create planning graph';
}

function renderProcessPlans(container, plans, project) {
  container.replaceChildren();
  if (!plans.length) return container.append(el('p', { className: 'muted', text: 'No planning graphs saved for this project.' }));
  const revisions = new Map();
  for (const plan of plans) {
    const values = revisions.get(plan.id) ?? [];
    values.push(plan); revisions.set(plan.id, values);
  }
  for (const entries of revisions.values()) {
    entries.sort((left, right) => (left.revision ?? 1) - (right.revision ?? 1));
    const plan = entries.at(-1);
    const card = el('section', { className: 'run-section process-plan', attrs: { 'aria-label': `Planned graph for ${plan.source.processName}` } }, [
      el('h4', { text: `${plan.source.processName} · blueprint v${plan.source.blueprintVersion} · graph revision ${plan.revision ?? 1}` }),
      el('p', { text: 'Proposed design · planned only · not dispatched' }),
    ]);
    const editButton = el('button', { className: 'button', text: 'Edit planned graph', attrs: { type: 'button' } });
    editButton.addEventListener('click', () => openPlanEditor(card, plan, project));
    card.append(editButton);
    const tasks = new Map(plan.tasks.map((task) => [task.id, task]));
    const list = el('ol');
    for (const task of plan.tasks) {
      const dependencies = task.dependencies.map((id) => tasks.get(id)?.title).filter(Boolean);
      const inputs = task.inputs.map((item) => item.label).join(', ') || 'None specified';
      const outputs = task.outputs.map((item) => item.label).join(', ') || 'None specified';
      const roleText = taskAssigneePresentation(task, plan, project);
      list.append(el('li', {}, [
        el('strong', { text: `${task.title} — ${task.status}` }),
        el('p', { text: task.detail }),
        el('p', { text: `Depends on: ${dependencies.join(', ') || 'No upstream process dependency'}` }),
        el('p', { text: `Inputs: ${inputs}` }), el('p', { text: `Outputs: ${outputs}` }),
        el('p', { text: `Role reference: ${roleText}` }),
      ]));
    }
    if (entries.length > 1) {
      const history = el('details', { className: 'plan-history' }, [el('summary', { text: 'Earlier immutable graph revisions' })]);
      for (const earlier of entries.slice(0, -1).reverse()) {
        const section = el('section', {}, [el('h5', { text: `Revision ${earlier.revision ?? 1} · planned` })]);
        const earlierTasks = new Map(earlier.tasks.map((task) => [task.id, task]));
        section.append(el('ul', {}, earlier.tasks.map((task) => {
          const dependsOn = task.dependencies.map((id) => earlierTasks.get(id)?.title).filter(Boolean).join(', ') || 'none';
          const role = taskAssigneePresentation(task, earlier, project);
          return el('li', {}, [
            el('strong', { text: `${task.title} — ${task.status}` }),
            el('p', { text: task.detail }),
            el('p', { text: `Dependencies: ${dependsOn}. Inputs: ${task.inputs.map((item) => item.label).join(', ') || 'none'}. Outputs: ${task.outputs.map((item) => item.label).join(', ') || 'none'}. Role reference: ${role}.` }),
          ]);
        })));
        history.append(section);
      }
      card.append(history);
    }
    card.append(list); container.append(card);
  }
}

function taskAssigneePresentation(task, plan, project) {
  if (task.assignee?.kind === 'role-reference') return `${task.assignee.roleName} · role reference only; no person selected`;
  if (task.assignee?.kind !== 'blueprint-actor') return 'No role or actor reference';
  const blueprint = project?.blueprintVersions?.find((entry) => entry.id === plan.source.blueprintId
    && entry.version === plan.source.blueprintVersion);
  const actor = Object.values(blueprint?.areas ?? {}).flatMap((area) => area.items ?? [])
    .find((item) => item.id === task.assignee.actorId);
  const actorLabel = actor?.name ?? 'Unknown blueprint actor';
  if (project?.blueprintVersions?.at(-1)?.version !== plan.source.blueprintVersion) {
    return `${actorLabel} · stale blueprint assignment; target unresolved`;
  }
  if (state.actorBindingProjectId !== project?.id || !state.actorBindingReadAvailable) {
    return `${actorLabel} · blueprint actor reference; target unresolved`;
  }
  const row = state.actorBindingRows.find((candidate) => candidate.blueprintVersion === plan.source.blueprintVersion
    && candidate.actorId === task.assignee.actorId && candidate.roleId === task.assignee.roleId);
  if (row?.status === 'enabled' && row.eligibilityStatus?.length === 1 && row.eligibilityStatus[0] === 'eligible' && row.targetName) {
    return `${actorLabel} · enabled organizational assignee: ${row.targetName}`;
  }
  return `${actorLabel} · enabled binding is stale or unavailable; target unresolved`;
}

function openPlanEditor(container, plan, project) {
  if (!project) return notify('Reload the project before editing this graph.');
  container.querySelector('.plan-editor')?.remove();
  const pendingKey = `${project.id}\n${plan.id}\nrevision`;
  const pendingRevision = state.pendingProcessPlans.get(pendingKey);
  const pendingEdits = new Map((pendingRevision?.payload.tasks ?? []).map((edit) => [edit.taskId, edit]));
  const form = el('form', { className: 'execution-form plan-editor', attrs: { 'aria-label': `Edit planned graph ${plan.source.processName}` } });
  form.append(el('p', { text: pendingRevision
    ? 'Retrying the same graph revision command. Its submitted values are locked to avoid changing an uncertain request.'
    : `Editing graph revision ${plan.revision ?? 1}. Save creates an immutable revision; every task stays planned and no person or execution authority is assigned.` }));
  const blueprint = project.blueprintVersions?.find((entry) => entry.id === plan.source.blueprintId && entry.version === plan.source.blueprintVersion);
  const pinnedObjects = Object.values(blueprint?.areas ?? {}).flatMap((area) => area.items ?? []);
  const roles = pinnedObjects.filter((item) => item.type === 'role');
  for (const task of plan.tasks) {
    const pendingEdit = pendingEdits.get(task.id);
    const fieldset = el('fieldset', { className: 'plan-task-editor' });
    fieldset.append(el('legend', { text: pendingEdit?.title ?? task.title }));
    const title = el('input', { attrs: { required: 'required', maxlength: '120', name: `title:${task.id}`, value: pendingEdit?.title ?? task.title } });
    fieldset.append(el('label', { text: 'Task title' }, title));
    const detail = el('textarea', { attrs: { required: 'required', maxlength: '700', name: `detail:${task.id}`, rows: '3' } });
    detail.value = pendingEdit?.detail ?? task.detail;
    fieldset.append(el('label', { text: 'Task detail' }, detail));
    const dependencySelect = el('select', { attrs: { name: `dependencies:${task.id}`, multiple: 'multiple', size: String(Math.min(Math.max(plan.tasks.length, 2), 8)), 'aria-label': `Dependencies for ${task.title}` } });
    for (const candidate of plan.tasks) {
      if (candidate.id === task.id) continue;
      const dependencies = pendingEdit?.dependencies ?? task.dependencies;
      dependencySelect.append(el('option', { text: candidate.title, attrs: { value: candidate.id, ...(dependencies.includes(candidate.id) ? { selected: 'selected' } : {}) } }));
    }
    fieldset.append(el('label', { text: 'Dependencies (use Ctrl or Command to select multiple)' }, dependencySelect));
    const roleSelect = el('select', { attrs: { name: `role:${task.id}`, 'aria-label': `Blueprint role reference for ${task.title}` } });
    roleSelect.append(el('option', { text: 'No role reference', attrs: { value: '' } }));
    const selectedRoleId = pendingEdit ? pendingEdit.roleId : task.assignee.roleId ?? null;
    for (const role of roles) {
      const roleId = selectedRoleId;
      roleSelect.append(el('option', { text: `${role.name} (no person selected)`, attrs: { value: role.id, ...(roleId === role.id ? { selected: 'selected' } : {}) } }));
    }
    fieldset.append(el('label', { text: 'Role reference' }, roleSelect));
    const actorSelect = el('select', { attrs: { name: `actor:${task.id}`, 'aria-label': `Eligible enabled actor binding for ${task.title}`, ...(!state.actorBindingReadAvailable ? { disabled: 'disabled' } : {}) } });
    const actorNote = el('p', { className: 'muted', attrs: { 'aria-live': 'polite' } });
    const populateActorOptions = (roleId, preferredActorId = null, reportStale = false) => {
      actorSelect.replaceChildren(el('option', { text: 'Role reference only — no person selected', attrs: { value: '' } }));
      const bindingRows = state.actorBindingRows.filter((row) => row.blueprintVersion === plan.source.blueprintVersion
        && row.roleId === roleId && row.status === 'enabled'
        && row.eligibilityStatus?.length === 1 && row.eligibilityStatus[0] === 'eligible');
      for (const row of bindingRows) {
        const boundActor = pinnedObjects.find((item) => item.id === row.actorId);
        const option = el('option', {
          text: `${boundActor?.name ?? row.actorName} → ${row.targetName} (organizational responsibility only)`,
          attrs: { value: row.actorId, ...(preferredActorId === row.actorId ? { selected: 'selected' } : {}) },
        });
        actorSelect.append(option);
      }
      const currentBinding = bindingRows.find((row) => row.actorId === preferredActorId);
      if (reportStale && preferredActorId && !currentBinding) {
        actorNote.textContent = 'Previously stored actor reference is stale or unresolved and will not carry into a new revision. Choose a current enabled binding or keep role-only to clear it.';
      } else if (!state.actorBindingReadAvailable) {
        actorNote.textContent = 'Enabled identity bindings are unavailable here. The graph remains visible; an owner or editor can resolve this restricted registry.';
      } else {
        actorNote.textContent = 'Only currently eligible enabled bindings for this pinned actor and role are offered. Selection records blueprint references only.';
      }
    };
    const currentRoleId = selectedRoleId;
    const storedActorId = pendingEdit ? pendingEdit.actorId : task.assignee.actorId ?? null;
    populateActorOptions(currentRoleId, storedActorId, Boolean(task.assignee.actorId && !pendingEdit));
    if (pendingEdit?.actorId && !actorSelect.querySelector(`option[value="${CSS.escape(pendingEdit.actorId)}"]`)) {
      actorNote.textContent = 'Retrying the stored command exactly; this submitted blueprint actor reference is locked.';
    }
    actorSelect.addEventListener('change', () => {
      if (actorSelect.value) {
        const row = state.actorBindingRows.find((candidate) => candidate.actorId === actorSelect.value
          && candidate.roleId === roleSelect.value && candidate.blueprintVersion === plan.source.blueprintVersion);
        actorNote.textContent = row ? `Target ${row.targetName} is eligible and enabled for organizational responsibility only; no platform permission or execution authority is granted.` : 'Selected actor binding is unresolved.';
      } else actorNote.textContent = 'Role reference only; no person is selected.';
    });
    roleSelect.addEventListener('change', () => populateActorOptions(roleSelect.value || null, null, false));
    fieldset.append(el('label', { text: 'Enabled organizational assignee (optional)' }, actorSelect), actorNote);
    fieldset.append(el('p', { className: 'muted', text: `Inputs and outputs remain pinned to the saved process: ${task.inputs.map((entry) => entry.label).join(', ') || 'no inputs'} → ${task.outputs.map((entry) => entry.label).join(', ') || 'no outputs'}.` }));
    form.append(fieldset);
  }
  const save = el('button', { className: 'button primary', text: 'Save graph revision', attrs: { type: 'submit' } });
  if (pendingRevision) {
    save.textContent = 'Retry same graph revision';
    for (const control of form.querySelectorAll('input, textarea, select')) control.disabled = true;
  }
  const cancel = el('button', { className: 'button', text: 'Cancel', attrs: { type: 'button' } });
  cancel.addEventListener('click', () => form.remove());
  form.append(el('div', { className: 'inline-action' }, [save, cancel]));
  form.addEventListener('submit', (event) => { void submitPlanRevision(event, plan, project); });
  container.append(form);
}

async function submitPlanRevision(event, plan, project) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const projectId = project.id;
  const planId = plan.id;
  const key = `${projectId}\n${planId}\nrevision`;
  button.disabled = true;
  try {
    let pending = state.pendingProcessPlans.get(key);
    if (!pending) {
      const currentProject = (await api(`/api/v1/projects/${encodeURIComponent(projectId)}`)).data;
      const revisions = (currentProject.processPlans ?? []).filter((entry) => entry.id === planId);
      const latest = revisions.sort((left, right) => (left.revision ?? 1) - (right.revision ?? 1)).at(-1);
      if (!latest || (latest.revision ?? 1) !== (plan.revision ?? 1)) {
        await loadPlanningProject(projectId);
        notify('This graph changed in another request. The current revision is loaded; reopen the editor and review it.');
        return;
      }
      const formData = new FormData(form);
      const edits = plan.tasks.map((task) => ({
        taskId: task.id,
        title: String(formData.get(`title:${task.id}`) ?? ''),
        detail: String(formData.get(`detail:${task.id}`) ?? ''),
        dependencies: formData.getAll(`dependencies:${task.id}`).map(String),
        roleId: String(formData.get(`role:${task.id}`) ?? '') || null,
        actorId: formData.has(`actor:${task.id}`)
          ? String(formData.get(`actor:${task.id}`) ?? '') || null
          : (String(formData.get(`role:${task.id}`) ?? '') === (task.assignee.roleId ?? '')
            ? task.assignee.actorId ?? null
            : null),
      }));
      pending = getOrCreatePlanRevisionCommand(state.pendingProcessPlans, projectId, planId, currentProject, { tasks: edits }, () => `process-plan-revision-${crypto.randomUUID()}`);
    }
    const result = await api(`/api/v1/projects/${encodeURIComponent(projectId)}/process-plans/${encodeURIComponent(planId)}/revisions`, {
      method: 'POST', body: JSON.stringify({ schemaVersion: pending.schemaVersion, commandId: pending.commandId, expectedVersion: pending.expectedVersion, payload: pending.payload }),
    });
    state.pendingProcessPlans.delete(key);
    state.planningProject = result.data;
    renderProcessPlans(document.querySelector('#process-plans'), result.data.processPlans ?? [], result.data);
    notify('Immutable graph revision saved. Tasks remain planned; no work was dispatched.');
  } catch (error) {
    const disposition = processPlanFailureDisposition(error);
    if (disposition === 'reload') {
      state.pendingProcessPlans.delete(key);
      await loadPlanningProject(projectId);
      notify('The project or pinned source changed. Current data is loaded; reopen the editor and submit again.');
    } else if (disposition === 'retry' && state.pendingProcessPlans.has(key)) {
      for (const control of form.querySelectorAll('input, textarea, select')) control.disabled = true;
      button.textContent = 'Retry same graph revision';
      notify('The save result is uncertain. Retry the same graph revision to safely recover the saved result.');
    } else {
      state.pendingProcessPlans.delete(key);
      notify(error.message);
    }
  } finally { button.disabled = false; }
}

async function createRun(event) {
  event.preventDefault();
  const form = event.currentTarget; const button = form.querySelector('button'); button.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(form));
    if (state.authenticated) delete values.requestedBy;
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
  if (run.execution) panel.append(section('Execution evidence', executionEvidence(run.execution, run.id)));
  panel.append(section('Append-only activity', el('div', { className: 'run-events' }, run.events.slice().reverse().map((entry) => el('div', {}, [el('b', { text: entry.type }), el('span', { text: `${new Date(entry.at).toLocaleString()} · ${entry.actor}` })])))));
  main.append(panel);
}

function approvalControls(run) {
  if (run.status === 'AWAITING_APPROVAL') {
    const wrap = el('div', { className: 'approval-box' }, [el('p', { text: `Requested by ${run.requestedBy}. A different identity with execution-approver authority must approve the immutable request.` })]);
    const button = el('button', { className: 'button primary', text: 'Approve execution', attrs: { type: 'button', 'data-action': 'approve' } });
    if (state.authenticated) button.addEventListener('click', () => command('approve', {}));
    else {
      const input = el('input', { attrs: { value: 'studio-governor', 'aria-label': 'Approver identity', maxlength: '120' } });
      button.addEventListener('click', () => command('approve', { principal: input.value, roles: ['execution-approver'] }));
      wrap.append(el('div', { className: 'inline-action' }, [input, button]));
      return wrap;
    }
    wrap.append(button); return wrap;
  }
  if (run.status === 'APPROVED') {
    const button = el('button', { className: 'button primary', text: 'Execute approved profile', attrs: { type: 'button', 'data-action': 'execute' } });
    button.addEventListener('click', () => command('execute', state.authenticated ? {} : { principal: 'local-execution-worker' }));
    return [el('p', { text: `Approved by ${run.approval.principal}. The profile executable and arguments are server-controlled.` }), button];
  }
  return el('p', { text: run.approval ? `Approved by ${run.approval.principal} at ${new Date(run.approval.approvedAt).toLocaleString()}.` : 'No approval recorded.' });
}

function executionEvidence(execution, runId) {
  const wrap = el('div', { className: 'evidence-grid' }, [
    el('div', {}, [el('b', { text: 'Result' }), el('span', { text: execution.status ?? 'FAILED' })]),
    el('div', {}, [el('b', { text: 'Exit code' }), el('span', { text: String(execution.exitCode ?? 'n/a') })]),
    el('div', {}, [el('b', { text: 'Artifacts' }), el('span', { text: String(execution.changedArtifacts?.length ?? 0) })]),
    el('div', {}, [el('b', { text: 'Evidence hash' }), el('span', { text: execution.evidenceHash?.slice(0, 18) ?? 'n/a' })]),
  ]);
  if (execution.changedArtifacts?.length) {
    const list = el('ul', { className: 'artifact-list' });
    for (const entry of execution.changedArtifacts) {
      const link = el('a', {
        text: `Download ${entry.path}`,
        attrs: { href: `/api/execution/runs/${encodeURIComponent(runId)}/artifact?path=${encodeURIComponent(entry.path)}` },
      });
      list.append(el('li', {}, [link, el('span', { text: ` · ${entry.contentHash.slice(0, 14)}…` })]));
    }
    wrap.append(list);
  }
  if (execution.stdout) wrap.append(el('pre', { text: execution.stdout }));
  if (execution.stderr || execution.error) wrap.append(el('pre', { className: 'error-log', text: execution.stderr || execution.error }));
  return wrap;
}

document.querySelector('#new-run').addEventListener('click', showNew);
try {
  const [meta, projectResult] = await Promise.all([api('/api/execution/meta'), api('/api/v1/projects')]);
  const session = await api('/auth/session');
  state.meta = meta; state.projects = projectResult.data; state.authenticated = session.authenticated; await refresh();
  if (state.runs.length) await load(state.runs[0].id); else showNew();
} catch (error) { notify(error.message); }
