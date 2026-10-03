import assert from 'node:assert/strict';
import test from 'node:test';
import { enterpriseCommandStorageKey, enterpriseContextFailure, enterpriseContextReadOnly, enterpriseQuery, enterpriseRequestPath, enterpriseSourceAligned, hasEnterpriseContext,
  persistEnterpriseCommand, renderEnterpriseContext,
  renderEnterpriseObject, restoreEnterpriseCommand, submitEnterpriseCommand } from '../../public/enterprise.mjs';
import { enterpriseBranchCommandPayload, enterpriseBranchWritable, enterpriseCandidateCurrent, enterpriseCommandResultRoute,
  renderEnterpriseBranches } from '../../public/enterprise-branches.mjs';
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
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.required = false;
    this.parent = null;
  }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  querySelectorAll(selector) {
    const tags = selector.split(',').map((part) => part.trim());
    return new NodeListFixture(this.children.flatMap((child) => [
      ...(tags.includes(child.tagName) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]));
  }
  reportValidity() { return true; }
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
  node.append(...children);
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
