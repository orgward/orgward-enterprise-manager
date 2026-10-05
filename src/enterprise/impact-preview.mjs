import { digest } from '../sdlc/contracts.mjs';
import { blueprintObjects, enterpriseFailure } from './types.mjs';
import { applyEnterpriseCommand, normalizeEnterpriseCommand } from './commands.mjs';
import { latestBlueprint } from '../model.mjs';

const incompleteAreas = [
  'Role instructions and constraints beyond direct blueprint relationships',
  'Sentinel claims and SDLC contexts or evaluations',
  'Approvals and queued, running, or completed work',
];

export function previewEnterpriseEditImpact(project, input) {
  const command = normalizeEnterpriseCommand(input);
  if (command.kind !== 'edit-blueprint-object') {
    throw enterpriseFailure('INVALID_IMPACT_PREVIEW', 'Impact preview supports one proposed-design object edit at a time.', 400);
  }
  const current = latestBlueprint(project);
  if (!current || current.id !== command.blueprintId || current.version !== command.blueprintVersion) {
    throw enterpriseFailure('ENTERPRISE_BLUEPRINT_STALE', 'Reload the exact current proposed design before previewing its impact.', 409);
  }
  const sourceHash = digest(current);
  const scratch = structuredClone(project);
  scratch.blueprintVersions = [structuredClone(current)];
  scratch.audit = [];
  const { blueprint: candidate } = applyEnterpriseCommand(scratch, command, 'impact-preview');
  const targetId = command.objectId;
  const currentObjects = new Map(blueprintObjects(current).map((object) => [object.id, object]));
  const candidateObjects = new Map(blueprintObjects(candidate).map((object) => [object.id, object]));
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
      source: { blueprintId: current.id, blueprintVersion: current.version, snapshotHash: sourceHash } }];
  });
  const core = {
    status: 'INCOMPLETE',
    source: { projectId: project.id, projectVersion: project.version, blueprintId: current.id,
      blueprintVersion: current.version, snapshotHash: sourceHash },
    proposedBlueprintVersion: candidate.version,
    editedObjectId: targetId,
    changedFields: candidate.edit.changedFields.map((field) => ({ field,
      before: candidate.edit.before[field] ?? null, after: candidate.edit.after[field] ?? null })),
    directRelationshipChanges: {
      before: current.relations.filter((relation) => relation.source === targetId || relation.target === targetId),
      after: candidate.relations.filter((relation) => relation.source === targetId || relation.target === targetId),
    },
    directlyAffectedObjects,
    coverage: { directBlueprintRelationships: 'COMPUTED', operationalAndDownstreamImpact: 'UNKNOWN' },
    unknownAreas: incompleteAreas,
    limitation: 'This read-only preview does not authorize publication or establish currentness for dependent approvals or work.',
  };
  return { ...core, previewHash: digest(core) };
}
