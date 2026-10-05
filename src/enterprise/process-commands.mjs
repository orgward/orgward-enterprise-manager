import { randomUUID } from 'node:crypto';
import { buildRelations, latestBlueprint, validateBlueprint } from '../model.mjs';
import { digest } from '../sdlc/contracts.mjs';
import { blueprintObjects, enterpriseFailure, enterpriseText } from './types.mjs';
import { appendEnterpriseBranchDesign } from './branches.mjs';
import { projectEnterprise } from './projections.mjs';
import { normalizeDecisionTable, normalizeProcessFlow } from './process-model.mjs';
import { normalizeStaffingScenario, simulateProcessFlow, simulateStaffingCapacity } from './process-simulation.mjs';
import { createLocalSandboxTestAdapter, LOCAL_SANDBOX_ADAPTER_ID, SANDBOX_EFFECT_CONTRACT } from './sandbox-adapter-contract.mjs';

export const ENTERPRISE_PROCESS_KINDS = new Set(['define-process-flow', 'define-decision-table', 'simulate-process', 'simulate-staffing', 'run-sandbox-procurement-test']);
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
  if (input.kind === 'run-sandbox-procurement-test') {
    allowed.push('processId', 'stepId');
    if (!safeId(input.processId) || !safeId(input.stepId)) fail('Choose a saved process and exact sandbox effect step.', 'INVALID_ENTERPRISE_PROCESS_COMMAND');
    Object.assign(command, { processId: input.processId, stepId: input.stepId });
  } else if (input.kind === 'simulate-process' || input.kind === 'simulate-staffing') {
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
  if (command.kind === 'run-sandbox-procurement-test') {
    if (current.id !== command.blueprintId || current.version !== command.blueprintVersion) {
      fail('SANDBOX_TRANSACTION_SOURCE_STALE', 'The saved process or capacity source changed. Review the current design and request owner approval again.', 409);
    }
    const blueprintHash = digest(current);
    const objects = blueprintObjects(current); const byId = new Map(objects.map((object) => [object.id, object]));
    const process = byId.get(command.processId); const step = process?.processFlow?.steps?.find((entry) => entry.id === command.stepId);
    if (process?.type !== 'process' || step?.kind !== 'sandbox-procurement') {
      fail('SANDBOX_TRANSACTION_INTENT_MISSING', 'The exact saved process has no sandbox procurement intent to approve.', 409);
    }
    const resource = byId.get(step.resourceId);
    const window = resource?.resourcePlan?.windows?.find((entry) => entry.id === step.windowId);
    const allocation = window?.allocations?.find((entry) => entry.id === step.allocationId);
    const quantity = allocation?.quantity; const available = window?.available; const capacity = window?.capacity;
    if (resource?.type !== 'resource' || allocation?.processId !== process.id || allocation.state !== 'COMMITTED_REPORTED'
      || quantity?.value === null || !Number.isFinite(quantity?.value) || quantity.value <= 0
      || available?.value === null || !Number.isFinite(available?.value) || available.value < quantity.value
      || capacity?.value === null || !Number.isFinite(capacity?.value) || capacity.value < available.value
      || quantity.unit !== available.unit || available.unit !== capacity.unit) {
      fail('SANDBOX_TRANSACTION_CAPACITY_UNAVAILABLE', 'Owner approval requires a current committed allocation with known matching units and enough reported capacity. Update the saved commitment or capacity, then retry.', 409);
    }
    const operationKey = digest({ projectId: project.id, blueprintId: current.id, blueprintVersion: current.version,
      blueprintHash, processId: process.id, stepId: step.id, resourceId: resource.id, windowId: window.id, allocationId: allocation.id });
    const existing = (project.sandboxTransactions ?? []).find((entry) => entry.operationKey === operationKey);
    if (existing) return { blueprint: current, affectedObjectId: process.id, sandboxTransaction: structuredClone(existing), idempotent: true };
    const operationId = `sandbox-transaction-${randomUUID()}`;
    const request = { contract: SANDBOX_EFFECT_CONTRACT, schemaVersion: '1.0', adapterId: LOCAL_SANDBOX_ADAPTER_ID,
      mode: 'LOCAL_TEST_ONLY', operationId, operationKey, kind: 'PROCUREMENT_TEST_EFFECT',
      source: { projectId: project.id, blueprintId: current.id, blueprintVersion: current.version, blueprintHash,
        processId: process.id, stepId: step.id, resourceId: resource.id, windowId: window.id, allocationId: allocation.id },
      approval: { decision: 'APPROVED', actor, at, authority: 'HUMAN_PROJECT_OWNER',
        quantity: { value: quantity.value, unit: quantity.unit }, capacity: { value: available.value, unit: available.unit } } };
    const adapterResponse = createLocalSandboxTestAdapter().dispatch(request);
    const core = { operationId, operationKey, providerKey: `orgward-local-sandbox:${operationKey}`,
      contract: SANDBOX_EFFECT_CONTRACT, contractVersion: '1.0', mode: 'LOCAL_TEST_ONLY',
      adapterId: LOCAL_SANDBOX_ADAPTER_ID, kind: 'PROCUREMENT_TEST_EFFECT', status: adapterResponse.outcome, sandbox: true,
      label: `Sandbox test effect · ${step.title}`, source: { projectId: project.id, blueprintId: current.id, blueprintVersion: current.version,
        blueprintHash, processId: process.id, stepId: step.id, resourceId: resource.id, windowId: window.id, allocationId: allocation.id },
      commitment: { state: allocation.state, quantity: structuredClone(quantity), source: 'saved owner-reviewed design declaration' },
      capacity: { available: structuredClone(available), total: structuredClone(capacity), source: 'saved owner-reviewed design declaration' },
      approval: { decision: 'APPROVED', actor, at, authority: 'HUMAN_PROJECT_OWNER',
        approved: { kind: 'PROCUREMENT_TEST_EFFECT', stepId: step.id, resourceId: resource.id, windowId: window.id,
          allocationId: allocation.id, quantity: structuredClone(quantity), capacity: structuredClone(available) } },
      effect: { result: adapterResponse.result.status, externalProviderCalled: adapterResponse.externalProviderCalled,
        adapterResponse: structuredClone(adapterResponse) },
      evidence: { kind: 'SANDBOX_OPERATION_RECEIPT', operationKey, createdAt: at, actor,
        detail: 'A local sandbox record represents one test effect. No payment, legal, physical, supplier or other external action was sent.' } };
    const transaction = { ...core, evidenceHash: digest(core) };
    project.sandboxTransactions ??= []; project.sandboxTransactions.push(transaction);
    project.audit ??= []; project.audit.push({ at, action: 'enterprise.sandbox-transaction-recorded', actor,
      detail: `Approved and recorded one local sandbox procurement test effect for “${process.name}”; no external provider was called.`,
      operationId, operationKey, evidenceHash: transaction.evidenceHash });
    return { blueprint: current, affectedObjectId: process.id, sandboxTransaction: structuredClone(transaction), idempotent: false };
  }
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
