export function savedTaskResultDisclosureKey(projectId, runId) {
  if (typeof projectId !== 'string' || !projectId || typeof runId !== 'string' || !runId) return null;
  return JSON.stringify([projectId, runId]);
}

export function captureExpandedSavedTaskResultKeys(details) {
  const expanded = new Set();
  for (const detail of details ?? []) {
    const key = detail?.dataset?.savedTaskResultKey;
    if (detail?.open === true && typeof key === 'string' && key) expanded.add(key);
  }
  return expanded;
}

export function restoreSavedTaskResultOpen(key, expandedKeys) {
  return typeof key === 'string' && expandedKeys instanceof Set && expandedKeys.has(key);
}
