export function deriveProcessTaskState(task, taskInstances, selectedInstanceId = null, allTasks = [task]) {
  const instances = (Array.isArray(taskInstances) ? taskInstances : []).filter((runtime) =>
    selectedInstanceId === null || runtime.planInstanceId === selectedInstanceId);
  const runtime = instances.find((entry) => entry.taskId === task.id) ?? null;
  const taskById = new Map((Array.isArray(allTasks) ? allTasks : [task]).map((entry) => [entry.id, entry]));
  const terminalFailures = new Map();
  const findTerminalFailures = (taskId, visited = new Set()) => {
    if (visited.has(taskId)) return;
    visited.add(taskId);
    const dependencyRuntime = instances.find((entry) => entry.taskId === taskId);
    if (dependencyRuntime?.status === 'SUCCEEDED') return;
    if (dependencyRuntime && ['FAILED', 'INTERRUPTED', 'CANCELLED'].includes(dependencyRuntime.status)) {
      terminalFailures.set(taskId, dependencyRuntime.status);
      return;
    }
    if (dependencyRuntime && !['PLANNED', 'WAITING'].includes(dependencyRuntime.status)) return;
    const dependencyTask = taskById.get(taskId);
    for (const nestedId of dependencyTask?.dependencies ?? []) findTerminalFailures(nestedId, visited);
  };
  for (const dependencyId of task.dependencies ?? []) findTerminalFailures(dependencyId);
  const blockedDependencies = [...terminalFailures].map(([taskId, status]) => ({ taskId, status }));
  const dependenciesSucceeded = (task.dependencies ?? []).every((dependencyId) => instances.some((entry) =>
    entry.taskId === dependencyId && entry.status === 'SUCCEEDED'));
  return {
    status: runtime?.status ?? (blockedDependencies.length ? 'BLOCKED' : dependenciesSucceeded ? 'PLANNED' : 'WAITING'),
    runtime,
    executionRunId: runtime?.executionRunId ?? null,
    dependenciesSucceeded,
    blockedDependencies,
    canStart: !runtime && dependenciesSucceeded,
  };
}
