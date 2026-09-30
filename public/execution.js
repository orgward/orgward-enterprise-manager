import { getOrCreatePlanRevisionCommand, getOrCreateProcessPlanCommand, processPlanCommandKey, processPlanFailureDisposition } from './process-plan-command.mjs';
import { deriveProcessTaskState } from './process-task-state.mjs';
import { processTaskStatusAnnouncement, scheduleProcessTaskAnnouncement, summarizeBlockedTaskTransitions } from './process-task-announcement.mjs';
import { humanTaskHistoryEntries } from './human-task-history.mjs';
import { humanTaskEffectiveAssigneePresentation } from './human-task-effective-assignee.mjs';
import { humanTaskEscalationResolutionOptions } from './human-task-escalation-resolution.mjs';
import { humanTaskInputDisclosureKey, humanTaskInputDisclosureOpen, processTaskHumanInputReview,
  rememberHumanTaskInputDisclosure } from './human-task-input-review.mjs';
import { humanTaskOutputApplicationState, humanTaskOutputCommand } from './human-task-output-application.mjs';
import { parseHumanTaskEvidence } from './human-task-evidence.mjs';
import { submitHumanTaskCommand } from './human-task-command-ui.mjs';
import { definitiveHumanTaskStartRejection, humanTaskActionFailureDisposition } from './human-task-action-failure.mjs';
import { processInstanceControlHistoryEntries } from './process-instance-history.mjs';
import { orderProcessInstancesByLatestActivity, processInstanceOptionLabel } from './process-instance-option-label.mjs';
import { applySettledProcessInstanceCommands, clearSettledProcessInstanceCommands, processInstanceCommandKey, refreshAfterProcessInstanceControl, restoreProcessInstanceControlPresentation, submitProcessInstanceControl } from './process-instance-control.mjs';
import { clearSettledLinkedRunAmendment, refreshLinkedRunAmendment, restoreLinkedRunAmendment, submitLinkedRunAmendment } from './linked-run-amendment.mjs';
import { restoreHumanTaskStatusFocus } from './human-task-status-focus.mjs';
import { isRunActionKeyboardActivation, restoreRunTransitionFocus } from './run-transition-focus.mjs';
import { deepSeekOutcomeDiagnosticCopy } from './provider-outcome-diagnostic.mjs';
import { isCurrentProcessInstanceRefresh, processInstanceRefreshDisposition, processInstanceRefreshMessage,
  processInstanceStatusAnnouncement, updateProcessInstanceRefreshStatus } from './process-instance-refresh.mjs';
import { isCurrentSelectedRunRefresh, selectedRunRefreshDisposition, selectedRunRefreshMessage, selectedRunStatusAnnouncement } from './selected-run-refresh.mjs';
import { linkedProcessTaskResult, modelUsagePresentation } from './linked-process-task-result.mjs';
import { linkedRunActivityLabel } from './linked-run-activity.mjs';
import { captureExpandedSavedTaskResultKeys, captureFocusedSavedTaskResult, restoreFocusedSavedTaskResult,
  restoreSavedTaskResultOpen, savedTaskResultDisclosureKey } from './saved-task-result-disclosure.mjs';
import { blockedProcessTaskRecoveryCopy, processTaskRecoveryAction, selectFreshProcessTaskInstance } from './process-task-recovery.mjs';
import { processTaskAssignmentTransparency } from './process-task-assignment.mjs';
import { processTaskGuidanceReview } from './process-task-guidance-review.mjs';
import { processTaskSourceReview } from './process-task-source-review.mjs';
import { deriveBlueprintProposalReviewState, HUMAN_PROPOSAL_RUBRIC, proposalApplyFailureDisposition, proposalDesignLink } from './proposal-review-state.mjs';
import { acceptProcessTaskRequest, clearPendingProcessTaskRequest, findPendingProcessTaskRequest,
  processTaskRequestPresentation, processTaskRequestReconciled, processTaskRequestStorageKey,
  readPendingProcessTaskRequest, reconciledSavedProcessTaskRequests, savePendingProcessTaskRequest } from './process-task-request.mjs';
import { acceptHumanTaskStart, clearHumanTaskStart, humanTaskStartCommandKey, humanTaskStartPresentation,
  humanTaskStartReconciled, humanTaskStartStorageKey, readHumanTaskStart, restoreHumanTaskStarts,
  saveHumanTaskStart } from './human-task-start-recovery.mjs';
import { setDomAttributes } from './dom-attributes.mjs';
import { boundedLineDiff, readBoundedUtf8Response } from './repository-text-diff.mjs';
import { encodeExecutionRoute, encodeStudioRoute, executionProcessTarget, executionProjectContext, executionRunRouteTarget } from './shared-interactions.mjs';
import { currentProcessPlanFocusTarget, linkedPlanInstanceRouteTarget, linkedProcessPlanTarget, processPlanFreshness, processPlanRevisionFocusTarget, selectLinkedProcessPlanInstance, sourceProcessDesignLink } from './process-plan-navigation.mjs';

const state = {
  meta: null, projects: [], runs: [], taskInstances: [], runtimePlans: [], localRepositories: [], run: null, runProject: null, proposalMembershipAccess: null, authenticated: false, currentPrincipal: null, planningProject: null, projectContextId: null,
  actorBindingRows: [], actorBindingProjectId: null, actorBindingReadAvailable: false,
  selectedPlanInstances: new Map(),
  processTaskStatuses: new Map(),
};
state.pendingProcessPlans = new Map();
state.pendingTaskRuns = new Map();
state.submittingTaskRequests = new Set();
state.pendingHumanTaskCommands = new Map();
state.pendingHumanTaskOutputApplications = new Map();
state.submittingHumanTaskStarts = new Set();
state.expandedHumanTaskInputs = new Set();
state.pendingRunCancellations = new Map();
state.pendingRunPauses = new Map();
state.pendingRunAmendments = new Map();
state.pendingInstanceCommands = new Map();
state.pendingProposalApplies = new Map();
state.pendingProposalReviews = new Map();
const main = document.querySelector('#execution-main');
const list = document.querySelector('#run-list');
const toast = document.querySelector('#execution-toast');
const processInstanceAnnouncement = document.querySelector('#process-instance-announcement');
const executionAnnouncement = document.querySelector('#execution-announcement');
let processRefreshRequestId = 0;
let deferredProcessInstances = null;
let selectedRunRefreshRequestId = 0;
let deferredSelectedRun = null;
let selectedRunWaitMessage = '';

function processPlansFor(project = state.planningProject) {
  const base = project?.processPlans ?? [];
  const runtime = state.runtimePlans.filter((plan) => plan.source?.projectId === project?.id);
  const revisions = new Set(base.map((plan) => `${plan.id}\n${plan.revision ?? 1}`));
  return [...base, ...runtime.filter((plan) => !revisions.has(`${plan.id}\n${plan.revision ?? 1}`))];
}

function setProcessRefreshStatus(message) {
  const projectId = state.planningProject?.id ?? null;
  const routeKey = `${window.location.pathname}${window.location.search}`;
  updateProcessInstanceRefreshStatus({ visibleRegion: document.querySelector('#process-instance-refresh-status'),
    liveRegion: processInstanceAnnouncement }, message, {
    isCurrent: () => state.planningProject?.id === projectId
      && `${window.location.pathname}${window.location.search}` === routeKey,
  });
}

function noteProjectRefreshUnavailable() {
  const warning = 'Project design update status could not be refreshed; process activity can still refresh. Will retry automatically.';
  const current = document.querySelector('#process-instance-refresh-status')?.textContent ?? '';
  if (!current.includes(warning)) setProcessRefreshStatus(current ? `${current} ${warning}` : warning);
}

function reconcileAcceptedProcessTaskRequests(runs, instances, projectId) {
  let reconciled = false;
  for (const [key, pending] of state.pendingTaskRuns) {
    if (pending?.status !== 'accepted' || pending.acceptedProcessTaskRef?.projectId !== projectId
      || pending.acceptedProcessTaskRef?.tenantId !== state.planningProject?.tenantId
      || pending.acceptedProcessTaskRef?.principal !== state.currentPrincipal
      || !processTaskRequestReconciled(pending, { runs, instances })) continue;
    const ref = pending.acceptedProcessTaskRef;
    state.selectedPlanInstances.set(`${ref.processPlanId}\n${ref.revision}`, ref.planInstanceId);
    state.pendingTaskRuns.delete(key);
    clearPendingProcessTaskRequest(processTaskIntentStorage(), key);
    reconciled = true;
  }
  for (const { key, pending } of reconciledSavedProcessTaskRequests(processTaskIntentStorage(), {
    tenantId: state.planningProject?.tenantId, principal: state.currentPrincipal, projectId, runs, instances,
  })) {
    const ref = pending.acceptedProcessTaskRef;
    state.selectedPlanInstances.set(`${ref.processPlanId}\n${ref.revision}`, ref.planInstanceId);
    state.pendingTaskRuns.delete(key);
    clearPendingProcessTaskRequest(processTaskIntentStorage(), key);
    reconciled = true;
  }
  return reconciled;
}

function syncHumanTaskStarts(project, plan) {
  const scope = { tenantId: project.tenantId, principal: state.currentPrincipal, projectId: project.id,
    planId: plan.id, revision: plan.revision };
  const restored = restoreHumanTaskStarts(processTaskIntentStorage(), scope);
  for (const { commandKey, pending } of restored) {
    if (!state.pendingHumanTaskCommands.has(commandKey)) state.pendingHumanTaskCommands.set(commandKey, pending);
  }
  const candidates = new Map(restored
    .map((entry) => [entry.commandKey, entry.pending]));
  for (const [commandKey, pending] of state.pendingHumanTaskCommands) {
    if (commandKey.startsWith(`start\n${plan.id}\n${plan.revision}\n`)
      && pending?.tenantId === project.tenantId && pending.principal === state.currentPrincipal
      && pending.payload?.projectId === project.id) candidates.set(commandKey, pending);
  }
  for (const [commandKey, pending] of candidates) {
    if (!humanTaskStartReconciled(pending, { tenantId: project.tenantId, principal: state.currentPrincipal,
      projectId: project.id, instances: state.taskInstances })) continue;
    state.pendingHumanTaskCommands.delete(commandKey);
    clearHumanTaskStart(processTaskIntentStorage(), humanTaskStartStorageKey({ tenantId: pending.tenantId,
      principal: pending.principal, projectId: pending.payload.projectId, planId: pending.payload.planId,
      revision: pending.payload.revision, planInstanceId: pending.payload.planInstanceId ?? null,
      taskId: pending.payload.taskId }));
  }
  return [...candidates.entries()].filter(([commandKey, pending]) => state.pendingHumanTaskCommands.has(commandKey)
    && pending?.tenantId === project.tenantId && pending.principal === state.currentPrincipal
    && pending.payload?.projectId === project.id && pending.payload?.planId === plan.id
    && pending.payload?.revision === plan.revision).map(([commandKey, pending]) => ({ commandKey, pending }));
}

function setTaskRequestControls({ requestButton, profileSelect, repositorySelect, status, pending, submitting = false,
  recoveringNewInstance = false }) {
  const presentation = processTaskRequestPresentation(pending, { submitting, recoveringNewInstance });
  if (profileSelect) profileSelect.disabled = presentation.locked;
  if (repositorySelect) repositorySelect.disabled = presentation.locked;
  requestButton.disabled = presentation.buttonDisabled;
  requestButton.textContent = presentation.buttonLabel;
  if (status) status.textContent = presentation.status;
}

function applyCrossSessionProcessInstances(instances, projectId, runtimePlans = state.runtimePlans, projectRuns = [],
  projectSnapshot = state.planningProject, expectedRouteKey = null, projectRefreshUnavailable = false) {
  const plans = document.querySelector('#process-plans');
  const route = new URL(window.location.href);
  const routeProjectId = route.searchParams.get('project') || null;
  if (state.planningProject?.id !== projectId || (routeProjectId && routeProjectId !== projectId)
    || projectSnapshot?.id !== projectId
    || (expectedRouteKey && `${window.location.pathname}${window.location.search}` !== expectedRouteKey) || !plans) return false;
  const disposition = processInstanceRefreshDisposition({ currentInstances: state.taskInstances,
    nextInstances: instances,
    currentRuns: state.runs.filter((run) => run.projectId === projectId), nextRuns: projectRuns,
    currentProject: state.planningProject, nextProject: projectSnapshot,
    container: plans, documentRef: document });
  if (disposition === 'unchanged') {
    const requestsReconciled = reconcileAcceptedProcessTaskRequests(projectRuns, instances, projectId);
    const instanceCommandsReconciled = applySettledProcessInstanceCommands({ disposition, pendingCommands: state.pendingInstanceCommands,
      render: () => renderProcessPlans(plans, processPlansFor(), state.planningProject) });
    if (requestsReconciled && !instanceCommandsReconciled) renderProcessPlans(plans, processPlansFor(), state.planningProject);
    return false;
  }
  if (disposition === 'defer-dirty' || disposition === 'defer-focus') {
    applySettledProcessInstanceCommands({ disposition, pendingCommands: state.pendingInstanceCommands });
    deferredProcessInstances = { instances, projectId, runtimePlans, projectRuns, projectSnapshot,
      projectRefreshUnavailable, routeKey: expectedRouteKey };
    setProcessRefreshStatus(processInstanceRefreshMessage(disposition));
    return false;
  }
  applySettledProcessInstanceCommands({ disposition, pendingCommands: state.pendingInstanceCommands });
  state.runtimePlans = runtimePlans;
  const currentProjectRuns = state.runs.filter((run) => run.projectId === projectId);
  const announcement = processInstanceStatusAnnouncement(state.taskInstances, instances, processPlansFor(projectSnapshot),
    currentProjectRuns, projectRuns);
  state.planningProject = projectSnapshot;
  state.taskInstances = instances;
  state.runs = [...state.runs.filter((run) => run.projectId !== projectId), ...projectRuns];
  reconcileAcceptedProcessTaskRequests(projectRuns, instances, projectId);
  for (const run of projectRuns) {
    const runLink = [...list.querySelectorAll('[data-run-link-id]')].find((entry) => entry.dataset.runLinkId === run.id);
    const status = runLink?.querySelector('.run-link-status');
    if (status) status.textContent = run.status.replaceAll('_', ' ');
  }
  deferredProcessInstances = null;
  renderProcessPlans(plans, processPlansFor(), state.planningProject, { skipBlockedAnnouncement: Boolean(announcement) });
  setProcessRefreshStatus(announcement);
  return true;
}

async function refreshProcessInstancesFromOtherSessions() {
  if (document.hidden || !state.authenticated || !state.planningProject?.id) return;
  const projectId = state.planningProject.id;
  const requestId = ++processRefreshRequestId;
  const routeKey = `${window.location.pathname}${window.location.search}`;
  try {
    const [processRead, projectRead] = await Promise.allSettled([
      api(`/api/execution/process-task-instances?projectId=${encodeURIComponent(projectId)}`),
      api(`/api/v1/projects/${encodeURIComponent(projectId)}`),
    ]);
    if (processRead.status === 'rejected') throw processRead.reason;
    const result = processRead.value;
    const projectSnapshot = projectRead.status === 'fulfilled' && projectRead.value?.data?.id === projectId
      ? projectRead.value.data : state.planningProject;
    const projectRefreshUnavailable = projectRead.status !== 'fulfilled' || projectRead.value?.data?.id !== projectId;
    if (!isCurrentProcessInstanceRefresh({ requestId, currentRequestId: processRefreshRequestId,
      projectId, currentProjectId: state.planningProject?.id, snapshotProjectId: projectSnapshot?.id, routeKey,
      currentRouteKey: `${window.location.pathname}${window.location.search}` })) return;
    applyCrossSessionProcessInstances(result.instances, projectId, result.plans ?? [], result.runs ?? [],
      projectSnapshot, routeKey, projectRefreshUnavailable);
    if (projectRefreshUnavailable) noteProjectRefreshUnavailable();
  } catch (error) {
    if (!isCurrentProcessInstanceRefresh({ requestId, currentRequestId: processRefreshRequestId,
      projectId, currentProjectId: state.planningProject?.id, routeKey,
      currentRouteKey: `${window.location.pathname}${window.location.search}` })) return;
    setProcessRefreshStatus(`Could not refresh saved process activity. ${error.message} Will retry automatically.`);
  }
}

function applySelectedRunSnapshot(nextRun, runId) {
  const route = new URL(window.location.href);
  if (state.run?.id !== runId || route.searchParams.get('run') !== runId
    || (route.searchParams.get('project') || null) !== (state.run.projectId || null)) return false;
  const disposition = selectedRunRefreshDisposition({ currentRun: state.run, nextRun, container: main, documentRef: document });
  if (disposition === 'stale') return false;
  if (disposition === 'unchanged') {
    if (clearSettledLinkedRunAmendment(state.pendingRunAmendments, runId)) {
      renderRun();
      return true;
    }
    return false;
  }
  if (disposition === 'defer-dirty' || disposition === 'defer-focus') {
    deferredSelectedRun = { runId, nextRun };
    selectedRunWaitMessage = selectedRunRefreshMessage(disposition);
    if (executionAnnouncement.textContent !== selectedRunWaitMessage) executionAnnouncement.textContent = selectedRunWaitMessage;
    return false;
  }
  clearSettledLinkedRunAmendment(state.pendingRunAmendments, runId);
  const announcement = selectedRunStatusAnnouncement(state.run, nextRun);
  state.run = nextRun;
  state.runs = state.runs.map((run) => run.id === runId ? { ...run, status: nextRun.status, version: nextRun.version } : run);
  deferredSelectedRun = null;
  renderRun();
  const selectedRunLink = [...list.querySelectorAll('[data-run-link-id]')].find((entry) => entry.dataset.runLinkId === runId);
  const selectedRunStatus = selectedRunLink?.querySelector('.run-link-status');
  if (selectedRunStatus) selectedRunStatus.textContent = nextRun.status.replaceAll('_', ' ');
  if (announcement) executionAnnouncement.textContent = announcement;
  else if (selectedRunWaitMessage && executionAnnouncement.textContent === selectedRunWaitMessage) executionAnnouncement.textContent = '';
  selectedRunWaitMessage = '';
  return true;
}

async function refreshSelectedRunFromOtherSessions() {
  if (document.hidden || !state.authenticated || !state.run?.id) return;
  const runId = state.run.id;
  const currentRoute = new URL(window.location.href);
  if (currentRoute.searchParams.get('run') !== runId
    || (currentRoute.searchParams.get('project') || null) !== (state.run.projectId || null)) return;
  const requestId = ++selectedRunRefreshRequestId;
  try {
    const nextRun = await api(`/api/execution/runs/${encodeURIComponent(runId)}`);
    const route = new URL(window.location.href);
    if (!isCurrentSelectedRunRefresh({ requestId, currentRequestId: selectedRunRefreshRequestId,
      runId, currentRunId: state.run?.id, routeRunId: route.searchParams.get('run'),
      projectId: state.run?.projectId ?? null, currentProjectId: state.run?.projectId ?? null,
      routeProjectId: route.searchParams.get('project') || null })) return;
    applySelectedRunSnapshot(nextRun, runId);
  } catch {
    // A transient read failure is retried on the next poll or visibility return.
  }
}

function retryDeferredSelectedRun() {
  if (!deferredSelectedRun) return;
  const { runId, nextRun } = deferredSelectedRun;
  applySelectedRunSnapshot(nextRun, runId);
}

function retryDeferredProcessInstances() {
  if (!deferredProcessInstances) return;
  const { instances, projectId, runtimePlans, projectRuns, projectSnapshot, routeKey, projectRefreshUnavailable } = deferredProcessInstances;
  const applied = applyCrossSessionProcessInstances(instances, projectId, runtimePlans, projectRuns,
    projectSnapshot, routeKey, projectRefreshUnavailable);
  if (applied && projectRefreshUnavailable) noteProjectRefreshUnavailable();
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    void refreshProcessInstancesFromOtherSessions();
    void refreshSelectedRunFromOtherSessions();
  }
});
document.addEventListener('focusout', (event) => {
  if (event.target?.closest?.('#process-plans')) setTimeout(retryDeferredProcessInstances, 0);
  if (event.target?.closest?.('#execution-main')) setTimeout(retryDeferredSelectedRun, 0);
});
setInterval(() => {
  void refreshProcessInstancesFromOtherSessions();
  void refreshSelectedRunFromOtherSessions();
}, 15000);

function syncEnterpriseDesignNavigation(projectId = state.projectContextId) {
  const link = document.querySelector('#enterprise-design-nav');
  if (link) link.href = encodeStudioRoute({ projectId });
}

function syncExecutionRoute(projectId = state.projectContextId, target = null) {
  history.replaceState(null, '', encodeExecutionRoute(projectId, target));
}

function syncExecutionRunRoute(run) {
  if (!run?.id) return;
  state.projectContextId = run.projectId ?? state.projectContextId;
  history.replaceState(null, '', encodeExecutionRoute(state.projectContextId, null, run.id));
}

function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  setDomAttributes(node, options.attrs);
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

function processTaskIntentStorage() {
  try { return window.localStorage; } catch { return null; }
}

async function refresh() {
  processRefreshRequestId += 1;
  state.runs = (await api('/api/execution/runs')).runs;
  let processInstancesRefreshed = false;
  if (state.authenticated && state.planningProject?.id) {
    try {
      const runtime = await api(`/api/execution/process-task-instances?projectId=${encodeURIComponent(state.planningProject.id)}`);
      state.taskInstances = runtime.instances;
      state.runtimePlans = runtime.plans ?? [];
      deferredProcessInstances = null;
      setProcessRefreshStatus('');
      clearSettledProcessInstanceCommands(state.pendingInstanceCommands);
      reconcileAcceptedProcessTaskRequests(state.runs, state.taskInstances, state.planningProject.id);
      processInstancesRefreshed = true;
    } catch {
      setProcessRefreshStatus('Could not refresh process instances. Existing controls remain locked until the current state is available.');
    }
  }
  renderList();
  const plans = document.querySelector('#process-plans');
  if (processInstancesRefreshed && plans && state.planningProject) renderProcessPlans(plans, processPlansFor(), state.planningProject);
  return processInstancesRefreshed;
}

function renderList() {
  list.replaceChildren();
  if (!state.runs.length) return list.append(el('p', { className: 'muted', text: 'No execution runs yet.' }));
  for (const run of state.runs) {
    const button = el('button', { className: `run-link${state.run?.id === run.id ? ' active' : ''}`, attrs: { type: 'button', 'data-run-link-id': run.id } }, [
      el('strong', { text: run.title }), el('span', { className: 'run-link-status', text: run.status.replaceAll('_', ' ') }), el('small', { text: run.profile.label }),
    ]);
    button.addEventListener('click', () => load(run.id)); list.append(button);
  }
}

function showNew({ planTarget = null, preferredProcessId = null, preserveProcessRoute = false } = {}) {
  selectedRunRefreshRequestId += 1;
  deferredSelectedRun = null;
  if (selectedRunWaitMessage && executionAnnouncement.textContent === selectedRunWaitMessage) executionAnnouncement.textContent = '';
  selectedRunWaitMessage = '';
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
        const runtime = await api(`/api/execution/process-task-instances?projectId=${encodeURIComponent(projectId)}`);
        state.taskInstances = runtime.instances;
        state.runtimePlans = runtime.plans ?? [];
      } catch { state.taskInstances = []; state.runtimePlans = []; }
      try {
        const repositories = await api(`/api/execution/local-repositories?projectId=${encodeURIComponent(projectId)}`);
        if (document.querySelector('#plan-project')?.value !== projectId) return;
        state.localRepositories = repositories.repositories ?? [];
      } catch { state.localRepositories = []; }
    } else {
      state.taskInstances = []; state.runtimePlans = []; state.localRepositories = [];
    }
    let restoredPlanTarget = planTarget;
    if (restoredPlanTarget) {
      const planExists = processPlansFor(project).some((plan) => plan.id === restoredPlanTarget.processPlanId
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
    renderProcessPlans(plansPanel, processPlansFor(project), project);
    updatePlanButtonLabel();
    if (restoredPlanTarget && !focusLinkedPlanInstance(restoredPlanTarget)) {
      notify('The linked plan revision or instance is no longer available.');
    }
  } catch (error) { notify(error.message); }
}

function humanTaskStatusTarget({ processPlanId, revision, planInstanceId, taskId }) {
  const card = [...document.querySelectorAll('.process-plan')].find((candidate) =>
    candidate.dataset.processPlanId === processPlanId
      && Number(candidate.dataset.planRevision) === revision);
  const instanceSelect = card?.querySelector('select[aria-label^="Process instance for"]');
  if (!instanceSelect || instanceSelect.value !== planInstanceId) return null;
  const status = [...card.querySelectorAll('[data-human-task-status-focus-target]')]
    .find((candidate) => candidate.dataset.humanTaskStatusFocusTarget === taskId);
  return status ?? null;
}

function focusHumanTaskStatus({ processPlanId, revision, planInstanceId, taskId }) {
  const status = humanTaskStatusTarget({ processPlanId, revision, planInstanceId, taskId });
  if (!status) return false;
  status.scrollIntoView?.({ block: 'nearest' });
  status.focus({ preventScroll: true });
  return document.activeElement === status;
}

function restoreHumanTaskStatusFocusAfterAction({ button, plan, task, planInstanceId }) {
  return restoreHumanTaskStatusFocus({
    initiatingControl: button,
    documentRef: document,
    findTarget: () => humanTaskStatusTarget({
      processPlanId: plan.id, revision: plan.revision, planInstanceId, taskId: task.id,
    }),
  });
}

async function reconcileHumanTaskConflict(project, plan, task, selectedInstance) {
  await loadPlanningProject(project.id, plan.source?.processId ?? null);
  if (state.planningProject?.id !== project.id || state.actorBindingProjectId !== project.id) return false;
  const existingRuntime = state.taskInstances.filter((runtime) => runtime.projectId === project.id
    && runtime.processPlanId === plan.id && runtime.revision === plan.revision && runtime.taskId === task.id)
    .sort((left, right) => (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0))[0];
  const instanceKey = `${plan.id}\n${plan.revision}`;
  let planInstanceId = selectedInstance;
  if (selectedInstance === 'new' && existingRuntime?.planInstanceId) {
    planInstanceId = existingRuntime.planInstanceId;
    state.selectedPlanInstances.set(instanceKey, planInstanceId);
    const plans = document.querySelector('#process-plans');
    if (plans) {
      renderProcessPlans(plans, processPlansFor(), state.planningProject);
      updatePlanButtonLabel();
    }
  }
  return focusHumanTaskStatus({
    processPlanId: plan.id, revision: plan.revision, planInstanceId, taskId: task.id,
  });
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

function focusProcessPlanCard(target) {
  if (!target) return false;
  const card = [...document.querySelectorAll('.process-plan')].find((candidate) =>
    candidate.dataset.processPlanId === target.processPlanId
      && Number(candidate.dataset.planRevision) === target.revision);
  if (!card || !card.hasAttribute('tabindex')) return false;
  card.scrollIntoView?.({ block: 'nearest' });
  card.focus({ preventScroll: true });
  return document.activeElement === card;
}

function openLinkedProcessPlan(run) {
  const target = selectLinkedProcessPlanInstance(run, state.projects, state.selectedPlanInstances, state.runtimePlans);
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
    renderProcessPlans(document.querySelector('#process-plans'), processPlansFor(result.data), result.data);
    focusProcessPlanCard(currentProcessPlanFocusTarget(result.data, processId, result.event?.data?.planId));
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

function renderProcessPlans(container, plans, project, { allowNewInstances = true, showHistory = true, skipBlockedAnnouncement = false } = {}) {
  const savedTaskResultDetails = container.querySelectorAll('details[data-saved-task-result-key]');
  const expandedSavedTaskResults = captureExpandedSavedTaskResultKeys(savedTaskResultDetails);
  const focusedSavedTaskResult = captureFocusedSavedTaskResult(savedTaskResultDetails, document.activeElement);
  container.replaceChildren();
  if (!plans.length) return container.append(el('p', { className: 'muted', text: 'No planning graphs saved for this project.' }));
  const blockedAnnouncements = [];
  const blockedAnnouncementContexts = new Map();
  const revisions = new Map();
  for (const plan of plans) {
    const values = revisions.get(plan.id) ?? [];
    values.push(plan); revisions.set(plan.id, values);
  }
  for (const entries of revisions.values()) {
    entries.sort((left, right) => (left.revision ?? 1) - (right.revision ?? 1));
    const plan = entries.at(-1);
    const pendingHumanTaskStarts = syncHumanTaskStarts(project, plan);
    const card = el('section', { className: 'run-section process-plan', attrs: {
      'aria-label': `Planned graph for ${plan.source.processName}`,
      tabindex: '-1',
      'data-process-plan-id': plan.id,
      'data-plan-revision': plan.revision ?? 1,
    } }, [
      el('h4', { text: `${plan.source.processName} · blueprint v${plan.source.blueprintVersion} · graph revision ${plan.revision ?? 1}` }),
      el('p', { text: 'Proposed design · planned only · not dispatched' }),
    ]);
    const planControls = el('div', { className: 'process-plan-controls' });
    const sourceLink = sourceProcessDesignLink(plan, project);
    if (sourceLink) planControls.append(el('a', { className: 'button', text: sourceLink.label, attrs: { href: sourceLink.href } }));
    const freshness = processPlanFreshness(plan, project);
    const softwareDeliveryPlan = plan.kind === 'software_delivery_runtime_plan';
    const canStartNewInstances = !softwareDeliveryPlan && allowNewInstances && !freshness.historical;
    if (softwareDeliveryPlan) card.append(el('p', { className: 'muted', text: 'Owner-promoted human checkpoint snapshot · each task remains a separately assigned human action. Agent execution requires a separate software output contract.' }));
    if (freshness.historical) {
      card.append(el('p', { className: 'muted historical-process-plan', text: `Historical plan · pinned to blueprint v${plan.source.blueprintVersion}; the current saved design is v${project.latestBlueprint.version}. This plan cannot start new work.` }));
      if (freshness.link) planControls.append(el('a', { className: 'button', text: freshness.link.label, attrs: { href: freshness.link.href } }));
    }
    if (canStartNewInstances) {
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
    const orderedInstances = orderProcessInstancesByLatestActivity([...instances.entries()]);
    const latestInstance = orderedInstances[0]?.[0] ?? 'new';
    let selectedInstance = state.selectedPlanInstances.get(instanceKey) ?? latestInstance;
    if (selectedInstance !== 'new' && !instances.has(selectedInstance)) {
      selectedInstance = latestInstance;
      state.selectedPlanInstances.set(instanceKey, latestInstance);
    }
    const instanceSelect = el('select', { attrs: { 'aria-label': `Process instance for ${plan.source.processName}` } });
    instanceSelect.append(el('option', { text: canStartNewInstances ? 'Start a new instance' : 'Earlier revision · existing instances only', attrs: { value: 'new', ...(selectedInstance === 'new' ? { selected: 'selected' } : {}), ...(!canStartNewInstances ? { disabled: 'disabled' } : {}) } }));
    for (const [instanceId, runtimes] of orderedInstances) {
      instanceSelect.append(el('option', {
        text: processInstanceOptionLabel(instanceId, runtimes),
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
        const boundary = instanceControl.pauseBoundary.tasks.map((task) => {
          const attemptReference = task.attemptStatus === 'outcome_unknown'
            ? ` · OrgWard-local attempt reference ${typeof task.attemptId === 'string' && /^[a-f0-9-]{36}$/i.test(task.attemptId) ? task.attemptId : 'unavailable'} (not a provider request ID; proves neither receipt nor completion)`
            : '';
          return `${task.taskId}${task.runId ? ` · run ${task.runId.slice(-8)} · instruction revision ${task.instructionRevision}` : ` · ${task.status}`}${task.attemptStatus ? ` · provider ${task.attemptStatus}` : ''}${attemptReference}`;
        }).join('; ');
        card.append(el('p', { className: 'muted', text: `Recorded pause boundary: ${boundary}` }));
      }
      if (instanceControl.events?.length) {
        const controlHistory = processInstanceControlHistoryEntries(instanceControl.events);
        if (controlHistory.length) {
          const history = el('details', { className: 'process-instance-history' }, [el('summary', { text: 'Instance control history' })]);
          history.append(el('ul', {}, controlHistory.map((event) => {
            const item = el('li');
            item.append(el('strong', { text: `${event.type} · ${event.actor}` }));
            item.append(el('p', { className: 'muted' }, el('time', {
              text: new Date(event.at).toLocaleString(), attrs: { datetime: event.at },
            })));
            if (event.reason) item.append(el('p', { text: `Reason: ${event.reason}` }));
            if (event.type === 'ProcessTaskInstanceAbandonedUnverified') {
              item.append(el('p', { text: `Runs: ${event.runIds.join(', ') || 'none'}` }));
              item.append(el('p', { text: `Attempts: ${event.attemptIds.join(', ') || 'none'}` }));
              item.append(el('p', { text: `Duplicate cost/work acknowledged: ${event.acknowledgeDuplicateCostWork ? 'yes' : 'no'}` }));
              if (event.evidence.length) item.append(el('ul', {}, event.evidence.map((note) => el('li', { text: note }))));
            }
            return item;
          })));
          card.append(history);
        }
      }
      if (instanceControl.status === 'PAUSE_REQUESTED') {
        card.append(el('p', { className: 'muted', text: 'Pause is pending while in-flight tasks settle. Provider requests already handed off are not canceled; unknown outcomes remain unresolved.' }));
        if (!canControlInstance) card.append(el('p', { className: 'muted', text: 'Only the instance initiator or a current project owner can control this process.' }));
        if (instanceControl.canAbandonUnverified === true) card.append(renderAbandonUnverifiedForm({ project, instanceId: selectedInstance, control: instanceControl }));
        else if (instanceControl.pauseBoundary?.tasks?.some((task) => task.attemptStatus === 'outcome_unknown')) {
          card.append(el('p', { className: 'muted', text: 'This unknown provider result cannot be cleared through this control. Terminal abandonment is limited to read-only OpenAI or DeepSeek model proposals; other provider or effect-capable work requires reconciliation before any new work.' }));
        }
      } else if (instanceControl.status === 'PAUSED') {
        card.append(el('p', { className: 'muted', text: 'This instance is paused at its recorded boundary. Resuming rechecks dependencies and authority; paused agent requests need fresh independent approval.' }));
        if (canControlInstance) card.append(renderInstanceControlForm({ project, instanceId: selectedInstance, control: instanceControl, action: 'resume' }));
        else card.append(el('p', { className: 'muted', text: 'Only the instance initiator or a current project owner can control this process.' }));
        if (instanceControl.canCancel === true) card.append(renderInstanceControlForm({ project, instanceId: selectedInstance, control: instanceControl, action: 'cancel' }));
        if (instanceControl.canAbandonUnverified === true) card.append(renderAbandonUnverifiedForm({ project, instanceId: selectedInstance, control: instanceControl }));
      } else if (instanceControl.status === 'CANCELLED') {
        card.append(el('p', { className: 'muted', text: 'This process instance is cancelled. Completed task outcomes and evidence remain available; no further work can start or resume.' }));
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
      const runtimeState = deriveProcessTaskState(task, selectedRuntimes, selectedInstance === 'new' ? null : selectedInstance, plan.tasks);
      const runtime = runtimeState.runtime;
      const uncertainBlockedDependency = runtimeState.blockedDependencies.some(({ taskId }) => {
        const dependencyRuntime = selectedRuntimes.find((candidate) => candidate.taskId === taskId);
        const dependencyRun = dependencyRuntime?.executionRunId
          ? state.runs.find((candidate) => candidate.id === dependencyRuntime.executionRunId) : null;
        return dependencyRun?.execution?.providerDiagnostic?.outcome === 'outcome_unknown';
      });
      const blockedDependencyText = runtimeState.blockedDependencies.length
        ? blockedProcessTaskRecoveryCopy({
          blockedTitles: runtimeState.blockedDependencies.map(({ taskId, status }) =>
            `${tasks.get(taskId)?.title ?? taskId} (${status.replaceAll('_', ' ').toLowerCase()})`),
          uncertainDelivery: uncertainBlockedDependency,
        }) : null;
      if (selectedInstance !== 'new') {
        const statusKey = `${project.id}\n${plan.id}\n${plan.revision}\n${selectedInstance}\n${task.id}`;
        const previousStatus = state.processTaskStatuses.get(statusKey);
        if (processTaskStatusAnnouncement(previousStatus, runtimeState.status)) {
          if (!uncertainBlockedDependency) {
            blockedAnnouncements.push(runtimeState.blockedDependencies.map(({ taskId, status }) => ({
              taskId,
              title: tasks.get(taskId)?.title,
              status,
            })));
            blockedAnnouncementContexts.set(statusKey, { planId: plan.id, revision: plan.revision, instanceId: selectedInstance });
          }
        }
        state.processTaskStatuses.set(statusKey, runtimeState.status);
      }
      const instancePaused = instanceControl?.status === 'PAUSED';
      const instanceFenced = instanceControl && instanceControl.status !== 'ACTIVE';
      const instanceAbandoned = instanceControl?.status === 'ABANDONED_UNVERIFIED';
      const instanceCancelled = instanceControl?.status === 'CANCELLED';
      const instanceTerminal = instanceAbandoned || instanceCancelled;
      const linkedRun = runtime?.executionRunId ? state.runs.find((candidate) => candidate.id === runtime.executionRunId) ?? null : null;
      const dependenciesSucceeded = runtimeState.dependenciesSucceeded;
      const item = el('li');
      item.append(el('h5', {
        className: 'process-task-status',
        text: `${task.title} — ${runtimeState.status}`,
        attrs: { tabindex: '-1', 'data-human-task-status-focus-target': task.id },
      }));
      item.append(
        el('p', { text: task.detail }),
        el('p', { text: `Depends on: ${dependencies.join(', ') || 'No upstream process dependency'}` }),
        el('p', { text: `Inputs: ${inputs}` }), el('p', { text: `Outputs: ${outputs}` }),
        el('p', { text: `Role reference: ${roleText}` }),
      );
      item.append(renderTaskAssignmentTransparency(task, plan, project));
      const selectedStartKey = humanTaskStartCommandKey({ planId: plan.id, revision: plan.revision,
        planInstanceId: selectedInstance, taskId: task.id });
      const detachedTaskStarts = pendingHumanTaskStarts.filter((entry) => entry.pending.payload.taskId === task.id
        && entry.commandKey !== selectedStartKey);
      for (const entry of detachedTaskStarts) {
        const presentation = humanTaskStartPresentation(entry.pending, {
          submitting: state.submittingHumanTaskStarts.has(entry.commandKey),
          displayedInstanceId: selectedInstance === 'new' ? null : selectedInstance,
        });
        const button = el('button', { className: 'button', text: presentation.buttonLabel,
          attrs: { type: 'button', disabled: presentation.buttonDisabled } });
        const status = el('p', { className: 'muted human-task-command-status', attrs: {
          role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true',
        }, text: presentation.status });
        button.addEventListener('click', () => { void startHumanTask({ project, plan, task,
          selectedInstance: entry.pending.payload.planInstanceId ?? 'new', button, status, requestKey: entry.commandKey }); });
        item.append(el('div', { className: 'human-task-start-recovery' }, [
          el('p', { className: 'muted', text: entry.pending.payload.planInstanceId === undefined
            ? 'Recover the saved new-instance start for this task. It is not linked to the process instance selected above; retry retrieves the original server-created instance if the command was already accepted.'
            : `Recover the saved start for process instance ${entry.pending.accepted?.planInstanceId ?? entry.pending.payload.planInstanceId}. It is not linked to the process instance selected above.` }),
          button, status,
        ]));
      }
      const pinnedBlueprint = project.blueprintVersions?.find((entry) => entry.id === plan.source.blueprintId
        && entry.version === plan.source.blueprintVersion);
      const taskActor = Object.values(pinnedBlueprint?.areas ?? {}).flatMap((area) => area.items ?? [])
        .find((candidate) => candidate.id === task.assignee?.actorId);
      const isHumanTask = taskActor?.type === 'actor-human';
      const humanInputReview = isHumanTask ? processTaskHumanInputReview({ task, plan, project }) : null;
      if (humanInputReview?.kind === 'unavailable') {
        item.append(el('p', { className: 'muted human-task-input-review-unavailable', text: humanInputReview.label }));
      } else if (humanInputReview?.kind === 'inputs' && humanInputReview.entries.length === 0) {
        item.append(el('p', { className: 'muted human-task-input-review-empty', text: 'No saved information inputs are referenced by this human task.' }));
      } else if (humanInputReview?.kind === 'inputs') {
        const inputDisclosureKey = humanTaskInputDisclosureKey({ projectId: project.id, planId: plan.id,
          revision: plan.revision, taskId: task.id });
        const disclosure = el('details', { className: 'human-task-input-review', attrs: {
          ...(inputDisclosureKey ? { 'data-human-task-input-key': inputDisclosureKey } : {}),
          ...(humanTaskInputDisclosureOpen(inputDisclosureKey, state.expandedHumanTaskInputs) ? { open: 'open' } : {}),
        } }, [
          el('summary', { text: `Review pinned task inputs (${humanInputReview.entries.length})` }),
          el('p', { className: 'muted', text: `Input details come from blueprint v${humanInputReview.blueprintVersion} pinned to this saved process.` }),
          el('ul', {}, humanInputReview.entries.map((entry) => el('li', {}, [
            el('strong', { text: `${entry.name} (${entry.type})` }),
            el('p', { text: entry.detail }),
          ]))),
        ]);
        disclosure.addEventListener('toggle', () => rememberHumanTaskInputDisclosure(
          inputDisclosureKey, disclosure.open, state.expandedHumanTaskInputs));
        item.append(disclosure);
      }
      const effectiveAssignee = isHumanTask ? humanTaskEffectiveAssigneePresentation(runtime) : null;
      if (effectiveAssignee) {
        item.append(el('div', { className: 'human-task-effective-assignee' }, [
          el('p', { text: effectiveAssignee.label }),
          el('p', { className: 'muted', text: effectiveAssignee.detail }),
        ]));
      }
      if (instanceAbandoned) {
        item.append(el('p', { className: 'muted', text: 'This old model result is unverified and cannot advance work. Start a distinct process instance and obtain fresh independent approval before retrying.' }));
      } else if (linkedRun) {
        const resultSummary = linkedProcessTaskResult(runtime, linkedRun, project);
        if (resultSummary) {
          if (resultSummary.providerDiagnostic?.outcome === 'outcome_unknown') {
            item.append(el('p', { className: 'provider-outcome-diagnostic', text: resultSummary.diagnostic }));
          }
          const disclosureKey = savedTaskResultDisclosureKey(project.id, linkedRun.id);
          const disclosure = el('details', { className: 'linked-process-task-result', attrs: {
            'data-saved-task-result-key': disclosureKey,
            ...(restoreSavedTaskResultOpen(disclosureKey, expandedSavedTaskResults) ? { open: 'open' } : {}),
          } }, [
            el('summary', { text: resultSummary.summaryLabel }),
            el('p', { text: `Terminal status: ${resultSummary.statusLabel}` }),
          ]);
          if (resultSummary.proposalPreview?.kind === 'proposal') {
            const preview = resultSummary.proposalPreview;
            disclosure.append(
              el('p', { className: 'muted', text: preview.label }),
              el('p', { text: `Target: ${preview.target}` }),
              el('p', { text: `Proposed detail: ${preview.proposedDetail}` }),
              el('p', { text: `Rationale: ${preview.rationale}` }),
              el('p', { text: `Structural checks only: ${preview.evaluation}` }),
              el('ul', { attrs: { 'aria-label': 'Cited saved task inputs' } }, preview.citations.map((citation) => el('li', {
                text: `${citation.name} (${citation.type})`,
              }))),
            );
            if (preview.designLink) disclosure.append(el('a', {
              className: 'button', text: preview.designLink.label, attrs: { href: preview.designLink.href },
            }));
          } else if (resultSummary.proposalPreview?.kind === 'unavailable') {
            disclosure.append(el('p', { className: 'muted', text: resultSummary.proposalPreview.label }));
          } else if (resultSummary.outputPreview) {
            disclosure.append(el('p', { text: `Saved output preview: ${resultSummary.outputPreview}` }));
          } else if (resultSummary.status === 'SUCCEEDED') {
            disclosure.append(el('p', { className: 'muted', text: 'The run completed without saved text output.' }));
          }
          disclosure.append(el('p', { text: `Artifacts: ${resultSummary.artifactsCapped ? '100+' : resultSummary.artifactCount}` }));
          if (resultSummary.artifacts.length) {
            const artifactList = el('ul', { className: 'linked-task-artifacts', attrs: { 'aria-label': 'Saved task artifacts' } });
            for (const artifact of resultSummary.artifacts) {
              artifactList.append(el('li', {}, el('a', {
                text: `Download ${artifact.displayName} · ${artifact.hashPrefix}…`,
                attrs: { href: `/api/execution/runs/${encodeURIComponent(linkedRun.id)}/artifact?path=${encodeURIComponent(artifact.relativePath)}` },
              })));
            }
            disclosure.append(artifactList);
          }
          if (resultSummary.artifactLinksCapped) {
            disclosure.append(el('p', { className: 'muted', text: 'This task-row summary shows up to 10 safe artifact links. Open the linked run to review the full artifact list.' }));
          }
          if (resultSummary.evidenceHash) disclosure.append(el('p', { text: `Evidence hash: ${resultSummary.evidenceHash}…` }));
          if (resultSummary.diagnostic && resultSummary.providerDiagnostic?.outcome !== 'outcome_unknown') {
            disclosure.append(el('p', { className: 'muted provider-outcome-diagnostic', text: resultSummary.diagnostic }));
          }
          if (resultSummary.failureGuidance && !resultSummary.diagnostic
            && resultSummary.providerDiagnostic?.outcome !== 'outcome_unknown') {
            disclosure.append(el('p', { className: 'linked-task-failure-guidance', text: resultSummary.failureGuidance.nextStep }));
          }
          item.append(disclosure);
        }
        const openRun = el('button', { className: 'button', text: `Open linked run ${linkedRun.id.slice(-8)}`, attrs: { type: 'button' } });
        openRun.addEventListener('click', (event) => { void load(linkedRun.id, { initiatingControl: openRun, event }); });
        item.append(el('p', { text: linkedRunActivityLabel(linkedRun) }), openRun);
      } else if (isHumanTask) {
        if (runtime?.outcome?.result) {
          item.append(el('p', { text: `Human checkpoint result: ${runtime.outcome.result}. Evidence: ${runtime.evidence.join(' · ') || 'none recorded'}` }));
        }
        const humanHistory = humanTaskHistoryEntries(runtime?.events);
        if (humanHistory.length) {
          const history = el('details', { className: 'human-task-history' }, [
            el('summary', { text: `Human task history (${humanHistory.length})` }),
          ]);
          history.append(el('ol', {}, humanHistory.map((entry) => {
            const event = el('li');
            const result = entry.result ? ` · ${entry.result.replaceAll('_', ' ')}` : '';
            event.append(el('strong', { text: `${entry.label}${result} · ${entry.actor}` }));
            event.append(el('p', { className: 'muted' }, el('time', {
              text: new Date(entry.at).toLocaleString(), attrs: { datetime: entry.at },
            })));
            if (entry.reason) event.append(el('p', { text: `Reason: ${entry.reason}` }));
            if (entry.evidence.length) event.append(el('ul', {}, entry.evidence.map((note) => el('li', { text: note }))));
            return event;
          })));
          item.append(history);
        }
        if (runtime?.status === 'SUCCEEDED') {
          for (const output of task.outputs.filter((entry) => entry.type === 'information')) {
            const outputControl = renderHumanTaskOutputApplication({ project, plan, task, runtime, output });
            if (outputControl) item.append(outputControl);
          }
        }
        if (instanceTerminal) {
          item.append(el('p', { className: 'muted', text: 'This process instance is terminal; no human task can start or resolve in it.' }));
        } else if (runtime?.status === 'ESCALATED') {
          if (instanceControl?.status === 'PAUSED') {
            item.append(el('p', { className: 'muted', text: 'This process instance is paused. Resume it before a project owner resolves the escalated checkpoint.' }));
          } else if (runtime.canResolveEscalation) {
            item.append(
              el('p', { className: 'muted', text: 'Project owner resolution is required before this human task can continue. Resume rechecks the current assignee; reassignment keeps this immutable task plan and instance.' }),
      renderHumanTaskEscalationResolution({ project, plan, task, selectedInstance, runtime }),
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
        } else if (selectedInstance === 'new' && (!canStartNewInstances || entries.at(-1)?.revision !== plan.revision
          || project.latestBlueprint?.version !== plan.source.blueprintVersion)) {
          item.append(el('p', { className: 'muted', text: 'A new human task instance requires the latest saved graph revision and current blueprint.' }));
        } else if (runtimeState.blockedDependencies.length) {
          item.append(el('p', { className: 'muted', text: blockedDependencyText }));
        } else if (!dependenciesSucceeded) {
          item.append(el('p', { className: 'muted', text: 'Dependencies must succeed in this instance before the assigned human can start this task.' }));
        } else if (!state.authenticated) {
          item.append(el('p', { className: 'muted', text: 'Sign in as the enabled assigned human with workspace write access to start this checkpoint.' }));
        } else if (runtime && !runtime.assignedToCurrentPrincipal) {
          item.append(el('p', { className: 'muted', text: 'Only the current assigned human can start this task.' }));
        } else {
          const commandKey = humanTaskStartCommandKey({ planId: plan.id, revision: plan.revision,
            planInstanceId: selectedInstance, taskId: task.id });
          const pendingStart = state.pendingHumanTaskCommands.get(commandKey) ?? null;
          const presentation = humanTaskStartPresentation(pendingStart, {
            submitting: state.submittingHumanTaskStarts.has(commandKey),
            displayedInstanceId: selectedInstance === 'new' ? null : selectedInstance,
          });
          const startButton = el('button', { className: 'button primary', text: presentation.buttonLabel,
            attrs: { type: 'button', disabled: presentation.buttonDisabled } });
          const startStatus = el('p', { className: 'muted human-task-command-status', attrs: {
            role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true',
          }, text: presentation.status });
          startButton.addEventListener('click', () => { void startHumanTask({ project, plan, task, selectedInstance,
            button: startButton, status: startStatus, requestKey: commandKey }); });
          item.append(
            el('p', { className: 'muted', text: runtime?.effectiveAssignmentOverridden
              ? 'The current owner-reassigned human may start and complete this task. Starting records work in progress; it grants no agent or platform authority.'
              : 'Only the enabled human bound to this blueprint actor can start and complete the task. Starting records work in progress; it grants no agent or platform authority.' }),
            startButton, startStatus,
          );
        }
      } else if (instanceCancelled) {
        item.append(el('p', { className: 'muted', text: 'This process instance is cancelled. No further task work can start.' }));
      } else {
        const assignment = currentTaskAssignment(task, plan, project, selectedInstance !== 'new');
        const hasProposalInputs = task.inputs?.length > 0 && task.outputs?.some((output) => output.type === 'information');
        const profileOptions = (state.meta?.profiles ?? []).filter((profile) => !['provider-openai', 'provider-deepseek'].includes(profile.kind) || hasProposalInputs);
        const canStartNew = canStartNewInstances && selectedInstance === 'new' && task.dependencies.length === 0
          && entries.at(-1)?.revision === plan.revision
          && project.latestBlueprint?.version === plan.source.blueprintVersion;
        const eligibleInInstance = selectedInstance !== 'new' && dependenciesSucceeded;
        const canRequest = state.authenticated && !instanceFenced && assignment.available && profileOptions.length > 0
          && (canStartNew || eligibleInInstance);
        if (selectedInstance !== 'new' && blockedDependencyText) {
          item.append(el('p', { className: 'muted', text: blockedDependencyText }));
        } else if (!assignment.available) {
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
        if (!state.meta?.profiles?.length) {
          item.append(el('p', { className: 'muted', text: 'No execution profile is configured. Ask an OrgWard administrator to configure one before requesting approval.' }));
        } else if (!profileOptions.length) {
          item.append(el('p', { className: 'muted', text: 'No configured execution profile supports this task. Model profiles need at least one input and one information output; add those to the task or ask an OrgWard administrator to configure a non-model profile.' }));
        } else if (canRequest) {
          const requestLookup = {
            tenantId: project.tenantId, principal: state.currentPrincipal, projectId: project.id, planId: plan.id,
            revision: plan.revision, planInstanceId: selectedInstance, taskId: task.id,
          };
          const directRequestKey = processTaskRequestStorageKey(requestLookup);
          const pendingRequestEntry = findPendingProcessTaskRequest(processTaskIntentStorage(), {
            ...requestLookup, key: directRequestKey,
          });
          const requestKey = pendingRequestEntry?.key ?? directRequestKey;
          const pendingRequest = state.pendingTaskRuns.get(requestKey) ?? pendingRequestEntry?.pending ?? null;
          if (pendingRequest) state.pendingTaskRuns.set(requestKey, pendingRequest);
          const isSubmittingTaskRequest = state.submittingTaskRequests.has(requestKey);
          const recoveringNewInstance = selectedInstance !== 'new' && pendingRequest?.status !== 'accepted'
            && pendingRequest?.payload?.planInstanceId === undefined;
          const requestPresentation = processTaskRequestPresentation(pendingRequest, {
            submitting: isSubmittingTaskRequest, recoveringNewInstance,
          });
          const profileSelect = el('select', { attrs: { 'aria-label': `Configured execution profile for ${task.title}` } });
          for (const profile of profileOptions) profileSelect.append(el('option', {
            text: `${profile.label} · ${profile.kind}`,
            attrs: { value: profile.id },
          }));
          const savedProfileId = pendingRequest?.payload?.profileId;
          if (requestPresentation.locked && savedProfileId) {
            if (!profileOptions.some((profile) => profile.id === savedProfileId)) profileSelect.append(el('option', {
              text: `${savedProfileId} · saved selection unavailable`, attrs: { value: savedProfileId, disabled: true },
            }));
            profileSelect.value = savedProfileId;
          }
          profileSelect.disabled = requestPresentation.locked;
          const requestButton = el('button', {
            className: 'button primary',
            text: requestPresentation.buttonLabel,
            attrs: { type: 'button', disabled: requestPresentation.buttonDisabled },
          });
          const repositorySelect = el('select', { attrs: { 'aria-label': `Local repository for ${task.title}` } });
          repositorySelect.append(el('option', { text: 'No local repository', attrs: { value: '' } }));
          repositorySelect.disabled = requestPresentation.locked;
          for (const repository of state.localRepositories) repositorySelect.append(el('option', {
            text: `${repository.label}${repository.kind === 'git' ? ` · ${repository.refLabel} @ ${repository.commitOid.slice(0, 12)}` : ''} · ${repository.fileCount} files · ${repository.treeDigest.slice(0, 12)}`,
            attrs: { value: repository.selectionId ?? repository.id },
          }));
          const savedRepository = pendingRequest?.payload?.repositoryId
            ? state.localRepositories.find((repository) => repository.id === pendingRequest.payload.repositoryId
              && repository.treeDigest === pendingRequest.payload.snapshotDigest
              && (repository.kind !== 'git' || (repository.refId === pendingRequest.payload.repositoryRefId
                && repository.commitOid === pendingRequest.payload.repositoryCommitOid))) : null;
          if (requestPresentation.locked && pendingRequest?.payload?.repositoryId) {
            if (savedRepository) repositorySelect.value = savedRepository.selectionId ?? savedRepository.id;
            else repositorySelect.append(el('option', {
              text: `Saved repository snapshot ${pendingRequest.payload.repositoryId} · unavailable or changed`,
              attrs: { value: '__saved_repository_unavailable__', disabled: true, selected: true },
            }));
          }
          const profileDisclosure = el('p', { className: 'muted' });
          const updateProfileDisclosure = () => {
            const selectedProfile = (state.meta?.profiles ?? []).find((profile) => profile.id === profileSelect.value);
            profileDisclosure.textContent = ['provider-openai', 'provider-deepseek'].includes(selectedProfile?.kind)
              ? `After independent approval, this ${selectedProfile.kind === 'provider-deepseek' ? 'DeepSeek' : 'OpenAI'} profile receives the saved task instructions, its pinned input record content and source notes, and the selected output context. It does not receive unrelated project records or credential material. The result is a review-only cited proposal.`
              : 'This records the assigned agent reference; the configured local profile runs under the OrgWard worker after separate approval, not as the bound workload identity.';
          };
          profileSelect.addEventListener('change', updateProfileDisclosure);
          updateProfileDisclosure();
          const requestStatus = el('p', { className: 'muted', attrs: { role: 'status', 'aria-live': 'polite' }, text: requestPresentation.status });
          requestButton.addEventListener('click', () => {
            void requestTaskApproval({ project, plan, task, selectedInstance, profileId: profileSelect.value,
              repositorySelectionId: repositorySelect.value, requestButton, profileSelect, repositorySelect, requestStatus, requestKey });
          });
          item.append(
            profileDisclosure, el('label', { text: 'Configured execution profile' }, profileSelect),
            ...(state.localRepositories.length || pendingRequest?.payload?.repositoryId
              ? [el('label', { text: 'Server-configured local repository' }, repositorySelect)] : []),
            requestButton, requestStatus,
          );
        }
      }
      if (selectedInstance !== 'new') {
        const recoveryAction = processTaskRecoveryAction({ blockedDependencies: runtimeState.blockedDependencies,
          uncertainDelivery: uncertainBlockedDependency,
          canStartNewInstance: canStartNewInstances && entries.at(-1)?.revision === plan.revision
            && project.latestBlueprint?.version === plan.source.blueprintVersion });
        if (recoveryAction?.kind === 'select-new-instance') {
          const chooseInstance = el('button', { className: 'button', text: recoveryAction.label, attrs: { type: 'button' } });
          chooseInstance.addEventListener('click', () => {
            if (!selectFreshProcessTaskInstance(state.selectedPlanInstances, instanceKey, recoveryAction)) return;
            syncExecutionRoute(project.id, null);
            renderProcessPlans(container, plans, project);
            const planCard = [...container.querySelectorAll('.process-plan')].find((candidate) =>
              candidate.dataset.processPlanId === plan.id && Number(candidate.dataset.planRevision) === Number(plan.revision));
            planCard?.querySelector('select[aria-label^="Process instance for"]')?.focus();
            notify('A new process instance is selected. Start with the first task; prior outcomes and evidence remain available in their original instance.');
          });
          item.append(chooseInstance);
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
  const blockedAnnouncement = summarizeBlockedTaskTransitions(blockedAnnouncements);
  if (blockedAnnouncement && executionAnnouncement && !skipBlockedAnnouncement) {
    const contexts = [...blockedAnnouncementContexts.values()];
    scheduleProcessTaskAnnouncement(executionAnnouncement, blockedAnnouncement, {
      isCurrent: () => state.planningProject?.id === project.id && contexts.every(({ planId, revision, instanceId }) => {
        const card = [...container.querySelectorAll('.process-plan')].find((candidate) =>
          candidate.dataset.processPlanId === planId && Number(candidate.dataset.planRevision) === Number(revision));
        return card?.querySelector('select[aria-label^="Process instance for"]')?.value === instanceId;
      }),
    });
  }
  restoreFocusedSavedTaskResult(focusedSavedTaskResult,
    container.querySelectorAll('details[data-saved-task-result-key]'));
}

async function submitInstanceControl({ project, instanceId, control, action, form, button, status, payload, endpoint, successMessage }) {
  const key = processInstanceCommandKey(action, instanceId, control.version);
  const disposition = await submitProcessInstanceControl({ action, key, pendingCommands: state.pendingInstanceCommands,
    payload, form, button, status,
    send: (pending) => api(endpoint, { method: 'POST', body: JSON.stringify({ schemaVersion: '1.0',
      commandId: pending.commandId, payload: pending.payload }) }),
  });
  if (disposition.kind === 'busy') return;
  if (disposition.kind === 'saved') {
    notify(successMessage(disposition.result));
    await refreshAfterProcessInstanceControl({ kind: 'saved', refresh, status, pending: state.pendingInstanceCommands.get(key) });
  } else if (disposition.kind === 'reconcile') {
    notify(disposition.error.message);
    await refreshAfterProcessInstanceControl({ kind: 'reconcile', refresh, status, pending: state.pendingInstanceCommands.get(key) });
  } else {
    status.textContent += ` ${disposition.error.message}`;
    notify(disposition.error.message);
  }
}

function renderInstanceControlForm({ project, instanceId, control, action }) {
  const form = el('form', { className: 'execution-form process-instance-control', attrs: {
    'aria-label': action === 'pause' ? 'Pause process instance' : action === 'cancel' ? 'Cancel process instance' : 'Resume process instance',
  } });
  let reason = null;
  if (action === 'pause' || action === 'cancel') {
    reason = el('textarea', { attrs: { name: 'reason', required: 'required', maxlength: action === 'pause' ? '500' : '1000', rows: '2',
      'aria-label': action === 'pause' ? 'Reason for pausing process instance' : 'Reason for cancelling process instance' } });
    form.append(el('p', { className: 'muted', text: action === 'pause'
      ? 'Pause blocks new starts and approvals. Already dispatched work remains in flight until its outcome is known.'
      : 'Cancellation is terminal. Completed outcomes and evidence remain; unresolved work must be reconciled before this action is available.' }),
      el('label', { text: 'Reason (required)' }, reason));
  }
  const button = el('button', { className: action === 'resume' ? 'button primary' : 'button',
    text: action === 'pause' ? 'Pause process instance' : action === 'cancel' ? 'Cancel process instance' : 'Resume process instance', attrs: { type: 'submit' } });
  const status = el('p', { className: 'muted', attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' } });
  form.append(button, status);
  const key = processInstanceCommandKey(action, instanceId, control.version);
  restoreProcessInstanceControlPresentation({ action, pending: state.pendingInstanceCommands.get(key), form, button, status });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const reasonText = reason?.value.trim() ?? '';
    if ((action === 'pause' || action === 'cancel') && !reasonText) return;
    void submitInstanceControl({ project, instanceId, control, action, form, button, status,
      endpoint: `/api/execution/process-task-instances/${action}`,
      payload: { projectId: project.id, planInstanceId: instanceId, version: control.version,
        ...(action === 'pause' || action === 'cancel' ? { reason: reasonText } : {}) },
      successMessage: (result) => action === 'pause'
        ? result.status === 'PAUSED' ? 'Process instance paused.' : 'Pause requested; waiting for in-flight work to settle.'
        : action === 'cancel' ? 'Process instance cancelled. Completed outcomes and evidence remain; no further work can start or resume.'
          : 'Process instance resumed. Paused agent requests require fresh independent approval.',
    });
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
  const status = el('p', { className: 'muted', attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' } });
  form.append(
    el('p', { className: 'muted', text: 'The old model output is unverified. The provider call may have completed and may have incurred cost. This terminal action preserves the unknown attempt and will not resume this instance.' }),
    el('p', { className: 'muted', text: 'Retry only by starting a distinct new process instance and obtaining fresh independent approval. The new call could duplicate cost or work.' }),
    el('label', { text: 'Reason (required)' }, reason),
    el('label', { text: 'Evidence reviewed (one note per line, required)' }, evidence),
    el('label', { text: 'I acknowledge retry may duplicate cost or work', attrs: { className: 'checkbox-label' } }, acknowledgement),
    button, status,
  );
  const key = processInstanceCommandKey('abandon-unverified', instanceId, control.version);
  restoreProcessInstanceControlPresentation({ action: 'abandon-unverified', pending: state.pendingInstanceCommands.get(key), form, button, status });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const reasonText = reason.value.trim();
    const evidenceEntries = evidence.value.split('\n').map((entry) => entry.trim()).filter(Boolean);
    if (!reasonText || evidenceEntries.length < 1 || evidenceEntries.length > 20 || !acknowledgement.checked) return;
    void submitInstanceControl({ project, instanceId, control, action: 'abandon-unverified', form, button, status,
      endpoint: '/api/execution/process-task-instances/abandon-unverified',
      payload: { projectId: project.id, planInstanceId: instanceId, version: control.version,
        reason: reasonText, evidence: evidenceEntries, acknowledgeDuplicateCostWork: true },
      successMessage: () => 'Instance closed as ABANDONED_UNVERIFIED. The old output is not verified; use a distinct instance and fresh approval to retry.',
    });
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
  const evidence = el('textarea', { attrs: { name: 'evidence', maxlength: '20099', rows: '4', 'aria-label': `Evidence notes for ${task.title}` } });
  const evidenceLabel = el('label', { text: 'Evidence notes, one per line (required)' }, evidence);
  const updateEvidenceRequirement = () => {
    const required = result.value === 'succeeded';
    evidence.required = required;
    evidence.setCustomValidity('');
    evidenceLabel.firstChild.textContent = required ? 'Evidence notes, one per line (required)' : 'Evidence notes, one per line (optional)';
  };
  updateEvidenceRequirement();
  evidence.addEventListener('input', () => evidence.setCustomValidity(''));
  result.addEventListener('change', updateEvidenceRequirement);
  const submit = el('button', { className: 'button primary', text: 'Complete human task', attrs: { type: 'submit' } });
  const status = el('p', { className: 'muted human-task-command-status', attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' } });
  form.append(el('label', { text: 'Outcome' }, result), evidenceLabel, status, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const evidenceEntries = parseHumanTaskEvidence(evidence.value);
    if (!evidenceEntries || (result.value === 'succeeded' && evidenceEntries.length === 0)) {
      evidence.setCustomValidity('Enter up to 20 evidence notes, one per line, with no note longer than 1000 characters. A succeeded task needs at least one note.');
      evidence.reportValidity();
      return;
    }
    evidence.setCustomValidity('');
    void completeHumanTask({ project, plan, task, selectedInstance, result: result.value, evidence: evidenceEntries, form, status, button: submit });
  });
  return form;
}

function humanTaskOutputApplicationKey({ project, plan, task, runtime, output }) {
  return [project.id, plan.id, plan.revision, runtime.planInstanceId, task.id, output.objectId].join('\n');
}

function renderHumanTaskOutputApplication({ project, plan, task, runtime, output }) {
  const disposition = humanTaskOutputApplicationState({ project, plan, task, runtime, output });
  if (disposition.kind === 'unavailable' || disposition.kind === 'not-succeeded') return null;
  if (disposition.kind === 'applied') {
    const superseded = disposition.currentBlueprintVersion > disposition.appliedBlueprintVersion;
    const designLink = proposalDesignLink(project, { status: 'applied',
      blueprintVersion: disposition.appliedBlueprintVersion, objectId: disposition.outputObjectId });
    return el('section', { className: 'human-task-output-applied', attrs: { 'aria-label': `Saved output ${output.label}` } }, [
      el('p', { text: `${output.label}: owner-authored content applied in proposed blueprint v${disposition.appliedBlueprintVersion}${superseded ? `; current design is v${disposition.currentBlueprintVersion}` : ''}.` }),
      el('p', { text: `Current saved design detail: ${disposition.currentDetail}` }),
      el('p', { className: 'muted', text: `Saved output reference: plan ${disposition.planId} revision ${disposition.revision}, task ${disposition.taskId}, instance ${disposition.planInstanceId}, event ${disposition.eventId}. The link opens the current design; it does not open a historical snapshot.` }),
      ...(designLink ? [el('a', { className: 'button', text: designLink.label, attrs: { href: designLink.href } })] : []),
    ]);
  }
  if (disposition.kind === 'stale') {
    return el('p', { className: 'muted human-task-output-stale', text: `${output.label} remains pinned to blueprint v${plan.source.blueprintVersion}, while the current design has advanced. A project owner must review and reconcile this task output against the current design.` });
  }
  if (disposition.kind === 'owner-review') {
    return el('p', { className: 'muted human-task-output-owner-review', text: `${output.label} is ready for explicit owner review. Only a current project owner can enter and apply proposed design content.` });
  }
  const key = humanTaskOutputApplicationKey({ project, plan, task, runtime, output });
  const pending = state.pendingHumanTaskOutputApplications.get(key) ?? null;
  const form = el('form', { className: 'execution-form human-task-output-application', attrs: {
    'aria-label': `Apply owner-entered content for ${output.label}`,
  } });
  form.append(el('p', { className: 'muted', text: `Owner-entered proposed design content for ${output.label}, pinned to blueprint v${disposition.blueprintVersion}.` }));
  form.append(el('p', { className: 'muted', text: 'Human evidence notes remain contextual provenance. They will not be copied into this output or treated as validation.' }));
  form.append(el('p', { text: `Pinned value before this owner update: ${disposition.before || 'No detail saved.'}` }));
  const detail = el('textarea', { attrs: { name: 'detail', required: 'required', maxlength: '700', rows: '4',
    'aria-label': `Owner-entered detail for ${output.label}`, ...(pending ? { disabled: 'disabled' } : {}) } });
  detail.value = pending?.payload?.detail ?? '';
  const submit = el('button', { className: 'button primary', text: pending ? 'Retry saved output update' : 'Apply owner-entered output',
    attrs: { type: 'submit', ...(pending?.submitting ? { disabled: 'disabled' } : {}) } });
  const status = el('p', { className: 'muted human-task-output-status', attrs: {
    role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true',
  }, text: pending ? pending.status : '' });
  form.append(el('label', { text: 'Proposed output detail (required)' }, detail), status, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!detail.value.trim() || detail.value.length > 700) {
      detail.setCustomValidity('Enter owner-authored output detail of 1–700 characters.');
      detail.reportValidity();
      return;
    }
    detail.setCustomValidity('');
    void applyHumanTaskOutputApplication({ project, plan, task, runtime, output, disposition, key, form, detail, submit, status });
  });
  return form;
}

async function applyHumanTaskOutputApplication({ project, plan, task, runtime, output, disposition, key, form, detail, submit, status }) {
  let pending = state.pendingHumanTaskOutputApplications.get(key);
  if (pending?.submitting) return;
  pending = humanTaskOutputCommand(pending, { commandId: `human-task-output:${crypto.randomUUID()}`,
    expectedVersion: project.version,
    payload: { planId: plan.id, revision: plan.revision, planInstanceId: runtime.planInstanceId,
        taskId: task.id, outputObjectId: output.objectId, blueprintId: plan.source.blueprintId,
        blueprintVersion: plan.source.blueprintVersion, before: disposition.before, detail: detail.value.trim() } });
  if (!pending) return;
  if (!state.pendingHumanTaskOutputApplications.has(key)) {
    state.pendingHumanTaskOutputApplications.set(key, pending);
  }
  pending.submitting = true;
  pending.status = 'Saving the owner-entered output against the pinned human checkpoint…';
  for (const field of form.querySelectorAll('textarea, select, input')) field.disabled = true;
  submit.disabled = true;
  status.textContent = pending.status;
  try {
    const result = await api(`/api/v1/projects/${encodeURIComponent(project.id)}/human-task-outputs/apply`, {
      method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', commandId: pending.commandId,
        expectedVersion: pending.expectedVersion, payload: pending.payload }),
    });
    state.pendingHumanTaskOutputApplications.delete(key);
    const stillSelected = state.planningProject?.id === project.id;
    if (stillSelected) state.planningProject = result.data;
    state.projects = state.projects.map((candidate) => candidate.id === result.data.id ? result.data : candidate);
    await refresh().catch(() => false);
    const plans = document.querySelector('#process-plans');
    if (stillSelected && plans && state.planningProject?.id === project.id) renderProcessPlans(plans, processPlansFor(), result.data);
    notify('Owner-entered content was saved as a new proposed blueprint version. The human checkpoint history remains unchanged.');
  } catch (error) {
    pending.submitting = false;
    if (error.status && error.status < 500) {
      state.pendingHumanTaskOutputApplications.delete(key);
      try {
        const current = await api(`/api/v1/projects/${encodeURIComponent(project.id)}`);
        const stillSelected = state.planningProject?.id === project.id;
        if (stillSelected) state.planningProject = current.data;
        state.projects = state.projects.map((candidate) => candidate.id === project.id ? current.data : candidate);
        await refresh();
        const plans = document.querySelector('#process-plans');
        if (stillSelected && plans && state.planningProject?.id === project.id) renderProcessPlans(plans, processPlansFor(), current.data);
      } catch {
        status.textContent = 'The command was rejected because its pinned state changed, but the current design could not be refreshed. Reload the project before entering new content.';
      }
      notify(error.message);
      return;
    }
    pending.status = 'The save result is uncertain. The submitted detail is frozen; retry sends the same command and payload.';
    detail.disabled = true;
    submit.disabled = false;
    submit.textContent = 'Retry saved output update';
    status.textContent = pending.status;
    notify(pending.status);
  }
}

function renderHumanTaskEscalation({ project, plan, task, selectedInstance }) {
  const form = el('form', { className: 'execution-form human-task-escalation', attrs: { 'aria-label': `Escalate assigned human task ${task.title}` } });
  form.append(el('p', { className: 'muted', text: 'Escalation pauses this task until a project owner reviews and resolves it.' }));
  const reason = el('textarea', { attrs: { name: 'reason', required: 'required', maxlength: '1000', rows: '2', 'aria-label': `Escalation reason for ${task.title}` } });
  const evidence = el('textarea', { attrs: { name: 'evidence', maxlength: '20099', rows: '4', 'aria-label': `Escalation evidence notes for ${task.title}` } });
  evidence.addEventListener('input', () => evidence.setCustomValidity(''));
  const submit = el('button', { className: 'button', text: 'Escalate to project owner', attrs: { type: 'submit' } });
  const status = el('p', { className: 'muted human-task-command-status', attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' } });
  form.append(el('label', { text: 'Reason (required)' }, reason), el('label', { text: 'Evidence notes, one per line (optional)' }, evidence), status, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const evidenceEntries = parseHumanTaskEvidence(evidence.value);
    if (!evidenceEntries) {
      evidence.setCustomValidity('Enter up to 20 evidence notes, one per line, with no note longer than 1000 characters.');
      evidence.reportValidity();
      return;
    }
    evidence.setCustomValidity('');
    void escalateHumanTask({ project, plan, task, selectedInstance, reason: reason.value, evidence: evidenceEntries, form, status, button: submit });
  });
  return form;
}

function renderHumanTaskEscalationResolution({ project, plan, task, selectedInstance, runtime }) {
  const form = el('form', { className: 'execution-form human-task-escalation-resolution', attrs: { 'aria-label': `Resolve escalated human task ${task.title}` } });
  const reassignmentCandidates = Array.isArray(runtime.humanReassignmentCandidates) ? runtime.humanReassignmentCandidates : [];
  const resolutionOptions = humanTaskEscalationResolutionOptions({
    instanceControlStatus: runtime.instanceControl?.status,
    reassignmentAvailable: reassignmentCandidates.length > 0,
  });
  const disposition = el('select', { attrs: { name: 'disposition', required: 'required', 'aria-label': `Owner resolution for ${task.title}` } }, [
    ...(resolutionOptions.initialChoiceRequired ? [el('option', {
      text: 'Choose an available owner resolution', attrs: { value: '', disabled: 'disabled', selected: 'selected' },
    })] : []),
    el('option', { text: resolutionOptions.resume.label, attrs: { value: 'resume', ...(resolutionOptions.resume.disabled ? { disabled: 'disabled' } : {}) } }),
    el('option', { text: resolutionOptions.reassign.label,
      attrs: { value: 'reassign', ...(resolutionOptions.reassign.disabled ? { disabled: 'disabled' } : {}) } }),
    el('option', { text: 'Mark succeeded', attrs: { value: 'succeeded', ...(resolutionOptions.succeeded.disabled ? { disabled: 'disabled' } : {}) } }),
    el('option', { text: 'Mark failed', attrs: { value: 'failed', ...(resolutionOptions.failed.disabled ? { disabled: 'disabled' } : {}) } }),
  ]);
  const targetPrincipal = el('select', { attrs: { name: 'targetPrincipal', 'aria-label': `New human assignee for ${task.title}`, disabled: 'disabled' } }, [
    el('option', { text: 'Choose an active human project member', attrs: { value: '' } }),
    ...reassignmentCandidates.map((candidate) => el('option', {
      text: `${candidate.displayName} (${candidate.principal.slice(-8)})`, attrs: { value: candidate.principal },
    })),
  ]);
  const targetLabel = el('label', { text: 'New assignee (owner override; the saved plan remains unchanged)', attrs: { hidden: 'hidden' } }, targetPrincipal);
  const reason = el('textarea', { attrs: { name: 'reason', required: 'required', maxlength: '1000', rows: '2', 'aria-label': `Owner resolution reason for ${task.title}` } });
  const evidence = el('textarea', { attrs: { name: 'evidence', maxlength: '20099', rows: '4', 'aria-label': `Owner verification evidence notes for ${task.title}` } });
  evidence.addEventListener('input', () => evidence.setCustomValidity(''));
  const syncResolutionFields = () => {
    const reassigning = disposition.value === 'reassign';
    evidence.required = ['succeeded', 'reassign'].includes(disposition.value);
    targetLabel.hidden = !reassigning;
    targetPrincipal.disabled = !reassigning;
    targetPrincipal.required = reassigning;
  };
  disposition.addEventListener('change', syncResolutionFields);
  syncResolutionFields();
  const submit = el('button', { className: 'button primary', text: 'Resolve escalation', attrs: { type: 'submit' } });
  const status = el('p', { className: 'muted human-task-command-status', attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' } });
  form.append(
    el('p', { className: 'muted', text: 'Only a project owner with workspace write access can resolve this escalation. Reassignment is an explicit owner override to another active human project member with workspace write access; it keeps the pinned plan unchanged. Reassignment and marking succeeded require evidence.' }),
    ...(resolutionOptions.pauseMessage ? [el('p', { className: 'muted', text: resolutionOptions.pauseMessage })] : []),
    el('label', { text: 'Resolution' }, disposition),
    targetLabel,
    el('label', { text: 'Owner reason (required)' }, reason),
    el('label', { text: 'Verification or work evidence notes, one per line' }, evidence), status, submit,
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const evidenceEntries = parseHumanTaskEvidence(evidence.value);
    if (!evidenceEntries || (['succeeded', 'reassign'].includes(disposition.value) && evidenceEntries.length === 0)) {
      evidence.setCustomValidity('Enter up to 20 verification, work, or reassignment evidence notes, one per line, with no note longer than 1000 characters. A succeeded or reassigned resolution needs at least one note.');
      evidence.reportValidity();
      return;
    }
    evidence.setCustomValidity('');
    void resolveHumanTaskEscalation({
      project, plan, task, selectedInstance, disposition: disposition.value,
      targetPrincipal: disposition.value === 'reassign' ? targetPrincipal.value : null,
      expectedVersion: disposition.value === 'reassign' ? runtime.version : null,
      reason: reason.value, evidence: evidenceEntries, form, status, button: submit,
    });
  });
  return form;
}

function humanTaskCommandKey(action, plan, task, instanceId) {
  return `${action}\n${plan.id}\n${plan.revision}\n${instanceId}\n${task.id}`;
}

async function startHumanTask({ project, plan, task, selectedInstance, button, status, requestKey }) {
  const key = requestKey ?? humanTaskStartCommandKey({ planId: plan.id, revision: plan.revision,
    planInstanceId: selectedInstance, taskId: task.id });
  if (state.submittingHumanTaskStarts.has(key)) return;
  const planInstanceSelectionKey = `${plan.id}\n${plan.revision}`;
  const selectionAtStart = state.selectedPlanInstances.get(planInstanceSelectionKey) ?? selectedInstance;
  const requestTenantId = project.tenantId;
  const requestPrincipal = state.currentPrincipal;
  const storageKeyFor = (pending) => humanTaskStartStorageKey({ tenantId: requestTenantId,
    principal: requestPrincipal, projectId: project.id, planId: plan.id, revision: plan.revision,
    planInstanceId: pending?.payload?.planInstanceId ?? null, taskId: task.id });
  const priorFocus = document.activeElement;
  let pending = state.pendingHumanTaskCommands.get(key) ?? readHumanTaskStart(processTaskIntentStorage(), storageKeyFor({
    payload: { planInstanceId: selectedInstance === 'new' ? undefined : selectedInstance },
  }));
  if (pending && (pending.tenantId !== requestTenantId || pending.principal !== requestPrincipal)) {
    notify('This saved start belongs to a different signed-in identity. Reload the project before retrying it.');
    return;
  }
  if (pending && (pending.payload?.projectId !== project.id || pending.payload?.planId !== plan.id
    || pending.payload?.revision !== plan.revision || pending.payload?.taskId !== task.id
    || pending.payload?.planInstanceId !== (selectedInstance === 'new' ? undefined : selectedInstance))) {
    notify('The saved start does not match this task selection. Reload the authorized task state before retrying it.');
    return;
  }
  if (!pending) {
    pending = { commandId: `human-task-start:${crypto.randomUUID()}`, status: 'pending',
      tenantId: requestTenantId, principal: requestPrincipal, payload: {
        projectId: project.id, planId: plan.id, revision: plan.revision, taskId: task.id,
        ...(selectedInstance !== 'new' ? { planInstanceId: selectedInstance } : {}),
      } };
  }
  state.pendingHumanTaskCommands.set(key, pending);
  saveHumanTaskStart(processTaskIntentStorage(), storageKeyFor(pending), pending);
  state.submittingHumanTaskStarts.add(key);
  const showStatus = (submitting = false) => {
    const presentation = humanTaskStartPresentation(state.pendingHumanTaskCommands.get(key) ?? pending, {
      submitting, displayedInstanceId: selectedInstance === 'new' ? null : selectedInstance,
    });
    button.disabled = presentation.buttonDisabled;
    button.textContent = presentation.buttonLabel;
    if (status) status.textContent = presentation.status;
  };
  button.disabled = true;
  showStatus(true);
  try {
    if (state.currentPrincipal !== requestPrincipal) throw Object.assign(new Error('The signed-in identity changed before the task start was sent. Its exact saved command remains available to its original assignee.'), { status: 403 });
    const runtime = await api('/api/execution/process-task-instances/start', {
      method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', commandId: pending.commandId, payload: pending.payload }),
    });
    pending = acceptHumanTaskStart(pending, runtime);
    if (!pending) throw Object.assign(new Error('The saved start response did not match its task, assignee or instance intent. The exact command remains saved for recovery.'), { retryable: true });
    state.pendingHumanTaskCommands.set(key, pending);
    saveHumanTaskStart(processTaskIntentStorage(), storageKeyFor(pending), pending);
    const stillSelected = state.planningProject?.id === project.id && state.currentPrincipal === requestPrincipal
      && document.querySelector('#plan-project')?.value === project.id
      && (state.selectedPlanInstances.get(planInstanceSelectionKey) ?? selectionAtStart) === selectionAtStart;
    if (stillSelected) {
      state.selectedPlanInstances.set(planInstanceSelectionKey, runtime.planInstanceId);
      syncExecutionRoute(project.id, {
        projectId: project.id, processPlanId: plan.id, revision: plan.revision,
        planInstanceId: runtime.planInstanceId,
      });
    }
    const refreshed = stillSelected ? await refresh() : false;
    if (refreshed && !state.pendingHumanTaskCommands.has(key)) {
      restoreHumanTaskStatusFocusAfterAction({ button, plan, task, planInstanceId: runtime.planInstanceId });
      notify('Human task started. Its assigned identity, start time and task history were confirmed in the current snapshot.');
    } else {
      showStatus();
      notify('The start was accepted, but the current task snapshot has not confirmed it. The exact command remains saved; retry it to reconcile.');
    }
  } catch (error) {
    const disposition = humanTaskActionFailureDisposition(error);
    if (state.pendingHumanTaskCommands.get(key)?.status === 'accepted') {
      notify('The start was accepted, but refresh did not confirm its current task state. Its exact command remains saved; retry it to reconcile.');
    } else if (disposition === 'reconcile') {
      const refreshed = state.planningProject?.id === project.id
        ? await reconcileHumanTaskConflict(project, plan, task, selectedInstance) : false;
      const reconciled = refreshed && !state.pendingHumanTaskCommands.has(key);
      if (reconciled) notify('The human checkpoint changed before this action was saved. Current history and available actions were refreshed.');
      else notify('The start could not be reconciled. Its exact command remains saved; review the current task state before trying again.');
    } else {
      if (definitiveHumanTaskStartRejection(error)) {
        state.pendingHumanTaskCommands.delete(key);
        clearHumanTaskStart(processTaskIntentStorage(), storageKeyFor(pending));
        pending = null;
      }
      notify(disposition === 'retry' ? 'The start result is uncertain. The exact command remains saved; retry it to recover the same task start.' : error.message);
    }
  } finally {
    state.submittingHumanTaskStarts.delete(key);
    if (button.isConnected) showStatus();
    if (document.activeElement === document.body && priorFocus?.isConnected) priorFocus.focus({ preventScroll: true });
  }
}

async function completeHumanTask({ project, plan, task, selectedInstance, result, evidence, form, status, button }) {
  const key = humanTaskCommandKey('complete', plan, task, selectedInstance);
  const priorFocus = document.activeElement;
  let saved = false;
  try {
    const submission = await submitHumanTaskCommand({
      action: 'complete', key, pendingCommands: state.pendingHumanTaskCommands,
      payload: { projectId: project.id, planId: plan.id, revision: plan.revision,
        planInstanceId: selectedInstance, taskId: task.id, result, evidence },
      form, button, status,
      send: (pending) => api('/api/execution/process-task-instances/complete', {
        method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', commandId: pending.commandId, payload: pending.payload }),
      }),
    });
    if (submission.kind === 'saved') {
      saved = true;
      await refresh();
      restoreHumanTaskStatusFocusAfterAction({ button, plan, task, planInstanceId: selectedInstance });
      notify('Human task outcome and evidence were saved to its process runtime.');
    } else if (submission.kind === 'reconcile') {
      const refreshed = await reconcileHumanTaskConflict(project, plan, task, selectedInstance);
      notify(refreshed
        ? 'The human checkpoint changed before this action was saved. Current history and available actions were refreshed.'
        : 'The human checkpoint changed before this action was saved. Reload the project to review its current history and actions.');
    } else if (submission.kind === 'retry') {
      notify('The completion result is uncertain. Form values are locked; use Retry saved completion to resend the same command.');
    } else if (submission.kind !== 'busy') {
      notify(submission.error?.message ?? 'The human task could not be completed.');
    }
  } catch (error) {
    notify(error.message);
  } finally {
    if (!saved) button.disabled = false;
    if (document.activeElement === document.body && priorFocus?.isConnected) priorFocus.focus({ preventScroll: true });
  }
}

async function submitHumanTaskAction({ action, project, plan, task, selectedInstance, details, form, status, button, success }) {
  const key = humanTaskCommandKey(action, plan, task, selectedInstance);
  const priorFocus = document.activeElement;
  let saved = false;
  try {
    const submission = await submitHumanTaskCommand({
      action, key, pendingCommands: state.pendingHumanTaskCommands,
      payload: { projectId: project.id, planId: plan.id, revision: plan.revision,
        planInstanceId: selectedInstance, taskId: task.id, ...details },
      form, button, status,
      send: (pending) => api(`/api/execution/process-task-instances/${action}`, {
        method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', commandId: pending.commandId, payload: pending.payload }),
      }),
    });
    if (submission.kind === 'saved') {
      saved = true;
      await refresh();
      restoreHumanTaskStatusFocusAfterAction({ button, plan, task, planInstanceId: selectedInstance });
      notify(success);
    } else if (submission.kind === 'reconcile') {
      const refreshed = await reconcileHumanTaskConflict(project, plan, task, selectedInstance);
      notify(refreshed
        ? 'The human checkpoint changed before this action was saved. Current history and available actions were refreshed.'
        : 'The human checkpoint changed before this action was saved. Reload the project to review its current history and actions.');
    } else if (submission.kind === 'retry') {
      const label = action === 'escalate' ? 'escalation' : 'resolution';
      notify(`The ${label} result is uncertain. Form values are locked; use Retry saved ${label} to resend the same command.`);
    } else if (submission.kind !== 'busy') {
      notify(submission.error?.message ?? 'The human task action could not be saved.');
    }
  } catch (error) {
    notify(error.message);
  } finally {
    if (!saved) button.disabled = false;
    if (document.activeElement === document.body && priorFocus?.isConnected) priorFocus.focus({ preventScroll: true });
  }
}

function escalateHumanTask({ project, plan, task, selectedInstance, reason, evidence, form, status, button }) {
  return submitHumanTaskAction({
    action: 'escalate', project, plan, task, selectedInstance, button,
    form, status,
    details: { reason: reason.trim(), evidence },
    success: 'Human task escalated to its project owner; the task is paused pending resolution.',
  });
}

function resolveHumanTaskEscalation({ project, plan, task, selectedInstance, disposition, targetPrincipal, expectedVersion, reason, evidence, form, status, button }) {
  return submitHumanTaskAction({
    action: 'resolve', project, plan, task, selectedInstance, button,
    form, status,
    details: { disposition, reason: reason.trim(), evidence,
      ...(targetPrincipal ? { targetPrincipal, expectedVersion } : {}) },
    success: disposition === 'reassign'
      ? 'Project owner reassigned the checkpoint to the selected active human; the saved plan remains unchanged.'
      : `Project owner saved the ${disposition} resolution for the human task.`,
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
  if (row?.status === 'enabled' && row.targetType === 'workload'
    && row.eligibilityStatus?.length === 1 && row.eligibilityStatus[0] === 'eligible' && row.targetName) {
    return `${actorLabel} · enabled organizational assignee: ${row.targetName}`;
  }
  return `${actorLabel} · enabled binding is stale or unavailable; target unresolved`;
}

function renderTaskAssignmentTransparency(task, plan, project) {
  const view = processTaskAssignmentTransparency({ task, plan, project,
    bindings: state.actorBindingRows, bindingProjectId: state.actorBindingProjectId,
    bindingReadAvailable: state.actorBindingReadAvailable });
  const field = (label, values) => el('p', { className: 'task-assignment-transparency-field' }, [
    el('strong', { text: `${label}: ` }), document.createTextNode(values.join(' · ')),
  ]);
  return el('details', { className: 'task-assignment-transparency' }, [
    el('summary', { text: view.disclosureSummary }),
    el('p', { className: 'muted', text: view.guidanceLabel }),
    field('Blueprint role', [view.roleName]),
    field('Responsibility', view.responsibility),
    field('Proposed scope and authority', view.scopeAndAuthority),
    field('Proposed instructions', view.instructions),
    field('Proposed tools (not enabled)', view.tools),
    field('Proposed escalation rules', view.escalationRules),
    field('Planned assignee', [view.assignee]),
    field('Enabled organizational responsibility target', [view.organizationalTarget]),
    field('Actual execution permission', [view.permissionBoundary]),
  ]);
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

async function requestTaskApproval({ project, plan, task, selectedInstance, profileId, repositorySelectionId,
  requestButton, profileSelect, repositorySelect, requestStatus, requestKey }) {
  const key = requestKey ?? processTaskRequestStorageKey({ tenantId: project.tenantId, principal: state.currentPrincipal,
    projectId: project.id, planId: plan.id, revision: plan.revision, planInstanceId: selectedInstance, taskId: task.id });
  let pending = state.pendingTaskRuns.get(key) ?? readPendingProcessTaskRequest(processTaskIntentStorage(), key);
  if (pending) {
    pending = { ...pending, tenantId: project.tenantId, principal: state.currentPrincipal };
    state.pendingTaskRuns.set(key, pending);
    savePendingProcessTaskRequest(processTaskIntentStorage(), key, pending);
  }
  const recoveringNewInstance = selectedInstance !== 'new' && pending?.status !== 'accepted'
    && pending?.payload?.planInstanceId === undefined;
  state.submittingTaskRequests.add(key);
  setTaskRequestControls({ requestButton, profileSelect, repositorySelect, status: requestStatus, pending,
    submitting: true, recoveringNewInstance });
  try {
    if (!pending) {
      const payload = {
        projectId: project.id, planId: plan.id, revision: plan.revision,
        taskId: task.id, profileId,
        ...(selectedInstance !== 'new' ? { planInstanceId: selectedInstance } : {}),
      };
      const selectedProfile = state.meta?.profiles?.find((entry) => entry.id === profileId);
      if (Number.isSafeInteger(selectedProfile?.catalogRevision)) payload.profileRevision = selectedProfile.catalogRevision;
      if (repositorySelectionId) {
        const repository = state.localRepositories.find((entry) => (entry.selectionId ?? entry.id) === repositorySelectionId);
        if (!repository) throw new Error('Reload the project to select a current local repository snapshot.');
        payload.repositoryId = repository.id;
        if (repository.kind === 'git') {
          payload.repositoryRefId = repository.refId;
          payload.repositoryCommitOid = repository.commitOid;
        }
        payload.snapshotDigest = repository.treeDigest;
      }
      pending = { commandId: `process-task-request:${crypto.randomUUID()}`, payload,
        tenantId: project.tenantId, principal: state.currentPrincipal };
      state.pendingTaskRuns.set(key, pending);
      savePendingProcessTaskRequest(processTaskIntentStorage(), key, pending);
    }
    const run = await api('/api/execution/process-task-runs', {
      method: 'POST',
      body: JSON.stringify({ schemaVersion: '1.0', commandId: pending.commandId, payload: pending.payload }),
    });
    const accepted = acceptProcessTaskRequest(pending, run);
    if (!accepted) throw Object.assign(new Error('The saved approval response did not match this task request. Its exact command remains available for reconciliation.'), { retryable: true });
    pending = accepted;
    state.pendingTaskRuns.set(key, pending);
    savePendingProcessTaskRequest(processTaskIntentStorage(), key, pending);
    state.run = run;
    syncExecutionRunRoute(run);
    const refreshed = await refresh();
    renderRun();
    renderList();
    if (refreshed && !state.pendingTaskRuns.has(key)) notify(run.meta?.replayed
      ? 'Recovered the existing approval request and confirmed its saved process task. No work was dispatched; independent approval is still required.'
      : 'Approval request created and linked to the saved process task. No work was dispatched; independent approval is still required.');
    else notify('The approval request was saved, but its process task is not yet confirmed. The original request stays locked; retry it to reconcile the saved receipt.');
  } catch (error) {
    const currentPending = state.pendingTaskRuns.get(key) ?? pending;
    if (currentPending?.status === 'accepted') {
      notify('The approval request was saved, but its process task is not yet confirmed. The original request stays locked; retry it to reconcile the saved receipt.');
    } else if (error.retryable && currentPending) {
      notify('The request result is uncertain. The profile and repository stay locked; retry the same approval command to recover its saved run.');
    } else {
      state.pendingTaskRuns.delete(key);
      clearPendingProcessTaskRequest(processTaskIntentStorage(), key);
      notify(error.message);
    }
  } finally {
    state.submittingTaskRequests.delete(key);
    setTaskRequestControls({ requestButton, profileSelect, repositorySelect, status: requestStatus,
      pending: state.pendingTaskRuns.get(key) ?? null, recoveringNewInstance });
  }
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
    renderProcessPlans(document.querySelector('#process-plans'), processPlansFor(result.data), result.data);
    focusProcessPlanCard(processPlanRevisionFocusTarget(result.event));
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
    syncExecutionRunRoute(state.run);
    await refresh(); renderRun(); notify('Execution request created. Independent approval is required.');
  } catch (error) { notify(error.message); button.disabled = false; }
}

async function load(id, { initiatingControl = null, event = null } = {}) {
  selectedRunRefreshRequestId += 1;
  deferredSelectedRun = null;
  if (selectedRunWaitMessage && executionAnnouncement.textContent === selectedRunWaitMessage) executionAnnouncement.textContent = '';
  selectedRunWaitMessage = '';
  const keyboardInvoked = isRunActionKeyboardActivation(event, initiatingControl, document);
  let focusMoved = false;
  const observeFocusMove = (focusEvent) => {
    if (focusEvent.target !== document.body && focusEvent.target !== initiatingControl) focusMoved = true;
  };
  if (keyboardInvoked) document.addEventListener('focusin', observeFocusMove);
  try {
    state.run = await api(`/api/execution/runs/${id}`);
    if (state.authenticated && state.run.processTaskRef && state.run.projectId) {
      try {
        state.taskInstances = (await api(`/api/execution/process-task-instances?projectId=${encodeURIComponent(state.run.projectId)}`)).instances;
      } catch { state.taskInstances = []; }
    }
    await loadProposalApplication(state.run);
    syncExecutionRunRoute(state.run);
    renderRun(); renderList();
    if (keyboardInvoked) restoreRunTransitionFocus({
      initiatingControl,
      documentRef: document,
      action: 'open-run',
      runStatus: state.run.status,
      keyboardInvoked,
      focusMoved,
      transitionSucceeded: true,
      findTarget: () => document.querySelector('[data-run-status-focus-target]'),
    });
  }
  catch (error) { notify(error.message); }
  finally { if (keyboardInvoked) document.removeEventListener('focusin', observeFocusMove); }
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

async function saveGeneratedProposalReview(form) {
  const run = state.run;
  const proposal = run?.execution?.generatedProposal;
  if (!proposal || !run.projectId || !state.authenticated || !run.proposalApplication?.canRecordReview
    || !Number.isInteger(state.runProject?.version)) return;
  const formData = new FormData(form);
  const criteria = HUMAN_PROPOSAL_RUBRIC.map(({ id }) => ({
    criterionId: id,
    judgment: String(formData.get(`judgment:${id}`) ?? ''),
    reason: String(formData.get(`reason:${id}`) ?? ''),
    evidence: formData.getAll(`evidence:${id}`).map((value) => {
      const citation = proposal.citations.find(({ id: citationId }) => citationId === value);
      return citation ? { sourceId: citation.id, sourceHash: citation.hash } : null;
    }).filter(Boolean),
  }));
  const missingEvidence = criteria.find(({ evidence }) => evidence.length === 0);
  if (missingEvidence) {
    notify(`Select at least one cited source for ${HUMAN_PROPOSAL_RUBRIC.find(({ id }) => id === missingEvidence.criterionId)?.label ?? 'each review criterion'}.`);
    form.querySelector(`input[name="evidence:${missingEvidence.criterionId}"]`)?.focus();
    return;
  }
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;
  let pending = state.pendingProposalReviews.get(run.id);
  if (!pending) {
    pending = { commandId: `blueprint-proposal-review:${crypto.randomUUID()}`,
      expectedVersion: state.runProject.version, proposalHash: proposal.proposalHash, criteria };
    state.pendingProposalReviews.set(run.id, pending);
  }
  try {
    const result = await api(`/api/v1/projects/${encodeURIComponent(run.projectId)}/blueprint-proposals/${encodeURIComponent(run.id)}/reviews`, {
      method: 'POST', body: JSON.stringify({ schemaVersion: '1.0',
        commandId: pending.commandId,
        expectedVersion: pending.expectedVersion,
        payload: { proposalHash: pending.proposalHash, criteria: pending.criteria } }),
    });
    state.pendingProposalReviews.delete(run.id);
    state.runProject = result.data;
    const applied = (result.data.events ?? []).find((event) => event.type === 'BlueprintProposalApplied'
      && event.data?.proposalHash === proposal.proposalHash);
    run.proposalApplication = deriveBlueprintProposalReviewState({
      proposal, project: result.data, membershipAccess: state.proposalMembershipAccess, appliedEvent: applied,
    });
    renderRun();
    notify('Owner rubric review saved as an append-only project event.');
  } catch (error) {
    if (proposalApplyFailureDisposition(error) === 'reconcile') state.pendingProposalReviews.delete(run.id);
    if (error.status === 409) {
      try {
        state.runProject = (await api(`/api/v1/projects/${encodeURIComponent(run.projectId)}`)).data;
        const applied = (state.runProject.events ?? []).find((event) => event.type === 'BlueprintProposalApplied'
          && event.data?.proposalHash === proposal.proposalHash);
        run.proposalApplication = deriveBlueprintProposalReviewState({
          proposal, project: state.runProject, membershipAccess: state.proposalMembershipAccess, appliedEvent: applied,
        });
        renderRun();
      } catch {
        state.runProject = null;
        run.proposalApplication = deriveBlueprintProposalReviewState({ proposal, project: null });
        renderRun();
      }
    }
    if (submit) submit.disabled = false;
    notify(error.message);
  }
}

async function command(action, body, event = null) {
  const button = document.querySelector(`[data-action="${action}"]`);
  const keyboardInvoked = isRunActionKeyboardActivation(event, button, document);
  let focusMoved = false;
  const observeFocusMove = (focusEvent) => {
    if (focusEvent.target !== document.body && focusEvent.target !== button) focusMoved = true;
  };
  if (keyboardInvoked) document.addEventListener('focusin', observeFocusMove);
  if (button) button.disabled = true;
  try {
    state.run = await api(`/api/execution/runs/${state.run.id}/${action}`, { method: 'POST', body: JSON.stringify({ version: state.run.version, ...body }) });
    await loadProposalApplication(state.run);
    await refresh(); renderRun();
    if (keyboardInvoked) restoreRunTransitionFocus({
      initiatingControl: button,
      documentRef: document,
      action,
      runStatus: state.run.status,
      keyboardInvoked,
      focusMoved,
      transitionSucceeded: true,
      findTarget: () => action === 'approve'
        ? document.querySelector('[data-action="execute"]')
        : document.querySelector('[data-run-status-focus-target]'),
    });
    notify(action === 'execute' ? 'Execution finished and evidence was saved.' : 'Independent approval recorded.');
  } catch (error) { notify(error.message); if (button) button.disabled = false; }
  finally { if (keyboardInvoked) document.removeEventListener('focusin', observeFocusMove); }
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
  const key = run.id;
  const existing = state.pendingRunAmendments.get(key);
  const values = existing ? null : Object.fromEntries(new FormData(form));
  const payload = existing?.payload ?? {
    objective: values.objective,
    requirements: values.requirements.split('\n').map((entry) => entry.trim()).filter(Boolean),
    reason: values.reason,
  };
  const button = form.querySelector('[type="submit"]');
  const status = form.querySelector('[role="status"]');
  const submission = await submitLinkedRunAmendment({ key, pendingCommands: state.pendingRunAmendments,
    projectId: run.projectId, version: run.version, payload,
    form, button, status,
    send: (pending) => api(`/api/execution/runs/${run.id}/amend`, {
      method: 'POST', body: JSON.stringify({ commandId: pending.commandId, version: pending.version,
        projectId: pending.projectId, ...pending.payload }),
    }),
  });
  if (submission.kind === 'busy') return;
  if (submission.kind === 'retry') {
    notify('The amendment result is uncertain. Retry the same saved instruction revision.');
    return;
  }
  if (submission.kind === 'discard') {
    notify(submission.error.message);
    return;
  }
  const disposition = await refreshLinkedRunAmendment({ key, pendingCommands: state.pendingRunAmendments,
    status, refresh: () => api(`/api/execution/runs/${encodeURIComponent(run.id)}`) });
  if (disposition.kind === 'refresh-failed') {
    notify(submission.kind === 'reconcile' ? 'The amendment was rejected, but current run state could not be refreshed.'
      : 'The amendment was saved, but current run state could not be refreshed.');
    return;
  }
  const currentRoute = new URL(window.location.href);
  if (state.run?.id !== run.id || currentRoute.searchParams.get('run') !== run.id) return;
  state.run = disposition.run;
  await loadProposalApplication(state.run);
  renderRun();
  if (submission.kind === 'reconcile') notify(submission.error.message);
  else notify(disposition.run.meta?.replayed ? 'The saved instruction amendment was restored.'
    : 'Instructions saved as a new revision. Resume will require fresh independent approval.');
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
        payload: { proposalHash: pending.proposalHash,
          reviewEventId: run.proposalApplication.review.eventId,
          reviewHash: run.proposalApplication.review.reviewHash },
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
  const usage = modelUsagePresentation(proposal.modelUsage);
  if (usage) content.push(el('p', { className: 'muted model-usage', text: usage.label }));
  const evaluation = proposal.evaluation;
  content.push(el('h4', { text: 'Structural checks only' }));
  content.push(el('p', { className: 'muted', text: 'These checks verify proposal structure and pinned references. They do not assess factual accuracy, source grounding, or provider quality.' }));
  if (evaluation?.evaluatorVersion === 1 && evaluation?.rubricVersion === 1
    && evaluation?.meaning === 'structural-checks-only' && Array.isArray(evaluation.checks)) {
    content.push(el('p', { text: `Evaluation: ${evaluation.status === 'passed' ? 'passed' : 'blocked'} · evaluator v${evaluation.evaluatorVersion} · rubric v${evaluation.rubricVersion}` }));
    content.push(el('ul', { className: 'proposal-structural-checks' }, evaluation.checks.map((check) => el('li', {
      text: `${check.status === 'passed' ? 'Passed' : 'Blocked'}: ${check.message}`,
    }))));
  } else {
    content.push(el('p', { className: 'muted', text: 'No supported structural evaluation is available. This proposal remains review-only.' }));
  }
  content.push(el('h4', { text: 'Owner semantic review' }));
  content.push(el('p', { className: 'muted', text: 'These are human judgments, not automated quality scores. Evidence references bind to the proposal’s cited saved sources; their IDs and hashes do not prove that a claim is true.' }));
  const review = application?.review;
  if (review) {
    content.push(el('p', { text: `Latest owner review: ${review.status === 'passed' ? 'all criteria passed' : 'needs attention'} · reviewer ${review.reviewer}` }));
    content.push(el('ul', { className: 'proposal-human-review' }, review.criteria.map((criterion) => {
      const evidenceNames = criterion.evidence.map((reference) => proposal.citations.find((citation) =>
        citation.id === reference.sourceId && citation.hash === reference.sourceHash)?.name ?? 'Unavailable cited source');
      return el('li', { text: `${HUMAN_PROPOSAL_RUBRIC.find(({ id }) => id === criterion.criterionId)?.label ?? criterion.criterionId}: ${criterion.judgment === 'pass' ? 'Pass' : 'Needs attention'} — ${criterion.reason} · evidence: ${evidenceNames.join(', ')}` });
    })));
    if (review.status === 'passed' && canApply) {
      content.push(el('p', { className: 'muted', text: 'All four owner judgments passed. Applying remains a separate action that creates a new proposed blueprint version.' }));
    }
  } else if (application?.status === 'review-required' || application?.status === 'review-needs-attention') {
    content.push(el('p', { className: 'muted', text: application.message }));
  }
  if (application?.canRecordReview) {
    const prior = new Map((review?.criteria ?? []).map((criterion) => [criterion.criterionId, criterion]));
    const rubricForm = el('form', { className: 'proposal-human-review-form', attrs: { 'data-form': 'proposal-human-review' } }, [
      el('p', { className: 'muted', text: 'Review each criterion against the task and cited source context. All four must pass to enable the separate apply action. A new review appends a record; it does not alter prior judgments.' }),
      ...HUMAN_PROPOSAL_RUBRIC.map(({ id, label }) => {
        const old = prior.get(id);
        const select = el('select', { attrs: { name: `judgment:${id}`, required: true, 'aria-label': `${label} judgment` } },
          [el('option', { text: 'Choose judgment', attrs: { value: '', disabled: true, ...(old ? {} : { selected: true }) } }),
            ...['pass', 'needs-attention'].map((judgment) => el('option', {
            text: judgment === 'pass' ? 'Pass' : 'Needs attention',
            attrs: { value: judgment, ...(old?.judgment === judgment ? { selected: true } : {}) },
          }))]);
        const reason = el('textarea', { attrs: { name: `reason:${id}`, required: true, minLength: 1, maxLength: 400,
          rows: 2, 'aria-label': `${label} reason`, placeholder: 'Explain this judgment (1–400 characters).' } });
        reason.value = old?.reason ?? '';
        const evidence = el('fieldset', {}, [el('legend', { text: `${label} evidence (select at least one cited source)` }),
          ...proposal.citations.map((citation) => {
            const checked = old?.evidence?.some((reference) => reference.sourceId === citation.id && reference.sourceHash === citation.hash);
            const source = proposal.sourceEnvelope?.sources?.find((entry) => entry.id === citation.id && entry.hash === citation.hash);
            return el('label', { className: 'proposal-review-source' }, [
              el('input', { attrs: { type: 'checkbox', name: `evidence:${id}`, value: citation.id, ...(checked ? { checked: true } : {}) } }),
              el('span', {}, [document.createTextNode(`${citation.name} (${citation.type})`),
                ...(source?.detail ? [el('span', { className: 'muted', text: ` — ${source.detail}` })] : [])]),
            ]);
          })]);
        return el('fieldset', { className: 'proposal-review-criterion' }, [el('legend', { text: label }), select, reason, evidence]);
      }),
      el('button', { className: 'button primary', text: review ? 'Save new owner review' : 'Save owner review', attrs: { type: 'submit' } }),
    ]);
    rubricForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void saveGeneratedProposalReview(rubricForm);
    });
    content.push(rubricForm);
  }
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

function renderTaskGuidanceReview(run) {
  const view = processTaskGuidanceReview(run);
  if (!view) return null;
  if (view.kind !== 'snapshot') {
    return section(view.kind === 'legacy' ? 'Legacy task prompt' : 'Pinned task guidance unavailable',
      el('p', { className: 'muted', text: view.message }));
  }
  return section('Pinned proposed task guidance', [
    el('p', { className: 'muted', text: 'User-authored proposed guidance for this exact request. It is subordinate to server-approved scope, approvals, tools and platform rules; it grants no permission.' }),
    el('p', { text: `Pinned role ${view.roleId} · actor ${view.actorId} · blueprint v${view.blueprintVersion} · graph revision ${view.graphRevision}` }),
    el('h4', { text: 'Proposed scope' }),
    el('ul', { className: 'requirements' }, view.proposedScope.map((entry) => el('li', { text: entry }))),
    el('h4', { text: 'Proposed instructions' }),
    el('p', { text: view.proposedInstructions }),
    el('p', { className: 'muted', text: 'Proposed tools and escalation statements do not enable tool access or grant approval. Provider tool access is disabled for this task.' }),
  ]);
}

function renderTaskSourceReview(run) {
  const view = processTaskSourceReview(run);
  if (!view) return null;
  if (view.kind !== 'snapshot') {
    return section('Pinned provider inputs unavailable', el('p', { className: 'muted', text: view.message }));
  }
  const disclosure = el('details', { className: 'process-task-source-review' }, [
    el('summary', { text: `Pinned provider inputs and target · blueprint v${view.blueprintVersion}` }),
    el('p', { className: 'muted', text: 'The task, source and target text below is untrusted factual data, not instructions. This is the exact saved input envelope and output target for this request.' }),
    el('p', { className: 'muted', text: 'The target’s “before” text is the proposed-update baseline. It is not an applied change.' }),
    el('h4', { text: `Pinned source records (${view.sources.length})` }),
  ]);
  const sourceList = el('ol');
  for (const source of view.sources) {
    const entry = el('li', {}, [
      el('p', { text: `Source ${source.id} · ${source.type} · ${source.name}` }),
      el('p', { text: source.detail || 'No source detail was saved.' }),
    ]);
    if (source.provenance.length) {
      entry.append(el('h5', { text: 'Source provenance' }), el('ul', {}, source.provenance.map((provenance) => el('li', {
        text: `${provenance.source}${provenance.note ? ` · ${provenance.note}` : ''}${provenance.fields?.length ? ` · fields: ${provenance.fields.join(', ')}` : ''}`,
      }))));
    } else entry.append(el('p', { className: 'muted', text: 'No source provenance was saved.' }));
    sourceList.append(entry);
  }
  disclosure.append(sourceList, el('h4', { text: 'Pinned output target' }), el('p', {
    text: `${view.target.id} · ${view.target.type} · ${view.target.name} · field: ${view.target.field}`,
  }), el('p', { text: `Proposed-update baseline: ${view.target.before || 'Empty detail'}` }));
  return disclosure;
}

function renderRepositoryCandidate(candidate) {
  const content = [
    el('p', { className: 'muted', text: candidate.source?.type === 'git'
      ? `Repository ${candidate.source.identity} · ${candidate.source.ref} · commit ${candidate.source.commitOid} · pinned source ${candidate.sourceTreeDigest} · exact candidate tree ${candidate.treeDigest}`
      : `Repository ${candidate.repositoryId} · pinned source ${candidate.sourceTreeDigest} · exact candidate tree ${candidate.treeDigest}` }),
    el('p', { className: 'muted', text: 'Review-only candidate. OrgWard has not written changes back to the configured repository or pushed them.' }),
  ];
  if (candidate.changes?.length) {
    const list = el('ul', { className: 'repository-candidate-diff', attrs: { 'aria-label': 'Candidate path changes' } });
    for (const change of candidate.changes) {
      const detail = `${change.change.replaceAll('_', ' ')} · ${change.path}`
        + (change.beforeMode || change.afterMode ? ` · mode ${change.beforeMode ?? '—'} → ${change.afterMode ?? '—'}` : '')
        + (change.beforeHash || change.afterHash ? ` · hash ${change.beforeHash?.slice(0, 12) ?? '—'} → ${change.afterHash?.slice(0, 12) ?? '—'}` : '');
      const item = el('li', {}, el('span', { text: detail }));
      if (change.change !== 'mode_changed' && (change.beforeHash || change.afterHash)) {
        const previewButton = el('button', { className: 'button', text: 'Preview text diff', attrs: { type: 'button' } });
        const preview = el('div', { className: 'repository-text-diff-preview', attrs: { 'aria-live': 'polite' } });
        previewButton.addEventListener('click', async () => {
          previewButton.disabled = true;
          preview.replaceChildren(el('p', { className: 'muted', text: 'Loading bounded text preview…' }));
          try {
            const base = `/api/execution/runs/${encodeURIComponent(candidate.runId)}`;
            const [beforeText, afterText] = await Promise.all([
              change.beforeHash
                ? fetch(`${base}/repository-source?path=${encodeURIComponent(change.path)}`).then((response) => readBoundedUtf8Response(response, change.beforeHash))
                : Promise.resolve(''),
              change.afterHash
                ? fetch(`${base}/artifact?path=${encodeURIComponent(change.path)}`).then((response) => readBoundedUtf8Response(response, change.afterHash))
                : Promise.resolve(''),
            ]);
            const lines = boundedLineDiff(beforeText, afterText);
            const diff = el('pre', { className: 'repository-text-diff' });
            for (const line of lines) diff.append(el('span', { className: `repository-diff-${line.type}`, text: line.text }), document.createTextNode('\n'));
            preview.replaceChildren(diff);
          } catch (error) {
            preview.replaceChildren(el('p', { className: 'muted', text: `${error.message} Use the file download links for review.` }));
          } finally {
            previewButton.disabled = false;
          }
        });
        item.append(previewButton, preview);
      }
      if (change.beforeHash) item.append(el('a', { text: 'Download pinned source file', attrs: {
        href: `/api/execution/runs/${encodeURIComponent(candidate.runId)}/repository-source?path=${encodeURIComponent(change.path)}`,
      } }));
      if (change.afterHash && change.change !== 'mode_changed') item.append(el('a', { text: 'Download captured candidate file', attrs: {
        href: `/api/execution/runs/${encodeURIComponent(candidate.runId)}/artifact?path=${encodeURIComponent(change.path)}`,
      } }));
      list.append(item);
    }
    content.push(list);
  } else content.push(el('p', { className: 'muted', text: 'The candidate contains no file changes.' }));
  if (candidate.verification) {
    const verification = candidate.verification;
    content.push(el('p', { text: `Verification ${verification.id} v${verification.version} · ${verification.status} · exit ${verification.exitCode} · tree ${verification.treeDigest} · command ${verification.commandHash} · output ${verification.outputHash}` }));
    if (typeof verification.stdoutTruncated !== 'boolean' || typeof verification.stderrTruncated !== 'boolean') {
      content.push(el('p', { className: 'muted', text: 'This saved verification record has no truncation metadata, so whether its output was truncated is unknown. The output hash covers the saved stdout and stderr.' }));
    } else if (verification.stdoutTruncated || verification.stderrTruncated) {
      const streams = [verification.stdoutTruncated ? 'stdout' : null, verification.stderrTruncated ? 'stderr' : null].filter(Boolean).join(' and ');
      content.push(el('p', { className: 'muted', text: `Saved verification ${streams} was truncated to the bounded capture. The output hash covers only the saved stdout and stderr.` }));
    } else {
      content.push(el('p', { className: 'muted', text: 'Verification output was not truncated. The output hash covers the saved stdout and stderr.' }));
    }
    if (verification.stdout) content.push(el('pre', { className: 'execution-output', text: verification.stdout }));
    if (verification.stderr) content.push(el('pre', { className: 'execution-output execution-error', text: verification.stderr }));
  }
  return section('Local repository candidate · review only', content);
}

function renderRun() {
  const run = state.run; main.replaceChildren();
  const effectiveInstructions = run.interventionRevisions?.at(-1) ?? run.workItem;
  const panel = el('section', { className: 'execution-panel' }, [
    el('div', { className: 'run-heading' }, [el('div', {}, [el('span', { className: 'eyebrow', text: `${run.profile.kind} · run revision ${run.version}` }), el('h2', { text: run.title })]), el('span', {
      className: `run-status status-${run.status}`,
      text: run.status.replaceAll('_', ' '),
      attrs: { tabindex: '-1', 'data-run-status-focus-target': run.id },
    })]),
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
    if (linkedProcessPlanTarget(run, state.projects, state.runtimePlans)) {
      const openPlan = el('button', { className: 'button', text: 'Open linked plan instance', attrs: { type: 'button', 'data-action': 'open-linked-plan' } });
      openPlan.addEventListener('click', () => openLinkedProcessPlan(run));
      processTaskDetails.push(openPlan);
    }
    panel.append(section('Saved process task', processTaskDetails));
  }
  const taskGuidance = renderTaskGuidanceReview(run);
  if (taskGuidance) panel.append(taskGuidance);
  const taskSource = renderTaskSourceReview(run);
  if (taskSource) panel.append(taskSource);
  panel.append(section('Approval boundary', approvalControls(run)));
  panel.append(section('Requirements', effectiveInstructions.requirements.length ? el('ul', { className: 'requirements' }, effectiveInstructions.requirements.map((entry) => el('li', { text: entry }))) : el('p', { className: 'muted', text: 'No acceptance requirements supplied.' })));
  if (run.execution) panel.append(section('Execution evidence', executionEvidence(run.execution, run.id)));
  if (run.execution?.generatedProposal) panel.append(renderGeneratedProposal(run.execution.generatedProposal, run.proposalApplication));
  if (run.execution?.repositoryCandidate) panel.append(renderRepositoryCandidate({ ...run.execution.repositoryCandidate, runId: run.id }));
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
    if (state.authenticated) button.addEventListener('click', (event) => command('approve', {}, event));
    else {
      const input = el('input', { attrs: { value: 'studio-governor', 'aria-label': 'Approver identity', maxlength: '120' } });
      button.addEventListener('click', (event) => command('approve', { principal: input.value, roles: ['execution-approver'] }, event));
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
    button.addEventListener('click', (event) => command('execute', state.authenticated ? {} : { principal: 'local-execution-worker' }, event));
    return [el('p', { text: `Approved by ${run.approval.principal}. The profile executable and arguments are server-controlled. Pausing now clears this approval; resume requires a new independent approval.` }), button,
      ...(canWithdraw ? [pauseButton('Pause and require new approval')] : []),
      ...(canWithdraw ? [withdrawalButton()] : [])];
  }
  if (run.processTaskRef && run.status === 'PAUSED') {
    const revision = run.interventionRevisions?.at(-1) ?? run.workItem;
    const canOwnerRecover = run.requestedBy !== state.currentPrincipal && canRecoverLinkedRun(run);
    const pendingAmendment = state.pendingRunAmendments.get(run.id);
    const amendForm = el('form', { className: 'execution-form' }, [
      el('label', {}, ['Amended objective', el('textarea', { attrs: { name: 'objective', required: true, maxlength: '4000', rows: '4' }, text: pendingAmendment?.payload.objective ?? revision.objective })]),
      el('label', {}, ['Requirements, one per line', el('textarea', { attrs: { name: 'requirements', maxlength: '26000', rows: '4' }, text: pendingAmendment?.payload.requirements.join('\n') ?? revision.requirements.join('\n') })]),
      el('label', {}, ['Reason for change', el('textarea', { attrs: { name: 'reason', required: true, maxlength: '1000', rows: '2' }, text: pendingAmendment?.payload.reason ?? '' })]),
      el('button', { className: 'button', text: 'Save new instruction revision', attrs: { type: 'submit' } }),
      el('p', { className: 'muted', attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' } }),
    ]);
    restoreLinkedRunAmendment({ pending: pendingAmendment, form: amendForm,
      button: amendForm.querySelector('[type="submit"]'), status: amendForm.querySelector('[role="status"]') });
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
    const cancelledByInstance = run.events?.some((entry) => entry.type === 'ExecutionCancelledByProcessInstanceController');
    return el('p', { text: cancelledByInstance
      ? 'The parent process instance was cancelled before this task started. Its run history remains available; starting again requires a new plan instance.'
      : 'The requester withdrew this linked task before work started. A retry requires a new plan instance.' });
  }
  return el('p', { text: run.approval ? `Approved by ${run.approval.principal} at ${new Date(run.approval.approvedAt).toLocaleString()}.` : 'No approval recorded.' });
}

function executionEvidence(execution, runId) {
  const providerDiagnostic = deepSeekOutcomeDiagnosticCopy(execution.providerDiagnostic);
  const wrap = el('div', { className: 'evidence-grid' }, [
    el('div', {}, [el('b', { text: 'Result' }), el('span', { text: execution.status ?? 'FAILED' })]),
    el('div', {}, [el('b', { text: 'Exit code' }), el('span', { text: String(execution.exitCode ?? 'n/a') })]),
    el('div', {}, [el('b', { text: 'Artifacts' }), el('span', { text: String(execution.changedArtifacts?.length ?? 0) })]),
    el('div', {}, [el('b', { text: 'Evidence hash' }), el('span', { text: execution.evidenceHash?.slice(0, 18) ?? 'n/a' })]),
  ]);
  const usage = modelUsagePresentation(execution.modelUsage);
  if (usage) wrap.append(el('p', { className: 'muted model-usage', text: usage.label }));
  if (providerDiagnostic) wrap.append(el('p', { className: 'muted provider-outcome-diagnostic', text: providerDiagnostic }));
  if (execution.stdoutTruncated === true || execution.stderrTruncated === true) {
    const streams = [execution.stdoutTruncated ? 'stdout' : null, execution.stderrTruncated ? 'stderr' : null].filter(Boolean).join(' and ');
    wrap.append(el('p', { className: 'muted', text: `Saved ${streams} is bounded; earlier output may be omitted.` }));
  } else if (execution.adapter?.port === 'ExecutionPort'
    && (typeof execution.stdoutTruncated !== 'boolean' || typeof execution.stderrTruncated !== 'boolean')) {
    wrap.append(el('p', { className: 'muted', text: 'This saved run has no output truncation metadata, so whether earlier stdout or stderr was omitted is unknown.' }));
  }
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
  const routeRun = executionRunRouteTarget(window.location.href, state.runs);
  if (routePlan.requested && !planTarget) notify('The linked plan revision or instance is no longer available.');
  if (routeProcess.requested && !processTarget) notify('The selected saved process is no longer available. Choose a current process to continue.');
  if (routeRun.requested && !routeRun.target) notify('The selected run is no longer available in this workspace.');
  if (planTarget) showNew({ planTarget });
  else if (processTarget) showNew({ preferredProcessId: processTarget.processId, preserveProcessRoute: true });
  else if (routeRun.target) await load(routeRun.target.runId);
  else if (routeRun.requested) showNew();
  else if (projectContext.projectId) showNew();
  else if (state.runs.length) await load(state.runs[0].id);
  else showNew();
} catch (error) { notify(error.message); }
