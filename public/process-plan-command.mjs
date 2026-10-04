export function processPlanCommandKey(projectId, processId, mode = null) {
  return `${projectId}\n${processId}${mode === 'manual-flow' ? '\nmanual-flow' : ''}`;
}

export function getOrCreateProcessPlanCommand(pending, projectId, processId, project, createCommandId, mode = null) {
  const key = processPlanCommandKey(projectId, processId, mode);
  const existing = pending.get(key);
  if (existing) return existing;
  const command = {
    key,
    projectId,
    processId,
    commandId: createCommandId(),
    expectedVersion: project.version,
    schemaVersion: '1.0',
    payload: { processId, ...(mode === 'manual-flow' ? { mode, blueprintId: project.latestBlueprint.id,
      blueprintVersion: project.latestBlueprint.version } : {}) },
  };
  pending.set(key, command);
  return command;
}

export function getOrCreatePlanRevisionCommand(pending, projectId, planId, project, payload, createCommandId) {
  const key = `${projectId}\n${planId}\nrevision`;
  const existing = pending.get(key);
  if (existing) return existing;
  const command = {
    key, projectId, planId, commandId: createCommandId(), expectedVersion: project.version,
    schemaVersion: '1.0', payload: structuredClone(payload),
  };
  pending.set(key, command);
  return command;
}

export function processPlanFailureDisposition(error) {
  if (['VERSION_CONFLICT', 'BLUEPRINT_NOT_FOUND', 'BLUEPRINT_PROCESS_NOT_FOUND', 'PROCESS_PLAN_BLUEPRINT_STALE'].includes(error?.code)) return 'reload';
  if (error?.retryable === true || error?.status == null || error.status >= 500) return 'retry';
  return 'discard';
}
