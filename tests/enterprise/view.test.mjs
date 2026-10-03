import assert from 'node:assert/strict';
import test from 'node:test';
import { enterpriseCommandStorageKey, enterpriseContextFailure, enterpriseQuery, enterpriseRequestPath, enterpriseSourceAligned, hasEnterpriseContext,
  persistEnterpriseCommand, renderEnterpriseContext,
  renderEnterpriseObject, restoreEnterpriseCommand, submitEnterpriseCommand } from '../../public/enterprise.mjs';

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
    return this.children.flatMap((child) => [
      ...(tags.includes(child.tagName) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
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
  assert.equal(enterpriseCommandStorageKey('oidc:owner', 'project-one'),
    'orgward:enterprise-command:oidc%3Aowner:project-one');
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
