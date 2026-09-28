export function blockedProcessTaskRecoveryCopy({ blockedTitles = [], uncertainDelivery = false } = {}) {
  const tasks = blockedTitles.length ? blockedTitles.join(', ') : 'An upstream task';
  if (uncertainDelivery) {
    return `This task cannot continue because ${tasks} has an unverified external delivery. Reconcile the provider outcome before deciding whether to start a new process instance.`;
  }
  return `This task cannot continue because ${tasks} ended without success. Start a new process instance from the first task to retry the workflow; saved outcomes and evidence in this instance remain available.`;
}

const TERMINAL_BLOCKERS = new Set(['FAILED', 'INTERRUPTED', 'CANCELLED']);

export function processTaskRecoveryAction({ blockedDependencies = [], uncertainDelivery = false,
  canStartNewInstance = false } = {}) {
  if (!Array.isArray(blockedDependencies)
    || !blockedDependencies.some((entry) => TERMINAL_BLOCKERS.has(entry?.status))) return null;
  if (uncertainDelivery) return { kind: 'reconcile' };
  if (!canStartNewInstance) return { kind: 'unavailable' };
  return { kind: 'select-new-instance', label: 'Choose a new process instance' };
}

export function selectFreshProcessTaskInstance(selectedInstances, instanceKey, action) {
  if (!(selectedInstances instanceof Map) || typeof instanceKey !== 'string' || !instanceKey
    || action?.kind !== 'select-new-instance') return false;
  selectedInstances.set(instanceKey, 'new');
  return true;
}
