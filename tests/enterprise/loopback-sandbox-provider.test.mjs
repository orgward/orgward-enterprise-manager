import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalSandboxProviderService } from '../../src/enterprise/local-sandbox-provider-service.mjs';
import { createLoopbackSandboxHttpAdapter } from '../../src/enterprise/loopback-sandbox-http-adapter.mjs';
import { LOOPBACK_SANDBOX_ADAPTER_ID, normalizeSandboxEffectRequest, normalizeSandboxEffectResponse,
  SANDBOX_EFFECT_CONTRACT } from '../../src/enterprise/sandbox-adapter-contract.mjs';

const request = () => ({ contract: SANDBOX_EFFECT_CONTRACT, schemaVersion: '1.0', adapterId: LOOPBACK_SANDBOX_ADAPTER_ID,
  mode: 'LOCAL_TEST_ONLY', operationId: 'sandbox-transaction-00000000-0000-4000-8000-000000000001', operationKey: 'a'.repeat(64),
  providerKey: `orgward-local-sandbox:${'a'.repeat(64)}`, kind: 'PROCUREMENT_TEST_EFFECT', compensatesOperationId: null,
  source: { projectId: 'project-1', blueprintId: 'blueprint-00000000-0000-4000-8000-000000000001', blueprintVersion: 2,
    blueprintHash: 'b'.repeat(64), processId: 'process-deliver', stepId: 'procure', resourceId: 'resource-capacity', windowId: 'window-delivery', allocationId: 'allocation-delivery' },
  approval: { decision: 'APPROVED', actor: 'oidc:owner', at: '2026-10-05T12:00:00.000Z', authority: 'HUMAN_PROJECT_OWNER',
    quantity: { value: 12, unit: 'hours' }, capacity: { value: 40, unit: 'hours' } } });
const token = 'local-sandbox-test-token-'.padEnd(64, 'x');

test('loopback provider persists a keyed test-effect receipt and reconciles it after service restart', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orgward-loopback-provider-'));
  const storePath = path.join(root, 'provider.json'); const normalized = normalizeSandboxEffectRequest(request());
  let service;
  try {
    service = await createLocalSandboxProviderService({ storePath, token, now: () => '2026-10-05T12:01:00.000Z' });
    let adapter = createLoopbackSandboxHttpAdapter({ baseUrl: service.url, token });
    const unauthenticated = await fetch(`${service.url}/v1/effects/reconcile`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ providerKey: normalized.providerKey }) });
    assert.equal(unauthenticated.status, 401);
    const first = await adapter.dispatch(normalized);
    assert.equal(first.externalProviderCalled, false); assert.equal(first.externalServiceCalled, true);
    assert.equal(first.result.providerEvidence.providerKey, normalized.providerKey);
    assert.equal(first.result.providerEvidence.requestHash.length, 64);
    assert.equal(normalizeSandboxEffectResponse(first, normalized).result.providerEvidence.receiptId, first.result.providerEvidence.receiptId);
    const replay = await adapter.dispatch(normalized);
    assert.equal(replay.idempotent, true); assert.equal(replay.result.providerEvidence.receiptId, first.result.providerEvidence.receiptId);
    await assert.rejects(() => adapter.dispatch({ ...normalized, operationId: 'sandbox-transaction-00000000-0000-4000-8000-000000000002' }),
      { code: 'SANDBOX_IDEMPOTENCY_CONFLICT' });
    await service.close(); service = null;

    service = await createLocalSandboxProviderService({ storePath, token, now: () => '2026-10-05T12:02:00.000Z' });
    adapter = createLoopbackSandboxHttpAdapter({ baseUrl: service.url, token });
    const reconciled = await adapter.reconcile(normalized.providerKey);
    assert.equal(reconciled.idempotent, true);
    assert.equal(reconciled.result.providerEvidence.receiptId, first.result.providerEvidence.receiptId);
    assert.equal(await adapter.reconcile(`orgward-local-sandbox:${'c'.repeat(64)}`), null);
  } finally {
    await service?.close(); await rm(root, { recursive: true, force: true });
  }
});

test('configured sandbox HTTP adapter refuses non-loopback and non-HTTP endpoints', () => {
  for (const baseUrl of ['https://127.0.0.1:7310', 'http://example.com', 'http://localhost:7310', 'http://127.0.0.1:7310/path']) {
    assert.throws(() => createLoopbackSandboxHttpAdapter({ baseUrl }), /only a plain HTTP IPv4-loopback origin/);
  }
  assert.throws(() => createLoopbackSandboxHttpAdapter({ baseUrl: 'http://127.0.0.1:7310', token: 'short' }), /token of at least 32 characters/);
});

test('loopback dispatch transport loss is marked unknown for stable-key reconciliation', async () => {
  const adapter = createLoopbackSandboxHttpAdapter({ baseUrl: 'http://127.0.0.1:7310', token,
    fetchImpl: async () => { throw new Error('simulated response loss after request send'); } });
  await assert.rejects(() => adapter.dispatch(normalizeSandboxEffectRequest(request())),
    { code: 'SANDBOX_ADAPTER_TIMEOUT_AFTER_ACCEPTANCE' });
});
