import { randomUUID } from 'node:crypto';
import { buildRelations, latestBlueprint, validateBlueprint } from '../model.mjs';
import { ENTERPRISE_SCOPE_TYPES, blueprintObjects, enterpriseFailure, enterpriseText } from './types.mjs';
import { digest } from '../sdlc/contracts.mjs';
import { ENTERPRISE_STATE_VALUES, enterpriseInterval, objectBasisHash } from './state.mjs';
import { applyEnterpriseBranchCommand, ENTERPRISE_BRANCH_KINDS, normalizeEnterpriseBranchCommand } from './branches.mjs';
import { applyEnterpriseProcessCommand, ENTERPRISE_PROCESS_KINDS, normalizeEnterpriseProcessCommand } from './process-commands.mjs';
import { applyEnterpriseEconomicCommand, ENTERPRISE_ECONOMIC_KINDS, normalizeEnterpriseEconomicCommand } from './economics-commands.mjs';
import { applyEnterpriseRefinementCommand, ENTERPRISE_REFINEMENT_KINDS, normalizeEnterpriseRefinementCommand } from './refinement-commands.mjs';
import { applyEnterpriseBulkEdit, applyEnterpriseDesignPack, ENTERPRISE_INTERCHANGE_KINDS, normalizeEnterpriseInterchangeCommand } from './interchange.mjs';
import { applyEnterpriseIntegrityCommand, ENTERPRISE_INTEGRITY_KINDS, normalizeEnterpriseIntegrityCommand } from './integrity.mjs';
import { applyEnterpriseSourceAcceptance, ENTERPRISE_SOURCE_ACCEPTANCE_KINDS, normalizeEnterpriseSourceAcceptanceCommand } from './source-acceptance.mjs';
import { applyEnterpriseGovernanceCommand, ENTERPRISE_GOVERNANCE_KINDS, normalizeEnterpriseGovernanceCommand } from './governance.mjs';
import { applyEnterpriseStewardshipCommand, ENTERPRISE_STEWARDSHIP_KINDS, normalizeEnterpriseStewardshipCommand } from './stewardship.mjs';

const base = ['kind', 'blueprintId', 'blueprintVersion', 'reason'];
function reference(value, field, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,119}$/i.test(value)) {
    throw enterpriseFailure('INVALID_ENTERPRISE_COMMAND', `${field} must identify a saved design record${nullable ? ' or be null' : ''}.`);
  }
  return value;
}
export function normalizeEnterpriseCommand(input) {
  if (input && ENTERPRISE_STEWARDSHIP_KINDS.has(input.kind)) return normalizeEnterpriseStewardshipCommand(input);
  if (input && ENTERPRISE_GOVERNANCE_KINDS.has(input.kind)) return normalizeEnterpriseGovernanceCommand(input);
  if (input && ENTERPRISE_INTEGRITY_KINDS.has(input.kind)) return normalizeEnterpriseIntegrityCommand(input);
  if (input && ENTERPRISE_SOURCE_ACCEPTANCE_KINDS.has(input.kind)) return normalizeEnterpriseSourceAcceptanceCommand(input);
  if (input && ENTERPRISE_PROCESS_KINDS.has(input.kind)) return normalizeEnterpriseProcessCommand(input);
  if (input && ENTERPRISE_ECONOMIC_KINDS.has(input.kind)) return normalizeEnterpriseEconomicCommand(input);
  if (input && ENTERPRISE_REFINEMENT_KINDS.has(input.kind)) return normalizeEnterpriseRefinementCommand(input);
  if (input && ENTERPRISE_INTERCHANGE_KINDS.has(input.kind)) return normalizeEnterpriseInterchangeCommand(input);
  if (input && ENTERPRISE_BRANCH_KINDS.has(input.kind)) return normalizeEnterpriseBranchCommand(input);
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || !['create-scope', 'rename-scope', 'assign-object-scope', 'record-state', 'set-validity', 'propose-future-design'].includes(input.kind)
    || !/^blueprint-[0-9a-f-]{36}$/.test(input.blueprintId ?? '')
    || !Number.isSafeInteger(input.blueprintVersion) || input.blueprintVersion < 1) {
    throw enterpriseFailure('INVALID_ENTERPRISE_COMMAND', 'Choose an available enterprise command and bind it to the saved blueprint.');
  }
  const normalized = { kind: input.kind, blueprintId: input.blueprintId, blueprintVersion: input.blueprintVersion,
    reason: enterpriseText(input.reason, 'Change reason', 500) };
  let allowed;
  if (input.kind === 'record-state') {
    allowed = [...base, 'objectId', 'dimension', 'value', 'basisHash', 'evidenceSummary'];
    if (!Object.hasOwn(ENTERPRISE_STATE_VALUES, input.dimension)
      || !ENTERPRISE_STATE_VALUES[input.dimension].includes(input.value) || !/^[a-f0-9]{64}$/.test(input.basisHash ?? '')) {
      throw enterpriseFailure('INVALID_ENTERPRISE_STATE', 'Choose an available independent state value and the exact selected object basis hash.');
    }
    const evidenceSummary = input.evidenceSummary ?? '';
    if (typeof evidenceSummary !== 'string' || evidenceSummary.length > 1000
      || (['ACTIVE', 'RETIRED', 'IMPLEMENTED_UNVERIFIED', 'OBSERVED_UNVERIFIED'].includes(input.value) && !evidenceSummary.trim())) {
      throw enterpriseFailure('ENTERPRISE_STATE_EVIDENCE_REQUIRED', 'Reported active, retired, implemented or observed states need a bounded evidence summary.');
    }
    Object.assign(normalized, { objectId: reference(input.objectId, 'Design object'), dimension: input.dimension,
      value: input.value, basisHash: input.basisHash, evidenceSummary: evidenceSummary.trim() });
  } else if (input.kind === 'set-validity' || input.kind === 'propose-future-design') {
    allowed = [...base, 'effectiveFrom', 'effectiveTo', ...(input.kind === 'propose-future-design' ? ['objectId', 'title', 'name', 'detail'] : [])];
    Object.assign(normalized, enterpriseInterval(input.effectiveFrom, input.effectiveTo));
    if (input.kind === 'propose-future-design') Object.assign(normalized, {
      objectId: reference(input.objectId, 'Design object'), title: enterpriseText(input.title, 'Future design title', 160),
      name: enterpriseText(input.name, 'Proposed name', 120), detail: enterpriseText(input.detail, 'Proposed description', 700) });
  } else if (input.kind === 'create-scope') {
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
export function applyEnterpriseCommand(project, command, actor, options = {}) {
  if (ENTERPRISE_STEWARDSHIP_KINDS.has(command.kind)) return applyEnterpriseStewardshipCommand(project, command, actor);
  if (ENTERPRISE_GOVERNANCE_KINDS.has(command.kind)) return applyEnterpriseGovernanceCommand(project, command, actor);
  if (ENTERPRISE_INTEGRITY_KINDS.has(command.kind)) return applyEnterpriseIntegrityCommand(project, command, actor);
  if (ENTERPRISE_SOURCE_ACCEPTANCE_KINDS.has(command.kind)) return applyEnterpriseSourceAcceptance(project, command, actor);
  if (ENTERPRISE_PROCESS_KINDS.has(command.kind)) return applyEnterpriseProcessCommand(project, command, actor);
  if (ENTERPRISE_ECONOMIC_KINDS.has(command.kind)) return applyEnterpriseEconomicCommand(project, command, actor);
  if (ENTERPRISE_REFINEMENT_KINDS.has(command.kind)) return applyEnterpriseRefinementCommand(project, command, actor);
  if (command.kind === 'import-design-pack') return applyEnterpriseDesignPack(project, command, actor);
  if (command.kind === 'bulk-edit-objects') return applyEnterpriseBulkEdit(project, command, actor);
  if (ENTERPRISE_BRANCH_KINDS.has(command.kind)) return applyEnterpriseBranchCommand(project, command, actor, options);
  const previous = latestBlueprint(project);
  if (!previous) throw enterpriseFailure('BLUEPRINT_NOT_FOUND', 'Save the initial blueprint before defining enterprise scopes.', 409);
  if (previous.id !== command.blueprintId || previous.version !== command.blueprintVersion) {
    throw enterpriseFailure('ENTERPRISE_BLUEPRINT_STALE', 'This command names a historical or changed blueprint. Reload the current design before editing.', 409);
  }
  if (['record-state', 'set-validity', 'propose-future-design'].includes(command.kind)) {
    return applyStateTimeCommand(project, previous, command, actor);
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

function applyStateTimeCommand(project, previous, command, actor) {
  const next = structuredClone(previous);
  const at = new Date().toISOString();
  const affected = command.objectId ? blueprintObjects(next).find((object) => object.id === command.objectId) : null;
  if (command.objectId && !affected) throw enterpriseFailure('ENTERPRISE_OBJECT_NOT_FOUND', 'The selected object is not present in the current main design.', 404);
  const before = affected ? structuredClone(affected) : structuredClone(previous.enterpriseValidity ?? {});
  if (command.kind === 'record-state') {
    if (objectBasisHash(affected) !== command.basisHash) throw enterpriseFailure('ENTERPRISE_STATE_BASIS_STALE', 'The object meaning changed. Reload before reporting or reviewing its state.', 409);
    affected.enterpriseStates ??= {};
    affected.enterpriseStates[command.dimension] = { value: command.value, basisHash: command.basisHash,
      evidenceKind: command.dimension === 'review' ? 'HUMAN_REVIEW' : 'HUMAN_REPORTED',
      recordedBy: actor, recordedAt: at, reason: command.reason, evidenceSummary: command.evidenceSummary };
    affected.provenance ??= [];
    affected.provenance.push({ source: 'workspace:enterprise-state', actor, at, reason: command.reason,
      note: 'An independent design review or human-reported state; no execution or verified outcome authority is granted.' });
  } else {
    if (command.kind === 'set-validity' && command.effectiveFrom
      && (command.effectiveFrom > at || (command.effectiveTo && command.effectiveTo <= at))) {
      throw enterpriseFailure('ENTERPRISE_CURRENT_VALIDITY_REQUIRED', 'The current design interval must contain now. Use a future proposal for a later design.', 409);
    }
    if (command.kind === 'propose-future-design' && (!command.effectiveFrom || command.effectiveFrom <= at)) {
      throw enterpriseFailure('ENTERPRISE_FUTURE_DATE_REQUIRED', 'A new future proposal needs a declared start after now.', 409);
    }
    next.enterpriseValidity = { effectiveFrom: command.effectiveFrom, effectiveTo: command.effectiveTo,
      evidenceKind: 'HUMAN_PROPOSED', recordedBy: actor, recordedAt: at, reason: command.reason };
  }
  next.id = `blueprint-${randomUUID()}`;
  next.createdAt = at; next.epistemicStatus = 'proposed-design';
  if (command.kind === 'propose-future-design') {
    if (['actor-human', 'actor-agent'].includes(affected.type)) throw enterpriseFailure('ENTERPRISE_ACTOR_IDENTITY_FIXED', 'Actor identity labels cannot be changed by a future design proposal.');
    if (affected.name === command.name && affected.detail === command.detail) throw enterpriseFailure('ENTERPRISE_NO_CHANGE', 'Propose a change to the selected object.', 409);
    if (affected.type === 'role' && blueprintObjects(next).some((object) => object.type === 'role' && object.id !== affected.id
      && object.name.toLocaleLowerCase() === command.name.toLocaleLowerCase())) {
      throw enterpriseFailure('INVALID_BLUEPRINT_RELATION', 'Role names must remain unique so design ownership remains unambiguous.', 409);
    }
    affected.name = command.name; affected.detail = command.detail;
    affected.enterpriseStates ??= {};
    affected.enterpriseStates.lifecycle = { value: 'PLANNED', basisHash: objectBasisHash(affected),
      evidenceKind: 'HUMAN_REPORTED', recordedBy: actor, recordedAt: at, reason: command.reason, evidenceSummary: '' };
    affected.provenance ??= [];
    affected.provenance.push({ source: 'workspace:future-design', actor, at, reason: command.reason, note: 'An immutable future proposal; not current or operational.' });
  }
  next.relations = buildRelations(next.areas);
  next.integrity = validateBlueprint(next);
  if (!next.integrity.valid) throw enterpriseFailure('INVALID_ENTERPRISE_SCOPE', 'The proposed state or date change would invalidate the saved design.', 409);
  const changedFields = command.kind === 'record-state' ? ['enterpriseStates']
    : command.kind === 'set-validity' ? ['enterpriseValidity'] : ['name', 'detail', 'enterpriseStates', 'enterpriseValidity'];
  next.edit = { actor, at, objectId: affected?.id ?? null, objectType: affected?.type ?? 'blueprint', changedFields, reason: command.reason,
    before, after: affected ? structuredClone(affected) : structuredClone(next.enterpriseValidity),
    relationsBefore: affected ? previous.relations.filter((relation) => relation.source === affected.id || relation.target === affected.id) : [],
    relationsAfter: affected ? next.relations.filter((relation) => relation.source === affected.id || relation.target === affected.id) : [] };
  if (command.kind === 'propose-future-design') {
    project.enterpriseProposals ??= [];
    if (project.enterpriseProposals.length >= 100) throw enterpriseFailure('ENTERPRISE_PROPOSAL_LIMIT', 'This project reached its 100-proposal history limit.', 409);
    const core = { id: `enterprise-proposal-${randomUUID()}`, title: command.title, objectId: affected.id,
      recordedAt: at, createdBy: actor, status: 'PROPOSED', effectiveFrom: command.effectiveFrom, effectiveTo: command.effectiveTo,
      baseBlueprintId: previous.id, baseBlueprintVersion: previous.version, baseSnapshotHash: digest(previous),
      snapshot: next, snapshotHash: digest(next) };
    const proposal = { ...core, proposalHash: digest(core) };
    project.enterpriseProposals.push(proposal);
    project.audit ??= [];
    project.audit.push({ at, action: 'enterprise.propose-future-design', actor,
      detail: `Proposed “${command.title}” for ${command.effectiveFrom}; current design remains unchanged.` });
    return { blueprint: previous, affectedObjectId: affected.id, proposalId: proposal.id, recordedAt: at };
  }
  next.version = Math.max(...project.blueprintVersions.map((blueprint) => blueprint.version)) + 1;
  project.blueprintVersions.push(next);
  project.audit ??= [];
  project.audit.push({ at, action: `enterprise.${command.kind}`, actor, detail: 'Recorded an independent reported design state or declared validity interval.' });
  return { blueprint: next, affectedObjectId: affected?.id ?? null, proposalId: null, recordedAt: at };
}
