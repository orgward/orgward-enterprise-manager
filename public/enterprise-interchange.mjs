export const ENTERPRISE_INTERCHANGE_COMMANDS = ['bulk-edit-objects', 'accept-source-evidence', 'compare-source-evidence', 'import-design-pack'];
export const ENTERPRISE_SOURCE_ATTESTATION_COMMANDS = ['configure-source-attestation-profile', 'ingest-source-attestation-manifest',
  'propose-attested-source-correction', 'repair-source-claim-mapping', 'recompute-source-reconciliation-report'];
export function enterpriseInterchangeWritable(model) {
  return Boolean(model?.permissions?.write && model.context?.isCurrent === true && model.blueprint
    && model.context?.effectiveAt == null && model.context?.recordedAtCutoff == null && !model.context?.proposalId && !model.context?.branchId);
}
export function enterpriseInterchangeCommandPayload(model, payload) {
  if (!enterpriseInterchangeWritable(model) || !ENTERPRISE_INTERCHANGE_COMMANDS.includes(payload?.kind)) return null;
  if (payload.kind === 'accept-source-evidence' && (!/^[a-f0-9]{64}$/.test(payload.blueprintHash ?? '')
    || !/^[a-f0-9]{64}$/.test(payload.previewHash ?? '') || !Array.isArray(payload.selections) || !payload.selections.length)) return null;
  if (payload.kind === 'compare-source-evidence' && (!/^source-acceptance-[0-9a-f-]{36}$/.test(payload.acceptanceReceiptId ?? '')
    || !payload.bundle || typeof payload.bundle !== 'object')) return null;
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

function renderSourceAttestation({ projectId, model, el, ui, onCommand, loading, pending }) {
  const root = el('div');
  const profiles = model.sourceAttestationProfiles ?? [];
  const heads = [...new Map(profiles.map((entry) => [entry.id, entry])).values()];
  if (model.permissions?.sourceAttestationAdmin) {
    root.append(el('h5', { text: 'Trusted collector attestation profiles' }),
      el('p', { text: 'An owner pins scope, expected push interval, collector public key and freshness policy. The signed push endpoint authenticates collector statements only; it does not independently verify third-party acquisition or source truth.' }));
    for (const profile of heads) {
      root.append(el('p', { attrs: { role: 'status', 'data-source-profile-status': profile.id }, text: `${profile.id} v${profile.version} · ${profile.sourceId}/${profile.sourceAccountId}/${profile.sourceInstanceId}/${profile.resourceNamespace} · collector ${profile.collectorId} · ${profile.active ? 'active' : 'revoked'} · push interval ${profile.intervalSeconds}s · freshness ${profile.freshnessPolicy.maxAgeSeconds}s · ${profile.pushStatus?.status ?? 'UNKNOWN'}${profile.pushStatus?.reason ? ` — ${profile.pushStatus.reason}` : ''} · key ${profile.activeKeyId ?? 'none'}` }));
      root.append(el('p', { text: `Collector push endpoint: POST /api/v1/tenants/${profile.tenantId}/projects/${projectId}/source-attestation-profiles/${profile.id}/manifests. Send a signed complete snapshot every ${profile.intervalSeconds}s, including when values have not changed.` }));
    }
    const mode = ui.field('mode', 'Profile change', { entries: [['CREATE', 'Create profile'], ['UPDATE', 'Update scope or freshness policy'],
      ['ROTATE_KEY', 'Rotate collector key'], ['REVOKE_KEY', 'Revoke active collector key']] });
    const existing = ui.field('profileId', 'Existing profile', { required: false,
      entries: [['', 'Choose a profile'], ...heads.map((entry) => [entry.id, `${entry.sourceId} · v${entry.version} · ${entry.active ? 'active' : 'revoked'}`])] });
    const sourceId = ui.field('sourceId', 'Source ID', { maximum: 120 });
    const accountId = ui.field('sourceAccountId', 'Source account ID', { maximum: 120 });
    const instanceId = ui.field('sourceInstanceId', 'Source instance ID', { maximum: 120 });
    const namespace = ui.field('resourceNamespace', 'Resource namespace', { maximum: 120 });
    const collector = ui.field('collectorId', 'Permitted collector ID', { maximum: 120 });
    const recordTypes = ui.field('recordTypes', 'Covered record types (comma separated)', { maximum: 500 });
    const paths = ui.field('paths', 'Covered claim paths (comma separated)', { maximum: 1000 });
    const keyId = ui.field('keyId', 'Ed25519 key ID', { maximum: 120, required: false });
    const publicKey = ui.field('publicKeyPem', 'Ed25519 public key PEM (never paste a private key)', { multiline: true, maximum: 4000, required: false });
    const keyFields = el('div', {}, [keyId.node, publicKey.node]);
    const maxAge = ui.field('maxAgeSeconds', 'Maximum observation age in seconds', { type: 'number', maximum: 10 });
    const interval = ui.field('intervalSeconds', 'Expected collector push interval in seconds', { type: 'number', maximum: 10 });
    const maxSkew = ui.field('maxClockSkewSeconds', 'Maximum collector clock skew in seconds', { type: 'number', maximum: 10 });
    const reason = ui.field('reason', 'Reason for this owner-controlled profile version', { multiline: true, maximum: 500 });
    const fill = () => {
      const profile = heads.find((entry) => entry.id === existing.control.value); if (!profile) return;
      sourceId.control.value = profile.sourceId; accountId.control.value = profile.sourceAccountId;
      instanceId.control.value = profile.sourceInstanceId; namespace.control.value = profile.resourceNamespace;
      collector.control.value = profile.collectorId; recordTypes.control.value = profile.coverageScope.recordTypes.join(', ');
      paths.control.value = profile.coverageScope.paths.join(', '); maxAge.control.value = String(profile.freshnessPolicy.maxAgeSeconds);
      interval.control.value = String(profile.intervalSeconds);
      maxSkew.control.value = String(profile.freshnessPolicy.maxClockSkewSeconds);
      const active = profile.keys.find((key) => key.keyId === profile.activeKeyId);
      keyId.control.value = ''; publicKey.control.value = '';
      keyId.control.placeholder = active ? `Current: ${active.keyId} v${active.keyVersion} · ${active.fingerprint}` : 'No active key';
    };
    existing.control.addEventListener('change', fill);
    mode.control.addEventListener('change', () => {
      existing.node.hidden = mode.control.value === 'CREATE';
      keyFields.hidden = ['UPDATE', 'REVOKE_KEY'].includes(mode.control.value);
      if (mode.control.value === 'CREATE') existing.control.value = ''; else fill();
    });
    existing.node.hidden = true;
    const form = ui.form('configure-source-attestation-profile', 'Save immutable source profile version', [mode.node, existing.node,
      sourceId.node, accountId.node, instanceId.node, namespace.node, collector.node, recordTypes.node, paths.node, keyFields,
      interval.node, maxAge.node, maxSkew.node, reason.node], () => {
      const profile = { sourceId: sourceId.control.value.trim(), sourceAccountId: accountId.control.value.trim(),
        sourceInstanceId: instanceId.control.value.trim(), resourceNamespace: namespace.control.value.trim(),
        collectorId: collector.control.value.trim(), coverageScope: { recordTypes: recordTypes.control.value.split(',').map((v) => v.trim()).filter(Boolean),
          paths: paths.control.value.split(',').map((v) => v.trim()).filter(Boolean) },
        intervalSeconds: Number(interval.control.value), freshnessPolicy: { maxAgeSeconds: Number(maxAge.control.value), maxClockSkewSeconds: Number(maxSkew.control.value) } };
      if (!['UPDATE', 'REVOKE_KEY'].includes(mode.control.value)) Object.assign(profile,
        { keyId: keyId.control.value.trim(), publicKeyPem: publicKey.control.value.trim() });
      const selected = heads.find((entry) => entry.id === existing.control.value);
      onCommand({ kind: 'configure-source-attestation-profile', mode: mode.control.value,
        ...(mode.control.value !== 'CREATE' && selected ? { profileId: selected.id, expectedProfileVersion: selected.version } : {}),
        profile, reason: reason.control.value.trim() });
    }, !model.permissions.sourceAttestationAdmin || loading || Boolean(pending));
    root.append(form);
  }
  if (model.permissions?.write && model.context?.isCurrent && !model.context?.branchId && !model.context?.proposalId
    && model.context?.effectiveAt == null && model.context?.recordedAtCutoff == null) {
    const manifest = ui.field('manifest', 'Signed source observation manifest JSON', { multiline: true, maximum: 1_000_000 });
    const form = ui.form('ingest-source-attestation-manifest', 'Verify collector signature and reconcile manifest', [manifest.node,
      el('p', { text: 'The pinned key verifies the collector signature, not the third-party source acquisition or factual truth. The report is pinned to the accepted baseline and profile policy.' })], () => {
      let value; try { value = JSON.parse(manifest.control.value); } catch { throw new Error('Paste valid signed observation manifest JSON.'); }
      onCommand({ kind: 'ingest-source-attestation-manifest', manifest: value });
    }, loading || Boolean(pending));
    root.append(el('h5', { text: 'Signed collector observation intake' }), form);
  }
  return root;
}

function renderAttestedCorrectionAction({ projectId, model, report, finding, el, ui, api, onCommand, loading, pending }) {
  const root = el('div', { attrs: { 'data-attested-correction-finding': finding.findingId } });
  root.append(el('p', { attrs: { role: 'status' }, text: `Pending review · finding ${finding.findingId} · row ${finding.findingRowIndex}` }));
  const prior = (model.sourceAttestationCorrectionReceipts ?? []).find((entry) => entry.findingId === finding.findingId);
  if (prior) {
    root.append(el('p', { text: `Proposed correction ${prior.candidate.id} v${prior.candidate.version} · finding remains PENDING_REVIEW · no approval or publication is implied.` }));
    return root;
  }
  if (!model.permissions?.sourceAttestationAdmin || !enterpriseInterchangeWritable(model)) return root;
  const manifest = ui.field('signed-manifest', 'Reupload the exact signed manifest pinned by this report', { multiline: true, maximum: 1_000_000 });
  const review = el('button', { text: 'Review signed finding', attrs: { type: 'button' } });
  review.disabled = loading || Boolean(pending);
  const message = el('p', { attrs: { role: 'status', 'aria-live': 'polite' } });
  const result = el('div');
  root.append(manifest.node, review, message, result);
  review.addEventListener('click', async () => {
    let value;
    try { value = JSON.parse(manifest.control.value); } catch { message.textContent = 'Paste the exact signed manifest JSON for this report.'; return; }
    review.disabled = true; message.textContent = 'Verifying the pinned finding and rebuilding its typed proposal preview…'; result.replaceChildren();
    try {
      const response = await api(`/api/v1/projects/${encodeURIComponent(projectId)}/enterprise/attestation-proposal-preview`, {
        method: 'POST', body: JSON.stringify({ reportId: report.id, reportHash: report.reportHash, findingId: finding.findingId, manifest: value }),
      });
      const preview = response.data;
      if (!preview?.finding || preview.finding.findingId !== finding.findingId || preview.manifestHash !== report.manifest?.hash) {
        throw new Error('The server did not return the report’s pinned finding preview.');
      }
      message.textContent = `Verified exact report ${preview.reportId} · manifest ${preview.manifestHash} · current design ${preview.currentSource.blueprintId} v${preview.currentSource.blueprintVersion}. No design change has been made.`;
      const proposal = preview.proposals.find((entry) => entry.identity.sourceRecordId === finding.sourceRecordId);
      if (!proposal) throw new Error('The finding’s exact source record is absent from its signed manifest.');
      const canonicalObjects = Object.values(model.blueprint.areas ?? {}).flatMap((area) => area.items ?? []);
      const targetChoices = canonicalObjects.filter((object) => object.type === proposal.identity.type);
      const mappedTarget = canonicalObjects.find((object) => object.id === finding.targetObjectId && object.type === proposal.identity.type);
      const allowedTargets = finding.status === 'CONTRADICTED' ? targetChoices.filter((object) => object.id === finding.targetObjectId) : targetChoices;
      const target = el('select', { attrs: { name: `attested-target-${finding.findingId}`, 'aria-label': `Canonical target for ${proposal.identity.name}` } }, [
        el('option', { text: 'Choose canonical target', attrs: { value: '' } }),
        ...allowedTargets.map((object) => el('option', { text: `${object.name} · ${object.id}`, attrs: { value: object.id } })),
      ]);
      target.required = true;
      const selections = el('fieldset');
      selections.append(el('legend', { text: `Select source claims for ${finding.sourceRecordId}` }));
      const selectedClaims = [];
      for (const claim of proposal.claims) {
        const input = el('input', { attrs: { type: 'checkbox', name: `attested-claim-${finding.findingId}`, value: claim.id } });
        input.checked = claim.id === finding.claimId;
        input.disabled = !['PROPOSED', 'IDENTITY_UNRESOLVED'].includes(claim.status);
        selections.append(el('label', {}, [input, el('span', { text: `${claim.path} · ${claim.status} · ${JSON.stringify(claim.value)} · ${claim.provenance.claimLocator ?? 'claim locator unknown'}` })]));
        selectedClaims.push({ input, claim });
      }
      const reason = ui.field('reason', 'Reason for proposing this correction', { multiline: true, maximum: 500 });
      const proposalForm = ui.form('propose-attested-source-correction', 'Create proposed correction', [
        el('p', { text: 'This creates one proposed-design version. The finding stays PENDING_REVIEW; this action does not approve or publish it.' }),
        ...(finding.status === 'CONTRADICTED' ? [el('p', { text: 'Confirm the canonical target pinned by this finding; a different target is rejected.' })] : []),
        el('label', { text: 'Canonical target' }, [target]), selections, reason.node,
      ], () => {
        const claimIds = selectedClaims.filter(({ input }) => input.checked).map(({ input }) => input.value);
        if (!claimIds.includes(finding.claimId) || !target.value) throw new Error('Keep the exact finding claim selected and choose its canonical target.');
        if (target.value !== finding.targetObjectId) throw new Error('The contradicted finding must retain its pinned canonical target.');
        onCommand({ kind: 'propose-attested-source-correction', reportId: report.id, reportHash: report.reportHash,
          findingId: finding.findingId, manifest: value, previewHash: preview.previewHash,
          blueprintHash: preview.currentSource.snapshotHash, blueprintId: preview.currentSource.blueprintId,
          blueprintVersion: preview.currentSource.blueprintVersion,
          selections: [{ sourceRecordId: proposal.identity.sourceRecordId, targetObjectId: target.value, claimIds }], reason: reason.control.value.trim() });
      }, loading || Boolean(pending));
      result.append(el('p', { text: `Evidence baseline ${finding.targetObjectId} · ${finding.path} · accepted ${JSON.stringify(finding.acceptedValue)} · observed ${JSON.stringify(finding.observedValue)}.` }), proposalForm);
    } catch (error) {
      message.textContent = error.message;
    } finally { review.disabled = false; }
  });
  return root;
}

export function renderEnterpriseInterchange({ projectId, model, object = null, draft = null, pending = null, loading = false, el, ui, api, onCommand, onDraftChange,
  isCurrentContext = () => true }) {
  if (!model.blueprint) return null;
  const root = el('section', { attrs: { 'data-enterprise-interchange': '', 'aria-label': 'Proposed design export and import' } }, [
    el('h4', { text: 'Proposed design export and bulk import' }),
    el('p', { text: 'Proposed-design bundles can be reviewed for editable changes, but importing them never runs or publishes work. Source-evidence bundles produce typed identity and claim proposals with source provenance; preview does not authenticate sources, verify claim truth, write records or publish design.' }),
  ]);
  const reports = [...(model.sourceReconciliationReports ?? [])].reverse();
  if (reports.length) {
    const history = el('section', { attrs: { 'aria-label': 'Source evidence and reconciliation history', 'data-source-reconciliation-history': '' } }, [
      el('h5', { text: 'Source evidence and reconciliation history' }),
      el('p', { text: 'Manual uploaded comparisons remain source unverified with freshness unknown. Reports are pinned to their accepted input and do not by themselves change design authority.' }),
    ]);
    for (const report of reports.slice(0, 10)) {
      const currentness = [...(model.sourceReconciliationCurrentness ?? [])].reverse().find((entry) => entry.reportId === report.id);
      const activeProfile = [...(model.sourceAttestationProfiles ?? [])].filter((profile) => profile.id === report.sourceProfile?.id).at(-1);
      const entry = el('details', { attrs: { 'data-source-reconciliation-report': report.id } }, [
        el('summary', { text: `${report.receivedAt} · ${report.input?.sourceId ?? report.sourceProfile?.sourceId ?? 'unknown source'} · ${report.counts?.DRIFTED ?? report.counts?.CONTRADICTED ?? 0} changed/contradicted · ${report.counts?.MISSING ?? 0} absent · ${report.counts?.UNVERIFIABLE ?? 0} unverifiable` }),
        el('p', { text: `Uploader ${report.uploader} · system receipt/evaluation ${report.receivedAt} · input hash ${report.input?.sourceBundleHash ?? report.manifest?.hash ?? 'unknown'} · baseline ${report.baseline?.acceptanceReceiptId ?? 'unavailable'} · sourceAuthentication ${report.sourceAuthentication} · freshness ${report.freshness}` }),
      ]);
      if (report.comparatorVersion === 'collector-attestation/v1') entry.append(el('p', { attrs: { role: 'status', 'data-source-report-currentness': report.id },
        text: `${currentness?.state ?? 'UNTRACKED'} · mapping revision ${currentness?.mappingRevision ?? report.mappingRevision ?? 1}${currentness?.reason ? ` · ${currentness.reason}` : ''}` }));
      if (report.comparatorVersion === 'collector-attestation/v1' && currentness?.state === 'STALE'
        && activeProfile?.pushStatus?.reportId === report.id
        && model.permissions?.sourceAttestationAdmin && enterpriseInterchangeWritable(model)) {
        const manifestField = ui.field(`recompute-manifest-${report.id}`, 'Reupload exact signed manifest for this report', { multiline: true, maximum: 1_000_000 });
        entry.append(ui.form('recompute-source-reconciliation-report', 'Recompute this report consumer', [manifestField.node,
          el('p', { text: 'Recomputation writes a new immutable report. This historical report and its original status remain unchanged.' })], () => {
          let manifest; try { manifest = JSON.parse(manifestField.control.value); } catch { throw new Error('Paste the exact signed manifest JSON for this report.'); }
          onCommand({ kind: 'recompute-source-reconciliation-report', reportId: report.id, reportHash: report.reportHash, manifest });
        }, loading || Boolean(pending)));
      }
      if (report.comparatorVersion === 'collector-attestation/v1') entry.append(el('p', { text: `${currentness?.state === 'FRESH' ? 'This is current' : 'Historical status only; this report is not current'} collector-attested evidence under the saved freshness policy; third-party source truth/acquisition are not independently verified.` }));
      for (const claim of report.claims ?? []) {
        const label = claim.status === 'DRIFTED' ? 'Changed in upload' : claim.status === 'MISSING' ? 'Absent from upload' : claim.status;
      entry.append(el('p', { text: `${claim.sourceRecordId} → ${claim.targetObjectId} · ${claim.path} · ${label} · ${claim.reason}` }));
      if (report.comparatorVersion === 'collector-attestation/v1' && claim.targetObjectId && claim.claimId
        && model.permissions?.sourceAttestationAdmin && enterpriseInterchangeWritable(model)) {
        const revisions = (model.sourceAttestationMappingRevisions ?? []).filter((revision) => revision.profileId === report.sourceProfile.id);
        const mappingVersion = revisions.at(-1)?.version ?? 1;
        const objects = Object.values(model.blueprint.areas ?? {}).flatMap((area) => area.items ?? []);
        const target = el('select', { attrs: { 'aria-label': `Replacement target for ${claim.sourceRecordId} ${claim.path}` } }, [
          el('option', { text: 'Choose replacement target', attrs: { value: '' } }),
          ...objects.filter((object) => object.id !== claim.targetObjectId).map((object) => el('option', {
            text: `${object.name} · ${object.id}`, attrs: { value: object.id } })),
        ]);
        const reason = ui.field(`mapping-repair-reason-${report.id}-${claim.claimId}`, 'Reason for source mapping repair', { multiline: true, maximum: 500 });
        entry.append(ui.form('repair-source-claim-mapping', 'Repair exact source claim mapping', [
          el('p', { text: `Pinned old binding: ${claim.sourceRecordId}/${claim.claimId}/${claim.path} → ${claim.targetObjectId} · mapping v${mappingVersion}` }),
          el('label', { text: 'Replacement canonical target' }, [target]), reason.node,
        ], () => {
          if (!target.value) throw new Error('Choose a replacement canonical target.');
          onCommand({ kind: 'repair-source-claim-mapping', profileId: report.sourceProfile.id,
            expectedProfileVersion: activeProfile?.version, expectedMappingVersion: mappingVersion,
            baselineAcceptanceReceiptId: report.baseline?.acceptanceReceiptId, baselineReceiptHash: report.baseline?.receiptHash,
            reportId: report.id, reportHash: report.reportHash,
            oldBinding: { sourceRecordId: claim.sourceRecordId, claimId: claim.claimId, path: claim.path, targetObjectId: claim.targetObjectId },
            replacementTargetObjectId: target.value, reason: reason.control.value.trim() });
        }, loading || Boolean(pending)));
      }
      if (claim.findingId) entry.append(renderAttestedCorrectionAction({ projectId, model, report, finding: claim,
        el, ui, api, onCommand, loading, pending }));
      }
      for (const issue of report.issues ?? []) entry.append(el('p', { text: `${issue.status} · ${issue.reason}` }));
      history.append(entry);
    }
    root.append(history);
  }
  root.append(renderSourceAttestation({ projectId, model, el, ui, onCommand, loading, pending }));
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
      previewRegion.append(el('h5', { text: 'Uploaded claim comparison — source unverified' }),
        el('p', { text: 'Compare this upload only with values explicitly accepted from the selected baseline. This does not authenticate the source or establish freshness, truth, or current-design applicability.' }));
      const baselines = model.sourceAcceptanceReceipts ?? [];
      if (baselines.length) {
        const baselineSelect = el('select', { attrs: { 'aria-label': 'Accepted source comparison baseline', name: 'source-acceptance-baseline' } }, [
          el('option', { text: 'Choose an explicit accepted source baseline', attrs: { value: '' } }),
          ...baselines.map((baseline) => el('option', { text: `${baseline.source.id} · accepted ${baseline.receivedAt} · blueprint ${baseline.acceptedBlueprint.version} · ${baseline.id}`, attrs: { value: baseline.id } })),
        ]);
        const compare = el('button', { className: 'button ghost', text: 'Compare uploaded claims', attrs: { type: 'button' } });
        compare.disabled = !writable;
        compare.addEventListener('click', () => {
          if (!writable || !activeDraft?.bundle || !baselineSelect.value) return;
          onCommand({ kind: 'compare-source-evidence', acceptanceReceiptId: baselineSelect.value, bundle: activeDraft.bundle });
        });
        previewRegion.append(el('label', { text: 'Accepted source baseline' }, [baselineSelect]), compare);
      } else {
        previewRegion.append(el('p', { text: 'No accepted source baseline is available yet. Explicitly accept selected claims before comparing later uploads.' }));
      }
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
        : (() => {
          const impactRows = response.data.rows?.filter((row) => row.impact) ?? [];
          const impactSummary = impactRows.length
            ? ` ${impactRows.length} record${impactRows.length === 1 ? ' has' : 's have'} direct impact preview marked INCOMPLETE; operational and downstream impact is UNKNOWN.`
            : '';
          return `Import preview ready.${impactSummary} Review every recognized, unknown, loss and collision field before applying.`;
        })();
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
