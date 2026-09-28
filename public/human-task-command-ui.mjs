import { humanTaskActionFailureDisposition } from './human-task-action-failure.mjs';

const labels = Object.freeze({
  complete: { normal: 'Complete human task', retry: 'Retry saved completion', noun: 'completion' },
  escalate: { normal: 'Escalate to project owner', retry: 'Retry saved escalation', noun: 'escalation' },
  resolve: { normal: 'Resolve escalation', retry: 'Retry saved resolution', noun: 'resolution' },
});

function setCommandPresentation({ form, button, status, action, mode }) {
  const actionLabel = labels[action];
  for (const control of Array.from(form.elements ?? [])) {
    if (control !== button && 'disabled' in control) control.disabled = mode !== 'normal';
  }
  button.disabled = mode === 'submitting' || mode === 'saved';
  button.textContent = mode === 'retry' ? actionLabel.retry
    : mode === 'submitting' ? `Saving ${actionLabel.noun}…`
      : mode === 'saved' ? `Saved ${actionLabel.noun}` : actionLabel.normal;
  status.textContent = mode === 'retry'
    ? `The ${actionLabel.noun} result is uncertain. Form values are locked; retry sends the same saved action and evidence.`
    : mode === 'submitting' ? `Saving ${actionLabel.noun}. Form values are locked while the result is checked.`
      : mode === 'saved' ? `${actionLabel.noun[0].toUpperCase()}${actionLabel.noun.slice(1)} saved. Refreshing checkpoint status.` : '';
}

export async function submitHumanTaskCommand({ action, key, pendingCommands, payload, form, button, status,
  send, commandIdFactory = () => `human-task-${action}:${crypto.randomUUID()}` }) {
  const actionLabel = labels[action];
  if (!actionLabel) throw new TypeError('Unsupported human task action.');
  let pending = pendingCommands.get(key);
  if (!pending) {
    pending = { commandId: commandIdFactory(), payload: structuredClone(payload) };
    pendingCommands.set(key, pending);
  }
  if (pending.inFlight) return { kind: 'busy' };

  pending.inFlight = true;
  setCommandPresentation({ form, button, status, action, mode: 'submitting' });
  let saved = false;
  try {
    const result = await send(pending);
    saved = true;
    pendingCommands.delete(key);
    setCommandPresentation({ form, button, status, action, mode: 'saved' });
    return { kind: 'saved', result };
  } catch (error) {
    const disposition = humanTaskActionFailureDisposition(error);
    if (disposition === 'retry') {
      pending.retryRequired = true;
      setCommandPresentation({ form, button, status, action, mode: 'retry' });
      return { kind: 'retry', error };
    }
    pendingCommands.delete(key);
    setCommandPresentation({ form, button, status, action, mode: 'normal' });
    return { kind: disposition, error };
  } finally {
    pending.inFlight = false;
    if (!saved) button.disabled = false;
  }
}
