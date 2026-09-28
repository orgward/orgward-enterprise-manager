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

export function captureFocusedSavedTaskResult(details, activeElement) {
  if (!activeElement) return null;
  for (const detail of details ?? []) {
    const key = detail?.dataset?.savedTaskResultKey;
    if (typeof key !== 'string' || !key || !detail.contains?.(activeElement)) continue;
    if (activeElement.tagName === 'SUMMARY') return { key, target: 'summary' };
    if (activeElement.tagName === 'A') {
      const href = activeElement.getAttribute?.('href');
      if (typeof href === 'string' && href) return { key, target: 'link', href };
    }
  }
  return null;
}

export function restoreFocusedSavedTaskResult(focus, details) {
  if (!focus || typeof focus.key !== 'string') return false;
  const detail = [...(details ?? [])].find((candidate) => candidate?.dataset?.savedTaskResultKey === focus.key);
  if (!detail) return false;
  let target = null;
  if (focus.target === 'summary') target = detail.querySelector?.('summary') ?? null;
  else if (focus.target === 'link' && typeof focus.href === 'string') {
    target = [...(detail.querySelectorAll?.('a[href]') ?? [])]
      .find((link) => link.getAttribute?.('href') === focus.href) ?? null;
  }
  if (typeof target?.focus !== 'function') return false;
  target.focus({ preventScroll: true });
  return true;
}

export function restoreSavedTaskResultOpen(key, expandedKeys) {
  return typeof key === 'string' && expandedKeys instanceof Set && expandedKeys.has(key);
}
