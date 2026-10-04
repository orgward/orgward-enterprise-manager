import { randomUUID } from 'node:crypto';
import { buildRelations, latestBlueprint, validateBlueprint } from '../model.mjs';
import { digest } from '../sdlc/contracts.mjs';
import { blueprintObjects, enterpriseFailure, enterpriseText } from './types.mjs';
import { appendEnterpriseBranchDesign } from './branches.mjs';
import { normalizeRefinementTargets } from './refinement.mjs';

export const ENTERPRISE_REFINEMENT_KINDS = new Set(['define-refinement']);
const fail = (code, message, status = 400) => { throw enterpriseFailure(code, message, status); };
const id = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,119}$/i.test(value);

export function normalizeEnterpriseRefinementCommand(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.kind !== 'define-refinement'
    || !/^blueprint-[0-9a-f-]{36}$/.test(input.blueprintId ?? '') || !Number.isSafeInteger(input.blueprintVersion) || input.blueprintVersion < 1
    || !id(input.objectId) || !Array.isArray(input.refines)) {
    fail('INVALID_ENTERPRISE_REFINEMENT_COMMAND', 'Bind refinement links to an exact saved blueprint and canonical record.');
  }
  const command = { kind: input.kind, blueprintId: input.blueprintId, blueprintVersion: input.blueprintVersion,
    objectId: input.objectId, refines: structuredClone(input.refines), reason: enterpriseText(input.reason, 'Refinement reason', 500) };
  const allowed = ['kind', 'blueprintId', 'blueprintVersion', 'objectId', 'refines', 'reason'];
  if (input.branchId !== undefined || input.branchRevision !== undefined) {
    if (!/^enterprise-branch-[0-9a-f-]{36}$/.test(input.branchId ?? '') || !Number.isSafeInteger(input.branchRevision) || input.branchRevision < 1) {
      fail('INVALID_ENTERPRISE_REFINEMENT_COMMAND', 'Choose an exact saved branch revision.');
    }
    command.branchId = input.branchId; command.branchRevision = input.branchRevision; allowed.push('branchId', 'branchRevision');
  }
  if (Object.keys(input).some((key) => !allowed.includes(key))) fail('INVALID_ENTERPRISE_REFINEMENT_COMMAND', 'The refinement command contains unsupported fields.');
  return command;
}

export function applyEnterpriseRefinementCommand(project, command, actor) {
  const current = latestBlueprint(project);
  if (!current) fail('BLUEPRINT_NOT_FOUND', 'Save an initial blueprint before refining its records.', 409);
  const mutate = (next, at) => {
    const beforeRelations = structuredClone(next.relations); const objects = blueprintObjects(next);
    const byId = new Map(objects.map((object) => [object.id, object])); const object = byId.get(command.objectId);
    if (!object) fail('ENTERPRISE_OBJECT_NOT_FOUND', 'The selected record is not present in this saved design.', 404);
    const refines = normalizeRefinementTargets(command.refines, byId, object.id);
    if (digest(object.refines ?? []) === digest(refines)) fail('ENTERPRISE_NO_CHANGE', 'The refinement links have no semantic changes.', 409);
    const before = structuredClone(object); object.refines = refines; object.provenance ??= [];
    object.provenance.push({ source: 'workspace:enterprise-refinement', actor, at, reason: command.reason, fields: ['refines'],
      note: 'Proposed design refinement links; no implementation, evidence or operating status is inferred.' });
    next.id = `blueprint-${randomUUID()}`; next.version += 1; next.createdAt = at; next.epistemicStatus = 'proposed-design';
    next.relations = buildRelations(next.areas); next.integrity = validateBlueprint(next);
    if (!next.integrity.valid) fail('INVALID_REFINEMENT', next.integrity.errors[0]?.message ?? 'The refinement would invalidate this design.', 409);
    const allObjects = blueprintObjects(next);
    next.summary = { areaCount: Object.keys(next.areas).length, objectCount: allObjects.length, relationCount: next.relations.length,
      designedAreas: Object.values(next.areas).filter((area) => area.status === 'designed').length };
    next.edit = { actor, at, objectId: object.id, objectType: object.type, changedFields: ['refines'], before,
      after: structuredClone(object), reason: command.reason,
      relationsBefore: beforeRelations.filter((relation) => relation.source === object.id || relation.target === object.id),
      relationsAfter: next.relations.filter((relation) => relation.source === object.id || relation.target === object.id) };
    return next;
  };
  if (command.branchId) return appendEnterpriseBranchDesign(project, command, actor, mutate);
  if (current.id !== command.blueprintId || current.version !== command.blueprintVersion) fail('ENTERPRISE_BLUEPRINT_STALE', 'Reload the exact current design before changing refinement links.', 409);
  const at = new Date().toISOString(); const next = mutate(structuredClone(current), at);
  project.blueprintVersions.push(next); project.audit ??= [];
  project.audit.push({ at, action: 'enterprise.define-refinement', actor, detail: `Refined ${next.edit.objectType} “${next.edit.after.name}” in blueprint v${next.version}.` });
  return { blueprint: next, affectedObjectId: command.objectId, proposalId: null, recordedAt: at };
}
