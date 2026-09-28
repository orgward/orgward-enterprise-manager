const isRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));

export function humanTaskOutputCommand(pending, { commandId, expectedVersion, payload } = {}) {
  if (pending && typeof pending.commandId === 'string' && Number.isSafeInteger(pending.expectedVersion)
    && isRecord(pending.payload)) return pending;
  if (typeof commandId !== 'string' || !commandId.trim() || !Number.isSafeInteger(expectedVersion)
    || !isRecord(payload)) return null;
  return { commandId, expectedVersion, payload: structuredClone(payload), submitting: false, status: '' };
}

function pinnedObject(project, plan, output) {
  if (!isRecord(project) || !isRecord(plan) || !isRecord(output)
    || plan.source?.projectId !== project.id || typeof plan.source.blueprintId !== 'string'
    || !Number.isSafeInteger(plan.source.blueprintVersion) || plan.source.blueprintVersion < 1) return null;
  const blueprint = project.blueprintVersions?.find((candidate) => candidate?.id === plan.source.blueprintId
    && candidate.version === plan.source.blueprintVersion);
  if (!blueprint) return null;
  const object = Object.values(blueprint.areas ?? {}).flatMap((area) => Array.isArray(area?.items) ? area.items : [])
    .find((candidate) => candidate?.id === output.objectId);
  if (!object || object.type !== 'information' || object.name !== output.label || output.type !== 'information') return null;
  return { blueprint, object };
}

export function humanTaskOutputApplicationState({ project, plan, task, runtime, output } = {}) {
  if (!isRecord(project) || !isRecord(plan) || !isRecord(task) || !isRecord(runtime) || !isRecord(output)
    || plan.source?.projectId !== project.id || runtime.projectId !== project.id
    || runtime.processPlanId !== plan.id || Number(runtime.revision) !== Number(plan.revision ?? 1)
    || runtime.taskId !== task.id || typeof runtime.planInstanceId !== 'string'
    || !Array.isArray(task.outputs) || task.outputs.filter((entry) => entry?.objectId === output.objectId
      && entry.type === 'information').length !== 1) return { kind: 'unavailable' };

  const appliedEvent = (project.events ?? []).find((event) => event?.type === 'HumanTaskOutputApplied'
    && typeof event.eventId === 'string' && event.eventId.length > 0
    && event.data?.projectId === project.id && event.data?.planId === plan.id
    && event.data?.revision === Number(plan.revision ?? 1)
    && event.data?.planInstanceId === runtime.planInstanceId && event.data?.taskId === task.id
    && event.data?.outputObjectId === output.objectId && event.data?.blueprintId === plan.source.blueprintId
    && Number(event.data?.blueprintVersion) === Number(plan.source.blueprintVersion)
    && typeof event.data?.appliedBlueprintId === 'string'
    && Number.isSafeInteger(event.data?.appliedBlueprintVersion) && event.data.appliedBlueprintVersion > 1
    && /^[a-f0-9]{64}$/.test(event.data?.contentHash ?? '') && event.data?.evidenceContextOnly === true);
  if (appliedEvent) {
    const appliedBlueprint = project.blueprintVersions?.find((candidate) => candidate?.id === appliedEvent.data.appliedBlueprintId
      && candidate.version === appliedEvent.data.appliedBlueprintVersion);
    const appliedObject = Object.values(appliedBlueprint?.areas ?? {}).flatMap((area) => Array.isArray(area?.items) ? area.items : [])
      .find((candidate) => candidate?.id === output.objectId && candidate.type === 'information'
        && candidate.name === output.label);
    const sourceEvent = Array.isArray(runtime.events) ? runtime.events.find((event) =>
      event?.id === appliedEvent.data.humanTaskEventId
      && ['HumanTaskCompleted', 'HumanTaskEscalationResolved'].includes(event.type)
      && event.data?.taskId === task.id && event.data?.processPlanId === plan.id
      && event.data?.revision === Number(plan.revision ?? 1)
      && event.data?.planInstanceId === runtime.planInstanceId
      && (event.type === 'HumanTaskCompleted' ? event.data?.result === 'succeeded'
        : event.data?.disposition === 'succeeded')) : null;
    const sourceEventHash = appliedEvent.data.humanTaskEventHash;
    const outputContentHash = appliedEvent.data.contentHash;
    const hasSourceLinkedProvenance = Boolean(sourceEvent && appliedObject && typeof appliedEvent.data.humanTaskEventId === 'string'
      && appliedEvent.data.humanTaskEventId.length > 0 && /^[a-f0-9]{64}$/.test(sourceEventHash ?? '')
      && /^[a-f0-9]{64}$/.test(outputContentHash ?? '')
      && Array.isArray(appliedObject.provenance) && appliedObject.provenance.some((entry) =>
        entry?.source === 'workspace:human-task-output' && entry.projectId === project.id
        && entry.planId === plan.id && entry.revision === Number(plan.revision ?? 1)
        && entry.planInstanceId === runtime.planInstanceId && entry.taskId === task.id
        && entry.outputObjectId === output.objectId
        && entry.sourceEventId === appliedEvent.data.humanTaskEventId
        && entry.sourceEventHash === sourceEventHash && entry.contentHash === outputContentHash));
    const currentObject = Object.values(project.latestBlueprint?.areas ?? {}).flatMap((area) => area?.items ?? [])
      .find((candidate) => candidate?.id === output.objectId && candidate.type === 'information');
    if (!appliedBlueprint || !appliedObject || !hasSourceLinkedProvenance || !currentObject) return { kind: 'unavailable' };
    return { kind: 'applied', eventId: appliedEvent.eventId, projectId: project.id, planId: plan.id,
      revision: Number(plan.revision ?? 1), planInstanceId: runtime.planInstanceId, taskId: task.id,
      outputObjectId: output.objectId, appliedBlueprintVersion: appliedEvent.data.appliedBlueprintVersion,
      currentBlueprintVersion: project.latestBlueprint.version, currentDetail: currentObject.detail };
  }

  const pinned = pinnedObject(project, plan, output);
  if (!pinned) return { kind: 'unavailable' };
  if (runtime.status !== 'SUCCEEDED') return { kind: 'not-succeeded' };
  if (project.latestBlueprint?.id !== plan.source.blueprintId
    || project.latestBlueprint?.version !== plan.source.blueprintVersion) return { kind: 'stale' };
  if (runtime.canApplyHumanTaskOutput !== true) return { kind: 'owner-review' };
  return { kind: 'ready', before: pinned.object.detail, outputName: pinned.object.name,
    blueprintVersion: pinned.blueprint.version };
}
