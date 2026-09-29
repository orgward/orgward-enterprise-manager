import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { createApp } from '../../server.mjs';
import { startTestPostgresCluster, stopTestPostgresCluster } from '../helpers/postgres-cluster.mjs';

const issuer = 'https://human-owner-resolution.example.test';
const principal = (subject) => `oidc:${createHash('sha256').update(`${issuer}\n${subject}`).digest('hex')}`;
const command = (commandId, payload, expectedVersion) => JSON.stringify({
  schemaVersion: '1.0', commandId, ...(expectedVersion === undefined ? {} : { expectedVersion }), payload,
});

async function send(base, route, subject, { method = 'GET', body } = {}) {
  const response = await fetch(`${base}${route}`, {
    method, headers: { authorization: `Bearer ${subject}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body }),
  });
  const data = await response.json();
  return { status: response.status, data };
}

async function sendWithSession(base, route, sessionId, { method = 'GET', body } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      cookie: `ow_session=${sessionId}`, origin: new URL(base).origin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body }),
  });
  const data = await response.json();
  return { status: response.status, data };
}

test('a project owner assigned to the same founder actor can resolve their escalated checkpoint and read it after restart', async (t) => {
  const cluster = await startTestPostgresCluster();
  const dbName = `owner_resolve_${randomUUID().replaceAll('-', '').slice(0, 18)}`;
  await cluster.admin.query(`create database "${dbName}"`);
  const databaseUrl = `${cluster.baseUrl}/${dbName}`;
  const alice = {
    issuer, subject: 'alice', principal: principal('alice'), displayName: 'Alice Owner', tenantId: 'tenant-a',
    roles: ['tenant-admin', 'workspace-read', 'workspace-write', 'execution-approver'], actorType: 'human',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };
  const identities = new Map([['alice', alice]]);
  const oidcAuthenticator = { authenticate: async (request) => identities.get(String(request.headers.authorization ?? '').slice(7)) ?? null };
  const oidcLoginFlow = { redirectUri: 'http://127.0.0.1', begin: () => ({}), complete: async () => ({}) };
  let app = createApp({ databaseUrl, oidcAuthenticator, oidcLoginFlow });
  t.after(async () => {
    if (app) { await new Promise((resolve) => app.server.close(resolve)); await app.close(); }
    await stopTestPostgresCluster(cluster);
  });
  await app.init();
  await app.persistence.query(`insert into orgward.oidc_principals
    (principal,issuer,tenant_id,actor_type,roles,display_name) values($1,$2,$3,$4,$5::text[],$6)`,
  [alice.principal, issuer, 'tenant-a', 'human', alice.roles, alice.displayName]);
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  let base = `http://127.0.0.1:${app.server.address().port}`;
  oidcLoginFlow.redirectUri = base;
  const sessionId = randomBytes(32).toString('base64url');
  await app.sessionStore.create(sessionId, alice, alice.expiresAt);

  let result = await send(base, '/api/v1/projects', 'alice', { method: 'POST', body: command('owner-self-project', { name: 'Owner self-assignment fixture' }) });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  let project = result.data.data;
  for (const [index, content] of [
    'A repair membership reduces restaurant downtime.',
    'Owners receive preventive maintenance and documented repairs.',
    'Monthly membership funds travel and parts.',
    'A human approves safety-critical repairs.',
  ].entries()) {
    result = await send(base, `/api/v1/projects/${project.id}/messages`, 'alice', {
      method: 'POST', body: command(`owner-self-answer-${index}`, { content }, project.version),
    });
    assert.equal(result.status, 200);
    project = result.data.data;
  }
  const strategy = project.latestBlueprint.areas.purposeStrategy.items.find((item) => item.id === 'strategy-focused-launch');
  result = await send(base, `/api/v1/projects/${project.id}/blueprint/edits`, 'alice', {
    method: 'POST', body: command('owner-self-blueprint-v2', {
      objectId: strategy.id, name: strategy.name,
      detail: 'Validate a narrow repair membership with local owners before scaling service coverage.',
      ownerRoleName: 'Founder / enterprise owner',
    }, project.version),
  });
  assert.equal(result.status, 200);
  project = result.data.data;
  assert.equal(project.latestBlueprint.version, 2);

  const bindingRoute = `/api/v1/projects/${project.id}/actor-bindings/proposals`;
  result = await send(base, bindingRoute, 'alice', { method: 'POST', body: command('owner-self-founder-binding', {
    actorId: 'actor-founder', roleId: 'role-founder', targetPrincipal: alice.principal, blueprintVersion: 2,
  }, project.version) });
  assert.equal(result.status, 200);
  project = result.data.data;
  result = await send(base, `${bindingRoute}/enable`, 'alice', { method: 'POST', body: command('owner-self-founder-enable', {
    actorId: 'actor-founder', roleId: 'role-founder', blueprintVersion: 2,
  }, project.version) });
  assert.equal(result.status, 200);
  project = result.data.data;

  const plansRoute = `/api/v1/projects/${project.id}/process-plans`;
  result = await send(base, plansRoute, 'alice', { method: 'POST', body: command('owner-self-plan', { processId: 'process-review' }, project.version) });
  assert.equal(result.status, 201);
  const plan = result.data.data.processPlans.at(-1);
  result = await send(base, `${plansRoute}/${plan.id}/revisions`, 'alice', {
    method: 'POST', body: command('owner-self-plan-revision', {
      tasks: plan.tasks.map((task) => ({
        taskId: task.id, title: task.title, detail: task.detail, dependencies: task.dependencies,
        actorId: 'actor-founder', roleId: 'role-founder',
      })),
      humanCheckpoint: {
        beforeTaskId: 'task-process-deliver', title: 'Verify the customer evidence',
        detail: 'The assigned founder checks the saved evidence before the dependent task proceeds.',
        actorId: 'actor-founder', roleId: 'role-founder',
      },
    }, result.data.data.version),
  });
  assert.equal(result.status, 200);
  const revisedPlan = result.data.data.processPlans.at(-1);
  const revision = revisedPlan.revision;
  const taskRef = { projectId: project.id, planId: plan.id, revision, taskId: 'task-process-learn' };
  result = await send(base, '/api/execution/process-task-instances/start', 'alice', {
    method: 'POST', body: command('owner-self-start-root', taskRef),
  });
  assert.equal(result.status, 201);
  const instanceId = result.data.planInstanceId;
  result = await send(base, '/api/execution/process-task-instances/complete', 'alice', {
    method: 'POST', body: command('owner-self-complete-root', {
      ...taskRef, planInstanceId: instanceId, result: 'succeeded', evidence: ['Founder reviewed the saved customer need.'],
    }),
  });
  assert.equal(result.status, 201);
  const checkpointTask = revisedPlan.tasks.find((task) => task.id.startsWith('task-human-checkpoint-'));
  assert.ok(checkpointTask);
  const checkpointRef = { ...taskRef, planInstanceId: instanceId, taskId: checkpointTask.id };
  const beforeCheckpointStart = await send(base, `/api/execution/process-task-instances?projectId=${project.id}`, 'alice');
  const priorTaskStates = beforeCheckpointStart.data.instances.filter((entry) => entry.planInstanceId === instanceId)
    .map((entry) => ({ taskId: entry.taskId, status: entry.status }));
  result = await send(base, '/api/execution/process-task-instances/start', 'alice', {
    method: 'POST', body: command('owner-self-start-checkpoint', checkpointRef),
  });
  assert.equal(result.status, 201, JSON.stringify({ failure: result.data, priorTaskStates }));
  result = await sendWithSession(base, '/api/execution/process-task-instances/escalate', sessionId, {
    method: 'POST', body: command('owner-self-cookie-escalate-checkpoint', {
      ...checkpointRef, reason: 'Need owner review of evidence scope.', evidence: ['Owner should confirm this handoff.'],
    }),
  });
  assert.equal(result.status, 201);

  result = await sendWithSession(base, '/api/execution/process-task-instances/resolve', sessionId, {
    method: 'POST', body: command('owner-self-cookie-resolve-fresh-command', {
      ...checkpointRef, disposition: 'resume', reason: 'Owner reviewed and approved resumption.', evidence: [],
    }),
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.equal(result.data.status, 'IN_PROGRESS');
  assert.equal(result.data.events.at(-1).type, 'HumanTaskEscalationResolved');

  await new Promise((resolve) => app.server.close(resolve));
  await app.close();
  app = createApp({ databaseUrl, oidcAuthenticator, oidcLoginFlow });
  await app.init();
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
  oidcLoginFlow.redirectUri = base;
  result = await sendWithSession(base, `/api/execution/process-task-instances?projectId=${project.id}`, sessionId);
  assert.equal(result.status, 200);
  const restored = result.data.instances.find((entry) => entry.planInstanceId === instanceId && entry.taskId === checkpointTask.id);
  assert.equal(restored.status, 'IN_PROGRESS');
  assert.equal(restored.events.at(-1).type, 'HumanTaskEscalationResolved');
});
