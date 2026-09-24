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

async function setup(t, handler, { openAi = false, persistenceFaults = {} } = {}) {
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
    }, ...(openAi ? [{ id: 'openai-current', kind: 'provider-openai', version: '1.0.0', label: 'Validated OpenAI', credentialReference: 'secret-openai', model: 'gpt-fixture', openAiEndpoint: `http://127.0.0.1:${fixture.address().port}/v1/responses` }] : [])];
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

async function createApprovedRun(app, projectId, objective) {
  const created = await api(app, '/api/execution/runs', 'worker', { method: 'POST', body: {
    projectId, profileId: 'fixture-http-provider', title: 'Fixture call', objective,
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
