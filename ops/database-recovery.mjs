import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants, createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { readProtectedDatabaseUrlFile } from '../src/platform/install-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_NAME = 'backup-manifest.json';
const DUMP_NAME = 'database.dump';
const FORMAT_VERSION = 1;

function recoveryError(code, message) { return Object.assign(new Error(message), { code }); }

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
    if (ledger.rows[0].exists) {
      const applied = await client.query(`select version from orgward.schema_migrations order by version`);
      schemaVersion = applied.rows.at(-1)?.version ?? null;
    }
    return { ...identity.rows[0], schemaVersion };
  } catch (error) {
    if (error.code && /^[A-Z][A-Z0-9_]{2,64}$/.test(error.code)) throw error;
    throw recoveryError('DATABASE_UNAVAILABLE', 'The PostgreSQL database could not be inspected.');
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
  if (!manifestStat?.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 65_536) throw recoveryError('BACKUP_INVALID', 'The backup manifest is missing or invalid.');
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); }
  catch { throw recoveryError('BACKUP_INVALID', 'The backup manifest is missing or invalid.'); }
  if (manifest?.formatVersion !== FORMAT_VERSION || manifest.dump?.file !== DUMP_NAME
    || !Number.isSafeInteger(manifest.dump.size) || manifest.dump.size <= 0
    || !/^[a-f0-9]{64}$/.test(manifest.dump.sha256)
    || typeof manifest.createdAt !== 'string' || typeof manifest.appVersion !== 'string' || !manifest.appVersion
    || typeof manifest.source?.database !== 'string'
    || typeof manifest.source?.serverAddress !== 'string' || !Number.isInteger(manifest.source?.serverPort)
    || typeof manifest.schemaVersion !== 'string' || typeof manifest.postgresVersion !== 'string') {
    throw recoveryError('BACKUP_INVALID', 'The backup manifest is incompatible or incomplete.');
  }
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

async function writeStatus(statusPath, report) {
  if (!path.isAbsolute(statusPath)) throw recoveryError('STATUS_PATH_INVALID', 'The restore status path must be absolute.');
  const parent = path.dirname(statusPath);
  const parentStat = await lstat(parent).catch(() => null);
  if (!parentStat?.isDirectory() || parentStat.isSymbolicLink()) throw recoveryError('STATUS_PATH_INVALID', 'The restore status directory must be an existing real directory.');
  const temp = path.join(parent, `.orgward-restore-status-${randomUUID()}.tmp`);
  await writeFile(temp, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await chmod(temp, 0o600);
  await rename(temp, statusPath);
}

export async function backupDatabase({ databaseUrlFile = process.env.ORGWARD_DATABASE_URL_FILE, outputParent, now = new Date() }) {
  if (!outputParent || !path.isAbsolute(outputParent)) throw recoveryError('BACKUP_PATH_INVALID', 'The backup parent directory must be an absolute path.');
  const parentStat = await lstat(outputParent).catch(() => null);
  if (!parentStat?.isDirectory() || parentStat.isSymbolicLink()) throw recoveryError('BACKUP_PATH_INVALID', 'The backup parent must be an existing real directory.');
  const sourceUrl = readProtectedDatabaseUrlFile(databaseUrlFile, 'ORGWARD_DATABASE_URL_FILE');
  const source = await inspectDatabase(sourceUrl);
  if (!source.schemaVersion) throw recoveryError('SOURCE_SCHEMA_UNAVAILABLE', 'The source database has no OrgWard migration ledger.');
  const packageInfo = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const temporary = await mkdtemp(path.join(outputParent, '.orgward-backup-'));
  await chmod(temporary, 0o700);
  const finalPath = path.join(outputParent, `orgward-backup-${now.toISOString().replaceAll(':', '').replaceAll('.', '-')}-${randomUUID()}`);
  try {
    const dumpPath = path.join(temporary, DUMP_NAME);
    await withPgPass(connectionParts(sourceUrl), (env) => runTool('pg_dump', ['--no-password', '--format=custom', '--no-owner', '--no-privileges', '--compress=6', `--file=${dumpPath}`], env));
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
    };
    await writeFile(path.join(temporary, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    if (await lstat(finalPath).then(() => true, () => false)) throw recoveryError('BACKUP_EXISTS', 'A backup already exists at the generated publication path.');
    await rename(temporary, finalPath);
    return { backupDirectory: finalPath, manifest };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    if (error.code) throw error;
    throw recoveryError('BACKUP_FAILED', 'The database backup could not be completed.');
  }
}

export async function restoreDatabase({ backupDirectory, statusPath, targetUrlFile = process.env.ORGWARD_RESTORE_DATABASE_URL_FILE }) {
  const startedAt = new Date().toISOString();
  const report = { formatVersion: FORMAT_VERSION, state: 'running', startedAt };
  await writeStatus(statusPath, report);
  let cleanupVerifiedDump = async () => {};
  try {
    const targetUrl = readProtectedDatabaseUrlFile(targetUrlFile, 'ORGWARD_RESTORE_DATABASE_URL_FILE');
    const { manifest, dumpPath, cleanup } = await readManifest(backupDirectory);
    cleanupVerifiedDump = cleanup;
    await runTool('pg_restore', ['--list', '--no-password', '--file=/dev/null', dumpPath], { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? tmpdir(), ...(process.env.ORGWARD_PG_TOOLS_LIBRARY_PATH ? { LD_LIBRARY_PATH: process.env.ORGWARD_PG_TOOLS_LIBRARY_PATH } : {}) });
    if (process.env.ORGWARD_DATABASE_URL_FILE && path.resolve(targetUrlFile) === path.resolve(process.env.ORGWARD_DATABASE_URL_FILE)) {
      throw recoveryError('RESTORE_SOURCE_TARGET', 'Restore target file must be distinct from the configured service database file.');
    }
    const target = await inspectDatabase(targetUrl);
    const sourceMajor = Number.parseInt(manifest.postgresVersion, 10);
    const targetMajor = Math.floor(target.postgres_version_num / 10_000);
    if (!Number.isSafeInteger(sourceMajor) || targetMajor < sourceMajor) {
      throw recoveryError('BACKUP_INCOMPATIBLE', 'The restore target PostgreSQL major version is older than the backup source.');
    }
    const sameSource = target.database === manifest.source.database && target.server_address === manifest.source.serverAddress
      && target.server_port === manifest.source.serverPort;
    if (sameSource) throw recoveryError('RESTORE_SOURCE_TARGET', 'Restore target must be distinct from the backup source.');
    if (!await isEmptyTarget(targetUrl)) throw recoveryError('RESTORE_TARGET_NOT_EMPTY', 'Restore target is not empty; no data was overwritten.');
    const targetParts = connectionParts(targetUrl);
    await withPgPass(targetParts, async (env) => {
      await runTool('pg_restore', ['--no-password', '--exit-on-error', '--single-transaction', '--no-owner', '--no-privileges', `--dbname=${targetParts.database}`, dumpPath], env);
    });
    const restored = await inspectDatabase(targetUrl);
    if (restored.schemaVersion !== manifest.schemaVersion) throw recoveryError('RESTORE_SCHEMA_MISMATCH', 'Restored migration ledger does not match the backup manifest.');
    Object.assign(report, { state: 'completed', completedAt: new Date().toISOString(), backupSha256: manifest.dump.sha256,
      sourceDatabase: manifest.source.database, targetDatabase: target.database, schemaVersion: restored.schemaVersion });
    await writeStatus(statusPath, report);
    await cleanupVerifiedDump();
    return report;
  } catch (error) {
    await cleanupVerifiedDump().catch(() => {});
    Object.assign(report, { state: 'failed', completedAt: new Date().toISOString(), failureCode: error.code ?? 'RESTORE_FAILED', failureType: error?.name ?? 'Error' });
    await writeStatus(statusPath, report).catch(() => {});
    if (error.code) throw error;
    throw recoveryError('RESTORE_FAILED', 'Database restore failed; inspect the protected status report.');
  }
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
    } else if (mode === 'restore' && args.length === 2) {
      const result = await restoreDatabase({ backupDirectory: args[0], statusPath: args[1] });
      process.stdout.write(`Restore ${result.state}; status: ${args[1]}\n`);
    } else {
      throw recoveryError('USAGE', 'Usage: database-recovery.mjs backup <existing-absolute-parent> | restore <backup-dir> <absolute-status-json>');
    }
  } catch (error) { cliFailure(error, mode === 'backup' ? 'Backup' : 'Restore'); }
}
