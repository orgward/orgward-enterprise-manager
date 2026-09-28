const STORAGE_PREFIX = 'orgward.human-task-start.v1';

function token(value) {
  return encodeURIComponent(String(value ?? 'unknown'));
}

export function humanTaskStartCommandKey({ planId, revision, planInstanceId, taskId }) {
  return `start\n${planId}\n${revision}\n${planInstanceId ?? 'new'}\n${taskId}`;
}

export function humanTaskStartStorageKey({ tenantId, principal, projectId, planId, revision, planInstanceId, taskId }) {
  return [STORAGE_PREFIX, tenantId, principal, projectId, planId, revision, planInstanceId ?? 'new', taskId]
    .map(token).join(':');
}

function validPending(value) {
  return Boolean(value && typeof value.commandId === 'string' && value.commandId.startsWith('human-task-start:')
    && ['pending', 'accepted'].includes(value.status)
    && value.payload && typeof value.payload === 'object' && !Array.isArray(value.payload)
    && value.tenantId && value.principal
    && (value.status !== 'accepted' || (value.accepted && typeof value.accepted === 'object'
      && typeof value.accepted.planInstanceId === 'string')));
}

export function readHumanTaskStart(storage, key) {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw);
    return validPending(value) ? value : null;
  } catch { return null; }
}

export function saveHumanTaskStart(storage, key, value) {
  try { storage?.setItem(key, JSON.stringify(value)); } catch { /* The authorized runtime snapshot remains authoritative. */ }
}

export function clearHumanTaskStart(storage, key) {
  try { storage?.removeItem(key); } catch { /* A later mount can still retry the saved command. */ }
}

export function restoreHumanTaskStarts(storage, { tenantId, principal, projectId, planId, revision }) {
  if (!storage || !tenantId || !principal || !projectId || !planId || !Number.isSafeInteger(revision)) return [];
  const prefix = `${humanTaskStartStorageKey({ tenantId, principal, projectId, planId, revision,
    planInstanceId: 'scope-scan', taskId: 'scope-scan' }).split(':').slice(0, 6).join(':')}:`;
  const restored = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const pending = readHumanTaskStart(storage, key);
      if (!pending || pending.tenantId !== tenantId || pending.principal !== principal
        || pending.payload?.projectId !== projectId || pending.payload?.planId !== planId
        || pending.payload?.revision !== revision || typeof pending.payload?.taskId !== 'string') continue;
      const expectedKey = humanTaskStartStorageKey({ tenantId, principal, projectId, planId, revision,
        planInstanceId: pending.payload.planInstanceId ?? null, taskId: pending.payload.taskId });
      if (key !== expectedKey) continue;
      restored.push({ key, commandKey: humanTaskStartCommandKey({ planId, revision,
        planInstanceId: pending.payload.planInstanceId ?? 'new', taskId: pending.payload.taskId }), pending });
    }
  } catch { return restored; }
  return restored;
}

export function acceptHumanTaskStart(pending, runtime) {
  const payload = pending?.payload;
  if (!validPending(pending) || !payload || !runtime || typeof runtime !== 'object'
    || runtime.projectId !== payload.projectId || runtime.processPlanId !== payload.planId
    || runtime.revision !== payload.revision || runtime.taskId !== payload.taskId
    || typeof runtime.planInstanceId !== 'string' || !runtime.planInstanceId
    || (payload.planInstanceId !== undefined && runtime.planInstanceId !== payload.planInstanceId)
    || runtime.status !== 'IN_PROGRESS' || runtime.assignedToCurrentPrincipal !== true) return null;
  return { ...pending, status: 'accepted', accepted: { projectId: payload.projectId,
    planId: payload.planId, revision: payload.revision, planInstanceId: runtime.planInstanceId, taskId: payload.taskId } };
}

export function humanTaskStartReconciled(pending, { tenantId, principal, projectId, instances = [] } = {}) {
  if (!validPending(pending) || pending.status !== 'accepted' || pending.tenantId !== tenantId
    || pending.principal !== principal || pending.accepted?.projectId !== projectId
    || pending.accepted.planId !== pending.payload.planId || pending.accepted.revision !== pending.payload.revision
    || pending.accepted.taskId !== pending.payload.taskId
    || (pending.payload.planInstanceId !== undefined && pending.accepted.planInstanceId !== pending.payload.planInstanceId)
    || !Array.isArray(instances)) return false;
  const expected = pending.accepted;
  return instances.some((runtime) => runtime?.projectId === expected.projectId
    && runtime.processPlanId === expected.planId && runtime.revision === expected.revision
    && runtime.planInstanceId === expected.planInstanceId && runtime.taskId === expected.taskId
    && runtime.status === 'IN_PROGRESS' && runtime.assignedToCurrentPrincipal === true);
}

export function humanTaskStartPresentation(pending, { submitting = false, displayedInstanceId = null } = {}) {
  if (submitting) return { buttonDisabled: true, buttonLabel: 'Starting assigned human task…',
    status: 'Starting the saved task command. Its command and task references are locked.' };
  if (!pending) return { buttonDisabled: false, buttonLabel: 'Start assigned human task', status: '' };
  const accepted = pending.status === 'accepted';
  const originalNewIntent = pending.payload?.planInstanceId === undefined;
  const targetInstanceId = pending.accepted?.planInstanceId ?? pending.payload?.planInstanceId ?? null;
  const unrelatedDisplayedInstance = displayedInstanceId && targetInstanceId && displayedInstanceId !== targetInstanceId;
  if (accepted) return { buttonDisabled: false, buttonLabel: 'Reconcile saved task start',
    status: `The start was accepted for instance ${targetInstanceId}, but its current authorized task state is not confirmed. Retry sends the same command.${unrelatedDisplayedInstance ? ' It is not the instance currently displayed.' : ''}` };
  if (originalNewIntent) return { buttonDisabled: false, buttonLabel: 'Retry saved new-instance start',
    status: 'This uncertain start was submitted for a new process instance. It is not tied to the instance currently displayed; retry sends the same command and task references.' };
  return { buttonDisabled: false, buttonLabel: 'Retry saved task start',
    status: `This start result is uncertain for instance ${targetInstanceId}. Retry sends the same saved command and task references.` };
}
