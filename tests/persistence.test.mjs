import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../server.mjs';
import { blueprintPublicationDigest, createProject, validateBlueprint } from '../src/model.mjs';
import { coverageForBlueprint } from '../public/coverage-dashboard.mjs';
import { createChangeCase } from '../src/sdlc/engine.mjs';
import { createExecutionRun, executionApprovalRequestHash, executionEvent } from '../src/execution/contracts.mjs';
import { buildBlueprintProposalPrompt } from '../src/execution/proposals.mjs';
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
  assert.equal(foundation.data.persistence.schemaVersion, '027-process-instance-unverified-abandonment');
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
  const seededStateResult = await app.persistence.query(`select state from orgward.aggregates
    where tenant_id='tenant-a' and aggregate_kind='project' and aggregate_id=$1`, [project.id]);
  const seededState = seededStateResult.rows[0].state;
  const seededBlueprint = seededState.blueprintVersions.at(-1);
  seededBlueprint.areas.customersOfferingsValueEconomics.items.push({
    id: 'customer-secondary', type: 'customer', name: 'Franchise operators',
    detail: 'A second existing customer group for offering relationship coverage.', status: 'designed', confidence: 'medium',
    provenance: [{ source: 'test:serves-relationship-fixture', note: 'Existing customer record for relationship edits.' }],
  });
  seededBlueprint.summary.objectCount += 1;
  seededBlueprint.integrity = validateBlueprint(seededBlueprint);
  await app.persistence.query(`update orgward.aggregates set state=$1::jsonb,state_hash=$2
    where tenant_id='tenant-a' and aggregate_kind='project' and aggregate_id=$3`,
  [JSON.stringify(seededState), contentHash(seededState), project.id]);
  project = (await request(app.base, `/api/v1/projects/${project.id}`)).data;
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

  const customer = project.latestBlueprint.areas.customersOfferingsValueEconomics.items.find((item) => item.id === 'customer-primary');
  const offering = project.latestBlueprint.areas.customersOfferingsValueEconomics.items.find((item) => item.id === 'offering-core');
  const economics = project.latestBlueprint.areas.customersOfferingsValueEconomics.items.find((item) => item.id === 'economics-launch');
  const commercialEdit = { objectId: economics.id, name: 'Subscription and service margin', detail: 'Test monthly fees against parts, travel, support time, and seasonal demand.' };
  const readerDenied = await sendEdit('readonly', 'blueprint-edit-commercial-reader', commercialEdit, project.version, 403);
  assert.equal(readerDenied.error.code, 'ACTION_FORBIDDEN');
  const otherTenantDenied = await sendEdit('tenant-b-admin', 'blueprint-edit-commercial-tenant', {
    objectId: customer.id, name: 'Other tenant customer', detail: 'This project is outside the caller tenant.',
  }, project.version, 404);
  assert.equal(otherTenantDenied.error.code, 'PROJECT_NOT_FOUND');

  const startingCommercialVersion = project.version;
  const commercialEdits = [
    { objectId: customer.id, name: 'Independent restaurant groups', detail: 'Multi-site restaurants that need predictable equipment repair and service records.' },
    { objectId: offering.id, name: 'Managed equipment repair', detail: 'Scheduled maintenance with clear repair approval and completion records.' },
    commercialEdit,
  ];
  for (const [index, payload] of commercialEdits.entries()) {
    const before = project.latestBlueprint.areas.customersOfferingsValueEconomics.items.find((item) => item.id === payload.objectId);
    const saved = await sendEdit('alice', `blueprint-edit-commercial-${index + 1}`, payload, project.version);
    project = saved.data;
    const updated = project.latestBlueprint.areas.customersOfferingsValueEconomics.items.find((item) => item.id === payload.objectId);
    assert.equal(updated.name, payload.name);
    assert.equal(updated.detail, payload.detail);
    assert.equal(project.latestBlueprint.edit.before.detail, before.detail);
    assert.equal(project.latestBlueprint.edit.after.detail, payload.detail);
    assert.equal(project.latestBlueprint.epistemicStatus, 'proposed-design');
  }
  const staleEconomics = await sendEdit('alice', 'blueprint-edit-stale-economics', {
    ...commercialEdit, detail: 'Stale commercial assumptions must not replace newer design.',
  }, startingCommercialVersion, 409);
  assert.equal(staleEconomics.error.code, 'VERSION_CONFLICT');
  const latestCommercial = project.latestBlueprint.areas.customersOfferingsValueEconomics.items.find((item) => item.id === economics.id);
  assert.equal(latestCommercial.owner, 'role-founder');
  assert.equal(latestCommercial.metric, 'metric-sustainability');
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === 'offering-core' && link.target === 'customer-primary' && link.type === 'serves'));

  const findBlueprintObject = (blueprint, objectId) => Object.values(blueprint.areas).flatMap((entry) => entry.items).find((item) => item.id === objectId);
  const restrictedActorVersion = project.version;
  const restrictedActor = await sendEdit('alice', 'blueprint-edit-restricted-actor', {
    objectId: 'actor-founder', name: 'Renamed founder', detail: 'Identity records stay restricted.',
  }, project.version, 400);
  assert.equal(restrictedActor.error.code, 'INVALID_BLUEPRINT_EDIT');
  const actorAfterRejectedRename = await request(app.base, `/api/v1/projects/${project.id}`);
  assert.equal(actorAfterRejectedRename.data.version, restrictedActorVersion);
  assert.equal(actorAfterRejectedRename.data.latestBlueprint.version, project.latestBlueprint.version);
  assert.equal(findBlueprintObject(actorAfterRejectedRename.data.latestBlueprint, 'actor-founder').name, 'Founder');
  assert.equal(findBlueprintObject(actorAfterRejectedRename.data.latestBlueprint, 'actor-founder').detail, 'Human accountable for scope, authority, and launch decisions.');
  const decisionFieldMisuse = await sendEdit('alice', 'blueprint-edit-decision-field-misuse', {
    objectId: 'decision-priority', name: 'Renamed decision', detail: 'Decision ownership uses a decision-maker role field.',
    ownerRoleName: 'Operations owner',
  }, project.version, 400);
  assert.equal(decisionFieldMisuse.error.code, 'INVALID_BLUEPRINT_EDIT');
  const resource = findBlueprintObject(project.latestBlueprint, 'resource-operating-capacity');
  const resourceReaderDenied = await sendEdit('readonly', 'blueprint-edit-resource-reader', {
    objectId: resource.id, name: 'Reader resource edit', detail: 'Readers cannot modify the proposed design.',
  }, project.version, 403);
  assert.equal(resourceReaderDenied.error.code, 'ACTION_FORBIDDEN');
  const resourceUnsupportedField = await sendEdit('alice', 'blueprint-edit-resource-role-field', {
    objectId: resource.id, name: 'Delivery capacity', detail: 'Available repair capacity and scheduling constraints.', proposedInstructions: 'Not a resource field.',
  }, project.version, 400);
  assert.equal(resourceUnsupportedField.error.code, 'INVALID_BLUEPRINT_EDIT');
  const invalidRole = await sendEdit('alice', 'blueprint-edit-resource-unknown-role', {
    objectId: resource.id, name: 'Delivery capacity', detail: 'Available repair capacity and scheduling constraints.', ownerRoleName: 'Unlisted service role',
  }, project.version, 400);
  assert.equal(invalidRole.error.code, 'INVALID_BLUEPRINT_RELATION');

  const ownerEditPrincipals = [principal('alice'), principal('bob'), principal('readonly')];
  const membershipsBeforeOwnerEdits = await app.persistence.query(`select principal, access, generation, revoked_at
    from orgward.project_memberships where tenant_id='tenant-a' and project_id=$1 order by principal`, [project.id]);
  const platformRolesBeforeOwnerEdits = await app.persistence.query(`select principal, roles, authz_generation
    from orgward.oidc_principals where tenant_id='tenant-a' and principal=any($1::text[]) order by principal`, [ownerEditPrincipals]);

  const startingGeneralModelVersion = project.version;
  const broaderModelEdits = [
    { objectId: 'goal-customer-outcome', name: 'Keep restaurants trading', detail: 'Restore essential kitchen equipment quickly enough to protect service continuity.', ownerRoleName: 'Operations owner' },
    { objectId: 'strategy-focused-launch', name: 'Launch with a narrow service area', detail: 'Validate repeat demand and delivery capacity before adding locations.', ownerRoleName: 'Operations owner' },
    { objectId: 'resource-operating-capacity', name: 'Regional repair capacity', detail: 'Technician hours, travel radius, parts availability, and scheduling limits.', ownerRoleName: 'Founder / enterprise owner' },
    { objectId: 'information-customer-signal', name: 'Qualified service request', detail: 'Capture equipment, urgency, site, consent, and evidence source.', ownerRoleName: 'Operations owner' },
    { objectId: 'system-studio', name: 'Private service workspace', detail: 'Store customer requests and service records for authorized internal review.', ownerRoleName: 'Operations owner' },
    { objectId: 'risk-unvalidated-demand', name: 'Insufficient repeat demand', detail: 'Subscription demand may not cover the fixed service and travel costs.', ownerRoleName: 'Operations owner' },
    { objectId: 'control-evidence-review', name: 'Review service and demand evidence', detail: 'A human reviews repeat demand, outcomes, and exceptions before expansion.', ownerRoleName: 'Operations owner' },
    { objectId: 'metric-demand', name: 'Qualified recurring requests', detail: 'Track eligible customer requests by location and repeat frequency.', ownerRoleName: 'Operations owner' },
    { objectId: 'loop-weekly-steering', name: 'Weekly demand and delivery review', detail: 'Review demand, outcome, cost and open risks; record a human-approved next step.', ownerRoleName: 'Operations owner' },
    { objectId: 'lifecycle-enterprise', name: 'Evidence-led service lifecycle', detail: 'Move from proposed design to tested launch, operation, review, and retirement.', ownerRoleName: 'Operations owner' },
  ];
  for (const [index, payload] of broaderModelEdits.entries()) {
    const before = findBlueprintObject(project.latestBlueprint, payload.objectId);
    const relationsBefore = project.latestBlueprint.relations.filter((link) => link.type !== 'owns' || link.target !== payload.objectId);
    const previousRoleName = findBlueprintObject(project.latestBlueprint, before.owner)?.name;
    const saved = await sendEdit('alice', `blueprint-edit-model-area-${index + 1}`, payload, project.version);
    project = saved.data;
    const updated = findBlueprintObject(project.latestBlueprint, payload.objectId);
    const selectedRole = findBlueprintObject(project.latestBlueprint, payload.ownerRoleName === 'Operations owner' ? 'role-operations' : 'role-founder');
    assert.equal(updated.name, payload.name);
    assert.equal(updated.detail, payload.detail);
    assert.equal(updated.owner, selectedRole.id, 'the persisted relation stores the selected role ID');
    assert.equal(project.latestBlueprint.edit.before.detail, before.detail);
    assert.equal(project.latestBlueprint.edit.after.detail, payload.detail);
    assert.equal(project.latestBlueprint.edit.before.ownerRoleName, previousRoleName);
    assert.equal(project.latestBlueprint.edit.after.ownerRoleName, selectedRole.name);
    assert.ok(project.latestBlueprint.relations.some((link) => link.source === selectedRole.id && link.target === payload.objectId && link.type === 'owns'));
    assert.deepEqual(project.latestBlueprint.relations.filter((link) => link.type !== 'owns' || link.target !== payload.objectId), relationsBefore,
      `${payload.objectId} non-ownership references remain intact`);
    assert.equal(updated.status, 'designed');
    assert.equal(project.latestBlueprint.epistemicStatus, 'proposed-design');
  }
  const staleResource = await sendEdit('alice', 'blueprint-edit-stale-resource', {
    objectId: resource.id, name: 'Stale capacity', detail: 'This older resource edit must be rejected.',
  }, startingGeneralModelVersion, 409);
  assert.equal(staleResource.error.code, 'VERSION_CONFLICT');

  const currentOffering = findBlueprintObject(project.latestBlueprint, offering.id);
  const offeringEditBase = { objectId: currentOffering.id, name: currentOffering.name, detail: currentOffering.detail };
  const servingReaderDenied = await sendEdit('readonly', 'blueprint-edit-serving-reader', {
    ...offeringEditBase, servesCustomerIds: ['customer-secondary'],
  }, project.version, 403);
  assert.equal(servingReaderDenied.error.code, 'ACTION_FORBIDDEN');
  const servingCrossTenantDenied = await sendEdit('tenant-b-admin', 'blueprint-edit-serving-cross-tenant', {
    ...offeringEditBase, servesCustomerIds: ['customer-secondary'],
  }, project.version, 404);
  assert.equal(servingCrossTenantDenied.error.code, 'PROJECT_NOT_FOUND');
  const duplicateCustomerTarget = await sendEdit('alice', 'blueprint-edit-serving-duplicate', {
    ...offeringEditBase, servesCustomerIds: ['customer-primary', 'customer-primary'],
  }, project.version, 400);
  assert.equal(duplicateCustomerTarget.error.code, 'INVALID_COMMAND');
  const unknownCustomerTarget = await sendEdit('alice', 'blueprint-edit-serving-unknown', {
    ...offeringEditBase, servesCustomerIds: ['customer-not-present'],
  }, project.version, 400);
  assert.equal(unknownCustomerTarget.error.code, 'INVALID_BLUEPRINT_RELATION');
  const wrongTypeCustomerTarget = await sendEdit('alice', 'blueprint-edit-serving-wrong-type', {
    ...offeringEditBase, servesCustomerIds: ['economics-launch'],
  }, project.version, 400);
  assert.equal(wrongTypeCustomerTarget.error.code, 'INVALID_BLUEPRINT_RELATION');

  const servingStartVersion = project.version;
  const addServing = await sendEdit('alice', 'blueprint-edit-serving-add', {
    ...offeringEditBase, servesCustomerIds: ['customer-primary', 'customer-secondary'],
  }, project.version);
  project = addServing.data;
  assert.deepEqual(findBlueprintObject(project.latestBlueprint, offering.id).serves, ['customer-primary', 'customer-secondary']);
  assert.deepEqual(project.latestBlueprint.edit.before.servesCustomerNames, ['Independent restaurant groups']);
  assert.deepEqual(project.latestBlueprint.edit.after.servesCustomerNames, ['Independent restaurant groups', 'Franchise operators']);
  assert.deepEqual(project.latestBlueprint.relations.filter((link) => link.source === offering.id && link.type === 'serves').map((link) => link.target).sort(),
    ['customer-primary', 'customer-secondary']);
  const servingReplay = await sendEdit('alice', 'blueprint-edit-serving-add', {
    ...offeringEditBase, servesCustomerIds: ['customer-primary', 'customer-secondary'],
  }, servingStartVersion);
  assert.equal(servingReplay.meta.replayed, true);
  assert.equal(servingReplay.data.latestBlueprint.version, project.latestBlueprint.version);

  const removeServing = await sendEdit('alice', 'blueprint-edit-serving-remove', {
    ...offeringEditBase, servesCustomerIds: ['customer-secondary'],
  }, project.version);
  project = removeServing.data;
  assert.deepEqual(findBlueprintObject(project.latestBlueprint, offering.id).serves, ['customer-secondary']);
  assert.deepEqual(project.latestBlueprint.edit.before.servesCustomerNames, ['Independent restaurant groups', 'Franchise operators']);
  assert.deepEqual(project.latestBlueprint.edit.after.servesCustomerNames, ['Franchise operators']);
  assert.deepEqual(project.latestBlueprint.relations.filter((link) => link.source === offering.id && link.type === 'serves').map((link) => link.target), ['customer-secondary']);

  const replaceServing = await sendEdit('alice', 'blueprint-edit-serving-replace', {
    ...offeringEditBase, servesCustomerIds: ['customer-primary'],
  }, project.version);
  project = replaceServing.data;
  assert.deepEqual(findBlueprintObject(project.latestBlueprint, offering.id).serves, ['customer-primary']);
  assert.deepEqual(project.latestBlueprint.edit.before.servesCustomerNames, ['Franchise operators']);
  assert.deepEqual(project.latestBlueprint.edit.after.servesCustomerNames, ['Independent restaurant groups']);
  assert.deepEqual(project.latestBlueprint.relations.filter((link) => link.source === offering.id && link.type === 'serves').map((link) => link.target), ['customer-primary']);
  const staleServing = await sendEdit('alice', 'blueprint-edit-serving-stale', {
    ...offeringEditBase, servesCustomerIds: ['customer-secondary'],
  }, servingStartVersion, 409);
  assert.equal(staleServing.error.code, 'VERSION_CONFLICT');

  const processLearn = findBlueprintObject(project.latestBlueprint, 'process-learn');
  const processReview = findBlueprintObject(project.latestBlueprint, 'process-review');
  const processEditBase = (record) => ({
    objectId: record.id, name: record.name, detail: record.detail,
    ownerRoleName: findBlueprintObject(project.latestBlueprint, record.owner)?.name,
    trigger: record.trigger,
  });
  const processReaderDenied = await sendEdit('readonly', 'blueprint-edit-process-info-reader', {
    ...processEditBase(processLearn), inputInformationIds: ['information-customer-signal'],
  }, project.version, 403);
  assert.equal(processReaderDenied.error.code, 'ACTION_FORBIDDEN');
  const processCrossTenantDenied = await sendEdit('tenant-b-admin', 'blueprint-edit-process-info-cross-tenant', {
    ...processEditBase(processLearn), inputInformationIds: ['information-customer-signal'],
  }, project.version, 404);
  assert.equal(processCrossTenantDenied.error.code, 'PROJECT_NOT_FOUND');
  const duplicateProcessInformation = await sendEdit('alice', 'blueprint-edit-process-info-duplicate', {
    ...processEditBase(processLearn), inputInformationIds: ['information-customer-signal', 'information-customer-signal'],
  }, project.version, 400);
  assert.equal(duplicateProcessInformation.error.code, 'INVALID_COMMAND');
  const unknownProcessInformation = await sendEdit('alice', 'blueprint-edit-process-info-unknown', {
    ...processEditBase(processLearn), inputInformationIds: ['information-not-present'],
  }, project.version, 400);
  assert.equal(unknownProcessInformation.error.code, 'INVALID_BLUEPRINT_RELATION');
  const wrongTypeProcessInformation = await sendEdit('alice', 'blueprint-edit-process-info-wrong-type', {
    ...processEditBase(processLearn), inputInformationIds: ['system-studio'],
  }, project.version, 400);
  assert.equal(wrongTypeProcessInformation.error.code, 'INVALID_BLUEPRINT_RELATION');

  const processFlowStartVersion = project.version;
  const addProcessFlow = await sendEdit('alice', 'blueprint-edit-process-info-add', {
    ...processEditBase(processLearn),
    inputInformationIds: ['information-customer-signal', 'information-delivery-result'],
    outputInformationIds: ['information-prioritised-need', 'information-delivery-result'],
  }, project.version);
  project = addProcessFlow.data;
  assert.deepEqual(findBlueprintObject(project.latestBlueprint, processLearn.id).inputs,
    ['information-customer-signal', 'information-delivery-result']);
  assert.deepEqual(findBlueprintObject(project.latestBlueprint, processLearn.id).outputs,
    ['information-prioritised-need', 'information-delivery-result']);
  assert.deepEqual(project.latestBlueprint.edit.before.inputInformationNames, ['Qualified service request']);
  assert.deepEqual(project.latestBlueprint.edit.after.inputInformationNames, ['Delivery result', 'Qualified service request']);
  assert.deepEqual(project.latestBlueprint.edit.before.outputInformationNames, ['Prioritised customer need']);
  assert.deepEqual(project.latestBlueprint.edit.after.outputInformationNames, ['Delivery result', 'Prioritised customer need']);
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === 'information-delivery-result' && link.target === processLearn.id && link.type === 'input-to'));
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === processLearn.id && link.target === 'information-delivery-result' && link.type === 'produces'));
  const processFlowReplay = await sendEdit('alice', 'blueprint-edit-process-info-add', {
    ...processEditBase(processLearn),
    inputInformationIds: ['information-customer-signal', 'information-delivery-result'],
    outputInformationIds: ['information-prioritised-need', 'information-delivery-result'],
  }, processFlowStartVersion);
  assert.equal(processFlowReplay.meta.replayed, true);
  assert.equal(processFlowReplay.data.latestBlueprint.version, project.latestBlueprint.version);

  const removeProcessFlow = await sendEdit('alice', 'blueprint-edit-process-info-remove', {
    ...processEditBase(processLearn), inputInformationIds: ['information-customer-signal'],
    outputInformationIds: ['information-prioritised-need'],
  }, project.version);
  project = removeProcessFlow.data;
  assert.deepEqual(findBlueprintObject(project.latestBlueprint, processLearn.id).inputs, ['information-customer-signal']);
  assert.deepEqual(findBlueprintObject(project.latestBlueprint, processLearn.id).outputs, ['information-prioritised-need']);
  assert.ok(!project.latestBlueprint.relations.some((link) => link.source === 'information-delivery-result' && link.target === processLearn.id && link.type === 'input-to'));
  assert.ok(!project.latestBlueprint.relations.some((link) => link.source === processLearn.id && link.target === 'information-delivery-result' && link.type === 'produces'));

  const replaceProcessFlow = await sendEdit('alice', 'blueprint-edit-process-info-replace', {
    ...processEditBase(processLearn), inputInformationIds: ['information-prioritised-need'],
    outputInformationIds: ['information-delivery-result'],
  }, project.version);
  project = replaceProcessFlow.data;
  assert.deepEqual(findBlueprintObject(project.latestBlueprint, processLearn.id).inputs, ['information-prioritised-need']);
  assert.deepEqual(findBlueprintObject(project.latestBlueprint, processLearn.id).outputs, ['information-delivery-result']);
  assert.deepEqual(project.latestBlueprint.edit.before.inputInformationNames, ['Qualified service request']);
  assert.deepEqual(project.latestBlueprint.edit.after.inputInformationNames, ['Prioritised customer need']);
  assert.deepEqual(project.latestBlueprint.edit.before.outputInformationNames, ['Prioritised customer need']);
  assert.deepEqual(project.latestBlueprint.edit.after.outputInformationNames, ['Delivery result']);
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === 'information-prioritised-need' && link.target === processLearn.id && link.type === 'input-to'));
  assert.ok(!project.latestBlueprint.relations.some((link) => link.source === 'information-customer-signal' && link.target === processLearn.id && link.type === 'input-to'));

  const reviewEdit = await sendEdit('alice', 'blueprint-edit-process-decision-preserved', {
    ...processEditBase(processReview), outputInformationIds: ['information-delivery-result'],
  }, project.version);
  project = reviewEdit.data;
  const updatedReview = findBlueprintObject(project.latestBlueprint, processReview.id);
  assert.deepEqual(updatedReview.outputs, ['decision-priority', 'information-delivery-result']);
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === processReview.id && link.target === 'decision-priority' && link.type === 'produces'),
    'changing information outputs preserves the existing decision output');
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === processReview.id && link.target === 'information-delivery-result' && link.type === 'produces'));
  const staleProcessFlow = await sendEdit('alice', 'blueprint-edit-process-info-stale', {
    ...processEditBase(processLearn), inputInformationIds: ['information-customer-signal'],
    outputInformationIds: ['information-prioritised-need'],
  }, processFlowStartVersion, 409);
  assert.equal(staleProcessFlow.error.code, 'VERSION_CONFLICT');

  const feedbackLoop = findBlueprintObject(project.latestBlueprint, 'loop-weekly-steering');
  const feedbackLoopEditBase = {
    objectId: feedbackLoop.id, name: feedbackLoop.name, detail: feedbackLoop.detail,
    ownerRoleName: findBlueprintObject(project.latestBlueprint, feedbackLoop.owner)?.name,
  };
  const feedbackReaderDenied = await sendEdit('readonly', 'blueprint-edit-loop-evidence-reader', {
    ...feedbackLoopEditBase, evidenceMetricIds: ['metric-demand'],
  }, project.version, 403);
  assert.equal(feedbackReaderDenied.error.code, 'ACTION_FORBIDDEN');
  const feedbackCrossTenantDenied = await sendEdit('tenant-b-admin', 'blueprint-edit-loop-evidence-cross-tenant', {
    ...feedbackLoopEditBase, evidenceMetricIds: ['metric-demand'],
  }, project.version, 404);
  assert.equal(feedbackCrossTenantDenied.error.code, 'PROJECT_NOT_FOUND');
  const duplicateEvidenceMetric = await sendEdit('alice', 'blueprint-edit-loop-evidence-duplicate', {
    ...feedbackLoopEditBase, evidenceMetricIds: ['metric-demand', 'metric-demand'],
  }, project.version, 400);
  assert.equal(duplicateEvidenceMetric.error.code, 'INVALID_COMMAND');
  const unknownEvidenceMetric = await sendEdit('alice', 'blueprint-edit-loop-evidence-unknown', {
    ...feedbackLoopEditBase, evidenceMetricIds: ['metric-not-present'],
  }, project.version, 400);
  assert.equal(unknownEvidenceMetric.error.code, 'INVALID_BLUEPRINT_RELATION');
  const wrongTypeEvidenceMetric = await sendEdit('alice', 'blueprint-edit-loop-evidence-wrong-type', {
    ...feedbackLoopEditBase, evidenceMetricIds: ['information-delivery-result'],
  }, project.version, 400);
  assert.equal(wrongTypeEvidenceMetric.error.code, 'INVALID_BLUEPRINT_RELATION');
  const evidenceFieldOnProcess = await sendEdit('alice', 'blueprint-edit-loop-evidence-field-on-process', {
    ...processEditBase(processLearn), evidenceMetricIds: ['metric-demand'],
  }, project.version, 400);
  assert.equal(evidenceFieldOnProcess.error.code, 'INVALID_BLUEPRINT_EDIT');

  const evidenceFlowStartVersion = project.version;
  const addEvidenceMetrics = await sendEdit('alice', 'blueprint-edit-loop-evidence-add', {
    ...feedbackLoopEditBase, evidenceMetricIds: ['metric-demand', 'metric-outcome'],
  }, project.version);
  project = addEvidenceMetrics.data;
  assert.deepEqual(findBlueprintObject(project.latestBlueprint, feedbackLoop.id).evidence, ['metric-demand', 'metric-outcome']);
  assert.deepEqual(project.latestBlueprint.edit.before.evidenceMetricNames,
    ['Customer outcome achieved', 'Operating sustainability', 'Qualified recurring requests']);
  assert.deepEqual(project.latestBlueprint.edit.after.evidenceMetricNames,
    ['Customer outcome achieved', 'Qualified recurring requests']);
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === 'metric-demand' && link.target === feedbackLoop.id && link.type === 'evidences'));
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === 'metric-outcome' && link.target === feedbackLoop.id && link.type === 'evidences'));
  assert.ok(!project.latestBlueprint.relations.some((link) => link.source === 'metric-sustainability' && link.target === feedbackLoop.id && link.type === 'evidences'));
  assert.deepEqual(findBlueprintObject(project.latestBlueprint, feedbackLoop.id).decisionIds, ['decision-priority']);
  const evidenceReplay = await sendEdit('alice', 'blueprint-edit-loop-evidence-add', {
    ...feedbackLoopEditBase, evidenceMetricIds: ['metric-demand', 'metric-outcome'],
  }, evidenceFlowStartVersion);
  assert.equal(evidenceReplay.meta.replayed, true);
  assert.equal(evidenceReplay.data.latestBlueprint.version, project.latestBlueprint.version);

  const removeEvidenceMetric = await sendEdit('alice', 'blueprint-edit-loop-evidence-remove', {
    ...feedbackLoopEditBase, evidenceMetricIds: ['metric-demand'],
  }, project.version);
  project = removeEvidenceMetric.data;
  assert.deepEqual(findBlueprintObject(project.latestBlueprint, feedbackLoop.id).evidence, ['metric-demand']);
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === 'metric-demand' && link.target === feedbackLoop.id && link.type === 'evidences'));
  assert.ok(!project.latestBlueprint.relations.some((link) => link.source === 'metric-outcome' && link.target === feedbackLoop.id && link.type === 'evidences'));

  const replaceEvidenceMetric = await sendEdit('alice', 'blueprint-edit-loop-evidence-replace', {
    ...feedbackLoopEditBase, evidenceMetricIds: ['metric-sustainability'],
  }, project.version);
  project = replaceEvidenceMetric.data;
  assert.deepEqual(findBlueprintObject(project.latestBlueprint, feedbackLoop.id).evidence, ['metric-sustainability']);
  assert.deepEqual(project.latestBlueprint.edit.before.evidenceMetricNames, ['Qualified recurring requests']);
  assert.deepEqual(project.latestBlueprint.edit.after.evidenceMetricNames, ['Operating sustainability']);
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === 'metric-sustainability' && link.target === feedbackLoop.id && link.type === 'evidences'));
  assert.ok(!project.latestBlueprint.relations.some((link) => link.source === 'metric-demand' && link.target === feedbackLoop.id && link.type === 'evidences'));
  assert.deepEqual(findBlueprintObject(project.latestBlueprint, feedbackLoop.id).decisionIds, ['decision-priority']);
  const staleEvidenceMetric = await sendEdit('alice', 'blueprint-edit-loop-evidence-stale', {
    ...feedbackLoopEditBase, evidenceMetricIds: ['metric-demand'],
  }, evidenceFlowStartVersion, 409);
  assert.equal(staleEvidenceMetric.error.code, 'VERSION_CONFLICT');

  const demandMetric = findBlueprintObject(project.latestBlueprint, 'metric-demand');
  const demandMetricEditBase = {
    objectId: demandMetric.id, name: demandMetric.name, detail: demandMetric.detail,
    ownerRoleName: findBlueprintObject(project.latestBlueprint, demandMetric.owner)?.name,
  };
  const readFieldOnLoop = await sendEdit('alice', 'blueprint-edit-read-source-field-on-loop', {
    objectId: feedbackLoop.id, name: feedbackLoop.name, detail: feedbackLoop.detail,
    ownerRoleName: findBlueprintObject(project.latestBlueprint, feedbackLoop.owner)?.name,
    readInformationId: 'information-customer-signal',
  }, project.version, 400);
  assert.equal(readFieldOnLoop.error.code, 'INVALID_BLUEPRINT_EDIT');
  const economicsMetric = findBlueprintObject(project.latestBlueprint, 'metric-sustainability');
  const readFieldOnEconomicsMetric = await sendEdit('alice', 'blueprint-edit-read-source-on-economics-metric', {
    objectId: economicsMetric.id, name: economicsMetric.name, detail: economicsMetric.detail,
    ownerRoleName: findBlueprintObject(project.latestBlueprint, economicsMetric.owner)?.name,
    readInformationId: 'information-delivery-result',
  }, project.version, 400);
  assert.equal(readFieldOnEconomicsMetric.error.code, 'INVALID_BLUEPRINT_EDIT');
  const duplicateReadSources = await sendEdit('alice', 'blueprint-edit-read-source-duplicate', {
    ...demandMetricEditBase, readInformationId: ['information-customer-signal', 'information-customer-signal'],
  }, project.version, 400);
  assert.equal(duplicateReadSources.error.code, 'INVALID_COMMAND');
  const unknownReadSource = await sendEdit('alice', 'blueprint-edit-read-source-unknown', {
    ...demandMetricEditBase, readInformationId: 'information-not-present',
  }, project.version, 400);
  assert.equal(unknownReadSource.error.code, 'INVALID_BLUEPRINT_RELATION');
  const wrongTypeReadSource = await sendEdit('alice', 'blueprint-edit-read-source-wrong-type', {
    ...demandMetricEditBase, readInformationId: 'metric-outcome',
  }, project.version, 400);
  assert.equal(wrongTypeReadSource.error.code, 'INVALID_BLUEPRINT_RELATION');
  const readSourceReaderDenied = await sendEdit('readonly', 'blueprint-edit-read-source-reader', {
    ...demandMetricEditBase, readInformationId: null,
  }, project.version, 403);
  assert.equal(readSourceReaderDenied.error.code, 'ACTION_FORBIDDEN');
  const readSourceCrossTenantDenied = await sendEdit('tenant-b-admin', 'blueprint-edit-read-source-cross-tenant', {
    ...demandMetricEditBase, readInformationId: null,
  }, project.version, 404);
  assert.equal(readSourceCrossTenantDenied.error.code, 'PROJECT_NOT_FOUND');

  const readSourceStartVersion = project.version;
  const readSourceStartBlueprintVersion = project.latestBlueprint.version;
  const clearReadSource = await sendEdit('alice', 'blueprint-edit-read-source-clear', {
    ...demandMetricEditBase, readInformationId: null,
  }, project.version);
  project = clearReadSource.data;
  assert.equal(findBlueprintObject(project.latestBlueprint, demandMetric.id).reads, null);
  assert.equal(project.latestBlueprint.edit.before.readInformationName, 'Qualified service request');
  assert.equal(project.latestBlueprint.edit.after.readInformationName, null);
  assert.ok(!project.latestBlueprint.relations.some((link) => link.target === demandMetric.id && link.type === 'read-by'));
  assert.equal(findBlueprintObject(project.latestBlueprint, demandMetric.id).owner, 'role-operations');
  assert.equal(findBlueprintObject(project.latestBlueprint, demandMetric.id).consumerLoop, 'loop-weekly-steering');
  await close(app);
  app = await start(postgres.databaseUrl);
  project = (await request(app.base, `/api/v1/projects/${project.id}`)).data;
  assert.equal(project.latestBlueprint.version, readSourceStartBlueprintVersion + 1);
  assert.equal(findBlueprintObject(project.latestBlueprint, demandMetric.id).reads, null,
    'a cleared information source stays clear across restart');
  assert.ok(!project.latestBlueprint.relations.some((link) => link.target === demandMetric.id && link.type === 'read-by'));
  assert.equal(project.latestBlueprint.edit.after.readInformationName, null);
  const addReadSource = await sendEdit('alice', 'blueprint-edit-read-source-add', {
    ...demandMetricEditBase, readInformationId: 'information-customer-signal',
  }, project.version);
  project = addReadSource.data;
  assert.equal(findBlueprintObject(project.latestBlueprint, demandMetric.id).reads, 'information-customer-signal');
  assert.equal(project.latestBlueprint.edit.before.readInformationName, null);
  assert.equal(project.latestBlueprint.edit.after.readInformationName, 'Qualified service request');
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === 'information-customer-signal' && link.target === demandMetric.id && link.type === 'read-by'));
  const replaceReadSource = await sendEdit('alice', 'blueprint-edit-read-source-replace', {
    ...demandMetricEditBase, readInformationId: 'information-prioritised-need',
  }, project.version);
  project = replaceReadSource.data;
  assert.equal(findBlueprintObject(project.latestBlueprint, demandMetric.id).reads, 'information-prioritised-need');
  assert.equal(project.latestBlueprint.edit.before.readInformationName, 'Qualified service request');
  assert.equal(project.latestBlueprint.edit.after.readInformationName, 'Prioritised customer need');
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === 'information-prioritised-need' && link.target === demandMetric.id && link.type === 'read-by'));
  assert.ok(!project.latestBlueprint.relations.some((link) => link.source === 'information-customer-signal' && link.target === demandMetric.id && link.type === 'read-by'));
  const readSourceReplay = await sendEdit('alice', 'blueprint-edit-read-source-clear', {
    ...demandMetricEditBase, readInformationId: null,
  }, readSourceStartVersion);
  assert.equal(readSourceReplay.meta.replayed, true);
  assert.equal(readSourceReplay.data.latestBlueprint.version, readSourceStartBlueprintVersion + 1);
  assert.equal(project.latestBlueprint.version, readSourceStartBlueprintVersion + 3);
  const staleReadSource = await sendEdit('alice', 'blueprint-edit-read-source-stale', {
    ...demandMetricEditBase, readInformationId: 'information-customer-signal',
  }, readSourceStartVersion, 409);
  assert.equal(staleReadSource.error.code, 'VERSION_CONFLICT');

  const goal = findBlueprintObject(project.latestBlueprint, 'goal-customer-outcome');
  const launchEconomics = findBlueprintObject(project.latestBlueprint, 'economics-launch');
  const metricLinkEditBase = (record) => ({
    objectId: record.id, name: record.name, detail: record.detail,
    ownerRoleName: findBlueprintObject(project.latestBlueprint, record.owner)?.name,
  });
  const goalReaderDenied = await sendEdit('readonly', 'blueprint-edit-goal-metric-reader', {
    ...metricLinkEditBase(goal), metricId: null,
  }, project.version, 403);
  assert.equal(goalReaderDenied.error.code, 'ACTION_FORBIDDEN');
  const economicsCrossTenantDenied = await sendEdit('tenant-b-admin', 'blueprint-edit-economics-metric-cross-tenant', {
    ...metricLinkEditBase(launchEconomics), metricId: null,
  }, project.version, 404);
  assert.equal(economicsCrossTenantDenied.error.code, 'PROJECT_NOT_FOUND');
  const duplicateMetricId = await sendEdit('alice', 'blueprint-edit-goal-metric-duplicate', {
    ...metricLinkEditBase(goal), metricId: ['metric-demand', 'metric-demand'],
  }, project.version, 400);
  assert.equal(duplicateMetricId.error.code, 'INVALID_COMMAND');
  const unknownMetricId = await sendEdit('alice', 'blueprint-edit-goal-metric-unknown', {
    ...metricLinkEditBase(goal), metricId: 'metric-not-present',
  }, project.version, 400);
  assert.equal(unknownMetricId.error.code, 'INVALID_BLUEPRINT_RELATION');
  const wrongTypeMetricId = await sendEdit('alice', 'blueprint-edit-economics-metric-wrong-type', {
    ...metricLinkEditBase(launchEconomics), metricId: 'information-delivery-result',
  }, project.version, 400);
  assert.equal(wrongTypeMetricId.error.code, 'INVALID_BLUEPRINT_RELATION');
  const capabilityMetricFieldMisuse = await sendEdit('alice', 'blueprint-edit-capability-scalar-metric-misuse', {
    objectId: 'capability-delivery', name: 'Offer delivery', detail: 'Reliably create and deliver the promised customer result.',
    ownerRoleName: findBlueprintObject(project.latestBlueprint, 'capability-delivery').owner === 'role-operations'
      ? 'Operations owner' : 'Founder / enterprise owner', metricId: 'metric-outcome',
  }, project.version, 400);
  assert.equal(capabilityMetricFieldMisuse.error.code, 'INVALID_BLUEPRINT_EDIT');
  assert.deepEqual(findBlueprintObject(project.latestBlueprint, 'capability-delivery').metrics, ['metric-outcome']);

  const metricLinkStartVersion = project.version;
  const metricLinkStartBlueprintVersion = project.latestBlueprint.version;
  const metricLinkEdits = [
    { object: goal, metricId: null, commandId: 'blueprint-edit-goal-metric-clear' },
    { object: goal, metricId: 'metric-demand', commandId: 'blueprint-edit-goal-metric-add' },
    { object: goal, metricId: 'metric-outcome', commandId: 'blueprint-edit-goal-metric-replace' },
    { object: goal, metricId: null, commandId: 'blueprint-edit-goal-metric-clear-again' },
    { object: goal, metricId: 'metric-demand', commandId: 'blueprint-edit-goal-metric-readd' },
    { object: launchEconomics, metricId: null, commandId: 'blueprint-edit-economics-metric-clear' },
    { object: launchEconomics, metricId: 'metric-demand', commandId: 'blueprint-edit-economics-metric-add' },
    { object: launchEconomics, metricId: 'metric-outcome', commandId: 'blueprint-edit-economics-metric-replace' },
    { object: launchEconomics, metricId: null, commandId: 'blueprint-edit-economics-metric-clear-again' },
    { object: launchEconomics, metricId: 'metric-sustainability', commandId: 'blueprint-edit-economics-metric-readd' },
  ];
  const metricName = (blueprint, metricId) => metricId
    ? findBlueprintObject(blueprint, metricId)?.name ?? 'Unknown metric'
    : null;
  let firstGoalMetricClearBody;
  for (const [index, edit] of metricLinkEdits.entries()) {
    const before = findBlueprintObject(project.latestBlueprint, edit.object.id);
    const payload = { ...metricLinkEditBase(before), metricId: edit.metricId };
    const expectedBeforeName = metricName(project.latestBlueprint, before.metric);
    const saved = await sendEdit('alice', edit.commandId, payload, project.version);
    project = saved.data;
    if (index === 0) firstGoalMetricClearBody = command(edit.commandId, payload, metricLinkStartVersion);
    const updated = findBlueprintObject(project.latestBlueprint, edit.object.id);
    assert.equal(updated.metric, edit.metricId);
    assert.equal(project.latestBlueprint.edit.before.metricName, expectedBeforeName);
    assert.equal(project.latestBlueprint.edit.after.metricName, metricName(project.latestBlueprint, edit.metricId));
    assert.deepEqual(project.latestBlueprint.relations.filter((link) => link.target === edit.object.id && link.type === 'measures').map((link) => link.source),
      edit.metricId === null ? [] : [edit.metricId]);
  }
  const goalMetricReplay = await request(app.base, route, { method: 'POST', body: firstGoalMetricClearBody });
  assert.equal(goalMetricReplay.meta.replayed, true);
  assert.equal(goalMetricReplay.data.latestBlueprint.version, metricLinkStartBlueprintVersion + 1);
  assert.equal(project.latestBlueprint.version, metricLinkStartBlueprintVersion + metricLinkEdits.length);
  const staleMetricLink = await sendEdit('alice', 'blueprint-edit-goal-metric-stale', {
    ...metricLinkEditBase(goal), metricId: 'metric-outcome',
  }, metricLinkStartVersion, 409);
  assert.equal(staleMetricLink.error.code, 'VERSION_CONFLICT');
  assert.deepEqual(findBlueprintObject(project.latestBlueprint, 'capability-delivery').metrics, ['metric-outcome']);
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === 'metric-outcome' && link.target === 'capability-delivery' && link.type === 'measures'));

  const coverageBeforeRestart = coverageForBlueprint(project.latestBlueprint);
  assert.equal(coverageBeforeRestart.blueprintVersion, 40);
  assert.equal(coverageBeforeRestart.gaps.length, project.latestBlueprint.integrity.gaps.length);

  const savedEvents = await app.persistence.query(`
    select count(*)::int as count from orgward.audit_log
    where tenant_id = 'tenant-a' and aggregate_id = $1 and event_type = 'BlueprintObjectEdited'
  `, [project.id]);
  assert.equal(savedEvents.rows[0].count, 39);
  const versionsBeforeRestart = project.blueprintVersions.length;
  await close(app);
  app = await start(postgres.databaseUrl);
  const restored = await request(app.base, `/api/v1/projects/${project.id}`);
  assert.equal(restored.data.blueprintVersions.length, versionsBeforeRestart);
  assert.equal(restored.data.latestBlueprint.version, 40);
  assert.equal(restored.data.latestBlueprint.areas.capabilitiesProcesses.items.find((item) => item.id === delivery.id).owner, 'role-founder');
  const restoredCommercial = restored.data.latestBlueprint.areas.customersOfferingsValueEconomics.items;
  assert.equal(restoredCommercial.find((item) => item.id === 'customer-primary').name, 'Independent restaurant groups');
  assert.equal(restoredCommercial.find((item) => item.id === 'offering-core').name, 'Managed equipment repair');
  assert.deepEqual(restoredCommercial.find((item) => item.id === 'offering-core').serves, ['customer-primary']);
  assert.deepEqual(restored.data.blueprintVersions.find((blueprint) => blueprint.version === 18).edit.after.servesCustomerNames,
    ['Independent restaurant groups', 'Franchise operators']);
  assert.deepEqual(restored.data.blueprintVersions.find((blueprint) => blueprint.version === 19).edit.after.servesCustomerNames,
    ['Franchise operators']);
  assert.deepEqual(restored.data.blueprintVersions.find((blueprint) => blueprint.version === 20).edit.after.servesCustomerNames,
    ['Independent restaurant groups']);
  assert.deepEqual(restored.data.blueprintVersions.find((blueprint) => blueprint.version === 21).edit.after.inputInformationNames,
    ['Delivery result', 'Qualified service request']);
  assert.deepEqual(restored.data.blueprintVersions.find((blueprint) => blueprint.version === 22).edit.after.inputInformationNames,
    ['Qualified service request']);
  assert.deepEqual(restored.data.blueprintVersions.find((blueprint) => blueprint.version === 23).edit.after.inputInformationNames,
    ['Prioritised customer need']);
  assert.deepEqual(restored.data.blueprintVersions.find((blueprint) => blueprint.version === 23).edit.after.outputInformationNames,
    ['Delivery result']);
  assert.deepEqual(restored.data.blueprintVersions.find((blueprint) => blueprint.version === 24).edit.before.outputInformationNames, []);
  assert.deepEqual(restored.data.blueprintVersions.find((blueprint) => blueprint.version === 24).edit.after.outputInformationNames,
    ['Delivery result']);
  assert.deepEqual(restored.data.blueprintVersions.find((blueprint) => blueprint.version === 25).edit.after.evidenceMetricNames,
    ['Customer outcome achieved', 'Qualified recurring requests']);
  assert.deepEqual(restored.data.blueprintVersions.find((blueprint) => blueprint.version === 26).edit.after.evidenceMetricNames,
    ['Qualified recurring requests']);
  assert.deepEqual(restored.data.blueprintVersions.find((blueprint) => blueprint.version === 27).edit.before.evidenceMetricNames,
    ['Qualified recurring requests']);
  assert.deepEqual(restored.data.blueprintVersions.find((blueprint) => blueprint.version === 27).edit.after.evidenceMetricNames,
    ['Operating sustainability']);
  assert.equal(restored.data.blueprintVersions.find((blueprint) => blueprint.version === 28).edit.before.readInformationName,
    'Qualified service request');
  assert.equal(restored.data.blueprintVersions.find((blueprint) => blueprint.version === 28).edit.after.readInformationName, null);
  assert.equal(restored.data.blueprintVersions.find((blueprint) => blueprint.version === 29).edit.before.readInformationName, null);
  assert.equal(restored.data.blueprintVersions.find((blueprint) => blueprint.version === 29).edit.after.readInformationName,
    'Qualified service request');
  assert.equal(restored.data.blueprintVersions.find((blueprint) => blueprint.version === 30).edit.before.readInformationName,
    'Qualified service request');
  assert.equal(restored.data.blueprintVersions.find((blueprint) => blueprint.version === 30).edit.after.readInformationName,
    'Prioritised customer need');
  assert.equal(restored.data.blueprintVersions.find((blueprint) => blueprint.version === 31).edit.before.metricName,
    'Customer outcome achieved');
  assert.equal(restored.data.blueprintVersions.find((blueprint) => blueprint.version === 31).edit.after.metricName, null);
  assert.equal(restored.data.blueprintVersions.find((blueprint) => blueprint.version === 35).edit.after.metricName,
    'Qualified recurring requests');
  assert.equal(restored.data.blueprintVersions.find((blueprint) => blueprint.version === 36).edit.before.metricName,
    'Operating sustainability');
  assert.equal(restored.data.blueprintVersions.find((blueprint) => blueprint.version === 40).edit.after.metricName,
    'Operating sustainability');
  const restoredReview = findBlueprintObject(restored.data.latestBlueprint, processReview.id);
  assert.deepEqual(restoredReview.outputs, ['decision-priority', 'information-delivery-result']);
  assert.ok(restored.data.latestBlueprint.relations.some((link) => link.source === processReview.id && link.target === 'decision-priority' && link.type === 'produces'));
  const restoredFeedbackLoop = findBlueprintObject(restored.data.latestBlueprint, feedbackLoop.id);
  assert.deepEqual(restoredFeedbackLoop.evidence, ['metric-sustainability']);
  assert.deepEqual(restoredFeedbackLoop.decisionIds, ['decision-priority']);
  assert.ok(restored.data.latestBlueprint.relations.some((link) => link.source === 'metric-sustainability' && link.target === feedbackLoop.id && link.type === 'evidences'));
  assert.ok(!restored.data.latestBlueprint.relations.some((link) => link.source === 'metric-demand' && link.target === feedbackLoop.id && link.type === 'evidences'));
  const restoredDemandMetric = findBlueprintObject(restored.data.latestBlueprint, demandMetric.id);
  assert.equal(restoredDemandMetric.reads, 'information-prioritised-need');
  assert.equal(restoredDemandMetric.owner, 'role-operations');
  assert.equal(restoredDemandMetric.consumerLoop, 'loop-weekly-steering');
  assert.ok(restored.data.latestBlueprint.relations.some((link) => link.source === 'information-prioritised-need' && link.target === demandMetric.id && link.type === 'read-by'));
  assert.ok(!restored.data.latestBlueprint.relations.some((link) => link.source === 'information-customer-signal' && link.target === demandMetric.id && link.type === 'read-by'));
  assert.equal(findBlueprintObject(restored.data.latestBlueprint, 'metric-sustainability').reads, 'economics-launch');
  assert.ok(restored.data.latestBlueprint.relations.some((link) => link.source === 'economics-launch' && link.target === 'metric-sustainability' && link.type === 'read-by'));
  assert.equal(findBlueprintObject(restored.data.latestBlueprint, goal.id).metric, 'metric-demand');
  assert.equal(findBlueprintObject(restored.data.latestBlueprint, launchEconomics.id).metric, 'metric-sustainability');
  assert.ok(restored.data.latestBlueprint.relations.some((link) => link.source === 'metric-demand' && link.target === goal.id && link.type === 'measures'));
  assert.ok(restored.data.latestBlueprint.relations.some((link) => link.source === 'metric-sustainability' && link.target === launchEconomics.id && link.type === 'measures'));
  assert.ok(!restored.data.latestBlueprint.relations.some((link) => link.source === 'metric-outcome' && link.target === goal.id && link.type === 'measures'));
  assert.deepEqual(findBlueprintObject(restored.data.latestBlueprint, 'capability-delivery').metrics, ['metric-outcome']);
  assert.ok(restored.data.latestBlueprint.relations.some((link) => link.source === 'metric-outcome' && link.target === 'capability-delivery' && link.type === 'measures'));
  assert.equal(restoredCommercial.find((item) => item.id === 'economics-launch').detail, commercialEdit.detail);
  assert.equal(findBlueprintObject(restored.data.latestBlueprint, 'goal-customer-outcome').owner, 'role-operations');
  assert.equal(findBlueprintObject(restored.data.latestBlueprint, 'resource-operating-capacity').name, 'Regional repair capacity');
  assert.equal(findBlueprintObject(restored.data.latestBlueprint, 'resource-operating-capacity').owner, 'role-founder');
  assert.equal(findBlueprintObject(restored.data.latestBlueprint, 'system-studio').detail, broaderModelEdits[4].detail);
  assert.equal(findBlueprintObject(restored.data.latestBlueprint, 'risk-unvalidated-demand').detail, broaderModelEdits[5].detail);
  assert.equal(findBlueprintObject(restored.data.latestBlueprint, 'risk-unvalidated-demand').owner, 'role-operations');
  assert.equal(findBlueprintObject(restored.data.latestBlueprint, 'control-evidence-review').detail, broaderModelEdits[6].detail);
  assert.equal(findBlueprintObject(restored.data.latestBlueprint, 'control-evidence-review').owner, 'role-operations');
  assert.equal(findBlueprintObject(restored.data.latestBlueprint, 'metric-demand').name, 'Qualified recurring requests');
  assert.equal(findBlueprintObject(restored.data.latestBlueprint, 'loop-weekly-steering').detail, broaderModelEdits[8].detail);
  assert.equal(findBlueprintObject(restored.data.latestBlueprint, 'lifecycle-enterprise').name, 'Evidence-led service lifecycle');
  assert.ok(restored.data.latestBlueprint.relations.some((link) => link.source === 'control-evidence-review' && link.target === 'risk-unvalidated-demand' && link.type === 'mitigates'));
  assert.ok(restored.data.latestBlueprint.relations.some((link) => link.source === 'information-prioritised-need' && link.target === 'metric-demand' && link.type === 'read-by'));
  assert.equal(restored.data.blueprintVersions[0].areas.customersOfferingsValueEconomics.items.find((item) => item.id === 'economics-launch').detail, economics.detail,
    'the original economics remain in the immutable discovery version');
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
  assert.deepEqual((await app.persistence.query(`select principal, access, generation, revoked_at
    from orgward.project_memberships where tenant_id='tenant-a' and project_id=$1 order by principal`, [project.id])).rows,
  membershipsBeforeOwnerEdits.rows, 'design ownership changes do not change project membership');
  assert.deepEqual((await app.persistence.query(`select principal, roles, authz_generation
    from orgward.oidc_principals where tenant_id='tenant-a' and principal=any($1::text[]) order by principal`, [ownerEditPrincipals])).rows,
  platformRolesBeforeOwnerEdits.rows, 'design ownership changes do not change tenant platform roles');
  assert.deepEqual(coverageForBlueprint(restored.data.latestBlueprint), coverageBeforeRestart);
  const replayAfterRestart = await request(app.base, route, { method: 'POST', body: firstEditBody });
  assert.equal(replayAfterRestart.meta.replayed, true);
  assert.equal(replayAfterRestart.data.blueprintVersions.length, 2, 'a replay returns its original committed snapshot without creating another version');
  const finalEvents = await app.persistence.query(`
    select count(*)::int as count from orgward.audit_log
    where tenant_id = 'tenant-a' and aggregate_id = $1 and event_type = 'BlueprintObjectEdited'
  `, [project.id]);
  assert.equal(finalEvents.rows[0].count, 39);
});

test('offering capability enablers edit proposed links with replay, history and restart integrity', async (t) => {
  const postgres = await startPostgres();
  let app = await start(postgres.databaseUrl);
  t.after(async () => { if (app) await close(app); await postgres.close(); });
  const issuer = 'https://persistence-identity.example.test';
  const principal = (subject) => `oidc:${createHash('sha256').update(`${issuer}\n${subject}`).digest('hex')}`;
  const created = await request(app.base, '/api/v1/projects', {
    method: 'POST', body: command('enabledby-project', { name: 'Offering enablement test' }),
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
      method: 'POST', body: command(`enabledby-answer-${index + 1}`, { content }, project.version),
    })).data;
  }
  const route = `/api/v1/projects/${project.id}/blueprint/edits`;
  const sendEdit = (subject, commandId, payload, expectedVersion = project.version, expected = 200) => request(app.base, route, {
    method: 'POST', headers: { authorization: `Bearer ${subject}` },
    body: command(commandId, payload, expectedVersion),
  }, expected);
  const offering = project.latestBlueprint.areas.customersOfferingsValueEconomics.items.find((item) => item.id === 'offering-core');
  const editBase = { objectId: offering.id, name: offering.name, detail: offering.detail };
  const membersBefore = await app.persistence.query(`select principal, access, generation, revoked_at
    from orgward.project_memberships where tenant_id='tenant-a' and project_id=$1 order by principal`, [project.id]);
  const rolesBefore = await app.persistence.query(`select principal, roles, authz_generation
    from orgward.oidc_principals where tenant_id='tenant-a' and principal=any($1::text[]) order by principal`,
  [[principal('alice'), principal('bob'), principal('readonly')]]);
  const initialVersion = project.version;
  const reader = await sendEdit('readonly', 'enabledby-reader', { ...editBase, enabledByCapabilityIds: ['capability-steering'] }, project.version, 403);
  assert.equal(reader.error.code, 'ACTION_FORBIDDEN');
  const crossTenant = await sendEdit('tenant-b-admin', 'enabledby-cross-tenant', { ...editBase, enabledByCapabilityIds: ['capability-steering'] }, project.version, 404);
  assert.equal(crossTenant.error.code, 'PROJECT_NOT_FOUND');
  const duplicate = await sendEdit('alice', 'enabledby-duplicate', { ...editBase, enabledByCapabilityIds: ['capability-delivery', 'capability-delivery'] }, project.version, 400);
  assert.equal(duplicate.error.code, 'INVALID_COMMAND');
  const unknown = await sendEdit('alice', 'enabledby-unknown', { ...editBase, enabledByCapabilityIds: ['capability-missing'] }, project.version, 400);
  assert.equal(unknown.error.code, 'INVALID_BLUEPRINT_RELATION');
  const wrongType = await sendEdit('alice', 'enabledby-wrong-type', { ...editBase, enabledByCapabilityIds: ['economics-launch'] }, project.version, 400);
  assert.equal(wrongType.error.code, 'INVALID_BLUEPRINT_RELATION');
  const fieldMisuse = await sendEdit('alice', 'enabledby-field-misuse', {
    objectId: 'capability-delivery', name: 'Offer delivery', detail: 'Reliably deliver the promised customer result.', enabledByCapabilityIds: [],
  }, project.version, 400);
  assert.equal(fieldMisuse.error.code, 'INVALID_BLUEPRINT_EDIT');

  const added = await sendEdit('alice', 'enabledby-add', { ...editBase, enabledByCapabilityIds: ['capability-customer-discovery', 'capability-delivery', 'capability-steering'] }, project.version);
  project = added.data;
  const enabledByIds = (value) => value.areas.customersOfferingsValueEconomics.items.find((item) => item.id === offering.id).enabledBy;
  const enables = (value) => value.relations.filter((link) => link.target === offering.id && link.type === 'enables').map((link) => link.source).sort();
  assert.deepEqual(enabledByIds(project.latestBlueprint).sort(), ['capability-customer-discovery', 'capability-delivery', 'capability-steering']);
  assert.deepEqual(enables(project.latestBlueprint), ['capability-customer-discovery', 'capability-delivery', 'capability-steering']);
  assert.deepEqual(project.latestBlueprint.edit.before.enabledByCapabilityNames, ['Customer discovery', 'Offer delivery']);
  assert.deepEqual(project.latestBlueprint.edit.after.enabledByCapabilityNames, ['Customer discovery', 'Enterprise steering', 'Offer delivery']);
  assert.deepEqual(project.latestBlueprint.areas.customersOfferingsValueEconomics.items.find((item) => item.id === offering.id).serves, ['customer-primary']);
  const replay = await sendEdit('alice', 'enabledby-add', { ...editBase, enabledByCapabilityIds: ['capability-customer-discovery', 'capability-delivery', 'capability-steering'] }, initialVersion);
  assert.equal(replay.meta.replayed, true);
  const conflict = await sendEdit('alice', 'enabledby-add', { ...editBase, enabledByCapabilityIds: ['capability-delivery'] }, initialVersion, 409);
  assert.equal(conflict.error.code, 'IDEMPOTENCY_CONFLICT');

  const removed = await sendEdit('alice', 'enabledby-remove', { ...editBase, enabledByCapabilityIds: ['capability-steering'] }, project.version);
  project = removed.data;
  assert.deepEqual(enabledByIds(project.latestBlueprint), ['capability-steering']);
  assert.deepEqual(enables(project.latestBlueprint), ['capability-steering']);
  assert.deepEqual(project.latestBlueprint.edit.before.enabledByCapabilityNames, ['Customer discovery', 'Enterprise steering', 'Offer delivery']);
  assert.deepEqual(project.latestBlueprint.edit.after.enabledByCapabilityNames, ['Enterprise steering']);
  const replacedVersion = project.version;
  const replaced = await sendEdit('alice', 'enabledby-replace', { ...editBase, enabledByCapabilityIds: ['capability-delivery'] }, project.version);
  project = replaced.data;
  assert.deepEqual(enabledByIds(project.latestBlueprint), ['capability-delivery']);
  assert.deepEqual(enables(project.latestBlueprint), ['capability-delivery']);
  assert.deepEqual(project.latestBlueprint.edit.before.enabledByCapabilityNames, ['Enterprise steering']);
  assert.deepEqual(project.latestBlueprint.edit.after.enabledByCapabilityNames, ['Offer delivery']);
  const stale = await sendEdit('alice', 'enabledby-stale', { ...editBase, enabledByCapabilityIds: ['capability-steering'] }, replacedVersion, 409);
  assert.equal(stale.error.code, 'VERSION_CONFLICT');

  const membershipAfter = await app.persistence.query(`select principal, access, generation, revoked_at
    from orgward.project_memberships where tenant_id='tenant-a' and project_id=$1 order by principal`, [project.id]);
  const rolesAfter = await app.persistence.query(`select principal, roles, authz_generation
    from orgward.oidc_principals where tenant_id='tenant-a' and principal=any($1::text[]) order by principal`,
  [[principal('alice'), principal('bob'), principal('readonly')]]);
  assert.deepEqual(membershipAfter.rows, membersBefore.rows);
  assert.deepEqual(rolesAfter.rows, rolesBefore.rows);
  const retainedHistory = structuredClone(project.blueprintVersions.slice(1).map((version) => version.edit));
  await close(app);
  app = await start(postgres.databaseUrl);
  const restored = await request(app.base, `/api/v1/projects/${project.id}`);
  assert.deepEqual(enabledByIds(restored.data.latestBlueprint), ['capability-delivery']);
  assert.deepEqual(enables(restored.data.latestBlueprint), ['capability-delivery']);
  assert.deepEqual(restored.data.blueprintVersions.slice(1).map((version) => version.edit), retainedHistory);
  assert.deepEqual(restored.data.latestBlueprint.areas.customersOfferingsValueEconomics.items.find((item) => item.id === offering.id).serves, ['customer-primary']);
});

test('process resource and system dependency edits preserve other links and survive replay and restart', async (t) => {
  const postgres = await startPostgres();
  let app = await start(postgres.databaseUrl);
  t.after(async () => { if (app) await close(app); await postgres.close(); });
  const issuer = 'https://persistence-identity.example.test';
  const principal = (subject) => `oidc:${createHash('sha256').update(`${issuer}\n${subject}`).digest('hex')}`;
  let project = (await request(app.base, '/api/v1/projects', {
    method: 'POST', body: command('process-dependencies-project', { name: 'Process dependencies test' }),
  }, 201)).data;
  await app.persistence.query(`insert into orgward.project_memberships (tenant_id, project_id, principal, access, granted_by)
    values ('tenant-a', $1, $2, 'editor', $3), ('tenant-a', $1, $4, 'reader', $3)`,
  [project.id, principal('bob'), principal('alice'), principal('readonly')]);
  for (const [index, content] of [
    'A repair membership for independent restaurants.',
    'Restaurants need dependable repairs and clear service records.',
    'Charge a subscription with transparent repair costs.',
    'Keep customer commitments and all external actions human approved.',
  ].entries()) {
    project = (await request(app.base, `/api/v1/projects/${project.id}/messages`, {
      method: 'POST', body: command(`process-dependencies-answer-${index + 1}`, { content }, project.version),
    })).data;
  }
  const route = `/api/v1/projects/${project.id}/blueprint/edits`;
  const sendEdit = (subject, commandId, payload, expectedVersion = project.version, expected = 200) => request(app.base, route, {
    method: 'POST', headers: { authorization: `Bearer ${subject}` }, body: command(commandId, payload, expectedVersion),
  }, expected);
  const find = (blueprint, id) => Object.values(blueprint.areas).flatMap((area) => area.items).find((item) => item.id === id);
  const process = find(project.latestBlueprint, 'process-learn');
  const review = find(project.latestBlueprint, 'process-review');
  const editBase = { objectId: process.id, name: process.name, detail: process.detail,
    ownerRoleName: find(project.latestBlueprint, process.owner).name, trigger: process.trigger };
  const membersBefore = await app.persistence.query(`select principal, access, generation, revoked_at
    from orgward.project_memberships where tenant_id='tenant-a' and project_id=$1 order by principal`, [project.id]);
  const rolesBefore = await app.persistence.query(`select principal, roles, authz_generation
    from orgward.oidc_principals where tenant_id='tenant-a' and principal=any($1::text[]) order by principal`,
  [[principal('alice'), principal('bob'), principal('readonly')]]);
  const reader = await sendEdit('readonly', 'process-dependencies-reader', { ...editBase, resourceIds: ['resource-operating-capacity'] }, project.version, 403);
  assert.equal(reader.error.code, 'ACTION_FORBIDDEN');
  const crossTenant = await sendEdit('tenant-b-admin', 'process-dependencies-cross-tenant', { ...editBase, resourceIds: ['resource-operating-capacity'] }, project.version, 404);
  assert.equal(crossTenant.error.code, 'PROJECT_NOT_FOUND');
  const duplicate = await sendEdit('alice', 'process-dependencies-duplicate', { ...editBase, resourceIds: ['resource-operating-capacity', 'resource-operating-capacity'] }, project.version, 400);
  assert.equal(duplicate.error.code, 'INVALID_COMMAND');
  const unknown = await sendEdit('alice', 'process-dependencies-unknown', { ...editBase, resourceIds: ['resource-missing'] }, project.version, 400);
  assert.equal(unknown.error.code, 'INVALID_BLUEPRINT_RELATION');
  const wrongType = await sendEdit('alice', 'process-dependencies-wrong-type', { ...editBase, systemIds: ['resource-operating-capacity'] }, project.version, 400);
  assert.equal(wrongType.error.code, 'INVALID_BLUEPRINT_RELATION');
  const fieldMisuse = await sendEdit('alice', 'process-dependencies-field-misuse', {
    objectId: 'resource-operating-capacity', name: 'Capacity', detail: 'Available delivery capacity.', resourceIds: [],
  }, project.version, 400);
  assert.equal(fieldMisuse.error.code, 'INVALID_BLUEPRINT_EDIT');

  const reviewEditBase = { objectId: review.id, name: review.name, detail: review.detail,
    ownerRoleName: find(project.latestBlueprint, review.owner).name, trigger: review.trigger };
  const duplicateDecision = await sendEdit('alice', 'process-decision-flow-duplicate', {
    ...reviewEditBase, inputDecisionIds: ['decision-priority', 'decision-priority'],
  }, project.version, 400);
  assert.equal(duplicateDecision.error.code, 'INVALID_COMMAND');
  const unknownDecision = await sendEdit('alice', 'process-decision-flow-unknown', {
    ...reviewEditBase, inputDecisionIds: ['decision-missing'],
  }, project.version, 400);
  assert.equal(unknownDecision.error.code, 'INVALID_BLUEPRINT_RELATION');
  const wrongTypeDecision = await sendEdit('alice', 'process-decision-flow-wrong-type', {
    ...reviewEditBase, outputDecisionIds: ['information-delivery-result'],
  }, project.version, 400);
  assert.equal(wrongTypeDecision.error.code, 'INVALID_BLUEPRINT_RELATION');
  const addDecisionFlow = await sendEdit('alice', 'process-decision-flow-add', {
    ...reviewEditBase, inputDecisionIds: ['decision-priority'], outputDecisionIds: [],
    outputInformationIds: ['information-delivery-result'],
  }, project.version);
  project = addDecisionFlow.data;
  let linkedReview = find(project.latestBlueprint, review.id);
  assert.deepEqual(linkedReview.inputs, ['information-delivery-result', 'decision-priority']);
  assert.deepEqual(linkedReview.outputs, ['information-delivery-result']);
  assert.deepEqual(project.latestBlueprint.edit.before.inputDecisionNames, []);
  assert.deepEqual(project.latestBlueprint.edit.after.inputDecisionNames, ['Operating priority decision']);
  assert.deepEqual(project.latestBlueprint.edit.before.outputDecisionNames, ['Operating priority decision']);
  assert.deepEqual(project.latestBlueprint.edit.after.outputDecisionNames, []);
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === 'decision-priority' && link.target === review.id && link.type === 'input-to'));
  assert.ok(!project.latestBlueprint.relations.some((link) => link.source === review.id && link.target === 'decision-priority' && link.type === 'produces'));
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === review.id && link.target === 'information-delivery-result' && link.type === 'produces'));

  const replaceDecisionFlow = await sendEdit('alice', 'process-decision-flow-replace', {
    ...reviewEditBase, inputDecisionIds: [], outputDecisionIds: ['decision-priority'],
  }, project.version);
  project = replaceDecisionFlow.data;
  linkedReview = find(project.latestBlueprint, review.id);
  assert.deepEqual(linkedReview.inputs, ['information-delivery-result']);
  assert.deepEqual(linkedReview.outputs, ['information-delivery-result', 'decision-priority']);
  assert.deepEqual(project.latestBlueprint.edit.before.inputDecisionNames, ['Operating priority decision']);
  assert.deepEqual(project.latestBlueprint.edit.after.inputDecisionNames, []);
  assert.deepEqual(project.latestBlueprint.edit.before.outputDecisionNames, []);
  assert.deepEqual(project.latestBlueprint.edit.after.outputDecisionNames, ['Operating priority decision']);
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === review.id && link.target === 'decision-priority' && link.type === 'produces'));
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === review.id && link.target === 'information-delivery-result' && link.type === 'produces'));

  const clearDecisionFlow = await sendEdit('alice', 'process-decision-flow-clear', {
    ...reviewEditBase, inputDecisionIds: [], outputDecisionIds: [],
  }, project.version);
  project = clearDecisionFlow.data;
  linkedReview = find(project.latestBlueprint, review.id);
  assert.deepEqual(linkedReview.inputs, ['information-delivery-result']);
  assert.deepEqual(linkedReview.outputs, ['information-delivery-result']);
  assert.ok(!project.latestBlueprint.relations.some((link) => link.type === 'input-to' && link.source === 'decision-priority' && link.target === review.id));
  assert.ok(!project.latestBlueprint.relations.some((link) => link.type === 'produces' && link.source === review.id && link.target === 'decision-priority'));

  const readdDecisionFlow = await sendEdit('alice', 'process-decision-flow-readd', {
    ...reviewEditBase, inputDecisionIds: ['decision-priority'], outputDecisionIds: ['decision-priority'],
  }, project.version);
  project = readdDecisionFlow.data;
  assert.deepEqual(find(project.latestBlueprint, review.id).inputs, ['information-delivery-result', 'decision-priority']);
  assert.deepEqual(find(project.latestBlueprint, review.id).outputs, ['information-delivery-result', 'decision-priority']);

  const originalVersion = project.version;
  const add = await sendEdit('alice', 'process-dependencies-add', { ...editBase,
    resourceIds: ['resource-founder-time', 'resource-operating-capacity'], systemIds: ['system-studio'] }, project.version);
  project = add.data;
  const linked = find(project.latestBlueprint, process.id);
  assert.deepEqual(linked.resources, ['resource-founder-time', 'resource-operating-capacity']);
  assert.deepEqual(linked.systems, ['system-studio']);
  assert.deepEqual(linked.inputs, process.inputs);
  assert.deepEqual(linked.outputs, process.outputs);
  assert.equal(linked.capability, process.capability);
  assert.equal(linked.owner, process.owner);
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === 'resource-founder-time' && link.target === process.id && link.type === 'resources'));
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === 'resource-operating-capacity' && link.target === process.id && link.type === 'resources'));
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === 'system-studio' && link.target === process.id && link.type === 'supports'));
  assert.equal(project.latestBlueprint.relations.filter((link) => link.source === 'system-studio' && link.target === process.id && link.type === 'supports').length, 1);
  assert.deepEqual(project.latestBlueprint.edit.before.resourceNames, ['Founder attention']);
  assert.deepEqual(project.latestBlueprint.edit.after.resourceNames, ['Delivery capacity', 'Founder attention']);
  const replay = await sendEdit('alice', 'process-dependencies-add', { ...editBase,
    resourceIds: ['resource-founder-time', 'resource-operating-capacity'], systemIds: ['system-studio'] }, originalVersion);
  assert.equal(replay.meta.replayed, true);
  const conflict = await sendEdit('alice', 'process-dependencies-add', { ...editBase,
    resourceIds: ['resource-operating-capacity'], systemIds: ['system-studio'] }, originalVersion, 409);
  assert.equal(conflict.error.code, 'IDEMPOTENCY_CONFLICT');
  const remove = await sendEdit('alice', 'process-dependencies-remove', { ...editBase, resourceIds: ['resource-founder-time'], systemIds: [] }, project.version);
  project = remove.data;
  assert.deepEqual(find(project.latestBlueprint, process.id).resources, ['resource-founder-time']);
  assert.deepEqual(find(project.latestBlueprint, process.id).systems, []);
  assert.deepEqual(project.latestBlueprint.edit.before.systemNames, ['OrgWard Enterprise Studio']);
  assert.deepEqual(project.latestBlueprint.edit.after.systemNames, []);
  const removedSystem = find(project.latestBlueprint, 'system-studio');
  assert.ok(!removedSystem.supports.includes(process.id));
  assert.ok(removedSystem.supports.includes('process-deliver'), 'removing one process retains another support target');
  assert.ok(removedSystem.supports.includes('process-review'), 'removing one process retains every unrelated support target');
  assert.ok(!project.latestBlueprint.relations.some((link) => link.source === 'system-studio' && link.target === process.id && link.type === 'supports'));
  assert.equal(project.latestBlueprint.relations.filter((link) => link.source === 'system-studio' && link.target === 'process-deliver' && link.type === 'supports').length, 1);
  const replaceVersion = project.version;
  const replace = await sendEdit('alice', 'process-dependencies-replace', { ...editBase,
    resourceIds: ['resource-operating-capacity'], systemIds: ['system-studio'] }, project.version);
  project = replace.data;
  assert.deepEqual(find(project.latestBlueprint, process.id).resources, ['resource-operating-capacity']);
  assert.deepEqual(find(project.latestBlueprint, process.id).systems, ['system-studio']);
  assert.ok(find(project.latestBlueprint, 'system-studio').supports.includes(process.id), 're-add synchronizes the reverse list');
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === 'system-studio' && link.target === process.id && link.type === 'supports'));
  assert.equal(project.latestBlueprint.relations.filter((link) => link.source === 'system-studio' && link.target === process.id && link.type === 'supports').length, 1);
  assert.deepEqual(project.latestBlueprint.edit.before.resourceNames, ['Founder attention']);
  assert.deepEqual(project.latestBlueprint.edit.after.resourceNames, ['Delivery capacity']);
  const stale = await sendEdit('alice', 'process-dependencies-stale', { ...editBase, resourceIds: ['resource-founder-time'], systemIds: [] }, replaceVersion, 409);
  assert.equal(stale.error.code, 'VERSION_CONFLICT');
  const reviewAfter = find(project.latestBlueprint, review.id);
  assert.deepEqual(reviewAfter.outputs, ['information-delivery-result', 'decision-priority']);
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === review.id && link.target === 'decision-priority' && link.type === 'produces'));
  const retainedHistory = structuredClone(project.blueprintVersions.slice(1).map((version) => version.edit));
  assert.deepEqual((await app.persistence.query(`select principal, access, generation, revoked_at
    from orgward.project_memberships where tenant_id='tenant-a' and project_id=$1 order by principal`, [project.id])).rows, membersBefore.rows);
  assert.deepEqual((await app.persistence.query(`select principal, roles, authz_generation
    from orgward.oidc_principals where tenant_id='tenant-a' and principal=any($1::text[]) order by principal`,
  [[principal('alice'), principal('bob'), principal('readonly')]])).rows, rolesBefore.rows);
  await close(app);
  app = await start(postgres.databaseUrl);
  const restored = await request(app.base, `/api/v1/projects/${project.id}`);
  assert.deepEqual(find(restored.data.latestBlueprint, process.id).resources, ['resource-operating-capacity']);
  assert.deepEqual(find(restored.data.latestBlueprint, process.id).systems, ['system-studio']);
  assert.ok(find(restored.data.latestBlueprint, 'system-studio').supports.includes(process.id));
  assert.deepEqual(restored.data.blueprintVersions.slice(1).map((version) => version.edit), retainedHistory);
  assert.deepEqual(find(restored.data.latestBlueprint, review.id).outputs, ['information-delivery-result', 'decision-priority']);
});

test('process capability edits synchronize capability realisers and survive clear, replay and restart', async (t) => {
  const postgres = await startPostgres();
  let app = await start(postgres.databaseUrl);
  t.after(async () => { if (app) await close(app); await postgres.close(); });
  const issuer = 'https://persistence-identity.example.test';
  const principal = (subject) => `oidc:${createHash('sha256').update(`${issuer}\n${subject}`).digest('hex')}`;
  let project = (await request(app.base, '/api/v1/projects', {
    method: 'POST', body: command('process-capability-project', { name: 'Process capability test' }),
  }, 201)).data;
  await app.persistence.query(`insert into orgward.project_memberships (tenant_id, project_id, principal, access, granted_by)
    values ('tenant-a', $1, $2, 'editor', $3), ('tenant-a', $1, $4, 'reader', $3)`,
  [project.id, principal('bob'), principal('alice'), principal('readonly')]);
  for (const [index, content] of [
    'A repair membership for independent restaurants.',
    'Restaurants need dependable repairs and clear service records.',
    'Charge a subscription with transparent repair costs.',
    'Keep customer commitments and all external actions human approved.',
  ].entries()) {
    project = (await request(app.base, `/api/v1/projects/${project.id}/messages`, {
      method: 'POST', body: command(`process-capability-answer-${index + 1}`, { content }, project.version),
    })).data;
  }
  const route = `/api/v1/projects/${project.id}/blueprint/edits`;
  const sendEdit = (subject, commandId, payload, expectedVersion = project.version, expected = 200) => request(app.base, route, {
    method: 'POST', headers: { authorization: `Bearer ${subject}` }, body: command(commandId, payload, expectedVersion),
  }, expected);
  const find = (blueprint, id) => Object.values(blueprint.areas).flatMap((area) => area.items).find((item) => item.id === id);
  const process = find(project.latestBlueprint, 'process-learn');
  const initialCapability = find(project.latestBlueprint, process.capability);
  const targetCapability = find(project.latestBlueprint, 'capability-steering');
  const editBase = { objectId: process.id, name: process.name, detail: process.detail,
    ownerRoleName: find(project.latestBlueprint, process.owner).name, trigger: process.trigger };
  const membersBefore = await app.persistence.query(`select principal, access, generation, revoked_at
    from orgward.project_memberships where tenant_id='tenant-a' and project_id=$1 order by principal`, [project.id]);
  const rolesBefore = await app.persistence.query(`select principal, roles, authz_generation
    from orgward.oidc_principals where tenant_id='tenant-a' and principal=any($1::text[]) order by principal`,
  [[principal('alice'), principal('bob'), principal('readonly')]]);
  const reader = await sendEdit('readonly', 'process-capability-reader', { ...editBase, capabilityId: targetCapability.id }, project.version, 403);
  assert.equal(reader.error.code, 'ACTION_FORBIDDEN');
  const crossTenant = await sendEdit('tenant-b-admin', 'process-capability-cross-tenant', { ...editBase, capabilityId: targetCapability.id }, project.version, 404);
  assert.equal(crossTenant.error.code, 'PROJECT_NOT_FOUND');
  const invalidSyntax = await sendEdit('alice', 'process-capability-invalid-syntax', { ...editBase, capabilityId: '' }, project.version, 400);
  assert.equal(invalidSyntax.error.code, 'INVALID_COMMAND');
  const unknown = await sendEdit('alice', 'process-capability-unknown', { ...editBase, capabilityId: 'capability-missing' }, project.version, 400);
  assert.equal(unknown.error.code, 'INVALID_BLUEPRINT_RELATION');
  const wrongType = await sendEdit('alice', 'process-capability-wrong-type', { ...editBase, capabilityId: 'resource-founder-time' }, project.version, 400);
  assert.equal(wrongType.error.code, 'INVALID_BLUEPRINT_RELATION');
  const fieldMisuse = await sendEdit('alice', 'process-capability-field-misuse', {
    objectId: targetCapability.id, name: targetCapability.name, detail: targetCapability.detail, capabilityId: process.capability,
  }, project.version, 400);
  assert.equal(fieldMisuse.error.code, 'INVALID_BLUEPRINT_EDIT');

  const initialVersion = project.version;
  const replaced = await sendEdit('alice', 'process-capability-replace', { ...editBase, capabilityId: targetCapability.id }, project.version);
  project = replaced.data;
  assert.equal(find(project.latestBlueprint, process.id).capability, targetCapability.id);
  assert.deepEqual(find(project.latestBlueprint, initialCapability.id).realisers, []);
  assert.deepEqual(find(project.latestBlueprint, targetCapability.id).realisers, ['process-review', 'process-learn']);
  assert.equal(project.latestBlueprint.relations.filter((link) => link.source === process.id && link.target === targetCapability.id && link.type === 'realises').length, 1);
  assert.equal(project.latestBlueprint.edit.before.capabilityName, initialCapability.name);
  assert.equal(project.latestBlueprint.edit.after.capabilityName, targetCapability.name);
  assert.equal(find(project.latestBlueprint, process.id).inputs.join(','), process.inputs.join(','));
  assert.equal(find(project.latestBlueprint, process.id).outputs.join(','), process.outputs.join(','));
  const replay = await sendEdit('alice', 'process-capability-replace', { ...editBase, capabilityId: targetCapability.id }, initialVersion);
  assert.equal(replay.meta.replayed, true);
  const conflict = await sendEdit('alice', 'process-capability-replace', { ...editBase, capabilityId: null }, initialVersion, 409);
  assert.equal(conflict.error.code, 'IDEMPOTENCY_CONFLICT');

  const clearedVersion = project.version;
  const cleared = await sendEdit('alice', 'process-capability-clear', { ...editBase, capabilityId: null }, project.version);
  project = cleared.data;
  assert.equal(find(project.latestBlueprint, process.id).capability, null);
  assert.deepEqual(find(project.latestBlueprint, targetCapability.id).realisers, ['process-review']);
  assert.ok(!project.latestBlueprint.relations.some((link) => link.source === process.id && link.target === targetCapability.id && link.type === 'realises'));
  assert.equal(project.latestBlueprint.edit.before.capabilityName, targetCapability.name);
  assert.equal(project.latestBlueprint.edit.after.capabilityName, null);

  const readded = await sendEdit('alice', 'process-capability-readd', { ...editBase, capabilityId: initialCapability.id }, project.version);
  project = readded.data;
  assert.equal(find(project.latestBlueprint, process.id).capability, initialCapability.id);
  assert.deepEqual(find(project.latestBlueprint, initialCapability.id).realisers, ['process-learn']);
  assert.deepEqual(find(project.latestBlueprint, targetCapability.id).realisers, ['process-review']);
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === process.id && link.target === initialCapability.id && link.type === 'realises'));
  assert.equal(project.latestBlueprint.edit.before.capabilityName, null);
  assert.equal(project.latestBlueprint.edit.after.capabilityName, initialCapability.name);
  const stale = await sendEdit('alice', 'process-capability-stale', { ...editBase, capabilityId: targetCapability.id }, clearedVersion, 409);
  assert.equal(stale.error.code, 'VERSION_CONFLICT');
  const retainedHistory = structuredClone(project.blueprintVersions.slice(1).map((version) => version.edit));
  assert.deepEqual((await app.persistence.query(`select principal, access, generation, revoked_at
    from orgward.project_memberships where tenant_id='tenant-a' and project_id=$1 order by principal`, [project.id])).rows, membersBefore.rows);
  assert.deepEqual((await app.persistence.query(`select principal, roles, authz_generation
    from orgward.oidc_principals where tenant_id='tenant-a' and principal=any($1::text[]) order by principal`,
  [[principal('alice'), principal('bob'), principal('readonly')]])).rows, rolesBefore.rows);
  await close(app);
  app = await start(postgres.databaseUrl);
  const restored = await request(app.base, `/api/v1/projects/${project.id}`);
  assert.equal(find(restored.data.latestBlueprint, process.id).capability, initialCapability.id);
  assert.deepEqual(find(restored.data.latestBlueprint, initialCapability.id).realisers, ['process-learn']);
  assert.deepEqual(find(restored.data.latestBlueprint, targetCapability.id).realisers, ['process-review']);
  assert.deepEqual(restored.data.blueprintVersions.slice(1).map((version) => version.edit), retainedHistory);
});

test('metric feedback-loop consumer link edits preserve sources with replay and restart integrity', async (t) => {
  const postgres = await startPostgres();
  let app = await start(postgres.databaseUrl);
  t.after(async () => { if (app) await close(app); await postgres.close(); });
  const issuer = 'https://persistence-identity.example.test';
  const principal = (subject) => `oidc:${createHash('sha256').update(`${issuer}\n${subject}`).digest('hex')}`;
  const created = await request(app.base, '/api/v1/projects', {
    method: 'POST', body: command('feeds-project', { name: 'Metric feedback-loop link test' }),
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
      method: 'POST', body: command(`feeds-answer-${index + 1}`, { content }, project.version),
    })).data;
  }
  const seededStateResult = await app.persistence.query(`select state from orgward.aggregates
    where tenant_id='tenant-a' and aggregate_kind='project' and aggregate_id=$1`, [project.id]);
  const seededState = seededStateResult.rows[0].state;
  const seededBlueprint = seededState.blueprintVersions.at(-1);
  seededBlueprint.areas.purposeStrategy.items.push({
    id: 'goal-sustain-maintenance', type: 'goal', name: 'Sustain rapid repair response',
    detail: 'Keep repair turnaround predictable as membership grows.', owner: 'role-operations', metric: 'metric-outcome',
    horizon: 'First operating year', status: 'designed', confidence: 'medium',
    provenance: [{ source: 'test:feedback-goal', note: 'Alternate goal fixture for steering-link editing.' }],
  });
  seededBlueprint.areas.governanceRiskControls.items.push({
    id: 'decision-customer-recovery', type: 'decision', name: 'Customer recovery review',
    detail: 'Choose a customer recovery response from the review evidence.', status: 'designed', confidence: 'medium',
    provenance: [{ source: 'test:feedback-decision', note: 'Alternate decision fixture for proposed loop design.' }],
  });
  seededBlueprint.summary.objectCount += 2;
  seededBlueprint.summary.relationCount += 2;
  seededBlueprint.integrity = validateBlueprint(seededBlueprint);
  await app.persistence.query(`update orgward.aggregates set state=$1::jsonb,state_hash=$2
    where tenant_id='tenant-a' and aggregate_kind='project' and aggregate_id=$3`,
  [JSON.stringify(seededState), contentHash(seededState), project.id]);
  project = (await request(app.base, `/api/v1/projects/${project.id}`)).data;
  const route = `/api/v1/projects/${project.id}/blueprint/edits`;
  const sendEdit = (subject, commandId, payload, expectedVersion = project.version, expected = 200) => request(app.base, route, {
    method: 'POST', headers: { authorization: `Bearer ${subject}` },
    body: command(commandId, payload, expectedVersion),
  }, expected);
  const metric = project.latestBlueprint.areas.metricsFeedback.items.find((item) => item.id === 'metric-demand');
  const feedbackLoop = project.latestBlueprint.areas.metricsFeedback.items.find((item) => item.id === 'loop-weekly-steering');
  const editBase = { objectId: metric.id, name: metric.name, detail: metric.detail };
  const feedbackGoalEditBase = { objectId: feedbackLoop.id, name: feedbackLoop.name, detail: feedbackLoop.detail };
  const feedbackDecisionEditBase = { objectId: feedbackLoop.id, name: feedbackLoop.name, detail: feedbackLoop.detail };
  const membershipsBefore = await app.persistence.query(`select principal, access, generation, revoked_at
    from orgward.project_memberships where tenant_id='tenant-a' and project_id=$1 order by principal`, [project.id]);
  const rolesBefore = await app.persistence.query(`select principal, roles, authz_generation
    from orgward.oidc_principals where tenant_id='tenant-a' and principal=any($1::text[]) order by principal`,
  [[principal('alice'), principal('bob'), principal('readonly')]]);
  const reader = await sendEdit('readonly', 'feeds-reader', { ...editBase, consumerLoopId: null }, project.version, 403);
  assert.equal(reader.error.code, 'ACTION_FORBIDDEN');
  const crossTenant = await sendEdit('tenant-b-admin', 'feeds-cross-tenant', { ...editBase, consumerLoopId: null }, project.version, 404);
  assert.equal(crossTenant.error.code, 'PROJECT_NOT_FOUND');
  const unknown = await sendEdit('alice', 'feeds-unknown', { ...editBase, consumerLoopId: 'loop-not-present' }, project.version, 400);
  assert.equal(unknown.error.code, 'INVALID_BLUEPRINT_RELATION');
  const wrongType = await sendEdit('alice', 'feeds-wrong-type', { ...editBase, consumerLoopId: 'process-deliver' }, project.version, 400);
  assert.equal(wrongType.error.code, 'INVALID_BLUEPRINT_RELATION');
  const goalReader = await sendEdit('readonly', 'feedback-goal-reader', { ...feedbackGoalEditBase, feedbackGoalId: null }, project.version, 403);
  assert.equal(goalReader.error.code, 'ACTION_FORBIDDEN');
  const goalCrossTenant = await sendEdit('tenant-b-admin', 'feedback-goal-cross-tenant', { ...feedbackGoalEditBase, feedbackGoalId: null }, project.version, 404);
  assert.equal(goalCrossTenant.error.code, 'PROJECT_NOT_FOUND');
  const goalWrongType = await sendEdit('alice', 'feedback-goal-wrong-type', { ...feedbackGoalEditBase, feedbackGoalId: 'process-deliver' }, project.version, 400);
  assert.equal(goalWrongType.error.code, 'INVALID_BLUEPRINT_RELATION');
  const unknownGoal = await sendEdit('alice', 'feedback-goal-unknown', { ...feedbackGoalEditBase, feedbackGoalId: 'goal-missing' }, project.version, 400);
  assert.equal(unknownGoal.error.code, 'INVALID_BLUEPRINT_RELATION');
  const invalidGoalSyntax = await sendEdit('alice', 'feedback-goal-invalid-syntax', { ...feedbackGoalEditBase, feedbackGoalId: '' }, project.version, 400);
  assert.equal(invalidGoalSyntax.error.code, 'INVALID_COMMAND');
  const goalFieldMisuse = await sendEdit('alice', 'feedback-goal-field-misuse', { ...editBase, feedbackGoalId: null }, project.version, 400);
  assert.equal(goalFieldMisuse.error.code, 'INVALID_BLUEPRINT_EDIT');
  const decisionReader = await sendEdit('readonly', 'feedback-decision-reader', { ...feedbackDecisionEditBase, feedbackDecisionIds: [] }, project.version, 403);
  assert.equal(decisionReader.error.code, 'ACTION_FORBIDDEN');
  const decisionCrossTenant = await sendEdit('tenant-b-admin', 'feedback-decision-cross-tenant', { ...feedbackDecisionEditBase, feedbackDecisionIds: [] }, project.version, 404);
  assert.equal(decisionCrossTenant.error.code, 'PROJECT_NOT_FOUND');
  const decisionWrongType = await sendEdit('alice', 'feedback-decision-wrong-type', { ...feedbackDecisionEditBase, feedbackDecisionIds: ['process-deliver'] }, project.version, 400);
  assert.equal(decisionWrongType.error.code, 'INVALID_BLUEPRINT_RELATION');
  const unknownDecision = await sendEdit('alice', 'feedback-decision-unknown', { ...feedbackDecisionEditBase, feedbackDecisionIds: ['decision-missing'] }, project.version, 400);
  assert.equal(unknownDecision.error.code, 'INVALID_BLUEPRINT_RELATION');
  const invalidDecisionSyntax = await sendEdit('alice', 'feedback-decision-invalid-syntax', { ...feedbackDecisionEditBase, feedbackDecisionIds: [''] }, project.version, 400);
  assert.equal(invalidDecisionSyntax.error.code, 'INVALID_COMMAND');
  const decisionFieldMisuse = await sendEdit('alice', 'feedback-decision-field-misuse', { ...editBase, feedbackDecisionIds: [] }, project.version, 400);
  assert.equal(decisionFieldMisuse.error.code, 'INVALID_BLUEPRINT_EDIT');
  const fieldMisuse = await sendEdit('alice', 'feeds-field-misuse', {
    objectId: 'loop-weekly-steering', name: 'Weekly enterprise steering', detail: 'Review evidence and decide the next step.', consumerLoopId: null,
  }, project.version, 400);
  assert.equal(fieldMisuse.error.code, 'INVALID_BLUEPRINT_EDIT');

  const loopById = (blueprint) => blueprint.areas.metricsFeedback.items.find((item) => item.id === feedbackLoop.id);
  const preservedLoopFields = ['evidence', 'decisionIds', 'owner', 'cadence', 'threshold'];
  const assertLoopPreserved = (blueprint) => {
    for (const field of preservedLoopFields) assert.deepEqual(loopById(blueprint)[field], feedbackLoop[field]);
  };
  const assertLoopPreservedExceptDecisions = (blueprint, expectedLoop) => {
    for (const field of ['evidence', 'goal', 'owner', 'cadence', 'threshold']) assert.deepEqual(loopById(blueprint)[field], expectedLoop[field]);
  };
  const authorisesLoop = (blueprint) => blueprint.relations.filter((link) => link.target === feedbackLoop.id && link.type === 'authorises');
  const goalReplaced = await sendEdit('alice', 'feedback-goal-replace', {
    ...feedbackGoalEditBase, feedbackGoalId: 'goal-sustain-maintenance',
  }, project.version);
  project = goalReplaced.data;
  assert.equal(loopById(project.latestBlueprint).goal, 'goal-sustain-maintenance');
  assert.equal(project.latestBlueprint.edit.before.feedbackGoalName, 'Deliver the promised customer outcome');
  assert.equal(project.latestBlueprint.edit.after.feedbackGoalName, 'Sustain rapid repair response');
  assert.ok(!project.latestBlueprint.relations.some((link) => link.source === feedbackLoop.id && link.target === 'goal-customer-outcome' && link.type === 'steers'));
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === feedbackLoop.id && link.target === 'goal-sustain-maintenance' && link.type === 'steers'));
  assertLoopPreserved(project.latestBlueprint);

  const goalCleared = await sendEdit('alice', 'feedback-goal-clear', {
    ...feedbackGoalEditBase, feedbackGoalId: null,
  }, project.version);
  project = goalCleared.data;
  assert.equal(loopById(project.latestBlueprint).goal, null);
  assert.equal(project.latestBlueprint.edit.before.feedbackGoalName, 'Sustain rapid repair response');
  assert.equal(project.latestBlueprint.edit.after.feedbackGoalName, null);
  assert.ok(!project.latestBlueprint.relations.some((link) => link.source === feedbackLoop.id && link.type === 'steers'));
  assertLoopPreserved(project.latestBlueprint);

  const loopBeforeDecisionReplacement = structuredClone(loopById(project.latestBlueprint));
  const decisionReplaced = await sendEdit('alice', 'feedback-decision-replace', {
    ...feedbackDecisionEditBase, feedbackDecisionIds: ['decision-customer-recovery'],
  }, project.version);
  project = decisionReplaced.data;
  assert.deepEqual(loopById(project.latestBlueprint).decisionIds, ['decision-customer-recovery']);
  assert.deepEqual(project.latestBlueprint.edit.before.feedbackDecisionNames, ['Operating priority decision']);
  assert.deepEqual(project.latestBlueprint.edit.after.feedbackDecisionNames, ['Customer recovery review']);
  assert.deepEqual(authorisesLoop(project.latestBlueprint), [{
    id: 'decision-customer-recovery--authorises--loop-weekly-steering', source: 'decision-customer-recovery',
    target: feedbackLoop.id, type: 'authorises',
  }]);
  assertLoopPreservedExceptDecisions(project.latestBlueprint, loopBeforeDecisionReplacement);
  const loopBeforeDecisionClear = structuredClone(loopById(project.latestBlueprint));
  const decisionCleared = await sendEdit('alice', 'feedback-decision-clear', {
    ...feedbackDecisionEditBase, feedbackDecisionIds: [],
  }, project.version);
  project = decisionCleared.data;
  assert.deepEqual(loopById(project.latestBlueprint).decisionIds, []);
  assert.deepEqual(project.latestBlueprint.edit.before.feedbackDecisionNames, ['Customer recovery review']);
  assert.deepEqual(project.latestBlueprint.edit.after.feedbackDecisionNames, []);
  assert.deepEqual(authorisesLoop(project.latestBlueprint), []);
  assertLoopPreservedExceptDecisions(project.latestBlueprint, loopBeforeDecisionClear);
  const initialVersion = project.version;

  const cleared = await sendEdit('alice', 'feeds-clear', { ...editBase, consumerLoopId: null }, project.version);
  project = cleared.data;
  const metricById = (blueprint, id) => blueprint.areas.metricsFeedback.items.find((item) => item.id === id);
  const feeds = (blueprint, id) => blueprint.relations.filter((link) => link.source === id && link.type === 'feeds');
  assert.equal(metricById(project.latestBlueprint, metric.id).consumerLoop, null);
  assert.equal(metricById(project.latestBlueprint, metric.id).reads, 'information-customer-signal');
  assert.deepEqual(feeds(project.latestBlueprint, metric.id), [], 'clearing the scalar target removes the derived feeds relation');
  assert.deepEqual(project.latestBlueprint.edit.before.consumerLoopName, 'Weekly enterprise steering');
  assert.equal(project.latestBlueprint.edit.after.consumerLoopName, null);
  assert.equal(metricById(project.latestBlueprint, 'metric-sustainability').reads, 'economics-launch', 'the economics source remains unchanged');
  const clearReplay = await sendEdit('alice', 'feeds-clear', { ...editBase, consumerLoopId: null }, initialVersion);
  assert.equal(clearReplay.meta.replayed, true);
  const idempotencyConflict = await sendEdit('alice', 'feeds-clear', { ...editBase, consumerLoopId: 'loop-weekly-steering' }, initialVersion, 409);
  assert.equal(idempotencyConflict.error.code, 'IDEMPOTENCY_CONFLICT');
  const clearHistory = structuredClone(project.blueprintVersions.slice(1).map((version) => version.edit));
  await close(app);
  app = await start(postgres.databaseUrl);
  project = (await request(app.base, `/api/v1/projects/${project.id}`)).data;
  assert.equal(metricById(project.latestBlueprint, metric.id).consumerLoop, null);
  assert.deepEqual(feeds(project.latestBlueprint, metric.id), []);
  assert.equal(loopById(project.latestBlueprint).goal, null);
  assert.ok(!project.latestBlueprint.relations.some((link) => link.source === feedbackLoop.id && link.type === 'steers'));
  assert.deepEqual(loopById(project.latestBlueprint).decisionIds, []);
  assert.deepEqual(authorisesLoop(project.latestBlueprint), []);
  assertLoopPreservedExceptDecisions(project.latestBlueprint, loopBeforeDecisionClear);
  assert.deepEqual(project.blueprintVersions.slice(1).map((version) => version.edit), clearHistory);

  const linked = await sendEdit('alice', 'feeds-readd', { ...editBase, consumerLoopId: 'loop-weekly-steering' }, project.version);
  project = linked.data;
  assert.equal(metricById(project.latestBlueprint, metric.id).consumerLoop, 'loop-weekly-steering');
  assert.deepEqual(feeds(project.latestBlueprint, metric.id), [{
    id: 'metric-demand--feeds--loop-weekly-steering', source: 'metric-demand', target: 'loop-weekly-steering', type: 'feeds',
  }]);
  assert.equal(metricById(project.latestBlueprint, metric.id).reads, 'information-customer-signal');
  assert.deepEqual(project.latestBlueprint.edit.before.consumerLoopName, null);
  assert.deepEqual(project.latestBlueprint.edit.after.consumerLoopName, 'Weekly enterprise steering');
  assert.equal(metricById(project.latestBlueprint, 'metric-sustainability').reads, 'economics-launch');
  const stale = await sendEdit('alice', 'feeds-stale', { ...editBase, consumerLoopId: null }, initialVersion, 409);
  assert.equal(stale.error.code, 'VERSION_CONFLICT');
  const loopBeforeGoalReadd = structuredClone(loopById(project.latestBlueprint));
  const goalReadded = await sendEdit('alice', 'feedback-goal-readd', {
    ...feedbackGoalEditBase, feedbackGoalId: 'goal-customer-outcome',
  }, project.version);
  project = goalReadded.data;
  assert.equal(loopById(project.latestBlueprint).goal, 'goal-customer-outcome');
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === feedbackLoop.id && link.target === 'goal-customer-outcome' && link.type === 'steers'));
  assert.equal(project.latestBlueprint.edit.before.feedbackGoalName, null);
  assert.equal(project.latestBlueprint.edit.after.feedbackGoalName, 'Deliver the promised customer outcome');
  for (const field of ['evidence', 'decisionIds', 'owner', 'cadence', 'threshold']) {
    assert.deepEqual(loopById(project.latestBlueprint)[field], loopBeforeGoalReadd[field]);
  }
  const loopBeforeDecisionReadd = structuredClone(loopById(project.latestBlueprint));
  const decisionReadded = await sendEdit('alice', 'feedback-decision-readd', {
    ...feedbackDecisionEditBase, feedbackDecisionIds: ['decision-priority'],
  }, project.version);
  project = decisionReadded.data;
  assert.deepEqual(loopById(project.latestBlueprint).decisionIds, ['decision-priority']);
  assert.deepEqual(project.latestBlueprint.edit.before.feedbackDecisionNames, []);
  assert.deepEqual(project.latestBlueprint.edit.after.feedbackDecisionNames, ['Operating priority decision']);
  assert.deepEqual(authorisesLoop(project.latestBlueprint), [{
    id: 'decision-priority--authorises--loop-weekly-steering', source: 'decision-priority',
    target: feedbackLoop.id, type: 'authorises',
  }]);
  assertLoopPreservedExceptDecisions(project.latestBlueprint, loopBeforeDecisionReadd);
  assert.deepEqual((await app.persistence.query(`select principal, access, generation, revoked_at
    from orgward.project_memberships where tenant_id='tenant-a' and project_id=$1 order by principal`, [project.id])).rows, membershipsBefore.rows);
  assert.deepEqual((await app.persistence.query(`select principal, roles, authz_generation
    from orgward.oidc_principals where tenant_id='tenant-a' and principal=any($1::text[]) order by principal`,
  [[principal('alice'), principal('bob'), principal('readonly')]])).rows, rolesBefore.rows);
  const retainedHistory = structuredClone(project.blueprintVersions.slice(1).map((version) => version.edit));
  await close(app);
  app = await start(postgres.databaseUrl);
  const restored = await request(app.base, `/api/v1/projects/${project.id}`);
  assert.equal(metricById(restored.data.latestBlueprint, metric.id).consumerLoop, 'loop-weekly-steering');
  assert.equal(loopById(restored.data.latestBlueprint).goal, 'goal-customer-outcome');
  assert.ok(restored.data.latestBlueprint.relations.some((link) => link.source === feedbackLoop.id && link.target === 'goal-customer-outcome' && link.type === 'steers'));
  assert.deepEqual(loopById(restored.data.latestBlueprint).decisionIds, ['decision-priority']);
  assert.deepEqual(authorisesLoop(restored.data.latestBlueprint), [{
    id: 'decision-priority--authorises--loop-weekly-steering', source: 'decision-priority',
    target: feedbackLoop.id, type: 'authorises',
  }]);
  assertLoopPreserved(restored.data.latestBlueprint);
  assert.deepEqual(feeds(restored.data.latestBlueprint, metric.id), feeds(project.latestBlueprint, metric.id));
  assert.deepEqual(restored.data.blueprintVersions.slice(1).map((version) => version.edit), retainedHistory);
  assert.equal(metricById(restored.data.latestBlueprint, metric.id).reads, 'information-customer-signal');
  assert.equal(metricById(restored.data.latestBlueprint, 'metric-sustainability').reads, 'economics-launch');
});

test('risk mitigating-control selection updates both references atomically and survives restart', async (t) => {
  const postgres = await startPostgres();
  let app = await start(postgres.databaseUrl);
  t.after(async () => { if (app) await close(app); await postgres.close(); });
  const issuer = 'https://persistence-identity.example.test';
  const principal = (subject) => `oidc:${createHash('sha256').update(`${issuer}\n${subject}`).digest('hex')}`;
  const created = await request(app.base, '/api/v1/projects', {
    method: 'POST', body: command('risk-control-project', { name: 'Risk control consistency test' }),
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
      method: 'POST', body: command(`risk-control-answer-${index + 1}`, { content }, project.version),
    })).data;
  }
  const route = `/api/v1/projects/${project.id}/blueprint/edits`;
  const sendEdit = (subject, commandId, payload, expectedVersion = project.version, expected = 200) => request(app.base, route, {
    method: 'POST', headers: { authorization: `Bearer ${subject}` },
    body: command(commandId, payload, expectedVersion),
  }, expected);
  const risk = project.latestBlueprint.areas.governanceRiskControls.items.find((item) => item.id === 'risk-unsafe-automation');
  const editBase = { objectId: risk.id, name: risk.name, detail: risk.detail };
  const initialVersion = project.version;
  const membershipsBefore = await app.persistence.query(`select principal, access, generation, revoked_at
    from orgward.project_memberships where tenant_id='tenant-a' and project_id=$1 order by principal`, [project.id]);
  const rolesBefore = await app.persistence.query(`select principal, roles, authz_generation
    from orgward.oidc_principals where tenant_id='tenant-a' and principal=any($1::text[]) order by principal`,
  [[principal('alice'), principal('bob'), principal('readonly')]]);
  const reader = await sendEdit('readonly', 'risk-control-reader', { ...editBase, mitigatingControlId: 'control-evidence-review' }, project.version, 403);
  assert.equal(reader.error.code, 'ACTION_FORBIDDEN');
  const crossTenant = await sendEdit('tenant-b-admin', 'risk-control-cross-tenant', { ...editBase, mitigatingControlId: 'control-evidence-review' }, project.version, 404);
  assert.equal(crossTenant.error.code, 'PROJECT_NOT_FOUND');
  const unknown = await sendEdit('alice', 'risk-control-unknown', { ...editBase, mitigatingControlId: 'control-not-present' }, project.version, 400);
  assert.equal(unknown.error.code, 'INVALID_BLUEPRINT_RELATION');
  const wrongType = await sendEdit('alice', 'risk-control-wrong-type', { ...editBase, mitigatingControlId: 'risk-unvalidated-demand' }, project.version, 400);
  assert.equal(wrongType.error.code, 'INVALID_BLUEPRINT_RELATION');
  const fieldMisuse = await sendEdit('alice', 'risk-control-field-misuse', {
    objectId: 'control-evidence-review', name: 'Evidence review before scaling', detail: 'Review evidence before expansion.', mitigatingControlId: null,
  }, project.version, 400);
  assert.equal(fieldMisuse.error.code, 'INVALID_BLUEPRINT_EDIT');

  const riskById = (blueprint) => blueprint.areas.governanceRiskControls.items.find((item) => item.id === risk.id);
  const controlById = (blueprint, id) => blueprint.areas.governanceRiskControls.items.find((item) => item.id === id);
  const mitigatingEdges = (blueprint, riskId) => blueprint.relations.filter((link) => link.type === 'mitigates' && link.target === riskId);
  const changed = await sendEdit('alice', 'risk-control-change', { ...editBase, mitigatingControlId: 'control-evidence-review' }, project.version);
  project = changed.data;
  assert.equal(riskById(project.latestBlueprint).control, 'control-evidence-review');
  assert.deepEqual(controlById(project.latestBlueprint, 'control-human-authority').mitigates, []);
  assert.deepEqual(controlById(project.latestBlueprint, 'control-evidence-review').mitigates, ['risk-unvalidated-demand', risk.id]);
  assert.deepEqual(mitigatingEdges(project.latestBlueprint, risk.id), [{
    id: 'control-evidence-review--mitigates--risk-unsafe-automation',
    source: 'control-evidence-review', target: risk.id, type: 'mitigates',
  }]);
  assert.equal(mitigatingEdges(project.latestBlueprint, risk.id).length, 1, 'the mirrored references derive one deduplicated relationship');
  assert.equal(project.latestBlueprint.edit.before.mitigatingControlName, 'Human authority boundary');
  assert.equal(project.latestBlueprint.edit.after.mitigatingControlName, 'Evidence review before scaling');
  assert.deepEqual(controlById(project.latestBlueprint, 'control-evidence-review').mitigates.filter((id) => id !== risk.id), ['risk-unvalidated-demand']);
  const replay = await sendEdit('alice', 'risk-control-change', { ...editBase, mitigatingControlId: 'control-evidence-review' }, initialVersion);
  assert.equal(replay.meta.replayed, true);
  const conflict = await sendEdit('alice', 'risk-control-change', { ...editBase, mitigatingControlId: null }, initialVersion, 409);
  assert.equal(conflict.error.code, 'IDEMPOTENCY_CONFLICT');

  const cleared = await sendEdit('alice', 'risk-control-clear', { ...editBase, mitigatingControlId: null }, project.version);
  project = cleared.data;
  assert.equal(riskById(project.latestBlueprint).control, null);
  assert.deepEqual(controlById(project.latestBlueprint, 'control-evidence-review').mitigates, ['risk-unvalidated-demand']);
  assert.deepEqual(controlById(project.latestBlueprint, 'control-human-authority').mitigates, []);
  assert.deepEqual(mitigatingEdges(project.latestBlueprint, risk.id), []);
  assert.equal(project.latestBlueprint.edit.before.mitigatingControlName, 'Evidence review before scaling');
  assert.equal(project.latestBlueprint.edit.after.mitigatingControlName, null);
  const beforeRestartHistory = structuredClone(project.blueprintVersions.slice(1).map((version) => version.edit));
  await close(app);
  app = await start(postgres.databaseUrl);
  project = (await request(app.base, `/api/v1/projects/${project.id}`)).data;
  assert.equal(riskById(project.latestBlueprint).control, null);
  assert.deepEqual(mitigatingEdges(project.latestBlueprint, risk.id), []);
  assert.deepEqual(project.blueprintVersions.slice(1).map((version) => version.edit), beforeRestartHistory);

  const linked = await sendEdit('alice', 'risk-control-readd', { ...editBase, mitigatingControlId: 'control-human-authority' }, project.version);
  project = linked.data;
  assert.equal(riskById(project.latestBlueprint).control, 'control-human-authority');
  assert.deepEqual(controlById(project.latestBlueprint, 'control-human-authority').mitigates, [risk.id]);
  assert.deepEqual(controlById(project.latestBlueprint, 'control-evidence-review').mitigates, ['risk-unvalidated-demand']);
  assert.deepEqual(mitigatingEdges(project.latestBlueprint, risk.id), [{
    id: 'control-human-authority--mitigates--risk-unsafe-automation',
    source: 'control-human-authority', target: risk.id, type: 'mitigates',
  }]);
  assert.equal(project.latestBlueprint.edit.before.mitigatingControlName, null);
  assert.equal(project.latestBlueprint.edit.after.mitigatingControlName, 'Human authority boundary');
  const stale = await sendEdit('alice', 'risk-control-stale', { ...editBase, mitigatingControlId: null }, initialVersion, 409);
  assert.equal(stale.error.code, 'VERSION_CONFLICT');
  assert.deepEqual((await app.persistence.query(`select principal, access, generation, revoked_at
    from orgward.project_memberships where tenant_id='tenant-a' and project_id=$1 order by principal`, [project.id])).rows, membershipsBefore.rows);
  assert.deepEqual((await app.persistence.query(`select principal, roles, authz_generation
    from orgward.oidc_principals where tenant_id='tenant-a' and principal=any($1::text[]) order by principal`,
  [[principal('alice'), principal('bob'), principal('readonly')]])).rows, rolesBefore.rows);
  const retainedHistory = structuredClone(project.blueprintVersions.slice(1).map((version) => version.edit));
  await close(app);
  app = await start(postgres.databaseUrl);
  const restored = await request(app.base, `/api/v1/projects/${project.id}`);
  assert.equal(riskById(restored.data.latestBlueprint).control, 'control-human-authority');
  assert.deepEqual(mitigatingEdges(restored.data.latestBlueprint, risk.id), mitigatingEdges(project.latestBlueprint, risk.id));
  assert.deepEqual(restored.data.blueprintVersions.slice(1).map((version) => version.edit), retainedHistory);
});

test('capability metric links edit only metric references and retain legacy targets across restart', async (t) => {
  const postgres = await startPostgres();
  let app = await start(postgres.databaseUrl);
  t.after(async () => { if (app) await close(app); await postgres.close(); });
  const issuer = 'https://persistence-identity.example.test';
  const principal = (subject) => `oidc:${createHash('sha256').update(`${issuer}\n${subject}`).digest('hex')}`;
  const created = await request(app.base, '/api/v1/projects', {
    method: 'POST', body: command('capability-metrics-project', { name: 'Capability metric link test' }),
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
      method: 'POST', body: command(`capability-metrics-answer-${index + 1}`, { content }, project.version),
    })).data;
  }
  const persistedResult = await app.persistence.query(`select state from orgward.aggregates
    where tenant_id='tenant-a' and aggregate_kind='project' and aggregate_id=$1`, [project.id]);
  const persisted = persistedResult.rows[0].state;
  const seededBlueprint = persisted.blueprintVersions.at(-1);
  const deliveryCapability = seededBlueprint.areas.capabilitiesProcesses.items.find((item) => item.id === 'capability-delivery');
  deliveryCapability.metrics.push('process-deliver');
  seededBlueprint.relations.push({
    id: 'process-deliver--measures--capability-delivery', source: 'process-deliver', target: 'capability-delivery', type: 'measures',
  });
  seededBlueprint.summary.relationCount = seededBlueprint.relations.length;
  seededBlueprint.integrity = validateBlueprint(seededBlueprint);
  await app.persistence.query(`update orgward.aggregates set state=$1::jsonb,state_hash=$2
    where tenant_id='tenant-a' and aggregate_kind='project' and aggregate_id=$3`,
  [JSON.stringify(persisted), contentHash(persisted), project.id]);
  project = (await request(app.base, `/api/v1/projects/${project.id}`)).data;
  const route = `/api/v1/projects/${project.id}/blueprint/edits`;
  const sendEdit = (subject, commandId, payload, expectedVersion = project.version, expected = 200) => request(app.base, route, {
    method: 'POST', headers: { authorization: `Bearer ${subject}` },
    body: command(commandId, payload, expectedVersion),
  }, expected);
  const capability = project.latestBlueprint.areas.capabilitiesProcesses.items.find((item) => item.id === 'capability-delivery');
  const editBase = { objectId: capability.id, name: capability.name, detail: capability.detail };
  const initialVersion = project.version;
  const membershipsBefore = await app.persistence.query(`select principal, access, generation, revoked_at
    from orgward.project_memberships where tenant_id='tenant-a' and project_id=$1 order by principal`, [project.id]);
  const rolesBefore = await app.persistence.query(`select principal, roles, authz_generation
    from orgward.oidc_principals where tenant_id='tenant-a' and principal=any($1::text[]) order by principal`,
  [[principal('alice'), principal('bob'), principal('readonly')]]);
  const reader = await sendEdit('readonly', 'capability-metrics-reader', { ...editBase, capabilityMetricIds: ['metric-demand'] }, project.version, 403);
  assert.equal(reader.error.code, 'ACTION_FORBIDDEN');
  const crossTenant = await sendEdit('tenant-b-admin', 'capability-metrics-cross-tenant', { ...editBase, capabilityMetricIds: ['metric-demand'] }, project.version, 404);
  assert.equal(crossTenant.error.code, 'PROJECT_NOT_FOUND');
  const duplicate = await sendEdit('alice', 'capability-metrics-duplicate', { ...editBase, capabilityMetricIds: ['metric-demand', 'metric-demand'] }, project.version, 400);
  assert.equal(duplicate.error.code, 'INVALID_COMMAND');
  const unknown = await sendEdit('alice', 'capability-metrics-unknown', { ...editBase, capabilityMetricIds: ['metric-missing'] }, project.version, 400);
  assert.equal(unknown.error.code, 'INVALID_BLUEPRINT_RELATION');
  const wrongType = await sendEdit('alice', 'capability-metrics-wrong-type', { ...editBase, capabilityMetricIds: ['process-deliver'] }, project.version, 400);
  assert.equal(wrongType.error.code, 'INVALID_BLUEPRINT_RELATION');
  const fieldMisuse = await sendEdit('alice', 'capability-metrics-field-misuse', {
    objectId: 'loop-weekly-steering', name: 'Weekly enterprise steering', detail: 'Review evidence and decide the next step.', capabilityMetricIds: [],
  }, project.version, 400);
  assert.equal(fieldMisuse.error.code, 'INVALID_BLUEPRINT_EDIT');

  const capabilityById = (blueprint) => blueprint.areas.capabilitiesProcesses.items.find((item) => item.id === capability.id);
  const measureEdges = (blueprint) => blueprint.relations.filter((link) => link.type === 'measures' && link.target === capability.id).map((link) => link.source).sort();
  const added = await sendEdit('alice', 'capability-metrics-add', { ...editBase, capabilityMetricIds: ['metric-demand', 'metric-outcome'] }, project.version);
  project = added.data;
  assert.deepEqual(capabilityById(project.latestBlueprint).metrics, ['process-deliver', 'metric-demand', 'metric-outcome']);
  assert.deepEqual(measureEdges(project.latestBlueprint), ['metric-demand', 'metric-outcome', 'process-deliver']);
  assert.deepEqual(project.latestBlueprint.edit.before.capabilityMetricNames, ['Customer outcome achieved']);
  assert.deepEqual(project.latestBlueprint.edit.after.capabilityMetricNames, ['Customer outcome achieved', 'Qualified demand']);
  const replay = await sendEdit('alice', 'capability-metrics-add', { ...editBase, capabilityMetricIds: ['metric-demand', 'metric-outcome'] }, initialVersion);
  assert.equal(replay.meta.replayed, true);
  const conflict = await sendEdit('alice', 'capability-metrics-add', { ...editBase, capabilityMetricIds: ['metric-sustainability'] }, initialVersion, 409);
  assert.equal(conflict.error.code, 'IDEMPOTENCY_CONFLICT');

  const removed = await sendEdit('alice', 'capability-metrics-remove', { ...editBase, capabilityMetricIds: [] }, project.version);
  project = removed.data;
  assert.deepEqual(capabilityById(project.latestBlueprint).metrics, ['process-deliver']);
  assert.deepEqual(measureEdges(project.latestBlueprint), ['process-deliver']);
  assert.deepEqual(project.latestBlueprint.edit.before.capabilityMetricNames, ['Customer outcome achieved', 'Qualified demand']);
  assert.deepEqual(project.latestBlueprint.edit.after.capabilityMetricNames, []);

  const replaced = await sendEdit('alice', 'capability-metrics-replace', { ...editBase, capabilityMetricIds: ['metric-sustainability'] }, project.version);
  project = replaced.data;
  assert.deepEqual(capabilityById(project.latestBlueprint).metrics, ['process-deliver', 'metric-sustainability']);
  assert.deepEqual(measureEdges(project.latestBlueprint), ['metric-sustainability', 'process-deliver']);
  assert.deepEqual(project.latestBlueprint.edit.before.capabilityMetricNames, []);
  assert.deepEqual(project.latestBlueprint.edit.after.capabilityMetricNames, ['Operating sustainability']);
  const stale = await sendEdit('alice', 'capability-metrics-stale', { ...editBase, capabilityMetricIds: [] }, initialVersion, 409);
  assert.equal(stale.error.code, 'VERSION_CONFLICT');
  assert.deepEqual((await app.persistence.query(`select principal, access, generation, revoked_at
    from orgward.project_memberships where tenant_id='tenant-a' and project_id=$1 order by principal`, [project.id])).rows, membershipsBefore.rows);
  assert.deepEqual((await app.persistence.query(`select principal, roles, authz_generation
    from orgward.oidc_principals where tenant_id='tenant-a' and principal=any($1::text[]) order by principal`,
  [[principal('alice'), principal('bob'), principal('readonly')]])).rows, rolesBefore.rows);
  const retainedHistory = structuredClone(project.blueprintVersions.slice(1).map((version) => version.edit));
  await close(app);
  app = await start(postgres.databaseUrl);
  const restored = await request(app.base, `/api/v1/projects/${project.id}`);
  assert.deepEqual(capabilityById(restored.data.latestBlueprint).metrics, ['process-deliver', 'metric-sustainability']);
  assert.deepEqual(measureEdges(restored.data.latestBlueprint), ['metric-sustainability', 'process-deliver']);
  assert.deepEqual(restored.data.blueprintVersions.slice(1).map((version) => version.edit), retainedHistory);
});

test('role responsibility edits preserve legacy references and remain organizational accountability across restart', async (t) => {
  const postgres = await startPostgres();
  let app = await start(postgres.databaseUrl);
  t.after(async () => { if (app) await close(app); await postgres.close(); });
  const issuer = 'https://persistence-identity.example.test';
  const principal = (subject) => `oidc:${createHash('sha256').update(`${issuer}\n${subject}`).digest('hex')}`;
  const created = await request(app.base, '/api/v1/projects', {
    method: 'POST', body: command('role-responsibility-project', { name: 'Role responsibility test' }),
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
      method: 'POST', body: command(`role-responsibility-answer-${index + 1}`, { content }, project.version),
    })).data;
  }
  const projectId = project.id;
  const seedResult = await app.persistence.query(`select state from orgward.aggregates
    where tenant_id='tenant-a' and aggregate_kind='project' and aggregate_id=$1`, [projectId]);
  const seededState = seedResult.rows[0].state;
  const seeded = seededState.blueprintVersions.at(-1);
  seeded.areas.informationTechnology.items.push(...Array.from({ length: 33 }, (_, index) => ({
    id: `test-responsibility-system-${index + 1}`, type: 'system', name: `Test responsibility system ${index + 1}`,
    detail: 'Eligible target used to verify the responsibility limit.', status: 'designed', confidence: 'medium',
    provenance: [{ source: 'test:role-responsibility', note: 'Bounded relation fixture.' }],
  })));
  const founder = seeded.areas.responsibilityAuthority.items.find((item) => item.id === 'role-founder');
  founder.responsibilities.push('metric-sustainability');
  seeded.relations.push({ id: 'role-founder--accountable-for--metric-sustainability', source: 'role-founder', target: 'metric-sustainability', type: 'accountable-for' });
  seeded.summary.objectCount += 33;
  seeded.summary.relationCount = seeded.relations.length;
  seeded.integrity = validateBlueprint(seeded);
  await app.persistence.query(`update orgward.aggregates set state=$1::jsonb,state_hash=$2
    where tenant_id='tenant-a' and aggregate_kind='project' and aggregate_id=$3`,
  [JSON.stringify(seededState), contentHash(seededState), projectId]);
  project = (await request(app.base, `/api/v1/projects/${projectId}`)).data;
  const route = `/api/v1/projects/${projectId}/blueprint/edits`;
  const sendEdit = (subject, commandId, payload, expectedVersion = project.version, expected = 200) => request(app.base, route, {
    method: 'POST', headers: { authorization: `Bearer ${subject}` }, body: command(commandId, payload, expectedVersion),
  }, expected);
  const role = project.latestBlueprint.areas.responsibilityAuthority.items.find((item) => item.id === 'role-founder');
  const base = { objectId: role.id, name: role.name, detail: role.detail,
    proposedInstructions: role.proposedInstructions, proposedScopeStatements: role.proposedScopeStatements };
  const absentResponsibilityField = await request(app.base, route, { method: 'POST', headers: tenantHeaders,
    body: command('role-responsibility-field-absent', { ...base, proposedInstructions: `${role.proposedInstructions} Preserve existing references.` }, project.version),
  });
  project = absentResponsibilityField.data;
  assert.deepEqual(project.latestBlueprint.areas.responsibilityAuthority.items.find((item) => item.id === role.id).responsibilities,
    ['goal-customer-outcome', 'capability-customer-discovery', 'capability-steering', 'metric-sustainability']);
  const actor = project.latestBlueprint.areas.peopleAgents.items.find((item) => item.id === 'actor-founder');
  const bindingRoute = `/api/v1/projects/${projectId}/actor-bindings/proposals`;
  project = (await request(app.base, bindingRoute, { method: 'POST', headers: tenantHeaders,
    body: command('role-responsibility-binding-fixture', {
      actorId: actor.id, roleId: role.id, targetPrincipal: principal('bob'), blueprintVersion: project.latestBlueprint.version,
    }, project.version),
  })).data;
  const rolePayload = (responsibilityIds) => {
    const latestRole = project.latestBlueprint.areas.responsibilityAuthority.items.find((item) => item.id === role.id);
    return { objectId: latestRole.id, name: latestRole.name, detail: latestRole.detail,
      proposedInstructions: latestRole.proposedInstructions, proposedScopeStatements: latestRole.proposedScopeStatements, responsibilityIds };
  };
  const membershipSnapshot = (await app.persistence.query(`select principal, access, generation, revoked_at
    from orgward.project_memberships where tenant_id='tenant-a' and project_id=$1 order by principal`, [projectId])).rows;
  const roleSnapshot = (await app.persistence.query(`select principal, roles, authz_generation
    from orgward.oidc_principals where tenant_id='tenant-a' and principal=any($1::text[]) order by principal`,
  [[principal('alice'), principal('bob'), principal('readonly')]])).rows;
  const bindingSnapshot = (await app.persistence.query(`select actor_id, role_id, target_principal, blueprint_version, status, target_authz_generation, target_membership_generation
    from orgward.project_actor_binding_proposals where tenant_id='tenant-a' and project_id=$1 order by actor_id, role_id`, [projectId])).rows;

  const reader = await sendEdit('readonly', 'role-responsibility-reader', rolePayload(['process-review']), project.version, 403);
  assert.equal(reader.error.code, 'ACTION_FORBIDDEN');
  const crossTenant = await sendEdit('tenant-b-admin', 'role-responsibility-cross-tenant', rolePayload(['process-review']), project.version, 404);
  assert.equal(crossTenant.error.code, 'PROJECT_NOT_FOUND');
  const duplicate = await sendEdit('alice', 'role-responsibility-duplicate', rolePayload(['process-review', 'process-review']), project.version, 400);
  assert.equal(duplicate.error.code, 'INVALID_COMMAND');
  const unknown = await sendEdit('alice', 'role-responsibility-unknown', rolePayload(['missing-responsibility']), project.version, 400);
  assert.equal(unknown.error.code, 'INVALID_BLUEPRINT_RELATION');
  const wrongType = await sendEdit('alice', 'role-responsibility-wrong-type', rolePayload(['metric-sustainability']), project.version, 400);
  assert.equal(wrongType.error.code, 'INVALID_BLUEPRINT_RELATION');
  const tooMany = await sendEdit('alice', 'role-responsibility-too-many', rolePayload(Array.from({ length: 33 }, (_, index) => `test-responsibility-system-${index + 1}`)), project.version, 400);
  assert.equal(tooMany.error.code, 'INVALID_COMMAND');
  const fieldMisuse = await sendEdit('alice', 'role-responsibility-field-misuse', {
    objectId: 'actor-founder', name: actor.name, detail: actor.detail, responsibilityIds: [],
  }, project.version, 400);
  assert.equal(fieldMisuse.error.code, 'INVALID_BLUEPRINT_EDIT');

  const initialVersion = project.version;
  const originalRole = structuredClone(project.latestBlueprint.areas.responsibilityAuthority.items.find((item) => item.id === role.id));
  const add = await sendEdit('alice', 'role-responsibility-add', rolePayload(['goal-customer-outcome', 'process-review']), project.version);
  project = add.data;
  const roleById = (blueprint) => blueprint.areas.responsibilityAuthority.items.find((item) => item.id === role.id);
  const accountableEdges = (blueprint) => blueprint.relations.filter((link) => link.type === 'accountable-for' && link.source === role.id).map((link) => link.target).sort();
  assert.deepEqual(roleById(project.latestBlueprint).responsibilities, ['metric-sustainability', 'goal-customer-outcome', 'process-review']);
  assert.deepEqual(accountableEdges(project.latestBlueprint), ['goal-customer-outcome', 'metric-sustainability', 'process-review']);
  assert.ok(project.latestBlueprint.relations.some((link) => link.id === 'role-founder--accountable-for--process-review'));
  assert.equal(project.latestBlueprint.relations.some((link) => link.id === 'process-review--accountable-for--role-founder'), false);
  assert.deepEqual(project.latestBlueprint.edit.before.responsibilityNames, ['Customer discovery', 'Deliver the promised customer outcome', 'Enterprise steering']);
  assert.deepEqual(project.latestBlueprint.edit.after.responsibilityNames, ['Deliver the promised customer outcome', 'Review and steer the enterprise']);
  assert.deepEqual(roleById(project.blueprintVersions[0]).responsibilities, originalRole.responsibilities, 'the previous blueprint remains immutable');
  const replay = await sendEdit('alice', 'role-responsibility-add', rolePayload(['goal-customer-outcome', 'process-review']), initialVersion);
  assert.equal(replay.meta.replayed, true);
  const idempotencyConflict = await sendEdit('alice', 'role-responsibility-add', rolePayload(['system-studio']), initialVersion, 409);
  assert.equal(idempotencyConflict.error.code, 'IDEMPOTENCY_CONFLICT');
  const stale = await sendEdit('alice', 'role-responsibility-stale', rolePayload(['system-studio']), initialVersion, 409);
  assert.equal(stale.error.code, 'VERSION_CONFLICT');

  const remove = await sendEdit('alice', 'role-responsibility-remove', rolePayload(['goal-customer-outcome']), project.version);
  project = remove.data;
  assert.deepEqual(accountableEdges(project.latestBlueprint), ['goal-customer-outcome', 'metric-sustainability']);
  const replace = await sendEdit('alice', 'role-responsibility-replace', rolePayload(['system-studio']), project.version);
  project = replace.data;
  assert.deepEqual(accountableEdges(project.latestBlueprint), ['metric-sustainability', 'system-studio']);
  assert.deepEqual(project.latestBlueprint.edit.before.responsibilityNames, ['Deliver the promised customer outcome']);
  assert.deepEqual(project.latestBlueprint.edit.after.responsibilityNames, ['OrgWard Enterprise Studio']);
  const empty = await sendEdit('alice', 'role-responsibility-empty', rolePayload([]), project.version);
  project = empty.data;
  assert.deepEqual(roleById(project.latestBlueprint).responsibilities, ['metric-sustainability']);
  assert.deepEqual(accountableEdges(project.latestBlueprint), ['metric-sustainability']);
  assert.deepEqual(project.latestBlueprint.edit.after.responsibilityNames, []);
  assert.equal(project.latestBlueprint.edit.before.proposedInstructions, originalRole.proposedInstructions);
  assert.deepEqual(project.latestBlueprint.edit.after.proposedScopeStatements, originalRole.proposedScopeStatements);
  const actorById = (blueprint) => blueprint.areas.peopleAgents.items.find((item) => item.id === actor.id);
  assert.deepEqual(actorById(project.latestBlueprint).assignedRoles, actor.assignedRoles);
  assert.deepEqual(project.latestBlueprint.relations.filter((link) => link.source === actor.id && link.type === 'assigned-to'),
    project.blueprintVersions[0].relations.filter((link) => link.source === actor.id && link.type === 'assigned-to'));
  assert.deepEqual((await app.persistence.query(`select actor_id, role_id, target_principal, blueprint_version, status, target_authz_generation, target_membership_generation
    from orgward.project_actor_binding_proposals where tenant_id='tenant-a' and project_id=$1 order by actor_id, role_id`, [projectId])).rows, bindingSnapshot);
  assert.deepEqual((await app.persistence.query(`select principal, access, generation, revoked_at
    from orgward.project_memberships where tenant_id='tenant-a' and project_id=$1 order by principal`, [projectId])).rows, membershipSnapshot);
  assert.deepEqual((await app.persistence.query(`select principal, roles, authz_generation
    from orgward.oidc_principals where tenant_id='tenant-a' and principal=any($1::text[]) order by principal`,
  [[principal('alice'), principal('bob'), principal('readonly')]])).rows, roleSnapshot);
  const retainedEdits = structuredClone(project.blueprintVersions.slice(1).filter((version) => version.edit?.objectId === role.id).map((version) => version.edit));
  await close(app);
  app = await start(postgres.databaseUrl);
  const restored = (await request(app.base, `/api/v1/projects/${projectId}`)).data;
  assert.deepEqual(roleById(restored.latestBlueprint).responsibilities, ['metric-sustainability']);
  assert.deepEqual(accountableEdges(restored.latestBlueprint), ['metric-sustainability']);
  assert.deepEqual(restored.blueprintVersions.slice(1).filter((version) => version.edit?.objectId === role.id).map((version) => version.edit), retainedEdits);
  assert.equal(restored.version, project.version);
});

test('actor organizational role links edit only role references and remain non-authorizing across restart', async (t) => {
  const postgres = await startPostgres();
  let app = await start(postgres.databaseUrl);
  t.after(async () => { if (app) await close(app); await postgres.close(); });
  const issuer = 'https://persistence-identity.example.test';
  const principal = (subject) => `oidc:${createHash('sha256').update(`${issuer}\n${subject}`).digest('hex')}`;
  const created = await request(app.base, '/api/v1/projects', {
    method: 'POST', body: command('actor-roles-project', { name: 'Actor role link test' }),
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
      method: 'POST', body: command(`actor-roles-answer-${index + 1}`, { content }, project.version),
    })).data;
  }
  const persistedResult = await app.persistence.query(`select state from orgward.aggregates
    where tenant_id='tenant-a' and aggregate_kind='project' and aggregate_id=$1`, [project.id]);
  const persisted = persistedResult.rows[0].state;
  const seededBlueprint = persisted.blueprintVersions.at(-1);
  const founder = seededBlueprint.areas.peopleAgents.items.find((item) => item.id === 'actor-founder');
  const originalType = founder.type;
  const originalName = founder.name;
  const originalDetail = founder.detail;
  founder.assignedRoles.push('process-deliver');
  seededBlueprint.relations.push({
    id: 'actor-founder--assigned-to--process-deliver', source: 'actor-founder', target: 'process-deliver', type: 'assigned-to',
  });
  seededBlueprint.summary.relationCount = seededBlueprint.relations.length;
  seededBlueprint.integrity = validateBlueprint(seededBlueprint);
  await app.persistence.query(`update orgward.aggregates set state=$1::jsonb,state_hash=$2
    where tenant_id='tenant-a' and aggregate_kind='project' and aggregate_id=$3`,
  [JSON.stringify(persisted), contentHash(persisted), project.id]);
  project = (await request(app.base, `/api/v1/projects/${project.id}`)).data;
  const route = `/api/v1/projects/${project.id}/blueprint/edits`;
  const sendEdit = (subject, commandId, payload, expectedVersion = project.version, expected = 200) => request(app.base, route, {
    method: 'POST', headers: { authorization: `Bearer ${subject}` },
    body: command(commandId, payload, expectedVersion),
  }, expected);
  const actor = project.latestBlueprint.areas.peopleAgents.items.find((item) => item.id === 'actor-founder');
  const editBase = { objectId: actor.id, name: actor.name, detail: actor.detail };
  const initialVersion = project.version;
  const membershipsBefore = await app.persistence.query(`select principal, access, generation, revoked_at
    from orgward.project_memberships where tenant_id='tenant-a' and project_id=$1 order by principal`, [project.id]);
  const platformRolesBefore = await app.persistence.query(`select principal, roles, authz_generation
    from orgward.oidc_principals where tenant_id='tenant-a' and principal=any($1::text[]) order by principal`,
  [[principal('alice'), principal('bob'), principal('readonly')]]);
  const reader = await sendEdit('readonly', 'actor-roles-reader', { ...editBase, assignedRoleIds: ['role-design-assistant'] }, project.version, 403);
  assert.equal(reader.error.code, 'ACTION_FORBIDDEN');
  const crossTenant = await sendEdit('tenant-b-admin', 'actor-roles-cross-tenant', { ...editBase, assignedRoleIds: ['role-design-assistant'] }, project.version, 404);
  assert.equal(crossTenant.error.code, 'PROJECT_NOT_FOUND');
  const duplicate = await sendEdit('alice', 'actor-roles-duplicate', { ...editBase, assignedRoleIds: ['role-design-assistant', 'role-design-assistant'] }, project.version, 400);
  assert.equal(duplicate.error.code, 'INVALID_COMMAND');
  const unknown = await sendEdit('alice', 'actor-roles-unknown', { ...editBase, assignedRoleIds: ['role-missing'] }, project.version, 400);
  assert.equal(unknown.error.code, 'INVALID_BLUEPRINT_RELATION');
  const wrongType = await sendEdit('alice', 'actor-roles-wrong-type', { ...editBase, assignedRoleIds: ['process-deliver'] }, project.version, 400);
  assert.equal(wrongType.error.code, 'INVALID_BLUEPRINT_RELATION');
  const fieldMisuse = await sendEdit('alice', 'actor-roles-field-misuse', {
    objectId: 'role-founder', name: 'Founder / enterprise owner', detail: 'Keep final accountability for commitments and approvals.', assignedRoleIds: [],
  }, project.version, 400);
  assert.equal(fieldMisuse.error.code, 'INVALID_BLUEPRINT_EDIT');

  const actorById = (blueprint) => blueprint.areas.peopleAgents.items.find((item) => item.id === actor.id);
  const assignedToRoleIds = (blueprint) => blueprint.relations.filter((link) => link.source === actor.id && link.type === 'assigned-to'
    && Object.values(blueprint.areas).flatMap((area) => area.items).some((item) => item.id === link.target && item.type === 'role')).map((link) => link.target).sort();
  const add = await sendEdit('alice', 'actor-roles-add', { ...editBase, assignedRoleIds: ['role-founder', 'role-design-assistant'] }, project.version);
  project = add.data;
  assert.deepEqual(actorById(project.latestBlueprint).assignedRoles, ['process-deliver', 'role-founder', 'role-design-assistant']);
  assert.deepEqual(assignedToRoleIds(project.latestBlueprint), ['role-design-assistant', 'role-founder']);
  assert.deepEqual(project.latestBlueprint.edit.before.assignedRoleNames, ['Founder / enterprise owner']);
  assert.deepEqual(project.latestBlueprint.edit.after.assignedRoleNames, ['Design assistant', 'Founder / enterprise owner']);
  assert.equal(actorById(project.latestBlueprint).type, originalType);
  assert.equal(actorById(project.latestBlueprint).name, originalName);
  assert.equal(actorById(project.latestBlueprint).detail, originalDetail);
  assert.ok(project.latestBlueprint.relations.some((link) => link.id === 'actor-founder--assigned-to--process-deliver'));
  const replay = await sendEdit('alice', 'actor-roles-add', { ...editBase, assignedRoleIds: ['role-founder', 'role-design-assistant'] }, initialVersion);
  assert.equal(replay.meta.replayed, true);
  const conflict = await sendEdit('alice', 'actor-roles-add', { ...editBase, assignedRoleIds: ['role-founder'] }, initialVersion, 409);
  assert.equal(conflict.error.code, 'IDEMPOTENCY_CONFLICT');

  const remove = await sendEdit('alice', 'actor-roles-remove', { ...editBase, assignedRoleIds: ['role-design-assistant'] }, project.version);
  project = remove.data;
  assert.deepEqual(actorById(project.latestBlueprint).assignedRoles, ['process-deliver', 'role-design-assistant']);
  assert.deepEqual(assignedToRoleIds(project.latestBlueprint), ['role-design-assistant']);
  const replace = await sendEdit('alice', 'actor-roles-replace', { ...editBase, assignedRoleIds: ['role-operations'] }, project.version);
  project = replace.data;
  assert.deepEqual(actorById(project.latestBlueprint).assignedRoles, ['process-deliver', 'role-operations']);
  assert.deepEqual(assignedToRoleIds(project.latestBlueprint), ['role-operations']);
  assert.deepEqual(project.latestBlueprint.edit.before.assignedRoleNames, ['Design assistant']);
  assert.deepEqual(project.latestBlueprint.edit.after.assignedRoleNames, ['Operations owner']);
  const projectVersionBeforeBinding = project.version;
  const proposalsBeforeUnlinkedRole = await app.persistence.query(`select count(*)::int count
    from orgward.project_actor_binding_proposals where tenant_id='tenant-a' and project_id=$1`, [project.id]);
  const removedRoleBinding = await request(app.base, `/api/v1/projects/${project.id}/actor-bindings/proposals`, {
    method: 'POST', headers: tenantHeaders,
    body: command('actor-roles-binding-removed-role', {
      actorId: actor.id, roleId: 'role-founder', targetPrincipal: principal('bob'), blueprintVersion: project.latestBlueprint.version,
    }, project.version),
  }, 400);
  assert.equal(removedRoleBinding.error.code, 'BLUEPRINT_ROLE_NOT_LINKED');
  const afterUnlinkedRoleAttempt = await request(app.base, `/api/v1/projects/${project.id}`);
  assert.equal(afterUnlinkedRoleAttempt.data.version, projectVersionBeforeBinding);
  assert.equal(afterUnlinkedRoleAttempt.data.latestBlueprint.version, project.latestBlueprint.version);
  assert.deepEqual(await app.persistence.query(`select count(*)::int count
    from orgward.project_actor_binding_proposals where tenant_id='tenant-a' and project_id=$1`, [project.id]), proposalsBeforeUnlinkedRole);
  const bindingProposal = await request(app.base, `/api/v1/projects/${project.id}/actor-bindings/proposals`, {
    method: 'POST', headers: tenantHeaders,
    body: command('actor-roles-binding-eligibility', {
      actorId: actor.id, roleId: 'role-operations', targetPrincipal: principal('bob'), blueprintVersion: project.latestBlueprint.version,
    }, project.version),
  });
  project = bindingProposal.data;
  assert.equal(bindingProposal.event.type, 'BlueprintActorBindingProposed');
  assert.equal(bindingProposal.event.data.status, 'proposed');
  assert.equal(bindingProposal.event.data.roleId, 'role-operations');
  const stale = await sendEdit('alice', 'actor-roles-stale', { ...editBase, assignedRoleIds: [] }, initialVersion, 409);
  assert.equal(stale.error.code, 'VERSION_CONFLICT');
  assert.deepEqual((await app.persistence.query(`select principal, access, generation, revoked_at
    from orgward.project_memberships where tenant_id='tenant-a' and project_id=$1 order by principal`, [project.id])).rows, membershipsBefore.rows);
  assert.deepEqual((await app.persistence.query(`select principal, roles, authz_generation
    from orgward.oidc_principals where tenant_id='tenant-a' and principal=any($1::text[]) order by principal`,
  [[principal('alice'), principal('bob'), principal('readonly')]])).rows, platformRolesBefore.rows);
  const retainedHistory = structuredClone(project.blueprintVersions.slice(1).map((version) => version.edit));
  await close(app);
  app = await start(postgres.databaseUrl);
  const restored = await request(app.base, `/api/v1/projects/${project.id}`);
  assert.deepEqual(actorById(restored.data.latestBlueprint).assignedRoles, ['process-deliver', 'role-operations']);
  assert.deepEqual(assignedToRoleIds(restored.data.latestBlueprint), ['role-operations']);
  assert.deepEqual(restored.data.blueprintVersions.slice(1).map((version) => version.edit), retainedHistory);
});

test('owner-only internal blueprint publication snapshots disclosures immutably with replay and restart integrity', async (t) => {
  const postgres = await startPostgres();
  let app = await start(postgres.databaseUrl);
  t.after(async () => { if (app) await close(app); await postgres.close(); });
  const issuer = 'https://persistence-identity.example.test';
  const principal = (subject) => `oidc:${createHash('sha256').update(`${issuer}\n${subject}`).digest('hex')}`;
  const created = await request(app.base, '/api/v1/projects', {
    method: 'POST', body: command('internal-publication-project', { name: 'Internal publication test' }),
  }, 201);
  let project = created.data;
  for (const [index, content] of [
    'A repair service for independent restaurants.',
    'Restaurants need dependable repairs and clear service records.',
    'Charge a subscription with transparent repair costs.',
    'Keep customer commitments and external actions human approved.',
  ].entries()) {
    project = (await request(app.base, `/api/v1/projects/${project.id}/messages`, {
      method: 'POST', body: command(`internal-publication-answer-${index + 1}`, { content }, project.version),
    })).data;
  }
  const route = `/api/v1/projects/${project.id}/blueprint/publications`;
  await app.persistence.query(`
    insert into orgward.project_memberships (tenant_id, project_id, principal, access, granted_by)
    values ('tenant-a', $1, $2, 'editor', $3), ('tenant-a', $1, $4, 'reader', $3)
  `, [project.id, principal('bob'), principal('alice'), principal('readonly')]);

  const publishPayload = {
    blueprintId: project.latestBlueprint.id,
    blueprintVersion: project.latestBlueprint.version,
    acknowledgeDisclosures: true,
  };
  const publish = (subject, commandId, payload = publishPayload, expectedVersion = project.version, expected = 200) => request(app.base, route, {
    method: 'POST', headers: { authorization: `Bearer ${subject}` },
    body: command(commandId, payload, expectedVersion),
  }, expected);

  const noIdentity = await fetch(`${app.base}${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: '' },
    body: command('internal-publication-no-identity', publishPayload, project.version),
  });
  assert.equal(noIdentity.status, 401);
  assert.equal((await noIdentity.json()).error.code, 'AUTHENTICATION_REQUIRED');
  const editorDenied = await publish('bob', 'internal-publication-editor-denied', publishPayload, project.version, 403);
  assert.equal(editorDenied.error.code, 'ACTION_FORBIDDEN');
  const readerDenied = await publish('readonly', 'internal-publication-reader-denied', publishPayload, project.version, 403);
  assert.equal(readerDenied.error.code, 'ACTION_FORBIDDEN');
  const tenantDenied = await publish('tenant-b-admin', 'internal-publication-tenant-denied', publishPayload, project.version, 404);
  assert.equal(tenantDenied.error.code, 'PROJECT_NOT_FOUND');

  const missingAcknowledgment = await publish('alice', 'internal-publication-no-ack', {
    blueprintId: publishPayload.blueprintId, blueprintVersion: publishPayload.blueprintVersion,
  }, project.version, 400);
  assert.equal(missingAcknowledgment.error.code, 'INVALID_COMMAND');
  const falseAcknowledgment = await publish('alice', 'internal-publication-false-ack', {
    ...publishPayload, acknowledgeDisclosures: false,
  }, project.version, 400);
  assert.equal(falseAcknowledgment.error.code, 'INVALID_COMMAND');
  const malformed = await publish('alice', 'internal-publication-extra-field', {
    ...publishPayload, publicUrl: 'https://example.invalid',
  }, project.version, 400);
  assert.equal(malformed.error.code, 'INVALID_COMMAND');
  const staleTarget = await publish('alice', 'internal-publication-nonlatest', {
    ...publishPayload, blueprintId: 'blueprint-00000000-0000-0000-0000-000000000000',
  }, project.version, 409);
  assert.equal(staleTarget.error.code, 'BLUEPRINT_PUBLICATION_NOT_LATEST');

  const projectStateResult = await app.persistence.query(`select state from orgward.aggregates
    where tenant_id='tenant-a' and aggregate_kind='project' and aggregate_id=$1`, [project.id]);
  const persisted = projectStateResult.rows[0].state;
  const blueprint = persisted.blueprintVersions.at(-1);
  const priorStatus = blueprint.areas.purposeStrategy.status;
  blueprint.areas.purposeStrategy.status = 'invalid-status';
  blueprint.integrity = validateBlueprint(blueprint);
  await app.persistence.query(`update orgward.aggregates set state=$1::jsonb,state_hash=$2
    where tenant_id='tenant-a' and aggregate_kind='project' and aggregate_id=$3`,
  [JSON.stringify(persisted), contentHash(persisted), project.id]);
  const invalid = await publish('alice', 'internal-publication-invalid-schema', publishPayload, project.version, 409);
  assert.equal(invalid.error.code, 'BLUEPRINT_PUBLICATION_INVALID');
  blueprint.areas.purposeStrategy.status = priorStatus;
  blueprint.areas.customersOfferingsValueEconomics.status = 'unknown';
  blueprint.areas.resources.status = 'out_of_scope';
  blueprint.summary.designedAreas = Object.values(blueprint.areas).filter((area) => area.status === 'designed').length;
  blueprint.assumptions = [...(blueprint.assumptions ?? []), 'Demand assumptions have not been tested.'];
  blueprint.unknowns = [...(blueprint.unknowns ?? []), 'Local registration requirements remain unknown.'];
  blueprint.integrity = validateBlueprint(blueprint);
  const originalBlueprint = structuredClone(blueprint);
  await app.persistence.query(`update orgward.aggregates set state=$1::jsonb,state_hash=$2
    where tenant_id='tenant-a' and aggregate_kind='project' and aggregate_id=$3`,
  [JSON.stringify(persisted), contentHash(persisted), project.id]);
  project = (await request(app.base, `/api/v1/projects/${project.id}`)).data;
  const publishExpectedVersion = project.version;
  const membershipsBefore = await app.persistence.query(`select principal, access, generation, revoked_at
    from orgward.project_memberships where tenant_id='tenant-a' and project_id=$1 order by principal`, [project.id]);
  const rolesBefore = await app.persistence.query(`select principal, roles, authz_generation
    from orgward.oidc_principals where tenant_id='tenant-a' and principal=any($1::text[]) order by principal`,
  [[principal('alice'), principal('bob'), principal('readonly')]]);
  const bindingsBefore = await app.persistence.query(`select blueprint_version, actor_id, role_id, target_principal,
      target_membership_generation, target_authz_generation, status, proposed_by, proposed_at, enabled_by, enabled_at
    from orgward.project_actor_binding_proposals where tenant_id='tenant-a' and project_id=$1
    order by blueprint_version, actor_id, role_id`, [project.id]);
  const beforeBlueprints = structuredClone(project.blueprintVersions);
  const beforePublicationCount = project.blueprintPublications?.length ?? 0;
  const publishBody = command('internal-publication-owner-success', {
    blueprintId: project.latestBlueprint.id,
    blueprintVersion: project.latestBlueprint.version,
    acknowledgeDisclosures: true,
  }, publishExpectedVersion);
  const publishedResponse = await request(app.base, route, { method: 'POST', body: publishBody });
  project = publishedResponse.data;
  assert.equal(project.version, publishExpectedVersion + 1);
  assert.equal(publishedResponse.event.type, 'BlueprintInternalBaselinePublished');
  assert.equal(publishedResponse.event.aggregateVersion, project.version);
  assert.equal(publishedResponse.meta.replayed, false);
  assert.equal(project.blueprintPublications.length, beforePublicationCount + 1);
  assert.deepEqual(project.blueprintVersions, beforeBlueprints, 'publication must not mutate or add a blueprint version');
  assert.equal(project.latestBlueprint.epistemicStatus, 'proposed-design');
  const publication = project.blueprintPublications.at(-1);
  assert.equal(publication.blueprintId, project.latestBlueprint.id);
  assert.equal(publication.blueprintVersion, project.latestBlueprint.version);
  assert.equal(publication.publishedBy, principal('alice'));
  assert.match(publication.digest, /^[a-f0-9]{64}$/);
  assert.equal(publication.digest, blueprintPublicationDigest(project.latestBlueprint, publication.disclosures));
  assert.ok(publication.disclosures.gaps.length > 0);
  assert.deepEqual(publication.disclosures.gaps, validateBlueprint(project.latestBlueprint).gaps);
  assert.ok(publication.disclosures.unknownAreas.some((area) => area.key === 'customersOfferingsValueEconomics'));
  assert.ok(publication.disclosures.outOfScopeAreas.some((area) => area.key === 'resources'));
  assert.ok(publication.disclosures.assumptions.includes('Demand assumptions have not been tested.'));
  assert.ok(publication.disclosures.unknowns.includes('Local registration requirements remain unknown.'));
  assert.equal(publication.disclosures.areas.length, 10);
  assert.deepEqual(Object.keys(publication.disclosures).sort(), ['areas', 'assumptions', 'gaps', 'outOfScopeAreas', 'unknownAreas', 'unknowns']);
  assert.equal(project.events.filter((event) => event.type === 'BlueprintInternalBaselinePublished').length, 1);

  const replay = await request(app.base, route, { method: 'POST', body: publishBody });
  assert.equal(replay.meta.replayed, true);
  assert.equal(replay.data.blueprintPublications.length, beforePublicationCount + 1);
  assert.equal(replay.data.blueprintPublications.at(-1).digest, publication.digest);
  const idempotencyConflict = await publish('alice', 'internal-publication-owner-success', {
    ...publishPayload, blueprintVersion: publishPayload.blueprintVersion + 1,
  }, publishExpectedVersion, 409);
  assert.equal(idempotencyConflict.error.code, 'IDEMPOTENCY_CONFLICT');
  const staleAggregate = await publish('alice', 'internal-publication-stale-aggregate', {
    blueprintId: project.latestBlueprint.id, blueprintVersion: project.latestBlueprint.version, acknowledgeDisclosures: true,
  }, publishExpectedVersion, 409);
  assert.equal(staleAggregate.error.code, 'VERSION_CONFLICT');

  const readerView = await request(app.base, `/api/v1/projects/${project.id}`, { headers: { authorization: 'Bearer readonly' } });
  assert.deepEqual(readerView.data.blueprintPublications.at(-1), publication, 'project readers can inspect the published internal baseline');
  assert.equal(JSON.stringify(readerView.data.blueprintPublications).includes('targetPrincipal'), false);
  assert.deepEqual((await app.persistence.query(`select principal, access, generation, revoked_at
    from orgward.project_memberships where tenant_id='tenant-a' and project_id=$1 order by principal`, [project.id])).rows, membershipsBefore.rows);
  assert.deepEqual((await app.persistence.query(`select principal, roles, authz_generation
    from orgward.oidc_principals where tenant_id='tenant-a' and principal=any($1::text[]) order by principal`,
  [[principal('alice'), principal('bob'), principal('readonly')]])).rows, rolesBefore.rows);
  assert.deepEqual((await app.persistence.query(`select blueprint_version, actor_id, role_id, target_principal,
      target_membership_generation, target_authz_generation, status, proposed_by, proposed_at, enabled_by, enabled_at
    from orgward.project_actor_binding_proposals where tenant_id='tenant-a' and project_id=$1
    order by blueprint_version, actor_id, role_id`, [project.id])).rows, bindingsBefore.rows);

  const raceVersion = project.version;
  const raceEdit = {
    objectId: 'goal-customer-outcome', name: 'Race-edit outcome', detail: 'Capture the customer outcome after the proposed service.',
    ownerRoleName: 'Founder / enterprise owner',
  };
  const racePublicationPayload = {
    blueprintId: project.latestBlueprint.id, blueprintVersion: project.latestBlueprint.version, acknowledgeDisclosures: true,
  };
  const raceResults = await Promise.all([
    fetch(`${app.base}${route}`, { method: 'POST', headers: tenantHeaders, body: command('internal-publication-race', racePublicationPayload, raceVersion) }),
    fetch(`${app.base}/api/v1/projects/${project.id}/blueprint/edits`, { method: 'POST', headers: tenantHeaders, body: command('internal-publication-race-edit', raceEdit, raceVersion) }),
  ]);
  assert.deepEqual(raceResults.map((response) => response.status).sort(), [200, 409]);
  const raceBodies = await Promise.all(raceResults.map((response) => response.json()));
  project = raceBodies.find((body) => body.data)?.data ?? (await request(app.base, `/api/v1/projects/${project.id}`)).data;
  const racePublication = project.blueprintPublications.at(-1);
  assert.ok(racePublication.blueprintVersion <= project.latestBlueprint.version);
  if (raceBodies[0].data) assert.equal(raceBodies[0].data.blueprintPublications.at(-1).blueprintVersion, racePublication.blueprintVersion);
  if (raceBodies[1].data) assert.equal(raceBodies[1].data.latestBlueprint.version, racePublication.blueprintVersion + 1);

  await close(app);
  app = await start(postgres.databaseUrl);
  const restored = await request(app.base, `/api/v1/projects/${project.id}`);
  assert.deepEqual(restored.data.blueprintPublications[0], publication, 'publication disclosures and digest survive application restart');
  assert.deepEqual(restored.data.blueprintVersions[0], originalBlueprint, 'published immutable blueprint survives restart unchanged');
  assert.equal(restored.data.blueprintPublications[0].digest, blueprintPublicationDigest(restored.data.blueprintVersions[0], restored.data.blueprintPublications[0].disclosures));
  const replayAfterRestart = await request(app.base, route, { method: 'POST', body: publishBody });
  assert.equal(replayAfterRestart.meta.replayed, true);
  assert.deepEqual(replayAfterRestart.data.blueprintPublications.at(-1), publication);
  const publicationEvents = await app.persistence.query(`select count(*)::int count from orgward.audit_log
    where tenant_id='tenant-a' and aggregate_id=$1 and event_type='BlueprintInternalBaselinePublished'`, [project.id]);
  assert.ok(publicationEvents.rows[0].count >= 1);
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
  assert.equal((await app.persistence.status()).schemaVersion, '027-process-instance-unverified-abandonment');
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

  const checkpointPayload = { tasks: revisedPlan.tasks.map((task) => ({
    taskId: task.id, title: task.title, detail: task.detail, dependencies: [...task.dependencies],
    roleId: task.assignee.roleId ?? null, actorId: task.assignee.actorId ?? null,
  })), humanCheckpoint: {
    beforeTaskId: 'task-process-learn', title: 'Approve repair scope',
    detail: 'The assigned human verifies the repair scope before delivery.', roleId: 'role-founder', actorId: 'actor-founder',
  } };
  const checkpointCommand = command('process-plan-insert-human-checkpoint', checkpointPayload, revised.data.version);
  const checkpointRevisionResponse = await request(app.base, revisionRoute, {
    ...as('alice'), method: 'POST', body: checkpointCommand,
  });
  const checkpointRevision = checkpointRevisionResponse.data.processPlans.at(-1);
  const insertedCheckpoint = checkpointRevision.tasks.find((task) => task.id.startsWith('task-human-checkpoint-'));
  const checkpointTarget = checkpointRevision.tasks.find((task) => task.id === 'task-process-learn');
  assert.equal(checkpointRevision.revision, 3);
  assert.deepEqual(insertedCheckpoint.dependencies, []);
  assert.deepEqual(checkpointTarget.dependencies, [insertedCheckpoint.id]);
  assert.deepEqual(insertedCheckpoint.assignee, { kind: 'blueprint-actor', actorId: 'actor-founder', roleId: 'role-founder' });
  assert.equal(checkpointRevisionResponse.event.type, 'ProcessTaskGraphRevised');
  assert.equal(checkpointRevisionResponse.data.processPlans[1].tasks.at(-1).title, 'Coordinate and record delivery',
    'the previous immutable revision remains available');
  const checkpointReplay = await request(app.base, revisionRoute, {
    ...as('alice'), method: 'POST', body: checkpointCommand,
  });
  assert.equal(checkpointReplay.meta.replayed, true);
  assert.equal(checkpointReplay.data.processPlans.length, 3, 'a replay does not duplicate the inserted task');
  const checkpointStartPayload = {
    projectId: project.id, planId: plan.id, revision: checkpointRevision.revision, taskId: insertedCheckpoint.id,
  };
  const startedCheckpoint = await request(app.base, '/api/execution/process-task-instances/start', {
    ...as('bob'), method: 'POST', body: command('process-plan-human-checkpoint-start', checkpointStartPayload),
  }, 201);
  const targetBeforeEvidence = await request(app.base, '/api/execution/process-task-instances/start', {
    ...as('bob'), method: 'POST', body: command('process-plan-target-before-checkpoint-evidence', {
      projectId: project.id, planId: plan.id, revision: checkpointRevision.revision,
      planInstanceId: startedCheckpoint.planInstanceId, taskId: checkpointTarget.id,
    }),
  }, 409);
  assert.equal(targetBeforeEvidence.error.code, 'PROCESS_TASK_DEPENDENCY_UNSATISFIED');
  const completedCheckpoint = await request(app.base, '/api/execution/process-task-instances/complete', {
    ...as('bob'), method: 'POST', body: command('process-plan-human-checkpoint-complete', {
      ...checkpointStartPayload, planInstanceId: startedCheckpoint.planInstanceId,
      result: 'succeeded', evidence: ['Repair scope checked and approved.'],
    }),
  }, 201);
  assert.equal(completedCheckpoint.status, 'SUCCEEDED');
  const targetAfterEvidence = await request(app.base, '/api/execution/process-task-instances/start', {
    ...as('bob'), method: 'POST', body: command('process-plan-target-after-checkpoint-evidence', {
      projectId: project.id, planId: plan.id, revision: checkpointRevision.revision,
      planInstanceId: startedCheckpoint.planInstanceId, taskId: checkpointTarget.id,
    }),
  }, 201);
  assert.equal(targetAfterEvidence.planInstanceId, startedCheckpoint.planInstanceId,
    'the target starts only after verified checkpoint success in the same plan instance');
  const invalidCheckpointPayload = {
    tasks: checkpointRevision.tasks.map((task) => ({
      taskId: task.id, title: task.title, detail: task.detail, dependencies: [...task.dependencies],
      roleId: task.assignee.roleId ?? null, actorId: task.assignee.actorId ?? null,
    })),
    humanCheckpoint: { ...checkpointPayload.humanCheckpoint },
  };
  invalidCheckpointPayload.humanCheckpoint.actorId = 'actor-design-assistant';
  const invalidCheckpoint = await request(app.base, revisionRoute, {
    ...as('alice'), method: 'POST', body: command('process-plan-insert-agent-as-human-checkpoint', invalidCheckpointPayload, checkpointRevisionResponse.data.version),
  }, 400);
  assert.equal(invalidCheckpoint.error.code, 'INVALID_PROCESS_PLAN_ACTOR_ROLE');
  await request(app.base, revisionRoute, {
    ...as('readonly'), method: 'POST', body: command('process-plan-checkpoint-reader', checkpointPayload, checkpointRevisionResponse.data.version),
  }, 403);
  const checkpointRevisionPayload = { tasks: checkpointRevision.tasks.map((task) => ({
    taskId: task.id, title: task.title, detail: task.detail, dependencies: [...task.dependencies],
    roleId: task.assignee.roleId ?? null, actorId: task.assignee.actorId ?? null,
  })) };

  await request(app.base, `/api/v1/projects/${project.id}/members/${principal('bob')}/revoke`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({}),
  }, 200);
  const revokedAssignment = await request(app.base, revisionRoute, {
    ...as('alice'), method: 'POST', body: command('process-plan-revoke-recipient', checkpointRevisionPayload, checkpointRevisionResponse.data.version),
  }, 409);
  assert.equal(revokedAssignment.error.code, 'PROCESS_PLAN_ACTOR_BINDING_INELIGIBLE');
  await request(app.base, `/api/v1/projects/${project.id}/members`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal('bob'), access: 'editor' }),
  }, 200);
  const regrantedAssignment = await request(app.base, revisionRoute, {
    ...as('alice'), method: 'POST', body: command('process-plan-regrant-recipient', checkpointRevisionPayload, checkpointRevisionResponse.data.version),
  }, 409);
  assert.equal(regrantedAssignment.error.code, 'PROCESS_PLAN_ACTOR_BINDING_STALE');

  await close(app); app = null;
  app = await start(postgres.databaseUrl, { oidcAuthenticator });
  const restored = (await request(app.base, `/api/v1/projects/${project.id}`, as('alice'))).data;
  assert.equal(restored.processPlans.length, 3);
  assert.equal(restored.processPlans[0].id, plan.id);
  assert.equal(restored.processPlans[1].revision, 2);
  assert.equal(restored.processPlans[1].tasks.every((task) => task.status === 'planned'), true);
  assert.equal(restored.processPlans[2].revision, 3);
  assert.equal(restored.processPlans[2].tasks.some((task) => task.id === insertedCheckpoint.id), true,
    'the inserted human checkpoint survives PostgreSQL application restart');
  assert.deepEqual((await request(app.base, '/api/execution/runs', as('alice'))).runs, []);
});

test('saved process task requests are linked, idempotent, dependency-gated, and durable', async (t) => {
  const postgres = await startPostgres();
  const oidcAuthenticator = testOidcAuthenticator();
  const profileRoot = await mkdtemp(path.join(tmpdir(), 'orgward-process-task-profile-'));
  let providerCallCount = 0;
  let providerRequest = null;
  let providerResponseGate = null;
  let failNextProviderResponse = false;
  const providerFixture = createServer(async (request, response) => {
    providerCallCount += 1;
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    providerRequest = {
      url: request.url,
      authorization: request.headers.authorization,
      body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {},
    };
    let citedSourceId = 'information-customer-signal';
    if (typeof providerRequest.body.input === 'string') {
      try {
        const promptJson = providerRequest.body.input.slice(providerRequest.body.input.lastIndexOf('\n\n') + 2);
        citedSourceId = JSON.parse(promptJson).sourceEnvelope.sources[0].id;
      } catch { /* non-proposal provider fixtures retain their default citation */ }
    }
    if (providerResponseGate) {
      const gate = providerResponseGate;
      providerResponseGate = null;
      gate.mark();
      await gate.releasePromise;
    }
    if (failNextProviderResponse) {
      failNextProviderResponse = false;
      response.destroy();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
      proposedDetail: 'Recurring repair signals are grouped into service needs for founder review.',
      rationale: 'The saved customer signal describes recurring repair history.',
      citations: [citedSourceId],
    }) }] }] }));
  });
  await new Promise((resolve) => providerFixture.listen(0, '127.0.0.1', resolve));
  const providerOrigin = `http://127.0.0.1:${providerFixture.address().port}`;
  const openAiFixtureSecret = 'fixture-openai-credential-never-returned';
  const profiles = [
    {
      id: 'process-task-success', label: 'Local task runner', kind: 'command', version: '1.0.0',
      executable: process.execPath, args: ['-e', "process.stdout.write('task completed')"], workspaceRoot: profileRoot,
    },
    {
      id: 'process-task-failure', label: 'Failing local task runner', kind: 'command', version: '1.0.0',
      executable: process.execPath, args: ['-e', 'process.exit(17)'], workspaceRoot: profileRoot,
    },
    {
      id: 'process-task-slow', label: 'Slow local task runner', kind: 'command', version: '1.0.0',
      executable: process.execPath, args: ['-e', "setTimeout(() => process.stdout.write('task completed'), 1200)"], workspaceRoot: profileRoot,
    },
    {
      id: 'process-task-openai', label: 'Fixture OpenAI model', kind: 'provider-openai', version: '1.0.0',
      credentialReference: 'secret-process-task-openai', model: 'gpt-fixture',
      openAiEndpoint: `${providerOrigin}/v1/responses`,
    },
    {
      id: 'process-task-provider-http', label: 'Fixture generic provider', kind: 'provider-http', version: '1.0.0',
      credentialReference: 'secret-process-task-http', credentialVersion: 1,
      providerEndpoint: `${providerOrigin}/v1/execute`,
    },
  ];
  let app = await start(postgres.databaseUrl, {
    executionProfiles: profiles, oidcAuthenticator, secretEncryptionKey: Buffer.alloc(32, 0x5c),
    openAiValidationEndpoint: `${providerOrigin}/v1/models`,
  });
  const as = (subject) => ({ headers: { authorization: `Bearer ${subject}` } });
  const principal = (subject) => `oidc:${createHash('sha256').update(`https://persistence-identity.example.test\n${subject}`).digest('hex')}`;
  const taskRequest = (commandId, payload, subject = 'alice', expected = 201) => request(
    app.base, '/api/execution/process-task-runs', {
      ...as(subject), method: 'POST', body: command(commandId, payload),
    }, expected,
  );
  const rawPost = async (route, subject, body) => {
    const response = await fetch(`${app.base}${route}`, {
      ...as(subject), method: 'POST', body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const approveAndExecute = async (run) => {
    const approved = await request(app.base, `/api/execution/runs/${run.id}/approve`, {
      ...as('bob'), method: 'POST', body: JSON.stringify({ version: run.version }),
    });
    return request(app.base, `/api/execution/runs/${run.id}/execute`, {
      ...as('alice'), method: 'POST', body: JSON.stringify({ version: approved.version }),
    });
  };
  t.after(async () => {
    releaseTaskBindingLookup();
    if (app) await close(app);
    await new Promise((resolve) => providerFixture.close(resolve));
    await postgres.close();
    await rm(profileRoot, { recursive: true, force: true });
  });

  await app.secretStore.put({
    tenantId: 'tenant-a', actor: principal('alice'), actorAuthzGeneration: await authzGeneration(app, 'alice'),
    reference: 'secret-process-task-openai', commandId: 'process-task-openai-secret-v1', expectedVersion: 0,
    value: openAiFixtureSecret, reason: 'Create encrypted fixture credential',
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  });
  await app.secretStore.put({
    tenantId: 'tenant-a', actor: principal('alice'), actorAuthzGeneration: await authzGeneration(app, 'alice'),
    reference: 'secret-process-task-http', commandId: 'process-task-http-secret-v1', expectedVersion: 0,
    value: 'fixture-provider-http-credential', reason: 'Create generic provider test credential',
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  });
  await app.persistence.query(`update orgward.secret_references set active_provider='openai', active_model='gpt-fixture'
    where tenant_id='tenant-a' and reference='secret-process-task-openai'`);
  const originalResolveOpenAiBinding = app.secretStore.resolveOpenAiBinding.bind(app.secretStore);
  let openAiBindingLookupCount = 0;
  let pauseNextTaskBindingLookup = false;
  let releaseTaskBindingLookup;
  let markTaskBindingLookup;
  const taskBindingLookupObserved = new Promise((resolve) => { markTaskBindingLookup = resolve; });
  const taskBindingLookupGate = new Promise((resolve) => { releaseTaskBindingLookup = resolve; });
  app.secretStore.resolveOpenAiBinding = async (options) => {
    if (options.reference === 'secret-process-task-openai') openAiBindingLookupCount += 1;
    const binding = await originalResolveOpenAiBinding(options);
    if (pauseNextTaskBindingLookup && options.reference === 'secret-process-task-openai') {
      pauseNextTaskBindingLookup = false;
      markTaskBindingLookup({ transactionClient: Boolean(options.client) });
      await taskBindingLookupGate;
    }
    return binding;
  };

  let project = (await request(app.base, '/api/v1/projects', {
    ...as('alice'), method: 'POST', body: command('process-task-project', { name: 'Assigned service workflow' }),
  }, 201)).data;
  const answers = [
    'A repair membership that reduces emergency restaurant downtime.',
    'Restaurant owners receive preventive maintenance and documented repairs.',
    'Monthly membership and parts keep travel, inventory, and cash exposure manageable.',
    'A human approves safety-critical repairs and spending.',
  ];
  for (const [index, content] of answers.entries()) {
    project = (await request(app.base, `/api/v1/projects/${project.id}/messages`, {
      ...as('alice'), method: 'POST', body: command(`process-task-answer-${index}`, { content }, project.version),
    })).data;
  }
  const membersRoute = `/api/v1/projects/${project.id}/members`;
  for (const subject of ['bob', 'carol', 'servicebot']) {
    await request(app.base, membersRoute, {
      ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal(subject), access: 'editor' }),
    });
  }
  await request(app.base, membersRoute, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal('readonly'), access: 'reader' }),
  });
  const bindingRoute = `/api/v1/projects/${project.id}/actor-bindings/proposals`;
  const bindingEnableRoute = `${bindingRoute}/enable`;
  const bind = async ({ actorId, roleId, target, label }) => {
    const payload = { actorId, roleId, targetPrincipal: principal(target), blueprintVersion: 1 };
    project = (await request(app.base, bindingRoute, {
      ...as('alice'), method: 'POST', body: command(`process-task-bind-${label}`, payload, project.version),
    })).data;
    project = (await request(app.base, bindingEnableRoute, {
      ...as('alice'), method: 'POST', body: command(`process-task-enable-${label}`, { actorId, roleId, blueprintVersion: 1 }, project.version),
    })).data;
  };
  await bind({ actorId: 'actor-design-assistant', roleId: 'role-design-assistant', target: 'servicebot', label: 'agent' });
  await bind({ actorId: 'actor-founder', roleId: 'role-founder', target: 'bob', label: 'human' });

  const plansRoute = `/api/v1/projects/${project.id}/process-plans`;
  const planned = await request(app.base, plansRoute, {
    ...as('alice'), method: 'POST', body: command('process-task-plan', { processId: 'process-review' }, project.version),
  }, 201);
  const plan = planned.data.processPlans[0];
  const revisionRoute = `${plansRoute}/${plan.id}/revisions`;
  const assignments = plan.tasks.map((task) => {
    if (task.id === 'task-process-review') return { roleId: 'role-founder', actorId: 'actor-founder' };
    return { roleId: 'role-design-assistant', actorId: 'actor-design-assistant' };
  });
  const revisionPayload = { tasks: plan.tasks.map((task, index) => ({
    taskId: task.id, title: task.title, detail: task.detail, dependencies: task.dependencies,
    ...assignments[index],
  })) };
  const revised = await request(app.base, revisionRoute, {
    ...as('alice'), method: 'POST', body: command('process-task-plan-revision-2', revisionPayload, planned.data.version),
  });
  const currentPlan = revised.data.processPlans.at(-1);
  const planInput = { projectId: project.id, planId: plan.id, revision: 2, taskId: 'task-process-learn', profileId: 'process-task-failure' };
  const successInput = { ...planInput, profileId: 'process-task-success' };
  const blockedOpenAiDependency = await taskRequest('process-task-openai-dependency-blocked', {
    projectId: project.id, planId: plan.id, revision: 2, taskId: 'task-process-deliver', profileId: 'process-task-openai',
  }, 'alice', 409);
  assert.equal(blockedOpenAiDependency.error.code, 'PROCESS_TASK_DEPENDENCY_UNSATISFIED');
  assert.equal(openAiBindingLookupCount, 0, 'task dependency preflight runs before OpenAI credential resolution');

  pauseNextTaskBindingLookup = true;
  const openAiRequestPromise = taskRequest('process-task-openai-root', { ...planInput, profileId: 'process-task-openai' });
  let bindingLookupTimeout;
  const observedBindingLookup = await Promise.race([
    taskBindingLookupObserved,
    new Promise((_, reject) => {
      bindingLookupTimeout = setTimeout(() => reject(new Error('The linked OpenAI credential lookup did not reach its post-preflight transaction point.')), 5_000);
    }),
  ]);
  clearTimeout(bindingLookupTimeout);
  assert.equal(observedBindingLookup.transactionClient, true, 'linked profile metadata is resolved on the saved-task PostgreSQL transaction client');
  let credentialMutationFinished = false;
  const concurrentMetadataMutation = app.persistence.query(`update orgward.secret_references set updated_at=clock_timestamp()
    where tenant_id='tenant-a' and reference='secret-process-task-openai'`).then(() => { credentialMutationFinished = true; });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(credentialMutationFinished, false, 'the active credential row remains locked until the linked approval request commits');
  releaseTaskBindingLookup();
  const openAiRequest = await openAiRequestPromise;
  await concurrentMetadataMutation;
  assert.equal(openAiRequest.status, 'AWAITING_APPROVAL');
  assert.deepEqual(openAiRequest.profile.credential, { reference: 'secret-process-task-openai', version: 1 });
  assert.equal(openAiRequest.profile.providerModel, 'gpt-fixture');
  assert.equal(JSON.stringify(openAiRequest).includes(openAiFixtureSecret), false, 'run responses contain no credential material');
  const openAiRunState = await app.persistence.query(`select state from orgward.aggregates
    where tenant_id='tenant-a' and aggregate_kind='execution_run' and aggregate_id=$1`, [openAiRequest.id]);
  assert.equal(JSON.stringify(openAiRunState.rows[0].state).includes(openAiFixtureSecret), false,
    'persisted run state contains only the credential reference and generation');
  const openAiReplay = await taskRequest('process-task-openai-root', { ...planInput, profileId: 'process-task-openai' }, 'alice', 200);
  assert.equal(openAiReplay.meta.replayed, true);
  assert.equal(openAiReplay.id, openAiRequest.id);
  assert.equal(openAiBindingLookupCount, 1, 'idempotent replay does not resolve a newer credential generation');
  const openAiApproved = await request(app.base, `/api/execution/runs/${openAiRequest.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: openAiRequest.version }),
  });
  assert.equal(openAiApproved.status, 'APPROVED');
  assert.equal(openAiBindingLookupCount, 2, 'approval revalidates and locks the pinned credential generation');
  await app.secretStore.put({
    tenantId: 'tenant-a', actor: principal('alice'), actorAuthzGeneration: await authzGeneration(app, 'alice'),
    reference: 'secret-process-task-openai', commandId: 'process-task-openai-secret-v2', expectedVersion: 1,
    value: `${openAiFixtureSecret}-rotated`, reason: 'Rotate encrypted fixture credential',
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  });
  await app.persistence.query(`update orgward.secret_references set active_provider='openai', active_model='gpt-fixture'
    where tenant_id='tenant-a' and reference='secret-process-task-openai'`);
  const staleOpenAiExecution = await request(app.base, `/api/execution/runs/${openAiRequest.id}/execute`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: openAiApproved.version }),
  }, 409);
  assert.match(staleOpenAiExecution.error, /credential binding changed after approval/i);
  assert.equal(providerCallCount, 0, 'stale credential generation is denied before the local provider transport');

  const openAiRequestForStaleApproval = await taskRequest('process-task-openai-stale-approval', {
    ...planInput, profileId: 'process-task-openai',
  });
  assert.equal(openAiRequestForStaleApproval.profile.credential.version, 2);
  await app.secretStore.put({
    tenantId: 'tenant-a', actor: principal('alice'), actorAuthzGeneration: await authzGeneration(app, 'alice'),
    reference: 'secret-process-task-openai', commandId: 'process-task-openai-secret-v3', expectedVersion: 2,
    value: `${openAiFixtureSecret}-rotated-again`, reason: 'Rotate fixture credential before approval',
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  });
  await app.persistence.query(`update orgward.secret_references set active_provider='openai', active_model='gpt-fixture'
    where tenant_id='tenant-a' and reference='secret-process-task-openai'`);
  const staleOpenAiApproval = await request(app.base, `/api/execution/runs/${openAiRequestForStaleApproval.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: openAiRequestForStaleApproval.version }),
  }, 409);
  assert.match(staleOpenAiApproval.error, /credential or profile changed before approval/i);
  assert.equal(providerCallCount, 0, 'approval of a rotated pinned generation performs no provider call');

  const openAiSuccessfulRequest = await taskRequest('process-task-openai-current-success', {
    ...planInput, profileId: 'process-task-openai',
  });
  assert.equal(openAiSuccessfulRequest.status, 'AWAITING_APPROVAL');
  assert.equal(openAiSuccessfulRequest.profile.credential.version, 3);
  const openAiPaused = await request(app.base, `/api/execution/runs/${openAiSuccessfulRequest.id}/pause`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ commandId: 'process-task-openai-current-pause',
      projectId: project.id, version: openAiSuccessfulRequest.version }),
  });
  const oversizedAmendmentRequirements = Array.from({ length: 50 }, (_, index) => `Requirement ${index}: ${'x'.repeat(480)}`);
  const oversizedOpenAiAmendment = await request(app.base, `/api/execution/runs/${openAiSuccessfulRequest.id}/amend`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ commandId: 'process-task-openai-current-amend-oversized',
      projectId: project.id, version: openAiPaused.version, objective: 'This amended objective must not dispatch.',
      requirements: oversizedAmendmentRequirements, reason: 'Exercise the full UTF-8 prompt limit.' }),
  }, 413);
  assert.equal(oversizedOpenAiAmendment.error.code, 'PROCESS_TASK_PROPOSAL_CONTEXT_TOO_LARGE');
  assert.equal(providerCallCount, 0, 'an oversized amended proposal prompt is rejected before provider dispatch');
  const stillPausedAfterOversize = await request(app.base, `/api/execution/runs/${openAiSuccessfulRequest.id}`, as('alice'));
  assert.equal(stillPausedAfterOversize.status, 'PAUSED');
  assert.equal(stillPausedAfterOversize.interventionRevisions?.length ?? 0, 0,
    'an oversized amendment is rejected before its revision is persisted');
  const openAiAmended = await request(app.base, `/api/execution/runs/${openAiSuccessfulRequest.id}/amend`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ commandId: 'process-task-openai-current-amend',
      projectId: project.id, version: openAiPaused.version,
      objective: 'Reassess the recurring customer signal and propose the clearest service need.',
      requirements: openAiSuccessfulRequest.workItem.requirements,
      reason: 'Clarify the decision expected from the revised provider prompt.' }),
  });
  assert.equal(openAiAmended.workItem.objective, openAiSuccessfulRequest.workItem.objective,
    'provider instructions are supplemental to the unchanged plan-derived work item');
  const openAiResumed = await request(app.base, `/api/execution/runs/${openAiSuccessfulRequest.id}/resume`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ commandId: 'process-task-openai-current-resume',
      projectId: project.id, version: openAiAmended.version }),
  });
  const openAiSuccessfulApproval = await request(app.base, `/api/execution/runs/${openAiSuccessfulRequest.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: openAiResumed.version }),
  });
  assert.equal(openAiSuccessfulApproval.status, 'APPROVED');
  const openAiSuccessfulRun = await request(app.base, `/api/execution/runs/${openAiSuccessfulRequest.id}/execute`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: openAiSuccessfulApproval.version }),
  });
  assert.equal(openAiSuccessfulRun.status, 'SUCCEEDED');
  assert.equal(openAiSuccessfulRun.execution.status, 'COMPLETED');
  assert.equal(openAiSuccessfulRun.execution.stdout, JSON.stringify({
    proposedDetail: 'Recurring repair signals are grouped into service needs for founder review.',
    rationale: 'The saved customer signal describes recurring repair history.',
    citations: ['information-customer-signal'],
  }));
  assert.match(openAiSuccessfulRun.execution.evidenceHash, /^[a-f0-9]{64}$/);
  const generatedProposal = openAiSuccessfulRun.execution.generatedProposal;
  assert.equal(generatedProposal.status, 'proposed');
  assert.equal(generatedProposal.blueprintId, openAiSuccessfulRequest.processTaskRef.blueprintId);
  assert.equal(generatedProposal.blueprintVersion, openAiSuccessfulRequest.processTaskRef.blueprintVersion);
  assert.equal(generatedProposal.target.id, 'information-prioritised-need');
  assert.equal(generatedProposal.target.before, 'A qualified need ready for delivery.');
  assert.deepEqual(generatedProposal.citations.map(({ id }) => id), ['information-customer-signal']);
  assert.equal(generatedProposal.sourceEnvelope.sources.length, 1);
  assert.equal(generatedProposal.sourceEnvelope.sources[0].id, 'information-customer-signal');
  assert.match(generatedProposal.sourceEnvelope.sources[0].hash, /^[a-f0-9]{64}$/);
  assert.match(generatedProposal.proposalHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(providerRequest.body, {
    model: 'gpt-fixture',
    input: buildBlueprintProposalPrompt({
      task: { id: openAiSuccessfulRequest.processTaskRef.taskId, title: openAiSuccessfulRequest.title,
        detail: openAiAmended.interventionRevisions[0].objective },
      proposalContext: openAiSuccessfulRequest.workItem.proposalContext,
      amendedRequirements: openAiAmended.interventionRevisions[0].requirements,
    }),
    store: false, max_output_tokens: 2_000, tools: [],
  });
  assert.doesNotMatch(providerRequest.body.input, /information-unrelated|private-principal|fixture-openai-credential/);
  assert.ok(Buffer.byteLength(providerRequest.body.input, 'utf8') <= 16 * 1024,
    'the complete provider prompt including amended requirements stays within the 16 KiB limit');
  assert.equal(providerCallCount, 1);
  assert.equal(providerRequest.url, '/v1/responses');
  assert.equal(providerRequest.authorization, `Bearer ${openAiFixtureSecret}-rotated-again`);
  assert.equal(JSON.stringify(openAiSuccessfulRun).includes(openAiFixtureSecret), false,
    'the completed run does not return any credential generation material');
  assert.equal(JSON.stringify(generatedProposal).includes(principal('servicebot')), false,
    'the proposal source envelope does not include target workload identity data');

  const staleCredentialPauseRequest = await taskRequest('process-task-openai-stale-resume-request', {
    ...planInput, profileId: 'process-task-openai',
  });
  const staleCredentialPaused = await request(app.base, `/api/execution/runs/${staleCredentialPauseRequest.id}/pause`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({
      commandId: 'process-task-openai-stale-resume-pause', projectId: project.id, version: staleCredentialPauseRequest.version,
    }),
  });
  assert.equal(staleCredentialPaused.status, 'PAUSED');
  await app.secretStore.put({
    tenantId: 'tenant-a', actor: principal('alice'), actorAuthzGeneration: await authzGeneration(app, 'alice'),
    reference: 'secret-process-task-openai', commandId: 'process-task-openai-secret-v4', expectedVersion: 3,
    value: `${openAiFixtureSecret}-rotated-fourth`, reason: 'Rotate fixture credential while linked request is paused',
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  });
  await app.persistence.query(`update orgward.secret_references set active_provider='openai', active_model='gpt-fixture'
    where tenant_id='tenant-a' and reference='secret-process-task-openai'`);
  const staleCredentialResume = await request(app.base, `/api/execution/runs/${staleCredentialPauseRequest.id}/resume`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({
      commandId: 'process-task-openai-stale-resume-resume', projectId: project.id, version: staleCredentialPaused.version,
    }),
  }, 409);
  assert.equal(staleCredentialResume.error.code, 'EXECUTION_PROFILE_STALE');
  assert.equal(providerCallCount, 1, 'a paused or stale-generation request never contacts the loopback provider');
  const pausedCredentialLease = await app.persistence.query(`select 1 from orgward.execution_worker_leases where tenant_id='tenant-a' and run_id=$1`, [staleCredentialPauseRequest.id]);
  assert.equal(pausedCredentialLease.rowCount, 0, 'pausing before dispatch creates no worker lease');
  assert.equal((await request(app.base, `/api/execution/runs/${staleCredentialPauseRequest.id}`, as('alice'))).status, 'PAUSED',
    'a stale credential leaves the request paused for a new request or cancellation');

  const pendingPauseRequest = await taskRequest('process-task-pause-pending-request', successInput);
  const pendingPauseBody = {
    commandId: 'process-task-pause-pending-command', projectId: project.id, version: pendingPauseRequest.version,
  };
  const nonRequesterPause = await request(app.base, `/api/execution/runs/${pendingPauseRequest.id}/pause`, {
    ...as('bob'), method: 'POST', body: JSON.stringify(pendingPauseBody),
  }, 403);
  assert.equal(nonRequesterPause.error.code, 'ACTION_FORBIDDEN');
  const readerPauseDenied = await request(app.base, `/api/execution/runs/${pendingPauseRequest.id}/pause`, {
    ...as('readonly'), method: 'POST', body: JSON.stringify(pendingPauseBody),
  }, 403);
  assert.equal(readerPauseDenied.error.code, 'ACTION_FORBIDDEN');
  const pausedPending = await request(app.base, `/api/execution/runs/${pendingPauseRequest.id}/pause`, {
    ...as('alice'), method: 'POST', body: JSON.stringify(pendingPauseBody),
  });
  assert.equal(pausedPending.status, 'PAUSED');
  assert.equal(pausedPending.approval, null);
  assert.equal(pausedPending.events.at(-1).type, 'ExecutionPaused');
  assert.equal(pausedPending.events.at(-1).data.priorStatus, 'AWAITING_APPROVAL');
  const pinnedRequestHash = executionApprovalRequestHash(pausedPending);
  const amendmentBody = {
    commandId: 'process-task-pause-pending-amend', projectId: project.id, version: pausedPending.version,
    objective: 'Review the agreed customer signal and propose one priority.',
    requirements: ['Use the saved customer evidence.', 'Explain the priority in one sentence.'],
    reason: 'Narrow the result to the decision needed by the review meeting.',
  };
  const nonRequesterAmendment = await request(app.base, `/api/execution/runs/${pendingPauseRequest.id}/amend`, {
    ...as('bob'), method: 'POST', body: JSON.stringify(amendmentBody),
  }, 403);
  assert.equal(nonRequesterAmendment.error.code, 'ACTION_FORBIDDEN');
  const amendedPending = await request(app.base, `/api/execution/runs/${pendingPauseRequest.id}/amend`, {
    ...as('alice'), method: 'POST', body: JSON.stringify(amendmentBody),
  });
  assert.equal(amendedPending.status, 'PAUSED');
  assert.equal(amendedPending.approval, null);
  assert.equal(amendedPending.workItem.objective, pendingPauseRequest.workItem.objective,
    'the immutable plan-derived work item remains unchanged');
  assert.equal(amendedPending.interventionRevisions.length, 1);
  assert.equal(amendedPending.interventionRevisions[0].reason, amendmentBody.reason);
  assert.equal(amendedPending.events.at(-1).type, 'ExecutionInstructionsAmended');
  assert.equal(amendedPending.events.at(-1).data.revision.instructionHash, amendedPending.interventionRevisions[0].instructionHash);
  assert.notEqual(executionApprovalRequestHash(amendedPending), pinnedRequestHash,
    'the amended snapshot creates a distinct approval request hash');
  const amendmentReplay = await request(app.base, `/api/execution/runs/${pendingPauseRequest.id}/amend`, {
    ...as('alice'), method: 'POST', body: JSON.stringify(amendmentBody),
  });
  assert.equal(amendmentReplay.meta.replayed, true);
  assert.equal(amendmentReplay.interventionRevisions.length, 1,
    'idempotent replay does not append a duplicate amendment');
  const conflictingAmendmentReplay = await request(app.base, `/api/execution/runs/${pendingPauseRequest.id}/amend`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ ...amendmentBody, reason: 'different input' }),
  }, 409);
  assert.equal(conflictingAmendmentReplay.error.code, 'IDEMPOTENCY_CONFLICT');
  const amendedReadback = await request(app.base, `/api/execution/runs/${pendingPauseRequest.id}`, as('alice'));
  assert.equal(amendedReadback.interventionRevisions[0].objective, amendmentBody.objective,
    'the amendment survives aggregate reload');
  const processInstancePauseRuntime = (await request(app.base,
    `/api/execution/process-task-instances?projectId=${encodeURIComponent(project.id)}`, as('alice'))).instances
    .find((runtime) => runtime.executionRunId === pendingPauseRequest.id);
  assert.equal(processInstancePauseRuntime.instanceControl.status, 'ACTIVE');
  const processInstancePauseBody = {
    schemaVersion: '1.0', commandId: 'process-instance-pause-pending',
    payload: { projectId: project.id, planInstanceId: pendingPauseRequest.processTaskRef.planInstanceId,
      version: processInstancePauseRuntime.instanceControl.version, reason: 'Hold this review while requirements are checked.' },
  };
  const nonInitiatorInstancePause = await request(app.base, '/api/execution/process-task-instances/pause', {
    ...as('bob'), method: 'POST', body: JSON.stringify(processInstancePauseBody),
  }, 403);
  assert.equal(nonInitiatorInstancePause.error.code, 'ACTION_FORBIDDEN');
  const processInstancePaused = await request(app.base, '/api/execution/process-task-instances/pause', {
    ...as('alice'), method: 'POST', body: JSON.stringify(processInstancePauseBody),
  });
  assert.equal(processInstancePaused.status, 'PAUSED');
  assert.equal(processInstancePaused.pauseBoundary.tasks.length, 0,
    'an instance with no in-flight work pauses immediately');
  const linkedResumeWhileInstancePaused = await request(app.base, `/api/execution/runs/${pendingPauseRequest.id}/resume`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({
      commandId: 'task-resume-while-instance-paused', projectId: project.id, version: amendedPending.version,
    }),
  }, 409);
  assert.equal(linkedResumeWhileInstancePaused.error.code, 'PROCESS_INSTANCE_PAUSED');
  const processInstancePauseReplay = await request(app.base, '/api/execution/process-task-instances/pause', {
    ...as('alice'), method: 'POST', body: JSON.stringify(processInstancePauseBody),
  });
  assert.equal(processInstancePauseReplay.replayed, true);
  await close(app);
  app = await start(postgres.databaseUrl, {
    executionProfiles: profiles, oidcAuthenticator, secretEncryptionKey: Buffer.alloc(32, 0x5c),
    openAiValidationEndpoint: `${providerOrigin}/v1/models`,
  });
  const amendedAfterRestart = await request(app.base, `/api/execution/runs/${pendingPauseRequest.id}`, as('alice'));
  assert.deepEqual(amendedAfterRestart.interventionRevisions, amendedPending.interventionRevisions,
    'the append-only instruction snapshot survives application restart');
  const controlAfterRestart = (await request(app.base,
    `/api/execution/process-task-instances?projectId=${encodeURIComponent(project.id)}`, as('alice'))).instances
    .find((runtime) => runtime.executionRunId === pendingPauseRequest.id).instanceControl;
  assert.equal(controlAfterRestart.status, 'PAUSED', 'instance pause status survives application restart');
  assert.equal(controlAfterRestart.events.filter((event) => event.type === 'ProcessTaskInstancePauseRequested').length, 1);
  const processInstanceResumeBody = {
    schemaVersion: '1.0', commandId: 'process-instance-resume-pending',
    payload: { projectId: project.id, planInstanceId: pendingPauseRequest.processTaskRef.planInstanceId,
      version: controlAfterRestart.version },
  };
  const processInstanceResumed = await request(app.base, '/api/execution/process-task-instances/resume', {
    ...as('alice'), method: 'POST', body: JSON.stringify(processInstanceResumeBody),
  });
  assert.equal(processInstanceResumed.status, 'ACTIVE');
  assert.equal(processInstanceResumed.freshApprovalRequired, true);
  const processInstanceResumeReplay = await request(app.base, '/api/execution/process-task-instances/resume', {
    ...as('alice'), method: 'POST', body: JSON.stringify(processInstanceResumeBody),
  });
  assert.equal(processInstanceResumeReplay.replayed, true);
  const pausedPendingReplay = await request(app.base, `/api/execution/runs/${pendingPauseRequest.id}/pause`, {
    ...as('alice'), method: 'POST', body: JSON.stringify(pendingPauseBody),
  });
  assert.equal(pausedPendingReplay.meta.replayed, true);
  assert.equal(pausedPendingReplay.events.filter((event) => event.type === 'ExecutionPaused').length, 1);
  const changedPauseReplay = await request(app.base, `/api/execution/runs/${pendingPauseRequest.id}/pause`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ ...pendingPauseBody, version: pendingPauseBody.version + 1 }),
  }, 409);
  assert.equal(changedPauseReplay.error.code, 'IDEMPOTENCY_CONFLICT');
  const pausedPendingRuntime = (await request(app.base,
    `/api/execution/process-task-instances?projectId=${encodeURIComponent(project.id)}`, as('alice'))).instances
    .find((runtime) => runtime.executionRunId === pendingPauseRequest.id);
  assert.equal(pausedPendingRuntime.status, 'PAUSED');
  assert.equal(pausedPendingRuntime.startedAt, null);
  assert.equal(pausedPendingRuntime.completedAt, null);
  await assert.rejects(() => app.persistence.query(`
    update orgward.process_task_instances set status='RUNNING', version=version+1
    where tenant_id='tenant-a' and plan_instance_id=$1 and task_id=$2
  `, [pendingPauseRequest.processTaskRef.planInstanceId, pendingPauseRequest.processTaskRef.taskId]),
  /paused workload task can only resume|pause runtime event/i,
  'the database rejects a direct paused-to-running transition');
  await assert.rejects(() => app.persistence.query(`
    update orgward.process_task_instances set version=version+1
    where tenant_id='tenant-a' and plan_instance_id=$1 and task_id=$2
  `, [pendingPauseRequest.processTaskRef.planInstanceId, pendingPauseRequest.processTaskRef.taskId]),
  /paused process task cannot change/i, 'the database keeps a paused runtime immutable between commands');
  assert.equal(providerCallCount, 1, 'a paused request has not dispatched a provider call');
  const pendingPauseLease = await app.persistence.query(`select 1 from orgward.execution_worker_leases where tenant_id='tenant-a' and run_id=$1`, [pendingPauseRequest.id]);
  assert.equal(pendingPauseLease.rowCount, 0, 'a paused request holds no worker lease');

  const resumedPending = await request(app.base, `/api/execution/runs/${pendingPauseRequest.id}/resume`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({
      commandId: 'process-task-pause-pending-resume', projectId: project.id, version: amendedPending.version,
    }),
  });
  assert.equal(resumedPending.status, 'AWAITING_APPROVAL');
  assert.equal(resumedPending.approval, null);
  assert.equal(resumedPending.events.at(-1).type, 'ExecutionResumed');
  assert.equal(resumedPending.events.at(-1).data.requiresFreshApproval, true);
  const resumedPendingReplay = await request(app.base, `/api/execution/runs/${pendingPauseRequest.id}/resume`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({
      commandId: 'process-task-pause-pending-resume', projectId: project.id, version: amendedPending.version,
    }),
  });
  assert.equal(resumedPendingReplay.meta.replayed, true);
  assert.equal(resumedPendingReplay.events.filter((event) => event.type === 'ExecutionResumed').length, 1);
  const resumedApproval = await request(app.base, `/api/execution/runs/${pendingPauseRequest.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: resumedPending.version }),
  });
  assert.equal(resumedApproval.status, 'APPROVED');
  assert.equal(resumedApproval.approval.principal, principal('bob'));
  assert.equal(resumedApproval.approval.requestHash, executionApprovalRequestHash(resumedApproval),
    'the successor approver approves the amended instruction snapshot');
  assert.equal(resumedApproval.events.filter((event) => event.type === 'ExecutionApproved').length, 1,
    'resume requires a new independent approval');
  const resumedExecution = await request(app.base, `/api/execution/runs/${pendingPauseRequest.id}/execute`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: resumedApproval.version }),
  });
  assert.equal(resumedExecution.status, 'SUCCEEDED');

  const instanceControlForRun = async (run) => (await request(app.base,
    `/api/execution/process-task-instances?projectId=${encodeURIComponent(project.id)}`, as('alice'))).instances
    .find((runtime) => runtime.executionRunId === run.id).instanceControl;
  const requestInstancePause = (run, control, commandId, subject = 'alice') => request(app.base, '/api/execution/process-task-instances/pause', {
    ...as(subject), method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', commandId,
      payload: { projectId: project.id, planInstanceId: run.processTaskRef.planInstanceId,
        version: control.version, reason: 'Pause at a verified safe boundary.' } }),
  });

  const ownerRecoveryRun = await taskRequest('process-task-owner-recovery-request', successInput, 'bob');
  const ownerRecoveryApproval = await request(app.base, `/api/execution/runs/${ownerRecoveryRun.id}/approve`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: ownerRecoveryRun.version }),
  });
  const ownerRecoveryControl = await instanceControlForRun(ownerRecoveryRun);
  const ownerRecoveryPause = await requestInstancePause(ownerRecoveryRun, ownerRecoveryControl,
    'process-instance-owner-recovery-pause', 'bob');
  assert.equal(ownerRecoveryPause.status, 'PAUSED');
  const ownerRecoveryParentResume = await request(app.base, '/api/execution/process-task-instances/resume', {
    ...as('alice'), method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', commandId: 'process-instance-owner-recovery-resume',
      payload: { projectId: project.id, planInstanceId: ownerRecoveryRun.processTaskRef.planInstanceId,
        version: ownerRecoveryPause.version } }),
  });
  assert.equal(ownerRecoveryParentResume.status, 'ACTIVE');
  await app.persistence.query(`update orgward.oidc_principals set status='revoked',revoked_at=now(),revoked_by=$2,
    revocation_reason='Test requester is unavailable during owner recovery.',updated_at=now()
    where tenant_id='tenant-a' and principal=$1`, [principal('bob'), principal('alice')]);
  const nonOwnerRunRecovery = await request(app.base, `/api/execution/runs/${ownerRecoveryRun.id}/resume`, {
    ...as('carol'), method: 'POST', body: JSON.stringify({ commandId: 'process-task-owner-recovery-denied',
      projectId: project.id, version: ownerRecoveryApproval.version + 1,
      reason: 'A non-owner must not recover another editor’s task.' }),
  }, 403);
  assert.equal(nonOwnerRunRecovery.error.code, 'ACTION_FORBIDDEN');
  const ownerRecoveryMissingReason = await request(app.base, `/api/execution/runs/${ownerRecoveryRun.id}/resume`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ commandId: 'process-task-owner-recovery-reason-required',
      projectId: project.id, version: ownerRecoveryApproval.version + 1 }),
  }, 409);
  assert.equal(ownerRecoveryMissingReason.error.code, 'RECOVERY_REASON_REQUIRED');
  const ownerRecoveryResumed = await request(app.base, `/api/execution/runs/${ownerRecoveryRun.id}/resume`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ commandId: 'process-task-owner-recovery-resume',
      projectId: project.id, version: ownerRecoveryPause.pauseBoundary.tasks[0]?.runVersion ?? ownerRecoveryApproval.version + 1,
      reason: 'The original requester is no longer available; reopen for independent review.' }),
  });
  assert.equal(ownerRecoveryResumed.status, 'AWAITING_APPROVAL');
  assert.equal(ownerRecoveryResumed.requestedBy, ownerRecoveryRun.requestedBy,
    'owner recovery keeps the original requester attached to the approval history');
  assert.equal(ownerRecoveryResumed.approval, null);
  assert.equal(ownerRecoveryResumed.events.at(-1).type, 'ExecutionResumed');
  assert.equal(ownerRecoveryResumed.events.filter((event) => event.type === 'ExecutionApproved').length, 1,
    'the original approval stays in append-only history while the current approval is cleared');
  assert.equal(ownerRecoveryResumed.events.filter((event) => event.type === 'ExecutionResumed').length, 1);
  assert.equal(ownerRecoveryResumed.events.at(-1).actor, principal('alice'));
  assert.equal(ownerRecoveryResumed.events.at(-1).data.ownerRecovery, true);
  assert.equal(ownerRecoveryResumed.events.at(-1).data.reason, 'The original requester is no longer available; reopen for independent review.');
  const ownerRecoveryReplay = await request(app.base, `/api/execution/runs/${ownerRecoveryRun.id}/resume`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ commandId: 'process-task-owner-recovery-resume',
      projectId: project.id, version: ownerRecoveryPause.pauseBoundary.tasks[0]?.runVersion ?? ownerRecoveryApproval.version + 1,
      reason: 'The original requester is no longer available; reopen for independent review.' }),
  });
  assert.equal(ownerRecoveryReplay.meta.replayed, true);
  await app.persistence.query(`update orgward.oidc_principals set status='active',revoked_at=null,revoked_by=null,
    revocation_reason=null,updated_at=now()
    where tenant_id='tenant-a' and principal = any($1::text[])`, [[principal('bob'), principal('alice')]]);
  const ownerRecoverySelfApproval = await request(app.base, `/api/execution/runs/${ownerRecoveryRun.id}/approve`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: ownerRecoveryResumed.version }),
  }, 409);
  assert.equal(ownerRecoverySelfApproval.error,
    'The owner who recovered this task cannot approve its fresh request.');
  const ownerRecoveryFreshApproval = await request(app.base, `/api/execution/runs/${ownerRecoveryRun.id}/approve`, {
    ...as('carol'), method: 'POST', body: JSON.stringify({ version: ownerRecoveryResumed.version }),
  });
  assert.equal(ownerRecoveryFreshApproval.status, 'APPROVED');

  const beforeAuthorizationRun = await taskRequest('process-instance-pause-before-auth-request', {
    ...successInput, profileId: 'process-task-slow',
  });
  const beforeAuthorizationApproved = await request(app.base, `/api/execution/runs/${beforeAuthorizationRun.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: beforeAuthorizationRun.version }),
  });
  const originalAuthorize = app.executionService.store.authorizeExecutionDispatch.bind(app.executionService.store);
  let releaseBeforeAuthorization;
  let markBeforeAuthorization;
  const beforeAuthorizationGate = new Promise((resolve) => { releaseBeforeAuthorization = resolve; });
  const beforeAuthorizationObserved = new Promise((resolve) => { markBeforeAuthorization = resolve; });
  app.executionService.store.authorizeExecutionDispatch = async (input) => {
    markBeforeAuthorization();
    await beforeAuthorizationGate;
    return originalAuthorize(input);
  };
  const beforeAuthorizationExecution = request(app.base, `/api/execution/runs/${beforeAuthorizationRun.id}/execute`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: beforeAuthorizationApproved.version }),
  });
  await beforeAuthorizationObserved;
  const beforeAuthorizationControl = await instanceControlForRun(beforeAuthorizationRun);
  const beforeAuthorizationPause = await requestInstancePause(beforeAuthorizationRun, beforeAuthorizationControl,
    'process-instance-pause-before-auth');
  assert.equal(beforeAuthorizationPause.status, 'PAUSE_REQUESTED');
  releaseBeforeAuthorization();
  const beforeAuthorizationResult = await beforeAuthorizationExecution;
  app.executionService.store.authorizeExecutionDispatch = originalAuthorize;
  assert.equal(beforeAuthorizationResult.status, 'PAUSED', 'pause wins before dispatch authorization and preserves the request for fresh approval');
  const beforeAuthorizationLease = await app.persistence.query(`select 1 from orgward.execution_worker_leases where tenant_id='tenant-a' and run_id=$1`, [beforeAuthorizationRun.id]);
  assert.equal(beforeAuthorizationLease.rowCount, 0);
  assert.equal((await instanceControlForRun(beforeAuthorizationRun)).status, 'PAUSED');

  const leaseBeforeReserveRun = await taskRequest('process-instance-pause-after-lease-request', {
    ...planInput, profileId: 'process-task-openai',
  });
  const leaseBeforeReserveApproved = await request(app.base, `/api/execution/runs/${leaseBeforeReserveRun.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: leaseBeforeReserveRun.version }),
  });
  let releaseAfterLease;
  let markAfterLease;
  const afterLeaseGate = new Promise((resolve) => { releaseAfterLease = resolve; });
  const afterLeaseObserved = new Promise((resolve) => { markAfterLease = resolve; });
  const providerCallsBeforeLeaseRace = providerCallCount;
  app.executionService.store.authorizeExecutionDispatch = async (input) => {
    const authorized = await originalAuthorize(input);
    markAfterLease();
    await afterLeaseGate;
    return authorized;
  };
  const leaseBeforeReserveExecution = request(app.base, `/api/execution/runs/${leaseBeforeReserveRun.id}/execute`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: leaseBeforeReserveApproved.version }),
  });
  await afterLeaseObserved;
  const leaseBeforeReserveControl = await instanceControlForRun(leaseBeforeReserveRun);
  const leaseBeforeReservePause = await requestInstancePause(leaseBeforeReserveRun, leaseBeforeReserveControl,
    'process-instance-pause-after-lease');
  assert.equal(leaseBeforeReservePause.status, 'PAUSE_REQUESTED');
  const liveLeaseBeforeReserve = await app.persistence.query(`select 1 from orgward.execution_worker_leases where tenant_id='tenant-a' and run_id=$1`, [leaseBeforeReserveRun.id]);
  assert.equal(liveLeaseBeforeReserve.rowCount, 1, 'the instance remains pause-requested while a live lease has no attempt row');
  releaseAfterLease();
  const leaseBeforeReserveResult = await leaseBeforeReserveExecution;
  app.executionService.store.authorizeExecutionDispatch = originalAuthorize;
  assert.equal(leaseBeforeReserveResult.status, 'PAUSED');
  assert.equal(providerCallCount, providerCallsBeforeLeaseRace, 'pause after lease but before reservation prevents provider dispatch');
  assert.equal((await instanceControlForRun(leaseBeforeReserveRun)).status, 'PAUSED');

  const handoffBeforePauseRun = await taskRequest('process-instance-pause-after-handoff-request', {
    ...planInput, profileId: 'process-task-openai',
  });
  const handoffBeforePauseApproved = await request(app.base, `/api/execution/runs/${handoffBeforePauseRun.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: handoffBeforePauseRun.version }),
  });
  let releaseProviderResponse;
  let markProviderHandoff;
  const providerResponseObserved = new Promise((resolve) => { markProviderHandoff = resolve; });
  const providerResponseRelease = new Promise((resolve) => { releaseProviderResponse = resolve; });
  providerResponseGate = { mark: markProviderHandoff, releasePromise: providerResponseRelease };
  const handoffBeforePauseExecution = request(app.base, `/api/execution/runs/${handoffBeforePauseRun.id}/execute`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: handoffBeforePauseApproved.version }),
  });
  await providerResponseObserved;
  const handedOffAttempt = await app.persistence.query(`select status,attempt_id from orgward.provider_dispatch_attempts
    where tenant_id='tenant-a' and run_id=$1`, [handoffBeforePauseRun.id]);
  assert.equal(handedOffAttempt.rows[0]?.status, 'handed_off', 'provider handoff is durable before pause races with the response');
  const handoffBeforePauseControl = await instanceControlForRun(handoffBeforePauseRun);
  const handoffBeforePauseRequest = await requestInstancePause(handoffBeforePauseRun, handoffBeforePauseControl,
    'process-instance-pause-after-handoff');
  assert.equal(handoffBeforePauseRequest.status, 'PAUSE_REQUESTED', 'handed-off provider work remains visibly unresolved while the response is pending');
  assert.equal(handoffBeforePauseRequest.pauseBoundary.tasks[0].attemptId, handedOffAttempt.rows[0].attempt_id);
  releaseProviderResponse();
  const handoffBeforePauseResult = await handoffBeforePauseExecution;
  assert.equal(handoffBeforePauseResult.status, 'SUCCEEDED', 'the dispatched revision may settle while the parent drains');
  assert.equal((await instanceControlForRun(handoffBeforePauseRun)).status, 'PAUSED', 'lease release settles the parent at its boundary');

  const unresolvedAfterRestartRun = await taskRequest('process-instance-unknown-recovery-request', {
    ...planInput, profileId: 'process-task-openai',
  });
  const unresolvedAfterRestartApproved = await request(app.base, `/api/execution/runs/${unresolvedAfterRestartRun.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: unresolvedAfterRestartRun.version }),
  });
  failNextProviderResponse = true;
  const unresolvedProviderResult = await request(app.base, `/api/execution/runs/${unresolvedAfterRestartRun.id}/execute`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: unresolvedAfterRestartApproved.version }),
  });
  const unknownAttempt = await app.persistence.query(`select status,attempt_id from orgward.provider_dispatch_attempts
    where tenant_id='tenant-a' and run_id=$1`, [unresolvedAfterRestartRun.id]);
  assert.equal(unknownAttempt.rows[0]?.status, 'outcome_unknown');
  assert.ok(['FAILED', 'INTERRUPTED'].includes(unresolvedProviderResult.status));

  const executionAggregate = await app.persistence.query(`select state from orgward.aggregates
    where tenant_id='tenant-a' and aggregate_kind='execution_run' and aggregate_id=$1`, [unresolvedAfterRestartRun.id]);
  const recoverySeed = executionAggregate.rows[0].state;
  recoverySeed.status = 'RUNNING';
  recoverySeed.version += 1;
  executionEvent(recoverySeed, 'ExecutionStarted', 'restart-recovery-fixture', { profileId: 'process-task-openai' });
  await app.persistence.query(`update orgward.aggregates set state=$1::jsonb,state_hash=$2,version=$3,updated_at=$4
    where tenant_id='tenant-a' and aggregate_kind='execution_run' and aggregate_id=$5`,
  [JSON.stringify(recoverySeed), contentHash(recoverySeed), recoverySeed.version, recoverySeed.updatedAt, unresolvedAfterRestartRun.id]);
  const runtimeEventValue = {
    id: 'process-task-recovery-seed-running', type: 'ProcessTaskRunStatusChanged', actor: 'execution run',
    at: recoverySeed.updatedAt, data: { runId: unresolvedAfterRestartRun.id, status: 'RUNNING', runVersion: recoverySeed.version },
  };
  const runtimeEvent = { ...runtimeEventValue, contentHash: contentHash(runtimeEventValue) };
  await app.persistence.query(`update orgward.process_task_instances set status='RUNNING',version=version+1,
    started_at=$4,completed_at=null,updated_at=$4,events=events || $5::jsonb
    where tenant_id='tenant-a' and plan_instance_id=$1 and task_id=$2 and execution_run_id=$3`,
  [unresolvedAfterRestartRun.processTaskRef.planInstanceId, unresolvedAfterRestartRun.processTaskRef.taskId,
    unresolvedAfterRestartRun.id, recoverySeed.updatedAt, JSON.stringify([runtimeEvent])]);
  await close(app);
  app = await start(postgres.databaseUrl, {
    executionProfiles: profiles, oidcAuthenticator, secretEncryptionKey: Buffer.alloc(32, 0x5c),
    openAiValidationEndpoint: `${providerOrigin}/v1/models`,
  });
  const recoveredUnknownRun = await request(app.base, `/api/execution/runs/${unresolvedAfterRestartRun.id}`, as('alice'));
  assert.equal(recoveredUnknownRun.status, 'INTERRUPTED', 'application restart recovers the persisted linked RUNNING task');
  const recoveredUnknownAttempt = await app.persistence.query(`select status,attempt_id from orgward.provider_dispatch_attempts
    where tenant_id='tenant-a' and run_id=$1`, [unresolvedAfterRestartRun.id]);
  assert.equal(recoveredUnknownAttempt.rows[0]?.status, 'outcome_unknown', 'recovery preserves the unknown external effect');
  const unknownBoundaryControl = await instanceControlForRun(unresolvedAfterRestartRun);
  const unknownBoundaryPause = await requestInstancePause(unresolvedAfterRestartRun, unknownBoundaryControl,
    'process-instance-pause-unknown-after-restart');
  assert.equal(unknownBoundaryPause.status, 'PAUSE_REQUESTED');
  assert.equal(unknownBoundaryPause.pauseBoundary.tasks[0].attemptId, unknownAttempt.rows[0].attempt_id);
  assert.equal(unknownBoundaryPause.pauseBoundary.tasks[0].attemptStatus, 'outcome_unknown');
  await close(app);
  app = await start(postgres.databaseUrl, {
    executionProfiles: profiles, oidcAuthenticator, secretEncryptionKey: Buffer.alloc(32, 0x5c),
    openAiValidationEndpoint: `${providerOrigin}/v1/models`,
  });
  const unknownBoundaryAfterRestart = await instanceControlForRun(unresolvedAfterRestartRun);
  assert.equal(unknownBoundaryAfterRestart.status, 'PAUSE_REQUESTED', 'unknown provider outcomes keep the pause request pending across restart');
  assert.equal(unknownBoundaryAfterRestart.pauseBoundary.tasks[0].attemptId, unknownAttempt.rows[0].attempt_id);
  const blockedUnknownResume = await request(app.base, '/api/execution/process-task-instances/resume', {
    ...as('alice'), method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', commandId: 'process-instance-unknown-resume-blocked',
      payload: { projectId: project.id, planInstanceId: unresolvedAfterRestartRun.processTaskRef.planInstanceId,
        version: unknownBoundaryAfterRestart.version } }),
  }, 409);
  assert.equal(blockedUnknownResume.error.code, 'PROCESS_INSTANCE_NOT_PAUSED');
  assert.equal((await instanceControlForRun(unresolvedAfterRestartRun)).status, 'PAUSE_REQUESTED');

  const abandonRoute = '/api/execution/process-task-instances/abandon-unverified';
  const unknownControlBeforeAbandon = await instanceControlForRun(unresolvedAfterRestartRun);
  assert.equal(unknownControlBeforeAbandon.status, 'PAUSE_REQUESTED');
  assert.equal(unknownControlBeforeAbandon.canAbandonUnverified, true,
    'the owner read model offers the terminal disposition for a restart-recovered OpenAI model result');
  const abandonmentPayload = { projectId: project.id, planInstanceId: unresolvedAfterRestartRun.processTaskRef.planInstanceId,
    version: unknownControlBeforeAbandon.version,
    reason: 'The original response is unavailable and cannot be verified.',
    evidence: ['Provider attempt is outcome_unknown after application restart.', 'No live worker lease or active human task remains.'],
    acknowledgeDuplicateCostWork: true };
  const nonOwnerAbandon = await request(app.base, abandonRoute, {
    ...as('carol'), method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', commandId: 'process-instance-abandon-non-owner', payload: abandonmentPayload }),
  }, 403);
  assert.equal(nonOwnerAbandon.error.code, 'ACTION_FORBIDDEN');
  const missingAbandonAcknowledgement = await request(app.base, abandonRoute, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', commandId: 'process-instance-abandon-no-ack',
      payload: { ...abandonmentPayload, acknowledgeDuplicateCostWork: false } }),
  }, 400);
  assert.equal(missingAbandonAcknowledgement.error.code, 'INVALID_COMMAND');

  // Exercise the SQL transition guard with an OpenAI run carrying an effect/tool plan.
  // The production API cannot create this shape; the row fixture proves a provider kind
  // alone cannot make an effect-capable request eligible for this terminal outcome.
  const effectfulAggregate = await app.persistence.query(`select state from orgward.aggregates
    where tenant_id='tenant-a' and aggregate_kind='execution_run' and aggregate_id=$1`, [unresolvedAfterRestartRun.id]);
  const readOnlyRunSnapshot = effectfulAggregate.rows[0].state;
  const effectfulRunSnapshot = structuredClone(readOnlyRunSnapshot);
  effectfulRunSnapshot.workItem.tools = [{ type: 'external-action', id: 'fixture-action' }];
  await app.persistence.query(`update orgward.aggregates set state=$1::jsonb,state_hash=$2
    where tenant_id='tenant-a' and aggregate_kind='execution_run' and aggregate_id=$3`,
  [JSON.stringify(effectfulRunSnapshot), contentHash(effectfulRunSnapshot), unresolvedAfterRestartRun.id]);
  const effectfulAbandon = await request(app.base, abandonRoute, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', commandId: 'process-instance-abandon-effectful-denied',
      payload: abandonmentPayload }),
  }, 409);
  assert.equal(effectfulAbandon.error.code, 'PROCESS_INSTANCE_ABANDONMENT_NOT_ALLOWED');
  const ownerAuthz = await authzGeneration(app, 'alice');
  const triggerEvent = { id: 'process-instance-effectful-abandon-denied', type: 'ProcessTaskInstanceAbandonedUnverified',
    actor: principal('alice'), at: new Date().toISOString(), causationId: 'process-instance-effectful-abandon-denied',
    data: { planInstanceId: unresolvedAfterRestartRun.processTaskRef.planInstanceId,
      priorStatus: 'PAUSE_REQUESTED', resultingStatus: 'ABANDONED_UNVERIFIED',
      reason: 'Test tool-capable task denial.', runIds: [unresolvedAfterRestartRun.id],
      attemptIds: [unknownAttempt.rows[0].attempt_id], evidence: ['This model task carries an effect plan.'],
      acknowledgeDuplicateCostWork: true, authzGeneration: ownerAuthz } };
  await assert.rejects(() => app.persistence.query(`update orgward.process_task_instance_controls
    set status='ABANDONED_UNVERIFIED',pause_reason='Test tool-capable task denial.',version=version+1,
      events=events || $1::jsonb,updated_at=now()
    where tenant_id='tenant-a' and plan_instance_id=$2`,
  [JSON.stringify([triggerEvent]), unresolvedAfterRestartRun.processTaskRef.planInstanceId]),
  /Only unresolved outcomes from built-in OpenAI model tasks/);
  await app.persistence.query(`update orgward.aggregates set state=$1::jsonb,state_hash=$2
    where tenant_id='tenant-a' and aggregate_kind='execution_run' and aggregate_id=$3`,
  [JSON.stringify(readOnlyRunSnapshot), contentHash(readOnlyRunSnapshot), unresolvedAfterRestartRun.id]);
  assert.equal((await instanceControlForRun(unresolvedAfterRestartRun)).canAbandonUnverified, true);

  const abandonedUnknown = await request(app.base, abandonRoute, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', commandId: 'process-instance-abandon-unknown-openai', payload: abandonmentPayload }),
  });
  assert.equal(abandonedUnknown.status, 'ABANDONED_UNVERIFIED');
  assert.deepEqual(abandonedUnknown.runIds, [unresolvedAfterRestartRun.id]);
  assert.deepEqual(abandonedUnknown.attemptIds, [unknownAttempt.rows[0].attempt_id]);
  const abandonedControlReplay = await request(app.base, abandonRoute, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', commandId: 'process-instance-abandon-unknown-openai', payload: abandonmentPayload }),
  });
  assert.equal(abandonedControlReplay.replayed, true);
  const abandonmentConflict = await request(app.base, abandonRoute, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', commandId: 'process-instance-abandon-unknown-openai',
      payload: { ...abandonmentPayload, reason: 'Different reason for same key.' } }),
  }, 409);
  assert.equal(abandonmentConflict.error.code, 'IDEMPOTENCY_CONFLICT');
  const terminalUnknownControl = await instanceControlForRun(unresolvedAfterRestartRun);
  assert.equal(terminalUnknownControl.status, 'ABANDONED_UNVERIFIED');
  const abandonmentEvent = terminalUnknownControl.events.at(-1);
  assert.equal(abandonmentEvent.type, 'ProcessTaskInstanceAbandonedUnverified');
  assert.equal(abandonmentEvent.actor, principal('alice'));
  assert.equal(abandonmentEvent.data.reason, abandonmentPayload.reason);
  assert.deepEqual(abandonmentEvent.data.evidence, abandonmentPayload.evidence);
  assert.equal(abandonmentEvent.data.acknowledgeDuplicateCostWork, true);
  assert.deepEqual(abandonmentEvent.data.runIds, [unresolvedAfterRestartRun.id]);
  assert.deepEqual(abandonmentEvent.data.attemptIds, [unknownAttempt.rows[0].attempt_id]);
  const stillUnknownAttempt = await app.persistence.query(`select status,attempt_id from orgward.provider_dispatch_attempts
    where tenant_id='tenant-a' and run_id=$1`, [unresolvedAfterRestartRun.id]);
  assert.deepEqual(stillUnknownAttempt.rows, unknownAttempt.rows, 'terminal disposition does not clear or rewrite provider attempt history');
  const staleAbandonment = await request(app.base, abandonRoute, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', commandId: 'process-instance-abandon-stale-version',
      payload: { ...abandonmentPayload, version: unknownControlBeforeAbandon.version } }),
  }, 409);
  assert.equal(staleAbandonment.error.code, 'PROCESS_INSTANCE_CONTROL_CONFLICT');
  const terminalResume = await request(app.base, '/api/execution/process-task-instances/resume', {
    ...as('alice'), method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', commandId: 'process-instance-abandon-resume-denied',
      payload: { projectId: project.id, planInstanceId: unresolvedAfterRestartRun.processTaskRef.planInstanceId,
        version: terminalUnknownControl.version } }),
  }, 409);
  assert.equal(terminalResume.error.code, 'PROCESS_INSTANCE_ABANDONED_UNVERIFIED');
  await assert.rejects(() => app.executionService.store.finalizeExecution({
    tenantId: 'tenant-a', projectId: project.id, principal: principal('alice'),
    runId: unresolvedAfterRestartRun.id, workerId: '00000000-0000-4000-8000-000000000001',
    expectedVersion: unresolvedAfterRestartRun.version,
    complete: async () => { throw new Error('A terminal late callback must not be applied.'); },
    interrupt: async () => { throw new Error('A terminal late callback must not be applied.'); },
  }), { code: 'PROCESS_INSTANCE_ABANDONED_UNVERIFIED' });
  const terminalNewTaskStart = await taskRequest('process-instance-abandon-new-task-denied', {
    ...planInput, planInstanceId: unresolvedAfterRestartRun.processTaskRef.planInstanceId,
  }, 'alice', 409);
  assert.equal(terminalNewTaskStart.error.code, 'PROCESS_INSTANCE_ABANDONED_UNVERIFIED');
  assert.match(terminalNewTaskStart.error.message, /closed with an unverified provider outcome/);
  const terminalHumanRefs = { projectId: project.id, planId: plan.id, revision: 2,
    planInstanceId: unresolvedAfterRestartRun.processTaskRef.planInstanceId, taskId: 'task-process-review' };
  const terminalHumanComplete = await request(app.base, '/api/execution/process-task-instances/complete', {
    ...as('bob'), method: 'POST', body: command('process-instance-abandon-human-complete-denied', {
      ...terminalHumanRefs, result: 'succeeded', evidence: ['Late human callback must not change a terminal instance.'],
    }),
  }, 409);
  assert.equal(terminalHumanComplete.error.code, 'PROCESS_INSTANCE_ABANDONED_UNVERIFIED');
  const terminalHumanEscalate = await request(app.base, '/api/execution/process-task-instances/escalate', {
    ...as('bob'), method: 'POST', body: command('process-instance-abandon-human-escalate-denied', {
      ...terminalHumanRefs, reason: 'Late escalation must not change a terminal instance.', evidence: ['Terminal control is persisted.'],
    }),
  }, 409);
  assert.equal(terminalHumanEscalate.error.code, 'PROCESS_INSTANCE_ABANDONED_UNVERIFIED');
  const terminalHumanResolve = await request(app.base, '/api/execution/process-task-instances/resolve', {
    ...as('alice'), method: 'POST', body: command('process-instance-abandon-human-resolve-denied', {
      ...terminalHumanRefs, disposition: 'resume', reason: 'Late resolution must not change a terminal instance.',
      evidence: ['Terminal control is persisted.'],
    }),
  }, 409);
  assert.equal(terminalHumanResolve.error.code, 'PROCESS_INSTANCE_ABANDONED_UNVERIFIED');
  await close(app);
  app = await start(postgres.databaseUrl, { executionProfiles: profiles, oidcAuthenticator, secretEncryptionKey: Buffer.alloc(32, 0x5c),
    openAiValidationEndpoint: `${providerOrigin}/v1/models` });
  const abandonedAfterRestart = await instanceControlForRun(unresolvedAfterRestartRun);
  assert.equal(abandonedAfterRestart.status, 'ABANDONED_UNVERIFIED');
  assert.deepEqual(abandonedAfterRestart.events.at(-1).data.evidence, abandonmentPayload.evidence);
  const abandonedAttemptAfterRestart = await app.persistence.query(`select status,attempt_id from orgward.provider_dispatch_attempts
    where tenant_id='tenant-a' and run_id=$1`, [unresolvedAfterRestartRun.id]);
  assert.deepEqual(abandonedAttemptAfterRestart.rows, unknownAttempt.rows);
  const freshNewInstanceRequest = await taskRequest('process-instance-abandon-new-instance', {
    ...planInput, profileId: 'process-task-openai',
  });
  assert.notEqual(freshNewInstanceRequest.processTaskRef.planInstanceId, unresolvedAfterRestartRun.processTaskRef.planInstanceId);
  assert.equal(freshNewInstanceRequest.status, 'AWAITING_APPROVAL');
  const freshNewInstanceApproval = await request(app.base, `/api/execution/runs/${freshNewInstanceRequest.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: freshNewInstanceRequest.version }),
  });
  assert.equal(freshNewInstanceApproval.status, 'APPROVED', 'a retry is a distinct process instance with fresh independent approval');

  const genericProviderRun = await taskRequest('process-instance-abandon-provider-http-request', {
    ...planInput, profileId: 'process-task-provider-http',
  });
  const genericProviderApproval = await request(app.base, `/api/execution/runs/${genericProviderRun.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: genericProviderRun.version }),
  });
  failNextProviderResponse = true;
  const genericProviderResult = await request(app.base, `/api/execution/runs/${genericProviderRun.id}/execute`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: genericProviderApproval.version }),
  });
  assert.equal(genericProviderResult.status, 'FAILED');
  const genericProviderControl = await instanceControlForRun(genericProviderRun);
  const genericProviderPause = await requestInstancePause(genericProviderRun, genericProviderControl, 'process-instance-provider-http-pause');
  assert.equal(genericProviderPause.status, 'PAUSE_REQUESTED');
  const genericProviderAbandon = await request(app.base, abandonRoute, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', commandId: 'process-instance-provider-http-abandon-denied',
      payload: { ...abandonmentPayload, planInstanceId: genericProviderRun.processTaskRef.planInstanceId,
        version: genericProviderPause.version } }),
  }, 409);
  assert.equal(genericProviderAbandon.error.code, 'PROCESS_INSTANCE_ABANDONMENT_NOT_ALLOWED');

  const approvedPauseRequest = await taskRequest('process-task-pause-approved-request', successInput);
  const approvedPauseApproval = await request(app.base, `/api/execution/runs/${approvedPauseRequest.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: approvedPauseRequest.version }),
  });
  const pausedApproved = await request(app.base, `/api/execution/runs/${approvedPauseRequest.id}/pause`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({
      commandId: 'process-task-pause-approved-command', projectId: project.id, version: approvedPauseApproval.version,
    }),
  });
  assert.equal(pausedApproved.status, 'PAUSED');
  assert.equal(pausedApproved.approval, null, 'pausing an approved run invalidates its approval');
  assert.equal(pausedApproved.events.at(-1).data.approvalInvalidated, true);
  const cancelledPaused = await request(app.base, `/api/execution/runs/${approvedPauseRequest.id}/cancel`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({
      commandId: 'process-task-pause-approved-cancel', projectId: project.id, version: pausedApproved.version,
    }),
  });
  assert.equal(cancelledPaused.status, 'CANCELLED');
  assert.equal(cancelledPaused.events.at(-1).data.priorStatus, 'PAUSED');

  const pauseApprovalRaceRequest = await taskRequest('process-task-pause-approve-race-request', successInput);
  const pauseApprovalRaceBody = {
    commandId: 'process-task-pause-approve-race-command', projectId: project.id, version: pauseApprovalRaceRequest.version,
  };
  const [pauseApprovalRacePause, pauseApprovalRaceApprove] = await Promise.all([
    rawPost(`/api/execution/runs/${pauseApprovalRaceRequest.id}/pause`, 'alice', pauseApprovalRaceBody),
    rawPost(`/api/execution/runs/${pauseApprovalRaceRequest.id}/approve`, 'bob', { version: pauseApprovalRaceRequest.version }),
  ]);
  assert.equal([pauseApprovalRacePause, pauseApprovalRaceApprove]
    .filter((result) => result.status >= 200 && result.status < 300).length, 1,
  'pause and independent approval at the same version have exactly one winner');
  let pauseApprovalRaceFinal = await request(app.base, `/api/execution/runs/${pauseApprovalRaceRequest.id}`, as('alice'));
  assert.ok(['PAUSED', 'APPROVED'].includes(pauseApprovalRaceFinal.status));
  assert.equal(pauseApprovalRaceFinal.events.filter((event) => ['ExecutionPaused', 'ExecutionApproved'].includes(event.type)).length, 1);
  const raceCleanupCancel = await request(app.base, `/api/execution/runs/${pauseApprovalRaceRequest.id}/cancel`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({
      commandId: 'process-task-pause-approve-race-cleanup', projectId: project.id, version: pauseApprovalRaceFinal.version,
    }),
  });
  assert.equal(raceCleanupCancel.status, 'CANCELLED');

  const pauseDispatchRaceRequest = await taskRequest('process-task-pause-dispatch-race-request', {
    ...successInput, profileId: 'process-task-slow',
  });
  const pauseDispatchRaceApproval = await request(app.base, `/api/execution/runs/${pauseDispatchRaceRequest.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: pauseDispatchRaceRequest.version }),
  });
  const [pauseDispatchRacePause, pauseDispatchRaceExecute] = await Promise.all([
    rawPost(`/api/execution/runs/${pauseDispatchRaceRequest.id}/pause`, 'alice', {
      commandId: 'process-task-pause-dispatch-race-command', projectId: project.id, version: pauseDispatchRaceApproval.version,
    }),
    rawPost(`/api/execution/runs/${pauseDispatchRaceRequest.id}/execute`, 'alice', { version: pauseDispatchRaceApproval.version }),
  ]);
  assert.equal([pauseDispatchRacePause, pauseDispatchRaceExecute]
    .filter((result) => result.status >= 200 && result.status < 300).length, 1,
  'pause and dispatch at the approved version have exactly one winner');
  const pauseDispatchRaceFinal = await request(app.base, `/api/execution/runs/${pauseDispatchRaceRequest.id}`, as('alice'));
  assert.ok(['PAUSED', 'SUCCEEDED'].includes(pauseDispatchRaceFinal.status));
  if (pauseDispatchRaceFinal.status === 'PAUSED') {
    const raceLease = await app.persistence.query(`select 1 from orgward.execution_worker_leases where tenant_id='tenant-a' and run_id=$1`, [pauseDispatchRaceRequest.id]);
    assert.equal(raceLease.rowCount, 0, 'a pause winner reserves no worker lease');
    assert.equal(pauseDispatchRaceFinal.events.some((event) => event.type === 'ExecutionStarted'), false);
    await request(app.base, `/api/execution/runs/${pauseDispatchRaceRequest.id}/cancel`, {
      ...as('alice'), method: 'POST', body: JSON.stringify({
        commandId: 'process-task-pause-dispatch-race-cleanup', projectId: project.id, version: pauseDispatchRaceFinal.version,
      }),
    });
  } else {
    assert.equal(pauseDispatchRaceFinal.events.some((event) => event.type === 'ExecutionStarted'), true);
    assert.equal(pauseDispatchRacePause.status, 409, 'dispatch winner prevents a later pause');
  }

  const firstRoot = await taskRequest('process-task-root-fail', planInput);
  assert.equal(firstRoot.status, 'AWAITING_APPROVAL');
  assert.match(firstRoot.processTaskRef.planInstanceId, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(firstRoot.events[0].data.processTaskRef, {
    processPlanId: plan.id, revision: 2, planInstanceId: firstRoot.processTaskRef.planInstanceId,
    taskId: 'task-process-learn', blueprintId: currentPlan.source.blueprintId, blueprintVersion: 1,
  });
  const failedTerminal = await approveAndExecute(firstRoot);
  assert.equal(failedTerminal.status, 'FAILED');

  const replay = await taskRequest('process-task-root-fail', planInput, 'alice', 200);
  assert.equal(replay.meta.replayed, true);
  assert.equal(replay.id, firstRoot.id);
  assert.equal(replay.processTaskRef.planInstanceId, firstRoot.processTaskRef.planInstanceId,
    'a replay without a caller-supplied instance retains the server-generated instance');
  const changedReplay = await taskRequest('process-task-root-fail', { ...planInput, profileId: 'process-task-success' }, 'alice', 409);
  assert.equal(changedReplay.error.code, 'IDEMPOTENCY_CONFLICT');
  const sameInstanceDuplicate = await taskRequest('process-task-root-duplicate', {
    ...planInput, planInstanceId: firstRoot.processTaskRef.planInstanceId,
  }, 'alice', 409);
  assert.equal(sameInstanceDuplicate.error.code, 'PROCESS_TASK_ALREADY_REQUESTED');

  const pendingCancellation = await taskRequest('process-task-cancel-pending-request', successInput);
  const pendingCancelBody = {
    commandId: 'process-task-cancel-pending-command', projectId: project.id, version: pendingCancellation.version,
  };
  await assert.rejects(() => app.persistence.query(`
    update orgward.process_task_instances
    set status='CANCELLED', completed_at=now(), version=version+1
    where tenant_id='tenant-a' and plan_instance_id=$1 and task_id=$2
  `, [pendingCancellation.processTaskRef.planInstanceId, pendingCancellation.processTaskRef.taskId]), /exactly one appended runtime event/i,
  'the database rejects cancellation without the atomic linked-run status event');
  const otherRequesterCancel = await request(app.base, `/api/execution/runs/${pendingCancellation.id}/cancel`, {
    ...as('bob'), method: 'POST', body: JSON.stringify(pendingCancelBody),
  }, 403);
  assert.equal(otherRequesterCancel.error.code, 'ACTION_FORBIDDEN');
  const cancelledPending = await request(app.base, `/api/execution/runs/${pendingCancellation.id}/cancel`, {
    ...as('alice'), method: 'POST', body: JSON.stringify(pendingCancelBody),
  });
  assert.equal(cancelledPending.status, 'CANCELLED');
  assert.equal(cancelledPending.events.at(-1).type, 'ExecutionCancelled');
  assert.equal(cancelledPending.events.at(-1).data.priorStatus, 'AWAITING_APPROVAL');
  assert.equal(cancelledPending.events.filter((event) => event.type === 'ExecutionCancelled').length, 1);
  const pendingCancelReplay = await request(app.base, `/api/execution/runs/${pendingCancellation.id}/cancel`, {
    ...as('alice'), method: 'POST', body: JSON.stringify(pendingCancelBody),
  });
  assert.equal(pendingCancelReplay.meta.replayed, true);
  assert.equal(pendingCancelReplay.events.filter((event) => event.type === 'ExecutionCancelled').length, 1,
    'same-command withdrawal replay does not append another run event');
  const changedPendingReplay = await request(app.base, `/api/execution/runs/${pendingCancellation.id}/cancel`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ ...pendingCancelBody, version: pendingCancelBody.version + 1 }),
  }, 409);
  assert.equal(changedPendingReplay.error.code, 'IDEMPOTENCY_CONFLICT');
  const pendingRuntime = (await request(app.base,
    `/api/execution/process-task-instances?projectId=${encodeURIComponent(project.id)}`, as('alice'))).instances
    .find((runtime) => runtime.executionRunId === pendingCancellation.id);
  assert.equal(pendingRuntime.status, 'CANCELLED');
  assert.ok(pendingRuntime.completedAt);
  assert.equal(pendingRuntime.startedAt, null, 'pre-dispatch cancellation never marks work as started');
  assert.equal(pendingRuntime.events.filter((event) => event.type === 'ProcessTaskRunStatusChanged'
    && event.data.status === 'CANCELLED').length, 1);
  const cancellationAudit = await app.persistence.query(`
    select aggregate_kind, command_id, count(*)::int as event_count
    from orgward.audit_log
    where tenant_id='tenant-a' and command_id=$1
    group by aggregate_kind, command_id order by aggregate_kind
  `, [pendingCancelBody.commandId]);
  assert.deepEqual(cancellationAudit.rows.map((row) => [row.aggregate_kind, row.command_id, row.event_count]), [
    ['execution_run', pendingCancelBody.commandId, 1],
    ['process_task_instance', pendingCancelBody.commandId, 1],
  ]);
  for (const mutation of [
    "status='FAILED'",
    'version=version+1',
    "outcome=outcome || '{\"forged\":true}'::jsonb",
    "evidence=evidence || '[\"forged\"]'::jsonb",
    'started_at=now()',
    "completed_at=completed_at + interval '1 second'",
    "created_at=created_at + interval '1 second'",
    "updated_at=updated_at + interval '1 second'",
    "events=events || '[{\"id\":\"forged-event\",\"type\":\"Forged\"}]'::jsonb",
  ]) {
    await assert.rejects(() => app.persistence.query(`
      update orgward.process_task_instances set ${mutation}
      where tenant_id='tenant-a' and plan_instance_id=$1 and task_id=$2
    `, [pendingCancellation.processTaskRef.planInstanceId, pendingCancellation.processTaskRef.taskId]),
    /cancelled process task runtime is terminal and immutable/i, `cancellation terminal guard rejects ${mutation}`);
  }

  const approvedCancellation = await taskRequest('process-task-cancel-approved-request', successInput);
  const approvedForCancellation = await request(app.base, `/api/execution/runs/${approvedCancellation.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: approvedCancellation.version }),
  });
  const cancelledApproved = await request(app.base, `/api/execution/runs/${approvedCancellation.id}/cancel`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({
      commandId: 'process-task-cancel-approved-command', projectId: project.id, version: approvedForCancellation.version,
    }),
  });
  assert.equal(cancelledApproved.status, 'CANCELLED');
  assert.equal(cancelledApproved.events.at(-1).data.priorStatus, 'APPROVED');

  const raceRequest = await taskRequest('process-task-cancel-approve-race-request', successInput);
  const raceCancelBody = {
    commandId: 'process-task-cancel-approve-race-command', projectId: project.id, version: raceRequest.version,
  };
  const racePost = async (route, subject, body) => {
    const response = await fetch(`${app.base}${route}`, {
      ...as(subject), method: 'POST', body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const [raceCancelResult, raceApprovalResult] = await Promise.all([
    racePost(`/api/execution/runs/${raceRequest.id}/cancel`, 'alice', raceCancelBody),
    racePost(`/api/execution/runs/${raceRequest.id}/approve`, 'bob', { version: raceRequest.version }),
  ]);
  assert.equal([raceCancelResult, raceApprovalResult].filter((result) => result.status >= 200 && result.status < 300).length, 1,
    'cancel and approval at the same expected version have exactly one winner');
  const raceFinal = await request(app.base, `/api/execution/runs/${raceRequest.id}`, as('alice'));
  assert.ok(['CANCELLED', 'APPROVED'].includes(raceFinal.status));
  assert.equal(raceFinal.events.filter((event) => ['ExecutionApproved', 'ExecutionCancelled'].includes(event.type)).length, 1);

  const runningRequest = await taskRequest('process-task-cancel-running-request', {
    ...successInput, profileId: 'process-task-slow',
  });
  const runningApproval = await request(app.base, `/api/execution/runs/${runningRequest.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: runningRequest.version }),
  });
  const executionInFlight = fetch(`${app.base}/api/execution/runs/${runningRequest.id}/execute`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: runningApproval.version }),
  });
  let observedRunning = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    observedRunning = await request(app.base, `/api/execution/runs/${runningRequest.id}`, as('alice'));
    if (observedRunning.status === 'RUNNING') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(observedRunning.status, 'RUNNING', 'the worker run enters RUNNING before cancellation is attempted');
  const runningCancelDenied = await request(app.base, `/api/execution/runs/${runningRequest.id}/cancel`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({
      commandId: 'process-task-cancel-running-command', projectId: project.id, version: runningApproval.version,
    }),
  }, 409);
  assert.equal(runningCancelDenied.error.code, 'PROCESS_TASK_CANCELLATION_UNAVAILABLE');
  assert.match(runningCancelDenied.error.message, /running task cannot be withdrawn/i);
  const executionResponse = await executionInFlight;
  const executionResult = await executionResponse.json();
  assert.equal(executionResponse.status, 200, JSON.stringify(executionResult));
  assert.equal(executionResult.status, 'SUCCEEDED');

  const secondRoot = await taskRequest('process-task-root-retry', successInput);
  assert.notEqual(secondRoot.processTaskRef.planInstanceId, firstRoot.processTaskRef.planInstanceId,
    'a retry after terminal failure starts a fresh plan instance');
  const dependentInput = {
    projectId: project.id, planId: plan.id, revision: 2, planInstanceId: secondRoot.processTaskRef.planInstanceId,
    taskId: 'task-process-deliver', profileId: 'process-task-success',
  };
  const unknownInstance = await taskRequest('process-task-unknown-instance', {
    ...dependentInput, planInstanceId: '00000000-0000-4000-8000-000000000099',
  }, 'alice', 409);
  assert.equal(unknownInstance.error.code, 'PROCESS_TASK_INSTANCE_NOT_FOUND');
  const blockedDependency = await taskRequest('process-task-deliver-too-early', dependentInput, 'alice', 409);
  assert.equal(blockedDependency.error.code, 'PROCESS_TASK_DEPENDENCY_UNSATISFIED');
  const successfulRoot = await approveAndExecute(secondRoot);
  assert.equal(successfulRoot.status, 'SUCCEEDED');
  const dependent = await taskRequest('process-task-deliver-after-root', dependentInput);
  assert.equal(dependent.status, 'AWAITING_APPROVAL');
  assert.equal(dependent.processTaskRef.planInstanceId, secondRoot.processTaskRef.planInstanceId);
  assert.equal((await approveAndExecute(dependent)).status, 'SUCCEEDED');

  const humanInput = {
    projectId: project.id, planId: plan.id, revision: 2, planInstanceId: secondRoot.processTaskRef.planInstanceId,
    taskId: 'task-process-review', profileId: 'process-task-success',
  };
  const wrongHuman = await request(app.base, '/api/execution/process-task-instances/start', {
    ...as('alice'), method: 'POST', body: command('process-task-human-wrong-person', {
      projectId: project.id, planId: plan.id, revision: 2,
      planInstanceId: secondRoot.processTaskRef.planInstanceId, taskId: 'task-process-review',
    }),
  }, 403);
  assert.equal(wrongHuman.error.code, 'ACTION_FORBIDDEN');
  const humanTaskPayload = {
    projectId: project.id, planId: plan.id, revision: 2,
    planInstanceId: secondRoot.processTaskRef.planInstanceId, taskId: 'task-process-review',
  };
  const lookupsBeforeHumanProfileDenial = openAiBindingLookupCount;
  const humanOpenAiDenied = await taskRequest('process-task-openai-human-assignment-denied', {
    ...humanTaskPayload, profileId: 'process-task-openai',
  }, 'alice', 409);
  assert.equal(humanOpenAiDenied.error.code, 'PROCESS_TASK_HUMAN_CHECKPOINT_REQUIRED');
  assert.equal(openAiBindingLookupCount, lookupsBeforeHumanProfileDenial,
    'a human-assigned task is rejected before any provider credential lookup');
  const startedHuman = await request(app.base, '/api/execution/process-task-instances/start', {
    ...as('bob'), method: 'POST', body: command('process-task-human-start', humanTaskPayload),
  }, 201);
  assert.equal(startedHuman.status, 'IN_PROGRESS');
  assert.equal(startedHuman.assignedToCurrentPrincipal, true);
  assert.equal(Object.hasOwn(startedHuman, 'assignedPrincipal'), false);
  const humanReplay = await request(app.base, '/api/execution/process-task-instances/start', {
    ...as('bob'), method: 'POST', body: command('process-task-human-start', humanTaskPayload),
  }, 200);
  assert.equal(humanReplay.meta.replayed, true);
  assert.equal(humanReplay.planInstanceId, startedHuman.planInstanceId);
  const humanRuntimeRead = await request(app.base,
    `/api/execution/process-task-instances?projectId=${encodeURIComponent(project.id)}`, as('bob'));
  const visibleHumanRuntime = humanRuntimeRead.instances.find((runtime) => runtime.taskId === 'task-process-review'
    && runtime.planInstanceId === secondRoot.processTaskRef.planInstanceId);
  assert.equal(visibleHumanRuntime.status, 'IN_PROGRESS');
  assert.equal(visibleHumanRuntime.assignedToCurrentPrincipal, true);
  assert.equal(visibleHumanRuntime.canResolveEscalation, false, 'an assigned editor cannot resolve a task escalation');
  assert.equal(JSON.stringify(visibleHumanRuntime).includes(principal('bob')), false,
    'runtime reads identify whether the caller is assigned without exposing the private target principal');
  const missingEscalationReason = await request(app.base, '/api/execution/process-task-instances/escalate', {
    ...as('bob'), method: 'POST', body: command('process-task-human-escalate-no-reason', {
      ...humanTaskPayload, reason: '  ', evidence: [],
    }),
  }, 409);
  assert.equal(missingEscalationReason.error.code, 'INVALID_HUMAN_TASK_ESCALATION');
  const escalatedHuman = await request(app.base, '/api/execution/process-task-instances/escalate', {
    ...as('bob'), method: 'POST', body: command('process-task-human-escalate', {
      ...humanTaskPayload, reason: 'Need owner review before approving the safety checkpoint.', evidence: ['Inspection result needs a second opinion.'],
    }),
  }, 201);
  assert.equal(escalatedHuman.status, 'ESCALATED');
  assert.equal(escalatedHuman.events.at(-1).type, 'HumanTaskEscalated');
  assert.equal(escalatedHuman.events.at(-1).data.reason, 'Need owner review before approving the safety checkpoint.');
  const escalationReplay = await request(app.base, '/api/execution/process-task-instances/escalate', {
    ...as('bob'), method: 'POST', body: command('process-task-human-escalate', {
      ...humanTaskPayload, reason: 'Need owner review before approving the safety checkpoint.', evidence: ['Inspection result needs a second opinion.'],
    }),
  }, 200);
  assert.equal(escalationReplay.meta.replayed, true);
  assert.equal(escalationReplay.events.filter((event) => event.type === 'HumanTaskEscalated').length, 1,
    'same-command escalation replay does not append a duplicate event');
  const changedEscalationReplay = await request(app.base, '/api/execution/process-task-instances/escalate', {
    ...as('bob'), method: 'POST', body: command('process-task-human-escalate', {
      ...humanTaskPayload, reason: 'Changed reason.', evidence: ['Inspection result needs a second opinion.'],
    }),
  }, 409);
  assert.equal(changedEscalationReplay.error.code, 'IDEMPOTENCY_CONFLICT');
  await request(app.base, membersRoute, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal('readonly'), access: 'editor' }),
  });
  const readerEscalated = await request(app.base,
    `/api/execution/process-task-instances?projectId=${encodeURIComponent(project.id)}`, {
    ...as('readonly'),
  });
  const readerEscalatedRuntime = readerEscalated.instances.find((runtime) => runtime.taskId === 'task-process-review'
    && runtime.planInstanceId === secondRoot.processTaskRef.planInstanceId);
  assert.equal(readerEscalatedRuntime.status, 'ESCALATED');
  assert.equal(readerEscalatedRuntime.canResolveEscalation, false);
  assert.equal(readerEscalatedRuntime.events.at(-1).data.reason, 'Need owner review before approving the safety checkpoint.');
  const escalatedCompletionDenied = await request(app.base, '/api/execution/process-task-instances/complete', {
    ...as('bob'), method: 'POST', body: command('process-task-human-complete-while-escalated', {
      ...humanTaskPayload, result: 'succeeded', evidence: ['Cannot complete before owner resolution.'],
    }),
  }, 409);
  assert.equal(escalatedCompletionDenied.error.code, 'PROCESS_TASK_ESCALATION_ACTIVE');
  const editorResolutionDenied = await request(app.base, '/api/execution/process-task-instances/resolve', {
    ...as('bob'), method: 'POST', body: command('process-task-human-editor-resolve', {
      ...humanTaskPayload, disposition: 'resume', reason: 'I am the assigned editor.', evidence: [],
    }),
  }, 403);
  assert.equal(editorResolutionDenied.error.code, 'ACTION_FORBIDDEN');
  const ownerEscalationView = await request(app.base,
    `/api/execution/process-task-instances?projectId=${encodeURIComponent(project.id)}`, as('alice'));
  const ownerVisibleRuntime = ownerEscalationView.instances.find((runtime) => runtime.taskId === 'task-process-review'
    && runtime.planInstanceId === secondRoot.processTaskRef.planInstanceId);
  assert.equal(ownerVisibleRuntime.status, 'ESCALATED');
  assert.equal(ownerVisibleRuntime.canResolveEscalation, true);
  assert.equal(ownerVisibleRuntime.events.at(-1).actor, 'assigned human');
  assert.equal(JSON.stringify(ownerVisibleRuntime).includes(principal('bob')), false,
    'owner escalation details do not expose the assigned principal');
  const resumedHuman = await request(app.base, '/api/execution/process-task-instances/resolve', {
    ...as('alice'), method: 'POST', body: command('process-task-human-owner-resume', {
      ...humanTaskPayload, disposition: 'resume', reason: 'Binding and assignment are still current.', evidence: ['Owner review recorded.'],
    }),
  }, 201);
  assert.equal(resumedHuman.status, 'IN_PROGRESS');
  assert.equal(resumedHuman.events.at(-1).type, 'HumanTaskEscalationResolved');
  assert.equal(resumedHuman.events.at(-1).actor, 'project owner');
  const missingOwnerReason = await request(app.base, '/api/execution/process-task-instances/resolve', {
    ...as('alice'), method: 'POST', body: command('process-task-human-owner-resume-no-reason', {
      ...humanTaskPayload, disposition: 'resume', reason: '', evidence: [],
    }),
  }, 409);
  assert.equal(missingOwnerReason.error.code, 'INVALID_HUMAN_TASK_ESCALATION');
  const ownerResolutionReplay = await request(app.base, '/api/execution/process-task-instances/resolve', {
    ...as('alice'), method: 'POST', body: command('process-task-human-owner-resume', {
      ...humanTaskPayload, disposition: 'resume', reason: 'Binding and assignment are still current.', evidence: ['Owner review recorded.'],
    }),
  }, 200);
  assert.equal(ownerResolutionReplay.meta.replayed, true);
  assert.equal(ownerResolutionReplay.events.filter((event) => event.type === 'HumanTaskEscalationResolved').length, 1);
  const changedOwnerResolutionReplay = await request(app.base, '/api/execution/process-task-instances/resolve', {
    ...as('alice'), method: 'POST', body: command('process-task-human-owner-resume', {
      ...humanTaskPayload, disposition: 'resume', reason: 'Different resolution.', evidence: ['Owner review recorded.'],
    }),
  }, 409);
  assert.equal(changedOwnerResolutionReplay.error.code, 'IDEMPOTENCY_CONFLICT');
  const completedHuman = await request(app.base, '/api/execution/process-task-instances/complete', {
    ...as('bob'), method: 'POST', body: command('process-task-human-complete', {
      ...humanTaskPayload, result: 'succeeded', evidence: ['Safety review recorded by assigned founder.'],
    }),
  }, 201);
  assert.equal(completedHuman.status, 'SUCCEEDED');
  assert.deepEqual(completedHuman.outcome, { result: 'succeeded' });
  assert.deepEqual(completedHuman.evidence, ['Safety review recorded by assigned founder.']);
  assert.equal(completedHuman.events.at(-1).type, 'HumanTaskCompleted');
  const completionReplay = await request(app.base, '/api/execution/process-task-instances/complete', {
    ...as('bob'), method: 'POST', body: command('process-task-human-complete', {
      ...humanTaskPayload, result: 'succeeded', evidence: ['Safety review recorded by assigned founder.'],
    }),
  }, 200);
  assert.equal(completionReplay.meta.replayed, true);
  const duplicateHumanStart = await request(app.base, '/api/execution/process-task-instances/start', {
    ...as('bob'), method: 'POST', body: command('process-task-human-second-start', humanTaskPayload),
  }, 409);
  assert.equal(duplicateHumanStart.error.code, 'PROCESS_TASK_STATE_CONFLICT');
  const changedCompletionReplay = await request(app.base, '/api/execution/process-task-instances/complete', {
    ...as('bob'), method: 'POST', body: command('process-task-human-complete', {
      ...humanTaskPayload, result: 'succeeded', evidence: ['Changed after commit.'],
    }),
  }, 409);
  assert.equal(changedCompletionReplay.error.code, 'IDEMPOTENCY_CONFLICT');

  project = (await request(app.base, `/api/v1/projects/${project.id}`, as('alice'))).data;
  const humanRootPlanCreated = await request(app.base, plansRoute, {
    ...as('alice'), method: 'POST', body: command('process-task-human-root-plan', { processId: 'process-review' }, project.version),
  }, 201);
  const humanRootPlan = humanRootPlanCreated.data.processPlans.at(-1);
  const humanRootPayload = { tasks: humanRootPlan.tasks.map((task) => ({
    taskId: task.id, title: task.title, detail: task.detail, dependencies: task.dependencies,
    actorId: 'actor-founder', roleId: 'role-founder',
  })) };
  const humanRootRevisionResponse = await request(app.base, `${plansRoute}/${humanRootPlan.id}/revisions`, {
    ...as('alice'), method: 'POST', body: command('process-task-human-root-revision', humanRootPayload, humanRootPlanCreated.data.version),
  });
  const humanRootRevision = humanRootRevisionResponse.data.processPlans.at(-1);
  const rootHumanTask = humanRootRevision.tasks.find((task) => task.dependencies.length === 0);
  const dependentHumanTask = humanRootRevision.tasks.find((task) => task.dependencies.includes(rootHumanTask.id));
  assert.equal(rootHumanTask.dependencies.length, 0);
  assert.ok(dependentHumanTask);
  const humanRootStartPayload = {
    projectId: project.id, planId: humanRootPlan.id, revision: humanRootRevision.revision, taskId: rootHumanTask.id,
  };
  const startedHumanRoot = await request(app.base, '/api/execution/process-task-instances/start', {
    ...as('bob'), method: 'POST', body: command('process-task-human-root-start', humanRootStartPayload),
  }, 201);
  assert.match(startedHumanRoot.planInstanceId, /^[0-9a-f-]{36}$/i);
  const replayedHumanRoot = await request(app.base, '/api/execution/process-task-instances/start', {
    ...as('bob'), method: 'POST', body: command('process-task-human-root-start', humanRootStartPayload),
  }, 200);
  assert.equal(replayedHumanRoot.planInstanceId, startedHumanRoot.planInstanceId,
    'a same-command root retry returns the server-generated instance ID');
  const rootEscalationRefs = { ...humanRootStartPayload, planInstanceId: startedHumanRoot.planInstanceId };
  const rootEscalated = await request(app.base, '/api/execution/process-task-instances/escalate', {
    ...as('bob'), method: 'POST', body: command('process-task-human-root-escalate', {
      ...rootEscalationRefs, reason: 'Owner review is required before continuing.', evidence: ['Question routed to owner.'],
    }),
  }, 201);
  assert.equal(rootEscalated.status, 'ESCALATED');
  const dependencyBlockedWhileEscalated = await request(app.base, '/api/execution/process-task-instances/start', {
    ...as('bob'), method: 'POST', body: command('process-task-human-dependent-while-escalated', {
      projectId: project.id, planId: humanRootPlan.id, revision: humanRootRevision.revision,
      planInstanceId: startedHumanRoot.planInstanceId, taskId: dependentHumanTask.id,
    }),
  }, 409);
  assert.equal(dependencyBlockedWhileEscalated.error.code, 'PROCESS_TASK_DEPENDENCY_UNSATISFIED');
  const rootResumed = await request(app.base, '/api/execution/process-task-instances/resolve', {
    ...as('alice'), method: 'POST', body: command('process-task-human-root-resume', {
      ...rootEscalationRefs, disposition: 'resume', reason: 'The original assignment is still current.', evidence: ['Owner reviewed the request.'],
    }),
  }, 201);
  assert.equal(rootResumed.status, 'IN_PROGRESS');
  await request(app.base, '/api/execution/process-task-instances/complete', {
    ...as('bob'), method: 'POST', body: command('process-task-human-root-complete', {
      ...humanRootStartPayload, planInstanceId: startedHumanRoot.planInstanceId,
      result: 'succeeded', evidence: ['Root human task completed.'],
    }),
  }, 201);
  const dependentHumanStart = await request(app.base, '/api/execution/process-task-instances/start', {
    ...as('bob'), method: 'POST', body: command('process-task-human-dependent-start', {
      projectId: project.id, planId: humanRootPlan.id, revision: humanRootRevision.revision,
      planInstanceId: startedHumanRoot.planInstanceId, taskId: dependentHumanTask.id,
    }),
  }, 201);
  assert.equal(dependentHumanStart.status, 'IN_PROGRESS', 'a human dependency starts after the canonical root status becomes SUCCEEDED');
  await request(app.base, '/api/execution/process-task-instances/complete', {
    ...as('bob'), method: 'POST', body: command('process-task-human-dependent-complete', {
      projectId: project.id, planId: humanRootPlan.id, revision: humanRootRevision.revision,
      planInstanceId: startedHumanRoot.planInstanceId, taskId: dependentHumanTask.id,
      result: 'succeeded', evidence: ['Dependent checkpoint completed.'],
    }),
  }, 201);

  const mixedPlanProject = (await request(app.base, `/api/v1/projects/${project.id}`, as('alice'))).data;
  const mixedPlanCreated = await request(app.base, plansRoute, {
    ...as('alice'), method: 'POST', body: command('process-task-mixed-human-agent-plan', { processId: 'process-review' }, mixedPlanProject.version),
  }, 201);
  const mixedPlan = mixedPlanCreated.data.processPlans.at(-1);
  const mixedAgentTarget = mixedPlan.tasks.find((task) => task.dependencies.length > 0);
  const mixedRevisionPayload = { tasks: mixedPlan.tasks.map((task) => {
    const humanRoot = task.dependencies.length === 0;
    return {
      taskId: task.id, title: task.title, detail: task.detail, dependencies: task.dependencies,
      actorId: humanRoot ? 'actor-founder' : 'actor-design-assistant',
      roleId: humanRoot ? 'role-founder' : 'role-design-assistant',
    };
  }), humanCheckpoint: {
    beforeTaskId: mixedAgentTarget.id, title: 'Approve the human review result',
    detail: 'A bound human verifies the review evidence before the agent continues.',
    actorId: 'actor-founder', roleId: 'role-founder',
  } };
  const mixedRevisionResponse = await request(app.base, `${plansRoute}/${mixedPlan.id}/revisions`, {
    ...as('alice'), method: 'POST', body: command('process-task-mixed-human-agent-revision', mixedRevisionPayload, mixedPlanCreated.data.version),
  });
  const mixedRevision = mixedRevisionResponse.data.processPlans.find((candidate) => candidate.id === mixedPlan.id && candidate.revision === 2);
  const mixedHumanRootTask = mixedRevision.tasks.find((task) => task.dependencies.length === 0);
  const mixedCheckpointTask = mixedRevision.tasks.find((task) => task.id.startsWith('task-human-checkpoint-'));
  const mixedAgentTask = mixedRevision.tasks.find((task) => task.assignee.actorId === 'actor-design-assistant');
  assert.equal(mixedHumanRootTask.assignee.actorId, 'actor-founder');
  assert.equal(mixedAgentTask.assignee.actorId, 'actor-design-assistant');
  assert.deepEqual(mixedCheckpointTask.dependencies, [mixedHumanRootTask.id]);
  assert.deepEqual(mixedAgentTask.dependencies, [mixedCheckpointTask.id]);
  const mixedRootPayload = {
    projectId: project.id, planId: mixedPlan.id, revision: mixedRevision.revision, taskId: mixedHumanRootTask.id,
  };
  const mixedDependentPayload = (planInstanceId) => ({
    projectId: project.id, planId: mixedPlan.id, revision: mixedRevision.revision,
    planInstanceId, taskId: mixedAgentTask.id, profileId: 'process-task-success',
  });

  const mixedHumanBinding = await app.persistence.query(`
    select target_principal, target_membership_generation, target_authz_generation
    from orgward.project_actor_binding_proposals
    where tenant_id='tenant-a' and project_id=$1 and blueprint_version=1
      and actor_id='actor-founder' and role_id='role-founder' and status='enabled'
  `, [project.id]);
  assert.equal(mixedHumanBinding.rowCount, 1);
  const legacySuccessInstanceId = '6d70cb74-8c46-4b5b-a90a-5fa32b123456';
  await app.persistence.query(`
    insert into orgward.process_task_instances (
      tenant_id, project_id, process_plan_id, plan_revision, plan_instance_id, task_id,
      blueprint_id, blueprint_version, process_id, actor_id, role_id, actor_type,
      assigned_principal, assigned_membership_generation, assigned_authz_generation,
      status, version, outcome, evidence, events, started_at, completed_at
    ) values ('tenant-a',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'human',$11,$12,$13,
      'SUCCEEDED',1,'{"result":"succeeded"}'::jsonb,'[]'::jsonb,'[]'::jsonb,now(),now())
  `, [project.id, mixedPlan.id, mixedRevision.revision, legacySuccessInstanceId, mixedHumanRootTask.id,
    mixedPlan.source.blueprintId, mixedPlan.source.blueprintVersion, mixedPlan.source.processId,
    mixedHumanRootTask.assignee.actorId, mixedHumanRootTask.assignee.roleId,
    mixedHumanBinding.rows[0].target_principal, Number(mixedHumanBinding.rows[0].target_membership_generation),
    Number(mixedHumanBinding.rows[0].target_authz_generation)]);
  await app.persistence.query(`insert into orgward.process_task_instance_controls
    (tenant_id, project_id, process_plan_id, plan_revision, plan_instance_id, status, initiated_by, version, events)
    values ('tenant-a',$1,$2,$3,$4,'ACTIVE',null,0,'[]'::jsonb)`,
  [project.id, mixedPlan.id, mixedRevision.revision, legacySuccessInstanceId]);
  const rejectedLegacyHumanSuccess = await taskRequest('process-task-mixed-agent-after-legacy-success',
    mixedDependentPayload(legacySuccessInstanceId), 'alice', 409);
  assert.equal(rejectedLegacyHumanSuccess.error.code, 'PROCESS_TASK_DEPENDENCY_UNSATISFIED',
    'a legacy-style SUCCEEDED human row without evidence or audited terminal provenance cannot open a dependency gate');
  const backfilledLegacyControl = (await request(app.base,
    `/api/execution/process-task-instances?projectId=${encodeURIComponent(project.id)}`, as('carol'))).instances
    .find((runtime) => runtime.planInstanceId === legacySuccessInstanceId).instanceControl;
  assert.equal(backfilledLegacyControl.canControl, false, 'a legacy control without an initiator grants controls only to its current owner');
  const legacyEditorPause = await request(app.base, '/api/execution/process-task-instances/pause', {
    ...as('carol'), method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', commandId: 'process-instance-legacy-pause-editor',
      payload: { projectId: project.id, planInstanceId: legacySuccessInstanceId,
        version: backfilledLegacyControl.version, reason: 'An editor cannot take over a legacy instance.' } }),
  }, 403);
  assert.equal(legacyEditorPause.error.code, 'ACTION_FORBIDDEN');
  const legacyOwnerPause = await request(app.base, '/api/execution/process-task-instances/pause', {
    ...as('alice'), method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', commandId: 'process-instance-legacy-pause-owner',
      payload: { projectId: project.id, planInstanceId: legacySuccessInstanceId,
        version: backfilledLegacyControl.version, reason: 'The current owner can recover a legacy instance.' } }),
  });
  assert.equal(legacyOwnerPause.status, 'PAUSED');

  const mixedHumanStart = await request(app.base, '/api/execution/process-task-instances/start', {
    ...as('bob'), method: 'POST', body: command('process-task-mixed-assigned-root-start', mixedRootPayload),
  }, 201);
  const mixedAssignedHumanRefs = { ...mixedRootPayload, planInstanceId: mixedHumanStart.planInstanceId };
  const mixedDependentWhileIncomplete = await taskRequest('process-task-mixed-agent-before-human-completion',
    mixedDependentPayload(mixedHumanStart.planInstanceId), 'alice', 409);
  assert.equal(mixedDependentWhileIncomplete.error.code, 'PROCESS_TASK_DEPENDENCY_UNSATISFIED');

  const mixedEmptySuccess = await request(app.base, '/api/execution/process-task-instances/complete', {
    ...as('bob'), method: 'POST', body: command('process-task-mixed-human-empty-success', {
      ...mixedAssignedHumanRefs, result: 'succeeded', evidence: [],
    }),
  }, 409);
  assert.equal(mixedEmptySuccess.error.code, 'INVALID_HUMAN_TASK_OUTCOME');
  const tryDirectHumanSuccess = (actor, evidence, suffix) => {
    const event = {
      id: `mixed-direct-human-success-${suffix}`, type: 'HumanTaskCompleted', actor,
      at: new Date().toISOString(),
      data: {
        taskId: mixedHumanRootTask.id, processPlanId: mixedPlan.id, revision: mixedRevision.revision,
        planInstanceId: mixedHumanStart.planInstanceId, result: 'succeeded', evidence,
      },
    };
    return app.persistence.query(`
      update orgward.process_task_instances
      set status='SUCCEEDED', outcome='{"result":"succeeded"}'::jsonb, evidence=$4::jsonb,
        version=version+1, completed_at=now(), updated_at=now(), events=events || $5::jsonb
      where tenant_id='tenant-a' and project_id=$1 and plan_instance_id=$2 and task_id=$3
    `, [project.id, mixedHumanStart.planInstanceId, mixedHumanRootTask.id, JSON.stringify(evidence), JSON.stringify([event])]);
  };
  await assert.rejects(() => tryDirectHumanSuccess(principal('bob'), [], 'empty-evidence'),
    /succeeded human checkpoint requires at least one evidence note/i,
    'the database refuses an empty-evidence success transition even when the appended event otherwise matches');
  await assert.rejects(() => tryDirectHumanSuccess(principal('alice'), ['Note from the wrong identity.'], 'wrong-actor'),
    /assigned person/i, 'the database ties HumanTaskCompleted provenance to its immutable assigned principal');
  const mixedHumanAfterForgedAttempts = await request(app.base,
    `/api/execution/process-task-instances?projectId=${encodeURIComponent(project.id)}`, as('alice'));
  assert.equal(mixedHumanAfterForgedAttempts.instances.find((runtime) => runtime.planInstanceId === mixedHumanStart.planInstanceId
    && runtime.taskId === mixedHumanRootTask.id).status, 'IN_PROGRESS');

  const mixedEscalated = await request(app.base, '/api/execution/process-task-instances/escalate', {
    ...as('bob'), method: 'POST', body: command('process-task-mixed-assigned-root-escalate', {
      ...mixedAssignedHumanRefs, reason: 'The review needs owner input before the assigned human can finish.', evidence: ['Owner input requested.'],
    }),
  }, 201);
  assert.equal(mixedEscalated.status, 'ESCALATED');
  const mixedDependentWhileEscalated = await taskRequest('process-task-mixed-agent-while-escalated',
    mixedDependentPayload(mixedHumanStart.planInstanceId), 'alice', 409);
  assert.equal(mixedDependentWhileEscalated.error.code, 'PROCESS_TASK_DEPENDENCY_UNSATISFIED');
  const mixedEscalationResumed = await request(app.base, '/api/execution/process-task-instances/resolve', {
    ...as('alice'), method: 'POST', body: command('process-task-mixed-assigned-root-resume', {
      ...mixedAssignedHumanRefs, disposition: 'resume', reason: 'The assigned human can complete the saved checkpoint.', evidence: ['Owner review recorded.'],
    }),
  }, 201);
  assert.equal(mixedEscalationResumed.status, 'IN_PROGRESS');
  const mixedHumanCompleted = await request(app.base, '/api/execution/process-task-instances/complete', {
    ...as('bob'), method: 'POST', body: command('process-task-mixed-assigned-root-complete', {
      ...mixedAssignedHumanRefs, result: 'succeeded', evidence: ['Assigned human verified the checkpoint.'],
    }),
  }, 201);
  assert.equal(mixedHumanCompleted.status, 'SUCCEEDED');
  assert.equal(mixedHumanCompleted.events.at(-1).type, 'HumanTaskCompleted');
  assert.deepEqual(mixedHumanCompleted.evidence, ['Assigned human verified the checkpoint.']);
  const mixedInstanceControl = (await request(app.base,
    `/api/execution/process-task-instances?projectId=${encodeURIComponent(project.id)}`, as('alice'))).instances
    .find((runtime) => runtime.planInstanceId === mixedHumanStart.planInstanceId).instanceControl;
  assert.equal(mixedInstanceControl.canControl, true, 'the current project owner can recover an instance started by another editor');
  const mixedEditorView = (await request(app.base,
    `/api/execution/process-task-instances?projectId=${encodeURIComponent(project.id)}`, as('carol'))).instances
    .find((runtime) => runtime.planInstanceId === mixedHumanStart.planInstanceId).instanceControl;
  assert.equal(mixedEditorView.canControl, false, 'another project editor cannot control an instance they did not initiate');
  const nonOwnerPause = await request(app.base, '/api/execution/process-task-instances/pause', {
    ...as('carol'), method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', commandId: 'process-instance-mixed-pause-non-owner',
      payload: { projectId: project.id, planInstanceId: mixedHumanStart.planInstanceId,
        version: mixedInstanceControl.version, reason: 'Unauthorized recovery attempt.' } }),
  }, 403);
  assert.equal(nonOwnerPause.error.code, 'ACTION_FORBIDDEN');
  const mixedInstancePaused = await request(app.base, '/api/execution/process-task-instances/pause', {
    ...as('alice'), method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', commandId: 'process-instance-mixed-pause',
      payload: { projectId: project.id, planInstanceId: mixedHumanStart.planInstanceId,
        version: mixedInstanceControl.version, reason: 'Hold the process before the agent step.' } }),
  });
  assert.equal(mixedInstancePaused.status, 'PAUSED');
  await app.persistence.query(`update orgward.project_memberships set access='reader', generation=generation+1
    where tenant_id='tenant-a' and project_id=$1 and principal=$2 and revoked_at is null`, [project.id, principal('alice')]);
  const staleOwnerView = (await request(app.base,
    `/api/execution/process-task-instances?projectId=${encodeURIComponent(project.id)}`, as('alice'))).instances
    .find((runtime) => runtime.planInstanceId === mixedHumanStart.planInstanceId).instanceControl;
  assert.equal(staleOwnerView.canControl, false, 'a former owner loses recovery controls when project authority is revoked');
  const revokedOwnerResume = await request(app.base, '/api/execution/process-task-instances/resume', {
    ...as('alice'), method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', commandId: 'process-instance-mixed-resume-revoked-owner',
      payload: { projectId: project.id, planInstanceId: mixedHumanStart.planInstanceId, version: mixedInstancePaused.version } }),
  }, 403);
  assert.equal(revokedOwnerResume.error.code, 'ACTION_FORBIDDEN');
  await app.persistence.query(`update orgward.project_memberships set access='owner', generation=generation+1
    where tenant_id='tenant-a' and project_id=$1 and principal=$2 and revoked_at is null`, [project.id, principal('alice')]);
  const blockedByInstancePause = await taskRequest('process-task-mixed-agent-while-instance-paused',
    mixedDependentPayload(mixedHumanStart.planInstanceId), 'alice', 409);
  assert.equal(blockedByInstancePause.error.code, 'PROCESS_INSTANCE_PAUSED',
    'the same-instance control fence blocks an otherwise dependency-satisfied agent start');
  const mixedInstanceResumed = await request(app.base, '/api/execution/process-task-instances/resume', {
    ...as('alice'), method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', commandId: 'process-instance-mixed-resume',
      payload: { projectId: project.id, planInstanceId: mixedHumanStart.planInstanceId,
        version: mixedInstancePaused.version } }),
  });
  assert.equal(mixedInstanceResumed.status, 'ACTIVE');
  const mixedAgentBeforeInsertedCheckpoint = await taskRequest('process-task-mixed-agent-before-inserted-checkpoint',
    mixedDependentPayload(mixedHumanStart.planInstanceId), 'alice', 409);
  assert.equal(mixedAgentBeforeInsertedCheckpoint.error.code, 'PROCESS_TASK_DEPENDENCY_UNSATISFIED',
    'a succeeded original human dependency cannot bypass the inserted human checkpoint');
  const mixedCheckpointStartPayload = {
    projectId: project.id, planId: mixedPlan.id, revision: mixedRevision.revision, taskId: mixedCheckpointTask.id,
  };
  const mixedCheckpointStarted = await request(app.base, '/api/execution/process-task-instances/start', {
    ...as('bob'), method: 'POST', body: command('process-task-mixed-inserted-checkpoint-start', {
      ...mixedCheckpointStartPayload, planInstanceId: mixedHumanStart.planInstanceId,
    }),
  }, 201);
  const mixedCheckpointCompleted = await request(app.base, '/api/execution/process-task-instances/complete', {
    ...as('bob'), method: 'POST', body: command('process-task-mixed-inserted-checkpoint-complete', {
      ...mixedCheckpointStartPayload, planInstanceId: mixedHumanStart.planInstanceId,
      result: 'succeeded', evidence: ['The original review result and supporting notes were checked.'],
    }),
  }, 201);
  assert.equal(mixedCheckpointCompleted.status, 'SUCCEEDED');
  assert.deepEqual(mixedCheckpointCompleted.evidence, ['The original review result and supporting notes were checked.']);

  const providerCallsBeforeCheckpointDependent = providerCallCount;
  const mixedOpenAiDependentRequest = await taskRequest('process-task-mixed-checkpoint-openai-request', {
    ...mixedDependentPayload(mixedHumanStart.planInstanceId), profileId: 'process-task-openai',
  });
  assert.equal(mixedOpenAiDependentRequest.status, 'AWAITING_APPROVAL');
  const mixedOpenAiDependentApproval = await request(app.base, `/api/execution/runs/${mixedOpenAiDependentRequest.id}/approve`, {
    ...as('bob'), method: 'POST', body: JSON.stringify({ version: mixedOpenAiDependentRequest.version }),
  });
  assert.equal(mixedOpenAiDependentApproval.status, 'APPROVED');
  const mixedOpenAiDependentRun = await request(app.base, `/api/execution/runs/${mixedOpenAiDependentRequest.id}/execute`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ version: mixedOpenAiDependentApproval.version }),
  });
  assert.equal(mixedOpenAiDependentRun.status, 'SUCCEEDED');
  assert.equal(providerCallCount, providerCallsBeforeCheckpointDependent + 1,
    'the dependent model task reaches the loopback provider only after its inserted human checkpoint succeeded');
  assert.equal(mixedOpenAiDependentRun.processTaskRef.planInstanceId, mixedHumanStart.planInstanceId);
  assert.equal(mixedOpenAiDependentRun.processTaskRef.taskId, mixedAgentTask.id);
  assert.match(mixedOpenAiDependentRun.execution.evidenceHash, /^[a-f0-9]{64}$/);
  assert.equal(mixedOpenAiDependentRun.execution.generatedProposal.status, 'proposed');
  assert.deepEqual(mixedOpenAiDependentRun.execution.generatedProposal.citations.map(({ id }) => id), [
    mixedOpenAiDependentRun.workItem.proposalContext.sourceEnvelope.sources[0].id,
  ]);

  const mixedOverrideStart = await request(app.base, '/api/execution/process-task-instances/start', {
    ...as('bob'), method: 'POST', body: command('process-task-mixed-override-root-start', mixedRootPayload),
  }, 201);
  const mixedOverrideRefs = { ...mixedRootPayload, planInstanceId: mixedOverrideStart.planInstanceId };
  const mixedOverrideEscalated = await request(app.base, '/api/execution/process-task-instances/escalate', {
    ...as('bob'), method: 'POST', body: command('process-task-mixed-override-root-escalate', {
      ...mixedOverrideRefs, reason: 'The owner must resolve this checkpoint.', evidence: ['Resolution requested.'],
    }),
  }, 201);
  assert.equal(mixedOverrideEscalated.status, 'ESCALATED');
  const mixedOwnerOverride = await request(app.base, '/api/execution/process-task-instances/resolve', {
    ...as('alice'), method: 'POST', body: command('process-task-mixed-override-root-succeed', {
      ...mixedOverrideRefs, disposition: 'succeeded', reason: 'Owner verified the checkpoint outcome.',
      evidence: ['Owner checked the saved review and accepted the result.'],
    }),
  }, 201);
  assert.equal(mixedOwnerOverride.status, 'SUCCEEDED');
  assert.equal(mixedOwnerOverride.events.at(-1).type, 'HumanTaskEscalationResolved');
  assert.equal(mixedOwnerOverride.events.at(-1).data.disposition, 'succeeded');
  assert.equal(mixedOwnerOverride.events.some((event) => event.type === 'HumanTaskCompleted'), false,
    'the owner override retains distinct provenance from assigned-human completion');
  const mixedOverrideCheckpoint = await request(app.base, '/api/execution/process-task-instances/start', {
    ...as('bob'), method: 'POST', body: command('process-task-mixed-override-checkpoint-start', {
      ...mixedCheckpointStartPayload, planInstanceId: mixedOverrideStart.planInstanceId,
    }),
  }, 201);
  assert.equal(mixedOverrideCheckpoint.status, 'IN_PROGRESS');
  const mixedOverrideCheckpointCompleted = await request(app.base, '/api/execution/process-task-instances/complete', {
    ...as('bob'), method: 'POST', body: command('process-task-mixed-override-checkpoint-complete', {
      ...mixedCheckpointStartPayload, planInstanceId: mixedOverrideStart.planInstanceId,
      result: 'succeeded', evidence: ['The owner-resolved review result was checked.'],
    }),
  }, 201);
  assert.equal(mixedOverrideCheckpointCompleted.status, 'SUCCEEDED');
  assert.deepEqual(mixedOverrideCheckpointCompleted.evidence, ['The owner-resolved review result was checked.']);

  const mixedFailedStart = await request(app.base, '/api/execution/process-task-instances/start', {
    ...as('bob'), method: 'POST', body: command('process-task-mixed-failed-root-start', mixedRootPayload),
  }, 201);
  const mixedFailedCompletion = await request(app.base, '/api/execution/process-task-instances/complete', {
    ...as('bob'), method: 'POST', body: command('process-task-mixed-failed-root-complete', {
      ...mixedRootPayload, planInstanceId: mixedFailedStart.planInstanceId,
      result: 'failed', evidence: ['Assigned human could not verify the required checkpoint.'],
    }),
  }, 201);
  assert.equal(mixedFailedCompletion.status, 'FAILED');
  const mixedAgentAfterFailure = await taskRequest('process-task-mixed-agent-after-failed-human',
    mixedDependentPayload(mixedFailedStart.planInstanceId), 'alice', 409);
  assert.equal(mixedAgentAfterFailure.error.code, 'PROCESS_TASK_DEPENDENCY_UNSATISFIED');

  const mixedRevokedIncompleteStart = await request(app.base, '/api/execution/process-task-instances/start', {
    ...as('bob'), method: 'POST', body: command('process-task-mixed-revoked-incomplete-start', mixedRootPayload),
  }, 201);
  const mixedRevokedIncompleteRefs = { ...mixedRootPayload, planInstanceId: mixedRevokedIncompleteStart.planInstanceId };

  const startAndEscalateRoot = async (label) => {
    const started = await request(app.base, '/api/execution/process-task-instances/start', {
      ...as('bob'), method: 'POST', body: command(`process-task-human-${label}-start`, humanRootStartPayload),
    }, 201);
    const refs = { ...humanRootStartPayload, planInstanceId: started.planInstanceId };
    await request(app.base, '/api/execution/process-task-instances/escalate', {
      ...as('bob'), method: 'POST', body: command(`process-task-human-${label}-escalate`, {
        ...refs, reason: `Owner review is required for ${label}.`, evidence: [],
      }),
    }, 201);
    return refs;
  };
  const ownerSuccessRefs = await startAndEscalateRoot('owner-success');
  const noSuccessEvidence = await request(app.base, '/api/execution/process-task-instances/resolve', {
    ...as('alice'), method: 'POST', body: command('process-task-human-owner-success-no-evidence', {
      ...ownerSuccessRefs, disposition: 'succeeded', reason: 'Reviewed without evidence.', evidence: [],
    }),
  }, 409);
  assert.equal(noSuccessEvidence.error.code, 'INVALID_HUMAN_TASK_OUTCOME');
  const ownerSuccess = await request(app.base, '/api/execution/process-task-instances/resolve', {
    ...as('alice'), method: 'POST', body: command('process-task-human-owner-success', {
      ...ownerSuccessRefs, disposition: 'succeeded', reason: 'The checkpoint was verified.', evidence: ['Owner verified the saved review.'],
    }),
  }, 201);
  assert.equal(ownerSuccess.status, 'SUCCEEDED');
  const ownerSuccessReplay = await request(app.base, '/api/execution/process-task-instances/resolve', {
    ...as('alice'), method: 'POST', body: command('process-task-human-owner-success', {
      ...ownerSuccessRefs, disposition: 'succeeded', reason: 'The checkpoint was verified.', evidence: ['Owner verified the saved review.'],
    }),
  }, 200);
  assert.equal(ownerSuccessReplay.meta.replayed, true);
  assert.equal(ownerSuccessReplay.events.filter((event) => event.type === 'HumanTaskEscalationResolved').length, 1);
  const dependentAfterOwnerSuccess = await request(app.base, '/api/execution/process-task-instances/start', {
    ...as('bob'), method: 'POST', body: command('process-task-human-dependent-after-owner-success', {
      projectId: project.id, planId: humanRootPlan.id, revision: humanRootRevision.revision,
      planInstanceId: ownerSuccessRefs.planInstanceId, taskId: dependentHumanTask.id,
    }),
  }, 201);
  assert.equal(dependentAfterOwnerSuccess.status, 'IN_PROGRESS');
  const ownerFailureRefs = await startAndEscalateRoot('owner-failure');
  const ownerFailure = await request(app.base, '/api/execution/process-task-instances/resolve', {
    ...as('alice'), method: 'POST', body: command('process-task-human-owner-failure', {
      ...ownerFailureRefs, disposition: 'failed', reason: 'Required work was not verified.', evidence: ['The required review record is missing.'],
    }),
  }, 201);
  assert.equal(ownerFailure.status, 'FAILED');
  const dependentAfterOwnerFailure = await request(app.base, '/api/execution/process-task-instances/start', {
    ...as('bob'), method: 'POST', body: command('process-task-human-dependent-after-owner-failure', {
      projectId: project.id, planId: humanRootPlan.id, revision: humanRootRevision.revision,
      planInstanceId: ownerFailureRefs.planInstanceId, taskId: dependentHumanTask.id,
    }),
  }, 409);
  assert.equal(dependentAfterOwnerFailure.error.code, 'PROCESS_TASK_DEPENDENCY_UNSATISFIED');
  const staleResumeRefs = await startAndEscalateRoot('stale-resume');
  const unauthorized = await taskRequest('process-task-reader-denied', successInput, 'readonly', 403);
  assert.equal(unauthorized.error.code, 'ACTION_FORBIDDEN');

  const revision3Payload = { tasks: currentPlan.tasks.map((task) => ({
    taskId: task.id, title: task.title, detail: task.id === 'task-process-learn' ? `${task.detail} Keep this as the latest plan.` : task.detail,
    dependencies: task.dependencies, roleId: task.assignee.roleId, actorId: task.assignee.actorId,
  })) };
  const currentProjectForRevision3 = (await request(app.base, `/api/v1/projects/${project.id}`, as('alice'))).data;
  const revision3 = await request(app.base, revisionRoute, {
    ...as('alice'), method: 'POST', body: command('process-task-plan-revision-3', revision3Payload, currentProjectForRevision3.version),
  });
  const staleNewInstance = await taskRequest('process-task-stale-revision', successInput, 'alice', 409);
  assert.equal(staleNewInstance.error.code, 'PROCESS_PLAN_REVISION_STALE');
  const pinnedRevisionTask = await taskRequest('process-task-pinned-v2-human-review', humanInput, 'alice', 409);
  assert.equal(pinnedRevisionTask.error.code, 'PROCESS_TASK_ALREADY_REQUESTED',
    'the human runtime already owns this task in its immutable revision-2 instance after revision 3 is saved');
  await request(app.base, `/api/v1/projects/${project.id}/members/${principal('bob')}/revoke`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({}),
  });
  await request(app.base, membersRoute, {
    ...as('alice'), method: 'POST', body: JSON.stringify({ principal: principal('bob'), access: 'editor' }),
  });
  const staleResumeDenied = await request(app.base, '/api/execution/process-task-instances/resolve', {
    ...as('alice'), method: 'POST', body: command('process-task-human-stale-resume', {
      ...staleResumeRefs, disposition: 'resume', reason: 'Attempt resume after original assignment changed.', evidence: [],
    }),
  }, 409);
  assert.equal(staleResumeDenied.error.code, 'PROCESS_TASK_ACTOR_BINDING_STALE');
  const staleHumanBinding = await request(app.base, '/api/execution/process-task-instances/start', {
    ...as('bob'), method: 'POST', body: command('process-task-human-root-stale-binding', humanRootStartPayload),
  }, 409);
  assert.equal(staleHumanBinding.error.code, 'PROCESS_TASK_ACTOR_BINDING_STALE');
  const staleStartReplay = await request(app.base, '/api/execution/process-task-instances/start', {
    ...as('bob'), method: 'POST', body: command('process-task-human-root-start', humanRootStartPayload),
  });
  assert.equal(staleStartReplay.meta.replayed, true);
  assert.equal(staleStartReplay.assignedToCurrentPrincipal, false,
    'idempotent start replay must not claim the original assignment is current after membership generation changes');
  const staleCompleteReplay = await request(app.base, '/api/execution/process-task-instances/complete', {
    ...as('bob'), method: 'POST', body: command('process-task-human-root-complete', {
      ...humanRootStartPayload, planInstanceId: startedHumanRoot.planInstanceId,
      result: 'succeeded', evidence: ['Root human task completed.'],
    }),
  });
  assert.equal(staleCompleteReplay.meta.replayed, true);
  assert.equal(staleCompleteReplay.assignedToCurrentPrincipal, false,
    'idempotent completion replay must report the same stale assignment state as runtime reads');
  const revokedIncompleteCompletion = await request(app.base, '/api/execution/process-task-instances/complete', {
    ...as('bob'), method: 'POST', body: command('process-task-mixed-revoked-incomplete-complete', {
      ...mixedRootPayload, planInstanceId: mixedRevokedIncompleteStart.planInstanceId,
      result: 'succeeded', evidence: ['The former assignee attempts to complete after revocation.'],
    }),
  }, 409);
  assert.equal(revokedIncompleteCompletion.error.code, 'PROCESS_TASK_ACTOR_BINDING_STALE');
  const revokedIncompleteDependency = await taskRequest('process-task-mixed-agent-after-revoked-incomplete-human',
    mixedDependentPayload(mixedRevokedIncompleteStart.planInstanceId), 'alice', 409);
  assert.equal(revokedIncompleteDependency.error.code, 'PROCESS_TASK_DEPENDENCY_UNSATISFIED');

  const executeMixedDependentAfterHumanTerminal = async (label, planInstanceId) => {
    const requested = await taskRequest(`process-task-mixed-agent-after-${label}`, mixedDependentPayload(planInstanceId));
    assert.equal(requested.status, 'AWAITING_APPROVAL');
    assert.equal(requested.processTaskRef.planInstanceId, planInstanceId,
      'the dependent agent request joins the exact human checkpoint instance');
    assert.equal(requested.processTaskRef.taskId, mixedAgentTask.id);
    const completed = await approveAndExecute(requested);
    assert.equal(completed.status, 'SUCCEEDED');
    assert.equal(completed.processTaskRef.planInstanceId, planInstanceId);
    return { requested, completed };
  };
  const mixedAgentAfterAssignedCompletion = {
    requested: mixedOpenAiDependentRequest, completed: mixedOpenAiDependentRun,
  };
  const mixedAgentAfterOwnerOverride = await executeMixedDependentAfterHumanTerminal(
    'owner-override-after-revocation', mixedOverrideStart.planInstanceId);
  const mixedRuntimeAfterRevocation = (await request(app.base,
    `/api/execution/process-task-instances?projectId=${encodeURIComponent(project.id)}`, as('bob'))).instances;
  assert.equal(mixedRuntimeAfterRevocation.find((runtime) => runtime.planInstanceId === mixedHumanStart.planInstanceId
    && runtime.taskId === mixedHumanRootTask.id).assignedToCurrentPrincipal, false,
  'the completed human assignment is now stale even though its terminal checkpoint still gates the agent task');

  const staleAgentPauseRequest = await taskRequest('process-task-pause-stale-agent-request', {
    ...successInput, revision: 3,
  });
  const staleAgentPaused = await request(app.base, `/api/execution/runs/${staleAgentPauseRequest.id}/pause`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({
      commandId: 'process-task-pause-stale-agent-command', projectId: project.id, version: staleAgentPauseRequest.version,
    }),
  });
  assert.equal(staleAgentPaused.status, 'PAUSED');
  await request(app.base, `${membersRoute}/${principal('servicebot')}/revoke`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({}),
  });
  const staleAgentResume = await request(app.base, `/api/execution/runs/${staleAgentPauseRequest.id}/resume`, {
    ...as('alice'), method: 'POST', body: JSON.stringify({
      commandId: 'process-task-pause-stale-agent-resume', projectId: project.id, version: staleAgentPaused.version,
    }),
  }, 409);
  assert.equal(staleAgentResume.error.code, 'PROCESS_TASK_ACTOR_BINDING_STALE');
  assert.equal((await request(app.base, `/api/execution/runs/${staleAgentPauseRequest.id}`, as('alice'))).status, 'PAUSED',
    'stale actor-binding validation leaves the request paused');
  const revokedBinding = await taskRequest('process-task-revoked-binding', {
    ...successInput, revision: 3,
  }, 'alice', 409);
  assert.equal(revokedBinding.error.code, 'PROCESS_TASK_ACTOR_BINDING_INELIGIBLE');

  const otherProject = (await request(app.base, '/api/v1/projects', {
    ...as('alice'), method: 'POST', body: command('process-task-other-project', { name: 'Unrelated task workspace' }),
  }, 201)).data;
  const crossProjectProposalApply = await request(app.base,
    `/api/v1/projects/${otherProject.id}/blueprint-proposals/${openAiSuccessfulRun.id}/apply`, {
      ...as('alice'), method: 'POST', body: command('proposal-apply-cross-project', { proposalHash: generatedProposal.proposalHash }, otherProject.version),
    }, 404);
  assert.equal(crossProjectProposalApply.error.code, 'BLUEPRINT_PROPOSAL_NOT_FOUND');
  const crossProjectPlan = await taskRequest('process-task-cross-project-plan', {
    ...successInput, projectId: otherProject.id, revision: revision3.data.processPlans.at(-1).revision,
  }, 'alice', 409);
  assert.equal(crossProjectPlan.error.code, 'PROCESS_PLAN_REVISION_NOT_FOUND');
  assert.deepEqual((await request(app.base,
    `/api/execution/process-task-instances?projectId=${encodeURIComponent(otherProject.id)}`, as('alice'))).instances, []);

  const proposalApplyPath = `/api/v1/projects/${project.id}/blueprint-proposals/${openAiSuccessfulRun.id}/apply`;
  const projectBeforeProposalApply = (await request(app.base, `/api/v1/projects/${project.id}`, as('alice'))).data;
  const actorDesignBeforeProposalApply = Object.values(projectBeforeProposalApply.latestBlueprint.areas).flatMap((area) => area.items)
    .filter((item) => item.type === 'actor-human' || item.type === 'actor-agent');
  const processPlansBeforeProposalApply = structuredClone(projectBeforeProposalApply.processPlans);
  const editorProposalApply = await request(app.base, proposalApplyPath, {
    ...as('bob'), method: 'POST', body: command('proposal-apply-editor-denied', { proposalHash: generatedProposal.proposalHash }, projectBeforeProposalApply.version),
  }, 403);
  assert.equal(editorProposalApply.error.code, 'ACTION_FORBIDDEN');
  const runtimeBeforeProposalApply = (await request(app.base,
    `/api/execution/process-task-instances?projectId=${encodeURIComponent(project.id)}`, as('alice'))).instances;
  const appliedProposal = await request(app.base, proposalApplyPath, {
    ...as('alice'), method: 'POST', body: command('proposal-apply-success', { proposalHash: generatedProposal.proposalHash }, projectBeforeProposalApply.version),
  });
  project = appliedProposal.data;
  assert.equal(appliedProposal.event.type, 'BlueprintProposalApplied');
  assert.equal(appliedProposal.event.data.proposalHash, generatedProposal.proposalHash);
  assert.equal(appliedProposal.event.data.epistemicStatus, 'proposed-design');
  assert.deepEqual(appliedProposal.event.data.sourceIds, ['information-customer-signal']);
  assert.equal(project.latestBlueprint.version, projectBeforeProposalApply.latestBlueprint.version + 1);
  assert.equal(project.latestBlueprint.epistemicStatus, 'proposed-design');
  const appliedTarget = Object.values(project.latestBlueprint.areas).flatMap((area) => area.items)
    .find((item) => item.id === generatedProposal.target.id);
  assert.equal(appliedTarget.detail, generatedProposal.proposedDetail);
  assert.equal(project.blueprintVersions.find((entry) => entry.id === generatedProposal.blueprintId).version,
    generatedProposal.blueprintVersion, 'the pinned source version remains in immutable project history');
  assert.equal(project.latestBlueprint.edit.proposalProvenance.proposalHash, generatedProposal.proposalHash);
  assert.deepEqual(project.latestBlueprint.edit.proposalProvenance.citations, [{ id: 'information-customer-signal', hash: generatedProposal.citations[0].hash }]);
  assert.deepEqual(Object.values(project.latestBlueprint.areas).flatMap((area) => area.items)
    .filter((item) => item.type === 'actor-human' || item.type === 'actor-agent'), actorDesignBeforeProposalApply,
  'proposal application does not change actor assignments or authority design');
  assert.deepEqual(project.processPlans, processPlansBeforeProposalApply,
    'proposal application preserves immutable plan revisions and task assignments');
  const proposalApplyReplay = await request(app.base, proposalApplyPath, {
    ...as('alice'), method: 'POST', body: command('proposal-apply-success', { proposalHash: generatedProposal.proposalHash }, projectBeforeProposalApply.version),
  });
  assert.equal(proposalApplyReplay.meta.replayed, true);
  assert.equal(proposalApplyReplay.data.blueprintVersions.length, project.blueprintVersions.length);
  assert.equal(proposalApplyReplay.data.events.filter((event) => event.type === 'BlueprintProposalApplied'
    && event.data.proposalHash === generatedProposal.proposalHash).length, 1);
  const changedProposalHash = await request(app.base, proposalApplyPath, {
    ...as('alice'), method: 'POST', body: command('proposal-apply-hash-mismatch', { proposalHash: '0'.repeat(64) }, project.version),
  }, 409);
  assert.equal(changedProposalHash.error.code, 'BLUEPRINT_PROPOSAL_HASH_MISMATCH');
  const staleProposalApply = await request(app.base, proposalApplyPath, {
    ...as('alice'), method: 'POST', body: command('proposal-apply-stale-version', { proposalHash: generatedProposal.proposalHash }, project.version),
  }, 409);
  assert.equal(staleProposalApply.error.code, 'BLUEPRINT_PROPOSAL_STALE');
  const runtimeAfterProposalApply = (await request(app.base,
    `/api/execution/process-task-instances?projectId=${encodeURIComponent(project.id)}`, as('alice'))).instances;
  const proposalRuntime = (instances) => instances.find((runtime) => runtime.planInstanceId === openAiSuccessfulRun.processTaskRef.planInstanceId
    && runtime.taskId === openAiSuccessfulRun.processTaskRef.taskId);
  assert.deepEqual(proposalRuntime(runtimeAfterProposalApply), proposalRuntime(runtimeBeforeProposalApply),
    'applying proposed detail does not change process runtime or assignment state');

  await assert.rejects(() => app.persistence.query(`
    update orgward.aggregates
    set state = jsonb_set(state, '{processTaskRef,taskId}', to_jsonb('task-forged'::text))
    where tenant_id = 'tenant-a' and aggregate_kind = 'execution_run' and aggregate_id = $1
  `, [secondRoot.id]), /immutable/i);

  await close(app); app = null;
  app = await start(postgres.databaseUrl, {
    executionProfiles: profiles, oidcAuthenticator, secretEncryptionKey: Buffer.alloc(32, 0x5c),
    openAiValidationEndpoint: `${providerOrigin}/v1/models`,
  });
  const restoredRuns = (await request(app.base, '/api/execution/runs', as('alice'))).runs;
  assert.deepEqual(new Map(restoredRuns.map((run) => [run.id, run.status])).get(firstRoot.id), 'FAILED');
  assert.deepEqual(new Map(restoredRuns.map((run) => [run.id, run.status])).get(pendingCancellation.id), 'CANCELLED');
  assert.deepEqual(new Map(restoredRuns.map((run) => [run.id, run.status])).get(approvedCancellation.id), 'CANCELLED');
  assert.deepEqual(new Map(restoredRuns.map((run) => [run.id, run.status])).get(staleCredentialPauseRequest.id), 'PAUSED');
  assert.deepEqual(new Map(restoredRuns.map((run) => [run.id, run.status])).get(staleAgentPauseRequest.id), 'PAUSED');
  assert.deepEqual(new Map(restoredRuns.map((run) => [run.id, run.status])).get(pendingPauseRequest.id), 'SUCCEEDED');
  assert.deepEqual(new Map(restoredRuns.map((run) => [run.id, run.status])).get(approvedPauseRequest.id), 'CANCELLED');
  assert.deepEqual(new Map(restoredRuns.map((run) => [run.id, run.status])).get(raceRequest.id), raceFinal.status);
  assert.deepEqual(new Map(restoredRuns.map((run) => [run.id, run.status])).get(runningRequest.id), 'SUCCEEDED');
  assert.equal(restoredRuns.find((run) => run.id === pendingCancellation.id)
    .events.filter((event) => event.type === 'ExecutionCancelled').length, 1);
  assert.deepEqual(new Map(restoredRuns.map((run) => [run.id, run.status])).get(secondRoot.id), 'SUCCEEDED');
  assert.deepEqual(new Map(restoredRuns.map((run) => [run.id, run.status])).get(dependent.id), 'SUCCEEDED');
  const restoredOpenAiRun = restoredRuns.find((run) => run.id === openAiSuccessfulRun.id);
  assert.equal(restoredOpenAiRun.status, 'SUCCEEDED');
  assert.deepEqual(restoredOpenAiRun.processTaskRef, openAiSuccessfulRun.processTaskRef);
  assert.equal(restoredOpenAiRun.execution.stdout, JSON.stringify({
    proposedDetail: 'Recurring repair signals are grouped into service needs for founder review.',
    rationale: 'The saved customer signal describes recurring repair history.',
    citations: ['information-customer-signal'],
  }));
  assert.equal(restoredOpenAiRun.execution.evidenceHash, openAiSuccessfulRun.execution.evidenceHash);
  assert.deepEqual(restoredOpenAiRun.execution.generatedProposal, openAiSuccessfulRun.execution.generatedProposal,
    'the immutable terminal run retains the exact proposal envelope and hash after restart');
  assert.equal(restoredOpenAiRun.execution.generatedProposal.status, 'proposed',
    'applied state is not written back into the immutable run result');
  assert.equal(JSON.stringify(restoredOpenAiRun).includes(openAiFixtureSecret), false,
    'reloaded execution history does not expose credential material');
  const restoredMixedOpenAiRun = restoredRuns.find((run) => run.id === mixedOpenAiDependentRun.id);
  assert.equal(restoredMixedOpenAiRun.status, 'SUCCEEDED');
  assert.deepEqual(restoredMixedOpenAiRun.processTaskRef, mixedOpenAiDependentRun.processTaskRef);
  assert.equal(restoredMixedOpenAiRun.execution.evidenceHash, mixedOpenAiDependentRun.execution.evidenceHash,
    'the checkpoint-dependent agent result retains its evidence hash after application restart');
  assert.deepEqual(restoredMixedOpenAiRun.execution.generatedProposal, mixedOpenAiDependentRun.execution.generatedProposal,
    'the dependent model output and citations remain inspectable after application restart');
  for (const run of restoredRuns.filter((candidate) => [firstRoot.id, secondRoot.id, dependent.id].includes(candidate.id))) {
    assert.deepEqual(run.processTaskRef, [firstRoot, secondRoot, dependent].find((candidate) => candidate.id === run.id).processTaskRef);
  }
  const restoredProject = (await request(app.base, `/api/v1/projects/${project.id}`, as('alice'))).data;
  const restoredApplyEvent = restoredProject.events.find((event) => event.type === 'BlueprintProposalApplied'
    && event.data?.proposalHash === generatedProposal.proposalHash);
  assert.ok(restoredApplyEvent, 'applied status survives restart through the project event');
  assert.equal(restoredApplyEvent.data.appliedBlueprintVersion, generatedProposal.blueprintVersion + 1);
  const proposalReplayAfterRestart = await request(app.base, proposalApplyPath, {
    ...as('alice'), method: 'POST', body: command('proposal-apply-success', { proposalHash: generatedProposal.proposalHash }, projectBeforeProposalApply.version),
  });
  assert.equal(proposalReplayAfterRestart.meta.replayed, true);
  assert.equal(proposalReplayAfterRestart.data.events.filter((event) => event.type === 'BlueprintProposalApplied'
    && event.data.proposalHash === generatedProposal.proposalHash).length, 1);
  assert.equal(restoredProject.processPlans.every((savedPlan) => savedPlan.tasks.every((task) => task.status === 'planned')), true,
    'the project graph keeps proposed task status; runtime state is derived from canonical task instances');
  assert.equal(restoredProject.processPlans.filter((savedPlan) => savedPlan.id === plan.id).at(-1).revision, 3);
  const restoredTaskInstances = (await request(app.base,
    `/api/execution/process-task-instances?projectId=${encodeURIComponent(project.id)}`, as('bob'))).instances;
  const restoredRuntime = (run) => restoredTaskInstances.find((runtime) => runtime.taskId === run.processTaskRef.taskId
    && runtime.planInstanceId === run.processTaskRef.planInstanceId);
  assert.equal(restoredRuntime(pendingCancellation).status, 'CANCELLED');
  assert.equal(restoredRuntime(pendingCancellation).executionRunId, pendingCancellation.id);
  assert.ok(restoredRuntime(pendingCancellation).completedAt);
  assert.equal(restoredRuntime(pendingCancellation).startedAt, null);
  assert.equal(restoredRuntime(pendingCancellation).events.filter((event) => event.type === 'ProcessTaskRunStatusChanged'
    && event.data.status === 'CANCELLED').length, 1);
  const cancellationReplayAfterRestart = await request(app.base, `/api/execution/runs/${pendingCancellation.id}/cancel`, {
    ...as('alice'), method: 'POST', body: JSON.stringify(pendingCancelBody),
  });
  assert.equal(cancellationReplayAfterRestart.meta.replayed, true);
  assert.equal(cancellationReplayAfterRestart.events.filter((event) => event.type === 'ExecutionCancelled').length, 1,
    'restart replay returns the saved cancellation without duplicate history');
  assert.equal(restoredRuntime(firstRoot).status, 'FAILED');
  assert.equal(restoredRuntime(firstRoot).executionRunId, firstRoot.id);
  assert.equal(restoredRuntime(secondRoot).status, 'SUCCEEDED');
  assert.equal(restoredRuntime(secondRoot).executionRunId, secondRoot.id);
  assert.equal(restoredRuntime(dependent).status, 'SUCCEEDED');
  assert.equal(restoredRuntime(dependent).executionRunId, dependent.id);
  assert.equal(restoredRuntime(staleCredentialPauseRequest).status, 'PAUSED');
  assert.equal(restoredRuntime(staleCredentialPauseRequest).executionRunId, staleCredentialPauseRequest.id);
  assert.equal(restoredRuntime(staleAgentPauseRequest).status, 'PAUSED');
  assert.equal(restoredRuntime(staleAgentPauseRequest).executionRunId, staleAgentPauseRequest.id);
  assert.equal(restoredRuntime(pendingPauseRequest).status, 'SUCCEEDED');
  assert.equal(restoredRuntime(pendingPauseRequest).events.filter((event) => event.type === 'ProcessTaskRunStatusChanged'
    && event.data.status === 'PAUSED').length, 1);
  assert.equal(restoredRuntime(openAiSuccessfulRun).status, 'SUCCEEDED');
  assert.equal(restoredRuntime(openAiSuccessfulRun).executionRunId, openAiSuccessfulRun.id);
  assert.equal(restoredTaskInstances.find((runtime) => runtime.taskId === 'task-process-review'
    && runtime.planInstanceId === secondRoot.processTaskRef.planInstanceId).status, 'SUCCEEDED');
  assert.deepEqual(restoredTaskInstances.find((runtime) => runtime.taskId === rootHumanTask.id
    && runtime.processPlanId === humanRootPlan.id).evidence, ['Root human task completed.']);
  const restoredHumanRuntime = (planInstanceId, taskId = rootHumanTask.id) => restoredTaskInstances.find((runtime) =>
    runtime.processPlanId === humanRootPlan.id && runtime.planInstanceId === planInstanceId && runtime.taskId === taskId);
  const restoredMixedRuntime = (planInstanceId, taskId) => restoredTaskInstances.find((runtime) =>
    runtime.processPlanId === mixedPlan.id && runtime.planInstanceId === planInstanceId && runtime.taskId === taskId);
  const restoredMixedCheckpoint = restoredMixedRuntime(mixedHumanStart.planInstanceId, mixedCheckpointTask.id);
  assert.equal(restoredMixedCheckpoint.status, 'SUCCEEDED');
  assert.deepEqual(restoredMixedCheckpoint.evidence, ['The original review result and supporting notes were checked.']);
  assert.ok(restoredMixedCheckpoint.events.some((event) => event.type === 'HumanTaskCompleted'),
    'the required human checkpoint evidence and completion event survive the application restart');
  const restoredMixedOpenAiRuntime = restoredMixedRuntime(mixedHumanStart.planInstanceId, mixedAgentTask.id);
  assert.equal(restoredMixedOpenAiRuntime.status, 'SUCCEEDED');
  assert.equal(restoredMixedOpenAiRuntime.executionRunId, mixedOpenAiDependentRun.id);
  assert.ok(restoredMixedOpenAiRuntime.events.some((event) => event.type === 'ProcessTaskRunStatusChanged'
    && event.data.status === 'SUCCEEDED'), 'the same-instance task runtime records dependent-agent success after restart');
  const restoredAssignedMixedRoot = restoredMixedRuntime(mixedHumanStart.planInstanceId, mixedHumanRootTask.id);
  assert.equal(restoredAssignedMixedRoot.status, 'SUCCEEDED');
  assert.deepEqual(restoredAssignedMixedRoot.evidence, ['Assigned human verified the checkpoint.']);
  assert.deepEqual(restoredAssignedMixedRoot.events.filter((event) => ['HumanTaskEscalated', 'HumanTaskEscalationResolved', 'HumanTaskCompleted'].includes(event.type))
    .map((event) => event.type), ['HumanTaskEscalated', 'HumanTaskEscalationResolved', 'HumanTaskCompleted']);
  assert.equal(JSON.stringify(restoredAssignedMixedRoot).includes(principal('bob')), false);
  const restoredOverrideMixedRoot = restoredMixedRuntime(mixedOverrideStart.planInstanceId, mixedHumanRootTask.id);
  assert.equal(restoredOverrideMixedRoot.status, 'SUCCEEDED');
  assert.deepEqual(restoredOverrideMixedRoot.evidence, ['Owner checked the saved review and accepted the result.']);
  assert.equal(restoredOverrideMixedRoot.events.at(-1).type, 'HumanTaskEscalationResolved');
  assert.equal(restoredOverrideMixedRoot.events.at(-1).data.disposition, 'succeeded');
  assert.equal(restoredOverrideMixedRoot.events.some((event) => event.type === 'HumanTaskCompleted'), false);
  const restoredFailedMixedRoot = restoredMixedRuntime(mixedFailedStart.planInstanceId, mixedHumanRootTask.id);
  assert.equal(restoredFailedMixedRoot.status, 'FAILED');
  const restoredRevokedIncompleteRoot = restoredMixedRuntime(mixedRevokedIncompleteStart.planInstanceId, mixedHumanRootTask.id);
  assert.equal(restoredRevokedIncompleteRoot.status, 'IN_PROGRESS');
  assert.equal(restoredRevokedIncompleteRoot.assignedToCurrentPrincipal, false);
  for (const { requested, completed } of [mixedAgentAfterAssignedCompletion, mixedAgentAfterOwnerOverride]) {
    const runtime = restoredMixedRuntime(requested.processTaskRef.planInstanceId, mixedAgentTask.id);
    assert.equal(runtime.status, 'SUCCEEDED');
    assert.equal(runtime.executionRunId, completed.id);
    assert.equal(completed.processTaskRef.planInstanceId, requested.processTaskRef.planInstanceId);
    assert.equal(new Map(restoredRuns.map((run) => [run.id, run.status])).get(completed.id), 'SUCCEEDED');
  }
  const resumedHumanHistory = restoredHumanRuntime(startedHumanRoot.planInstanceId);
  assert.equal(resumedHumanHistory.status, 'SUCCEEDED');
  assert.deepEqual(resumedHumanHistory.events.filter((event) => ['HumanTaskEscalated', 'HumanTaskEscalationResolved'].includes(event.type))
    .map((event) => [event.type, event.actor]), [
    ['HumanTaskEscalated', 'assigned human'], ['HumanTaskEscalationResolved', 'project owner'],
  ]);
  assert.equal(restoredHumanRuntime(ownerSuccessRefs.planInstanceId).status, 'SUCCEEDED');
  assert.equal(restoredHumanRuntime(ownerFailureRefs.planInstanceId).status, 'FAILED');
  const restoredStaleEscalation = restoredHumanRuntime(staleResumeRefs.planInstanceId);
  assert.equal(restoredStaleEscalation.status, 'ESCALATED');
  assert.equal(JSON.stringify(restoredStaleEscalation).includes(principal('bob')), false);
  const ownerRestoredInstances = (await request(app.base,
    `/api/execution/process-task-instances?projectId=${encodeURIComponent(project.id)}`, as('alice'))).instances;
  assert.equal(ownerRestoredInstances.find((runtime) => runtime.planInstanceId === staleResumeRefs.planInstanceId
    && runtime.taskId === rootHumanTask.id).canResolveEscalation, true);
  await assert.rejects(() => app.persistence.query(`
    update orgward.process_task_instances set status='SUCCEEDED'
    where tenant_id='tenant-a' and plan_instance_id=$1 and task_id=$2
  `, [staleResumeRefs.planInstanceId, rootHumanTask.id]), /exactly one append-only event/i,
  'the database trigger rejects a terminal escalation update that omits its resolution event');
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

test('decision maker and governed scope edits persist as proposed design only', async (t) => {
  const postgres = await startPostgres();
  t.after(postgres.close);
  const oidcAuthenticator = testOidcAuthenticator();
  let app = await start(postgres.databaseUrl, { oidcAuthenticator });
  t.after(async () => { if (app) await close(app); });
  const issuer = 'https://persistence-identity.example.test';
  const principal = (subject) => `oidc:${createHash('sha256').update(`${issuer}\n${subject}`).digest('hex')}`;
  const as = (subject) => ({ headers: { authorization: `Bearer ${subject}` } });
  const created = await request(app.base, '/api/v1/projects', {
    ...as('alice'), method: 'POST', body: command('decision-edit-project', { name: 'Decision design workspace' }),
  }, 201);
  let project = created.data;
  for (const [index, content] of [
    'Independent restaurants need dependable equipment repair.',
    'Customers want fast response, predictable service, and clear records.',
    'Use a subscription with transparent repair costs.',
    'Keep customer commitments and every consequential action human approved.',
  ].entries()) {
    project = (await request(app.base, `/api/v1/projects/${project.id}/messages`, {
      ...as('alice'), method: 'POST', body: command(`decision-edit-answer-${index + 1}`, { content }, project.version),
    })).data;
  }
  assert.ok(project.latestBlueprint, 'four discovery answers create a saved enterprise design');
  const decision = project.latestBlueprint.areas.governanceRiskControls.items.find((item) => item.id === 'decision-priority');
  assert.ok(decision);
  const route = `/api/v1/projects/${project.id}/blueprint/edits`;
  const sendEdit = (subject, commandId, payload, expectedVersion = project.version, expected = 200) => request(app.base, route, {
    ...as(subject), method: 'POST', body: command(commandId, payload, expectedVersion),
  }, expected);
  await app.persistence.query(`insert into orgward.project_memberships (tenant_id, project_id, principal, access, granted_by)
    values ('tenant-a', $1, $2, 'reader', $3)`, [project.id, principal('readonly'), principal('alice')]);
  const decisionPayload = {
    objectId: decision.id, name: decision.name, detail: decision.detail,
    decisionMakerRoleId: 'role-operations', decisionScopeIds: ['process-deliver', 'risk-unsafe-automation'],
  };
  const initialVersion = project.version;
  const readerDenied = await sendEdit('readonly', 'decision-edit-reader', decisionPayload, initialVersion, 403);
  assert.equal(readerDenied.error.code, 'ACTION_FORBIDDEN');
  const otherTenantDenied = await sendEdit('tenant-b-admin', 'decision-edit-cross-tenant', decisionPayload, initialVersion, 404);
  assert.equal(otherTenantDenied.error.code, 'PROJECT_NOT_FOUND');
  const malformedMaker = await sendEdit('alice', 'decision-edit-malformed-maker', { ...decisionPayload, decisionMakerRoleId: '' }, initialVersion, 400);
  assert.equal(malformedMaker.error.code, 'INVALID_COMMAND');
  const duplicateScope = await sendEdit('alice', 'decision-edit-duplicate-scope', {
    ...decisionPayload, decisionScopeIds: ['process-deliver', 'process-deliver'],
  }, initialVersion, 400);
  assert.equal(duplicateScope.error.code, 'INVALID_COMMAND');
  const wrongMakerType = await sendEdit('alice', 'decision-edit-wrong-maker-type', {
    ...decisionPayload, decisionMakerRoleId: 'system-studio',
  }, initialVersion, 400);
  assert.equal(wrongMakerType.error.code, 'INVALID_BLUEPRINT_RELATION');
  const wrongScopeType = await sendEdit('alice', 'decision-edit-wrong-scope-type', {
    ...decisionPayload, decisionScopeIds: ['role-founder'],
  }, initialVersion, 400);
  assert.equal(wrongScopeType.error.code, 'INVALID_BLUEPRINT_RELATION');
  const unknownScope = await sendEdit('alice', 'decision-edit-unknown-scope', {
    ...decisionPayload, decisionScopeIds: ['missing-record'],
  }, initialVersion, 400);
  assert.equal(unknownScope.error.code, 'INVALID_BLUEPRINT_RELATION');

  const membershipBefore = await app.persistence.query(`select principal, access, generation, revoked_at
    from orgward.project_memberships where tenant_id='tenant-a' and project_id=$1 order by principal`, [project.id]);
  const rolePrincipals = [principal('alice'), principal('readonly')];
  const rolesBefore = await app.persistence.query(`select principal, roles, authz_generation from orgward.oidc_principals
    where tenant_id='tenant-a' and principal=any($1::text[]) order by principal`, [rolePrincipals]);
  const added = await sendEdit('alice', 'decision-edit-scope-add', decisionPayload, initialVersion);
  project = added.data;
  const editedDecision = project.latestBlueprint.areas.governanceRiskControls.items.find((item) => item.id === decision.id);
  assert.equal(editedDecision.by, 'role-operations');
  assert.deepEqual(editedDecision.scope, ['process-deliver', 'risk-unsafe-automation']);
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === 'role-operations' && link.target === decision.id && link.type === 'decides'));
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === decision.id && link.target === 'process-deliver' && link.type === 'governs'));
  assert.equal(project.latestBlueprint.edit.before.decisionMakerRoleName, 'Founder / enterprise owner');
  assert.equal(project.latestBlueprint.edit.after.decisionMakerRoleName, 'Operations owner');
  assert.deepEqual(project.latestBlueprint.edit.before.decisionScopeNames, ['Deliver the promised customer outcome', 'Enterprise steering']);
  assert.deepEqual(project.latestBlueprint.edit.after.decisionScopeNames, ['Deliver the core offering', 'Unapproved automated action']);
  assert.equal(project.latestBlueprint.epistemicStatus, 'proposed-design');
  assert.equal(editedDecision.status, 'designed');
  assert.equal(project.blueprintVersions[0].areas.governanceRiskControls.items.find((item) => item.id === decision.id).by, 'role-founder');

  const addReplay = await sendEdit('alice', 'decision-edit-scope-add', decisionPayload, initialVersion);
  assert.equal(addReplay.meta.replayed, true);
  assert.equal(addReplay.data.latestBlueprint.version, project.latestBlueprint.version);
  const reuseConflict = await sendEdit('alice', 'decision-edit-scope-add', {
    ...decisionPayload, decisionMakerRoleId: 'role-founder',
  }, initialVersion, 409);
  assert.equal(reuseConflict.error.code, 'IDEMPOTENCY_CONFLICT');
  const stale = await sendEdit('alice', 'decision-edit-stale', decisionPayload, initialVersion, 409);
  assert.equal(stale.error.code, 'VERSION_CONFLICT');

  const clearPayload = { ...decisionPayload, decisionMakerRoleId: null, decisionScopeIds: [] };
  const cleared = await sendEdit('alice', 'decision-edit-scope-clear', clearPayload, project.version);
  project = cleared.data;
  const clearedDecision = project.latestBlueprint.areas.governanceRiskControls.items.find((item) => item.id === decision.id);
  assert.equal(clearedDecision.by, null);
  assert.deepEqual(clearedDecision.scope, []);
  assert.equal(project.latestBlueprint.relations.some((link) => link.type === 'decides' && link.target === decision.id), false);
  assert.equal(project.latestBlueprint.relations.some((link) => link.type === 'governs' && link.source === decision.id), false);

  await close(app);
  app = await start(postgres.databaseUrl, { oidcAuthenticator });
  project = (await request(app.base, `/api/v1/projects/${project.id}`, as('alice'))).data;
  assert.equal(project.latestBlueprint.areas.governanceRiskControls.items.find((item) => item.id === decision.id).by, null);
  assert.deepEqual(project.blueprintVersions[2].edit.after.decisionScopeNames, []);
  const readded = await sendEdit('alice', 'decision-edit-maker-readd', {
    ...decisionPayload, decisionMakerRoleId: 'role-founder', decisionScopeIds: ['goal-customer-outcome'],
  }, project.version);
  project = readded.data;
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === 'role-founder' && link.target === decision.id && link.type === 'decides'));
  assert.deepEqual(project.latestBlueprint.edit.after.decisionScopeNames, ['Deliver the promised customer outcome']);

  const membershipAfter = await app.persistence.query(`select principal, access, generation, revoked_at
    from orgward.project_memberships where tenant_id='tenant-a' and project_id=$1 order by principal`, [project.id]);
  const rolesAfter = await app.persistence.query(`select principal, roles, authz_generation from orgward.oidc_principals
    where tenant_id='tenant-a' and principal=any($1::text[]) order by principal`, [rolePrincipals]);
  assert.deepEqual(membershipAfter.rows, membershipBefore.rows);
  assert.deepEqual(rolesAfter.rows, rolesBefore.rows);
});

test('strategy goal links save, replace, clear, and survive restart as proposed traceability', async (t) => {
  const postgres = await startPostgres();
  t.after(postgres.close);
  const oidcAuthenticator = testOidcAuthenticator();
  let app = await start(postgres.databaseUrl, { oidcAuthenticator });
  t.after(async () => { if (app) await close(app); });
  const issuer = 'https://persistence-identity.example.test';
  const principal = (subject) => `oidc:${createHash('sha256').update(`${issuer}\n${subject}`).digest('hex')}`;
  const as = (subject) => ({ headers: { authorization: `Bearer ${subject}` } });
  const created = await request(app.base, '/api/v1/projects', {
    ...as('alice'), method: 'POST', body: command('strategy-goals-project', { name: 'Strategy traceability workspace' }),
  }, 201);
  let project = created.data;
  for (const [index, content] of [
    'Independent restaurants need dependable equipment repair.',
    'Customers want fast response, predictable service, and clear records.',
    'Use a subscription with transparent repair costs.',
    'Keep customer commitments and every consequential action human approved.',
  ].entries()) {
    project = (await request(app.base, `/api/v1/projects/${project.id}/messages`, {
      ...as('alice'), method: 'POST', body: command(`strategy-goals-answer-${index + 1}`, { content }, project.version),
    })).data;
  }
  assert.ok(project.latestBlueprint, 'four discovery answers create a saved enterprise design');
  const seededStateResult = await app.persistence.query(`select state from orgward.aggregates
    where tenant_id='tenant-a' and aggregate_kind='project' and aggregate_id=$1`, [project.id]);
  const seededState = seededStateResult.rows[0].state;
  const seededBlueprint = seededState.blueprintVersions.at(-1);
  seededBlueprint.areas.purposeStrategy.items.push({
    id: 'goal-repeat-service', type: 'goal', name: 'Reduce repeat customer disruption',
    detail: 'Restore essential equipment quickly and prevent repeat disruption.', owner: 'role-operations',
    status: 'designed', confidence: 'medium',
    provenance: [{ source: 'test:strategy-goal', note: 'Goal fixture for strategy traceability.' }],
  });
  seededBlueprint.summary.objectCount += 1;
  seededBlueprint.integrity = validateBlueprint(seededBlueprint);
  await app.persistence.query(`update orgward.aggregates set state=$1::jsonb,state_hash=$2
    where tenant_id='tenant-a' and aggregate_kind='project' and aggregate_id=$3`,
  [JSON.stringify(seededState), contentHash(seededState), project.id]);
  project = (await request(app.base, `/api/v1/projects/${project.id}`, as('alice'))).data;

  const strategy = project.latestBlueprint.areas.purposeStrategy.items.find((item) => item.id === 'strategy-focused-launch');
  const route = `/api/v1/projects/${project.id}/blueprint/edits`;
  const sendEdit = (subject, commandId, payload, expectedVersion = project.version, expected = 200) => request(app.base, route, {
    ...as(subject), method: 'POST', body: command(commandId, payload, expectedVersion),
  }, expected);
  await app.persistence.query(`insert into orgward.project_memberships (tenant_id, project_id, principal, access, granted_by)
    values ('tenant-a', $1, $2, 'reader', $3)`, [project.id, principal('readonly'), principal('alice')]);
  const basePayload = {
    objectId: strategy.id, name: strategy.name, detail: strategy.detail, ownerRoleName: 'Founder / enterprise owner',
  };
  const requestedGoals = ['goal-customer-outcome', 'goal-repeat-service'];
  const payload = { ...basePayload, strategyGoalIds: requestedGoals };
  const initialVersion = project.version;
  const readerDenied = await sendEdit('readonly', 'strategy-goals-reader', payload, initialVersion, 403);
  assert.equal(readerDenied.error.code, 'ACTION_FORBIDDEN');
  const crossTenantDenied = await sendEdit('tenant-b-admin', 'strategy-goals-cross-tenant', payload, initialVersion, 404);
  assert.equal(crossTenantDenied.error.code, 'PROJECT_NOT_FOUND');
  const duplicate = await sendEdit('alice', 'strategy-goals-duplicate', {
    ...payload, strategyGoalIds: ['goal-customer-outcome', 'goal-customer-outcome'],
  }, initialVersion, 400);
  assert.equal(duplicate.error.code, 'INVALID_COMMAND');
  const unknown = await sendEdit('alice', 'strategy-goals-unknown', {
    ...payload, strategyGoalIds: ['goal-missing'],
  }, initialVersion, 400);
  assert.equal(unknown.error.code, 'INVALID_BLUEPRINT_RELATION');
  const wrongType = await sendEdit('alice', 'strategy-goals-wrong-type', {
    ...payload, strategyGoalIds: ['system-studio'],
  }, initialVersion, 400);
  assert.equal(wrongType.error.code, 'INVALID_BLUEPRINT_RELATION');
  const process = project.latestBlueprint.areas.capabilitiesProcesses.items.find((item) => item.id === 'process-learn');
  const fieldMisuse = await sendEdit('alice', 'strategy-goals-field-misuse', {
    objectId: process.id, name: process.name, detail: process.detail, ownerRoleName: 'Founder / enterprise owner',
    trigger: process.trigger, strategyGoalIds: [],
  }, initialVersion, 400);
  assert.equal(fieldMisuse.error.code, 'INVALID_BLUEPRINT_EDIT');

  const membershipsBefore = await app.persistence.query(`select principal, access, generation, revoked_at
    from orgward.project_memberships where tenant_id='tenant-a' and project_id=$1 order by principal`, [project.id]);
  const principals = [principal('alice'), principal('readonly')];
  const rolesBefore = await app.persistence.query(`select principal, roles, authz_generation from orgward.oidc_principals
    where tenant_id='tenant-a' and principal=any($1::text[]) order by principal`, [principals]);
  const add = await sendEdit('alice', 'strategy-goals-add', payload, initialVersion);
  project = add.data;
  const edited = project.latestBlueprint.areas.purposeStrategy.items.find((item) => item.id === strategy.id);
  assert.deepEqual(edited.goals, requestedGoals);
  assert.equal(edited.owner, 'role-founder', 'the existing strategy owner remains unchanged');
  assert.deepEqual(project.latestBlueprint.edit.before.strategyGoalNames, []);
  assert.deepEqual(project.latestBlueprint.edit.after.strategyGoalNames, ['Deliver the promised customer outcome', 'Reduce repeat customer disruption']);
  assert.deepEqual(project.latestBlueprint.relations.filter((link) => link.source === strategy.id && link.type === 'supports').map((link) => link.target).sort(), requestedGoals);
  assert.equal(project.latestBlueprint.relations.filter((link) => link.source === strategy.id && link.type === 'supports').length, 2);
  assert.equal(edited.status, 'designed');
  assert.equal(project.latestBlueprint.epistemicStatus, 'proposed-design');
  assert.equal(project.latestBlueprint.relations.some((link) => link.source === strategy.id && link.target === 'goal-customer-outcome' && link.type === 'supports'), true);

  const replay = await sendEdit('alice', 'strategy-goals-add', payload, initialVersion);
  assert.equal(replay.meta.replayed, true);
  const idempotencyConflict = await sendEdit('alice', 'strategy-goals-add', {
    ...payload, strategyGoalIds: ['goal-customer-outcome'],
  }, initialVersion, 409);
  assert.equal(idempotencyConflict.error.code, 'IDEMPOTENCY_CONFLICT');
  const stale = await sendEdit('alice', 'strategy-goals-stale', payload, initialVersion, 409);
  assert.equal(stale.error.code, 'VERSION_CONFLICT');

  const replace = await sendEdit('alice', 'strategy-goals-replace', {
    ...basePayload, strategyGoalIds: ['goal-repeat-service'],
  }, project.version);
  project = replace.data;
  assert.deepEqual(project.latestBlueprint.areas.purposeStrategy.items.find((item) => item.id === strategy.id).goals, ['goal-repeat-service']);
  assert.deepEqual(project.latestBlueprint.relations.filter((link) => link.source === strategy.id && link.type === 'supports').map((link) => link.target), ['goal-repeat-service']);
  assert.deepEqual(project.latestBlueprint.edit.before.strategyGoalNames, ['Deliver the promised customer outcome', 'Reduce repeat customer disruption']);
  assert.deepEqual(project.latestBlueprint.edit.after.strategyGoalNames, ['Reduce repeat customer disruption']);
  const clear = await sendEdit('alice', 'strategy-goals-clear', { ...basePayload, strategyGoalIds: [] }, project.version);
  project = clear.data;
  assert.deepEqual(project.latestBlueprint.areas.purposeStrategy.items.find((item) => item.id === strategy.id).goals, []);
  assert.equal(project.latestBlueprint.relations.some((link) => link.source === strategy.id && link.type === 'supports'), false);

  await close(app);
  app = await start(postgres.databaseUrl, { oidcAuthenticator });
  project = (await request(app.base, `/api/v1/projects/${project.id}`, as('alice'))).data;
  assert.deepEqual(project.latestBlueprint.areas.purposeStrategy.items.find((item) => item.id === strategy.id).goals, []);
  assert.deepEqual(project.blueprintVersions[1].edit.after.strategyGoalNames,
    ['Deliver the promised customer outcome', 'Reduce repeat customer disruption']);
  const readd = await sendEdit('alice', 'strategy-goals-readd', {
    ...basePayload, strategyGoalIds: ['goal-customer-outcome'],
  }, project.version);
  project = readd.data;
  assert.ok(project.latestBlueprint.relations.some((link) => link.source === strategy.id && link.target === 'goal-customer-outcome' && link.type === 'supports'));
  assert.deepEqual(project.latestBlueprint.edit.after.strategyGoalNames, ['Deliver the promised customer outcome']);
  const membershipsAfter = await app.persistence.query(`select principal, access, generation, revoked_at
    from orgward.project_memberships where tenant_id='tenant-a' and project_id=$1 order by principal`, [project.id]);
  const rolesAfter = await app.persistence.query(`select principal, roles, authz_generation from orgward.oidc_principals
    where tenant_id='tenant-a' and principal=any($1::text[]) order by principal`, [principals]);
  assert.deepEqual(membershipsAfter.rows, membershipsBefore.rows);
  assert.deepEqual(rolesAfter.rows, rolesBefore.rows);
});
