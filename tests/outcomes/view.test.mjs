import assert from 'node:assert/strict';
import test from 'node:test';
import { renderOutcomeInbox } from '../../public/outcomes.mjs';
import { openInitialCase, sourceObjectPreview } from '../../public/sdlc-routing.mjs';

class NodeFixture {
  constructor(tagName, options = {}) {
    this.tagName = tagName;
    this.attrs = options.attrs ?? {};
    this.text = options.text ?? '';
    this.className = options.className ?? '';
    this.children = [];
    this.listeners = new Map();
    this.style = {};
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.required = false;
    this.open = false;
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
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
  async click() { if (!this.disabled) await this.listeners.get('click')?.({ preventDefault() {} }); }
  async submit() { if (!this.disabled) await this.listeners.get('submit')?.({ preventDefault() {} }); }
  get textContent() { return [this.text, ...this.children.map((child) => child.textContent)].filter(Boolean).join(' '); }
  set textContent(value) { this.text = String(value); this.children = []; }
}

const el = (tag, options = {}, children = []) => {
  const node = new NodeFixture(tag, options);
  node.append(...children);
  return node;
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
const findForm = (root, label) => root.querySelectorAll('form').find((form) => form.attrs['aria-label'] === label);
const findButton = (root, label) => root.querySelectorAll('button').find((button) => button.textContent === label);

function storageFixture() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
}

function acceptedOutcome({ followUpCaseId = null } = {}) {
  return { id: 'outcome-00000000-0000-4000-8000-000000000010', version: 5, status: 'OPEN',
    title: 'Reduce failed transfers', category: 'incident', ownerPrincipal: 'oidc:owner',
    source: { kind: 'task', runId: 'execution-run-00000000-0000-4000-8000-000000000001' },
    observations: [{ window: '1–7 October', recordedAt: '2026-10-03T12:00:00.000Z', measures: [
      { dimension: 'technical', name: 'Successful runs', actual: 8, target: 10, comparison: 'gte', unit: 'count', evidenceSummary: 'Saved task results', observedAt: '2026-10-03T12:00:00.000Z', status: 'NOT_MET', evidenceKind: 'HUMAN_REPORTED' },
    ] }],
    latestEvaluation: { technical: 'NOT_MET', control: 'UNKNOWN', business: 'UNKNOWN', observationHash: 'a'.repeat(64) },
    proposals: [{ id: 'learning-1', title: 'Retry bounded transfer errors', recommendation: 'Add a bounded retry path.', rationale: 'The observed technical target was missed.',
      observationHash: 'a'.repeat(64), proposalHash: 'b'.repeat(64), status: followUpCaseId ? 'ACCEPTED' : 'PROPOSED',
      review: followUpCaseId ? { decision: 'accept', principal: 'oidc:owner', reason: 'Matches the evidence.' } : null,
      followUpCaseId, followUpSourceSelectionHash: followUpCaseId ? 'c'.repeat(64) : null }],
    events: [] };
}

function inbox(outcome) {
  return { available: true, outcomes: [outcome], permissions: { write: true, review: true, assign: true, followUp: true },
    sources: {
      members: [{ principal: 'oidc:owner', displayName: 'Case owner', access: 'owner' }],
      releases: [{ actionId: 'release-action-00000000-0000-4000-8000-000000000001', environmentId: 'Production', status: 'SUCCEEDED' }],
      tasks: [{ runId: 'execution-run-00000000-0000-4000-8000-000000000001', title: 'Transfer run', status: 'COMPLETED' }],
      design: { projectVersion: 7, blueprintId: 'blueprint-current', blueprintVersion: 3,
        objects: [{ id: 'goal-customer-outcome', type: 'goal', name: 'Reliable transfers' }] },
    } };
}

test('outcome inbox shows project sources and exposes the exact linked change-case URL', async () => {
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = storageFixture();
  try {
    const outcome = acceptedOutcome({ followUpCaseId: 'change-case-00000000-0000-4000-8000-000000000022' });
    const api = async () => inbox(outcome);
    const root = renderOutcomeInbox({ projectId: 'project-one', principal: 'oidc:owner', el, api,
      preferredSource: { kind: 'task', runId: 'execution-run-00000000-0000-4000-8000-000000000001' } });
    await settle();
    assert.equal(root.attrs['aria-label'], 'Project outcome inbox');
    assert.match(root.textContent, /Technical: NOT_MET · control: UNKNOWN · business: UNKNOWN/);
    assert.match(root.textContent, /Human reported/);
    assert.match(root.textContent, /Release Production/);
    assert.match(root.textContent, /Task Transfer run/);
    const link = root.querySelectorAll('a').find((node) => node.textContent === 'Open linked change case');
    assert.ok(link);
    assert.equal(link.attrs.href, '/sdlc.html?case=change-case-00000000-0000-4000-8000-000000000022');
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  }
});

test('uncertain outcome command survives inbox remount and retries its exact payload once', async () => {
  const originalStorage = globalThis.localStorage;
  const storage = storageFixture();
  globalThis.localStorage = storage;
  try {
    const outcome = acceptedOutcome();
    const calls = [];
    let uncertain = true;
    const api = async (route, options) => {
      calls.push({ route, options });
      if (!options) return inbox(outcome);
      if (uncertain) { uncertain = false; throw Object.assign(new Error('response lost'), { status: 503 }); }
      return { outcome, replayed: true };
    };
    const first = renderOutcomeInbox({ projectId: 'project-one', principal: 'oidc:owner', el, api });
    await settle();
    const proposal = findForm(first, 'Propose learning');
    assert.ok(proposal);
    const fields = proposal.querySelectorAll('input,textarea');
    fields[0].value = 'Retry bounded transfer errors';
    fields[1].value = 'Add a bounded retry path.';
    fields[2].value = 'The observed technical target was missed.';
    await proposal.submit();
    await settle();
    const savedCall = calls.find(({ options }) => options?.method === 'POST');
    assert.ok(savedCall);
    const savedPayload = JSON.parse(savedCall.options.body);
    assert.equal(savedCall.route, `${'/api/v1/projects/project-one/outcomes'}/${outcome.id}/propose`);
    assert.equal(savedPayload.observationHash, outcome.latestEvaluation.observationHash);
    assert.match(rootText(first), /response is uncertain/i);
    assert.ok([...storage.values.keys()].some((key) => key.includes('outcome-command')));

    const second = renderOutcomeInbox({ projectId: 'project-one', principal: 'oidc:owner', el, api });
    await settle();
    const retry = findButton(second, 'Retry saved command: Propose learning');
    assert.ok(retry);
    await retry.click();
    await settle();
    const retriedCall = calls.filter(({ options }) => options?.method === 'POST')[1];
    assert.deepEqual(retriedCall, savedCall);
    assert.equal(storage.values.size, 0, 'a recovered response clears the pending command');
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  }
});

test('change-case deep link selects its exact saved case on reload and does not fall back when unavailable', async () => {
  const available = [{ id: 'change-case-other' }, { id: 'change-case-linked' }];
  const selected = [];
  const notices = [];
  const opened = await openInitialCase({ search: '?case=change-case-linked', cases: available,
    loadCase: async (id) => selected.push(id), showWelcome: () => selected.push('welcome'), notify: (message) => notices.push(message) });
  assert.deepEqual(opened, { state: 'opened', caseId: 'change-case-linked' });
  assert.deepEqual(selected, ['change-case-linked']);

  selected.length = 0;
  const unavailable = await openInitialCase({ search: '?case=change-case-not-owned', cases: available,
    loadCase: async (id) => selected.push(id), showWelcome: () => selected.push('welcome'), notify: (message) => notices.push(message) });
  assert.deepEqual(unavailable, { state: 'unavailable', caseId: 'change-case-not-owned' });
  assert.deepEqual(selected, ['welcome'], 'an unavailable linked case does not select a different case');
  assert.match(notices.at(-1), /unavailable to your current identity/i);
});

test('SDLC project deep link previews the exact workspace saved source', async () => {
  const selectedProject = { id: 'project-selected', name: 'Selected workspace', version: 8,
    latestBlueprint: { id: 'blueprint-selected', version: 5, areas: {} } };
  const otherProject = { id: 'project-first', name: 'First workspace' };
  const selectedObject = { id: 'object-selected', name: 'Selected information', type: 'information', detail: 'Current customer record.' };
  let welcomeOptions;
  const openedCases = [];
  const route = await openInitialCase({ search: '?projectId=project-selected', cases: [{ id: 'case-existing' }],
    projects: [otherProject, selectedProject], loadCase: async (id) => openedCases.push(id),
    showWelcome: (options) => { welcomeOptions = options; }, notify() {} });
  assert.deepEqual(route, { state: 'welcome', projectId: 'project-selected' });
  assert.deepEqual(welcomeOptions, { requestedProjectId: 'project-selected', exactProjectRequested: true });
  assert.deepEqual(openedCases, [], 'a project deep link opens the case form without selecting or creating a case');
  assert.equal(sourceObjectPreview(selectedProject, selectedObject),
    'Current saved source · Selected information (information) · project v8 · blueprint blueprint-selected v5. Current customer record.');

  let unavailableOptions;
  const notices = [];
  const unavailable = await openInitialCase({ search: '?projectId=not-visible', cases: [{ id: 'case-existing' }],
    projects: [otherProject, selectedProject], loadCase: async (id) => openedCases.push(id),
    showWelcome: (options) => { unavailableOptions = options; }, notify: (message) => notices.push(message) });
  assert.deepEqual(unavailable, { state: 'project-unavailable', projectId: 'not-visible' });
  assert.deepEqual(unavailableOptions, { requestedProjectId: null, exactProjectRequested: true },
    'an unavailable deep link does not silently default to the first workspace');
  assert.match(notices[0], /unavailable to your current identity/);
});

test('historical learning stays visible but cannot be owner-reviewed against a newer observation', async () => {
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = storageFixture();
  try {
    const outcome = acceptedOutcome();
    outcome.latestEvaluation.observationHash = 'c'.repeat(64);
    const api = async () => inbox(outcome);
    const root = renderOutcomeInbox({ projectId: 'project-one', principal: 'oidc:owner', el, api });
    await settle();
    assert.match(root.textContent, /Historical learning: this proposal is not bound to the latest observation/);
    assert.match(root.textContent, /Existing reviews and linked cases remain in the history/);
    const review = findForm(root, 'Save owner review');
    assert.ok(review);
    assert.equal(review.querySelectorAll('button')[0].disabled, true);
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  }
});

test('outcome export downloads and verified import recovers its exact command after remount', async () => {
  const originalStorage = globalThis.localStorage;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const storage = storageFixture();
  globalThis.localStorage = storage;
  let exportedBlob;
  URL.createObjectURL = (blob) => { exportedBlob = blob; return 'blob:outcome-export'; };
  URL.revokeObjectURL = () => {};
  try {
    const base = '/api/v1/projects/project-one/outcomes';
    const outcome = acceptedOutcome();
    const bundle = { version: 'orgward-outcome-export-v1', projectId: 'project-one', outcome, exportHash: 'd'.repeat(64) };
    const preview = { importHash: 'e'.repeat(64), exportHash: bundle.exportHash,
      origin: { tenantId: 'tenant-source', projectId: 'project-source', outcomeId: outcome.id, version: outcome.version },
      title: outcome.title, category: outcome.category, observationCount: 1,
      latestEvaluation: { technical: 'NOT_MET', control: 'UNKNOWN', business: 'UNKNOWN' },
      evidenceKind: 'HUMAN_REPORTED', authorityImported: false };
    const importedOutcome = { ...outcome, id: 'outcome-imported', status: 'OPEN', proposals: [], importedFrom: {
      tenantId: 'tenant-source', projectId: 'project-source', outcomeId: outcome.id, version: outcome.version,
      exportHash: bundle.exportHash, authorityImported: false } };
    const calls = [];
    let importUncertain = true;
    let imported = false;
    const api = async (route, options) => {
      calls.push({ route, options });
      if (route === base && !options) return { ...inbox(imported ? importedOutcome : outcome),
        outcomes: imported ? [importedOutcome, outcome] : [outcome] };
      if (route === `${base}/${outcome.id}/export` && !options) return bundle;
      if (route === `${base}/import-preview`) return { preview };
      if (route === `${base}/import`) {
        if (importUncertain) { importUncertain = false; throw Object.assign(new Error('import response lost'), { status: 503 }); }
        imported = true;
        return { outcome: importedOutcome, replayed: true };
      }
      throw new Error(`Unexpected API call ${route}`);
    };
    const options = { projectId: 'project-one', principal: 'oidc:owner', el, api };
    const first = renderOutcomeInbox(options);
    await settle();
    await findButton(first, 'Download outcome JSON export').click();
    assert.ok(exportedBlob);
    assert.match(await exportedBlob.text(), /orgward-outcome-export-v1/);
    assert.ok(calls.some(({ route }) => route === `${base}/${outcome.id}/export`));

    const fileControl = findForm(first, 'Verify outcome import').querySelectorAll('input')[0];
    fileControl.files = [{ name: 'saved-outcome.json', size: 20, text: async () => JSON.stringify(bundle) }];
    await findForm(first, 'Verify outcome import').submit();
    await settle();
    assert.match(first.textContent, /Export verified\. Review its origin and reported observations/);
    assert.match(first.textContent, /Learning approvals and change-case authority are not copied/);
    const importForm = findForm(first, 'Import as new open item');
    assert.ok(importForm);
    assert.match(importForm.textContent, /I reviewed the origin and latest reported observations/);
    await importForm.submit();
    await settle();
    const originalImport = calls.find(({ route, options: requestOptions }) => route === `${base}/import` && requestOptions?.method === 'POST');
    assert.ok(originalImport);
    const originalPayload = JSON.parse(originalImport.options.body);
    assert.equal(originalPayload.bundle.exportHash, bundle.exportHash);
    assert.equal(originalPayload.expectedImportHash, preview.importHash);
    assert.match(first.textContent, /response is uncertain/i);

    const second = renderOutcomeInbox(options);
    await settle();
    await findButton(second, 'Retry saved command: Import outcome').click();
    await settle();
    const retriedImport = calls.filter(({ route, options: requestOptions }) => route === `${base}/import` && requestOptions?.method === 'POST')[1];
    assert.deepEqual(retriedImport, originalImport);
    assert.equal(storage.values.size, 0);
    assert.match(second.textContent, /Imported context:/);
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

function rootText(node) { return node.textContent; }
