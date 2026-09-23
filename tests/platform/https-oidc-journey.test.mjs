import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { execFile } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { createServer as createHttpsServer, request as httpsRequest } from 'node:https';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { createApp } from '../../server.mjs';
import { OidcAuthenticator } from '../../src/platform/oidc.mjs';
import { OidcLoginFlow } from '../../src/platform/oidc-login.mjs';
import { startPostgres } from '../helpers/postgres.mjs';

const exec = promisify(execFile);
const clientId = 'orgward-https-browser';

async function freePort() {
  const probe = createNetServer();
  await new Promise((resolve, reject) => probe.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

function requestHttps(urlValue, { method = 'GET', headers = {}, body, ca } = {}) {
  const url = new URL(urlValue);
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, { method, headers, ca, rejectUnauthorized: true }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

function requestProxy(upstreamPort, key, cert) {
  return createHttpsServer({ key, cert }, (incoming, outgoing) => {
    const proxyRequest = httpRequest({
      host: '127.0.0.1', port: upstreamPort, method: incoming.method,
      path: incoming.url, headers: { ...incoming.headers, 'x-forwarded-proto': 'https' },
    }, (upstream) => {
      outgoing.writeHead(upstream.statusCode, upstream.headers);
      upstream.pipe(outgoing);
    });
    proxyRequest.on('error', () => { outgoing.writeHead(502); outgoing.end(); });
    incoming.pipe(proxyRequest);
  });
}

test('HTTPS reverse proxy completes secure browser OIDC session and enforces origin', async (t) => {
  const postgres = await startPostgres();
  const root = await mkdtemp(path.join(os.tmpdir(), 'orgward-https-oidc-'));
  t.after(async () => { await postgres.close(); await rm(root, { recursive: true, force: true }); });
  const keyFile = path.join(root, 'key.pem');
  const certFile = path.join(root, 'cert.pem');
  await exec('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile,
    '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1']);
  const key = await readFile(keyFile);
  const cert = await readFile(certFile);
  const publicPort = await freePort();
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const issuer = 'https://127.0.0.1';
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'https-journey', use: 'sig', alg: 'RS256' };
  const codes = new Map();
  let identityIssuer;
  const identityProvider = createHttpsServer({ key, cert }, (request, response) => {
    const url = new URL(request.url, issuer);
    if (url.pathname === '/keys') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    if (url.pathname === '/authorize') {
      const code = `code-${createHash('sha256').update(url.searchParams.get('state')).digest('hex').slice(0, 12)}`;
      codes.set(code, url.searchParams.get('nonce'));
      const callback = new URL(url.searchParams.get('redirect_uri'));
      callback.searchParams.set('state', url.searchParams.get('state'));
      callback.searchParams.set('code', code);
      response.writeHead(302, { location: callback.toString(), 'cache-control': 'no-store' });
      response.end();
      return;
    }
    if (url.pathname === '/token' && request.method === 'POST') {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        const form = new URLSearchParams(Buffer.concat(chunks).toString());
        const nonce = codes.get(form.get('code'));
        codes.delete(form.get('code'));
        if (!nonce || form.get('client_id') !== clientId || !form.get('code_verifier')) {
          response.writeHead(400); response.end('{}'); return;
        }
        const now = Math.floor(Date.now() / 1000);
        const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'https-journey' })).toString('base64url');
        const claims = Buffer.from(JSON.stringify({ iss: identityIssuer, aud: clientId, sub: 'first-owner', iat: now, exp: now + 600,
          nonce, orgward_tenant: 'idp-tenant', groups: [] })).toString('base64url');
        const content = `${header}.${claims}`;
        const idToken = `${content}.${sign('RSA-SHA256', Buffer.from(content), privateKey).toString('base64url')}`;
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(JSON.stringify({ id_token: idToken }));
      });
      return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise((resolve) => identityProvider.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => identityProvider.close(resolve)));
  const identityPort = identityProvider.address().port;
  identityIssuer = `https://127.0.0.1:${identityPort}`;
  const tokenFetch = async (url, options = {}) => {
    const body = options.body instanceof URLSearchParams ? options.body.toString() : options.body;
    const result = await requestHttps(url, { method: options.method ?? 'GET', headers: options.headers ?? {}, body, ca: cert });
    return new Response(result.body, { status: result.status, headers: result.headers });
  };
  const idAuthenticator = new OidcAuthenticator({ issuer: identityIssuer, audience: clientId,
    jwksUri: `${identityIssuer}/keys`, roleMap: {}, tenantBindings: { 'idp-tenant': 'tenant-https' }, fetchImpl: tokenFetch });
  const loginFlow = new OidcLoginFlow({ clientId, redirectUri: `https://127.0.0.1:${publicPort}/auth/callback`,
    authorizationEndpoint: `${identityIssuer}/authorize`, tokenEndpoint: `${identityIssuer}/token`,
    identityAuthenticator: idAuthenticator, fetchImpl: tokenFetch });
  const secretCanary = Buffer.alloc(32, 27).toString('base64');
  const appOptions = { databaseUrl: postgres.databaseUrl, secretEncryptionKey: Buffer.alloc(32, 27),
    oidcAuthenticator: idAuthenticator, oidcLoginFlow: loginFlow,
    oidcBootstrapPrincipals: [{ issuer: identityIssuer, subject: 'first-owner', tenantId: 'tenant-https' }] };
  let app = createApp(appOptions);
  t.after(async () => {
    if (!app) return;
    if (app.server.listening) await new Promise((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
    await app.close();
  });
  await app.init();
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const upstreamPort = app.server.address().port;
  const proxy = requestProxy(upstreamPort, key, cert);
  await new Promise((resolve) => proxy.listen(publicPort, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => proxy.close(resolve)));
  const publicOrigin = `https://127.0.0.1:${proxy.address().port}`;
  assert.equal(new URL(loginFlow.redirectUri).origin, publicOrigin);

  const login = await requestHttps(`${publicOrigin}/auth/login?returnTo=%2F%3Fview%3Dmap`, { ca: cert });
  assert.equal(login.status, 302);
  const loginCookie = (Array.isArray(login.headers['set-cookie']) ? login.headers['set-cookie'] : [login.headers['set-cookie']])[0];
  assert.match(loginCookie, /ow_login=/);
  assert.match(loginCookie, /HttpOnly/);
  assert.match(loginCookie, /SameSite=Lax/);
  assert.match(loginCookie, /; Secure/);
  const authorizationUrl = new URL(login.headers.location);
  assert.equal(authorizationUrl.origin, identityIssuer);
  const authorization = await requestHttps(authorizationUrl, { ca: cert });
  assert.equal(authorization.status, 302);
  const callbackUrl = new URL(authorization.headers.location);
  assert.equal(callbackUrl.origin, publicOrigin);
  const loginState = authorizationUrl.searchParams.get('state');
  assert.equal(callbackUrl.searchParams.get('state'), loginState);
  const stateCookie = loginCookie.match(/(?:^|;\s*)ow_login=([^;]+)/)[1];
  const callback = await requestHttps(callbackUrl, { ca: cert, headers: { cookie: `ow_login=${stateCookie}` } });
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.location, '/?view=map');
  const callbackCookies = callback.headers['set-cookie'];
  const cookieLines = Array.isArray(callbackCookies) ? callbackCookies : [callbackCookies];
  const sessionCookie = cookieLines.find((value) => value.startsWith('ow_session='));
  assert.ok(sessionCookie);
  assert.match(sessionCookie, /HttpOnly/);
  assert.match(sessionCookie, /SameSite=Lax/);
  assert.match(sessionCookie, /; Secure/);
  assert.doesNotMatch(sessionCookie, /;\s*Secure=false/i);
  const sessionId = sessionCookie.match(/^ow_session=([^;]+)/)[1];
  const session = await requestHttps(`${publicOrigin}/auth/session`, { ca: cert, headers: { cookie: `ow_session=${sessionId}` } });
  assert.equal(session.status, 200);
  assert.equal(JSON.parse(session.body).authenticated, true);
  assert.equal(JSON.parse(session.body).principal, `oidc:${createHash('sha256').update(`${identityIssuer}\nfirst-owner`).digest('hex')}`);

  const payload = JSON.stringify({ schemaVersion: '1.0', commandId: 'https-proxy-project', payload: { name: 'HTTPS proxy project' } });
  const created = await requestHttps(`${publicOrigin}/api/v1/projects`, { method: 'POST', ca: cert,
    headers: { origin: publicOrigin, cookie: `ow_session=${sessionId}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }, body: payload });
  assert.equal(created.status, 201, created.body);
  const projectList = await requestHttps(`${publicOrigin}/api/v1/projects`, { ca: cert,
    headers: { cookie: `ow_session=${sessionId}` } });
  assert.equal(projectList.status, 200);
  assert.equal(JSON.parse(projectList.body).data.length, 1);
  const wrongOrigin = await requestHttps(`${publicOrigin}/api/v1/projects`, { method: 'POST', ca: cert,
    headers: { origin: 'https://attacker.example', cookie: `ow_session=${sessionId}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }, body: payload });
  assert.equal(wrongOrigin.status, 403);
  assert.equal(JSON.parse(wrongOrigin.body).error.code, 'CROSS_SITE_REQUEST_DENIED');

  await new Promise((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
  await app.close();
  app = null;
  app = createApp(appOptions);
  await app.init();
  await new Promise((resolve, reject) => app.server.listen(upstreamPort, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  const restartedList = await requestHttps(`${publicOrigin}/api/v1/projects`, { ca: cert,
    headers: { cookie: `ow_session=${sessionId}` } });
  assert.equal(restartedList.status, 200);
  assert.equal(JSON.parse(restartedList.body).data.length, 1);

  const logout = await requestHttps(`${publicOrigin}/auth/logout`, { method: 'POST', ca: cert,
    headers: { origin: publicOrigin, cookie: `ow_session=${sessionId}` } });
  assert.equal(logout.status, 303);
  assert.ok((Array.isArray(logout.headers['set-cookie']) ? logout.headers['set-cookie'] : [logout.headers['set-cookie']])
    .some((value) => value.startsWith('ow_session=') && /; Secure/.test(value)));
  const afterLogout = await requestHttps(`${publicOrigin}/api/v1/projects`, { ca: cert,
    headers: { cookie: `ow_session=${sessionId}` } });
  assert.equal(afterLogout.status, 401);
  for (const response of [login, authorization, callback, created, projectList, wrongOrigin, logout, afterLogout]) {
    assert.equal(response.body.includes(postgres.databaseUrl), false);
    assert.equal(response.body.includes(secretCanary), false);
  }
});
