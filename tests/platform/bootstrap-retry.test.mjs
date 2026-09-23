import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../../server.mjs';
import { runInstallPreflight } from '../../src/platform/install-config.mjs';
import { startPostgres } from '../helpers/postgres.mjs';

const ISSUER = 'https://bootstrap.identity.example.test';
const KEY = Buffer.alloc(32, 8);
const BOOTSTRAP = { issuer: ISSUER, subject: 'owner-1', tenantId: 'tenant-acme' };
const principal = (subject) => `oidc:${createHash('sha256').update(`${ISSUER}\n${subject}`).digest('hex')}`;
function identity(subject) {
  return { issuer: ISSUER, subject, principal: principal(subject), displayName: subject,
    tenantId: 'tenant-acme', roles: [], actorType: 'human', expiresAt: Math.floor(Date.now() / 1000) + 300 };
}
function auth() {
  return { async authenticate(request) {
    const subject = String(request.headers.authorization ?? '').replace(/^Bearer /, '');
    return ['owner-1', 'backup-admin'].includes(subject) ? identity(subject) : null;
  } };
}
function config(databaseUrl) {
  return {
    ORGWARD_AUTH_MODE: 'oidc', ORGWARD_DATABASE_URL: databaseUrl,
    ORGWARD_SECRET_ENCRYPTION_KEY: KEY.toString('base64'),
    ORGWARD_PUBLIC_URL: 'https://studio.example.test',
    ORGWARD_OIDC_ISSUER: ISSUER, ORGWARD_OIDC_AUDIENCE: 'orgward-api',
    ORGWARD_OIDC_JWKS_URI: `${ISSUER}/jwks`, ORGWARD_OIDC_CLIENT_ID: 'orgward-web',
    ORGWARD_OIDC_REDIRECT_URI: 'https://studio.example.test/auth/callback',
    ORGWARD_OIDC_AUTHORIZATION_ENDPOINT: `${ISSUER}/authorize`,
    ORGWARD_OIDC_TOKEN_ENDPOINT: `${ISSUER}/token`,
    ORGWARD_OIDC_TENANT_BINDINGS: JSON.stringify({ 'provider-acme': 'tenant-acme' }),
    ORGWARD_OIDC_BOOTSTRAP_PRINCIPALS: JSON.stringify([BOOTSTRAP]),
  };
}

async function start(databaseUrl) {
  const app = createApp({ databaseUrl, secretEncryptionKey: KEY,
    oidcAuthenticator: auth(), oidcBootstrapPrincipals: [BOOTSTRAP] });
  await app.init();
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  return { app, base: `http://127.0.0.1:${app.server.address().port}` };
}
async function stop(app) {
  await new Promise((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
  await app.close();
}
async function call(base, subject, route, init = {}, expected = 200) {
  const response = await fetch(`${base}${route}`, { ...init,
    headers: { authorization: `Bearer ${subject}`, ...(init.headers ?? {}) } });
  const body = await response.json();
  assert.equal(response.status, expected, JSON.stringify(body));
  return body;
}

test('interrupted first-owner provisioning retries idempotently and retains demotions/data', async (t) => {
  const postgres = await startPostgres();
  t.after(postgres.close);
  const preflight = async () => {
    const result = await runInstallPreflight({ env: config(postgres.databaseUrl) });
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    return result;
  };
  assert.equal((await preflight()).database.uninitialized, true);

  // Simulate the operator stopping the first initialized process before first login.
  let interrupted = createApp({ databaseUrl: postgres.databaseUrl, secretEncryptionKey: KEY,
    oidcAuthenticator: auth(), oidcBootstrapPrincipals: [BOOTSTRAP] });
  await interrupted.init();
  await interrupted.close();
  interrupted = null;
  const afterInterruption = await preflight();
  assert.equal(afterInterruption.database.uninitialized, false);

  let { app, base } = await start(postgres.databaseUrl);
  t.after(async () => { if (app) await stop(app); });
  const created = await call(base, 'owner-1', '/api/v1/projects', { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ schemaVersion: '1.0', commandId: 'first-install-project', payload: { name: 'Retained installation data' } }),
  }, 201);
  const projectId = created.data.id;
  const initialOwnerMembership = await postgres.query(`
    select count(*)::int count from orgward.project_memberships
    where tenant_id = 'tenant-acme' and project_id = $1 and principal = $2 and access = 'owner' and revoked_at is null
  `, [projectId, principal('owner-1')]);
  assert.equal(initialOwnerMembership.rows[0].count, 1);

  // Provision a second administrator, then demote the bootstrapped principal.
  await call(base, 'backup-admin', '/api/v1/projects', {}, 403); // identity is persisted before authorization denial.
  const directory = await call(base, 'owner-1', '/api/v1/identities');
  const backup = directory.data.find((entry) => entry.principal === principal('backup-admin'));
  assert.ok(backup);
  await call(base, 'owner-1', `/api/v1/identities/${principal('backup-admin')}/roles`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roles: ['tenant-admin', 'workspace-read', 'workspace-write'], expectedAuthzGeneration: backup.authzGeneration, reason: 'Maintain a second tenant administrator.' }),
  });
  const ownerNow = (await call(base, 'owner-1', '/api/v1/identities')).data.find((entry) => entry.principal === principal('owner-1'));
  await call(base, 'backup-admin', `/api/v1/identities/${principal('owner-1')}/roles`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roles: ['workspace-read', 'workspace-write'], expectedAuthzGeneration: ownerNow.authzGeneration, reason: 'Revoke initial tenant-admin role.' }),
  });
  await stop(app);
  ({ app, base } = await start(postgres.databaseUrl));
  await preflight();

  const projects = await call(base, 'owner-1', '/api/v1/projects');
  assert.deepEqual(projects.data.map((project) => project.id), [projectId]);
  const identities = await call(base, 'backup-admin', '/api/v1/identities');
  const ownerAfterRestart = identities.data.find((entry) => entry.principal === principal('owner-1'));
  assert.deepEqual(ownerAfterRestart.roles, ['workspace-read', 'workspace-write']);
  const persisted = await postgres.query(`
    select
      (select count(*)::int from orgward.oidc_bootstrap_grants where tenant_id = 'tenant-acme' and principal = $1) bootstrap_grants,
      (select count(*)::int from orgward.oidc_principal_events where tenant_id = 'tenant-acme' and principal = $1 and event_type = 'PrincipalBootstrapped') bootstrap_events,
      (select count(*)::int from orgward.aggregates where tenant_id = 'tenant-acme' and aggregate_id = $2) retained_projects,
      (select count(*)::int from orgward.oidc_principals where tenant_id = 'tenant-acme') principals
  `, [principal('owner-1'), projectId]);
  assert.deepEqual(persisted.rows[0], { bootstrap_grants: 1, bootstrap_events: 1, retained_projects: 1, principals: 2 });
});
