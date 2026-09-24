import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, cp, link, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { request as httpRequest } from 'node:http';
import { createApp } from '../../server.mjs';
import { createProject } from '../../src/model.mjs';
import { contentHash, RECOVERY_ADVISORY_LOCK_KEY } from '../../src/platform/postgres.mjs';
import { digest } from '../../src/sdlc/contracts.mjs';
import { backupDatabase, restoreDatabase } from '../../ops/database-recovery.mjs';
import { RESTORE_GUARD_SCHEMA } from '../../src/platform/recovery-guard.mjs';
import { startPostgres } from '../helpers/postgres.mjs';
import { Client } from 'pg';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
const preflightScript = new URL('../../ops/preflight.mjs', import.meta.url);

function toolsDirectory() {
  if (process.env.ORGWARD_PG_TOOLS_BIN) return process.env.ORGWARD_PG_TOOLS_BIN;
  const candidates = ['/usr/bin', '/usr/lib/postgresql/18/bin', '/usr/lib/postgresql/16/bin'];
  for (const directory of candidates) {
    try { if (process.getBuiltinModule('node:fs').statSync(path.join(directory, 'pg_dump')).isFile()) return directory; } catch {}
  }
  return null;
}

async function protectedUrlFile(directory, name, url) {
  const file = path.join(directory, name);
  await writeFile(file, `${url}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
  return file;
}

async function seedProject(databaseUrl, fileRoots, legacyArtifactHash, artifactHash) {
  const app = createApp({ databaseUrl, secretEncryptionKey: Buffer.alloc(32, 6),
    dataDirectory: fileRoots.find((root) => root.name === 'projects').sourcePath,
    sdlcDirectory: fileRoots.find((root) => root.name === 'sdlc').sourcePath,
    executionDirectory: fileRoots.find((root) => root.name === 'execution-runs').sourcePath,
    executionWorkspaceDirectory: fileRoots.find((root) => root.name === 'execution-workspaces').sourcePath });
  try {
    await app.init();
    const project = createProject('Recovery journey retained project');
    Object.assign(project, { tenantId: 'tenant-recovery', version: 1, createdBy: 'operator-principal', updatedBy: 'operator-principal' });
    await app.persistence.query(`insert into orgward.aggregates
      (tenant_id,aggregate_kind,aggregate_id,version,state,state_hash,updated_at)
      values ($1,'project',$2,$3,$4::jsonb,$5,$6::timestamptz)`,
    [project.tenantId, project.id, project.version, JSON.stringify(project), contentHash(project), project.updatedAt]);
    const runId = 'execution-run-11111111-1111-4111-8111-111111111111';
    const run = { id: runId, tenantId: project.tenantId, projectId: project.id, version: 1, status: 'SUCCEEDED',
      profile: { id: 'recovery-fixture-profile' },
      execution: { changedArtifacts: [
        { path: 'report.txt', contentHash: legacyArtifactHash },
        { path: 'report-new.txt', contentHash: artifactHash, hashAlgorithm: 'sha256-raw' },
      ] } };
    await app.persistence.query(`insert into orgward.aggregates
      (tenant_id,aggregate_kind,aggregate_id,version,state,state_hash,updated_at)
      values ($1,'execution_run',$2,$3,$4::jsonb,$5,now())`,
    [run.tenantId, run.id, run.version, JSON.stringify(run), contentHash(run)]);
    return { projectId: project.id, runId };
  } finally { await app.close(); }
}

async function assertNoOrgWardSchema(database) {
  return (await database.query(`select to_regnamespace('orgward') is null as empty`)).rows[0].empty;
}

async function listen(app) {
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', resolve);
  });
  return app.server.address().port;
}

async function closeApp(app) {
  if (app.server.listening) await new Promise((resolve, reject) => {
    app.server.close((error) => error ? reject(error) : resolve());
  });
  await app.close();
}

async function getArtifact(port, runId, artifactPath = 'report.txt') {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, path: `/api/execution/runs/${runId}/artifact?path=${encodeURIComponent(artifactPath)}`, headers: { 'x-orgward-tenant': 'tenant-recovery' } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, hash: response.headers['x-content-sha256'], body: Buffer.concat(chunks) }));
    });
    request.on('error', reject);
    request.end();
  });
}

async function runPreflight(env) {
  try {
    const result = await runFile(process.execPath, [preflightScript.pathname], { cwd: process.cwd(), env, maxBuffer: 1_000_000 });
    return { code: 0, output: `${result.stdout}${result.stderr}` };
  } catch (error) {
    return { code: error.code, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

async function assertRestoredStateUnchanged(database, stageRoot, roots, expectedFiles) {
  const migrations = (await database.query('select version,checksum from orgward.schema_migrations order by version')).rows;
  const aggregates = (await database.query('select aggregate_kind,aggregate_id,version,state_hash from orgward.aggregates order by aggregate_kind,aggregate_id')).rows;
  assert.ok(migrations.length > 0);
  assert.ok(aggregates.length > 0);
  for (const entry of expectedFiles) {
    const bytes = await readFile(path.join(stageRoot, entry.root, ...entry.path.split('/')));
    assert.equal(bytes.length, entry.size);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  }
  for (const root of roots) assert.equal((await stat(root)).isDirectory(), true);
  return { migrations, aggregates };
}

test('PostgreSQL backup and restore verify metadata, refuse unsafe targets, record failures and restore persisted data transactionally', async (t) => {
  const pgBin = toolsDirectory();
  if (!pgBin) return t.skip('PostgreSQL client tools are not available; set ORGWARD_PG_TOOLS_BIN for the qualified recovery journey.');
  const databases = [];
  t.after(async () => { for (const database of databases) await database.close(); });
  const source = await startPostgres(); databases.push(source);
  const target = await startPostgres(); databases.push(target);
  const nonempty = await startPostgres(); databases.push(nonempty);
  const tamperedTarget = await startPostgres(); databases.push(tamperedTarget);
  const tamperedFilesTarget = await startPostgres(); databases.push(tamperedFilesTarget);
  const failedTarget = await startPostgres(); databases.push(failedTarget);
  const guardedEmptyTarget = await startPostgres(); databases.push(guardedEmptyTarget);
  const lockLossDatabase = await startPostgres(); databases.push(lockLossDatabase);
  const temporary = await mkdtemp(path.join(tmpdir(), 'orgward-recovery-test-'));
  await chmod(temporary, 0o700);
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const oldToolBin = process.env.ORGWARD_PG_TOOLS_BIN;
  process.env.ORGWARD_PG_TOOLS_BIN = pgBin;
  t.after(() => { if (oldToolBin === undefined) delete process.env.ORGWARD_PG_TOOLS_BIN; else process.env.ORGWARD_PG_TOOLS_BIN = oldToolBin; });

  const sourceUrl = new URL(source.databaseUrl);
  sourceUrl.password = 'backup-credential-canary';
  const sourceFile = await protectedUrlFile(temporary, 'source-url', sourceUrl.href);
  const targetFile = await protectedUrlFile(temporary, 'target-url', target.databaseUrl);
  const nonemptyFile = await protectedUrlFile(temporary, 'nonempty-url', nonempty.databaseUrl);
  const tamperedFile = await protectedUrlFile(temporary, 'tampered-url', tamperedTarget.databaseUrl);
  const tamperedFilesFile = await protectedUrlFile(temporary, 'tampered-files-url', tamperedFilesTarget.databaseUrl);
  const failedFile = await protectedUrlFile(temporary, 'failed-url', failedTarget.databaseUrl);
  const fileRootParent = path.join(temporary, 'live-roots');
  const fileRoots = [
    { name: 'projects', sourcePath: path.join(fileRootParent, 'projects') },
    { name: 'sdlc', sourcePath: path.join(fileRootParent, 'sdlc') },
    { name: 'execution-runs', sourcePath: path.join(fileRootParent, 'execution-runs') },
    { name: 'execution-workspaces', sourcePath: path.join(fileRootParent, 'execution-workspaces') },
  ];
  await Promise.all(fileRoots.map((root) => mkdir(root.sourcePath, { recursive: true, mode: 0o700 })));
  const artifactBody = Buffer.from('verified recovered execution evidence\n');
  const artifactHash = contentHash(artifactBody);
  const runId = 'execution-run-11111111-1111-4111-8111-111111111111';
  await mkdir(path.join(fileRoots[3].sourcePath, runId), { mode: 0o700 });
  await writeFile(path.join(fileRoots[0].sourcePath, 'legacy-project.json'), '{"id":"legacy-example"}\n', { mode: 0o600 });
  await writeFile(path.join(fileRoots[1].sourcePath, 'case-record.json'), '{"id":"case-example"}\n', { mode: 0o600 });
  await writeFile(path.join(fileRoots[2].sourcePath, 'run-record.json'), '{"id":"run-example"}\n', { mode: 0o600 });
  await writeFile(path.join(fileRoots[3].sourcePath, runId, 'report.txt'), artifactBody, { mode: 0o600 });
  await writeFile(path.join(fileRoots[3].sourcePath, runId, 'report-new.txt'), artifactBody, { mode: 0o600 });
  const { projectId } = await seedProject(sourceUrl.href, fileRoots, digest(artifactBody), artifactHash);
  const backupParent = path.join(temporary, 'backups');
  await mkdir(backupParent, { mode: 0o700 });
  const backupOptions = { databaseUrlFile: sourceFile, outputParent: backupParent, fileRoots };
  const migrationLedger = (await source.query('select version,checksum from orgward.schema_migrations order by version')).rows;
  await source.query("update orgward.schema_migrations set checksum=repeat('0',64) where version=$1", [migrationLedger.at(-1).version]);
  await assert.rejects(backupDatabase(backupOptions), { code: 'SOURCE_SCHEMA_INVALID' });
  await source.query('update orgward.schema_migrations set checksum=$2 where version=$1', [migrationLedger.at(-1).version, migrationLedger.at(-1).checksum]);
  await source.query('delete from orgward.schema_migrations where version=$1', [migrationLedger[1].version]);
  await assert.rejects(backupDatabase(backupOptions), { code: 'SOURCE_SCHEMA_INVALID' });
  await source.query('insert into orgward.schema_migrations(version,checksum) values($1,$2)', [migrationLedger[1].version, migrationLedger[1].checksum]);
  const runStateHash = (await source.query("select state_hash from orgward.aggregates where aggregate_kind='execution_run' and aggregate_id=$1", [runId])).rows[0].state_hash;
  await source.query("update orgward.aggregates set state_hash=repeat('0',64) where aggregate_kind='execution_run' and aggregate_id=$1", [runId]);
  await assert.rejects(backupDatabase(backupOptions), { code: 'PERSISTENCE_INTEGRITY' });
  await source.query('update orgward.aggregates set state_hash=$2 where aggregate_kind=$3 and aggregate_id=$1', [runId, runStateHash, 'execution_run']);
  const originalRunState = (await source.query("select state from orgward.aggregates where aggregate_kind='execution_run' and aggregate_id=$1", [runId])).rows[0].state;
  const unknownHashRun = structuredClone(originalRunState);
  unknownHashRun.execution.changedArtifacts[1].hashAlgorithm = 'sha256-unknown';
  await source.query("update orgward.aggregates set state=$2::jsonb,state_hash=$3 where aggregate_kind='execution_run' and aggregate_id=$1", [runId, JSON.stringify(unknownHashRun), contentHash(unknownHashRun)]);
  await assert.rejects(backupDatabase(backupOptions), { code: 'ARTIFACT_REFERENCE_INVALID' });
  await source.query("update orgward.aggregates set state=$2::jsonb,state_hash=$3 where aggregate_kind='execution_run' and aggregate_id=$1", [runId, JSON.stringify(originalRunState), contentHash(originalRunState)]);
  await source.query(`insert into orgward.oidc_principals (principal, issuer, tenant_id, actor_type, roles, display_name)
    values ('oidc:${'a'.repeat(64)}','https://backup.example.test','tenant-recovery','human','{}','Backup worker')`);
  await source.query(`insert into orgward.execution_worker_leases
    (tenant_id,run_id,project_id,principal,worker_id,lease_until)
    values ('tenant-recovery',$1,$2,'oidc:${'a'.repeat(64)}','22222222-2222-4222-8222-222222222222',clock_timestamp()+interval '10 minutes')`, [runId, projectId]);
  await assert.rejects(backupDatabase(backupOptions), { code: 'WORKERS_NOT_QUIESCED' });
  await source.query("update orgward.execution_worker_leases set lease_until=clock_timestamp()-interval '1 second' where run_id=$1", [runId]);
  await assert.rejects(backupDatabase(backupOptions), { code: 'WORKERS_NOT_QUIESCED' });
  await source.query('delete from orgward.execution_worker_leases where run_id=$1', [runId]);
  const runState = (await source.query("select state from orgward.aggregates where aggregate_kind='execution_run' and aggregate_id=$1", [runId])).rows[0].state;
  const runningState = { ...runState, status: 'RUNNING' };
  const runningHash = contentHash(runningState);
  await source.query("update orgward.aggregates set state=$2::jsonb,state_hash=$3 where aggregate_kind='execution_run' and aggregate_id=$1", [runId, JSON.stringify(runningState), runningHash]);
  await assert.rejects(backupDatabase(backupOptions), { code: 'WORKERS_NOT_QUIESCED' });
  await source.query("update orgward.aggregates set state=$2::jsonb,state_hash=$3 where aggregate_kind='execution_run' and aggregate_id=$1", [runId, JSON.stringify(runState), contentHash(runState)]);
  assert.deepEqual(await readdir(backupParent), []);
  const activeApp = createApp({ databaseUrl: source.databaseUrl, secretEncryptionKey: Buffer.alloc(32, 6),
    dataDirectory: fileRoots[0].sourcePath, sdlcDirectory: fileRoots[1].sourcePath,
    executionDirectory: fileRoots[2].sourcePath, executionWorkspaceDirectory: fileRoots[3].sourcePath });
  await activeApp.init();
  t.after(() => activeApp.close());
  await assert.rejects(backupDatabase(backupOptions), { code: 'BACKUP_SERVICE_ACTIVE' });
  assert.deepEqual(await readdir(backupParent), []);
  await activeApp.close();
  const exclusive = new Client({ connectionString: source.databaseUrl });
  await exclusive.connect();
  try {
    assert.equal((await exclusive.query('select pg_try_advisory_lock($1::bigint) as acquired', [RECOVERY_ADVISORY_LOCK_KEY])).rows[0].acquired, true);
    const blockedApp = createApp({ databaseUrl: source.databaseUrl, secretEncryptionKey: Buffer.alloc(32, 6) });
    await assert.rejects(blockedApp.init(), { code: 'RECOVERY_OPERATION_ACTIVE' });
    await blockedApp.close();
  } finally { await exclusive.end(); }

  const lockLossApp = createApp({ databaseUrl: lockLossDatabase.databaseUrl, secretEncryptionKey: Buffer.alloc(32, 6) });
  await lockLossApp.init();
  await new Promise((resolve) => lockLossApp.server.listen(0, '127.0.0.1', resolve));
  const terminateLockClient = new Client({ connectionString: lockLossDatabase.databaseUrl });
  await terminateLockClient.connect();
  try {
    await terminateLockClient.query('select pg_terminate_backend($1) as terminated', [lockLossApp.persistence.recoveryLockClient.processID]);
    const deadline = Date.now() + 3_000;
    while (lockLossApp.persistence.recoveryLockHealthy && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(lockLossApp.persistence.recoveryLockHealthy, false);
    await assert.rejects(lockLossApp.persistence.query('select 1'), { code: 'RECOVERY_LOCK_UNAVAILABLE' });
    const liveness = await new Promise((resolve, reject) => {
      httpRequest({ host: '127.0.0.1', port: lockLossApp.server.address().port, path: '/livez' }, (response) => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      }).on('error', reject).end();
    });
    assert.equal(liveness, 200);
    const readiness = await new Promise((resolve, reject) => {
      httpRequest({ host: '127.0.0.1', port: lockLossApp.server.address().port, path: '/readyz' }, (response) => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      }).on('error', reject).end();
    });
    assert.equal(readiness, 503);
    assert.equal((await terminateLockClient.query('select pg_try_advisory_lock($1::bigint) as acquired', [RECOVERY_ADVISORY_LOCK_KEY])).rows[0].acquired, true);
    await terminateLockClient.query('select pg_advisory_unlock($1::bigint)', [RECOVERY_ADVISORY_LOCK_KEY]);
  } finally {
    await terminateLockClient.end();
    if (lockLossApp.server.listening) await new Promise((resolve, reject) => {
      let callbacks = 0;
      const onClose = (error) => {
        if (error) { reject(error); return; }
        callbacks += 1;
        if (callbacks === 2) resolve();
      };
      lockLossApp.server.close(onClose);
      lockLossApp.server.close(onClose);
    });
    await lockLossApp.close();
  }

  const unsafeLink = path.join(fileRoots[0].sourcePath, 'unsafe-link');
  await symlink('/etc/passwd', unsafeLink);
  await assert.rejects(backupDatabase(backupOptions), { code: 'FILESYSTEM_UNSAFE' });
  await unlink(unsafeLink);
  const hardlinkPath = path.join(fileRoots[0].sourcePath, 'hardlink.json');
  await link(path.join(fileRoots[0].sourcePath, 'legacy-project.json'), hardlinkPath);
  await assert.rejects(backupDatabase(backupOptions), { code: 'FILESYSTEM_UNSAFE' });
  await unlink(hardlinkPath);
  assert.deepEqual(await readdir(backupParent), []);
  const loggingTools = path.join(temporary, 'logging-tools');
  await mkdir(loggingTools, { mode: 0o700 });
  const dumpArgsPath = path.join(temporary, 'pg-dump-argv.txt');
  const passFilePath = path.join(temporary, 'pgpass-path.txt');
  await writeFile(path.join(loggingTools, 'pg_dump'), `#!/bin/sh\nprintf '%s\\n' "$*" > "${dumpArgsPath}"\nprintf '%s\\n' "$PGPASSFILE" > "${passFilePath}"\nexec "${path.join(pgBin, 'pg_dump')}" "$@"\n`, { mode: 0o700 });
  await chmod(path.join(loggingTools, 'pg_dump'), 0o700);
  await writeFile(path.join(loggingTools, 'pg_restore'), `#!/bin/sh\nexec "${path.join(pgBin, 'pg_restore')}" "$@"\n`, { mode: 0o700 });
  await chmod(path.join(loggingTools, 'pg_restore'), 0o700);
  process.env.ORGWARD_PG_TOOLS_BIN = loggingTools;
  const backup = await backupDatabase(backupOptions);
  assert.equal(backup.manifest.source.database, new URL(source.databaseUrl).pathname.slice(1));
  assert.equal(Object.values(backup.manifest).join(' ').includes('backup-credential-canary'), false);
  assert.equal((await stat(backup.backupDirectory)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(backup.backupDirectory, 'database.dump'))).mode & 0o077, 0);
  assert.equal((await stat(path.join(backup.backupDirectory, 'backup-manifest.json'))).mode & 0o077, 0);
  assert.equal((await readdir(backup.backupDirectory)).sort().join(','), 'backup-manifest.json,database.dump,files');
  assert.equal(backup.manifest.files.find((entry) => entry.root === 'execution-workspaces' && entry.path === `${runId}/report.txt`)?.sha256, artifactHash);
  assert.equal(backup.manifest.files.find((entry) => entry.root === 'execution-workspaces' && entry.path === `${runId}/report.txt`)?.legacySha256, digest(artifactBody));
  assert.equal((await readFile(path.join(backup.backupDirectory, 'backup-manifest.json'), 'utf8')).includes('backup-credential-canary'), false);
  assert.equal((await readFile(dumpArgsPath, 'utf8')).includes('backup-credential-canary'), false);
  await assert.rejects(stat((await readFile(passFilePath, 'utf8')).trim()));

  const sourceStatus = path.join(temporary, 'same-source-status.json');
  const existingStatus = path.join(temporary, 'existing-status.json');
  await writeFile(existingStatus, 'operator data must remain untouched\n', { mode: 0o600 });
  await assert.rejects(restoreDatabase({ backupDirectory: backup.backupDirectory, statusPath: existingStatus, targetUrlFile: sourceFile, filesystemRoot: path.join(temporary, 'unused-stage') }), { code: 'STATUS_PATH_EXISTS' });
  assert.equal(await readFile(existingStatus, 'utf8'), 'operator data must remain untouched\n');
  const sourceFailure = await restoreDatabase({ backupDirectory: backup.backupDirectory, statusPath: sourceStatus, targetUrlFile: sourceFile, filesystemRoot: path.join(temporary, 'source-stage') }).catch((error) => error);
  const sourceReport = JSON.parse(await readFile(sourceStatus, 'utf8'));
  assert.equal(sourceFailure.code, 'RESTORE_SOURCE_TARGET', JSON.stringify(sourceReport));
  assert.equal(sourceReport.state, 'failed');

  const priorServiceUrlFile = process.env.ORGWARD_DATABASE_URL_FILE;
  process.env.ORGWARD_DATABASE_URL_FILE = targetFile;
  try {
    const servicePathStatus = path.join(temporary, 'service-path-status.json');
    await assert.rejects(restoreDatabase({ backupDirectory: backup.backupDirectory, statusPath: servicePathStatus, targetUrlFile: targetFile, filesystemRoot: path.join(temporary, 'service-stage') }), { code: 'RESTORE_SOURCE_TARGET' });
    assert.equal(JSON.parse(await readFile(servicePathStatus, 'utf8')).state, 'failed');
  } finally {
    if (priorServiceUrlFile === undefined) delete process.env.ORGWARD_DATABASE_URL_FILE;
    else process.env.ORGWARD_DATABASE_URL_FILE = priorServiceUrlFile;
  }

  await nonempty.query('create table preserved_before_restore (id integer primary key)');
  const nonemptyStatus = path.join(temporary, 'nonempty-status.json');
  const conflictStage = path.join(temporary, 'existing-stage');
  await mkdir(conflictStage);
  await writeFile(path.join(conflictStage, 'keep.txt'), 'keep', { mode: 0o600 });
  await assert.rejects(restoreDatabase({ backupDirectory: backup.backupDirectory, statusPath: nonemptyStatus, targetUrlFile: nonemptyFile, filesystemRoot: conflictStage }), { code: 'RESTORE_FILESYSTEM_TARGET_EXISTS' });
  assert.equal(JSON.parse(await readFile(nonemptyStatus, 'utf8')).state, 'failed');
  assert.equal(await readFile(path.join(conflictStage, 'keep.txt'), 'utf8'), 'keep');
  assert.equal((await nonempty.query(`select to_regclass('public.preserved_before_restore') is not null as exists`)).rows[0].exists, true);

  const filesystemStage = path.join(temporary, 'restored-files');
  const successStatusPath = path.join(temporary, 'success-status.json');
  const restored = await restoreDatabase({ backupDirectory: backup.backupDirectory, statusPath: successStatusPath, targetUrlFile: targetFile, filesystemRoot: filesystemStage });
  assert.equal(restored.state, 'completed');
  const successReport = JSON.parse(await readFile(successStatusPath, 'utf8'));
  assert.equal(successReport.phase, 'verified-completion');
  assert.equal(successReport.recoveryMayBeRequired, false);
  assert.equal(successReport.pgRestoreResultConfirmed, true);
  assert.equal(successReport.pgRestoreMayHaveBegun, undefined);
  assert.equal(successReport.targetGuard.state, 'removed-after-verified-publication');
  assert.equal((await target.query('select exists(select 1 from pg_namespace where nspname=$1) as present', [RESTORE_GUARD_SCHEMA])).rows[0].present, false,
    'a successful restore removes its target guard before service startup');
  assert.equal(restored.sourceDatabase, new URL(source.databaseUrl).pathname.slice(1));
  assert.equal(restored.targetDatabase, new URL(target.databaseUrl).pathname.slice(1));
  assert.equal(await readFile(path.join(filesystemStage, 'execution-workspaces', runId, 'report.txt'), 'utf8'), artifactBody.toString());
  assert.equal(await readFile(path.join(filesystemStage, 'projects', 'legacy-project.json'), 'utf8'), '{"id":"legacy-example"}\n');
  const restoredRoots = {
    projects: path.join(filesystemStage, 'projects'),
    sdlc: path.join(filesystemStage, 'sdlc'),
    executionRuns: path.join(filesystemStage, 'execution-runs'),
    executionWorkspaces: path.join(filesystemStage, 'execution-workspaces'),
  };
  const keyPath = path.join(temporary, 'restored-encryption-key');
  await writeFile(keyPath, `${Buffer.alloc(32, 6).toString('base64')}\n`, { mode: 0o600 });
  await chmod(keyPath, 0o600);
  const preflightEnv = {
    PATH: process.env.PATH,
    HOST: '127.0.0.1',
    ORGWARD_AUTH_MODE: 'development',
    ORGWARD_DATABASE_URL_FILE: targetFile,
    ORGWARD_SECRET_ENCRYPTION_KEY_FILE: keyPath,
    ORGWARD_ENABLE_LOCAL_EXECUTION: 'true',
    ORGWARD_DATA_DIR: restoredRoots.projects,
    ORGWARD_SDLC_DATA_DIR: restoredRoots.sdlc,
    ORGWARD_EXECUTION_DATA_DIR: restoredRoots.executionRuns,
    ORGWARD_EXECUTION_WORKSPACE_DIR: restoredRoots.executionWorkspaces,
  };
  const expectedStageFiles = backup.manifest.files;
  const beforePreflight = await assertRestoredStateUnchanged(target, filesystemStage, Object.values(restoredRoots), expectedStageFiles);
  const deniedPreflight = await runPreflight({
    ...preflightEnv,
    ORGWARD_EXECUTION_WORKSPACE_DIR: path.join(restoredRoots.projects, 'legacy-project.json'),
  });
  assert.equal(deniedPreflight.code, 1, deniedPreflight.output);
  assert.match(deniedPreflight.output, /Execution workspace directory resolves to a non-directory path/);
  assert.equal(deniedPreflight.output.includes(target.databaseUrl), false);
  assert.equal(deniedPreflight.output.includes(Buffer.alloc(32, 6).toString('base64')), false);
  assert.deepEqual(await assertRestoredStateUnchanged(target, filesystemStage, Object.values(restoredRoots), expectedStageFiles), beforePreflight);
  const passedPreflight = await runPreflight(preflightEnv);
  assert.equal(passedPreflight.code, 0, passedPreflight.output);
  assert.match(passedPreflight.output, /schema \d{3}-[a-z0-9-]+ is current/);
  assert.match(passedPreflight.output, /Preflight passed\. No database or local application data was changed\./);
  assert.equal(passedPreflight.output.includes(target.databaseUrl), false);
  assert.equal(passedPreflight.output.includes(Buffer.alloc(32, 6).toString('base64')), false);
  assert.deepEqual(await assertRestoredStateUnchanged(target, filesystemStage, Object.values(restoredRoots), expectedStageFiles), beforePreflight);
  const recoveryProfile = { id: 'recovery-fixture-profile', kind: 'system-generator', version: '1.0.0', executable: process.execPath, workspaceRoot: restoredRoots.executionWorkspaces };
  const targetApp = createApp({ databaseUrl: target.databaseUrl, secretEncryptionKey: Buffer.alloc(32, 6),
    dataDirectory: restoredRoots.projects, sdlcDirectory: restoredRoots.sdlc,
    executionDirectory: restoredRoots.executionRuns, executionWorkspaceDirectory: restoredRoots.executionWorkspaces,
    executionProfiles: [recoveryProfile] });
  try {
    await targetApp.init();
    const retained = await targetApp.persistence.query(`select state->>'name' as name from orgward.aggregates where tenant_id='tenant-recovery' and aggregate_id=$1`, [projectId]);
    assert.equal(retained.rows[0].name, 'Recovery journey retained project');
    const port = await listen(targetApp);
    const artifact = await getArtifact(port, runId);
    assert.equal(artifact.status, 200);
    assert.equal(artifact.hash, artifactHash);
    assert.deepEqual(artifact.body, artifactBody);
    const markedArtifact = await getArtifact(port, runId, 'report-new.txt');
    assert.equal(markedArtifact.status, 200);
    assert.equal(markedArtifact.hash, artifactHash);
    assert.deepEqual(markedArtifact.body, artifactBody);
  } finally { await closeApp(targetApp); }

  await guardedEmptyTarget.query(`create schema "${RESTORE_GUARD_SCHEMA}"`);
  const guardedApp = createApp({ databaseUrl: guardedEmptyTarget.databaseUrl, secretEncryptionKey: Buffer.alloc(32, 6) });
  await assert.rejects(guardedApp.init(), { code: 'RESTORE_RECOVERY_GUARD' });
  assert.equal(await assertNoOrgWardSchema(guardedEmptyTarget), true,
    'service startup rejects the target-side guard before creating or migrating the OrgWard schema');
  await guardedApp.close();
  const restarted = createApp({ databaseUrl: target.databaseUrl, secretEncryptionKey: Buffer.alloc(32, 6),
    dataDirectory: restoredRoots.projects, sdlcDirectory: restoredRoots.sdlc,
    executionDirectory: restoredRoots.executionRuns, executionWorkspaceDirectory: restoredRoots.executionWorkspaces,
    executionProfiles: [recoveryProfile] });
  try {
    await restarted.init();
    assert.equal((await restarted.persistence.query(`select count(*)::int as count from orgward.aggregates where tenant_id='tenant-recovery' and aggregate_id=$1`, [projectId])).rows[0].count, 1);
    const port = await listen(restarted);
    const artifact = await getArtifact(port, runId);
    assert.equal(artifact.status, 200);
    assert.equal(artifact.hash, artifactHash);
    assert.deepEqual(artifact.body, artifactBody);
    const markedArtifact = await getArtifact(port, runId, 'report-new.txt');
    assert.equal(markedArtifact.status, 200);
    assert.equal(markedArtifact.hash, artifactHash);
    assert.deepEqual(markedArtifact.body, artifactBody);
  } finally { await closeApp(restarted); }

  const tamperedDir = path.join(temporary, 'tampered-backup');
  await cp(backup.backupDirectory, tamperedDir, { recursive: true });
  const dump = await readFile(path.join(tamperedDir, 'database.dump'));
  dump[Math.floor(dump.length / 2)] ^= 0x01;
  await writeFile(path.join(tamperedDir, 'database.dump'), dump, { mode: 0o600 });
  const tamperedStatus = path.join(temporary, 'tampered-status.json');
  await assert.rejects(restoreDatabase({ backupDirectory: tamperedDir, statusPath: tamperedStatus, targetUrlFile: tamperedFile, filesystemRoot: path.join(temporary, 'tampered-stage') }), { code: 'BACKUP_INTEGRITY_FAILED' });
  assert.equal(JSON.parse(await readFile(tamperedStatus, 'utf8')).state, 'failed');
  assert.equal(await assertNoOrgWardSchema(tamperedTarget), true);

  const tamperedFilesDir = path.join(temporary, 'tampered-files-backup');
  await cp(backup.backupDirectory, tamperedFilesDir, { recursive: true });
  await writeFile(path.join(tamperedFilesDir, 'files', 'projects', 'legacy-project.json'), 'tampered filesystem bytes\n', { mode: 0o600 });
  const tamperedFilesStatus = path.join(temporary, 'tampered-files-status.json');
  const tamperedFilesStage = path.join(temporary, 'tampered-files-stage');
  await assert.rejects(restoreDatabase({ backupDirectory: tamperedFilesDir, statusPath: tamperedFilesStatus, targetUrlFile: tamperedFilesFile, filesystemRoot: tamperedFilesStage }), { code: 'BACKUP_INTEGRITY_FAILED' });
  assert.equal(JSON.parse(await readFile(tamperedFilesStatus, 'utf8')).state, 'failed');
  assert.equal(await assertNoOrgWardSchema(tamperedFilesTarget), true);
  assert.equal(await readdir(temporary).then((entries) => entries.includes('tampered-files-stage')), false);

  const failingTools = path.join(temporary, 'failing-tools');
  await mkdir(failingTools, { mode: 0o700 });
  const restorePath = path.join(pgBin, 'pg_restore');
  const restoreInvocationCount = path.join(temporary, 'pg-restore-invocations');
  await writeFile(path.join(failingTools, 'pg_restore'), `#!/bin/sh\nprintf 'started\\n' >> "${restoreInvocationCount}"\nfor arg in "$@"; do if [ "$arg" = "--list" ]; then exec "${restorePath}" "$@"; fi; done\n"${restorePath}" "$@"\nrestore_code=$?\nif [ "$restore_code" -ne 0 ]; then exit "$restore_code"; fi\nexit 23\n`, { mode: 0o700 });
  await chmod(path.join(failingTools, 'pg_restore'), 0o700);
  process.env.ORGWARD_PG_TOOLS_BIN = failingTools;
  const failedStatus = path.join(temporary, 'failed-status.json');
  const failedStage = path.join(temporary, 'failed-stage');
  await assert.rejects(restoreDatabase({ backupDirectory: backup.backupDirectory, statusPath: failedStatus, targetUrlFile: failedFile, filesystemRoot: failedStage }), { code: 'PG_RESTORE_FAILED' });
  const uncertainStatus = JSON.parse(await readFile(failedStatus, 'utf8'));
  assert.equal(uncertainStatus.state, 'restore-invocation-uncertain');
  assert.equal(uncertainStatus.phase, 'pg_restore-result-unconfirmed');
  assert.equal(uncertainStatus.recoveryMayBeRequired, true);
  assert.equal(uncertainStatus.pgRestoreMayHaveBegun, true);
  assert.equal(uncertainStatus.statusPath, failedStatus);
  assert.equal(uncertainStatus.backupPath, backup.backupDirectory);
  assert.equal(uncertainStatus.backupSha256, backup.manifest.dump.sha256);
  assert.equal(uncertainStatus.targetIdentity.database, new URL(failedTarget.databaseUrl).pathname.slice(1));
  const preservedStagePath = uncertainStatus.filesystemStage.path;
  assert.equal(path.dirname(preservedStagePath), temporary);
  assert.match(path.basename(preservedStagePath), /^\.orgward-restore-files-/);
  assert.equal(uncertainStatus.filesystemStage.intendedPublishPath, failedStage);
  assert.equal(uncertainStatus.filesystemStage.state, 'verified-private-stage-preserved-until-manual-recovery');
  const preservedStageStat = await stat(preservedStagePath);
  assert.equal(uncertainStatus.filesystemStage.device, preservedStageStat.dev);
  assert.equal(uncertainStatus.filesystemStage.inode, preservedStageStat.ino);
  assert.match(uncertainStatus.recoveryGuidance, /Preserve and reuse this exact status path/);
  assert.match(uncertainStatus.recoveryGuidance, /different status path/);
  assert.match(uncertainStatus.recoveryGuidance, /inspect and reconcile the target database/);
  assert.equal(preservedStageStat.isDirectory(), true);
  assert.equal(await readFile(path.join(preservedStagePath, 'projects', 'legacy-project.json'), 'utf8'), '{"id":"legacy-example"}\n');
  assert.equal((await stat(backup.backupDirectory)).isDirectory(), true);
  assert.equal((await stat(path.join(backup.backupDirectory, 'database.dump'))).isFile(), true);
  assert.equal((await failedTarget.query(`select to_regclass('orgward.schema_migrations') is not null as exists`)).rows[0].exists, true,
    'the real pg_restore completed before its wrapper simulated a lost acknowledgement');
  assert.equal((await failedTarget.query('select count(*)::int as count from orgward.aggregates')).rows[0].count > 0, true);
  assert.equal((await readFile(restoreInvocationCount, 'utf8')).trim().split('\n').length, 2,
    'one inventory call and one database restore call were made');
  await assert.rejects(backupDatabase({ databaseUrlFile: failedFile, outputParent: backupParent, fileRoots }), { code: 'RESTORE_RECOVERY_GUARD' });

  const retryResult = await runFile(process.execPath, [new URL('../../ops/database-recovery.mjs', import.meta.url).pathname,
    'restore', backup.backupDirectory, failedStatus, failedStage], {
    cwd: process.cwd(), maxBuffer: 1_000_000,
    env: { ...process.env, ORGWARD_RESTORE_DATABASE_URL_FILE: failedFile, ORGWARD_PG_TOOLS_BIN: failingTools },
  }).then(() => ({ code: 0, output: '' })).catch((error) => ({ code: error.code, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }));
  assert.notEqual(retryResult.code, 0);
  assert.match(retryResult.output, /STATUS_PATH_EXISTS/);
  assert.equal((await readFile(restoreInvocationCount, 'utf8')).trim().split('\n').length, 2,
    'a new process must refuse the uncertain journal without invoking pg_restore again');
  const alternateStatusPath = path.join(temporary, 'alternate-status.json');
  await assert.rejects(restoreDatabase({ backupDirectory: backup.backupDirectory, statusPath: alternateStatusPath,
    targetUrlFile: failedFile, filesystemRoot: path.join(temporary, 'alternate-stage') }), { code: 'RESTORE_RECOVERY_GUARD' });
  assert.equal(JSON.parse(await readFile(alternateStatusPath, 'utf8')).state, 'failed');
  assert.equal((await readFile(restoreInvocationCount, 'utf8')).trim().split('\n').length, 2,
    'a different journal path is refused by the target guard before any pg_restore child process');
  assert.equal((await stat(preservedStagePath)).isDirectory(), true);
  assert.equal((await stat(backup.backupDirectory)).isDirectory(), true);
});
