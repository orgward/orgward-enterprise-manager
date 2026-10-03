import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../../server.mjs';
import { contentHash } from '../../src/platform/postgres.mjs';
import { releaseBuildBytes, readyCandidate } from './candidate-fixture.mjs';
import { startPostgres } from '../helpers/postgres.mjs';

const tenantId = 'tenant-release-test';
const projectId = 'project-00000000-0000-4000-8000-000000000001';
const issuer = 'https://release-identity.example.test';
const subjects = ['requester', 'approver', 'executor', 'outsider'];
const roles = {
  requester: ['workspace-write', 'release-approver'],
  approver: ['workspace-read', 'release-approver'],
  executor: ['workspace-write'],
  outsider: ['workspace-write'],
};
const identities = new Map(subjects.map((subject) => {
  const principal = `oidc:${createHash('sha256').update(`${issuer}\n${subject}`).digest('hex')}`;
  return [subject, { issuer, subject, principal, tenantId, actorType: 'human', displayName: subject,
    roles: roles[subject], expiresAt: Math.floor(Date.now() / 1000) + 300 }];
}));
const environmentAuthority = {
  requesters: [identities.get('requester').principal],
  approvers: [identities.get('requester').principal, identities.get('approver').principal],
  executors: [identities.get('executor').principal],
};

function environment(id, endpoint) {
  return { id, tenantId, projectId, label: id === 'production' ? 'Production' : 'Empty target',
    assetIds: ['service-api'], riskClass: 'high', actions: ['release', 'rollback'], authority: environmentAuthority,
    adapter: { kind: 'http-release-v1', endpoint, authorizationToken: 'loopback-release-token' } };
}

function receipt(payload, health = 'healthy') {
  const request = payload.request;
  return { version: 'protected-release-result-v1', actionId: payload.actionId, requestHash: payload.requestHash,
    environmentId: request.environment.id, configurationHash: request.environment.configurationHash,
    candidateEvidenceHash: request.candidate.candidateEvidenceHash,
    outputManifestHash: request.candidate.outputManifestHash, status: 'APPLIED', health,
    healthCheckId: `health-${payload.actionId.slice(-8)}`, observedAt: new Date().toISOString() };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function closeServer(server) {
  if (!server?.listening) return;
  server.closeAllConnections?.();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function makeController(t) {
  const receipts = new Map();
  const outcomes = [];
  const calls = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    if (request.method === 'POST' && request.url === '/actions') {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      calls.push({ method: 'POST', payload, authorization: request.headers.authorization,
        idempotencyKey: request.headers['idempotency-key'] });
      const outcome = outcomes.shift() ?? 'healthy';
      receipts.set(payload.actionId, receipt(payload, outcome === 'unhealthy' ? 'unhealthy' : 'healthy'));
      if (outcome === 'unknown') {
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end('{"message":"fixture transport uncertainty"}');
        return;
      }
      const result = outcome === 'missing-health' ? { ...receipt(payload), health: undefined, healthCheckId: undefined }
        : receipt(payload, outcome === 'unhealthy' ? 'unhealthy' : 'healthy');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(result));
      return;
    }
    const reconcileMatch = request.url.match(/^\/actions\/([^/]+)$/);
    if (request.method === 'GET' && reconcileMatch) {
      const actionId = decodeURIComponent(reconcileMatch[1]);
      calls.push({ method: 'GET', actionId });
      const result = receipts.get(actionId);
      response.writeHead(result ? 200 : 404, { 'content-type': 'application/json' });
      response.end(JSON.stringify(result ?? { code: 'not_found' }));
      return;
    }
    response.writeHead(404); response.end();
  });
  const ready = listen(server);
  t.after(() => closeServer(server));
  return { server, ready, calls, outcomes };
}

async function startApp({ postgres, root, endpoint }) {
  const authenticator = { authenticate: async (request) => {
    const token = request.headers.authorization?.slice('Bearer '.length);
    return identities.get(token) ?? null;
  } };
  const app = createApp({
    databaseUrl: postgres.databaseUrl,
    dataDirectory: path.join(root, 'projects'), sdlcDirectory: path.join(root, 'sdlc'),
    executionDirectory: path.join(root, 'executions'), executionWorkspaceDirectory: path.join(root, 'workspaces'),
    oidcAuthenticator: authenticator,
    releaseEnvironments: [environment('production', endpoint), environment('empty', endpoint)],
  });
  await app.init();
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  return { app, base: `http://127.0.0.1:${app.server.address().port}` };
}

async function closeApp(instance) {
  if (!instance) return;
  instance.app.server.closeIdleConnections?.();
  await new Promise((resolve, reject) => instance.app.server.close((error) => error ? reject(error) : resolve()));
  await instance.app.close();
}

async function request(base, subject, route, { method = 'GET', body } = {}, expectedStatus = 200) {
  const response = await fetch(`${base}${route}`, { method,
    headers: { authorization: `Bearer ${subject}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json();
  assert.equal(response.status, expectedStatus, JSON.stringify(value));
  return value;
}

async function seedFixture(postgres, executionDirectory, candidates) {
  const now = new Date().toISOString();
  for (const identity of identities.values()) {
    await postgres.query(`insert into orgward.oidc_principals
      (principal,issuer,tenant_id,actor_type,display_name,roles) values ($1,$2,$3,$4,$5,$6::text[])`,
    [identity.principal, identity.issuer, tenantId, identity.actorType, identity.displayName, identity.roles]);
  }
  const project = { id: projectId, tenantId, name: 'Protected release fixture', version: 0,
    createdAt: now, updatedAt: now, createdBy: identities.get('requester').principal,
    updatedBy: identities.get('requester').principal, conversation: [], events: [], memberships: [] };
  await postgres.query(`insert into orgward.aggregates
    (tenant_id,aggregate_kind,aggregate_id,version,state,state_hash,updated_at)
    values ($1,'project',$2,0,$3::jsonb,$4,$5)`,
  [tenantId, projectId, JSON.stringify(project), contentHash(project), now]);
  await postgres.query(`insert into orgward.project_memberships
    (tenant_id,project_id,principal,access,granted_by)
    values ($1,$2,$3,'owner',$3),($1,$2,$4,'editor',$3),($1,$2,$5,'editor',$3),($1,$2,$6,'editor',$3)`,
  [tenantId, projectId, identities.get('requester').principal, identities.get('approver').principal,
    identities.get('executor').principal, identities.get('outsider').principal]);
  for (const [index, run] of candidates.entries()) {
    run.tenantId = tenantId; run.projectId = projectId; run.version = 1;
    run.createdAt = now; run.updatedAt = now; run.profile = { id: `github-candidate-${index + 1}` };
    run.execution.status = 'COMPLETED';
    await postgres.query(`insert into orgward.aggregates
      (tenant_id,aggregate_kind,aggregate_id,version,state,state_hash,updated_at)
      values ($1,'execution_run',$2,$3,$4::jsonb,$5,$6)`,
    [tenantId, run.id, run.version, JSON.stringify(run), contentHash(run), now]);
    await postgres.query(`insert into orgward.aggregate_project_scopes
      (tenant_id,aggregate_kind,aggregate_id,project_id) values ($1,'execution_run',$2,$3)`, [tenantId, run.id, projectId]);
    for (const built of run.execution.repositoryCandidate.buildReceipt.runs) {
      const outputPath = path.join(executionDirectory, 'github-build-artifacts', run.id, built.artifactSetId, 'dist', 'app.js');
      await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
      await writeFile(outputPath, releaseBuildBytes, { mode: 0o600 });
    }
  }
}

function actionRoute(action, operation) {
  return `/api/v1/projects/${projectId}/release-actions/${action.id}/${operation}`;
}

function commandBody(action, commandId) {
  return { commandId, expectedVersion: action.version, requestHash: action.requestHash };
}

async function createAction(base, subject, { commandId, environmentId = 'production', kind, runId, expectedGeneration }) {
  return request(base, subject, `/api/v1/projects/${projectId}/release-actions`, {
    method: 'POST', body: { commandId, environmentId, kind, ...(runId ? { runId } : {}),
      reason: `Reviewed ${kind} for ${environmentId}`, expectedGeneration },
  }, 201);
}

async function approve(base, action, commandId = `approve-${action.id.slice(-8)}`, subject = 'approver') {
  return request(base, subject, actionRoute(action, 'approve'), { method: 'POST', body: commandBody(action, commandId) });
}

async function execute(base, action, commandId = `execute-${action.id.slice(-8)}`) {
  return request(base, 'executor', actionRoute(action, 'execute'), { method: 'POST', body: commandBody(action, commandId) });
}

test('protected release API sends exact build bytes, reconciles without redispatch, persists rollback and recovers confirmed unhealthy release', async (t) => {
  const postgres = await startPostgres();
  t.after(() => postgres.close());
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-protected-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const controller = makeController(t);
  const endpoint = await controller.ready;
  const executionDirectory = path.join(root, 'executions');
  const runA = readyCandidate({ runId: 'execution-run-00000000-0000-4000-8000-000000000001', snapshotChar: '1', candidateTreeChar: '6' });
  const runB = readyCandidate({ runId: 'execution-run-00000000-0000-4000-8000-000000000002', snapshotChar: '2', candidateTreeChar: '7' });
  let instance = await startApp({ postgres, root, endpoint });
  t.after(async () => closeApp(instance));
  await seedFixture(postgres, executionDirectory, [runA, runB]);

  const base = instance.base;
  const environmentPath = `/api/v1/projects/${projectId}/release-environments`;
  const initial = await request(base, 'requester', environmentPath);
  assert.equal(initial.available, true);
  assert.deepEqual(initial.environments.find((entry) => entry.id === 'production').state,
    { generation: 0, current: null, previous: null, pendingActionId: null });

  await request(base, 'outsider', `/api/v1/projects/${projectId}/release-actions`, { method: 'POST', body: {
    commandId: 'outsider-release', environmentId: 'production', kind: 'release', runId: runA.id,
    reason: 'Not configured for release.', expectedGeneration: 0,
  } }, 403).then((result) => assert.equal(result.error.code, 'RELEASE_AUTHORITY_DENIED'));
  const releaseA = (await createAction(base, 'requester', { commandId: 'request-release-a', kind: 'release', runId: runA.id, expectedGeneration: 0 })).action;
  const selfApproval = await request(base, 'requester', actionRoute(releaseA, 'approve'), {
    method: 'POST', body: commandBody(releaseA, 'self-approve-release-a'),
  }, 403);
  assert.equal(selfApproval.error.code, 'RELEASE_INDEPENDENT_APPROVAL_REQUIRED');
  const beforeApproval = await request(base, 'executor', actionRoute(releaseA, 'execute'), {
    method: 'POST', body: commandBody(releaseA, 'execute-before-approval-a'),
  }, 409);
  assert.equal(beforeApproval.error.code, 'RELEASE_STATE_CONFLICT');
  const approvedA = (await approve(base, releaseA)).action;
  const appliedA = (await execute(base, approvedA)).action;
  assert.equal(appliedA.status, 'SUCCEEDED');
  assert.equal(controller.calls.filter((call) => call.method === 'POST').length, 1);
  assert.deepEqual(controller.calls[0].payload.outputs, [{ ...runA.execution.repositoryCandidate.buildReceipt.runs[0].outputManifest[0],
    contentBase64: releaseBuildBytes.toString('base64') }]);
  assert.deepEqual(Buffer.from(controller.calls[0].payload.outputs[0].contentBase64, 'base64'), releaseBuildBytes);
  assert.equal(controller.calls[0].authorization, 'Bearer loopback-release-token');
  assert.equal(controller.calls[0].idempotencyKey, appliedA.id);

  const staleGeneration = await request(base, 'requester', `/api/v1/projects/${projectId}/release-actions`, {
    method: 'POST', body: { commandId: 'release-stale-generation', environmentId: 'production', kind: 'release',
      runId: runB.id, reason: 'Stale generation must fail.', expectedGeneration: 0 },
  }, 409);
  assert.equal(staleGeneration.error.code, 'RELEASE_STATE_CONFLICT');

  const releaseB = (await createAction(base, 'requester', { commandId: 'request-release-b', kind: 'release', runId: runB.id, expectedGeneration: 1 })).action;
  const changedB = structuredClone(runB);
  changedB.status = 'FAILED';
  await postgres.query(`update orgward.aggregates set state=$4::jsonb,state_hash=$5
    where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2 and version=$3`,
  [tenantId, runB.id, runB.version, JSON.stringify(changedB), contentHash(changedB)]);
  const staleCandidateApproval = await request(base, 'approver', actionRoute(releaseB, 'approve'), {
    method: 'POST', body: commandBody(releaseB, 'approve-stale-candidate-b'),
  }, 409);
  assert.equal(staleCandidateApproval.error.code, 'RELEASE_CANDIDATE_NOT_READY');
  await postgres.query(`update orgward.aggregates set state=$4::jsonb,state_hash=$5
    where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2 and version=$3`,
  [tenantId, runB.id, runB.version, JSON.stringify(runB), contentHash(runB)]);
  const approvedB = (await approve(base, releaseB)).action;
  controller.outcomes.push('unknown');
  const uncertainB = (await execute(base, approvedB)).action;
  assert.equal(uncertainB.status, 'OUTCOME_UNKNOWN');
  const repeatedUnknownExecute = await request(base, 'executor', actionRoute(uncertainB, 'execute'), {
    method: 'POST', body: commandBody(approvedB, `execute-${uncertainB.id.slice(-8)}`),
  });
  assert.equal(repeatedUnknownExecute.replayed, true);
  assert.equal(controller.calls.filter((call) => call.method === 'POST').length, 2,
    'retrying the same execute command does not send another effect');

  const blockedRelease = await request(base, 'requester', `/api/v1/projects/${projectId}/release-actions`, {
    method: 'POST', body: { commandId: 'release-while-unknown', environmentId: 'production', kind: 'release',
      runId: runA.id, reason: 'Cannot bypass unknown effect.', expectedGeneration: 1 },
  }, 409);
  assert.equal(blockedRelease.error.code, 'RELEASE_RECONCILIATION_REQUIRED');
  const blockedRollback = await request(base, 'requester', `/api/v1/projects/${projectId}/release-actions`, {
    method: 'POST', body: { commandId: 'rollback-while-unknown', environmentId: 'production', kind: 'rollback',
      reason: 'Cannot bypass unknown effect.', expectedGeneration: 1 },
  }, 409);
  assert.equal(blockedRollback.error.code, 'RELEASE_ROLLBACK_UNAVAILABLE');
  const reconcileBody = commandBody(uncertainB, 'reconcile-release-b');
  const reconciledB = (await request(base, 'executor', actionRoute(uncertainB, 'reconcile'), { method: 'POST', body: reconcileBody })).action;
  assert.equal(reconciledB.status, 'SUCCEEDED');
  assert.equal(controller.calls.filter((call) => call.method === 'GET').length, 1);
  const repeatedReconcile = await request(base, 'executor', actionRoute(uncertainB, 'reconcile'), { method: 'POST', body: reconcileBody });
  assert.equal(repeatedReconcile.replayed, true);
  assert.equal(controller.calls.filter((call) => call.method === 'GET').length, 1,
    'replaying reconciliation returns the saved observation without another adapter read');

  await closeApp(instance);
  instance = await startApp({ postgres, root, endpoint });
  const restarted = await request(instance.base, 'requester', environmentPath);
  const restoredState = restarted.environments.find((entry) => entry.id === 'production').state;
  assert.equal(restoredState.generation, 2);
  assert.equal(restoredState.current.candidateEvidenceHash, runB.execution.evidenceHash);
  assert.equal(restoredState.previous.candidateEvidenceHash, runA.execution.evidenceHash);

  const rollbackRequest = { commandId: 'rollback-b-to-a', environmentId: 'production', kind: 'rollback',
    reason: 'Restore the last approved candidate.', expectedGeneration: 2 };
  const rollbackA = (await request(instance.base, 'requester', `/api/v1/projects/${projectId}/release-actions`, {
    method: 'POST', body: rollbackRequest,
  }, 201)).action;
  assert.equal(rollbackA.request.candidate.candidateEvidenceHash, runA.execution.evidenceHash);
  const approvedRollback = (await approve(instance.base, rollbackA)).action;
  const appliedRollback = (await execute(instance.base, approvedRollback)).action;
  assert.equal(appliedRollback.status, 'SUCCEEDED');
  const dispatchCountAfterRollback = controller.calls.filter((call) => call.method === 'POST').length;
  const duplicateRollbackRequest = await request(instance.base, 'requester', `/api/v1/projects/${projectId}/release-actions`, {
    method: 'POST', body: rollbackRequest,
  });
  assert.equal(duplicateRollbackRequest.replayed, true);
  assert.equal(duplicateRollbackRequest.action.id, rollbackA.id);
  assert.equal(controller.calls.filter((call) => call.method === 'POST').length, dispatchCountAfterRollback,
    'replaying the original rollback command returns its immutable action without redispatch');

  const releaseUnhealthy = (await createAction(instance.base, 'requester', { commandId: 'request-unhealthy-b', kind: 'release', runId: runB.id, expectedGeneration: 3 })).action;
  const approvedUnhealthy = (await approve(instance.base, releaseUnhealthy)).action;
  controller.outcomes.push('unhealthy');
  const unhealthyB = (await execute(instance.base, approvedUnhealthy)).action;
  assert.equal(unhealthyB.status, 'UNHEALTHY');
  const healthState = (await request(instance.base, 'requester', environmentPath)).environments.find((entry) => entry.id === 'production').state;
  assert.equal(healthState.pendingActionId, unhealthyB.id);
  assert.equal(healthState.current.candidateEvidenceHash, runA.execution.evidenceHash);
  const deniedRecovery = await request(instance.base, 'outsider', `/api/v1/projects/${projectId}/release-actions`, {
    method: 'POST', body: { commandId: 'outsider-recovery', environmentId: 'production', kind: 'rollback',
      reason: 'Not configured.', expectedGeneration: 3 },
  }, 403);
  assert.equal(deniedRecovery.error.code, 'RELEASE_AUTHORITY_DENIED');

  const recovery = (await createAction(instance.base, 'requester', { commandId: 'recover-unhealthy-b', kind: 'rollback', expectedGeneration: 3 })).action;
  assert.equal(recovery.request.recoveryOfActionId, unhealthyB.id);
  assert.equal(recovery.request.expectedPendingActionId, unhealthyB.id);
  assert.equal(recovery.request.candidate.candidateEvidenceHash, runA.execution.evidenceHash);
  const approvedRecovery = (await approve(instance.base, recovery)).action;
  const recovered = (await execute(instance.base, approvedRecovery)).action;
  assert.equal(recovered.status, 'SUCCEEDED');
  const finalState = (await request(instance.base, 'requester', environmentPath)).environments.find((entry) => entry.id === 'production').state;
  assert.equal(finalState.generation, 4);
  assert.equal(finalState.current.candidateEvidenceHash, runA.execution.evidenceHash);
  assert.equal(finalState.pendingActionId, null);
  const actionHistory = (await request(instance.base, 'requester', environmentPath)).environments
    .find((entry) => entry.id === 'production').actions;
  assert.equal(actionHistory.find((action) => action.id === unhealthyB.id).status, 'RECOVERED');
  assert.equal(actionHistory.find((action) => action.id === unhealthyB.id).recoveredByActionId, recovered.id);

  const emptyUnhealthy = (await createAction(instance.base, 'requester', { commandId: 'request-empty-unhealthy',
    environmentId: 'empty', kind: 'release', runId: runA.id, expectedGeneration: 0 })).action;
  const approvedEmpty = (await approve(instance.base, emptyUnhealthy)).action;
  controller.outcomes.push('unhealthy');
  const unhealthyWithoutHistory = (await execute(instance.base, approvedEmpty)).action;
  assert.equal(unhealthyWithoutHistory.status, 'UNHEALTHY');
  const noHealthyTarget = await request(instance.base, 'requester', `/api/v1/projects/${projectId}/release-actions`, {
    method: 'POST', body: { commandId: 'rollback-empty-unhealthy', environmentId: 'empty', kind: 'rollback',
      reason: 'No prior successful candidate exists.', expectedGeneration: 0 },
  }, 409);
  assert.equal(noHealthyTarget.error.code, 'RELEASE_ROLLBACK_UNAVAILABLE');

  const emptyAfterNoTarget = (await request(instance.base, 'requester', environmentPath)).environments.find((entry) => entry.id === 'empty').state;
  assert.equal(emptyAfterNoTarget.pendingActionId, unhealthyWithoutHistory.id,
    'an unhealthy first release remains fenced when there is no prior healthy candidate');
});
