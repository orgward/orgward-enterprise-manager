import { randomUUID } from 'node:crypto';
import { buildRelations, latestBlueprint, validateBlueprint } from '../model.mjs';
import { digest } from '../sdlc/contracts.mjs';
import { blueprintObjects, enterpriseFailure, enterpriseText } from './types.mjs';
import { appendEnterpriseBranchDesign } from './branches.mjs';
import { projectEnterprise } from './projections.mjs';
import { normalizeDecisionTable, normalizeProcessFlow } from './process-model.mjs';
import { normalizeStaffingScenario, simulateProcessFlow, simulateStaffingCapacity } from './process-simulation.mjs';
import { createLocalSandboxTestAdapter, LOCAL_SANDBOX_ADAPTER_ID, normalizeSandboxEffectResponse, SANDBOX_EFFECT_CONTRACT } from './sandbox-adapter-contract.mjs';

export const ENTERPRISE_PROCESS_KINDS = new Set(['define-process-flow', 'define-decision-table', 'simulate-process', 'simulate-staffing',
  'run-sandbox-procurement-test', 'dispatch-sandbox-procurement-test', 'reconcile-sandbox-procurement-test', 'compensate-sandbox-procurement-test']);
const fail = (code, message, status = 400) => { throw enterpriseFailure(code, message, status); };
const safeId = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,119}$/i.test(value);
function sandboxGroup(process, step, source) {
  const steps = process.processFlow?.steps ?? [];
  const previous = steps.find((entry) => entry.kind === 'sandbox-procurement' && entry.nextStepId === step.id);
  const next = steps.find((entry) => entry.id === step.nextStepId && entry.kind === 'sandbox-procurement');
  if (previous && next) return null;
  if (previous && steps.some((entry) => entry.kind === 'sandbox-procurement' && entry.nextStepId === previous.id)) return null;
  if (next && steps.some((entry) => entry.kind === 'sandbox-procurement' && entry.id === next.nextStepId)) return null;
  const first = previous ?? step; const second = previous ? step : next;
  if (!second) return null;
  const id = `sandbox-group-${digest({ blueprintHash: source.blueprintHash, processId: process.id,
    firstStepId: first.id, secondStepId: second.id }).slice(0, 24)}`;
  return { id, sequence: step.id === first.id ? 1 : 2, total: 2, stepIds: [first.id, second.id] };
}
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
  } else if (['dispatch-sandbox-procurement-test', 'reconcile-sandbox-procurement-test', 'compensate-sandbox-procurement-test'].includes(input.kind)) {
    allowed.push('operationId');
    if (typeof input.operationId !== 'string' || !/^sandbox-transaction-[0-9a-f-]{36}$/.test(input.operationId)) {
      fail('Choose an exact saved sandbox operation for dispatch, reconciliation or compensation.', 'INVALID_ENTERPRISE_PROCESS_COMMAND');
    }
    command.operationId = input.operationId;
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
export function applyEnterpriseProcessCommand(project, command, actor, options = {}) {
  const at = new Date().toISOString(); const current = latestBlueprint(project);
  if (!current) fail('BLUEPRINT_NOT_FOUND', 'Save the initial blueprint first.', 409);
  if (command.kind === 'reconcile-sandbox-procurement-test') {
    const existing = (project.sandboxTransactions ?? []).find((entry) => entry.operationId === command.operationId);
    if (!existing) fail('SANDBOX_TRANSACTION_NOT_FOUND', 'The saved sandbox operation is unavailable; reload the project and try again.', 404);
    if (!['UNKNOWN_EFFECT', 'APPROVED_PENDING'].includes(existing.status)) fail('SANDBOX_RECONCILIATION_NOT_REQUIRED', 'Only an unconfirmed sandbox operation can be reconciled.', 409);
    const adapter = options.sandboxEffectAdapter ?? createLocalSandboxTestAdapter();
    if (typeof adapter.reconcile !== 'function') fail('SANDBOX_RECONCILIATION_UNAVAILABLE', 'The configured sandbox adapter cannot reconcile by provider key.', 503);
    const response = adapter.reconcile(existing.providerKey);
    const transaction = structuredClone(existing);
    if (response) {
      const normalized = normalizeSandboxEffectResponse(response, existing.adapterRequest);
      if (normalized.result.operationId !== existing.operationId || normalized.providerKey !== existing.providerKey) {
        fail('SANDBOX_RECONCILIATION_MISMATCH', 'The adapter result does not match this saved operation and provider key.', 409);
      }
      transaction.status = normalized.outcome;
      transaction.effect = { result: normalized.result.status, externalProviderCalled: normalized.externalProviderCalled,
        adapterResponse: normalized };
      transaction.reconciliation = { state: 'RECONCILED_ACCEPTED', actor, at, providerKey: existing.providerKey,
        outcome: normalized.outcome, detail: 'The existing operation was found by provider key; no second dispatch occurred.' };
      transaction.evidence = { ...transaction.evidence, kind: 'SANDBOX_OPERATION_RECEIPT',
        detail: 'The existing local sandbox operation was reconciled by provider key. No second dispatch or external provider call occurred.' };
    } else {
      transaction.reconciliation = { state: existing.status === 'UNKNOWN_EFFECT' ? 'STILL_UNKNOWN' : 'NOT_FOUND', actor, at,
        providerKey: existing.providerKey, outcome: 'UNKNOWN', detail: existing.status === 'UNKNOWN_EFFECT'
          ? 'No operation was found by provider key. Do not replay or compensate; retry reconciliation.'
          : 'No accepted operation was found by provider key. The approved request remains pending and may be dispatched.' };
    }
    const { evidenceHash: _priorHash, ...core } = transaction;
    const updated = { ...core, evidenceHash: digest(core) };
    project.sandboxTransactions = (project.sandboxTransactions ?? []).map((entry) => entry.operationId === existing.operationId ? updated : entry);
    project.audit ??= []; project.audit.push({ at, action: response ? 'enterprise.sandbox-transaction-reconciled' : 'enterprise.sandbox-transaction-reconciliation-unknown',
      actor, operationId: existing.operationId, providerKey: existing.providerKey, outcome: updated.reconciliation.state,
      evidenceHash: updated.evidenceHash });
    return { blueprint: current, affectedObjectId: existing.source.processId, sandboxTransaction: structuredClone(updated), idempotent: false };
  }
  if (command.kind === 'compensate-sandbox-procurement-test') {
    const original = (project.sandboxTransactions ?? []).find((entry) => entry.operationId === command.operationId);
    if (!original) fail('SANDBOX_TRANSACTION_NOT_FOUND', 'The completed sandbox operation is unavailable; reload the project and try again.', 404);
    if (original.status !== 'RECORDED_IN_SANDBOX' || !original.compensable || !original.group?.id) {
      fail('SANDBOX_COMPENSATION_UNAVAILABLE', 'Compensation requires a completed step that explicitly declares local reversibility.', 409);
    }
    const operationKey = digest({ projectId: project.id, groupId: original.group.id, compensatesOperationId: original.operationId,
      source: original.source, kind: 'PROCUREMENT_TEST_COMPENSATION' });
    const existing = (project.sandboxTransactions ?? []).find((entry) => entry.operationKey === operationKey);
    if (existing) return { blueprint: current, affectedObjectId: original.source.processId,
      sandboxTransaction: structuredClone(existing), idempotent: true };
    const group = (project.sandboxTransactions ?? []).filter((entry) => entry.group?.id === original.group.id);
    const peer = group.find((entry) => entry.operationId !== original.operationId);
    if (!peer || peer.status !== 'FAILED_IN_SANDBOX') {
      fail('SANDBOX_COMPENSATION_NOT_REQUIRED', 'Compensation is available only after the paired step has a known partial failure.', 409);
    }
    if (group.some((entry) => ['APPROVED_PENDING', 'UNKNOWN_EFFECT'].includes(entry.status))) {
      fail('SANDBOX_EFFECT_RECONCILIATION_REQUIRED', 'Resolve every pending or unknown group outcome before authorizing compensation.', 409);
    }
    const operationId = `sandbox-transaction-${randomUUID()}`; const providerKey = `orgward-local-sandbox:${operationKey}`;
    const request = { ...structuredClone(original.adapterRequest), operationId, operationKey, providerKey,
      kind: 'PROCUREMENT_TEST_COMPENSATION', compensatesOperationId: original.operationId,
      approval: { ...structuredClone(original.adapterRequest.approval), actor, at, decision: 'APPROVED' } };
    const core = { operationId, operationKey, providerKey, contract: SANDBOX_EFFECT_CONTRACT, contractVersion: '1.0',
      mode: 'LOCAL_TEST_ONLY', adapterId: LOCAL_SANDBOX_ADAPTER_ID, kind: 'PROCUREMENT_TEST_COMPENSATION',
      status: 'APPROVED_PENDING', sandbox: true, group: structuredClone(original.group), compensatesOperationId: original.operationId,
      compensable: false, adapterRequest: request, source: structuredClone(original.source),
      label: `Sandbox compensation · ${original.label}`, commitment: structuredClone(original.commitment),
      capacity: structuredClone(original.capacity), approval: { decision: 'APPROVED', actor, at,
        authority: 'HUMAN_PROJECT_OWNER', approved: { kind: 'PROCUREMENT_TEST_COMPENSATION', compensatesOperationId: original.operationId,
          groupId: original.group.id } }, effect: { result: 'NOT_DISPATCHED', externalProviderCalled: false, adapterResponse: null },
      evidence: { kind: 'SANDBOX_COMPENSATION_APPROVAL', operationKey, createdAt: at, actor,
        detail: `Separate owner-approved local compensation for ${original.operationId}; original result is preserved and no external provider was called.` } };
    const transaction = { ...core, evidenceHash: digest(core) }; project.sandboxTransactions.push(transaction);
    project.audit ??= []; project.audit.push({ at, action: 'enterprise.sandbox-compensation-approved', actor,
      operationId, compensatesOperationId: original.operationId, providerKey, evidenceHash: transaction.evidenceHash });
    return { blueprint: current, affectedObjectId: original.source.processId, sandboxTransaction: structuredClone(transaction), idempotent: false };
  }
  if (command.kind === 'dispatch-sandbox-procurement-test') {
    const existing = (project.sandboxTransactions ?? []).find((entry) => entry.operationId === command.operationId);
    if (!existing) fail('SANDBOX_TRANSACTION_NOT_FOUND', 'The approved sandbox operation is unavailable; reload the project and try again.', 404);
    if (existing.status === 'UNKNOWN_EFFECT') {
      fail('SANDBOX_EFFECT_RECONCILIATION_REQUIRED', 'The previous attempt has an unknown outcome. Reconcile its stable provider key before retrying or considering compensation.', 409);
    }
    if (existing.status !== 'APPROVED_PENDING') return { blueprint: current, affectedObjectId: existing.source.processId,
      sandboxTransaction: structuredClone(existing), idempotent: true };
    if (existing.group?.sequence === 2) {
      const first = (project.sandboxTransactions ?? []).find((entry) => entry.group?.id === existing.group.id && entry.group.sequence === 1);
      if (!first || first.status !== 'RECORDED_IN_SANDBOX') fail('SANDBOX_GROUP_PREDECESSOR_INCOMPLETE', 'The second step cannot dispatch until the first step is recorded as successful.', 409);
    }
    if (current.id !== existing.source.blueprintId || current.version !== existing.source.blueprintVersion
      || digest(current) !== existing.source.blueprintHash) {
      fail('SANDBOX_TRANSACTION_SOURCE_STALE', 'The approved source changed before dispatch. Review the current design and approve a new request.', 409);
    }
    const adapter = options.sandboxEffectAdapter ?? createLocalSandboxTestAdapter();
    if (typeof adapter.reconcile !== 'function' || typeof adapter.dispatch !== 'function') {
      fail('SANDBOX_ADAPTER_UNAVAILABLE', 'The approved sandbox adapter cannot dispatch and reconcile by provider key.', 503);
    }
    // Check first so a crash after acceptance cannot cause a second effect when dispatch resumes.
    const accepted = adapter.reconcile(existing.providerKey);
    let adapterResponse = accepted ? normalizeSandboxEffectResponse(accepted, existing.adapterRequest) : null;
    let status = adapterResponse?.outcome ?? 'UNKNOWN_EFFECT'; let timedOut = false;
    if (!adapterResponse) {
      try {
        adapterResponse = normalizeSandboxEffectResponse(adapter.dispatch(existing.adapterRequest), existing.adapterRequest);
        status = adapterResponse.outcome;
      } catch (error) {
        if (error?.code !== 'SANDBOX_ADAPTER_TIMEOUT_AFTER_ACCEPTANCE') throw error;
        timedOut = true; status = 'UNKNOWN_EFFECT';
      }
    }
    const transaction = structuredClone(existing); transaction.status = status;
    if (adapterResponse) {
      transaction.effect = { result: adapterResponse.result.status, externalProviderCalled: adapterResponse.externalProviderCalled,
        adapterResponse: structuredClone(adapterResponse) };
      transaction.evidence = { ...transaction.evidence, kind: 'SANDBOX_OPERATION_RECEIPT',
        detail: 'The local test adapter returned a normalized sandbox receipt. No external provider was called.' };
    } else {
      transaction.effect = { result: 'UNKNOWN_EFFECT', externalProviderCalled: false, adapterResponse: null,
        reconciliationRequired: true, detail: 'The local harness accepted the operation but simulated a lost response.' };
      transaction.adapterAttempt = { state: 'ACCEPTED_RESPONSE_TIMEOUT', at, providerKey: existing.providerKey };
      transaction.evidence = { ...transaction.evidence, kind: 'SANDBOX_OPERATION_OUTCOME_UNKNOWN',
        detail: 'The local harness accepted the request then simulated a lost response. Reconcile by provider key before retry; no external provider was called.' };
    }
    if (accepted) transaction.reconciliation = { state: 'RECONCILED_ACCEPTED', actor, at, providerKey: existing.providerKey,
      outcome: adapterResponse.outcome, detail: 'The existing operation was found before dispatch; no second effect was sent.' };
    const { evidenceHash: _priorHash, ...core } = transaction; const updated = { ...core, evidenceHash: digest(core) };
    project.sandboxTransactions = (project.sandboxTransactions ?? []).map((entry) => entry.operationId === existing.operationId ? updated : entry);
    project.audit ??= []; project.audit.push({ at, action: timedOut ? 'enterprise.sandbox-transaction-outcome-unknown' : 'enterprise.sandbox-transaction-dispatched',
      actor, operationId: existing.operationId, providerKey: existing.providerKey, outcome: updated.status, evidenceHash: updated.evidenceHash });
    return { blueprint: current, affectedObjectId: existing.source.processId, sandboxTransaction: structuredClone(updated), idempotent: false };
  }
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
    const source = { projectId: project.id, blueprintId: current.id, blueprintVersion: current.version,
      blueprintHash, processId: process.id, stepId: step.id, resourceId: resource.id, windowId: window.id, allocationId: allocation.id };
    const group = sandboxGroup(process, step, { blueprintHash });
    if (group?.sequence === 2) {
      const first = (project.sandboxTransactions ?? []).find((entry) => entry.group?.id === group.id && entry.group.sequence === 1);
      if (!first || first.status !== 'RECORDED_IN_SANDBOX') fail('SANDBOX_GROUP_PREDECESSOR_INCOMPLETE', 'Approve the second step only after the first step is recorded as successful.', 409);
    }
    const operationKey = digest({ projectId: project.id, blueprintId: current.id, blueprintVersion: current.version,
      blueprintHash, processId: process.id, stepId: step.id, resourceId: resource.id, windowId: window.id, allocationId: allocation.id });
    const existing = (project.sandboxTransactions ?? []).find((entry) => entry.operationKey === operationKey);
    if (existing?.status === 'UNKNOWN_EFFECT') {
      fail('SANDBOX_EFFECT_RECONCILIATION_REQUIRED', 'The previous attempt has an unknown outcome. Reconcile its stable provider key before retrying or considering compensation.', 409);
    }
    if (existing) return { blueprint: current, affectedObjectId: process.id, sandboxTransaction: structuredClone(existing), idempotent: true };
    const operationId = `sandbox-transaction-${randomUUID()}`;
    const providerKey = `orgward-local-sandbox:${operationKey}`;
    const request = { contract: SANDBOX_EFFECT_CONTRACT, schemaVersion: '1.0', adapterId: LOCAL_SANDBOX_ADAPTER_ID,
      mode: 'LOCAL_TEST_ONLY', operationId, operationKey, providerKey, kind: 'PROCUREMENT_TEST_EFFECT',
      compensatesOperationId: null, source,
      approval: { decision: 'APPROVED', actor, at, authority: 'HUMAN_PROJECT_OWNER',
        quantity: { value: quantity.value, unit: quantity.unit }, capacity: { value: available.value, unit: available.unit } } };
    const core = { operationId, operationKey, providerKey,
      contract: SANDBOX_EFFECT_CONTRACT, contractVersion: '1.0', mode: 'LOCAL_TEST_ONLY',
      adapterId: LOCAL_SANDBOX_ADAPTER_ID, kind: 'PROCUREMENT_TEST_EFFECT', status: 'APPROVED_PENDING', sandbox: true, adapterRequest: request,
      group, compensable: step.compensable === true,
      label: `Sandbox test effect · ${step.title}`, source: { projectId: project.id, blueprintId: current.id, blueprintVersion: current.version,
        blueprintHash, processId: process.id, stepId: step.id, resourceId: resource.id, windowId: window.id, allocationId: allocation.id },
      commitment: { state: allocation.state, quantity: structuredClone(quantity), source: 'saved owner-reviewed design declaration' },
      capacity: { available: structuredClone(available), total: structuredClone(capacity), source: 'saved owner-reviewed design declaration' },
      approval: { decision: 'APPROVED', actor, at, authority: 'HUMAN_PROJECT_OWNER',
        approved: { kind: 'PROCUREMENT_TEST_EFFECT', stepId: step.id, resourceId: resource.id, windowId: window.id,
          allocationId: allocation.id, quantity: structuredClone(quantity), capacity: structuredClone(available) } },
      effect: { result: 'NOT_DISPATCHED', externalProviderCalled: false, adapterResponse: null },
      evidence: { kind: 'SANDBOX_APPROVAL_REQUEST', operationKey, createdAt: at, actor,
        detail: 'Owner approval and the exact versioned request are saved before dispatch. No external provider has been called.' } };
    const transaction = { ...core, evidenceHash: digest(core) };
    project.sandboxTransactions ??= []; project.sandboxTransactions.push(transaction);
    project.audit ??= []; project.audit.push({ at, action: 'enterprise.sandbox-transaction-approved', actor,
      detail: `Approved one local sandbox procurement test effect for “${process.name}”; no dispatch has occurred.`,
      operationId, operationKey, providerKey, evidenceHash: transaction.evidenceHash });
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
