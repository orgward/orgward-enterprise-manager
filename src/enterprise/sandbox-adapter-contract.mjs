import { digest } from '../sdlc/contracts.mjs';

export const SANDBOX_EFFECT_CONTRACT = 'orgward.sandbox-effect/v1';
export const LOCAL_SANDBOX_ADAPTER_ID = 'orgward.local-sandbox.procurement-test/v1';
export const LOOPBACK_SANDBOX_ADAPTER_ID = 'orgward.loopback-sandbox.procurement-test/v1';

const fail = (code, message, statusCode = 400) => { throw Object.assign(new Error(message), { code, statusCode }); };
const exactKeys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...expected].sort().join(',');

export function normalizeSandboxEffectRequest(input) {
  const fields = ['contract', 'schemaVersion', 'adapterId', 'mode', 'operationId', 'operationKey', 'providerKey', 'kind',
    'compensatesOperationId', 'source', 'approval'];
  if (!exactKeys(input, fields) || input.contract !== SANDBOX_EFFECT_CONTRACT || input.schemaVersion !== '1.0'
    || ![LOCAL_SANDBOX_ADAPTER_ID, LOOPBACK_SANDBOX_ADAPTER_ID].includes(input.adapterId) || input.mode !== 'LOCAL_TEST_ONLY'
    || typeof input.operationId !== 'string' || !/^sandbox-transaction-[0-9a-f-]{36}$/.test(input.operationId)
    || typeof input.operationKey !== 'string' || !/^[a-f0-9]{64}$/.test(input.operationKey)
    || input.providerKey !== `orgward-local-sandbox:${input.operationKey}`
    || !['PROCUREMENT_TEST_EFFECT', 'PROCUREMENT_TEST_COMPENSATION'].includes(input.kind)
    || (input.kind === 'PROCUREMENT_TEST_EFFECT' && input.compensatesOperationId !== null)
    || (input.kind === 'PROCUREMENT_TEST_COMPENSATION' && (typeof input.compensatesOperationId !== 'string'
      || !/^sandbox-transaction-[0-9a-f-]{36}$/.test(input.compensatesOperationId)))
    || !exactKeys(input.source,
      ['projectId', 'blueprintId', 'blueprintVersion', 'blueprintHash', 'processId', 'stepId', 'resourceId', 'windowId', 'allocationId'])
    || !exactKeys(input.approval, ['decision', 'actor', 'at', 'authority', 'quantity', 'capacity'])
    || input.approval.decision !== 'APPROVED' || input.approval.authority !== 'HUMAN_PROJECT_OWNER'
    || typeof input.approval.actor !== 'string' || typeof input.approval.at !== 'string') {
    fail('INVALID_SANDBOX_EFFECT_REQUEST', 'Use the version 1.0 local sandbox effect request with exact source and owner approval.');
  }
  for (const field of ['projectId', 'blueprintId', 'blueprintHash', 'processId', 'stepId', 'resourceId', 'windowId', 'allocationId']) {
    if (typeof input.source[field] !== 'string' || !input.source[field]) fail('INVALID_SANDBOX_EFFECT_REQUEST', `The source ${field} is required.`);
  }
  if (!Number.isSafeInteger(input.source.blueprintVersion) || input.source.blueprintVersion < 1) {
    fail('INVALID_SANDBOX_EFFECT_REQUEST', 'The source blueprint version must be a positive integer.');
  }
  const quantity = input.approval.quantity; const capacity = input.approval.capacity;
  if (!exactKeys(quantity, ['value', 'unit']) || !Number.isSafeInteger(quantity.value) || quantity.value <= 0
    || typeof quantity.unit !== 'string' || !quantity.unit || !exactKeys(capacity, ['value', 'unit'])
    || !Number.isSafeInteger(capacity.value) || capacity.value < quantity.value || capacity.unit !== quantity.unit) {
    fail('INVALID_SANDBOX_EFFECT_REQUEST', 'The approved allocation and capacity must be positive, sufficient and use matching units.');
  }
  return structuredClone(input);
}

export function normalizeSandboxEffectResponse(input, request) {
  const fields = ['contract', 'schemaVersion', 'adapterId', 'mode', 'operationKey', 'providerKey', 'outcome', 'externalProviderCalled', 'externalServiceCalled', 'result', 'idempotent'];
  if (!exactKeys(input, fields) || input.contract !== SANDBOX_EFFECT_CONTRACT || input.schemaVersion !== '1.0'
    || input.adapterId !== request.adapterId || input.mode !== 'LOCAL_TEST_ONLY'
    || input.operationKey !== request.operationKey || input.providerKey !== request.providerKey
    || !({ PROCUREMENT_TEST_EFFECT: ['RECORDED_IN_SANDBOX', 'FAILED_IN_SANDBOX'],
      PROCUREMENT_TEST_COMPENSATION: ['COMPENSATED_IN_SANDBOX'] }[request.kind] ?? []).includes(input.outcome)
    || input.externalProviderCalled !== false || typeof input.idempotent !== 'boolean'
    || typeof input.externalServiceCalled !== 'boolean'
    || !exactKeys(input.result, ['operationId', 'status', 'detail', 'providerEvidence']) || input.result.operationId !== request.operationId
    || input.result.status !== input.outcome || typeof input.result.detail !== 'string' || !input.result.detail
    || (request.adapterId === LOCAL_SANDBOX_ADAPTER_ID && (input.externalServiceCalled || input.result.providerEvidence !== null))
    || (request.adapterId === LOOPBACK_SANDBOX_ADAPTER_ID && (!input.externalServiceCalled
      || !validProviderEvidence(input.result.providerEvidence, request, input.outcome)))) {
    fail('INVALID_SANDBOX_EFFECT_RESPONSE', 'The local sandbox adapter returned an invalid or externally effectful response.');
  }
  return structuredClone(input);
}

function validProviderEvidence(evidence, request, outcome) {
  if (!exactKeys(evidence, ['serviceId', 'receiptId', 'providerKey', 'requestHash', 'outcome', 'recordedAt', 'evidenceHash'])
    || evidence.serviceId !== 'orgward.sandbox-provider.local/v1' || evidence.providerKey !== request.providerKey
    || evidence.requestHash !== digest(request) || evidence.outcome !== outcome || typeof evidence.receiptId !== 'string'
    || typeof evidence.recordedAt !== 'string' || typeof evidence.evidenceHash !== 'string') return false;
  const { evidenceHash, ...core } = evidence;
  return evidenceHash === digest(core);
}

/**
 * Internal deterministic harness adapter. It is intentionally not a provider
 * registry entry: it cannot contact a connector and only returns a local test
 * receipt. Production connector support requires a separate configured adapter.
 */
export function createLocalSandboxTestAdapter({ acceptedThenTimeoutOnce = false, failStepIds = [] } = {}) {
  const results = new Map();
  let faultConsumed = false; let dispatchCount = 0; let effectCount = 0; let reconciliationCount = 0;
  return Object.freeze({
    id: LOCAL_SANDBOX_ADAPTER_ID,
    dispatch(input) {
      dispatchCount += 1;
      const request = normalizeSandboxEffectRequest(input);
      const requestHash = digest(request);
      const prior = results.get(request.providerKey);
      if (prior) {
        if (prior.requestHash !== requestHash) fail('SANDBOX_IDEMPOTENCY_CONFLICT', 'The operation key is already bound to a different sandbox request.');
        return normalizeSandboxEffectResponse({ ...prior.response, idempotent: true }, request);
      }
      const outcome = request.kind === 'PROCUREMENT_TEST_COMPENSATION' ? 'COMPENSATED_IN_SANDBOX'
        : failStepIds.includes(request.source.stepId) ? 'FAILED_IN_SANDBOX' : 'RECORDED_IN_SANDBOX';
      const response = normalizeSandboxEffectResponse({ contract: SANDBOX_EFFECT_CONTRACT, schemaVersion: '1.0',
        adapterId: LOCAL_SANDBOX_ADAPTER_ID, mode: 'LOCAL_TEST_ONLY', operationKey: request.operationKey,
        providerKey: request.providerKey, outcome, externalProviderCalled: false, idempotent: false,
        externalServiceCalled: false,
        result: { operationId: request.operationId, status: outcome, providerEvidence: null, detail: outcome === 'FAILED_IN_SANDBOX'
          ? 'Local deterministic harness failure; no external provider was called.'
          : outcome === 'COMPENSATED_IN_SANDBOX' ? 'Separate local compensation test receipt; original operation remains recorded.'
            : 'Local deterministic test receipt; no external provider was called.' } }, request);
      results.set(request.providerKey, { requestHash, request, response });
      if (outcome !== 'FAILED_IN_SANDBOX') effectCount += 1;
      if (acceptedThenTimeoutOnce && !faultConsumed) {
        faultConsumed = true;
        fail('SANDBOX_ADAPTER_TIMEOUT_AFTER_ACCEPTANCE', 'The local harness accepted the operation but simulated a lost response.', 504);
      }
      return response;
    },
    reconcile(providerKey) {
      reconciliationCount += 1;
      const prior = results.get(providerKey);
      return prior ? normalizeSandboxEffectResponse({ ...prior.response, idempotent: true }, prior.request) : null;
    },
    get metrics() { return Object.freeze({ dispatchCount, effectCount, reconciliationCount }); },
  });
}
