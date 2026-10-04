export const ENTERPRISE_GOVERNANCE_COMMANDS = [
  'request-governance-decision', 'decide-governance-decision',
  'appeal-governance-decision', 'review-governance-appeal',
];

export function enterpriseGovernanceCommandPayload(model, kind, values = {}) {
  if (!model?.blueprint || !model.context?.isCurrent || !/^[a-f0-9]{64}$/.test(model.context.snapshotHash ?? '')
    || !ENTERPRISE_GOVERNANCE_COMMANDS.includes(kind)) return null;
  const base = { kind, blueprintId: model.context.blueprintId, blueprintVersion: model.context.blueprintVersion,
    snapshotHash: model.context.snapshotHash };
  if (kind === 'request-governance-decision') {
    if (model.permissions?.governanceRequest !== true) return null;
    return { ...base, objectId: values.objectId, title: values.title, question: values.question,
      proposedOption: values.proposedOption, reason: values.reason };
  }
  const item = model.governance?.cases?.find((entry) => entry.id === values.caseId);
  if (!item || !item.appliesToContext || item.sourceDrift || item.revision !== values.caseRevision) return null;
  if (kind === 'decide-governance-decision') {
    if (model.permissions?.governanceDecide !== true || item.status !== 'REQUESTED') return null;
  } else if (kind === 'appeal-governance-decision') {
    if (!item.canAppeal || item.status !== 'DECIDED') return null;
  } else if (model.permissions?.governanceReviewAppeal !== true || item.status !== 'APPEALED') return null;
  return { ...base, caseId: item.id, caseRevision: item.revision,
    ...(values.outcome ? { outcome: values.outcome } : {}), reason: values.reason };
}

export function renderEnterpriseGovernance({ model, pending = null, loading = false, el, ui, onCommand }) {
  if (!model?.blueprint) return null;
  const governance = model.governance ?? { cases: [], ledgerLength: 0, ledgerHead: null };
  const objects = Object.values(model.blueprint.areas ?? {}).flatMap((area) => area.items ?? [])
    .filter((entry) => entry && typeof entry.id === 'string');
  const byId = new Map(objects.map((entry) => [entry.id, entry]));
  const section = el('section', { className: 'enterprise-governance', attrs: { 'aria-label': 'Governance decision register' } }, [
    el('h3', { text: 'Governance decision register' }),
    el('p', { text: 'Submit a decision request against an exact saved design record. Owners record a decision; the requester can appeal it. These governance records do not edit, publish or activate the design.' }),
    el('p', { attrs: { role: 'status' }, text: `${governance.ledgerLength} append-only decision history entries · ledger head ${governance.ledgerHead ?? 'not started'}. Each entry is checked against the saved hash chain when this view loads.` }),
  ]);
  const currentSource = !model.context?.isCurrent || model.context?.sourceKind !== 'MAIN_DESIGN'
    ? `This context is read-only. Return to the current main design to record a governance decision.`
    : null;
  if (currentSource) section.append(el('p', { attrs: { role: 'status' }, text: currentSource }));
  if (model.permissions?.governanceRequest) {
    const object = ui.field('governance-object', 'Design record', { entries: objects.map((entry) => [entry.id, `${entry.name ?? entry.id} · ${entry.type ?? 'record'}`]),
      value: model.selection?.object?.id ?? '' });
    const title = ui.field('governance-title', 'Decision title', { maximum: 160 });
    const question = ui.field('governance-question', 'What decision is needed?', { multiline: true, maximum: 700 });
    const proposed = ui.field('governance-proposed-option', 'Your proposed option', { multiline: true, maximum: 300 });
    const reason = ui.field('governance-request-reason', 'Why is this decision needed?', { multiline: true, maximum: 500 });
    section.append(ui.form('request-governance-decision', 'Submit decision request', [object.node, title.node, question.node, proposed.node, reason.node], () => {
      const command = enterpriseGovernanceCommandPayload(model, 'request-governance-decision', { objectId: object.control.value,
        title: title.control.value, question: question.control.value, proposedOption: proposed.control.value, reason: reason.control.value });
      if (command) onCommand(command);
    }, loading || Boolean(pending) || !objects.length));
  } else if (model.context?.isCurrent) section.append(el('p', { text: 'A human workspace writer can submit a decision request. Project owners decide open requests and review appeals.' }));
  const list = el('ol', { attrs: { 'aria-label': 'Governance decisions' } });
  for (const item of [...governance.cases].reverse()) {
    const object = byId.get(item.objectId);
    const statusLabel = item.status === 'DECISION_UPHELD' ? 'DECISION UPHELD · APPEAL DENIED' : item.status.replaceAll('_', ' ');
    const row = el('li', { attrs: { 'data-governance-case': item.id, 'data-governance-status': item.status } }, [
      el('h4', { text: `${statusLabel} · ${item.title}` }),
      el('p', { text: `Record: ${object ? `${object.name} (${object.type})` : item.objectId}. ${item.question}` }),
      el('p', { text: `Requested option: ${item.proposedOption} · requested by ${item.requestedBy} · ${item.createdAt}. Reason: ${item.requestReason}` }),
      el('p', { attrs: { role: 'status' }, text: `${item.sourceDrift ? 'SOURCE DRIFT · This request belongs to a different current design source.' : item.appliesToContext ? 'Exact saved source applies to this context.' : 'This decision is retained for history and does not apply to the selected source.'} Blueprint v${item.source.blueprintVersion} · ${item.source.snapshotHash}.` }),
    ]);
    for (const decision of item.decisions) row.append(el('p', { attrs: { 'data-governance-decision': decision.outcome },
      text: `${decision.outcome} by ${decision.actor} · ${decision.at} · ${decision.reason}` }));
    for (const appeal of item.appeals) {
      row.append(el('p', { attrs: { 'data-governance-appeal': '' }, text: `Appealed by ${appeal.actor} · ${appeal.at} · ${appeal.reason}` }));
      if (appeal.review) row.append(el('p', { attrs: { 'data-governance-appeal-review': appeal.review.outcome },
        text: `${appeal.review.outcome === 'UPHOLD' ? 'Decision upheld · appeal denied' : 'Appeal accepted · decision reopened'} by ${appeal.review.actor} · ${appeal.review.at} · ${appeal.review.reason}` }));
    }
    const canWrite = !loading && !pending && item.appliesToContext && !item.sourceDrift && model.context?.isCurrent
      && model.context?.sourceKind === 'MAIN_DESIGN';
    if (canWrite && item.status === 'REQUESTED' && model.permissions?.governanceDecide) {
      const outcome = ui.field(`governance-outcome-${item.id}`, 'Decision', { entries: [['APPROVE', 'Approve'], ['DECLINE', 'Decline']] });
      const reason = ui.field(`governance-decision-reason-${item.id}`, 'Decision rationale', { multiline: true, maximum: 500 });
      row.append(ui.form(`decide-governance-decision-${item.id}`, 'Record owner decision', [outcome.node, reason.node], () => {
        const command = enterpriseGovernanceCommandPayload(model, 'decide-governance-decision', { caseId: item.id,
          caseRevision: item.revision, outcome: outcome.control.value, reason: reason.control.value });
        if (command) onCommand(command);
      }, false));
    }
    if (canWrite && item.status === 'DECIDED' && item.canAppeal) {
      const reason = ui.field(`governance-appeal-reason-${item.id}`, 'Why should this decision be reviewed?', { multiline: true, maximum: 500 });
      row.append(ui.form(`appeal-governance-decision-${item.id}`, 'Appeal this decision', [reason.node], () => {
        const command = enterpriseGovernanceCommandPayload(model, 'appeal-governance-decision', { caseId: item.id,
          caseRevision: item.revision, reason: reason.control.value });
        if (command) onCommand(command);
      }, false));
    }
    if (canWrite && item.status === 'APPEALED' && model.permissions?.governanceReviewAppeal) {
      const outcome = ui.field(`governance-appeal-outcome-${item.id}`, 'Appeal outcome', { entries: [['UPHOLD', 'Uphold decision'], ['REOPEN', 'Reopen for a new decision']] });
      const reason = ui.field(`governance-appeal-review-reason-${item.id}`, 'Appeal review rationale', { multiline: true, maximum: 500 });
      row.append(ui.form(`review-governance-appeal-${item.id}`, 'Review appeal', [outcome.node, reason.node], () => {
        const command = enterpriseGovernanceCommandPayload(model, 'review-governance-appeal', { caseId: item.id,
          caseRevision: item.revision, outcome: outcome.control.value, reason: reason.control.value });
        if (command) onCommand(command);
      }, false));
    }
    row.append(el('details', {}, [el('summary', { text: `Verified history · ${item.history.length} entries` }),
      el('ol', {}, item.history.map((entry) => el('li', { attrs: { 'data-ledger-hash': entry.hash },
        text: `#${entry.sequence} · ${entry.action} · revision ${entry.caseRevision} · ${entry.actor} · ${entry.at} · ${entry.reason} · hash ${entry.hash}` }))),
    ]));
    list.append(row);
  }
  if (!governance.cases.length) list.append(el('li', { text: 'No governance decision requests have been recorded for this project.' }));
  section.append(list);
  return section;
}
