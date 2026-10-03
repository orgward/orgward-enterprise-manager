import { ENTERPRISE_BRANCH_COMMANDS, enterpriseBranchWritable, renderEnterpriseBranches } from './enterprise-branches.mjs';
const SCOPE_TYPES = new Set(['organization', 'legal-entity', 'unit']);
const STATE_VALUES = {
  lifecycle: ['UNKNOWN', 'PLANNED', 'ACTIVE', 'RETIRED'],
  review: ['UNREVIEWED', 'ACCEPTED', 'REJECTED'],
  implementation: ['UNKNOWN', 'NOT_IMPLEMENTED', 'IMPLEMENTED_UNVERIFIED'],
  observation: ['UNKNOWN', 'NOT_OBSERVED', 'OBSERVED_UNVERIFIED'],
};
const STATE_LABELS = { lifecycle: 'Lifecycle', review: 'Design review', implementation: 'Implementation report', observation: 'Observation report' };
const VALUE_LABELS = { UNKNOWN: 'Unknown', PLANNED: 'Planned', ACTIVE: 'Active (reported)', RETIRED: 'Retired (reported)',
  UNREVIEWED: 'Unreviewed', ACCEPTED: 'Accepted design review', REJECTED: 'Rejected design review', NOT_IMPLEMENTED: 'Not implemented (reported)',
  IMPLEMENTED_UNVERIFIED: 'Implementation reported, unverified', NOT_OBSERVED: 'Not observed (reported)', OBSERVED_UNVERIFIED: 'Observation reported, unverified' };

export function enterpriseUtcTime(value) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) throw new Error('Enter a valid UTC date and time.');
  const instant = new Date(`${value}Z`);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 19) !== (value.length === 16 ? `${value}:00` : value.split('.')[0])) throw new Error('Enter a valid UTC date and time.');
  return instant.toISOString();
}

function timeInput(value) {
  return typeof value === 'string' && value.endsWith('Z') && Number.isFinite(Date.parse(value)) ? value.slice(0, -1) : '';
}

export function enterpriseObjectStates(model, object) {
  return (model.selection?.object?.id === object.id ? model.selection.states : null)
    ?? model.graph?.nodes.find((node) => node.id === object.id)?.states
    ?? { basisHash: null, ...Object.fromEntries(Object.keys(STATE_VALUES).map((dimension) => [dimension, { value: dimension === 'review' ? 'UNREVIEWED' : 'UNKNOWN', evidenceKind: 'UNKNOWN' }])) };
}

export function enterpriseStateSummary(states = {}) {
  return Object.keys(STATE_VALUES).map((dimension) => `${STATE_LABELS[dimension]}: ${VALUE_LABELS[states?.[dimension]?.value] ?? (dimension === 'review' ? 'Unreviewed' : 'Unknown')}`).join(' · ');
}

export function renderEnterpriseStates({ states = {}, el }) {
  const root = el('section', { attrs: { 'data-enterprise-states': '', 'aria-label': 'Independent item states' } }, [
    el('h4', { text: 'Independent item states' }),
    el('p', { text: 'Lifecycle, item design review, implementation reports and observation reports are independent. Human reports do not verify outcomes or enable work.' }),
  ]);
  for (const dimension of Object.keys(STATE_VALUES)) {
    const report = states?.[dimension] ?? { value: dimension === 'review' ? 'UNREVIEWED' : 'UNKNOWN', evidenceKind: 'UNKNOWN' };
    const panel = el('article', { attrs: { 'data-enterprise-state': dimension } }, [el('h5', { text: `${STATE_LABELS[dimension]}: ${VALUE_LABELS[report.value] ?? (dimension === 'review' ? 'Unreviewed' : 'Unknown')}` })]);
    if (report.stale) panel.append(el('p', { text: `The saved ${STATE_LABELS[dimension].toLowerCase()} no longer matches this item's content. Previous value: ${VALUE_LABELS[report.priorValue] ?? 'unknown'}. Review or report the exact current item again.` }));
    const kind = ({ HUMAN_REPORTED: 'Human reported', HUMAN_REVIEW: 'Human design review', HUMAN_PROPOSED: 'Human proposed', UNKNOWN: 'Evidence unknown' })[report.evidenceKind] ?? 'Evidence unknown';
    panel.append(el('p', { text: `${kind} · ${report.recordedBy ?? 'reporter unknown'} · ${report.recordedAt ?? 'recording time unknown'}` }));
    if (report.reason) panel.append(el('p', { text: `Reason: ${report.reason}` }));
    if (report.evidenceSummary) panel.append(el('p', { text: `Reported evidence: ${report.evidenceSummary}` }));
    root.append(panel);
  }
  return root;
}

export function enterpriseQuery(route = {}) {
  return { lensId: route.lensId ?? 'all', scopeId: route.scopeId ?? null, blueprintVersion: route.blueprintVersion ?? null,
    ...Object.fromEntries(['proposalId', 'effectiveAt', 'recordedAt', 'branchId', 'branchRevision'].filter((field) => Object.hasOwn(route, field)).map((field) => [field, route[field]])) };
}

export function hasEnterpriseContext(route = {}) {
  return ['lensId', 'scopeId', 'blueprintVersion', 'proposalId', 'effectiveAt', 'recordedAt', 'branchId', 'branchRevision'].some((field) => Object.hasOwn(route, field));
}

export function enterpriseContextReadOnly(context) {
  return Boolean(context && (context.isCurrent === false || context.proposalId || context.sourceKind === 'FUTURE_PROPOSAL' || context.branchId || context.sourceKind === 'BRANCH_DRAFT'
    || context.effectiveAt != null || context.recordedAtCutoff != null));
}

export function enterpriseContextFailure(explicit, message) {
  return explicit ? { error: message, unavailable: null } : { error: null, unavailable: message };
}

export function enterpriseSourceAligned(project, model) {
  return Boolean(project && model?.context) && project.version === model.context.projectVersion && (!model.context.isCurrent
    || (project.latestBlueprint?.id === model.context.blueprintId
      && project.latestBlueprint?.version === model.context.blueprintVersion
      && model.blueprint?.id === model.context.blueprintId));
}

export function enterpriseRequestPath(projectId, query, selectedId = null) {
  const params = new URLSearchParams({ lensId: query.lensId ?? 'all' });
  if (query.scopeId !== null && query.scopeId !== undefined) params.set('scopeId', query.scopeId);
  if (query.blueprintVersion !== null && query.blueprintVersion !== undefined) params.set('blueprintVersion', String(query.blueprintVersion));
  for (const field of ['proposalId', 'effectiveAt', 'recordedAt', 'branchId', 'branchRevision']) if (query[field] !== null && query[field] !== undefined) params.set(field, String(query[field]));
  if (selectedId) params.set('selectedId', selectedId);
  return `/api/v1/projects/${encodeURIComponent(projectId)}/enterprise?${params}`;
}

export function enterpriseCommandStorageKey(principal, projectId) {
  return `orgward:enterprise-command:${encodeURIComponent(principal ?? '')}:${encodeURIComponent(projectId)}`;
}

export function restoreEnterpriseCommand(storage, principal, projectId) {
  const saved = JSON.parse(storage.getItem(enterpriseCommandStorageKey(principal, projectId)) ?? 'null');
  if (!saved) return null;
  if (saved.projectId !== projectId || saved.envelope?.schemaVersion !== '1.0'
    || typeof saved.envelope.commandId !== 'string' || !Number.isSafeInteger(saved.envelope.expectedVersion)
    || !['create-scope', 'rename-scope', 'assign-object-scope', 'record-state', 'set-validity', 'propose-future-design', ...ENTERPRISE_BRANCH_COMMANDS].includes(saved.envelope.payload?.kind)) throw new Error('Saved enterprise command is unreadable.');
  return saved;
}

export function persistEnterpriseCommand(storage, principal, projectId, saved) {
  const key = enterpriseCommandStorageKey(principal, projectId);
  if (saved) storage.setItem(key, JSON.stringify(saved)); else storage.removeItem(key);
}

export function submitEnterpriseCommand(api, projectId, saved) {
  if (saved.projectId !== projectId) throw new Error('The saved enterprise command belongs to another project.');
  return api(`/api/v1/projects/${encodeURIComponent(projectId)}/enterprise/commands`, { method: 'POST', body: JSON.stringify(saved.envelope) });
}

function fields(el) {
  function field(name, label, { entries = null, value = '', required = true, multiline = false, maximum = 700, type = null } = {}) {
    const control = entries ? el('select', { attrs: { name } }, entries.map(([value, text]) => el('option', { text, attrs: { value } })))
      : el(multiline ? 'textarea' : 'input', { attrs: { name, maxlength: String(maximum), ...(multiline ? { rows: '3' } : {}), ...(type ? { type, ...(type === 'datetime-local' ? { step: '0.001' } : {}) } : {}) } });
    control.required = required; control.value = value ?? '';
    return { control, node: el('label', { text: label }, [control]) };
  }
  function form(kind, label, controls, submit, disabled) {
    const node = el('form', { className: 'enterprise-form', attrs: { 'aria-label': label, 'data-enterprise-action': kind } }, controls);
    const save = el('button', { className: 'button', text: label, attrs: { type: 'submit' } });
    const error = el('p', { attrs: { role: 'alert' } }); error.hidden = true;
    node.append(save, error);
    if (disabled) for (const control of node.querySelectorAll('input,select,textarea,button')) control.disabled = true;
    node.addEventListener('submit', (event) => {
      event.preventDefault();
      if (disabled || !node.reportValidity()) return;
      error.hidden = true;
      try { submit(); } catch (failure) { error.textContent = failure.message; error.hidden = false; }
    });
    return node;
  }
  return { field, form };
}

function scopeOptions(scopes, type, predicate = () => true) {
  return [['', 'None'], ...scopes.filter((scope) => scope.type === type && predicate(scope)).map((scope) => [scope.id, scope.name])];
}

function refill(el, field, entries) {
  const previous = field.control.value;
  field.control.replaceChildren(...entries.map(([value, text]) => el('option', { text, attrs: { value } })));
  field.control.value = entries.some(([value]) => value === previous) ? previous : '';
}

function scopeFields(el, scopes, values = {}) {
  const { field } = fields(el);
  const organization = field('organizationId', 'Organization', { entries: scopeOptions(scopes, 'organization'), required: false, value: values.organizationId });
  const legalEntity = field('legalEntityId', 'Legal entity', { entries: scopeOptions(scopes, 'legal-entity', (scope) => scope.organizationId === organization.control.value), required: false, value: values.legalEntityId });
  const unit = field('unitId', 'Organizational unit', { entries: scopeOptions(scopes, 'unit', (scope) => scope.organizationId === organization.control.value && (!legalEntity.control.value || scope.legalEntityId === legalEntity.control.value)), required: false, value: values.unitId });
  const updateUnits = () => refill(el, unit, scopeOptions(scopes, 'unit', (scope) => scope.organizationId === organization.control.value && (!legalEntity.control.value || scope.legalEntityId === legalEntity.control.value)));
  organization.control.addEventListener('change', () => { refill(el, legalEntity, scopeOptions(scopes, 'legal-entity', (scope) => scope.organizationId === organization.control.value)); updateUnits(); });
  legalEntity.control.addEventListener('change', updateUnits);
  unit.control.addEventListener('change', () => {
    const selected = scopes.find((scope) => scope.id === unit.control.value);
    if (selected) legalEntity.control.value = selected.legalEntityId ?? '';
  });
  return { organization, legalEntity, unit };
}

export function renderEnterpriseContext({ model, query, loading = false, error = null, unavailable = null, pending = null, status = '', storageAvailable = true, el, onContext, onCommand, onRetry, onReload }) {
  const { field, form } = fields(el);
  const root = el('section', { className: 'enterprise-context', attrs: { 'data-enterprise-context': '', 'aria-label': 'Enterprise perspectives and design scopes' } }, [
    el('h3', { text: 'Enterprise perspectives and design scopes' }),
    el('p', { text: 'Lenses share the same saved design records. Scope describes proposed organizational structure and grants no access, legal formation or operating authority.' }),
  ]);
  if (status) root.append(el('p', { text: status, attrs: { role: 'status', 'aria-live': 'polite' } }));
  if (pending) {
    root.append(el('p', { text: 'An enterprise command has an uncertain response. Recover its exact saved result before making another change.' }));
    if (!storageAvailable) root.append(el('p', { text: 'Browser storage is unavailable. Keep this page open until recovery completes.' }));
    const retry = el('button', { className: 'button', text: 'Recover saved enterprise command', attrs: { type: 'button', 'data-enterprise-retry': '' } });
    retry.disabled = loading; retry.addEventListener('click', onRetry); root.append(retry);
  }
  if (loading) root.append(el('p', { text: 'Loading the requested saved perspective…', attrs: { role: 'status' } }));
  if (unavailable) {
    root.append(el('p', { text: `Enterprise perspectives are unavailable: ${unavailable}. The existing saved blueprint and map remain available.`, attrs: { role: 'status' } }));
    if (onReload) {
      const reload = el('button', { className: 'button ghost', text: 'Retry enterprise perspectives', attrs: { type: 'button', 'data-enterprise-reload': '' } });
      reload.addEventListener('click', onReload); root.append(reload);
    }
    return root;
  }
  if (error) {
    root.append(el('p', { text: `Requested enterprise context unavailable: ${error}. The requested lens, scope or version has not been replaced with another context. Time, future draft and branch requests also retain their exact requested identity.`, attrs: { role: 'alert' } }));
    const reset = el('button', { className: 'button', text: 'Open current design with all objects', attrs: { type: 'button' } });
    reset.addEventListener('click', () => onContext({ lensId: 'all', scopeId: null, blueprintVersion: null, proposalId: null, effectiveAt: null, recordedAt: null, branchId: null, branchRevision: null })); root.append(reset);
    return root;
  }
  if (!model) return root;
  const lenses = [['all', 'All design objects'], ...(model.lenses ?? []).filter((lens) => lens.id !== 'all').map((lens) => [lens.id, lens.label])];
  const lens = field('lensId', 'Perspective', { entries: lenses, value: query.lensId });
  const scope = field('scopeId', 'Design scope', { entries: [['', 'All design scopes'], ...(model.scopes ?? []).map((scope) => [scope.id, `${scope.name} · ${scope.type.replaceAll('-', ' ')}`])], required: false, value: query.scopeId });
  const version = field('blueprintVersion', 'Saved main design version', { entries: [['', query.effectiveAt || query.recordedAt ? 'Latest eligible main snapshot' : 'Current saved main design'], ...(model.versions ?? []).map((version) => [String(version.version), `Saved main version ${version.version}`])], required: false, value: query.blueprintVersion });
  const controls = el('div', { className: 'enterprise-context-controls' }, [lens.node, scope.node, version.node]);
  for (const control of [lens, scope, version]) {
    control.control.disabled = loading || Boolean(pending);
    control.control.addEventListener('change', () => onContext({ ...query, lensId: lens.control.value, scopeId: scope.control.value || null, blueprintVersion: version.control.value ? Number(version.control.value) : null,
      ...(control === version ? { proposalId: null, branchId: null, branchRevision: null } : {}) }));
  }
  const proposalChoices = [...(model.proposals ?? [])];
  if (model.proposal && !proposalChoices.some((proposal) => proposal.id === model.proposal.id)) proposalChoices.push(model.proposal);
  const proposal = field('proposalId', 'Future design draft', { entries: [['', 'Current main or saved main version'], ...proposalChoices.map((proposal) => [proposal.id, `${proposal.title} · proposed from version ${proposal.baseBlueprintVersion}`])], required: false, value: query.proposalId });
  proposal.control.disabled = loading || Boolean(pending);
  proposal.control.addEventListener('change', () => onContext({ ...query, proposalId: proposal.control.value || null, blueprintVersion: null, branchId: null, branchRevision: null }));
  controls.append(proposal.node);
  const source = model.context.branchId ? 'branch draft · main work and publication unavailable' : model.context.sourceKind === 'FUTURE_PROPOSAL' ? 'proposed future draft · read only'
    : enterpriseContextReadOnly(model.context) ? 'saved time or historical context · read only' : 'current main design';
  root.append(controls, el('p', { text: model.blueprint ? `Snapshot version ${model.context.blueprintVersion} · ${source}.` : 'No saved design version at this context.' }));
  root.append(renderEnterpriseBranches({ model, query, loading, pending, el, ui: { field, form }, onContext, onCommand, utcTime: enterpriseUtcTime }));
  const effectiveAt = field('effectiveAt', 'Effective at (UTC, blank means no time filter)', { type: 'datetime-local', value: timeInput(query.effectiveAt), required: false });
  const recordedAt = field('recordedAt', 'Recorded by (UTC cutoff, blank means latest recorded)', { type: 'datetime-local', value: timeInput(query.recordedAt), required: false });
  if (model.blueprint || (model.versions ?? []).length || proposalChoices.length || query.effectiveAt || query.recordedAt || query.proposalId) root.append(form('inspect-time', 'Inspect exact time context', [effectiveAt.node, recordedAt.node], () => onContext({ ...query, effectiveAt: enterpriseUtcTime(effectiveAt.control.value), recordedAt: enterpriseUtcTime(recordedAt.control.value) }), loading || Boolean(pending)));
  if (model.context.recordedAt) root.append(el('p', { text: `Snapshot recorded at: ${model.context.recordedAt}` }));
  if (model.context.recordedAtCutoff) root.append(el('p', { text: `Recorded-time cutoff: ${model.context.recordedAtCutoff}` }));
  if (model.context.effectiveAt) root.append(el('p', { text: `Effective-time query: ${model.context.effectiveAt} · ${({ IN_RANGE: 'within the declared interval', OUT_OF_RANGE: 'outside the declared interval', UNKNOWN: 'validity unknown' })[model.context.effectiveStatus] ?? 'validity unknown'}.` }));
  const selectedProposal = model.proposal ?? proposalChoices.find((proposal) => proposal.id === model.context.proposalId);
  if (selectedProposal) {
    const panel = el('section', { attrs: { 'data-enterprise-proposal': '' } }, [
      el('h4', { text: selectedProposal.title }),
      el('p', { text: `Immutable proposed draft · based on saved main version ${selectedProposal.baseBlueprintVersion} · recorded ${model.context.recordedAt ?? selectedProposal.recordedAt ?? 'time unknown'}.` }),
      el('p', { text: `Proposed interval: ${model.context.validity?.effectiveFrom ?? selectedProposal.effectiveFrom ?? 'start unknown'} to ${model.context.validity?.effectiveTo ?? selectedProposal.effectiveTo ?? 'no end declared'} (end exclusive).` }),
      el('p', { text: 'The draft stays proposed after its effective date. It does not automatically change the main design, publish a baseline or enable work.' }),
    ]);
    if (selectedProposal.baseStale) panel.append(el('p', { text: 'The current main design has changed since this draft was created. This draft retains its original saved base and proposed changes.', attrs: { role: 'status', 'data-enterprise-stale-base': '' } }));
    for (const field of ['name', 'detail']) if (selectedProposal.diff?.changedFields?.includes(field)
      && selectedProposal.diff.before?.[field] !== selectedProposal.diff.after?.[field]) panel.append(el('div', { attrs: { 'data-enterprise-proposal-diff': field } }, [
      el('strong', { text: field === 'name' ? 'Name change' : 'Description change' }),
      el('p', { text: `Before: ${selectedProposal.diff.before?.[field] ?? 'unknown'}` }),
      el('p', { text: `Proposed: ${selectedProposal.diff.after?.[field] ?? 'unknown'}` }),
    ]));
    panel.append(el('details', {}, [el('summary', { text: 'Draft identity and saved source' }),
      el('p', { text: `Base blueprint: ${selectedProposal.baseBlueprintId} · base hash: ${selectedProposal.baseSnapshotHash ?? 'unavailable'} · draft hash: ${selectedProposal.proposalHash}` }),
    ]));
    root.append(panel);
  }
  if (enterpriseContextReadOnly(model.context) && (model.blueprint || (model.versions ?? []).length || query.blueprintVersion != null || query.effectiveAt || query.recordedAt || query.proposalId || model.context.effectiveAt || model.context.recordedAtCutoff || model.context.proposalId || query.branchId || model.context.branchId)) {
    const current = el('button', { className: 'button ghost', text: 'Return to the current saved design', attrs: { type: 'button' } });
    current.addEventListener('click', () => onContext({ ...query, blueprintVersion: null, proposalId: null, effectiveAt: null, recordedAt: null, branchId: null, branchRevision: null })); root.append(current);
  }
  if (model.gaps?.length) root.append(el('details', {}, [el('summary', { text: 'Perspective gaps and unavailable capabilities' }), el('ul', {}, model.gaps.map((gap) => el('li', { text: gap.message })))]));
  if (!model.blueprint) {
    root.append(el('p', { text: (model.versions ?? []).length || query.effectiveAt || query.recordedAt || query.proposalId
      ? 'The requested time has no saved design evidence. This context remains unknown; choose another recorded time or return to the current main design.'
      : 'Save the initial blueprint before creating or assigning design scopes.' }));
    return root;
  }
  const disabled = loading || Boolean(pending) || enterpriseContextReadOnly(model.context) || !model.permissions?.scopeAdmin;
  const validity = model.context.validity ?? {};
  root.append(el('p', { text: `Declared design validity: ${validity.effectiveFrom ?? 'start unknown'} to ${validity.effectiveTo ?? 'no end declared'} (end exclusive). This is proposed design timing.` }));
  if (validity.recordedBy) root.append(el('p', { text: `Declared by ${validity.recordedBy} at ${validity.recordedAt ?? 'recording time unknown'} · ${validity.reason ?? ''}` }));
  const from = field('effectiveFrom', 'Current design effective start (UTC, blank means unknown)', { type: 'datetime-local', value: timeInput(validity.effectiveFrom), required: false });
  const to = field('effectiveTo', 'Exclusive effective end (UTC, optional)', { type: 'datetime-local', value: timeInput(validity.effectiveTo), required: false });
  const validityReason = field('reason', 'Reason for declaring this design interval', { multiline: true, maximum: 500 });
  root.append(el('details', {}, [el('summary', { text: 'Declare current design validity' }),
    el('p', { text: 'Current design dates must include the present time. Leave both blank to record unknown validity. A future draft has its own proposed interval.' }),
    form('set-validity', 'Save declared design validity', [from.node, to.node, validityReason.node], () => onCommand({ kind: 'set-validity', effectiveFrom: enterpriseUtcTime(from.control.value), effectiveTo: enterpriseUtcTime(to.control.value), reason: validityReason.control.value.trim() }), disabled),
  ]));
  const scopeType = field('scopeType', 'Scope type', { entries: [['organization', 'Organization'], ['legal-entity', 'Legal entity'], ['unit', 'Organizational unit']] });
  const name = field('name', 'Scope name', { maximum: 120 });
  const detail = field('detail', 'Design purpose and description', { multiline: true });
  const reason = field('reason', 'Reason for this design change', { multiline: true, maximum: 500 });
  const scopeDisabled = loading || Boolean(pending) || (model.context.branchId ? (!enterpriseBranchWritable(model) || !model.permissions?.branchAdmin) : disabled);
  const scopeCommand = (payload) => {
    if (!model.context.branchId) return onCommand(payload);
    const { reason, ...change } = payload;
    return onCommand({ kind: 'edit-branch-scope', change, reason });
  };
  const roles = Object.values(model.blueprint.areas ?? {}).flatMap((area) => area.items ?? []).filter((object) => object.type === 'role');
  const owner = field('ownerRoleId', 'Proposed owner role', { entries: [['', 'None specified'], ...roles.map((role) => [role.id, role.name])], required: false });
  const scopes = scopeFields(el, model.scopes ?? []);
  const jurisdiction = field('jurisdiction', 'Jurisdiction (reported design context)', { maximum: 120 });
  const hierarchy = el('div', { className: 'enterprise-hierarchy' }, [scopes.organization.node, jurisdiction.node, scopes.legalEntity.node, scopes.unit.node]);
  scopes.unit.node.firstChild.textContent = 'Parent organizational unit';
  scopes.unit.control.name = 'parentUnitId';
  const updateType = () => {
    const type = scopeType.control.value;
    scopes.organization.node.hidden = type === 'organization'; scopes.organization.control.required = type !== 'organization';
    jurisdiction.node.hidden = type !== 'legal-entity'; jurisdiction.control.required = type === 'legal-entity';
    scopes.legalEntity.node.hidden = type !== 'unit'; scopes.unit.node.hidden = type !== 'unit';
  };
  scopeType.control.addEventListener('change', updateType); updateType();
  const create = form('create-scope', 'Create proposed design scope', [scopeType.node, name.node, detail.node, owner.node, hierarchy, reason.node], () => {
    const type = scopeType.control.value;
    scopeCommand({ kind: 'create-scope', scopeType: type, name: name.control.value.trim(), detail: detail.control.value.trim(), ownerRoleId: owner.control.value || null, reason: reason.control.value.trim(),
      ...(type === 'organization' ? {} : { organizationId: scopes.organization.control.value }),
      ...(type === 'legal-entity' ? { jurisdiction: jurisdiction.control.value.trim() } : {}),
      ...(type === 'unit' ? { legalEntityId: scopes.legalEntity.control.value || null, parentUnitId: scopes.unit.control.value || null } : {}) });
  }, scopeDisabled);
  root.append(el('details', {}, [el('summary', { text: 'Create an organization, legal entity or unit' }), create]));
  if (!model.permissions?.scopeAdmin && model.context.isCurrent) root.append(el('p', { text: 'A project owner can create or rename proposed design scopes.' }));
  return root;
}

export function renderEnterpriseObject({ model, object, pending = null, loading = false, el, onCommand }) {
  const { field, form } = fields(el);
  const root = el('section', { className: 'enterprise-object', attrs: { 'aria-label': 'Selected object design scope' } });
  const scope = object.enterpriseScope;
  const assigned = scope ? Object.values(scope).some(Boolean) : false;
  const scopes = model.scopes ?? [];
  const states = enterpriseObjectStates(model, object);
  root.append(renderEnterpriseStates({ states, el }));
  root.append(el('h4', { text: 'Proposed organizational scope' }), el('p', { text: scope ? (assigned ? 'Assigned to a design scope.' : 'Explicitly unscoped.') : 'Organizational scope is unknown; no assignment has been recorded.' }));
  if (assigned) for (const id of Object.values(scope).filter(Boolean)) root.append(el('p', { text: scopes.find((entry) => entry.id === id)?.name ?? id }));
  if (model.selection?.object?.id === object.id && !model.selection.visible) root.append(el('p', { text: `The selected record is outside this perspective: ${(model.selection.hiddenBy ?? []).map((reason) => ({ lens: 'perspective filter', scope: 'design scope filter' })[reason] ?? reason).join(', ') || 'perspective or design scope filter'}. Its saved identity and inspector remain selected.`, attrs: { 'data-enterprise-selection': '', role: 'status' } }));
  const disabled = loading || Boolean(pending) || enterpriseContextReadOnly(model.context);
  const dimension = field('dimension', 'Independent state dimension', { entries: Object.entries(STATE_LABELS) });
  const value = field('value', 'Recorded value', { entries: STATE_VALUES.lifecycle.map((value) => [value, VALUE_LABELS[value]]), value: states.lifecycle?.value ?? 'UNKNOWN' });
  const stateReason = field('reason', 'Reason for this report or item review', { multiline: true, maximum: 500 });
  const evidence = field('evidenceSummary', 'Human reported evidence summary', { multiline: true, maximum: 1000, required: false });
  const reviewAccess = el('p', { attrs: { role: 'status' } });
  const stateDisabled = disabled || !model.permissions?.write || !states.basisHash;
  const stateForm = form('record-state', 'Save independent item state', [dimension.node, value.node, evidence.node, stateReason.node, reviewAccess], () => {
    if (dimension.control.value === 'review' && !model.permissions?.scopeAdmin) return;
    onCommand({ kind: 'record-state', objectId: object.id, dimension: dimension.control.value, value: value.control.value,
      basisHash: states.basisHash, reason: stateReason.control.value.trim(), evidenceSummary: evidence.control.value.trim() });
  }, stateDisabled);
  const updateStateAccess = () => {
    evidence.control.required = ['ACTIVE', 'RETIRED', 'IMPLEMENTED_UNVERIFIED', 'OBSERVED_UNVERIFIED'].includes(value.control.value);
    const ownerReview = dimension.control.value === 'review';
    const save = Array.from(stateForm.querySelectorAll('button')).at(-1);
    save.disabled = stateDisabled || (ownerReview && !model.permissions?.scopeAdmin);
    save.textContent = ownerReview ? 'Save exact item design review' : 'Save human reported item state';
    reviewAccess.textContent = ownerReview ? 'A project owner reviews this exact saved item content. This item review grants no publication or execution authority.' : 'This is a human report. Implementation and observation remain unverified.';
  };
  dimension.control.addEventListener('change', () => {
    refill(el, value, STATE_VALUES[dimension.control.value].map((value) => [value, VALUE_LABELS[value]]));
    value.control.value = states[dimension.control.value]?.value ?? (dimension.control.value === 'review' ? 'UNREVIEWED' : 'UNKNOWN');
    evidence.control.value = states[dimension.control.value]?.evidenceSummary ?? '';
    updateStateAccess();
  });
  value.control.addEventListener('change', updateStateAccess); updateStateAccess();
  root.append(el('details', {}, [el('summary', { text: 'Report an independent state or review this item' }), stateForm]));
  if (!['actor-human', 'actor-agent'].includes(object.type)) {
    const title = field('title', 'Future draft title', { maximum: 160 });
    const futureName = field('name', 'Proposed future name', { value: object.name, maximum: 120 });
    const futureDetail = field('detail', 'Proposed future description', { value: object.detail, multiline: true });
    const from = field('effectiveFrom', 'Future effective start (UTC)', { type: 'datetime-local' });
    const to = field('effectiveTo', 'Exclusive effective end (UTC, optional)', { type: 'datetime-local', required: false });
    const reason = field('reason', 'Reason for this future design', { multiline: true, maximum: 500 });
    root.append(el('details', {}, [el('summary', { text: 'Create a proposed future design draft' }),
      el('p', { text: 'The draft copies the current saved main design and changes this exact item. Its identity and saved base are retained. The declared date never activates the draft automatically.' }),
      form('propose-future-design', 'Save immutable future draft', [title.node, futureName.node, futureDetail.node, from.node, to.node, reason.node], () => onCommand({ kind: 'propose-future-design', objectId: object.id,
        title: title.control.value.trim(), name: futureName.control.value.trim(), detail: futureDetail.control.value.trim(), effectiveFrom: enterpriseUtcTime(from.control.value), effectiveTo: enterpriseUtcTime(to.control.value), reason: reason.control.value.trim() }), disabled || !model.permissions?.scopeAdmin),
    ]));
  }
  const scopeDisabled = loading || Boolean(pending) || (model.context.branchId ? !enterpriseBranchWritable(model) : disabled);
  const scopeCommand = (payload) => {
    if (!model.context.branchId) return onCommand(payload);
    const { reason, ...change } = payload;
    return onCommand({ kind: 'edit-branch-scope', change, reason });
  };
  if (SCOPE_TYPES.has(object.type)) {
    if (object.type === 'legal-entity') root.append(el('p', { text: `Reported jurisdiction: ${object.jurisdiction || 'unknown'}` }));
    if (object.type === 'unit') root.append(el('p', { text: `Parent unit: ${scopes.find((entry) => entry.id === object.parentUnitId)?.name ?? 'None specified'}` }));
    const name = field('name', 'Scope name', { value: object.name, maximum: 120 });
    const detail = field('detail', 'Design purpose and description', { value: object.detail, multiline: true });
    const reason = field('reason', 'Reason for renaming this design scope', { multiline: true, maximum: 500 });
    root.append(form('rename-scope', 'Rename proposed design scope', [name.node, detail.node, reason.node], () => scopeCommand({ kind: 'rename-scope', objectId: object.id, name: name.control.value.trim(), detail: detail.control.value.trim(), reason: reason.control.value.trim() }), scopeDisabled || (model.context.branchId ? !model.permissions?.branchAdmin : !model.permissions?.scopeAdmin)));
  } else {
    const fields = scopeFields(el, scopes, scope ?? {});
    const reason = field('reason', 'Reason for this scope assignment', { multiline: true, maximum: 500 });
    root.append(form('assign-object-scope', 'Save proposed scope assignment', [fields.organization.node, fields.legalEntity.node, fields.unit.node, reason.node], () => scopeCommand({ kind: 'assign-object-scope', objectId: object.id, organizationId: fields.organization.control.value || null, legalEntityId: fields.legalEntity.control.value || null, unitId: fields.unit.control.value || null, reason: reason.control.value.trim() }), scopeDisabled || (!model.context.branchId && !model.permissions?.write)));
  }
  return root;
}
