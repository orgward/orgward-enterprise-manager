export function restoreHumanTaskStatusFocus({ initiatingControl, documentRef, findTarget }) {
  if (!initiatingControl || initiatingControl.isConnected !== false
    || !documentRef || documentRef.activeElement !== documentRef.body || typeof findTarget !== 'function') return false;
  const target = findTarget();
  if (!target) return false;
  target.scrollIntoView?.({ block: 'nearest' });
  target.focus({ preventScroll: true });
  return documentRef.activeElement === target;
}
