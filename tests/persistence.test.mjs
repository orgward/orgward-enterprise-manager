import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../server.mjs';
import { createProject } from '../src/model.mjs';
import { coverageForBlueprint } from '../public/coverage-dashboard.mjs';
import { createChangeCase } from '../src/sdlc/engine.mjs';
import { createExecutionRun, executionApprovalRequestHash, executionEvent } from '../src/execution/contracts.mjs';
import { PostgresOidcSessionStore } from '../src/platform/oidc-sessions.mjs';
import { contentHash } from '../src/platform/postgres.mjs';
import { startPostgres } from './helpers/postgres.mjs';

const tenantHeaders = { 'content-type': 'application/json', authorization: 'Bearer alice' };

function command(commandId, payload, expectedVersion) {
  return JSON.stringify({ schemaVersion: '1.0', commandId, ...(expectedVersion === undefined ? {} : { expectedVersion }), payload });
}

function testOidcAuthenticator() {
  const issuer = 'https://persistence-identity.example.test';
  const identity = (subject, tenantId = 'tenant-a') => ({
    issuer, subject, principal: `oidc:${createHash('sha256').update(`${issuer}\n${subject}`).digest('hex')}`,
    displayName: subject, tenantId, roles: ['workspace-read', 'workspace-write', 'execution-approver', 'release-approver', 'control-owner'],
    actorType: 'human', expiresAt: Math.floor(Date.now() / 1000) + 300,
  });
  const identities = new Map(['alice', 'bob', 'carol', 'dave', 'readonly', 'shared-user', 'servicebot'].map((subject) => [subject, identity(subject)]));
  identities.get('readonly').roles = ['workspace-read'];
  identities.get('servicebot').actorType = 'workload';
  identities.get('servicebot').roles = ['workspace-read', 'workspace-write'];
  const tenantBIdentity = identity('tenant-b-admin');
  tenantBIdentity.tenantId = 'tenant-b';
  identities.set('tenant-b-admin', tenantBIdentity);
  for (const value of identities.values()) value.roles = value === identities.get('readonly')
    ? value.roles
    : [...value.roles, 'tenant-admin'];
  return {
    authenticate: async (request) => {
      const [subject, tenantClaim] = String(request.headers.authorization ?? '').slice(7).split('@');
      const verified = identities.get(subject);
      if (!verified) return null;
      if (!tenantClaim) return verified;
      if (tenantClaim === 'tenant-b-reader') return { ...verified, tenantId: 'tenant-b', roles: ['workspace-read'] };
      return { ...verified, tenantId: tenantClaim };
    },
    setRoles(subject, roles) { identities.get(subject).roles = [...roles]; },
    setActorType(subject, actorType) { identities.get(subject).actorType = actorType; },
    setDisplayName(subject, displayName) { identities.get(subject).displayName = displayName; },
    identitiesForFixture() { return [...identities.values()]; },
  };
}

async function request(base, route, options = {}, expected = 200) {
  const response = await fetch(`${base}${route}`, { ...options, headers: { ...tenantHeaders, ...(options.headers ?? {}) } });
  let body;
  try { body = await response.json(); }
  catch { body = null; }
  assert.equal(response.status, expected, JSON.stringify(body));
  return body;
}

async function start(databaseUrl, options = {}) {
  const oidcAuthenticator = options.oidcAuthenticator ?? testOidcAuthenticator();
  const app = createApp({ databaseUrl, ...options, oidcAuthenticator });
  await app.init();
  if (options.testEnrollment !== false && typeof oidcAuthenticator.identitiesForFixture === 'function') {
    const enrolled = new Map();
    for (const identity of oidcAuthenticator.identitiesForFixture()) {
      for (const tenantId of ['tenant-a', 'tenant-b']) {
        const key = `${tenantId}\n${identity.principal}`;
        if (enrolled.has(key)) continue;
        enrolled.set(key, true);
        await app.persistence.query(`
          insert into orgward.oidc_principals (principal, issuer, tenant_id, actor_type, roles, display_name)
          values ($1, $2, $3, $4, $5::text[], $6) on conflict (tenant_id, principal) do nothing
        `, [identity.principal, identity.issuer, tenantId, identity.actorType, identity.roles, identity.displayName]);
      }
    }
  }
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  return { ...app, base: `http://127.0.0.1:${app.server.address().port}` };
}

async function close(app) {
  await new Promise((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
  await app.close();
}

async function trustedGrantRoles(app, subject, roles, tenantId = 'tenant-a') {
  const principal = `oidc:${createHash('sha256').update(`https://persistence-identity.example.test\n${subject}`).digest('hex')}`;
  const previous = await app.persistence.query(
    "select roles from orgward.oidc_principals where tenant_id = $1 and principal = $2 and status = 'active'",
    [tenantId, principal],
  );
  const updated = await app.persistence.query(`
    update orgward.oidc_principals set roles = $3::text[], authz_generation = authz_generation + 1, updated_at = now()
    where tenant_id = $1 and principal = $2 and status = 'active'
    returning authz_generation
  `, [tenantId, principal, roles]);
  assert.equal(updated.rowCount, 1, 'the test trusted-enrollment fixture requires an active persisted principal');
  await app.persistence.query(`
    insert into orgward.oidc_principal_events (tenant_id, principal, event_type, actor, authz_generation)
    values ($1, $2, 'PrincipalClaimsUpdated', $2, $3)
  `, [tenantId, principal, updated.rows[0].authz_generation]);
  if (previous.rows[0]?.roles.some((role) => !roles.includes(role))) {
    await app.persistence.query(`
      update orgward.execution_worker_leases
      set cancel_requested_at = coalesce(cancel_requested_at, now()),
        cancel_reason = coalesce(cancel_reason, 'principal_authority_changed'), updated_at = now()
      where tenant_id = $1 and principal = $2 and lease_until > now() and cancel_requested_at is null
    `, [tenantId, principal]);
    await app.executionService.cancelPrincipal({ tenantId, principal, reason: 'principal_authority_changed' });
  }
  return Number(updated.rows[0].authz_generation);
}

async function authzGeneration(app, subject, tenantId = 'tenant-a') {
  const principal = `oidc:${createHash('sha256').update(`https://persistence-identity.example.test\n${subject}`).digest('hex')}`;
  const result = await app.persistence.query(
    'select authz_generation from orgward.oidc_principals where tenant_id = $1 and principal = $2',
    [tenantId, principal],
  );
  assert.equal(result.rowCount, 1);
  return Number(result.rows[0].authz_generation);
}

test('PostgreSQL commits state, command result, audit and outbox atomically under concurrency', async (t) => {
  const postgres = await startPostgres();
  const app = await start(postgres.databaseUrl);
  t.after(async () => { await close(app); await postgres.close(); });

  const created = await request(app.base, '/api/v1/projects', {
    method: 'POST', body: command('pg-create-one', { name: 'Transactional studio' }),
  }, 201);
  const project = created.data;
  const submit = (id, content) => fetch(`${app.base}/api/v1/projects/${project.id}/messages`, {
    method: 'POST', headers: tenantHeaders, body: command(id, { content }, project.version),
  });
  const responses = await Promise.all([submit('pg-race-a', 'Accepted answer'), submit('pg-race-b', 'Stale answer')]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const conflict = await responses.find((response) => response.status === 409).json();
  assert.equal(conflict.error.code, 'VERSION_CONFLICT');
  assert.equal(conflict.error.currentVersion, 2);

  const persisted = (await request(app.base, `/api/v1/projects/${project.id}`)).data;
  assert.equal(persisted.version, 2);
  assert.equal(persisted.conversation.filter((entry) => entry.role === 'user').length, 1);
  const rows = await postgres.query(`
    select
      (select count(*)::int from orgward.aggregates where tenant_id = 'tenant-a' and aggregate_id = $1) aggregates,
      (select count(*)::int from orgward.command_results where tenant_id = 'tenant-a') commands,
      (select count(*)::int from orgward.audit_log where tenant_id = 'tenant-a') audits,
      (select count(*)::int from orgward.outbox where tenant_id = 'tenant-a') outbox
  `, [project.id]);
  assert.deepEqual(rows.rows[0], { aggregates: 1, commands: 2, audits: 2, outbox: 2 });
  assert.deepEqual((await request(app.base, '/api/v1/projects', { headers: { authorization: 'Bearer tenant-b-admin' } })).data, []);
  const foundation = await request(app.base, '/api/v1/foundation');
  assert.equal(foundation.data.persistence.status, 'postgresql_transactional');
  assert.equal(foundation.data.persistence.schemaVersion, '015-provider-dispatch-attempts');
});

test('retry after a post-commit response failure returns the original result without another event', async (t) => {
  const postgres = await startPostgres();
  let injected = false;
  let app = await start(postgres.databaseUrl, {
    persistenceFaults: {
      afterCommit({ commandId }) {
        if (!injected && commandId === 'pg-uncertain-answer') {
          injected = true;
          throw new Error('Injected response-path failure.');
        }
      },
    },
  });
  t.after(async () => { if (app) await close(app); await postgres.close(); });
  const created = await request(app.base, '/api/v1/projects', {
    method: 'POST', body: command('pg-create-recovery', { name: 'Recovery studio' }),
  }, 201);
  await request(app.base, `/api/v1/projects/${created.data.id}/messages`, {
    method: 'POST', body: command('pg-uncertain-answer', { content: 'Committed before the response failed.' }, 1),
  }, 503);
  await close(app);
  app = null;

  app = await start(postgres.databaseUrl);
  const replay = await request(app.base, `/api/v1/projects/${created.data.id}/messages`, {
    method: 'POST', body: command('pg-uncertain-answer', { content: 'Committed before the response failed.' }, 1),
  });
  assert.equal(replay.meta.replayed, true);
  assert.equal(replay.data.version, 2);
  const conflict = await request(app.base, `/api/v1/projects/${created.data.id}/messages`, {
    method: 'POST', body: command('pg-uncertain-answer', { content: 'Different reuse.' }, 1),
  }, 409);
  assert.equal(conflict.error.code, 'IDEMPOTENCY_CONFLICT');
  const events = await postgres.query('select count(*)::int count from orgward.outbox where aggregate_id = $1', [created.data.id]);
  assert.equal(events.rows[0].count, 2);
});

test('authorized blueprint edits create immutable proposed versions with relationships, audit, replay and restart integrity', async (t) => {
  const postgres = await startPostgres();
  t.after(postgres.close);
  let injectedEditResponseFailure = false;
  let app = await start(postgres.databaseUrl, { persistenceFaults: {
    afterCommit({ operation, commandId }) {
      if (!injectedEditResponseFailure && operation === 'project.edit-blueprint-object' && commandId === 'blueprint-edit-process-trigger') {
        injectedEditResponseFailure = true;
        throw new Error('Injected post-commit edit response failure.');
      }
    },
  } });
  t.after(async () => { if (app) await close(app); });
  const issuer = 'https://persistence-identity.example.test';
  const principal = (subject) => `oidc:${createHash('sha256').update(`${issuer}\n${subject}`).digest('hex')}`;
  const created = await request(app.base, '/api/v1/projects', {
    method: 'POST', body: command('blueprint-edit-project', { name: 'Founder Blueprint' }),
  }, 201);
  let project = created.data;
  await app.persistence.query(`
    insert into orgward.project_memberships (tenant_id, project_id, principal, access, granted_by)
    values ('tenant-a', $1, $2, 'editor', $3), ('tenant-a', $1, $4, 'reader', $3)
  `, [project.id, principal('bob'), principal('alice'), principal('readonly')]);
  for (const [index, content] of [
    'A repair membership for independent restaurants.',
    'Restaurants need dependable repairs and clear service records.',
    'Charge a subscription with transparent repair costs.',
    'Keep customer commitments and all external actions human approved.',
  ].entries()) {
    project = (await request(app.base, `/api/v1/projects/${project.id}/messages`, {
      method: 'POST', body: command(index === 0 ? 'blueprint-edit-shared-command' : `blueprint-edit-answer-${index + 1}`, { content }, project.version),
    })).data;
  }
  assert.equal(project.latestBlueprint.version, 1);
  const route = `/api/v1/projects/${project.id}/blueprint/edits`;
  const sendEdit = (subject, commandId, payload, expectedVersion = project.version, expected = 200) => request(app.base, route, {
    method: 'POST', headers: { authorization: `Bearer ${subject}` },
    body: command(commandId, payload, expectedVersion),
  }, expected);

  const delivery = project.latestBlueprint.areas.capabilitiesProcesses.items.find((item) => item.id === 'capability-delivery');
  const beforeVersion = project.version;
  const capabilityEdit = {
    objectId: delivery.id, name: 'Partner service delivery', detail: 'Coordinate a reliable repair and record the customer outcome.',
    ownerRoleName: 'Founder / enterprise owner',
  };
  const invalidField = await sendEdit('alice', 'blueprint-edit-unknown-field', { ...capabilityEdit, proposedStatus: 'enabled' }, beforeVersion, 400);
  assert.equal(invalidField.error.code, 'INVALID_COMMAND');
  const authorityClaim = await sendEdit('alice', 'blueprint-edit-authority-claim', { ...capabilityEdit, authority: ['workspace-admin'] }, beforeVersion, 400);
  assert.equal(authorityClaim.error.code, 'CALLER_AUTHORITY_NOT_ALLOWED');
  const missingObject = await sendEdit('alice', 'blueprint-edit-missing-object', { ...capabilityEdit, objectId: 'capability-does-not-exist' }, beforeVersion, 404);
  assert.equal(missingObject.error.code, 'BLUEPRINT_OBJECT_NOT_FOUND');
  const missingRole = await sendEdit('alice', 'blueprint-edit-missing-role', { ...capabilityEdit, ownerRoleName: 'External operator' }, beforeVersion, 400);
  assert.equal(missingRole.error.code, 'INVALID_BLUEPRINT_RELATION');
  const noOp = await sendEdit('alice', 'blueprint-edit-no-op', {
    objectId: delivery.id, name: delivery.name, detail: delivery.detail, ownerRoleName: 'Operations owner',
  }, beforeVersion, 400);
  assert.equal(noOp.error.code, 'BLUEPRINT_EDIT_NO_CHANGE');
  const duplicateRole = await sendEdit('alice', 'blueprint-edit-duplicate-role', {
    objectId: 'role-operations', name: 'Founder / enterprise owner', detail: 'Duplicate role name.', proposedInstructions: 'Keep decisions proposed.', proposedScopeStatements: ['Propose only.'],
  }, beforeVersion, 400);
  assert.equal(duplicateRole.error.code, 'INVALID_BLUEPRINT_RELATION');
  const invalidScope = await sendEdit('alice', 'blueprint-edit-invalid-scope', {
    objectId: 'role-founder', name: 'Founder / enterprise owner', detail: 'Owns purpose and risk review.',
    proposedInstructions: 'Keep actions proposed.', proposedScopeStatements: [' '.repeat(3)],
  }, beforeVersion, 400);
  assert.equal(invalidScope.error.code, 'INVALID_COMMAND');
  const invalidTools = await sendEdit('alice', 'blueprint-edit-invalid-tools', {
    objectId: 'role-founder', name: 'Founder / enterprise owner', detail: 'Owns purpose and risk review.',
    proposedInstructions: 'Keep actions proposed.', proposedScopeStatements: ['Review purpose.'],
    proposedToolStatements: Array.from({ length: 13 }, (_, index) => `Tool ${index}`),
  }, beforeVersion, 400);
  assert.equal(invalidTools.error.code, 'INVALID_COMMAND');
  const invalidEscalations = await sendEdit('alice', 'blueprint-edit-invalid-escalations', {
    objectId: 'role-founder', name: 'Founder / enterprise owner', detail: 'Owns purpose and risk review.',
    proposedInstructions: 'Keep actions proposed.', proposedScopeStatements: ['Review purpose.'],
    proposedEscalationRules: ['x'.repeat(241)],
  }, beforeVersion, 400);
  assert.equal(invalidEscalations.error.code, 'INVALID_COMMAND');

  const unauthorized = await sendEdit('readonly', 'blueprint-edit-readonly', capabilityEdit, beforeVersion, 403);
  assert.equal(unauthorized.error.code, 'ACTION_FORBIDDEN');
  const nonmember = await sendEdit('carol', 'blueprint-edit-nonmember', capabilityEdit, beforeVersion, 404);
  assert.equal(nonmember.error.code, 'PROJECT_NOT_FOUND');
  const crossTenant = await sendEdit('tenant-b-admin', 'blueprint-edit-cross-tenant', capabilityEdit, beforeVersion, 404);
  assert.equal(crossTenant.error.code, 'PROJECT_NOT_FOUND');
  assert.equal((await request(app.base, `/api/v1/projects/${project.id}`)).data.version, beforeVersion);

  // The same command ID used by the answer route is independent under the blueprint-edit operation.
  const firstEditBody = command('blueprint-edit-shared-command', capabilityEdit, beforeVersion);
  const savedResponse = await request(app.base, route, { method: 'POST', body: firstEditBody });
  project = savedResponse.data;
  assert.equal(project.version, beforeVersion + 1);
  assert.equal(savedResponse.event.type, 'BlueprintObjectEdited');
  assert.equal(savedResponse.event.aggregateVersion, project.version);
  assert.equal(savedResponse.meta.replayed, false);
  assert.equal(project.blueprintVersions.length, 2);
  assert.equal(project.blueprintVersions[0].areas.capabilitiesProcesses.items.find((item) => item.id === delivery.id).owner, 'role-operations');
  const editedDelivery = project.latestBlueprint.areas.capabilitiesProcesses.items.find((item) => item.id === delivery.id);
  assert.equal(editedDelivery.name, capabilityEdit.name);
  assert.equal(editedDelivery.owner, 'role-founder');
  assert.equal(project.latestBlueprint.epistemicStatus, 'proposed-design');
  const coverageAfterCapabilityEdit = coverageForBlueprint(project.latestBlueprint);
  assert.equal(coverageAfterCapabilityEdit.blueprintVersion, 2);
  assert.equal(coverageAfterCapabilityEdit.epistemicStatus, 'proposed-design');
  assert.equal(coverageAfterCapabilityEdit.gaps.length, project.latestBlueprint.integrity.gaps.length);
  assert.equal(editedDelivery.status, delivery.status);
  assert.equal(project.latestBlueprint.integrity.valid, true);
  assert.equal(project.latestBlueprint.summary.relationCount, project.latestBlueprint.relations.length);
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === 'role-founder' && link.target === delivery.id && link.type === 'owns'));
  assert.ok(!project.latestBlueprint.relations.some((link) => link.source === 'role-operations' && link.target === delivery.id && link.type === 'owns'));
  assert.equal(project.latestBlueprint.edit.actor, principal('alice'));
  assert.deepEqual(project.latestBlueprint.edit.before.ownerRoleName, 'Operations owner');
  assert.deepEqual(project.latestBlueprint.edit.after.ownerRoleName, 'Founder / enterprise owner');
  assert.ok(project.latestBlueprint.edit.relationsBefore.some((link) => link.source === 'Operations owner' && link.type === 'owns'));
  assert.ok(project.latestBlueprint.edit.relationsAfter.some((link) => link.source === 'Founder / enterprise owner' && link.type === 'owns'));
  assert.ok(project.audit.some((entry) => entry.action === 'blueprint.object-edited' && entry.actor === principal('alice')));

  const replay = await request(app.base, route, { method: 'POST', body: firstEditBody });
  assert.equal(replay.meta.replayed, true);
  assert.equal(replay.data.blueprintVersions.length, 2);
  const reused = await sendEdit('alice', 'blueprint-edit-shared-command', { ...capabilityEdit, detail: 'Different text' }, beforeVersion, 409);
  assert.equal(reused.error.code, 'IDEMPOTENCY_CONFLICT');
  const stale = await sendEdit('alice', 'blueprint-edit-stale-version', { ...capabilityEdit, detail: 'Stale text' }, beforeVersion, 409);
  assert.equal(stale.error.code, 'VERSION_CONFLICT');
  assert.equal(stale.error.currentVersion, project.version);

  const processPayload = {
    objectId: 'process-deliver', name: 'Deliver partner service', detail: 'Accept an approved request, perform service work, and record the result.',
    ownerRoleName: 'Operations owner', trigger: 'A customer-approved repair request is received.',
  };
  const uncertainResponse = await fetch(`${app.base}${route}`, { method: 'POST',
    headers: { ...tenantHeaders, authorization: 'Bearer bob' },
    body: command('blueprint-edit-process-trigger', processPayload, project.version),
  });
  assert.equal(uncertainResponse.status, 503);
  assert.equal((await uncertainResponse.json()).error.code, 'COMMIT_OUTCOME_UNKNOWN');
  const processEdit = await sendEdit('bob', 'blueprint-edit-process-trigger', processPayload, project.version);
  assert.equal(processEdit.meta.replayed, true, 'the same pending command must recover the committed result after a lost response');
  project = processEdit.data;
  assert.equal(processEdit.event.type, 'BlueprintObjectEdited');
  assert.equal(project.latestBlueprint.version, 3);
  assert.equal(project.latestBlueprint.areas.capabilitiesProcesses.items.find((item) => item.id === 'process-deliver').trigger, 'A customer-approved repair request is received.');
  const roleEdit = await sendEdit('alice', 'blueprint-edit-role-instructions', {
    objectId: 'role-founder', name: 'Founder / enterprise owner', detail: 'Owns purpose, economics, risk acceptance, and delegation.',
    proposedInstructions: 'Review evidence and authorize design updates; do not bypass human approval.',
    proposedScopeStatements: ['Approve blueprint changes', 'Accept risk', 'Authorise assignments', 'Recommend investments'],
    proposedToolStatements: ['Coverage map', 'Version history'],
    proposedEscalationRules: ['Escalate unowned critical risks to a human owner'],
  });
  project = roleEdit.data;
  assert.equal(project.latestBlueprint.version, 4);
  const editedFounder = project.latestBlueprint.areas.responsibilityAuthority.items.find((item) => item.id === 'role-founder');
  assert.match(editedFounder.proposedInstructions, /human approval/);
  assert.deepEqual(editedFounder.proposedScopeStatements, ['Approve blueprint changes', 'Accept risk', 'Authorise assignments', 'Recommend investments']);
  assert.deepEqual(editedFounder.proposedToolStatements, ['Coverage map', 'Version history']);
  assert.deepEqual(editedFounder.proposedEscalationRules, ['Escalate unowned critical risks to a human owner']);
  assert.deepEqual(project.latestBlueprint.edit.before.proposedToolStatements, ['Blueprint editor', 'Coverage and version history']);
  assert.deepEqual(project.latestBlueprint.edit.after.proposedToolStatements, ['Coverage map', 'Version history']);
  assert.deepEqual(project.latestBlueprint.edit.before.proposedEscalationRules, ['Escalate unowned critical risks for human review']);
  assert.deepEqual(project.latestBlueprint.edit.after.proposedEscalationRules, ['Escalate unowned critical risks to a human owner']);
  assert.equal(Object.hasOwn(editedFounder, 'authority'), false);
  assert.equal(editedFounder.status, 'designed', 'proposal metadata does not grant authority or change operational state');
  assert.deepEqual(project.latestBlueprint.edit.before.proposedScopeStatements, ['Approve blueprint changes', 'Accept risk', 'Authorise assignments']);
  assert.equal(project.latestBlueprint.epistemicStatus, 'proposed-design');
  const coverageBeforeRestart = coverageForBlueprint(project.latestBlueprint);
  assert.equal(coverageBeforeRestart.blueprintVersion, 4);
  assert.equal(coverageBeforeRestart.gaps.length, project.latestBlueprint.integrity.gaps.length);

  const savedEvents = await app.persistence.query(`
    select count(*)::int as count from orgward.audit_log
    where tenant_id = 'tenant-a' and aggregate_id = $1 and event_type = 'BlueprintObjectEdited'
  `, [project.id]);
  assert.equal(savedEvents.rows[0].count, 3);
  const versionsBeforeRestart = project.blueprintVersions.length;
  await close(app);
  app = await start(postgres.databaseUrl);
  const restored = await request(app.base, `/api/v1/projects/${project.id}`);
  assert.equal(restored.data.blueprintVersions.length, versionsBeforeRestart);
  assert.equal(restored.data.latestBlueprint.version, 4);
  assert.equal(restored.data.latestBlueprint.areas.capabilitiesProcesses.items.find((item) => item.id === delivery.id).owner, 'role-founder');
  assert.deepEqual(restored.data.latestBlueprint.areas.responsibilityAuthority.items.find((item) => item.id === 'role-founder').proposedScopeStatements,
    ['Approve blueprint changes', 'Accept risk', 'Authorise assignments', 'Recommend investments']);
  assert.deepEqual(restored.data.latestBlueprint.areas.responsibilityAuthority.items.find((item) => item.id === 'role-founder').proposedToolStatements,
    ['Coverage map', 'Version history']);
  assert.deepEqual(restored.data.latestBlueprint.areas.responsibilityAuthority.items.find((item) => item.id === 'role-founder').proposedEscalationRules,
    ['Escalate unowned critical risks to a human owner']);
  assert.deepEqual(restored.data.blueprintVersions[0].areas.responsibilityAuthority.items.find((item) => item.id === 'role-founder').proposedScopeStatements,
    ['Approve blueprint changes', 'Accept risk', 'Authorise assignments'], 'the older immutable version retains its prior scope text');
  assert.deepEqual(restored.data.blueprintVersions[0].areas.responsibilityAuthority.items.find((item) => item.id === 'role-founder').proposedToolStatements,
    ['Blueprint editor', 'Coverage and version history'], 'older tool proposals remain unchanged');
  assert.deepEqual(coverageForBlueprint(restored.data.latestBlueprint), coverageBeforeRestart);
  const replayAfterRestart = await request(app.base, route, { method: 'POST', body: firstEditBody });
  assert.equal(replayAfterRestart.meta.replayed, true);
  assert.equal(replayAfterRestart.data.blueprintVersions.length, 2, 'a replay returns its original committed snapshot without creating another version');
  const finalEvents = await app.persistence.query(`
    select count(*)::int as count from orgward.audit_log
    where tenant_id = 'tenant-a' and aggregate_id = $1 and event_type = 'BlueprintObjectEdited'
  `, [project.id]);
  assert.equal(finalEvents.rows[0].count, 3);
});

test('blueprint actor identity proposals are restricted, type-checked, pinned, idempotent and non-authorizing', async (t) => {
  const postgres = await startPostgres();
  t.after(postgres.close);
  const oidcAuthenticator = testOidcAuthenticator();
  oidcAuthenticator.setDisplayName('bob', 'Hidden assignment recipient');
  let app = await start(postgres.databaseUrl, { oidcAuthenticator });
  t.after(async () => { if (app) await close(app); });
  const issuer = 'https://persistence-identity.example.test';
  const principal = (subject) => `oidc:${createHash('sha256').update(`${issuer}\n${subject}`).digest('hex')}`;
  const created = await request(app.base, '/api/v1/projects', {
    method: 'POST', body: command('actor-binding-project', { name: 'Proposed identity test' }),
  }, 201);
  let project = created.data;
  for (const [index, content] of [
    'A local service business for customers.', 'Customers receive maintenance and clear records.',
    'Members pay monthly; travel and parts constrain costs.', 'Humans approve safety decisions; records may be automated.',
  ].entries()) {
    project = (await request(app.base, `/api/v1/projects/${project.id}/messages`, {
      method: 'POST', body: command(`actor-binding-answer-${index}`, { content }, project.version),
    })).data;
  }
  const projectId = project.id;
  await app.persistence.query(`
    insert into orgward.project_memberships (tenant_id, project_id, principal, access, granted_by)
    values ('tenant-a', $1, $2, 'editor', $3), ('tenant-a', $1, $4, 'reader', $3), ('tenant-a', $1, $5, 'editor', $3)
  `, [projectId, principal('bob'), principal('alice'), principal('readonly'), principal('servicebot')]);
  const route = `/api/v1/projects/${projectId}/actor-bindings/proposals`;
  const enableRoute = `${route}/enable`;
  const members = await request(app.base, `/api/v1/projects/${projectId}/members`);
  assert.ok(members.data.some((member) => member.displayName === 'Hidden assignment recipient' && member.actorType === 'human'));
  const basePayload = { actorId: 'actor-founder', roleId: 'role-founder', targetPrincipal: principal('bob'), blueprintVersion: 1 };
  const post = (subject, id, payload, expectedVersion, expected = 200) => request(app.base, route, {
    method: 'POST', headers: { authorization: `Bearer ${subject}` },
    body: command(id, payload, expectedVersion),
  }, expected);
  const enable = (subject, id, payload, expectedVersion, expected = 200) => request(app.base, enableRoute, {
    method: 'POST', headers: { authorization: `Bearer ${subject}` },
    body: command(id, payload, expectedVersion),
  }, expected);
  const unrelated = await request(app.base, '/api/v1/projects', {
    method: 'POST', body: command('actor-binding-other-project', { name: 'Unrelated assignment workspace' }),
  }, 201);
  let unrelatedProject = unrelated.data;
  for (const [index, content] of [
    'A separate local service.', 'Separate customers receive service.',
    'Separate costs and membership terms.', 'Humans review all consequential actions.',
  ].entries()) {
    unrelatedProject = (await request(app.base, `/api/v1/projects/${unrelatedProject.id}/messages`, {
      method: 'POST', body: command(`actor-binding-other-answer-${index}`, { content }, unrelatedProject.version),
    })).data;
  }
  const wrongProjectEnable = await fetch(`${app.base}/api/v1/projects/${unrelatedProject.id}/actor-bindings/proposals/enable`, {
    method: 'POST', headers: { ...tenantHeaders },
    body: command('actor-binding-enable-wrong-project', { actorId: 'actor-founder', roleId: 'role-founder', blueprintVersion: 1 }, unrelatedProject.version),
  });
  assert.equal(wrongProjectEnable.status, 404, 'a same-tenant project cannot transition another project’s proposal');
  assert.equal((await wrongProjectEnable.json()).error.code, 'ACTOR_BINDING_PROPOSAL_NOT_FOUND');
  const missingIdentity = await fetch(`${app.base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: command('actor-binding-no-auth', basePayload, project.version) });
  assert.equal(missingIdentity.status, 401);
  const readerDenied = await post('readonly', 'actor-binding-reader', basePayload, project.version, 403);
  assert.equal(readerDenied.error.code, 'ACTION_FORBIDDEN');
  const nonmember = await post('alice', 'actor-binding-nonmember', { ...basePayload, targetPrincipal: principal('carol') }, project.version, 409);
  assert.equal(nonmember.error.code, 'ACTOR_BINDING_TARGET_INELIGIBLE');
  const crossTenant = await post('alice', 'actor-binding-cross-tenant', { ...basePayload, targetPrincipal: principal('tenant-b-admin') }, project.version, 409);
  assert.equal(crossTenant.error.code, 'ACTOR_BINDING_TARGET_INELIGIBLE');
  const wrongType = await post('alice', 'actor-binding-type-mismatch', { ...basePayload, targetPrincipal: principal('servicebot') }, project.version, 400);
  assert.equal(wrongType.error.code, 'ACTOR_BINDING_TYPE_MISMATCH');
  const wrongRole = await post('alice', 'actor-binding-unlinked-role', { ...basePayload, roleId: 'role-operations' }, project.version, 400);
  assert.equal(wrongRole.error.code, 'BLUEPRINT_ROLE_NOT_LINKED');
  const staleBlueprint = await post('alice', 'actor-binding-stale-blueprint', { ...basePayload, blueprintVersion: 2 }, project.version, 409);
  assert.equal(staleBlueprint.error.code, 'BLUEPRINT_VERSION_STALE');
  const firstBody = command('actor-binding-propose-human', basePayload, project.version);
  const first = await request(app.base, route, { method: 'POST', body: firstBody });
  project = first.data;
  assert.equal(first.event.type, 'BlueprintActorBindingProposed');
  assert.equal(first.event.actor, principal('alice'), 'the audit event retains the verified proposer');
  assert.deepEqual(first.event.data, { blueprintVersion: 1, actorId: 'actor-founder', roleId: 'role-founder', targetType: 'human', status: 'proposed' });
  assert.equal(first.meta.replayed, false);
  const firstResponseText = JSON.stringify(first);
  assert.equal(firstResponseText.includes(principal('bob')), false);
  assert.equal(firstResponseText.includes('Hidden assignment recipient'), false);
  const replay = await request(app.base, route, { method: 'POST', body: firstBody });
  assert.equal(replay.meta.replayed, true);
  assert.equal(replay.data.version, project.version);
  const duplicate = await post('alice', 'actor-binding-duplicate-pair', basePayload, project.version, 409);
  assert.equal(duplicate.error.code, 'ACTOR_BINDING_ALREADY_PROPOSED');
  const stale = await post('alice', 'actor-binding-stale', basePayload, project.version - 1, 409);
  assert.equal(stale.error.code, 'VERSION_CONFLICT');
  const readerList = await fetch(`${app.base}${route}`, { headers: { authorization: 'Bearer readonly' } });
  assert.equal(readerList.status, 404);
  const editorList = await request(app.base, route, { headers: { authorization: 'Bearer bob' } });
  assert.equal(editorList.data.proposals[0].targetName, 'Hidden assignment recipient');
  const tenantBList = await fetch(`${app.base}${route}`, { headers: { authorization: 'Bearer tenant-b-admin@tenant-b' } });
  assert.equal(tenantBList.status, 404);
  let registry = await request(app.base, route);
  assert.equal(registry.data.proposals.length, 1);
  assert.equal(registry.data.proposals[0].targetName, 'Hidden assignment recipient');
  assert.equal(registry.data.proposals[0].targetStatus, 'active_project_member');
  assert.equal(Object.hasOwn(registry.data.proposals[0], 'targetPrincipal'), false);
  const agentPayload = { actorId: 'actor-design-assistant', roleId: 'role-design-assistant', targetPrincipal: principal('servicebot'), blueprintVersion: 1 };
  const agentProposal = await post('alice', 'actor-binding-propose-agent', agentPayload, project.version);
  project = agentProposal.data;
  assert.equal(agentProposal.event.data.targetType, 'workload');
  const enableHumanPayload = { actorId: basePayload.actorId, roleId: basePayload.roleId, blueprintVersion: 1 };
  const enableReaderDenied = await enable('readonly', 'actor-binding-enable-reader', enableHumanPayload, project.version, 403);
  assert.equal(enableReaderDenied.error.code, 'ACTION_FORBIDDEN');
  const enableCrossTenant = await enable('tenant-b-admin@tenant-b', 'actor-binding-enable-cross-tenant', enableHumanPayload, project.version, 404);
  assert.equal(enableCrossTenant.error.code, 'PROJECT_NOT_FOUND');
  const enableStaleAggregate = await enable('alice', 'actor-binding-enable-stale-version', enableHumanPayload, project.version - 1, 409);
  assert.equal(enableStaleAggregate.error.code, 'VERSION_CONFLICT');
  const enableStaleBlueprint = await enable('alice', 'actor-binding-enable-stale-blueprint', { ...enableHumanPayload, blueprintVersion: 2 }, project.version, 409);
  assert.equal(enableStaleBlueprint.error.code, 'BLUEPRINT_VERSION_STALE');
  const bobAuthorityBefore = await app.persistence.query(
    'select roles, authz_generation from orgward.oidc_principals where tenant_id=$1 and principal=$2',
    ['tenant-a', principal('bob')],
  );
  const firstEnableBody = command('actor-binding-enable-human', enableHumanPayload, project.version);
  const enabled = await request(app.base, enableRoute, { method: 'POST', body: firstEnableBody });
  project = enabled.data;
  assert.equal(enabled.event.type, 'BlueprintActorBindingEnabled');
  assert.equal(enabled.event.actor, principal('alice'));
  assert.equal(enabled.event.data.status, 'enabled');
  assert.equal(enabled.event.data.targetPrincipal, undefined);
  assert.equal(enabled.meta.replayed, false);
  assert.equal(JSON.stringify(enabled).includes(principal('bob')), false);
  assert.equal(JSON.stringify(enabled).includes('Hidden assignment recipient'), false);
  const enableReplay = await request(app.base, enableRoute, { method: 'POST', body: firstEnableBody });
  assert.equal(enableReplay.meta.replayed, true);
  assert.equal(enableReplay.data.version, project.version);
  const secondEnable = await enable('alice', 'actor-binding-enable-twice', enableHumanPayload, project.version, 409);
  assert.equal(secondEnable.error.code, 'ACTOR_BINDING_NOT_PROPOSED');
  const bobAuthorityAfter = await app.persistence.query(
    'select roles, authz_generation from orgward.oidc_principals where tenant_id=$1 and principal=$2',
    ['tenant-a', principal('bob')],
  );
  assert.deepEqual(bobAuthorityAfter.rows, bobAuthorityBefore.rows, 'enabling organizational responsibility does not change platform roles or authority generation');
  registry = await request(app.base, route);
  const enabledRegistryRow = registry.data.proposals.find((proposal) => proposal.actorId === 'actor-founder');
  assert.equal(enabledRegistryRow.status, 'enabled');
  assert.ok(enabledRegistryRow.eligibilityStatus.includes('eligible'));
  assert.equal(Object.hasOwn(enabledRegistryRow, 'targetPrincipal'), false);
  const agentEnablePayload = { actorId: agentPayload.actorId, roleId: agentPayload.roleId, blueprintVersion: 1 };
  await app.persistence.query("update orgward.oidc_principals set actor_type='human' where tenant_id='tenant-a' and principal=$1", [principal('servicebot')]);
  const changedType = await enable('alice', 'actor-binding-enable-type-change', agentEnablePayload, project.version, 409);
  assert.equal(changedType.error.code, 'ACTOR_BINDING_TYPE_MISMATCH');
  await app.persistence.query("update orgward.oidc_principals set actor_type='workload', authz_generation=authz_generation+1 where tenant_id='tenant-a' and principal=$1", [principal('servicebot')]);
  const changedAuthority = await enable('alice', 'actor-binding-enable-authz-change', agentEnablePayload, project.version, 409);
  assert.equal(changedAuthority.error.code, 'ACTOR_BINDING_TARGET_GENERATION_STALE');
  await app.store.revokeMember({ tenantId: 'tenant-a', projectId, actor: principal('alice'), actorAuthzGeneration: 1, principal: principal('servicebot') });
  await app.store.grantMember({ tenantId: 'tenant-a', projectId, actor: principal('alice'), actorAuthzGeneration: 1, principal: principal('servicebot'), access: 'editor' });
  const changedMembership = await enable('alice', 'actor-binding-enable-membership-change', agentEnablePayload, project.version, 409);
  assert.equal(changedMembership.error.code, 'ACTOR_BINDING_TARGET_GENERATION_STALE');
  const storedProject = await app.persistence.query(`
    select state::text from orgward.aggregates where tenant_id = 'tenant-a' and aggregate_id = $1 and aggregate_kind = 'project'
  `, [projectId]);
  assert.equal(storedProject.rows[0].state.includes(principal('bob')), false, 'target identity stays out of project JSON');
  assert.equal(storedProject.rows[0].state.includes(principal('servicebot')), false, 'workload identity stays out of project JSON');
  await app.persistence.query(`
    update orgward.project_memberships set revoked_at = now(), revoked_by = $3
    where tenant_id = 'tenant-a' and project_id = $1 and principal = $2
  `, [projectId, principal('bob'), principal('alice')]);
  registry = await request(app.base, route);
  const noLongerEligibleEnabled = registry.data.proposals.find((proposal) => proposal.actorId === 'actor-founder');
  assert.equal(noLongerEligibleEnabled.status, 'enabled');
  assert.ok(noLongerEligibleEnabled.eligibilityStatus.includes('no_longer_eligible'));
  await app.store.grantMember({ tenantId: 'tenant-a', projectId, actor: principal('alice'), actorAuthzGeneration: 1, principal: principal('bob'), access: 'editor' });
  registry = await request(app.base, route);
  assert.equal(registry.data.proposals.find((proposal) => proposal.actorId === 'actor-founder').targetStatus, 'no_longer_eligible', 'a revoke and regrant does not silently restore an older proposal');
  const newBlueprint = await request(app.base, `/api/v1/projects/${projectId}/blueprint/edits`, {
    method: 'POST', body: command('actor-binding-new-blueprint', {
      objectId: 'capability-delivery', name: 'Offer delivery revised', detail: 'Deliver and record the promised result.', ownerRoleName: 'Operations owner',
    }, project.version),
  });
  project = newBlueprint.data;
  registry = await request(app.base, route);
  assert.equal(registry.data.currentBlueprintVersion, 2);
  assert.ok(registry.data.proposals.every((proposal) => proposal.blueprintVersion === 1 && proposal.currentBlueprintVersion === 2), 'proposals remain pinned and are not copied to a new blueprint version');
  const oldEnabled = registry.data.proposals.find((proposal) => proposal.actorId === 'actor-founder');
  assert.ok(oldEnabled.eligibilityStatus.includes('stale_blueprint'));
  const oldProposalEnable = await enable('alice', 'actor-binding-enable-old-blueprint', agentEnablePayload, project.version, 409);
  assert.equal(oldProposalEnable.error.code, 'BLUEPRINT_VERSION_STALE');
  await close(app);
  app = await start(postgres.databaseUrl, { oidcAuthenticator });
  registry = await request(app.base, route);
  assert.equal(registry.data.proposals.length, 2, 'restricted proposals persist across restart');
  const normalProject = await request(app.base, `/api/v1/projects/${projectId}`);
  const normalJson = JSON.stringify(normalProject.data);
  assert.equal(normalJson.includes(principal('bob')), false);
  assert.equal(normalJson.includes(principal('servicebot')), false);
  const recorded = await app.persistence.query(`
    select event_type, actor, event from orgward.audit_log where tenant_id = 'tenant-a' and aggregate_id = $1 and event_type = 'BlueprintActorBindingProposed'
  `, [projectId]);
  assert.equal(recorded.rows.length, 2);
  assert.equal(recorded.rows[0].actor, principal('alice'));
  assert.equal(JSON.stringify(recorded.rows).includes(principal('bob')), false);
  assert.equal(JSON.stringify(recorded.rows).includes('Hidden assignment recipient'), false);
  const enabledEvents = await app.persistence.query(`
    select event_type, actor, event from orgward.audit_log where tenant_id='tenant-a' and aggregate_id=$1 and event_type='BlueprintActorBindingEnabled'
  `, [projectId]);
  assert.equal(enabledEvents.rows.length, 1);
  assert.equal(enabledEvents.rows[0].actor, principal('alice'));
  assert.equal(JSON.stringify(enabledEvents.rows).includes(principal('bob')), false);
  assert.equal(JSON.stringify(enabledEvents.rows).includes('Hidden assignment recipient'), false);
});

test('legacy preview and import preserve valid IDs and hashes, quarantine invalid data, and resume idempotently', async (t) => {
  const postgres = await startPostgres();
  const legacyRoot = await mkdtemp(path.join(tmpdir(), 'orgward-legacy-import-'));
  const directories = {
    projects: path.join(legacyRoot, 'projects'),
    changeCases: path.join(legacyRoot, 'sdlc'),
    executionRuns: path.join(legacyRoot, 'execution-runs'),
  };
  await Promise.all(Object.values(directories).map((directory) => mkdir(directory, { recursive: true })));
  const project = { ...createProject('Imported studio'), tenantId: 'tenant-a', version: 1, events: [], commandRecords: {} };
  const changeCase = createChangeCase({ tenantId: 'tenant-a', mode: 'golden' });
  const run = createExecutionRun({
    tenantId: 'tenant-a', requestedBy: 'operator-a', title: 'Imported run', objective: 'Preserve this run.',
    profile: { id: 'legacy-profile', label: 'Legacy profile', kind: 'command', version: '1.0.0' },
  });
  const sources = [
    [path.join(directories.projects, `${project.id}.json`), project],
    [path.join(directories.changeCases, `${changeCase.id}.json`), changeCase],
    [path.join(directories.executionRuns, `${run.id}.json`), run],
  ];
  for (const [file, value] of sources) await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
  await writeFile(path.join(directories.projects, 'project-00000000-0000-0000-0000-000000000000.json'), '{broken');

  let importResponseLost = false;
  let app = await start(postgres.databaseUrl, {
    legacyDirectories: directories,
    persistenceFaults: {
      afterCommit({ commandId }) {
        if (!importResponseLost && commandId === 'legacy-apply') {
          importResponseLost = true;
          throw new Error('Injected import response loss.');
        }
      },
    },
  });
  t.after(async () => {
    if (app) await close(app);
    await postgres.close();
    await rm(legacyRoot, { recursive: true, force: true });
  });
  const invalid = await request(app.base, '/api/v1/persistence/imports', {
    method: 'POST', body: command('legacy-invalid', { mode: 'overwrite' }),
  }, 400);
  assert.equal(invalid.error.code, 'INVALID_COMMAND');
  assert.deepEqual(invalid.error.fieldErrors, [{ field: 'payload.mode', message: 'Choose dry-run or apply.' }]);
  const unsupported = await request(app.base, '/api/v1/persistence/imports', {
    method: 'POST', body: command('legacy-unsupported', { mode: 'apply', overwrite: true }),
  }, 400);
  assert.deepEqual(unsupported.error.fieldErrors, [{ field: 'payload.overwrite', message: 'This field is not accepted.' }]);
  const denied = await request(app.base, '/api/v1/persistence/imports', {
    method: 'POST', headers: { authorization: 'Bearer readonly' }, body: command('legacy-denied', { mode: 'apply' }),
  }, 403);
  assert.equal(denied.error.code, 'ACTION_FORBIDDEN');
  assert.equal((await postgres.query('select count(*)::int count from orgward.legacy_imports')).rows[0].count, 0);
  const preview = await request(app.base, '/api/v1/persistence/imports', {
    method: 'POST', body: command('legacy-preview', { mode: 'dry-run' }),
  });
  assert.deepEqual(preview.data.counts, { discovered: 4, importable: 3, unchanged: 0, quarantined: 1 });
  assert.equal((await postgres.query('select count(*)::int count from orgward.aggregates')).rows[0].count, 0);

  await request(app.base, '/api/v1/persistence/imports', {
    method: 'POST', body: command('legacy-apply', { mode: 'apply' }),
  }, 503);
  assert.equal((await postgres.query('select count(*)::int count from orgward.aggregates')).rows[0].count, 3);
  assert.equal((await postgres.query('select count(*)::int count from orgward.aggregate_project_scopes')).rows[0].count, 0);
  const projectSource = await process.getBuiltinModule('node:fs/promises').readFile(sources[0][0]);
  const mapping = await postgres.query('select source_hash from orgward.legacy_import_items where aggregate_id = $1', [project.id]);
  assert.equal(mapping.rows[0].source_hash, createHash('sha256').update(projectSource).digest('hex'));
  await close(app);
  app = null;

  app = await start(postgres.databaseUrl, { legacyDirectories: directories });
  await request(app.base, `/api/v1/projects/${project.id}`, {}, 404);
  assert.deepEqual((await request(app.base, '/api/sdlc/cases')).cases, []);
  assert.deepEqual((await request(app.base, '/api/execution/runs')).runs, []);
  const importedKinds = await postgres.query(
    'select aggregate_kind, count(*)::int count from orgward.aggregates where tenant_id = $1 group by aggregate_kind order by aggregate_kind',
    ['tenant-a'],
  );
  assert.deepEqual(importedKinds.rows, [
    { aggregate_kind: 'change_case', count: 1 },
    { aggregate_kind: 'execution_run', count: 1 },
    { aggregate_kind: 'project', count: 1 },
  ]);
  const replay = await request(app.base, '/api/v1/persistence/imports', {
    method: 'POST', body: command('legacy-apply', { mode: 'apply' }),
  });
  assert.equal(replay.meta.replayed, true);
  assert.deepEqual(replay.data.counts, { discovered: 4, imported: 3, unchanged: 0, quarantined: 1 });
  assert.deepEqual(replay.data.items.filter((item) => item.status === 'imported').map((item) => item.id).sort(), [changeCase.id, project.id, run.id].sort());
  assert.equal((await postgres.query('select count(*)::int count from orgward.aggregates')).rows[0].count, 3);
  assert.equal((await postgres.query('select count(*)::int count from orgward.aggregate_project_scopes')).rows[0].count, 0);
  const postImportPreview = await request(app.base, '/api/v1/persistence/imports', {
    method: 'POST', body: command('legacy-preview-after', { mode: 'dry-run' }),
  });
  assert.deepEqual(postImportPreview.data.counts, { discovered: 4, importable: 0, unchanged: 3, quarantined: 1 });

  const tenantBProject = { ...project, tenantId: 'tenant-b', name: 'Tenant B imported studio' };
  await writeFile(sources[0][0], `${JSON.stringify(tenantBProject, null, 2)}\n`);
  const tenantBImport = await request(app.base, '/api/v1/persistence/imports', {
    method: 'POST', headers: { authorization: 'Bearer tenant-b-admin' }, body: command('legacy-tenant-b', { mode: 'apply' }),
  });
  assert.equal(tenantBImport.data.counts.imported, 1);
  await request(app.base, `/api/v1/projects/${project.id}`, { headers: { authorization: 'Bearer tenant-b-admin' } }, 404);
  await request(app.base, `/api/v1/projects/${project.id}`, {}, 404);
  assert.deepEqual((await request(app.base, '/api/sdlc/cases')).cases, []);
  assert.deepEqual((await request(app.base, '/api/execution/runs')).runs, []);
  const importedProjects = await postgres.query(
    'select tenant_id, state->>\'name\' name from orgward.aggregates where aggregate_kind = $1 and aggregate_id = $2 order by tenant_id',
    ['project', project.id],
  );
  assert.deepEqual(importedProjects.rows, [
    { tenant_id: 'tenant-a', name: 'Imported studio' },
    { tenant_id: 'tenant-b', name: 'Tenant B imported studio' },
  ]);
  assert.equal((await postgres.query('select count(*)::int count from orgward.aggregates where aggregate_kind = $1 and aggregate_id = $2', ['project', project.id])).rows[0].count, 2);
});

test('legacy import preview and apply revalidate tenant-admin authority after request authentication', async (t) => {
  const postgres = await startPostgres();
  const legacyRoot = await mkdtemp(path.join(tmpdir(), 'orgward-import-authority-'));
  const projectsDirectory = path.join(legacyRoot, 'projects');
  await mkdir(projectsDirectory, { recursive: true });
  const project = { ...createProject('Import authorization boundary'), tenantId: 'tenant-a', version: 1, events: [], commandRecords: {} };
  await writeFile(path.join(projectsDirectory, `${project.id}.json`), `${JSON.stringify(project, null, 2)}\n`);
  const app = await start(postgres.databaseUrl, { legacyDirectories: { projects: projectsDirectory } });
  const as = (subject) => ({ headers: { authorization: `Bearer ${subject}` } });
  const principal = (subject) => `oidc:${createHash('sha256').update(`https://persistence-identity.example.test\n${subject}`).digest('hex')}`;
  t.after(async () => { await close(app); await postgres.close(); await rm(legacyRoot, { recursive: true, force: true }); });

  const importRoles = ['tenant-admin', 'workspace-read', 'workspace-write', 'execution-approver', 'release-approver', 'control-owner'];
  for (const mode of ['dry-run', 'apply']) {
    const originalScan = app.importer.scan.bind(app.importer);
    let announceScan;
    const enteredScan = new Promise((resolve) => { announceScan = resolve; });
    let resumeScan;
    const scanGate = new Promise((resolve) => { resumeScan = resolve; });
    app.importer.scan = async (...args) => {
      announceScan();
      await scanGate;
      return originalScan(...args);
    };
    const pendingImport = fetch(`${app.base}/api/v1/persistence/imports`, {
      ...as('alice'), method: 'POST', body: command(`legacy-${mode}-authority-race`, { mode }),
    });
    await enteredScan;
    const beforeDemotion = await authzGeneration(app, 'alice');
    const demoted = await request(app.base, `/api/v1/identities/${principal('alice')}/roles`, {
      ...as('bob'), method: 'PUT',
      body: JSON.stringify({ roles: ['workspace-read', 'workspace-write'], expectedAuthzGeneration: beforeDemotion, reason: `Revoke import authority during ${mode}.` }),
    });
    assert.deepEqual(demoted.data.roles, ['workspace-read', 'workspace-write']);
    resumeScan();
    const denied = await pendingImport;
    app.importer.scan = originalScan;
    assert.equal(denied.status, 403, await denied.clone().text());
    assert.equal((await denied.json()).error.code, 'ACTION_FORBIDDEN');
    assert.equal((await postgres.query('select count(*)::int count from orgward.aggregates')).rows[0].count, 0);
    assert.equal((await postgres.query('select count(*)::int count from orgward.legacy_imports')).rows[0].count, 0);

    const currentGeneration = await authzGeneration(app, 'alice');
    await request(app.base, `/api/v1/identities/${principal('alice')}/roles`, {
      ...as('bob'), method: 'PUT',
      body: JSON.stringify({ roles: importRoles, expectedAuthzGeneration: currentGeneration, reason: `Restore import authority after ${mode} denial.` }),
    });
  }
});

test('database corruption fails closed and retention removes only delivered expired outbox rows', async (t) => {
  const postgres = await startPostgres();
  const app = await start(postgres.databaseUrl);
  t.after(async () => { await close(app); await postgres.close(); });
  const createCommand = command('pg-create-corruption', { name: 'Integrity studio' });
  const created = await request(app.base, '/api/v1/projects', {
    method: 'POST', body: createCommand,
  }, 201);
  const other = await request(app.base, '/api/v1/projects', {
    method: 'POST', body: command('pg-create-other', { name: 'Other studio' }),
  }, 201);
  await postgres.query('update orgward.command_results set aggregate_id = $1 where tenant_id = $2 and command_id = $3', [other.data.id, 'tenant-a', 'pg-create-corruption']);
  const corruptReceipt = await request(app.base, '/api/v1/projects', {
    method: 'POST', body: createCommand,
  }, 503);
  assert.equal(corruptReceipt.error.code, 'PERSISTENCE_INTEGRITY');
  await postgres.query("update orgward.aggregates set state_hash = repeat('0', 64) where aggregate_id = $1", [created.data.id]);
  const status = await request(app.base, '/api/v1/foundation');
  assert.equal(status.data.sources.projects.status, 'unavailable');
  const corrupt = await request(app.base, `/api/v1/projects/${created.data.id}`, {}, 503);
  assert.equal(corrupt.error.code, 'PERSISTENCE_INTEGRITY');

  await postgres.query("update orgward.outbox set retain_until = now() - interval '1 day'");
  assert.equal((await app.persistence.applyRetention()).deletedOutbox, 0);
  await postgres.query('update orgward.outbox set published_at = now()');
  assert.equal((await app.persistence.applyRetention()).deletedOutbox, 2);
});

test('change cases and execution runs use PostgreSQL compare-and-swap state across restart', async (t) => {
  const postgres = await startPostgres();
  const workspace = await mkdtemp(path.join(tmpdir(), 'orgward-pg-execution-'));
  const profile = {
    id: 'pg-profile', label: 'PostgreSQL profile', kind: 'command', version: '1.0.0',
    executable: process.execPath, args: [], workspaceRoot: workspace,
  };
  let app = await start(postgres.databaseUrl, { executionProfiles: [profile] });
  t.after(async () => {
    if (app) await close(app);
    await postgres.close();
    await rm(workspace, { recursive: true, force: true });
  });

  const project = await request(app.base, '/api/v1/projects', {
    method: 'POST', body: command('pg-cas-project', { name: 'CAS project' }),
  }, 201);
  const changeCase = await request(app.base, '/api/sdlc/cases', {
    method: 'POST', body: JSON.stringify({ projectId: project.data.id, mode: 'golden' }),
  }, 201);
  const advances = await Promise.all([
    fetch(`${app.base}/api/sdlc/cases/${changeCase.id}/advance`, {
      method: 'POST', headers: tenantHeaders,
      body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'pg-case-a' }),
    }),
    fetch(`${app.base}/api/sdlc/cases/${changeCase.id}/advance`, {
      method: 'POST', headers: tenantHeaders,
      body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'pg-case-b' }),
    }),
  ]);
  assert.deepEqual(advances.map((response) => response.status).sort(), [200, 409]);
  const advanced = await request(app.base, `/api/sdlc/cases/${changeCase.id}`);
  assert.equal(advanced.version, 1);
  const runToCheckpoint = await request(app.base, `/api/sdlc/cases/${changeCase.id}/run`, {
    method: 'POST', body: JSON.stringify({ version: advanced.version, idempotencyKey: 'pg-case-run' }),
  });
  await request(app.base, `/api/sdlc/cases/${changeCase.id}/run`, {
    method: 'POST', body: JSON.stringify({ version: advanced.version, idempotencyKey: 'pg-case-run', note: 'changed retry' }),
  }, 409);
  const caseEvidence = await postgres.query(`
    select jsonb_array_length(state -> 'events') event_count,
      (select count(*)::int from orgward.outbox where tenant_id = 'tenant-a' and aggregate_kind = 'change_case' and aggregate_id = $1) outbox_count
    from orgward.aggregates where tenant_id = 'tenant-a' and aggregate_kind = 'change_case' and aggregate_id = $1
  `, [changeCase.id]);
  assert.equal(caseEvidence.rows[0].outbox_count, caseEvidence.rows[0].event_count);

  const run = await request(app.base, '/api/execution/runs', {
    method: 'POST', body: JSON.stringify({ projectId: project.data.id, profileId: profile.id, title: 'Durable run', objective: 'Survive restart.' }),
  }, 201);
  await request(app.base, '/api/v1/foundation', { headers: { authorization: 'Bearer bob' } });
  const bobPrincipal = `oidc:${createHash('sha256').update('https://persistence-identity.example.test\nbob').digest('hex')}`;
  await request(app.base, `/api/v1/projects/${project.data.id}/members`, {
    method: 'POST', body: JSON.stringify({ principal: bobPrincipal, access: 'editor' }),
  });
  const approved = await request(app.base, `/api/execution/runs/${run.id}/approve`, {
    method: 'POST', headers: { authorization: 'Bearer bob' }, body: JSON.stringify({ version: run.version }),
  });
  assert.equal(approved.status, 'APPROVED');
  await close(app);
  app = null;

  app = await start(postgres.databaseUrl, { executionProfiles: [profile] });
  assert.equal((await request(app.base, `/api/sdlc/cases/${changeCase.id}`)).version, runToCheckpoint.version);
  assert.equal((await request(app.base, `/api/execution/runs/${run.id}`)).status, 'APPROVED');
  const kinds = await postgres.query("select aggregate_kind, count(*)::int count from orgward.aggregates group by aggregate_kind order by aggregate_kind");
  assert.deepEqual(kinds.rows, [
    { aggregate_kind: 'change_case', count: 1 },
    { aggregate_kind: 'execution_run', count: 1 },
    { aggregate_kind: 'project', count: 1 },
  ]);
});

test('PostgreSQL revalidates authenticated SDLC release approval authority atomically and binds replay to its principal', async (t) => {
  const postgres = await startPostgres();
  const oidcAuthenticator = testOidcAuthenticator();
  const app = await start(postgres.databaseUrl, { oidcAuthenticator });
  const as = (subject) => ({ headers: { authorization: `Bearer ${subject}` } });
  const principal = (subject) => `oidc:${createHash('sha256').update(`https://persistence-identity.example.test\n${subject}`).digest('hex')}`;
  t.after(async () => { await close(app); await postgres.close(); });

  const project = await request(app.base, '/api/v1/projects', {
    ...as('alice'), method: 'POST', body: command('sdlc-release-project', { name: 'Governed release' }),
  }, 201);
  const changeCase = await request(app.base, '/api/sdlc/cases', {
    ...as('alice'), method: 'POST', body: JSON.stringify({ projectId: project.data.id, mode: 'golden' }),
  }, 201);
  const atApproval = await request(app.base, `/api/sdlc/cases/${changeCase.id}/run`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'sdlc-release-run' }),
  });
  assert.equal(atApproval.currentStage, 'S9');
  await request(app.base, '/api/v1/foundation', as('bob'));
  await request(app.base, '/api/v1/foundation', as('carol'));
  await request(app.base, `/api/v1/projects/${project.data.id}/members`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal('bob'), access: 'editor' }),
  });
  await request(app.base, `/api/v1/projects/${project.data.id}/members`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal('carol'), access: 'editor' }),
  });

  const underlyingSave = app.sdlcStore.saveForPrincipal.bind(app.sdlcStore);
  let announceSave;
  const enteredSave = new Promise((resolve) => { announceSave = resolve; });
  let resumeSave;
  const saveGate = new Promise((resolve) => { resumeSave = resolve; });
  app.sdlcStore.saveForPrincipal = async (state, options) => {
    if (options.approvalAuthority) { announceSave(); await saveGate; }
    return underlyingSave(state, options);
  };
  const approveBody = { version: atApproval.version, idempotencyKey: 'sdlc-release-approve' };
  const racedApproval = fetch(`${app.base}/api/sdlc/cases/${changeCase.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify(approveBody),
  });
  await enteredSave;
  await trustedGrantRoles(app, 'bob', ['workspace-read', 'workspace-write', 'execution-approver', 'release-approver', 'tenant-admin']);
  resumeSave();
  const deniedResponse = await racedApproval;
  const denied = await deniedResponse.json();
  assert.equal(deniedResponse.status, 403, JSON.stringify(denied));
  app.sdlcStore.saveForPrincipal = underlyingSave;
  const unchanged = await request(app.base, `/api/sdlc/cases/${changeCase.id}`, as('alice'));
  assert.equal(unchanged.currentStage, 'S9');
  assert.equal(unchanged.version, atApproval.version);
  assert.equal(unchanged.approvals.length, 0);
  assert.equal(unchanged.events.some((event) => event.type === 'ReleaseApprovalRecorded'), false);

  await trustedGrantRoles(app, 'bob', ['workspace-read', 'workspace-write', 'execution-approver', 'release-approver', 'control-owner', 'tenant-admin']);
  await trustedGrantRoles(app, 'bob', ['workspace-read', 'workspace-write', 'execution-approver', 'release-approver', 'control-owner', 'tenant-admin']);
  const approved = await request(app.base, `/api/sdlc/cases/${changeCase.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify(approveBody),
  });
  assert.equal(approved.approvals.length, 1);
  const approval = approved.approvals[0];
  assert.equal(approval.principal, principal('bob'));
  const bobIdentity = await postgres.query('select authz_generation from orgward.oidc_principals where tenant_id = $1 and principal = $2', ['tenant-a', principal('bob')]);
  assert.equal(approval.authorityGeneration, Number(bobIdentity.rows[0].authz_generation));
  assert.equal(approval.evidenceBundleRef, approved.artifacts.assurance.releaseEvidenceBundle.id);
  const approvalEvents = approved.events.filter((event) => event.type === 'ReleaseApprovalRecorded');
  assert.equal(approvalEvents.length, 1);

  const replay = await request(app.base, `/api/sdlc/cases/${changeCase.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify(approveBody),
  });
  assert.equal(replay.command.replayed, true);
  assert.equal(replay.version, approved.version);
  assert.equal(replay.approvals.length, 1);
  const crossPrincipal = await fetch(`${app.base}/api/sdlc/cases/${changeCase.id}/approve`, {
    ...as('carol'), method: 'POST', body: JSON.stringify(approveBody),
  });
  assert.equal(crossPrincipal.status, 409);
  const finalCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}`, as('alice'));
  assert.equal(finalCase.version, approved.version);
  assert.equal(finalCase.approvals.length, 1);
  assert.equal(finalCase.events.filter((event) => event.type === 'ReleaseApprovalRecorded').length, 1);
});

test('PostgreSQL requires human identities for SDLC release approval and legacy approval consumption', async (t) => {
  const postgres = await startPostgres();
  const oidcAuthenticator = testOidcAuthenticator();
  const app = await start(postgres.databaseUrl, { oidcAuthenticator });
  const as = (subject) => ({ headers: { authorization: `Bearer ${subject}` } });
  const principal = (subject) => `oidc:${createHash('sha256').update(`https://persistence-identity.example.test\n${subject}`).digest('hex')}`;
  t.after(async () => { await close(app); await postgres.close(); });

  const project = await request(app.base, '/api/v1/projects', {
    ...as('alice'), method: 'POST', body: command('workload-release-project', { name: 'Human-only release approval' }),
  }, 201);
  const changeCase = await request(app.base, '/api/sdlc/cases', {
    ...as('alice'), method: 'POST', body: JSON.stringify({ projectId: project.data.id, mode: 'golden' }),
  }, 201);
  const atApproval = await request(app.base, `/api/sdlc/cases/${changeCase.id}/run`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'workload-release-run' }),
  });
  assert.equal(atApproval.currentStage, 'S9');
  await request(app.base, '/api/v1/foundation', as('servicebot'));
  await request(app.base, `/api/v1/projects/${project.data.id}/members`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal('servicebot'), access: 'editor' }),
  });
  const workloadGrant = await postgres.query(`
    update orgward.oidc_principals
    set roles = ARRAY['workspace-read', 'workspace-write', 'release-approver', 'control-owner'],
        authz_generation = authz_generation + 1, updated_at = now()
    where tenant_id = 'tenant-a' and principal = $1 and actor_type = 'workload'
    returning authz_generation
  `, [principal('servicebot')]);
  assert.equal(workloadGrant.rowCount, 1);
  const workloadGeneration = Number(workloadGrant.rows[0].authz_generation);

  const directApproval = await fetch(`${app.base}/api/sdlc/cases/${changeCase.id}/approve`, {
    ...as('servicebot'), method: 'POST', body: JSON.stringify({ version: atApproval.version, idempotencyKey: 'workload-release-approve' }),
  });
  assert.equal(directApproval.status, 403, await directApproval.clone().text());
  let persisted = await request(app.base, `/api/sdlc/cases/${changeCase.id}`, as('alice'));
  assert.equal(persisted.version, atApproval.version);
  assert.equal(persisted.approvals.length, 0);

  const legacyState = await app.sdlcStore.get(changeCase.id, 'tenant-a');
  const approval = {
    id: 'legacy-workload-release-approval', action: 'release', status: 'APPROVED',
    principal: principal('servicebot'), roles: ['release-approver', 'control-owner'],
    authorityGeneration: workloadGeneration,
    evidenceBundleRef: legacyState.artifacts.assurance.releaseEvidenceBundle.id,
    approvedAt: new Date().toISOString(),
  };
  approval.contentHash = contentHash(approval);
  legacyState.approvals.push(approval);
  await postgres.query(`
    update orgward.aggregates set state = $3::jsonb, state_hash = $4
    where tenant_id = $1 and aggregate_kind = 'change_case' and aggregate_id = $2
  `, ['tenant-a', changeCase.id, JSON.stringify(legacyState), contentHash(legacyState)]);

  const legacyConsumption = await fetch(`${app.base}/api/sdlc/cases/${changeCase.id}/run`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: atApproval.version, idempotencyKey: 'workload-release-consume' }),
  });
  assert.equal(legacyConsumption.status, 403, await legacyConsumption.clone().text());
  persisted = await request(app.base, `/api/sdlc/cases/${changeCase.id}`, as('alice'));
  assert.equal(persisted.version, atApproval.version);
  assert.equal(persisted.approvals.length, 1);
  assert.equal(persisted.approvals[0].usedAt, undefined);
  assert.equal(persisted.artifacts.release, undefined);
});

test('PostgreSQL fences S9 release consumption against revoked approver authority and persists explicit reapproval', async (t) => {
  const postgres = await startPostgres();
  const oidcAuthenticator = testOidcAuthenticator();
  let app = await start(postgres.databaseUrl, { oidcAuthenticator });
  const as = (subject) => ({ headers: { authorization: `Bearer ${subject}` } });
  const principal = (subject) => `oidc:${createHash('sha256').update(`https://persistence-identity.example.test\n${subject}`).digest('hex')}`;
  t.after(async () => { if (app) await close(app); await postgres.close(); });

  const project = await request(app.base, '/api/v1/projects', {
    ...as('alice'), method: 'POST', body: command('sdlc-consume-project', { name: 'Approval consumption' }),
  }, 201);
  const changeCase = await request(app.base, '/api/sdlc/cases', {
    ...as('alice'), method: 'POST', body: JSON.stringify({ projectId: project.data.id, mode: 'golden' }),
  }, 201);
  const atApproval = await request(app.base, `/api/sdlc/cases/${changeCase.id}/run`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'sdlc-consume-run' }),
  });
  assert.equal(atApproval.currentStage, 'S9');
  await request(app.base, '/api/v1/foundation', as('bob'));
  await request(app.base, `/api/v1/projects/${project.data.id}/members`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal('bob'), access: 'editor' }),
  });
  const approved = await request(app.base, `/api/sdlc/cases/${changeCase.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: atApproval.version, idempotencyKey: 'sdlc-consume-approval-1' }),
  });
  const firstApproval = approved.approvals[0];
  const beforeRevocation = structuredClone(approved);

  await trustedGrantRoles(app, 'bob', ['workspace-read', 'workspace-write', 'execution-approver', 'release-approver', 'tenant-admin']);
  const revokedAttempt = await fetch(`${app.base}/api/sdlc/cases/${changeCase.id}/run`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: approved.version, idempotencyKey: 'sdlc-consume-revoked' }),
  });
  assert.equal(revokedAttempt.status, 403);
  let persisted = await request(app.base, `/api/sdlc/cases/${changeCase.id}`, as('alice'));
  assert.equal(persisted.version, beforeRevocation.version);
  assert.deepEqual(persisted.approvals, beforeRevocation.approvals);
  assert.deepEqual(persisted.events, beforeRevocation.events);
  assert.equal(persisted.artifacts.release, undefined);

  await trustedGrantRoles(app, 'bob', ['workspace-read', 'workspace-write', 'execution-approver', 'release-approver', 'control-owner', 'tenant-admin']);
  await trustedGrantRoles(app, 'bob', ['workspace-read', 'workspace-write', 'execution-approver', 'release-approver', 'control-owner', 'tenant-admin']);
  const legacyState = await app.sdlcStore.get(changeCase.id, 'tenant-a');
  delete legacyState.approvals[0].authorityGeneration;
  const { contentHash: _previousApprovalHash, ...legacyApprovalPayload } = legacyState.approvals[0];
  legacyState.approvals[0].contentHash = contentHash(legacyApprovalPayload);
  await postgres.query(`
    update orgward.aggregates set state = $3::jsonb, state_hash = $4
    where tenant_id = $1 and aggregate_kind = 'change_case' and aggregate_id = $2
  `, ['tenant-a', changeCase.id, JSON.stringify(legacyState), contentHash(legacyState)]);
  const legacyApprovalAttempt = await fetch(`${app.base}/api/sdlc/cases/${changeCase.id}/run`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: approved.version, idempotencyKey: 'sdlc-consume-old-generation' }),
  });
  assert.equal(legacyApprovalAttempt.status, 409);
  persisted = await request(app.base, `/api/sdlc/cases/${changeCase.id}`, as('alice'));
  assert.equal(persisted.version, approved.version);
  assert.equal(Object.hasOwn(persisted.approvals[0], 'authorityGeneration'), false);
  assert.equal(persisted.approvals[0].usedAt, null);
  assert.equal(persisted.artifacts.release, undefined);

  const reapproved = await request(app.base, `/api/sdlc/cases/${changeCase.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: persisted.version, idempotencyKey: 'sdlc-consume-approval-2' }),
  });
  assert.equal(reapproved.approvals.length, 2);
  assert.ok(reapproved.approvals[1].authorityGeneration > firstApproval.authorityGeneration);
  const released = await request(app.base, `/api/sdlc/cases/${changeCase.id}/run`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: reapproved.version, idempotencyKey: 'sdlc-consume-release' }),
  });
  assert.equal(released.artifacts.release.status, 'RELEASED');
  assert.equal(released.artifacts.release.externalEffect, false);
  assert.equal(released.artifacts.release.authorizedBy, reapproved.approvals[1].id);
  assert.equal(released.approvals[0].usedAt, null);
  assert.ok(released.approvals[1].usedAt);

  await close(app); app = null;
  app = await start(postgres.databaseUrl, { oidcAuthenticator });
  const restored = await request(app.base, `/api/sdlc/cases/${changeCase.id}`, as('alice'));
  assert.equal(restored.version, released.version);
  assert.equal(restored.artifacts.release.id, released.artifacts.release.id);
  assert.equal(restored.artifacts.release.externalEffect, false);
  assert.ok(restored.approvals[1].usedAt);
});

test('PostgreSQL enforces project scope for cases and runs, denies reader writes, and preserves revocation after restart', async (t) => {
  const postgres = await startPostgres();
  const profileRoot = await mkdtemp(path.join(tmpdir(), 'orgward-pg-scope-profile-'));
  const profile = {
    id: 'pg-scope-profile', label: 'Scoped profile', kind: 'test', version: '1.0.0',
    executable: process.execPath, args: [], workspaceRoot: profileRoot,
  };
  const oidcAuthenticator = testOidcAuthenticator();
  let app = await start(postgres.databaseUrl, { executionProfiles: [profile], oidcAuthenticator });
  const token = (subject) => `Bearer ${subject}`;
  const as = (subject) => ({ headers: { authorization: token(subject) } });
  const principal = (subject) => `oidc:${createHash('sha256').update(`https://persistence-identity.example.test\n${subject}`).digest('hex')}`;
  t.after(async () => {
    if (app) await close(app);
    await postgres.close();
    await rm(profileRoot, { recursive: true, force: true });
  });

  const aliceProject = await request(app.base, '/api/v1/projects', {
    ...as('alice'), method: 'POST', body: command('scope-pg-alice-project', { name: 'Alice project' }),
  }, 201);
  const bobProject = await request(app.base, '/api/v1/projects', {
    ...as('bob'), method: 'POST', body: command('scope-pg-bob-project', { name: 'Bob project' }),
  }, 201);
  const changeCase = await request(app.base, '/api/sdlc/cases', {
    ...as('alice'), method: 'POST', body: JSON.stringify({ projectId: aliceProject.data.id, mode: 'golden' }),
  }, 201);
  const run = await request(app.base, '/api/execution/runs', {
    ...as('alice'), method: 'POST', body: JSON.stringify({
      projectId: aliceProject.data.id, profileId: profile.id, title: 'Scoped PostgreSQL run', objective: 'Retain project ownership.',
    }),
  }, 201);

  assert.deepEqual((await request(app.base, '/api/sdlc/cases', as('bob'))).cases, []);
  assert.deepEqual((await request(app.base, '/api/execution/runs', as('bob'))).runs, []);
  await request(app.base, `/api/sdlc/cases/${changeCase.id}`, as('bob'), 404);
  await request(app.base, `/api/execution/runs/${run.id}`, as('bob'), 404);
  await request(app.base, '/api/sdlc/cases', {
    ...as('alice'), method: 'POST', body: JSON.stringify({ projectId: bobProject.data.id, mode: 'golden' }),
  }, 403);
  await request(app.base, '/api/execution/runs', {
    ...as('alice'), method: 'POST', body: JSON.stringify({
      projectId: bobProject.data.id, profileId: profile.id, title: 'Cross-project run', objective: 'Must be denied.',
    }),
  }, 403);

  await request(app.base, `/api/v1/projects/${aliceProject.data.id}/members`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal('bob'), access: 'reader' }),
  });

  const readAuthorityCases = [
    { path: '/api/sdlc/cases', method: 'listWithPrincipalAuthority', field: 'cases' },
    { path: `/api/sdlc/cases/${changeCase.id}`, method: 'withPrincipalAuthority', field: 'id' },
    { path: `/api/sdlc/cases/${changeCase.id}/traceability`, method: 'withPrincipalAuthority', field: 'traceability' },
  ];
  for (const { path, method, field } of readAuthorityCases) {
    await trustedGrantRoles(app, 'alice', ['workspace-read', 'workspace-write', 'tenant-admin']);
    const originalRead = app.sdlcStore[method].bind(app.sdlcStore);
    let readReached;
    let resumeRead;
    const readPaused = new Promise((resolve) => { readReached = resolve; });
    const readGate = new Promise((resolve) => { resumeRead = resolve; });
    app.sdlcStore[method] = async (options) => {
      if (options.principal === principal('alice')) {
        readReached();
        await readGate;
      }
      return originalRead(options);
    };
    const pendingRead = fetch(`${app.base}${path}`, as('alice'));
    await readPaused;
    await trustedGrantRoles(app, 'alice', ['workspace-read']);
    resumeRead();
    const staleRead = await pendingRead;
    assert.equal(staleRead.status, 409, `${path} must reject a stale authority generation`);
    const staleReadBody = await staleRead.json();
    assert.equal(staleReadBody[field], undefined, `${path} must not disclose data after authority changes`);
    app.sdlcStore[method] = originalRead;
  }
  await trustedGrantRoles(app, 'alice', ['workspace-read', 'workspace-write', 'tenant-admin']);

  await request(app.base, `/api/sdlc/cases/${changeCase.id}/advance`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'scope-reader-case-write' }),
  }, 404);
  await request(app.base, `/api/execution/runs/${run.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: run.version }),
  }, 404);
  assert.equal((await request(app.base, `/api/sdlc/cases/${changeCase.id}`, as('alice'))).version, changeCase.version);
  assert.equal((await request(app.base, `/api/execution/runs/${run.id}`, as('alice'))).status, 'AWAITING_APPROVAL');
  await request(app.base, `/api/v1/projects/${aliceProject.data.id}/members/${principal('bob')}/revoke`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({}),
  });
  await request(app.base, `/api/sdlc/cases/${changeCase.id}`, as('bob'), 404);
  await request(app.base, `/api/execution/runs/${run.id}`, as('bob'), 404);

  await close(app); app = null;
  app = await start(postgres.databaseUrl, { executionProfiles: [profile], oidcAuthenticator });
  assert.equal((await request(app.base, `/api/sdlc/cases/${changeCase.id}`, as('alice'))).projectId, aliceProject.data.id);
  assert.equal((await request(app.base, `/api/execution/runs/${run.id}`, as('alice'))).projectId, aliceProject.data.id);
  await request(app.base, `/api/sdlc/cases/${changeCase.id}`, as('bob'), 404);
  await request(app.base, `/api/execution/runs/${run.id}`, as('bob'), 404);
  const scopes = await postgres.query('select aggregate_kind, project_id from orgward.aggregate_project_scopes order by aggregate_kind');
  assert.deepEqual(scopes.rows, [
    { aggregate_kind: 'change_case', project_id: aliceProject.data.id },
    { aggregate_kind: 'execution_run', project_id: aliceProject.data.id },
  ]);
});

test('PostgreSQL project rosters are visible only to owners and editors', async (t) => {
  const postgres = await startPostgres();
  const oidcAuthenticator = testOidcAuthenticator();
  const app = await start(postgres.databaseUrl, { oidcAuthenticator });
  const as = (subject) => ({ headers: { authorization: `Bearer ${subject}` } });
  const principal = (subject) => `oidc:${createHash('sha256').update(`https://persistence-identity.example.test\n${subject}`).digest('hex')}`;
  t.after(async () => { await close(app); await postgres.close(); });

  const project = await request(app.base, '/api/v1/projects', {
    ...as('alice'), method: 'POST', body: command('pg-roster-project', { name: 'Roster privacy' }),
  }, 201);
  await request(app.base, '/api/v1/foundation', as('bob'));
  await request(app.base, '/api/v1/foundation', as('carol'));
  await request(app.base, `/api/v1/projects/${project.data.id}/members`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal('bob'), access: 'reader' }),
  });
  await request(app.base, `/api/v1/projects/${project.data.id}/members`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal('carol'), access: 'editor' }),
  });

  const ownerRoster = await request(app.base, `/api/v1/projects/${project.data.id}/members`, as('alice'));
  assert.equal(ownerRoster.data.length, 3);
  const editorRoster = await request(app.base, `/api/v1/projects/${project.data.id}/members`, as('carol'));
  assert.deepEqual(editorRoster.data.map(({ principal: member }) => member), ownerRoster.data.map(({ principal: member }) => member));
  await request(app.base, `/api/v1/projects/${project.data.id}/members`, as('bob'), 404);
  await request(app.base, `/api/v1/projects/${project.data.id}/members`, as('dave'), 404);
  await request(app.base, `/api/v1/projects/${project.data.id}/members`, as('tenant-b-admin'), 404);

  const originalRosterRead = app.store.listMembers.bind(app.store);
  let rosterReadReached;
  let resumeRosterRead;
  const rosterReadPaused = new Promise((resolve) => { rosterReadReached = resolve; });
  const rosterReadGate = new Promise((resolve) => { resumeRosterRead = resolve; });
  app.store.listMembers = async (...args) => {
    if (args[2] === principal('alice')) {
      rosterReadReached();
      await rosterReadGate;
    }
    return originalRosterRead(...args);
  };
  const pendingStaleRoster = fetch(`${app.base}/api/v1/projects/${project.data.id}/members`, as('alice'));
  await rosterReadPaused;
  await trustedGrantRoles(app, 'alice', ['workspace-read']);
  resumeRosterRead();
  const staleRoster = await pendingStaleRoster;
  assert.equal(staleRoster.status, 409);
  const staleRosterBody = await staleRoster.json();
  assert.equal(staleRosterBody.error.code, 'AUTHORITY_GENERATION_STALE');
  assert.equal(staleRosterBody.data, undefined);
  app.store.listMembers = originalRosterRead;
});

test('PostgreSQL scopes OIDC principal roles, sessions, projects, and revocation by tenant', async (t) => {
  const postgres = await startPostgres();
  const oidcAuthenticator = testOidcAuthenticator();
  let app = await start(postgres.databaseUrl, { oidcAuthenticator });
  const token = (subject) => `Bearer ${subject}`;
  const as = (subject) => ({ headers: { authorization: token(subject) } });
  const principal = (subject) => `oidc:${createHash('sha256').update(`https://persistence-identity.example.test\n${subject}`).digest('hex')}`;
  t.after(async () => {
    if (app) await close(app);
    await postgres.close();
  });

  const [sharedA, sharedB] = await Promise.all([
    request(app.base, '/api/v1/projects', {
      ...as('shared-user'), method: 'POST', body: command('shared-first-login-a', { name: 'Concurrent tenant A' }),
    }, 201),
    request(app.base, '/api/v1/projects', {
      ...as('shared-user@tenant-b'), method: 'POST', body: command('shared-first-login-b', { name: 'Concurrent tenant B' }),
    }, 201),
  ]);
  assert.equal(sharedA.data.createdBy, sharedB.data.createdBy);
  assert.deepEqual((await postgres.query(
    'select tenant_id from orgward.oidc_principals where principal = $1 order by tenant_id',
    [principal('shared-user')],
  )).rows, [{ tenant_id: 'tenant-a' }, { tenant_id: 'tenant-b' }]);

  const projectA = await request(app.base, '/api/v1/projects', {
    ...as('alice'), method: 'POST', body: command('alice-project-tenant-a', { name: 'Alice tenant A' }),
  }, 201);
  const projectB = await request(app.base, '/api/v1/projects', {
    ...as('alice@tenant-b'), method: 'POST', body: command('alice-project-tenant-b', { name: 'Alice tenant B' }),
  }, 201);
  assert.equal(projectA.data.createdBy, projectB.data.createdBy);
  await request(app.base, `/api/v1/projects/${projectA.data.id}`, as('alice@tenant-b'), 404);
  await request(app.base, `/api/v1/projects/${projectB.data.id}`, as('alice'), 404);

  const sessionStore = new PostgresOidcSessionStore(app.persistence);
  const aliceA = await oidcAuthenticator.authenticate({ headers: { authorization: token('alice') } });
  const aliceB = await oidcAuthenticator.authenticate({ headers: { authorization: token('alice@tenant-b') } });
  const aliceSessionA = 'C'.repeat(43);
  const aliceSessionB = 'D'.repeat(43);
  await sessionStore.create(aliceSessionA, aliceA, aliceA.expiresAt);
  await sessionStore.create(aliceSessionB, aliceB, aliceB.expiresAt);

  await trustedGrantRoles(app, 'alice', ['workspace-read'], 'tenant-b');
  const readerProjects = await request(app.base, '/api/v1/projects', as('alice@tenant-b-reader'));
  assert.deepEqual(readerProjects.data.map((project) => project.id).sort(), [projectB.data.id].sort());
  await request(app.base, '/api/v1/projects', {
    ...as('alice@tenant-b-reader'), method: 'POST',
    body: command('tenant-b-reader-create', { name: 'Reader cannot create' }),
  }, 403);
  const retainedProjectA = await request(app.base, '/api/v1/projects', {
    ...as('alice'), method: 'POST', body: command('tenant-a-write-retained', { name: 'Tenant A write retained' }),
  }, 201);

  await trustedGrantRoles(app, 'alice', []);
  await request(app.base, `/api/v1/projects/${projectA.data.id}`, as('alice'), 403);
  const cookieReadAfterRoleRemoval = await fetch(`${app.base}/api/v1/projects/${projectA.data.id}`, {
    headers: { cookie: `ow_session=${aliceSessionA}` },
  });
  assert.equal(cookieReadAfterRoleRemoval.status, 403);
  await trustedGrantRoles(app, 'alice', ['workspace-read', 'workspace-write', 'execution-approver', 'release-approver', 'control-owner', 'tenant-admin']);
  assert.equal((await request(app.base, `/api/v1/projects/${projectA.data.id}`, as('alice'))).data.id, projectA.data.id);

  await request(app.base, `/api/v1/identities/${principal('alice')}/revoke`, {
    ...as('tenant-b-admin'), method: 'POST', body: JSON.stringify({
      reason: 'Tenant B access removed.', expectedAuthzGeneration: await authzGeneration(app, 'alice', 'tenant-b'),
    }),
  }, 200);
  assert.equal(await sessionStore.get(aliceSessionB), null);
  assert.ok(await sessionStore.get(aliceSessionA));
  await request(app.base, '/api/v1/projects', as('alice@tenant-b'), 401);
  const retainedTenantAProjects = await request(app.base, '/api/v1/projects', as('alice'));
  assert.deepEqual(retainedTenantAProjects.data.map((project) => project.id).sort(), [projectA.data.id, retainedProjectA.data.id].sort());

  await close(app); app = null;
  app = await start(postgres.databaseUrl, { oidcAuthenticator });
  assert.equal((await request(app.base, `/api/v1/projects/${projectA.data.id}`, as('alice'))).data.id, projectA.data.id);
  await request(app.base, '/api/v1/projects', as('alice@tenant-b'), 401);
  const bindings = await postgres.query(
    'select tenant_id, status from orgward.oidc_principals where principal = $1 order by tenant_id',
    [principal('alice')],
  );
  assert.deepEqual(bindings.rows, [
    { tenant_id: 'tenant-a', status: 'active' },
    { tenant_id: 'tenant-b', status: 'revoked' },
  ]);
});

test('PostgreSQL browser session role disclosure is serialized with concurrent authority changes', async (t) => {
  const postgres = await startPostgres();
  const oidcAuthenticator = testOidcAuthenticator();
  const app = await start(postgres.databaseUrl, { oidcAuthenticator });
  t.after(async () => { await close(app); await postgres.close(); });

  const alicePrincipal = `oidc:${createHash('sha256').update('https://persistence-identity.example.test\nalice').digest('hex')}`;
  const sessionId = 'S'.repeat(43);
  const aliceIdentity = await oidcAuthenticator.authenticate({ headers: { authorization: 'Bearer alice' } });
  await app.sessionStore.create(sessionId, aliceIdentity, aliceIdentity.expiresAt);

  const originalGetWithAuthority = app.sessionStore.getWithAuthority.bind(app.sessionStore);
  let sessionReadReached;
  let resumeSessionRead;
  const sessionReadPaused = new Promise((resolve) => { sessionReadReached = resolve; });
  const sessionReadGate = new Promise((resolve) => { resumeSessionRead = resolve; });
  app.sessionStore.getWithAuthority = (id, options = {}) => originalGetWithAuthority(id, {
    ...options,
    operation: async (identity) => {
      if (identity?.principal === alicePrincipal) {
        sessionReadReached();
        await sessionReadGate;
      }
      return options.operation(identity);
    },
  });

  const pendingSessionRead = fetch(`${app.base}/auth/session`, { headers: { cookie: `ow_session=${sessionId}` } });
  await sessionReadPaused;
  const pendingRoleRemoval = fetch(`${app.base}/api/v1/identities/${alicePrincipal}/roles`, {
    method: 'PUT', headers: { ...tenantHeaders, authorization: 'Bearer bob' },
    body: JSON.stringify({
      roles: ['workspace-read', 'workspace-write'],
      expectedAuthzGeneration: await authzGeneration(app, 'alice'),
      reason: 'Remove tenant administration during browser-session disclosure.',
    }),
  });
  const roleRemovalState = await Promise.race([
    pendingRoleRemoval.then(() => 'completed'),
    new Promise((resolve) => setTimeout(() => resolve('waiting_for_session_read'), 50)),
  ]);
  assert.equal(roleRemovalState, 'waiting_for_session_read', 'role removal must wait for session data delivery to release its authority lock');

  resumeSessionRead();
  const inFlightResponse = await pendingSessionRead;
  assert.equal(inFlightResponse.status, 200);
  const inFlightIdentity = await inFlightResponse.json();
  assert.equal(inFlightIdentity.principal, alicePrincipal);
  assert.ok(inFlightIdentity.roles.includes('tenant-admin'));
  const roleRemovalResponse = await pendingRoleRemoval;
  assert.equal(roleRemovalResponse.status, 200);

  const afterRemoval = await fetch(`${app.base}/auth/session`, { headers: { cookie: `ow_session=${sessionId}` } });
  assert.equal(afterRemoval.status, 200);
  const currentIdentity = await afterRemoval.json();
  assert.equal(currentIdentity.principal, alicePrincipal);
  assert.equal(currentIdentity.roles.includes('tenant-admin'), false);
});

test('PostgreSQL bearer and session binding never changes persisted local roles from token claims', async (t) => {
  const postgres = await startPostgres();
  const oidcAuthenticator = testOidcAuthenticator();
  const profileRoot = await mkdtemp(path.join(tmpdir(), 'orgward-oidc-role-lease-'));
  const profile = { id: 'oidc-role-lease', label: 'OIDC role lease', kind: 'test', version: '1.0.0', executable: process.execPath, args: [], workspaceRoot: profileRoot };
  const app = await start(postgres.databaseUrl, { oidcAuthenticator, executionProfiles: [profile], testEnrollment: false });
  const as = (subject) => ({ headers: { authorization: `Bearer ${subject}` } });
  const principal = `oidc:${createHash('sha256').update('https://persistence-identity.example.test\nalice').digest('hex')}`;
  const sessions = new PostgresOidcSessionStore(app.persistence);
  t.after(async () => { await close(app); await postgres.close(); await rm(profileRoot, { recursive: true, force: true }); });

  let expandedIdentity = await oidcAuthenticator.authenticate({ headers: { authorization: 'Bearer alice' } });
  const bootstrapped = await sessions.resolve(expandedIdentity);
  assert.deepEqual(bootstrapped.roles, []);
  assert.deepEqual((await postgres.query(
    'select roles, authz_generation from orgward.oidc_principals where tenant_id = $1 and principal = $2',
    ['tenant-a', principal],
  )).rows, [{ roles: [], authz_generation: '1' }]);

  // This direct SQL update is the fixture's trusted enrollment step; the app has no role-grant path.
  const enrolledRoles = ['workspace-read', 'workspace-write', 'execution-approver', 'release-approver', 'control-owner', 'tenant-admin'];
  await postgres.query('update orgward.oidc_principals set roles = $3::text[] where tenant_id = $1 and principal = $2', ['tenant-a', principal, enrolledRoles]);
  oidcAuthenticator.setRoles('alice', enrolledRoles);
  expandedIdentity = await oidcAuthenticator.authenticate({ headers: { authorization: 'Bearer alice' } });
  const project = await request(app.base, '/api/v1/projects', {
    ...as('alice'), method: 'POST', body: command('oidc-role-local-grant-project', { name: 'Local role grant' }),
  }, 201);
  const run = await request(app.base, '/api/execution/runs', {
    ...as('alice'), method: 'POST', body: JSON.stringify({
      projectId: project.data.id, profileId: profile.id, title: 'Token claims do not cancel lease', objective: 'Use persisted roles only.',
    }),
  }, 201);
  await postgres.query(`
    insert into orgward.execution_worker_leases
      (tenant_id, run_id, project_id, principal, worker_id, lease_until)
    values ('tenant-a', $1, $2, $3, '00000000-0000-4000-8000-000000000001', now() + interval '5 minutes')
  `, [run.id, project.data.id, principal]);

  const sameSecondIat = 1_750_000_000;
  const reducedIdentity = { ...expandedIdentity, roles: ['workspace-read', 'execution-approver'], iat: sameSecondIat };
  const reduced = await sessions.resolve(reducedIdentity);
  assert.deepEqual(reduced.roles, enrolledRoles);
  assert.equal(reduced.authzGeneration, 1);
  assert.deepEqual((await postgres.query(
    'select cancel_reason from orgward.execution_worker_leases where tenant_id = $1 and run_id = $2',
    ['tenant-a', run.id],
  )).rows, [{ cancel_reason: null }]);

  const olderExpandedToken = { ...expandedIdentity, iat: sameSecondIat };
  assert.deepEqual((await sessions.resolve(olderExpandedToken)).roles, enrolledRoles);
  assert.equal((await sessions.resolve(olderExpandedToken)).authzGeneration, 1);
  const staleLoginSession = 'F'.repeat(43);
  await sessions.create(staleLoginSession, olderExpandedToken, Math.floor(Date.now() / 1000) + 300);
  assert.deepEqual((await sessions.get(staleLoginSession)).roles, enrolledRoles);
  assert.equal((await fetch(`${app.base}/api/v1/projects`, { headers: { cookie: `ow_session=${staleLoginSession}` } })).status, 200);

  const noRolesIdentity = { ...expandedIdentity, roles: [], iat: sameSecondIat };
  const noRoles = await sessions.resolve(noRolesIdentity);
  assert.deepEqual(noRoles.roles, enrolledRoles);
  assert.equal(noRoles.authzGeneration, 1);
  assert.equal((await fetch(`${app.base}/api/v1/projects`, { headers: { cookie: `ow_session=${staleLoginSession}` } })).status, 200);
  assert.deepEqual((await sessions.get(staleLoginSession)).roles, enrolledRoles);
});

test('PostgreSQL identity bootstrap and tenant-admin role lifecycle are exact, local, and fenced', async (t) => {
  const postgres = await startPostgres();
  const oidcAuthenticator = testOidcAuthenticator();
  const profileRoot = await mkdtemp(path.join(tmpdir(), 'orgward-human-approval-'));
  const profile = {
    id: 'human-approval-profile', label: 'Human approval profile', kind: 'test', version: '1.0.0',
    executable: process.execPath, args: ['-e', "require('node:fs').writeFileSync('started.txt', 'started')"],
    workspaceRoot: profileRoot, timeoutMs: 2_000,
  };
  const issuer = 'https://persistence-identity.example.test';
  const bootstrapPrincipals = [
    { issuer, subject: 'alice', tenantId: 'tenant-a' },
    { issuer, subject: 'bob', tenantId: 'tenant-a' },
    { issuer, subject: 'servicebot', tenantId: 'tenant-a' },
  ];
  let app = await start(postgres.databaseUrl, { oidcAuthenticator, oidcBootstrapPrincipals: bootstrapPrincipals, executionProfiles: [profile], testEnrollment: false });
  const token = (subject) => `Bearer ${subject}`;
  const as = (subject) => ({ headers: { authorization: token(subject) } });
  const principal = (subject) => `oidc:${createHash('sha256').update(`${issuer}\n${subject}`).digest('hex')}`;
  const sessions = app.sessionStore;
  t.after(async () => { if (app) await close(app); await postgres.close(); await rm(profileRoot, { recursive: true, force: true }); });

  const aliceIdentity = await oidcAuthenticator.authenticate(as('alice'));
  const concurrentBootstrap = await Promise.all([sessions.resolve(aliceIdentity), sessions.resolve(aliceIdentity)]);
  const baseAdminRoles = ['tenant-admin', 'workspace-read', 'workspace-write'];
  assert.deepEqual(concurrentBootstrap[0].roles, baseAdminRoles);
  assert.deepEqual(concurrentBootstrap[1].roles, baseAdminRoles);
  const bootstrapAudit = await postgres.query(`
    select count(*)::int count from orgward.oidc_principal_events
    where tenant_id = 'tenant-a' and principal = $1 and event_type = 'PrincipalBootstrapped'
  `, [principal('alice')]);
  assert.equal(bootstrapAudit.rows[0].count, 1);

  const bobIdentity = await oidcAuthenticator.authenticate(as('bob'));
  assert.deepEqual((await sessions.resolve(bobIdentity)).roles, baseAdminRoles);
  for (const [subject, tenantId] of [['carol', 'tenant-a'], ['alice', 'tenant-b'], ['servicebot', 'tenant-a']]) {
    const verified = await oidcAuthenticator.authenticate(as(subject === 'alice' ? 'alice@tenant-b' : subject));
    const resolved = await sessions.resolve(verified);
    assert.deepEqual(resolved.roles, [], `${subject} in ${tenantId} must not match the exact bootstrap tuple`);
  }
  assert.equal((await postgres.query('select count(*)::int count from orgward.oidc_bootstrap_grants')).rows[0].count, 2);

  await request(app.base, '/api/v1/projects', as('carol'), 403);
  const listed = await request(app.base, '/api/v1/identities', as('alice'));
  const aliceAdminRecord = listed.data.find((entry) => entry.principal === principal('alice'));
  assert.ok(aliceAdminRecord);
  const originalAdminDirectoryRead = sessions.listPrincipalsForAdmin.bind(sessions);
  let adminDirectoryReadReached;
  let resumeAdminDirectoryRead;
  const adminDirectoryReadPaused = new Promise((resolve) => { adminDirectoryReadReached = resolve; });
  const adminDirectoryReadGate = new Promise((resolve) => { resumeAdminDirectoryRead = resolve; });
  sessions.listPrincipalsForAdmin = async (options) => {
    if (options.actor === principal('alice')) {
      adminDirectoryReadReached();
      await adminDirectoryReadGate;
    }
    return originalAdminDirectoryRead(options);
  };
  const pendingIdentityDirectory = fetch(`${app.base}/api/v1/identities`, as('alice'));
  await adminDirectoryReadPaused;
  await request(app.base, `/api/v1/identities/${principal('alice')}/roles`, {
    method: 'PUT', headers: { authorization: token('bob') },
    body: JSON.stringify({
      roles: ['workspace-read', 'workspace-write'], expectedAuthzGeneration: aliceAdminRecord.authzGeneration,
      reason: 'Remove tenant-admin authority during an identity-directory read.',
    }),
  });
  resumeAdminDirectoryRead();
  const staleIdentityDirectory = await pendingIdentityDirectory;
  assert.equal(staleIdentityDirectory.status, 403);
  const staleIdentityBody = await staleIdentityDirectory.json();
  assert.equal(staleIdentityBody.error.code, 'ACTION_FORBIDDEN');
  assert.equal(staleIdentityBody.data, undefined);
  sessions.listPrincipalsForAdmin = originalAdminDirectoryRead;
  await request(app.base, `/api/v1/identities/${principal('alice')}/roles`, {
    method: 'PUT', headers: { authorization: token('bob') },
    body: JSON.stringify({
      roles: baseAdminRoles, expectedAuthzGeneration: await authzGeneration(app, 'alice'),
      reason: 'Restore tenant-admin authority after the identity-directory race.',
    }),
  });
  const carolRecord = listed.data.find((entry) => entry.principal === principal('carol'));
  assert.ok(carolRecord);
  assert.deepEqual(carolRecord.roles, []);
  const grantRoles = ['workspace-read', 'workspace-write'];
  const granted = await request(app.base, `/api/v1/identities/${principal('carol')}/roles`, {
    method: 'PUT', headers: { authorization: token('alice') },
    body: JSON.stringify({ roles: grantRoles, expectedAuthzGeneration: carolRecord.authzGeneration, reason: 'Initial local workspace enrollment.' }),
  });
  assert.deepEqual(granted.data.roles, grantRoles);
  assert.equal((await request(app.base, '/api/v1/projects', as('carol'))).data.length, 0);
  const staleGrant = await fetch(`${app.base}/api/v1/identities/${principal('carol')}/roles`, {
    method: 'PUT', headers: { authorization: token('alice'), 'content-type': 'application/json' },
    body: JSON.stringify({ roles: grantRoles, expectedAuthzGeneration: carolRecord.authzGeneration, reason: 'Stale retry.' }),
  });
  assert.equal(staleGrant.status, 409);
  oidcAuthenticator.setRoles('carol', []);
  assert.equal((await request(app.base, '/api/v1/projects', as('carol'))).data.length, 0, 'provider claim changes do not remove the local grant');

  const workloadRecord = listed.data.find((entry) => entry.principal === principal('servicebot'));
  assert.ok(workloadRecord);
  const workloadAdmin = await fetch(`${app.base}/api/v1/identities/${principal('servicebot')}/roles`, {
    method: 'PUT', headers: { authorization: token('alice'), 'content-type': 'application/json' },
    body: JSON.stringify({ roles: ['tenant-admin'], expectedAuthzGeneration: workloadRecord.authzGeneration, reason: 'Must be rejected.' }),
  });
  assert.equal(workloadAdmin.status, 403);
  for (const approvalRole of ['execution-approver', 'release-approver', 'control-owner']) {
    const workloadApprovalRole = await fetch(`${app.base}/api/v1/identities/${principal('servicebot')}/roles`, {
      method: 'PUT', headers: { authorization: token('alice'), 'content-type': 'application/json' },
      body: JSON.stringify({ roles: ['workspace-read', 'workspace-write', approvalRole], expectedAuthzGeneration: workloadRecord.authzGeneration, reason: 'Workloads cannot approve protected changes.' }),
    });
    assert.equal(workloadApprovalRole.status, 403);
    assert.equal((await workloadApprovalRole.json()).error.code, 'WORKLOAD_APPROVAL_ROLE_DENIED');
  }

  // Even if an earlier or external provisioner left an invalid workload grant behind,
  // approval's principal-authority transaction must still require a human actor.
  const workloadGrant = await postgres.query(`
    update orgward.oidc_principals
    set roles = ARRAY['workspace-read', 'workspace-write', 'execution-approver'],
        authz_generation = authz_generation + 1, updated_at = now()
    where tenant_id = 'tenant-a' and principal = $1 and actor_type = 'workload'
    returning authz_generation
  `, [principal('servicebot')]);
  assert.equal(workloadGrant.rowCount, 1);
  const approvalProject = await request(app.base, '/api/v1/projects', {
    ...as('alice'), method: 'POST', body: command('workload-approver-project', { name: 'Human approval boundary' }),
  }, 201);
  await request(app.base, `/api/v1/projects/${approvalProject.data.id}/members`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal('servicebot'), access: 'editor' }),
  });
  const pendingApproval = await request(app.base, '/api/execution/runs', {
    ...as('alice'), method: 'POST', body: JSON.stringify({
      projectId: approvalProject.data.id, profileId: profile.id, title: 'Human-only approval',
      objective: 'An agent identity cannot authorize a protected execution.',
    }),
  }, 201);
  const workloadApproval = await request(app.base, `/api/execution/runs/${pendingApproval.id}/approve`, {
    ...as('servicebot'), method: 'POST', body: JSON.stringify({ version: pendingApproval.version }),
  }, 403);
  assert.match(workloadApproval.error, /Human identity is required/);
  const unchangedApproval = await request(app.base, `/api/execution/runs/${pendingApproval.id}`, as('alice'));
  assert.equal(unchangedApproval.status, 'AWAITING_APPROVAL');
  assert.equal(unchangedApproval.approval, null);
  assert.equal(unchangedApproval.events.some((event) => event.type === 'ExecutionApproved'), false);

  const selfGrant = await fetch(`${app.base}/api/v1/identities/${principal('alice')}/roles`, {
    method: 'PUT', headers: { authorization: token('alice'), 'content-type': 'application/json' },
    body: JSON.stringify({ roles: [...baseAdminRoles, 'execution-approver'], expectedAuthzGeneration: concurrentBootstrap[0].authzGeneration, reason: 'Must be rejected.' }),
  });
  assert.equal(selfGrant.status, 409);

  const bobBefore = await authzGeneration(app, 'bob');
  await request(app.base, `/api/v1/identities/${principal('bob')}/roles`, {
    method: 'PUT', headers: { authorization: token('alice') },
    body: JSON.stringify({ roles: ['workspace-read', 'workspace-write', 'tenant-admin'], expectedAuthzGeneration: bobBefore, reason: 'Enable a second administrator for concurrency coverage.' }),
  });
  await request(app.base, '/api/v1/projects', {
    ...as('alice'), method: 'POST', body: command('identity-admin-bootstrap-project', { name: 'Admin bootstrap access' }),
  }, 201);

  const targetCarolgeneration = await authzGeneration(app, 'carol');
  const originalRoleUpdate = sessions.updatePrincipalRoles.bind(sessions);
  let signalRoleUpdate;
  let resumeRoleUpdate;
  const pausedRoleUpdate = new Promise((resolve) => { signalRoleUpdate = resolve; });
  const roleUpdateGate = new Promise((resolve) => { resumeRoleUpdate = resolve; });
  sessions.updatePrincipalRoles = async (input) => {
    if (input.actor === principal('alice') && input.principal === principal('carol')) {
      signalRoleUpdate();
      await roleUpdateGate;
    }
    return originalRoleUpdate(input);
  };
  const pendingActorAction = fetch(`${app.base}/api/v1/identities/${principal('carol')}/roles`, {
    method: 'PUT', headers: { authorization: token('alice'), 'content-type': 'application/json' },
    body: JSON.stringify({ roles: ['workspace-read'], expectedAuthzGeneration: targetCarolgeneration, reason: 'Must fail after actor demotion.' }),
  });
  await pausedRoleUpdate;
  const aliceGeneration = await authzGeneration(app, 'alice');
  const demoteActor = await request(app.base, `/api/v1/identities/${principal('alice')}/roles`, {
    method: 'PUT', headers: { authorization: token('bob') },
    body: JSON.stringify({ roles: ['workspace-read', 'workspace-write'], expectedAuthzGeneration: aliceGeneration, reason: 'Demote actor during paused action.' }),
  });
  assert.equal(demoteActor.data.roles.includes('tenant-admin'), false);
  resumeRoleUpdate();
  const staleActorAction = await pendingActorAction;
  assert.equal(staleActorAction.status, 403);
  sessions.updatePrincipalRoles = originalRoleUpdate;

  await close(app); app = null;
  app = await start(postgres.databaseUrl, { oidcAuthenticator, oidcBootstrapPrincipals: bootstrapPrincipals, testEnrollment: false });
  const sessionsAfterRestart = app.sessionStore;
  const aliceAfterRestart = await sessionsAfterRestart.resolve(await oidcAuthenticator.authenticate(as('alice')));
  assert.deepEqual(aliceAfterRestart.roles, ['workspace-read', 'workspace-write'], 'configured bootstrap must not silently regrant after local demotion');
  const revokeAlice = await request(app.base, `/api/v1/identities/${principal('alice')}/revoke`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({
      reason: 'Lifecycle completion after local demotion.', expectedAuthzGeneration: await authzGeneration(app, 'alice'),
    }),
  });
  assert.equal(revokeAlice.data.status, 'revoked');
  assert.equal(await sessionsAfterRestart.resolve(await oidcAuthenticator.authenticate(as('alice'))), null, 'revoked bootstrap principal remains revoked');

  const carolProject = await request(app.base, '/api/v1/projects', {
    ...as('bob'), method: 'POST', body: command('admin-role-last-admin-project', { name: 'Last admin concurrency' }),
  }, 201);
  const addDave = await request(app.base, '/api/v1/foundation', as('dave'), 403);
  assert.ok(addDave.error);
  const daveGeneration = await authzGeneration(app, 'dave');
  await request(app.base, `/api/v1/identities/${principal('dave')}/roles`, {
    method: 'PUT', headers: { authorization: token('bob') },
    body: JSON.stringify({ roles: ['workspace-read', 'workspace-write', 'tenant-admin'], expectedAuthzGeneration: daveGeneration, reason: 'Provision second live administrator.' }),
  });
  const bobGeneration = await authzGeneration(app, 'bob');
  const daveCurrentGeneration = await authzGeneration(app, 'dave');
  const opposingAdminChanges = await Promise.all([
    fetch(`${app.base}/api/v1/identities/${principal('dave')}/roles`, {
      method: 'PUT', headers: { authorization: token('bob'), 'content-type': 'application/json' },
      body: JSON.stringify({ roles: ['workspace-read', 'workspace-write'], expectedAuthzGeneration: daveCurrentGeneration, reason: 'Concurrent administrator race.' }),
    }),
    fetch(`${app.base}/api/v1/identities/${principal('bob')}/roles`, {
      method: 'PUT', headers: { authorization: token('dave'), 'content-type': 'application/json' },
      body: JSON.stringify({ roles: ['workspace-read', 'workspace-write'], expectedAuthzGeneration: bobGeneration, reason: 'Concurrent administrator race.' }),
    }),
  ]);
  assert.deepEqual(opposingAdminChanges.map((response) => response.status).sort(), [200, 403]);
  const remainingAdmins = await postgres.query(`
    select count(*)::int count from orgward.oidc_principals
    where tenant_id = 'tenant-a' and status = 'active' and 'tenant-admin' = any(roles)
  `);
  assert.equal(remainingAdmins.rows[0].count, 1, 'sorted locks preserve exactly one administrator through opposing demotions');
  assert.equal(carolProject.data.createdBy, principal('bob'));
});

test('PostgreSQL requires a human approver even for legacy workload grants and persisted approvals', async (t) => {
  const postgres = await startPostgres();
  const profileRoot = await mkdtemp(path.join(tmpdir(), 'orgward-workload-approval-'));
  const profile = {
    id: 'workload-approval-profile', label: 'Workload approval profile', kind: 'test', version: '1.0.0',
    executable: process.execPath, args: ['-e', "require('node:fs').writeFileSync('started.txt', 'started')"],
    workspaceRoot: profileRoot, timeoutMs: 2_000,
  };
  const oidcAuthenticator = testOidcAuthenticator();
  const app = await start(postgres.databaseUrl, { oidcAuthenticator, executionProfiles: [profile] });
  const as = (subject) => ({ headers: { authorization: `Bearer ${subject}` } });
  const principal = (subject) => `oidc:${createHash('sha256').update(`https://persistence-identity.example.test\n${subject}`).digest('hex')}`;
  t.after(async () => { await close(app); await postgres.close(); await rm(profileRoot, { recursive: true, force: true }); });

  const project = await request(app.base, '/api/v1/projects', {
    ...as('alice'), method: 'POST', body: command('workload-approval-boundary', { name: 'Workload approval boundary' }),
  }, 201);
  const membership = await request(app.base, `/api/v1/projects/${project.data.id}/members`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal('servicebot'), access: 'editor' }),
  });
  const workloadAuthority = await postgres.query(`
    update orgward.oidc_principals
    set roles = ARRAY['workspace-read', 'workspace-write', 'execution-approver'],
        authz_generation = authz_generation + 1, updated_at = now()
    where tenant_id = 'tenant-a' and principal = $1 and actor_type = 'workload'
    returning authz_generation
  `, [principal('servicebot')]);
  assert.equal(workloadAuthority.rowCount, 1);

  const run = await request(app.base, '/api/execution/runs', {
    ...as('alice'), method: 'POST', body: JSON.stringify({
      projectId: project.data.id, profileId: profile.id, title: 'Human approval required',
      objective: 'Only a human project member can authorize this work.',
    }),
  }, 201);
  const deniedApproval = await request(app.base, `/api/execution/runs/${run.id}/approve`, {
    ...as('servicebot'), method: 'POST', body: JSON.stringify({ version: run.version }),
  }, 403);
  assert.match(deniedApproval.error, /Human identity is required/);

  const store = app.executionService.store;
  const originalAuthorityRead = store.withPrincipalAuthority.bind(store);
  store.withPrincipalAuthority = async (input) => {
    if (input.requiredPrincipalRoles?.includes('execution-approver')) {
      const current = await store.get(input.id, input.tenantId);
      return current ? input.operation(current, { projectId: current.projectId, access: 'editor', generation: membership.data.generation }) : null;
    }
    return originalAuthorityRead(input);
  };
  const deniedSave = await request(app.base, `/api/execution/runs/${run.id}/approve`, {
    ...as('servicebot'), method: 'POST', body: JSON.stringify({ version: run.version }),
  }, 403);
  assert.match(deniedSave.error, /Human identity is required/);
  store.withPrincipalAuthority = originalAuthorityRead;

  const unchanged = await request(app.base, `/api/execution/runs/${run.id}`, as('alice'));
  assert.equal(unchanged.status, 'AWAITING_APPROVAL');
  assert.equal(unchanged.approval, null);

  // Simulate a legacy persisted approval created before actor-type enforcement.
  const legacy = await app.executionService.store.get(run.id, 'tenant-a');
  const workloadGeneration = Number(workloadAuthority.rows[0].authz_generation);
  legacy.approval = {
    principal: principal('servicebot'), roles: ['execution-approver'], approvedAt: new Date().toISOString(),
    requestHash: executionApprovalRequestHash(legacy), authorityGeneration: workloadGeneration,
    projectMembershipGeneration: membership.data.generation,
  };
  legacy.status = 'APPROVED';
  legacy.version += 1;
  executionEvent(legacy, 'ExecutionApproved', principal('servicebot'), { requestHash: legacy.approval.requestHash });
  await postgres.query(`
    update orgward.aggregates set state = $3::jsonb, state_hash = $4, version = $5, updated_at = now()
    where tenant_id = $1 and aggregate_kind = 'execution_run' and aggregate_id = $2
  `, ['tenant-a', run.id, JSON.stringify(legacy), contentHash(legacy), legacy.version]);

  const interrupted = await request(app.base, `/api/execution/runs/${run.id}/execute`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: legacy.version }),
  });
  assert.equal(interrupted.status, 'INTERRUPTED');
  assert.equal(interrupted.events.at(-1).data.reason, 'execution_approval_stale');
  assert.deepEqual(interrupted.execution.changedArtifacts, []);
  assert.equal(interrupted.events.some((event) => event.type === 'ExecutionStarted'), true);
  await assert.rejects(() => readFile(path.join(profileRoot, run.id, 'started.txt')), { code: 'ENOENT' });
});

test('PostgreSQL revalidates workspace-write generation inside project create and update transactions', async (t) => {
  const postgres = await startPostgres();
  const oidcAuthenticator = testOidcAuthenticator();
  const app = await start(postgres.databaseUrl, { oidcAuthenticator });
  const token = (subject) => `Bearer ${subject}`;
  const as = (subject) => ({ headers: { authorization: token(subject) } });
  const principal = (subject) => `oidc:${createHash('sha256').update(`https://persistence-identity.example.test\n${subject}`).digest('hex')}`;
  t.after(async () => { await close(app); await postgres.close(); });

  const project = await request(app.base, '/api/v1/projects', {
    ...as('alice'), method: 'POST', body: command('workspace-write-race-project', { name: 'Workspace authorization race' }),
  }, 201);
  const alicePrincipal = principal('alice');
  const carolPrincipal = principal('carol');
  const replaceAliceRoles = async (roles, reason) => request(
    app.base, `/api/v1/identities/${alicePrincipal}/roles`, {
      method: 'PUT', headers: { authorization: token('bob') },
      body: JSON.stringify({ roles, expectedAuthzGeneration: await authzGeneration(app, 'alice'), reason }),
    },
  );

  const originalUpdate = app.store.updateWithCommandForPrincipal.bind(app.store);
  let updateReachedStore;
  let resumeUpdate;
  const pausedUpdate = new Promise((resolve) => { updateReachedStore = resolve; });
  const updateGate = new Promise((resolve) => { resumeUpdate = resolve; });
  app.store.updateWithCommandForPrincipal = async (...args) => {
    if (args[3] === alicePrincipal) {
      updateReachedStore();
      await updateGate;
    }
    return originalUpdate(...args);
  };
  const pendingUpdate = fetch(`${app.base}/api/v1/projects/${project.data.id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: token('alice') },
    body: command('workspace-write-race-update', { content: 'This write must not survive role removal.' }, project.data.version),
  });
  await pausedUpdate;
  const identities = await request(app.base, '/api/v1/identities', as('bob'));
  const aliceRecord = identities.data.find((entry) => entry.principal === alicePrincipal);
  const demoteAlice = await request(app.base, `/api/v1/identities/${alicePrincipal}/roles`, {
    method: 'PUT', headers: { authorization: token('bob') },
    body: JSON.stringify({
      roles: ['workspace-read'], expectedAuthzGeneration: aliceRecord.authzGeneration,
      reason: 'Remove workspace write during a pending project update.',
    }),
  });
  assert.deepEqual(demoteAlice.data.roles, ['workspace-read']);
  resumeUpdate();
  const updateResponse = await pendingUpdate;
  assert.equal(updateResponse.status, 403);
  assert.equal((await updateResponse.json()).error.code, 'ACTION_FORBIDDEN');
  app.store.updateWithCommandForPrincipal = originalUpdate;
  const unchangedProject = await postgres.query(
    'select state from orgward.aggregates where tenant_id = $1 and aggregate_kind = $2 and aggregate_id = $3',
    ['tenant-a', 'project', project.data.id],
  );
  assert.equal(unchangedProject.rows[0].state.version, project.data.version);
  assert.equal(unchangedProject.rows[0].state.conversation.some((turn) => turn.content === 'This write must not survive role removal.'), false);

  const originalCreate = app.store.createWithCommandForPrincipal.bind(app.store);
  let createReachedStore;
  let resumeCreate;
  const pausedCreate = new Promise((resolve) => { createReachedStore = resolve; });
  const createGate = new Promise((resolve) => { resumeCreate = resolve; });
  app.store.createWithCommandForPrincipal = async (...args) => {
    if (args[3] === carolPrincipal) {
      createReachedStore();
      await createGate;
    }
    return originalCreate(...args);
  };
  const pendingCreate = fetch(`${app.base}/api/v1/projects`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: token('carol') },
    body: command('workspace-write-race-create', { name: 'Must not be created' }),
  });
  await pausedCreate;
  const carolRecord = identities.data.find((entry) => entry.principal === carolPrincipal);
  const demoteCarol = await request(app.base, `/api/v1/identities/${carolPrincipal}/roles`, {
    method: 'PUT', headers: { authorization: token('bob') },
    body: JSON.stringify({
      roles: ['workspace-read'], expectedAuthzGeneration: carolRecord.authzGeneration,
      reason: 'Remove workspace write during a pending project create.',
    }),
  });
  assert.deepEqual(demoteCarol.data.roles, ['workspace-read']);
  resumeCreate();
  const createResponse = await pendingCreate;
  assert.equal(createResponse.status, 403);
  assert.equal((await createResponse.json()).error.code, 'ACTION_FORBIDDEN');
  app.store.createWithCommandForPrincipal = originalCreate;
  const createdProject = await postgres.query(
    'select count(*)::int count from orgward.aggregates where tenant_id = $1 and aggregate_kind = $2 and state->>\'createdBy\' = $3',
    ['tenant-a', 'project', carolPrincipal],
  );
  assert.equal(createdProject.rows[0].count, 0);
  const recordedCommand = await postgres.query(
    'select count(*)::int count from orgward.command_results where tenant_id = $1 and command_id = $2',
    ['tenant-a', 'workspace-write-race-create'],
  );
  assert.equal(recordedCommand.rows[0].count, 0);

  await replaceAliceRoles(['workspace-read', 'workspace-write'], 'Restore project owner workspace access for membership tests.');
  const originalGrant = app.store.grantMember.bind(app.store);
  let grantReachedStore;
  let resumeGrant;
  const pausedGrant = new Promise((resolve) => { grantReachedStore = resolve; });
  const grantGate = new Promise((resolve) => { resumeGrant = resolve; });
  app.store.grantMember = async (...args) => {
    grantReachedStore();
    await grantGate;
    return originalGrant(...args);
  };
  const pendingGrant = fetch(`${app.base}/api/v1/projects/${project.data.id}/members`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: token('alice') },
    body: JSON.stringify({ principal: carolPrincipal, access: 'editor' }),
  });
  await pausedGrant;
  await replaceAliceRoles(['workspace-read'], 'Remove workspace write during a pending membership grant.');
  resumeGrant();
  const grantResponse = await pendingGrant;
  assert.equal(grantResponse.status, 403);
  assert.equal((await grantResponse.json()).error.code, 'ACTION_FORBIDDEN');
  app.store.grantMember = originalGrant;
  const absentMembership = await postgres.query(
    'select count(*)::int count from orgward.project_memberships where tenant_id = $1 and project_id = $2 and principal = $3 and revoked_at is null',
    ['tenant-a', project.data.id, carolPrincipal],
  );
  assert.equal(absentMembership.rows[0].count, 0);

  await replaceAliceRoles(['workspace-read', 'workspace-write'], 'Restore project owner workspace access for membership revocation test.');
  await request(app.base, `/api/v1/projects/${project.data.id}/members`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: carolPrincipal, access: 'editor' }),
  });
  const originalRevoke = app.store.revokeMember.bind(app.store);
  let revokeReachedStore;
  let resumeRevoke;
  const pausedRevoke = new Promise((resolve) => { revokeReachedStore = resolve; });
  const revokeGate = new Promise((resolve) => { resumeRevoke = resolve; });
  app.store.revokeMember = async (...args) => {
    revokeReachedStore();
    await revokeGate;
    return originalRevoke(...args);
  };
  const pendingRevoke = fetch(`${app.base}/api/v1/projects/${project.data.id}/members/${carolPrincipal}/revoke`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: token('alice') }, body: '{}',
  });
  await pausedRevoke;
  await replaceAliceRoles(['workspace-read'], 'Remove workspace write during a pending membership revocation.');
  resumeRevoke();
  const revokeResponse = await pendingRevoke;
  assert.equal(revokeResponse.status, 403);
  assert.equal((await revokeResponse.json()).error.code, 'ACTION_FORBIDDEN');
  app.store.revokeMember = originalRevoke;
  const retainedMembership = await postgres.query(
    'select access, revoked_at from orgward.project_memberships where tenant_id = $1 and project_id = $2 and principal = $3',
    ['tenant-a', project.data.id, carolPrincipal],
  );
  assert.equal(retainedMembership.rows[0].access, 'editor');
  assert.equal(retainedMembership.rows[0].revoked_at, null);

  await replaceAliceRoles(['workspace-read', 'workspace-write'], 'Prepare an authenticated project-list read race.');
  const originalProjectList = app.store.listWithPrincipalAuthority.bind(app.store);
  let projectListReached;
  let resumeProjectList;
  const projectListPaused = new Promise((resolve) => { projectListReached = resolve; });
  const projectListGate = new Promise((resolve) => { resumeProjectList = resolve; });
  app.store.listWithPrincipalAuthority = async (options) => {
    if (options.principal === alicePrincipal) {
      projectListReached();
      await projectListGate;
    }
    return originalProjectList(options);
  };
  const pendingProjectList = fetch(`${app.base}/api/v1/projects`, { headers: { authorization: token('alice') } });
  await projectListPaused;
  await replaceAliceRoles(['workspace-read'], 'Advance project-list authority before disclosure.');
  resumeProjectList();
  const staleProjectList = await pendingProjectList;
  assert.equal(staleProjectList.status, 409);
  assert.equal((await staleProjectList.json()).error.code, 'AUTHORITY_GENERATION_STALE');
  app.store.listWithPrincipalAuthority = originalProjectList;

  await replaceAliceRoles(['workspace-read', 'workspace-write'], 'Prepare a legacy project-list read race.');
  let legacyProjectListReached;
  let resumeLegacyProjectList;
  const legacyProjectListPaused = new Promise((resolve) => { legacyProjectListReached = resolve; });
  const legacyProjectListGate = new Promise((resolve) => { resumeLegacyProjectList = resolve; });
  app.store.listWithPrincipalAuthority = async (options) => {
    if (options.principal === alicePrincipal) {
      legacyProjectListReached();
      await legacyProjectListGate;
    }
    return originalProjectList(options);
  };
  const pendingLegacyProjectList = fetch(`${app.base}/api/projects`, {
    headers: { authorization: token('alice') },
  });
  await legacyProjectListPaused;
  await replaceAliceRoles(['workspace-read'], 'Advance legacy project-list authority before disclosure.');
  resumeLegacyProjectList();
  const staleLegacyProjectList = await pendingLegacyProjectList;
  assert.equal(staleLegacyProjectList.status, 409);
  const staleLegacyListBody = await staleLegacyProjectList.json();
  assert.match(staleLegacyListBody.error, /authority changed/i);
  assert.equal(staleLegacyListBody.projects, undefined);
  app.store.listWithPrincipalAuthority = originalProjectList;

  await replaceAliceRoles(['workspace-read', 'workspace-write'], 'Prepare an authenticated project-detail read race.');
  const originalProjectDetail = app.store.getWithPrincipalAuthority.bind(app.store);
  let projectDetailReached;
  let resumeProjectDetail;
  const projectDetailPaused = new Promise((resolve) => { projectDetailReached = resolve; });
  const projectDetailGate = new Promise((resolve) => { resumeProjectDetail = resolve; });
  app.store.getWithPrincipalAuthority = async (options) => {
    if (options.principal === alicePrincipal) {
      projectDetailReached();
      await projectDetailGate;
    }
    return originalProjectDetail(options);
  };
  const pendingProjectDetail = fetch(`${app.base}/api/v1/projects/${project.data.id}`, {
    headers: { authorization: token('alice') },
  });
  await projectDetailPaused;
  await replaceAliceRoles(['workspace-read'], 'Advance project-detail authority before disclosure.');
  resumeProjectDetail();
  const staleProjectDetail = await pendingProjectDetail;
  assert.equal(staleProjectDetail.status, 409);
  assert.equal((await staleProjectDetail.json()).error.code, 'AUTHORITY_GENERATION_STALE');
  app.store.getWithPrincipalAuthority = originalProjectDetail;

  await replaceAliceRoles(['workspace-read', 'workspace-write'], 'Prepare a legacy project-detail read race.');
  let legacyProjectDetailReached;
  let resumeLegacyProjectDetail;
  const legacyProjectDetailPaused = new Promise((resolve) => { legacyProjectDetailReached = resolve; });
  const legacyProjectDetailGate = new Promise((resolve) => { resumeLegacyProjectDetail = resolve; });
  app.store.getWithPrincipalAuthority = async (options) => {
    if (options.principal === alicePrincipal) {
      legacyProjectDetailReached();
      await legacyProjectDetailGate;
    }
    return originalProjectDetail(options);
  };
  const pendingLegacyProjectDetail = fetch(`${app.base}/api/projects/${project.data.id}`, {
    headers: { authorization: token('alice') },
  });
  await legacyProjectDetailPaused;
  await replaceAliceRoles(['workspace-read'], 'Advance legacy project-detail authority before disclosure.');
  resumeLegacyProjectDetail();
  const staleLegacyProjectDetail = await pendingLegacyProjectDetail;
  assert.equal(staleLegacyProjectDetail.status, 409);
  const staleLegacyProjectBody = await staleLegacyProjectDetail.json();
  assert.match(staleLegacyProjectBody.error, /authority changed/i);
  assert.equal(staleLegacyProjectBody.id, undefined);
  app.store.getWithPrincipalAuthority = originalProjectDetail;

  await replaceAliceRoles(['workspace-read', 'workspace-write'], 'Prepare a foundation-summary authority race.');
  const originalFoundationRead = app.store.withPrincipalFoundationAuthority.bind(app.store);
  let foundationReadReached;
  let resumeFoundationRead;
  const foundationReadPaused = new Promise((resolve) => { foundationReadReached = resolve; });
  const foundationReadGate = new Promise((resolve) => { resumeFoundationRead = resolve; });
  app.store.withPrincipalFoundationAuthority = async (options) => {
    if (options.principal === alicePrincipal) {
      foundationReadReached();
      await foundationReadGate;
    }
    return originalFoundationRead(options);
  };
  const pendingFoundation = fetch(`${app.base}/api/v1/foundation`, { headers: { authorization: token('alice') } });
  await foundationReadPaused;
  await replaceAliceRoles(['workspace-read'], 'Advance foundation-summary authority before disclosure.');
  resumeFoundationRead();
  const staleFoundation = await pendingFoundation;
  assert.equal(staleFoundation.status, 409);
  assert.equal((await staleFoundation.json()).error.code, 'AUTHORITY_GENERATION_STALE');
  app.store.withPrincipalFoundationAuthority = originalFoundationRead;
});

test('PostgreSQL revalidates workspace-write generation in authenticated SDLC create, action and replay transactions', async (t) => {
  const postgres = await startPostgres();
  const oidcAuthenticator = testOidcAuthenticator();
  const app = await start(postgres.databaseUrl, { oidcAuthenticator });
  const token = (subject) => `Bearer ${subject}`;
  const as = (subject) => ({ headers: { authorization: token(subject) } });
  const principal = (subject) => `oidc:${createHash('sha256').update(`https://persistence-identity.example.test\n${subject}`).digest('hex')}`;
  t.after(async () => { await close(app); await postgres.close(); });

  const project = await request(app.base, '/api/v1/projects', {
    ...as('alice'), method: 'POST', body: command('sdlc-workspace-write-project', { name: 'SDLC write authority' }),
  }, 201);
  const restoreAlice = async () => trustedGrantRoles(
    app, 'alice', ['workspace-read', 'workspace-write', 'tenant-admin'],
  );
  const removeUnrelatedRole = async () => trustedGrantRoles(app, 'alice', ['workspace-read', 'workspace-write']);

  const originalSave = app.sdlcStore.saveForPrincipal.bind(app.sdlcStore);
  let createReached;
  let resumeCreate;
  const createPaused = new Promise((resolve) => { createReached = resolve; });
  const createGate = new Promise((resolve) => { resumeCreate = resolve; });
  let pendingCreateId;
  app.sdlcStore.saveForPrincipal = async (state, options) => {
    if (options.commandAuthority) {
      pendingCreateId = state.id;
      createReached();
      await createGate;
    }
    return originalSave(state, options);
  };
  const pendingCreate = fetch(`${app.base}/api/sdlc/cases`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ projectId: project.data.id, mode: 'golden' }),
  });
  await createPaused;
  await removeUnrelatedRole();
  resumeCreate();
  const deniedCreate = await pendingCreate;
  assert.equal(deniedCreate.status, 409);
  app.sdlcStore.saveForPrincipal = originalSave;
  const createdCaseCount = await postgres.query(
    "select count(*)::int count from orgward.aggregates where tenant_id = 'tenant-a' and aggregate_kind = 'change_case' and aggregate_id = $1",
    [pendingCreateId],
  );
  assert.equal(createdCaseCount.rows[0].count, 0, 'a stale create must not persist');
  await restoreAlice();

  const changeCase = await request(app.base, '/api/sdlc/cases', {
    ...as('alice'), method: 'POST', body: JSON.stringify({ projectId: project.data.id, mode: 'golden' }),
  }, 201);
  const originalAuthorityRead = app.sdlcStore.withPrincipalAuthority.bind(app.sdlcStore);
  let authorityReadReached;
  let resumeAuthorityRead;
  const authorityReadPaused = new Promise((resolve) => { authorityReadReached = resolve; });
  const authorityReadGate = new Promise((resolve) => { resumeAuthorityRead = resolve; });
  app.sdlcStore.withPrincipalAuthority = async (options) => {
    if (options.principal === principal('alice') && options.requiredPrincipalRoles?.includes('workspace-write')) {
      authorityReadReached();
      await authorityReadGate;
    }
    return originalAuthorityRead(options);
  };
  const staleAuthorityAction = fetch(`${app.base}/api/sdlc/cases/${changeCase.id}/advance`, {
    ...as('alice'), method: 'POST',
    body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'sdlc-read-authority-action' }),
  });
  await authorityReadPaused;
  await removeUnrelatedRole();
  resumeAuthorityRead();
  const staleAuthorityResponse = await staleAuthorityAction;
  assert.equal(staleAuthorityResponse.status, 409);
  app.sdlcStore.withPrincipalAuthority = originalAuthorityRead;
  let unchanged = await request(app.base, `/api/sdlc/cases/${changeCase.id}`, as('alice'));
  assert.equal(unchanged.version, changeCase.version);
  assert.equal(unchanged.currentStage, changeCase.currentStage);
  await restoreAlice();

  const gateSave = async (run) => {
    let saveReached;
    let resumeSave;
    const savePaused = new Promise((resolve) => { saveReached = resolve; });
    const saveGate = new Promise((resolve) => { resumeSave = resolve; });
    app.sdlcStore.saveForPrincipal = async (state, options) => {
      if (options.commandAuthority) { saveReached(); await saveGate; }
      return originalSave(state, options);
    };
    const pending = run();
    await savePaused;
    await removeUnrelatedRole();
    resumeSave();
    const response = await pending;
    app.sdlcStore.saveForPrincipal = originalSave;
    return response;
  };
  const deniedAction = await gateSave(() => fetch(`${app.base}/api/sdlc/cases/${changeCase.id}/advance`, {
    ...as('alice'), method: 'POST',
    body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'sdlc-write-authority-action' }),
  }));
  assert.equal(deniedAction.status, 409);
  await restoreAlice();
  unchanged = await request(app.base, `/api/sdlc/cases/${changeCase.id}`, as('alice'));
  assert.equal(unchanged.version, changeCase.version);
  assert.equal(unchanged.currentStage, changeCase.currentStage);

  const completedAction = await request(app.base, `/api/sdlc/cases/${changeCase.id}/advance`, {
    ...as('alice'), method: 'POST',
    body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'sdlc-write-authority-action' }),
  });
  let replayReached;
  let resumeReplay;
  const replayPaused = new Promise((resolve) => { replayReached = resolve; });
  const replayGate = new Promise((resolve) => { resumeReplay = resolve; });
  app.sdlcStore.withPrincipalAuthority = async (options) => {
    if (options.principal === principal('alice') && options.requiredPrincipalRoles?.includes('workspace-write')) {
      replayReached();
      await replayGate;
    }
    return originalAuthorityRead(options);
  };
  const pendingReplay = fetch(`${app.base}/api/sdlc/cases/${changeCase.id}/advance`, {
    ...as('alice'), method: 'POST',
    body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'sdlc-write-authority-action' }),
  });
  await replayPaused;
  await removeUnrelatedRole();
  resumeReplay();
  const deniedReplay = await pendingReplay;
  assert.equal(deniedReplay.status, 409);
  app.sdlcStore.withPrincipalAuthority = originalAuthorityRead;
  await restoreAlice();
  unchanged = await request(app.base, `/api/sdlc/cases/${changeCase.id}`, as('alice'));
  assert.equal(unchanged.version, completedAction.version);
  assert.equal(unchanged.events.length, completedAction.events.length);

  const replayCase = await request(app.base, '/api/sdlc/cases', {
    ...as('alice'), method: 'POST', body: JSON.stringify({ projectId: project.data.id, mode: 'golden' }),
  }, 201);
  const clarificationBody = {
    version: replayCase.version, idempotencyKey: 'sdlc-write-authority-exact-replay',
    question: 'Which owner is in scope?', targetField: 'desiredOutcomes',
  };
  await request(app.base, `/api/sdlc/cases/${replayCase.id}/clarify`, {
    ...as('alice'), method: 'POST', body: JSON.stringify(clarificationBody),
  });
  let exactReplayReached;
  let resumeExactReplay;
  const exactReplayPaused = new Promise((resolve) => { exactReplayReached = resolve; });
  const exactReplayGate = new Promise((resolve) => { resumeExactReplay = resolve; });
  app.sdlcStore.withPrincipalAuthority = async (options) => {
    if (options.principal === principal('alice') && options.requiredPrincipalRoles?.includes('workspace-write')) {
      exactReplayReached();
      await exactReplayGate;
    }
    return originalAuthorityRead(options);
  };
  const pendingExactReplay = fetch(`${app.base}/api/sdlc/cases/${replayCase.id}/clarify`, {
    ...as('alice'), method: 'POST', body: JSON.stringify(clarificationBody),
  });
  await exactReplayPaused;
  await removeUnrelatedRole();
  resumeExactReplay();
  const deniedExactReplay = await pendingExactReplay;
  assert.equal(deniedExactReplay.status, 409);
  app.sdlcStore.withPrincipalAuthority = originalAuthorityRead;
  await restoreAlice();
  const retainedClarification = await request(app.base, `/api/sdlc/cases/${replayCase.id}`, as('alice'));
  assert.equal(retainedClarification.clarifications.length, 1);
});

test('PostgreSQL fences execution creation, dispatch and worker renewal to the caller authority generation', async (t) => {
  const postgres = await startPostgres();
  const profileRoot = await mkdtemp(path.join(tmpdir(), 'orgward-execution-authority-fence-'));
  const marker = path.join(profileRoot, 'worker-started');
  const profile = {
    id: 'execution-authority-fence', label: 'Execution authority fence', kind: 'test', version: '1.0.0',
    executable: process.execPath,
    args: ['-e', "require('node:fs').writeFileSync(process.env.MARKER, 'started'); setInterval(() => {}, 25)"],
    environment: { MARKER: marker }, sandbox: { allowedEnvironment: ['MARKER'] },
    workspaceRoot: path.join(profileRoot, 'workspaces'), timeoutMs: 30_000,
  };
  const app = await start(postgres.databaseUrl, { executionProfiles: [profile] });
  const token = (subject) => `Bearer ${subject}`;
  const as = (subject) => ({ headers: { authorization: token(subject) } });
  const principal = (subject) => `oidc:${createHash('sha256').update(`https://persistence-identity.example.test\n${subject}`).digest('hex')}`;
  const alicePrincipal = principal('alice');
  t.after(async () => {
    await close(app);
    await postgres.close();
    await rm(profileRoot, { recursive: true, force: true });
  });

  const project = await request(app.base, '/api/v1/projects', {
    ...as('alice'), method: 'POST', body: command('execution-authority-project', { name: 'Execution authority boundary' }),
  }, 201);
  const replaceAliceRoles = async (roles, reason) => request(
    app.base, `/api/v1/identities/${alicePrincipal}/roles`, {
      method: 'PUT', headers: { authorization: token('bob') },
      body: JSON.stringify({ roles, expectedAuthzGeneration: await authzGeneration(app, 'alice'), reason }),
    },
  );

  const originalSave = app.executionService.store.saveForPrincipal.bind(app.executionService.store);
  let creationReachedStore;
  let resumeCreation;
  const creationPaused = new Promise((resolve) => { creationReachedStore = resolve; });
  const creationGate = new Promise((resolve) => { resumeCreation = resolve; });
  app.executionService.store.saveForPrincipal = async (run, options) => {
    if (options.expectedVersion === null && options.requiredPrincipalRoles?.includes('workspace-write')) {
      creationReachedStore();
      await creationGate;
    }
    return originalSave(run, options);
  };
  const pendingCreation = fetch(`${app.base}/api/execution/runs`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: token('alice') },
    body: JSON.stringify({ projectId: project.data.id, profileId: profile.id, title: 'Racing task', objective: 'Must not be saved after demotion.' }),
  });
  await creationPaused;
  await replaceAliceRoles(['workspace-read'], 'Remove workspace write during a pending execution creation.');
  resumeCreation();
  const creationResponse = await pendingCreation;
  assert.equal(creationResponse.status, 403);
  assert.match((await creationResponse.json()).error, /required authority/i);
  app.executionService.store.saveForPrincipal = originalSave;
  const absentRun = await postgres.query(
    "select count(*)::int count from orgward.aggregates where tenant_id = $1 and aggregate_kind = 'execution_run' and state->>'title' = $2",
    ['tenant-a', 'Racing task'],
  );
  assert.equal(absentRun.rows[0].count, 0);

  await replaceAliceRoles(['workspace-read', 'workspace-write'], 'Restore Alice execution authority for dispatch race.');
  await request(app.base, `/api/v1/projects/${project.data.id}/members`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal('bob'), access: 'editor' }),
  });
  const created = await request(app.base, '/api/execution/runs', {
    ...as('alice'), method: 'POST', body: JSON.stringify({
      projectId: project.data.id, profileId: profile.id, title: 'Dispatch race task', objective: 'Do not start after workspace authority changes.',
    }),
  }, 201);
  const approved = await request(app.base, `/api/execution/runs/${created.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: created.version }),
  });
  const originalDispatch = app.executionService.store.authorizeExecutionDispatch.bind(app.executionService.store);
  let dispatchReachedStore;
  let resumeDispatch;
  const dispatchPaused = new Promise((resolve) => { dispatchReachedStore = resolve; });
  const dispatchGate = new Promise((resolve) => { resumeDispatch = resolve; });
  let workerStarted = false;
  app.executionService.store.authorizeExecutionDispatch = async (input) => {
    dispatchReachedStore();
    await dispatchGate;
    return originalDispatch({ ...input, start: async () => { workerStarted = true; return input.start(); } });
  };
  const pendingDispatch = fetch(`${app.base}/api/execution/runs/${created.id}/execute`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: token('alice') },
    body: JSON.stringify({ version: approved.version }),
  });
  await dispatchPaused;
  await replaceAliceRoles(['workspace-read'], 'Remove workspace write during a pending worker dispatch.');
  resumeDispatch();
  const dispatchResponse = await pendingDispatch;
  assert.equal(dispatchResponse.status, 200);
  const interrupted = await dispatchResponse.json();
  assert.equal(interrupted.status, 'INTERRUPTED');
  assert.equal(interrupted.events.at(-1).data.reason, 'principal_authority_changed');
  assert.equal(workerStarted, false, 'the process must not start after the executor authority generation changes');
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  app.executionService.store.authorizeExecutionDispatch = originalDispatch;
});

test('PostgreSQL execution approval separates requester and approver, enforces project membership, and survives restart', async (t) => {
  const postgres = await startPostgres();
  const profileRoot = await mkdtemp(path.join(tmpdir(), 'orgward-approval-fence-'));
  const profile = {
    id: 'approval-fence-test', label: 'Approval fence test', kind: 'test', version: '1.0.0',
    executable: process.execPath,
    args: ['-e', "require('node:fs').writeFileSync(process.env.MARKER, 'started')"],
    environment: { MARKER: path.join(profileRoot, 'worker-started') },
    sandbox: { allowedEnvironment: ['MARKER'] },
    workspaceRoot: path.join(profileRoot, 'workspaces'), timeoutMs: 2_000,
  };
  const oidcAuthenticator = testOidcAuthenticator();
  oidcAuthenticator.setRoles('alice', ['workspace-read', 'workspace-write', 'execution-approver']);
  oidcAuthenticator.setRoles('dave', ['workspace-read', 'workspace-write', 'execution-approver']);
  oidcAuthenticator.setRoles('bob', ['workspace-read', 'execution-approver']);
  oidcAuthenticator.setRoles('carol', ['workspace-read', 'execution-approver']);
  let app = await start(postgres.databaseUrl, { oidcAuthenticator, executionProfiles: [profile] });
  const as = (subject) => ({ headers: { authorization: `Bearer ${subject}` } });
  const principal = (subject) => `oidc:${createHash('sha256').update(`https://persistence-identity.example.test\n${subject}`).digest('hex')}`;
  t.after(async () => {
    if (app) await close(app);
    await postgres.close();
    await rm(profileRoot, { recursive: true, force: true });
  });

  const project = await request(app.base, '/api/v1/projects', {
    ...as('alice'), method: 'POST', body: command('approval-boundary-project', { name: 'Approval boundary' }),
  }, 201);
  for (const subject of ['bob', 'carol', 'dave']) await request(app.base, '/api/v1/foundation', as(subject));
  for (const subject of ['bob', 'carol']) {
    await request(app.base, `/api/v1/projects/${project.data.id}/members`, {
      ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal(subject), access: 'editor' }),
    });
  }
  await request(app.base, `/api/v1/projects/${project.data.id}/members`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal('dave'), access: 'reader' }),
  });
  const run = await request(app.base, '/api/execution/runs', {
    ...as('alice'), method: 'POST', body: JSON.stringify({
      projectId: project.data.id, profileId: profile.id, title: 'Approval boundary run', objective: 'Require independent approval.',
    }),
  }, 201);
  assert.equal(run.status, 'AWAITING_APPROVAL');
  assert.equal(run.requestedBy, principal('alice'));

  await trustedGrantRoles(app, 'alice', ['workspace-read', 'workspace-write']);
  await request(app.base, `/api/execution/runs/${run.id}/approve`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: run.version }),
  }, 403);
  await trustedGrantRoles(app, 'alice', ['workspace-read', 'workspace-write', 'execution-approver']);
  await request(app.base, `/api/execution/runs/${run.id}/approve`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: run.version }),
  }, 400);
  await request(app.base, `/api/execution/runs/${run.id}/approve`, {
    ...as('dave'), method: 'POST', body: JSON.stringify({ version: run.version }),
  }, 404);

  const responses = await Promise.all(['bob', 'carol'].map((subject) => fetch(`${app.base}/api/execution/runs/${run.id}/approve`, {
    method: 'POST', headers: { ...tenantHeaders, authorization: `Bearer ${subject}` }, body: JSON.stringify({ version: run.version }),
  })));
  const approvals = await Promise.all(responses.map(async (response) => ({ status: response.status, body: await response.json() })));
  assert.deepEqual(approvals.map(({ status }) => status).sort(), [200, 409]);
  const approved = approvals.find(({ status }) => status === 200).body;
  assert.equal(approved.status, 'APPROVED');
  assert.ok(['bob', 'carol'].some((subject) => approved.approval.principal === principal(subject)));
  assert.equal(approved.events.at(-1).type, 'ExecutionApproved');
  assert.equal(approved.events.at(-1).actor, approved.approval.principal);
  await request(app.base, `/api/execution/runs/${run.id}/execute`, {
    ...as('dave'), method: 'POST', body: JSON.stringify({ version: approved.version }),
  }, 404);
  assert.equal((await request(app.base, `/api/execution/runs/${run.id}`, as('alice'))).status, 'APPROVED');
  await assert.rejects(() => readFile(profile.environment.MARKER), { code: 'ENOENT' });

  await close(app); app = null;
  app = await start(postgres.databaseUrl, { oidcAuthenticator, executionProfiles: [profile] });
  const restored = await request(app.base, `/api/execution/runs/${run.id}`, as('alice'));
  assert.equal(restored.status, 'APPROVED');
  assert.equal(restored.approval.principal, approved.approval.principal);
  await request(app.base, `/api/execution/runs/${run.id}`, as('tenant-b-admin'), 404);
  await assert.rejects(() => readFile(profile.environment.MARKER), { code: 'ENOENT' });
});

test('PostgreSQL rejects an execution approval after the approver authority generation changes', async (t) => {
  const postgres = await startPostgres();
  const profileRoot = await mkdtemp(path.join(tmpdir(), 'orgward-stale-approval-'));
  const profile = {
    id: 'stale-approval-profile', label: 'Stale approval profile', kind: 'test', version: '1.0.0',
    executable: process.execPath,
    args: ['-e', "require('node:fs').writeFileSync('started.txt', 'started')"],
    workspaceRoot: path.join(profileRoot, 'workspaces'), timeoutMs: 2_000,
  };
  const oidcAuthenticator = testOidcAuthenticator();
  let app = await start(postgres.databaseUrl, { oidcAuthenticator, executionProfiles: [profile] });
  const as = (subject) => ({ headers: { authorization: `Bearer ${subject}` } });
  const principal = (subject) => `oidc:${createHash('sha256').update(`https://persistence-identity.example.test\n${subject}`).digest('hex')}`;
  t.after(async () => {
    if (app) await close(app);
    await postgres.close();
    await rm(profileRoot, { recursive: true, force: true });
  });

  const project = await request(app.base, '/api/v1/projects', {
    ...as('alice'), method: 'POST', body: command('stale-approval-project', { name: 'Stale approval' }),
  }, 201);
  await request(app.base, '/api/v1/foundation', as('bob'));
  await request(app.base, '/api/v1/foundation', as('carol'));
  await request(app.base, `/api/v1/projects/${project.data.id}/members`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal('bob'), access: 'editor' }),
  });
  await request(app.base, `/api/v1/projects/${project.data.id}/members`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal('carol'), access: 'editor' }),
  });
  const created = await request(app.base, '/api/execution/runs', {
    ...as('alice'), method: 'POST', body: JSON.stringify({
      projectId: project.data.id, profileId: profile.id, title: 'Stale approval run', objective: 'Recheck approval authority at dispatch.',
    }),
  }, 201);
  const forgedGeneration = await request(app.base, `/api/execution/runs/${created.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: created.version, authorityGeneration: 1 }),
  }, 400);
  assert.match(forgedGeneration.error, /verified server context/i);
  const fullBobRoles = ['workspace-read', 'workspace-write', 'execution-approver', 'release-approver', 'control-owner', 'tenant-admin'];
  const originalAuthorityRead = app.executionService.store.withPrincipalAuthority.bind(app.executionService.store);
  let announceAuthorityRead;
  let releaseAuthorityRead;
  const atAuthorityRead = new Promise((resolve) => { announceAuthorityRead = resolve; });
  const resumeAuthorityRead = new Promise((resolve) => { releaseAuthorityRead = resolve; });
  app.executionService.store.withPrincipalAuthority = async (options) => {
    if (options.principal === principal('bob') && options.requiredPrincipalRoles?.includes('execution-approver')) {
      announceAuthorityRead();
      await resumeAuthorityRead;
    }
    return originalAuthorityRead(options);
  };
  const staleAuthorityApproval = fetch(`${app.base}/api/execution/runs/${created.id}/approve`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer bob' },
    body: JSON.stringify({ version: created.version }),
  });
  await atAuthorityRead;
  await trustedGrantRoles(app, 'bob', fullBobRoles.filter((role) => role !== 'workspace-read'));
  releaseAuthorityRead();
  const rejectedAuthorityApproval = await staleAuthorityApproval;
  assert.equal(rejectedAuthorityApproval.status, 409);
  app.executionService.store.withPrincipalAuthority = originalAuthorityRead;
  assert.equal((await request(app.base, `/api/execution/runs/${created.id}`, as('alice'))).status, 'AWAITING_APPROVAL');
  await trustedGrantRoles(app, 'bob', fullBobRoles);

  let announceSave;
  let releaseSave;
  const atApprovalSave = new Promise((resolve) => { announceSave = resolve; });
  const resumeApprovalSave = new Promise((resolve) => { releaseSave = resolve; });
  const originalSaveForPrincipal = app.executionService.store.saveForPrincipal.bind(app.executionService.store);
  app.executionService.store.saveForPrincipal = async (run, options) => {
    if (options.requiredPrincipalRoles?.includes('execution-approver')) {
      announceSave();
      await resumeApprovalSave;
    }
    return originalSaveForPrincipal(run, options);
  };
  const pendingApproval = fetch(`${app.base}/api/execution/runs/${created.id}/approve`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer bob' },
    body: JSON.stringify({ version: created.version }),
  });
  await atApprovalSave;
  await trustedGrantRoles(app, 'bob', ['workspace-read', 'workspace-write', 'release-approver', 'control-owner', 'tenant-admin']);
  releaseSave();
  const rejectedApproval = await pendingApproval;
  assert.equal(rejectedApproval.status, 403);
  const rejectedApprovalBody = await rejectedApproval.json();
  assert.match(rejectedApprovalBody.error, /required authority/i);
  assert.equal((await request(app.base, `/api/execution/runs/${created.id}`, as('alice'))).status, 'AWAITING_APPROVAL');

  app.executionService.store.saveForPrincipal = originalSaveForPrincipal;
  await trustedGrantRoles(app, 'bob', ['workspace-read', 'workspace-write', 'execution-approver', 'release-approver', 'control-owner', 'tenant-admin']);
  const approved = await request(app.base, `/api/execution/runs/${created.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: created.version }),
  });
  assert.ok(Number.isSafeInteger(approved.approval.authorityGeneration));

  await trustedGrantRoles(app, 'bob', ['workspace-read', 'workspace-write', 'release-approver', 'control-owner', 'tenant-admin']);
  await trustedGrantRoles(app, 'bob', ['workspace-read', 'workspace-write', 'execution-approver', 'release-approver', 'control-owner', 'tenant-admin']);

  await close(app); app = null;
  app = await start(postgres.databaseUrl, { oidcAuthenticator, executionProfiles: [profile] });
  const result = await request(app.base, `/api/execution/runs/${created.id}/execute`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: approved.version }),
  });
  assert.equal(result.status, 'INTERRUPTED', JSON.stringify(result));
  assert.equal(result.events.at(-1).type, 'ExecutionInterrupted');
  assert.equal(result.events.at(-1).data.reason, 'execution_approval_stale');
  assert.equal(result.events.some((event) => event.type === 'ExecutionSucceeded'), false);
  assert.deepEqual(result.execution.changedArtifacts, []);
  await request(app.base, `/api/execution/runs/${created.id}/artifact?path=started.txt`, as('alice'), 404);

  const reapproved = await request(app.base, `/api/execution/runs/${created.id}/approve`, {
    ...as('carol'), method: 'POST', body: JSON.stringify({ version: result.version }),
  });
  assert.equal(reapproved.status, 'APPROVED');
  assert.equal(reapproved.events.at(-1).type, 'ExecutionReapproved');
  const succeeded = await request(app.base, `/api/execution/runs/${created.id}/execute`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: reapproved.version }),
  });
  assert.equal(succeeded.status, 'SUCCEEDED', JSON.stringify(succeeded));
  const artifact = await fetch(`${app.base}/api/execution/runs/${created.id}/artifact?path=started.txt`, as('alice'));
  assert.equal(artifact.status, 200);
  assert.equal(await artifact.text(), 'started');
});

test('PostgreSQL requires renewed execution approval after the approver membership changes across restart', async (t) => {
  const postgres = await startPostgres();
  const profileRoot = await mkdtemp(path.join(tmpdir(), 'orgward-membership-approval-'));
  await mkdir(profileRoot, { recursive: true });
  const profile = {
    id: 'membership-approval-profile', label: 'Membership approval profile', kind: 'test', version: '1.0.0',
    executable: process.execPath,
    args: ['-e', "require('node:fs').mkdirSync(require('node:path').dirname(process.env.MARKER), { recursive: true }); require('node:fs').writeFileSync(process.env.MARKER, 'started')"],
    environment: { MARKER: path.join(profileRoot, 'worker-started') },
    sandbox: { allowedEnvironment: ['MARKER'] },
    workspaceRoot: path.join(profileRoot, 'workspaces'), timeoutMs: 2_000,
  };
  const oidcAuthenticator = testOidcAuthenticator();
  let app = await start(postgres.databaseUrl, { oidcAuthenticator, executionProfiles: [profile] });
  const as = (subject) => ({ headers: { authorization: `Bearer ${subject}` } });
  const principal = (subject) => `oidc:${createHash('sha256').update(`https://persistence-identity.example.test\n${subject}`).digest('hex')}`;
  t.after(async () => {
    if (app) await close(app);
    await postgres.close();
    await rm(profileRoot, { recursive: true, force: true });
  });

  const project = await request(app.base, '/api/v1/projects', {
    ...as('alice'), method: 'POST', body: command('membership-approval-project', { name: 'Membership approval' }),
  }, 201);
  for (const subject of ['bob', 'carol']) await request(app.base, '/api/v1/foundation', as(subject));
  for (const subject of ['bob', 'carol']) {
    await request(app.base, `/api/v1/projects/${project.data.id}/members`, {
      ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal(subject), access: 'editor' }),
    });
  }
  const created = await request(app.base, '/api/execution/runs', {
    ...as('alice'), method: 'POST', body: JSON.stringify({
      projectId: project.data.id, profileId: profile.id, title: 'Membership-bound approval', objective: 'Require renewed approval after project access changes.',
    }),
  }, 201);
  const approved = await request(app.base, `/api/execution/runs/${created.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: created.version }),
  });
  assert.ok(Number.isSafeInteger(approved.approval.projectMembershipGeneration));

  await request(app.base, `/api/v1/projects/${project.data.id}/members/${principal('bob')}/revoke`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({}),
  });
  await request(app.base, `/api/v1/projects/${project.data.id}/members`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal('bob'), access: 'editor' }),
  });
  await close(app); app = null;
  app = await start(postgres.databaseUrl, { oidcAuthenticator, executionProfiles: [profile] });

  const interrupted = await request(app.base, `/api/execution/runs/${created.id}/execute`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: approved.version }),
  });
  assert.equal(interrupted.status, 'INTERRUPTED');
  assert.equal(interrupted.events.at(-1).data.reason, 'execution_approval_stale');
  assert.deepEqual(interrupted.execution.changedArtifacts, []);
  await assert.rejects(() => readFile(profile.environment.MARKER), { code: 'ENOENT' });

  const reapproved = await request(app.base, `/api/execution/runs/${created.id}/approve`, {
    ...as('carol'), method: 'POST', body: JSON.stringify({ version: interrupted.version }),
  });
  assert.equal(reapproved.status, 'APPROVED');
  const succeeded = await request(app.base, `/api/execution/runs/${created.id}/execute`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: reapproved.version }),
  });
  assert.equal(succeeded.status, 'SUCCEEDED', JSON.stringify(succeeded));
});

test('PostgreSQL blocks an approved execution when its configured profile version changes across restart', async (t) => {
  const postgres = await startPostgres();
  const profileRoot = await mkdtemp(path.join(tmpdir(), 'orgward-profile-approval-'));
  const makeProfile = (version, value) => ({
    id: 'versioned-approval-profile', label: 'Versioned approval profile', kind: 'test', version,
    executable: process.execPath,
    args: ['-e', `require('node:fs').writeFileSync('started.txt', '${value}')`],
    workspaceRoot: path.join(profileRoot, 'workspaces'), timeoutMs: 2_000,
  });
  const oidcAuthenticator = testOidcAuthenticator();
  let app = await start(postgres.databaseUrl, { oidcAuthenticator, executionProfiles: [makeProfile('1.0.0', 'v1')] });
  const as = (subject) => ({ headers: { authorization: `Bearer ${subject}` } });
  const principal = (subject) => `oidc:${createHash('sha256').update(`https://persistence-identity.example.test\n${subject}`).digest('hex')}`;
  t.after(async () => {
    if (app) await close(app);
    await postgres.close();
    await rm(profileRoot, { recursive: true, force: true });
  });

  const project = await request(app.base, '/api/v1/projects', {
    ...as('alice'), method: 'POST', body: command('profile-approval-project', { name: 'Profile approval' }),
  }, 201);
  await request(app.base, '/api/v1/foundation', as('bob'));
  await request(app.base, `/api/v1/projects/${project.data.id}/members`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal('bob'), access: 'editor' }),
  });
  const createRun = () => request(app.base, '/api/execution/runs', {
    ...as('alice'), method: 'POST', body: JSON.stringify({
      projectId: project.data.id, profileId: 'versioned-approval-profile', title: 'Profile-bound approval',
      objective: 'Do not reuse approval after executor configuration changes.',
    }),
  }, 201);
  const approvedRun = await createRun();
  const approved = await request(app.base, `/api/execution/runs/${approvedRun.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: approvedRun.version }),
  });
  assert.equal(approved.approval.requestHash, executionApprovalRequestHash(approvedRun));

  await close(app); app = null;
  app = await start(postgres.databaseUrl, { oidcAuthenticator, executionProfiles: [makeProfile('2.0.0', 'v2')] });
  const stale = await request(app.base, `/api/execution/runs/${approvedRun.id}/execute`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: approved.version }),
  }, 409);
  assert.match(stale.error, /profile changed after approval/);
  const unchanged = await request(app.base, `/api/execution/runs/${approvedRun.id}`, as('alice'));
  assert.equal(unchanged.status, 'APPROVED');
  assert.equal(unchanged.events.some((entry) => entry.type === 'ExecutionStarted'), false);
  await assert.rejects(() => readFile(path.join(profileRoot, 'workspaces', approvedRun.id, 'started.txt')), { code: 'ENOENT' });

  const currentRun = await createRun();
  const currentApproval = await request(app.base, `/api/execution/runs/${currentRun.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: currentRun.version }),
  });
  assert.equal(currentApproval.approval.requestHash, executionApprovalRequestHash(currentRun));
  const succeeded = await request(app.base, `/api/execution/runs/${currentRun.id}/execute`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: currentApproval.version }),
  });
  assert.equal(succeeded.status, 'SUCCEEDED', JSON.stringify(succeeded));
  assert.ok(succeeded.execution.changedArtifacts.some((artifact) => artifact.path === 'started.txt'));
});

test('tenant-scoped principal migration preserves existing identity and audit references', async (t) => {
  const postgres = await startPostgres();
  const issuer = 'https://persistence-identity.example.test';
  const alicePrincipal = `oidc:${createHash('sha256').update(`${issuer}\nalice`).digest('hex')}`;
  const migrationDirectory = path.resolve('migrations');
  await postgres.query(`
    create schema if not exists orgward;
    create table orgward.schema_migrations (
      version text primary key,
      checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
      applied_at timestamptz not null default now()
    );
  `);
  const files = (await readdir(migrationDirectory))
    .filter((file) => /^00[1-6]-[a-z0-9-]+\.sql$/.test(file))
    .sort();
  for (const file of files) {
    const sql = await readFile(path.join(migrationDirectory, file), 'utf8');
    await postgres.query(sql);
    await postgres.query('insert into orgward.schema_migrations (version, checksum) values ($1, $2)', [file.slice(0, -4), contentHash(sql)]);
  }
  await postgres.query(`
    insert into orgward.oidc_principals
      (principal, issuer, tenant_id, actor_type, display_name, roles)
    values ($1, $2, 'tenant-a', 'human', 'alice', array['workspace-write'])
  `, [alicePrincipal, issuer]);
  await postgres.query(`
    insert into orgward.oidc_principal_events
      (tenant_id, principal, event_type, actor, authz_generation)
    values ('tenant-a', $1, 'PrincipalAuthenticated', $1, 1)
  `, [alicePrincipal]);

  const oidcAuthenticator = testOidcAuthenticator();
  let app = await start(postgres.databaseUrl, { oidcAuthenticator });
  t.after(async () => {
    if (app) await close(app);
    await postgres.close();
  });
  const as = (subject) => ({ headers: { authorization: `Bearer ${subject}` } });
  const projectA = await request(app.base, '/api/v1/projects', {
    ...as('alice'), method: 'POST', body: command('migrated-principal-project-a', { name: 'Preserved tenant A principal' }),
  }, 201);
  const projectB = await request(app.base, '/api/v1/projects', {
    ...as('alice@tenant-b'), method: 'POST', body: command('migrated-principal-project-b', { name: 'New tenant B binding' }),
  }, 201);
  assert.equal(projectA.data.createdBy, alicePrincipal);
  assert.equal(projectB.data.createdBy, alicePrincipal);
  assert.equal((await app.persistence.status()).schemaVersion, '015-provider-dispatch-attempts');
  assert.deepEqual((await postgres.query(`
    select tenant_id, status from orgward.oidc_principals where principal = $1 order by tenant_id
  `, [alicePrincipal])).rows, [
    { tenant_id: 'tenant-a', status: 'active' },
    { tenant_id: 'tenant-b', status: 'active' },
  ]);
  assert.equal((await postgres.query(
    "select count(*)::int count from orgward.oidc_principal_events where tenant_id = 'tenant-a' and principal = $1 and event_type = 'PrincipalAuthenticated'",
    [alicePrincipal],
  )).rows[0].count, 1);
  await request(app.base, `/api/v1/projects/${projectA.data.id}`, as('alice@tenant-b'), 404);
  await request(app.base, `/api/v1/projects/${projectB.data.id}`, as('alice'), 404);
});

test('PostgreSQL live worker leases prevent cross-instance dispatch and carry revocation', async (t) => {
  const postgres = await startPostgres();
  const profileRoot = await mkdtemp(path.join(tmpdir(), 'orgward-pg-revoke-worker-'));
  const profile = {
    id: 'pg-revoke-worker', label: 'Revocation worker', kind: 'test', version: '1.0.0',
    executable: process.execPath, args: ['-e', 'setInterval(() => {}, 25)'], workspaceRoot: profileRoot, timeoutMs: 30_000,
  };
  const oidcAuthenticator = testOidcAuthenticator();
  let app = await start(postgres.databaseUrl, { executionProfiles: [profile], oidcAuthenticator });
  let secondApp = null;
  const token = (subject) => `Bearer ${subject}`;
  const as = (subject) => ({ headers: { authorization: token(subject) } });
  const principal = (subject) => `oidc:${createHash('sha256').update(`https://persistence-identity.example.test\n${subject}`).digest('hex')}`;
  t.after(async () => {
    if (app) await close(app);
    if (secondApp) await close(secondApp);
    await postgres.close();
    await rm(profileRoot, { recursive: true, force: true });
  });

  const project = await request(app.base, '/api/v1/projects', {
    ...as('alice'), method: 'POST', body: command('pg-revoke-project', { name: 'Revocation fence' }),
  }, 201);
  await request(app.base, '/api/v1/foundation', as('bob'));
  await request(app.base, `/api/v1/projects/${project.data.id}/members`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal('bob'), access: 'editor' }),
  });
  secondApp = await start(postgres.databaseUrl, { executionProfiles: [profile], oidcAuthenticator });
  const created = await request(app.base, '/api/execution/runs', {
    ...as('alice'), method: 'POST', body: JSON.stringify({
      projectId: project.data.id, profileId: profile.id, title: 'Revocable run', objective: 'Stop on project revocation.',
    }),
  }, 201);
  const approved = await request(app.base, `/api/execution/runs/${created.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: created.version }),
  });
  const executing = fetch(`${app.base}/api/execution/runs/${created.id}/execute`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: token('bob') },
    body: JSON.stringify({ version: approved.version }),
  });
  for (let attempt = 0; attempt < 200 && !app.executionService.active.get(created.id)?.handle; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(app.executionService.active.get(created.id)?.handle, 'the process must be registered before dispatch authorization releases its lock');

  const liveRun = await request(secondApp.base, `/api/execution/runs/${created.id}`, as('alice'));
  assert.equal(liveRun.status, 'RUNNING', 'a second app must preserve the live worker lease during recovery');
  let duplicateStarted = false;
  const bobAuthzGeneration = await authzGeneration(secondApp, 'bob');
  await assert.rejects(() => secondApp.executionService.store.authorizeExecutionDispatch({
    tenantId: 'tenant-a', projectId: project.data.id, principal: principal('bob'), runId: created.id,
    authzGeneration: bobAuthzGeneration,
    expectedVersion: liveRun.version, workerId: '00000000-0000-4000-8000-000000000001',
    start: async () => { duplicateStarted = true; },
  }), { code: 'WORKER_LEASE_HELD' });
  assert.equal(duplicateStarted, false);
  await request(secondApp.base, `/api/v1/projects/${project.data.id}/members`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal('bob'), access: 'reader' }),
  });
  const executionResponse = await executing;
  assert.equal(executionResponse.status, 200);
  const interrupted = await executionResponse.json();
  assert.equal(interrupted.status, 'INTERRUPTED');
  assert.equal(interrupted.events.at(-1).type, 'ExecutionInterrupted');
  assert.equal(interrupted.events.at(-1).data.reason, 'project_access_downgraded');
  assert.equal(app.executionService.active.size, 0);
  assert.equal((await postgres.query(
    'select count(*)::int count from orgward.execution_worker_leases where tenant_id = $1 and run_id = $2',
    ['tenant-a', created.id],
  )).rows[0].count, 0);
  assert.equal((await request(app.base, `/api/execution/runs/${created.id}`, as('bob'))).status, 'INTERRUPTED');
  await request(app.base, '/api/execution/runs', {
    ...as('bob'), method: 'POST', body: JSON.stringify({
      projectId: project.data.id, profileId: profile.id, title: 'Reader cannot create', objective: 'Must be denied.',
    }),
  }, 403);
  await request(app.base, `/api/v1/projects/${project.data.id}/members/${principal('bob')}/revoke`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({}),
  });

  await request(secondApp.base, `/api/v1/projects/${project.data.id}/members`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal('bob'), access: 'editor' }),
  });
  const roleRun = await request(app.base, '/api/execution/runs', {
    ...as('alice'), method: 'POST', body: JSON.stringify({
      projectId: project.data.id, profileId: profile.id, title: 'Role revocation run', objective: 'Stop when execution authority is withdrawn.',
    }),
  }, 201);
  const roleApproved = await request(app.base, `/api/execution/runs/${roleRun.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: roleRun.version }),
  });
  const roleExecuting = fetch(`${app.base}/api/execution/runs/${roleRun.id}/execute`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: token('bob') },
    body: JSON.stringify({ version: roleApproved.version }),
  });
  for (let attempt = 0; attempt < 200 && !app.executionService.active.get(roleRun.id)?.handle; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(app.executionService.active.get(roleRun.id)?.handle);
  await trustedGrantRoles(secondApp, 'bob', ['workspace-read', 'release-approver', 'control-owner', 'tenant-admin']);
  const roleResponse = await roleExecuting;
  assert.equal(roleResponse.status, 200, await roleResponse.clone().text());
  const roleInterrupted = await roleResponse.json();
  assert.equal(roleInterrupted.status, 'INTERRUPTED');
  assert.equal(roleInterrupted.events.at(-1).data.reason, 'principal_authority_changed');

  await trustedGrantRoles(secondApp, 'bob', ['workspace-read', 'workspace-write', 'execution-approver', 'release-approver', 'control-owner', 'tenant-admin']);
  const secondRun = await request(app.base, '/api/execution/runs', {
    ...as('bob'), method: 'POST', body: JSON.stringify({
      projectId: project.data.id, profileId: profile.id, title: 'Revoked identity run', objective: 'Stop on identity revocation.',
    }),
  }, 201);
  const secondApproved = await request(app.base, `/api/execution/runs/${secondRun.id}/approve`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: secondRun.version }),
  });
  const secondExecuting = fetch(`${app.base}/api/execution/runs/${secondRun.id}/execute`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: token('bob') },
    body: JSON.stringify({ version: secondApproved.version }),
  });
  for (let attempt = 0; attempt < 200 && !app.executionService.active.get(secondRun.id)?.handle; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(app.executionService.active.get(secondRun.id)?.handle);
  const sessionStore = new PostgresOidcSessionStore(app.persistence);
  const bobIdentity = await oidcAuthenticator.authenticate({ headers: { authorization: token('bob') } });
  const sessionId = 'B'.repeat(43);
  await sessionStore.create(sessionId, bobIdentity, bobIdentity.expiresAt);
  const revokeBody = JSON.stringify({
    reason: 'Workload access removed.', expectedAuthzGeneration: await authzGeneration(secondApp, 'bob'),
  });
  await request(secondApp.base, `/api/v1/identities/${principal('bob')}/revoke`, {
    ...as('alice'), method: 'POST', body: revokeBody,
  });
  const secondResponse = await secondExecuting;
  assert.equal(secondResponse.status, 200);
  const secondInterrupted = await secondResponse.json();
  assert.equal(secondInterrupted.status, 'INTERRUPTED');
  assert.equal(secondInterrupted.events.at(-1).data.reason, 'principal_revoked');
  await request(app.base, `/api/v1/identities/${principal('bob')}/revoke`, {
    ...as('alice'), method: 'POST', body: revokeBody,
  });
  assert.equal(await sessionStore.get(sessionId), null);
  const revokedSessions = await postgres.query(
    'select count(*)::int count from orgward.oidc_sessions where principal = $1 and revoked_at is not null',
    [principal('bob')],
  );
  assert.equal(revokedSessions.rows[0].count, 1);

  await close(app); app = null;
  app = await start(postgres.databaseUrl, { executionProfiles: [profile], oidcAuthenticator });
  assert.equal((await request(app.base, `/api/execution/runs/${created.id}`, as('alice'))).status, 'INTERRUPTED');
  await request(app.base, `/api/execution/runs/${created.id}`, as('bob'), 401);
});

test('PostgreSQL fences a completed worker result against committed project revocation', async (t) => {
  const postgres = await startPostgres();
  const profileRoot = await mkdtemp(path.join(tmpdir(), 'orgward-pg-terminal-fence-'));
  const profile = {
    id: 'pg-terminal-fence', label: 'Terminal fence', kind: 'test', version: '1.0.0',
    executable: process.execPath, args: ['-e', "require('fs').writeFileSync('result.txt', 'private result')"],
    workspaceRoot: profileRoot, timeoutMs: 30_000,
  };
  const oidcAuthenticator = testOidcAuthenticator();
  let app = await start(postgres.databaseUrl, { executionProfiles: [profile], oidcAuthenticator });
  let secondApp = null;
  const token = (subject) => `Bearer ${subject}`;
  const as = (subject) => ({ headers: { authorization: token(subject) } });
  const principal = (subject) => `oidc:${createHash('sha256').update(`https://persistence-identity.example.test\n${subject}`).digest('hex')}`;
  t.after(async () => {
    if (app) await close(app);
    if (secondApp) await close(secondApp);
    await postgres.close();
    await rm(profileRoot, { recursive: true, force: true });
  });

  const project = await request(app.base, '/api/v1/projects', {
    ...as('alice'), method: 'POST', body: command('pg-terminal-fence-project', { name: 'Terminal fence' }),
  }, 201);
  await request(app.base, '/api/v1/foundation', as('bob'));
  await request(app.base, `/api/v1/projects/${project.data.id}/members`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal('bob'), access: 'editor' }),
  });
  const created = await request(app.base, '/api/execution/runs', {
    ...as('alice'), method: 'POST', body: JSON.stringify({
      projectId: project.data.id, profileId: profile.id, title: 'Fence terminal result', objective: 'Do not publish after revocation.',
    }),
  }, 201);
  const approved = await request(app.base, `/api/execution/runs/${created.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: created.version }),
  });

  let announceFinalizer;
  let releaseFinalizer;
  const atFinalizer = new Promise((resolve) => { announceFinalizer = resolve; });
  const proceed = new Promise((resolve) => { releaseFinalizer = resolve; });
  const originalFinalize = app.executionService.store.finalizeExecution.bind(app.executionService.store);
  app.executionService.store.finalizeExecution = async (input) => {
    announceFinalizer();
    await proceed;
    return originalFinalize(input);
  };
  const executing = fetch(`${app.base}/api/execution/runs/${created.id}/execute`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: token('bob') },
    body: JSON.stringify({ version: approved.version }),
  });
  await atFinalizer;
  secondApp = await start(postgres.databaseUrl, { executionProfiles: [profile], oidcAuthenticator });
  await request(secondApp.base, `/api/v1/projects/${project.data.id}/members/${principal('bob')}/revoke`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({}),
  });
  releaseFinalizer();

  const response = await executing;
  assert.equal(response.status, 200);
  const interrupted = await response.json();
  assert.equal(interrupted.status, 'INTERRUPTED');
  assert.equal(interrupted.events.at(-1).type, 'ExecutionInterrupted');
  assert.deepEqual(interrupted.execution.changedArtifacts, []);
  assert.equal(interrupted.events.some((event) => event.type === 'ExecutionSucceeded'), false);
  const artifactResponse = await fetch(`${app.base}/api/execution/runs/${created.id}/artifact?path=result.txt`, as('alice'));
  assert.equal(artifactResponse.status, 404);
  const terminalEvents = await postgres.query(`
    select event_type from orgward.audit_log
    where tenant_id = $1 and aggregate_kind = 'execution_run' and aggregate_id = $2
  `, ['tenant-a', created.id]);
  assert.equal(terminalEvents.rows.some((row) => row.event_type === 'ExecutionSucceeded'), false);
});

test('execution dispatch commit uncertainty closes the worker and persists only interruption', async (t) => {
  const postgres = await startPostgres();
  const profileRoot = await mkdtemp(path.join(tmpdir(), 'orgward-pg-dispatch-unknown-'));
  const profile = {
    id: 'pg-dispatch-unknown', label: 'Dispatch acknowledgment', kind: 'test', version: '1.0.0',
    executable: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'],
    workspaceRoot: profileRoot, timeoutMs: 12_000,
    sandbox: { executable: '/usr/bin/bwrap' },
  };
  const oidcAuthenticator = testOidcAuthenticator();
  const app = await start(postgres.databaseUrl, { executionProfiles: [profile], oidcAuthenticator });
  const token = (subject) => `Bearer ${subject}`;
  const as = (subject) => ({ headers: { authorization: token(subject) } });
  const principal = (subject) => `oidc:${createHash('sha256').update(`https://persistence-identity.example.test\n${subject}`).digest('hex')}`;
  t.after(async () => { await close(app); await postgres.close(); await rm(profileRoot, { recursive: true, force: true }); });

  const project = await request(app.base, '/api/v1/projects', {
    ...as('alice'), method: 'POST', body: command('pg-dispatch-unknown-project', { name: 'Dispatch uncertainty' }),
  }, 201);
  await request(app.base, '/api/v1/foundation', as('bob'));
  await request(app.base, `/api/v1/projects/${project.data.id}/members`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal('bob'), access: 'editor' }),
  });

  const originalAuthorize = app.executionService.store.authorizeExecutionDispatch.bind(app.executionService.store);
  for (const mode of ['rollback-after-spawn', 'committed-lost-ack', 'late-ack-watchdog']) {
    const created = await request(app.base, '/api/execution/runs', {
      ...as('alice'), method: 'POST', body: JSON.stringify({
        projectId: project.data.id, profileId: profile.id, title: mode, objective: 'Stop if dispatch acknowledgment is uncertain.',
      }),
    }, 201);
    const approved = await request(app.base, `/api/execution/runs/${created.id}/approve`, {
      ...as('bob'), method: 'POST', body: JSON.stringify({ version: created.version }),
    });
    let spawns = 0;
    let observedHandle = null;
    let leasesAtUncertainBoundary = null;
    let childClosedAt = null;
    let acknowledgmentAt = null;
    let remainingLeaseAtAcknowledgment = null;
    const leaseCount = async () => (await postgres.query(`
      select count(*)::int count from orgward.execution_worker_leases where tenant_id = $1 and run_id = $2
    `, ['tenant-a', created.id])).rows[0].count;
    if (mode === 'rollback-after-spawn') {
      app.executionService.store.authorizeExecutionDispatch = (input) => originalAuthorize({
        ...input,
        start: async () => {
          spawns += 1;
          observedHandle = await input.start();
          throw new Error('Injected transaction rollback after child spawn.');
        },
      });
    } else if (mode === 'committed-lost-ack') {
      app.executionService.store.authorizeExecutionDispatch = async (input) => {
        const handle = await originalAuthorize(input);
        observedHandle = handle;
        spawns += 1;
        leasesAtUncertainBoundary = await leaseCount();
        throw new Error('Injected lost dispatch acknowledgment after commit.');
      };
    } else {
      app.executionService.store.authorizeExecutionDispatch = async (input) => {
        const handle = await originalAuthorize(input);
        observedHandle = handle;
        spawns += 1;
        leasesAtUncertainBoundary = await leaseCount();
        handle.child.once('close', () => { childClosedAt = Date.now(); });
        await new Promise((resolve) => setTimeout(resolve, 5_500));
        acknowledgmentAt = Date.now();
        remainingLeaseAtAcknowledgment = (await postgres.query(`
          select floor(extract(epoch from lease_until - now()) * 1000)::int remaining_ms
          from orgward.execution_worker_leases where tenant_id = $1 and run_id = $2
        `, ['tenant-a', created.id])).rows[0]?.remaining_ms ?? null;
        return handle;
      };
    }

    const response = await fetch(`${app.base}/api/execution/runs/${created.id}/execute`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: token('bob') },
      body: JSON.stringify({ version: approved.version }),
    });
    assert.equal(response.status, 200, `${mode}: ${await response.clone().text()}`);
    const interrupted = await response.json();
    assert.equal(interrupted.status, 'INTERRUPTED', mode);
    assert.equal(interrupted.execution.status, 'INTERRUPTED');
    assert.deepEqual(interrupted.execution.changedArtifacts, []);
    assert.equal(interrupted.events.at(-1).type, 'ExecutionInterrupted');
    assert.equal(interrupted.events.some((event) => event.type === 'ExecutionSucceeded'), false);
    assert.equal(spawns, 1);
    if (mode !== 'rollback-after-spawn') assert.equal(leasesAtUncertainBoundary, 1, mode);
    assert.ok(observedHandle.child.exitCode !== null || observedHandle.child.signalCode !== null, 'the child must be closed before the request finishes');
    if (mode === 'late-ack-watchdog') {
      assert.ok(childClosedAt !== null && acknowledgmentAt !== null);
      assert.ok(childClosedAt < acknowledgmentAt - 500, 'watchdog must close the process before the delayed dispatch acknowledgment');
      assert.ok(remainingLeaseAtAcknowledgment > 1_000, 'the uncertain acknowledgment must retain a live recovery fence until the request resolves');
    }
    const retry = await fetch(`${app.base}/api/execution/runs/${created.id}/execute`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: token('bob') },
      body: JSON.stringify({ version: approved.version }),
    });
    assert.equal(retry.status, 409);
    assert.equal(spawns, 1, 'retry must not spawn a second process');
    assert.equal(await leaseCount(), 0, 'terminal execution must remove its lease after finalization');
    const persisted = await request(app.base, `/api/execution/runs/${created.id}`, as('alice'));
    assert.equal(persisted.status, 'INTERRUPTED');
    assert.deepEqual(persisted.execution.changedArtifacts, []);
    const events = await postgres.query(`
      select event_type from orgward.audit_log
      where tenant_id = $1 and aggregate_kind = 'execution_run' and aggregate_id = $2
    `, ['tenant-a', created.id]);
    assert.equal(events.rows.some((row) => row.event_type === 'ExecutionSucceeded'), false);
  }
  app.executionService.store.authorizeExecutionDispatch = originalAuthorize;
});

test('artifact and execution reads enforce tenant, project, authority and integrity boundaries', async (t) => {
  const postgres = await startPostgres();
  const profileRoot = await mkdtemp(path.join(tmpdir(), 'orgward-pg-artifact-profile-'));
  const profile = {
    id: 'pg-artifact-profile', label: 'Artifact profile', kind: 'test', version: '1.0.0',
    executable: process.execPath,
    args: ['-e', "require('node:fs').writeFileSync('private.txt', 'project artifact content')"],
    workspaceRoot: profileRoot,
  };
  const oidcAuthenticator = testOidcAuthenticator();
  let app = await start(postgres.databaseUrl, { executionProfiles: [profile], oidcAuthenticator });
  const token = (subject) => `Bearer ${subject}`;
  const as = (subject) => ({ headers: { authorization: token(subject) } });
  const principal = (subject) => `oidc:${createHash('sha256').update(`https://persistence-identity.example.test\n${subject}`).digest('hex')}`;
  const artifactUrl = (base, runId) => `${base}/api/execution/runs/${runId}/artifact?path=${encodeURIComponent('private.txt')}`;
  t.after(async () => {
    if (app) await close(app);
    await postgres.close();
    await rm(profileRoot, { recursive: true, force: true });
  });

  const project = await request(app.base, '/api/v1/projects', {
    ...as('alice'), method: 'POST', body: command('pg-artifact-project', { name: 'Artifact project' }),
  }, 201);
  await request(app.base, '/api/v1/foundation', as('bob'));
  await request(app.base, `/api/v1/projects/${project.data.id}/members`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal('bob'), access: 'editor' }),
  });
  const carolProject = await request(app.base, '/api/v1/projects', {
    ...as('carol'), method: 'POST', body: command('pg-artifact-carol-project', { name: 'Carol project' }),
  }, 201);
  assert.notEqual(carolProject.data.id, project.data.id);
  const created = await request(app.base, '/api/execution/runs', {
    ...as('alice'), method: 'POST', body: JSON.stringify({
      projectId: project.data.id, profileId: profile.id, title: 'Private artifact', objective: 'Generate a project-scoped file.',
    }),
  }, 201);
  const approved = await request(app.base, `/api/execution/runs/${created.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: created.version }),
  });
  const run = await request(app.base, `/api/execution/runs/${created.id}/execute`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: approved.version }),
  });
  assert.equal(run.status, 'SUCCEEDED');
  const expectedHash = run.execution.changedArtifacts.find((entry) => entry.path === 'private.txt').contentHash;
  const downloaded = await fetch(artifactUrl(app.base, run.id), { headers: { authorization: token('bob') } });
  assert.equal(downloaded.status, 200);
  assert.equal(await downloaded.text(), 'project artifact content');
  assert.equal(downloaded.headers.get('x-content-sha256'), expectedHash);
  const otherProject = await fetch(artifactUrl(app.base, run.id), { headers: { authorization: token('carol') } });
  assert.equal(otherProject.status, 404);

  const identityDirectory = await request(app.base, '/api/v1/identities', as('alice'));
  const bobIdentity = identityDirectory.data.find((identity) => identity.principal === principal('bob'));
  assert.ok(bobIdentity);
  const originalAuthorityRead = app.executionService.store.withPrincipalAuthority.bind(app.executionService.store);
  let authorityReadReached;
  let resumeAuthorityRead;
  const authorityReadPaused = new Promise((resolve) => { authorityReadReached = resolve; });
  const authorityReadGate = new Promise((resolve) => { resumeAuthorityRead = resolve; });
  app.executionService.store.withPrincipalAuthority = async (options) => {
    if (options.principal === principal('bob')) {
      authorityReadReached();
      await authorityReadGate;
    }
    return originalAuthorityRead(options);
  };
  const pendingStaleDownload = fetch(artifactUrl(app.base, run.id), { headers: { authorization: token('bob') } });
  await authorityReadPaused;
  await request(app.base, `/api/v1/identities/${principal('bob')}/roles`, {
    method: 'PUT', headers: { authorization: token('alice') },
    body: JSON.stringify({
      roles: ['workspace-read'], expectedAuthzGeneration: bobIdentity.authzGeneration,
      reason: 'Advance the downloader authority generation before artifact disclosure.',
    }),
  });
  resumeAuthorityRead();
  const staleDownload = await pendingStaleDownload;
  assert.equal(staleDownload.status, 409);
  assert.match((await staleDownload.json()).error, /authority changed/i);
  app.executionService.store.withPrincipalAuthority = originalAuthorityRead;
  await request(app.base, `/api/v1/identities/${principal('bob')}/roles`, {
    method: 'PUT', headers: { authorization: token('alice') },
    body: JSON.stringify({
      roles: bobIdentity.roles, expectedAuthzGeneration: await authzGeneration(app, 'bob'),
      reason: 'Restore editor and execution roles after artifact authorization test.',
    }),
  });

  const currentBobGeneration = await authzGeneration(app, 'bob');
  let detailReadReached;
  let resumeDetailRead;
  const detailReadPaused = new Promise((resolve) => { detailReadReached = resolve; });
  const detailReadGate = new Promise((resolve) => { resumeDetailRead = resolve; });
  app.executionService.store.withPrincipalAuthority = async (options) => {
    if (options.principal === principal('bob')) {
      detailReadReached();
      await detailReadGate;
    }
    return originalAuthorityRead(options);
  };
  const pendingStaleDetail = fetch(`${app.base}/api/execution/runs/${run.id}`, { headers: { authorization: token('bob') } });
  await detailReadPaused;
  await request(app.base, `/api/v1/identities/${principal('bob')}/roles`, {
    method: 'PUT', headers: { authorization: token('alice') },
    body: JSON.stringify({
      roles: ['workspace-read'], expectedAuthzGeneration: currentBobGeneration,
      reason: 'Advance the run-detail reader authority generation before disclosure.',
    }),
  });
  resumeDetailRead();
  const staleDetail = await pendingStaleDetail;
  assert.equal(staleDetail.status, 409);
  const staleDetailBody = await staleDetail.json();
  assert.match(staleDetailBody.error, /authority changed/i);
  assert.equal(staleDetailBody.id, undefined);
  app.executionService.store.withPrincipalAuthority = originalAuthorityRead;
  await request(app.base, `/api/v1/identities/${principal('bob')}/roles`, {
    method: 'PUT', headers: { authorization: token('alice') },
    body: JSON.stringify({
      roles: bobIdentity.roles, expectedAuthzGeneration: await authzGeneration(app, 'bob'),
      reason: 'Restore Bob roles after run-detail authorization test.',
    }),
  });

  const currentBobListGeneration = await authzGeneration(app, 'bob');
  const originalAuthorityList = app.executionService.store.listWithPrincipalAuthority.bind(app.executionService.store);
  let authorityListReached;
  let resumeAuthorityList;
  const authorityListPaused = new Promise((resolve) => { authorityListReached = resolve; });
  const authorityListGate = new Promise((resolve) => { resumeAuthorityList = resolve; });
  app.executionService.store.listWithPrincipalAuthority = async (options) => {
    if (options.principal === principal('bob')) {
      authorityListReached();
      await authorityListGate;
    }
    return originalAuthorityList(options);
  };
  const pendingStaleRunList = fetch(`${app.base}/api/execution/runs`, { headers: { authorization: token('bob') } });
  await authorityListPaused;
  await request(app.base, `/api/v1/identities/${principal('bob')}/roles`, {
    method: 'PUT', headers: { authorization: token('alice') },
    body: JSON.stringify({
      roles: ['workspace-read'], expectedAuthzGeneration: currentBobListGeneration,
      reason: 'Advance the execution-list reader authority generation before disclosure.',
    }),
  });
  resumeAuthorityList();
  const staleRunList = await pendingStaleRunList;
  assert.equal(staleRunList.status, 409);
  const staleRunListBody = await staleRunList.json();
  assert.match(staleRunListBody.error, /authority changed/i);
  assert.equal(staleRunListBody.runs, undefined);
  app.executionService.store.listWithPrincipalAuthority = originalAuthorityList;
  await request(app.base, `/api/v1/identities/${principal('bob')}/roles`, {
    method: 'PUT', headers: { authorization: token('alice') },
    body: JSON.stringify({
      roles: bobIdentity.roles, expectedAuthzGeneration: await authzGeneration(app, 'bob'),
      reason: 'Restore Bob roles after execution-list authorization test.',
    }),
  });

  await close(app); app = null;
  app = await start(postgres.databaseUrl, { executionProfiles: [profile], oidcAuthenticator });
  const afterRestart = await fetch(artifactUrl(app.base, run.id), { headers: { authorization: token('bob') } });
  assert.equal(afterRestart.status, 200);
  assert.equal(afterRestart.headers.get('x-content-sha256'), expectedHash);
  await request(app.base, `/api/v1/projects/${project.data.id}/members/${principal('bob')}/revoke`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({}),
  });
  const afterRevocation = await fetch(artifactUrl(app.base, run.id), { headers: { authorization: token('bob') } });
  assert.equal(afterRevocation.status, 404);
  const ownerDownload = await fetch(artifactUrl(app.base, run.id), { headers: { authorization: token('alice') } });
  assert.equal(ownerDownload.status, 200);
});

test('saved process becomes an isolated durable planning graph without entering execution runs', async (t) => {
  const postgres = await startPostgres();
  const oidcAuthenticator = testOidcAuthenticator();
  oidcAuthenticator.setDisplayName('bob', 'Restricted Assignment Recipient');
  let app = await start(postgres.databaseUrl, { oidcAuthenticator });
  const as = (subject) => ({ headers: { authorization: `Bearer ${subject}` } });
  const principal = (subject) => `oidc:${createHash('sha256').update(`https://persistence-identity.example.test\n${subject}`).digest('hex')}`;
  t.after(async () => { if (app) await close(app); await postgres.close(); });

  let project = (await request(app.base, '/api/v1/projects', {
    ...as('alice'), method: 'POST', body: command('process-plan-project', { name: 'Planned service project' }),
  }, 201)).data;
  const answers = [
    'A repair membership that reduces emergency restaurant downtime.',
    'Restaurant owners receive preventive maintenance and documented repairs.',
    'Monthly membership and parts keep travel, inventory, and cash exposure manageable.',
    'A human approves safety-critical repairs and spending.',
  ];
  for (let index = 0; index < answers.length; index += 1) {
    project = (await request(app.base, `/api/v1/projects/${project.id}/messages`, {
      ...as('alice'), method: 'POST', body: command(`process-plan-answer-${index}`, { content: answers[index] }, project.version),
    })).data;
  }
  assert.equal(project.latestBlueprint.version, 1);
  const bindingRoute = `/api/v1/projects/${project.id}/actor-bindings/proposals`;
  const bindingEnableRoute = `${bindingRoute}/enable`;
  await request(app.base, `/api/v1/projects/${project.id}/members`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal('bob'), access: 'editor' }),
  }, 200);
  const bindingPayload = { actorId: 'actor-founder', roleId: 'role-founder', targetPrincipal: principal('bob'), blueprintVersion: 1 };
  project = (await request(app.base, bindingRoute, {
    ...as('alice'), method: 'POST', body: command('process-plan-binding-proposal', bindingPayload, project.version),
  })).data;
  const bindingEnablePayload = { actorId: bindingPayload.actorId, roleId: bindingPayload.roleId, blueprintVersion: 1 };
  project = (await request(app.base, bindingEnableRoute, {
    ...as('alice'), method: 'POST', body: command('process-plan-binding-enable', bindingEnablePayload, project.version),
  })).data;
  const enabledRows = (await request(app.base, bindingRoute, as('alice'))).data.proposals;
  assert.ok(enabledRows.some((row) => row.status === 'enabled' && row.targetName === 'Restricted Assignment Recipient'
    && row.eligibilityStatus.length === 1 && row.eligibilityStatus[0] === 'eligible'));
  const route = `/api/v1/projects/${project.id}/process-plans`;
  const envelope = command('process-plan-deliver', { processId: 'process-deliver' }, project.version);
  const planned = await request(app.base, route, { ...as('alice'), method: 'POST', body: envelope }, 201);
  const plan = planned.data.processPlans[0];
  assert.equal(plan.state, 'planned');
  assert.equal(plan.epistemicStatus, 'proposed-design');
  assert.equal(plan.source.processId, 'process-deliver');
  assert.equal(plan.source.blueprintVersion, 1);
  assert.ok(plan.tasks.some((task) => task.dependencies.includes('task-process-learn')));
  assert.ok(plan.tasks.every((task) => task.status === 'planned'));
  assert.equal(planned.event.type, 'ProcessTaskGraphPlanned');
  assert.equal(planned.event.data.taskCount, plan.tasks.length);
  assert.deepEqual((await request(app.base, '/api/execution/runs', as('alice'))).runs, []);

  const replay = await request(app.base, route, { ...as('alice'), method: 'POST', body: envelope }, 201);
  assert.equal(replay.meta.replayed, true);
  assert.equal(replay.data.processPlans.length, 1);

  const revisionRoute = `${route}/${plan.id}/revisions`;
  const revisionPayload = { tasks: plan.tasks.map((task, index) => ({
    taskId: task.id, title: index === plan.tasks.length - 1 ? 'Coordinate and record delivery' : task.title,
    detail: index === plan.tasks.length - 1 ? 'Coordinate delivery and record the result.' : task.detail,
    dependencies: task.dependencies, roleId: index === plan.tasks.length - 1 ? 'role-founder' : task.assignee.roleId ?? null,
    actorId: task.id === 'task-process-learn' ? 'actor-founder' : null,
  })) };
  const revisionEnvelope = command('process-plan-edit-v1', revisionPayload, planned.data.version);
  const revised = await request(app.base, revisionRoute, { ...as('alice'), method: 'POST', body: revisionEnvelope });
  assert.equal(revised.data.processPlans.length, 2);
  const revisedPlan = revised.data.processPlans.at(-1);
  assert.equal(revisedPlan.revision, 2);
  assert.equal(revisedPlan.state, 'planned');
  assert.ok(revisedPlan.tasks.every((task) => task.status === 'planned'));
  assert.equal(revisedPlan.tasks.at(-1).title, 'Coordinate and record delivery');
  const assignedTask = revisedPlan.tasks.find((task) => task.id === 'task-process-learn');
  assert.deepEqual(assignedTask.assignee, { kind: 'blueprint-actor', actorId: 'actor-founder', roleId: 'role-founder' });
  assert.equal(Object.hasOwn(assignedTask.assignee, 'targetPrincipal'), false);
  assert.equal(JSON.stringify(revised.data).includes(principal('bob')), false);
  assert.equal(JSON.stringify(revised.data).includes('Restricted Assignment Recipient'), false);
  assert.equal(JSON.stringify(revised.event.data).includes('eligibilityStatus'), false);
  assert.equal(revisedPlan.tasks.at(-1).inputs[0].objectId, plan.tasks.at(-1).inputs[0].objectId);
  assert.equal(revised.data.processPlans[0].tasks.at(-1).title, 'Deliver the core offering', 'older graph revision stays immutable');
  assert.equal(revised.event.type, 'ProcessTaskGraphRevised');
  const revisionReplay = await request(app.base, revisionRoute, { ...as('alice'), method: 'POST', body: revisionEnvelope });
  assert.equal(revisionReplay.meta.replayed, true);
  assert.equal(revisionReplay.data.processPlans.length, 2);
  const bobProjectView = (await request(app.base, `/api/v1/projects/${project.id}`, as('bob'))).data;
  const bobAssignedTask = bobProjectView.processPlans[1].tasks.find((task) => task.id === 'task-process-learn');
  assert.deepEqual(bobAssignedTask.assignee, { kind: 'blueprint-actor', actorId: 'actor-founder', roleId: 'role-founder' });
  assert.equal(JSON.stringify(bobProjectView).includes(principal('bob')), false);
  assert.equal(JSON.stringify(bobProjectView).includes('Restricted Assignment Recipient'), false);
  const wrongTypePayload = structuredClone(revisionPayload);
  wrongTypePayload.tasks.find((task) => task.taskId === 'task-process-learn').detail = 'Refresh the linked role check after each learning task.';
  await app.persistence.query("update orgward.oidc_principals set actor_type='workload' where tenant_id='tenant-a' and principal=$1", [principal('bob')]);
  const wrongType = await request(app.base, revisionRoute, {
    ...as('alice'), method: 'POST', body: command('process-plan-wrong-target-type', wrongTypePayload, revised.data.version),
  }, 409);
  assert.equal(wrongType.error.code, 'PROCESS_PLAN_ACTOR_TYPE_MISMATCH');
  await app.persistence.query("update orgward.oidc_principals set actor_type='human' where tenant_id='tenant-a' and principal=$1", [principal('bob')]);

  const cyclePayload = structuredClone(revisionPayload);
  cyclePayload.tasks[0].dependencies = [cyclePayload.tasks[1].taskId];
  cyclePayload.tasks[1].dependencies = [cyclePayload.tasks[0].taskId];
  const cycle = await request(app.base, revisionRoute, {
    ...as('alice'), method: 'POST', body: command('process-plan-cycle', cyclePayload, revised.data.version),
  }, 409);
  assert.equal(cycle.error.code, 'PROCESS_GRAPH_CYCLE');
  const invalidRolePayload = structuredClone(revisionPayload);
  invalidRolePayload.tasks[0].roleId = 'role-outside-blueprint';
  const invalidRole = await request(app.base, revisionRoute, {
    ...as('alice'), method: 'POST', body: command('process-plan-invalid-role', invalidRolePayload, revised.data.version),
  }, 400);
  assert.equal(invalidRole.error.code, 'INVALID_PROCESS_PLAN_ROLE');
  await request(app.base, revisionRoute, {
    ...as('alice'), method: 'POST', body: command('process-plan-revision-stale', revisionPayload, planned.data.version),
  }, 409);
  await request(app.base, route, {
    ...as('alice'), method: 'POST', body: command('process-plan-invalid', { processId: 'missing-process' }, revised.data.version),
  }, 400);
  await request(app.base, route, {
    ...as('alice'), method: 'POST', body: command('process-plan-stale', { processId: 'process-deliver' }, revised.data.version - 1),
  }, 409);
  await request(app.base, `/api/v1/projects/${project.id}/members`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal('readonly'), access: 'reader' }),
  }, 200);
  await request(app.base, bindingRoute, as('readonly'), 404);
  await request(app.base, route, {
    ...as('readonly'), method: 'POST', body: command('process-plan-reader', { processId: 'process-deliver' }, revised.data.version),
  }, 403);

  const otherProject = (await request(app.base, '/api/v1/projects', {
    ...as('bob'), method: 'POST', body: command('process-plan-other-project', { name: 'Separate workspace' }),
  }, 201)).data;
  await request(app.base, `/api/v1/projects/${otherProject.id}/process-plans`, {
    ...as('alice'), method: 'POST', body: command('process-plan-cross-project', { processId: 'process-deliver' }, otherProject.version),
  }, 404);
  await request(app.base, `/api/v1/projects/${project.id}/members/${principal('bob')}/revoke`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({}),
  }, 200);
  const revokedAssignment = await request(app.base, revisionRoute, {
    ...as('alice'), method: 'POST', body: command('process-plan-revoke-recipient', revisionPayload, revised.data.version),
  }, 409);
  assert.equal(revokedAssignment.error.code, 'PROCESS_PLAN_ACTOR_BINDING_INELIGIBLE');
  await request(app.base, `/api/v1/projects/${project.id}/members`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal('bob'), access: 'editor' }),
  }, 200);
  const regrantedAssignment = await request(app.base, revisionRoute, {
    ...as('alice'), method: 'POST', body: command('process-plan-regrant-recipient', revisionPayload, revised.data.version),
  }, 409);
  assert.equal(regrantedAssignment.error.code, 'PROCESS_PLAN_ACTOR_BINDING_STALE');

  await close(app); app = null;
  app = await start(postgres.databaseUrl, { oidcAuthenticator });
  const restored = (await request(app.base, `/api/v1/projects/${project.id}`, as('alice'))).data;
  assert.equal(restored.processPlans.length, 2);
  assert.equal(restored.processPlans[0].id, plan.id);
  assert.equal(restored.processPlans[1].revision, 2);
  assert.equal(restored.processPlans[1].tasks.every((task) => task.status === 'planned'), true);
  assert.deepEqual((await request(app.base, '/api/execution/runs', as('alice'))).runs, []);
});

test('startup refuses an applied migration whose checksum no longer matches', async (t) => {
  const postgres = await startPostgres();
  let app = await start(postgres.databaseUrl);
  t.after(async () => {
    if (app) await app.close().catch(() => {});
    await postgres.close();
  });
  await close(app);
  app = null;
  await postgres.query("update orgward.schema_migrations set checksum = repeat('0', 64) where version = '001-initial'");
  app = createApp({ databaseUrl: postgres.databaseUrl });
  await assert.rejects(app.init(), /no longer matches the applied checksum/i);
});
