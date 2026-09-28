import { digest } from './contracts.mjs';

export function softwareRuntimePlanSnapshot({ draft, review, project, principal }) {
  if (!draft || !review || !project || review.planId !== draft.id || review.draftHash !== draft.contentHash
    || review.status !== 'REVIEWED' || review.executable !== false) throw new Error('A current owner-reviewed software draft is required.');
  const reviewCore = Object.fromEntries(Object.entries(review).filter(([key]) => key !== 'reviewHash'));
  if (digest(reviewCore) !== review.reviewHash) throw new Error('The owner review snapshot failed integrity verification.');
  const assignments = new Map(review.assignments.map((entry) => [entry.taskId, entry]));
  if (assignments.size !== draft.tasks.length || draft.tasks.some((task) => !assignments.has(task.id))) {
    throw new Error('Every software task must have exactly one reviewed assignment.');
  }
  if (draft.tasks.some((task) => assignments.get(task.id)?.assignee?.actorType !== 'human')) {
    const error = new Error('Only human checkpoint assignments can be promoted. Agent tasks require a separate software execution contract.');
    error.code = 'SOFTWARE_AGENT_RUNTIME_UNSUPPORTED';
    throw error;
  }
  const binding = draft.binding;
  if (review.binding?.sourceHash !== binding.sourceHash
    || review.binding?.projectVersion !== binding.projectVersion || review.binding?.blueprintId !== binding.blueprintId
    || review.binding?.blueprintVersion !== binding.blueprintVersion || review.binding?.blueprintSchemaVersion !== binding.blueprintSchemaVersion
    || review.binding?.sourceObjectId !== binding.sourceObjectId || review.binding?.sourceObjectType !== binding.sourceObjectType
    || review.binding?.requirementsBaselineHash !== binding.requirementsBaselineHash
    || review.binding?.architectureBaselineHash !== binding.architectureBaselineHash
    || review.binding?.g6PlanHash !== binding.g6PlanHash || review.binding?.compilerVersion !== draft.compilerVersion) {
    throw new Error('The owner review is not bound to the full software draft source and baseline identity.');
  }
  const blueprint = project.blueprintVersions?.find((entry) => entry.id === binding.blueprintId && entry.version === binding.blueprintVersion);
  const sourceObject = Object.values(blueprint?.areas ?? {}).flatMap((area) => area.items ?? []).find((entry) => entry.id === binding.sourceObjectId);
  if (!blueprint || !sourceObject || project.id !== binding.projectId) throw new Error('The pinned software source is unavailable.');
  const tasks = draft.tasks.map((task) => {
    const assignment = assignments.get(task.id).assignee;
    if (!assignment.principal || !assignment.membershipId || !Number.isSafeInteger(assignment.membershipGeneration)
      || !Number.isSafeInteger(assignment.authzGeneration)) throw new Error('The owner review does not bind an exact current human membership.');
    return {
      id: task.id, sourceProcessId: task.g6WorkItemId, title: task.title, detail: task.contextPackageRef ?? '', trigger: '',
      status: 'planned', dependencies: [...task.dependencies], inputs: [], outputs: [],
      assignee: { kind: 'blueprint-actor', actorId: assignment.actorId, roleId: assignment.roleId,
        actorName: assignment.actorName, roleName: assignment.roleName, principal: assignment.principal,
        membershipId: assignment.membershipId, membershipGeneration: assignment.membershipGeneration,
        authzGeneration: assignment.authzGeneration, state: 'assigned' },
      softwareDelivery: { requirementRefs: [...task.requirementRefs], decisionRefs: [...task.decisionRefs],
        contextPackageRef: task.contextPackageRef },
    };
  });
  const byId = new Map(tasks.map((task) => [task.id, task]));
  if (byId.size !== tasks.length || tasks.length === 0 || tasks.length > 32
    || tasks.some((task) => task.dependencies.some((id) => id === task.id || !byId.has(id)))) {
    throw new Error('The software task dependency graph is invalid.');
  }
  const visiting = new Set(); const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) throw new Error('The software task dependency graph contains a cycle.');
    if (visited.has(id)) return;
    visiting.add(id); for (const dependency of byId.get(id).dependencies) visit(dependency);
    visiting.delete(id); visited.add(id);
  };
  for (const task of tasks) visit(task.id);
  const core = {
    schemaVersion: 1, kind: 'software_delivery_runtime_plan', id: draft.id, version: 1, revision: review.revision,
    state: 'planned', epistemicStatus: 'owner-reviewed-software-delivery',
    source: { projectId: project.id, blueprintId: binding.blueprintId, blueprintVersion: binding.blueprintVersion,
      processId: binding.sourceObjectId, processName: sourceObject.name },
    createdBy: principal,
    binding: { ...binding, sourceBindingHash: review.binding.sourceBindingHash,
      reviewRevision: review.revision, reviewHash: review.reviewHash },
    tasks,
  };
  return { ...core, snapshotHash: digest(core) };
}

export function verifySoftwareRuntimePlanSnapshot(snapshot) {
  if (!snapshot || snapshot.kind !== 'software_delivery_runtime_plan' || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1
    || !Array.isArray(snapshot.tasks) || !snapshot.binding || !snapshot.source) return false;
  const core = Object.fromEntries(Object.entries(snapshot).filter(([key]) => key !== 'snapshotHash'));
  return digest(core) === snapshot.snapshotHash;
}
