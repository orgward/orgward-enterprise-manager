import assert from 'node:assert/strict';
import test from 'node:test';
import { renderProtectedRelease } from '../../public/protected-release.mjs';
import { h, readyCandidate } from './candidate-fixture.mjs';

class NodeFixture {
  constructor(tag, options = {}) {
    this.tagName = tag;
    this.attrs = options.attrs ?? {};
    this.className = options.className ?? '';
    this.disabled = false;
    this.value = '';
    this.style = {};
    this.children = [];
    this.listeners = new Map();
    this.text = options.text ?? '';
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  addEventListener(event, handler) { this.listeners.set(event, handler); }
  querySelectorAll(selectors) {
    const tags = selectors.split(',').map((tag) => tag.trim());
    return this.children.flatMap((child) => [
      ...(tags.includes(child.tagName) ? [child] : []), ...child.querySelectorAll(selectors),
    ]);
  }
  reportValidity() { return true; }
  async click() { if (!this.disabled) await this.listeners.get('click')?.({ preventDefault() {} }); }
  get textContent() { return [this.text, ...this.children.map((child) => child.textContent)].filter(Boolean).join(' '); }
  set textContent(value) { this.text = String(value); this.children = []; }
}

const el = (tag, options = {}, children = []) => {
  const node = new NodeFixture(tag, options);
  node.append(...children);
  return node;
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
const findButton = (root, label) => root.querySelectorAll('button').find((button) => button.textContent === label);

function viewFixture(status) {
  const run = readyCandidate({ runId: 'execution-run-00000000-0000-4000-8000-000000000001' });
  run.projectId = 'project-00000000-0000-4000-8000-000000000001';
  const action = { id: 'release-action-00000000-0000-4000-8000-000000000010', version: 4, status,
    requestHash: h('d'), request: { kind: 'release', reason: 'Reviewed candidate', requestedBy: 'requester', expectedGeneration: 3,
      environment: { configurationHash: h('e') }, candidate: { runId: 'execution-run-00000000-0000-4000-8000-000000000002',
        candidateEvidenceHash: h('f'), candidateTreeDigest: h('6'), outputManifestHash: h('5'),
        outputManifest: [{ path: 'dist/app.js', sha256: h('5'), size: 6 }] } },
    approval: { principal: 'approver' }, dispatch: { id: 'dispatch-10' }, events: [],
    observations: [{ status: status === 'UNHEALTHY' ? 'APPLIED' : 'UNKNOWN',
      health: status === 'UNHEALTHY' ? 'unhealthy' : undefined, recordedAt: 'now' }] };
  return { run, action };
}

test('uncertain release outcome keeps release and rollback fenced while exposing a read-only reconciliation action', async () => {
  const { run, action } = viewFixture('OUTCOME_UNKNOWN');
  const requests = [];
  const api = async (route, options = {}) => {
    requests.push({ route, options });
    return { available: true, environments: [{ id: 'production', label: 'Production', riskClass: 'high', assetIds: ['service-api'],
      actionsAllowed: ['release', 'rollback'], permissions: { request: true, approve: false, execute: true },
      state: { generation: 3, current: { runId: 'previous-run', candidateEvidenceHash: h('1'), outputManifest: [] },
        previous: null, pendingActionId: action.id }, actions: [action] }] };
  };
  const root = renderProtectedRelease({ run, principal: 'executor', el, api });
  await settle();
  assert.match(root.textContent, /An outcome is unresolved/);
  assert.match(root.textContent, /Checking the saved outcome does not send another release/);
  assert.equal(findButton(root, 'Request release of selected candidate').disabled, true);
  assert.equal(findButton(root, 'Request rollback to previous candidate').disabled, true);
  const reconcile = findButton(root, 'Check saved outcome');
  assert.equal(reconcile.disabled, false);
  await reconcile.click();
  await settle();
  const command = requests.find(({ options }) => options.method === 'POST');
  assert.match(command.route, /\/release-actions\/release-action-[^/]+\/reconcile$/);
  assert.equal(command.options.method, 'POST');
  const body = JSON.parse(command.options.body);
  assert.equal(body.expectedVersion, action.version);
  assert.equal(body.requestHash, action.requestHash);
});

test('confirmed unhealthy release exposes an independently approved rollback to the last healthy candidate', async () => {
  const { run, action } = viewFixture('UNHEALTHY');
  const lastHealthy = { runId: 'execution-run-last-healthy', candidateEvidenceHash: h('1'),
    candidateTreeDigest: h('2'), outputManifestHash: h('3'), outputManifest: [] };
  let environmentState = { generation: 4, current: lastHealthy,
    previous: action.request.candidate, pendingActionId: action.id };
  const requests = [];
  const api = async (route, options = {}) => {
    requests.push({ route, options });
    return { available: true, environments: [{ id: 'production', label: 'Production', riskClass: 'high', assetIds: ['service-api'],
      actionsAllowed: ['release', 'rollback'], permissions: { request: true, approve: false, execute: true },
      state: environmentState, actions: [action] }] };
  };
  const root = renderProtectedRelease({ run, principal: 'requester', el, api });
  await settle();
  assert.match(root.textContent, /last healthy candidate · recovery rollback target/i);
  assert.match(root.textContent, /Request an independently approved rollback/);
  assert.equal(findButton(root, 'Request release of selected candidate').disabled, true);
  const rollback = findButton(root, 'Request rollback to previous candidate');
  assert.equal(rollback.disabled, false);
  const reason = root.querySelectorAll('textarea')[0];
  reason.value = ' Restore last known healthy service. ';
  await rollback.click();
  await settle();
  const command = requests.find(({ route, options }) => route.endsWith('/release-actions') && options.method === 'POST');
  assert.ok(command);
  assert.equal(command.options.method, 'POST');
  const body = JSON.parse(command.options.body);
  assert.equal(body.kind, 'rollback');
  assert.equal(body.environmentId, 'production');
  assert.equal(body.expectedGeneration, 4);
  assert.equal(body.reason, 'Restore last known healthy service.');
  assert.equal(Object.hasOwn(body, 'runId'), false, 'the server selects the bound last healthy target from saved state');
});
