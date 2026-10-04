export const ENTERPRISE_INTERCHANGE_COMMANDS = ['bulk-edit-objects'];
export function enterpriseInterchangeWritable(model) {
  return Boolean(model?.permissions?.write && model.context?.isCurrent === true && model.blueprint
    && model.context?.effectiveAt == null && model.context?.recordedAtCutoff == null && !model.context?.proposalId && !model.context?.branchId);
}
export function enterpriseInterchangeCommandPayload(model, payload) {
  if (!enterpriseInterchangeWritable(model) || payload?.kind !== 'bulk-edit-objects') return null;
  return { ...payload, blueprintId: model.context.blueprintId, blueprintVersion: model.context.blueprintVersion };
}

function fieldSummary(label, values, el) {
  const entries = values ?? [];
  const box = el('div', { className: 'enterprise-interchange-list' }, [el('strong', { text: `${label}: ${entries.length}` })]);
  for (const value of entries.slice(0, 20)) box.append(el('p', { text: typeof value === 'string' ? value
    : `${value.recordId ? `${value.recordId} · ` : ''}${value.field ?? value.code ?? JSON.stringify(value)}` }));
  if (entries.length > 20) box.append(el('p', { text: `${entries.length - 20} additional entries are omitted from this preview.` }));
  return box;
}

export function renderEnterpriseInterchange({ projectId, model, draft = null, pending = null, loading = false, el, ui, api, onCommand, onDraftChange }) {
  if (!model.blueprint) return null;
  const root = el('section', { attrs: { 'data-enterprise-interchange': '', 'aria-label': 'Proposed design export and import' } }, [
    el('h4', { text: 'Proposed design export and bulk import' }),
    el('p', { text: 'Bundles carry a source project, blueprint version and snapshot hash. Import changes only recognized editable fields on existing canonical records; unknown fields, preserved non-editable fields and collisions are listed before apply. Changes remain proposed design and never run or publish work.' }),
  ]);
  const writable = enterpriseInterchangeWritable(model) && !loading && !pending;
  const status = el('p', { attrs: { role: 'status', 'aria-live': 'polite' } });
  const previewRegion = el('div');
  const file = el('input', { attrs: { type: 'file', accept: '.json,application/json', 'aria-label': 'Enterprise blueprint JSON bundle' } });
  const upload = el('button', { className: 'button', text: 'Preview import', attrs: { type: 'button' } }); upload.disabled = !writable;
  const download = el('button', { className: 'button ghost', text: 'Download current proposed design JSON', attrs: { type: 'button' } }); download.disabled = loading;
  const setDraft = (value) => { if (onDraftChange) onDraftChange(value); };
  let activeDraft = draft;
  download.addEventListener('click', async () => {
    download.disabled = true; status.textContent = 'Preparing the exact proposed design export…';
    let url = null;
    try {
      const response = await api(`/api/v1/projects/${encodeURIComponent(projectId)}/enterprise/export`);
      url = URL.createObjectURL(new Blob([`${JSON.stringify(response.data, null, 2)}\n`], { type: 'application/json' }));
      const anchor = el('a', { attrs: { href: url, download: `orgward-enterprise-${response.data.source.blueprintId}-v${response.data.source.blueprintVersion}.json` } });
      root.append(anchor); anchor.click(); anchor.remove();
      status.textContent = `Downloaded blueprint ${response.data.source.blueprintId} v${response.data.source.blueprintVersion} · snapshot ${response.data.source.snapshotHash}.`;
    } catch (error) { status.textContent = `Export failed: ${error.message}. Try again.`; }
    finally { if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); download.disabled = loading; }
  });

  function showPreview(value) {
    activeDraft = value; setDraft(value); previewRegion.replaceChildren();
    const preview = value?.preview;
    if (!preview) return;
    previewRegion.append(el('h5', { text: 'Import preview' }),
      el('p', { text: `Source project ${preview.source.projectId} · blueprint ${preview.source.blueprintId} v${preview.source.blueprintVersion} · hash ${preview.source.snapshotHash}` }),
      el('p', { text: `Current destination: blueprint ${preview.currentSource.blueprintId} v${preview.currentSource.blueprintVersion} · hash ${preview.currentSource.snapshotHash}` }),
      el('p', { text: `${preview.recordCount} records · ${preview.recognizedFields} recognized fields · ${preview.readyRecordIds.length} ready to apply. Preview hash ${preview.previewHash}.` }),
      fieldSummary('Unknown fields (not applied)', preview.unknownFields, el),
      fieldSummary('Loss fields (preserved in destination)', preview.lossyFields, el),
      fieldSummary('Identity/type/field collisions (blocked)', preview.collisions, el),
      fieldSummary('Typed-reference/model validation errors (blocked)', preview.validationErrors, el));
    const selected = new Set(value.recordIds ?? preview.readyRecordIds);
    const choices = el('fieldset'); choices.append(el('legend', { text: 'Select ready records for one atomic apply' }));
    for (const row of preview.rows) {
      const checkbox = el('input', { attrs: { type: 'checkbox', name: 'import-record', value: row.id } });
      checkbox.checked = row.status === 'READY' && selected.has(row.id); checkbox.disabled = !writable || row.status !== 'READY';
      const detail = `${row.id} · ${row.type} · ${row.status} · changed: ${row.changedFields.join(', ') || 'none'} · recognized: ${row.recognizedFields.join(', ') || 'none'}${row.validationErrors?.length ? ` · invalid: ${row.validationErrors.map((entry) => entry.message).join('; ')}` : ''}`;
      choices.append(el('label', {}, [checkbox, el('span', { text: detail })]));
    }
    const reason = ui.field('reason', 'Reason for importing these proposed design edits', { multiline: true, maximum: 500, value: value.reason ?? '' });
    const submit = ui.form('bulk-edit-objects', 'Apply selected edits as one proposed version', [choices, reason.node], () => {
      const recordIds = Array.from(choices.querySelectorAll('input')).filter((control) => control.checked).map((control) => control.value);
      if (!recordIds.length) throw new Error('Select at least one ready record to apply.');
      const next = { ...activeDraft, recordIds, reason: reason.control.value.trim() }; showPreview(next);
      onCommand({ kind: 'bulk-edit-objects', bundle: activeDraft.bundle, recordIds, reason: next.reason });
    }, !writable || !preview.readyRecordIds.length);
    previewRegion.append(submit);
  }

  async function restorePreview(value) {
    try {
      const response = await api(`/api/v1/projects/${encodeURIComponent(projectId)}/enterprise/import-preview`, {
        method: 'POST', body: JSON.stringify({ bundle: value.bundle }),
      });
      if (activeDraft !== value) return;
      showPreview({ ...value, preview: response.data });
      status.textContent = 'Saved import draft rechecked against the current proposed design. Review it before applying.';
    } catch (error) {
      status.textContent = `Saved import draft needs repair: ${error.message}. Its exact JSON remains available for editing and preview.`;
    }
  }

  upload.addEventListener('click', async () => {
    const selectedFile = file.files?.[0];
    if (!selectedFile || loading || pending) { status.textContent = 'Choose an enterprise JSON bundle before previewing it.'; return; }
    if (selectedFile.size > 1_000_000) { status.textContent = 'Choose a bundle no larger than 1 MB.'; return; }
    upload.disabled = true; status.textContent = 'Reading bundle and checking its source identity…';
    try {
      const bundle = JSON.parse(await selectedFile.text());
      const response = await api(`/api/v1/projects/${encodeURIComponent(projectId)}/enterprise/import-preview`, {
        method: 'POST', body: JSON.stringify({ bundle }),
      });
      showPreview({ fileName: selectedFile.name, bundle, preview: response.data, recordIds: response.data.readyRecordIds, reason: '' });
      status.textContent = 'Import preview ready. Review every recognized, unknown, loss and collision field before applying.';
    } catch (error) { status.textContent = `Import preview failed: ${error.message}. The typed bundle remains unchanged; choose or repair a file and preview again.`; }
    finally { upload.disabled = !writable; }
  });
  root.append(download, file, upload, status, previewRegion);
  if (activeDraft?.bundle && activeDraft?.preview) showPreview(activeDraft);
  else if (activeDraft?.bundle) { status.textContent = 'Rechecking the saved import draft against the current proposed design…'; void restorePreview(activeDraft); }
  if (!writable) root.append(el('p', { text: 'Import is enabled only for a current proposed main design and a human workspace editor.' }));
  return root;
}
