import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { request as httpRequest, createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { createServer as createHttpsServer, request as httpsRequest } from 'node:https';
import { gunzipSync, gzipSync } from 'node:zlib';
import { chmod, chown, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { buildRelease } from '../../ops/build-release.mjs';
import { installReleaseArchive } from '../../ops/install-release.mjs';
import { startPostgres } from '../helpers/postgres.mjs';

const ROOT = path.resolve('.');
const run = promisify(execFile);
async function freePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}
function requestUrl(urlValue, { method = 'GET', headers = {}, body, ca } = {}) {
  const url = new URL(urlValue);
  const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const request = transport(url, { method, headers, ...(ca ? { ca, rejectUnauthorized: true } : {}) }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}
function createHttpsProxy(upstreamPort, key, cert) {
  return createHttpsServer({ key, cert }, (incoming, outgoing) => {
    const upstreamRequest = httpRequest({ host: '127.0.0.1', port: upstreamPort, method: incoming.method,
      path: incoming.url, headers: { ...incoming.headers, 'x-forwarded-proto': 'https' } }, (upstream) => {
      outgoing.writeHead(upstream.statusCode, upstream.headers);
      upstream.pipe(outgoing);
    });
    upstreamRequest.on('error', () => { outgoing.writeHead(502); outgoing.end(); });
    incoming.pipe(upstreamRequest);
  });
}
async function dependencySetup(directory) {
  if (process.env.ORGWARD_FRESH_INSTALL_QUALIFICATION === '1') {
    await run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: directory, maxBuffer: 2_000_000 });
    const runtimePackage = JSON.parse(await readFile(path.join(directory, 'node_modules/pg/package.json'), 'utf8'));
    const lock = JSON.parse(await readFile(path.join(directory, 'package-lock.json'), 'utf8'));
    assert.equal(runtimePackage.version, lock.packages['node_modules/pg'].version);
    return `fresh registry npm ci; npm=${(await run('npm', ['--version'])).stdout.trim()}; pg=${runtimePackage.version}; lock integrity=${lock.packages['node_modules/pg'].integrity}`;
  }
  try {
    await run('npm', ['ci', '--omit=dev', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: directory, maxBuffer: 2_000_000 });
    return 'offline npm ci';
  } catch (error) {
    const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
    if (!/ENOTCACHED|cache mode is 'only-if-cached'/i.test(output)) {
      throw new Error(`Offline production dependency installation failed for a reason other than unavailable cache: ${output.slice(-2_000)}`);
    }
    await rm(path.join(directory, 'node_modules'), { recursive: true, force: true });
    await cp(path.join(ROOT, 'node_modules'), path.join(directory, 'node_modules'), { recursive: true });
    return 'test-host production dependency copy (offline npm cache unavailable)';
  }
}
function environment(databaseUrl, issuer, providerPort, port = 4310) {
  return { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
    HOST: '127.0.0.1', PORT: String(port), ORGWARD_AUTH_MODE: 'oidc', ORGWARD_PUBLIC_URL: 'https://studio.example.test',
    ORGWARD_DATABASE_URL: databaseUrl, ORGWARD_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
    ORGWARD_OIDC_ISSUER: issuer, ORGWARD_OIDC_AUDIENCE: 'orgward-api',
    ORGWARD_OIDC_JWKS_URI: `${issuer}/jwks`, ORGWARD_OIDC_CLIENT_ID: 'orgward-web',
    ORGWARD_OIDC_REDIRECT_URI: 'https://studio.example.test/auth/callback',
    ORGWARD_OIDC_AUTHORIZATION_ENDPOINT: `${issuer}/authorize`, ORGWARD_OIDC_TOKEN_ENDPOINT: `${issuer}/token`,
    ORGWARD_OIDC_ROLE_MAP: '{"studio-writers":["workspace-read","workspace-write"]}',
    ORGWARD_OIDC_TENANT_BINDINGS: '{"provider-acme":"bundle-smoke"}',
    ORGWARD_OIDC_BOOTSTRAP_PRINCIPALS: JSON.stringify([{ issuer, subject: 'bundle-owner', tenantId: 'bundle-smoke' }]) };
}
async function preflight(directory, env) {
  try { return { code: 0, output: (await run(process.execPath, ['ops/preflight.mjs'], { cwd: directory, env, maxBuffer: 1_000_000 })).stdout }; }
  catch (error) { return { code: error.code ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }; }
}
async function startChild(directory, env) {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output = `${output}${chunk}`.slice(-20_000); });
  child.stderr.on('data', (chunk) => { output = `${output}${chunk}`.slice(-20_000); });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((resolve) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5_000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill('SIGTERM');
    });
  };
  return { child, get output() { return output; }, stop };
}
function startCaddy(binary, configPath, { home, data, config, uid, gid }) {
  const env = { PATH: process.env.PATH, HOME: home, TMPDIR: process.env.TMPDIR,
    XDG_DATA_HOME: data, XDG_CONFIG_HOME: config };
  const child = spawn(binary, ['run', '--config', configPath, '--adapter', 'caddyfile'], {
    cwd: home, env, uid, gid, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let spawnError = false;
  child.on('error', (error) => { spawnError = true; output = `${output}Caddy spawn failed: ${error.message}`.slice(-20_000); });
  child.stdout.on('data', (chunk) => { output = `${output}${chunk}`.slice(-20_000); });
  child.stderr.on('data', (chunk) => { output = `${output}${chunk}`.slice(-20_000); });
  const stop = async () => {
    if (spawnError || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((resolve) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5_000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill('SIGTERM');
    });
  };
  return { child, get output() { return output; }, get spawnError() { return spawnError; }, stop };
}
async function waitCaddyReady(caddy, publicOrigin, rootCertificatePath) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (caddy.spawnError || caddy.child.exitCode !== null || caddy.child.signalCode !== null) throw new Error(`Caddy exited during startup: ${caddy.output}`);
    try {
      const certificate = await readFile(rootCertificatePath);
      const response = await requestUrl(`${publicOrigin}/readyz`, { ca: certificate });
      if (response.status === 200) return certificate;
    } catch { /* wait for Caddy's local CA and listener */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Caddy did not become ready: ${caddy.output}`);
}
async function waitReady(child, base) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.child.exitCode !== null) {
      await new Promise((resolve) => child.child.once('close', resolve));
      throw new Error(`Release service exited before readiness: ${child.output}`);
    }
    try { if ((await fetch(`${base}/readyz`)).status === 200) return; } catch { /* retry until bounded deadline */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Release service did not become ready: ${child.output}`);
}

test('release builder rejects malformed and wrong-type signing keys before creating outputs', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'orgward-release-signing-key-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const invalidKeys = [
    ['malformed', 'not a private PEM'],
    ['wrong-type', privateKey.export({ type: 'pkcs8', format: 'pem' })],
  ];
  for (const [name, signingKeyPem] of invalidKeys) {
    const outputPath = path.join(directory, `${name}.tar.gz`);
    await assert.rejects(buildRelease(outputPath, { signingKeyPem }), /Release signing key/);
    assert.deepEqual(await readdir(directory), [], `${name} key leaves no archive, sidecar, or staging directory`);
  }
});

test('private release bundle extracts cleanly and runs against disposable PostgreSQL', async (t) => {
  const fixture = await startPostgres();
  t.after(fixture.close);
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'orgward-release-bundle-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const caddyBinary = process.env.ORGWARD_CADDY_BIN;
  let tlsKey;
  let tlsCert;
  if (!caddyBinary) {
    const tlsKeyPath = path.join(temporary, 'proxy-key.pem');
    const tlsCertPath = path.join(temporary, 'proxy-cert.pem');
    await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', tlsKeyPath, '-out', tlsCertPath,
      '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1']);
    tlsKey = await readFile(tlsKeyPath);
    tlsCert = await readFile(tlsCertPath);
  }
  const publicPort = await freePort();
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'release-smoke-key', use: 'sig', alg: 'RS256' };
  const authorizationCodes = new Map();
  let issuer;
  const provider = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/jwks') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    const url = new URL(request.url, issuer);
    if (request.method === 'GET' && url.pathname === '/authorize') {
      const code = `bundle-code-${createHash('sha256').update(url.searchParams.get('state')).digest('hex').slice(0, 12)}`;
      authorizationCodes.set(code, { nonce: url.searchParams.get('nonce'), challenge: url.searchParams.get('code_challenge') });
      const callback = new URL(url.searchParams.get('redirect_uri'));
      callback.searchParams.set('state', url.searchParams.get('state'));
      callback.searchParams.set('code', code);
      response.writeHead(302, { location: callback.toString(), 'cache-control': 'no-store' });
      response.end();
      return;
    }
    if (request.method === 'POST' && url.pathname === '/token') {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        const form = new URLSearchParams(Buffer.concat(chunks).toString());
        const authorization = authorizationCodes.get(form.get('code'));
        authorizationCodes.delete(form.get('code'));
        const verifier = form.get('code_verifier');
        if (!authorization || form.get('client_id') !== 'orgward-web' || !verifier
          || createHash('sha256').update(verifier).digest('base64url') !== authorization.challenge) {
          response.writeHead(400); response.end('{}'); return;
        }
        const now = Math.floor(Date.now() / 1000);
        const tokenHeader = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'release-smoke-key' })).toString('base64url');
        const tokenClaims = Buffer.from(JSON.stringify({ iss: issuer, aud: 'orgward-web', sub: 'bundle-owner',
          iat: now, exp: now + 600, nonce: authorization.nonce, orgward_tenant: 'provider-acme', groups: ['studio-writers'] })).toString('base64url');
        const unsigned = `${tokenHeader}.${tokenClaims}`;
        const idToken = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`;
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(JSON.stringify({ id_token: idToken }));
      });
      return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => provider.close(resolve)));
  const providerPort = provider.address().port;
  issuer = `http://127.0.0.1:${providerPort}`;
  const now = Math.floor(Date.now() / 1000);
  const tokenHeader = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'release-smoke-key' })).toString('base64url');
  const tokenClaims = Buffer.from(JSON.stringify({ iss: issuer, aud: 'orgward-api', sub: 'bundle-owner',
    iat: now, exp: now + 600, orgward_tenant: 'provider-acme', groups: ['studio-writers'] })).toString('base64url');
  const unsignedToken = `${tokenHeader}.${tokenClaims}`;
  const bearer = `${unsignedToken}.${sign('RSA-SHA256', Buffer.from(unsignedToken), privateKey).toString('base64url')}`;
  const archivePath = path.join(temporary, 'release.tar.gz');
  const releaseSigner = generateKeyPairSync('ed25519');
  const privateKeyPem = releaseSigner.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const releasePrivateKeyPath = path.join(temporary, 'release-signing-key.pem');
  await writeFile(releasePrivateKeyPath, privateKeyPem, { mode: 0o600 });
  const trustedPublicKeyPem = releaseSigner.publicKey.export({ type: 'spki', format: 'pem' });
  const wrongReleaseSigner = generateKeyPairSync('ed25519');
  const trustedPublicKeyPath = path.join(temporary, 'trusted-release-key.pem');
  await writeFile(trustedPublicKeyPath, trustedPublicKeyPem, { mode: 0o644 });
  const secretCanary = Buffer.alloc(32, 9).toString('base64');
  const secretInputDirectory = path.join(temporary, 'secret-inputs');
  await mkdir(secretInputDirectory, { mode: 0o700 });
  const databaseUrlFile = path.join(secretInputDirectory, 'database-url');
  const encryptionKeyFile = path.join(secretInputDirectory, 'encryption-key');
  await writeFile(databaseUrlFile, `${fixture.databaseUrl}\n`, { mode: 0o600 });
  await writeFile(encryptionKeyFile, `${secretCanary}\n`, { mode: 0o600 });
  await chmod(databaseUrlFile, 0o600);
  await chmod(encryptionKeyFile, 0o600);
  const previousSigningKeyPath = process.env.ORGWARD_RELEASE_SIGNING_KEY_FILE;
  process.env.ORGWARD_RELEASE_SIGNING_KEY_FILE = releasePrivateKeyPath;
  let built;
  try { built = await buildRelease(archivePath); }
  finally {
    if (previousSigningKeyPath === undefined) delete process.env.ORGWARD_RELEASE_SIGNING_KEY_FILE;
    else process.env.ORGWARD_RELEASE_SIGNING_KEY_FILE = previousSigningKeyPath;
  }
  const archiveNames = (await run('tar', ['-tzf', archivePath])).stdout;
  assert.doesNotMatch(archiveNames, /(?:^|\/)(?:\.git|data|tests|node_modules)(?:\/|$)/);
  assert.doesNotMatch(archiveNames, /(?:^|\/)(?:\.env|[^/]+\.log)$/);
  const archiveBytes = await readFile(archivePath);
  const signatureBytes = await readFile(`${archivePath}.sig`, 'utf8');
  assert.match(signatureBytes, /^orgward-release-signature-v1:[A-Za-z0-9+/]{86}==\n$/);
  assert.equal(archiveBytes.includes(privateKeyPem), false);
  assert.equal(archiveBytes.includes(secretCanary), false);

  const releaseParent = path.join(temporary, 'releases');
  await mkdir(releaseParent, { mode: 0o700 });
  const wrongDigestParent = path.join(temporary, 'wrong-digest');
  await mkdir(wrongDigestParent, { mode: 0o700 });
  const installOptions = { archivePath, trustedPublicKeyPem, destinationParent: wrongDigestParent };
  assert.throws(() => installReleaseArchive({ ...installOptions, signaturePath: path.join(temporary, 'missing.sig') }), /signature/);
  assert.deepEqual(await readdir(wrongDigestParent), []);
  const wrongKeyOptions = { ...installOptions, trustedPublicKeyPem: wrongReleaseSigner.publicKey.export({ type: 'spki', format: 'pem' }) };
  assert.throws(() => installReleaseArchive(wrongKeyOptions), /signature/);
  assert.deepEqual(await readdir(wrongDigestParent), []);
  assert.throws(() => installReleaseArchive({ ...installOptions, trustedPublicKeyPem: 'not a PEM key' }), /public key/);
  assert.deepEqual(await readdir(wrongDigestParent), []);
  assert.throws(() => installReleaseArchive({ archivePath, destinationParent: wrongDigestParent }), /public key/);
  assert.deepEqual(await readdir(wrongDigestParent), []);
  assert.throws(() => installReleaseArchive({ ...installOptions, signaturePath: archivePath }), /signature/);
  assert.deepEqual(await readdir(wrongDigestParent), []);
  const tamperedArchivePath = path.join(temporary, 'tampered.tar.gz');
  const tamperedBytes = Buffer.from(archiveBytes);
  tamperedBytes[0] ^= 1;
  await writeFile(tamperedArchivePath, tamperedBytes, { mode: 0o600 });
  const recomputedTamperedChecksum = createHash('sha256').update(tamperedBytes).digest('hex');
  assert.notEqual(recomputedTamperedChecksum, built.checksum);
  await writeFile(`${temporary}/tampered.tar.gz.sha256`, `${recomputedTamperedChecksum}  tampered.tar.gz\n`, { mode: 0o600 });
  const tamperedSignaturePath = `${tamperedArchivePath}.sig`;
  await writeFile(tamperedSignaturePath, signatureBytes, { mode: 0o600 });
  assert.throws(() => installReleaseArchive({ archivePath: tamperedArchivePath, signaturePath: tamperedSignaturePath, trustedPublicKeyPem, destinationParent: wrongDigestParent }), /signature/);
  assert.deepEqual(await readdir(wrongDigestParent), []);
  const malformedSignaturePath = path.join(temporary, 'malformed.sig');
  await writeFile(malformedSignaturePath, 'not-a-signature\n', { mode: 0o600 });
  assert.throws(() => installReleaseArchive({ ...installOptions, signaturePath: malformedSignaturePath }), /signature/);
  assert.deepEqual(await readdir(wrongDigestParent), []);
  const modifiedTar = gunzipSync(archiveBytes);
  const marker = modifiedTar.indexOf(Buffer.from('export function createApp'));
  assert.notEqual(marker, -1);
  modifiedTar[marker] ^= 1;
  const modifiedManifestHashArchive = gzipSync(modifiedTar);
  const modifiedManifestHashPath = path.join(temporary, 'modified-file.tar.gz');
  await writeFile(modifiedManifestHashPath, modifiedManifestHashArchive, { mode: 0o600 });
  const modifiedSignaturePath = `${modifiedManifestHashPath}.sig`;
  await writeFile(modifiedSignaturePath, signatureBytes, { mode: 0o600 });
  assert.throws(() => installReleaseArchive({ archivePath: modifiedManifestHashPath, signaturePath: modifiedSignaturePath, trustedPublicKeyPem, destinationParent: wrongDigestParent }), /signature/);
  assert.deepEqual(await readdir(wrongDigestParent), []);
  const installCommand = await run('npm', ['run', 'release:install', '--', archivePath, trustedPublicKeyPath, releaseParent], { cwd: ROOT, maxBuffer: 1_000_000 });
  assert.match(installCommand.stdout, /Installed signature-verified orgward-enterprise-studio-/);
  const installed = { name: built.name, destination: path.join(releaseParent, built.name) };
  assert.equal(installed.name, built.name);
  const directory = installed.destination;
  const installedServer = await readFile(path.join(directory, 'server.mjs'));
  assert.throws(() => installReleaseArchive({ archivePath, trustedPublicKeyPem, destinationParent: releaseParent }), /already exists/);
  assert.deepEqual(await readFile(path.join(directory, 'server.mjs')), installedServer);
  const packageJson = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  assert.deepEqual(packageJson.scripts, {
    start: 'node server.mjs', preflight: 'node ops/preflight.mjs',
    'db:backup': 'node ops/database-recovery.mjs backup', 'db:restore': 'node ops/database-recovery.mjs restore',
  });
  const lock = JSON.parse(await readFile(path.join(directory, 'package-lock.json'), 'utf8'));
  assert.deepEqual(lock.packages[''].dependencies, packageJson.dependencies);
  assert.equal(lock.packages['node_modules/pg'].version, packageJson.dependencies.pg);
  assert.ok(await readFile(path.join(directory, 'ops/preflight.mjs')));
  assert.ok(await readFile(path.join(directory, 'ops/database-recovery.mjs')));
  assert.ok(await readFile(path.join(directory, 'migrations/012-secret-revocation-obligations.sql')));
  assert.ok(await readFile(path.join(directory, 'public/platform.html')));
  assert.ok(await readFile(path.join(directory, 'workers/scaffold-node-service.mjs')));
  const configTemplate = await readFile(path.join(directory, 'config.example.env'), 'utf8');
  assert.match(configTemplate, /ORGWARD_SECRET_ENCRYPTION_KEY_FILE=\/run\/secrets\/orgward\/secret-encryption-key/);
  assert.match(configTemplate, /ORGWARD_DATABASE_URL_FILE=\/run\/secrets\/orgward\/database-url/);
  assert.match(configTemplate, /ORGWARD_OIDC_BOOTSTRAP_PRINCIPALS='\[/);
  const serviceExample = await readFile(path.join(directory, 'examples/orgward.service'), 'utf8');
  assert.match(serviceExample, /ExecStartPre=\/usr\/bin\/env node .*preflight/);
  assert.match(serviceExample, /ExecStart=\/usr\/bin\/env node .*server\.mjs/);
  assert.match(serviceExample, /User=orgward/);
  const installGuide = await readFile(path.join(directory, 'INSTALL.md'), 'utf8');
  assert.match(installGuide, /unit PATH resolves Node 22\+/);
  assert.match(installGuide, /owner-only regular files/);
  assert.match(installGuide, /detached Ed25519 signature/);
  assert.match(installGuide, /ORGWARD_RELEASE_SIGNING_KEY_FILE/);
  assert.match(installGuide, /ORGWARD_RESTORE_DATABASE_URL_FILE/);
  assert.match(installGuide, /pg_restore --single-transaction/);
  const manifest = JSON.parse(await readFile(path.join(directory, 'release-manifest.json'), 'utf8'));
  for (const [relative, expectedHash] of Object.entries(manifest.files)) {
    const content = await readFile(path.join(directory, relative));
    const actualHash = createHash('sha256').update(content).digest('hex');
    assert.equal(actualHash, expectedHash, relative);
    assert.equal(content.includes(secretCanary), false, relative);
  }

  const dependencyMode = await dependencySetup(directory);
  t.diagnostic(`release runtime dependencies: ${dependencyMode}`);
  const validEnv = environment(fixture.databaseUrl, issuer, providerPort);
  const publicOrigin = `https://127.0.0.1:${publicPort}`;
  validEnv.ORGWARD_PUBLIC_URL = publicOrigin;
  validEnv.ORGWARD_OIDC_REDIRECT_URI = `${publicOrigin}/auth/callback`;
  delete validEnv.ORGWARD_DATABASE_URL;
  validEnv.ORGWARD_DATABASE_URL_FILE = databaseUrlFile;
  delete validEnv.ORGWARD_SECRET_ENCRYPTION_KEY;
  validEnv.ORGWARD_SECRET_ENCRYPTION_KEY_FILE = encryptionKeyFile;
  const missingKeyEnv = { ...validEnv };
  delete missingKeyEnv.ORGWARD_SECRET_ENCRYPTION_KEY_FILE;
  const missingKey = await preflight(directory, missingKeyEnv);
  assert.notEqual(missingKey.code, 0);
  assert.match(missingKey.output, /secret encryption key/i);
  assert.equal(missingKey.output.includes(fixture.databaseUrl), false);
  assert.equal(missingKey.output.includes(encryptionKeyFile), false);
  const insecure = await preflight(directory, { ...validEnv, ORGWARD_PUBLIC_URL: 'http://studio.example.test' });
  assert.notEqual(insecure.code, 0);
  assert.match(insecure.output, /ORGWARD_PUBLIC_URL/);

  const cleanPreflight = await preflight(directory, validEnv);
  assert.equal(cleanPreflight.code, 0, cleanPreflight.output);
  assert.match(cleanPreflight.output, /Preflight passed/);
  assert.equal((await fixture.query("select to_regnamespace('orgward') as schema")).rows[0].schema, null);

  const port = await freePort();
  const env = environment(fixture.databaseUrl, issuer, providerPort, port);
  env.ORGWARD_PUBLIC_URL = publicOrigin;
  env.ORGWARD_OIDC_REDIRECT_URI = `${publicOrigin}/auth/callback`;
  delete env.ORGWARD_DATABASE_URL;
  env.ORGWARD_DATABASE_URL_FILE = databaseUrlFile;
  delete env.ORGWARD_SECRET_ENCRYPTION_KEY;
  env.ORGWARD_SECRET_ENCRYPTION_KEY_FILE = encryptionKeyFile;
  const base = `http://127.0.0.1:${port}`;
  let serviceProcess = await startChild(directory, env);
  t.after(() => serviceProcess.stop());
  await waitReady(serviceProcess, base);
  assert.equal((await fetch(`${base}/livez`)).status, 200);
  assert.equal((await fetch(`${base}/readyz`)).status, 200);
  const create = await fetch(`${base}/api/v1/projects`, { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ schemaVersion: '1.0', commandId: 'release-bundle-project', payload: { name: 'Release smoke project' } }),
  });
  const created = await create.json();
  assert.equal(create.status, 201, JSON.stringify(created));
  await serviceProcess.stop();
  assert.ok(!serviceProcess.output.includes(secretCanary));
  assert.ok(!serviceProcess.output.includes(encryptionKeyFile));
  assert.ok(!serviceProcess.output.includes(databaseUrlFile));
  assert.ok(!serviceProcess.output.includes(fixture.databaseUrl));

  serviceProcess = await startChild(directory, env);
  await waitReady(serviceProcess, base);
  const projects = await fetch(`${base}/api/v1/projects`, { headers: { authorization: `Bearer ${bearer}` } });
  assert.equal(projects.status, 200);
  assert.deepEqual((await projects.json()).data.map((project) => project.id), [created.data.id]);

  if (caddyBinary) {
    assert.ok(path.isAbsolute(caddyBinary), 'ORGWARD_CADDY_BIN must be an absolute executable path');
    const bundleCaddyfile = await readFile(path.join(directory, 'examples/Caddyfile'), 'utf8');
    assert.match(bundleCaddyfile, /orgward\.example\.com/);
    assert.match(bundleCaddyfile, /reverse_proxy 127\.0\.0\.1:4310/);
    const adaptedSite = bundleCaddyfile.replace('orgward.example.com', `127.0.0.1:${publicPort}`)
      .replace('  reverse_proxy 127.0.0.1:4310', `  bind 127.0.0.1\n  tls internal\n  reverse_proxy 127.0.0.1:${port}`);
    const caddyConfig = path.join(temporary, 'Caddyfile');
    await writeFile(caddyConfig, `{\n  admin off\n  auto_https disable_redirects\n  skip_install_trust\n}\n${adaptedSite}`, { mode: 0o600 });
    const caddyUid = process.getuid() === 0 ? 65534 : process.getuid();
    const caddyGid = process.getuid() === 0 ? 65534 : process.getgid();
    assert.ok(caddyUid > 0, 'Caddy must run as an unprivileged user');
    const caddyHome = path.join(temporary, 'caddy-home');
    const caddyData = path.join(temporary, 'caddy-data');
    const caddyConfigHome = path.join(temporary, 'caddy-config');
    await Promise.all([mkdir(caddyHome, { mode: 0o700 }), mkdir(caddyData, { mode: 0o700 }), mkdir(caddyConfigHome, { mode: 0o700 })]);
    if (caddyUid !== process.getuid()) {
      await Promise.all([chown(caddyHome, caddyUid, caddyGid), chown(caddyData, caddyUid, caddyGid), chown(caddyConfigHome, caddyUid, caddyGid)]);
      await chown(caddyConfig, caddyUid, caddyGid);
      await chmod(temporary, 0o755);
    }
    const rootCertificatePath = path.join(caddyData, 'caddy', 'pki', 'authorities', 'local', 'root.crt');

    // Prove a bad Caddy startup fails closed, cleans up, and does not leak environment secrets.
    const conflictPort = await freePort();
    const failureConfig = path.join(temporary, 'Caddy-failurefile');
    await writeFile(failureConfig, `{\n admin off\n auto_https disable_redirects\n skip_install_trust\n}\n127.0.0.1:${conflictPort} {\n bind 127.0.0.1\n unsupported_orgward_test_directive\n}\n`, { mode: 0o600 });
    if (caddyUid !== process.getuid()) await chown(failureConfig, caddyUid, caddyGid);
    const failedCaddy = startCaddy(caddyBinary, failureConfig, { home: caddyHome, data: caddyData, config: caddyConfigHome, uid: caddyUid, gid: caddyGid });
    t.after(() => failedCaddy.stop());
    const failureCode = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Caddy startup failure path hung: ${failedCaddy.output}`)), 10_000);
      failedCaddy.child.once('error', reject);
      failedCaddy.child.once('exit', (code) => { clearTimeout(timer); resolve(code); });
    });
    assert.notEqual(failureCode, 0, failedCaddy.output);
    assert.match(failedCaddy.output, /unrecognized directive|adapt|directive/i);
    for (const secret of [secretCanary, fixture.databaseUrl, encryptionKeyFile, databaseUrlFile]) assert.equal(failedCaddy.output.includes(secret), false);

    const caddy = startCaddy(caddyBinary, caddyConfig, { home: caddyHome, data: caddyData, config: caddyConfigHome, uid: caddyUid, gid: caddyGid });
    t.after(() => caddy.stop());
    tlsCert = await waitCaddyReady(caddy, publicOrigin, rootCertificatePath);
    const sockets = (await run('ss', ['-H', '-lnptu', 'sport', '=', `:${publicPort}`])).stdout.trim().split('\n').filter(Boolean);
    assert.ok(sockets.length > 0, 'Caddy loopback listener should be visible');
    assert.ok(sockets.every((line) => /^127\.0\.0\.1:\d+$/.test(line.trim().split(/\s+/)[4] ?? '')), sockets.join('\n'));
    assert.ok(!caddy.output.includes(secretCanary));
    assert.ok(!caddy.output.includes(fixture.databaseUrl));
    assert.ok(!caddy.output.includes(encryptionKeyFile));
    assert.ok(!caddy.output.includes(databaseUrlFile));
    t.diagnostic(`reverse proxy qualification: Caddy ${((await run(caddyBinary, ['version'])).stdout).trim()}, unprivileged uid ${caddyUid}, loopback-only listener`);
  } else {
    const proxy = createHttpsProxy(port, tlsKey, tlsCert);
    await new Promise((resolve) => proxy.listen(publicPort, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => proxy.close(resolve)));
  }
  const login = await requestUrl(`${publicOrigin}/auth/login?returnTo=%2F%3Fview%3Dmap`, { ca: tlsCert });
  assert.equal(login.status, 302);
  const loginCookies = Array.isArray(login.headers['set-cookie']) ? login.headers['set-cookie'] : [login.headers['set-cookie']];
  const loginCookie = loginCookies.find((value) => value.startsWith('ow_login='));
  assert.ok(loginCookie);
  assert.match(loginCookie, /HttpOnly/);
  assert.match(loginCookie, /SameSite=Lax/);
  assert.match(loginCookie, /; Secure/);
  const authorizeUrl = new URL(login.headers.location);
  assert.equal(authorizeUrl.origin, issuer);
  const authorization = await requestUrl(authorizeUrl);
  assert.equal(authorization.status, 302);
  const callbackUrl = new URL(authorization.headers.location);
  assert.equal(callbackUrl.origin, publicOrigin);
  assert.equal(callbackUrl.searchParams.get('state'), authorizeUrl.searchParams.get('state'));
  const loginState = loginCookie.match(/^ow_login=([^;]+)/)[1];
  const callback = await requestUrl(callbackUrl, { ca: tlsCert, headers: { cookie: `ow_login=${loginState}` } });
  assert.equal(callback.status, 303, callback.body);
  assert.equal(callback.headers.location, '/?view=map');
  const callbackCookies = Array.isArray(callback.headers['set-cookie']) ? callback.headers['set-cookie'] : [callback.headers['set-cookie']];
  const sessionCookie = callbackCookies.find((value) => value.startsWith('ow_session='));
  assert.ok(sessionCookie);
  assert.match(sessionCookie, /HttpOnly/);
  assert.match(sessionCookie, /SameSite=Lax/);
  assert.match(sessionCookie, /; Secure/);
  const sessionId = sessionCookie.match(/^ow_session=([^;]+)/)[1];

  const browserPayload = JSON.stringify({ schemaVersion: '1.0', commandId: 'release-bundle-browser-project', payload: { name: 'HTTPS browser project' } });
  const browserCreate = await requestUrl(`${publicOrigin}/api/v1/projects`, { method: 'POST', ca: tlsCert,
    headers: { origin: publicOrigin, cookie: `ow_session=${sessionId}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(browserPayload) }, body: browserPayload });
  assert.equal(browserCreate.status, 201, browserCreate.body);
  const browserProject = JSON.parse(browserCreate.body);
  const wrongOrigin = await requestUrl(`${publicOrigin}/api/v1/projects`, { method: 'POST', ca: tlsCert,
    headers: { origin: 'https://attacker.example', cookie: `ow_session=${sessionId}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(browserPayload) }, body: browserPayload });
  assert.equal(wrongOrigin.status, 403);
  assert.equal(JSON.parse(wrongOrigin.body).error.code, 'CROSS_SITE_REQUEST_DENIED');
  const browserList = await requestUrl(`${publicOrigin}/api/v1/projects`, { ca: tlsCert, headers: { cookie: `ow_session=${sessionId}` } });
  assert.equal(browserList.status, 200);
  assert.deepEqual(JSON.parse(browserList.body).data.map((project) => project.id).sort(), [created.data.id, browserProject.data.id].sort());

  await serviceProcess.stop();
  const stoppedProcess = serviceProcess;
  serviceProcess = await startChild(directory, env);
  await waitReady(serviceProcess, base);
  assert.ok(!stoppedProcess.output.includes(secretCanary));
  assert.ok(!stoppedProcess.output.includes(encryptionKeyFile));
  assert.ok(!stoppedProcess.output.includes(databaseUrlFile));
  assert.ok(!stoppedProcess.output.includes(fixture.databaseUrl));
  const afterRestart = await requestUrl(`${publicOrigin}/api/v1/projects`, { ca: tlsCert, headers: { cookie: `ow_session=${sessionId}` } });
  assert.equal(afterRestart.status, 200);
  assert.deepEqual(JSON.parse(afterRestart.body).data.map((project) => project.id).sort(), [created.data.id, browserProject.data.id].sort());
  const logout = await requestUrl(`${publicOrigin}/auth/logout`, { method: 'POST', ca: tlsCert,
    headers: { origin: publicOrigin, cookie: `ow_session=${sessionId}` } });
  assert.equal(logout.status, 303);
  const logoutCookies = Array.isArray(logout.headers['set-cookie']) ? logout.headers['set-cookie'] : [logout.headers['set-cookie']];
  assert.ok(logoutCookies.some((value) => value.startsWith('ow_session=') && /; Secure/.test(value)));
  const deniedAfterLogout = await requestUrl(`${publicOrigin}/api/v1/projects`, { ca: tlsCert,
    headers: { cookie: `ow_session=${sessionId}` } });
  assert.equal(deniedAfterLogout.status, 401);
  for (const response of [login, authorization, callback, browserCreate, browserList, wrongOrigin, afterRestart, logout, deniedAfterLogout]) {
    assert.equal(response.body.includes(fixture.databaseUrl), false);
    assert.equal(response.body.includes(secretCanary), false);
    assert.equal(response.body.includes(encryptionKeyFile), false);
    assert.equal(response.body.includes(databaseUrlFile), false);
  }
  assert.ok(!serviceProcess.output.includes(secretCanary));
  assert.ok(!serviceProcess.output.includes(encryptionKeyFile));
  assert.ok(!serviceProcess.output.includes(databaseUrlFile));
  assert.ok(!serviceProcess.output.includes(fixture.databaseUrl));
});
