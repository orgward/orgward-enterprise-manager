import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { OidcAuthenticator } from '../src/platform/oidc.mjs';
import { OidcLoginFlow } from '../src/platform/oidc-login.mjs';
import { PostgresOidcSessionStore } from '../src/platform/oidc-sessions.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const issuer = 'https://identity.example.test';
const clientId = 'orgward-browser';
const principal = `oidc:${createHash('sha256').update(`${issuer}\nalice`).digest('hex')}`;
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'login-key', use: 'sig', alg: 'RS256' };

function signedIdToken(nonce, overrides = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'login-key' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    iss: issuer, aud: clientId, sub: 'alice', iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 1200, nonce, orgward_tenant: 'tenant-login',
    groups: ['editors'], ...overrides,
  })).toString('base64url');
  const content = `${header}.${claims}`;
  return `${content}.${sign('RSA-SHA256', Buffer.from(content), privateKey).toString('base64url')}`;
}

function idAuthenticator() {
  return new OidcAuthenticator({
    issuer, audience: clientId, jwksUri: `${issuer}/keys`, roleMap: { editors: ['workspace-write'], admins: ['tenant-admin'] },
    tenantBindings: { 'tenant-login': 'tenant-login', 'tenant-other': 'tenant-other' },
    fetchImpl: async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }),
  });
}

function sessionMemory() {
  const entries = new Map();
  const principals = new Map();
  const localGrants = new Map([
    ['tenant-login\nalice', ['workspace-read', 'workspace-write']],
    ['tenant-login\ntenant-admin', ['tenant-admin']],
    ['tenant-other\nother-admin', ['tenant-admin']],
  ]);
  const provision = (identity) => ({ ...identity, roles: localGrants.get(`${identity.tenantId}\n${identity.subject}`) ?? [], authzGeneration: 1 });
  return {
    entries, principals,
    async create(id, identity, expiresAt) {
      if (!principals.has(identity.principal)) principals.set(identity.principal, { identity: provision(identity), status: 'active', authzGeneration: 1 });
      if (principals.get(identity.principal).status !== 'active') throw new Error('revoked');
      entries.set(id, { principal: identity.principal, expiresAt });
    },
    async resolve(identity) {
      let principal = principals.get(identity.principal);
      if (!principal) {
        principal = { identity: provision(identity), status: 'active', authzGeneration: 1 };
        principals.set(identity.principal, principal);
      }
      if (principal.status !== 'active' || principal.identity.tenantId !== identity.tenantId) return null;
      principal.identity = { ...identity, roles: principal.identity.roles, authzGeneration: principal.authzGeneration };
      return principal.identity;
    },
    async get(id) {
      const session = entries.get(id);
      const principal = principals.get(session?.principal);
      return principal?.status === 'active' && session.expiresAt > Math.floor(Date.now() / 1000)
        ? principal.identity : null;
    },
    async getWithAuthority(id, { operation }) {
      // This JSON fixture models the callback contract only; PostgreSQL tests prove locking.
      return operation(await this.get(id));
    },
    async revoke(id) { return entries.delete(id); },
    async listPrincipals(tenantId) {
      return [...principals.values()].map(({ identity, status }) => ({
        principal: identity.principal, tenantId: identity.tenantId, actorType: identity.actorType,
        roles: identity.roles, status, authzGeneration: principals.get(identity.principal).authzGeneration,
      })).filter((entry) => entry.tenantId === tenantId);
    },
    async listPrincipalsForAdmin({ tenantId, actor, actorAuthzGeneration, operation }) {
      const administrator = principals.get(actor);
      if (!administrator || administrator.status !== 'active' || administrator.identity.tenantId !== tenantId
        || !administrator.identity.roles.includes('tenant-admin')) {
        throw Object.assign(new Error('Current tenant administrator authority is required.'), { statusCode: 403, code: 'ACTION_FORBIDDEN' });
      }
      if (administrator.authzGeneration !== actorAuthzGeneration) {
        throw Object.assign(new Error('The identity authority changed before this operation was completed.'), {
          statusCode: 409, code: 'AUTHORITY_GENERATION_STALE',
        });
      }
      return operation(await this.listPrincipals(tenantId));
    },
    async revokePrincipal({ tenantId, principal, actor, actorAuthzGeneration, expectedAuthzGeneration, reason }) {
      const current = principals.get(principal);
      const administrator = principals.get(actor);
      if (!administrator || administrator.status !== 'active' || administrator.identity.tenantId !== tenantId
        || !administrator.identity.roles.includes('tenant-admin') || administrator.authzGeneration !== actorAuthzGeneration) {
        throw Object.assign(new Error('Current tenant administrator authority is required.'), { statusCode: 403, code: 'ACTION_FORBIDDEN' });
      }
      if (principal === actor) throw Object.assign(new Error('Self identity change denied.'), { statusCode: 409, code: 'SELF_IDENTITY_CHANGE_DENIED' });
      if (!current || current.identity.tenantId !== tenantId) return false;
      if (current.status === 'revoked') return true;
      if (current.authzGeneration !== expectedAuthzGeneration) throw Object.assign(new Error('Target authority changed.'), { statusCode: 409, code: 'AUTHORITY_GENERATION_STALE' });
      current.status = 'revoked';
      current.authzGeneration += 1;
      current.revokedBy = actor;
      current.reason = reason;
      return true;
    },
  };
}

test('OIDC login uses state, nonce, PKCE S256, one-time code exchange, and a same-origin return path', async () => {
  let now = Date.now();
  let loginNonce;
  let exchangedBody;
  const login = new OidcLoginFlow({
    clientId, redirectUri: 'http://127.0.0.1:4310/auth/callback',
    authorizationEndpoint: `${issuer}/authorize`, tokenEndpoint: `${issuer}/token`,
    identityAuthenticator: idAuthenticator(), clock: () => now,
    fetchImpl: async (_url, options) => {
      exchangedBody = new URLSearchParams(options.body);
      return new Response(JSON.stringify({ id_token: signedIdToken(loginNonce) }), { status: 200 });
    },
  });

  const start = login.begin('/?project=project-123');
  const authorization = new URL(start.location);
  loginNonce = authorization.searchParams.get('nonce');
  assert.equal(authorization.searchParams.get('response_type'), 'code');
  assert.equal(authorization.searchParams.get('scope'), 'openid profile');
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorization.searchParams.get('state'), start.state);
  assert.match(authorization.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);

  const sessions = sessionMemory();
  await assert.rejects(() => login.complete({ state: start.state, cookieState: 'attacker-state', code: 'code', sessionStore: sessions }), { statusCode: 400 });
  await assert.rejects(() => login.complete({ state: start.state, cookieState: start.state, code: 'code', sessionStore: sessions }), { statusCode: 400 });

  const second = login.begin('https://attacker.example/steal');
  const secondUrl = new URL(second.location);
  loginNonce = secondUrl.searchParams.get('nonce');
  const result = await login.complete({ state: second.state, cookieState: second.state, code: 'single-use-code', sessionStore: sessions });
  assert.equal(result.identity.principal, principal);
  assert.equal(result.identity.tenantId, 'tenant-login');
  assert.equal(result.returnTo, '/');
  assert.equal(sessions.entries.size, 1);
  assert.equal(exchangedBody.get('grant_type'), 'authorization_code');
  assert.equal(exchangedBody.get('client_id'), clientId);
  assert.equal(exchangedBody.get('code'), 'single-use-code');
  assert.match(exchangedBody.get('code_verifier'), /^[A-Za-z0-9._~-]{43,128}$/);
  assert.equal(exchangedBody.has('client_secret'), false);
  await assert.rejects(() => login.complete({ state: second.state, cookieState: second.state, code: 'replay', sessionStore: sessions }), { statusCode: 400 });

  const expired = login.begin('/');
  now += 300_001;
  await assert.rejects(() => login.complete({ state: expired.state, cookieState: expired.state, code: 'late', sessionStore: sessions }), { statusCode: 400 });
});

test('OIDC callback rejects an ID token with the wrong nonce and does not create a session', async () => {
  let nonce;
  const login = new OidcLoginFlow({
    clientId, redirectUri: 'https://studio.example.test/auth/callback',
    authorizationEndpoint: `${issuer}/authorize`, tokenEndpoint: `${issuer}/token`,
    identityAuthenticator: idAuthenticator(),
    fetchImpl: async () => new Response(JSON.stringify({ id_token: signedIdToken('wrong-nonce') }), { status: 200 }),
  });
  const start = login.begin('/');
  nonce = new URL(start.location).searchParams.get('nonce');
  assert.notEqual(nonce, 'wrong-nonce');
  const sessions = sessionMemory();
  await assert.rejects(() => login.complete({ state: start.state, cookieState: start.state, code: 'code', sessionStore: sessions }), { statusCode: 401 });
  assert.equal(sessions.entries.size, 0);
});

test('OIDC workload identities cannot create interactive browser sessions', async () => {
  let nonce;
  const login = new OidcLoginFlow({
    clientId, redirectUri: 'https://studio.example.test/auth/callback',
    authorizationEndpoint: `${issuer}/authorize`, tokenEndpoint: `${issuer}/token`,
    identityAuthenticator: idAuthenticator(),
    fetchImpl: async () => new Response(JSON.stringify({
      id_token: signedIdToken(nonce, { orgward_actor_type: 'workload' }),
    }), { status: 200 }),
  });
  const start = login.begin('/');
  nonce = new URL(start.location).searchParams.get('nonce');
  const sessions = sessionMemory();
  await assert.rejects(
    () => login.complete({ state: start.state, cookieState: start.state, code: 'workload-code', sessionStore: sessions }),
    { statusCode: 403, code: 'OIDC_WORKLOAD_BROWSER_SESSION_DENIED' },
  );
  assert.equal(sessions.entries.size, 0);
});

test('browser login creates an HttpOnly session cookie, authorizes scoped APIs, and logout revokes it', async (t) => {
  let loginNonce;
  const loginFlow = new OidcLoginFlow({
    clientId, redirectUri: 'http://127.0.0.1:4310/auth/callback',
    authorizationEndpoint: `${issuer}/authorize`, tokenEndpoint: `${issuer}/token`,
    identityAuthenticator: idAuthenticator(),
    fetchImpl: async () => new Response(JSON.stringify({ id_token: signedIdToken(loginNonce) }), { status: 200 }),
  });
  const sessions = sessionMemory();
  const root = await mkdtemp(path.join(os.tmpdir(), 'orgward-login-'));
  const app = createApp({
    dataDirectory: path.join(root, 'projects'), sdlcDirectory: path.join(root, 'sdlc'),
    executionDirectory: path.join(root, 'execution'), executionWorkspaceDirectory: path.join(root, 'workspaces'),
    oidcAuthenticator: idAuthenticator(), oidcLoginFlow: loginFlow, oidcSessionStore: sessions,
  });
  await app.init();
  // The browser-session fixture uses JSON storage and tests cookie/scoping
  // behavior, not the PostgreSQL transaction/revocation fence.
  app.store.listWithPrincipalAuthority = async ({ tenantId, principal, operation }) => {
    const records = await app.store.listForPrincipal(tenantId, principal);
    return operation({ records, corruptRecords: 0 });
  };
  app.store.getWithPrincipalAuthority = async ({ id, tenantId, principal, operation }) => {
    const record = await app.store.getForPrincipal(id, tenantId, principal);
    return record ? operation(record) : null;
  };
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    await new Promise((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  const start = await fetch(`${base}/auth/login?returnTo=%2F%3Fview%3Dmap`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const authorization = new URL(start.headers.get('location'));
  loginNonce = authorization.searchParams.get('nonce');
  const loginCookie = start.headers.get('set-cookie');
  assert.match(loginCookie, /ow_login=/);
  assert.match(loginCookie, /HttpOnly/);
  assert.match(loginCookie, /SameSite=Lax/);
  const state = authorization.searchParams.get('state');

  const callback = await fetch(`${base}/auth/callback?state=${state}&code=one-time`, {
    redirect: 'manual', headers: { cookie: `ow_login=${state}` },
  });
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.get('location'), '/?view=map');
  const cookies = callback.headers.getSetCookie();
  const sessionCookie = cookies.find((value) => value.startsWith('ow_session='));
  assert.match(sessionCookie, /HttpOnly/);
  assert.match(sessionCookie, /SameSite=Lax/);
  const sessionId = sessionCookie.match(/^ow_session=([^;]+)/)[1];
  const browserProject = await fetch(`${base}/api/v1/projects`, {
    method: 'POST', headers: {
      origin: 'http://127.0.0.1:4310', cookie: `ow_session=${sessionId}`, 'content-type': 'application/json',
    },
    body: JSON.stringify({ schemaVersion: '1.0', commandId: 'browser-session-project', payload: { name: 'Browser session project' } }),
  });
  assert.equal(browserProject.status, 201);
  const missingOrigin = await fetch(`${base}/api/v1/projects`, {
    method: 'POST', headers: { cookie: `ow_session=${sessionId}`, 'content-type': 'application/json' },
    body: JSON.stringify({ schemaVersion: '1.0', commandId: 'browser-session-no-origin', payload: { name: 'Must be denied' } }),
  });
  assert.equal(missingOrigin.status, 403);
  assert.equal((await missingOrigin.json()).error.code, 'CROSS_SITE_REQUEST_DENIED');
  const crossOrigin = await fetch(`${base}/api/v1/projects`, {
    method: 'POST', headers: {
      origin: 'https://attacker.example', cookie: `ow_session=${sessionId}`, 'content-type': 'application/json',
    },
    body: JSON.stringify({ schemaVersion: '1.0', commandId: 'browser-session-cross-origin', payload: { name: 'Must be denied' } }),
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal((await crossOrigin.json()).error.code, 'CROSS_SITE_REQUEST_DENIED');
  assert.equal((await fetch(`${base}/api/v1/projects`, { headers: { cookie: `ow_session=${sessionId}` } })).status, 200);
  const browserSession = await fetch(`${base}/auth/session`, { headers: { cookie: `ow_session=${sessionId}` } });
  assert.equal(browserSession.status, 200);
  assert.equal((await browserSession.json()).principal, principal);

  const identityList = await fetch(`${base}/api/v1/identities`, { headers: { cookie: `ow_session=${sessionId}` } });
  assert.equal(identityList.status, 403);
  const nonAdminRevoke = await fetch(`${base}/api/v1/identities/${principal}/revoke`, {
    method: 'POST', headers: {
      origin: 'http://127.0.0.1:4310', cookie: `ow_session=${sessionId}`, 'content-type': 'application/json',
    },
    body: JSON.stringify({ reason: 'not authorized' }),
  });
  assert.equal(nonAdminRevoke.status, 403);

  const admin = signedIdToken('no-browser-nonce', { sub: 'tenant-admin', groups: ['admins'] });
  const adminToken = `Bearer ${admin}`;
  const adminIdentity = `oidc:${createHash('sha256').update(`${issuer}\ntenant-admin`).digest('hex')}`;
  const adminBusinessWrite = await fetch(`${base}/api/v1/projects`, {
    method: 'POST', headers: { authorization: adminToken, 'content-type': 'application/json' },
    body: JSON.stringify({ schemaVersion: '1.0', commandId: 'admin-business-write', payload: { name: 'Admin must not become project owner' } }),
  });
  assert.equal(adminBusinessWrite.status, 403);
  const enrolled = await fetch(`${base}/api/v1/identities`, { headers: { authorization: adminToken } });
  assert.equal(enrolled.status, 200);
  assert.ok((await enrolled.json()).data.some((entry) => entry.principal === principal && entry.status === 'active'));
  const selfRevoke = await fetch(`${base}/api/v1/identities/${adminIdentity}/revoke`, {
    method: 'POST', headers: { authorization: adminToken, 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'self revoke', expectedAuthzGeneration: 1 }),
  });
  assert.equal(selfRevoke.status, 409);

  const crossTenantRevoke = await fetch(`${base}/api/v1/identities/${principal}/revoke`, {
    method: 'POST', headers: { authorization: `Bearer ${signedIdToken('unused', { sub: 'other-admin', groups: ['admins'], orgward_tenant: 'tenant-other' })}`, 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'different tenant', expectedAuthzGeneration: 1 }),
  });
  assert.equal(crossTenantRevoke.status, 404);
  const otherTenantIdentities = await fetch(`${base}/api/v1/identities`, {
    headers: { authorization: `Bearer ${signedIdToken('unused', { sub: 'other-admin', groups: ['admins'], orgward_tenant: 'tenant-other' })}` },
  });
  assert.equal(otherTenantIdentities.status, 200);
  const otherTenantRecords = (await otherTenantIdentities.json()).data;
  assert.equal(otherTenantRecords.some((entry) => entry.principal === principal), false);

  const forgedAuthority = await fetch(`${base}/api/v1/identities/${principal}/revoke`, {
    method: 'POST', headers: { authorization: adminToken, 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'forged', expectedAuthzGeneration: 1, roles: ['tenant-admin'] }),
  });
  assert.equal(forgedAuthority.status, 400);

  const revoke = await fetch(`${base}/api/v1/identities/${principal}/revoke`, {
    method: 'POST', headers: { authorization: adminToken, 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'Membership ended', expectedAuthzGeneration: 1 }),
  });
  assert.equal(revoke.status, 200);
  assert.equal((await fetch(`${base}/api/v1/projects`, { headers: { cookie: `ow_session=${sessionId}` } })).status, 401);
  assert.equal((await fetch(`${base}/api/v1/projects`, { headers: { authorization: `Bearer ${signedIdToken('unused', { groups: ['editors'] })}` } })).status, 401);
  const blockedLogin = await fetch(`${base}/auth/login`, { redirect: 'manual' });
  const blockedAuthorization = new URL(blockedLogin.headers.get('location'));
  loginNonce = blockedAuthorization.searchParams.get('nonce');
  const blockedState = blockedAuthorization.searchParams.get('state');
  const blockedCallback = await fetch(`${base}/auth/callback?state=${blockedState}&code=blocked-login`, {
    redirect: 'manual', headers: { cookie: `ow_login=${blockedState}` },
  });
  assert.equal(blockedCallback.status, 303);
  assert.equal(blockedCallback.headers.get('location'), '/sign-in.html?error=login_failed');

  const logout = await fetch(`${base}/auth/logout`, {
    method: 'POST', redirect: 'manual', headers: { origin: 'http://127.0.0.1:4310', cookie: `ow_session=${sessionId}` },
  });
  assert.equal(logout.status, 303);
  assert.match(logout.headers.get('set-cookie'), /ow_session=;/);
  assert.equal(sessions.entries.has(sessionId), false);
  assert.equal((await fetch(`${base}/api/v1/projects`, { headers: { cookie: `ow_session=${sessionId}` } })).status, 401);
  const loggedOutSession = await fetch(`${base}/auth/session`, { headers: { cookie: `ow_session=${sessionId}` } });
  assert.equal(loggedOutSession.status, 200);
  assert.deepEqual(await loggedOutSession.json(), { authenticated: false, mode: 'oidc', roles: [], principal: null });

  const crossSiteLogout = await fetch(`${base}/auth/logout`, { method: 'POST', redirect: 'manual', headers: { origin: 'https://attacker.example' } });
  assert.equal(crossSiteLogout.status, 403);
  const missingOriginLogout = await fetch(`${base}/auth/logout`, { method: 'POST', redirect: 'manual' });
  assert.equal(missingOriginLogout.status, 403);
});

test('PostgreSQL sessions store only a digest of the browser secret and support principal revocation', async () => {
  const calls = [];
  let revoked = false;
  let principalRevoked = false;
  let workerCancellationRequested = false;
  let principalBound = true;
  const rowIdentity = { issuer, principal: `oidc:${createHash('sha256').update(`${issuer}\nalice`).digest('hex')}`, tenant_id: 'tenant-login', roles: ['workspace-write'], actor_type: 'human', display_name: 'Alice', authz_generation: '1' };
  let principal = { ...rowIdentity, status: 'active' };
  const persistence = {
    async transaction(work) {
      return work({
        async query(sql, values) {
          calls.push({ sql, values });
          if (sql.includes('insert into orgward.oidc_principals')) {
            return { rowCount: 0, rows: [] };
          }
          if (sql.includes('from orgward.oidc_principals where principal')) {
            return principalRevoked ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ ...principal, status: 'active' }] };
          }
          if (sql.includes('update orgward.oidc_principals') && sql.includes('set roles')) {
            principal = {
              ...principal, roles: values[1], display_name: values[2],
              authz_generation: String(Number(principal.authz_generation) + Number(values[3])),
            };
            return { rowCount: 1, rows: [principal] };
          }
          if (sql.includes('update orgward.oidc_principals set last_authenticated_at')) return { rowCount: 1, rows: [] };
          if (sql.includes('insert into orgward.oidc_sessions')) return { rowCount: 1, rows: [] };
          if (sql.includes('from orgward.oidc_sessions s')) {
            assert.match(sql, /for share of s, p/i, 'session reads must lock both the session and current principal authority');
            return revoked || principalRevoked ? { rowCount: 0, rows: [] }
              : { rowCount: 1, rows: [{ ...principal, expires_at: '2000000000' }] };
          }
          if (sql.includes('update orgward.oidc_sessions')) { revoked = true; return { rowCount: 1, rows: [] }; }
          if (sql.includes('update orgward.execution_worker_leases')) {
            workerCancellationRequested = true;
            return { rowCount: 0, rows: [] };
          }
          if (sql.includes("set status = 'revoked'")) {
            if (principalRevoked) return { rowCount: 0, rows: [] };
            principalRevoked = true;
            return { rowCount: 1, rows: [{ ...rowIdentity, authz_generation: '2', revoked_at: new Date() }] };
          }
          if (sql.includes('select status from orgward.oidc_principals')) {
            return { rowCount: 1, rows: [{ status: principalRevoked ? 'revoked' : 'active' }] };
          }
          if (sql.includes('insert into orgward.oidc_principal_events')) return { rowCount: 1, rows: [] };
          throw new Error(`Unexpected transaction query: ${sql}`);
        },
      });
    },
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('update orgward.oidc_sessions')) { revoked = true; return { rowCount: 1, rows: [] }; }
      if (sql.includes('from orgward.oidc_sessions s')) {
        return revoked || principalRevoked ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ ...principal, expires_at: '2000000000' }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const store = new PostgresOidcSessionStore(persistence);
  const sessionId = 'A'.repeat(43);
  const identity = { issuer, subject: 'alice', principal: rowIdentity.principal, displayName: 'Alice', tenantId: 'tenant-login', roles: ['workspace-write'], actorType: 'human' };
  const persistedIdentity = { issuer, principal: rowIdentity.principal, displayName: 'Alice', tenantId: 'tenant-login', roles: ['workspace-write'], actorType: 'human' };
  await store.create(sessionId, identity, 2_000_000_000);
  const sessionInsert = calls.find(({ sql }) => sql.includes('insert into orgward.oidc_sessions'));
  assert.notEqual(sessionInsert.values[0], sessionId);
  assert.equal(sessionInsert.values[0], createHash('sha256').update(sessionId).digest('hex'));
  assert.deepEqual(await store.get(sessionId), { ...persistedIdentity, authzGeneration: 1, expiresAt: 2_000_000_000 });
  assert.deepEqual(await store.resolve(identity), { ...persistedIdentity, authzGeneration: 1, expiresAt: undefined });
  assert.deepEqual(await store.resolve({ ...identity, roles: [] }), { ...persistedIdentity, authzGeneration: 1, expiresAt: undefined });
  assert.deepEqual(await store.get(sessionId), { ...persistedIdentity, authzGeneration: 1, expiresAt: 2_000_000_000 });
  assert.equal(await store.revoke(sessionId), true);
  assert.equal(await store.get(sessionId), null);
  assert.equal(await store.get('bad'), null);
  assert.equal(await store.get(sessionId), null);
});
