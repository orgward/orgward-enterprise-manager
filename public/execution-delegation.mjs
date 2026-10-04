export function eligibleParentAgentRuns({ runs = [], projectId, planId, revision, planInstanceId,
  blueprintId, blueprintVersion, actorId, roleId }) {
  if (!Array.isArray(runs) || !projectId || !planId || !Number.isSafeInteger(revision)
    || !planInstanceId || !blueprintId || !Number.isSafeInteger(blueprintVersion)) return [];
  return runs.filter((run) => {
    const ref = run?.processTaskRef;
    return run.projectId === projectId && run.status === 'SUCCEEDED' && run.execution?.status === 'COMPLETED'
      && ref?.processPlanId === planId && ref.revision === revision && ref.planInstanceId === planInstanceId
      && ref.blueprintId === blueprintId && ref.blueprintVersion === blueprintVersion
      && (ref.actorId !== actorId || ref.roleId !== roleId);
  }).sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
}
