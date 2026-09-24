import { createHash, createPrivateKey, sign } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants, closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execFileAsync = promisify(execFile);
const SIGNATURE_DOMAIN = 'OrgWard Enterprise Studio release archive v1\n';
const MAX_SIGNING_KEY_BYTES = 16_384;

function readSigningKeyFile(filePath) {
  let descriptor;
  try {
    if (!path.isAbsolute(filePath) || !Number.isInteger(fsConstants.O_NOFOLLOW)) throw new Error();
    descriptor = openSync(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | (fsConstants.O_NONBLOCK ?? 0) | (fsConstants.O_CLOEXEC ?? 0));
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0 || (metadata.mode & 0o400) === 0
      || metadata.size <= 0 || metadata.size > MAX_SIGNING_KEY_BYTES) throw new Error();
    const data = Buffer.alloc(metadata.size);
    let offset = 0;
    while (offset < data.length) {
      const count = readSync(descriptor, data, offset, data.length - offset, offset);
      if (!count) throw new Error();
      offset += count;
    }
    if (fstatSync(descriptor).size !== metadata.size) throw new Error();
    return data.toString('utf8');
  } catch { throw new Error('Release signing key must be an absolute-path, owner-only regular PEM file within the size limit.'); }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

function prepareSigningKey(signingKeyPem) {
  let key;
  try { key = createPrivateKey(signingKeyPem); }
  catch { throw new Error('Release signing key is malformed.'); }
  if (key.asymmetricKeyType !== 'ed25519' || key.type !== 'private') throw new Error('Release signing key must be an Ed25519 private key.');
  return key;
}

function signArchiveDigest(archiveDigest, signingKey) {
  const statement = Buffer.from(`${SIGNATURE_DOMAIN}sha256=${archiveDigest}\n`, 'utf8');
  return `orgward-release-signature-v1:${sign(null, statement, signingKey).toString('base64')}\n`;
}
const INCLUDE = ['server.mjs', 'package.json', 'package-lock.json', 'DELIVERY-STATUS.json', 'src', 'public', 'migrations', 'workers', 'ops/preflight.mjs', 'ops/database-recovery.mjs', 'ops/recovery-files.mjs'];
const EXAMPLES = {
  'config.example.env': `# Copy into a root-owned, mode-0600 environment file; never commit credentials.\n# Have your secret manager deliver the following as separate owner-only files.\nHOST=127.0.0.1\nPORT=4310\nORGWARD_AUTH_MODE=oidc\nORGWARD_PUBLIC_URL=https://orgward.example.com\nORGWARD_DATABASE_URL_FILE=/run/secrets/orgward/database-url\nORGWARD_SECRET_ENCRYPTION_KEY_FILE=/run/secrets/orgward/secret-encryption-key\n# Optional: omit all three managed OpenAI settings to disable provisioning.\nORGWARD_OPENAI_ADMIN_API_KEY_FILE=/run/secrets/orgward/openai-admin-key\nORGWARD_OPENAI_ORGANIZATION_ID=org_example\nORGWARD_OPENAI_TENANT_PROJECTS='{\"orgward-tenant-id\":\"proj_example\"}'\nORGWARD_OIDC_ISSUER=https://identity.example.com/\nORGWARD_OIDC_AUDIENCE=orgward-api\nORGWARD_OIDC_JWKS_URI=https://identity.example.com/.well-known/jwks.json\nORGWARD_OIDC_CLIENT_ID=orgward-web\nORGWARD_OIDC_REDIRECT_URI=https://orgward.example.com/auth/callback\nORGWARD_OIDC_AUTHORIZATION_ENDPOINT=https://identity.example.com/authorize\nORGWARD_OIDC_TOKEN_ENDPOINT=https://identity.example.com/token\nORGWARD_OIDC_ROLE_MAP='{}'\nORGWARD_OIDC_TENANT_BINDINGS='{\"provider-tenant-value\":\"orgward-tenant-id\"}'\nORGWARD_OIDC_BOOTSTRAP_PRINCIPALS='[{\"issuer\":\"https://identity.example.com/\",\"subject\":\"exact-provider-subject\",\"tenantId\":\"orgward-tenant-id\"}]'\nORGWARD_ENABLE_LOCAL_EXECUTION=false\nORGWARD_DATA_DIR=/var/lib/orgward/projects\nORGWARD_SDLC_DATA_DIR=/var/lib/orgward/sdlc\nORGWARD_EXECUTION_DATA_DIR=/var/lib/orgward/execution-runs\nORGWARD_EXECUTION_WORKSPACE_DIR=/var/lib/orgward/execution-workspaces\n`,
  'examples/Caddyfile': `orgward.example.com {\n  reverse_proxy 127.0.0.1:4310\n}\n`,
  'examples/orgward.service': `[Unit]\nDescription=OrgWard Enterprise Studio\nAfter=network-online.target postgresql.service\nWants=network-online.target\n\n[Service]\nType=simple\nUser=orgward\nGroup=orgward\nWorkingDirectory=/opt/orgward/current\nEnvironmentFile=/etc/orgward/orgward.env\nEnvironment=HOST=127.0.0.1\nEnvironment=PORT=4310\nExecStartPre=/usr/bin/env node /opt/orgward/current/ops/preflight.mjs\nExecStart=/usr/bin/env node /opt/orgward/current/server.mjs\nRestart=on-failure\nRestartSec=5\nUMask=0077\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nProtectHome=true\nReadWritePaths=/var/lib/orgward\n\n[Install]\nWantedBy=multi-user.target\n`,
};

const INSTALL = `# Private self-hosted installation\n\nThis archive is a private application bundle, not an independently qualified clean-host release. The installer supports only gzip-compressed POSIX USTAR and rejects PAX/GNU extensions and non-regular members; it does not claim generic tar safety. It contains the application source, public assets, migrations, workers, production npm lock, and the examples in \`examples/\`. It contains no credentials, application data, tests, repository history, logs, or installed \`node_modules\`.\n\n## Supported starting point\n\n- Node.js 22 or newer. The systemd example runs \`/usr/bin/env node\`; ensure the unit PATH resolves Node 22+, or replace it with the installed absolute executable path.\n- PostgreSQL 16 or newer, on a private network, with a dedicated least-privilege application role.\n- A dedicated unprivileged \`orgward\` service user. Never run the service as root.\n- An HTTPS reverse proxy with the app listener kept on \`127.0.0.1:4310\`. The bundled Caddyfile is an example only; TLS issuance, proxy headers, external exposure and firewall policy must be configured and verified by the operator.\n- An OIDC provider and exact issuer, client/audience, callback, role map, tenant mapping and first-owner subject. The callback URI must exactly match \`ORGWARD_PUBLIC_URL/auth/callback\`.\n- A secret encryption key and PostgreSQL URL delivered through owner-only regular files, ideally populated by the operator's secret manager. Set \`ORGWARD_SECRET_ENCRYPTION_KEY_FILE\` and \`ORGWARD_DATABASE_URL_FILE\`; inline variables remain supported, but each value must use only one source. File inputs must have no group/other permissions. Do not put either value in this archive or source control.\n\n## Install\n\n1. Create the service user, an empty PostgreSQL database and a dedicated DB role. Restrict the database to the service network. Back up any existing database before an upgrade.\n2. Obtain the detached \`.sig\` and independently trusted Ed25519 SPKI public key through trusted release channels; the \`.sha256\` sidecar is informational only. Build operators may sign the final archive by setting \`ORGWARD_RELEASE_SIGNING_KEY_FILE\` to an owner-only PEM file before \`npm run release:bundle\`; the private key is never packaged. From a separately trusted OrgWard tooling checkout, run \`npm run release:install -- <archive.tar.gz> <trusted-ed25519-public.pem> <existing-release-parent>\`. The installer pins the exact archive bytes, accepts bounded gzip POSIX USTAR only (PAX/GNU extensions and links/devices are rejected), validates member paths/types and exact manifest inventory/hashes, then atomically publishes without overwriting a version directory. It is not included in the archive. The installer verifies the detached Ed25519 signature over a domain-separated statement containing the SHA-256 digest of the exact archive bytes before decompression; the checksum file alone does not establish authenticity. Authenticity depends on independently trusting and distributing the public key. Use an existing trusted destination parent; installer instances serialize with a lock and assume no hostile concurrent writer in that parent. Verify a stale-lock report before removing its lock. Then point \`/opt/orgward/current\` to the installed version directory. Create \`/var/lib/orgward/projects\`, \`/var/lib/orgward/sdlc\`, \`/var/lib/orgward/execution-runs\` and \`/var/lib/orgward/execution-workspaces\` owned by \`orgward\`.\n3. From the release directory, install the pinned production dependencies with \`npm ci --omit=dev\`. The host needs access to the locked npm packages unless they are already in a trusted local cache.\n4. Create \`/etc/orgward/orgward.env\` using \`config.example.env\` as a template. Configure the secret manager to deliver the database URL and canonical base64 encoding of a 32-byte encryption key at the protected paths. Ensure each is a regular file owned by and readable by the service account, with no group/other permissions; do not put either value in the environment file. Preserve the same encryption key across restarts and upgrades, and include it in protected recovery material; replacing or losing it can make existing encrypted credential references unusable. Configure OIDC tenant bindings so each exact provider tenant value maps to one OrgWard tenant ID. Add one bootstrap tuple with the exact configured issuer, provider subject and mapped tenant ID. Optional managed OpenAI provisioning additionally requires \`ORGWARD_OPENAI_ADMIN_API_KEY_FILE\` pointing to an absolute owner-only Admin API key file, \`ORGWARD_OPENAI_ORGANIZATION_ID\`, and \`ORGWARD_OPENAI_TENANT_PROJECTS\` containing a JSON object that maps each OrgWard tenant ID to a unique OpenAI project ID within that organization. Omit all three settings to disable managed provisioning. Never place the Admin key in the environment file. Use the same public HTTPS origin in \`ORGWARD_PUBLIC_URL\` and OIDC redirect configuration. Do not use development auth on a network listener.\n5. Keep local execution disabled unless its isolation prerequisites are configured. If enabling it, confirm the workspace path in the environment is writable by \`orgward\` and the required worker isolation is available.\n6. Set up the HTTPS reverse proxy using \`examples/Caddyfile\` as a starting point and the service using \`examples/orgward.service\`. Confirm proxy TLS, DNS, firewall and OIDC callback behavior independently; the sample files do not prove them.\n7. With the exact service environment loaded, run \`npm run preflight\`. It does not apply migrations or change database contents. Resolve all errors before startup. Start the service with \`npm start\` or systemd and check \`/livez\` and \`/readyz\`. On first successful OIDC login, the configured subject receives the one-time tenant-admin/workspace bootstrap grant for the mapped tenant. Remove or rotate bootstrap configuration after access is established according to local policy; removing configuration does not revoke a persisted grant.\n\n## Repeat startup and upgrade\n\nRepeat startup with the same database and configuration. Bootstrap grants are persisted and are not restored after an administrator later demotes or revokes the identity. For an upgrade, back up PostgreSQL, extract a new versioned bundle, install its lockfile dependencies, run preflight, and start the new version. Current evidence covers populated migrations 001–006 upgrading to 012 and transactional retry after an injected migration failure; other source versions are not qualified. Preserve the previous bundle and backup. A code-only rollback may be incompatible with an already migrated database; restore the matching database backup together with the prior bundle unless compatibility is independently established.\n\nA clean-host installation, actual TLS/OIDC setup, independent operator usability, and general upgrade/rollback support have not been qualified by this bundle.\n`;

const RECOVERY_GUIDE = `
## PostgreSQL backup and isolated restore

Install PostgreSQL client tools compatible with the server and ensure \`pg_dump\` and \`pg_restore\` are on PATH. Stop every OrgWard service instance and writer first, then load \`ORGWARD_DATABASE_URL_FILE\` for the source and run \`npm run db:backup -- /absolute/existing/backup-parent\`. The service holds a shared PostgreSQL advisory lock from before migrations/store initialization through worker shutdown; backup requires the exclusive lock and refuses while an official service is active. Every transactional persistence operation also takes a transaction-scoped shared lock, so recovery waits for in-flight operations if the lifetime lock connection is lost. The runtime marks persistence unhealthy and stops workers on detected lock-session loss while keeping the dependency-free \`/livez\` endpoint available; database-backed routes fail closed. This does not detect direct database or filesystem writers, so maintain the quiesced window for the whole operation. Backup also refuses while any execution worker lease remains or any execution aggregate is RUNNING; stop and confirm all workers are quiescent first. Backup creates a new mode-0700 directory containing a custom-format dump, private manifest, and verified copies of the configured projects, SDLC, execution-run and execution-workspace roots. Every checked execution aggregate must pass state-hash integrity validation; each database-referenced execution artifact must exist in the captured workspace tree with the stored SHA-256. Symlinks, hardlinks, special files, cross-device trees, changing files and overlapping aliases are rejected. Recovery commands cap a single file at 512 MiB, a tree at 50 GiB, all roots at 100,000 total file/directory entries, and the serialized manifest at 64 MiB; these are command limits, not application data quotas. The archive listing is checked before same-filesystem publication. The digest detects corruption only; it does not authenticate the source or producer. Keep database/filesystem backups separate from the bundle and encryption/config recovery material.

To restore, create an empty database on a separate isolated PostgreSQL target and choose a new absolute filesystem staging path outside every configured live root. Provide the DB URL through owner-only \`ORGWARD_RESTORE_DATABASE_URL_FILE\`, then run \`npm run db:restore -- /absolute/backup-dir /absolute/restore-status.json /absolute/new-filesystem-staging-root\`. The command verifies and stages all file roots before restoring the DB with \`pg_restore --single-transaction\`, verifies restored artifact references, and publishes the filesystem staging directory without overwriting an existing path. Failures leave live service roots untouched; database commit and filesystem publication are not one atomic cutover. Keep both restored targets offline until independently validated. Before any operator-planned activation, configure the four service roots to the published staging tree: \`ORGWARD_DATA_DIR=/absolute/new-filesystem-staging-root/projects\`, \`ORGWARD_SDLC_DATA_DIR=/absolute/new-filesystem-staging-root/sdlc\`, \`ORGWARD_EXECUTION_DATA_DIR=/absolute/new-filesystem-staging-root/execution-runs\`, and \`ORGWARD_EXECUTION_WORKSPACE_DIR=/absolute/new-filesystem-staging-root/execution-workspaces\`. With the service still stopped and the restore target isolated from production, load the full target environment and run \`npm run preflight\`; review its database/schema and storage results before separately planning activation. Preflight does not perform cutover. The command never drops objects, uses \`--clean\`, or changes the running service database URL. The protected status JSON records running, completed, restore-invocation-uncertain, fence-install uncertainty, or failed state and safe database identifiers without connection credentials. Preserve encryption/config keys separately. No command here performs a live cutover.

### Uncertain restore status

If the protected status report records an uncertain restore or an unconfirmed restore-fence installation, preserve the exact status path recorded in the report, the original backup directory, and the verified filesystem stage. If the report says the stage was published, preserve that published directory too. Do not retry with a different status path or attempt an automatic resume; restore progress is not resumable. The target-side guard blocks service startup, another restore, and backup from that database. Keep the target offline while an operator inspects the database, status report, backup, and staged or published files. Reconcile the database and filesystem together before removing the guard or reusing the target.
`;

async function listFiles(directory, relative = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    const name = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Release source contains an unexpected symlink: ${name}`);
    if (entry.isDirectory()) files.push(...await listFiles(child, name));
    else if (entry.isFile()) files.push(name);
  }
  return files.sort();
}

export async function buildRelease(outputPath = null, { signingKeyPem = null } = {}) {
  if (signingKeyPem == null) {
    const keyPath = process.env.ORGWARD_RELEASE_SIGNING_KEY_FILE;
    if (!keyPath) throw new Error('Set ORGWARD_RELEASE_SIGNING_KEY_FILE to an owner-only Ed25519 private PEM file before building a signed release.');
    signingKeyPem = readSigningKeyFile(path.resolve(keyPath));
  }
  const signingKey = prepareSigningKey(signingKeyPem);
  const packageJson = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  outputPath ??= path.join(ROOT, 'dist', `orgward-enterprise-studio-${packageJson.version}.tar.gz`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temp = await mkdtemp(path.join(path.dirname(outputPath), '.orgward-release-'));
  const name = `orgward-enterprise-studio-${packageJson.version}`;
  const stage = path.join(temp, name);
  try {
    await mkdir(stage, { recursive: true });
    for (const relative of INCLUDE) {
      await mkdir(path.dirname(path.join(stage, relative)), { recursive: true });
      await cp(path.join(ROOT, relative), path.join(stage, relative), { recursive: true, errorOnExist: true });
    }
    packageJson.scripts = {
      start: 'node server.mjs', preflight: 'node ops/preflight.mjs',
      'db:backup': 'node ops/database-recovery.mjs backup', 'db:restore': 'node ops/database-recovery.mjs restore',
    };
    await writeFile(path.join(stage, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`, { mode: 0o644 });
    for (const [relative, contents] of Object.entries({ 'INSTALL.md': `${INSTALL}${RECOVERY_GUIDE}`, ...EXAMPLES })) {
      const destination = path.join(stage, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, contents, { mode: 0o644, flag: 'wx' });
    }
    const manifest = { name, version: packageJson.version, node: '>=22', postgres: '>=16', files: {} };
    for (const relative of await listFiles(stage)) {
      manifest.files[relative] = createHash('sha256').update(await readFile(path.join(stage, relative))).digest('hex');
    }
    await writeFile(path.join(stage, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644, flag: 'wx' });
    await mkdir(path.dirname(outputPath), { recursive: true });
    const tempArchive = path.join(temp, path.basename(outputPath));
    await execFileAsync('tar', ['--format=ustar', '-czf', tempArchive, '-C', temp, name]);
    const archive = await readFile(tempArchive);
    await writeFile(outputPath, archive, { mode: 0o600 });
    const checksum = createHash('sha256').update(archive).digest('hex');
    const signature = signArchiveDigest(checksum, signingKey);
    await writeFile(`${outputPath}.sha256`, `${checksum}  ${path.basename(outputPath)}\n`, { mode: 0o600 });
    await writeFile(`${outputPath}.sig`, signature, { mode: 0o600 });
    return { outputPath, checksum, signature, name };
  } finally { await rm(temp, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputIndex = process.argv.indexOf('--output');
  const outputPath = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1]) : undefined;
  try {
    const release = await buildRelease(outputPath);
    process.stdout.write(`Built signed ${release.name}: ${release.outputPath}\nSHA-256 (informational): ${release.checksum}\nSignature: ${release.outputPath}.sig\n`);
  } catch (error) {
    process.stderr.write(`Release build failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
