import { randomUUID } from 'node:crypto';
import { buildRelations, latestBlueprint, validateBlueprint } from '../model.mjs';
import { ENTERPRISE_SCOPE_TYPES, blueprintObjects, enterpriseFailure, enterpriseText } from './types.mjs';

const base = ['kind', 'blueprintId', 'blueprintVersion', 'reason'];
function reference(value, field, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,119}$/i.test(value)) {
    throw enterpriseFailure('INVALID_ENTERPRISE_COMMAND', `${field} must identify a saved design record${nullable ? ' or be null' : ''}.`);
  }
  return value;
}
export function normalizeEnterpriseCommand(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || !['create-scope', 'rename-scope', 'assign-object-scope'].includes(input.kind)
    || !/^blueprint-[0-9a-f-]{36}$/.test(input.blueprintId ?? '')
    || !Number.isSafeInteger(input.blueprintVersion) || input.blueprintVersion < 1) {
    throw enterpriseFailure('INVALID_ENTERPRISE_COMMAND', 'Choose an available enterprise command and bind it to the saved blueprint.');
  }
  const normalized = { kind: input.kind, blueprintId: input.blueprintId, blueprintVersion: input.blueprintVersion,
    reason: enterpriseText(input.reason, 'Change reason', 500) };
  let allowed;
  if (input.kind === 'create-scope') {
    if (!ENTERPRISE_SCOPE_TYPES.includes(input.scopeType)) throw enterpriseFailure('INVALID_ENTERPRISE_COMMAND', 'Choose organization, legal-entity or unit.');
    allowed = [...base, 'scopeType', 'name', 'detail', 'ownerRoleId',
      ...(input.scopeType === 'legal-entity' ? ['organizationId', 'jurisdiction']
        : input.scopeType === 'unit' ? ['organizationId', 'legalEntityId', 'parentUnitId'] : [])];
    Object.assign(normalized, { scopeType: input.scopeType, name: enterpriseText(input.name, 'Scope name', 120),
      detail: enterpriseText(input.detail, 'Scope description', 700), ownerRoleId: reference(input.ownerRoleId ?? null, 'Owner role', { nullable: true }) });
    if (input.scopeType !== 'organization') normalized.organizationId = reference(input.organizationId, 'Organization');
    if (input.scopeType === 'legal-entity') normalized.jurisdiction = enterpriseText(input.jurisdiction, 'Reported jurisdiction', 120);
    if (input.scopeType === 'unit') Object.assign(normalized, {
      legalEntityId: reference(input.legalEntityId ?? null, 'Legal entity', { nullable: true }),
      parentUnitId: reference(input.parentUnitId ?? null, 'Parent unit', { nullable: true }) });
  } else if (input.kind === 'rename-scope') {
    allowed = [...base, 'objectId', 'name', 'detail'];
    Object.assign(normalized, { objectId: reference(input.objectId, 'Scope record'),
      name: enterpriseText(input.name, 'Scope name', 120), detail: enterpriseText(input.detail, 'Scope description', 700) });
  } else {
    allowed = [...base, 'objectId', 'organizationId', 'legalEntityId', 'unitId'];
    normalized.objectId = reference(input.objectId, 'Design object');
    normalized.enterpriseScope = Object.fromEntries(['organizationId', 'legalEntityId', 'unitId'].map((field) =>
      [field, reference(input[field], field, { nullable: true })]));
  }
  if (Object.keys(input).some((field) => !allowed.includes(field))) {
    throw enterpriseFailure('INVALID_ENTERPRISE_COMMAND', 'The command contains fields that do not apply to this change.');
  }
  return normalized;
}
export function applyEnterpriseCommand(project, command, actor) {
  const previous = latestBlueprint(project);
  if (!previous) throw enterpriseFailure('BLUEPRINT_NOT_FOUND', 'Save the initial blueprint before defining enterprise scopes.', 409);
  if (previous.id !== command.blueprintId || previous.version !== command.blueprintVersion) {
    throw enterpriseFailure('ENTERPRISE_BLUEPRINT_STALE', 'This command names a historical or changed blueprint. Reload the current design before editing.', 409);
  }
  const next = structuredClone(previous);
  const objects = blueprintObjects(next);
  const byId = new Map(objects.map((object) => [object.id, object]));
  const at = new Date().toISOString();
  let affected;
  let before = {};
  if (command.kind === 'create-scope') {
    if (objects.filter((object) => ENTERPRISE_SCOPE_TYPES.includes(object.type)).length >= 200) {
      throw enterpriseFailure('ENTERPRISE_SCOPE_LIMIT', 'This blueprint reached its 200-scope limit.', 409);
    }
    if (command.ownerRoleId && byId.get(command.ownerRoleId)?.type !== 'role') {
      throw enterpriseFailure('INVALID_ENTERPRISE_OWNER_REFERENCE', 'Choose an existing role from this saved design.', 409);
    }
    const objectId = `${command.scopeType}-${randomUUID()}`;
    affected = { id: objectId, type: command.scopeType, name: command.name, detail: command.detail,
      status: 'designed', confidence: 'low', owner: command.ownerRoleId,
      enterpriseScope: { organizationId: command.scopeType === 'organization' ? objectId : command.organizationId,
        legalEntityId: command.scopeType === 'legal-entity' ? objectId : command.legalEntityId ?? null,
        unitId: command.scopeType === 'unit' ? objectId : null },
      provenance: [], ...(command.scopeType === 'legal-entity' ? { jurisdiction: command.jurisdiction, jurisdictionEvidenceKind: 'HUMAN_REPORTED' } : {}),
      ...(command.scopeType === 'unit' ? { parentUnitId: command.parentUnitId } : {}) };
    next.areas.responsibilityAuthority.items.push(affected);
  } else {
    affected = byId.get(command.objectId);
    if (!affected) throw enterpriseFailure('ENTERPRISE_OBJECT_NOT_FOUND', 'The selected object is not present in this saved design.', 404);
    before = structuredClone(affected);
    if (command.kind === 'rename-scope') {
      if (!ENTERPRISE_SCOPE_TYPES.includes(affected.type)) throw enterpriseFailure('ENTERPRISE_SCOPE_REQUIRED', 'Choose an organization, legal entity or unit to rename.');
      affected.name = command.name; affected.detail = command.detail;
    } else {
      if (ENTERPRISE_SCOPE_TYPES.includes(affected.type)) throw enterpriseFailure('ENTERPRISE_SCOPE_COMMAND_REQUIRED', 'Scope records retain their defined hierarchy. Choose a business object for assignment.');
      affected.enterpriseScope = structuredClone(command.enterpriseScope);
    }
    if (JSON.stringify(before) === JSON.stringify(affected)) throw enterpriseFailure('ENTERPRISE_NO_CHANGE', 'This command does not change the selected object.', 409);
  }
  const changedFields = command.kind !== 'create-scope' ? Object.keys(affected).filter((field) => JSON.stringify(before[field]) !== JSON.stringify(affected[field]))
    : ['name', 'detail', 'enterpriseScope', ...(affected.jurisdiction ? ['jurisdiction'] : []), ...(affected.parentUnitId ? ['parentUnitId'] : [])];
  affected.provenance ??= [];
  affected.provenance.push({ source: 'workspace:enterprise-scope', note: 'Proposed organizational design; does not grant access or verify legal status.',
    actor, at, reason: command.reason, fields: changedFields });
  next.id = `blueprint-${randomUUID()}`;
  next.version = Math.max(...project.blueprintVersions.map((blueprint) => blueprint.version)) + 1;
  next.createdAt = at; next.epistemicStatus = 'proposed-design';
  next.relations = buildRelations(next.areas);
  next.integrity = validateBlueprint(next);
  if (!next.integrity.valid) {
    throw enterpriseFailure('INVALID_ENTERPRISE_SCOPE', next.integrity.errors[0]?.message ?? 'The scope change would invalidate the saved design.', 409);
  }
  next.edit = { actor, at, objectId: affected.id, objectType: affected.type, changedFields,
    before, after: structuredClone(affected), reason: command.reason,
    relationsBefore: previous.relations.filter((relation) => relation.source === affected.id || relation.target === affected.id),
    relationsAfter: next.relations.filter((relation) => relation.source === affected.id || relation.target === affected.id) };
  next.summary = { areaCount: Object.keys(next.areas).length, objectCount: blueprintObjects(next).length,
    relationCount: next.relations.length, designedAreas: Object.values(next.areas).filter((area) => area.status === 'designed').length };
  project.blueprintVersions.push(next);
  project.audit ??= [];
  project.audit.push({ at, action: `enterprise.${command.kind}`, actor, detail: `Updated ${affected.type} “${affected.name}” in blueprint v${next.version}.` });
  return { blueprint: next, affectedObjectId: affected.id };
}
