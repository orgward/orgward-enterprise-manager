export function deriveProcessTaskState(task, taskInstances, selectedInstanceId = null) {
  const instances = (Array.isArray(taskInstances) ? taskInstances : []).filter((runtime) =>
    selectedInstanceId === null || runtime.planInstanceId === selectedInstanceId);
  const runtime = instances.find((entry) => entry.taskId === task.id) ?? null;
  const dependenciesSucceeded = (task.dependencies ?? []).every((dependencyId) => instances.some((entry) =>
    entry.taskId === dependencyId && entry.status === 'SUCCEEDED'));
  return {
    status: runtime?.status ?? (dependenciesSucceeded ? 'PLANNED' : 'WAITING'),
    runtime,
    executionRunId: runtime?.executionRunId ?? null,
    dependenciesSucceeded,
    canStart: !runtime && dependenciesSucceeded,
  };
}
