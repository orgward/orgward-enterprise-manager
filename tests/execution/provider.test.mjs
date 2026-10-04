import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { createApp } from '../../server.mjs';
import { startPostgres } from '../helpers/postgres.mjs';

const issuer = 'https://provider-test.example.test';
const subjects = ['admin', 'worker', 'other'];
const principal = (subject) => `oidc:${createHash('sha256').update(`${issuer}\n${subject}`).digest('hex')}`;

function authenticator() {
  return { authenticate: async (request) => {
    const subject = String(request.headers.authorization ?? '').slice(7);
    if (!subjects.includes(subject)) return null;
    return { subject, tenantId: subject === 'other' ? 'tenant-b' : 'tenant-a', actorType: 'human', issuer,
      principal: principal(subject), displayName: subject, roles: [], expiresAt: Math.floor(Date.now() / 1000) + 300 };
  } };
}

async function api(app, route, subject, { method = 'GET', body } = {}) {
  const response = await fetch(`http://127.0.0.1:${app.server.address().port}${route}`, {
    method, headers: { authorization: `Bearer ${subject}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

async function setup(t, handler, { openAi = false, deepSeek = false, persistenceFaults = {} } = {}) {
  const postgres = await startPostgres();
  let fixtureRequest;
  let fixtureRequestCount = 0;
  let markFixtureRequest;
  const fixtureSeen = new Promise((resolve) => { markFixtureRequest = resolve; });
  const fixture = await new Promise((resolve) => {
    const server = createServer(async (request, response) => {
      fixtureRequestCount += 1;
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const credential = request.headers.authorization;
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      fixtureRequest = { credential, body };
      markFixtureRequest(fixtureRequest);
      await handler({ request, response, credential, body });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
  const canary = 'fixture-secret-canary-8472';
  const secretEncryptionKey = Buffer.alloc(32, 0x6c);
  const executionProfiles = [{
      id: 'fixture-http-provider', kind: 'provider-http', version: '1.0.0', label: 'Fixture provider',
      providerEndpoint: `http://127.0.0.1:${fixture.address().port}/v1/execute`, timeoutMs: 5_000,
      credentialReference: 'secret-fixture', credentialVersion: 1,
    }, ...(openAi ? [{ id: 'openai-current', kind: 'provider-openai', version: '1.0.0', label: 'Validated OpenAI', credentialReference: 'secret-openai', model: 'gpt-fixture', openAiEndpoint: `http://127.0.0.1:${fixture.address().port}/v1/responses` }] : []),
    ...(deepSeek ? [
      { id: 'deepseek-current', kind: 'provider-deepseek', version: '1.0.0', label: 'DeepSeek · deepseek-fixture', credentialReference: 'secret-fixture', model: 'deepseek-fixture', deepSeekEndpoint: `http://127.0.0.1:${fixture.address().port}/responses`, deepSeekMaxOutputTokens: 128 },
      { id: 'deepseek-alternate', kind: 'provider-deepseek', version: '2.0.0', label: 'DeepSeek · alternate-fixture', credentialReference: 'secret-fixture', model: 'deepseek-alternate-fixture', deepSeekEndpoint: `http://127.0.0.1:${fixture.address().port}/responses`, deepSeekMaxOutputTokens: 96 },
    ] : [])];
  const apps = [];
  const newApp = async () => {
    const instance = createApp({ databaseUrl: postgres.databaseUrl, oidcAuthenticator: authenticator(), secretEncryptionKey, executionProfiles, persistenceFaults,
      ...(openAi ? { openAiValidationEndpoint: `http://127.0.0.1:${fixture.address().port}/v1/models` } : {}) });
    await instance.init();
    await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
    apps.push(instance);
    return instance;
  };
  const app = await newApp();
  for (const [subject, roles] of [
    ['admin', ['tenant-admin', 'workspace-read', 'workspace-write', 'execution-approver']],
    ['worker', ['workspace-read', 'workspace-write']],
    ['other', ['tenant-admin', 'workspace-read', 'workspace-write']],
  ]) await app.persistence.query(`insert into orgward.oidc_principals (principal, issuer, tenant_id, actor_type, roles, display_name)
    values ($1,$2,$3,'human',$4::text[],$5) on conflict (tenant_id,principal) do update set roles=excluded.roles`,
  [principal(subject), issuer, subject === 'other' ? 'tenant-b' : 'tenant-a', roles, subject]);
  t.after(async () => {
    for (const instance of apps) {
      if (instance.server.listening) await new Promise((resolve) => instance.server.close(resolve));
      await instance.close();
    }
    await new Promise((resolve) => fixture.close(resolve));
    await postgres.close();
  });
  const project = await api(app, '/api/v1/projects', 'admin', { method: 'POST', body: {
    schemaVersion: '1.0', commandId: 'provider-project', payload: { name: 'Provider fixture' },
  } });
  assert.equal(project.status, 201, JSON.stringify(project.body));
  await app.persistence.query(`insert into orgward.project_memberships (tenant_id, project_id, principal, access, granted_by)
    values ('tenant-a',$1,$2,'editor',$3)`, [project.body.data.id, principal('worker'), principal('admin')]);
  const credential = await api(app, '/api/v1/secrets/secret-fixture', 'admin', { method: 'PUT', body: {
    schemaVersion: '1.0', commandId: 'provider-secret', expectedVersion: 0,
    payload: { value: canary, reason: 'Local provider fixture', expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() },
  } });
  assert.equal(credential.status, 200, JSON.stringify(credential.body));
  return { app, apps, projectId: project.body.data.id, canary, fixtureSeen, getFixtureRequest: () => fixtureRequest,
    getFixtureRequestCount: () => fixtureRequestCount, restart: newApp };
}

async function createApprovedRun(app, projectId, objective, profileId = 'fixture-http-provider') {
  const created = await api(app, '/api/execution/runs', 'worker', { method: 'POST', body: {
    projectId, profileId, title: 'Fixture call', objective,
  } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.deepEqual(created.body.profile.credential, { reference: 'secret-fixture', version: 1 });
  const denied = await api(app, `/api/execution/runs/${created.body.id}/approve`, 'worker', { method: 'POST', body: { version: created.body.version } });
  assert.equal(denied.status, 403);
  const approved = await api(app, `/api/execution/runs/${created.body.id}/approve`, 'admin', { method: 'POST', body: { version: created.body.version } });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  return approved.body;
}

test('brokered provider HTTP execution starts after authorization commit and persists bounded result across restart', async (t) => {
  let app;
  let leaseWasCommittedBeforeProviderRequest = false;
  const setupResult = await setup(t, async ({ response, body }) => {
    const leases = await app.persistence.query(`select count(*)::int as count from orgward.execution_worker_leases
      where tenant_id = 'tenant-a' and lease_until > now() and cancel_requested_at is null`);
    leaseWasCommittedBeforeProviderRequest = leases.rows[0].count > 0;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ result: `Processed: ${body.objective}` }));
  });
  ({ app } = setupResult);
  const { projectId, canary, fixtureSeen, getFixtureRequest, restart } = setupResult;
  const run = await createApprovedRun(app, projectId, 'provider success case');
  assert.equal(app.executionService.profiles.get('fixture-http-provider').credentialVersion, 1);
  const executed = await api(app, `/api/execution/runs/${run.id}/execute`, 'worker', { method: 'POST', body: { version: run.version } });
  assert.equal(executed.status, 200, JSON.stringify(executed.body));
  assert.equal(executed.body.status, 'SUCCEEDED');
  assert.equal(executed.body.execution.stdout, 'Processed: provider success case');
  const completedAttempt = await app.persistence.query('select status from orgward.provider_dispatch_attempts where tenant_id=$1 and run_id=$2', ['tenant-a', run.id]);
  assert.equal(completedAttempt.rows[0].status, 'completed');
  assert.equal(getFixtureRequest().credential, `Bearer ${canary}`);
  assert.equal(leaseWasCommittedBeforeProviderRequest, true);
  assert.equal(JSON.stringify(executed.body).includes(canary), false);
  await new Promise((resolve) => app.server.close(resolve));
  await app.close();
  setupResult.apps.splice(setupResult.apps.indexOf(app), 1);
  app = await restart();
  const restarted = await api(app, `/api/execution/runs/${run.id}`, 'worker');
  assert.equal(restarted.status, 200);
  assert.equal(restarted.body.execution.stdout, 'Processed: provider success case');
  assert.equal((await api(app, `/api/execution/runs/${run.id}`, 'other')).status, 404);
  await fixtureSeen;
});

test('provider failures are safe, output canaries are quarantined, and rotation cancels an in-flight request', async (t) => {
  let signalSlowRequest;
  const slowRequest = new Promise((resolve) => { signalSlowRequest = resolve; });
  const setupResult = await setup(t, async ({ response, body }) => {
    if (body.objective === 'provider failure') {
      response.writeHead(503, { 'content-type': 'text/plain' });
      response.end('fixture outage details');
      return;
    }
    if (body.objective === 'provider canary leak') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ result: 'fixture-secret-canary-8472' }));
      return;
    }
    if (body.objective === 'rotate during request') {
      signalSlowRequest();
      await new Promise((resolve) => response.once('close', resolve));
      if (!response.destroyed) response.end(JSON.stringify({ result: 'late result' }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ result: 'unexpected result' }));
  });
  const { app, projectId, canary } = setupResult;

  for (const objective of ['provider failure', 'provider canary leak']) {
    const run = await createApprovedRun(app, projectId, objective);
    const result = await api(app, `/api/execution/runs/${run.id}/execute`, 'worker', { method: 'POST', body: { version: run.version } });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.status, 'FAILED');
    assert.equal(JSON.stringify(result.body).includes(canary), false);
    assert.match(result.body.execution.error, objective === 'provider failure' ? /provider may have received this request/i : /quarantined/);
  }

  const run = await createApprovedRun(app, projectId, 'rotate during request');
  const executePromise = api(app, `/api/execution/runs/${run.id}/execute`, 'worker', { method: 'POST', body: { version: run.version } });
  await slowRequest;
  const rotated = await api(app, '/api/v1/secrets/secret-fixture', 'admin', { method: 'PUT', body: {
    schemaVersion: '1.0', commandId: 'provider-secret-rotation', expectedVersion: 1,
    payload: { value: 'fixture-secret-canary-rotated-8473', reason: 'Rotate in-flight fixture credential', expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() },
  } });
  assert.equal(rotated.status, 200, JSON.stringify(rotated.body));
  const canceled = await executePromise;
  assert.equal(canceled.status, 200, JSON.stringify(canceled.body));
  assert.equal(canceled.body.status, 'INTERRUPTED');
  assert.equal(JSON.stringify(canceled.body).includes(canary), false);
  assert.equal((await api(app, `/api/execution/runs/${run.id}`, 'other')).status, 404);

  const requestCountBeforeStaleBinding = setupResult.getFixtureRequestCount();
  const staleRun = await createApprovedRun(app, projectId, 'stale credential binding');
  const staleResult = await api(app, `/api/execution/runs/${staleRun.id}/execute`, 'worker', { method: 'POST', body: { version: staleRun.version } });
  assert.equal(staleResult.status, 200, JSON.stringify(staleResult.body));
  assert.equal(staleResult.body.status, 'FAILED');
  assert.equal(JSON.stringify(staleResult.body).includes('fixture-secret-canary'), false);
  assert.equal(setupResult.getFixtureRequestCount(), requestCountBeforeStaleBinding);
});

test('provider redirects are rejected and run views do not reveal the fixed provider URL', async (t) => {
  let targetCalls = 0;
  const setupResult = await setup(t, async ({ request, response, body }) => {
    if (request.url === '/redirect-target') { targetCalls += 1; response.end('{"result":"followed"}'); return; }
    if (body.objective === 'redirect response') {
      response.writeHead(302, { location: `http://${request.headers.host}/redirect-target` });
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ result: 'unexpected result' }));
  });
  const { app, projectId, getFixtureRequestCount } = setupResult;
  const run = await createApprovedRun(app, projectId, 'redirect response');
  assert.equal(JSON.stringify(run).includes('/v1/execute'), false);
  assert.equal(JSON.stringify(run).includes('127.0.0.1'), false);
  const result = await api(app, `/api/execution/runs/${run.id}/execute`, 'worker', { method: 'POST', body: { version: run.version } });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.status, 'FAILED');
  assert.equal(targetCalls, 0);
  assert.equal(getFixtureRequestCount(), 1);
});

test('revocation before transport handoff cancels the durable reservation without contacting the provider', async (t) => {
  let entered;
  let release;
  let armed = false;
  const reserved = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const setupResult = await setup(t, async ({ response }) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ result: 'unexpected provider contact' }));
  }, { persistenceFaults: { afterProviderDispatchReservation: async () => {
    if (!armed) return;
    armed = false;
    entered();
    await gate;
  } } });
  const { app, projectId, getFixtureRequestCount, restart } = setupResult;
  const secondApp = await restart();
  const run = await createApprovedRun(app, projectId, 'revocation wins dispatch gate');
  armed = true;
  const execution = api(app, `/api/execution/runs/${run.id}/execute`, 'worker', { method: 'POST', body: { version: run.version } });
  await reserved;
  const revoked = await api(secondApp, `/api/v1/projects/${projectId}/members/${principal('worker')}/revoke`, 'admin', { method: 'POST', body: {} });
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  release();
  const outcome = await execution;
  assert.notEqual(outcome.body.status, 'SUCCEEDED');
  assert.equal(getFixtureRequestCount(), 0);
  const attempt = await app.persistence.query('select status from orgward.provider_dispatch_attempts where tenant_id=$1 and run_id=$2', ['tenant-a', run.id]);
  assert.equal(attempt.rows[0].status, 'cancelled');
});

test('handoff wins the shared lease gate before revocation and restart never redispatches an uncertain attempt', async (t) => {
  let enteredHandoff;
  let releaseHandoff;
  let providerSeen;
  let releaseProvider;
  let armed = false;
  const handoffEntered = new Promise((resolve) => { enteredHandoff = resolve; });
  const handoffGate = new Promise((resolve) => { releaseHandoff = resolve; });
  const seen = new Promise((resolve) => { providerSeen = resolve; });
  const responseGate = new Promise((resolve) => { releaseProvider = resolve; });
  const setupResult = await setup(t, async ({ response }) => {
    providerSeen();
    await responseGate;
    if (!response.destroyed) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ result: 'late provider response' }));
    }
  }, { persistenceFaults: { afterProviderDispatchHandoff: async () => {
    if (!armed) return;
    armed = false;
    enteredHandoff();
    await handoffGate;
  } } });
  const { app, projectId, getFixtureRequestCount, restart } = setupResult;
  const secondApp = await restart();
  const run = await createApprovedRun(app, projectId, 'dispatch wins gate');
  armed = true;
  const execution = api(app, `/api/execution/runs/${run.id}/execute`, 'worker', { method: 'POST', body: { version: run.version } });
  await handoffEntered;
  const liveLease = await app.persistence.query(`select lease_until > clock_timestamp() + interval '20 seconds' as beyond_provider_handoff_bound
    from orgward.execution_worker_leases where tenant_id='tenant-a' and run_id=$1`, [run.id]);
  assert.equal(liveLease.rows[0].beyond_provider_handoff_bound, true, 'the provider lease remains valid while the committed send is deferred');
  const handedOff = await app.persistence.query(`select status from orgward.provider_dispatch_attempts
    where tenant_id='tenant-a' and run_id=$1`, [run.id]);
  assert.equal(handedOff.rows[0].status, 'handed_off', 'the provider handoff is durably recorded before the send hook');
  const revoked = await api(secondApp, `/api/v1/projects/${projectId}/members/${principal('worker')}/revoke`, 'admin', { method: 'POST', body: {} });
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  releaseHandoff();
  await seen;
  releaseProvider();
  const outcome = await execution;
  assert.notEqual(outcome.body.status, 'SUCCEEDED');
  assert.equal(outcome.body.status, 'INTERRUPTED');
  assert.deepEqual(outcome.body.execution.providerDiagnostic, { outcome: 'outcome_unknown' });
  assert.equal(getFixtureRequestCount(), 1);
  const attempt = await app.persistence.query('select status from orgward.provider_dispatch_attempts where tenant_id=$1 and run_id=$2', ['tenant-a', run.id]);
  assert.equal(attempt.rows[0].status, 'outcome_unknown');

  await app.persistence.query(`update orgward.execution_worker_leases set lease_until=clock_timestamp()-interval '1 second'
    where tenant_id='tenant-a' and run_id=$1`, [run.id]);
  await new Promise((resolve) => app.server.close(resolve));
  await app.close();
  setupResult.apps.splice(setupResult.apps.indexOf(app), 1);
  const restarted = await restart();
  const recovered = await api(restarted, `/api/execution/runs/${run.id}`, 'admin');
  assert.equal(recovered.status, 200);
  assert.notEqual(recovered.body.status, 'APPROVED');
  assert.deepEqual(recovered.body.execution.providerDiagnostic, { outcome: 'outcome_unknown' });
  const retry = await api(restarted, `/api/execution/runs/${run.id}/execute`, 'admin', { method: 'POST', body: { version: recovered.body.version } });
  assert.notEqual(retry.status, 200);
  assert.equal(getFixtureRequestCount(), 1);
  releaseProvider();
});

test('restart turns a reserved attempt with an expired lease into unknown and prevents redispatch', async (t) => {
  let entered;
  let release;
  let armed = false;
  const reserved = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const setupResult = await setup(t, async ({ response }) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"result":"must not dispatch"}');
  }, { persistenceFaults: { afterProviderDispatchReservation: async () => {
    if (!armed) return;
    armed = false;
    entered();
    await gate;
  } } });
  const { app, projectId, getFixtureRequestCount, restart } = setupResult;
  const run = await createApprovedRun(app, projectId, 'reserved attempt restart');
  armed = true;
  const execution = api(app, `/api/execution/runs/${run.id}/execute`, 'worker', { method: 'POST', body: { version: run.version } });
  await reserved;
  await app.persistence.query(`update orgward.execution_worker_leases set lease_until=clock_timestamp()-interval '1 second'
    where tenant_id='tenant-a' and run_id=$1`, [run.id]);
  const restarted = await restart();
  const attemptAfterRecovery = await restarted.persistence.query('select status from orgward.provider_dispatch_attempts where tenant_id=$1 and run_id=$2', ['tenant-a', run.id]);
  assert.equal(attemptAfterRecovery.rows[0].status, 'outcome_unknown');
  release();
  await execution;
  assert.equal(getFixtureRequestCount(), 0);
  const runAfterRecovery = await api(restarted, `/api/execution/runs/${run.id}`, 'admin');
  assert.notEqual(runAfterRecovery.body.status, 'APPROVED');
  assert.equal(getFixtureRequestCount(), 0);
});

test('failure after durable handoff but before transport send persists unknown and prevents redispatch', async (t) => {
  let failAfterHandoff = true;
  const setupResult = await setup(t, async ({ response }) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ result: 'provider may have processed this request' }));
  }, { persistenceFaults: { afterProviderDispatchHandoff: async () => {
    if (!failAfterHandoff) return;
    failAfterHandoff = false;
    throw new Error('simulated failure after durable handoff and before deferred transport send');
  } } });
  let { app } = setupResult;
  const { projectId, getFixtureRequestCount, restart } = setupResult;
  const run = await createApprovedRun(app, projectId, 'handoff outcome unknown');
  const first = await api(app, `/api/execution/runs/${run.id}/execute`, 'worker', { method: 'POST', body: { version: run.version } });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.notEqual(first.body.status, 'SUCCEEDED');
  assert.match(first.body.execution.error, /provider may have received this request/i);
  assert.match(first.body.execution.error, /run will not send it again/i);
  assert.equal(getFixtureRequestCount(), 0, 'the deferred transport is not sent when the post-handoff hook fails');
  const runEvents = await app.persistence.query(`select state->'events' as events from orgward.aggregates
    where tenant_id='tenant-a' and aggregate_kind='execution_run' and aggregate_id=$1`, [run.id]);
  assert.ok(runEvents.rows[0].events.some((event) => event.type === 'ExecutionFailed'
    && /will not send it again/i.test(event.data?.error ?? '')));
  const uncertain = await app.persistence.query('select status from orgward.provider_dispatch_attempts where tenant_id=$1 and run_id=$2', ['tenant-a', run.id]);
  assert.equal(uncertain.rows[0].status, 'outcome_unknown');

  await new Promise((resolve) => app.server.close(resolve));
  await app.close();
  setupResult.apps.splice(setupResult.apps.indexOf(app), 1);
  app = await restart();
  const persisted = await app.persistence.query('select status from orgward.provider_dispatch_attempts where tenant_id=$1 and run_id=$2', ['tenant-a', run.id]);
  assert.equal(persisted.rows[0].status, 'outcome_unknown');
  const current = await api(app, `/api/execution/runs/${run.id}`, 'worker');
  assert.equal(current.status, 200);
  const retry = await api(app, `/api/execution/runs/${run.id}/execute`, 'worker', { method: 'POST', body: { version: current.body.version } });
  assert.notEqual(retry.status, 200);
  assert.equal(getFixtureRequestCount(), 0, 'restart never sends an attempt whose outcome is unknown');
});

test('credential expiry blocks provider dispatch and aborts an in-flight provider request', async (t) => {
  let signalSlowRequest;
  const slowRequest = new Promise((resolve) => { signalSlowRequest = resolve; });
  let signalProviderClosed;
  const providerClosed = new Promise((resolve) => { signalProviderClosed = resolve; });
  const waitForFixture = (promise, name) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${name}.`)), 7_000);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
  const setupResult = await setup(t, async ({ response, body }) => {
    if (body.objective === 'expire during HTTP request') {
      signalSlowRequest();
      await new Promise((resolve) => response.once('close', resolve));
      signalProviderClosed();
      return;
    }
    signalSlowRequest?.();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ result: `Processed: ${body.objective}` }));
  });
  const { app, projectId, canary, getFixtureRequestCount } = setupResult;

  const beforeDispatch = await createApprovedRun(app, projectId, 'expiry before dispatch');
  await app.persistence.query(`update orgward.secret_references set expires_at = clock_timestamp() - interval '1 second'
    where tenant_id = 'tenant-a' and reference = 'secret-fixture'`);
  const countBeforeExpiredDispatch = getFixtureRequestCount();
  const blocked = await api(app, `/api/execution/runs/${beforeDispatch.id}/execute`, 'worker', { method: 'POST', body: { version: beforeDispatch.version } });
  assert.equal(blocked.status, 200, JSON.stringify(blocked.body));
  assert.equal(blocked.body.status, 'FAILED');
  assert.match(blocked.body.execution.error, /credential expired/i);
  assert.equal(JSON.stringify(blocked.body).includes(canary), false);
  assert.equal(getFixtureRequestCount(), countBeforeExpiredDispatch);
  const blockedStored = await app.persistence.query(`select state from orgward.aggregates
    where tenant_id = 'tenant-a' and aggregate_kind = 'execution_run' and aggregate_id = $1`, [beforeDispatch.id]);
  assert.ok(blockedStored.rows[0].state.events.some((entry) => entry.type === 'ExecutionFailed'
    && /credential expired/i.test(entry.data?.error ?? '')));

  const inFlight = await createApprovedRun(app, projectId, 'expire during HTTP request');
  await app.persistence.query(`update orgward.secret_references set expires_at = clock_timestamp() + interval '1200 milliseconds'
    where tenant_id = 'tenant-a' and reference = 'secret-fixture'`);
  const executionPromise = api(app, `/api/execution/runs/${inFlight.id}/execute`, 'worker', { method: 'POST', body: { version: inFlight.version } });
  await waitForFixture(slowRequest, 'provider request dispatch');
  await waitForFixture(providerClosed, 'provider request abort');
  const expired = await executionPromise;
  assert.equal(expired.status, 200, JSON.stringify(expired.body));
  assert.equal(expired.body.status, 'FAILED');
  assert.match(expired.body.execution.error, /credential expired/i);
  assert.equal(JSON.stringify(expired.body).includes(canary), false);
  assert.equal(getFixtureRequestCount(), countBeforeExpiredDispatch + 1);
  const expiredStored = await app.persistence.query(`select state from orgward.aggregates
    where tenant_id = 'tenant-a' and aggregate_kind = 'execution_run' and aggregate_id = $1`, [inFlight.id]);
  assert.ok(expiredStored.rows[0].state.events.some((entry) => entry.type === 'ExecutionFailed'
    && /credential expired/i.test(entry.data?.error ?? '')));
});

test('opt-in OpenAI profile binds each new approved run to the current validated generation and uses fixed Responses API', async (t) => {
  const keys = ['sk-openai-fixture-one', 'sk-openai-fixture-two'];
  const providerCalls = [];
  const fixtureResult = await setup(t, async ({ request, response, credential, body }) => {
    if (request.url.startsWith('/v1/models/')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: 'gpt-fixture' }));
      return;
    }
    if (request.url === '/v1/responses') {
      providerCalls.push({ credential, body });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Validated OpenAI result' }] }] }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ result: `Processed: ${body.objective}` }));
  }, { openAi: true });
  const { app, projectId } = fixtureResult;
  const nonmemberProject = await api(app, '/api/v1/projects', 'admin', { method: 'POST', body: {
    schemaVersion: '1.0', commandId: 'provider-nonmember-project', payload: { name: 'No worker membership' },
  } });
  assert.equal(nonmemberProject.status, 201, JSON.stringify(nonmemberProject.body));
  let resolverCalls = 0;
  const resolveBinding = app.secretStore.resolveOpenAiBinding.bind(app.secretStore);
  app.secretStore.resolveOpenAiBinding = async (...args) => {
    resolverCalls += 1;
    return resolveBinding(...args);
  };
  async function stageAndActivate(value, expectedVersion, commandTag) {
    const staged = await api(app, '/api/v1/secrets/secret-openai/openai-candidate', 'admin', { method: 'PUT', body: {
      schemaVersion: '1.0', commandId: `stage-${commandTag}`, expectedVersion,
      payload: { value, model: 'gpt-fixture', reason: 'Stage OpenAI test key', expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() },
    } });
    assert.equal(staged.status, 200, JSON.stringify(staged.body));
    const candidateVersion = staged.body.data.candidateVersion;
    const validated = await api(app, '/api/v1/secrets/secret-openai/openai-candidate/validate', 'admin', { method: 'POST', body: {
      schemaVersion: '1.0', commandId: `validate-${commandTag}`, expectedVersion,
      payload: { candidateVersion },
    } });
    assert.equal(validated.status, 200, JSON.stringify(validated.body));
    assert.equal(validated.body.data.candidateStatus, 'validated');
    const activated = await api(app, '/api/v1/secrets/secret-openai/openai-candidate/activate', 'admin', { method: 'POST', body: {
      schemaVersion: '1.0', commandId: `activate-${commandTag}`, expectedVersion,
      payload: { candidateVersion, reason: 'Activate validated OpenAI test key' },
    } });
    assert.equal(activated.status, 200, JSON.stringify(activated.body));
    return activated.body.data;
  }
  const unavailableDenial = await api(app, '/api/execution/runs', 'worker', { method: 'POST', body: {
    projectId: nonmemberProject.body.data.id, profileId: 'openai-current', title: 'No access', objective: 'Should not resolve a secret',
  } });
  assert.equal(unavailableDenial.status, 403);
  assert.match(unavailableDenial.body.error, /membership/i);
  assert.equal(resolverCalls, 0);

  const first = await stageAndActivate(keys[0], 0, 'one');
  assert.equal(first.version, 1);
  assert.equal(first.upstreamRevocationStatus, 'not_applicable');
  const activeDenial = await api(app, '/api/execution/runs', 'worker', { method: 'POST', body: {
    projectId: nonmemberProject.body.data.id, profileId: 'openai-current', title: 'No access', objective: 'Should not resolve a secret',
  } });
  assert.equal(activeDenial.status, unavailableDenial.status);
  assert.equal(activeDenial.body.error, unavailableDenial.body.error);
  assert.equal(resolverCalls, 0);
  const configuredSecretStore = app.executionService.secretStore;
  app.executionService.secretStore = null;
  const missingBrokerNonmember = await api(app, '/api/execution/runs', 'worker', { method: 'POST', body: {
    projectId: nonmemberProject.body.data.id, profileId: 'openai-current', title: 'No access', objective: 'Broker is absent',
  } });
  assert.equal(missingBrokerNonmember.status, unavailableDenial.status);
  assert.equal(missingBrokerNonmember.body.error, unavailableDenial.body.error);
  const missingBrokerMember = await api(app, '/api/execution/runs', 'worker', { method: 'POST', body: {
    projectId, profileId: 'openai-current', title: 'Broker unavailable', objective: 'Authorized lookup cannot proceed',
  } });
  app.executionService.secretStore = configuredSecretStore;
  assert.equal(missingBrokerMember.status, 503);
  assert.equal(resolverCalls, 0);

  const authorizeProject = app.executionService.store.authorizeProjectForPrincipal;
  app.executionService.store.authorizeProjectForPrincipal = undefined;
  const unavailableStore = await api(app, '/api/execution/runs', 'worker', { method: 'POST', body: {
    projectId, profileId: 'openai-current', title: 'Unavailable authorization store', objective: 'Must fail closed',
  } });
  app.executionService.store.authorizeProjectForPrincipal = authorizeProject;
  assert.equal(unavailableStore.status, 503);
  assert.equal(resolverCalls, 0);

  const created = await api(app, '/api/execution/runs', 'worker', { method: 'POST', body: {
    projectId, profileId: 'openai-current', title: 'OpenAI task', objective: 'Summarize the validation flow',
  } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.deepEqual(created.body.profile.credential, { reference: 'secret-openai', version: 1 });
  assert.equal(created.body.profile.providerModel, 'gpt-fixture');
  assert.equal(created.body.profile.providerMaxOutputTokens, undefined,
    'the DeepSeek-specific cap does not alter the existing OpenAI profile contract');
  assert.equal(resolverCalls, 1);

  const runCountBeforeRace = await app.persistence.query(`select count(*)::int as count from orgward.aggregates
    where tenant_id = 'tenant-a' and aggregate_kind = 'execution_run'`);
  const originalResolver = app.secretStore.resolveOpenAiBinding;
  app.secretStore.resolveOpenAiBinding = async (...args) => {
    const binding = await originalResolver(...args);
    await app.persistence.query(`update orgward.project_memberships set access = 'reader'
      where tenant_id = 'tenant-a' and project_id = $1 and principal = $2 and revoked_at is null`, [projectId, principal('worker')]);
    return binding;
  };
  const revokedRace = await api(app, '/api/execution/runs', 'worker', { method: 'POST', body: {
    projectId, profileId: 'openai-current', title: 'Raced authorization', objective: 'Must not persist',
  } });
  app.secretStore.resolveOpenAiBinding = originalResolver;
  assert.equal(revokedRace.status, 403, JSON.stringify(revokedRace.body));
  const runCountAfterRace = await app.persistence.query(`select count(*)::int as count from orgward.aggregates
    where tenant_id = 'tenant-a' and aggregate_kind = 'execution_run'`);
  assert.equal(runCountAfterRace.rows[0].count, runCountBeforeRace.rows[0].count);
  await app.persistence.query(`update orgward.project_memberships set access = 'editor'
    where tenant_id = 'tenant-a' and project_id = $1 and principal = $2 and revoked_at is null`, [projectId, principal('worker')]);
  const approved = await api(app, `/api/execution/runs/${created.body.id}/approve`, 'admin', { method: 'POST', body: { version: created.body.version } });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));

  const second = await stageAndActivate(keys[1], 1, 'two');
  assert.equal(second.version, 2);
  assert.equal(second.upstreamRevocationStatus, 'unconfirmed');
  const stale = await api(app, `/api/execution/runs/${created.body.id}/execute`, 'worker', { method: 'POST', body: { version: approved.body.version } });
  assert.equal(stale.status, 409, JSON.stringify(stale.body));
  assert.equal(providerCalls.length, 0);

  const next = await api(app, '/api/execution/runs', 'worker', { method: 'POST', body: {
    projectId, profileId: 'openai-current', title: 'OpenAI task v2', objective: 'Summarize the current model response',
  } });
  assert.equal(next.status, 201, JSON.stringify(next.body));
  assert.deepEqual(next.body.profile.credential, { reference: 'secret-openai', version: 2 });
  const nextApproved = await api(app, `/api/execution/runs/${next.body.id}/approve`, 'admin', { method: 'POST', body: { version: next.body.version } });
  assert.equal(nextApproved.status, 200, JSON.stringify(nextApproved.body));
  const executed = await api(app, `/api/execution/runs/${next.body.id}/execute`, 'worker', { method: 'POST', body: { version: nextApproved.body.version } });
  assert.equal(executed.status, 200, JSON.stringify(executed.body));
  assert.equal(executed.body.status, 'SUCCEEDED');
  assert.equal(executed.body.execution.stdout, 'Validated OpenAI result');
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].credential, `Bearer ${keys[1]}`);
  assert.deepEqual(providerCalls[0].body, { model: 'gpt-fixture', input: 'Summarize the current model response\n\nRequirements:\n', store: false, max_output_tokens: 2_000, tools: [] });
  assert.equal(JSON.stringify(executed.body).includes(keys[1]), false);
});

test('DeepSeek uses its fixed Responses endpoint with a pinned generic credential and bounded output', async (t) => {
  const providerCalls = [];
  const fixtureResult = await setup(t, async ({ request, response, credential, body }) => {
    providerCalls.push({ path: request.url, credential, body });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'completed', usage: { input_tokens: 18, output_tokens: 7, total_tokens: 25 }, output: [{ type: 'message', content: [{ type: 'output_text', text: 'Bounded DeepSeek result' }] }] }));
  }, { deepSeek: true });
  const { app, projectId, restart } = fixtureResult;
  const created = await api(app, '/api/execution/runs', 'worker', { method: 'POST', body: {
    projectId, profileId: 'deepseek-current', title: 'DeepSeek task', objective: 'Summarize the local test input',
  } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.profile.kind, 'provider-deepseek');
  assert.deepEqual(created.body.profile.credential, { reference: 'secret-fixture', version: 1 });
  assert.equal(created.body.profile.providerModel, 'deepseek-fixture');
  assert.equal(created.body.profile.providerMaxOutputTokens, 128);

  const approved = await api(app, `/api/execution/runs/${created.body.id}/approve`, 'admin', { method: 'POST', body: { version: created.body.version } });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const rotated = await api(app, '/api/v1/secrets/secret-fixture', 'admin', { method: 'PUT', body: {
    schemaVersion: '1.0', commandId: 'deepseek-generic-secret-rotate', expectedVersion: 1,
    payload: { value: 'fixture-deepseek-rotated-credential', reason: 'Rotate generic fixture credential', expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() },
  } });
  assert.equal(rotated.status, 200, JSON.stringify(rotated.body));
  const staleDispatch = await api(app, `/api/execution/runs/${created.body.id}/execute`, 'worker', { method: 'POST', body: { version: approved.body.version } });
  assert.equal(staleDispatch.status, 409);
  assert.match(staleDispatch.body.error, /credential binding changed after approval/i);
  assert.equal(providerCalls.length, 0, 'a rotated generic credential never reaches the provider');

  const next = await api(app, '/api/execution/runs', 'worker', { method: 'POST', body: {
    projectId, profileId: 'deepseek-current', title: 'DeepSeek task v2', objective: 'Summarize the current local test input',
  } });
  assert.equal(next.status, 201, JSON.stringify(next.body));
  assert.deepEqual(next.body.profile.credential, { reference: 'secret-fixture', version: 2 });
  const nextApproved = await api(app, `/api/execution/runs/${next.body.id}/approve`, 'admin', { method: 'POST', body: { version: next.body.version } });
  assert.equal(nextApproved.status, 200, JSON.stringify(nextApproved.body));
  const executed = await api(app, `/api/execution/runs/${next.body.id}/execute`, 'worker', { method: 'POST', body: { version: nextApproved.body.version } });
  assert.equal(executed.status, 200, JSON.stringify(executed.body));
  assert.equal(executed.body.status, 'SUCCEEDED');
  assert.equal(executed.body.execution.stdout, 'Bounded DeepSeek result');
  assert.deepEqual(executed.body.execution.modelUsage, { status: 'reported', inputTokens: 18, outputTokens: 7, totalTokens: 25 });
  assert.deepEqual(executed.body.execution.modelAttemptEvidence, {
    provider: 'deepseek', model: 'deepseek-fixture', profileRevision: '1.0.0',
    promptBytes: Buffer.byteLength(providerCalls[0].body.input, 'utf8'), promptByteCeiling: 16_384,
    requestedOutputTokens: 128, timeoutMs: 20_000, toolCount: 0,
    usageStatus: 'reported', costStatus: 'unknown',
  });
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].path, '/responses');
  assert.equal(providerCalls[0].credential, 'Bearer fixture-deepseek-rotated-credential');
  assert.deepEqual(providerCalls[0].body, {
    model: 'deepseek-fixture', input: 'Summarize the current local test input\n\nRequirements:\n',
    store: false, max_output_tokens: 128, tools: [], reasoning: { effort: 'none' },
  });
  assert.equal(JSON.stringify(executed.body).includes('fixture-deepseek-rotated-credential'), false);

  await new Promise((resolve) => app.server.close(resolve));
  await app.close();
  fixtureResult.apps.splice(fixtureResult.apps.indexOf(app), 1);
  const restarted = await restart();
  const restored = await api(restarted, `/api/execution/runs/${next.body.id}`, 'worker');
  assert.equal(restored.status, 200);
  assert.deepEqual(restored.body.execution.modelUsage, executed.body.execution.modelUsage);
  assert.deepEqual(restored.body.execution.modelAttemptEvidence, executed.body.execution.modelAttemptEvidence);
  assert.equal(JSON.stringify(restored.body.execution.modelAttemptEvidence).includes('fixture-deepseek-rotated-credential'), false);
  assert.equal(fixtureResult.getFixtureRequestCount(), 1);
});

test('DeepSeek secret-quarantined output keeps validated usage and completes the provider attempt', async (t) => {
  const fixtureResult = await setup(t, async ({ response }) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'completed', usage: { input_tokens: 13, output_tokens: 5, total_tokens: 18 },
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'fixture-secret-canary-8472' }] }] }));
  }, { deepSeek: true });
  const { app, projectId, canary, getFixtureRequestCount } = fixtureResult;
  const run = await createApprovedRun(app, projectId, 'quarantine a secret-bearing model result', 'deepseek-current');
  const failed = await api(app, `/api/execution/runs/${run.id}/execute`, 'worker', {
    method: 'POST', body: { version: run.version },
  });
  assert.equal(failed.status, 200);
  assert.equal(failed.body.status, 'FAILED');
  assert.match(failed.body.execution.error, /quarantined/);
  assert.equal(Object.hasOwn(failed.body.execution, 'stdout'), false);
  assert.deepEqual(failed.body.execution.modelUsage, { status: 'reported', inputTokens: 13, outputTokens: 5, totalTokens: 18 });
  assert.deepEqual(failed.body.execution.modelAttemptEvidence, {
    provider: 'deepseek', model: 'deepseek-fixture', profileRevision: '1.0.0',
    promptBytes: failed.body.execution.modelAttemptEvidence.promptBytes, promptByteCeiling: 16_384,
    requestedOutputTokens: 128, timeoutMs: 20_000, toolCount: 0,
    usageStatus: 'reported', costStatus: 'unknown',
  });
  assert.equal(JSON.stringify(failed.body).includes(canary), false);
  assert.equal(getFixtureRequestCount(), 1);
  const attempt = await app.persistence.query(`select status,usage_status,usage_input_tokens,usage_output_tokens,
      usage_total_tokens,cost_status from orgward.provider_dispatch_attempts where tenant_id='tenant-a' and run_id=$1`, [run.id]);
  assert.deepEqual(attempt.rows[0], {
    status: 'completed', usage_status: 'reported', usage_input_tokens: 13, usage_output_tokens: 5,
    usage_total_tokens: 18, cost_status: 'unknown',
  });
  const slot = await app.persistence.query(`select active_attempt_id from orgward.tenant_model_handoff_controls where tenant_id='tenant-a'`);
  assert.equal(slot.rows[0].active_attempt_id, null, 'quarantined completed response releases the tenant slot');
});

test('tenant-wide model handoff is single-flight across projects and profile revisions with bounded restart evidence', async (t) => {
  let providerCalls = 0;
  let markFirstRequest;
  let releaseFirstRequest;
  const firstRequestSeen = new Promise((resolve) => { markFirstRequest = resolve; });
  const firstRequestGate = new Promise((resolve) => { releaseFirstRequest = resolve; });
  const fixtureResult = await setup(t, async ({ response }) => {
    providerCalls += 1;
    if (providerCalls === 1) { markFirstRequest(); await firstRequestGate; }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'completed', usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Local model result.' }] }] }));
  }, { deepSeek: true });
  let { app } = fixtureResult;
  const { projectId, restart } = fixtureResult;
  const otherProject = await api(app, '/api/v1/projects', 'admin', { method: 'POST', body: {
    schemaVersion: '1.0', commandId: 'provider-budget-second-project', payload: { name: 'Second tenant project' },
  } });
  assert.equal(otherProject.status, 201, JSON.stringify(otherProject.body));
  await app.persistence.query(`insert into orgward.project_memberships (tenant_id,project_id,principal,access,granted_by)
    values ('tenant-a',$1,$2,'editor',$3)`, [otherProject.body.data.id, principal('worker'), principal('admin')]);

  const first = await createApprovedRun(app, projectId, 'first model handoff', 'deepseek-current');
  const concurrent = await createApprovedRun(app, otherProject.body.data.id, 'cross-project competing handoff', 'deepseek-alternate');
  const firstExecution = api(app, `/api/execution/runs/${first.id}/execute`, 'worker', {
    method: 'POST', body: { version: first.version },
  });
  await firstRequestSeen;
  const active = await app.persistence.query(`select c.active_run_id,c.active_attempt_id,c.active_status,
      d.model_provider,d.model_id,d.profile_revision,d.prompt_bytes,d.prompt_byte_ceiling,
      d.requested_output_tokens,d.timeout_ms,d.tool_count,d.usage_status,d.cost_status
    from orgward.tenant_model_handoff_controls c
    join orgward.provider_dispatch_attempts d on d.tenant_id=c.tenant_id
      and d.run_id=c.active_run_id and d.attempt_id=c.active_attempt_id
    where c.tenant_id='tenant-a'`);
  assert.equal(active.rowCount, 1);
  assert.equal(active.rows[0].active_run_id, first.id);
  assert.equal(active.rows[0].active_status, 'handed_off');
  assert.equal(active.rows[0].model_provider, 'deepseek');
  assert.equal(active.rows[0].model_id, 'deepseek-fixture');
  assert.equal(active.rows[0].profile_revision, '1.0.0');
  assert.equal(active.rows[0].prompt_byte_ceiling, 16_384);
  assert.equal(active.rows[0].prompt_bytes <= 16_384, true);
  assert.equal(active.rows[0].requested_output_tokens, 128);
  assert.equal(active.rows[0].timeout_ms <= 20_000, true);
  assert.equal(active.rows[0].tool_count, 0);
  assert.equal(active.rows[0].usage_status, 'reserved');
  assert.equal(active.rows[0].cost_status, 'unknown');

  const denied = await api(app, `/api/execution/runs/${concurrent.id}/execute`, 'worker', {
    method: 'POST', body: { version: concurrent.version },
  });
  assert.equal(denied.status, 200);
  assert.equal(denied.body.status, 'FAILED');
  assert.match(denied.body.execution.error, /this run was stopped before provider dispatch/i);
  assert.match(denied.body.execution.error, /request and approve a fresh run/i);
  const deniedAttempt = await app.persistence.query(`select count(*)::int as count from orgward.provider_dispatch_attempts
    where tenant_id='tenant-a' and run_id=$1`, [concurrent.id]);
  assert.equal(deniedAttempt.rows[0].count, 0, 'tenant-wide reservation denial happens before a second attempt is inserted');
  assert.equal(providerCalls, 1, 'the cross-project profile never reaches the loopback provider while the first handoff is active');

  releaseFirstRequest();
  const completed = await firstExecution;
  assert.equal(completed.status, 200);
  assert.equal(completed.body.status, 'SUCCEEDED');
  const finished = await app.persistence.query(`select status,usage_status,usage_input_tokens,usage_output_tokens,
      usage_total_tokens,cost_status,model_provider,model_id,profile_revision,prompt_bytes,prompt_byte_ceiling,
      requested_output_tokens,timeout_ms,tool_count
    from orgward.provider_dispatch_attempts where tenant_id='tenant-a' and run_id=$1`, [first.id]);
  assert.deepEqual(finished.rows[0], {
    status: 'completed', usage_status: 'reported', usage_input_tokens: 20, usage_output_tokens: 8,
    usage_total_tokens: 28, cost_status: 'unknown', model_provider: 'deepseek', model_id: 'deepseek-fixture',
    profile_revision: '1.0.0', prompt_bytes: finished.rows[0].prompt_bytes,
    prompt_byte_ceiling: 16_384, requested_output_tokens: 128, timeout_ms: finished.rows[0].timeout_ms, tool_count: 0,
  });
  assert.equal(finished.rows[0].prompt_bytes, Buffer.byteLength(fixtureResult.getFixtureRequest().body.input, 'utf8'));
  const released = await app.persistence.query(`select active_run_id,active_attempt_id,active_status
    from orgward.tenant_model_handoff_controls where tenant_id='tenant-a'`);
  assert.deepEqual(released.rows[0], { active_run_id: null, active_attempt_id: null, active_status: null });

  const afterCompletion = await createApprovedRun(app, otherProject.body.data.id, 'new model request after completion', 'deepseek-alternate');
  const nextExecution = await api(app, `/api/execution/runs/${afterCompletion.id}/execute`, 'worker', {
    method: 'POST', body: { version: afterCompletion.version },
  });
  assert.equal(nextExecution.body.status, 'SUCCEEDED');
  assert.equal(providerCalls, 2, 'a fresh approved run can use the released slot');
  await new Promise((resolve) => app.server.close(resolve));
  await app.close();
  fixtureResult.apps.splice(fixtureResult.apps.indexOf(app), 1);
  app = await restart();
  const restored = await app.persistence.query(`select status,usage_status,usage_input_tokens,usage_output_tokens,
      usage_total_tokens,cost_status,model_provider,model_id,profile_revision,prompt_bytes,prompt_byte_ceiling,
      requested_output_tokens,timeout_ms,tool_count from orgward.provider_dispatch_attempts
    where tenant_id='tenant-a' and run_id=$1`, [first.id]);
  assert.deepEqual(restored.rows[0], finished.rows[0], 'the full bounded envelope and known token usage persist across restart');
  const noRestartHandoff = await app.persistence.query(`select active_attempt_id from orgward.tenant_model_handoff_controls where tenant_id='tenant-a'`);
  assert.equal(noRestartHandoff.rows[0].active_attempt_id, null);
  assert.equal(providerCalls, 2, 'restart reads the persisted attempt without redispatch');
});

test('tenant shared output-token budget reserves requests and blocks later cross-profile dispatch', async (t) => {
  let providerCalls = 0;
  const fixture = await setup(t, async ({ response }) => {
    providerCalls += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'completed', usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Budgeted model result.' }] }] }));
  }, { deepSeek: true });
  const { app, projectId } = fixture;
  const initial = await api(app, '/api/execution/model-budget', 'admin');
  assert.equal(initial.status, 200);
  assert.equal(initial.body.budget.dailyOutputTokenLimit, null);
  const workerReadDenied = await api(app, '/api/execution/model-budget', 'worker');
  assert.equal(workerReadDenied.status, 403);
  const command = { schemaVersion: '1.0', commandId: 'tenant-model-budget-test', expectedVersion: 0,
    payload: { dailyOutputTokenLimit: 136, reason: 'Share a bounded daily token allowance across all tenant model profiles.' } };
  const configured = await api(app, '/api/execution/model-budget', 'admin', { method: 'PUT', body: command });
  assert.equal(configured.status, 201, JSON.stringify(configured.body));
  assert.equal(configured.body.budget.revision, 1);
  const replay = await api(app, '/api/execution/model-budget', 'admin', { method: 'PUT', body: command });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.budget.dailyOutputTokenLimit, 136);

  const execute = async (suffix) => {
    const run = await createApprovedRun(app, projectId, `Shared budget ${suffix}`, 'deepseek-current');
    return api(app, `/api/execution/runs/${run.id}/execute`, 'worker', { method: 'POST', body: { version: run.version } });
  };
  const first = await execute('first');
  assert.equal(first.body.status, 'SUCCEEDED');
  const second = await execute('second');
  assert.equal(second.body.status, 'SUCCEEDED');
  const blocked = await execute('over-cap');
  assert.equal(blocked.body.status, 'FAILED');
  assert.match(blocked.body.execution.error, /shared UTC-day output-token budget would be exceeded/i);
  assert.equal(providerCalls, 2, 'the rejected third request never reaches the provider');
  const blockedAttempt = await app.persistence.query(`select count(*)::int as count from orgward.provider_dispatch_attempts
    where tenant_id='tenant-a' and run_id=$1`, [blocked.body.id]);
  assert.equal(blockedAttempt.rows[0].count, 0);
  const current = await api(app, '/api/execution/model-budget', 'admin');
  assert.equal(current.body.budget.usedOutputTokens, 16);
  assert.equal(current.body.budget.remainingOutputTokens, 120);
  const audit = await app.persistence.query(`select count(*)::int as count from orgward.audit_log
    where tenant_id='tenant-a' and aggregate_kind='tenant_model_handoff_control'
      and aggregate_id='tenant-a' and event_type='TenantModelOutputBudgetConfigured'`);
  assert.equal(audit.rows[0].count, 1);
});

test('pre-handoff cancellation releases the tenant model slot without provider contact', async (t) => {
  let providerCalls = 0;
  let markReserved;
  let releaseReservation;
  let armed = false;
  const reservationSeen = new Promise((resolve) => { markReserved = resolve; });
  const reservationGate = new Promise((resolve) => { releaseReservation = resolve; });
  const fixtureResult = await setup(t, async ({ response }) => {
    providerCalls += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'completed', usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Local result.' }] }] }));
  }, { deepSeek: true, persistenceFaults: { afterProviderDispatchReservation: async () => {
    if (!armed) return;
    armed = false;
    markReserved();
    await reservationGate;
  } } });
  const { app, projectId } = fixtureResult;
  const first = await createApprovedRun(app, projectId, 'cancel before model handoff', 'deepseek-current');
  armed = true;
  const firstExecution = api(app, `/api/execution/runs/${first.id}/execute`, 'worker', {
    method: 'POST', body: { version: first.version },
  });
  await reservationSeen;
  await app.persistence.query(`update orgward.execution_worker_leases
    set cancel_requested_at=now(),cancel_reason='execution_cancelled'
    where tenant_id='tenant-a' and run_id=$1`, [first.id]);
  const cancelledAttempt = await app.persistence.query(`select status,usage_status from orgward.provider_dispatch_attempts
    where tenant_id='tenant-a' and run_id=$1`, [first.id]);
  assert.deepEqual(cancelledAttempt.rows[0], { status: 'cancelled', usage_status: 'dispatch_not_started' });
  const released = await app.persistence.query(`select active_attempt_id from orgward.tenant_model_handoff_controls where tenant_id='tenant-a'`);
  assert.equal(released.rows[0].active_attempt_id, null, 'pre-handoff cancellation releases the locked tenant slot');

  const next = await createApprovedRun(app, projectId, 'fresh run after cancellation', 'deepseek-alternate');
  const nextExecution = await api(app, `/api/execution/runs/${next.id}/execute`, 'worker', {
    method: 'POST', body: { version: next.version },
  });
  assert.equal(nextExecution.body.status, 'SUCCEEDED');
  assert.equal(providerCalls, 1, 'only the new run reaches the loopback provider');
  releaseReservation();
  const firstOutcome = await firstExecution;
  assert.notEqual(firstOutcome.body.status, 'SUCCEEDED');
  assert.equal(providerCalls, 1, 'the cancelled reservation never dispatches after its barrier releases');
});

test('DeepSeek denies oversized complete prompts before credential reservation or provider dispatch', async (t) => {
  let providerCalls = 0;
  const { app, projectId } = await setup(t, async ({ response }) => {
    providerCalls += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'unexpected' }] }] }));
  }, { deepSeek: true });
  const created = await api(app, '/api/execution/runs', 'worker', { method: 'POST', body: {
    projectId, profileId: 'deepseek-current', title: 'Oversized prompt', objective: 'x'.repeat(4_000),
    requirements: Array.from({ length: 40 }, (_, index) => `${index}-${'r'.repeat(490)}`),
  } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const approved = await api(app, `/api/execution/runs/${created.body.id}/approve`, 'admin', {
    method: 'POST', body: { version: created.body.version },
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const denied = await api(app, `/api/execution/runs/${created.body.id}/execute`, 'worker', {
    method: 'POST', body: { version: approved.body.version },
  });
  assert.equal(denied.status, 413, JSON.stringify(denied.body));
  assert.match(denied.body.error, /complete serialized model prompt/i);
  assert.equal(providerCalls, 0);
  const attempt = await app.persistence.query(`select count(*)::int as count from orgward.provider_dispatch_attempts
    where tenant_id='tenant-a' and run_id=$1`, [created.body.id]);
  assert.equal(attempt.rows[0].count, 0, 'prompt cap runs before broker reservation');
  const persisted = await api(app, `/api/execution/runs/${created.body.id}`, 'worker');
  assert.equal(persisted.body.status, 'APPROVED', 'prompt rejection leaves the approved run undispatched');
});

test('DeepSeek missing or malformed token usage is recorded as unreported', async (t) => {
  let providerCalls = 0;
  const { app, projectId } = await setup(t, async ({ response, body }) => {
    providerCalls += 1;
    const usage = body.input.includes('malformed usage')
      ? { input_tokens: 8, output_tokens: 129, total_tokens: 137 } : undefined;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'completed', ...(usage ? { usage } : {}), output: [{ type: 'message', content: [{ type: 'output_text', text: 'Completed without reliable usage' }] }] }));
  }, { deepSeek: true });
  for (const [objective, reason] of [['missing usage', 'usage_missing'], ['malformed usage', 'usage_invalid']]) {
    const created = await api(app, '/api/execution/runs', 'worker', { method: 'POST', body: {
      projectId, profileId: 'deepseek-current', title: objective, objective,
    } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const approved = await api(app, `/api/execution/runs/${created.body.id}/approve`, 'admin', {
      method: 'POST', body: { version: created.body.version },
    });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    const executed = await api(app, `/api/execution/runs/${created.body.id}/execute`, 'worker', {
      method: 'POST', body: { version: approved.body.version },
    });
    assert.equal(executed.body.status, 'SUCCEEDED');
    assert.deepEqual(executed.body.execution.modelUsage, { status: 'unreported', reason });
    const ledger = await app.persistence.query(`select usage_status,usage_reason,cost_status,prompt_bytes,prompt_byte_ceiling,
        requested_output_tokens,timeout_ms,tool_count from orgward.provider_dispatch_attempts
      where tenant_id='tenant-a' and run_id=$1`, [created.body.id]);
    assert.deepEqual(ledger.rows[0], {
      usage_status: 'unreported', usage_reason: reason, cost_status: 'unknown',
      prompt_bytes: ledger.rows[0].prompt_bytes, prompt_byte_ceiling: 16_384,
      requested_output_tokens: 128, timeout_ms: ledger.rows[0].timeout_ms, tool_count: 0,
    });
    assert.ok(ledger.rows[0].prompt_bytes > 0 && ledger.rows[0].prompt_bytes <= 16_384);
    assert.ok(ledger.rows[0].timeout_ms > 0 && ledger.rows[0].timeout_ms <= 20_000);
  }
  assert.equal(providerCalls, 2);
});

test('DeepSeek outcome-unknown HTTP responses persist only a safe status and never redispatch', async (t) => {
  const bodyCanary = 'provider-private-body-canary-9071';
  const headerCanary = 'provider-private-header-canary-9072';
  const fixtureResult = await setup(t, async ({ response }) => {
    response.writeHead(503, { 'content-type': 'text/plain', 'x-provider-private': headerCanary });
    response.end(bodyCanary);
  }, { deepSeek: true });
  const { app, projectId, restart, getFixtureRequestCount } = fixtureResult;
  const created = await api(app, '/api/execution/runs', 'worker', { method: 'POST', body: {
    projectId, profileId: 'deepseek-current', title: 'DeepSeek uncertain response', objective: 'Read only the local fixture input',
  } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const approved = await api(app, `/api/execution/runs/${created.body.id}/approve`, 'admin', {
    method: 'POST', body: { version: created.body.version },
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const failed = await api(app, `/api/execution/runs/${created.body.id}/execute`, 'worker', {
    method: 'POST', body: { version: approved.body.version },
  });
  assert.equal(failed.status, 200, JSON.stringify(failed.body));
  assert.equal(failed.body.status, 'FAILED');
  assert.match(failed.body.execution.error, /may have received this request/i);
  const diagnostic = { outcome: 'outcome_unknown', provider: 'deepseek', httpStatus: 503 };
  assert.deepEqual(failed.body.execution.providerDiagnostic, diagnostic);
  assert.deepEqual(failed.body.execution.modelUsage, { status: 'reserved' });
  assert.deepEqual(failed.body.execution.modelAttemptEvidence, {
    provider: 'deepseek', model: 'deepseek-fixture', profileRevision: '1.0.0',
    promptBytes: failed.body.execution.modelAttemptEvidence.promptBytes, promptByteCeiling: 16_384,
    requestedOutputTokens: 128, timeoutMs: 20_000, toolCount: 0,
    usageStatus: 'outcome_unknown', costStatus: 'unknown',
  });
  const failureEvent = failed.body.events.findLast((event) => event.type === 'ExecutionFailed');
  assert.deepEqual(failureEvent.data.providerDiagnostic, { provider: 'deepseek', httpStatus: 503 });
  assert.equal(JSON.stringify(failed.body).includes(bodyCanary), false);
  assert.equal(JSON.stringify(failed.body).includes(headerCanary), false);
  assert.equal(JSON.stringify(failed.body).includes(fixtureResult.canary), false);
  assert.equal(getFixtureRequestCount(), 1);
  const attempt = await app.persistence.query(`select status,usage_status,usage_input_tokens,usage_output_tokens,
      usage_total_tokens,cost_status,model_provider,model_id,profile_revision,prompt_bytes,prompt_byte_ceiling,
      requested_output_tokens,timeout_ms,tool_count from orgward.provider_dispatch_attempts
    where tenant_id='tenant-a' and run_id=$1`, [created.body.id]);
  assert.equal(attempt.rows[0].status, 'outcome_unknown');
  assert.equal(attempt.rows[0].usage_status, 'outcome_unknown');
  assert.equal(attempt.rows[0].cost_status, 'unknown');
  assert.equal(attempt.rows[0].model_provider, 'deepseek');
  assert.equal(attempt.rows[0].model_id, 'deepseek-fixture');
  assert.equal(attempt.rows[0].profile_revision, '1.0.0');
  assert.ok(attempt.rows[0].prompt_bytes > 0 && attempt.rows[0].prompt_bytes <= 16_384);
  assert.equal(attempt.rows[0].prompt_byte_ceiling, 16_384);
  assert.equal(attempt.rows[0].requested_output_tokens, 128);
  assert.ok(attempt.rows[0].timeout_ms > 0 && attempt.rows[0].timeout_ms <= 20_000);
  assert.equal(attempt.rows[0].tool_count, 0);
  const releasedSlot = await app.persistence.query(`select active_attempt_id from orgward.tenant_model_handoff_controls where tenant_id='tenant-a'`);
  assert.equal(releasedSlot.rows[0].active_attempt_id, null, 'terminal unknown outcome releases single-flight but preserves the attempt record');

  await new Promise((resolve) => app.server.close(resolve));
  await app.close();
  fixtureResult.apps.splice(fixtureResult.apps.indexOf(app), 1);
  const restarted = await restart();
  const persistedAttempt = await restarted.persistence.query(`select status,usage_status,usage_reason,cost_status,model_provider,
      model_id,profile_revision,prompt_bytes,prompt_byte_ceiling,requested_output_tokens,timeout_ms,tool_count
    from orgward.provider_dispatch_attempts where tenant_id='tenant-a' and run_id=$1`, [created.body.id]);
  assert.equal(persistedAttempt.rows[0].status, 'outcome_unknown');
  assert.equal(persistedAttempt.rows[0].usage_status, 'outcome_unknown');
  assert.equal(persistedAttempt.rows[0].cost_status, 'unknown');
  assert.equal(persistedAttempt.rows[0].prompt_bytes, attempt.rows[0].prompt_bytes);
  const recovered = await api(restarted, `/api/execution/runs/${created.body.id}`, 'worker');
  assert.equal(recovered.status, 200);
  assert.deepEqual(recovered.body.execution.providerDiagnostic, diagnostic);
  assert.deepEqual(recovered.body.execution.modelUsage, { status: 'reserved' });
  assert.deepEqual(recovered.body.execution.modelAttemptEvidence, failed.body.execution.modelAttemptEvidence);
  assert.deepEqual(recovered.body.events.findLast((event) => event.type === 'ExecutionFailed').data.providerDiagnostic,
    { provider: 'deepseek', httpStatus: 503 });
  const retry = await api(restarted, `/api/execution/runs/${created.body.id}/execute`, 'worker', {
    method: 'POST', body: { version: recovered.body.version },
  });
  assert.notEqual(retry.status, 200);
  assert.equal(getFixtureRequestCount(), 1);
});

test('DeepSeek outcome-unknown transport failures expose only allowlisted detail and never redispatch', async (t) => {
  const fixtureResult = await setup(t, async ({ response }) => { response.destroy(); }, { deepSeek: true });
  const { app, projectId, restart, getFixtureRequestCount } = fixtureResult;
  const created = await api(app, '/api/execution/runs', 'worker', { method: 'POST', body: {
    projectId, profileId: 'deepseek-current', title: 'DeepSeek missing response status', objective: 'Read only the local fixture input',
  } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const approved = await api(app, `/api/execution/runs/${created.body.id}/approve`, 'admin', {
    method: 'POST', body: { version: created.body.version },
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const failed = await api(app, `/api/execution/runs/${created.body.id}/execute`, 'worker', {
    method: 'POST', body: { version: approved.body.version },
  });
  assert.equal(failed.status, 200, JSON.stringify(failed.body));
  assert.equal(failed.body.status, 'FAILED');
  const eventDiagnostic = failed.body.events.findLast((event) => event.type === 'ExecutionFailed').data.providerDiagnostic;
  assert.deepEqual(eventDiagnostic, { provider: 'deepseek', transportFailureClass: 'connection_reset' });
  const diagnostic = { outcome: 'outcome_unknown', ...eventDiagnostic };
  assert.deepEqual(failed.body.execution.providerDiagnostic, diagnostic);
  assert.equal(JSON.stringify(failed.body).includes(fixtureResult.canary), false);
  assert.equal(getFixtureRequestCount(), 1);
  const processSnapshot = await api(app,
    `/api/execution/process-task-instances?projectId=${encodeURIComponent(projectId)}`, 'worker');
  assert.equal(processSnapshot.status, 200, JSON.stringify(processSnapshot.body));
  assert.ok(processSnapshot.body.runs.every((candidate) => candidate.projectId === projectId));
  assert.ok(processSnapshot.body.runs.some((candidate) => candidate.id === created.body.id
    && JSON.stringify(candidate.execution.providerDiagnostic) === JSON.stringify(diagnostic)));

  await new Promise((resolve) => app.server.close(resolve));
  await app.close();
  fixtureResult.apps.splice(fixtureResult.apps.indexOf(app), 1);
  const restarted = await restart();
  const recovered = await api(restarted, `/api/execution/runs/${created.body.id}`, 'worker');
  assert.equal(recovered.status, 200);
  assert.deepEqual(recovered.body.execution.providerDiagnostic, diagnostic);
  assert.deepEqual(recovered.body.events.findLast((event) => event.type === 'ExecutionFailed').data.providerDiagnostic,
    eventDiagnostic);
  const retry = await api(restarted, `/api/execution/runs/${created.body.id}/execute`, 'worker', {
    method: 'POST', body: { version: recovered.body.version },
  });
  assert.notEqual(retry.status, 200);
  assert.equal(getFixtureRequestCount(), 1);
});

test('DeepSeek 2xx parser failures persist only allowlisted diagnostics across restart', async (t) => {
  const cases = [
    { name: 'invalid JSON', parserFailureClass: 'invalid_json', body: '{bad-json' },
    { name: 'oversize body', parserFailureClass: 'body_too_large', body: 'x'.repeat(33_000) },
    { name: 'incomplete response', parserFailureClass: 'incomplete_response', body: JSON.stringify({ status: 'in_progress', output: [] }) },
    { name: 'missing output text', parserFailureClass: 'missing_output_text', body: JSON.stringify({ status: 'completed', output: [] }) },
  ];
  for (const [index, scenario] of cases.entries()) {
    const bodyCanary = `private-body-canary-${index}-8831`;
    const headerCanary = `private-header-canary-${index}-8832`;
    const fixtureResult = await setup(t, async ({ response }) => {
      response.writeHead(200, { 'content-type': 'application/json', 'x-private-canary': headerCanary });
      response.end(scenario.body.replace('{bad-json', `{\"canary\":\"${bodyCanary}`));
    }, { deepSeek: true });
    const { app, projectId, restart, getFixtureRequestCount } = fixtureResult;
    const approved = await createApprovedRun(app, projectId, `parse failure ${index}`, 'deepseek-current');
    const failed = await api(app, `/api/execution/runs/${approved.id}/execute`, 'worker', {
      method: 'POST', body: { version: approved.version },
    });
    assert.equal(failed.status, 200, JSON.stringify(failed.body));
    assert.equal(failed.body.status, 'FAILED');
    const diagnostic = { provider: 'deepseek', httpStatus: 200, parserFailureClass: scenario.parserFailureClass };
    const projectedDiagnostic = { outcome: 'outcome_unknown', ...diagnostic };
    assert.deepEqual(failed.body.execution.providerDiagnostic, projectedDiagnostic, failed.body.execution.error);
    const failureEvent = failed.body.events.findLast((event) => event.type === 'ExecutionFailed');
    assert.deepEqual(failureEvent.data.providerDiagnostic, diagnostic);
    assert.equal(JSON.stringify(failed.body).includes(bodyCanary), false);
    assert.equal(JSON.stringify(failed.body).includes(headerCanary), false);
    assert.equal(JSON.stringify(failed.body).includes(fixtureResult.canary), false);
    assert.equal((await api(app, `/api/execution/runs/${approved.id}`, 'other')).status, 404);
    await new Promise((resolve) => app.server.close(resolve));
    await app.close();
    fixtureResult.apps.splice(fixtureResult.apps.indexOf(app), 1);
    const restarted = await restart();
    const recovered = await api(restarted, `/api/execution/runs/${approved.id}`, 'worker');
    assert.equal(recovered.status, 200);
    assert.deepEqual(recovered.body.execution.providerDiagnostic, projectedDiagnostic);
    assert.deepEqual(recovered.body.events.findLast((event) => event.type === 'ExecutionFailed').data.providerDiagnostic,
      diagnostic);
    const retry = await api(restarted, `/api/execution/runs/${approved.id}/execute`, 'worker', {
      method: 'POST', body: { version: recovered.body.version },
    });
    assert.notEqual(retry.status, 200);
    assert.equal(getFixtureRequestCount(), 1);
  }
});
