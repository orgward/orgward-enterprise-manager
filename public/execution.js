import { getOrCreatePlanRevisionCommand, getOrCreateProcessPlanCommand, processPlanCommandKey, processPlanFailureDisposition } from './process-plan-command.mjs';
import { deriveProcessTaskState } from './process-task-state.mjs';
import { deriveBlueprintProposalReviewState, proposalApplyFailureDisposition, proposalDesignLink } from './proposal-review-state.mjs';
import { encodeExecutionRoute, encodeStudioRoute, executionProcessTarget, executionProjectContext } from './shared-interactions.mjs';
import { linkedPlanInstanceRouteTarget, linkedProcessPlanTarget, selectLinkedProcessPlanInstance, sourceProcessDesignLink } from './process-plan-navigation.mjs';

const state = {
  meta: null, projects: [], runs: [], taskInstances: [], run: null, runProject: null, proposalMembershipAccess: null, authenticated: false, currentPrincipal: null, planningProject: null, projectContextId: null,
  actorBindingRows: [], actorBindingProjectId: null, actorBindingReadAvailable: false,
  selectedPlanInstances: new Map(),
};
state.pendingProcessPlans = new Map();
state.pendingTaskRuns = new Map();
state.pendingHumanTaskCommands = new Map();
state.pendingRunCancellations = new Map();
state.pendingRunPauses = new Map();
state.pendingRunAmendments = new Map();
state.pendingInstanceCommands = new Map();
state.pendingProposalApplies = new Map();
const main = document.querySelector('#execution-main');
const list = document.querySelector('#run-list');
const toast = document.querySelector('#execution-toast');

function syncEnterpriseDesignNavigation(projectId = state.projectContextId) {
  const link = document.querySelector('#enterprise-design-nav');
  if (link) link.href = encodeStudioRoute({ projectId });
}

function syncExecutionRoute(projectId = state.projectContextId, target = null) {
  history.replaceState(null, '', encodeExecutionRoute(projectId, target));
}

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

async function refresh() {
  state.runs = (await api('/api/execution/runs')).runs;
  if (state.authenticated && state.planningProject?.id) {
    try {
      state.taskInstances = (await api(`/api/execution/process-task-instances?projectId=${encodeURIComponent(state.planningProject.id)}`)).instances;
    } catch { state.taskInstances = []; }
  }
  renderList();
  const plans = document.querySelector('#process-plans');
  if (plans && state.planningProject) renderProcessPlans(plans, state.planningProject.processPlans ?? [], state.planningProject);
}

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

function showNew({ planTarget = null, preferredProcessId = null, preserveProcessRoute = false } = {}) {
  state.run = null; main.replaceChildren(document.querySelector('#new-run-template').content.cloneNode(true)); renderList();
  const select = document.querySelector('#profile');
  const projectSelect = document.querySelector('#project');
  const planProjectSelect = document.querySelector('#plan-project');
  for (const project of state.projects) projectSelect.append(el('option', { text: project.name, attrs: { value: project.id } }));
  for (const project of state.projects) planProjectSelect.append(el('option', { text: project.name, attrs: { value: project.id } }));
  const projectContext = executionProjectContext(window.location.href, state.projects);
  const selectedProjectId = planTarget?.projectId ?? (state.projectContextId
    && state.projects.some((project) => project.id === state.projectContextId) ? state.projectContextId : projectContext.projectId);
  if (planTarget) state.selectedPlanInstances.set(planTarget.selectionKey, planTarget.planInstanceId);
  else if (!preserveProcessRoute) syncExecutionRoute(selectedProjectId);
  if (selectedProjectId) {
    state.projectContextId = selectedProjectId;
    projectSelect.value = selectedProjectId;
    planProjectSelect.value = selectedProjectId;
  }
  if (!state.projects.length) document.querySelector('#run-form button').disabled = true;
  if (state.authenticated) document.querySelector('[name="requestedBy"]').closest('label').hidden = true;
  if (!state.meta.profiles.length) {
    select.append(el('option', { text: 'No execution profile enabled', attrs: { value: '' } }));
    document.querySelector('#run-form button').disabled = true;
  } else for (const profile of state.meta.profiles) select.append(el('option', { text: `${profile.label} — ${profile.description}`, attrs: { value: profile.id } }));
  document.querySelector('#run-form').addEventListener('submit', createRun);
  planProjectSelect.addEventListener('change', () => {
    state.projectContextId = planProjectSelect.value || null;
    syncEnterpriseDesignNavigation();
    syncExecutionRoute(state.projectContextId);
    void loadPlanningProject(planProjectSelect.value);
  });
  document.querySelector('#process-plan-form').addEventListener('submit', createProcessPlan);
  document.querySelector('#plan-process').addEventListener('change', updatePlanButtonLabel);
  if (state.projects.length) void loadPlanningProject(planProjectSelect.value, preferredProcessId, planTarget);
}

async function loadPlanningProject(projectId, preferredProcessId = null, planTarget = null) {
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
    else if (preferredProcessId) {
      syncExecutionRoute(projectId);
      notify('The selected saved process is no longer available. Choose a current process to continue.');
    }
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
      try {
        state.taskInstances = (await api(`/api/execution/process-task-instances?projectId=${encodeURIComponent(projectId)}`)).instances;
      } catch { state.taskInstances = []; }
    } else {
      state.taskInstances = [];
    }
    let restoredPlanTarget = planTarget;
    if (restoredPlanTarget) {
      const planExists = (project.processPlans ?? []).some((plan) => plan.id === restoredPlanTarget.processPlanId
        && plan.revision === restoredPlanTarget.revision);
      const instanceExists = state.taskInstances.some((runtime) => runtime.projectId === projectId
        && runtime.processPlanId === restoredPlanTarget.processPlanId && runtime.revision === restoredPlanTarget.revision
        && runtime.planInstanceId === restoredPlanTarget.planInstanceId)
        || state.runs.some((run) => run.projectId === projectId && run.processTaskRef?.processPlanId === restoredPlanTarget.processPlanId
          && run.processTaskRef?.revision === restoredPlanTarget.revision && run.processTaskRef?.planInstanceId === restoredPlanTarget.planInstanceId);
      if (!planExists || !instanceExists) {
        state.selectedPlanInstances.set(restoredPlanTarget.selectionKey, 'new');
        restoredPlanTarget = null;
        syncExecutionRoute(projectId);
        notify('The linked plan revision or instance is no longer available.');
      }
    }
    renderProcessPlans(plansPanel, project.processPlans ?? [], project);
    updatePlanButtonLabel();
    if (restoredPlanTarget && !focusLinkedPlanInstance(restoredPlanTarget)) {
      notify('The linked plan revision or instance is no longer available.');
    }
  } catch (error) { notify(error.message); }
}

function focusLinkedPlanInstance(target) {
  const card = [...document.querySelectorAll('.process-plan')].find((candidate) =>
    candidate.dataset.processPlanId === target.processPlanId
      && Number(candidate.dataset.planRevision) === target.revision);
  const instanceSelect = card?.querySelector('select[aria-label^="Process instance for"]');
  if (!instanceSelect || instanceSelect.value !== target.planInstanceId) return false;
  card.scrollIntoView?.({ block: 'nearest' });
  instanceSelect.focus({ preventScroll: true });
  return document.activeElement === instanceSelect;
}

function openLinkedProcessPlan(run) {
  const target = selectLinkedProcessPlanInstance(run, state.projects, state.selectedPlanInstances);
  if (!target) return;
  state.projectContextId = target.projectId;
  syncEnterpriseDesignNavigation(target.projectId);
  syncExecutionRoute(target.projectId, target);
  showNew({ planTarget: target });
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

function renderProcessPlans(container, plans, project, { allowNewInstances = true, showHistory = true } = {}) {
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
    const card = el('section', { className: 'run-section process-plan', attrs: {
      'aria-label': `Planned graph for ${plan.source.processName}`,
      'data-process-plan-id': plan.id,
      'data-plan-revision': plan.revision ?? 1,
    } }, [
      el('h4', { text: `${plan.source.processName} · blueprint v${plan.source.blueprintVersion} · graph revision ${plan.revision ?? 1}` }),
      el('p', { text: 'Proposed design · planned only · not dispatched' }),
    ]);
    const planControls = el('div', { className: 'process-plan-controls' });
    const sourceLink = sourceProcessDesignLink(plan, project);
    if (sourceLink) planControls.append(el('a', { className: 'button', text: sourceLink.label, attrs: { href: sourceLink.href } }));
    if (allowNewInstances) {
      const editButton = el('button', { className: 'button', text: 'Edit planned graph', attrs: { type: 'button' } });
      editButton.addEventListener('click', () => openPlanEditor(card, plan, project));
      planControls.append(editButton);
    }
    if (planControls.childElementCount) card.append(planControls);
    const tasks = new Map(plan.tasks.map((task) => [task.id, task]));
    const planRuns = state.runs.filter((run) => run.projectId === project.id && run.processTaskRef?.processPlanId === plan.id
      && run.processTaskRef?.revision === plan.revision);
    const planRuntimes = state.taskInstances.filter((runtime) => runtime.projectId === project.id
      && runtime.processPlanId === plan.id && runtime.revision === plan.revision);
    const instances = new Map();
    for (const runtime of planRuntimes) {
      const id = runtime.planInstanceId;
      const rows = instances.get(id) ?? [];
      rows.push(runtime); instances.set(id, rows);
    }
    for (const run of planRuns) {
      const id = run.processTaskRef.planInstanceId;
      if (instances.has(id)) continue;
      instances.set(id, [{
        planInstanceId: id, processPlanId: plan.id, revision: plan.revision,
        taskId: run.processTaskRef.taskId, status: run.status, executionRunId: run.id,
        createdAt: run.createdAt, updatedAt: run.updatedAt,
      }]);
    }
    const instanceKey = `${plan.id}\n${plan.revision}`;
    const latestInstance = [...instances.entries()].sort((left, right) => {
      const leftAt = Math.max(...left[1].map((runtime) => Date.parse(runtime.updatedAt ?? runtime.createdAt) || 0));
      const rightAt = Math.max(...right[1].map((runtime) => Date.parse(runtime.updatedAt ?? runtime.createdAt) || 0));
      return rightAt - leftAt;
    })[0]?.[0] ?? 'new';
    let selectedInstance = state.selectedPlanInstances.get(instanceKey) ?? latestInstance;
    if (selectedInstance !== 'new' && !instances.has(selectedInstance)) {
      selectedInstance = latestInstance;
      state.selectedPlanInstances.set(instanceKey, latestInstance);
    }
    const instanceSelect = el('select', { attrs: { 'aria-label': `Process instance for ${plan.source.processName}` } });
    instanceSelect.append(el('option', { text: allowNewInstances ? 'Start a new instance' : 'Earlier revision · existing instances only', attrs: { value: 'new', ...(selectedInstance === 'new' ? { selected: 'selected' } : {}), ...(!allowNewInstances ? { disabled: 'disabled' } : {}) } }));
    for (const [instanceId, runtimes] of instances) {
      const finished = runtimes.filter((runtime) => ['SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CANCELLED'].includes(runtime.status)).length;
      instanceSelect.append(el('option', {
        text: `Instance ${instanceId.slice(0, 8)} · ${runtimes.length} task${runtimes.length === 1 ? '' : 's'} · ${finished} terminal`,
        attrs: { value: instanceId, ...(selectedInstance === instanceId ? { selected: 'selected' } : {}) },
      }));
    }
    instanceSelect.addEventListener('change', () => {
      state.selectedPlanInstances.set(instanceKey, instanceSelect.value);
      syncExecutionRoute(project.id, instanceSelect.value === 'new' ? null : {
        projectId: project.id, processPlanId: plan.id, revision: plan.revision,
        planInstanceId: instanceSelect.value,
      });
      renderProcessPlans(container, plans, project);
    });
    card.append(el('label', { text: 'Process instance' }, instanceSelect));
    const currentInstanceRuntimes = selectedInstance === 'new' ? [] : instances.get(selectedInstance) ?? [];
    const instanceControl = currentInstanceRuntimes[0]?.instanceControl ?? null;
    if (instanceControl) {
      const canControlInstance = state.authenticated && instanceControl.canControl === true;
      const controlSummary = el('p', { className: 'muted', text: `Instance control: ${instanceControl.status.replaceAll('_', ' ')}${instanceControl.pauseReason ? ` · ${instanceControl.pauseReason}` : ''}` });
      card.append(controlSummary);
      if (instanceControl.pauseBoundary?.tasks?.length) {
        const boundary = instanceControl.pauseBoundary.tasks.map((task) =>
          `${task.taskId}${task.runId ? ` · run ${task.runId.slice(-8)} · instruction revision ${task.instructionRevision}` : ` · ${task.status}`}${task.attemptStatus ? ` · provider ${task.attemptStatus}` : ''}`,
        ).join('; ');
        card.append(el('p', { className: 'muted', text: `Recorded pause boundary: ${boundary}` }));
      }
      if (instanceControl.events?.length) {
        const history = el('details', { className: 'process-instance-history' }, [el('summary', { text: 'Instance control history' })]);
        history.append(el('ul', {}, instanceControl.events.map((event) => el('li', {
          text: `${event.type} · ${event.actor} · ${new Date(event.at).toLocaleString()}${event.data?.reason ? ` · ${event.data.reason}` : ''}${event.type === 'ProcessTaskInstanceAbandonedUnverified' ? ` · Runs: ${(event.data?.runIds ?? []).join(', ') || 'none'} · Attempts: ${(event.data?.attemptIds ?? []).join(', ') || 'none'} · Evidence: ${(event.data?.evidence ?? []).join(' | ') || 'none'} · Duplicate cost/work acknowledged: ${event.data?.acknowledgeDuplicateCostWork === true ? 'yes' : 'no'}` : ''}`,
        }))));
        card.append(history);
      }
      if (instanceControl.status === 'PAUSE_REQUESTED') {
        card.append(el('p', { className: 'muted', text: 'Pause is pending while in-flight tasks settle. Provider requests already handed off are not canceled; unknown outcomes remain unresolved.' }));
        if (!canControlInstance) card.append(el('p', { className: 'muted', text: 'Only the instance initiator or a current project owner can control this process.' }));
        if (instanceControl.canAbandonUnverified === true) card.append(renderAbandonUnverifiedForm({ project, instanceId: selectedInstance, control: instanceControl }));
        else if (instanceControl.pauseBoundary?.tasks?.some((task) => task.attemptStatus === 'outcome_unknown')) {
          card.append(el('p', { className: 'muted', text: 'This unknown provider result cannot be cleared through this control. Terminal abandonment is limited to read-only OpenAI model proposals; other provider or effect-capable work requires reconciliation before any new work.' }));
        }
      } else if (instanceControl.status === 'PAUSED') {
        card.append(el('p', { className: 'muted', text: 'This instance is paused at its recorded boundary. Resuming rechecks dependencies and authority; paused agent requests need fresh independent approval.' }));
        if (canControlInstance) card.append(renderInstanceControlForm({ project, instanceId: selectedInstance, control: instanceControl, action: 'resume' }));
        else card.append(el('p', { className: 'muted', text: 'Only the instance initiator or a current project owner can control this process.' }));
        if (instanceControl.canAbandonUnverified === true) card.append(renderAbandonUnverifiedForm({ project, instanceId: selectedInstance, control: instanceControl }));
      } else if (instanceControl.status === 'ABANDONED_UNVERIFIED') {
        card.append(el('p', { className: 'muted', text: 'This instance is closed as ABANDONED_UNVERIFIED. The old model output is unverified; the provider call may have completed and may have incurred cost. This instance cannot resume. Retrying requires a distinct new process instance and fresh independent approval.' }));
      } else if (instanceControl.status === 'ACTIVE' && canControlInstance) {
        card.append(renderInstanceControlForm({ project, instanceId: selectedInstance, control: instanceControl, action: 'pause' }));
      } else if (instanceControl.status === 'ACTIVE') {
        card.append(el('p', { className: 'muted', text: 'Only the instance initiator or a current project owner can control this process.' }));
      }
    }
    card.append(
      el('p', { className: 'muted', text: 'Task state comes from the durable process runtime. Agent requests wait for independent approval; human tasks record an assigned person’s checkpoint. Neither action is automatic.' }),
      el('p', { className: 'muted', text: 'The blueprint agent binding is recorded for traceability. A selected configured profile runs through the OrgWard worker after separate approval; it does not execute as or impersonate the bound workload.' }),
    );
    const list = el('ol');
    for (const task of plan.tasks) {
      const dependencies = task.dependencies.map((id) => tasks.get(id)?.title).filter(Boolean);
      const inputs = task.inputs.map((item) => item.label).join(', ') || 'None specified';
      const outputs = task.outputs.map((item) => item.label).join(', ') || 'None specified';
      const roleText = taskAssigneePresentation(task, plan, project);
      const selectedRuntimes = selectedInstance === 'new' ? [] : instances.get(selectedInstance) ?? [];
      const runtimeState = deriveProcessTaskState(task, selectedRuntimes, selectedInstance === 'new' ? null : selectedInstance);
      const runtime = runtimeState.runtime;
      const instancePaused = instanceControl?.status === 'PAUSED';
      const instanceFenced = instanceControl && instanceControl.status !== 'ACTIVE';
      const instanceAbandoned = instanceControl?.status === 'ABANDONED_UNVERIFIED';
      const linkedRun = runtime?.executionRunId ? state.runs.find((candidate) => candidate.id === runtime.executionRunId) ?? null : null;
      const dependenciesSucceeded = runtimeState.dependenciesSucceeded;
      const item = el('li');
      item.append(el('strong', { text: `${task.title} — ${runtimeState.status}` }));
      item.append(
        el('p', { text: task.detail }),
        el('p', { text: `Depends on: ${dependencies.join(', ') || 'No upstream process dependency'}` }),
        el('p', { text: `Inputs: ${inputs}` }), el('p', { text: `Outputs: ${outputs}` }),
        el('p', { text: `Role reference: ${roleText}` }),
      );
      const pinnedBlueprint = project.blueprintVersions?.find((entry) => entry.id === plan.source.blueprintId
        && entry.version === plan.source.blueprintVersion);
      const taskActor = Object.values(pinnedBlueprint?.areas ?? {}).flatMap((area) => area.items ?? [])
        .find((candidate) => candidate.id === task.assignee?.actorId);
      const isHumanTask = taskActor?.type === 'actor-human';
      if (instanceAbandoned) {
        item.append(el('p', { className: 'muted', text: 'This old model result is unverified and cannot advance work. Start a distinct process instance and obtain fresh independent approval before retrying.' }));
      } else if (linkedRun) {
        const openRun = el('button', { className: 'button', text: `Open linked run ${linkedRun.id.slice(-8)}`, attrs: { type: 'button' } });
        openRun.addEventListener('click', () => { void load(linkedRun.id); });
        item.append(el('p', { text: `Approval request ${linkedRun.id} · ${linkedRun.status.replaceAll('_', ' ')}` }), openRun);
      } else if (isHumanTask) {
        if (runtime?.outcome?.result) {
          item.append(el('p', { text: `Human checkpoint result: ${runtime.outcome.result}. Evidence: ${runtime.evidence.join(' · ') || 'none recorded'}` }));
        }
        const latestEscalation = [...(runtime?.events ?? [])].reverse().find((event) =>
          event.type === 'HumanTaskEscalated' || event.type === 'HumanTaskEscalationResolved');
        if (latestEscalation) {
          const escalationEvidence = latestEscalation.data?.evidence?.join(' · ') || 'None recorded';
          item.append(el('p', { className: 'muted', text: `${latestEscalation.type === 'HumanTaskEscalated' ? 'Escalation' : `Owner ${latestEscalation.data?.disposition ?? 'resolution'}`} · ${latestEscalation.data?.reason ?? 'No reason recorded'} · Evidence: ${escalationEvidence}` }));
        }
        if (instanceAbandoned) {
          item.append(el('p', { className: 'muted', text: 'This process instance is terminal; no human task can start or resolve in it.' }));
        } else if (runtime?.status === 'ESCALATED') {
          if (instanceControl?.status === 'PAUSED') {
            item.append(el('p', { className: 'muted', text: 'This process instance is paused. Resume it before a project owner resolves the escalated checkpoint.' }));
          } else if (runtime.canResolveEscalation) {
            item.append(
              el('p', { className: 'muted', text: 'Project owner resolution is required before this human task can continue. Resume rechecks the original assigned human and pinned enabled binding.' }),
              renderHumanTaskEscalationResolution({ project, plan, task, selectedInstance }),
            );
          } else {
            item.append(el('p', { className: 'muted', text: 'Escalated and awaiting a project owner with workspace write access. The assigned human cannot complete it until an owner resolves it.' }));
          }
        } else if (instancePaused) {
          item.append(el('p', { className: 'muted', text: 'Process instance pause is pending or complete; no new human task work can start.' }));
        } else if (runtime?.status === 'IN_PROGRESS' && runtime.assignedToCurrentPrincipal) {
          item.append(
            renderHumanTaskCompletion({ project, plan, task, selectedInstance }),
            renderHumanTaskEscalation({ project, plan, task, selectedInstance }),
          );
        } else if (runtime?.status === 'IN_PROGRESS') {
          item.append(el('p', { className: 'muted', text: 'The assigned human has started this task. Only that bound identity can record its outcome.' }));
        } else if (instanceControl?.status === 'PAUSE_REQUESTED') {
          item.append(el('p', { className: 'muted', text: 'Pause is draining active work; no new human task work can start.' }));
        } else if (['SUCCEEDED', 'FAILED', 'INTERRUPTED'].includes(runtime?.status)) {
          item.append(el('p', { className: 'muted', text: 'This human checkpoint is complete for this process instance. A retry requires a new process instance.' }));
        } else if (selectedInstance === 'new' && task.dependencies.length > 0) {
          item.append(el('p', { className: 'muted', text: 'A dependent human task must join an existing process instance after every dependency succeeds.' }));
        } else if (selectedInstance === 'new' && (!allowNewInstances || entries.at(-1)?.revision !== plan.revision
          || project.latestBlueprint?.version !== plan.source.blueprintVersion)) {
          item.append(el('p', { className: 'muted', text: 'A new human task instance requires the latest saved graph revision and current blueprint.' }));
        } else if (!dependenciesSucceeded) {
          item.append(el('p', { className: 'muted', text: 'Dependencies must succeed in this instance before the assigned human can start this task.' }));
        } else if (!state.authenticated) {
          item.append(el('p', { className: 'muted', text: 'Sign in as the enabled assigned human with workspace write access to start this checkpoint.' }));
        } else if (runtime && !runtime.assignedToCurrentPrincipal) {
          item.append(el('p', { className: 'muted', text: 'This task runtime is pinned to its assigned human and cannot be started by another identity.' }));
        } else {
          const startButton = el('button', { className: 'button primary', text: 'Start assigned human task', attrs: { type: 'button' } });
          startButton.addEventListener('click', () => { void startHumanTask({ project, plan, task, selectedInstance, button: startButton }); });
          item.append(
            el('p', { className: 'muted', text: 'Only the enabled human bound to this blueprint actor can start and complete the task. Starting records work in progress; it grants no agent or platform authority.' }),
            startButton,
          );
        }
      } else {
        const assignment = currentTaskAssignment(task, plan, project, selectedInstance !== 'new');
        const hasProposalInputs = task.inputs?.length > 0 && task.outputs?.some((output) => output.type === 'information');
        const profileOptions = (state.meta?.profiles ?? []).filter((profile) => profile.kind !== 'provider-openai' || hasProposalInputs);
        const canStartNew = allowNewInstances && selectedInstance === 'new' && task.dependencies.length === 0
          && entries.at(-1)?.revision === plan.revision
          && project.latestBlueprint?.version === plan.source.blueprintVersion;
        const eligibleInInstance = selectedInstance !== 'new' && dependenciesSucceeded;
        const canRequest = state.authenticated && !instanceFenced && assignment.available && profileOptions.length > 0
          && (canStartNew || eligibleInInstance);
        if (!assignment.available) {
          item.append(el('p', { className: 'muted', text: assignment.reason }));
        } else if (!state.authenticated) {
          item.append(el('p', { className: 'muted', text: 'Sign in with workspace write access to request approval for an assigned task.' }));
        } else if (selectedInstance === 'new' && task.dependencies.length) {
          item.append(el('p', { className: 'muted', text: 'Start a root task first; dependent tasks join its instance after their dependencies succeed.' }));
        } else if (selectedInstance === 'new' && !canStartNew) {
          item.append(el('p', { className: 'muted', text: 'A new instance requires the latest graph revision and current saved blueprint.' }));
        } else if (selectedInstance !== 'new' && !dependenciesSucceeded) {
          item.append(el('p', { className: 'muted', text: 'Dependencies must succeed in this instance before this task can start.' }));
        }
        if (!profileOptions.length) {
          item.append(el('p', { className: 'muted', text: 'No local configured execution profile is available for a task-linked approval request.' }));
        } else if (canRequest) {
          const profileSelect = el('select', { attrs: { 'aria-label': `Configured execution profile for ${task.title}` } });
          for (const profile of profileOptions) profileSelect.append(el('option', {
            text: `${profile.label} · ${profile.kind}`,
            attrs: { value: profile.id },
          }));
          const requestButton = el('button', {
            className: 'button primary',
            text: state.pendingTaskRuns.has(`${plan.id}\n${plan.revision}\n${task.id}`) ? 'Retry same approval request' : 'Create approval request',
            attrs: { type: 'button' },
          });
          requestButton.addEventListener('click', () => {
            void requestTaskApproval({ project, plan, task, selectedInstance, profileId: profileSelect.value, requestButton });
          });
          const profileDisclosure = el('p', { className: 'muted' });
          const updateProfileDisclosure = () => {
            profileDisclosure.textContent = profileSelect.selectedOptions[0]?.textContent.includes('provider-openai')
              ? 'After independent approval, this OpenAI profile receives the saved task instructions, its pinned input record content and source notes, and the selected output context. It does not receive unrelated project records or credential material. The result is a review-only cited proposal.'
              : 'This records the assigned agent reference; the configured local profile runs under the OrgWard worker after separate approval, not as the bound workload identity.';
          };
          profileSelect.addEventListener('change', updateProfileDisclosure);
          updateProfileDisclosure();
          item.append(
            profileDisclosure, el('label', { text: 'Configured execution profile' }, profileSelect), requestButton,
          );
        }
      }
      list.append(item);
    }
    if (showHistory && entries.length > 1) {
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
    if (showHistory) {
      for (const earlier of entries.slice(0, -1).reverse()) {
        if (!state.taskInstances.some((runtime) => runtime.projectId === project.id
          && runtime.processPlanId === earlier.id && runtime.revision === earlier.revision)
          && !state.runs.some((run) => run.projectId === project.id && run.processTaskRef?.processPlanId === earlier.id
            && run.processTaskRef?.revision === earlier.revision)) continue;
        const historicalContainer = document.createElement('div');
        renderProcessPlans(historicalContainer, [earlier], project, { allowNewInstances: false, showHistory: false });
        const historicalCard = historicalContainer.firstElementChild;
        if (!historicalCard) continue;
        historicalCard.querySelector('h4').textContent += ' · pinned existing instance';
        historicalCard.querySelector('p').textContent = 'Earlier immutable graph revision · existing instances only';
        container.append(historicalCard);
      }
    }
  }
}

function renderInstanceControlForm({ project, instanceId, control, action }) {
  const form = el('form', { className: 'execution-form process-instance-control', attrs: {
    'aria-label': action === 'pause' ? 'Pause process instance' : 'Resume process instance',
  } });
  let reason = null;
  if (action === 'pause') {
    reason = el('textarea', { attrs: { name: 'reason', required: 'required', maxlength: '500', rows: '2', 'aria-label': 'Reason for pausing process instance' } });
    form.append(el('p', { className: 'muted', text: 'Pause blocks new starts and approvals. Already dispatched work remains in flight until its outcome is known.' }),
      el('label', { text: 'Reason (required)' }, reason));
  }
  const button = el('button', { className: action === 'resume' ? 'button primary' : 'button',
    text: action === 'pause' ? 'Pause process instance' : 'Resume process instance', attrs: { type: 'submit' } });
  form.append(button);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const reasonText = reason?.value.trim() ?? '';
    const key = `${instanceId}:${action}:${control.version}:${reasonText}`;
    let pending = state.pendingInstanceCommands.get(key);
    if (!pending) {
      pending = { commandId: `process-instance-${action}:${crypto.randomUUID()}` };
      state.pendingInstanceCommands.set(key, pending);
    }
    button.disabled = true;
    void api(`/api/execution/process-task-instances/${action}`, {
      method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', commandId: pending.commandId,
        payload: { projectId: project.id, planInstanceId: instanceId, version: control.version,
          ...(action === 'pause' ? { reason: reasonText } : {}) } }),
    }).then(async (result) => {
      state.pendingInstanceCommands.delete(key);
      notify(action === 'pause'
        ? result.status === 'PAUSED' ? 'Process instance paused.' : 'Pause requested; waiting for in-flight work to settle.'
        : 'Process instance resumed. Paused agent requests require fresh independent approval.');
      await refresh();
    }).catch((error) => notify(error.message)).finally(() => { button.disabled = false; });
  });
  return form;
}

function renderAbandonUnverifiedForm({ project, instanceId, control }) {
  const form = el('form', { className: 'execution-form process-instance-abandonment', attrs: {
    'aria-label': 'Close process instance with unverified model result',
  } });
  const reason = el('textarea', { attrs: { name: 'reason', required: 'required', maxlength: '1000', rows: '2',
    'aria-label': 'Reason for closing with unverified model result' } });
  const evidence = el('textarea', { attrs: { name: 'evidence', required: 'required', maxlength: '4000', rows: '3',
    'aria-label': 'Evidence checked before closing' } });
  const acknowledgement = el('input', { attrs: { type: 'checkbox', required: 'required', name: 'acknowledgeDuplicateCostWork' } });
  const button = el('button', { className: 'button', text: 'Close as unverified', attrs: { type: 'submit' } });
  form.append(
    el('p', { className: 'muted', text: 'The old model output is unverified. The provider call may have completed and may have incurred cost. This terminal action preserves the unknown attempt and will not resume this instance.' }),
    el('p', { className: 'muted', text: 'Retry only by starting a distinct new process instance and obtaining fresh independent approval. The new call could duplicate cost or work.' }),
    el('label', { text: 'Reason (required)' }, reason),
    el('label', { text: 'Evidence reviewed (one note per line, required)' }, evidence),
    el('label', { text: 'I acknowledge retry may duplicate cost or work', attrs: { className: 'checkbox-label' } }, acknowledgement),
    button,
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const reasonText = reason.value.trim();
    const evidenceEntries = evidence.value.split('\n').map((entry) => entry.trim()).filter(Boolean);
    if (!reasonText || evidenceEntries.length < 1 || evidenceEntries.length > 20 || !acknowledgement.checked) return;
    const key = `${instanceId}:abandon-unverified:${control.version}:${reasonText}:${evidenceEntries.join('\n')}`;
    let pending = state.pendingInstanceCommands.get(key);
    if (!pending) {
      pending = { commandId: `process-instance-abandon-unverified:${crypto.randomUUID()}` };
      state.pendingInstanceCommands.set(key, pending);
    }
    button.disabled = true;
    void api('/api/execution/process-task-instances/abandon-unverified', {
      method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', commandId: pending.commandId,
        payload: { projectId: project.id, planInstanceId: instanceId, version: control.version,
          reason: reasonText, evidence: evidenceEntries, acknowledgeDuplicateCostWork: true } }),
    }).then(async () => {
      state.pendingInstanceCommands.delete(key);
      notify('Instance closed as ABANDONED_UNVERIFIED. The old output is not verified; use a distinct instance and fresh approval to retry.');
      await refresh();
    }).catch((error) => notify(error.message)).finally(() => { button.disabled = false; });
  });
  return form;
}

function renderHumanTaskCompletion({ project, plan, task, selectedInstance }) {
  const form = el('form', { className: 'execution-form human-task-completion', attrs: { 'aria-label': `Complete assigned human task ${task.title}` } });
  form.append(el('p', { className: 'muted', text: 'A succeeded human checkpoint requires at least one brief evidence note; a failed outcome may include evidence optionally.' }));
  const result = el('select', { attrs: { name: 'result', required: 'required', 'aria-label': `Outcome for ${task.title}` } }, [
    el('option', { text: 'Succeeded', attrs: { value: 'succeeded' } }),
    el('option', { text: 'Failed', attrs: { value: 'failed' } }),
  ]);
  const evidence = el('textarea', { attrs: { name: 'evidence', maxlength: '1000', rows: '3', 'aria-label': `Evidence for ${task.title}` } });
  const evidenceLabel = el('label', { text: 'Evidence note (required)' }, evidence);
  const updateEvidenceRequirement = () => {
    const required = result.value === 'succeeded';
    evidence.required = required;
    evidenceLabel.firstChild.textContent = required ? 'Evidence note (required)' : 'Evidence note (optional)';
  };
  updateEvidenceRequirement();
  result.addEventListener('change', updateEvidenceRequirement);
  const submit = el('button', { className: 'button primary', text: 'Complete human task', attrs: { type: 'submit' } });
  form.append(el('label', { text: 'Outcome' }, result), evidenceLabel, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void completeHumanTask({ project, plan, task, selectedInstance, result: result.value, evidence: evidence.value, button: submit });
  });
  return form;
}

function renderHumanTaskEscalation({ project, plan, task, selectedInstance }) {
  const form = el('form', { className: 'execution-form human-task-escalation', attrs: { 'aria-label': `Escalate assigned human task ${task.title}` } });
  form.append(el('p', { className: 'muted', text: 'Escalation pauses this task until a project owner reviews and resolves it.' }));
  const reason = el('textarea', { attrs: { name: 'reason', required: 'required', maxlength: '1000', rows: '2', 'aria-label': `Escalation reason for ${task.title}` } });
  const evidence = el('textarea', { attrs: { name: 'evidence', maxlength: '1000', rows: '2', 'aria-label': `Escalation evidence for ${task.title}` } });
  const submit = el('button', { className: 'button', text: 'Escalate to project owner', attrs: { type: 'submit' } });
  form.append(el('label', { text: 'Reason (required)' }, reason), el('label', { text: 'Evidence (optional)' }, evidence), submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void escalateHumanTask({ project, plan, task, selectedInstance, reason: reason.value, evidence: evidence.value, button: submit });
  });
  return form;
}

function renderHumanTaskEscalationResolution({ project, plan, task, selectedInstance }) {
  const form = el('form', { className: 'execution-form human-task-escalation-resolution', attrs: { 'aria-label': `Resolve escalated human task ${task.title}` } });
  const disposition = el('select', { attrs: { name: 'disposition', required: 'required', 'aria-label': `Owner resolution for ${task.title}` } }, [
    el('option', { text: 'Resume assigned human task', attrs: { value: 'resume' } }),
    el('option', { text: 'Mark succeeded', attrs: { value: 'succeeded' } }),
    el('option', { text: 'Mark failed', attrs: { value: 'failed' } }),
  ]);
  const reason = el('textarea', { attrs: { name: 'reason', required: 'required', maxlength: '1000', rows: '2', 'aria-label': `Owner resolution reason for ${task.title}` } });
  const evidence = el('textarea', { attrs: { name: 'evidence', maxlength: '1000', rows: '2', 'aria-label': `Owner verification evidence for ${task.title}` } });
  const syncEvidenceRequirement = () => { evidence.required = disposition.value === 'succeeded'; };
  disposition.addEventListener('change', syncEvidenceRequirement);
  syncEvidenceRequirement();
  const submit = el('button', { className: 'button primary', text: 'Resolve escalation', attrs: { type: 'submit' } });
  form.append(
    el('p', { className: 'muted', text: 'Only a project owner with workspace write access can resolve this escalation. Marking succeeded requires verification or work evidence.' }),
    el('label', { text: 'Resolution' }, disposition),
    el('label', { text: 'Owner reason (required)' }, reason),
    el('label', { text: 'Verification or work evidence' }, evidence), submit,
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void resolveHumanTaskEscalation({
      project, plan, task, selectedInstance, disposition: disposition.value,
      reason: reason.value, evidence: evidence.value, button: submit,
    });
  });
  return form;
}

function humanTaskCommandKey(action, plan, task, instanceId) {
  return `${action}\n${plan.id}\n${plan.revision}\n${instanceId}\n${task.id}`;
}

async function startHumanTask({ project, plan, task, selectedInstance, button }) {
  const key = humanTaskCommandKey('start', plan, task, selectedInstance);
  button.disabled = true;
  try {
    let pending = state.pendingHumanTaskCommands.get(key);
    if (!pending) {
      pending = {
        commandId: `human-task-start:${crypto.randomUUID()}`,
        payload: {
          projectId: project.id, planId: plan.id, revision: plan.revision, taskId: task.id,
          ...(selectedInstance !== 'new' ? { planInstanceId: selectedInstance } : {}),
        },
      };
      state.pendingHumanTaskCommands.set(key, pending);
    }
    const runtime = await api('/api/execution/process-task-instances/start', {
      method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', commandId: pending.commandId, payload: pending.payload }),
    });
    state.pendingHumanTaskCommands.delete(key);
    state.selectedPlanInstances.set(`${plan.id}\n${plan.revision}`, runtime.planInstanceId);
    syncExecutionRoute(project.id, {
      projectId: project.id, processPlanId: plan.id, revision: plan.revision,
      planInstanceId: runtime.planInstanceId,
    });
    await refresh();
    notify('Human task started. Its assigned identity, start time and task history were saved.');
  } catch (error) {
    if (!error.retryable) state.pendingHumanTaskCommands.delete(key);
    notify(error.retryable ? 'The start result is uncertain. Retry this same task command.' : error.message);
  } finally { button.disabled = false; }
}

async function completeHumanTask({ project, plan, task, selectedInstance, result, evidence, button }) {
  const key = humanTaskCommandKey('complete', plan, task, selectedInstance);
  button.disabled = true;
  try {
    let pending = state.pendingHumanTaskCommands.get(key);
    if (!pending) {
      pending = {
        commandId: `human-task-complete:${crypto.randomUUID()}`,
        payload: {
          projectId: project.id, planId: plan.id, revision: plan.revision,
          planInstanceId: selectedInstance, taskId: task.id, result,
          evidence: evidence.trim() ? [evidence.trim()] : [],
        },
      };
      state.pendingHumanTaskCommands.set(key, pending);
    }
    await api('/api/execution/process-task-instances/complete', {
      method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', commandId: pending.commandId, payload: pending.payload }),
    });
    state.pendingHumanTaskCommands.delete(key);
    await refresh();
    notify('Human task outcome and evidence were saved to its process runtime.');
  } catch (error) {
    if (!error.retryable) state.pendingHumanTaskCommands.delete(key);
    notify(error.retryable ? 'The completion result is uncertain. Retry this same task command.' : error.message);
  } finally { button.disabled = false; }
}

async function submitHumanTaskAction({ action, project, plan, task, selectedInstance, details, button, success }) {
  const key = humanTaskCommandKey(action, plan, task, selectedInstance);
  button.disabled = true;
  try {
    let pending = state.pendingHumanTaskCommands.get(key);
    if (!pending) {
      pending = {
        commandId: `human-task-${action}:${crypto.randomUUID()}`,
        payload: {
          projectId: project.id, planId: plan.id, revision: plan.revision,
          planInstanceId: selectedInstance, taskId: task.id, ...details,
        },
      };
      state.pendingHumanTaskCommands.set(key, pending);
    }
    await api(`/api/execution/process-task-instances/${action}`, {
      method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', commandId: pending.commandId, payload: pending.payload }),
    });
    state.pendingHumanTaskCommands.delete(key);
    await refresh();
    notify(success);
  } catch (error) {
    if (!error.retryable) state.pendingHumanTaskCommands.delete(key);
    notify(error.retryable ? `The ${action} result is uncertain. Retry this same task command.` : error.message);
  } finally { button.disabled = false; }
}

function escalateHumanTask({ project, plan, task, selectedInstance, reason, evidence, button }) {
  return submitHumanTaskAction({
    action: 'escalate', project, plan, task, selectedInstance, button,
    details: { reason: reason.trim(), evidence: evidence.trim() ? [evidence.trim()] : [] },
    success: 'Human task escalated to its project owner; the task is paused pending resolution.',
  });
}

function resolveHumanTaskEscalation({ project, plan, task, selectedInstance, disposition, reason, evidence, button }) {
  return submitHumanTaskAction({
    action: 'resolve', project, plan, task, selectedInstance, button,
    details: { disposition, reason: reason.trim(), evidence: evidence.trim() ? [evidence.trim()] : [] },
    success: `Project owner saved the ${disposition} resolution for the human task.`,
  });
}

function taskAssigneePresentation(task, plan, project) {
  if (task.assignee?.kind === 'role-reference') return `${task.assignee.roleName} · role reference only; no person selected`;
  if (task.assignee?.kind !== 'blueprint-actor') return 'No role or actor reference';
  const blueprint = project?.blueprintVersions?.find((entry) => entry.id === plan.source.blueprintId
    && entry.version === plan.source.blueprintVersion);
  const actor = Object.values(blueprint?.areas ?? {}).flatMap((area) => area.items ?? [])
    .find((item) => item.id === task.assignee.actorId);
  const actorLabel = actor?.name ?? 'Unknown blueprint actor';
  if (actor?.type === 'actor-human') return `${actorLabel} · human checkpoint; only the enabled bound human can start after dependencies succeed`;
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

function currentTaskAssignment(task, plan, project, pinnedInstance = false) {
  const assignee = task.assignee;
  if (assignee?.kind !== 'blueprint-actor' || !assignee.actorId || !assignee.roleId) {
    return { available: false, reason: 'Assign a blueprint actor and role in a new graph revision before requesting approval.' };
  }
  const pinnedBlueprint = project.blueprintVersions?.find((entry) => entry.id === plan.source.blueprintId
    && entry.version === plan.source.blueprintVersion);
  const actor = Object.values(pinnedBlueprint?.areas ?? {}).flatMap((area) => area.items ?? [])
    .find((item) => item.id === assignee.actorId);
  if (actor?.type === 'actor-human') {
    return { available: false, reason: 'Human tasks use the separate assigned-person checkpoint flow and are not executor runs.' };
  }
  if (actor?.type !== 'actor-agent') {
    return { available: false, reason: 'The pinned task actor is not an executable agent assignment.' };
  }
  if (!pinnedInstance && project.latestBlueprint?.version !== plan.source.blueprintVersion) {
    return { available: false, reason: 'The task assignment is pinned to an older blueprint. Create a new graph revision before starting a new instance.' };
  }
  if (state.actorBindingProjectId !== project.id || !state.actorBindingReadAvailable) {
    return { available: false, reason: 'Current actor binding eligibility is unavailable; an owner or editor must resolve the binding first.' };
  }
  const binding = state.actorBindingRows.find((row) => row.blueprintVersion === plan.source.blueprintVersion
    && row.actorId === assignee.actorId && row.roleId === assignee.roleId);
  const pinnedStillEligible = pinnedInstance && binding?.targetStatus === 'active_project_member'
    && binding.eligibilityStatus?.every((value) => value === 'stale_blueprint');
  if (binding?.status !== 'enabled'
    || (!pinnedStillEligible && (binding.eligibilityStatus?.length !== 1 || binding.eligibilityStatus[0] !== 'eligible'))) {
    return { available: false, reason: 'A current enabled actor binding is required before requesting approval for this task.' };
  }
  return { available: true, binding };
}

async function requestTaskApproval({ project, plan, task, selectedInstance, profileId, requestButton }) {
  const key = `${plan.id}\n${plan.revision}\n${task.id}`;
  requestButton.disabled = true;
  try {
    let pending = state.pendingTaskRuns.get(key);
    if (!pending) {
      const payload = {
        projectId: project.id, planId: plan.id, revision: plan.revision,
        taskId: task.id, profileId,
        ...(selectedInstance !== 'new' ? { planInstanceId: selectedInstance } : {}),
      };
      pending = { commandId: `process-task-request:${crypto.randomUUID()}`, payload };
      state.pendingTaskRuns.set(key, pending);
    }
    const run = await api('/api/execution/process-task-runs', {
      method: 'POST',
      body: JSON.stringify({ schemaVersion: '1.0', commandId: pending.commandId, payload: pending.payload }),
    });
    state.pendingTaskRuns.delete(key);
    state.selectedPlanInstances.set(`${plan.id}\n${plan.revision}`, run.processTaskRef.planInstanceId);
    syncExecutionRoute(project.id, {
      projectId: project.id, processPlanId: plan.id, revision: plan.revision,
      planInstanceId: run.processTaskRef.planInstanceId,
    });
    state.run = run;
    await refresh();
    renderRun();
    renderList();
    notify('Approval request created for the assigned task. No work was dispatched; the selected profile will run through the OrgWard worker, not as the bound workload.');
  } catch (error) {
    if (error.retryable && state.pendingTaskRuns.has(key)) {
      requestButton.textContent = 'Retry same approval request';
      notify('The request result is uncertain. Retry the same approval command to recover its saved run.');
    } else {
      state.pendingTaskRuns.delete(key);
      notify(error.message);
    }
  } finally { requestButton.disabled = false; }
}

function openPlanEditor(container, plan, project) {
  if (!project) return notify('Reload the project before editing this graph.');
  container.querySelector('.plan-editor')?.remove();
  const pendingKey = `${project.id}\n${plan.id}\nrevision`;
  const pendingRevision = state.pendingProcessPlans.get(pendingKey);
  const pendingEdits = new Map((pendingRevision?.payload.tasks ?? []).map((edit) => [edit.taskId, edit]));
  const pendingCheckpoint = pendingRevision?.payload.humanCheckpoint ?? null;
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
  const checkpointSet = el('fieldset', { className: 'plan-task-editor' });
  checkpointSet.append(el('legend', { text: 'Insert a required human checkpoint' }));
  const beforeTask = el('select', { attrs: { name: 'checkpoint:before', 'aria-label': 'Insert human checkpoint before task' } });
  beforeTask.append(el('option', { text: 'Do not insert a checkpoint', attrs: { value: '' } }));
  for (const task of plan.tasks) beforeTask.append(el('option', {
    text: `Before: ${task.title}`, attrs: { value: task.id, ...(pendingCheckpoint?.beforeTaskId === task.id ? { selected: 'selected' } : {}) },
  }));
  checkpointSet.append(el('label', { text: 'Task that must wait for this checkpoint' }, beforeTask));
  const checkpointTitle = el('input', { attrs: { maxlength: '120', name: 'checkpoint:title', value: pendingCheckpoint?.title ?? '', ...(pendingCheckpoint ? { required: 'required' } : {}) } });
  checkpointSet.append(el('label', { text: 'Checkpoint title' }, checkpointTitle));
  const checkpointDetail = el('textarea', { attrs: { maxlength: '700', name: 'checkpoint:detail', rows: '3', ...(pendingCheckpoint ? { required: 'required' } : {}) } });
  checkpointDetail.value = pendingCheckpoint?.detail ?? '';
  checkpointSet.append(el('label', { text: 'What the assigned person must verify' }, checkpointDetail));
  const humanBinding = el('select', { attrs: { name: 'checkpoint:binding', 'aria-label': 'Enabled bound human and blueprint role for checkpoint', ...(pendingCheckpoint ? { required: 'required' } : {}) } });
  humanBinding.append(el('option', { text: 'Choose an enabled human assignment', attrs: { value: '' } }));
  const pinnedActorById = new Map(pinnedObjects.map((item) => [item.id, item]));
  const humanBindings = state.actorBindingRows.filter((row) => row.blueprintVersion === plan.source.blueprintVersion
    && row.status === 'enabled' && row.eligibilityStatus?.length === 1 && row.eligibilityStatus[0] === 'eligible'
    && pinnedActorById.get(row.actorId)?.type === 'actor-human' && roles.some((role) => role.id === row.roleId));
  for (const row of humanBindings) {
    const actor = pinnedActorById.get(row.actorId);
    const role = roles.find((entry) => entry.id === row.roleId);
    const value = `${row.actorId}\n${row.roleId}`;
    humanBinding.append(el('option', { text: `${actor.name} → ${role.name} (${row.targetName})`, attrs: {
      value, ...(pendingCheckpoint?.actorId === row.actorId && pendingCheckpoint?.roleId === row.roleId ? { selected: 'selected' } : {}),
    } }));
  }
  checkpointSet.append(el('label', { text: 'Bound human and role' }, humanBinding));
  checkpointSet.append(el('p', { className: 'muted', text: 'The new task inherits the selected task’s existing dependencies. That task waits for the assigned human to complete the checkpoint with evidence in the same instance. Saving creates a new immutable graph revision; prior revisions and instances stay pinned.' }));
  beforeTask.addEventListener('change', () => {
    const required = Boolean(beforeTask.value);
    for (const control of [checkpointTitle, checkpointDetail, humanBinding]) control.required = required;
  });
  form.append(checkpointSet);
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
      const payload = { tasks: edits };
      const checkpointTarget = String(formData.get('checkpoint:before') ?? '');
      if (checkpointTarget) {
        const binding = String(formData.get('checkpoint:binding') ?? '').split('\n');
        payload.humanCheckpoint = {
          beforeTaskId: checkpointTarget,
          title: String(formData.get('checkpoint:title') ?? ''),
          detail: String(formData.get('checkpoint:detail') ?? ''),
          actorId: binding[0] ?? '', roleId: binding[1] ?? '',
        };
      }
      pending = getOrCreatePlanRevisionCommand(state.pendingProcessPlans, projectId, planId, currentProject, payload, () => `process-plan-revision-${crypto.randomUUID()}`);
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
  try {
    state.run = await api(`/api/execution/runs/${id}`);
    if (state.authenticated && state.run.processTaskRef && state.run.projectId) {
      try {
        state.taskInstances = (await api(`/api/execution/process-task-instances?projectId=${encodeURIComponent(state.run.projectId)}`)).instances;
      } catch { state.taskInstances = []; }
    }
    await loadProposalApplication(state.run);
    renderRun(); renderList();
  }
  catch (error) { notify(error.message); }
}

async function loadProposalApplication(run, project = null) {
  const proposal = run?.execution?.generatedProposal;
  state.runProject = null;
  state.proposalMembershipAccess = null;
  if (!proposal || !run.projectId) return;
  let savedProject = project;
  try {
    savedProject ??= (await api(`/api/v1/projects/${encodeURIComponent(run.projectId)}`)).data;
  } catch {
    run.proposalApplication = deriveBlueprintProposalReviewState({ proposal, project: null });
    return;
  }
  state.runProject = savedProject;
  if (state.authenticated && state.currentPrincipal) {
    try {
      const members = (await api(`/api/v1/projects/${encodeURIComponent(run.projectId)}/members`)).data;
      state.proposalMembershipAccess = members.find((member) => member.principal === state.currentPrincipal)?.access ?? null;
    } catch {
      // Readers may not be allowed to read the roster; they can still review the saved proposal.
      state.proposalMembershipAccess = null;
    }
  }
  const applied = (savedProject.events ?? []).find((event) => event.type === 'BlueprintProposalApplied'
    && event.data?.proposalHash === proposal.proposalHash);
  run.proposalApplication = deriveBlueprintProposalReviewState({
    proposal, project: savedProject, membershipAccess: state.proposalMembershipAccess, appliedEvent: applied,
  });
}

async function command(action, body) {
  const button = document.querySelector(`[data-action="${action}"]`); if (button) button.disabled = true;
  try {
    state.run = await api(`/api/execution/runs/${state.run.id}/${action}`, { method: 'POST', body: JSON.stringify({ version: state.run.version, ...body }) });
    await loadProposalApplication(state.run);
    await refresh(); renderRun(); notify(action === 'execute' ? 'Execution finished and evidence was saved.' : 'Independent approval recorded.');
  } catch (error) { notify(error.message); if (button) button.disabled = false; }
}

async function withdrawLinkedRun() {
  const run = state.run;
  if (!run?.processTaskRef || !state.currentPrincipal || run.requestedBy !== state.currentPrincipal) return;
  let pending = state.pendingRunCancellations.get(run.id);
  if (!pending) {
    pending = { commandId: crypto.randomUUID(), version: run.version };
    state.pendingRunCancellations.set(run.id, pending);
  }
  const button = document.querySelector('[data-action="cancel"]');
  if (button) button.disabled = true;
  try {
    const cancelled = await api(`/api/execution/runs/${run.id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ commandId: pending.commandId, version: pending.version, projectId: run.projectId }),
    });
    state.pendingRunCancellations.delete(run.id);
    state.run = cancelled;
    await refresh(); renderRun();
    notify(cancelled.meta?.replayed ? 'The saved withdrawal was restored.' : 'The request was withdrawn before work started.');
  } catch (error) {
    if (error.status && error.status < 500) state.pendingRunCancellations.delete(run.id);
    notify(error.message);
    if (button) button.disabled = false;
  }
}

function canRecoverLinkedRun(run) {
  return Boolean(run?.processTaskRef && state.taskInstances.some((runtime) =>
    runtime.projectId === run.projectId && runtime.planInstanceId === run.processTaskRef.planInstanceId
      && runtime.instanceControl?.status === 'ACTIVE' && runtime.instanceControl.canRecover === true));
}

async function changeLinkedRunPause(action, reason = null) {
  const run = state.run;
  const ownerRecovery = action === 'resume' && run?.requestedBy !== state.currentPrincipal && canRecoverLinkedRun(run);
  if (!run?.processTaskRef || !state.currentPrincipal || (run.requestedBy !== state.currentPrincipal && !ownerRecovery)
    || !['pause', 'resume'].includes(action)) return;
  const key = `${run.id}:${action}`;
  let pending = state.pendingRunPauses.get(key);
  if (!pending) {
    pending = { commandId: crypto.randomUUID(), version: run.version, projectId: run.projectId,
      ...(reason ? { reason: reason.trim() } : {}) };
    state.pendingRunPauses.set(key, pending);
  }
  const button = document.querySelector(`[data-action="${action}"]`);
  if (button) button.disabled = true;
  try {
    const updated = await api(`/api/execution/runs/${run.id}/${action}`, {
      method: 'POST',
      body: JSON.stringify(pending),
    });
    state.pendingRunPauses.delete(key);
    state.run = updated;
    await refresh(); renderRun();
    if (action === 'pause') {
      notify(updated.meta?.replayed ? 'The saved pause was restored.'
        : 'The request is paused before dispatch. Resume will require fresh independent approval.');
    } else {
      notify(updated.meta?.replayed ? 'The saved resume was restored.'
        : 'The request is ready for fresh independent approval.');
    }
  } catch (error) {
    if (error.status && error.status < 500) state.pendingRunPauses.delete(key);
    notify(error.message);
    if (button) button.disabled = false;
  }
}

async function amendLinkedRun(form) {
  const run = state.run;
  if (!run?.processTaskRef || run.status !== 'PAUSED' || !state.currentPrincipal || run.requestedBy !== state.currentPrincipal) return;
  const values = Object.fromEntries(new FormData(form));
  const key = run.id;
  let pending = state.pendingRunAmendments.get(key);
  if (!pending) {
    pending = { commandId: crypto.randomUUID(), version: run.version, projectId: run.projectId };
    state.pendingRunAmendments.set(key, pending);
  }
  const button = form.querySelector('[type="submit"]');
  if (button) button.disabled = true;
  try {
    const updated = await api(`/api/execution/runs/${run.id}/amend`, {
      method: 'POST',
      body: JSON.stringify({ ...pending, objective: values.objective,
        requirements: values.requirements.split('\n').map((entry) => entry.trim()).filter(Boolean), reason: values.reason }),
    });
    state.pendingRunAmendments.delete(key);
    state.run = updated;
    await refresh(); renderRun();
    notify(updated.meta?.replayed ? 'The saved instruction amendment was restored.'
      : 'Instructions saved as a new revision. Resume will require fresh independent approval.');
  } catch (error) {
    if (error.status && error.status < 500) state.pendingRunAmendments.delete(key);
    notify(error.message);
    if (button) button.disabled = false;
  }
}

function section(title, children) { return el('section', { className: 'run-section' }, [el('h3', { text: title }), ...(Array.isArray(children) ? children : [children])]); }

async function applyGeneratedProposal() {
  const run = state.run;
  const proposal = run?.execution?.generatedProposal;
  if (!proposal || !run.projectId || !state.authenticated || !run.proposalApplication?.canApply) return;
  let pending = state.pendingProposalApplies.get(run.id);
  if (!pending) {
    pending = {
      commandId: `blueprint-proposal-apply:${crypto.randomUUID()}`,
      expectedVersion: state.runProject?.version,
      proposalHash: proposal.proposalHash,
    };
    state.pendingProposalApplies.set(run.id, pending);
  }
  if (!Number.isInteger(pending.expectedVersion)) {
    notify('Load the current project version before applying this proposal.');
    return;
  }
  const button = document.querySelector('[data-action="apply-proposal"]');
  if (button) button.disabled = true;
  try {
    const result = await api(`/api/v1/projects/${encodeURIComponent(run.projectId)}/blueprint-proposals/${encodeURIComponent(run.id)}/apply`, {
      method: 'POST', body: JSON.stringify({
        schemaVersion: '1.0', commandId: pending.commandId, expectedVersion: pending.expectedVersion,
        payload: { proposalHash: pending.proposalHash },
      }),
    });
    state.pendingProposalApplies.delete(run.id);
    state.runProject = result.data;
    const appliedEvent = (result.data.events ?? []).find((event) => event.type === 'BlueprintProposalApplied'
      && event.data?.proposalHash === proposal.proposalHash);
    run.proposalApplication = deriveBlueprintProposalReviewState({
      proposal, project: result.data, membershipAccess: 'owner', appliedEvent,
    });
    if (state.planningProject?.id === result.data.id) state.planningProject = result.data;
    await refresh(); renderRun();
    notify('The owner applied this review-only proposal as a new proposed blueprint version.');
  } catch (error) {
    if (proposalApplyFailureDisposition(error) === 'reconcile') {
      state.pendingProposalApplies.delete(run.id);
      try {
        state.run = await api(`/api/execution/runs/${encodeURIComponent(run.id)}`);
        await loadProposalApplication(state.run);
        await refresh().catch(() => {});
        renderRun();
      } catch {
        state.run = run;
        state.runProject = null;
        state.proposalMembershipAccess = null;
        run.proposalApplication = deriveBlueprintProposalReviewState({ proposal, project: null });
        renderRun();
      }
    } else {
      const retryButton = document.querySelector('[data-action="apply-proposal"]');
      if (retryButton) retryButton.disabled = false;
    }
    notify(error.message);
  }
}

function renderGeneratedProposal(proposal, application) {
  const applied = application?.status === 'applied';
  const canApply = application?.canApply === true;
  const stale = application?.status === 'stale';
  const content = [
    el('p', { className: 'muted', text: applied
      ? `Applied to proposed blueprint v${application.blueprintVersion}. This status comes from the project’s append-only apply event.`
      : stale
        ? application.message
        : application?.status === 'project-unavailable'
          ? application.message
          : 'Review-only generated content. It is not verified evidence, approval, permission, or a signal to execute work.' }),
    el('p', { text: `Target: ${proposal.target.name} · ${proposal.target.field}` }),
    el('p', { text: `Before: ${proposal.target.before}` }),
    el('p', { text: `Proposed: ${proposal.proposedDetail}` }),
    el('p', { text: `Rationale: ${proposal.rationale}` }),
    el('p', { className: 'muted', text: `Pinned blueprint v${proposal.blueprintVersion} · ${proposal.provider.provider} / ${proposal.provider.model} · proposal hash ${proposal.proposalHash}` }),
  ];
  content.push(el('h4', { text: 'Cited saved task inputs' }));
  content.push(el('ul', {}, proposal.citations.map((citation) => el('li', { text: `${citation.name} (${citation.type}) · ${citation.id} · ${citation.hash}` }))));
  const designLink = proposalDesignLink(state.runProject, application);
  if (designLink) content.push(el('a', { className: 'button', text: designLink.label, attrs: { href: designLink.href } }));
  if (canApply) {
    const button = el('button', { className: 'button primary', text: 'Apply as new proposed blueprint version', attrs: { type: 'button', 'data-action': 'apply-proposal' } });
    button.addEventListener('click', () => { void applyGeneratedProposal(); });
    content.push(el('p', { className: 'muted', text: 'As a workspace owner, you can apply this proposal as a new immutable version. It does not change assignments, permissions, or task status.' }));
    content.push(button);
  } else if (!applied && !stale && application?.status !== 'project-unavailable') {
    content.push(el('p', { className: 'muted', text: application?.message
      ?? 'A workspace owner can apply this proposal as a new immutable proposed version. Other project members can review it here.' }));
  }
  return section('Generated blueprint proposal', content);
}

function renderRun() {
  const run = state.run; main.replaceChildren();
  const effectiveInstructions = run.interventionRevisions?.at(-1) ?? run.workItem;
  const panel = el('section', { className: 'execution-panel' }, [
    el('div', { className: 'run-heading' }, [el('div', {}, [el('span', { className: 'eyebrow', text: `${run.profile.kind} · run revision ${run.version}` }), el('h2', { text: run.title })]), el('span', { className: `run-status status-${run.status}`, text: run.status.replaceAll('_', ' ') })]),
    el('p', { className: 'objective', text: effectiveInstructions.objective }),
  ]);
  if (run.processTaskRef) {
    const ref = run.processTaskRef;
    const processTaskDetails = [
      el('p', { text: `${ref.processName} · graph revision ${ref.revision} · blueprint v${ref.blueprintVersion}` }),
      el('p', { text: `Task ${ref.taskId} · instance ${ref.planInstanceId}` }),
      el('p', { text: `Blueprint assignment reference ${ref.actorId} → role ${ref.roleId}. The durable task runtime supplies progress; the saved plan graph remains immutable.` }),
      el('p', { className: 'muted', text: 'This run uses its selected configured profile through the OrgWard worker after independent approval; it does not execute as or impersonate the bound workload identity.' }),
    ];
    if (linkedProcessPlanTarget(run, state.projects)) {
      const openPlan = el('button', { className: 'button', text: 'Open linked plan instance', attrs: { type: 'button', 'data-action': 'open-linked-plan' } });
      openPlan.addEventListener('click', () => openLinkedProcessPlan(run));
      processTaskDetails.push(openPlan);
    }
    panel.append(section('Saved process task', processTaskDetails));
  }
  panel.append(section('Approval boundary', approvalControls(run)));
  panel.append(section('Requirements', effectiveInstructions.requirements.length ? el('ul', { className: 'requirements' }, effectiveInstructions.requirements.map((entry) => el('li', { text: entry }))) : el('p', { className: 'muted', text: 'No acceptance requirements supplied.' })));
  if (run.execution) panel.append(section('Execution evidence', executionEvidence(run.execution, run.id)));
  if (run.execution?.generatedProposal) panel.append(renderGeneratedProposal(run.execution.generatedProposal, run.proposalApplication));
  panel.append(section('Append-only activity', el('div', { className: 'run-events' }, run.events.slice().reverse().map((entry) => {
    const details = [el('b', { text: entry.type }), el('span', { text: `${new Date(entry.at).toLocaleString()} · ${entry.actor}` })];
    if (entry.type === 'ExecutionInstructionsAmended') {
      const revision = entry.data?.revision;
      if (revision) details.push(
        el('p', { text: `Instruction revision ${revision.revision} · ${revision.reason}` }),
        el('p', { text: revision.objective }),
        el('ul', { className: 'requirements' }, (revision.requirements ?? []).map((requirement) => el('li', { text: requirement }))),
      );
    }
    if (entry.type === 'ExecutionResumed' && entry.data?.ownerRecovery) {
      details.push(el('p', { className: 'muted', text: `Project owner recovery · ${entry.data.reason}` }));
    }
    return el('div', {}, details);
  }))));
  main.append(panel);
}

function approvalControls(run) {
  const canWithdraw = Boolean(run.processTaskRef && state.currentPrincipal && run.requestedBy === state.currentPrincipal);
  const pauseButton = (label = 'Pause before dispatch') => {
    const pending = state.pendingRunPauses.get(`${run.id}:pause`);
    const button = el('button', { className: 'button', text: pending ? 'Retry pause' : label, attrs: { type: 'button', 'data-action': 'pause' } });
    button.addEventListener('click', () => { void changeLinkedRunPause('pause'); });
    return button;
  };
  const resumeButton = () => {
    const pending = state.pendingRunPauses.get(`${run.id}:resume`);
    const button = el('button', { className: 'button primary', text: pending ? 'Retry resume' : 'Resume for fresh approval', attrs: { type: 'button', 'data-action': 'resume' } });
    button.addEventListener('click', () => { void changeLinkedRunPause('resume'); });
    return button;
  };
  const ownerRecoveryForm = () => {
    const pending = state.pendingRunPauses.get(`${run.id}:resume`);
    const form = el('form', { className: 'execution-form owner-recovery-form' }, [
      el('p', { className: 'muted', text: 'As current project owner, reopen this paused task for fresh independent approval. The original requester and task history stay attached.' }),
      el('label', {}, ['Reason for owner recovery', el('textarea', { attrs: { name: 'reason', required: true, maxlength: '500', rows: '2' }, text: pending?.reason ?? '' })]),
      el('button', { className: 'button primary', text: pending ? 'Retry owner recovery' : 'Reopen for fresh approval', attrs: { type: 'submit' } }),
    ]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const reason = String(new FormData(form).get('reason') ?? '').trim();
      if (reason) void changeLinkedRunPause('resume', reason);
    });
    return form;
  };
  const withdrawalButton = () => {
    const pending = state.pendingRunCancellations.get(run.id);
    const button = el('button', { className: 'button', text: pending ? 'Retry withdrawal' : 'Withdraw request', attrs: { type: 'button', 'data-action': 'cancel' } });
    button.addEventListener('click', () => { void withdrawLinkedRun(); });
    return button;
  };
  if (run.status === 'AWAITING_APPROVAL') {
    const wrap = el('div', { className: 'approval-box' }, [el('p', { text: `Requested by ${run.requestedBy}. A different identity with execution-approver authority must approve the immutable request. The requester can pause it before dispatch.` })]);
    const button = el('button', { className: 'button primary', text: 'Approve execution', attrs: { type: 'button', 'data-action': 'approve' } });
    if (state.authenticated) button.addEventListener('click', () => command('approve', {}));
    else {
      const input = el('input', { attrs: { value: 'studio-governor', 'aria-label': 'Approver identity', maxlength: '120' } });
      button.addEventListener('click', () => command('approve', { principal: input.value, roles: ['execution-approver'] }));
      wrap.append(el('div', { className: 'inline-action' }, [input, button]));
      return wrap;
    }
    wrap.append(button);
    if (canWithdraw) wrap.append(pauseButton());
    if (canWithdraw) wrap.append(withdrawalButton());
    return wrap;
  }
  if (run.status === 'APPROVED') {
    const button = el('button', { className: 'button primary', text: 'Execute approved profile', attrs: { type: 'button', 'data-action': 'execute' } });
    button.addEventListener('click', () => command('execute', state.authenticated ? {} : { principal: 'local-execution-worker' }));
    return [el('p', { text: `Approved by ${run.approval.principal}. The profile executable and arguments are server-controlled. Pausing now clears this approval; resume requires a new independent approval.` }), button,
      ...(canWithdraw ? [pauseButton('Pause and require new approval')] : []),
      ...(canWithdraw ? [withdrawalButton()] : [])];
  }
  if (run.processTaskRef && run.status === 'PAUSED') {
    const revision = run.interventionRevisions?.at(-1) ?? run.workItem;
    const canOwnerRecover = run.requestedBy !== state.currentPrincipal && canRecoverLinkedRun(run);
    const amendForm = el('form', { className: 'execution-form' }, [
      el('label', {}, ['Amended objective', el('textarea', { attrs: { name: 'objective', required: true, maxlength: '4000', rows: '4' }, text: revision.objective })]),
      el('label', {}, ['Requirements, one per line', el('textarea', { attrs: { name: 'requirements', maxlength: '26000', rows: '4' }, text: revision.requirements.join('\n') })]),
      el('label', {}, ['Reason for change', el('textarea', { attrs: { name: 'reason', required: true, maxlength: '1000', rows: '2' } })]),
      el('button', { className: 'button', text: 'Save new instruction revision', attrs: { type: 'submit' } }),
    ]);
    amendForm.addEventListener('submit', (event) => { event.preventDefault(); void amendLinkedRun(amendForm); });
    return el('div', {}, [
      el('p', { text: 'This linked request is paused before dispatch. You can add a reasoned instruction revision; the saved plan remains unchanged. Resume rechecks the task assignment, dependencies, profile and credential generation. Any instruction revision requires fresh independent approval.' }),
      ...(canWithdraw ? [amendForm] : []),
      ...(canWithdraw ? [resumeButton(), withdrawalButton()] : []),
      ...(canOwnerRecover ? [ownerRecoveryForm()] : []),
    ]);
  }
  if (run.processTaskRef && run.status === 'RUNNING') {
    return el('div', {}, [
      el('p', { text: run.approval ? `Approved by ${run.approval.principal} at ${new Date(run.approval.approvedAt).toLocaleString()}.` : 'Execution is running.' }),
      el('p', { className: 'muted', text: 'This request has started. Pause, resume and withdrawal apply only before dispatch; wait for worker completion or recovery to see its outcome.' }),
    ]);
  }
  if (run.processTaskRef && run.status === 'CANCELLED') {
    return el('p', { text: 'The requester withdrew this linked task before work started. A retry requires a new plan instance.' });
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

document.querySelector('#new-run').addEventListener('click', () => showNew());
try {
  const [meta, projectResult] = await Promise.all([api('/api/execution/meta'), api('/api/v1/projects')]);
  const session = await api('/auth/session');
  state.meta = meta; state.projects = projectResult.data; state.authenticated = session.authenticated;
  state.currentPrincipal = session.principal ?? null;
  const projectContext = executionProjectContext(window.location.href, state.projects);
  const routePlan = linkedPlanInstanceRouteTarget(window.location.href, state.projects);
  const routeProcess = executionProcessTarget(window.location.href, state.projects);
  const planTarget = routePlan.target;
  const processTarget = routeProcess.target;
  state.projectContextId = planTarget?.projectId ?? processTarget?.projectId ?? projectContext.projectId;
  syncEnterpriseDesignNavigation();
  await refresh();
  if (routePlan.requested && !planTarget) notify('The linked plan revision or instance is no longer available.');
  if (routeProcess.requested && !processTarget) notify('The selected saved process is no longer available. Choose a current process to continue.');
  if (planTarget) showNew({ planTarget });
  else if (processTarget) showNew({ preferredProcessId: processTarget.processId, preserveProcessRoute: true });
  else if (projectContext.projectId) showNew();
  else if (state.runs.length) await load(state.runs[0].id);
  else showNew();
} catch (error) { notify(error.message); }
