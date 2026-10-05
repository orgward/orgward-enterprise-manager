import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalSandboxTestAdapter, LOCAL_SANDBOX_ADAPTER_ID,
  normalizeSandboxEffectRequest, normalizeSandboxEffectResponse, SANDBOX_EFFECT_CONTRACT } from '../../src/enterprise/sandbox-adapter-contract.mjs';

const request = () => ({ contract: SANDBOX_EFFECT_CONTRACT, schemaVersion: '1.0', adapterId: LOCAL_SANDBOX_ADAPTER_ID,
  mode: 'LOCAL_TEST_ONLY', operationId: 'sandbox-transaction-00000000-0000-4000-8000-000000000001', operationKey: 'a'.repeat(64),
  kind: 'PROCUREMENT_TEST_EFFECT', source: { projectId: 'project-1', blueprintId: 'blueprint-00000000-0000-4000-8000-000000000001',
    blueprintVersion: 2, blueprintHash: 'b'.repeat(64), processId: 'process-deliver', stepId: 'procure', resourceId: 'resource-capacity',
    windowId: 'window-delivery', allocationId: 'allocation-delivery' },
  approval: { decision: 'APPROVED', actor: 'oidc:owner', at: '2026-10-05T12:00:00.000Z', authority: 'HUMAN_PROJECT_OWNER',
    quantity: { value: 12, unit: 'hours' }, capacity: { value: 40, unit: 'hours' } } });

test('local sandbox adapter conforms to the versioned request/response and reports test-only outcome', () => {
  const normalizedRequest = normalizeSandboxEffectRequest(request());
  const response = createLocalSandboxTestAdapter().dispatch(normalizedRequest);
  assert.equal(response.contract, SANDBOX_EFFECT_CONTRACT);
  assert.equal(response.adapterId, LOCAL_SANDBOX_ADAPTER_ID);
  assert.equal(response.mode, 'LOCAL_TEST_ONLY');
  assert.equal(response.outcome, 'RECORDED_IN_SANDBOX');
  assert.equal(response.externalProviderCalled, false);
  assert.equal(response.idempotent, false);
  assert.equal(normalizeSandboxEffectResponse(response, normalizedRequest).result.operationId, normalizedRequest.operationId);
});

test('sandbox adapter rejects malformed requests and malformed, mismatched or externally-effectful responses', () => {
  const adapter = createLocalSandboxTestAdapter(); const valid = request();
  assert.throws(() => normalizeSandboxEffectRequest({ ...valid, mode: 'LIVE' }), { code: 'INVALID_SANDBOX_EFFECT_REQUEST' });
  assert.throws(() => normalizeSandboxEffectRequest({ ...valid, approval: { ...valid.approval,
    quantity: { value: 42, unit: 'hours' } } }), { code: 'INVALID_SANDBOX_EFFECT_REQUEST' });
  const response = adapter.dispatch(valid);
  for (const invalid of [
    { ...response, result: null },
    { ...response, operationKey: 'c'.repeat(64) },
    { ...response, externalProviderCalled: true },
  ]) {
    assert.throws(() => normalizeSandboxEffectResponse(invalid, valid), { code: 'INVALID_SANDBOX_EFFECT_RESPONSE' });
  }
});

test('sandbox adapter replays an identical operation key and rejects reuse for different request content', () => {
  const adapter = createLocalSandboxTestAdapter(); const original = request();
  const first = adapter.dispatch(original); const replay = adapter.dispatch(original);
  assert.equal(first.idempotent, false); assert.equal(replay.idempotent, true);
  assert.equal(replay.operationKey, first.operationKey); assert.deepEqual(replay.result, first.result);
  const changed = { ...original, operationId: 'sandbox-transaction-00000000-0000-4000-8000-000000000002' };
  assert.throws(() => adapter.dispatch(changed), { code: 'SANDBOX_IDEMPOTENCY_CONFLICT' });
});
