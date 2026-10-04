const STORAGE_PREFIX = 'orgward.process-task.pending.v1';

function token(value) {
  return encodeURIComponent(String(value ?? 'unknown'));
}

export function processTaskRequestStorageKey({ tenantId, principal, projectId, planId, revision, planInstanceId, taskId }) {
  return [STORAGE_PREFIX, tenantId, principal, projectId, planId, revision, planInstanceId || 'new', taskId]
    .map(token).join(':');
}

export function readPendingProcessTaskRequest(storage, key) {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value || typeof value.commandId !== 'string' || !value.commandId.startsWith('process-task-request:')
      || !value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) return null;
    if (value.status !== undefined && !['pending', 'accepted'].includes(value.status)) return null;
    if (value.status === 'accepted' && (typeof value.acceptedRunId !== 'string'
      || !value.acceptedProcessTaskRef || typeof value.acceptedProcessTaskRef !== 'object'
      || Array.isArray(value.acceptedProcessTaskRef))) return null;
    return value;
  } catch { return null; }
}

export function savePendingProcessTaskRequest(storage, key, value) {
  try { storage?.setItem(key, JSON.stringify(value)); } catch { /* The server receipt remains authoritative if browser storage is unavailable. */ }
}

export function clearPendingProcessTaskRequest(storage, key) {
  try { storage?.removeItem(key); } catch { /* The server receipt remains authoritative if browser storage is unavailable. */ }
}

export function processTaskRequestScopeMatches(pending, { tenantId, principal, projectId, planId, revision, taskId, planInstanceId }) {
  const instanceMatches = planInstanceId === undefined || (planInstanceId === 'new'
    ? pending?.payload?.planInstanceId === undefined
    : pending?.payload?.planInstanceId === planInstanceId || (pending?.payload?.planInstanceId === undefined
      && (pending?.status !== 'accepted' || pending?.acceptedProcessTaskRef?.planInstanceId === planInstanceId)));
  return Boolean(pending && (pending.tenantId === undefined || pending.tenantId === tenantId)
    && (pending.principal === undefined || pending.principal === principal)
    && pending.payload?.projectId === projectId && pending.payload.planId === planId
    && pending.payload.revision === revision && pending.payload.taskId === taskId && instanceMatches);
}

export function findPendingProcessTaskRequest(storage, { key, tenantId, principal, projectId, planId, revision, planInstanceId, taskId }) {
  const direct = readPendingProcessTaskRequest(storage, key);
  const matchesTask = (candidate) => processTaskRequestScopeMatches(candidate, { tenantId, principal, projectId, planId, revision, taskId });
  const directInstanceMatches = planInstanceId === 'new'
    ? direct?.payload?.planInstanceId === undefined
    : direct?.payload?.planInstanceId === planInstanceId;
  if (matchesTask(direct) && directInstanceMatches) return { key, pending: direct };
  if (!storage || planInstanceId === 'new') return null;
  const newIntentKey = processTaskRequestStorageKey({ tenantId, principal, projectId, planId, revision,
    planInstanceId: null, taskId });
  const taskKeyPrefix = `${processTaskRequestStorageKey({ tenantId, principal, projectId, planId, revision,
    planInstanceId: '__request-scan__', taskId }).split(':').slice(0, 6).join(':')}:`;
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const candidateKey = storage.key(index);
      if (!candidateKey?.startsWith(taskKeyPrefix)) continue;
      const candidate = readPendingProcessTaskRequest(storage, candidateKey);
      if (!matchesTask(candidate)) continue;
      const ref = candidate.acceptedProcessTaskRef;
      if (candidate.payload?.planInstanceId === planInstanceId
        || (candidate.status === 'accepted' && ref?.tenantId === tenantId && ref?.principal === principal
          && ref?.projectId === projectId && ref?.processPlanId === planId && ref?.revision === revision
          && ref?.taskId === taskId && ref?.planInstanceId === planInstanceId)
        || (candidateKey === newIntentKey && candidate.status !== 'accepted'
          && candidate.payload?.planInstanceId === undefined)) return { key: candidateKey, pending: candidate };
    }
  } catch { /* A reload can still recover through the canonical pending key. */ }
  return null;
}

export function acceptProcessTaskRequest(pending, run) {
  const ref = run?.processTaskRef;
  const { projectId, planId, revision, taskId, planInstanceId } = pending?.payload ?? {};
  if (!pending || typeof pending.commandId !== 'string' || typeof run?.id !== 'string'
    || run.tenantId !== pending.tenantId || run.projectId !== projectId || ref?.processPlanId !== planId || ref?.revision !== revision
    || ref?.taskId !== taskId || typeof ref?.planInstanceId !== 'string'
    || (planInstanceId !== undefined && ref.planInstanceId !== planInstanceId)) return null;
  return { ...pending, status: 'accepted', acceptedRunId: run.id,
    acceptedProcessTaskRef: { tenantId: pending.tenantId, principal: pending.principal,
      projectId, processPlanId: planId, revision, taskId, planInstanceId: ref.planInstanceId } };
}

export function processTaskRequestReconciled(pending, { runs = [], instances = [] } = {}) {
  if (pending?.status !== 'accepted' || !Array.isArray(runs) || !Array.isArray(instances)) return false;
  const expected = pending.acceptedProcessTaskRef;
  const run = runs.find((candidate) => candidate?.id === pending.acceptedRunId);
  if (!run || run.tenantId !== expected.tenantId || run.projectId !== expected.projectId
    || run.processTaskRef?.processPlanId !== expected.processPlanId
    || run.processTaskRef?.revision !== expected.revision || run.processTaskRef?.taskId !== expected.taskId
    || run.processTaskRef?.planInstanceId !== expected.planInstanceId) return false;
  return instances.some((instance) => instance?.projectId === expected.projectId
    && instance.processPlanId === expected.processPlanId && instance.revision === expected.revision
    && instance.planInstanceId === expected.planInstanceId && instance.taskId === expected.taskId
    && instance.executionRunId === pending.acceptedRunId);
}

export function reconciledSavedProcessTaskRequests(storage, { tenantId, principal, projectId, runs = [], instances = [] }) {
  if (!storage || !tenantId || !principal || !projectId || !Array.isArray(runs) || !Array.isArray(instances)) return [];
  const prefix = `${processTaskRequestStorageKey({ tenantId, principal, projectId,
    planId: '__request_scan__', revision: 0, planInstanceId: null, taskId: '__request_scan__' }).split(':').slice(0, 4).join(':')}:`;
  const reconciled = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const pending = readPendingProcessTaskRequest(storage, key);
      if (pending?.tenantId !== tenantId || pending.principal !== principal || pending.status !== 'accepted'
        || pending.payload?.projectId !== projectId || !processTaskRequestReconciled(pending, { runs, instances })) continue;
      reconciled.push({ key, pending });
    }
  } catch { return reconciled; }
  return reconciled;
}

export function processTaskRequestPresentation(pending, { submitting = false, recoveringNewInstance = false } = {}) {
  if (submitting) return { locked: true, buttonDisabled: true, buttonLabel: 'Submitting approval request…',
    status: 'Submitting the saved task approval request.' };
  if (!pending) return { locked: false, buttonDisabled: false, buttonLabel: 'Create approval request', status: '' };
  if (pending.status === 'accepted') return { locked: true, buttonDisabled: false, buttonLabel: 'Reconcile saved approval request',
    status: 'The approval request was saved. The task stays locked until its linked process instance is confirmed.' };
  if (recoveringNewInstance) return { locked: true, buttonDisabled: false, buttonLabel: 'Retry saved new-instance request',
    status: 'This uncertain request was originally submitted to create a new process instance. It is not tied to the instance currently displayed; retry sends the same saved command and selections.' };
  return { locked: true, buttonDisabled: false, buttonLabel: 'Retry same approval request',
    status: 'The request result is uncertain. Retry sends the same saved command and selections.' };
}
