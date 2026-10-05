export const ENTERPRISE_INTERCHANGE_COMMANDS = ['bulk-edit-objects', 'accept-source-evidence', 'import-design-pack'];
export function enterpriseInterchangeWritable(model) {
  return Boolean(model?.permissions?.write && model.context?.isCurrent === true && model.blueprint
    && model.context?.effectiveAt == null && model.context?.recordedAtCutoff == null && !model.context?.proposalId && !model.context?.branchId);
}
export function enterpriseInterchangeCommandPayload(model, payload) {
  if (!enterpriseInterchangeWritable(model) || !ENTERPRISE_INTERCHANGE_COMMANDS.includes(payload?.kind)) return null;
  if (payload.kind === 'accept-source-evidence' && (!/^[a-f0-9]{64}$/.test(payload.blueprintHash ?? '')
    || !/^[a-f0-9]{64}$/.test(payload.previewHash ?? '') || !Array.isArray(payload.selections) || !payload.selections.length)) return null;
  if (payload.kind === 'import-design-pack' && (!/^[a-f0-9]{64}$/.test(payload.previewHash ?? '')
    || !payload.bundle || typeof payload.bundle !== 'object' || !payload.mappings || typeof payload.mappings !== 'object')) return null;
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

export function renderEnterpriseInterchange({ projectId, model, object = null, draft = null, pending = null, loading = false, el, ui, api, onCommand, onDraftChange,
  isCurrentContext = () => true }) {
  if (!model.blueprint) return null;
  const root = el('section', { attrs: { 'data-enterprise-interchange': '', 'aria-label': 'Proposed design export and import' } }, [
    el('h4', { text: 'Proposed design export and bulk import' }),
    el('p', { text: 'Proposed-design bundles can be reviewed for editable changes, but importing them never runs or publishes work. Source-evidence bundles produce typed identity and claim proposals with source provenance; preview does not authenticate sources, verify claim truth, write records or publish design.' }),
  ]);
  const writable = enterpriseInterchangeWritable(model) && !loading && !pending;
  const previewable = Boolean(model.blueprint) && !loading && !pending;
  const status = el('p', { attrs: { role: 'status', 'aria-live': 'polite' } });
  const previewRegion = el('div');
  const file = el('input', { attrs: { type: 'file', accept: '.json,application/json', 'aria-label': 'Enterprise blueprint JSON bundle' } });
  const upload = el('button', { className: 'button', text: 'Preview import', attrs: { type: 'button' } }); upload.disabled = !previewable;
  const download = el('button', { className: 'button ghost', text: 'Download current proposed design JSON', attrs: { type: 'button' } }); download.disabled = loading;
  const setDraft = (value) => { if (onDraftChange) onDraftChange(value); };
  let activeDraft = draft;
  let previewAttempt = 0;
  const packExport = object?.type === 'process' && model.context?.isCurrent === true
    ? el('button', { className: 'button ghost', text: 'Export this process and its design dependencies as a pack', attrs: { type: 'button', disabled: loading } }) : null;
  if (packExport) packExport.addEventListener('click', async () => {
    packExport.disabled = true; status.textContent = 'Preparing a pinned process pack…';
    let url = null;
    try {
      const response = await api(`/api/v1/projects/${encodeURIComponent(projectId)}/enterprise/process-pack-export`, {
        method: 'POST', body: JSON.stringify({ blueprintId: model.context.blueprintId,
          blueprintVersion: model.context.blueprintVersion, rootId: object.id }),
      });
      const bundle = response.data;
      url = URL.createObjectURL(new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: 'application/json' }));
      const anchor = el('a', { attrs: { href: url, download: `orgward-process-pack-${bundle.rootId}-${bundle.packHash.slice(0, 12)}.json` } });
      root.append(anchor); anchor.click(); anchor.remove();
      status.textContent = `Downloaded process pack for ${bundle.records.find((record) => record.id === bundle.rootId)?.name ?? bundle.rootId}. The source is proposed design; uploaded pack identity is not authenticated.`;
    } catch (error) { status.textContent = `Process pack export failed: ${error.message}.`; }
    finally { if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); packExport.disabled = loading; }
  });
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
    if (!preview) {
      if (value && Object.hasOwn(value, 'bundle')) {
        previewRegion.append(el('h5', { text: 'Retained source JSON needs review' }),
          el('p', { text: `The exact ${value.fileName ?? 'source evidence'} remains in this browser, but no current preview is available. Repair the JSON in your source system or editor, then select the corrected file and preview it again.` }));
        const save = el('button', { className: 'button ghost', text: 'Download retained source JSON', attrs: { type: 'button' } });
        save.addEventListener('click', () => {
          const url = URL.createObjectURL(new Blob([`${JSON.stringify(value.bundle, null, 2)}\n`], { type: 'application/json' }));
          const anchor = el('a', { attrs: { href: url, download: value.fileName || 'orgward-source-evidence.json' } });
          root.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
        previewRegion.append(save);
      }
      return;
    }
    if (preview.mode === 'SOURCE_ONBOARDING_PREVIEW') {
      previewRegion.append(el('h5', { text: 'Source evidence preview · proposals only' }),
        el('p', { text: `Source ${preview.source.label} (${preview.source.id}) · source locator ${preview.source.locator ?? 'not supplied'} · source snapshot ${preview.source.snapshotHash}` }),
        el('p', { text: `Destination blueprint ${preview.currentSource.blueprintId} v${preview.currentSource.blueprintVersion} · ${preview.currentSource.snapshotHash}` }),
        el('p', { text: `${preview.recordCount} source records · ${preview.claimCount} claims · ${preview.unknowns.length} unresolved items · ${preview.collisions.length} identity collisions · preview ${preview.previewHash}` }),
        fieldSummary('Identity and claim proposals', preview.proposals.flatMap((proposal) => [
          { recordId: proposal.identity.sourceRecordId, field: `identity ${proposal.identity.status} · ${proposal.identity.type} “${proposal.identity.name}” · candidates ${proposal.identity.candidateObjectIds.join(', ') || 'none'} · provenance ${proposal.identity.provenance.sourceId}/${proposal.identity.provenance.sourceLocator ?? 'source locator unknown'}/${proposal.identity.provenance.recordLocator} · hash ${proposal.identity.provenance.sourceHash}` },
          ...proposal.claims.map((claim) => ({ recordId: proposal.identity.sourceRecordId,
            field: `${claim.status}${claim.identityResolution ? ` · identity ${claim.identityResolution}` : ''} ${claim.path}${claim.expectedValueType ? ` (expected ${claim.expectedValueType})` : ''} = ${JSON.stringify(claim.value)} · provenance ${claim.provenance.sourceId}/${claim.provenance.sourceLocator ?? 'source locator unknown'}/${claim.provenance.recordLocator}/${claim.provenance.claimLocator ?? 'claim locator unknown'} · hash ${claim.provenance.sourceHash}` })),
        ]), el),
        fieldSummary('Unknown or unresolved identity/claim data', preview.unknowns, el),
        fieldSummary('Identity collisions', preview.collisions, el));
      for (const limitation of preview.limitations) previewRegion.append(el('p', { text: limitation }));
      if (!writable) {
        if (pending?.kind === 'accept-source-evidence') previewRegion.append(el('p', { attrs: { role: 'status' },
          text: `Acceptance command is pending exact recovery: ${pending.selections.map((selection) => `${selection.sourceRecordId} → ${selection.targetObjectId} (${selection.claimIds.join(', ')})`).join('; ')} · preview ${pending.previewHash}.` }));
        return;
      }
      const savedSelections = new Map((value.sourceSelections ?? []).map((entry) => [entry.sourceRecordId, entry]));
      const canonicalObjects = Object.values(model.blueprint.areas ?? {}).flatMap((area) => area.items ?? []);
      const acceptance = el('fieldset'); acceptance.append(el('legend', { text: 'Review and accept selected claims into one proposed version' }));
      const proposalControls = [];
      for (const proposal of preview.proposals) {
        const identity = proposal.identity;
        const choices = identity.candidateObjectIds.length
          ? canonicalObjects.filter((object) => identity.candidateObjectIds.includes(object.id))
          : canonicalObjects.filter((object) => object.type === identity.type);
        const target = el('select', { attrs: { name: `source-target-${identity.sourceRecordId}`, 'aria-label': `Canonical target for ${identity.name}` } }, [
          el('option', { text: 'Resolve identity before accepting claims', attrs: { value: '' } }),
          ...choices.map((object) => el('option', { text: `${object.name} · ${object.id}`, attrs: { value: object.id } })),
        ]);
        target.required = false; target.disabled = choices.length === 0;
        const saved = savedSelections.get(identity.sourceRecordId);
        target.value = saved?.targetObjectId ?? '';
        acceptance.append(el('p', { text: `${identity.name} · ${identity.type} · ${identity.status} · source record ${identity.sourceRecordId}` }),
          el('label', { text: 'Canonical identity match' }, [target]));
        const claimControls = [];
        for (const claim of proposal.claims) {
          const checkbox = el('input', { attrs: { type: 'checkbox', name: `source-claim-${identity.sourceRecordId}`, value: claim.id } });
          checkbox.checked = Boolean(saved?.claimIds?.includes(claim.id));
          checkbox.disabled = !['PROPOSED', 'IDENTITY_UNRESOLVED'].includes(claim.status);
          acceptance.append(el('label', {}, [checkbox, el('span', { text: `${claim.path} · ${claim.status} · ${JSON.stringify(claim.value)} · ${claim.provenance.sourceLocator ?? 'source locator unknown'}/${claim.provenance.recordLocator}/${claim.provenance.claimLocator ?? 'claim locator unknown'}` })]));
          claimControls.push(checkbox);
        }
        target.required = claimControls.some((control) => control.checked);
        proposalControls.push({ sourceRecordId: identity.sourceRecordId, target, claimControls });
      }
      const reason = ui.field('reason', 'Reason for accepting these source claims', { multiline: true, maximum: 500, value: value.reason ?? '' });
      const persistSelection = () => {
        for (const { target, claimControls } of proposalControls) target.required = claimControls.some((control) => control.checked);
        const sourceSelections = proposalControls.map(({ sourceRecordId, target, claimControls }) => ({ sourceRecordId,
          targetObjectId: target.value, claimIds: claimControls.filter((control) => control.checked).map((control) => control.value) }))
          .filter((entry) => entry.claimIds.length);
        const next = { ...activeDraft, sourceSelections, reason: reason.control.value.trim() };
        activeDraft = next; setDraft(next);
      };
      for (const { target, claimControls } of proposalControls) {
        target.addEventListener('change', persistSelection);
        for (const control of claimControls) control.addEventListener('change', persistSelection);
      }
      reason.control.addEventListener('change', persistSelection);
      const submit = ui.form('accept-source-evidence', 'Accept selected claims as one proposed version', [acceptance, reason.node], () => {
        const selectedRows = proposalControls.filter(({ claimControls }) => claimControls.some((control) => control.checked));
        const selections = selectedRows.map(({ sourceRecordId, target, claimControls }) => ({ sourceRecordId,
          targetObjectId: target.value, claimIds: claimControls.filter((control) => control.checked).map((control) => control.value) }))
          .filter((entry) => entry.claimIds.length);
        if (!selections.length || selections.some((entry) => !entry.targetObjectId)) throw new Error('Choose a canonical identity and at least one claim before accepting.');
        const payload = { kind: 'accept-source-evidence', bundle: activeDraft.bundle, previewHash: preview.previewHash,
          blueprintHash: preview.currentSource.snapshotHash, selections, reason: reason.control.value.trim() };
        const next = { ...activeDraft, sourceSelections: selections, reason: payload.reason }; showPreview(next); onCommand(payload);
      }, !writable || !proposalControls.some(({ target, claimControls }) => !target.disabled && claimControls.some((control) => !control.disabled)));
      previewRegion.append(submit);
      return;
    }
    if (preview.mode === 'DESIGN_PACK_PREVIEW') {
      previewRegion.append(el('h5', { text: 'Reusable process pack preview' }),
        el('p', { text: `Source workspace ${preview.source.projectId} · blueprint ${preview.source.blueprintId} v${preview.source.blueprintVersion} · hash ${preview.source.snapshotHash}` }),
        el('p', { text: `Destination workspace ${preview.currentSource.projectId} · blueprint ${preview.currentSource.blueprintId} v${preview.currentSource.blueprintVersion} · hash ${preview.currentSource.snapshotHash}` }),
        el('p', { text: `Root process ${preview.rootName} · ${preview.recordCount} linked design records · pack ${preview.packHash}` }),
        el('p', { text: 'Uploaded JSON and its claimed source identity are untrusted. Hashes check internal consistency only; they do not authenticate who created the pack or prove its design is correct. Applying it creates proposed design only.' }));
      const mapChoices = [];
      for (const row of preview.rows) {
        const detail = el('p', { text: `${row.sourceName} · ${row.type} · ${row.status}${row.targetId ? ` → ${row.targetId}` : ''}` });
        previewRegion.append(detail);
        if (row.candidates?.length) {
          const saved = activeDraft?.mappings?.[row.sourceRecordId];
          const select = el('select', { attrs: { 'aria-label': `Resolve matching ${row.type} ${row.sourceName}`, name: `pack-map-${row.sourceRecordId}` } }, [
            el('option', { text: 'Choose: create a new copy or reuse a target record', attrs: { value: '' } }),
            el('option', { text: 'Create a new local copy', attrs: { value: '__new__' } }),
            ...row.candidates.map((candidate) => el('option', { text: `Reuse ${candidate.name} · ${candidate.id}`, attrs: { value: candidate.id } })),
          ]);
          select.value = Object.hasOwn(activeDraft?.mappings ?? {}, row.sourceRecordId) ? (saved === null ? '__new__' : saved) : '';
          select.addEventListener('change', async () => {
            const mappings = { ...(activeDraft?.mappings ?? {}), [row.sourceRecordId]: select.value === '__new__' ? null : select.value };
            const next = { ...activeDraft, mappings, preview: null }; activeDraft = next; setDraft(next);
            status.textContent = 'Rechecking process pack choices against the current destination…';
            try {
              const response = await api(`/api/v1/projects/${encodeURIComponent(projectId)}/enterprise/import-preview`, {
                method: 'POST', body: JSON.stringify({ bundle: next.bundle, mappings }),
              });
              if (activeDraft === next && isCurrentContext()) showPreview({ ...next, preview: response.data });
            } catch (error) { if (activeDraft === next && isCurrentContext()) status.textContent = `Process pack mapping needs review: ${error.message}.`; }
          });
          mapChoices.push(el('label', { text: `Resolve name collision for ${row.sourceName}` }, [select]));
        }
      }
      if (mapChoices.length) previewRegion.append(el('fieldset', {}, [el('legend', { text: 'Resolve matching records explicitly' }), ...mapChoices]));
      previewRegion.append(fieldSummary('Declared process dependencies', preview.dependencies.map((entry) => ({ recordId: preview.rootId,
        field: `${entry.field} → ${entry.sourceName ?? entry.sourceId} · ${entry.includedInPack ? 'included in pack' : 'missing from pack'}` })), el));
      if (preview.omissions?.length) previewRegion.append(fieldSummary('Out-of-pack relationships omitted', preview.omissions.map((entry) => ({ recordId: entry.recordId, field: `${entry.field} · ${entry.count} omitted · ${entry.meaning}` })), el));
      if (preview.unresolvedDependencies?.length) previewRegion.append(fieldSummary('Missing dependencies and unresolved collisions', preview.unresolvedDependencies, el));
      if (!preview.ready) { previewRegion.append(el('p', { text: 'Resolve all pack dependencies and name collisions before applying.' })); return; }
      if (!writable) { previewRegion.append(el('p', { text: 'Applying a process pack requires a human workspace owner or editor with write access on the exact current target.' })); return; }
      const reason = ui.field('reason', 'Reason for importing this process pack', { multiline: true, maximum: 500, value: value.reason ?? '' });
      const apply = ui.form('import-design-pack', 'Apply reviewed process pack as one proposed version', [reason.node], () => {
        const payload = { kind: 'import-design-pack', bundle: activeDraft.bundle, mappings: activeDraft.mappings ?? {},
          previewHash: preview.previewHash, reason: reason.control.value.trim() };
        const next = { ...activeDraft, reason: payload.reason }; showPreview(next); onCommand(payload);
      }, !writable);
      previewRegion.append(apply);
      return;
    }
    previewRegion.append(el('h5', { text: 'Import preview' }),
      el('p', { text: `Source project ${preview.source.projectId} · blueprint ${preview.source.blueprintId} v${preview.source.blueprintVersion} · hash ${preview.source.snapshotHash}` }),
      el('p', { text: `Current destination: workspace v${preview.currentSource.projectVersion} · blueprint ${preview.currentSource.blueprintId} v${preview.currentSource.blueprintVersion} · hash ${preview.currentSource.snapshotHash}` }),
      el('p', { text: `${preview.recordCount} records · ${preview.recognizedFields} recognized fields · ${preview.readyRecordIds.length} ready to apply. Preview hash ${preview.previewHash}.` }),
      fieldSummary('Unknown fields (not applied)', preview.unknownFields, el),
      fieldSummary('Loss fields (preserved in destination)', preview.lossyFields, el),
      fieldSummary('Identity/type/field collisions (blocked)', preview.collisions, el),
      fieldSummary('Typed-reference/model validation errors (blocked)', preview.validationErrors, el));
    const impactRows = preview.rows.filter((row) => row.impact);
    if (impactRows.length) {
      const impactPanel = el('section', { attrs: { 'aria-label': 'Read-only direct import impact preview' } }, [
        el('h5', { text: 'Direct impact preview · INCOMPLETE' }),
        el('p', { text: 'Pins identify the exact current destination above. These field and relationship changes are read only; operational and downstream impact is UNKNOWN.' }),
      ]);
      for (const row of impactRows) {
        impactPanel.append(el('h6', { text: `${row.id} · ${row.type}` }));
        impactPanel.append(fieldSummary('Changed fields before → after', row.impact.changedFields.map((change) => ({
          recordId: row.id, field: `${change.field}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`,
        })), el));
        impactPanel.append(fieldSummary('Directly affected saved records', row.impact.directlyAffectedObjects.map((entry) => ({
          recordId: entry.objectId, field: `${entry.name} · ${entry.type}${entry.edited ? ' · edited' : ' · directly connected'}`,
        })), el));
      }
      impactPanel.append(fieldSummary('Not computed', impactRows.flatMap((row) => row.impact.unknownAreas), el));
      previewRegion.append(impactPanel);
    }
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
    const attempt = ++previewAttempt;
    try {
      const response = await api(`/api/v1/projects/${encodeURIComponent(projectId)}/enterprise/import-preview`, {
        method: 'POST', body: JSON.stringify({ bundle: value.bundle,
          ...(value.bundle?.kind === 'orgward-enterprise-process-pack' ? { mappings: value.mappings ?? {} } : {}) }),
      });
      if (activeDraft !== value || attempt !== previewAttempt || !isCurrentContext()) return;
      showPreview({ ...value, preview: response.data });
      status.textContent = 'Saved import draft rechecked against the current proposed design. Review it before applying.';
    } catch (error) {
      if (activeDraft !== value || attempt !== previewAttempt || !isCurrentContext()) return;
      status.textContent = `Saved import draft needs repair: ${error.message}. Its exact JSON remains available for editing and preview.`;
      showPreview({ ...value, preview: null });
    }
  }

  upload.addEventListener('click', async () => {
    const attempt = ++previewAttempt;
    const selectedFile = file.files?.[0];
    if (!selectedFile || loading || pending) { status.textContent = 'Choose an enterprise JSON bundle before previewing it.'; return; }
    if (selectedFile.size > 1_000_000) { status.textContent = 'Choose a bundle no larger than 1 MB.'; return; }
    upload.disabled = true; status.textContent = 'Reading bundle and checking its source identity…';
    let parsedBundle;
    let parsedSuccessfully = false;
    try {
      parsedBundle = JSON.parse(await selectedFile.text());
      parsedSuccessfully = true;
      if (attempt !== previewAttempt || !isCurrentContext()) return;
      const response = await api(`/api/v1/projects/${encodeURIComponent(projectId)}/enterprise/import-preview`, {
        method: 'POST', body: JSON.stringify({ bundle: parsedBundle }),
      });
      if (attempt !== previewAttempt || !isCurrentContext()) return;
      showPreview({ fileName: selectedFile.name, bundle: parsedBundle, preview: response.data, mappings: {}, recordIds: response.data.readyRecordIds ?? [], reason: '' });
      status.textContent = response.data.mode === 'DESIGN_PACK_PREVIEW'
        ? 'Process pack preview ready. Review untrusted source provenance, dependency closure, omissions, target mappings and exact target pin before applying.'
        : response.data.mode === 'SOURCE_ONBOARDING_PREVIEW'
        ? 'Source evidence preview ready. Review provenance, candidate identities, unknowns and collisions. Nothing has been saved or published.'
        : 'Import preview ready. Review every recognized, unknown, loss and collision field before applying.';
    } catch (error) {
      if (attempt !== previewAttempt || !isCurrentContext()) return;
      if (parsedSuccessfully) showPreview({ fileName: selectedFile.name, bundle: parsedBundle, preview: null, recordIds: [], reason: '' });
      status.textContent = `Import preview failed: ${error.message}. ${parsedSuccessfully ? 'The exact source JSON is retained for download, repair and retry.' : 'Choose a valid JSON source file and preview again.'}`;
    }
    finally { if (attempt === previewAttempt && isCurrentContext()) upload.disabled = !previewable; }
  });
  root.append(...(packExport ? [packExport] : []), download, file, upload, status, previewRegion);
  const hasActiveBundle = activeDraft && Object.hasOwn(activeDraft, 'bundle');
  if (hasActiveBundle && activeDraft.preview) showPreview(activeDraft);
  else if (hasActiveBundle) { status.textContent = 'Rechecking the saved import draft against the current proposed design…'; void restorePreview(activeDraft); }
  if (!writable) root.append(el('p', { text: 'Project readers can preview source evidence against the current saved main design. Applying proposed-design edits requires a human workspace editor viewing the current main design.' }));
  return root;
}
