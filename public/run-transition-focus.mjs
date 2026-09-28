const TERMINAL_EXECUTION_STATES = new Set(['SUCCEEDED', 'FAILED']);

export function isRunActionKeyboardActivation(event, initiatingControl, documentRef) {
  return event?.isTrusted === true && event.detail === 0 && documentRef?.activeElement === initiatingControl;
}

export function restoreRunTransitionFocus({
  initiatingControl,
  documentRef,
  findTarget,
  action,
  runStatus,
  keyboardInvoked,
  focusMoved,
  transitionSucceeded,
}) {
  if (!transitionSucceeded || !keyboardInvoked || focusMoved || !['approve', 'execute', 'open-run'].includes(action)
    || (action === 'approve' && runStatus !== 'APPROVED')
    || (action === 'execute' && !TERMINAL_EXECUTION_STATES.has(runStatus))
    || (action === 'open-run' && typeof runStatus !== 'string')
    || !initiatingControl || initiatingControl.isConnected !== false
    || !documentRef || documentRef.activeElement !== documentRef.body || typeof findTarget !== 'function') return false;
  const target = findTarget();
  if (!target) return false;
  target.scrollIntoView?.({ block: 'nearest' });
  target.focus({ preventScroll: true });
  return documentRef.activeElement === target;
}
