import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { createApp } from '../server.mjs';
import { approveExecutionRun, createExecutionRun } from '../src/execution/contracts.mjs';
import { contentHash } from '../src/platform/postgres.mjs';
import { decodeSecretEncryptionKey } from '../src/platform/secrets.mjs';
import { startPostgres } from './helpers/postgres.mjs';

const issuer = 'https://secret-identity.example.test';
const defaultExpiry = new Date(Date.now() + 60 * 60_000).toISOString();

function brokerOperation(operation) {
  return (context) => {
    const result = new Promise((resolve, reject) => setImmediate(() => {
      Promise.resolve().then(() => operation(context)).then(resolve, reject);
    }));
    return { handedOff: Promise.resolve(), result, abort() {} };
  };
}

function principal(subject) {
  return `oidc:${createHash('sha256').update(`${issuer}\n${subject}`).digest('hex')}`;
}

function authenticator() {
  const bindings = new Map([
    ['alice', { subject: 'alice', tenantId: 'tenant-a', actorType: 'human' }],
    ['writer', { subject: 'writer', tenantId: 'tenant-a', actorType: 'human' }],
    ['other-admin', { subject: 'other-admin', tenantId: 'tenant-b', actorType: 'human' }],
  ]);
  return {
    authenticate: async (request) => {
      const binding = bindings.get(String(request.headers.authorization ?? '').slice(7));
      if (!binding) return null;
      return {
        ...binding, issuer, principal: principal(binding.subject), displayName: binding.subject,
        roles: [], expiresAt: Math.floor(Date.now() / 1000) + 300,
      };
    },
  };
}

async function start(databaseUrl, encryptionKey, openAiValidationEndpoint) {
  const app = createApp({ databaseUrl, oidcAuthenticator: authenticator(), secretEncryptionKey: encryptionKey, ...(openAiValidationEndpoint ? { openAiValidationEndpoint } : {}) });
  await app.init();
  for (const [subject, tenantId, roles] of [
    ['alice', 'tenant-a', ['tenant-admin', 'workspace-read', 'workspace-write', 'execution-approver']],
    ['writer', 'tenant-a', ['workspace-read', 'workspace-write']],
    ['other-admin', 'tenant-b', ['tenant-admin', 'workspace-read', 'workspace-write']],
  ]) {
    await app.persistence.query(`
      insert into orgward.oidc_principals (principal, issuer, tenant_id, actor_type, roles, display_name)
      values ($1, $2, $3, 'human', $4::text[], $5)
      on conflict (tenant_id, principal) do update set roles = excluded.roles
    `, [principal(subject), issuer, tenantId, roles, subject]);
  }
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  return app;
}

async function insertCredentialLease(app, credentialVersion = 1) {
  const tenantId = 'tenant-a';
  const approver = principal('alice');
  const worker = principal('writer');
  const projectId = `project-${randomUUID()}`;
  const runId = `execution-run-${randomUUID()}`;
  const workerId = randomUUID();
  const project = { id: projectId, tenantId, version: 1, createdBy: approver, updatedBy: approver, updatedAt: new Date().toISOString() };
  await app.persistence.query(`
    insert into orgward.aggregates (tenant_id, aggregate_kind, aggregate_id, version, state, state_hash, updated_at)
    values ($1, 'project', $2, $3, $4::jsonb, $5, $6)
  `, [tenantId, projectId, project.version, JSON.stringify(project), contentHash(project), project.updatedAt]);
  for (const member of [approver, worker]) {
    await app.persistence.query(`
      insert into orgward.project_memberships (tenant_id, project_id, principal, access, granted_by)
      values ($1, $2, $3, 'editor', $4)
    `, [tenantId, projectId, member, approver]);
  }
  const actor = await app.persistence.query('select authz_generation from orgward.oidc_principals where tenant_id = $1 and principal = $2', [tenantId, approver]);
  const run = createExecutionRun({
    tenantId, projectId, profile: {
      id: 'provider-bound', label: 'Provider bound', kind: 'provider', version: '1.0.0',
      credentialReference: 'secret-provider-a', credentialVersion,
    },
    requestedBy: worker, title: 'Provider task', objective: 'Use the configured provider',
  });
  run.id = runId;
  approveExecutionRun(run, { principal: approver, roles: ['execution-approver'], authorityGeneration: Number(actor.rows[0].authz_generation) });
  run.approval.projectMembershipGeneration = 1;
  run.status = 'RUNNING'; run.version += 1;
  await app.persistence.query(`
    insert into orgward.aggregates (tenant_id, aggregate_kind, aggregate_id, version, state, state_hash, updated_at)
    values ($1, 'execution_run', $2, $3, $4::jsonb, $5, $6)
  `, [tenantId, runId, run.version, JSON.stringify(run), contentHash(run), run.updatedAt]);
  await app.persistence.query(`
    insert into orgward.aggregate_project_scopes (tenant_id, aggregate_kind, aggregate_id, project_id)
    values ($1, 'execution_run', $2, $3)
  `, [tenantId, runId, projectId]);
  await app.persistence.query(`
    insert into orgward.execution_worker_leases (tenant_id, run_id, project_id, principal, worker_id, lease_until)
    values ($1, $2, $3, $4, $5, now() + interval '1 minute')
  `, [tenantId, runId, projectId, worker, workerId]);
  const workerAuthority = await app.persistence.query('select authz_generation from orgward.oidc_principals where tenant_id = $1 and principal = $2', [tenantId, worker]);
  return { tenantId, projectId, runId, workerId, principal: worker, authzGeneration: Number(workerAuthority.rows[0].authz_generation) };
}

async function close(app) {
  await new Promise((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
  await app.close();
}

async function send(app, path, subject, { method = 'GET', body } = {}) {
  return fetch(`http://127.0.0.1:${app.server.address().port}${path}`, {
    method,
    headers: { authorization: `Bearer ${subject}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function rotateBody(commandId, expectedVersion, value, reason = 'Configure provider access', expiresAt = defaultExpiry) {
  return { schemaVersion: '1.0', commandId, expectedVersion, payload: { value, reason, expiresAt } };
}

test('secret encryption key configuration accepts only canonical base64 32-byte keys', () => {
  const key = Buffer.alloc(32, 7);
  assert.deepEqual(decodeSecretEncryptionKey(key.toString('base64')), key);
  assert.equal(decodeSecretEncryptionKey(undefined), null);
  assert.throws(() => decodeSecretEncryptionKey('not-a-key'), /canonical base64/);
  assert.throws(() => decodeSecretEncryptionKey(Buffer.alloc(31).toString('base64')), /32-byte/);
});

test('tenant administrators manage encrypted credential references with rotation, isolation, and restart recovery', async (t) => {
  const postgres = await startPostgres();
  const encryptionKey = Buffer.alloc(32, 0x5a);
  let app = await start(postgres.databaseUrl, encryptionKey);
  t.after(async () => { if (app) await close(app); await postgres.close(); });

  const denied = await send(app, '/api/v1/secrets', 'writer');
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, 'ACTION_FORBIDDEN');
  const forged = await send(app, '/api/v1/secrets/secret-provider-a', 'alice', {
    method: 'PUT', body: { ...rotateBody('secret-forged', 0, 'secret-canary-rotate-001'), actor: principal('alice') },
  });
  assert.equal(forged.status, 400);
  assert.equal((await forged.json()).error.code, 'CALLER_AUTHORITY_NOT_ALLOWED');

  const initial = await send(app, '/api/v1/secrets', 'alice');
  assert.equal(initial.status, 200);
  assert.deepEqual((await initial.json()).data, []);
  const canary = 'secret-canary-rotate-001';
  for (const [commandId, expiry] of [['secret-expiry-missing', null], ['secret-expiry-past', new Date(Date.now() - 60_000).toISOString()]]) {
    const invalidExpiry = await send(app, '/api/v1/secrets/secret-invalid-expiry', 'alice', {
      method: 'PUT', body: rotateBody(commandId, 0, 'secret-invalid-expiry-001', 'Invalid expiry', expiry),
    });
    assert.equal(invalidExpiry.status, 400);
    assert.equal((await invalidExpiry.json()).error.code, 'INVALID_CREDENTIAL_EXPIRY');
  }
  const created = await send(app, '/api/v1/secrets/secret-provider-a', 'alice', {
    method: 'PUT', body: rotateBody('secret-create-a', 0, canary),
  });
  assert.equal(created.status, 200);
  const createdBody = await created.json();
  assert.equal(createdBody.data.version, 1);
  assert.equal(createdBody.data.status, 'active');
  assert.equal(typeof createdBody.data.expiresAt, 'string');
  assert.equal(JSON.stringify(createdBody).includes(canary), false);

  const lease = await insertCredentialLease(app);
  await app.persistence.query(`update orgward.secret_references set expires_at = null where tenant_id = 'tenant-a' and reference = 'secret-provider-a'`);
  await assert.rejects(app.secretStore.useForAuthorizedLease({ ...lease, reference: 'secret-provider-a', expectedVersion: 1, operation: async () => 'must fail closed' }), { code: 'SECRET_CREDENTIAL_EXPIRED' });
  await app.persistence.query(`update orgward.secret_references set expires_at = clock_timestamp() + interval '1 hour' where tenant_id = 'tenant-a' and reference = 'secret-provider-a'`);
  const providerUse = await app.secretStore.useForAuthorizedLease({
    ...lease, reference: 'secret-provider-a', expectedVersion: 1,
    operation: brokerOperation(async ({ credential, reference, version }) => ({ provider: 'fixture', accepted: credential === canary, reference, version })),
  });
  assert.deepEqual(providerUse, { provider: 'fixture', accepted: true, reference: 'secret-provider-a', version: 1 });
  await app.persistence.query(`update orgward.secret_references set expires_at = clock_timestamp() + interval '100 milliseconds' where tenant_id = 'tenant-a' and reference = 'secret-provider-a'`);
  let expiryAbortObserved = false;
  const expiryLease = await insertCredentialLease(app);
  await assert.rejects(app.secretStore.useForAuthorizedLease({
    ...expiryLease, reference: 'secret-provider-a', expectedVersion: 1,
    operation: brokerOperation(async ({ signal }) => new Promise((resolve) => {
      signal.addEventListener('abort', () => { expiryAbortObserved = true; resolve('late result'); }, { once: true });
    })),
  }), { code: 'SECRET_CREDENTIAL_EXPIRED' });
  assert.equal(expiryAbortObserved, true);
  await app.persistence.query(`update orgward.secret_references set expires_at = clock_timestamp() + interval '1 hour' where tenant_id = 'tenant-a' and reference = 'secret-provider-a'`);
  await assert.rejects(app.secretStore.useForAuthorizedLease({
    tenantId: 'tenant-b', reference: 'secret-provider-a', expectedVersion: 1,
    authorizeLease: async () => ({ active: true, tenantId: 'tenant-b' }), operation: brokerOperation(async () => 'should not run'),
  }), { code: 'WORKER_LEASE_INVALID' });
  await assert.rejects(app.secretStore.useForAuthorizedLease({
    ...await insertCredentialLease(app), reference: 'secret-provider-a', expectedVersion: 1,
    operation: brokerOperation(async ({ credential }) => ({ diagnostic: credential })),
  }), { code: 'PROVIDER_OUTPUT_QUARANTINED' });
  await assert.rejects(app.secretStore.useForAuthorizedLease({
    ...await insertCredentialLease(app), reference: 'secret-provider-a', expectedVersion: 1,
    operation: brokerOperation(async () => { throw new Error(`adapter logged ${canary}`); }),
  }), (error) => error.code === 'PROVIDER_OUTCOME_UNKNOWN' && !error.message.includes(canary));
  assert.equal(await app.secretStore.useForAuthorizedLease({
    ...await insertCredentialLease(app), reference: 'secret-provider-a', expectedVersion: 1,
    authorizeLease: async () => ({ active: true, tenantId: 'tenant-a' }), operation: brokerOperation(async () => 'forged callback ignored'),
  }), 'forged callback ignored');

  await app.persistence.query(`update orgward.secret_references set expires_at = clock_timestamp() - interval '1 second' where tenant_id = 'tenant-a' and reference = 'secret-provider-a'`);
  const replay = await send(app, '/api/v1/secrets/secret-provider-a', 'alice', {
    method: 'PUT', body: rotateBody('secret-create-a', 0, canary),
  });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).meta.replayed, true);
  await app.persistence.query(`update orgward.secret_references set expires_at = clock_timestamp() + interval '1 hour' where tenant_id = 'tenant-a' and reference = 'secret-provider-a'`);
  const reusedCommand = await send(app, '/api/v1/secrets/secret-provider-a', 'alice', {
    method: 'PUT', body: rotateBody('secret-create-a', 0, 'secret-canary-different-999'),
  });
  assert.equal(reusedCommand.status, 409);
  assert.equal((await reusedCommand.json()).error.code, 'IDEMPOTENCY_CONFLICT');

  const stored = await app.persistence.query(`
    select version, status, ciphertext, nonce, auth_tag from orgward.secret_references
    where tenant_id = 'tenant-a' and reference = 'secret-provider-a'
  `);
  assert.equal(stored.rows[0].version, 1);
  assert.equal(stored.rows[0].status, 'active');
  assert.notEqual(stored.rows[0].ciphertext.toString('utf8'), canary);
  assert.equal(stored.rows[0].ciphertext.includes(Buffer.from(canary)), false);
  assert.equal(stored.rows[0].nonce.length, 12);
  assert.equal(stored.rows[0].auth_tag.length, 16);
  const audit = await app.persistence.query(`
    select event::text from orgward.secret_reference_events
    where tenant_id = 'tenant-a' and reference = 'secret-provider-a'
  `);
  assert.equal(JSON.stringify(audit.rows).includes(canary), false);
  const listed = await send(app, '/api/v1/secrets', 'alice');
  assert.equal(JSON.stringify(await listed.json()).includes(canary), false);
  const crossTenantList = await send(app, '/api/v1/secrets', 'other-admin');
  assert.equal(crossTenantList.status, 200);
  assert.deepEqual((await crossTenantList.json()).data, []);
  const crossTenantRevoke = await send(app, '/api/v1/secrets/secret-provider-a/revoke', 'other-admin', {
    method: 'POST', body: { schemaVersion: '1.0', commandId: 'secret-cross-tenant-revoke', expectedVersion: 1, payload: { reason: 'Cross-tenant denial' } },
  });
  assert.equal(crossTenantRevoke.status, 404);

  await close(app); app = await start(postgres.databaseUrl, encryptionKey);
  const afterRestart = await send(app, '/api/v1/secrets', 'alice');
  assert.equal(afterRestart.status, 200);
  assert.deepEqual((await afterRestart.json()).data.map(({ reference, version, status }) => ({ reference, version, status })), [
    { reference: 'secret-provider-a', version: 1, status: 'active' },
  ]);

  const staleRotation = await send(app, '/api/v1/secrets/secret-provider-a', 'alice', {
    method: 'PUT', body: rotateBody('secret-stale-rotation', 0, 'secret-canary-rotate-002'),
  });
  assert.equal(staleRotation.status, 409);
  assert.equal((await staleRotation.json()).error.code, 'VERSION_CONFLICT');

  let secondInstance = await start(postgres.databaseUrl, encryptionKey);
  secondInstance.secretStore.onCredentialInvalidated = () => { throw new Error('The local worker notifier is unavailable.'); };
  const competing = await Promise.all([
    send(secondInstance, '/api/v1/secrets/secret-provider-a', 'alice', { method: 'PUT', body: rotateBody('secret-rotation-b', 1, 'secret-canary-rotate-002') }),
    send(secondInstance, '/api/v1/secrets/secret-provider-a', 'alice', { method: 'PUT', body: rotateBody('secret-rotation-c', 1, 'secret-canary-rotate-003') }),
  ]);
  await close(secondInstance); secondInstance = null;
  assert.deepEqual(competing.map((response) => response.status).sort(), [200, 409]);
  const rotated = await send(app, '/api/v1/secrets', 'alice');
  const rotatedRecord = (await rotated.json()).data[0];
  assert.equal(rotatedRecord.version, 2);
  assert.equal(rotatedRecord.status, 'active');
  const cancelledLease = await app.persistence.query('select cancel_reason from orgward.execution_worker_leases where tenant_id = $1 and run_id = $2', [lease.tenantId, lease.runId]);
  assert.equal(cancelledLease.rows[0].cancel_reason, 'credential_rotated');
  const leaseV2DuringUse = await insertCredentialLease(app, 2);
  const adminAuthority = await app.persistence.query('select authz_generation from orgward.oidc_principals where tenant_id = $1 and principal = $2', ['tenant-a', principal('alice')]);
  await assert.rejects(app.secretStore.useForAuthorizedLease({
    ...leaseV2DuringUse, reference: 'secret-provider-a', expectedVersion: 2,
    operation: brokerOperation(async () => {
      await app.secretStore.put({
        tenantId: 'tenant-a', actor: principal('alice'), actorAuthzGeneration: Number(adminAuthority.rows[0].authz_generation),
        reference: 'secret-provider-a', commandId: 'secret-rotation-during-provider-use', expectedVersion: 2,
        value: 'secret-canary-rotate-003', reason: 'Rotate during provider use', expiresAt: defaultExpiry,
      });
      return { accepted: true };
    }),
  }), { code: 'SECRET_GENERATION_STALE' });
  const cancelledDuringUse = await app.persistence.query('select cancel_reason from orgward.execution_worker_leases where tenant_id = $1 and run_id = $2', [leaseV2DuringUse.tenantId, leaseV2DuringUse.runId]);
  assert.equal(cancelledDuringUse.rows[0].cancel_reason, 'credential_rotated');
  const leaseV3 = await insertCredentialLease(app, 3);
  await assert.rejects(app.secretStore.useForAuthorizedLease({
    ...lease, reference: 'secret-provider-a', expectedVersion: 1,
    operation: async () => 'should not run',
  }), { code: 'SECRET_GENERATION_STALE' });

  await close(app); app = await start(postgres.databaseUrl, null);
  const noKeyList = await send(app, '/api/v1/secrets', 'alice');
  assert.equal((await noKeyList.json()).data[0].encryptionAvailable, false);
  const noKeyRotation = await send(app, '/api/v1/secrets/secret-provider-a', 'alice', {
    method: 'PUT', body: rotateBody('secret-no-key', 3, 'secret-canary-rotate-004'),
  });
  assert.equal(noKeyRotation.status, 503);
  assert.equal((await noKeyRotation.json()).error.code, 'SECRET_ENCRYPTION_UNAVAILABLE');

  const revoke = await send(app, '/api/v1/secrets/secret-provider-a/revoke', 'alice', {
    method: 'POST', body: { schemaVersion: '1.0', commandId: 'secret-revoke-a', expectedVersion: 3, payload: { reason: 'Retiring secret-canary-rotate-003' } },
  });
  assert.equal(revoke.status, 200);
  const revokeBody = await revoke.json();
  assert.equal(revokeBody.data.status, 'revoked');
  assert.equal(revokeBody.data.version, 4);
  assert.equal(JSON.stringify(revokeBody).includes('secret-canary'), false);
  const noKeyRevokeEvent = await app.persistence.query(`select reason,event::text as event from orgward.secret_reference_events where tenant_id='tenant-a' and reference='secret-provider-a' order by version desc limit 1`);
  assert.equal(noKeyRevokeEvent.rows[0].reason, 'reason_unverified_redacted');
  assert.equal(noKeyRevokeEvent.rows[0].event.includes('secret-canary-rotate-003'), false);
  const erased = await app.persistence.query(`
    select version, status, ciphertext, nonce, auth_tag from orgward.secret_references
    where tenant_id = 'tenant-a' and reference = 'secret-provider-a'
  `);
  assert.equal(erased.rows[0].status, 'revoked');
  assert.equal(erased.rows[0].version, 4);
  assert.equal(erased.rows[0].ciphertext, null);
  assert.equal(erased.rows[0].nonce, null);
  assert.equal(erased.rows[0].auth_tag, null);
  const revokedLease = await app.persistence.query('select cancel_reason from orgward.execution_worker_leases where tenant_id = $1 and run_id = $2', [leaseV3.tenantId, leaseV3.runId]);
  assert.equal(revokedLease.rows[0].cancel_reason, 'credential_revoked');
  await assert.rejects(app.secretStore.useForAuthorizedLease({
    ...lease, reference: 'secret-provider-a', expectedVersion: 3,
    operation: async () => 'should not run',
  }), { code: 'SECRET_ENCRYPTION_UNAVAILABLE' });
  await close(app); app = await start(postgres.databaseUrl, encryptionKey);
  await assert.rejects(app.secretStore.useForAuthorizedLease({
    ...lease, reference: 'secret-provider-a', expectedVersion: 3,
    operation: async () => 'should not run',
  }), { code: 'SECRET_REFERENCE_INACTIVE' });

  const ui = await fetch(`http://127.0.0.1:${app.server.address().port}/platform.js`);
  assert.equal(ui.status, 200);
  const source = await ui.text();
  assert.match(source, /Provider credentials/);
  assert.match(source, /type="password"/);
  assert.match(source, /Generic fixed-version provider credential/);
});

test('OpenAI candidate validation stages encrypted key, denies cross-tenant access, and activates with explicit unconfirmed revocation state', async (t) => {
  const postgres = await startPostgres();
  let seen;
  let validationUnavailable = false;
  const fixture = await new Promise((resolve) => {
    const server = createServer(async (request, response) => {
      seen = { url: request.url, authorization: request.headers.authorization };
      for await (const _chunk of request) { /* validation sends no body */ }
      if (validationUnavailable) { response.writeHead(503); response.end('fixture outage'); return; }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: 'gpt-fixture' }));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
  const key = Buffer.alloc(32, 0x3a), canary = 'sk-fixture-canary-875';
  let app = await start(postgres.databaseUrl, key, `http://127.0.0.1:${fixture.address().port}/v1/models`);
  t.after(async () => { if (app) await close(app); await new Promise((resolve) => fixture.close(resolve)); await postgres.close(); });
  const stage = await send(app, '/api/v1/secrets/secret-openai/openai-candidate', 'alice', { method: 'PUT', body: {
    schemaVersion: '1.0', commandId: 'openai-stage-1', expectedVersion: 0,
    payload: { value: canary, model: 'gpt-fixture', reason: 'Validate OpenAI access', expiresAt: defaultExpiry },
  } });
  assert.equal(stage.status, 200, JSON.stringify(await stage.clone().json()));
  const staged = await stage.json();
  assert.equal(staged.data.candidateStatus, 'staged');
  const crossTenant = await send(app, '/api/v1/secrets/secret-openai/openai-candidate/validate', 'other-admin', { method: 'POST', body: { schemaVersion: '1.0', commandId: 'openai-cross-validate', expectedVersion: 0, payload: { candidateVersion: 1 } } });
  assert.equal(crossTenant.status, 409);
  const validation = await send(app, '/api/v1/secrets/secret-openai/openai-candidate/validate', 'alice', { method: 'POST', body: { schemaVersion: '1.0', commandId: 'openai-validate-1', expectedVersion: 0, payload: { candidateVersion: 1 } } });
  assert.equal(validation.status, 200, JSON.stringify(await validation.clone().json()));
  assert.equal((await validation.json()).data.candidateStatus, 'validated');
  assert.equal(seen.url, '/v1/models/gpt-fixture');
  assert.equal(seen.authorization, `Bearer ${canary}`);
  const stagedDb = await app.persistence.query(`select version,status,candidate_status,candidate_ciphertext from orgward.secret_references where tenant_id='tenant-a' and reference='secret-openai'`);
  assert.equal(stagedDb.rows[0].version, 0);
  assert.equal(stagedDb.rows[0].status, 'revoked');
  assert.equal(stagedDb.rows[0].candidate_status, 'validated');
  assert.equal(stagedDb.rows[0].candidate_ciphertext.includes(Buffer.from(canary)), false);
  await app.persistence.query(`update orgward.secret_references set candidate_validated_at=clock_timestamp()-interval '16 minutes' where tenant_id='tenant-a' and reference='secret-openai'`);
  const staleValidation = await send(app, '/api/v1/secrets/secret-openai/openai-candidate/activate', 'alice', { method: 'POST', body: { schemaVersion: '1.0', commandId: 'openai-activate-stale-validation', expectedVersion: 0, payload: { candidateVersion: 1, reason: 'Activate stale validation' } } });
  assert.equal(staleValidation.status, 409);
  assert.equal((await staleValidation.json()).error.code, 'CANDIDATE_VALIDATION_STALE');
  const refreshedValidation = await send(app, '/api/v1/secrets/secret-openai/openai-candidate/validate', 'alice', { method: 'POST', body: { schemaVersion: '1.0', commandId: 'openai-validate-refresh', expectedVersion: 0, payload: { candidateVersion: 1 } } });
  assert.equal(refreshedValidation.status, 200);
  validationUnavailable = true;
  const unavailable = await send(app, '/api/v1/secrets/secret-openai/openai-candidate/validate', 'alice', { method: 'POST', body: { schemaVersion: '1.0', commandId: 'openai-validate-retry', expectedVersion: 0, payload: { candidateVersion: 1 } } });
  assert.equal(unavailable.status, 503);
  const retained = await app.persistence.query(`select candidate_status from orgward.secret_references where tenant_id='tenant-a' and reference='secret-openai'`);
  assert.equal(retained.rows[0].candidate_status, 'validated');
  validationUnavailable = false;
  const activated = await send(app, '/api/v1/secrets/secret-openai/openai-candidate/activate', 'alice', { method: 'POST', body: { schemaVersion: '1.0', commandId: 'openai-activate-1', expectedVersion: 0, payload: { candidateVersion: 1, reason: 'Activate validated key' } } });
  assert.equal(activated.status, 200, JSON.stringify(await activated.clone().json()));
  assert.deepEqual((await activated.json()).data, { reference: 'secret-openai', version: 1, status: 'active', model: 'gpt-fixture', provider: 'openai', upstreamRevocationStatus: 'not_applicable', encryptionAvailable: true, replayed: false });
  const replay = await send(app, '/api/v1/secrets/secret-openai/openai-candidate/activate', 'alice', { method: 'POST', body: { schemaVersion: '1.0', commandId: 'openai-activate-1', expectedVersion: 0, payload: { candidateVersion: 1, reason: 'Activate validated key' } } });
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get('content-type').includes('application/json'), true);
  assert.equal((await replay.json()).meta.replayed, true);
  const activeDb = await app.persistence.query(`select ciphertext,active_provider,active_model from orgward.secret_references where tenant_id='tenant-a' and reference='secret-openai'`);
  assert.equal(activeDb.rows[0].active_provider, 'openai');
  assert.equal(activeDb.rows[0].active_model, 'gpt-fixture');
  assert.equal(activeDb.rows[0].ciphertext.includes(Buffer.from(canary)), false);
  const openAiAudit = await app.persistence.query(`select event::text from orgward.secret_reference_events where tenant_id='tenant-a' and reference='secret-openai'`);
  assert.equal(JSON.stringify(openAiAudit.rows).includes(canary), false);
  assert.equal((await app.persistence.query(`select count(*)::int as count from orgward.secret_upstream_revocation_obligations where tenant_id='tenant-a' and reference='secret-openai'`)).rows[0].count, 0);
  const nextStage = await send(app, '/api/v1/secrets/secret-openai/openai-candidate', 'alice', { method: 'PUT', body: { schemaVersion: '1.0', commandId: 'openai-stage-next', expectedVersion: 1, payload: { value: 'sk-fixture-next-generation', model: 'gpt-fixture', reason: 'Stage a later key', expiresAt: defaultExpiry } } });
  assert.equal(nextStage.status, 200, JSON.stringify(await nextStage.clone().json()));
  assert.equal((await nextStage.json()).data.candidateVersion, 2);
  const staleCandidate = await send(app, '/api/v1/secrets/secret-openai/openai-candidate/validate', 'alice', { method: 'POST', body: { schemaVersion: '1.0', commandId: 'openai-stale-candidate', expectedVersion: 1, payload: { candidateVersion: 1 } } });
  assert.equal(staleCandidate.status, 409);
  const validateSecond = await send(app, '/api/v1/secrets/secret-openai/openai-candidate/validate', 'alice', { method: 'POST', body: { schemaVersion: '1.0', commandId: 'openai-validate-second', expectedVersion: 1, payload: { candidateVersion: 2 } } });
  assert.equal(validateSecond.status, 200);
  const activateSecond = await send(app, '/api/v1/secrets/secret-openai/openai-candidate/activate', 'alice', { method: 'POST', body: { schemaVersion: '1.0', commandId: 'openai-activate-second', expectedVersion: 1, payload: { candidateVersion: 2, reason: 'Activate second generation' } } });
  assert.equal(activateSecond.status, 200, JSON.stringify(await activateSecond.clone().json()));
  const next2 = await send(app, '/api/v1/secrets/secret-openai/openai-candidate', 'alice', { method: 'PUT', body: { schemaVersion: '1.0', commandId: 'openai-stage-third', expectedVersion: 2, payload: { value: 'sk-fixture-third-generation', model: 'gpt-fixture', reason: 'Stage third key', expiresAt: defaultExpiry } } });
  assert.equal(next2.status, 200);
  const validateThird = await send(app, '/api/v1/secrets/secret-openai/openai-candidate/validate', 'alice', { method: 'POST', body: { schemaVersion: '1.0', commandId: 'openai-validate-third', expectedVersion: 2, payload: { candidateVersion: 3 } } });
  assert.equal(validateThird.status, 200);
  const activateThird = await send(app, '/api/v1/secrets/secret-openai/openai-candidate/activate', 'alice', { method: 'POST', body: { schemaVersion: '1.0', commandId: 'openai-activate-third', expectedVersion: 2, payload: { candidateVersion: 3, reason: 'Activate third generation' } } });
  assert.equal(activateThird.status, 200);
  const obligations = await app.persistence.query(`select credential_version,status from orgward.secret_upstream_revocation_obligations where tenant_id='tenant-a' and reference='secret-openai' order by credential_version`);
  assert.deepEqual(obligations.rows, [{ credential_version: 1, status: 'unconfirmed' }, { credential_version: 2, status: 'unconfirmed' }]);
  const listed = await send(app, '/api/v1/secrets', 'alice');
  assert.equal(JSON.stringify(await listed.json()).includes(canary), false);
  await close(app); app = await start(postgres.databaseUrl, key, `http://127.0.0.1:${fixture.address().port}/v1/models`);
  const afterRestart = await send(app, '/api/v1/secrets', 'alice');
  const record = (await afterRestart.json()).data.find((entry) => entry.reference === 'secret-openai');
  assert.equal(record.version, 3);
  assert.equal(record.upstreamRevocationStatus, 'unconfirmed');
  assert.deepEqual(record.upstreamRevocations.map(({ credentialVersion, status }) => ({ credentialVersion, status })), [
    { credentialVersion: 1, status: 'unconfirmed' }, { credentialVersion: 2, status: 'unconfirmed' },
  ]);
  const stagedFourth = await send(app, '/api/v1/secrets/secret-openai/openai-candidate', 'alice', { method: 'PUT', body: { schemaVersion: '1.0', commandId: 'openai-stage-fourth', expectedVersion: 3, payload: { value: 'sk-fixture-fourth-generation', model: 'gpt-fixture', reason: 'Stage fourth key', expiresAt: defaultExpiry } } });
  assert.equal(stagedFourth.status, 200);
  const sensitiveRevoke = await send(app, '/api/v1/secrets/secret-openai/revoke', 'alice', { method: 'POST', body: { schemaVersion: '1.0', commandId: 'openai-revoke-sensitive-reason', expectedVersion: 3, payload: { reason: 'Retire sk-fixture-third-generation and sk-fixture-fourth-generation' } } });
  assert.equal(sensitiveRevoke.status, 200, JSON.stringify(await sensitiveRevoke.clone().json()));
  const sensitiveBody = await sensitiveRevoke.json();
  assert.equal(JSON.stringify(sensitiveBody).includes('sk-fixture-third-generation'), false);
  assert.equal(JSON.stringify(sensitiveBody).includes('sk-fixture-fourth-generation'), false);
  const sensitiveEvent = await app.persistence.query(`select reason,event::text as event from orgward.secret_reference_events where tenant_id='tenant-a' and reference='secret-openai' order by version desc limit 1`);
  assert.equal(sensitiveEvent.rows[0].reason, 'redacted_sensitive_reason');
  assert.equal(sensitiveEvent.rows[0].event.includes('sk-fixture-third-generation'), false);
  assert.equal(sensitiveEvent.rows[0].event.includes('sk-fixture-fourth-generation'), false);
  const cleared = await app.persistence.query(`select ciphertext,candidate_ciphertext from orgward.secret_references where tenant_id='tenant-a' and reference='secret-openai'`);
  assert.equal(cleared.rows[0].ciphertext, null);
  assert.equal(cleared.rows[0].candidate_ciphertext, null);
  const corruptCreate = await send(app, '/api/v1/secrets/secret-corrupt-envelope', 'alice', { method: 'PUT', body: rotateBody('corrupt-envelope-create', 0, 'sk-fixture-corrupt-envelope') });
  assert.equal(corruptCreate.status, 200);
  const originalEnvelope = await app.persistence.query(`select ciphertext,nonce,auth_tag from orgward.secret_references where tenant_id='tenant-a' and reference='secret-corrupt-envelope'`);
  const constraint = await app.persistence.query(`select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='orgward.secret_references'::regclass and conname='secret_references_check'`);
  assert.ok(constraint.rows[0]?.definition);
  // Simulate legacy/corrupt storage that the normal active-row CHECK prevents.
  await app.persistence.query(`alter table orgward.secret_references drop constraint secret_references_check`);
  try {
    await app.persistence.query(`update orgward.secret_references set ciphertext=null,nonce=null,auth_tag=null where tenant_id='tenant-a' and reference='secret-corrupt-envelope'`);
    const corruptRevoke = await send(app, '/api/v1/secrets/secret-corrupt-envelope/revoke', 'alice', { method: 'POST', body: { schemaVersion: '1.0', commandId: 'corrupt-envelope-revoke', expectedVersion: 1, payload: { reason: 'Retire sk-fixture-corrupt-envelope' } } });
    assert.equal(corruptRevoke.status, 200);
    assert.equal(JSON.stringify(await corruptRevoke.json()).includes('sk-fixture-corrupt-envelope'), false);
    const corruptEvent = await app.persistence.query(`select reason,event::text as event from orgward.secret_reference_events where tenant_id='tenant-a' and reference='secret-corrupt-envelope' order by version desc limit 1`);
    assert.equal(corruptEvent.rows[0].reason, 'reason_unverified_redacted');
    assert.equal(corruptEvent.rows[0].event.includes('sk-fixture-corrupt-envelope'), false);
  } finally {
    await app.persistence.query(`update orgward.secret_references set ciphertext=$3,nonce=$4,auth_tag=$5 where tenant_id=$1 and reference=$2 and status='active' and ciphertext is null`, ['tenant-a', 'secret-corrupt-envelope', originalEnvelope.rows[0].ciphertext, originalEnvelope.rows[0].nonce, originalEnvelope.rows[0].auth_tag]);
    await app.persistence.query(`alter table orgward.secret_references add constraint secret_references_check ${constraint.rows[0].definition}`);
  }
});
