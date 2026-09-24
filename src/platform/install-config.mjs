import { access, lstat, realpath } from 'node:fs/promises';
import { closeSync, constants as fsConstants, fstatSync, openSync, readSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { decodeSecretEncryptionKey } from './secrets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS = path.join(ROOT, 'migrations');
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const MIN_POSTGRES_VERSION = 160_000;

function add(issues, check, message, remedy, severity = 'error') { issues.push({ check, message, remedy, severity }); }

function protectedFileValue(env, inlineName, fileName, issues, { maxBytes }) {
  const inlineConfigured = Object.hasOwn(env, inlineName) && env[inlineName] !== undefined;
  const inline = typeof env[inlineName] === 'string' && env[inlineName] !== '' ? env[inlineName] : null;
  const fileConfigured = Object.hasOwn(env, fileName) && env[fileName] !== undefined;
  if (inlineConfigured && fileConfigured) {
    add(issues, `${inlineName.toLowerCase()}-source`, `${inlineName} and ${fileName} cannot both be set.`, `Set exactly one of ${inlineName} or ${fileName}.`);
    return null;
  }
  if (!fileConfigured) return inline;
  const filePath = env[fileName];
  let descriptor;
  try {
    if (typeof filePath !== 'string' || !filePath.trim() || !path.isAbsolute(filePath) || !Number.isInteger(fsConstants.O_NOFOLLOW)) throw new Error('unsafe input');
    descriptor = openSync(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | (fsConstants.O_CLOEXEC ?? 0));
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0 || (metadata.mode & 0o400) === 0 || metadata.size > maxBytes) throw new Error('unsafe input');
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > maxBytes || fstatSync(descriptor).size > maxBytes) throw new Error('unsafe input');
    let value = buffer.subarray(0, length).toString('utf8');
    if (value.endsWith('\r\n')) value = value.slice(0, -2);
    else if (value.endsWith('\n')) value = value.slice(0, -1);
    if (/[\r\n]/.test(value)) throw new Error('unsafe input');
    return value;
  } catch {
    add(issues, fileName.toLowerCase(), `${fileName} must refer to a readable, owner-only regular file within the size limit.`, `Provide ${fileName} as a protected regular file readable by the OrgWard service account; do not include its path or contents in support logs.`);
    return null;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function readProtectedDatabaseUrlFile(filePath, variableName = 'ORGWARD_DATABASE_URL_FILE') {
  if (!['ORGWARD_DATABASE_URL_FILE', 'ORGWARD_RESTORE_DATABASE_URL_FILE'].includes(variableName)) {
    throw new Error('A supported protected database URL file variable is required.');
  }
  const issues = [];
  const value = protectedFileValue({ [variableName]: filePath }, 'ORGWARD_DATABASE_URL', variableName, issues, { maxBytes: 16_384 });
  if (!value || issues.length) throw new Error(`${variableName} must refer to a readable owner-only regular file.`);
  return value;
}

function parseJsonObject(raw, label, issues, { required = false } = {}) {
  if (raw == null || raw === '') {
    if (required) add(issues, label, `${label} is required.`, `Set ${label} to a valid JSON object with at least one mapping.`);
    return null;
  }
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    add(issues, label, `${label} must be a JSON object.`, `Replace ${label} with valid JSON object syntax.`);
    return null;
  }
}

function isLoopbackUrl(value) {
  try { return LOOPBACK.has(new URL(value).hostname); } catch { return false; }
}

function validateHttpsUrl(value, label, issues, { allowLoopbackHttp = true } = {}) {
  let url;
  try { url = new URL(value); } catch {
    add(issues, label, `${label} must be an absolute HTTP(S) URL.`, `Set ${label} to the exact provider URL.`);
    return false;
  }
  const httpLoopback = allowLoopbackHttp && url.protocol === 'http:' && LOOPBACK.has(url.hostname);
  if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !httpLoopback)) {
    add(issues, label, `${label} must use HTTPS and must not contain URL credentials or a fragment.`, `Use an HTTPS endpoint; HTTP is accepted only for loopback development URLs.`);
    return false;
  }
  return true;
}

export function parseInstallConfig(env = process.env, nodeVersion = process.versions.node) {
  const issues = [];
  const nodeMajor = Number(String(nodeVersion).split('.')[0]);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 22) add(issues, 'node', `Node.js ${nodeVersion || 'unknown'} is unsupported.`, 'Install Node.js 22 or newer, then rerun the preflight.');

  const host = env.HOST || '127.0.0.1';
  const port = Number(env.PORT || 4310);
  const authMode = env.ORGWARD_AUTH_MODE || 'oidc';
  if (!Number.isInteger(port) || port < 1 || port > 65_535) add(issues, 'listener', 'PORT must be an integer from 1 through 65535.', 'Set PORT to an unused TCP port in that range.');
  if (!['oidc', 'development'].includes(authMode)) add(issues, 'auth-mode', 'ORGWARD_AUTH_MODE must be oidc or development.', 'Set ORGWARD_AUTH_MODE=oidc for authenticated use.');
  if (authMode === 'development' && !LOOPBACK.has(host)) add(issues, 'listener-security', 'Development header authentication cannot bind to a non-loopback address.', 'Bind HOST to 127.0.0.1, ::1, or localhost; configure OIDC for network access.');
  if (authMode === 'oidc') {
    const publicUrl = env.ORGWARD_PUBLIC_URL;
    let publicOrigin = null;
    if (!publicUrl || !validateHttpsUrl(publicUrl, 'ORGWARD_PUBLIC_URL', issues, { allowLoopbackHttp: false })) {
      if (!issues.some((issue) => issue.check === 'ORGWARD_PUBLIC_URL')) add(issues, 'public-url', 'ORGWARD_PUBLIC_URL is required in OIDC mode, including with a loopback proxy backend.', 'Set ORGWARD_PUBLIC_URL to the HTTPS public origin served by the reverse proxy.');
    } else {
      const parsedPublicUrl = new URL(publicUrl);
      if (parsedPublicUrl.pathname !== '/' || parsedPublicUrl.search) {
        add(issues, 'public-url', 'ORGWARD_PUBLIC_URL must contain only the public HTTPS origin.', 'Set ORGWARD_PUBLIC_URL to the HTTPS origin without a path or query.');
      } else publicOrigin = parsedPublicUrl.origin;
    }
    if (env.ORGWARD_OIDC_REDIRECT_URI && publicOrigin) {
      try {
        const redirect = new URL(env.ORGWARD_OIDC_REDIRECT_URI);
        if (redirect.origin !== publicOrigin || redirect.pathname !== '/auth/callback' || redirect.search || redirect.hash) {
          add(issues, 'oidc-redirect', 'ORGWARD_OIDC_REDIRECT_URI must match ORGWARD_PUBLIC_URL/auth/callback.', 'Set the identity-provider callback and ORGWARD_OIDC_REDIRECT_URI to the exact public origin plus /auth/callback.');
        }
      } catch { /* The OIDC URL validator reports malformed redirect URIs. */ }
    }
    if (!LOOPBACK.has(host) && publicOrigin === null && !issues.some((issue) => issue.check === 'public-url')) {
      add(issues, 'listener-tls', 'A network-bound OIDC listener needs a declared HTTPS public URL.', 'Set ORGWARD_PUBLIC_URL to the HTTPS address served by the TLS-terminating proxy.');
    }
  }

  const databaseUrl = protectedFileValue(env, 'ORGWARD_DATABASE_URL', 'ORGWARD_DATABASE_URL_FILE', issues, { maxBytes: 16_384 }) || null;
  if (!databaseUrl && env.ORGWARD_ALLOW_LEGACY_JSON !== 'true') add(issues, 'database-config', 'A PostgreSQL connection URL is required.', 'Set ORGWARD_DATABASE_URL or provide its protected file through ORGWARD_DATABASE_URL_FILE.');
  if (databaseUrl) {
    try {
      const url = new URL(databaseUrl);
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) throw new Error();
    } catch { add(issues, 'database-url', 'ORGWARD_DATABASE_URL is not a valid PostgreSQL URL.', 'Use postgresql://user@host:5432/database; do not include the URL in support logs.'); }
  }
  let secretEncryptionKey = null;
  const secretEncryptionKeyInput = protectedFileValue(env, 'ORGWARD_SECRET_ENCRYPTION_KEY', 'ORGWARD_SECRET_ENCRYPTION_KEY_FILE', issues, { maxBytes: 1024 });
  if (secretEncryptionKeyInput !== null) {
    try { secretEncryptionKey = decodeSecretEncryptionKey(secretEncryptionKeyInput); }
    catch (error) { add(issues, 'secret-key', error.message, 'Set ORGWARD_SECRET_ENCRYPTION_KEY or its protected file to canonical base64 for one 32-byte key, stored in your secret manager.'); }
  }
  if (databaseUrl && !secretEncryptionKey && !issues.some((issue) => issue.check === 'secret-key')) {
    add(issues, 'secret-key', 'The secret encryption key is required for PostgreSQL installations.', 'Generate one canonical base64 32-byte key, store it in a protected file, and set ORGWARD_SECRET_ENCRYPTION_KEY_FILE (or use the inline variable).');
  }

  const openAiCredentialReference = env.ORGWARD_OPENAI_CREDENTIAL_REFERENCE || null;
  const openAiModel = env.ORGWARD_OPENAI_MODEL || null;
  if (Boolean(openAiCredentialReference) !== Boolean(openAiModel)) add(issues, 'openai-profile', 'OpenAI credential reference and model must be configured together.', 'Set both ORGWARD_OPENAI_CREDENTIAL_REFERENCE and ORGWARD_OPENAI_MODEL, or remove both to disable the profile.');
  if (openAiCredentialReference && !/^secret-[a-z0-9][a-z0-9._-]{0,79}$/.test(openAiCredentialReference)) add(issues, 'openai-reference', 'ORGWARD_OPENAI_CREDENTIAL_REFERENCE has an invalid format.', 'Use secret- followed by a lowercase identifier.');
  if (openAiModel && !/^[A-Za-z0-9._:-]{1,100}$/.test(openAiModel)) add(issues, 'openai-model', 'ORGWARD_OPENAI_MODEL has an invalid format.', 'Set it to the exact model ID from the provider configuration.');

  const openAiAdminInlineConfigured = Object.hasOwn(env, 'ORGWARD_OPENAI_ADMIN_API_KEY') && env.ORGWARD_OPENAI_ADMIN_API_KEY !== undefined;
  const openAiAdminKeyInput = protectedFileValue(
    { ORGWARD_OPENAI_ADMIN_API_KEY_FILE: env.ORGWARD_OPENAI_ADMIN_API_KEY_FILE },
    'ORGWARD_OPENAI_ADMIN_API_KEY', 'ORGWARD_OPENAI_ADMIN_API_KEY_FILE', issues, { maxBytes: 2_048 },
  );
  if (openAiAdminInlineConfigured) add(issues, 'openai-admin-key-source', 'ORGWARD_OPENAI_ADMIN_API_KEY is not accepted; the Admin API key must come from a protected file.', 'Remove the inline variable and configure ORGWARD_OPENAI_ADMIN_API_KEY_FILE as an absolute owner-only regular file.');
  const openAiAdminApiKey = openAiAdminInlineConfigured ? null : openAiAdminKeyInput;
  if (openAiAdminApiKey !== null && (openAiAdminApiKey.length < 8 || /[\r\n]/.test(openAiAdminApiKey))) {
    add(issues, 'openai-admin-key', 'The protected OpenAI Admin API key file contains an invalid value.', 'Provide the Admin API key as one non-empty line in the protected file.');
  }

  const openAiOrganizationId = env.ORGWARD_OPENAI_ORGANIZATION_ID || null;
  if (openAiOrganizationId && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(openAiOrganizationId)) add(issues, 'openai-organization-id', 'ORGWARD_OPENAI_ORGANIZATION_ID has an invalid identifier.', 'Set it to the exact OpenAI organization ID.');
  let openAiTenantProjects = null;
  if (env.ORGWARD_OPENAI_TENANT_PROJECTS) {
    const parsed = parseJsonObject(env.ORGWARD_OPENAI_TENANT_PROJECTS, 'ORGWARD_OPENAI_TENANT_PROJECTS', issues);
    if (parsed) {
      const entries = Object.entries(parsed);
      const projects = entries.map(([, projectId]) => projectId);
      if (!entries.length || entries.some(([tenantId, projectId]) => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(tenantId)
        || typeof projectId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(projectId))
        || new Set(projects).size !== projects.length) {
        add(issues, 'openai-tenant-projects', 'ORGWARD_OPENAI_TENANT_PROJECTS must map valid OrgWard tenant IDs to unique OpenAI project IDs.', 'Provide a non-empty JSON object with one unique project ID per tenant.');
      } else openAiTenantProjects = Object.freeze({ ...parsed });
    }
  }
  const managedOpenAiConfigured = Boolean(openAiAdminApiKey || openAiOrganizationId || openAiTenantProjects);
  if (managedOpenAiConfigured && (!openAiAdminApiKey || !openAiOrganizationId || !openAiTenantProjects)) {
    add(issues, 'openai-managed-prerequisites', 'Managed OpenAI provisioning requires an Admin API key file, organization ID, and tenant-to-project mapping together.', 'Configure ORGWARD_OPENAI_ADMIN_API_KEY_FILE, ORGWARD_OPENAI_ORGANIZATION_ID, and ORGWARD_OPENAI_TENANT_PROJECTS, or omit all three to disable managed provisioning.');
  }

  const oidc = {
    issuer: env.ORGWARD_OIDC_ISSUER || null,
    audience: env.ORGWARD_OIDC_AUDIENCE || null,
    jwksUri: env.ORGWARD_OIDC_JWKS_URI || null,
    clientId: env.ORGWARD_OIDC_CLIENT_ID || null,
    redirectUri: env.ORGWARD_OIDC_REDIRECT_URI || null,
    authorizationEndpoint: env.ORGWARD_OIDC_AUTHORIZATION_ENDPOINT || null,
    tokenEndpoint: env.ORGWARD_OIDC_TOKEN_ENDPOINT || null,
    tenantClaim: env.ORGWARD_OIDC_TENANT_CLAIM || 'orgward_tenant',
    roleClaim: env.ORGWARD_OIDC_ROLE_CLAIM || 'groups',
  };
  let roleMap = {};
  let tenantBindings = null;
  let bootstrapPrincipals = [];
  if (authMode === 'oidc') {
    const required = ['issuer', 'audience', 'jwksUri', 'clientId', 'redirectUri', 'authorizationEndpoint', 'tokenEndpoint'];
    for (const name of required) if (!oidc[name]) add(issues, `oidc-${name}`, `ORGWARD_OIDC_${name.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()} is required in OIDC mode.`, `Set ORGWARD_OIDC_${name.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()} to the value from your identity provider.`);
    if (oidc.issuer) validateHttpsUrl(oidc.issuer, 'ORGWARD_OIDC_ISSUER', issues);
    if (oidc.jwksUri) validateHttpsUrl(oidc.jwksUri, 'ORGWARD_OIDC_JWKS_URI', issues);
    if (oidc.authorizationEndpoint) validateHttpsUrl(oidc.authorizationEndpoint, 'ORGWARD_OIDC_AUTHORIZATION_ENDPOINT', issues);
    if (oidc.tokenEndpoint) validateHttpsUrl(oidc.tokenEndpoint, 'ORGWARD_OIDC_TOKEN_ENDPOINT', issues);
    if (oidc.redirectUri) validateHttpsUrl(oidc.redirectUri, 'ORGWARD_OIDC_REDIRECT_URI', issues);
    roleMap = parseJsonObject(env.ORGWARD_OIDC_ROLE_MAP || '{}', 'ORGWARD_OIDC_ROLE_MAP', issues) ?? {};
    tenantBindings = parseJsonObject(env.ORGWARD_OIDC_TENANT_BINDINGS, 'ORGWARD_OIDC_TENANT_BINDINGS', issues, { required: true });
    if (tenantBindings && (!Object.keys(tenantBindings).length || Object.entries(tenantBindings).some(([key, value]) => !key.trim() || typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value)))) {
      add(issues, 'oidc-tenant-bindings', 'ORGWARD_OIDC_TENANT_BINDINGS must map provider tenant values to valid OrgWard tenant IDs.', 'Provide a non-empty mapping to tenant IDs containing letters, numbers, dot, underscore, colon, or hyphen.');
    }
    try { bootstrapPrincipals = JSON.parse(env.ORGWARD_OIDC_BOOTSTRAP_PRINCIPALS || '[]'); }
    catch { add(issues, 'oidc-bootstrap', 'ORGWARD_OIDC_BOOTSTRAP_PRINCIPALS must be a JSON array.', 'Set it to [] or a JSON array of exact issuer, subject, and mapped tenant triples.'); }
    if (!Array.isArray(bootstrapPrincipals)) bootstrapPrincipals = [];
    if (tenantBindings && bootstrapPrincipals.some((entry) => !entry || entry.issuer !== oidc.issuer
      || typeof entry.subject !== 'string' || !entry.subject.trim() || entry.subject.length > 255
      || typeof entry.tenantId !== 'string' || !Object.values(tenantBindings).includes(entry.tenantId))) {
      add(issues, 'oidc-bootstrap', 'Each bootstrap principal must exactly match the configured issuer and a mapped tenant.', 'Use exact issuer, provider subject, and OrgWard tenant ID values from ORGWARD_OIDC_TENANT_BINDINGS.');
    }
  }

  const allowLegacyJson = !databaseUrl && env.ORGWARD_ALLOW_LEGACY_JSON === 'true';
  const config = {
    host, port, authMode, databaseUrl, secretEncryptionKey, allowLegacyJson,
    dataDirectory: path.resolve(env.ORGWARD_DATA_DIR || path.join(ROOT, 'data', 'projects')),
    sdlcDirectory: path.resolve(env.ORGWARD_SDLC_DATA_DIR || path.join(ROOT, 'data', 'sdlc')),
    executionDirectory: path.resolve(env.ORGWARD_EXECUTION_DATA_DIR || path.join(ROOT, 'data', 'execution-runs')),
    executionWorkspaceDirectory: path.resolve(env.ORGWARD_EXECUTION_WORKSPACE_DIR || path.join(ROOT, 'data', 'execution-workspaces')),
    enableLocalExecution: env.ORGWARD_ENABLE_LOCAL_EXECUTION === 'true',
    openAiCredentialReference, openAiModel, oidc, roleMap, tenantBindings, bootstrapPrincipals,
    openAiAdminApiKey, openAiOrganizationId, openAiTenantProjects,
    legacyReadOnlyMode: allowLegacyJson,
  };
  if (openAiCredentialReference && (!databaseUrl || !secretEncryptionKey)) add(issues, 'openai-prerequisites', 'The OpenAI profile needs PostgreSQL and the secret encryption key.', 'Configure PostgreSQL and the secret encryption key through the inline or protected-file settings before opting in.');
  return { config, issues };
}

async function inspectStorageDirectory(directory, label, issues) {
  let current = directory;
  let missing = false;
  while (true) {
    try {
      const metadata = await lstat(current);
      if (!metadata.isDirectory()) {
        add(issues, label, `${label} resolves to a non-directory path.`, `Choose a directory owned by the OrgWard service account.`);
        return;
      }
      const resolved = await realpath(current);
      await access(resolved, fsConstants.R_OK | fsConstants.X_OK | (missing || current === directory ? fsConstants.W_OK : 0));
      if (missing) add(issues, label, `${label} does not exist yet; its nearest existing parent is writable.`, `OrgWard can create this directory on first use; ensure the service account owns its parent.`, 'notice');
      return;
    } catch (error) {
      if (error.code === 'ENOENT') {
        const parent = path.dirname(current);
        if (parent === current) {
          add(issues, label, `${label} has no accessible existing parent.`, 'Create a writable parent directory for the OrgWard service account.');
          return;
        }
        missing = true;
        current = parent;
        continue;
      }
      add(issues, label, `${label} is not accessible to the current service account.`, `Grant the OrgWard service account read/write/search access to the configured directory.`);
      return;
    }
  }
}

async function inspectDatabase(databaseUrl, issues) {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000, query_timeout: 5_000 });
  try {
    await client.connect();
    const version = await client.query(`select current_setting('server_version_num')::int as version_num, current_setting('server_version') as version`);
    const versionNum = version.rows[0].version_num;
    if (versionNum < MIN_POSTGRES_VERSION) add(issues, 'postgres-version', `PostgreSQL ${version.rows[0].version} is below the supported minimum.`, 'Use PostgreSQL 16 or newer.');
    const schemaInfo = await client.query(`select to_regnamespace('orgward') is not null as schema_exists, to_regclass('orgward.schema_migrations') is not null as migration_table_exists`);
    if (!schemaInfo.rows[0].migration_table_exists) {
      let count = 0;
      if (schemaInfo.rows[0].schema_exists) {
        const tables = await client.query(`select count(*)::int as count from information_schema.tables where table_schema='orgward'`);
        count = tables.rows[0].count;
      }
      if (count > 0) add(issues, 'database-schema', 'The OrgWard schema has tables but no migration ledger; compatibility cannot be established safely.', 'Restore a consistent OrgWard database backup or use an empty database for a new installation.');
      return { serverVersion: version.rows[0].version, schemaVersion: null, pendingMigrations: true, uninitialized: count === 0 };
    }
    const files = (await readdir(MIGRATIONS)).filter((file) => /^\d{3}-[a-z0-9-]+\.sql$/.test(file)).sort();
    const known = new Map();
    for (const file of files) known.set(file.slice(0, -4), createHash('sha256').update(await readFile(path.join(MIGRATIONS, file))).digest('hex'));
    const applied = await client.query('select version,checksum from orgward.schema_migrations order by version');
    const knownVersions = [...known.keys()];
    const appliedVersions = applied.rows.map((row) => row.version);
    const expectedPrefix = knownVersions.slice(0, appliedVersions.length);
    if (appliedVersions.some((version, index) => version !== expectedPrefix[index])) {
      add(issues, 'database-schema', 'The migration ledger is not a contiguous prefix of this release.', 'Restore a consistent database backup or use the supported upgrade path; do not edit migration history.');
    }
    for (const row of applied.rows) {
      if (!known.has(row.version)) add(issues, 'database-schema', 'The database contains a migration unknown to this application.', 'Use the matching OrgWard release or restore a database backup compatible with this release.');
      else if (known.get(row.version) !== row.checksum) add(issues, 'database-schema', `Applied migration ${row.version} does not match this release checksum.`, 'Restore the exact migration file or follow the supported upgrade procedure; do not edit migration history.');
    }
    return { serverVersion: version.rows[0].version, schemaVersion: applied.rows.at(-1)?.version ?? null,
      pendingMigrations: applied.rowCount !== known.size, uninitialized: applied.rowCount === 0 };
  } catch {
    add(issues, 'database-connectivity', 'The configured PostgreSQL server could not be reached or inspected.', 'Check the PostgreSQL service, network route, database name, and secret-manager credentials; do not paste the connection URL into logs.');
    return null;
  } finally { await client.end().catch(() => {}); }
}

export async function runInstallPreflight({ env = process.env, nodeVersion = process.versions.node } = {}) {
  const { config, issues } = parseInstallConfig(env, nodeVersion);
  if (config.enableLocalExecution) await inspectStorageDirectory(config.executionWorkspaceDirectory, 'Execution workspace directory', issues);
  let database = null;
  if (config.databaseUrl && !issues.some((issue) => issue.check === 'database-url')) database = await inspectDatabase(config.databaseUrl, issues);
  const failures = issues.filter((issue) => issue.severity !== 'notice');
  return { ok: failures.length === 0, issues, database };
}
