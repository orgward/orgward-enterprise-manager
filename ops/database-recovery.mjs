import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, link, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { constants as fsConstants, createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { readProtectedDatabaseUrlFile } from '../src/platform/install-config.mjs';
import { contentHash, RECOVERY_ADVISORY_LOCK_KEY, verifyAggregateRow } from '../src/platform/postgres.mjs';
import { assertNoRestoreGuard, createRestoreGuard, removeRestoreGuard, RESTORE_GUARD_SCHEMA } from '../src/platform/recovery-guard.mjs';
import { assertRootsDisjoint, configuredFileRoots, copySafeRoot, verifyCopiedRoot, verifyManifestFiles } from './recovery-files.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_NAME = 'backup-manifest.json';
const DUMP_NAME = 'database.dump';
const FORMAT_VERSION = 2;
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const FILE_ROOT_NAMES = ['projects', 'sdlc', 'execution-runs', 'execution-workspaces'];

function recoveryError(code, message) { return Object.assign(new Error(message), { code }); }

async function withRecoveryLock(connectionString, mode, busyCode, operation) {
  const client = await acquireRecoveryLock(connectionString, mode, busyCode);
  try { return await operation(); }
  finally { await client.end().catch(() => {}); }
}

async function acquireRecoveryLock(connectionString, mode, busyCode) {
  const client = new Client({ connectionString, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    const functionName = mode === 'shared' ? 'pg_try_advisory_lock_shared' : 'pg_try_advisory_lock';
    const result = await client.query(`select ${functionName}($1::bigint) as acquired`, [RECOVERY_ADVISORY_LOCK_KEY]);
    if (!result.rows[0].acquired) throw recoveryError(busyCode, mode === 'exclusive'
      ? 'The OrgWard service or another recovery operation is active; backup/restore was refused.'
      : 'A database recovery operation is active; service startup is refused.');
    return client;
  } catch (error) {
    await client.end().catch(() => {});
    throw error;
  }
}

async function verifyArtifactReferences(connectionString, fileEntries) {
  const client = new Client({ connectionString, connectionTimeoutMillis: 5_000, query_timeout: 15_000 });
  try {
    await client.connect();
    const result = await client.query(`select aggregate_id, tenant_id, version, state, state_hash
      from orgward.aggregates where aggregate_kind='execution_run'`);
    const files = new Map(fileEntries.filter((entry) => entry.root === 'execution-workspaces').map((entry) => [entry.path, entry]));
    for (const row of result.rows) {
      const aggregate = verifyAggregateRow(row);
      const artifacts = aggregate.execution?.changedArtifacts;
      if (artifacts == null) continue;
      if (!Array.isArray(artifacts)) throw recoveryError('ARTIFACT_REFERENCE_INVALID', 'An execution artifact reference is invalid.');
      if (typeof row.aggregate_id !== 'string' || !row.aggregate_id || row.aggregate_id.includes('/') || row.aggregate_id.includes('\\')) throw recoveryError('ARTIFACT_REFERENCE_INVALID', 'An execution artifact reference is invalid.');
      for (const artifact of artifacts) {
        if (typeof artifact?.path !== 'string' || artifact.path.split('/').some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\\') || segment.includes('\0'))
          || !/^[a-f0-9]{64}$/.test(artifact.contentHash ?? '')
          || (artifact.hashAlgorithm !== undefined && artifact.hashAlgorithm !== 'sha256-raw')) throw recoveryError('ARTIFACT_REFERENCE_INVALID', 'An execution artifact reference is invalid.');
        const file = files.get(`${row.aggregate_id}/${artifact.path}`);
        const matches = artifact.hashAlgorithm === 'sha256-raw'
          ? file?.sha256 === artifact.contentHash
          : file?.sha256 === artifact.contentHash || file?.legacySha256 === artifact.contentHash;
        if (!matches) throw recoveryError('ARTIFACT_MISSING_OR_INVALID', 'A database-referenced execution artifact is missing or has a different hash.');
      }
    }
  } catch (error) {
    if (error.code && /^[A-Z][A-Z0-9_]{2,64}$/.test(error.code)) throw error;
    throw recoveryError('ARTIFACT_REFERENCE_CHECK_FAILED', 'Database artifact references could not be verified.');
  } finally { await client.end().catch(() => {}); }
}

async function assertWorkersQuiescent(connectionString) {
  const client = new Client({ connectionString, connectionTimeoutMillis: 5_000, query_timeout: 10_000 });
  try {
    await client.connect();
    const result = await client.query(`select
      exists(select 1 from orgward.execution_worker_leases) as has_worker_lease,
      exists(select 1 from orgward.aggregates where aggregate_kind='execution_run' and state->>'status'='RUNNING') as has_running_run`);
    if (result.rows[0].has_worker_lease || result.rows[0].has_running_run) {
      throw recoveryError('WORKERS_NOT_QUIESCED', 'Execution workers or runs are not confirmed quiescent; stop workers and resolve active leases before backup.');
    }
  } catch (error) {
    if (error.code && /^[A-Z][A-Z0-9_]{2,64}$/.test(error.code)) throw error;
    throw recoveryError('WORKER_QUIESCENCE_UNVERIFIED', 'Execution worker quiescence could not be verified.');
  } finally { await client.end().catch(() => {}); }
}

function connectionParts(connectionString) {
  let url;
  try { url = new URL(connectionString); } catch { throw recoveryError('DATABASE_URL_INVALID', 'The protected PostgreSQL URL is invalid.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) {
    throw recoveryError('DATABASE_URL_INVALID', 'The protected PostgreSQL URL is invalid.');
  }
  let host = url.hostname;
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  const database = decodeURIComponent(url.pathname.slice(1));
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const allowed = new Set(['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'application_name', 'connect_timeout']);
  for (const key of url.searchParams.keys()) if (!allowed.has(key)) throw recoveryError('DATABASE_URL_INVALID', 'The protected PostgreSQL URL contains unsupported connection options.');
  return {
    host, port: url.port ? Number(url.port) : 5432, database, username, password,
    sslmode: url.searchParams.get('sslmode'), sslrootcert: url.searchParams.get('sslrootcert'),
    sslcert: url.searchParams.get('sslcert'), sslkey: url.searchParams.get('sslkey'),
    applicationName: url.searchParams.get('application_name') || 'orgward-recovery',
  };
}

function passField(value) { return String(value).replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll('*', '\\*').replaceAll('\n', '\\n').replaceAll('\r', '\\r'); }

async function withPgPass(parts, operation) {
  const directory = await mkdtemp(path.join(tmpdir(), 'orgward-pgpass-'));
  try {
    await chmod(directory, 0o700);
    const file = path.join(directory, 'pgpass');
    await writeFile(file, `${[parts.host, parts.port, parts.database, parts.username, parts.password].map(passField).join(':')}\n`, { mode: 0o600, flag: 'wx' });
    await chmod(file, 0o600);
    const env = {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: process.env.HOME ?? tmpdir(),
      ...(process.env.ORGWARD_PG_TOOLS_LIBRARY_PATH ? { LD_LIBRARY_PATH: process.env.ORGWARD_PG_TOOLS_LIBRARY_PATH } : {}),
      PGPASSFILE: file,
      PGHOST: parts.host,
      PGPORT: String(parts.port),
      PGDATABASE: parts.database,
      PGUSER: parts.username,
      PGAPPNAME: parts.applicationName,
      ...(parts.sslmode ? { PGSSLMODE: parts.sslmode } : {}),
      ...(parts.sslrootcert ? { PGSSLROOTCERT: parts.sslrootcert } : {}),
      ...(parts.sslcert ? { PGSSLCERT: parts.sslcert } : {}),
      ...(parts.sslkey ? { PGSSLKEY: parts.sslkey } : {}),
    };
    return await operation(env);
  }
  finally { await rm(directory, { recursive: true, force: true }); }
}

function runTool(command, args, env) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      const binDirectory = process.env.ORGWARD_PG_TOOLS_BIN;
      child = spawn(binDirectory ? path.join(binDirectory, command) : command, args, { env, stdio: 'ignore', shell: false });
    } catch { reject(recoveryError('PG_TOOL_UNAVAILABLE', 'The required PostgreSQL client tool is unavailable.')); return; }
    child.once('error', () => reject(recoveryError('PG_TOOL_UNAVAILABLE', 'The required PostgreSQL client tool is unavailable.')));
    child.once('close', (code) => code === 0 ? resolve() : reject(Object.assign(recoveryError(`${command === 'pg_dump' ? 'PG_DUMP' : 'PG_RESTORE'}_FAILED`, `The ${command} client operation failed.`), { exitCode: code })));
  });
}

async function inspectDatabase(connectionString) {
  const client = new Client({ connectionString, connectionTimeoutMillis: 5_000, query_timeout: 10_000 });
  try {
    await client.connect();
    const identity = await client.query(`select current_database() as database, coalesce(inet_server_addr()::text, 'local-socket') as server_address,
      coalesce(inet_server_port(), 0) as server_port, current_setting('server_version') as postgres_version,
      current_setting('server_version_num')::int as postgres_version_num`);
    if (identity.rows[0].postgres_version_num < 160000) throw recoveryError('POSTGRES_VERSION_UNSUPPORTED', 'PostgreSQL 16 or newer is required.');
    const ledger = await client.query(`select to_regclass('orgward.schema_migrations') is not null as exists`);
    let schemaVersion = null;
    let migrationLedger = [];
    if (ledger.rows[0].exists) {
      const applied = await client.query(`select version, checksum from orgward.schema_migrations order by version`);
      const files = (await readdir(path.join(ROOT, 'migrations'))).filter((file) => /^\d{3}-[a-z0-9-]+\.sql$/.test(file)).sort();
      const expected = [];
      for (const file of files) {
        const version = file.slice(0, -4);
        const sql = await readFile(path.join(ROOT, 'migrations', file), 'utf8');
        expected.push({ version, checksum: contentHash(sql) });
      }
      if (applied.rows.length > expected.length || applied.rows.some((row, index) => row.version !== expected[index]?.version || row.checksum !== expected[index]?.checksum)) {
        throw recoveryError('SOURCE_SCHEMA_INVALID', 'The source migration ledger is not a valid checked migration prefix.');
      }
      migrationLedger = applied.rows;
      schemaVersion = applied.rows.at(-1)?.version ?? null;
    }
    return { ...identity.rows[0], schemaVersion, migrationLedger };
  } catch (error) {
    if (error.code && /^[A-Z][A-Z0-9_]{2,64}$/.test(error.code)) throw error;
    throw recoveryError('DATABASE_UNAVAILABLE', 'The PostgreSQL database could not be inspected.');
  } finally { await client.end().catch(() => {}); }
}

async function assertDatabaseHasNoRestoreGuard(connectionString) {
  const client = new Client({ connectionString, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    await assertNoRestoreGuard(client, 'RESTORE_RECOVERY_GUARD');
  } finally { await client.end().catch(() => {}); }
}

async function isEmptyTarget(connectionString) {
  const client = new Client({ connectionString, connectionTimeoutMillis: 5_000, query_timeout: 10_000 });
  try {
    await client.connect();
    const result = await client.query(`select
      (select count(*)::int from pg_namespace where nspname not in ('pg_catalog','information_schema','public','pg_toast')) as extra_schemas,
      (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname not in ('pg_catalog','information_schema','pg_toast') and c.relkind in ('r','p','v','m','S','f')) as relations,
      (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') as routines,
      (select count(*)::int from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype in ('c','d','e','r','m')) as types,
      (select count(*)::int from pg_extension where extname <> 'plpgsql') as extensions`);
    return Object.values(result.rows[0]).every((count) => count === 0);
  } catch { throw recoveryError('RESTORE_TARGET_UNAVAILABLE', 'The restore target could not be checked.'); }
  finally { await client.end().catch(() => {}); }
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(filePath)) { size += chunk.length; hash.update(chunk); }
  return { size, sha256: hash.digest('hex') };
}

async function readManifest(backupDirectory) {
  if (!path.isAbsolute(backupDirectory)) throw recoveryError('BACKUP_INVALID', 'The backup directory path must be absolute.');
  let directory;
  try { directory = await lstat(backupDirectory); } catch { throw recoveryError('BACKUP_INVALID', 'The backup directory is unavailable.'); }
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw recoveryError('BACKUP_INVALID', 'The backup directory is invalid.');
  const manifestPath = path.join(backupDirectory, MANIFEST_NAME);
  const manifestStat = await lstat(manifestPath).catch(() => null);
  if (!manifestStat?.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 64 * 1024 * 1024) throw recoveryError('BACKUP_INVALID', 'The backup manifest is missing or invalid.');
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); }
  catch { throw recoveryError('BACKUP_INVALID', 'The backup manifest is missing or invalid.'); }
  if (manifest?.formatVersion !== FORMAT_VERSION || manifest.dump?.file !== DUMP_NAME
    || !Number.isSafeInteger(manifest.dump.size) || manifest.dump.size <= 0
    || !/^[a-f0-9]{64}$/.test(manifest.dump.sha256)
    || typeof manifest.createdAt !== 'string' || typeof manifest.appVersion !== 'string' || !manifest.appVersion
    || typeof manifest.source?.database !== 'string'
    || typeof manifest.source?.serverAddress !== 'string' || !Number.isInteger(manifest.source?.serverPort)
    || typeof manifest.schemaVersion !== 'string' || typeof manifest.postgresVersion !== 'string'
    || !Array.isArray(manifest.fileRoots) || !Array.isArray(manifest.files) || !Array.isArray(manifest.directories)) {
    throw recoveryError('BACKUP_INVALID', 'The backup manifest is incompatible or incomplete.');
  }
  await verifyManifestFiles(manifest.fileRoots, manifest.files, manifest.directories);
  if (manifest.fileRoots.map((root) => root.name).sort().join(',') !== [...FILE_ROOT_NAMES].sort().join(',')) throw recoveryError('BACKUP_INVALID', 'The backup filesystem roots are incompatible.');
  const filesDirectory = path.join(backupDirectory, 'files');
  const filesMetadata = await lstat(filesDirectory).catch(() => null);
  if (!filesMetadata?.isDirectory() || filesMetadata.isSymbolicLink()) throw recoveryError('BACKUP_INVALID', 'The backup filesystem roots are missing or invalid.');
  const actualRoots = (await readdir(filesDirectory)).sort();
  if (actualRoots.join(',') !== [...FILE_ROOT_NAMES].sort().join(',')) throw recoveryError('BACKUP_INVALID', 'The backup filesystem root inventory is incompatible.');
  const migrations = await readdir(path.join(ROOT, 'migrations'));
  const versions = migrations.filter((file) => /^\d{3}-[a-z0-9-]+\.sql$/.test(file)).map((file) => file.slice(0, -4));
  if (!versions.includes(manifest.schemaVersion)) throw recoveryError('BACKUP_INCOMPATIBLE', 'The backup schema version is not supported by this release.');
  const sourceDumpPath = path.join(backupDirectory, DUMP_NAME);
  const metadata = await lstat(sourceDumpPath).catch(() => null);
  if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size !== manifest.dump.size) throw recoveryError('BACKUP_INVALID', 'The database dump is missing or not a regular file of the declared size.');
  const privateDirectory = await mkdtemp(path.join(tmpdir(), 'orgward-restore-verified-'));
  await chmod(privateDirectory, 0o700);
  const dumpPath = path.join(privateDirectory, DUMP_NAME);
  let descriptor;
  try {
    descriptor = await open(sourceDumpPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | (fsConstants.O_NONBLOCK ?? 0) | (fsConstants.O_CLOEXEC ?? 0));
    const opened = await descriptor.stat();
    if (!opened.isFile() || opened.size !== manifest.dump.size) throw recoveryError('BACKUP_INVALID', 'The database dump changed while being opened.');
    await pipeline(descriptor.createReadStream({ autoClose: false }), createWriteStream(dumpPath, { flags: 'wx', mode: 0o600 }));
    await chmod(dumpPath, 0o600);
    const actual = await sha256File(dumpPath);
    if (actual.size !== manifest.dump.size || actual.sha256 !== manifest.dump.sha256) throw recoveryError('BACKUP_INTEGRITY_FAILED', 'The database dump does not match its manifest.');
    return { manifest, dumpPath, cleanup: () => rm(privateDirectory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(privateDirectory, { recursive: true, force: true });
    throw error;
  } finally { await descriptor?.close().catch(() => {}); }
}

async function writeStatus(statusPath, report, priorIdentity = null) {
  if (!path.isAbsolute(statusPath)) throw recoveryError('STATUS_PATH_INVALID', 'The restore status path must be absolute.');
  const parent = path.dirname(statusPath);
  const parentStat = await lstat(parent).catch(() => null);
  if (!parentStat?.isDirectory() || parentStat.isSymbolicLink()) throw recoveryError('STATUS_PATH_INVALID', 'The restore status directory must be an existing real directory.');
  const temp = path.join(parent, `.orgward-restore-status-${randomUUID()}.tmp`);
  await writeFile(temp, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await chmod(temp, 0o600);
  const statusHandle = await open(temp, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try { await statusHandle.sync(); } finally { await statusHandle.close(); }
  try {
    if (!priorIdentity) {
      await link(temp, statusPath);
      const directoryHandle = await open(parent, fsConstants.O_RDONLY);
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
      const created = await lstat(statusPath);
      return { dev: created.dev, ino: created.ino, uid: created.uid };
    }
    const current = await lstat(statusPath).catch(() => null);
    const processUid = process.getuid?.();
    if (!current?.isFile() || current.isSymbolicLink() || current.mode & 0o077
      || current.dev !== priorIdentity.dev || current.ino !== priorIdentity.ino
      || current.uid !== priorIdentity.uid || (processUid !== undefined && current.uid !== processUid)) {
      throw recoveryError('STATUS_PATH_CHANGED', 'The restore status file was replaced or is no longer private.');
    }
    await rename(temp, statusPath);
    const directoryHandle = await open(parent, fsConstants.O_RDONLY);
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    const updated = await lstat(statusPath);
    return { dev: updated.dev, ino: updated.ino, uid: updated.uid };
  } catch (error) {
    if (error.code === 'EEXIST') throw recoveryError('STATUS_PATH_EXISTS', 'The restore status path already exists.');
    throw error;
  } finally { await unlink(temp).catch(() => {}); }
}

async function backupDatabaseLocked({ sourceUrl, outputParent, fileRoots, now = new Date() }) {
  if (!outputParent || !path.isAbsolute(outputParent)) throw recoveryError('BACKUP_PATH_INVALID', 'The backup parent directory must be an absolute path.');
  const parentStat = await lstat(outputParent).catch(() => null);
  if (!parentStat?.isDirectory() || parentStat.isSymbolicLink()) throw recoveryError('BACKUP_PATH_INVALID', 'The backup parent must be an existing real directory.');
  await assertRootsDisjoint(fileRoots, outputParent, 'BACKUP_PATH_INVALID');
  await assertDatabaseHasNoRestoreGuard(sourceUrl);
  const source = await inspectDatabase(sourceUrl);
  if (!source.schemaVersion) throw recoveryError('SOURCE_SCHEMA_UNAVAILABLE', 'The source database has no OrgWard migration ledger.');
  const packageInfo = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const temporary = await mkdtemp(path.join(outputParent, '.orgward-backup-'));
  await chmod(temporary, 0o700);
  const finalPath = path.join(outputParent, `orgward-backup-${now.toISOString().replaceAll(':', '').replaceAll('.', '-')}-${randomUUID()}`);
  try {
    await assertWorkersQuiescent(sourceUrl);
    const fileState = { files: 0, bytes: 0, entries: [], directories: [], seen: new Set() };
    const fileRootSummary = [];
    for (const root of fileRoots) {
      const destination = path.join(temporary, 'files', root.name);
      const copied = await copySafeRoot(root.sourcePath, destination, root.name, fileState);
      fileRootSummary.push(copied.root);
    }
    await verifyManifestFiles(fileRootSummary, fileState.entries, fileState.directories);
    await verifyArtifactReferences(sourceUrl, fileState.entries);
    const dumpPath = path.join(temporary, DUMP_NAME);
    await withPgPass(connectionParts(sourceUrl), (env) => runTool('pg_dump', ['--no-password', '--format=custom', '--no-owner', '--no-privileges', '--compress=6', `--exclude-schema=${RESTORE_GUARD_SCHEMA}`, `--file=${dumpPath}`], env));
    await chmod(dumpPath, 0o600);
    const checkEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? tmpdir(), ...(process.env.ORGWARD_PG_TOOLS_LIBRARY_PATH ? { LD_LIBRARY_PATH: process.env.ORGWARD_PG_TOOLS_LIBRARY_PATH } : {}) };
    await runTool('pg_restore', ['--list', '--no-password', '--file=/dev/null', dumpPath], checkEnv);
    const dump = await sha256File(dumpPath);
    const manifest = {
      formatVersion: FORMAT_VERSION,
      createdAt: now.toISOString(),
      appVersion: packageInfo.version,
      schemaVersion: source.schemaVersion,
      postgresVersion: source.postgres_version,
      source: {
        database: source.database, serverAddress: source.server_address, serverPort: source.server_port,
      },
      dump: { file: DUMP_NAME, size: dump.size, sha256: dump.sha256 },
      fileRoots: fileRootSummary,
      files: fileState.entries,
      directories: fileState.directories,
    };
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    if (Buffer.byteLength(manifestText) > MAX_MANIFEST_BYTES) throw recoveryError('FILESYSTEM_LIMIT', 'The recovery manifest exceeds the 64 MiB command limit.');
    await writeFile(path.join(temporary, MANIFEST_NAME), manifestText, { mode: 0o600, flag: 'wx' });
    if (await lstat(finalPath).then(() => true, () => false)) throw recoveryError('BACKUP_EXISTS', 'A backup already exists at the generated publication path.');
    await rename(temporary, finalPath);
    return { backupDirectory: finalPath, manifest };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    if (error.code) throw error;
    throw recoveryError('BACKUP_FAILED', 'The database backup could not be completed.');
  }
}

export async function backupDatabase({ databaseUrlFile = process.env.ORGWARD_DATABASE_URL_FILE, outputParent, fileRoots = configuredFileRoots(), now = new Date() }) {
  const sourceUrl = readProtectedDatabaseUrlFile(databaseUrlFile, 'ORGWARD_DATABASE_URL_FILE');
  return withRecoveryLock(sourceUrl, 'exclusive', 'BACKUP_SERVICE_ACTIVE', () => backupDatabaseLocked({ sourceUrl, outputParent, fileRoots, now }));
}

export async function restoreDatabase({ backupDirectory, statusPath, filesystemRoot, targetUrlFile = process.env.ORGWARD_RESTORE_DATABASE_URL_FILE }) {
  const startedAt = new Date().toISOString();
  const report = { formatVersion: FORMAT_VERSION, state: 'running', startedAt };
  let statusIdentity = await writeStatus(statusPath, report);
  let cleanupVerifiedDump = async () => {};
  let targetLock = null;
  let filesystemStage = null;
  let invocationMayHaveBegun = false;
  let recoveryMayBeRequired = false;
  let uncertainPhase = 'restore-fence-install-result-unconfirmed';
  try {
    const targetUrl = readProtectedDatabaseUrlFile(targetUrlFile, 'ORGWARD_RESTORE_DATABASE_URL_FILE');
    if (!filesystemRoot || !path.isAbsolute(filesystemRoot) || filesystemRoot.split(path.sep).includes('..')) throw recoveryError('RESTORE_FILESYSTEM_TARGET_INVALID', 'The filesystem staging root must be a new absolute path without traversal.');
    filesystemRoot = path.resolve(filesystemRoot);
    const fileRoots = configuredFileRoots();
    const backupResolved = path.resolve(backupDirectory);
    await assertRootsDisjoint([...fileRoots, { name: 'backup', sourcePath: backupResolved }], filesystemRoot, 'RESTORE_FILESYSTEM_TARGET_INVALID');
    const filesystemParent = path.dirname(filesystemRoot);
    const parentStat = await lstat(filesystemParent).catch(() => null);
    if (!parentStat?.isDirectory() || parentStat.isSymbolicLink()) throw recoveryError('RESTORE_FILESYSTEM_TARGET_INVALID', 'The filesystem staging parent must be an existing real directory.');
    if (await lstat(filesystemRoot).then(() => true, () => false)) throw recoveryError('RESTORE_FILESYSTEM_TARGET_EXISTS', 'The filesystem staging root must not already exist.');
    const { manifest, dumpPath, cleanup } = await readManifest(backupDirectory);
    cleanupVerifiedDump = cleanup;
    if (process.env.ORGWARD_DATABASE_URL_FILE && path.resolve(targetUrlFile) === path.resolve(process.env.ORGWARD_DATABASE_URL_FILE)) {
      throw recoveryError('RESTORE_SOURCE_TARGET', 'Restore target file must be distinct from the configured service database file.');
    }
    targetLock = await acquireRecoveryLock(targetUrl, 'exclusive', 'RESTORE_TARGET_ACTIVE');
    const target = await inspectDatabase(targetUrl);
    await assertNoRestoreGuard(targetLock);
    const sourceMajor = Number.parseInt(manifest.postgresVersion, 10);
    const targetMajor = Math.floor(target.postgres_version_num / 10_000);
    if (!Number.isSafeInteger(sourceMajor) || targetMajor < sourceMajor) {
      throw recoveryError('BACKUP_INCOMPATIBLE', 'The restore target PostgreSQL major version is older than the backup source.');
    }
    const sameSource = target.database === manifest.source.database && target.server_address === manifest.source.serverAddress
      && target.server_port === manifest.source.serverPort;
    if (sameSource) throw recoveryError('RESTORE_SOURCE_TARGET', 'Restore target must be distinct from the backup source.');
    if (!await isEmptyTarget(targetUrl)) throw recoveryError('RESTORE_TARGET_NOT_EMPTY', 'Restore target is not empty; no data was overwritten.');
    await runTool('pg_restore', ['--list', '--no-password', '--file=/dev/null', dumpPath], { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? tmpdir(), ...(process.env.ORGWARD_PG_TOOLS_LIBRARY_PATH ? { LD_LIBRARY_PATH: process.env.ORGWARD_PG_TOOLS_LIBRARY_PATH } : {}) });
    filesystemStage = await mkdtemp(path.join(filesystemParent, '.orgward-restore-files-'));
    await chmod(filesystemStage, 0o700);
    for (const root of manifest.fileRoots) {
      await verifyCopiedRoot(path.join(backupDirectory, 'files', root.name), path.join(filesystemStage, root.name), root.name, manifest.files, manifest.directories);
    }
    const targetParts = connectionParts(targetUrl);
    const restoreId = randomUUID();
    const targetIdentity = {
      database: target.database,
      serverAddress: target.server_address,
      serverPort: target.server_port,
      postgresVersion: target.postgres_version,
    };
    const stageStat = await lstat(filesystemStage);
    Object.assign(report, {
      state: 'restore-invocation-uncertain',
      phase: 'restore-fence-install-result-unconfirmed',
      recoveryMayBeRequired: true,
      pgRestoreMayHaveBegun: false,
      statusPath: path.resolve(statusPath),
      restoreId,
      backupPath: backupResolved,
      backupSha256: manifest.dump.sha256,
      targetIdentity,
      targetGuard: { schema: RESTORE_GUARD_SCHEMA, table: 'active_restore', state: 'installation-outcome-unconfirmed' },
      filesystemStage: {
        path: filesystemStage,
        intendedPublishPath: filesystemRoot,
        device: stageStat.dev,
        inode: stageStat.ino,
        ownerUid: stageStat.uid,
        state: 'verified-private-stage-preserved-until-manual-recovery',
      },
      recoveryGuidance: 'The pg_restore process may have changed the target database. Preserve and reuse this exact status path; do not retry or resume with this or a different status path. Keep the original backup and verified filesystem stage. An operator must inspect and reconcile the target database and this journal manually before planning another restore.',
    });
    statusIdentity = await writeStatus(statusPath, report, statusIdentity);
    // From this point onward preserve recovery material even if the CREATE
    // transaction's commit acknowledgement is lost. The guard may exist.
    recoveryMayBeRequired = true;
    await createRestoreGuard(targetLock, { restoreId, backupSha256: manifest.dump.sha256, targetIdentity });
    uncertainPhase = 'restore-fence-established-before-pg_restore';
    Object.assign(report, {
      phase: uncertainPhase,
      pgRestoreMayHaveBegun: true,
      targetGuard: { schema: RESTORE_GUARD_SCHEMA, table: 'active_restore', state: 'installed' },
    });
    statusIdentity = await writeStatus(statusPath, report, statusIdentity);
    uncertainPhase = 'pg_restore-result-unconfirmed';
    report.phase = uncertainPhase;
    invocationMayHaveBegun = true;
    // The synced status and committed target guard both precede spawn.
    await withPgPass(targetParts, async (env) => {
      await runTool('pg_restore', ['--no-password', '--exit-on-error', '--single-transaction', '--no-owner', '--no-privileges', `--dbname=${targetParts.database}`, dumpPath], env);
    });
    const restored = await inspectDatabase(targetUrl);
    if (restored.schemaVersion !== manifest.schemaVersion) throw recoveryError('RESTORE_SCHEMA_MISMATCH', 'Restored migration ledger does not match the backup manifest.');
    await verifyArtifactReferences(targetUrl, manifest.files);
    const publishLockPath = path.join(filesystemParent, '.orgward-recovery-filesystem-publish.lock');
    const publishLock = await open(publishLockPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600)
      .catch((error) => error.code === 'EEXIST' ? Promise.reject(recoveryError('RESTORE_FILESYSTEM_LOCKED', 'Another filesystem restore is publishing in this directory.')) : Promise.reject(error));
    try {
      if (await lstat(filesystemRoot).then(() => true, () => false)) throw recoveryError('RESTORE_FILESYSTEM_TARGET_EXISTS', 'The filesystem staging root appeared before publication.');
      await rename(filesystemStage, filesystemRoot);
      filesystemStage = null;
      Object.assign(report.filesystemStage, { path: filesystemRoot, state: 'published' });
    } finally {
      await publishLock.close();
      await unlink(publishLockPath).catch(() => {});
    }
    await removeRestoreGuard(targetLock, { restoreId, backupSha256: manifest.dump.sha256, targetIdentity });
    report.targetGuard.state = 'removed-after-verified-publication';
    delete report.pgRestoreMayHaveBegun;
    Object.assign(report, { state: 'completed', phase: 'verified-completion', recoveryMayBeRequired: false,
      pgRestoreResultConfirmed: true, completedAt: new Date().toISOString(), backupSha256: manifest.dump.sha256,
      sourceDatabase: manifest.source.database, targetDatabase: target.database, schemaVersion: restored.schemaVersion,
      filesystemRootNames: FILE_ROOT_NAMES, filesystemStagingPublished: true });
    statusIdentity = await writeStatus(statusPath, report, statusIdentity);
    await cleanupVerifiedDump();
    return report;
  } catch (error) {
    await cleanupVerifiedDump().catch(() => {});
    if (filesystemStage && !recoveryMayBeRequired) await rm(filesystemStage, { recursive: true, force: true }).catch(() => {});
    Object.assign(report, {
      state: recoveryMayBeRequired ? 'restore-invocation-uncertain' : 'failed',
      phase: recoveryMayBeRequired ? uncertainPhase : 'pre-invocation-failed',
      recoveryMayBeRequired,
      pgRestoreMayHaveBegun: invocationMayHaveBegun,
      completedAt: new Date().toISOString(),
      failureCode: error.code ?? 'RESTORE_FAILED', failureType: error?.name ?? 'Error',
      ...(recoveryMayBeRequired ? { recoveryGuidance: invocationMayHaveBegun
        ? 'The pg_restore process may have changed the target database. Preserve and reuse this exact status path; do not retry or resume with this or a different status path. Keep the original backup and verified filesystem stage. An operator must inspect and reconcile the target database and this journal manually before planning another restore.'
        : 'The target-side restore guard installation may have committed. Preserve and reuse this exact status path; do not retry with another status path. Keep the original backup and verified filesystem stage. An operator must inspect the guard and target database, then reconcile this journal manually.' } : {}),
    });
    await writeStatus(statusPath, report, statusIdentity).catch(() => {});
    if (error.code) throw error;
    throw recoveryError('RESTORE_FAILED', 'Database restore failed; inspect the protected status report.');
  } finally { await targetLock?.end().catch(() => {}); }
}

function cliFailure(error, mode) {
  process.stderr.write(`${mode} failed (${error.code ?? 'RECOVERY_FAILED'}); inspect the protected status report if one was requested.\n`);
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, ...args] = process.argv.slice(2);
  try {
    if (mode === 'backup' && args.length === 1) {
      const result = await backupDatabase({ outputParent: args[0] });
      process.stdout.write(`Backup verified and published: ${result.backupDirectory}\nSHA-256: ${result.manifest.dump.sha256}\n`);
    } else if (mode === 'restore' && args.length === 3) {
      const result = await restoreDatabase({ backupDirectory: args[0], statusPath: args[1], filesystemRoot: args[2] });
      process.stdout.write(`Restore ${result.state}; status: ${args[1]}\n`);
    } else {
      throw recoveryError('USAGE', 'Usage: database-recovery.mjs backup <existing-absolute-parent> | restore <backup-dir> <absolute-status-json> <new-absolute-filesystem-staging-root>');
    }
  } catch (error) { cliFailure(error, mode === 'backup' ? 'Backup' : 'Restore'); }
}
