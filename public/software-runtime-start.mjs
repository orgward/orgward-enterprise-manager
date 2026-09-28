export function softwareStartIntentKey({ tenantId = '', sessionId = '', principal = '', projectId, caseId, planId, revision }) {
  return `orgward:software-start:${JSON.stringify([tenantId, sessionId || principal, projectId, caseId, planId, revision])}`;
}

export function pendingSoftwareStartKey(storage, scope, createKey) {
  const storageKey = softwareStartIntentKey(scope);
  let key = storage.getItem(storageKey);
  if (!key) {
    key = createKey();
    storage.setItem(storageKey, key);
  }
  return { storageKey, idempotencyKey: key };
}

export function clearPendingSoftwareStart(storage, storageKey) {
  storage.removeItem(storageKey);
}

export function createSoftwareStartFlightGuard() {
  const active = new Set();
  return {
    begin(key) {
      if (active.has(key)) return false;
      active.add(key);
      return true;
    },
    end(key) { active.delete(key); },
  };
}
