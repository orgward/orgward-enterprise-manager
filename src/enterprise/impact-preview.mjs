import { digest } from '../sdlc/contracts.mjs';
import { blueprintObjects, enterpriseFailure } from './types.mjs';
import { applyEnterpriseCommand, normalizeEnterpriseCommand } from './commands.mjs';
import { latestBlueprint } from '../model.mjs';

const incompleteAreas = [
  'Role instructions and constraints beyond direct blueprint relationships',
  'Sentinel claims and SDLC contexts or evaluations',
  'Approvals and queued, running, or completed work',
];

function flattenDecisionFields(value, path = 'decisionTable', fields = new Map()) {
  if (Array.isArray(value)) {
    if (value.length === 0) fields.set(path, value);
    else value.forEach((entry, index) => flattenDecisionFields(entry, `${path}[${index}]`, fields));
  } else if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) fields.set(path, value);
    else entries.forEach(([key, entry]) => flattenDecisionFields(entry, `${path}.${key}`, fields));
  } else fields.set(path, value ?? null);
  return fields;
}

function decisionTableChanges(before, after) {
  const oldFields = flattenDecisionFields(before ?? null);
  const newFields = flattenDecisionFields(after ?? null);
  return [...new Set([...oldFields.keys(), ...newFields.keys()])].sort()
    .filter((field) => digest(oldFields.get(field) ?? null) !== digest(newFields.get(field) ?? null))
    .map((field) => ({ field, before: oldFields.get(field) ?? null, after: newFields.get(field) ?? null }));
}

function processFlowsReferencingDecision(blueprint, decisionId) {
  return blueprintObjects(blueprint).filter((object) => object.type === 'process' && object.processFlow)
    .flatMap((process) => {
      const decisionStepIds = process.processFlow.steps
        .filter((step) => step.kind === 'decision' && step.decisionId === decisionId)
        .map((step) => step.id).sort();
      return decisionStepIds.length ? [{ processId: process.id, name: process.name, decisionStepIds,
        processSnapshotHash: digest(process) }] : [];
    });
}

export function previewEnterpriseEditImpact(project, input) {
  const command = normalizeEnterpriseCommand(input);
  const decisionTableEdit = command.kind === 'define-decision-table';
  const branchEdit = command.kind === 'edit-branch-object' || (decisionTableEdit && Boolean(command.branchId));
  if (command.kind !== 'edit-blueprint-object' && !branchEdit && !decisionTableEdit) {
    throw enterpriseFailure('INVALID_IMPACT_PREVIEW', 'Impact preview supports one main or branch proposed-design object edit or typed decision-table edit at a time.', 400);
  }
  const main = latestBlueprint(project);
  const branch = branchEdit ? project.enterpriseBranches?.find((entry) => entry.id === command.branchId) : null;
  if (branchEdit && !branch) throw enterpriseFailure('ENTERPRISE_BRANCH_NOT_FOUND', 'The branch was not found in this project.', 404);
  if (branchEdit && branch.status !== 'DRAFT') throw enterpriseFailure('ENTERPRISE_BRANCH_READ_ONLY', 'Merged or abandoned branches remain read only.');
  const branchHead = branch?.revisions?.at(-1);
  const current = branchEdit ? branchHead?.snapshot : main;
  if (branchEdit && (!branchHead || branchHead.revision !== command.branchRevision)) {
    throw enterpriseFailure('ENTERPRISE_BRANCH_STALE', 'Reload the current branch revision before previewing its impact.', 409);
  }
  if (!current || current.id !== command.blueprintId || current.version !== command.blueprintVersion) {
    throw enterpriseFailure(branchEdit ? 'ENTERPRISE_BRANCH_STALE' : 'ENTERPRISE_BLUEPRINT_STALE',
      'Reload the exact current proposed design before previewing its impact.', 409);
  }
  const sourceHash = digest(current);
  const scratch = structuredClone(project);
  // Branch integrity is anchored to its original main snapshot. Preserve the
  // full version history so the normal command validator can verify that pin.
  if (!branchEdit) scratch.blueprintVersions = [structuredClone(current)];
  scratch.audit = [];
  const changed = applyEnterpriseCommand(scratch, command, 'impact-preview');
  const candidate = branchEdit
    ? scratch.enterpriseBranches.find((entry) => entry.id === command.branchId)?.revisions?.at(-1)?.snapshot
    : changed.blueprint;
  if (!candidate) throw enterpriseFailure('ENTERPRISE_BRANCH_STALE', 'Reload the exact current branch revision before previewing its impact.', 409);
  const targetId = command.kind === 'edit-branch-object' ? command.edit.objectId : command.objectId;
  const currentObjects = new Map([...blueprintObjects(main), ...blueprintObjects(current)].map((object) => [object.id, object]));
  const candidateObjects = new Map([...blueprintObjects(main), ...blueprintObjects(candidate)].map((object) => [object.id, object]));
  if (current.edit?.objectId && current.edit.before?.id) currentObjects.set(current.edit.before.id, current.edit.before);
  if (candidate.edit?.objectId && candidate.edit.after?.id) candidateObjects.set(candidate.edit.after.id, candidate.edit.after);
  const relatedIds = new Set();
  const relationSets = [current.relations, candidate.relations];
  for (const relations of relationSets) for (const relation of relations) {
    if (relation.source === targetId) relatedIds.add(relation.target);
    if (relation.target === targetId) relatedIds.add(relation.source);
  }
  const objectIds = [targetId, ...[...relatedIds].sort()];
  const directlyAffectedObjects = objectIds.flatMap((objectId) => {
    const object = candidateObjects.get(objectId) ?? currentObjects.get(objectId);
    if (!object) return [];
    const oldRelations = current.relations.filter((relation) => relation.source === targetId && relation.target === objectId
      || relation.target === targetId && relation.source === objectId);
    const newRelations = candidate.relations.filter((relation) => relation.source === targetId && relation.target === objectId
      || relation.target === targetId && relation.source === objectId);
    return [{ objectId, name: object.name, type: object.type, edited: objectId === targetId,
      relationshipTypes: [...new Set([...oldRelations, ...newRelations].map((relation) => relation.type))].sort(),
      source: { blueprintId: current.id, blueprintVersion: current.version, snapshotHash: sourceHash,
        ...(branchEdit ? { branchId: branch.id, branchRevision: branchHead.revision } : {}) } }];
  });
  const currentTarget = blueprintObjects(current).find((object) => object.id === targetId);
  const candidateTarget = blueprintObjects(candidate).find((object) => object.id === targetId);
  const changedFields = decisionTableEdit
    ? decisionTableChanges(currentTarget?.decisionTable, candidateTarget?.decisionTable)
    : candidate.edit.changedFields.map((field) => ({ field,
      before: candidate.edit.before[field] ?? null, after: candidate.edit.after[field] ?? null }));
  const priorFlows = decisionTableEdit ? processFlowsReferencingDecision(current, targetId) : [];
  const proposedFlows = decisionTableEdit ? processFlowsReferencingDecision(candidate, targetId) : [];
  const flowsById = new Map();
  for (const flow of priorFlows) flowsById.set(flow.processId, { processId: flow.processId, name: flow.name,
    beforeDecisionStepIds: flow.decisionStepIds, afterDecisionStepIds: [],
    beforeProcessSnapshotHash: flow.processSnapshotHash, afterProcessSnapshotHash: null });
  for (const flow of proposedFlows) {
    const previous = flowsById.get(flow.processId) ?? { processId: flow.processId, name: flow.name,
      beforeDecisionStepIds: [], afterDecisionStepIds: [], beforeProcessSnapshotHash: null, afterProcessSnapshotHash: null };
    previous.afterDecisionStepIds = flow.decisionStepIds;
    previous.afterProcessSnapshotHash = flow.processSnapshotHash;
    flowsById.set(flow.processId, previous);
  }
  const core = {
    status: 'INCOMPLETE',
    source: { projectId: project.id, projectVersion: project.version, blueprintId: current.id,
      blueprintVersion: current.version, snapshotHash: sourceHash,
      ...(branchEdit ? { kind: 'BRANCH_DRAFT', branchId: branch.id, branchRevision: branchHead.revision,
        mainBlueprintId: main.id, mainBlueprintVersion: main.version, mainSnapshotHash: digest(main) }
        : { kind: 'MAIN_DESIGN' }) },
    proposedBlueprintVersion: candidate.version,
    ...(branchEdit ? { proposedBranchRevision: branchHead.revision + 1 } : {}),
    editedObjectId: targetId,
    changedFields,
    directRelationshipChanges: {
      before: current.relations.filter((relation) => relation.source === targetId || relation.target === targetId),
      after: candidate.relations.filter((relation) => relation.source === targetId || relation.target === targetId),
    },
    directlyAffectedObjects,
    ...(decisionTableEdit ? { directlyReferencingProcessFlows: [...flowsById.values()].sort((a, b) => a.processId.localeCompare(b.processId)) } : {}),
    coverage: { directBlueprintRelationships: 'COMPUTED', operationalAndDownstreamImpact: 'UNKNOWN' },
    unknownAreas: incompleteAreas,
    limitation: 'This read-only preview does not authorize publication or establish currentness for dependent approvals or work.',
  };
  return { ...core, previewHash: digest(core) };
}
