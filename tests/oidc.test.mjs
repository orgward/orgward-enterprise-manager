import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { OidcAuthenticator } from '../src/platform/oidc.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' };
const issuer = 'https://identity.example.test';
const alicePrincipal = `oidc:${createHash('sha256').update(`${issuer}\nalice`).digest('hex')}`;
const localRoleGrants = new Map([
  ['tenant-a\nalice', ['workspace-read', 'workspace-write']],
  ['tenant-b\nalice', ['workspace-read', 'workspace-write']],
  ['tenant-a\nmapped-user', ['workspace-read', 'workspace-write']],
  ['tenant-a\nbob', ['workspace-read', 'workspace-write']],
  ['tenant-a\nread-only-user', ['workspace-read']],
]);

function testLocalRoleAuthority() {
  return {
    async get() { return null; },
    async resolve(identity) {
      const key = `${identity.tenantId}\n${identity.subject}`;
      return Object.freeze({
        ...identity,
        roles: Object.freeze([...(localRoleGrants.get(key) ?? [])]),
        authzGeneration: 1,
      });
    },
  };
}

function token(claimOverrides = {}, headerOverrides = {}, nowMs = Date.now()) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key', ...headerOverrides })).toString('base64url');
  const nowSeconds = Math.floor(nowMs / 1000);
  const claims = Buffer.from(JSON.stringify({
    iss: issuer, aud: 'orgward-api', sub: 'alice', iat: nowSeconds, exp: nowSeconds + 300,
    orgward_tenant: 'tenant-a', groups: ['studio-editors'], ...claimOverrides,
  })).toString('base64url');
  const content = `${header}.${claims}`;
  return `${content}.${sign('RSA-SHA256', Buffer.from(content), privateKey).toString('base64url')}`;
}

function authenticator({ clock } = {}) {
  return new OidcAuthenticator({
    issuer, audience: 'orgward-api', jwksUri: `${issuer}/.well-known/jwks.json`,
    roleMap: { 'studio-editors': ['workspace-write'], 'release-owners': ['release-approver', 'control-owner'] },
    tenantBindings: { 'tenant-a': 'tenant-a', 'tenant-b': 'tenant-b', 'provider-org-green': 'tenant-a' },
    fetchImpl: async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ...(clock ? { clock } : {}),
  });
}

function adaptFileBackedAuthorityForTests(app) {
  // These fixtures check route scoping without exercising transaction or
  // revocation races; they are not production authorization fences.
  app.store.listWithPrincipalAuthority = async ({ tenantId, principal, operation }) => {
    const records = await app.store.listForPrincipal(tenantId, principal);
    return operation({ records, corruptRecords: 0 });
  };
  app.store.getWithPrincipalAuthority = async ({ id, tenantId, principal, operation }) => {
    const record = await app.store.getForPrincipal(id, tenantId, principal);
    return record ? operation(record) : null;
  };
  app.sdlcStore.listWithPrincipalAuthority = async ({ tenantId, principal, operation }) => {
    const records = await app.sdlcStore.listForPrincipal(tenantId, principal);
    return operation({ records, corruptRecords: 0 });
  };
  app.sdlcStore.withPrincipalAuthority = async ({ id, tenantId, principal, operation }) => {
    const record = await app.sdlcStore.getForPrincipal(id, tenantId, principal);
    return record ? operation(record) : null;
  };
  const executionStore = app.executionService.store;
  executionStore.listWithPrincipalAuthority = async ({ tenantId, principal, operation }) => {
    const records = await executionStore.listForPrincipal(tenantId, principal);
    return operation({ records, corruptRecords: 0 });
  };
  executionStore.withPrincipalAuthority = async ({ id, tenantId, principal, operation }) => {
    const record = await executionStore.getForPrincipal(id, tenantId, principal);
    return record ? operation(record) : null;
  };
}

async function api(t, oidcAuthenticator, { executionProfiles = [] } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orgward-oidc-'));
  const app = createApp({
    dataDirectory: path.join(root, 'projects'), sdlcDirectory: path.join(root, 'sdlc'),
    executionDirectory: path.join(root, 'execution'), executionWorkspaceDirectory: path.join(root, 'workspaces'),
    oidcAuthenticator, oidcSessionStore: testLocalRoleAuthority(), executionProfiles,
  });
  await app.init();
  adaptFileBackedAuthorityForTests(app);
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    await new Promise((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  return base;
}

async function restartableApi(t, oidcAuthenticator, { executionProfiles = [] } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orgward-oidc-restart-'));
  let app;
  let base;
  const start = async () => {
    app = createApp({
      dataDirectory: path.join(root, 'projects'), sdlcDirectory: path.join(root, 'sdlc'),
      executionDirectory: path.join(root, 'execution'), executionWorkspaceDirectory: path.join(root, 'workspaces'),
      oidcAuthenticator, oidcSessionStore: testLocalRoleAuthority(), executionProfiles,
    });
    await app.init();
    adaptFileBackedAuthorityForTests(app);
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${app.server.address().port}`;
  };
  const stop = async () => {
    if (!app) return;
    await new Promise((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
    await app.close(); app = null;
  };
  await start();
  t.after(async () => { await stop(); await rm(root, { recursive: true, force: true }); });
  return { get base() { return base; }, restart: async () => { await stop(); await start(); } };
}

async function request(base, endpoint, { bearer, headers = {}, ...init } = {}) {
  const response = await fetch(`${base}${endpoint}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...headers,
    },
  });
  return { status: response.status, body: await response.json() };
}

test('OIDC access tokens require a trusted signature, issuer, audience, validity and tenant; roles are server mapped', async () => {
  const verifierNowMs = Date.UTC(2026, 0, 1, 0, 0, 0);
  const verifierNowSeconds = Math.floor(verifierNowMs / 1000);
  const issue = (claims = {}, header = {}) => token(claims, header, verifierNowMs);
  const auth = authenticator({ clock: () => verifierNowMs });
  const accessToken = issue();
  const tokenClaims = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url'));
  const identity = await auth.authenticate({ headers: { authorization: `Bearer ${accessToken}` } });
  assert.deepEqual(identity, {
    issuer, subject: 'alice', principal: alicePrincipal, displayName: 'alice', tenantId: 'tenant-a',
    roles: ['workspace-write'], actorType: 'human', expiresAt: tokenClaims.exp,
  });
  const workload = await auth.authenticate({ headers: { authorization: `Bearer ${issue({ sub: 'build-agent', orgward_actor_type: 'workload' })}` } });
  assert.equal(workload.actorType, 'workload');
  assert.equal(workload.tenantId, 'tenant-a');
  const mapped = await auth.authenticate({ headers: { authorization: `Bearer ${issue({ orgward_tenant: 'provider-org-green' })}` } });
  assert.equal(mapped.tenantId, 'tenant-a');
  await assert.rejects(() => auth.authenticate({
    headers: { authorization: `Bearer ${issue({ orgward_tenant: 'unconfigured-provider-org' })}` },
  }), { statusCode: 401, code: 'AUTHENTICATION_REQUIRED' });
  for (const invalid of [
    issue({ iss: 'https://attacker.example.test' }),
    issue({ aud: 'other-api' }),
    issue({ exp: verifierNowSeconds - 1 }),
    issue({ iat: undefined }),
    issue({ iat: '123' }),
    issue({ iat: verifierNowSeconds + 61 }),
    issue({ iat: verifierNowSeconds, exp: verifierNowSeconds }),
    issue({ sub: 'build-agent', orgward_actor_type: 'workload', iat: undefined }),
    issue({ orgward_tenant: '../tenant-b' }),
    issue({}, { alg: 'none' }),
    issue({}, { kid: 'unknown-key' }),
  ]) {
    await assert.rejects(() => auth.authenticate({ headers: { authorization: `Bearer ${invalid}` } }), { statusCode: 401 });
  }
  const forgedSignature = `${issue().split('.').slice(0, 2).join('.')}.${Buffer.alloc(256, 7).toString('base64url')}`;
  await assert.rejects(() => auth.authenticate({ headers: { authorization: `Bearer ${forgedSignature}` } }), { statusCode: 401 });
  const malformedHeader = `${Buffer.from('null').toString('base64url')}.${Buffer.from('{}').toString('base64url')}.x`;
  await assert.rejects(() => auth.authenticate({ headers: { authorization: `Bearer ${malformedHeader}` } }), { statusCode: 401 });
  const malformedClaims = `${Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url')}.${Buffer.from('null').toString('base64url')}.x`;
  await assert.rejects(() => auth.authenticate({ headers: { authorization: `Bearer ${malformedClaims}` } }), { statusCode: 401 });
});

test('OIDC authenticator requires explicit, valid tenant bindings', () => {
  const options = { issuer, audience: 'orgward-api', jwksUri: `${issuer}/.well-known/jwks.json` };
  assert.throws(() => new OidcAuthenticator(options), /explicit provider-tenant/);
  assert.throws(() => new OidcAuthenticator({ ...options, tenantBindings: {} }), /provider tenant values/);
  assert.throws(() => new OidcAuthenticator({ ...options, tenantBindings: { 'provider-org': '../tenant' } }), /valid OrgWard tenant IDs/);
});

test('OIDC API derives tenant and actor from the token, denies missing and cross-tenant access, and separates read from write roles', async (t) => {
  const base = await api(t, authenticator());
  const missing = await request(base, '/api/v1/projects');
  assert.equal(missing.status, 401);
  assert.equal(missing.body.error.code, 'AUTHENTICATION_REQUIRED');

  const created = await request(base, '/api/v1/projects', {
    bearer: token(), method: 'POST',
    headers: { 'x-orgward-tenant': 'tenant-b', 'x-orgward-principal': 'attacker', 'x-orgward-access': 'read' },
    body: JSON.stringify({ schemaVersion: '1.0', commandId: 'oidc-create-1', payload: { name: 'Verified tenant workspace' } }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.tenantId, 'tenant-a');
  assert.equal(created.body.data.createdBy, alicePrincipal);

  const mappedTenant = await request(base, '/api/v1/projects', {
    bearer: token({ sub: 'mapped-user', orgward_tenant: 'provider-org-green' }), method: 'POST',
    body: JSON.stringify({ schemaVersion: '1.0', commandId: 'mapped-tenant-create', payload: { name: 'Explicit tenant binding' } }),
  });
  assert.equal(mappedTenant.status, 201);
  assert.equal(mappedTenant.body.data.tenantId, 'tenant-a');

  const unknownTenant = await request(base, '/api/v1/projects', {
    bearer: token({ sub: 'unbound-user', orgward_tenant: 'unconfigured-provider-org' }),
  });
  assert.equal(unknownTenant.status, 401);

  const wrongTenant = await request(base, `/api/v1/projects/${created.body.data.id}`, {
    bearer: token({ orgward_tenant: 'tenant-b' }), headers: { 'x-orgward-tenant': 'tenant-a' },
  });
  assert.equal(wrongTenant.status, 404);

  const reader = token({ sub: 'read-only-user', groups: ['unmapped-read-only-group'] });
  const readDenied = await request(base, '/api/v1/projects', { bearer: reader });
  assert.equal(readDenied.status, 200);
  assert.deepEqual(readDenied.body.data, []);
  const denied = await request(base, '/api/v1/projects', {
    bearer: reader, method: 'POST', body: JSON.stringify({ schemaVersion: '1.0', commandId: 'reader-create', payload: { name: 'Denied' } }),
  });
  assert.equal(denied.status, 403);

  const noRoles = token({ sub: 'unprivileged-user', groups: [] });
  const noRoleRead = await request(base, '/api/v1/projects', { bearer: noRoles });
  assert.equal(noRoleRead.status, 403);
  assert.equal(noRoleRead.body.error.code, 'ACTION_FORBIDDEN');

  const importDenied = await request(base, '/api/v1/persistence/imports', {
    bearer: token(), method: 'POST',
    body: JSON.stringify({ schemaVersion: '1.0', commandId: 'editor-import', payload: { mode: 'dry-run' } }),
  });
  assert.equal(importDenied.status, 403);

  const forgedPayload = await request(base, '/api/v1/projects', {
    bearer: token(), method: 'POST',
    body: JSON.stringify({ schemaVersion: '1.0', commandId: 'forged-tenant', payload: { name: 'No override', tenantId: 'tenant-b' } }),
  });
  assert.equal(forgedPayload.status, 400);
  assert.equal(forgedPayload.body.error.code, 'CALLER_AUTHORITY_NOT_ALLOWED');

  const forgedOwner = await request(base, '/api/sdlc/cases', {
    bearer: token(), method: 'POST',
    body: JSON.stringify({ title: 'Attempted owner override', accountableOwner: 'attacker' }),
  });
  assert.equal(forgedOwner.status, 400);
  assert.match(forgedOwner.body.error, /verified server context/);
});

test('OIDC project reads and commands are limited to explicit project members', async (t) => {
  const base = await api(t, authenticator());
  const created = await request(base, '/api/v1/projects', {
    bearer: token(), method: 'POST',
    body: JSON.stringify({ schemaVersion: '1.0', commandId: 'alice-isolated-create', payload: { name: 'Alice private project' } }),
  });
  assert.equal(created.status, 201);
  const projectId = created.body.data.id;
  assert.deepEqual(created.body.data.memberships, undefined);

  const aliceList = await request(base, '/api/v1/projects', { bearer: token() });
  assert.deepEqual(aliceList.body.data.map((project) => project.id), [projectId]);
  const bobList = await request(base, '/api/v1/projects', { bearer: token({ sub: 'bob' }) });
  assert.deepEqual(bobList.body.data, []);

  const guessedRead = await request(base, `/api/v1/projects/${projectId}`, { bearer: token({ sub: 'bob' }) });
  assert.equal(guessedRead.status, 404);
  const guessedWrite = await request(base, `/api/v1/projects/${projectId}/messages`, {
    bearer: token({ sub: 'bob' }), method: 'POST',
    body: JSON.stringify({ schemaVersion: '1.0', commandId: 'bob-guessed-write', expectedVersion: 1, payload: { content: 'unauthorized' } }),
  });
  assert.equal(guessedWrite.status, 404);

  const ownerMembers = await request(base, `/api/v1/projects/${projectId}/members`, { bearer: token() });
  assert.equal(ownerMembers.status, 200);
  assert.deepEqual(ownerMembers.body.data.map(({ principal, access }) => ({ principal, access })), [{ principal: alicePrincipal, access: 'owner' }]);
  const bobMembers = await request(base, `/api/v1/projects/${projectId}/members`, { bearer: token({ sub: 'bob' }) });
  assert.equal(bobMembers.status, 404);
});

test('OIDC change cases and execution runs inherit project scope across list, read, create, and action routes', async (t) => {
  const app = await restartableApi(t, authenticator(), {
    executionProfiles: [{
      id: 'test-scoped-profile', label: 'Scoped test profile', description: 'Not executed by this test.', kind: 'test', version: '1.0.0',
      executable: process.execPath, workspaceRoot: path.join(os.tmpdir(), 'orgward-scoped-test-work'), timeoutMs: 1000,
    }],
  });
  const aliceProject = await request(app.base, '/api/v1/projects', {
    bearer: token(), method: 'POST',
    body: JSON.stringify({ schemaVersion: '1.0', commandId: 'scope-alice-project', payload: { name: 'Alice scope' } }),
  });
  assert.equal(aliceProject.status, 201);
  const projectId = aliceProject.body.data.id;

  const changeCase = await request(app.base, '/api/sdlc/cases', {
    bearer: token(), method: 'POST',
    body: JSON.stringify({ projectId, mode: 'custom', rawIntent: 'Scope this change to my workspace.' }),
  });
  assert.equal(changeCase.status, 201);
  assert.equal(changeCase.body.projectId, projectId);
  assert.deepEqual((await request(app.base, '/api/sdlc/cases', { bearer: token() })).body.cases.map(({ id }) => id), [changeCase.body.id]);
  assert.deepEqual((await request(app.base, '/api/sdlc/cases', { bearer: token({ sub: 'bob' }) })).body.cases, []);
  assert.equal((await request(app.base, `/api/sdlc/cases/${changeCase.body.id}`, { bearer: token({ sub: 'bob' }) })).status, 404);
  assert.equal((await request(app.base, `/api/sdlc/cases/${changeCase.body.id}/run`, {
    bearer: token({ sub: 'bob' }), method: 'POST', body: JSON.stringify({ version: 0 }),
  })).status, 404);

  const run = await request(app.base, '/api/execution/runs', {
    bearer: token(), method: 'POST',
    body: JSON.stringify({ projectId, profileId: 'test-scoped-profile', title: 'Scoped run', objective: 'Prove project scope.' }),
  });
  assert.equal(run.status, 201);
  assert.equal(run.body.projectId, projectId);
  assert.deepEqual((await request(app.base, '/api/execution/runs', { bearer: token({ sub: 'bob' }) })).body.runs, []);
  assert.equal((await request(app.base, `/api/execution/runs/${run.body.id}`, { bearer: token({ sub: 'bob' }) })).status, 404);
  assert.equal((await request(app.base, `/api/execution/runs/${run.body.id}/execute`, {
    bearer: token({ sub: 'bob' }), method: 'POST', body: JSON.stringify({ version: 0 }),
  })).status, 404);

  await app.restart();
  assert.deepEqual((await request(app.base, '/api/sdlc/cases', { bearer: token() })).body.cases.map(({ id }) => id), [changeCase.body.id]);
  assert.deepEqual((await request(app.base, '/api/execution/runs', { bearer: token() })).body.runs.map(({ id }) => id), [run.body.id]);
  assert.deepEqual((await request(app.base, '/api/sdlc/cases', { bearer: token({ sub: 'bob' }) })).body.cases, []);
  assert.deepEqual((await request(app.base, '/api/execution/runs', { bearer: token({ sub: 'bob' }) })).body.runs, []);

  const bobProject = await request(app.base, '/api/v1/projects', {
    bearer: token({ sub: 'bob' }), method: 'POST',
    body: JSON.stringify({ schemaVersion: '1.0', commandId: 'scope-bob-project', payload: { name: 'Bob scope' } }),
  });
  const crossProjectCase = await request(app.base, '/api/sdlc/cases', {
    bearer: token(), method: 'POST',
    body: JSON.stringify({ projectId: bobProject.body.data.id, mode: 'custom', rawIntent: 'Attempt cross project scope.' }),
  });
  assert.equal(crossProjectCase.status, 403);
  const crossProjectRun = await request(app.base, '/api/execution/runs', {
    bearer: token(), method: 'POST',
    body: JSON.stringify({ projectId: bobProject.body.data.id, profileId: 'test-scoped-profile', title: 'Cross scope', objective: 'Must fail.' }),
  });
  assert.equal(crossProjectRun.status, 403);
});
