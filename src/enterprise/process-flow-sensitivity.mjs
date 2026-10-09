import { digest } from '../sdlc/contracts.mjs';

const objects = (blueprint) => Object.values(blueprint?.areas ?? {}).flatMap((area) => area.items ?? []);

export function processFlowSensitivity(before, after, changedFields) {
  const fields = changedFields.map(({ field }) => ({
    field,
    kind: /\.title$/.test(field) ? 'VIEW_ONLY' : 'MATERIAL',
    reason: /\.title$/.test(field) ? 'Step titles are presentation labels; routing uses stable step IDs and explicit transitions.'
      : 'This field can change the saved flow definition or its references.',
  }));
  const layoutOnly = digest(before ?? null) !== digest(after ?? null) && changedFields.length === 0;
  return {
    classification: fields.some((entry) => entry.kind === 'MATERIAL') ? 'MATERIAL' : 'VIEW_ONLY',
    ...(layoutOnly ? { reason: 'Step array order is presentation only; the runtime follows startStepId and explicit transition IDs.' }
      : fields.length && fields.every((entry) => entry.kind === 'VIEW_ONLY')
        ? { reason: 'Only presentation labels changed; execution relationships are unchanged.' } : {}),
    fields,
    materialFieldPaths: fields.filter((entry) => entry.kind === 'MATERIAL').map((entry) => entry.field),
    viewOnlyFieldPaths: fields.filter((entry) => entry.kind === 'VIEW_ONLY').map((entry) => entry.field),
    layoutOnly,
  };
}

function flowDisplayProjection(flow) {
  if (!flow || typeof flow !== 'object' || !Array.isArray(flow.steps)) return flow;
  return { ...flow, steps: flow.steps.map(({ title: _title, ...step }) => step)
    .sort((left, right) => String(left.id).localeCompare(String(right.id))) };
}

function blueprintProjection(blueprint, processId) {
  const value = structuredClone(blueprint);
  for (const key of ['id', 'version', 'createdAt', 'edit', 'integrity']) delete value[key];
  value.relations = [...(value.relations ?? [])].sort((left, right) =>
    `${left.source}\0${left.type}\0${left.target}`.localeCompare(`${right.source}\0${right.type}\0${right.target}`));
  const process = objects(value).find((entry) => entry.id === processId && entry.type === 'process');
  if (!process) return null;
  // The exact edit/provenance append is validated separately above; omit its
  // audit trail from the semantic comparison of the saved design.
  delete process.provenance;
  process.processFlow = flowDisplayProjection(process.processFlow);
  return value;
}

function isExactProcessFlowEdit(previous, next, processId) {
  const oldProcess = objects(previous).find((entry) => entry.id === processId && entry.type === 'process');
  const newProcess = objects(next).find((entry) => entry.id === processId && entry.type === 'process');
  const edit = next.edit;
  if (!oldProcess || !newProcess || edit?.objectId !== processId || edit.objectType !== 'process'
    || !Array.isArray(edit.changedFields) || edit.changedFields.length !== 1 || edit.changedFields[0] !== 'processFlow'
    || digest(edit.before) !== digest(oldProcess) || digest(edit.after) !== digest(newProcess)) return false;
  const priorProvenance = oldProcess.provenance ?? [];
  const nextProvenance = newProcess.provenance ?? [];
  if (nextProvenance.length !== priorProvenance.length + 1
    || digest(nextProvenance.slice(0, priorProvenance.length)) !== digest(priorProvenance)) return false;
  const appended = nextProvenance.at(-1);
  if (appended?.source !== 'workspace:process-design' || appended.actor !== edit.actor || appended.at !== edit.at
    || appended.reason !== edit.reason || digest(appended.fields) !== digest(['processFlow'])) return false;
  return true;
}

/**
 * A retained manual-flow plan may start against a later blueprint only when
 * every intervening revision is a validated process-flow edit whose only
 * differences are step display titles or array order. Unknown diffs fail closed.
 */
export function isViewOnlyProcessFlowSuccessor({ plan, sourceBlueprint, currentBlueprint, blueprintHistory }) {
  if (plan?.kind !== 'manual_process_flow_plan' || !sourceBlueprint || !currentBlueprint
    || plan.source?.blueprintId !== sourceBlueprint.id || Number(plan.source?.blueprintVersion) !== Number(sourceBlueprint.version)
    || plan.source?.blueprintHash !== digest(sourceBlueprint)
    || currentBlueprint.version <= sourceBlueprint.version || !Array.isArray(blueprintHistory)) return false;
  const from = blueprintHistory.findIndex((entry) => entry.id === sourceBlueprint.id && entry.version === sourceBlueprint.version);
  const to = blueprintHistory.findIndex((entry) => entry.id === currentBlueprint.id && entry.version === currentBlueprint.version);
  if (from < 0 || to <= from) return false;
  let previous = sourceBlueprint;
  for (const next of blueprintHistory.slice(from + 1, to + 1)) {
    if (next.version !== previous.version + 1 || !isExactProcessFlowEdit(previous, next, next.edit?.objectId)) return false;
    const before = blueprintProjection(previous, next.edit.objectId);
    const after = blueprintProjection(next, next.edit.objectId);
    if (!before || !after || digest(before) !== digest(after)) return false;
    previous = next;
  }
  return previous.id === currentBlueprint.id && previous.version === currentBlueprint.version;
}

export function processPlanBlueprintApplicability(plan, project) {
  const source = plan?.source;
  const history = project?.blueprintVersions ?? [];
  const pinned = history.find((entry) => entry.id === source?.blueprintId && Number(entry.version) === Number(source.blueprintVersion));
  const current = history.at(-1);
  if (pinned && current && pinned.id === current.id && pinned.version === current.version) {
    return { status: 'CURRENT', scope: 'EXACT_BLUEPRINT', blueprintId: pinned.id, blueprintVersion: pinned.version };
  }
  if (isViewOnlyProcessFlowSuccessor({ plan, sourceBlueprint: pinned, currentBlueprint: current, blueprintHistory: history })) {
    return { status: 'CURRENT_VIEW_ONLY_COMPATIBLE', scope: 'STEP_TITLE_AND_ORDER_ONLY',
      blueprintId: current.id, blueprintVersion: current.version,
      pinnedBlueprintId: pinned.id, pinnedBlueprintVersion: pinned.version,
      explanation: 'The current design differs only in process-step titles or display order; this plan retains its original immutable source pin.' };
  }
  return { status: 'STALE', scope: 'EXACT_BLUEPRINT', blueprintId: current?.id ?? null,
    blueprintVersion: current?.version ?? null, pinnedBlueprintId: source?.blueprintId ?? null,
    pinnedBlueprintVersion: source?.blueprintVersion ?? null };
}
