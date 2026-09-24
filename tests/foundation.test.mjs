import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../server.mjs';
import {
  decodeStudioRoute, encodeExecutionRoute, encodeStudioRoute, executionProcessTarget, executionProjectContext,
  fieldErrorsFor, founderConversationAnnouncement,
} from '../public/shared-interactions.mjs';

async function start(root, options = {}) {
  const app = createApp({
    dataDirectory: path.join(root, 'projects'),
    sdlcDirectory: path.join(root, 'sdlc'),
    executionDirectory: path.join(root, 'runs'),
    executionWorkspaceDirectory: path.join(root, 'workspaces'),
    ...options,
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  return { ...app, base: `http://127.0.0.1:${app.server.address().port}` };
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function request(base, route, options = {}, expected = 200) {
  const response = await fetch(`${base}${route}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-orgward-tenant': 'tenant-a',
      'x-orgward-principal': 'founder-a',
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json();
  assert.equal(response.status, expected, JSON.stringify(body));
  return { response, body };
}

function command(commandId, payload, expectedVersion) {
  return JSON.stringify({ schemaVersion: '1.0', commandId, expectedVersion, payload });
}

test('foundation API reports actual empty state and unavailable capabilities without samples', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-foundation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await start(root); t.after(() => close(app.server));

  const { response, body } = await request(app.base, '/api/v1/foundation');
  const health = (await request(app.base, '/api/health')).body;
  assert.equal(response.headers.get('x-orgward-api-version'), '1.0');
  assert.equal(body.schemaVersion, '1.0');
  assert.equal(body.data.mode, 'development');
  assert.equal(body.data.productionReady, false);
  assert.equal(body.data.identity.status, 'development_unverified');
  assert.deepEqual(body.data.actual, { projects: 0, changeCases: 0, executionRuns: 0 });
  assert.equal(body.data.sources.projects.kind, 'actual');
  assert.equal(body.data.sources.projects.status, 'current');
  assert.equal(body.data.sources.projects.sampleSource, null);
  assert.equal(body.data.capabilities.execution.status, 'unavailable');
  assert.equal(body.data.capabilities.externalEffects.status, 'disabled');
  assert.deepEqual(body.data.productGates, { status: 'current', passed: 4, total: 12, source: 'DELIVERY-STATUS.json' });
  assert.equal(body.meta.partial, false);
  assert.match(body.meta.asOf, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(health.maturity, 'development-foundation');
  assert.equal(health.execution.status, 'unavailable');
});

test('foundation API does not fabricate gate counts when the canonical ledger is unavailable', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-foundation-ledger-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await start(root, { deliveryStatusFile: path.join(root, 'missing-delivery-status.json') });
  t.after(() => close(app.server));
  const { body } = await request(app.base, '/api/v1/foundation');
  assert.deepEqual(body.data.productGates, {
    status: 'unavailable', passed: null, total: null, source: 'missing-delivery-status.json', recoveryActions: [{ type: 'retry', label: 'Retry' }],
  });
  assert.equal(body.meta.partial, true);
});

test('foundation API marks a failed source unavailable instead of fabricating zero', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-foundation-outage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'projects'), 'not a directory');
  const app = await start(root); t.after(() => close(app.server));
  const { body } = await request(app.base, '/api/v1/foundation');
  assert.equal(body.data.sources.projects.status, 'unavailable');
  assert.equal(body.data.sources.projects.count, null);
  assert.equal(body.data.actual.projects, null);
  assert.equal(body.data.actual.changeCases, 0);
  assert.equal(body.meta.partial, true);
  assert.deepEqual(body.data.sources.projects.recoveryActions, [{ type: 'retry', label: 'Retry' }]);
});

test('foundation API hides corrupt-record counts and creation fails closed', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-foundation-corrupt-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'projects'));
  await writeFile(path.join(root, 'projects', 'project-corrupt.json'), '{not-json');
  const app = await start(root); t.after(() => close(app.server));
  const { body } = await request(app.base, '/api/v1/foundation');
  assert.equal(body.data.sources.projects.status, 'unavailable');
  assert.equal(body.data.sources.projects.count, null);
  assert.equal(body.data.sources.projects.validRecords, undefined);
  assert.equal(body.data.sources.projects.unreadableRecords, undefined);
  assert.equal(body.data.actual.projects, null);
  assert.equal(body.meta.partial, true);
  const create = await request(app.base, '/api/v1/projects', {
    method: 'POST', body: command('create-with-corruption', { name: 'Must not be created' }),
  }, 503);
  assert.equal(create.body.error.code, 'PERSISTENCE_INTEGRITY');
  assert.equal(create.body.error.retryable, false);
});

test('authenticated project queries and commands require explicit principal-scoped store methods', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-project-scope-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let unscopedCalls = 0;
  let membershipOnlyCalls = 0;
  let membershipOnlyCaseReads = 0;
  let genericCommandCalls = 0;
  const projectStore = {
    async init() {},
    async list() { unscopedCalls += 1; return []; },
    async listWithDiagnostics() { unscopedCalls += 1; return { records: [], corruptRecords: 0 }; },
    async get() { unscopedCalls += 1; return null; },
    async listForPrincipal() { membershipOnlyCalls += 1; return []; },
    async getForPrincipal() { membershipOnlyCalls += 1; return null; },
    async createWithCommand() { genericCommandCalls += 1; },
    async updateWithCommand() { genericCommandCalls += 1; },
  };
  const changeCaseStore = {
    async init() {},
    async list() { unscopedCalls += 1; return []; },
    async listWithDiagnostics() { unscopedCalls += 1; return { records: [], corruptRecords: 0 }; },
    async listWithDiagnosticsForPrincipal() {
      membershipOnlyCaseReads += 1;
      return { records: [{ id: 'private-case' }], corruptRecords: 0 };
    },
  };
  const identity = { tenantId: 'tenant-a', principal: 'principal-a', roles: ['workspace-write'], actorType: 'human' };
  const app = await start(root, {
    projectStore, changeCaseStore,
    oidcAuthenticator: { async authenticate() { return identity; } },
    oidcSessionStore: { async resolve() { return { ...identity, authzGeneration: 1 }; } },
  });
  t.after(() => close(app.server));
  const headers = { authorization: 'Bearer verified-by-test' };
  const id = 'project-00000000-0000-4000-8000-000000000000';

  const v1List = await fetch(`${app.base}/api/v1/projects`, { headers });
  assert.equal(v1List.status, 503);
  assert.equal((await v1List.json()).error.code, 'PROJECT_AUTHORIZATION_UNAVAILABLE');
  for (const route of ['/api/projects', `/api/projects/${id}`, `/api/v1/projects/${id}`]) {
    const response = await fetch(`${app.base}${route}`, { headers });
    assert.equal(response.status, 503, route);
    const body = await response.json();
    assert.match(body.error.message ?? body.error, /cannot enforce principal-scoped access/i);
  }
  const foundation = await fetch(`${app.base}/api/v1/foundation`, { headers });
  const status = await foundation.json();
  assert.equal(foundation.status, 200);
  assert.equal(status.data.sources.projects.status, 'unavailable');
  assert.equal(status.data.actual.projects, null);
  assert.equal(status.data.sources.changeCases.status, 'unavailable');
  assert.equal(status.data.actual.changeCases, null);
  assert.equal(status.meta.partial, true);
  const create = await fetch(`${app.base}/api/v1/projects`, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: command('scoped-create-required', { name: 'No generic write' }),
  });
  assert.equal(create.status, 503);
  assert.equal((await create.json()).error.code, 'PROJECT_AUTHORIZATION_UNAVAILABLE');
  const update = await fetch(`${app.base}/api/v1/projects/${id}/messages`, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: command('scoped-update-required', { content: 'No generic update' }, 1),
  });
  assert.equal(update.status, 503);
  assert.equal((await update.json()).error.code, 'PROJECT_AUTHORIZATION_UNAVAILABLE');
  assert.equal(unscopedCalls, 0);
  assert.equal(membershipOnlyCalls, 0);
  assert.equal(membershipOnlyCaseReads, 0);
  assert.equal(genericCommandCalls, 0);
});

test('v1 project commands validate their envelope, reject authority claims, and enforce denial', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await start(root); t.after(() => close(app.server));

  const invalid = await request(app.base, '/api/v1/projects', {
    method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', payload: { name: '' } }),
  }, 400);
  assert.equal(invalid.body.error.code, 'INVALID_COMMAND');
  assert.equal(invalid.body.error.retryable, false);
  assert.deepEqual(invalid.body.error.fieldErrors.map((entry) => entry.field).sort(), ['commandId', 'payload.name']);
  assert.ok(invalid.body.error.correlationId);

  const authority = await request(app.base, '/api/v1/projects', {
    method: 'POST', body: command('authority-claim', { name: 'Hidden authority', tenantId: 'tenant-b', actor: 'admin' }),
  }, 400);
  assert.equal(authority.body.error.code, 'CALLER_AUTHORITY_NOT_ALLOWED');

  const denied = await request(app.base, '/api/v1/projects', {
    method: 'POST', headers: { 'x-orgward-access': 'read' }, body: command('denied-create', { name: 'Denied' }),
  }, 403);
  assert.equal(denied.body.error.code, 'ACTION_FORBIDDEN');
  assert.deepEqual(denied.body.error.recoveryActions, [{ type: 'request_write_access', label: 'Request write access' }]);
});

test('v1 project journey persists events, isolates tenants, and recovers from conflict and retry', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-v1-project-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let app = await start(root);

  let result = await request(app.base, '/api/v1/projects', {
    method: 'POST', body: command('create-circular', { name: 'Circular Works' }),
  }, 201);
  let project = result.body.data;
  assert.equal(project.schemaVersion, '1.0');
  assert.equal(project.version, 1);
  assert.equal(project.tenantId, 'tenant-a');
  assert.equal(result.body.event.type, 'ProjectCreated');
  assert.equal(result.body.event.aggregateVersion, 1);
  assert.equal(result.body.meta.replayed, false);

  const createReplay = await request(app.base, '/api/v1/projects', {
    method: 'POST', body: command('create-circular', { name: 'Circular Works' }),
  }, 201);
  assert.equal(createReplay.body.data.id, project.id);
  assert.equal(createReplay.body.meta.replayed, true);
  await request(app.base, '/api/v1/projects', {
    method: 'POST', body: command('create-circular', { name: 'Changed payload' }),
  }, 409);

  result = await request(app.base, `/api/v1/projects/${project.id}/messages`, {
    method: 'POST', body: command('answer-1', { content: 'A repair membership for independent restaurants.' }, project.version),
  });
  project = result.body.data;
  assert.equal(project.version, 2);
  assert.equal(result.body.event.type, 'ProjectAnswerRecorded');

  const stale = await request(app.base, `/api/v1/projects/${project.id}/messages`, {
    method: 'POST', body: command('stale-answer', { content: 'This must not overwrite anything.' }, 1),
  }, 409);
  assert.equal(stale.body.error.code, 'VERSION_CONFLICT');
  assert.equal(stale.body.error.currentVersion, 2);
  assert.equal(stale.body.error.retryable, true);
  assert.deepEqual(stale.body.error.recoveryActions.map((entry) => entry.type), ['reload', 'retry']);

  const replay = await request(app.base, `/api/v1/projects/${project.id}/messages`, {
    method: 'POST', body: command('answer-1', { content: 'A repair membership for independent restaurants.' }, 1),
  });
  assert.equal(replay.body.meta.replayed, true);
  assert.equal(replay.body.data.version, 2);
  assert.equal(replay.body.data.conversation.filter((entry) => entry.role === 'user').length, 1);

  const tenantB = { 'x-orgward-tenant': 'tenant-b', 'x-orgward-principal': 'founder-b' };
  assert.deepEqual((await request(app.base, '/api/v1/projects', { headers: tenantB })).body.data, []);
  const hidden = await request(app.base, `/api/v1/projects/${project.id}`, { headers: tenantB }, 404);
  assert.equal(hidden.body.error.code, 'PROJECT_NOT_FOUND');

  const id = project.id;
  await close(app.server);
  app = await start(root); t.after(() => close(app.server));
  const restored = (await request(app.base, `/api/v1/projects/${id}`)).body.data;
  assert.equal(restored.version, 2);
  assert.equal(restored.events.length, 2);
  assert.equal(restored.events[1].causationId, 'answer-1');
  assert.equal(restored.conversation.filter((entry) => entry.role === 'user').length, 1);
});

test('simultaneous v1 commands preserve one create and one accepted project update', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-project-race-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await start(root); t.after(() => close(app.server));
  const createOptions = { method: 'POST', body: command('create-once', { name: 'One workspace' }) };
  const [firstCreate, secondCreate] = await Promise.all([
    request(app.base, '/api/v1/projects', createOptions, 201),
    request(app.base, '/api/v1/projects', createOptions, 201),
  ]);
  assert.equal(firstCreate.body.data.id, secondCreate.body.data.id);
  assert.deepEqual([firstCreate.body.meta.replayed, secondCreate.body.meta.replayed].sort(), [false, true]);
  const project = firstCreate.body.data;
  const submit = (commandId, content) => fetch(`${app.base}/api/v1/projects/${project.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-orgward-tenant': 'tenant-a', 'x-orgward-principal': 'founder-a' },
    body: command(commandId, { content }, project.version),
  });
  const responses = await Promise.all([submit('race-answer-a', 'Answer A'), submit('race-answer-b', 'Answer B')]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const saved = (await request(app.base, `/api/v1/projects/${project.id}`)).body.data;
  assert.equal(saved.version, 2);
  assert.equal(saved.conversation.filter((entry) => entry.role === 'user').length, 1);
  assert.equal(saved.events.filter((entry) => entry.type === 'ProjectAnswerRecorded').length, 1);
});

test('v1 failures have a stable safe error envelope and correlation id', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-errors-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await start(root); t.after(() => close(app.server));
  const missing = await request(app.base, '/api/v1/not-a-route', {}, 404);
  assert.equal(missing.body.schemaVersion, '1.0');
  assert.deepEqual(Object.keys(missing.body.error).sort(), ['code', 'correlationId', 'currentVersion', 'fieldErrors', 'message', 'recoveryActions', 'retryable'].sort());
  assert.equal(missing.body.error.code, 'ROUTE_NOT_FOUND');
  assert.doesNotMatch(JSON.stringify(missing.body), /\/srv\/|Error:|stack/i);
});

test('shared interaction helpers retain drafts and round-trip linkable workspace state', () => {
  const projectId = 'project-12345678-1234-1234-1234-123456789abc';
  const encoded = encodeStudioRoute({ projectId, view: 'map', selectedId: 'cap-delivery', types: ['process', 'capability'], area: 'capabilitiesProcesses' });
  assert.equal(encoded, `/?project=${projectId}&view=map&area=capabilitiesProcesses&selected=cap-delivery&types=capability%2Cprocess`);
  assert.deepEqual(decodeStudioRoute(encoded), { projectId, view: 'map', area: 'capabilitiesProcesses', selectedId: 'cap-delivery', types: ['capability', 'process'] });
  const coverageRoute = encodeStudioRoute({ projectId, view: 'coverage' });
  assert.deepEqual(decodeStudioRoute(coverageRoute), { projectId, view: 'coverage', area: null, selectedId: null, types: [] });
  assert.deepEqual(decodeStudioRoute('/?project=bad&view=unknown&selected=%20&area=arbitrary'), { projectId: null, view: 'blueprint', area: null, selectedId: null, types: [] });
  assert.deepEqual(fieldErrorsFor({ fieldErrors: [{ field: 'payload.name', message: 'Name is required.' }] }, 'payload.name'), ['Name is required.']);
});

test('Execution navigation carries only a valid project in both selectors', () => {
  const projectId = 'project-12345678-1234-1234-1234-123456789abc';
  const projects = [{ id: projectId }, { id: 'project-abcdefab-cdef-abcd-efab-cdefabcdefab' }];
  assert.equal(encodeExecutionRoute(projectId), `/execution.html?project=${projectId}`);
  assert.equal(encodeExecutionRoute('invalid'), '/execution.html');
  assert.deepEqual(executionProjectContext(`/execution.html?project=${projectId}`, projects), {
    projectId, runProjectId: projectId, planningProjectId: projectId,
  });
  assert.deepEqual(executionProjectContext('/execution.html', projects), {
    projectId: null, runProjectId: null, planningProjectId: null,
  });
  assert.deepEqual(executionProjectContext('/execution.html?project=invalid', projects), {
    projectId: null, runProjectId: null, planningProjectId: null,
  });
  assert.deepEqual(executionProjectContext(`/execution.html?project=${projects[1].id}`, [projects[0]]), {
    projectId: null, runProjectId: null, planningProjectId: null,
  }, 'unavailable projects use the existing fallback');
  const processId = 'process-customer-intake';
  const processRoute = encodeExecutionRoute(projectId, { projectId, processId });
  assert.equal(processRoute, `/execution.html?project=${projectId}&process=${processId}`);
  assert.deepEqual(executionProcessTarget(processRoute, projects), {
    requested: true, target: { projectId, processId },
  });
  assert.deepEqual(executionProcessTarget(`/execution.html?project=${projectId}&process=bad%20id`, projects), {
    requested: true, target: null,
  });
  assert.deepEqual(executionProcessTarget(processRoute, [projects[1]]), { requested: true, target: null });
  assert.deepEqual(executionProcessTarget(`/execution.html?project=${projectId}`, projects), { requested: false, target: null });
});

test('founder announcement reports only the current prompt or saved blueprint', () => {
  const project = {
    questionIndex: 2,
    conversation: [
      { role: 'assistant', content: 'What business do you want to create?' },
      { role: 'user', content: 'A repair service.' },
      { role: 'assistant', content: 'Who are the customers and what will you offer?' },
    ],
  };
  assert.equal(founderConversationAnnouncement(project, { answerSaved: true }), 'Answer saved. Who are the customers and what will you offer?');
  assert.doesNotMatch(founderConversationAnnouncement(project, { answerSaved: true }), /What business|A repair service/);
  assert.equal(founderConversationAnnouncement(project), 'Current question. Who are the customers and what will you offer?');
  assert.equal(founderConversationAnnouncement({ latestBlueprint: { version: 2 }, conversation: project.conversation }), 'Saved blueprint version 2 loaded. The proposed design is ready to review.');
});

test('product status shell uses live foundation data and accessible recovery controls', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-platform-shell-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await start(root); t.after(() => close(app.server));
  const [page, script, platformStyles, studioStyles] = await Promise.all([
    fetch(`${app.base}/platform.html`).then((response) => response.text()),
    fetch(`${app.base}/platform.js`).then((response) => response.text()),
    fetch(`${app.base}/platform.css`).then((response) => response.text()),
    fetch(`${app.base}/styles.css`).then((response) => response.text()),
  ]);
  assert.match(page, /Product status/);
  assert.match(page, /aria-live="polite"/);
  assert.match(script, /\/api\/v1\/foundation/);
  assert.match(script, /View specification/);
  assert.match(script, /class=\"notice\" role=\"status\" aria-live=\"polite\"/);
  assert.match(script, /addEventListener\('popstate'/);
  assert.match(script, /event\.key === 'Escape'/);
  assert.doesNotMatch(script, /executionRuns\.length \|\| 1|Math\.max\(cases, 1\)/);
  assert.doesNotMatch(page + script, /Northstar Bank|238 checks|42m|18m waiting/);
  assert.match(platformStyles, /prefers-reduced-motion:\s*reduce/);
  assert.match(studioStyles, /prefers-reduced-motion:\s*reduce/);
});
