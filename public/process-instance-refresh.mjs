import { deepSeekOutcomeDiagnosticCopy } from './provider-outcome-diagnostic.mjs';
import { cancelLiveRegionAnnouncement, scheduleLiveRegionAnnouncement } from './process-task-announcement.mjs';

function sameProjectSnapshot(currentProject, nextProject) {
  if (!currentProject && !nextProject) return true;
  if (!currentProject || !nextProject) return false;
  return currentProject.id === nextProject.id && currentProject.version === nextProject.version;
}

export function processInstanceRefreshDisposition({ currentInstances = [], nextInstances = [], currentRuns = [], nextRuns = [],
  currentProject = null, nextProject = null, container, documentRef }) {
  if (JSON.stringify(currentInstances) === JSON.stringify(nextInstances)
    && JSON.stringify(currentRuns) === JSON.stringify(nextRuns)
    && sameProjectSnapshot(currentProject, nextProject)) return 'unchanged';
  if (!container) return 'apply';
  for (const control of container.querySelectorAll('input, textarea, select')) {
    if (control.disabled) continue;
    if (control.type === 'checkbox' || control.type === 'radio') {
      if (control.checked !== control.defaultChecked) return 'defer-dirty';
    } else if (control.tagName === 'SELECT') {
      if ([...control.options].some((option) => option.selected !== option.defaultSelected)) return 'defer-dirty';
    } else if (control.value !== control.defaultValue) return 'defer-dirty';
  }
  const active = documentRef?.activeElement;
  if (active && active !== documentRef.body && container.contains(active)) return 'defer-focus';
  return 'apply';
}

export function processInstanceRefreshMessage(disposition) {
  if (disposition === 'defer-dirty') return 'New saved project updates are available. Save or discard your current edit to show them.';
  if (disposition === 'defer-focus') return 'New saved project updates are available. Move focus outside the plan to show them.';
  return '';
}

export function updateProcessInstanceRefreshStatus({ visibleRegion, liveRegion } = {}, message,
  { schedule, isCurrent = () => true } = {}) {
  if (typeof message !== 'string') return false;
  let changed = false;
  if (visibleRegion && visibleRegion.textContent !== message) {
    visibleRegion.textContent = message;
    changed = true;
  }
  if (liveRegion) {
    if (message) {
      const alreadyAnnounced = liveRegion.textContent === message;
      const timer = scheduleLiveRegionAnnouncement(liveRegion, message, { schedule, isCurrent });
      if (!alreadyAnnounced && timer !== null) changed = true;
    } else if (cancelLiveRegionAnnouncement(liveRegion)) changed = true;
  }
  return changed;
}

function processTaskInstanceKey(instance) {
  return [instance.projectId ?? '', instance.processPlanId ?? '', instance.revision ?? '',
    instance.planInstanceId ?? '', instance.taskId ?? ''].join('\n');
}

function displayProcessTaskStatus(status) {
  return String(status ?? '').replaceAll('_', ' ').toLowerCase();
}

function processTaskTitle(instance, processPlans) {
  const plan = processPlans.find((candidate) => candidate.id === instance.processPlanId
    && Number(candidate.revision ?? 1) === Number(instance.revision ?? 1));
  return plan?.tasks?.find((task) => task.id === instance.taskId)?.title || instance.taskId || 'Process task';
}

function linkedRunFor(runtime, runs = []) {
  if (!runtime?.executionRunId) return null;
  return runs.find((run) => run.id === runtime.executionRunId
    && run.projectId === runtime.projectId
    && run.processTaskRef?.processPlanId === runtime.processPlanId
    && Number(run.processTaskRef?.revision) === Number(runtime.revision)
    && run.processTaskRef?.planInstanceId === runtime.planInstanceId
    && run.processTaskRef?.taskId === runtime.taskId) ?? null;
}

function hasUnknownOutcome(run) {
  return run?.execution?.providerDiagnostic?.outcome === 'outcome_unknown';
}

export function processInstanceStatusAnnouncement(previousInstances = [], nextInstances = [], processPlans = [],
  previousRuns = [], nextRuns = [], maxTransitions = 3) {
  const previousByKey = new Map(previousInstances.map((instance) => [processTaskInstanceKey(instance), instance]));
  const transitions = [];
  for (const next of nextInstances) {
    const previous = previousByKey.get(processTaskInstanceKey(next));
    if (!previous) continue;
    const nextLinkedRun = linkedRunFor(next, nextRuns);
    const previousLinkedRun = linkedRunFor(previous, previousRuns);
    const outcomeBecameUnknown = previousLinkedRun && !hasUnknownOutcome(previousLinkedRun)
      && hasUnknownOutcome(nextLinkedRun);
    if (!outcomeBecameUnknown && (previous.status === next.status || !next.status)) continue;
    const title = processTaskTitle(next, processPlans);
    transitions.push(outcomeBecameUnknown
      ? { title, unknownOutcome: true, outcomeCopy: deepSeekOutcomeDiagnosticCopy(nextLinkedRun.execution?.providerDiagnostic) }
      : { title, from: displayProcessTaskStatus(previous.status), to: displayProcessTaskStatus(next.status) });
  }
  if (!transitions.length) return '';
  const limit = Math.max(1, Math.min(5, Number.isInteger(maxTransitions) ? maxTransitions : 3));
  const prioritizedTransitions = transitions.some((transition) => transition.unknownOutcome)
    ? [...transitions.filter((transition) => transition.unknownOutcome), ...transitions.filter((transition) => !transition.unknownOutcome)]
    : transitions;
  if (prioritizedTransitions.length === 1 && !prioritizedTransitions[0].unknownOutcome) {
    const [{ title, from, to }] = prioritizedTransitions;
    return `${title} changed from ${from} to ${to}.`;
  }
  if (prioritizedTransitions.length === 1) {
    const { title, outcomeCopy } = prioritizedTransitions[0];
    return `${title}: ${outcomeCopy || 'Outcome unknown. An external request may have been received. Delivery is unverified. Reconcile with the provider before retrying.'}`;
  }
  const visible = prioritizedTransitions.slice(0, limit).map(({ title, from, to, unknownOutcome, outcomeCopy }) => unknownOutcome
    ? `${title}: ${outcomeCopy || 'Outcome unknown. An external request may have been received. Delivery is unverified. Reconcile with the provider before retrying.'}`
    : `${title} changed from ${from} to ${to}`);
  const remaining = prioritizedTransitions.length - visible.length;
  const label = prioritizedTransitions.some((transition) => transition.unknownOutcome)
    ? `${prioritizedTransitions.length} process task updates` : `${prioritizedTransitions.length} process tasks changed status`;
  return `${label}: ${visible.join('; ')}${remaining ? `; and ${remaining} more` : ''}.`;
}

export function isCurrentProcessInstanceRefresh({ requestId, currentRequestId, projectId, currentProjectId,
  snapshotProjectId, routeKey, currentRouteKey }) {
  return requestId === currentRequestId && projectId === currentProjectId
    && (snapshotProjectId === undefined || snapshotProjectId === projectId)
    && (routeKey === undefined || routeKey === currentRouteKey);
}
