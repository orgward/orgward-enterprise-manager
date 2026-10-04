export function enterpriseIntegrityCommandPayload(model, reason) {
  if (!model?.blueprint || !model.context?.isCurrent || !model.permissions?.integrityRun
    || !/^[a-f0-9]{64}$/.test(model.context.snapshotHash ?? '') || typeof reason !== 'string' || !reason.trim()) return null;
  return { kind: 'run-integrity-checks', blueprintId: model.context.blueprintId,
    blueprintVersion: model.context.blueprintVersion, snapshotHash: model.context.snapshotHash, reason: reason.trim() };
}

export function renderEnterpriseIntegrity({ model, pending = null, draft = null, loading = false, el, ui, onCommand }) {
  if (!model?.blueprint) return null;
  const panel = el('section', { className: 'enterprise-integrity', attrs: { 'aria-label': 'Integrity and lineage assessment' } }, [
    el('h3', { text: 'Integrity and lineage checks' }),
    el('p', { text: 'Run deterministic structure, typed-reference, canonical relationship and design-gap checks against this exact saved blueprint. A report never changes design, grants authority or verifies business outcomes.' }),
  ]);
  const integrity = model.integrity ?? { current: null, latest: null, assessments: [] };
  const displayed = integrity.current ?? integrity.latest;
  if (displayed) {
    const assessment = displayed;
    if (!assessment.appliesToContext) panel.append(el('p', { attrs: { role: 'status', 'data-integrity-stale': 'true' },
      text: `STALE · This saved assessment is for blueprint ${assessment.source.blueprintVersion} and does not apply to the selected snapshot. Its original source, rules and findings are retained for review; run checks on the current source before relying on a current assessment.` }));
    panel.append(el('p', { attrs: { 'data-integrity-status': assessment.status, role: 'status' },
      text: `${assessment.status} · ${assessment.counts.failedRules} failed rules · ${assessment.counts.reviewRules} rules need design review · ${assessment.counts.findings} findings · assessed ${assessment.createdAt}.` }));
    panel.append(el('p', { text: `Saved source: blueprint ${assessment.source.blueprintVersion} · ${assessment.source.snapshotHash} · ${assessment.createdBy}. Reason: ${assessment.reason}` }));
    for (const rule of assessment.rules) panel.append(el('p', { attrs: { 'data-integrity-rule': rule.id },
      text: `${rule.id}: ${rule.status} · ${rule.findingCount} findings · ${rule.summary}` }));
    if (!assessment.findings.length) panel.append(el('p', { text: 'No typed structure, lineage or completeness findings were returned for this saved source.' }));
    else {
      const list = el('ol', { attrs: { 'aria-label': 'Integrity findings' } });
      for (const entry of assessment.findings) list.append(el('li', { attrs: { 'data-integrity-finding': entry.id },
        text: `${entry.severity.toUpperCase()} · ${entry.code} · ${entry.objectId ?? entry.path ?? 'Blueprint'}: ${entry.message} Suggested action: ${entry.action}` }));
      panel.append(list);
    }
  } else panel.append(el('p', { text: 'No integrity assessment has been saved for this project yet.' }));
  for (const older of (integrity.assessments ?? []).slice(0, -1).reverse()) {
    panel.append(el('details', { attrs: { 'data-integrity-history': older.id } }, [
      el('summary', { text: `Assessment for blueprint ${older.source.blueprintVersion} · ${older.status} · ${older.createdAt}` }),
      el('p', { text: `${older.counts.findings} findings · source ${older.source.snapshotHash} · ${older.createdBy} · ${older.reason}` }),
    ]));
  }
  const savedReason = pending?.envelope?.payload?.kind === 'run-integrity-checks'
    ? pending.envelope.payload.reason : draft?.reason;
  const reason = ui.field('reason', 'Reason for running these checks', { multiline: true, maximum: 500, value: savedReason ?? '' });
  const payload = () => enterpriseIntegrityCommandPayload(model, reason.control.value);
  const writable = model.permissions?.integrityRun === true && model.context?.isCurrent === true;
  panel.append(ui.form('run-integrity-checks', 'Run integrity and lineage checks', [reason.node], () => {
    const command = payload(); if (command) onCommand(command);
  }, loading || Boolean(pending) || !writable));
  if (!writable && model.context?.isCurrent) panel.append(el('p', { text: 'A human workspace writer can run checks on the current saved design.' }));
  if (model.context?.sourceKind !== 'MAIN_DESIGN') panel.append(el('p', { text: 'Historical, future and branch snapshots are read-only; reports are run against the current saved main design.' }));
  return panel;
}
