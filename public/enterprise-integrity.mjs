export const ENTERPRISE_INTEGRITY_COMMANDS = ['run-integrity-checks', 'accept-integrity-exception'];

export function enterpriseIntegrityCommandPayload(model, reason) {
  if (!model?.blueprint || !model.context?.isCurrent || !model.permissions?.integrityRun
    || !/^[a-f0-9]{64}$/.test(model.context.snapshotHash ?? '') || typeof reason !== 'string' || !reason.trim()) return null;
  return { kind: 'run-integrity-checks', blueprintId: model.context.blueprintId,
    blueprintVersion: model.context.blueprintVersion, snapshotHash: model.context.snapshotHash, reason: reason.trim() };
}

export function enterpriseIntegrityExceptionPayload(model, assessment, finding, reason, expiryLocal = '') {
  const source = assessment?.source;
  if (!model?.blueprint || !model.context?.isCurrent || model.context?.sourceKind !== 'MAIN_DESIGN'
    || model.permissions?.integrityException !== true || !assessment?.appliesToContext
    || model.integrity?.current?.id !== assessment.id
    || !/^[a-f0-9]{64}$/.test(assessment.reportHash ?? '')
    || source?.blueprintId !== model.context.blueprintId || source?.blueprintVersion !== model.context.blueprintVersion
    || source?.snapshotHash !== model.context.snapshotHash
    || !assessment.findings?.some((entry) => entry.id === finding?.id)
    || typeof reason !== 'string' || !reason.trim() || reason.length > 500) return null;
  let expiresAt = null;
  if (expiryLocal) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(expiryLocal)) return null;
    const date = new Date(`${expiryLocal}Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== (expiryLocal.length === 16 ? `${expiryLocal}:00` : expiryLocal.split('.')[0])) return null;
    expiresAt = date.toISOString();
  }
  return { kind: 'accept-integrity-exception', findingId: finding.id, reportId: assessment.id,
    reportHash: assessment.reportHash, blueprintId: source.blueprintId, blueprintVersion: source.blueprintVersion,
    snapshotHash: source.snapshotHash, reason: reason.trim(), expiresAt };
}

export function renderEnterpriseIntegrity({ model, pending = null, draft = null, loading = false, el, ui, onCommand, onInspectFinding = null }) {
  if (!model?.blueprint) return null;
  const panel = el('section', { className: 'enterprise-integrity', attrs: { 'aria-label': 'Integrity and lineage assessment', tabindex: '-1' } }, [
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
  } else panel.append(el('p', { text: 'No integrity assessment has been saved for this project yet.' }));
  for (const older of (integrity.assessments ?? []).slice(0, -1).reverse()) {
    panel.append(el('details', { attrs: { 'data-integrity-history': older.id } }, [
      el('summary', { text: `Assessment for blueprint ${older.source.blueprintVersion} · ${older.status} · ${older.createdAt}` }),
      el('p', { text: `${older.counts.findings} findings · source ${older.source.snapshotHash} · ${older.createdBy} · ${older.reason}` }),
      ...(older.exceptions ?? []).map((exception) => el('p', { attrs: { 'data-exception-status': exception.status },
        text: `${exception.status} exception for ${exception.findingId}; its prior finding remains unresolved. ${exception.reason}` })),
    ]));
  }
  const staleExceptions = (integrity.exceptions ?? []).filter((entry) => entry.status === 'STALE');
  if (staleExceptions.length) panel.append(el('section', { attrs: { 'aria-label': 'Stale integrity exceptions', 'data-stale-exception-count': String(staleExceptions.length) } }, [
    el('h4', { text: 'Exceptions requiring re-review' }),
    el('p', { attrs: { role: 'status' }, text: `${staleExceptions.length} prior exception(s) are STALE because their source changed. They do not carry forward. Review a finding in the current report and accept a new exact-source exception only after explicit human review.` }),
    el('ul', {}, staleExceptions.map((exception) => el('li', { attrs: { 'data-exception-status': exception.status },
      text: `STALE · finding ${exception.findingId} · report ${exception.reportId} (${exception.reportHash}) · blueprint ${exception.blueprintId} v${exception.blueprintVersion} (${exception.snapshotHash}) · ${exception.actor} · ${exception.acceptedAt}${exception.expiresAt ? ` · expired ${exception.expiresAt}` : ''} · ${exception.reason}. The finding remains unresolved.` }))),
  ]));
  const inbox = integrity.remediationInbox;
  if (inbox) {
    const section = el('section', { className: 'integrity-remediation-inbox', attrs: { 'aria-label': 'Integrity remediation inbox' } }, [
      el('h3', { text: 'Remediation inbox' }),
      el('p', { text: `${inbox.unresolvedFindings} unresolved findings across ${inbox.reportWindowCount} recent saved reports (${inbox.totalSavedReports} reports in saved history). ${inbox.driftedReports} report sources differ from the current blueprint. Findings remain unresolved regardless of exception state.` }),
      el('p', { text: `Severity coverage · high ${inbox.bySeverity.high} · medium ${inbox.bySeverity.medium} · low ${inbox.bySeverity.low}. Exceptions · active ${inbox.exceptionCoverage.ACTIVE} · expired ${inbox.exceptionCoverage.EXPIRED} · stale ${inbox.exceptionCoverage.STALE} · none ${inbox.exceptionCoverage.NONE}.` }),
      el('ul', { attrs: { 'aria-label': 'Rule coverage' } }, inbox.byRule.map((rule) => el('li', { attrs: { 'data-remediation-rule': rule.ruleId },
        text: `${rule.ruleId} · ${rule.findings} findings across ${rule.reports} reports` }))),
    ]);
    if (inbox.omittedItems) section.append(el('p', { attrs: { role: 'status' }, text: `Showing ${inbox.visibleItems} of ${inbox.totalFindings} findings; ${inbox.omittedItems} older findings are omitted from this bounded inbox projection.` }));
    const list = el('ol', { attrs: { 'aria-label': 'Unresolved remediation items' } });
    const assessments = new Map([...(integrity.assessments ?? []), ...(integrity.current ? [integrity.current] : [])]
      .map((entry) => [entry.id, entry]));
    const renderItem = (item, allowExceptionForm = true) => {
      const finding = item.finding;
      const itemExceptions = item.exceptions?.length ? item.exceptions : item.exception ? [item.exception] : [];
      const row = el('li', { attrs: { 'data-remediation-report': item.reportId, 'data-remediation-finding': finding.id, 'data-remediation-status': 'UNRESOLVED' } }, [
        el('h4', { text: `${finding.severity.toUpperCase()} · ${finding.ruleId} · ${finding.code}` }),
        el('p', { text: `Target: ${finding.objectId ?? finding.path ?? 'Blueprint'}` }),
        el('p', { text: `${finding.message} Suggested action: ${finding.action}` }),
        el('p', { attrs: { role: 'status' }, text: `UNRESOLVED · ${item.reportDrift ? 'SOURCE DRIFT · this report is not for the current blueprint.' : 'Report source matches the current blueprint.'}${item.notReturnedInLatest ? ` · Not returned in latest same-source report ${item.latestSameSourceReportId}; this historical finding remains unresolved and needs review.` : ''} Report ${item.reportId} · ${item.reportHash} · blueprint ${item.source.blueprintVersion} · ${item.source.snapshotHash}.` }),
        ...(itemExceptions.length ? itemExceptions.map((exception) => el('p', { attrs: { role: 'status', 'data-exception-status': exception.status },
          text: `${exception.status} exception · ${exception.actor} · accepted ${exception.acceptedAt} · expires ${exception.expiresAt ?? 'never'} · ${exception.reason}. Finding remains unresolved.` }))
          : [el('p', { attrs: { role: 'status' }, text: 'No exception recorded for this exact finding and report.' })]),
      ]);
      const inspect = el('button', { className: 'button ghost', text: finding.objectId ? 'Inspect record in current design' : 'Open current design report', attrs: { type: 'button' } });
      inspect.addEventListener('click', () => onInspectFinding?.(finding, item)); row.append(inspect);
      const savedAssessment = assessments.get(item.reportId);
      if (allowExceptionForm && !item.reportDrift && item.appliesToContext && model.integrity?.current?.id === item.reportId
        && model.context?.isCurrent && model.context?.sourceKind === 'MAIN_DESIGN'
        && model.permissions?.integrityException === true && !itemExceptions.some((exception) => exception.status === 'ACTIVE') && savedAssessment) {
        const reason = ui.field(`exception-reason-${item.reportId}-${finding.id}`, 'Reason for accepting this exception', { maximum: 500 });
        const expiry = ui.field(`exception-expiry-${item.reportId}-${finding.id}`, 'Expiry in UTC (optional)', { required: false, type: 'datetime-local' });
        row.append(ui.form(`accept-integrity-exception-${item.reportId}-${finding.id}`, 'Accept exception for this finding', [reason.node, expiry.node], () => {
          const command = enterpriseIntegrityExceptionPayload(model, savedAssessment, finding, reason.control.value, expiry.control.value);
          if (command) onCommand(command);
        }, loading || Boolean(pending)));
      }
      return row;
    };
    for (const item of inbox.items) list.append(renderItem(item));
    if (!inbox.items.length) list.append(el('li', { text: 'No unresolved findings were returned for the saved reports in this inbox window.' }));
    section.append(list); panel.append(section);
    const currentAssessment = integrity.current;
    const inboxKeys = new Set(inbox.items.map((item) => `${item.reportId}\n${item.finding.id}`));
    const currentSource = inbox.currentSource;
    const currentFallbackItems = currentAssessment?.appliesToContext ? currentAssessment.findings
      .filter((finding) => !inboxKeys.has(`${currentAssessment.id}\n${finding.id}`))
      .map((finding) => {
        const exceptions = (currentAssessment.exceptions ?? []).filter((exception) => exception.findingId === finding.id);
        return { reportId: currentAssessment.id, reportHash: currentAssessment.reportHash, source: currentAssessment.source,
          reportCreatedAt: currentAssessment.createdAt, reportStatus: currentAssessment.status,
          reportDrift: !currentSource || currentAssessment.source.blueprintId !== currentSource.blueprintId
            || currentAssessment.source.blueprintVersion !== currentSource.blueprintVersion
            || currentAssessment.source.snapshotHash !== currentSource.snapshotHash,
          appliesToContext: true, latestSameSourceReportId: currentAssessment.id,
          notReturnedInLatest: false, finding, status: 'UNRESOLVED', exception: exceptions.at(-1) ?? null, exceptions };
      }) : [];
    if (currentFallbackItems.length) panel.append(el('section', { attrs: { 'aria-label': 'Current context findings omitted from recent inbox' } }, [
      el('h3', { text: 'Current context findings omitted from the recent inbox' }),
      el('p', { attrs: { role: 'status' }, text: 'These findings belong to the assessment for the selected blueprint and are retained here because they are outside the bounded inbox projection. They remain unresolved; exception actions are available only from the current applicable report row in the inbox.' }),
      el('ol', {}, currentFallbackItems.map((item) => renderItem(item, false))),
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
