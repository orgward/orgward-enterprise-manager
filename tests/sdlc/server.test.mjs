import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../../server.mjs';

async function start(root) {
  const app = createApp({ dataDirectory: path.join(root, 'blueprints'), sdlcDirectory: path.join(root, 'sdlc') });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  return { ...app, base: `http://127.0.0.1:${app.server.address().port}` };
}

async function close(server) { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }

async function request(base, route, options = {}, expected = 200) {
  const response = await fetch(`${base}${route}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers ?? {}) } });
  const body = await response.json();
  assert.equal(response.status, expected, JSON.stringify(body));
  return body;
}

test('SDLC API persists and resumes a golden case across process restart', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-api-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let app = await start(root);
  let changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ mode: 'golden' }) }, 201);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/run`, { method: 'POST', body: JSON.stringify({ version: changeCase.version, actor: 'orchestrator', idempotencyKey: 'api-run-1' }) });
  assert.equal(changeCase.status, 'NEEDS_HUMAN');
  assert.equal(changeCase.currentStage, 'S9');
  const id = changeCase.id;
  const version = changeCase.version;
  await close(app.server);

  app = await start(root); t.after(() => close(app.server));
  changeCase = await request(app.base, `/api/sdlc/cases/${id}`);
  assert.equal(changeCase.version, version);
  assert.equal(changeCase.currentStage, 'S9');
  assert.ok(changeCase.traceability.nodes.some((node) => node.type === 'ChangeSet'));
  assert.ok(changeCase.evidenceIntegrity.every((entry) => entry.valid));
});

test('SDLC API enforces optimistic concurrency, authority, isolation, and immutable action replay', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-api-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await start(root); t.after(() => close(app.server));
  const tenantA = { 'x-orgward-tenant': 'tenant-a' }; const tenantB = { 'x-orgward-tenant': 'tenant-b' };
  let first = await request(app.base, '/api/sdlc/cases', { method: 'POST', headers: tenantA, body: JSON.stringify({ mode: 'golden', tenantId: 'attempted-body-override' }) }, 201);
  const second = await request(app.base, '/api/sdlc/cases', { method: 'POST', headers: tenantB, body: JSON.stringify({ mode: 'golden' }) }, 201);
  assert.notEqual(first.id, second.id);
  assert.equal(first.tenantId, 'tenant-a');
  first = await request(app.base, `/api/sdlc/cases/${first.id}/advance`, { method: 'POST', headers: tenantA, body: JSON.stringify({ version: first.version, idempotencyKey: 'advance-once' }) });
  await request(app.base, `/api/sdlc/cases/${first.id}/advance`, { method: 'POST', headers: tenantA, body: JSON.stringify({ version: 0, idempotencyKey: 'stale' }) }, 409);
  const replay = await request(app.base, `/api/sdlc/cases/${first.id}/advance`, { method: 'POST', headers: tenantA, body: JSON.stringify({ version: first.version, idempotencyKey: 'advance-once' }) });
  assert.equal(replay.command.replayed, true);
  assert.equal(replay.version, first.version);
  await request(app.base, `/api/sdlc/cases/${first.id}/advance`, { method: 'POST', headers: tenantA, body: JSON.stringify({ version: first.version, idempotencyKey: 'advance-once', actor: 'different-actor' }) }, 409);
  const listingA = await request(app.base, '/api/sdlc/cases', { headers: tenantA });
  const listingB = await request(app.base, '/api/sdlc/cases', { headers: tenantB });
  assert.deepEqual(listingA.cases.map((entry) => entry.tenantId), ['tenant-a']);
  assert.deepEqual(listingB.cases.map((entry) => entry.tenantId), ['tenant-b']);
  await request(app.base, `/api/sdlc/cases/${second.id}`, { headers: tenantA }, 404);
  assert.equal((await request(app.base, `/api/sdlc/cases/${second.id}`, { headers: tenantB })).tenantId, 'tenant-b');
});

test('authenticated SDLC routes fail closed when principal-scoped store methods are unavailable', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-scope-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let unscopedCalls = 0;
  const changeCaseStore = {
    async init() {},
    async list() { unscopedCalls += 1; return []; },
    async listWithDiagnostics() { unscopedCalls += 1; return { records: [], corruptRecords: 0 }; },
    async get() { unscopedCalls += 1; return null; },
    async getForPrincipal() { unscopedCalls += 1; return null; },
    async save() { unscopedCalls += 1; },
  };
  const identity = { tenantId: 'tenant-a', principal: 'principal-a', roles: ['workspace-write'], actorType: 'human' };
  const app = createApp({
    dataDirectory: path.join(root, 'blueprints'), sdlcDirectory: path.join(root, 'sdlc'),
    changeCaseStore,
    oidcAuthenticator: { async authenticate() { return identity; } },
    oidcSessionStore: {
      async get() { return null; },
      async resolve() { return { ...identity, authzGeneration: 1 }; },
    },
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => close(app.server));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const headers = { authorization: 'Bearer signed-by-test', 'content-type': 'application/json' };
  const id = 'change-case-00000000-0000-4000-8000-000000000000';
  const assertDenied = async (route, options = {}) => {
    const response = await fetch(`${base}${route}`, { ...options, headers: { ...headers, ...(options.headers ?? {}) } });
    const body = await response.json();
    assert.equal(response.status, 503, JSON.stringify(body));
    assert.match(body.error, /cannot enforce principal-scoped access/i);
  };

  await assertDenied('/api/sdlc/cases');
  await assertDenied(`/api/sdlc/cases/${id}`);
  await assertDenied(`/api/sdlc/cases/${id}/traceability`);
  await assertDenied('/api/sdlc/cases', {
    method: 'POST', body: JSON.stringify({ projectId: 'project-00000000-0000-4000-8000-000000000000', mode: 'golden' }),
  });
  await assertDenied(`/api/sdlc/cases/${id}/advance`, {
    method: 'POST', body: JSON.stringify({ version: 0 }),
  });
  const foundationResponse = await fetch(`${base}/api/v1/foundation`, { headers });
  const foundation = await foundationResponse.json();
  assert.equal(foundationResponse.status, 200);
  assert.equal(foundation.data.sources.changeCases.status, 'unavailable');
  assert.equal(unscopedCalls, 0);
});

test('served SDLC product surface and meta contract expose stages and mutation lab', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-api-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await start(root); t.after(() => close(app.server));
  const meta = await request(app.base, '/api/sdlc/meta');
  assert.equal(meta.stages.length, 12);
  assert.equal(meta.mutations.missing_aml.expectedGate, 'G1');
  const response = await fetch(`${app.base}/sdlc.html`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Synthetic SDLC reference/i);
  const [styles, script] = await Promise.all([
    fetch(`${app.base}/sdlc.css`).then((entry) => entry.text()),
    fetch(`${app.base}/sdlc.js`).then((entry) => entry.text()),
  ]);
  assert.match(styles, /min-height:\s*44px/);
  assert.match(styles, /scroll-snap-type:\s*x proximity/);
  assert.match(script, /crypto\?\.randomUUID\?\.\(\)/);
});

test('clarification survives restart and reconciles through the API', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-clarification-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let app = await start(root);
  let changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ mode: 'golden' }) }, 201);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/clarify`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'open-api-question', actor: 'studio-operator', question: 'Is payment part of this release?', targetField: 'nonGoals' }),
  });
  await request(app.base, `/api/sdlc/cases/${changeCase.id}/clarify`, {
    method: 'POST', body: JSON.stringify({ version: 0, idempotencyKey: 'open-api-question', actor: 'studio-operator', question: 'Is payment part of this release?', targetField: 'nonGoals' }),
  });
  await request(app.base, `/api/sdlc/cases/${changeCase.id}/clarify`, {
    method: 'POST', body: JSON.stringify({ version: 0, idempotencyKey: 'open-api-question', actor: 'studio-operator', question: 'Different question', targetField: 'nonGoals' }),
  }, 409);
  const questionRef = changeCase.clarifications[0].id;
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/answer-clarification`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'answer-api-question', actor: 'actor-accountable-owner', questionRef, answer: 'Payment is outside this release.' }),
  });
  const { id, version } = changeCase;
  await close(app.server);

  app = await start(root); t.after(() => close(app.server));
  changeCase = await request(app.base, `/api/sdlc/cases/${id}`);
  assert.equal(changeCase.version, version);
  assert.equal(changeCase.clarifications[0].status, 'ANSWERED');
  assert.deepEqual(changeCase.intent.nonGoals, []);
  changeCase = await request(app.base, `/api/sdlc/cases/${id}/reconcile-clarification`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'reconcile-api-question', actor: 'actor-accountable-owner', questionRef }),
  });
  assert.equal(changeCase.clarifications[0].status, 'RECONCILED');
  assert.deepEqual(changeCase.intent.nonGoals, ['Payment is outside this release.']);
  assert.equal(changeCase.intent.revision, 2);
});

test('simultaneous clarification writes use persisted compare-and-swap', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-race-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await start(root); t.after(() => close(app.server));
  const changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ mode: 'golden' }) }, 201);
  const submit = (key, question) => fetch(`${app.base}/api/sdlc/cases/${changeCase.id}/clarify`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: changeCase.version, idempotencyKey: key, actor: 'studio-operator', question, targetField: 'nonGoals' }),
  });
  const responses = await Promise.all([submit('race-a', 'Is payment included?'), submit('race-b', 'Is invoicing included?')]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const saved = await request(app.base, `/api/sdlc/cases/${changeCase.id}`);
  assert.equal(saved.version, 1);
  assert.equal(saved.clarifications.length, 1);
});

test('proof results persist across restart and acceptance is derived by the API', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-proofs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let app = await start(root);
  let changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ mode: 'golden' }) }, 201);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/register-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'api-register-proof', actor: 'designer', criterion: 'The intent can be reconstructed after restart.', evaluatorType: 'DETERMINISTIC', required: true }),
  });
  const proofRef = changeCase.proofs.obligations[0].id;
  await request(app.base, `/api/sdlc/cases/${changeCase.id}/record-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'api-invalid-proof', actor: 'test-runner', proofRef, status: 'GREEN', summary: 'Invalid client status.' }),
  }, 400);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/record-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'api-record-proof', actor: 'test-runner', proofRef, status: 'PASS', summary: 'Reloaded state matches the saved revision.', observations: ['Intent revision and content hash matched after restart.'] }),
  });
  const { id } = changeCase;
  await close(app.server);

  app = await start(root); t.after(() => close(app.server));
  changeCase = await request(app.base, `/api/sdlc/cases/${id}`);
  assert.equal(changeCase.proofs.results[0].status, 'PASS');
  changeCase = await request(app.base, `/api/sdlc/cases/${id}/assess-proofs`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'api-assess-proofs', actor: 'controller', accepted: false }),
  });
  assert.equal(changeCase.proofs.assessments.at(-1).phase, 'ACCEPTED');
  assert.equal(changeCase.proofs.assessments.at(-1).accepted, true);
});

test('proof action routing persists across restart and preserves the failed result', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-routing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let app = await start(root);
  let changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ mode: 'golden' }) }, 201);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/register-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'route-api-proof', actor: 'designer', criterion: 'The bounded workflow succeeds.', required: true }),
  });
  const proofRef = changeCase.proofs.obligations[0].id;
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/record-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'route-api-fail', actor: 'runner', proofRef, status: 'FAIL', summary: 'The implementation is incomplete.', observations: ['The expected response was absent.'] }),
  });
  const failedResult = structuredClone(changeCase.proofs.results[0]);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/route-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'route-api-replan', actor: 'studio-operator', proofRef, resultRef: failedResult.id, action: 'REPLAN', reason: 'Add the missing work to the plan.' }),
  });
  assert.deepEqual(changeCase.proofs.results, [failedResult]);
  assert.equal(changeCase.proofs.actions[0].action, 'REPLAN');
  const { id, version } = changeCase;
  await close(app.server);

  app = await start(root); t.after(() => close(app.server));
  changeCase = await request(app.base, `/api/sdlc/cases/${id}`);
  assert.equal(changeCase.version, version);
  assert.deepEqual(changeCase.proofs.results, [failedResult]);
  assert.equal(changeCase.proofs.actions[0].status, 'READY');
});

test('a terminal proof stop blocks later API mutations while replay remains safe', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-stop-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await start(root); t.after(() => close(app.server));
  let changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ mode: 'golden' }) }, 201);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/register-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'stop-api-proof', actor: 'designer', criterion: 'The outcome is feasible.', required: true }),
  });
  const proofRef = changeCase.proofs.obligations[0].id;
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/record-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'stop-api-result', actor: 'runner', proofRef, status: 'INDETERMINATE', summary: 'Feasibility cannot be established.', observations: ['The required dependency is unavailable.'] }),
  });
  const stopCommand = { version: changeCase.version, idempotencyKey: 'stop-api-route', actor: changeCase.accountableOwner, proofRef, resultRef: changeCase.proofs.results[0].id, action: 'STOP', reason: 'The owner stopped infeasible work.' };
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/route-proof`, { method: 'POST', body: JSON.stringify(stopCommand) });
  assert.equal(changeCase.status, 'STOPPED');
  const replay = await request(app.base, `/api/sdlc/cases/${changeCase.id}/route-proof`, { method: 'POST', body: JSON.stringify(stopCommand) });
  assert.equal(replay.command.replayed, true);
  await request(app.base, `/api/sdlc/cases/${changeCase.id}/advance`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'advance-after-stop', actor: 'orchestrator' }),
  }, 409);
  await request(app.base, `/api/sdlc/cases/${changeCase.id}/clarify`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'clarify-after-stop', actor: 'studio-operator', question: 'Can scope change?', targetField: 'nonGoals' }),
  }, 409);
  const saved = await request(app.base, `/api/sdlc/cases/${changeCase.id}`);
  assert.equal(saved.version, changeCase.version);
  assert.equal(saved.events.at(-1).type, 'ProofActionRouted');
});

test('a pending proof action resumes once after restart without chat history', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-resume-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let app = await start(root);
  let changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ mode: 'golden' }) }, 201);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/register-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'resume-api-proof', actor: 'designer', criterion: 'The queued repair resumes once.', required: true }),
  });
  const proofRef = changeCase.proofs.obligations[0].id;
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/record-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'resume-api-result', actor: 'runner', proofRef, status: 'FAIL', summary: 'Repair is required.', observations: ['The expected result is absent.'] }),
  });
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/route-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'resume-api-route', actor: 'studio-operator', proofRef, resultRef: changeCase.proofs.results[0].id, action: 'REPAIR', reason: 'Queue a bounded repair.' }),
  });
  const action = changeCase.proofs.actions[0];
  const id = changeCase.id;
  assert.equal(action.status, 'READY');
  await close(app.server);

  app = await start(root);
  changeCase = await request(app.base, `/api/sdlc/cases/${id}`);
  assert.equal(changeCase.proofs.actions[0].status, 'READY');
  assert.equal(changeCase.workspace.nextAllowedAction.type, 'RESUME_PROOF_ACTION');
  assert.equal(changeCase.workspace.failedResults[0].id, changeCase.proofs.results[0].id);
  changeCase = await request(app.base, `/api/sdlc/cases/${id}/resume-proof-action`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'resume-after-restart', actor: action.owner, actionRef: action.id }),
  });
  assert.equal(changeCase.proofs.actions[0].status, 'IN_PROGRESS');
  assert.equal(changeCase.proofs.loopCounters[proofRef], 1);
  assert.equal(changeCase.workspace.nextAllowedAction.type, 'COMPLETE_PROOF_ACTION');
  const resumedVersion = changeCase.version;
  await close(app.server);

  app = await start(root); t.after(() => close(app.server));
  changeCase = await request(app.base, `/api/sdlc/cases/${id}`);
  const replay = await request(app.base, `/api/sdlc/cases/${id}/resume-proof-action`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'different-key-after-second-restart', actor: action.owner, actionRef: action.id }),
  });
  assert.equal(replay.command.replayed, true);
  assert.equal(replay.version, resumedVersion);
  assert.equal(replay.proofs.loopCounters[proofRef], 1);
  assert.equal(replay.events.filter((entry) => entry.type === 'ProofActionResumed').length, 1);
});

test('simultaneous pending-action claims persist exactly one attempt', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-resume-race-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await start(root); t.after(() => close(app.server));
  let changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ mode: 'golden' }) }, 201);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/register-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'race-resume-proof', actor: 'designer', criterion: 'Only one worker claims the repair.', required: true }),
  });
  const proofRef = changeCase.proofs.obligations[0].id;
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/record-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'race-resume-result', actor: 'runner', proofRef, status: 'FAIL', summary: 'A repair is pending.', observations: ['The result failed.'] }),
  });
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/route-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'race-resume-route', actor: 'studio-operator', proofRef, resultRef: changeCase.proofs.results[0].id, action: 'REPAIR', reason: 'Queue one repair.' }),
  });
  const action = changeCase.proofs.actions[0];
  const claim = (key) => fetch(`${app.base}/api/sdlc/cases/${changeCase.id}/resume-proof-action`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: changeCase.version, idempotencyKey: key, actor: action.owner, actionRef: action.id }),
  });
  const responses = await Promise.all([claim('race-resume-a'), claim('race-resume-b')]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const saved = await request(app.base, `/api/sdlc/cases/${changeCase.id}`);
  assert.equal(saved.proofs.actions[0].status, 'IN_PROGRESS');
  assert.equal(saved.proofs.loopCounters[proofRef], 1);
  assert.equal(saved.events.filter((entry) => entry.type === 'ProofActionResumed').length, 1);
});
