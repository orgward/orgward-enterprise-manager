import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, readFile, symlink, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../server.mjs';
import { runInstallPreflight, parseInstallConfig } from '../../src/platform/install-config.mjs';
import { startPostgres } from '../helpers/postgres.mjs';

const KEY = Buffer.alloc(32, 7).toString('base64');
function env(databaseUrl, overrides = {}) {
  return { ORGWARD_AUTH_MODE: 'development', ORGWARD_DATABASE_URL: databaseUrl,
    ORGWARD_SECRET_ENCRYPTION_KEY: KEY, ...overrides };
}

test('preflight reports actionable config errors without exposing secrets', () => {
  const result = parseInstallConfig(env(undefined, { HOST: '0.0.0.0', ORGWARD_OPENAI_MODEL: 'm', ORGWARD_SECRET_ENCRYPTION_KEY: undefined }));
  assert.ok(result.issues.some((issue) => issue.check === 'listener-security'));
  assert.ok(result.issues.some((issue) => issue.check === 'openai-profile'));
  assert.ok(result.issues.some((issue) => issue.check === 'database-config'));
  assert.ok(result.issues.every((issue) => !JSON.stringify(issue).includes(KEY)));
  assert.ok(parseInstallConfig(env('not-a-url')).issues.some((issue) => issue.check === 'database-url'));
  assert.ok(parseInstallConfig(env(undefined), '20.1.0').issues.some((issue) => issue.check === 'node'));
  const oidc = parseInstallConfig(env(undefined, {
    ORGWARD_AUTH_MODE: 'oidc', ORGWARD_PUBLIC_URL: 'https://studio.example.test',
    ORGWARD_OIDC_ISSUER: 'https://identity.example.test', ORGWARD_OIDC_AUDIENCE: 'api',
    ORGWARD_OIDC_JWKS_URI: 'https://identity.example.test/jwks', ORGWARD_OIDC_CLIENT_ID: 'web',
    ORGWARD_OIDC_REDIRECT_URI: 'https://other.example.test/auth/callback',
    ORGWARD_OIDC_AUTHORIZATION_ENDPOINT: 'https://identity.example.test/authorize',
    ORGWARD_OIDC_TOKEN_ENDPOINT: 'https://identity.example.test/token',
    ORGWARD_OIDC_TENANT_BINDINGS: '{"provider":"tenant"}',
  }));
  assert.ok(oidc.issues.some((issue) => issue.check === 'oidc-redirect'));
});

test('protected file inputs enforce source exclusivity, file safety, bounds, and redacted errors', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ow-install-secrets-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databaseFile = path.join(directory, 'database-url');
  const keyFile = path.join(directory, 'secret-key');
  const expectedDatabaseUrl = 'postgresql://orgward:private-canary@localhost/orgward';
  await writeFile(databaseFile, `${expectedDatabaseUrl}\n`, { mode: 0o600 });
  await writeFile(keyFile, `${KEY}\n`, { mode: 0o600 });
  await chmod(databaseFile, 0o600);
  await chmod(keyFile, 0o600);
  const fileEnv = () => env(undefined, {
    ORGWARD_DATABASE_URL: undefined,
    ORGWARD_DATABASE_URL_FILE: databaseFile,
    ORGWARD_SECRET_ENCRYPTION_KEY: undefined,
    ORGWARD_SECRET_ENCRYPTION_KEY_FILE: keyFile,
  });
  const valid = parseInstallConfig(fileEnv());
  assert.deepEqual(valid.issues, []);
  assert.equal(valid.config.databaseUrl, expectedDatabaseUrl);
  assert.deepEqual(valid.config.secretEncryptionKey, Buffer.from(KEY, 'base64'));

  const conflict = parseInstallConfig(env(expectedDatabaseUrl, {
    ORGWARD_DATABASE_URL_FILE: databaseFile,
    ORGWARD_SECRET_ENCRYPTION_KEY: KEY,
    ORGWARD_SECRET_ENCRYPTION_KEY_FILE: keyFile,
  }));
  assert.ok(conflict.issues.some((issue) => issue.check === 'orgward_database_url-source'));
  assert.ok(conflict.issues.some((issue) => issue.check === 'orgward_secret_encryption_key-source'));
  assert.ok(!JSON.stringify(conflict.issues).includes(expectedDatabaseUrl));
  assert.ok(!JSON.stringify(conflict.issues).includes(databaseFile));

  const linkFile = path.join(directory, 'secret-link');
  await symlink(keyFile, linkFile);
  const symlinkResult = parseInstallConfig({ ...fileEnv(), ORGWARD_SECRET_ENCRYPTION_KEY_FILE: linkFile });
  assert.ok(symlinkResult.issues.some((issue) => issue.check === 'orgward_secret_encryption_key_file'));
  assert.ok(!JSON.stringify(symlinkResult.issues).includes(linkFile));

  await chmod(keyFile, 0o644);
  const looseMode = parseInstallConfig(fileEnv());
  assert.ok(looseMode.issues.some((issue) => issue.check === 'orgward_secret_encryption_key_file'));
  await chmod(keyFile, 0o600);

  const missingPath = path.join(directory, 'missing-secret-file');
  const missing = parseInstallConfig({ ...fileEnv(), ORGWARD_SECRET_ENCRYPTION_KEY_FILE: missingPath });
  assert.ok(missing.issues.some((issue) => issue.check === 'orgward_secret_encryption_key_file'));
  assert.ok(!JSON.stringify(missing.issues).includes(missingPath));
  const relativePath = parseInstallConfig({ ...fileEnv(), ORGWARD_SECRET_ENCRYPTION_KEY_FILE: 'relative-secret-file' });
  assert.ok(relativePath.issues.some((issue) => issue.check === 'orgward_secret_encryption_key_file'));
  const invalidConfiguredPath = parseInstallConfig({ ...fileEnv(), ORGWARD_SECRET_ENCRYPTION_KEY_FILE: null });
  assert.ok(invalidConfiguredPath.issues.some((issue) => issue.check === 'orgward_secret_encryption_key_file'));

  const oversizedFile = path.join(directory, 'oversized-key');
  await writeFile(oversizedFile, 'x'.repeat(1025), { mode: 0o600 });
  await chmod(oversizedFile, 0o600);
  const oversized = parseInstallConfig({ ...fileEnv(), ORGWARD_SECRET_ENCRYPTION_KEY_FILE: oversizedFile });
  assert.ok(oversized.issues.some((issue) => issue.check === 'orgward_secret_encryption_key_file'));

  const malformedFile = path.join(directory, 'malformed-key');
  const malformedCanary = 'malformed-private-key-canary';
  await writeFile(malformedFile, malformedCanary, { mode: 0o600 });
  await chmod(malformedFile, 0o600);
  const malformed = parseInstallConfig({ ...fileEnv(), ORGWARD_SECRET_ENCRYPTION_KEY_FILE: malformedFile });
  assert.ok(malformed.issues.some((issue) => issue.check === 'secret-key'));
  assert.ok(!JSON.stringify(malformed.issues).includes(malformedCanary));
  assert.ok(!JSON.stringify(malformed.issues).includes(malformedFile));

  const badDatabaseCanary = 'postgresql://private-database-canary@/bad';
  await writeFile(databaseFile, badDatabaseCanary, { mode: 0o600 });
  const malformedDatabase = parseInstallConfig(fileEnv());
  assert.ok(malformedDatabase.issues.some((issue) => issue.check === 'database-url'));
  assert.ok(!JSON.stringify(malformedDatabase.issues).includes(badDatabaseCanary));
});

test('preflight inspects PostgreSQL read-only and can be repeated', async (t) => {
  const database = await startPostgres();
  t.after(database.close);
  const configured = env(database.databaseUrl, {
    ORGWARD_DATA_DIR: await mkdtemp(path.join(os.tmpdir(), 'ow-preflight-data-')),
  });
  const directory = configured.ORGWARD_DATA_DIR;
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await runInstallPreflight({ env: configured });
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.equal(result.database.uninitialized, true);
    assert.equal(result.database.pendingMigrations, true);
    const state = await database.query("select to_regnamespace('orgward') as schema");
    assert.equal(state.rows[0].schema, null);
  }
  const missingDatabaseUrl = new URL(database.databaseUrl);
  missingDatabaseUrl.pathname += '_missing';
  const failed = await runInstallPreflight({ env: env(missingDatabaseUrl.toString()) });
  assert.equal(failed.ok, false);
  assert.ok(failed.issues.some((issue) => issue.check === 'database-connectivity'));
  assert.ok(!JSON.stringify(failed).includes(database.databaseUrl));
});

test('preflight rejects a non-prefix migration ledger without changing it', async (t) => {
  const database = await startPostgres();
  t.after(database.close);
  const latestFile = new URL('../../migrations/012-secret-revocation-obligations.sql', import.meta.url);
  const checksum = createHash('sha256').update(await readFile(latestFile)).digest('hex');
  await database.query('create schema orgward');
  await database.query('create table orgward.schema_migrations (version text primary key, checksum text not null)');
  await database.query('insert into orgward.schema_migrations(version, checksum) values ($1, $2)', ['012-secret-revocation-obligations', checksum]);
  const result = await runInstallPreflight({ env: env(database.databaseUrl) });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.check === 'database-schema' && issue.message.includes('contiguous prefix')));
  const rows = await database.query('select version from orgward.schema_migrations order by version');
  assert.deepEqual(rows.rows, [{ version: '012-secret-revocation-obligations' }]);
});

test('liveness stays available while readiness fails on lost database', async (t) => {
  const database = await startPostgres();
  t.after(database.close);
  const root = await mkdtemp(path.join(os.tmpdir(), 'ow-ready-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = createApp({ databaseUrl: database.databaseUrl, secretEncryptionKey: Buffer.from(KEY, 'base64'),
    dataDirectory: path.join(root, 'projects'), sdlcDirectory: path.join(root, 'sdlc'),
    executionDirectory: path.join(root, 'runs') });
  await app.init();
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await new Promise((resolve) => app.server.close(resolve)); await app.close(); });
  assert.equal((await fetch(`${base}/livez`)).status, 200);
  assert.equal((await fetch(`${base}/readyz`)).status, 200);
  await database.close();
  assert.equal((await fetch(`${base}/livez`)).status, 200);
  const response = await fetch(`${base}/readyz`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: 'not_ready', dependency: 'database' });
});
