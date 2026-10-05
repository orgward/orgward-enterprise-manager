import { randomUUID } from 'node:crypto';
import { buildRelations, latestBlueprint, validateBlueprint } from '../model.mjs';
import { digest } from '../sdlc/contracts.mjs';
import { blueprintObjects, enterpriseFailure, enterpriseText } from './types.mjs';
import { appendEnterpriseBranchDesign } from './branches.mjs';
import { projectEnterprise } from './projections.mjs';
import { normalizeDecisionTable, normalizeProcessFlow } from './process-model.mjs';
import { normalizeStaffingScenario, simulateProcessFlow, simulateStaffingCapacity } from './process-simulation.mjs';

export const ENTERPRISE_PROCESS_KINDS = new Set(['define-process-flow', 'define-decision-table', 'simulate-process', 'simulate-staffing']);
const fail = (code, message, status = 400) => { throw enterpriseFailure(code, message, status); };
const safeId = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,119}$/i.test(value);
export function normalizeEnterpriseProcessCommand(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !ENTERPRISE_PROCESS_KINDS.has(input.kind)
    || !/^blueprint-[0-9a-f-]{36}$/.test(input.blueprintId ?? '') || !Number.isSafeInteger(input.blueprintVersion) || input.blueprintVersion < 1) {
    fail('INVALID_ENTERPRISE_PROCESS_COMMAND', 'Choose a supported process command bound to an exact saved blueprint.');
  }
  const command = { kind: input.kind, blueprintId: input.blueprintId, blueprintVersion: input.blueprintVersion,
    reason: enterpriseText(input.reason, 'Change reason', 500) };
  const allowed = ['kind', 'blueprintId', 'blueprintVersion', 'reason'];
  if (input.branchId !== undefined || input.branchRevision !== undefined) {
    if (!/^enterprise-branch-[0-9a-f-]{36}$/.test(input.branchId ?? '') || !Number.isSafeInteger(input.branchRevision) || input.branchRevision < 1) {
      fail('INVALID_ENTERPRISE_PROCESS_COMMAND', 'Choose an exact saved branch revision.');
    }
    allowed.push('branchId', 'branchRevision'); Object.assign(command, { branchId: input.branchId, branchRevision: input.branchRevision });
  }
  if (input.kind === 'simulate-process' || input.kind === 'simulate-staffing') {
    allowed.push('processId', 'scenario', 'proposalId');
    if (!safeId(input.processId) || !input.scenario || typeof input.scenario !== 'object' || Array.isArray(input.scenario)) fail('INVALID_ENTERPRISE_PROCESS_COMMAND', 'Choose a saved process and declared scenario.');
    if (input.proposalId != null && (!/^enterprise-proposal-[0-9a-f-]{36}$/.test(input.proposalId) || command.branchId)) fail('INVALID_ENTERPRISE_PROCESS_COMMAND', 'Choose a main, branch or proposal source.');
    Object.assign(command, { processId: input.processId,
      scenario: input.kind === 'simulate-staffing' ? normalizeStaffingScenario(input.scenario) : structuredClone(input.scenario),
      proposalId: input.proposalId ?? null });
  } else {
    const field = input.kind === 'define-process-flow' ? 'processFlow' : 'decisionTable';
    allowed.push('objectId', field);
    if (!safeId(input.objectId) || !input[field] || typeof input[field] !== 'object' || Array.isArray(input[field])) fail('INVALID_ENTERPRISE_PROCESS_COMMAND', 'Choose a canonical process or decision and a typed definition.');
    command.objectId = input.objectId; command[field] = structuredClone(input[field]);
  }
  if (Object.keys(input).some((field) => !allowed.includes(field))) fail('INVALID_ENTERPRISE_PROCESS_COMMAND', 'The process command contains unsupported fields.');
  return command;
}
export function applyEnterpriseProcessCommand(project, command, actor) {
  const at = new Date().toISOString(); const current = latestBlueprint(project);
  if (!current) fail('BLUEPRINT_NOT_FOUND', 'Save the initial blueprint first.', 409);
  if (command.kind === 'simulate-process' || command.kind === 'simulate-staffing') {
    if ((project.enterpriseSimulations ?? []).length >= 50) fail('PROCESS_SIMULATION_LIMIT', 'This project reached its 50-simulation history limit.', 409);
    const query = command.branchId ? { branchId: command.branchId, branchRevision: command.branchRevision }
      : command.proposalId ? { proposalId: command.proposalId } : { blueprintVersion: command.blueprintVersion };
    const view = projectEnterprise(project, query); const source = view.blueprint;
    if (!source || source.id !== command.blueprintId || source.version !== command.blueprintVersion) fail('PROCESS_SIMULATION_SOURCE_STALE', 'The exact simulation source was not found in this project.', 409);
    const objects = blueprintObjects(source); const byId = new Map(objects.map((object) => [object.id, object]));
    const process = byId.get(command.processId);
    if (process?.type !== 'process') fail('INVALID_PROCESS_REFERENCE', 'Choose a canonical process in the exact simulation source.');
    const result = command.kind === 'simulate-staffing'
      ? simulateStaffingCapacity(process, command.scenario)
      : simulateProcessFlow(process, command.scenario, byId);
    const binding = { projectId: project.id, blueprintId: source.id, blueprintVersion: source.version,
      processId: process.id, snapshotHash: digest(source), branchId: command.branchId ?? null,
      branchRevision: command.branchRevision ?? null, proposalId: command.proposalId ?? null };
    const referenced = command.kind === 'simulate-staffing' ? new Set([process.id]) : new Set([process.id,
      ...process.processFlow.steps.flatMap((step) => [step.processId, step.roleId, step.decisionId,
        ...(step.inputIds ?? []), ...(step.outputIds ?? []),
        ...(byId.get(step.decisionId)?.decisionTable?.inputs ?? []).map((entry) => entry.informationId)]).filter(Boolean),
      ...result.scenario.inputs.map((entry) => entry.informationId)]);
    const sourceLabels = { records: Object.fromEntries(objects.filter((object) => referenced.has(object.id)).map((object) => [object.id, object.name])),
      steps: Object.fromEntries((process.processFlow?.steps ?? []).map((step) => [step.id, step.title])) };
    const { resultHash: evaluatedHash, ...evaluated } = result;
    const core = { ...evaluated, source: binding, sourceLabels };
    if (Buffer.byteLength(JSON.stringify(core), 'utf8') > 262144) fail('PROCESS_SIMULATION_TOO_LARGE', 'The saved explainable simulation exceeds 256 KiB. Reduce rules, trace length or repeated assumptions.', 409);
    const simulation = { ...core, resultHash: digest(core), id: `process-simulation-${randomUUID()}`, createdAt: at, createdBy: actor, reason: command.reason };
    project.enterpriseSimulations ??= []; project.enterpriseSimulations.push(simulation);
    project.audit ??= []; project.audit.push({ at, action: command.kind === 'simulate-staffing' ? 'enterprise.simulate-staffing' : 'enterprise.simulate-process', actor,
      detail: `Saved ${result.status.toLowerCase()} declared simulation for “${process.name}”; no work or business effects performed.` });
    return { blueprint: source, affectedObjectId: process.id, proposalId: command.proposalId ?? null,
      branchId: command.branchId ?? null, branchRevision: command.branchRevision ?? null, simulationId: simulation.id, recordedAt: at };
  }
  const field = command.kind === 'define-process-flow' ? 'processFlow' : 'decisionTable';
  const mutate = (next, savedAt) => {
    const priorRelations = structuredClone(next.relations);
    const objects = blueprintObjects(next); const byId = new Map(objects.map((object) => [object.id, object]));
    const object = byId.get(command.objectId); const required = field === 'processFlow' ? 'process' : 'decision';
    if (object?.type !== required) fail('INVALID_PROCESS_REFERENCE', `Choose a saved ${required} in this exact source.`);
    const before = structuredClone(object);
    const definition = field === 'processFlow' ? normalizeProcessFlow(command[field], byId) : normalizeDecisionTable(command[field], byId);
    if (digest(object[field] ?? null) === digest(definition)) fail('ENTERPRISE_NO_CHANGE', 'The definition has no semantic changes.', 409);
    object[field] = definition; object.provenance ??= [];
    object.provenance.push({ source: 'workspace:process-design', actor, at: savedAt, reason: command.reason,
      fields: [field], note: 'A proposed process or decision design; simulation and actual human work remain separate.' });
    next.id = `blueprint-${randomUUID()}`; next.version += 1; next.createdAt = savedAt; next.epistemicStatus = 'proposed-design';
    next.relations = buildRelations(next.areas); next.integrity = validateBlueprint(next);
    if (!next.integrity.valid) fail('INVALID_PROCESS_DEFINITION', next.integrity.errors[0]?.message ?? 'The definition would invalidate saved typed references.', 409);
    next.summary = { areaCount: Object.keys(next.areas).length, objectCount: objects.length, relationCount: next.relations.length,
      designedAreas: Object.values(next.areas).filter((area) => area.status === 'designed').length };
    next.edit = { actor, at: savedAt, objectId: object.id, objectType: object.type, changedFields: [field], before,
      after: structuredClone(object), reason: command.reason,
      relationsBefore: priorRelations.filter((edge) => edge.source === object.id || edge.target === object.id),
      relationsAfter: next.relations.filter((edge) => edge.source === object.id || edge.target === object.id) };
    return next;
  };
  if (command.branchId) return appendEnterpriseBranchDesign(project, command, actor, mutate);
  if (current.id !== command.blueprintId || current.version !== command.blueprintVersion) fail('ENTERPRISE_BLUEPRINT_STALE', 'Reload the current main before defining process design.', 409);
  const next = mutate(structuredClone(current), at); project.blueprintVersions.push(next);
  project.audit ??= []; project.audit.push({ at, action: `enterprise.${command.kind}`, actor, detail: 'Saved an independent typed process design.' });
  return { blueprint: next, affectedObjectId: command.objectId, proposalId: null, recordedAt: at };
}
