import { randomUUID } from 'node:crypto';
import { buildRelations, latestBlueprint, validateBlueprint } from '../model.mjs';
import { digest } from '../sdlc/contracts.mjs';
import { blueprintObjects, enterpriseFailure, enterpriseText } from './types.mjs';
import { appendEnterpriseBranchDesign } from './branches.mjs';
import { projectEnterprise } from './projections.mjs';
import { ECONOMIC_LIMITS, economicModelErrors, economicModelRelations, normalizeEconomicScenario,
  normalizeResourcePlan, normalizeValueLifecycle } from './economics-model.mjs';
import { evaluateEconomicScenario } from './economics-scenario.mjs';
import { buildEconomicInputManifest } from './derived-input-provenance.mjs';

export const ENTERPRISE_ECONOMIC_KINDS = new Set(['define-economic-scenario', 'define-resource-plan', 'define-value-lifecycle', 'evaluate-economic-scenario']);
const definitions = { 'define-economic-scenario': ['economicScenario', 'economics'], 'define-resource-plan': ['resourcePlan', 'resource'],
  'define-value-lifecycle': ['valueLifecycle', 'lifecycle'] };
const fail = (code, message, status = 400) => { throw enterpriseFailure(code, message, status); };
const safeId = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,119}$/i.test(value);
export function normalizeEnterpriseEconomicCommand(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !ENTERPRISE_ECONOMIC_KINDS.has(input.kind)
    || !/^blueprint-[0-9a-f-]{36}$/.test(input.blueprintId ?? '') || !Number.isSafeInteger(input.blueprintVersion) || input.blueprintVersion < 1
    || !safeId(input.objectId)) fail('INVALID_ENTERPRISE_ECONOMIC_COMMAND', 'Bind a supported economic/resource/value command to an exact saved blueprint and canonical object.');
  const command = { kind: input.kind, blueprintId: input.blueprintId, blueprintVersion: input.blueprintVersion,
    objectId: input.objectId, reason: enterpriseText(input.reason, 'Change/evaluation reason', 500) };
  const allowed = ['kind', 'blueprintId', 'blueprintVersion', 'objectId', 'reason'];
  if (input.branchId !== undefined || input.branchRevision !== undefined) {
    if (!/^enterprise-branch-[0-9a-f-]{36}$/.test(input.branchId ?? '') || !Number.isSafeInteger(input.branchRevision) || input.branchRevision < 1) {
      fail('INVALID_ENTERPRISE_ECONOMIC_COMMAND', 'Choose an exact saved branch revision.');
    }
    allowed.push('branchId', 'branchRevision'); Object.assign(command, { branchId: input.branchId, branchRevision: input.branchRevision });
  }
  if (input.kind === 'evaluate-economic-scenario') {
    allowed.push('proposalId');
    if (input.proposalId != null && (command.branchId || !/^enterprise-proposal-[0-9a-f-]{36}$/.test(input.proposalId))) fail('INVALID_ENTERPRISE_ECONOMIC_COMMAND', 'Choose a main version, branch or future proposal source.');
    command.proposalId = input.proposalId ?? null;
  } else {
    const [field] = definitions[input.kind]; allowed.push(field);
    if (!input[field] || typeof input[field] !== 'object' || Array.isArray(input[field])) fail('INVALID_ENTERPRISE_ECONOMIC_COMMAND', 'Provide the supported typed definition.');
    command[field] = structuredClone(input[field]);
    if (Buffer.byteLength(JSON.stringify(command[field]), 'utf8') > 65536) fail('ECONOMIC_DEFINITION_TOO_LARGE', 'This typed definition exceeds its 64 KiB limit.');
  }
  if (Object.keys(input).some((key) => !allowed.includes(key))) fail('INVALID_ENTERPRISE_ECONOMIC_COMMAND', 'The command contains unsupported fields.');
  return command;
}
export function applyEnterpriseEconomicCommand(project, command, actor) {
  const current = latestBlueprint(project); const at = new Date().toISOString();
  if (!current) fail('BLUEPRINT_NOT_FOUND', 'Save an initial blueprint before defining economic/resource/value records.', 409);
  if (command.kind === 'evaluate-economic-scenario') return saveEvaluation(project, command, actor, at);
  const [field, requiredType] = definitions[command.kind];
  const mutate = (next, savedAt) => {
    const beforeRelations = structuredClone(next.relations); const objects = blueprintObjects(next);
    const byId = new Map(objects.map((object) => [object.id, object])); const object = byId.get(command.objectId);
    if (object?.type !== requiredType) fail('INVALID_ECONOMIC_REFERENCE', `Choose an existing canonical ${requiredType} from this exact source.`);
    const before = structuredClone(object);
    const definition = field === 'economicScenario' ? normalizeEconomicScenario(command[field], byId)
      : field === 'resourcePlan' ? normalizeResourcePlan(command[field], byId, object.id) : normalizeValueLifecycle(command[field], byId);
    if (digest(object[field] ?? null) === digest(definition)) fail('ENTERPRISE_NO_CHANGE', 'The typed definition has no semantic changes.', 409);
    object[field] = definition; object.provenance ??= [];
    object.provenance.push({ source: 'workspace:economics-resources-value', actor, at: savedAt, reason: command.reason, fields: [field],
      note: 'Declared assumptions and human-reported value/capacity; no verified business performance, work allocation or financial effect authority is granted.' });
    next.id = `blueprint-${randomUUID()}`; next.version += 1; next.createdAt = savedAt; next.epistemicStatus = 'proposed-design';
    next.relations = [...new Map([...buildRelations(next.areas), ...economicModelRelations(objects)].map((relation) => [relation.id, relation])).values()];
    next.integrity = validateBlueprint(next); const typedErrors = economicModelErrors(objects);
    if (!next.integrity.valid || typedErrors.length) fail('INVALID_ECONOMIC_DEFINITION', typedErrors[0]?.message ?? next.integrity.errors[0]?.message ?? 'The typed definition invalidates saved references.', 409);
    next.summary = { areaCount: Object.keys(next.areas).length, objectCount: objects.length, relationCount: next.relations.length,
      designedAreas: Object.values(next.areas).filter((area) => area.status === 'designed').length };
    next.edit = { actor, at: savedAt, objectId: object.id, objectType: object.type, changedFields: [field], before,
      after: structuredClone(object), reason: command.reason,
      relationsBefore: beforeRelations.filter((relation) => relation.source === object.id || relation.target === object.id),
      relationsAfter: next.relations.filter((relation) => relation.source === object.id || relation.target === object.id) };
    return next;
  };
  if (command.branchId) return appendEnterpriseBranchDesign(project, command, actor, mutate);
  if (current.id !== command.blueprintId || current.version !== command.blueprintVersion) fail('ENTERPRISE_BLUEPRINT_STALE', 'Reload current main before changing its typed assumptions or reports.', 409);
  const next = mutate(structuredClone(current), at); project.blueprintVersions.push(next);
  project.audit ??= []; project.audit.push({ at, action: `enterprise.${command.kind}`, actor, detail: 'Saved linked typed economics/resource/value design with explicit assumption/report sources.' });
  return { blueprint: next, affectedObjectId: command.objectId, proposalId: null, recordedAt: at };
}
function saveEvaluation(project, command, actor, at) {
  if ((project.enterpriseEconomicEvaluations ?? []).length >= ECONOMIC_LIMITS.evaluations) fail('ECONOMIC_EVALUATION_LIMIT', 'This project reached its 50-evaluation history limit.', 409);
  const query = command.branchId ? { branchId: command.branchId, branchRevision: command.branchRevision }
    : command.proposalId ? { proposalId: command.proposalId } : { blueprintVersion: command.blueprintVersion };
  const view = projectEnterprise(project, query); const source = view.blueprint;
  if (!source || source.id !== command.blueprintId || source.version !== command.blueprintVersion) fail('ECONOMIC_EVALUATION_SOURCE_STALE', 'The exact economic evaluation source was not found in this project.', 409);
  const objects = blueprintObjects(source); const byId = new Map(objects.map((object) => [object.id, object])); const object = byId.get(command.objectId);
  if (object?.type !== 'economics' || !object.economicScenario) fail('ECONOMIC_SCENARIO_REQUIRED', 'Choose a canonical economics object with a saved typed scenario.');
  const evaluated = evaluateEconomicScenario(object, byId); const { resultHash, ...calculation } = evaluated;
  const referenced = new Set([object.id, calculation.scenario.offeringId, ...calculation.scenario.processIds,
    ...calculation.scenario.resourceDemands.flatMap((entry) => [entry.resourceId, entry.processId]),
    ...calculation.resources.flatMap((entry) => entry.allocations.map((allocation) => allocation.processId))]);
  const binding = { projectId: project.id, blueprintId: source.id, blueprintVersion: source.version, snapshotHash: digest(source),
    branchId: command.branchId ?? null, branchRevision: command.branchRevision ?? null, proposalId: command.proposalId ?? null };
  const inputManifest = buildEconomicInputManifest(project.id, source, object.id);
  if (!inputManifest || inputManifest.source.snapshotHash !== binding.snapshotHash) {
    fail('ECONOMIC_INPUTS_UNTRACKED', 'The exact economic calculation inputs could not be resolved to immutable records; no evaluation was saved.', 409);
  }
  const sourceLabels = { records: Object.fromEntries(objects.filter((entry) => referenced.has(entry.id)).map((entry) => [entry.id, entry.name])) };
  const core = { ...calculation, source: binding, sourceLabels,
    inputProvenance: { status: 'TRACKED', manifestHash: digest(inputManifest), manifest: inputManifest } };
  if (Buffer.byteLength(JSON.stringify(core), 'utf8') > 262144) fail('ECONOMIC_EVALUATION_TOO_LARGE', 'The explainable evaluation exceeds its 256 KiB limit.', 409);
  const evaluation = { ...core, resultHash: digest(core), id: `economic-evaluation-${randomUUID()}`, createdAt: at, createdBy: actor, reason: command.reason };
  project.enterpriseEconomicEvaluations ??= []; project.enterpriseEconomicEvaluations.push(evaluation);
  project.audit ??= []; project.audit.push({ at, action: 'enterprise.evaluate-economic-scenario', actor,
    detail: `Saved ${evaluation.status.toLowerCase()} declared economic scenario for “${object.name}”; no work, reservation or financial effects performed.` });
  return { blueprint: source, affectedObjectId: object.id, branchId: command.branchId ?? null, branchRevision: command.branchRevision ?? null,
    proposalId: command.proposalId ?? null, economicEvaluationId: evaluation.id, recordedAt: at };
}
