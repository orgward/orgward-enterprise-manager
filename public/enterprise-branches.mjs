const DRAFT_KINDS = new Set(['edit-branch-object', 'edit-branch-scope', 'set-branch-validity', 'abandon-branch']);
const MERGE_KINDS = new Set(['prepare-merge', 'review-merge', 'apply-reviewed-merge']);
export const ENTERPRISE_BRANCH_COMMANDS = ['create-branch', ...DRAFT_KINDS, ...MERGE_KINDS];

export function enterpriseBranchWritable(model) {
  return Boolean(model?.permissions?.branchWrite && model.branch?.status === 'DRAFT' && model.branch.isHead
    && model.context?.branchId === model.branch.id && model.context.branchRevision === model.branch.revision
    && model.context.effectiveAt == null && model.context.recordedAtCutoff == null);
}

export function enterpriseCandidateCurrent(model) {
  const { branch } = model ?? {}; const candidate = branch?.candidate; const comparison = branch?.comparison;
  return Boolean(candidate && comparison && candidate.branchRevision === branch.revision
    && candidate.mainBlueprintId === comparison.mainBlueprintId && candidate.mainBlueprintVersion === comparison.mainBlueprintVersion
    && !['STALE', 'APPLIED'].includes(candidate.status));
}

// All source references are derived from the displayed exact snapshot or comparison.
export function enterpriseBranchCommandPayload(model, payload) {
  if (!ENTERPRISE_BRANCH_COMMANDS.includes(payload?.kind) || !model?.blueprint) return null;
  if (payload.kind === 'create-branch') {
    if (!model.permissions?.branchCreate || model.context.branchId) return null;
    return { ...payload, blueprintId: model.context.blueprintId, blueprintVersion: model.context.blueprintVersion,
      proposalId: model.context.proposalId ?? null };
  }
  if (!enterpriseBranchWritable(model)) return null;
  if (['set-branch-validity', 'abandon-branch', 'review-merge', 'apply-reviewed-merge'].includes(payload.kind) && !model.permissions?.branchAdmin) return null;
  if (payload.kind === 'edit-branch-scope' && ['create-scope', 'rename-scope'].includes(payload.change?.kind) && !model.permissions?.branchAdmin) return null;
  const branch = model.branch;
  if (['review-merge', 'apply-reviewed-merge'].includes(payload.kind)) {
    if (!enterpriseCandidateCurrent(model) || payload.candidateId !== branch.candidate.id || payload.candidateHash !== branch.candidate.hash) return null;
    if (payload.kind === 'review-merge' && branch.candidate.status !== 'PENDING') return null;
    if (payload.kind === 'apply-reviewed-merge' && (branch.candidate.status !== 'ACCEPTED'
      || !['UNKNOWN', 'ELIGIBLE'].includes(branch.candidate.eligibility?.status))) return null;
  }
  const source = MERGE_KINDS.has(payload.kind) ? branch.comparison : model.context;
  if (!source) return null;
  return { ...payload, branchId: branch.id, branchRevision: branch.revision,
    blueprintId: MERGE_KINDS.has(payload.kind) ? source.mainBlueprintId : source.blueprintId,
    blueprintVersion: MERGE_KINDS.has(payload.kind) ? source.mainBlueprintVersion : source.blueprintVersion };
}

export function enterpriseCommandResultRoute(route, payload, result = null) {
  // A definitive failure refreshes the same requested context, never a substitute.
  if (!result) return { ...route };
  const reset = { blueprintVersion: null, proposalId: null, effectiveAt: null, recordedAt: null, branchId: null, branchRevision: null };
  if (ENTERPRISE_BRANCH_COMMANDS.includes(payload.kind) && payload.kind !== 'apply-reviewed-merge') return {
    ...route, ...reset, branchId: result.branchId ?? payload.branchId, branchRevision: result.branchRevision ?? payload.branchRevision,
    selectedId: result.affectedObjectId ?? route.selectedId, view: 'map',
    ...(payload.kind === 'edit-branch-scope' && payload.change?.kind === 'create-scope' ? { lensId: 'all', scopeId: null, types: [], area: null } : {}),
  };
  return { ...route, ...reset, proposalId: result.proposalId ?? null, selectedId: result.affectedObjectId ?? route.selectedId, view: 'map',
    ...(payload.kind === 'create-scope' ? { lensId: 'all', scopeId: null, types: [], area: null } : {}) };
}

const LABELS = { DRAFT: 'Draft', MERGED: 'Merged into proposed main design', ABANDONED: 'Abandoned',
  PENDING: 'Awaiting owner review', ACCEPTED: 'Accepted by owner', REJECTED: 'Rejected by owner', STALE: 'Review is stale', APPLIED: 'Applied to proposed main design' };
const FIELD_LABELS = { name: 'Name', detail: 'Description', enterpriseScope: 'Design scope', owner: 'Proposed owner role',
  $object: 'Record presence', $area: 'Design area', enterpriseValidity: 'Declared design interval', id: 'Record identity', status: 'Proposed design status', assignedRoleIds: 'Assigned roles', goals: 'Strategy goals', decisions: 'Decision links',
  inputs: 'Inputs', outputs: 'Outputs', responsibilities: 'Responsibilities', assignedRoles: 'Assigned roles', effectiveFrom: 'Effective start', effectiveTo: 'Exclusive effective end' };
function readable(value, names) {
  if (value == null) return 'None';
  if (Array.isArray(value)) return value.map((entry) => readable(entry, names)).join(', ') || 'None';
  if (typeof value === 'object') return Object.entries(value).map(([key, entry]) => `${FIELD_LABELS[key] ?? key.replace(/([A-Z])/g, ' $1')}: ${readable(entry, names)}`).join(' · ');
  return names.get(String(value)) ?? String(value);
}

function sideNames(referenceNames, side, fallback) {
  // Missing summaries support older saved DTOs; an explicit side never borrows another snapshot's names.
  return referenceNames?.[side] ? new Map(Object.entries(referenceNames[side])) : fallback;
}

function relationText(relations, names) {
  return (relations ?? []).map((edge) => `${readable(edge.source ?? edge.from, names)} → ${readable(edge.target ?? edge.to, names)} · ${edge.type ?? edge.label ?? 'design relationship'}`).join('; ') || 'None';
}

export function renderEnterpriseBranches({ model, query, loading = false, pending = null, el, ui, onContext, onCommand, utcTime }) {
  const { field, form } = ui; const branch = model.branch;
  const root = el('section', { attrs: { 'data-enterprise-branches': '', 'aria-label': 'Design branches and reviewed merge' } }, [
    el('h4', { text: 'Design branches' }),
    el('p', { text: 'Draft changes preserve their saved source and record identities. Applying an owner-reviewed merge updates the proposed main design; publication and work remain separate actions.' }),
  ]);
  const branches = [...(model.branches ?? [])];
  if (branch && !branches.some((entry) => entry.id === branch.id)) branches.push(branch);
  const selector = field('branchId', 'Design branch', { entries: [['', 'Main design or future draft'], ...branches.map((entry) => [entry.id, `${entry.title} · ${LABELS[entry.status] ?? entry.status}`])], required: false, value: query.branchId });
  selector.control.disabled = loading || Boolean(pending);
  selector.control.addEventListener('change', () => onContext({ ...query, branchId: selector.control.value || null, branchRevision: null, blueprintVersion: null, proposalId: null }));
  root.append(selector.node);
  const transportDisabled = loading || Boolean(pending);
  if (!branch) {
    if (model.blueprint) {
      const title = field('title', 'Branch title', { maximum: 160 });
      const reason = field('reason', 'Reason for creating this draft branch', { multiline: true, maximum: 500 });
      const source = model.context.proposalId ? `future draft “${model.proposal?.title ?? 'selected draft'}”` : `saved main version ${model.context.blueprintVersion}`;
      root.append(el('details', {}, [el('summary', { text: 'Create a draft branch from this exact snapshot' }), el('p', { text: `Saved source: ${source}. Dates remain proposed and never activate a draft automatically.` }),
        form('create-branch', 'Create design branch', [title.node, reason.node], () => onCommand({ kind: 'create-branch', title: title.control.value.trim(), reason: reason.control.value.trim() }), transportDisabled || !model.permissions?.branchCreate),
      ]));
    }
    return root;
  }
  const revision = field('branchRevision', 'Saved branch revision', { entries: (branch.revisions ?? []).map((entry) => [String(entry.revision), `Revision ${entry.revision}${entry.revision === branch.headRevision ? ' · latest draft' : ''} · ${entry.recordedAt}`]), value: String(branch.revision) });
  revision.control.disabled = transportDisabled;
  revision.control.addEventListener('change', () => onContext({ ...query, branchRevision: Number(revision.control.value) }));
  root.append(revision.node, el('p', { text: `${branch.title} · ${LABELS[branch.status] ?? branch.status} · revision ${branch.revision} · based on saved main version ${branch.baseBlueprintVersion}.` }));
  const writable = enterpriseBranchWritable(model); const disabled = transportDisabled || !writable;
  if (!writable) root.append(el('p', { text: 'This branch context is read only. Editing requires a human editor viewing the latest active draft without time filters. Main publication and work actions remain unavailable here.', attrs: { role: 'status', 'data-enterprise-branch-readonly': '' } }));
  const names = new Map(Object.values(model.blueprint?.areas ?? {}).flatMap((area) => area.items ?? []).map((object) => [object.id, object.name]));
  const comparison = branch.comparison;
  if (comparison) {
    const baseNames = sideNames(comparison.referenceNames, 'base', names);
    const currentNames = sideNames(comparison.referenceNames, 'current', names);
    const draftNames = sideNames(comparison.referenceNames, 'proposed', names);
    const compare = el('details', { attrs: { 'data-enterprise-branch-comparison': '' } }, [el('summary', { text: `Compare saved base, current main version ${comparison.mainBlueprintVersion}, and draft revision ${branch.revision}` })]);
    for (const row of comparison.changes ?? []) compare.append(el('article', { className: 'enterprise-change', attrs: { 'data-enterprise-change': row.objectId } }, [
      el('h5', { text: `${row.objectName ?? names.get(row.objectId) ?? 'Design record'} · ${FIELD_LABELS[row.field] ?? row.field}` }),
      el('p', { text: `Saved base: ${readable(row.base, baseNames)}` }), el('p', { text: `Current main: ${readable(row.current, currentNames)}` }), el('p', { text: `Draft: ${readable(row.proposed, draftNames)}` }),
      ...(row.conflictId ? [el('p', { text: 'Both main and draft changed this field; choose a value before preparing a merge.' })] : []),
    ]));
    if (!(comparison.changes ?? []).length) compare.append(el('p', { text: 'No object fields differ from the saved base.' }));
    compare.append(el('h5', { text: 'Derived relationship changes' }));
    for (const [key, label, referenceNames] of [['currentAdded', 'Main added', currentNames], ['currentRemoved', 'Main removed', baseNames], ['branchAdded', 'Draft added', draftNames], ['branchRemoved', 'Draft removed', baseNames]]) compare.append(el('p', { text: `${label}: ${relationText(comparison.relations?.[key], referenceNames)}` }));
    root.append(compare);
    const resolutions = (comparison.conflicts ?? []).map((conflict) => ({ conflict, choice: field(`choice:${conflict.conflictId}`, `${conflict.objectName ?? names.get(conflict.objectId) ?? 'Record'} · ${FIELD_LABELS[conflict.field] ?? conflict.field}`, { entries: [['', 'Choose explicitly'], ['current', `Keep main: ${readable(conflict.current, currentNames)}`], ['branch', `Use draft: ${readable(conflict.proposed, draftNames)}`]] }) }));
    const reason = field('reason', 'Reason for preparing this exact merge', { multiline: true, maximum: 500 });
    root.append(form('prepare-merge', 'Prepare exact merge for owner review', [...resolutions.map(({ choice }) => choice.node), reason.node], () => onCommand({ kind: 'prepare-merge', resolutions: resolutions.map(({ conflict, choice }) => ({ conflictId: conflict.conflictId, choice: choice.control.value })), reason: reason.control.value.trim() }), disabled));
  }
  const candidate = branch.candidate;
  if (candidate) {
    const currentNames = sideNames(candidate.referenceNames, 'current', names);
    const proposedNames = sideNames(candidate.referenceNames, 'proposed', names);
    const current = enterpriseCandidateCurrent(model);
    const panel = el('section', { attrs: { 'data-enterprise-merge-candidate': '' } }, [el('h5', { text: `Prepared merge: ${LABELS[candidate.status] ?? candidate.status}` }),
      el('p', { text: `Prepared from draft revision ${candidate.branchRevision} against main version ${candidate.mainBlueprintVersion}.` }),
    ]);
    if (candidate.status !== 'APPLIED' && (!current || candidate.status === 'STALE')) panel.append(el('p', { text: 'This candidate does not match the displayed draft and current main snapshot. Select the latest draft or prepare a new exact candidate and obtain a new owner review before applying.', attrs: { role: 'status', 'data-enterprise-merge-stale': '' } }));
    for (const row of candidate.changes ?? []) panel.append(el('p', { text: `${row.objectName ?? names.get(row.objectId) ?? 'Design record'} · ${FIELD_LABELS[row.field] ?? row.field}: ${readable(row.current ?? row.before, currentNames)} → ${readable(row.proposed ?? row.after, proposedNames)}` }));
    panel.append(el('h5', { text: 'Prepared relationship changes' }), el('p', { text: `Added: ${relationText(candidate.relations?.added, proposedNames)}` }), el('p', { text: `Removed: ${relationText(candidate.relations?.removed, currentNames)}` }));
    for (const resolution of candidate.resolutions ?? []) {
      const row = comparison?.conflicts?.find((entry) => entry.conflictId === resolution.conflictId);
      if (row) panel.append(el('p', { text: `Resolved ${row.objectName ?? 'record'} · ${FIELD_LABELS[row.field] ?? row.field}: ${resolution.choice === 'branch' ? 'use draft' : 'keep current main'}.` }));
    }
    if (candidate.review) panel.append(el('p', { text: `Owner review: ${candidate.review.decision === 'ACCEPT' ? 'accepted' : 'rejected'} by ${candidate.review.principal} at ${candidate.review.recordedAt}. ${candidate.review.reason ?? ''}` }), el('p', { text: 'This saved owner decision is immutable. Prepare a new candidate for another review.' }));
    const eligibility = candidate.eligibility?.status ?? 'UNKNOWN';
    panel.append(el('p', { text: `Declared merge interval: ${candidate.eligibility?.effectiveFrom ?? 'start unknown'} to ${candidate.eligibility?.effectiveTo ?? 'no end declared'}. ${eligibility === 'FUTURE' ? 'This draft is not yet eligible to apply.' : eligibility === 'EXPIRED' ? 'This draft interval has ended; it cannot be applied.' : eligibility === 'UNKNOWN' ? 'Timing is unknown. Application remains an explicit owner action.' : 'Timing allows an explicit owner application.'}` }));
    for (const [decision, label] of [['ACCEPT', 'Accept exact proposed merge'], ['REJECT', 'Reject exact proposed merge']]) {
      const reason = field('reason', 'Reason for this owner decision', { multiline: true, maximum: 500 });
      panel.append(form('review-merge', label, [reason.node], () => onCommand({ kind: 'review-merge', candidateId: candidate.id, candidateHash: candidate.hash, decision, reason: reason.control.value.trim() }), disabled || !model.permissions?.branchAdmin || !current || candidate.status !== 'PENDING'));
    }
    const applyReason = field('reason', 'Reason for applying the reviewed merge', { multiline: true, maximum: 500 });
    panel.append(form('apply-reviewed-merge', 'Apply reviewed merge to proposed main design', [applyReason.node], () => onCommand({ kind: 'apply-reviewed-merge', candidateId: candidate.id, candidateHash: candidate.hash, reason: applyReason.control.value.trim() }), disabled || !model.permissions?.branchAdmin || !current || candidate.status !== 'ACCEPTED' || !['UNKNOWN', 'ELIGIBLE'].includes(eligibility)));
    panel.append(el('details', {}, [el('summary', { text: 'Prepared merge identity' }), el('p', { text: `Candidate: ${candidate.id} · digest: ${candidate.hash}` })]));
    root.append(panel);
  }
  const effectiveFrom = field('effectiveFrom', 'Draft effective start (UTC, optional)', { type: 'datetime-local', value: model.context.validity?.effectiveFrom?.replace(/Z$/, '') ?? '', required: false });
  const effectiveTo = field('effectiveTo', 'Draft exclusive effective end (UTC, optional)', { type: 'datetime-local', value: model.context.validity?.effectiveTo?.replace(/Z$/, '') ?? '', required: false });
  const validityReason = field('reason', 'Reason for this draft interval', { multiline: true, maximum: 500 });
  const abandonReason = field('reason', 'Reason for abandoning this branch', { multiline: true, maximum: 500 });
  root.append(el('details', {}, [el('summary', { text: 'Draft interval and abandonment' }),
    form('set-branch-validity', 'Save branch draft interval', [effectiveFrom.node, effectiveTo.node, validityReason.node], () => onCommand({ kind: 'set-branch-validity', effectiveFrom: utcTime(effectiveFrom.control.value), effectiveTo: utcTime(effectiveTo.control.value), reason: validityReason.control.value.trim() }), disabled || !model.permissions?.branchAdmin),
    form('abandon-branch', 'Abandon this design branch', [abandonReason.node], () => onCommand({ kind: 'abandon-branch', reason: abandonReason.control.value.trim() }), disabled || !model.permissions?.branchAdmin),
  ]));
  root.append(el('details', {}, [el('summary', { text: 'Branch saved source identity' }), el('p', { text: `Branch: ${branch.id} · saved base: ${branch.baseBlueprintId} · source hash: ${branch.baseSnapshotHash} · revision source: ${model.context.blueprintId}` })]));
  return root;
}
