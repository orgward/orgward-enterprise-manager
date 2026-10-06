const MAX_CONTROLS = 64;
const MAX_VALUE_LENGTH = 20_100;
const MAX_DRAFT_BYTES = 32_768;

export function humanTaskFormDraftScope({ tenantId, principal, projectId, planId, revision, planInstanceId, taskId }) {
  if (![tenantId, principal, projectId, planId, planInstanceId, taskId].every((value) => typeof value === 'string' && value.length > 0)
    || !Number.isSafeInteger(revision) || revision < 1) return null;
  return { tenantId, principal, projectId, planId, revision, planInstanceId, taskId };
}

export function humanTaskFormDraftKey(scope) {
  const pinned = humanTaskFormDraftScope(scope ?? {});
  if (!pinned) return null;
  return `orgward:human-task-form-draft:v1:${[pinned.tenantId, pinned.principal, pinned.projectId, pinned.planId,
    pinned.revision, pinned.planInstanceId, pinned.taskId].map(encodeURIComponent).join(':')}`;
}

function validValues(values) {
  return Array.isArray(values) && values.length <= MAX_CONTROLS && values.every((entry) => entry && typeof entry === 'object'
    && typeof entry.name === 'string' && entry.name.length > 0 && entry.name.length <= 240
    && typeof entry.value === 'string' && entry.value.length <= MAX_VALUE_LENGTH);
}

export function readHumanTaskFormDraft(storage, scope) {
  const pinned = humanTaskFormDraftScope(scope ?? {});
  const key = humanTaskFormDraftKey(pinned);
  if (!key || !storage) return null;
  try {
    const raw = storage.getItem(key);
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_DRAFT_BYTES) return null;
    const record = JSON.parse(raw);
    if (record?.schemaVersion !== 1 || JSON.stringify(record.scope) !== JSON.stringify(pinned)
      || !validValues(record.values)) return null;
    return { values: record.values };
  } catch { return null; }
}

export function saveHumanTaskFormDraft(storage, scope, values) {
  const pinned = humanTaskFormDraftScope(scope ?? {});
  const key = humanTaskFormDraftKey(pinned);
  if (!key || !storage) return false;
  try {
    if (!validValues(values)) { storage.removeItem(key); return false; }
    const raw = JSON.stringify({ schemaVersion: 1, scope: pinned, values });
    if (new TextEncoder().encode(raw).length > MAX_DRAFT_BYTES) { storage.removeItem(key); return false; }
    storage.setItem(key, raw);
    return true;
  } catch { return false; }
}

export function clearHumanTaskFormDraft(storage, scope) {
  const key = humanTaskFormDraftKey(scope);
  if (!key || !storage) return false;
  try { storage.removeItem(key); return true; } catch { return false; }
}

export function restoreHumanTaskFormDraftControls(form, values) {
  if (!form || !validValues(values)) return false;
  const result = values.find((entry) => entry.name === 'result');
  const resultControl = result ? form.elements.namedItem('result') : null;
  if (resultControl && typeof resultControl.value === 'string') {
    resultControl.value = result.value;
    resultControl.dispatchEvent(new Event('change', { bubbles: true }));
  }
  for (const entry of values) {
    if (entry.name === 'result') continue;
    const control = form.elements.namedItem(entry.name);
    if (!control || typeof control.value !== 'string') continue;
    control.value = entry.value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return true;
}

export function humanTaskDraftForgetPresentation(removed) {
  return removed
    ? { buttonHidden: true, status: 'Saved browser copy removed. Current fields remain on screen and are not submitted.' }
    : { buttonHidden: false, status: 'Could not remove the saved browser copy. It may still be restored on this device.' };
}
