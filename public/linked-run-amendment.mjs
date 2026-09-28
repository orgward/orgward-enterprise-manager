const savedAmendmentStatus = 'The amendment was saved, but the current run could not be refreshed. This form stays locked until the saved run state is available.';
const rejectedAmendmentStatus = 'The amendment was rejected, but the current run could not be refreshed. This form stays locked until the conflict is reconciled.';

export function linkedRunAmendmentFailureDisposition(error) {
  if (error?.code === 'VERSION_CONFLICT') return 'reconcile';
  const status = Number(error?.status);
  if (error?.retryable === true || !Number.isInteger(status) || status === 408 || status === 429 || status >= 500) return 'retry';
  if (status === 409) return 'reconcile';
  return 'discard';
}

function setPresentation({ form, button, status, mode, pending = null }) {
  const labels = {
    normal: 'Save new instruction revision',
    submitting: 'Saving instruction revision…',
    retry: 'Retry saved instruction revision',
    saved: 'Saved instruction revision',
    reconcile: 'Checking current run…',
  };
  for (const control of Array.from(form.elements ?? [])) {
    if (control !== button && 'disabled' in control) control.disabled = mode !== 'normal';
  }
  button.disabled = mode !== 'normal' && mode !== 'retry';
  button.textContent = labels[mode];
  status.textContent = mode === 'normal' ? ''
    : mode === 'submitting' ? 'Saving this instruction revision. Form values are locked while the result is checked.'
      : mode === 'retry' ? 'The amendment result is uncertain. Form values are locked; retry sends the same saved command and details.'
        : mode === 'saved' ? 'The amendment was saved. Refreshing the current run.'
          : 'The amendment was rejected. Checking the current run before enabling another action.';
  if (pending?.refreshFailed) status.textContent = pending.mode === 'saved' ? savedAmendmentStatus : rejectedAmendmentStatus;
}

export function restoreLinkedRunAmendment({ pending, form, button, status }) {
  if (!pending) return false;
  const { payload } = pending;
  const objective = form.querySelector?.('[name="objective"]');
  const requirements = form.querySelector?.('[name="requirements"]');
  const reason = form.querySelector?.('[name="reason"]');
  if (objective) objective.value = payload.objective;
  if (requirements) requirements.value = payload.requirements.join('\n');
  if (reason) reason.value = payload.reason;
  setPresentation({ form, button, status, mode: pending.mode ?? 'retry', pending });
  return true;
}

export async function submitLinkedRunAmendment({ key, pendingCommands, projectId, version, payload, form, button, status, send,
  commandIdFactory = () => crypto.randomUUID() }) {
  let pending = pendingCommands.get(key);
  if (!pending) {
    pending = { commandId: commandIdFactory(), projectId, version, payload: structuredClone(payload) };
    pendingCommands.set(key, pending);
  }
  if (pending.inFlight) return { kind: 'busy' };
  pending.inFlight = true;
  pending.mode = 'submitting';
  setPresentation({ form, button, status, mode: 'submitting', pending });
  try {
    const result = await send(pending);
    pending.mode = 'saved';
    setPresentation({ form, button, status, mode: 'saved', pending });
    return { kind: 'saved', result };
  } catch (error) {
    const disposition = linkedRunAmendmentFailureDisposition(error);
    if (disposition === 'retry') {
      pending.mode = 'retry';
      setPresentation({ form, button, status, mode: 'retry', pending });
      return { kind: 'retry', error };
    }
    if (disposition === 'reconcile') {
      pending.mode = 'reconcile';
      setPresentation({ form, button, status, mode: 'reconcile', pending });
      return { kind: 'reconcile', error };
    }
    pendingCommands.delete(key);
    setPresentation({ form, button, status, mode: 'normal' });
    return { kind: 'discard', error };
  } finally {
    pending.inFlight = false;
  }
}

export async function refreshLinkedRunAmendment({ key, pendingCommands, refresh, status }) {
  try {
    const run = await refresh();
    if (!run || typeof run !== 'object') throw new Error('Current run was not returned.');
    pendingCommands.delete(key);
    return { kind: 'refreshed', run };
  } catch {
    const pending = pendingCommands.get(key);
    if (pending) {
      pending.refreshFailed = true;
      status.textContent = pending.mode === 'saved' ? savedAmendmentStatus : rejectedAmendmentStatus;
    }
    return { kind: 'refresh-failed' };
  }
}

export function clearSettledLinkedRunAmendment(pendingCommands, key) {
  const pending = pendingCommands.get(key);
  if (pending?.mode !== 'saved' && pending?.mode !== 'reconcile') return false;
  return pendingCommands.delete(key);
}
