import { renderBlueprintImpactPreview } from './blueprint-impact-preview.mjs';

const EDITABLE_TYPES = new Set(['customer']);
const reason = 'Chat proposed an exact customer name or detail replacement.';

function sourcePins(source) {
  return source && {
    projectId: source.projectId,
    projectVersion: source.projectVersion,
    blueprintId: source.blueprintId,
    blueprintVersion: source.blueprintVersion,
    snapshotHash: source.snapshotHash,
    objectId: source.selectedId ?? source.objectId,
  };
}

function samePins(left, right) {
  return Boolean(left && right && left.projectId === right.projectId
    && left.projectVersion === right.projectVersion && left.blueprintId === right.blueprintId
    && left.blueprintVersion === right.blueprintVersion && left.snapshotHash === right.snapshotHash
    && left.objectId === right.objectId);
}

export function renderChatBlueprintEdit({ project, model, selectedId, writable, readCurrentSource, api, onApply,
  onDraftChange = () => {}, initialDraft = null, el }) {
  const root = el('section', { className: 'chat-blueprint-edit', attrs: { 'aria-labelledby': 'chat-blueprint-edit-title' } });
  root.append(el('h2', { text: 'Blueprint edit chat', attrs: { id: 'chat-blueprint-edit-title' } }),
    el('p', { text: 'Propose one exact customer name or detail replacement. OrgWard will show the impact before you apply it. This draft and its chat echo are transient and unsaved.' }));

  const blueprint = project?.latestBlueprint;
  const object = Object.values(blueprint?.areas ?? {}).flatMap((area) => area.items ?? []).find((entry) => entry.id === selectedId) ?? null;
  if (!writable || !model?.context || !model.context.isCurrent || model.context.sourceKind !== 'MAIN_DESIGN'
    || model.context.branchId || model.context.proposalId || model.context.effectiveAt != null || model.context.recordedAtCutoff != null) {
    root.append(el('p', { className: 'chat-blueprint-edit-guidance', text: 'Open the current main design with workspace write access to propose a change.' }));
    return root;
  }
  if (!object || !EDITABLE_TYPES.has(object.type)) {
    root.append(el('p', { className: 'chat-blueprint-edit-guidance', text: 'Select a customer record on the map to start a chat edit. Actor identities and other record types are not available in this first edit mode.' }));
    return root;
  }

  root.append(el('p', { className: 'chat-blueprint-edit-target', text: `Selected customer: ${object.name}.` }));
  const form = el('form', { className: 'chat-blueprint-edit-form', attrs: { 'aria-label': `Propose a change to ${object.name}` } });
  const fieldId = 'chat-blueprint-edit-field'; const valueId = 'chat-blueprint-edit-value';
  const fieldLabel = el('label', { text: 'Replace field', attrs: { for: fieldId } });
  const field = el('select', { attrs: { id: fieldId, name: 'field' } }, [
    el('option', { text: 'Name', attrs: { value: 'name' } }),
    el('option', { text: 'Detail', attrs: { value: 'detail' } }),
  ]);
  const valueLabel = el('label', { text: 'Exact replacement value', attrs: { for: valueId } });
  const value = el('textarea', { attrs: { id: valueId, name: 'replacement', rows: '3', maxlength: '700', required: '' } });
  const error = el('p', { className: 'field-error', attrs: { role: 'alert', 'aria-live': 'polite', hidden: '' } });
  const status = el('p', { className: 'chat-blueprint-edit-status', attrs: { role: 'status', 'aria-live': 'polite' } });
  const echo = el('div', { className: 'chat-blueprint-edit-echo', attrs: { hidden: '', role: 'status', 'aria-live': 'polite', 'aria-label': 'Transient chat edit echo' } });
  const previewPanel = el('div', { className: 'chat-blueprint-edit-preview', attrs: { hidden: '' } });
  const previewButton = el('button', { className: 'button primary', text: 'Preview impact', attrs: { type: 'submit' } });
  const applyButton = el('button', { className: 'button primary', text: 'Apply proposed change', attrs: { type: 'button', disabled: '' } });
  applyButton.disabled = true;
  form.append(fieldLabel, field, valueLabel, value, error, echo, previewPanel,
    el('div', { className: 'chat-blueprint-edit-actions' }, [previewButton, applyButton]), status);
  root.append(form);

  const targetPins = sourcePins(readCurrentSource());
  const retained = initialDraft && samePins(sourcePins(initialDraft), targetPins)
    && initialDraft.field && ['name', 'detail'].includes(initialDraft.field) ? initialDraft : null;
  field.value = retained?.field ?? 'detail';
  value.value = retained?.replacement ?? '';
  value.setAttribute('maxlength', field.value === 'name' ? '120' : '700');
  let generation = 0;
  let previewedDraft = null;
  let busy = false;
  const setError = (message = '') => { error.textContent = message; error.hidden = !message; };
  const canonicalReplacement = () => value.value.trim();
  const sourceCurrent = (draft) => root.isConnected !== false && samePins(sourcePins(readCurrentSource()), sourcePins(draft))
    && Boolean(readCurrentSource()?.writable);
  const currentSpec = () => {
    const replacement = canonicalReplacement();
    if (!replacement) return null;
    const key = field.value;
    const name = key === 'name' ? replacement : object.name;
    const detail = key === 'detail' ? replacement : object.detail;
    return Object.freeze({ projectId: project.id, projectVersion: project.version,
      blueprintId: blueprint.id, blueprintVersion: blueprint.version,
      snapshotHash: model.context.snapshotHash, objectId: object.id, objectType: object.type,
      field: key, replacement, name, detail, reason,
      commandId: `chat-blueprint-edit:${globalThis.crypto.randomUUID()}`,
      command: Object.freeze({ kind: 'edit-blueprint-object', blueprintId: blueprint.id,
        blueprintVersion: blueprint.version, objectId: object.id, name, detail, reason }) });
  };
  const clearPreview = () => {
    generation += 1; busy = false; previewButton.disabled = false; previewedDraft = null; applyButton.disabled = true;
    previewPanel.hidden = true; previewPanel.replaceChildren(); echo.hidden = true;
    if (value.value.trim()) status.textContent = 'Edit draft changed. Preview it again before applying.';
    else status.textContent = 'No change has been previewed or saved.';
  };
  field.addEventListener('change', () => {
    clearPreview(); onDraftChange(value.value.trim() ? { ...currentSpec(), commandId: null } : null);
    value.setAttribute('maxlength', field.value === 'name' ? '120' : '700');
  });
  value.addEventListener('input', () => {
    clearPreview(); setError(); onDraftChange(value.value.trim() ? { ...currentSpec(), commandId: null } : null);
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const replacement = canonicalReplacement();
    const maximum = field.value === 'name' ? 120 : 700;
    if (!replacement || replacement.length > maximum) {
      setError(`Enter a ${field.value} of 1–${maximum} characters.`); return;
    }
    const current = readCurrentSource();
    const draft = currentSpec();
    if (!draft || !current?.writable || !samePins(sourcePins(current), sourcePins(draft))) {
      setError('The selected customer or current main design changed. Reload it and preview again.'); return;
    }
    setError(); previewedDraft = null; applyButton.disabled = true; previewButton.disabled = true; busy = true;
    const requestGeneration = ++generation;
    const requestDraft = draft;
    onDraftChange(requestDraft);
    echo.replaceChildren(el('strong', { text: `You · Set ${object.name} ${draft.field} to:` }),
      el('blockquote', { text: draft.replacement })); echo.hidden = false;
    status.textContent = 'Checking the exact current design and direct impact…';
    try {
      const response = await api(`/api/v1/projects/${encodeURIComponent(project.id)}/enterprise/impact-preview`, {
        method: 'POST', body: JSON.stringify({ expectedVersion: draft.projectVersion, command: draft.command }),
      });
      if (requestGeneration !== generation || previewedDraft || !sourceCurrent(requestDraft)) return;
      previewPanel.replaceChildren(renderBlueprintImpactPreview(response.data, el)); previewPanel.hidden = false;
      previewedDraft = requestDraft; applyButton.disabled = false;
      status.textContent = `Preview is ${response.data.status}. Operational and downstream impact remain UNKNOWN; this does not grant publication or approval authority.`;
    } catch (failure) {
      if (requestGeneration !== generation || !sourceCurrent(requestDraft)) return;
      setError(failure.message ?? 'Impact preview failed.'); status.textContent = 'No change was applied.';
    } finally {
      if (requestGeneration === generation) { busy = false; previewButton.disabled = false; }
    }
  });
  applyButton.addEventListener('click', async () => {
    const draft = previewedDraft;
    if (!draft || busy) return;
    if (!sourceCurrent(draft)) {
      clearPreview(); setError('The current design or selected customer changed. Preview the edit again.'); return;
    }
    busy = true; applyButton.disabled = true; previewButton.disabled = true;
    status.textContent = 'Submitting the exact reviewed semantic edit…';
    try {
      await onApply(draft.command, draft.commandId, draft.projectVersion);
    } finally { busy = false; }
  });
  return root;
}
