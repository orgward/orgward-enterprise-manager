export function processInstanceControlFailureDisposition(error) {
  const status = Number(error?.status);
  return Number.isInteger(status) && status >= 400 && status < 500
    && status !== 408 && status !== 429 && error?.retryable !== true
    ? 'reconcile' : 'retry';
}

const actionLabels = Object.freeze({
  pause: { noun: 'pause', normal: 'Pause process instance', retry: 'Retry saved pause' },
  resume: { noun: 'resume', normal: 'Resume process instance', retry: 'Retry saved resume' },
  cancel: { noun: 'cancellation', normal: 'Cancel process instance', retry: 'Retry saved cancellation' },
  'abandon-unverified': { noun: 'unverified closure', normal: 'Close as unverified', retry: 'Retry saved closure' },
});

export function processInstanceCommandKey(action, instanceId, version) {
  return `${action}\n${instanceId}\n${version}`;
}

export function clearSettledProcessInstanceCommands(pendingCommands) {
  let cleared = false;
  for (const [key, pending] of pendingCommands) {
    if (pending.mode === 'saved' || pending.mode === 'reconcile') cleared = pendingCommands.delete(key) || cleared;
  }
  return cleared;
}

export function applySettledProcessInstanceCommands({ disposition, pendingCommands, render }) {
  if (disposition === 'defer-dirty' || disposition === 'defer-focus') return false;
  const cleared = clearSettledProcessInstanceCommands(pendingCommands);
  if (disposition === 'unchanged' && cleared) render?.();
  return cleared;
}

export function restoreProcessInstanceControlPresentation({ action, pending, form, button, status }) {
  if (!pending) return false;
  const payload = pending.payload;
  const reason = form.querySelector?.('[name="reason"]');
  if (reason && typeof payload.reason === 'string') reason.value = payload.reason;
  const evidence = form.querySelector?.('[name="evidence"]');
  if (evidence && Array.isArray(payload.evidence)) evidence.value = payload.evidence.join('\n');
  const acknowledgement = form.querySelector?.('[name="acknowledgeDuplicateCostWork"]');
  if (acknowledgement) acknowledgement.checked = payload.acknowledgeDuplicateCostWork === true;
  if (pending.refreshFailed) {
    const failedRefreshStatus = pending.mode === 'saved'
      ? 'The command was saved, but current process state could not be refreshed. This form stays locked; reload or refresh before acting again.'
      : 'The action was rejected, but current process state could not be refreshed. This form stays locked until it can be reconciled.';
    setPresentation({ action, form, button, status, mode: pending.mode === 'saved' ? 'saved' : 'reconciling' });
    status.textContent = failedRefreshStatus;
    return true;
  }
  setPresentation({ action, form, button, status, mode: pending.mode === 'submitting' ? 'submitting'
    : pending.mode === 'retry' ? 'retry'
    : pending.mode === 'saved' ? 'saved' : pending.mode === 'reconcile' ? 'reconciling' : 'retry' });
  return true;
}

export async function refreshAfterProcessInstanceControl({ kind, refresh, status, pending }) {
  if (kind !== 'saved' && kind !== 'reconcile') return false;
  try {
    if (await refresh()) return true;
  } catch { /* A failed refresh leaves the original command form locked. */ }
  if (pending) pending.refreshFailed = true;
  status.textContent = kind === 'saved'
    ? 'The command was saved, but current process state could not be refreshed. This form stays locked; reload or refresh before acting again.'
    : 'The action was rejected, but current process state could not be refreshed. This form stays locked until it can be reconciled.';
  return false;
}

function setPresentation({ action, form, button, status, mode }) {
  const label = actionLabels[action];
  for (const control of Array.from(form.elements ?? [])) {
    if (control !== button && 'disabled' in control) control.disabled = mode !== 'normal';
  }
  button.disabled = mode !== 'retry' && mode !== 'normal';
  button.textContent = mode === 'retry' ? label.retry
    : mode === 'submitting' ? `Saving ${label.noun}…`
      : mode === 'saved' ? `Saved ${label.noun}`
        : mode === 'reconciling' ? `Checking ${label.noun}…` : label.normal;
  status.textContent = mode === 'retry'
    ? `The ${label.noun} result is uncertain. Form values are locked; retry sends the same saved command and details.`
    : mode === 'submitting' ? `Saving ${label.noun}. Form values are locked while the result is checked.`
      : mode === 'saved' ? `${label.noun[0].toUpperCase()}${label.noun.slice(1)} saved. Refreshing process state.`
        : mode === 'reconciling' ? `The ${label.noun} was rejected. Checking current process state before enabling another action.` : '';
}

export async function submitProcessInstanceControl({ action, key, pendingCommands, payload, form, button, status,
  send, commandIdFactory = () => `process-instance-${action}:${crypto.randomUUID()}` }) {
  const label = actionLabels[action];
  if (!label) throw new TypeError('Unsupported process-instance control action.');
  let pending = pendingCommands.get(key);
  if (!pending) {
    pending = { commandId: commandIdFactory(), payload: structuredClone(payload) };
    pendingCommands.set(key, pending);
  }
  if (pending.inFlight) return { kind: 'busy' };

  pending.inFlight = true;
  pending.mode = 'submitting';
  setPresentation({ action, form, button, status, mode: 'submitting' });
  let saved = false;
  let preserveLock = false;
  try {
    const result = await send(pending);
    saved = true;
    preserveLock = true;
    pending.mode = 'saved';
    setPresentation({ action, form, button, status, mode: 'saved' });
    return { kind: 'saved', result };
  } catch (error) {
    if (processInstanceControlFailureDisposition(error) === 'retry') {
      pending.mode = 'retry';
      setPresentation({ action, form, button, status, mode: 'retry' });
      return { kind: 'retry', error };
    }
    pending.mode = 'reconcile';
    preserveLock = true;
    setPresentation({ action, form, button, status, mode: 'reconciling' });
    return { kind: 'reconcile', error };
  } finally {
    pending.inFlight = false;
    if (!saved && !preserveLock) button.disabled = false;
  }
}
