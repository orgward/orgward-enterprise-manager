import assert from 'node:assert/strict';
import test from 'node:test';
import { clearPendingSoftwareStart, createSoftwareStartFlightGuard, pendingSoftwareStartKey, softwareStartIntentKey } from '../../public/software-runtime-start.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('served client start intent reuses its pending key across reloads and retries, then allows a fresh confirmed start', () => {
  const storage = memoryStorage();
  const scope = { tenantId: 'tenant-a', sessionId: 'session-1', projectId: 'project-1', caseId: 'case-1', planId: 'plan-1', revision: 3 };
  let minted = 0;
  const mint = () => `software-runtime-instance-${++minted}`;
  const firstClick = pendingSoftwareStartKey(storage, scope, mint);
  const afterReload = pendingSoftwareStartKey(storage, scope, mint);
  assert.equal(afterReload.idempotencyKey, firstClick.idempotencyKey, 'ambiguous retry/reload retains the same idempotency key');
  assert.equal(minted, 1);
  clearPendingSoftwareStart(storage, firstClick.storageKey);
  const explicitlyFreshStart = pendingSoftwareStartKey(storage, scope, mint);
  assert.equal(explicitlyFreshStart.idempotencyKey, 'software-runtime-instance-2');
  assert.notEqual(explicitlyFreshStart.storageKey, softwareStartIntentKey({ ...scope, revision: 4 }));
});

test('served client guard rejects duplicate in-flight start submissions', () => {
  const guard = createSoftwareStartFlightGuard();
  assert.equal(guard.begin('same-intent'), true);
  assert.equal(guard.begin('same-intent'), false);
  guard.end('same-intent');
  assert.equal(guard.begin('same-intent'), true);
});
