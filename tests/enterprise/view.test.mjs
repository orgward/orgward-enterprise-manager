import assert from 'node:assert/strict';
import test from 'node:test';
import { enterpriseCommandStorageKey, enterpriseContextFailure, enterpriseContextReadOnly, enterpriseQuery, enterpriseRequestPath, enterpriseSourceAligned, hasEnterpriseContext,
  enterpriseInterchangeDraftStorageKey, persistEnterpriseCommand, persistEnterpriseInterchangeDraft, renderEnterpriseContext,
  renderEnterpriseObject, restoreEnterpriseCommand, restoreEnterpriseInterchangeDraft, submitEnterpriseCommand } from '../../public/enterprise.mjs';
import { enterpriseBranchCommandPayload, enterpriseBranchWritable, enterpriseCandidateCurrent, enterpriseCommandResultRoute,
  renderEnterpriseBranches } from '../../public/enterprise-branches.mjs';
import { enterpriseProcessCommandPayload, enterpriseTypedValue, renderEnterpriseProcess, renderEnterpriseSimulation } from '../../public/enterprise-process.mjs';
import { activationForTask, evaluateManualFlowAdvice, manualFlowActivation, manualFlowAllowsAgent, manualFlowAgentRequestReady, manualFlowDecisionDefinition,
  mergeProcessPlanActivation, renderManualFlowDecisionChoice } from '../../public/manual-flow-ui.mjs';
import { renderEnterpriseEconomics } from '../../public/enterprise-economics.mjs';
import { renderEnterpriseRefinement } from '../../public/enterprise-refinement.mjs';
import { enterpriseInterchangeCommandPayload, enterpriseInterchangeWritable, renderEnterpriseInterchange } from '../../public/enterprise-interchange.mjs';
import { enterpriseIntegrityCommandPayload, renderEnterpriseIntegrity } from '../../public/enterprise-integrity.mjs';
import { decodeStudioRoute, encodeStudioRoute } from '../../public/shared-interactions.mjs';

class NodeListFixture extends Array {
  constructor(entries) { super(...entries); this.at = undefined; }
  item(index) { return this[index] ?? null; }
}

class NodeFixture {
  constructor(tagName, options = {}) {
    this.tagName = tagName;
    this.attrs = options.attrs ?? {};
    this.text = options.text ?? '';
    this.className = options.className ?? '';
    this.children = [];
    this.listeners = new Map();
    this._value = options.attrs?.value ?? '';
    this.disabled = false;
    this.hidden = false;
    this.required = false;
    this.parent = null;
  }
  append(...nodes) {
    for (const node of nodes) { node.parent = this; this.children.push(node); }
    if (this.tagName === 'select' && !this.children.some((option) => String(option.attrs.value ?? '') === this._value)) {
      this._value = String(this.children[0]?.attrs.value ?? '');
    }
  }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  querySelectorAll(selector) {
    const tags = selector.split(',').map((part) => part.trim());
    return new NodeListFixture(this.children.flatMap((child) => [
      ...(tags.includes(child.tagName) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]));
  }
  reportValidity() { return true; }
  get value() {
    if (this.tagName === 'select') return this.children.find((option) => String(option.attrs.value ?? '') === this._value)?.attrs.value
      ?? this.children[0]?.attrs.value ?? '';
    return this._value;
  }
  set value(value) {
    const selected = String(value ?? '');
    if (this.tagName === 'select') {
      this._value = this.children.some((option) => String(option.attrs.value ?? '') === selected)
        ? selected : String(this.children[0]?.attrs.value ?? '');
    } else this._value = selected;
  }
  get firstChild() {
    if (this.text) {
      const parent = this;
      return { get textContent() { return parent.text; }, set textContent(value) { parent.text = String(value); }, parent };
    }
    return this.children[0] ?? null;
  }
  get textContent() { return [this.text, ...this.children.map((child) => child.textContent)].filter(Boolean).join(' '); }
  set textContent(value) { this.text = String(value); this.children = []; }
}

const el = (tag, options = {}, children = []) => {
  const node = new NodeFixture(tag, options);
  node.append(...(Array.isArray(children) ? children : [children]));
  return node;
};
const branchUi = {
  field(name, label, { entries = null, value = '', required = true, multiline = false } = {}) {
    const control = el(entries ? 'select' : multiline ? 'textarea' : 'input', { attrs: { name } },
      entries ? entries.map(([optionValue, text]) => el('option', { text, attrs: { value: optionValue } })) : []);
    control.value = value ?? ''; control.required = required;
    return { control, node: el('label', { text: label }, [control]) };
  },
  form(kind, label, controls, submit, disabled) {
    const node = el('form', { attrs: { 'data-enterprise-action': kind, 'aria-label': label } }, controls);
    const save = el('button', { text: label }); node.append(save);
    if (disabled) for (const control of node.querySelectorAll('input,select,textarea,button')) control.disabled = true;
    node.addEventListener('submit', submit);
    return node;
  },
};

test('enterprise interchange UI binds edits to the visible source and restores and submits a retained preview draft', async () => {
  const model = { permissions: { write: true }, context: { isCurrent: true, blueprintId: 'blueprint-00000000-0000-4000-8000-000000000001',
    blueprintVersion: 4, effectiveAt: null, recordedAtCutoff: null, proposalId: null, branchId: null }, blueprint: { id: 'visible' } };
  assert.equal(enterpriseInterchangeWritable(model), true);
  assert.deepEqual(enterpriseInterchangeCommandPayload(model, { kind: 'bulk-edit-objects', recordIds: ['customer-x'] }), {
    kind: 'bulk-edit-objects', recordIds: ['customer-x'], blueprintId: model.context.blueprintId, blueprintVersion: 4,
  });
  for (const context of [{ ...model.context, isCurrent: false }, { ...model.context, branchId: 'branch-x' }, { ...model.context, effectiveAt: '2026-10-01' }]) {
    assert.equal(enterpriseInterchangeWritable({ ...model, context }), false);
    assert.equal(enterpriseInterchangeCommandPayload({ ...model, context }, { kind: 'bulk-edit-objects' }), null);
  }
  const rendered = renderEnterpriseInterchange({ projectId: 'project-x', model, el, ui: branchUi, api: async () => ({}), onCommand() {} });
  assert.match(rendered.textContent, /never runs or publishes work/);
  assert.equal(rendered.querySelectorAll('button').some((button) => button.text === 'Apply selected edits as one proposed version'), false);

  const bundle = { kind: 'orgward-enterprise-blueprint' };
  const preview = { source: { projectId: 'source-project', blueprintId: 'source-blueprint', blueprintVersion: 2, snapshotHash: 'source-hash' },
    currentSource: { blueprintId: model.context.blueprintId, blueprintVersion: 4, snapshotHash: 'current-hash' }, recordCount: 1,
    recognizedFields: 1, readyRecordIds: ['customer-x'], previewHash: 'preview-hash', unknownFields: [], lossyFields: [], collisions: [], validationErrors: [],
    rows: [{ id: 'customer-x', type: 'customer', status: 'READY', changedFields: ['name'], recognizedFields: ['name'], unknownFields: [], validationErrors: [] }] };
  const restoredDraft = { bundle, recordIds: ['customer-x'], reason: 'Retained after a definitive rejection.' };
  let restored = null; let called = null; let previewCalls = 0;
  const retryRoot = renderEnterpriseInterchange({ projectId: 'project-x', model, draft: restoredDraft, el, ui: branchUi,
    api: async (_path, options) => { previewCalls += 1; assert.equal(options.method, 'POST'); return { data: preview }; },
    onDraftChange(value) { restored = value; }, onCommand(payload) { called = payload; } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(previewCalls, 1);
  assert.equal(restored.preview, preview);
  assert.match(retryRoot.textContent, /Import preview/);
  const form = retryRoot.querySelectorAll('form').find((node) => node.attrs['data-enterprise-action'] === 'bulk-edit-objects');
  assert.ok(form);
  const reason = form.querySelectorAll('textarea')[0]; reason.value = 'Reviewed and corrected';
  form.listeners.get('submit')({ preventDefault() {} });
  assert.deepEqual(called, { kind: 'bulk-edit-objects', bundle, recordIds: ['customer-x'], reason: 'Reviewed and corrected' });
});

test('source evidence preview shows provenance and candidate identities without an apply action and survives reload', async () => {
  const currentModel = { permissions: { write: true }, context: { isCurrent: true, blueprintId: 'blueprint-00000000-0000-4000-8000-000000000001',
    blueprintVersion: 4, effectiveAt: null, recordedAtCutoff: null, proposalId: null, branchId: null }, blueprint: { id: 'visible' } };
  const bundle = { kind: 'orgward-enterprise-source-evidence', schemaVersion: '1.0', source: { id: 'crm-export', label: 'CRM export' },
    records: [{ id: 'crm-1', type: 'customer', name: 'Small business', claims: [{ id: 'claim-1', path: 'name', value: 'Updated name' }] }] };
  const sourcePreview = { mode: 'SOURCE_ONBOARDING_PREVIEW', meaning: 'UNTRUSTED_EVIDENCE_PROPOSALS_ONLY',
    source: { id: 'crm-export', label: 'CRM export', locator: 'crm://exports/october', snapshotHash: 'a'.repeat(64) },
    currentSource: { blueprintId: currentModel.context.blueprintId, blueprintVersion: 4, snapshotHash: 'b'.repeat(64) },
    recordCount: 1, claimCount: 1, previewHash: 'c'.repeat(64), unknowns: [], collisions: [],
    proposals: [{ identity: { sourceRecordId: 'crm-1', type: 'customer', name: 'Small business', status: 'CANDIDATE', candidateObjectIds: ['customer-1'],
      provenance: { sourceId: 'crm-export', sourceLabel: 'CRM export', sourceLocator: 'crm://exports/october', recordLocator: 'crm-1', sourceHash: 'a'.repeat(64) } },
      claims: [{ id: 'claim-1', path: 'name', value: 'Updated name', status: 'PROPOSED', targetObjectId: 'customer-1',
        provenance: { sourceId: 'crm-export', sourceLocator: 'crm://exports/october', sourceRecordId: 'crm-1', recordLocator: 'crm-1', claimLocator: 'crm-1/name', sourceHash: 'a'.repeat(64) } }] }],
    limitations: ['Preview does not authenticate the source or verify claim truth.', 'No record is written or published.'] };
  const draft = { fileName: 'crm.json', bundle, preview: sourcePreview };
  const rendered = renderEnterpriseInterchange({ projectId: 'project-x', model: currentModel, draft, el, ui: branchUi, api: async () => ({}), onCommand() {} });
  assert.match(rendered.textContent, /Source evidence preview · proposals only/);
  assert.match(rendered.textContent, /crm-export\/crm:\/\/exports\/october\/crm-1\/crm-1\/name/);
  assert.match(rendered.textContent, /Updated name/);
  assert.match(rendered.textContent, /does not authenticate the source or verify claim truth/);
  assert.equal(rendered.querySelectorAll('form').some((form) => form.attrs['data-enterprise-action'] === 'bulk-edit-objects'), false);
  const readerPanel = renderEnterpriseInterchange({ projectId: 'project-x', model: { ...currentModel, permissions: { write: false } },
    el, ui: branchUi, api: async () => ({}), onCommand() {} });
  assert.equal(readerPanel.querySelectorAll('button').find((button) => button.text === 'Preview import').disabled, false);

  const storage = storageFixture();
  persistEnterpriseInterchangeDraft(storage, 'owner', 'project-x', draft);
  assert.equal(storage.getItem(enterpriseInterchangeDraftStorageKey('reader', 'project-x')), null);
  assert.deepEqual(restoreEnterpriseInterchangeDraft(storage, 'owner', 'project-x'), { fileName: 'crm.json', bundle, preview: null, recordIds: [], reason: '' });
  assert.equal(restoreEnterpriseInterchangeDraft(storage, 'owner', 'project-y'), null);
  const retainedDesignDraft = { fileName: 'design.json', bundle: { kind: 'orgward-enterprise-blueprint', records: [] },
    recordIds: ['customer-1'], reason: 'Retain reviewer choice.' };
  persistEnterpriseInterchangeDraft(storage, 'owner', 'project-x', retainedDesignDraft);
  assert.deepEqual(restoreEnterpriseInterchangeDraft(storage, 'owner', 'project-x'), { ...retainedDesignDraft, preview: null });
  const malformedSourceDraft = { fileName: 'malformed-source.json', bundle: { kind: 'orgward-enterprise-source-evidence', schemaVersion: '1.0', records: null } };
  persistEnterpriseInterchangeDraft(storage, 'owner', 'project-x', malformedSourceDraft);
  assert.deepEqual(restoreEnterpriseInterchangeDraft(storage, 'owner', 'project-x'), { ...malformedSourceDraft, preview: null, recordIds: [], reason: '' });
  const repairPanel = renderEnterpriseInterchange({ projectId: 'project-x', model: currentModel, draft: malformedSourceDraft, el, ui: branchUi,
    api: async () => { throw Object.assign(new Error('records must be an array'), { status: 400 }); }, onCommand() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(repairPanel.textContent, /Retained source JSON needs review/);
  assert.equal(repairPanel.querySelectorAll('button').some((button) => button.text === 'Download retained source JSON'), true);
  persistEnterpriseInterchangeDraft(storage, 'owner', 'project-x', draft);
  const restoredDraft = restoreEnterpriseInterchangeDraft(storage, 'owner', 'project-x');
  let recoveredDraft = null;
  const recovered = renderEnterpriseInterchange({ projectId: 'project-x', model: currentModel, draft: restoredDraft, el, ui: branchUi,
    api: async (_path, options) => { assert.equal(options.method, 'POST'); return { data: sourcePreview }; },
    onDraftChange(value) { recoveredDraft = value; }, onCommand() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(recoveredDraft.preview, sourcePreview);
  assert.match(recovered.textContent, /Source evidence preview · proposals only/);
  assert.equal(recovered.querySelectorAll('form').length, 0);
  persistEnterpriseInterchangeDraft(storage, 'owner', 'project-x', null);
  assert.equal(storage.getItem(enterpriseInterchangeDraftStorageKey('owner', 'project-x')), null);

  let releasePreview;
  let isCurrent = true;
  let staleDraftCallback = false;
  const selected = { id: 'customer-1', type: 'customer', name: 'Small business', detail: 'Canonical customer.' };
  const objectModel = model({ blueprint: { areas: { customersOfferingsValueEconomics: { items: [selected] } } },
    selection: { object: selected, states: { basisHash: 'd'.repeat(64) }, visible: true, hiddenBy: [] } });
  const late = renderEnterpriseObject({ projectId: 'project-x', model: objectModel, object: selected, interchangeDraft: { bundle }, el,
    api: () => new Promise((resolve) => { releasePreview = resolve; }), isCurrentContext: () => isCurrent,
    onDraftChange() { staleDraftCallback = true; }, onCommand() {} });
  await new Promise((resolve) => setImmediate(resolve));
  isCurrent = false;
  releasePreview({ data: sourcePreview });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(staleDraftCallback, false);
  assert.doesNotMatch(late.textContent, /Source evidence preview · proposals only/);
});
function storageFixture(values = new Map()) {
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key), values };
}
const lenses = Array.from({ length: 16 }, (_, index) => ({ id: `L-${String(index + 1).padStart(2, '0')}`, label: `Perspective ${index + 1}`, types: [] }));
const object = { id: 'process-deliver', type: 'process', name: 'Deliver the core offering', detail: 'Complete the service.' };
const model = (overrides = {}) => ({
  context: { projectVersion: 7, blueprintId: 'blueprint-00000000-0000-4000-8000-000000000001', blueprintVersion: 3, isCurrent: true, lensId: 'all', scopeId: null, branch: 'main' },
  blueprint: { areas: { responsibilityAuthority: { items: [object] } } },
  scopes: [], versions: [{ id: 'blueprint-current', version: 3, createdAt: '2026-10-01T00:00:00.000Z' }],
  lenses, gaps: [], permissions: { write: true, scopeAdmin: true }, selection: null,
  ...overrides,
});

test('enterprise route preserves the exact perspective, optional scope, history, and selected object', () => {
  assert.deepEqual(enterpriseQuery({}), { lensId: 'all', scopeId: null, blueprintVersion: null });
  const allRoute = enterpriseRequestPath('project one', enterpriseQuery({ lensId: 'all' }), 'process-deliver');
  assert.equal(allRoute, '/api/v1/projects/project%20one/enterprise?lensId=all&selectedId=process-deliver');
  assert.equal(enterpriseRequestPath('project-one', enterpriseQuery({ scopeId: 'organization-one' })),
    '/api/v1/projects/project-one/enterprise?lensId=all&scopeId=organization-one');
  assert.equal(enterpriseRequestPath('project-one', enterpriseQuery({ lensId: 'L-05', blueprintVersion: 2 }), 'unit-child'),
    '/api/v1/projects/project-one/enterprise?lensId=L-05&blueprintVersion=2&selectedId=unit-child');
  const simulationId = 'process-simulation-00000000-0000-4000-8000-000000000001';
  const simulationQuery = enterpriseQuery({ simulationId });
  assert.equal(simulationQuery.simulationId, simulationId);
  assert.equal(enterpriseRequestPath('project-one', simulationQuery, 'process-deliver'),
    `/api/v1/projects/project-one/enterprise?lensId=all&simulationId=${simulationId}&selectedId=process-deliver`);
  assert.equal(hasEnterpriseContext({ simulationId }), true);
  const savedRoute = { projectId: 'project-one', view: 'map', selectedId: 'process-deliver', simulationId };
  assert.equal(decodeStudioRoute(encodeStudioRoute(savedRoute)).simulationId, simulationId);
  assert.equal(enterpriseContextReadOnly({ isCurrent: true }), false);
  assert.equal(enterpriseCommandStorageKey('oidc:owner', 'project-one'),
    'orgward:enterprise-command:oidc%3Aowner:project-one');
});

test('enterprise temporal routes preserve exact proposal and effective/recorded dates', () => {
  const temporal = enterpriseQuery({ proposalId: 'proposal-one', effectiveAt: '2026-10-04T00:00:00.000Z', recordedAt: '2026-10-03T12:00:00.000Z' });
  assert.deepEqual(temporal, { lensId: 'all', scopeId: null, blueprintVersion: null, proposalId: 'proposal-one',
    effectiveAt: '2026-10-04T00:00:00.000Z', recordedAt: '2026-10-03T12:00:00.000Z' });
  assert.equal(enterpriseRequestPath('project-one', temporal, 'process-deliver'),
    '/api/v1/projects/project-one/enterprise?lensId=all&proposalId=proposal-one&effectiveAt=2026-10-04T00%3A00%3A00.000Z&recordedAt=2026-10-03T12%3A00%3A00.000Z&selectedId=process-deliver');
  assert.equal(enterpriseContextReadOnly({ isCurrent: true, effectiveAt: temporal.effectiveAt }), true);
  assert.equal(enterpriseContextReadOnly({ isCurrent: true, proposalId: temporal.proposalId }), true);
  assert.equal(enterpriseContextReadOnly({ isCurrent: true, recordedAtCutoff: temporal.recordedAt }), true);
});

test('branch context route and command helpers retain exact draft revision, source, candidate and recovery destination', async () => {
  const projectId = 'project-00000000-0000-4000-8000-000000000001';
  const branchId = 'enterprise-branch-00000000-0000-4000-8000-000000000002';
  const mainId = 'blueprint-00000000-0000-4000-8000-000000000003';
  const draftId = 'blueprint-00000000-0000-4000-8000-000000000004';
  const candidateId = 'enterprise-merge-00000000-0000-4000-8000-000000000005';
  const candidateHash = 'd'.repeat(64);
  const route = { projectId, view: 'map', selectedId: 'process-deliver', branchId, branchRevision: 2 };
  const decoded = decodeStudioRoute(encodeStudioRoute(route));
  assert.equal(decoded.projectId, projectId);
  assert.equal(decoded.branchId, branchId);
  assert.equal(decoded.branchRevision, 2);
  assert.equal(decoded.selectedId, 'process-deliver');
  assert.equal(encodeStudioRoute(decoded), encodeStudioRoute(route));
  const query = enterpriseQuery({ branchId, branchRevision: 2 });
  assert.deepEqual(query, { lensId: 'all', scopeId: null, blueprintVersion: null, branchId, branchRevision: 2 });
  assert.equal(enterpriseRequestPath(projectId, query, 'process-deliver'),
    `/api/v1/projects/${projectId}/enterprise?lensId=all&branchId=${branchId}&branchRevision=2&selectedId=process-deliver`);

  const createSource = { permissions: { branchCreate: true }, context: { blueprintId: mainId, blueprintVersion: 7,
    branchId: null, proposalId: 'enterprise-proposal-00000000-0000-4000-8000-000000000006' }, blueprint: { id: mainId } };
  assert.deepEqual(enterpriseBranchCommandPayload(createSource, { kind: 'create-branch', title: 'Draft from future source', reason: 'Compare exact proposal.' }), {
    kind: 'create-branch', title: 'Draft from future source', reason: 'Compare exact proposal.', blueprintId: mainId, blueprintVersion: 7,
    proposalId: createSource.context.proposalId,
  });

  const comparison = { mainBlueprintId: mainId, mainBlueprintVersion: 7, mainSnapshotHash: 'a'.repeat(64), conflicts: [] };
  const branchModel = { permissions: { branchCreate: true, branchWrite: true, branchAdmin: true },
    context: { branchId, branchRevision: 2, blueprintId: draftId, blueprintVersion: 3 },
    blueprint: { id: draftId }, branch: { id: branchId, status: 'DRAFT', revision: 2, isHead: true, comparison,
      candidate: { id: candidateId, hash: candidateHash, status: 'PENDING', branchRevision: 2,
        mainBlueprintId: mainId, mainBlueprintVersion: 7, eligibility: { status: 'UNKNOWN' } } } };
  assert.equal(enterpriseBranchWritable(branchModel), true);
  assert.equal(enterpriseCandidateCurrent(branchModel), true);
  assert.equal(enterpriseBranchWritable({ ...branchModel, context: { ...branchModel.context, effectiveAt: '2030-01-01T00:00:00.000Z' } }), false);
  assert.equal(enterpriseBranchWritable({ ...branchModel, context: { ...branchModel.context, branchRevision: 1 } }), false);
  assert.equal(enterpriseCandidateCurrent({ ...branchModel,
    branch: { ...branchModel.branch, revision: 3, candidate: { ...branchModel.branch.candidate, branchRevision: 2 } } }), false);
  assert.equal(enterpriseCandidateCurrent({ ...branchModel, branch: { ...branchModel.branch,
    comparison: { ...comparison, mainBlueprintVersion: 8 } } }), false);
  assert.deepEqual(enterpriseBranchCommandPayload(branchModel, { kind: 'edit-branch-object', edit: { objectId: 'process-deliver' }, reason: 'Draft change.' }), {
    kind: 'edit-branch-object', edit: { objectId: 'process-deliver' }, reason: 'Draft change.', branchId, branchRevision: 2,
    blueprintId: draftId, blueprintVersion: 3,
  });
  assert.deepEqual(enterpriseBranchCommandPayload(branchModel, { kind: 'prepare-merge', resolutions: [], reason: 'Prepare exact candidate.' }), {
    kind: 'prepare-merge', resolutions: [], reason: 'Prepare exact candidate.', branchId, branchRevision: 2,
    blueprintId: mainId, blueprintVersion: 7,
  });
  const reviewPayload = { kind: 'review-merge', candidateId, candidateHash, decision: 'ACCEPT', reason: 'Review.' };
  assert.equal(enterpriseBranchCommandPayload(branchModel, reviewPayload).blueprintId, mainId);
  assert.equal(enterpriseBranchCommandPayload({ ...branchModel, permissions: { ...branchModel.permissions, branchAdmin: false } }, reviewPayload), null);
  for (const status of ['ACCEPTED', 'REJECTED']) assert.equal(enterpriseBranchCommandPayload({ ...branchModel,
    branch: { ...branchModel.branch, candidate: { ...branchModel.branch.candidate, status } } }, reviewPayload), null,
  `${status} is immutable and cannot receive a second review`);
  const failed = enterpriseCommandResultRoute(route, { kind: 'edit-branch-object' }, null);
  assert.deepEqual(failed, route, 'an uncertain or failed command leaves the exact branch route available for recovery');
  assert.deepEqual(enterpriseCommandResultRoute(route, { kind: 'edit-branch-object' }, { branchId, branchRevision: 3, affectedObjectId: 'process-deliver' }),
    { ...route, blueprintVersion: null, proposalId: null, effectiveAt: null, recordedAt: null,
      branchRevision: 3, selectedId: 'process-deliver' });
  const applied = enterpriseCommandResultRoute(route, { kind: 'apply-reviewed-merge' }, { affectedObjectId: 'process-deliver' });
  assert.equal(applied.branchId, null);
  assert.equal(applied.branchRevision, null);
  assert.equal(applied.selectedId, 'process-deliver');

  const storage = storageFixture();
  const saved = { projectId, envelope: { schemaVersion: '1.0', commandId: 'uncertain-branch-command', expectedVersion: 20,
    payload: { kind: 'edit-branch-object', blueprintId: draftId, blueprintVersion: 3, branchId, branchRevision: 2,
      reason: 'Recover this exact draft change.', edit: { objectId: 'process-deliver', name: 'Delivery branch' } } } };
  persistEnterpriseCommand(storage, 'oidc:owner', projectId, saved);
  const restored = restoreEnterpriseCommand(storage, 'oidc:owner', projectId);
  assert.deepEqual(restored, saved);
  const calls = [];
  await submitEnterpriseCommand(async (...args) => { calls.push(args); return { data: {} }; }, projectId, restored);
  assert.deepEqual(calls, [[`/api/v1/projects/${projectId}/enterprise/commands`, { method: 'POST', body: JSON.stringify(saved.envelope) }]]);
});

test('branch review UI compares main and draft fields and keeps unresolved choices explicit', () => {
  const branchId = 'enterprise-branch-00000000-0000-4000-8000-000000000002';
  const mainId = 'blueprint-00000000-0000-4000-8000-000000000003';
  const draftId = 'blueprint-00000000-0000-4000-8000-000000000004';
  const conflicts = [
    { conflictId: `conflict-${'1'.repeat(64)}`, objectId: 'process-deliver', objectName: 'Delivery', field: 'name', kind: 'CONTENT', base: 'Base', current: 'Main', proposed: 'Draft' },
    { conflictId: `conflict-${'2'.repeat(64)}`, objectId: 'process-deliver', objectName: 'Delivery', field: 'inputs', kind: 'REFERENCE', base: ['information-customer-signal'], current: ['information-prioritised-need'], proposed: ['information-delivery-result'] },
    { conflictId: `conflict-${'3'.repeat(64)}`, objectId: 'process-deliver', objectName: 'Delivery', field: 'enterpriseScope', kind: 'SCOPE', base: { organizationId: 'org-base' }, current: { organizationId: 'org-main' }, proposed: { organizationId: 'org-draft' } },
  ];
  const comparison = { mainBlueprintId: mainId, mainBlueprintVersion: 7, conflicts, changes: conflicts,
    relations: { currentAdded: [], currentRemoved: [], branchAdded: [{ source: 'process-deliver', target: 'org-draft', type: 'within-organization' }], branchRemoved: [] } };
  const modelValue = { context: { branchId, branchRevision: 2, blueprintId: draftId, blueprintVersion: 3, validity: null },
    permissions: { branchCreate: true, branchWrite: true, branchAdmin: false },
    blueprint: { areas: { capabilitiesProcesses: { items: [object] } } },
    branches: [], branch: { id: branchId, title: 'Delivery branch', status: 'DRAFT', revision: 2, headRevision: 2,
      baseBlueprintId: mainId, baseBlueprintVersion: 6, baseSnapshotHash: 'a'.repeat(64), isHead: true,
      revisions: [{ revision: 1, recordedAt: '2026-10-03T00:00:00.000Z' }, { revision: 2, recordedAt: '2026-10-03T01:00:00.000Z' }],
      comparison, candidate: { id: 'enterprise-merge-00000000-0000-4000-8000-000000000005', hash: 'b'.repeat(64), status: 'PENDING', branchRevision: 2,
        mainBlueprintId: mainId, mainBlueprintVersion: 7, changes: conflicts, eligibility: { status: 'UNKNOWN' } } } };
  const root = renderEnterpriseBranches({ model: modelValue, query: { branchId, branchRevision: 2 }, el, ui: branchUi,
    onContext: () => {}, onCommand: () => {}, utcTime: (value) => value || null });
  assert.equal(root.attrs['aria-label'], 'Design branches and reviewed merge');
  assert.match(root.textContent, /Both main and draft changed this field/);
  assert.match(root.textContent, /Main added/);
  assert.match(root.textContent, /Draft added/);
  const resolve = root.querySelectorAll('form').find((form) => form.attrs['data-enterprise-action'] === 'prepare-merge');
  assert.ok(resolve);
  assert.equal(resolve.querySelectorAll('select').length, 3);
  assert.ok(resolve.querySelectorAll('select').every((control) => control.children.some((entry) => entry.textContent.startsWith('Keep main:'))
    && control.children.some((entry) => entry.textContent.startsWith('Use draft:'))));
  const apply = root.querySelectorAll('form').find((form) => form.attrs['data-enterprise-action'] === 'apply-reviewed-merge');
  assert.ok(apply.querySelectorAll('button').every((button) => button.disabled), 'pending candidates cannot be applied');
});

test('branch conflict labels use names from the matching base, current, and draft snapshots', () => {
  const branchId = 'enterprise-branch-00000000-0000-4000-8000-000000000012';
  const conflictId = `conflict-${'4'.repeat(64)}`;
  const conflict = { conflictId, objectId: 'process-deliver', objectName: 'Delivery', field: 'enterpriseScope', kind: 'SCOPE',
    base: { organizationId: 'org-base-only' }, current: { organizationId: 'org-current-only' }, proposed: { organizationId: 'org-draft-only' } };
  const referenceNames = { base: { 'org-base-only': 'Base Commerce Group' },
    current: { 'org-current-only': 'Northstar Services' }, proposed: { 'org-draft-only': 'Draft Customer Operations' } };
  const modelValue = { context: { branchId, branchRevision: 1, blueprintId: 'blueprint-draft', blueprintVersion: 1 },
    permissions: { branchWrite: true, branchAdmin: false },
    blueprint: { areas: { capabilitiesProcesses: { items: [object] } } }, branches: [],
    branch: { id: branchId, title: 'Delivery branch', status: 'DRAFT', revision: 1, headRevision: 1, isHead: true,
      revisions: [{ revision: 1, recordedAt: '2026-10-03T00:00:00.000Z' }],
      comparison: { mainBlueprintId: 'blueprint-main', mainBlueprintVersion: 2, changes: [conflict], conflicts: [conflict], referenceNames,
        relations: { currentAdded: [{ source: 'process-deliver', target: 'org-current-only', type: 'within-organization' }], currentRemoved: [],
          branchAdded: [{ source: 'process-deliver', target: 'org-draft-only', type: 'within-organization' }], branchRemoved: [] } },
      candidate: null } };
  let command = null;
  const root = renderEnterpriseBranches({ model: modelValue, query: { branchId, branchRevision: 1 }, el, ui: branchUi,
    onContext: () => {}, onCommand: (value) => { command = value; }, utcTime: (value) => value || null });
  assert.match(root.textContent, /Saved base:.*Base Commerce Group/);
  assert.match(root.textContent, /Current main:.*Northstar Services/);
  assert.match(root.textContent, /Draft:.*Draft Customer Operations/);
  assert.match(root.textContent, /Main added:.*Northstar Services/);
  assert.match(root.textContent, /Draft added:.*Draft Customer Operations/);
  const resolve = root.querySelectorAll('form').find((form) => form.attrs['data-enterprise-action'] === 'prepare-merge');
  const choice = resolve.querySelectorAll('select')[0];
  assert.ok(choice.children.some((entry) => entry.textContent.includes('Keep main:') && entry.textContent.includes('Northstar Services')));
  assert.ok(choice.children.some((entry) => entry.textContent.includes('Use draft:') && entry.textContent.includes('Draft Customer Operations')));
  choice.value = 'current';
  resolve.listeners.get('submit')?.({ preventDefault() {} });
  assert.deepEqual(command.resolutions, [{ conflictId, choice: 'current' }]);
});

test('enterprise process authoring binds current and branch snapshots and requires explicit typed scenario values', () => {
  const process = { id: 'process-transfer', type: 'process', name: 'Transfer funds', detail: 'Move a transfer.' };
  const current = { permissions: { processWrite: true, simulate: true }, context: { blueprintId: 'blueprint-main', blueprintVersion: 8, isCurrent: true }, blueprint: { id: 'blueprint-main' } };
  assert.deepEqual(enterpriseProcessCommandPayload(current, { kind: 'define-process-flow', objectId: process.id, processFlow: { schemaVersion: '1.0' }, reason: 'Record route design.' }), {
    kind: 'define-process-flow', objectId: process.id, processFlow: { schemaVersion: '1.0' }, reason: 'Record route design.',
    blueprintId: 'blueprint-main', blueprintVersion: 8,
  });
  const draft = { ...current, permissions: { processWrite: true, branchWrite: true, simulate: true }, context: { blueprintId: 'blueprint-draft', blueprintVersion: 3,
    branchId: 'enterprise-branch-00000000-0000-4000-8000-000000000021', branchRevision: 4 },
    branch: { id: 'enterprise-branch-00000000-0000-4000-8000-000000000021', status: 'DRAFT', revision: 4, isHead: true } };
  const draftEdit = enterpriseProcessCommandPayload(draft, { kind: 'define-process-flow', objectId: process.id, processFlow: { schemaVersion: '1.0' }, reason: 'Edit the exact draft.' });
  assert.equal(draftEdit.blueprintId, 'blueprint-draft');
  assert.equal(draftEdit.branchId, draft.context.branchId);
  assert.equal(draftEdit.branchRevision, 4);
  const simulation = enterpriseProcessCommandPayload(draft, { kind: 'simulate-process', processId: process.id,
    scenario: { inputs: [], activityOutcomes: [], decisionChoices: [], stepLimit: 12 }, reason: 'Inspect the exact draft flow.' });
  assert.equal(simulation.blueprintId, 'blueprint-draft');
  assert.equal(simulation.branchRevision, 4);
  assert.equal(enterpriseProcessCommandPayload({ ...draft, permissions: { write: false, simulate: false } }, {
    kind: 'simulate-process', processId: process.id, scenario: {}, reason: 'Denied.' }), null);
  assert.equal(enterpriseTypedValue('number', '12.5'), 12.5);
  assert.equal(enterpriseTypedValue('boolean', 'false'), false);
  assert.deepEqual(enterpriseTypedValue('number', '1\n2', true), [1, 2]);
  assert.throws(() => enterpriseTypedValue('number', 'NaN'), /finite number/);
});

test('enterprise process UI shows a saved simulation as exact hypothetical evidence', () => {
  const process = { ...object, id: 'process-transfer', type: 'process', name: 'Transfer funds', owner: 'role-operator', processFlow: {
    schemaVersion: '1.0', startStepId: 'step-intake', steps: [
      { id: 'step-intake', kind: 'manual', title: 'Review transfer', processId: 'process-transfer', roleId: 'role-operator',
        inputIds: ['information-transfer-amount'], outputIds: [], nextStepId: 'step-end', exceptionStepId: null },
      { id: 'step-end', kind: 'end', title: 'Done' },
    ],
  } };
  const information = { id: 'information-transfer-amount', type: 'information', name: 'Transfer amount' };
  const role = { id: 'role-operator', type: 'role', name: 'Operations' };
  const blueprint = { id: 'blueprint-main', areas: { capabilitiesProcesses: { items: [process, information, role] } } };
  const modelValue = { context: { blueprintId: blueprint.id, blueprintVersion: 8, snapshotHash: 'a'.repeat(64), isCurrent: true }, blueprint,
    permissions: { write: true, processWrite: true, simulate: true }, simulations: [] };
  const result = { id: 'process-simulation-00000000-0000-4000-8000-000000000031', status: 'COMPLETED',
    createdAt: '2026-10-03T12:00:00.000Z', createdBy: 'oidc:operator', source: { blueprintId: blueprint.id, blueprintVersion: 8,
      processId: process.id, snapshotHash: 'a'.repeat(64) }, engineVersion: 'orgward-declared-flow-v1', scenarioHash: 'b'.repeat(64),
    resultHash: 'c'.repeat(64), meaning: 'SIMULATION_ONLY', scenario: { inputs: [{ informationId: information.id, value: 125 }] },
    trace: [{ sequence: 1, stepId: 'step-intake', iteration: 0, kind: 'manual', status: 'SUCCEEDED', detail: 'Scenario assumption only.' },
      { sequence: 2, stepId: 'step-end', iteration: 0, kind: 'end', status: 'ENDED', detail: 'Design path ended.' }], unresolved: [] };
  let selectedSimulation = null;
  const root = renderEnterpriseProcess({ model: { ...modelValue, simulation: result, simulations: [{ id: result.id, status: result.status, meaning: result.meaning,
    createdAt: result.createdAt, source: result.source, resultHash: result.resultHash }] }, object: process, simulation: result,
    selectedSimulationId: result.id, el, ui: branchUi, onCommand: () => {}, onSimulationSelection: (id) => { selectedSimulation = id; } });
  assert.equal(root.attrs['aria-label'], 'Typed process authoring and simulation');
  assert.match(root.textContent, /Simulation never starts work, approves a decision or applies a design/);
  assert.match(root.textContent, /Input Transfer amount: 125/);
  assert.match(root.textContent, /Review transfer · iteration 0 · SUCCEEDED/);
  assert.match(root.textContent, /Blueprint blueprint-main · version 8/);
  assert.equal(Array.from(root.querySelectorAll('section')).filter((node) => node.attrs['data-enterprise-simulation-result'] === result.id).length, 1);
  assert.equal(root.querySelectorAll('ol').find((node) => Object.hasOwn(node.attrs, 'data-enterprise-simulation-trace')).querySelectorAll('li').length, 2);
  assert.ok(root.querySelectorAll('form').some((form) => form.attrs['data-enterprise-action'] === 'define-process-flow'));
  assert.ok(root.querySelectorAll('form').some((form) => form.attrs['data-enterprise-action'] === 'simulate-process'));
  const savedFlowTarget = root.querySelectorAll('select').find((control) => control.attrs.name === 'nextStepId');
  assert.equal(savedFlowTarget.value, 'step-end', 'the DOM selection retains a saved forward target after every step is loaded');
  assert.ok(savedFlowTarget.children.some((option) => option.attrs.value === 'step-end'));
  const simulationPicker = root.querySelectorAll('select').find((control) => control.attrs.name === 'simulationId');
  assert.ok(simulationPicker);
  simulationPicker.value = result.id;
  simulationPicker.listeners.get('change')?.();
  assert.equal(selectedSimulation, result.id, 'choosing saved history requests the exact detail record');
});

test('manual-flow UI binds activation, decisions and task occurrences to the exact plan instance', () => {
  const taskId = 'task-flow-0123456789abcdef01234567';
  const decisionTable = { schemaVersion: '1.0', hitPolicy: 'UNIQUE', inputs: [{ informationId: 'information-score', valueType: 'number' }],
    rules: [{ id: 'rule-high', conditions: [{ informationId: 'information-score', operator: 'gte', value: 5 }], outcome: 'HIGH' }], defaultOutcome: 'LOW' };
  const task = { id: taskId, title: 'Review transaction risk', inputs: [{ objectId: 'information-score', label: 'Customer risk score' }],
    flowRef: { stepId: 'risk-gate', iteration: 2, kind: 'decision', decisionId: 'decision-risk',
    decisionTable, outcomes: ['HIGH', 'LOW'], decisionInputs: [{ informationId: 'information-score', valueType: 'number' }] } };
  const taskActivation = { taskId, state: 'READY', reason: 'Reached by verified saved outcomes.', identity: 'a'.repeat(64), trace: [] };
  const planActivation = { planInstanceId: null, state: 'WAITING', identity: 'b'.repeat(64), trace: [], tasks: [taskActivation], steps: [] };
  const plan = { id: 'process-plan-1', kind: 'manual_process_flow_plan', revision: 3,
    source: { projectId: 'project-one', blueprintId: 'blueprint-pinned', blueprintVersion: 4 },
    tasks: [task], activation: planActivation };
  const instanceId = 'process-task-instance-00000000-0000-4000-8000-000000000001';
  const instanceActivation = { ...planActivation, planInstanceId: instanceId, identity: 'c'.repeat(64), tasks: [{ ...taskActivation, state: 'WAITING' }] };
  const rows = [{ projectId: 'project-one', processPlanId: plan.id, revision: plan.revision, planInstanceId: instanceId, activation: instanceActivation }];
  const changedTable = { ...decisionTable, defaultOutcome: 'REVIEW' };
  const project = { blueprintVersions: [{ id: 'blueprint-pinned', version: 4,
    areas: { governanceRiskControls: { items: [{ id: 'decision-risk', decisionTable: changedTable }] } } },
  { id: 'blueprint-latest', version: 5, areas: { governanceRiskControls: { items: [{ id: 'decision-risk', decisionTable: changedTable }] } } }] };

  const merged = mergeProcessPlanActivation([plan], [{ id: plan.id, revision: 3, activation: planActivation }]);
  assert.equal(merged[0].activation.identity, planActivation.identity);
  assert.equal(manualFlowActivation(merged[0], rows, null).planInstanceId, null);
  assert.equal(manualFlowActivation(merged[0], rows, instanceId).identity, instanceActivation.identity);
  assert.equal(manualFlowActivation(merged[0], [{ planInstanceId: 'process-task-instance-other', activation: instanceActivation }], instanceId), null);
  assert.equal(manualFlowActivation(merged[0], [{ ...rows[0], projectId: 'project-other' }], instanceId), null);
  assert.equal(activationForTask(merged[0], rows, taskId, instanceId).state, 'WAITING');
  assert.equal(activationForTask(merged[0], rows, 'task-flow-stale', instanceId), null);
  assert.equal(manualFlowDecisionDefinition(plan, project, task), decisionTable, 'runtime task carries the immutable compiled table instead of a later blueprint definition');
  assert.deepEqual(evaluateManualFlowAdvice(decisionTable, []), { status: 'UNKNOWN', outcome: null });
  assert.deepEqual(evaluateManualFlowAdvice(decisionTable, [{ informationId: 'information-score', value: 8 }]), { status: 'RESOLVED', outcome: 'HIGH' });
  const overlap = { ...decisionTable, rules: [...decisionTable.rules,
    { id: 'rule-overlap', conditions: [{ informationId: 'information-score', operator: 'gte', value: 7 }], outcome: 'LOW' }] };
  assert.deepEqual(evaluateManualFlowAdvice(overlap, [{ informationId: 'information-score', value: 8 }]), { status: 'CONFLICTED', outcome: null });
  const staleRevisionMerge = mergeProcessPlanActivation([plan], [{ id: plan.id, revision: 2, activation: planActivation }]);
  assert.equal(staleRevisionMerge[0], plan, 'a runtime projection from another saved plan revision cannot replace the current plan');
  assert.equal(staleRevisionMerge[1].revision, 2, 'unmatched historical runtime is retained as a separately identified revision');

  task.flowRef.decisionTable = overlap;
  const choice = renderManualFlowDecisionChoice({ project, plan, task, el });
  const scoreControl = choice.node.querySelectorAll('input').find((control) => control.attrs.name === 'information-score');
  const knownControl = choice.node.querySelectorAll('select').find((control) => control.attrs.name === 'known:information-score');
  const outcomeControl = choice.node.querySelectorAll('select').find((control) => control.attrs.name === 'decisionOutcome');
  const reasonControl = choice.node.querySelectorAll('textarea').find((control) => control.attrs.name === 'decisionReason');
  assert.match(choice.node.textContent, /Human decision — Review transaction risk/);
  assert.match(choice.node.textContent, /Observed Customer risk score/);
  assert.match(choice.node.textContent, /Customer risk score: information-score/);
  scoreControl.value = '8'; scoreControl.listeners.get('input')?.();
  assert.ok(choice.node.textContent.includes('Choose the human outcome explicitly'));
  outcomeControl.value = 'LOW'; reasonControl.value = 'Operator records a cautious route.';
  assert.match(choice.node.querySelectorAll('p').find((node) => node.className === 'manual-flow-table-advice').textContent, /CONFLICTED/);
  const savedChoice = choice.read();
  assert.deepEqual(savedChoice, { outcome: 'LOW', observations: [{ informationId: 'information-score', value: 8 }], reason: 'Operator records a cautious route.' });
  const restored = renderManualFlowDecisionChoice({ project, plan, task, el });
  restored.restore(savedChoice);
  assert.deepEqual(restored.read(), savedChoice, 'the exact saved human choice is restored for retry');
  const unknownChoice = { outcome: 'HIGH', observations: [{ informationId: 'information-score', value: null }], reason: 'Input is not known.' };
  restored.restore(unknownChoice);
  assert.equal(restored.node.querySelectorAll('select').find((control) => control.attrs.name === 'known:information-score').value, 'unknown');
  assert.equal(restored.node.querySelectorAll('input').find((control) => control.attrs.name === 'information-score').disabled, true);
  assert.deepEqual(restored.read(), unknownChoice);
});

test('manual-flow agent requests are limited to the exact supported READY occurrence', () => {
  const instanceId = '9f2ac136-bfe2-496f-8502-1eaee607d75e';
  const agentTask = { id: 'task-agent-review', flowRef: { stepId: 'review', iteration: 1, kind: 'manual' } };
  const plan = { id: 'process-plan-manual-agent', kind: 'manual_process_flow_plan', revision: 2,
    source: { projectId: 'project-manual-agent', blueprintId: 'blueprint-1', blueprintVersion: 4 }, tasks: [agentTask],
    activation: { planInstanceId: null, tasks: [{ taskId: agentTask.id, state: 'READY' }] } };
  const runtimeTask = { ...agentTask, activation: undefined };
  const instanceActivation = { planInstanceId: instanceId, tasks: [{ taskId: agentTask.id, state: 'READY' }] };
  const rows = [{ projectId: plan.source.projectId, processPlanId: plan.id, revision: plan.revision,
    planInstanceId: instanceId, taskId: agentTask.id, activation: instanceActivation }];
  assert.equal(manualFlowAllowsAgent(agentTask), true);
  assert.equal(manualFlowAllowsAgent({ ...agentTask, flowRef: { ...agentTask.flowRef, kind: 'manual-exception' } }), true);
  for (const kind of ['decision', 'loop', 'fork', 'join', 'end', 'legacy-dag']) {
    assert.equal(manualFlowAllowsAgent({ ...agentTask, flowRef: { ...agentTask.flowRef, kind } }), false, `${kind} cannot be assigned to an agent`);
  }
  assert.equal(manualFlowAgentRequestReady(plan, [], agentTask, null), true);
  assert.equal(manualFlowAgentRequestReady(plan, rows, agentTask, instanceId), true);
  assert.equal(manualFlowAgentRequestReady({ ...plan, kind: 'process_plan' }, rows, agentTask, instanceId), false);
  assert.equal(manualFlowAgentRequestReady(plan, rows, { ...agentTask, id: 'task-copied-elsewhere' }, instanceId), false);
  for (const patch of [
    { stepId: 'other-step' }, { iteration: 2 }, { kind: 'decision' },
  ]) assert.equal(manualFlowAgentRequestReady(plan, rows, { ...agentTask, flowRef: { ...agentTask.flowRef, ...patch } }, instanceId), false,
    `the pinned occurrence rejects ${JSON.stringify(patch)}`);
  assert.equal(manualFlowAgentRequestReady(plan, [{ ...rows[0], projectId: 'project-other' }], agentTask, instanceId), false);
  assert.equal(manualFlowAgentRequestReady(plan, [{ ...rows[0], processPlanId: 'process-plan-other' }], agentTask, instanceId), false);
  assert.equal(manualFlowAgentRequestReady(plan, [{ ...rows[0], revision: 1 }], agentTask, instanceId), false);
  assert.equal(manualFlowAgentRequestReady(plan, [{ ...rows[0], planInstanceId: '9f2ac136-bfe2-496f-8502-1eaee607d75f' }], agentTask, instanceId), false);
  for (const state of ['WAITING', 'SKIPPED', 'BLOCKED', 'SUCCEEDED', 'FAILED']) {
    const notReady = [{ ...rows[0], activation: { ...instanceActivation, tasks: [{ taskId: agentTask.id, state }] } }];
    assert.equal(manualFlowAgentRequestReady(plan, notReady, agentTask, instanceId), false, `${state} does not authorize a new agent request`);
  }
  assert.equal(runtimeTask.flowRef.kind, 'manual');
});

test('an unavailable requested enterprise context stays explicit and offers an intentional reset', () => {
  const requested = { lensId: 'L-99', scopeId: 'missing-scope', blueprintVersion: 42 };
  const root = renderEnterpriseContext({ model: null, query: requested, error: 'Requested context is unavailable', el,
    onContext: () => {}, onCommand: () => {}, onRetry: () => {} });
  assert.match(root.textContent, /Requested enterprise context unavailable/i);
  assert.match(root.textContent, /has not been replaced with another context/i);
  assert.equal(root.querySelectorAll('select').length, 0);
  assert.ok(root.querySelectorAll('button').some((button) => button.textContent === 'Open current design with all objects'));
});

test('default perspective failure preserves the existing map while explicit route context stays unavailable', async () => {
  assert.equal(hasEnterpriseContext({}), false);
  assert.equal(hasEnterpriseContext({ lensId: 'all' }), true, 'an explicit all-lens route is still an explicit request');
  assert.deepEqual(enterpriseContextFailure(false, 'API unavailable'), { error: null, unavailable: 'API unavailable' });
  assert.deepEqual(enterpriseContextFailure(true, 'scope was deleted'), { error: 'scope was deleted', unavailable: null });
  let reloads = 0;
  const defaultFailure = renderEnterpriseContext({ model: model(), query: { lensId: 'all', scopeId: null, blueprintVersion: null },
    unavailable: 'API unavailable', el, onContext: () => {}, onCommand: () => {}, onRetry: () => {}, onReload: () => { reloads += 1; } });
  assert.match(defaultFailure.textContent, /existing saved blueprint and map remain available/);
  assert.equal(defaultFailure.querySelectorAll('form').length, 0);
  await defaultFailure.querySelectorAll('button').find((button) => button.attrs['data-enterprise-reload'] !== undefined)
    .listeners.get('click')?.({ preventDefault() {} });
  assert.equal(reloads, 1);
  const requestedFailure = renderEnterpriseContext({ model: null, query: { lensId: 'L-08', scopeId: null, blueprintVersion: null },
    ...enterpriseContextFailure(true, 'API unavailable'), el, onContext: () => {}, onCommand: () => {}, onRetry: () => {} });
  assert.match(requestedFailure.textContent, /requested lens, scope or version has not been replaced/);
});

test('enterprise API source must align with the loaded project while historical snapshots align to its version', () => {
  const project = { version: 8, latestBlueprint: { id: 'blueprint-current', version: 4 } };
  const currentModel = { context: { projectVersion: 8, blueprintId: 'blueprint-current', blueprintVersion: 4, isCurrent: true },
    blueprint: { id: 'blueprint-current' } };
  assert.equal(enterpriseSourceAligned(project, currentModel), true);
  assert.equal(enterpriseSourceAligned({ ...project, version: 9 }, currentModel), false);
  assert.equal(enterpriseSourceAligned(project, { ...currentModel, context: { ...currentModel.context, blueprintVersion: 3 } }), false);
  assert.equal(enterpriseSourceAligned(project, { context: { projectVersion: 8, blueprintId: 'blueprint-history', blueprintVersion: 2, isCurrent: false },
    blueprint: { id: 'blueprint-history' } }), true);
  assert.equal(enterpriseSourceAligned(project, { context: { projectVersion: 7, blueprintId: 'blueprint-history', blueprintVersion: 2, isCurrent: false },
    blueprint: { id: 'blueprint-history' } }), false);
});

test('dated and future enterprise contexts show human-report provenance and disable mutation controls', () => {
  const selected = { ...object };
  const states = { basisHash: 'a'.repeat(64),
    lifecycle: { value: 'ACTIVE', evidenceKind: 'HUMAN_REPORTED', recordedBy: 'oidc:owner', recordedAt: '2026-10-03T10:00:00.000Z',
      reason: 'Owner report.', evidenceSummary: 'Reported active use.', stale: false },
    review: { value: 'UNREVIEWED', evidenceKind: 'UNKNOWN', stale: false },
    implementation: { value: 'UNKNOWN', evidenceKind: 'UNKNOWN', stale: false },
    observation: { value: 'UNKNOWN', evidenceKind: 'UNKNOWN', stale: false } };
  const datedModel = model({ context: { projectVersion: 8, blueprintId: 'blueprint-current', blueprintVersion: 4,
    isCurrent: false, lensId: 'all', scopeId: null, branch: 'main', effectiveAt: '2026-10-04T00:00:00.000Z',
    effectiveStatus: 'IN_RANGE' }, selection: { object: selected, states, visible: true, hiddenBy: [] },
  permissions: { write: true, scopeAdmin: true } });
  const root = renderEnterpriseObject({ model: datedModel, object: selected, el, onCommand: () => {} });
  assert.match(root.textContent, /Human reported/);
  assert.match(root.textContent, /Reported evidence: Reported active use/);
  for (const action of ['record-state', 'propose-future-design', 'assign-object-scope']) {
    const form = root.querySelectorAll('form').find((entry) => entry.attrs['data-enterprise-action'] === action);
    assert.ok(form, `${action} remains visible for explanation`);
    assert.ok(form.querySelectorAll('input,select,textarea,button').every((control) => control.disabled), `${action} is read-only`);
  }
  assert.equal(enterpriseContextReadOnly({ isCurrent: true, recordedAtCutoff: '2026-10-03T10:00:00.000Z' }), true);
});

test('future proposal remains visibly proposed after its effective date and has no context mutation authority', () => {
  const proposalId = 'enterprise-proposal-00000000-0000-4000-8000-000000000001';
  const futureModel = model({
    context: { projectVersion: 9, blueprintId: 'blueprint-future', blueprintVersion: 5, isCurrent: false,
      lensId: 'all', scopeId: null, branch: 'main', proposalId, sourceKind: 'FUTURE_PROPOSAL',
      effectiveAt: '2030-01-02T00:00:00.000Z', effectiveStatus: 'IN_RANGE',
      validity: { effectiveFrom: '2030-01-01T00:00:00.000Z', effectiveTo: null } },
    blueprint: { id: 'blueprint-future', areas: { responsibilityAuthority: { items: [object] } } },
    versions: [{ id: 'blueprint-main', version: 4, createdAt: '2026-10-01T00:00:00.000Z' }],
    proposals: [{ id: proposalId, title: 'Future service design', baseBlueprintVersion: 4, effectiveFrom: '2030-01-01T00:00:00.000Z' }],
    proposal: { id: proposalId, title: 'Future service design', status: 'PROPOSED', baseBlueprintId: 'blueprint-main',
      baseBlueprintVersion: 4, baseSnapshotHash: 'b'.repeat(64), proposalHash: 'c'.repeat(64), baseStale: false,
      diff: { before: { name: object.name }, after: { name: 'Future service' }, changedFields: ['name'] } },
    permissions: { write: false, scopeAdmin: false },
  });
  const root = renderEnterpriseContext({ model: futureModel, query: { lensId: 'all', scopeId: null, blueprintVersion: null,
    proposalId, effectiveAt: futureModel.context.effectiveAt }, el, onContext: () => {}, onCommand: () => {}, onRetry: () => {} });
  assert.match(root.textContent, /proposed future draft · read only/);
  assert.match(root.textContent, /The draft stays proposed after its effective date/);
  assert.match(root.textContent, /within the declared interval/);
  for (const action of ['create-scope', 'set-validity']) {
    const form = root.querySelectorAll('form').find((entry) => entry.attrs['data-enterprise-action'] === action);
    assert.ok(form, `${action} remains visible as a disabled explanation`);
    assert.ok(form.querySelectorAll('input,select,textarea,button').every((control) => control.disabled));
  }
});

test('a filtered selection remains inspectable with a clear lens and scope explanation', () => {
  const selected = { ...object, enterpriseScope: { organizationId: 'org-one', legalEntityId: null, unitId: null } };
  const projected = model({
    context: { projectVersion: 8, blueprintId: 'blueprint-next', blueprintVersion: 4, isCurrent: true, lensId: 'L-01', scopeId: 'org-two', branch: 'main' },
    selection: { object: selected, visible: false, hiddenBy: ['scope', 'lens'] },
  });
  const root = renderEnterpriseObject({ model: projected, object: selected, el, onCommand: () => {} });
  assert.equal(root.attrs['aria-label'], 'Selected object design scope');
  assert.match(root.textContent, /outside this perspective: design scope filter, perspective filter/i);
  assert.match(root.textContent, /Its saved identity and inspector remain selected/);
  assert.ok(root.querySelectorAll('form').some((form) => form.attrs['data-enterprise-action'] === 'assign-object-scope'));
});

test('pending enterprise command exposes exact-result recovery and disables new scope edits', async () => {
  const savedCommand = { commandId: 'same-command', payload: { kind: 'create-scope', name: 'North Division' } };
  const recovery = [];
  const root = renderEnterpriseContext({ model: model(), query: { lensId: 'all', scopeId: null, blueprintVersion: null },
    pending: savedCommand, el, onContext: () => {}, onCommand: () => {}, onRetry: () => recovery.push(savedCommand) });
  const createForm = root.querySelectorAll('form').find((form) => form.attrs['data-enterprise-action'] === 'create-scope');
  assert.ok(createForm);
  assert.ok(createForm.querySelectorAll('input,select,textarea,button').every((control) => control.disabled));
  const retry = root.querySelectorAll('button').find((button) => button.attrs['data-enterprise-retry'] !== undefined);
  assert.ok(retry);
  await retry.listeners.get('click')?.({ preventDefault() {} });
  assert.deepEqual(recovery, [savedCommand]);
});

test('enterprise command recovery persists and resubmits the identical envelope after remount', async () => {
  const values = new Map();
  const saved = { projectId: 'project-one', envelope: { schemaVersion: '1.0', commandId: 'cmd-123', expectedVersion: 8,
    payload: { kind: 'rename-scope', blueprintId: 'blueprint-1', blueprintVersion: 4, objectId: 'org_north_1',
      name: 'Northstar Group', detail: 'Parent scope', reason: 'Persist this exact command.' } } };
  persistEnterpriseCommand(storageFixture(values), 'oidc:owner', 'project-one', saved);
  const restored = restoreEnterpriseCommand(storageFixture(values), 'oidc:owner', 'project-one');
  assert.deepEqual(restored, saved);
  const calls = [];
  const api = async (...args) => { calls.push(args); return { data: { affectedObjectId: 'org_north_1' } }; };
  await submitEnterpriseCommand(api, 'project-one', restored);
  assert.deepEqual(calls, [['/api/v1/projects/project-one/enterprise/commands', {
    method: 'POST', body: JSON.stringify(saved.envelope),
  }]]);
  persistEnterpriseCommand(storageFixture(values), 'oidc:owner', 'project-one', null);
  assert.equal(restoreEnterpriseCommand(storageFixture(values), 'oidc:owner', 'project-one'), null);
});

test('first-run enterprise context gives blueprint guidance without rendering scope mutation forms', () => {
  const initial = model({
    context: { projectVersion: 1, blueprintId: null, blueprintVersion: null, isCurrent: false, lensId: 'all', scopeId: null, branch: 'main' },
    blueprint: null, graph: { nodes: [], links: [], types: [] }, scopes: [], versions: [],
    permissions: { write: false, scopeAdmin: false }, gaps: [{ code: 'BLUEPRINT_REQUIRED', message: 'Save the initial blueprint to explore and define enterprise scopes.' }],
  });
  const root = renderEnterpriseContext({ model: initial, query: { lensId: 'all', scopeId: null, blueprintVersion: null }, el,
    onContext: () => {}, onCommand: () => {}, onRetry: () => {} });
  assert.match(root.textContent, /Save the initial blueprint to explore and define enterprise scopes/);
  assert.equal(root.querySelectorAll('form').length, 0);
});

test('saved economics UI explains each allocation with its process identity and source', () => {
  const process = { id: 'process-deliver', type: 'process', name: 'Deliver the core offering', detail: 'Complete the service.' };
  const resource = { id: 'resource-capacity', type: 'resource', name: 'Delivery capacity', detail: 'Staffing.' };
  const economics = { id: 'economics-launch', type: 'economics', name: 'Launch economics', detail: 'Declared assumptions.' };
  const evaluation = { id: 'economic-evaluation-00000000-0000-4000-8000-000000000001', economicsId: economics.id,
    createdAt: '2026-10-04T00:00:00.000Z', createdBy: 'oidc:owner', reason: 'Review reported allocation.', status: 'CONSTRAINED',
    source: { blueprintId: model().context.blueprintId, blueprintVersion: 3, snapshotHash: 'a'.repeat(64), branchId: null, branchRevision: null, proposalId: null },
    sourceLabels: { records: { [economics.id]: economics.name, [process.id]: process.name } },
    scenario: { window: { start: '2026-10-01T00:00:00.000Z', end: '2026-10-02T00:00:00.000Z' } }, metrics: {},
    resources: [{ resourceId: resource.id, resourceName: resource.name, status: 'CONSTRAINED',
      window: { start: '2026-10-01T00:00:00.000Z', end: '2026-10-02T00:00:00.000Z' }, metrics: {}, constraints: [], demands: [],
      allocations: [{ id: 'allocation-staffing', processId: process.id, state: 'COMMITTED_REPORTED',
        quantity: { value: 12, unit: 'hours', source: 'Human staffing forecast' } }],
    }], constraints: [], explanations: [] };
  const sourceModel = model({ context: { ...model().context, snapshotHash: 'a'.repeat(64) },
    blueprint: { areas: { responsibilityAuthority: { items: [economics] }, capabilitiesProcesses: { items: [process] }, resources: { items: [resource] } } },
    permissions: { economicWrite: true, economicEvaluate: true }, economics: { evaluation } });
  const panel = renderEnterpriseEconomics({ model: sourceModel, object: economics, el, ui: branchUi, onCommand() {} });
  assert.match(panel.textContent, /allocation-staffing/);
  assert.match(panel.textContent, /Deliver the core offering/);
  assert.match(panel.textContent, /Human staffing forecast/);
});

test('refinement UI names both reverse trace directions and saves selected existing records', () => {
  const parent = { id: 'goal-safe-service', name: 'Safe service', type: 'goal' };
  const selected = { id: 'process-review', name: 'Review exception', type: 'process', refines: [] };
  const child = { id: 'task-check-evidence', name: 'Check evidence', type: 'process' };
  const sourceModel = model({ blueprint: { areas: { purposeStrategy: { items: [parent] }, capabilitiesProcesses: { items: [selected, child] } } },
    context: { ...model().context, blueprintId: 'blueprint-00000000-0000-4000-8000-000000000001' },
    permissions: { processWrite: true }, refinementTrace: { selectedId: selected.id, status: 'LINKED', explanation: 'Saved design links only.',
      ancestors: [{ id: parent.id, name: parent.name, type: parent.type, depth: 1, path: [selected.id, parent.id] }],
      descendants: [{ id: child.id, name: child.name, type: child.type, depth: 1, path: [selected.id, child.id] }] } });
  let submitted = null;
  const panel = renderEnterpriseRefinement({ model: sourceModel, object: selected, el, ui: branchUi, onCommand: (payload) => { submitted = payload; } });
  assert.match(panel.textContent, /Refinement and reverse trace/);
  assert.match(panel.textContent, /Refines \/ higher-level \(1\)/);
  assert.match(panel.textContent, /Refined by \/ lower-level \(1\)/);
  assert.match(panel.textContent, /do not establish implementation, evidence or operational status/);
  const controls = Array.from(panel.querySelectorAll('input')).filter((control) => control.attrs.name === 'refines');
  assert.equal(controls.length, 2);
  for (const control of controls) control.value = control.attrs.value;
  controls.find((control) => control.value === parent.id).checked = true;
  const form = panel.querySelectorAll('form')[0];
  form.listeners.get('submit')({ preventDefault() {} });
  assert.deepEqual(submitted, { kind: 'define-refinement', objectId: selected.id, refines: [parent.id], reason: '' });
});

test('integrity UI binds each run to the current saved snapshot and labels report findings', () => {
  const assessment = { id: 'enterprise-integrity-00000000-0000-4000-8000-000000000001', status: 'REVIEW',
    source: { blueprintVersion: 3, snapshotHash: 'a'.repeat(64) }, appliesToContext: true,
    createdAt: '2026-10-04T10:00:00.000Z', createdBy: 'owner', reason: 'Check proposed design.',
    counts: { failedRules: 0, reviewRules: 1, findings: 1 },
    rules: [{ id: 'design.completeness', status: 'REVIEW', findingCount: 1, summary: 'Completeness gaps remain.' }],
    findings: [{ id: 'finding-one', severity: 'high', code: 'gap-owner', objectId: 'process-deliver', message: 'Assign an owner.', action: 'Choose an owner.' }] };
  const sourceModel = model({ context: { ...model().context, snapshotHash: 'a'.repeat(64), sourceKind: 'MAIN_DESIGN' },
    permissions: { integrityRun: true }, integrity: { current: assessment, latest: assessment, assessments: [assessment] } });
  const exactPayload = enterpriseIntegrityCommandPayload(sourceModel, ' Recheck ');
  assert.deepEqual(exactPayload, { kind: 'run-integrity-checks', blueprintId: sourceModel.context.blueprintId,
    blueprintVersion: 3, snapshotHash: 'a'.repeat(64), reason: 'Recheck' });
  assert.equal(enterpriseIntegrityCommandPayload({ ...sourceModel, context: { ...sourceModel.context, isCurrent: false } }, 'Recheck'), null);

  let submitted = null;
  const panel = renderEnterpriseIntegrity({ model: sourceModel, el, ui: branchUi, onCommand: (payload) => { submitted = payload; } });
  assert.equal(panel.attrs['aria-label'], 'Integrity and lineage assessment');
  assert.match(panel.textContent, /never changes design, grants authority or verifies business outcomes/);
  assert.match(panel.textContent, /gap-owner/);
  const form = panel.querySelectorAll('form')[0];
  form.querySelectorAll('textarea')[0].value = 'Recheck';
  form.listeners.get('submit')({ preventDefault() {} });
  assert.deepEqual(submitted, exactPayload);

  const staleAssessment = { ...assessment, appliesToContext: false };
  const staleModel = { ...sourceModel, context: { ...sourceModel.context, snapshotHash: 'b'.repeat(64) },
    integrity: { current: null, latest: staleAssessment, assessments: [staleAssessment] } };
  const stalePanel = renderEnterpriseIntegrity({ model: staleModel, el, ui: branchUi, onCommand() {} });
  assert.match(stalePanel.textContent, /STALE · This saved assessment/);
  assert.match(stalePanel.textContent, new RegExp(assessment.source.snapshotHash));
  assert.match(stalePanel.textContent, /Assign an owner\./);
});
