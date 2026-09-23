import assert from 'node:assert/strict';
import { chmod, cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../../server.mjs';
import { createProject } from '../../src/model.mjs';
import { contentHash } from '../../src/platform/postgres.mjs';
import { backupDatabase, restoreDatabase } from '../../ops/database-recovery.mjs';
import { startPostgres } from '../helpers/postgres.mjs';

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

async function seedProject(databaseUrl) {
  const app = createApp({ databaseUrl, secretEncryptionKey: Buffer.alloc(32, 6) });
  try {
    await app.init();
    const project = createProject('Recovery journey retained project');
    Object.assign(project, { tenantId: 'tenant-recovery', version: 1, createdBy: 'operator-principal', updatedBy: 'operator-principal' });
    await app.persistence.query(`insert into orgward.aggregates
      (tenant_id,aggregate_kind,aggregate_id,version,state,state_hash,updated_at)
      values ($1,'project',$2,$3,$4::jsonb,$5,$6::timestamptz)`,
    [project.tenantId, project.id, project.version, JSON.stringify(project), contentHash(project), project.updatedAt]);
    return project.id;
  } finally { await app.close(); }
}

async function assertNoOrgWardSchema(database) {
  return (await database.query(`select to_regnamespace('orgward') is null as empty`)).rows[0].empty;
}

test('PostgreSQL backup and restore verify metadata, refuse unsafe targets, record failures and restore persisted data transactionally', async (t) => {
  const pgBin = toolsDirectory();
  if (!pgBin) return t.skip('PostgreSQL client tools are not available; set ORGWARD_PG_TOOLS_BIN for the qualified recovery journey.');
  const databases = [];
  t.after(async () => Promise.all(databases.map((database) => database.close())));
  const source = await startPostgres(); databases.push(source);
  const target = await startPostgres(); databases.push(target);
  const nonempty = await startPostgres(); databases.push(nonempty);
  const tamperedTarget = await startPostgres(); databases.push(tamperedTarget);
  const failedTarget = await startPostgres(); databases.push(failedTarget);
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
  const failedFile = await protectedUrlFile(temporary, 'failed-url', failedTarget.databaseUrl);
  const projectId = await seedProject(sourceUrl.href);
  const backupParent = path.join(temporary, 'backups');
  await mkdir(backupParent, { mode: 0o700 });
  const loggingTools = path.join(temporary, 'logging-tools');
  await mkdir(loggingTools, { mode: 0o700 });
  const dumpArgsPath = path.join(temporary, 'pg-dump-argv.txt');
  const passFilePath = path.join(temporary, 'pgpass-path.txt');
  await writeFile(path.join(loggingTools, 'pg_dump'), `#!/bin/sh\nprintf '%s\\n' "$*" > "${dumpArgsPath}"\nprintf '%s\\n' "$PGPASSFILE" > "${passFilePath}"\nexec "${path.join(pgBin, 'pg_dump')}" "$@"\n`, { mode: 0o700 });
  await chmod(path.join(loggingTools, 'pg_dump'), 0o700);
  await writeFile(path.join(loggingTools, 'pg_restore'), `#!/bin/sh\nexec "${path.join(pgBin, 'pg_restore')}" "$@"\n`, { mode: 0o700 });
  await chmod(path.join(loggingTools, 'pg_restore'), 0o700);
  process.env.ORGWARD_PG_TOOLS_BIN = loggingTools;
  const backup = await backupDatabase({ databaseUrlFile: sourceFile, outputParent: backupParent });
  assert.equal(backup.manifest.source.database, new URL(source.databaseUrl).pathname.slice(1));
  assert.equal(Object.values(backup.manifest).join(' ').includes('backup-credential-canary'), false);
  assert.equal((await stat(backup.backupDirectory)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(backup.backupDirectory, 'database.dump'))).mode & 0o077, 0);
  assert.equal((await stat(path.join(backup.backupDirectory, 'backup-manifest.json'))).mode & 0o077, 0);
  assert.equal((await readdir(backup.backupDirectory)).length, 2);
  assert.equal((await readFile(path.join(backup.backupDirectory, 'backup-manifest.json'), 'utf8')).includes('backup-credential-canary'), false);
  assert.equal((await readFile(dumpArgsPath, 'utf8')).includes('backup-credential-canary'), false);
  await assert.rejects(stat((await readFile(passFilePath, 'utf8')).trim()));

  const sourceStatus = path.join(temporary, 'same-source-status.json');
  const sourceFailure = await restoreDatabase({ backupDirectory: backup.backupDirectory, statusPath: sourceStatus, targetUrlFile: sourceFile }).catch((error) => error);
  const sourceReport = JSON.parse(await readFile(sourceStatus, 'utf8'));
  assert.equal(sourceFailure.code, 'RESTORE_SOURCE_TARGET', JSON.stringify(sourceReport));
  assert.equal(sourceReport.state, 'failed');

  const priorServiceUrlFile = process.env.ORGWARD_DATABASE_URL_FILE;
  process.env.ORGWARD_DATABASE_URL_FILE = targetFile;
  try {
    const servicePathStatus = path.join(temporary, 'service-path-status.json');
    await assert.rejects(restoreDatabase({ backupDirectory: backup.backupDirectory, statusPath: servicePathStatus, targetUrlFile: targetFile }), { code: 'RESTORE_SOURCE_TARGET' });
    assert.equal(JSON.parse(await readFile(servicePathStatus, 'utf8')).state, 'failed');
  } finally {
    if (priorServiceUrlFile === undefined) delete process.env.ORGWARD_DATABASE_URL_FILE;
    else process.env.ORGWARD_DATABASE_URL_FILE = priorServiceUrlFile;
  }

  await nonempty.query('create table preserved_before_restore (id integer primary key)');
  const nonemptyStatus = path.join(temporary, 'nonempty-status.json');
  await assert.rejects(restoreDatabase({ backupDirectory: backup.backupDirectory, statusPath: nonemptyStatus, targetUrlFile: nonemptyFile }), { code: 'RESTORE_TARGET_NOT_EMPTY' });
  assert.equal(JSON.parse(await readFile(nonemptyStatus, 'utf8')).state, 'failed');
  assert.equal((await nonempty.query(`select to_regclass('public.preserved_before_restore') is not null as exists`)).rows[0].exists, true);

  const restored = await restoreDatabase({ backupDirectory: backup.backupDirectory, statusPath: path.join(temporary, 'success-status.json'), targetUrlFile: targetFile });
  assert.equal(restored.state, 'completed');
  assert.equal(restored.sourceDatabase, new URL(source.databaseUrl).pathname.slice(1));
  assert.equal(restored.targetDatabase, new URL(target.databaseUrl).pathname.slice(1));
  const targetApp = createApp({ databaseUrl: target.databaseUrl, secretEncryptionKey: Buffer.alloc(32, 6) });
  try {
    await targetApp.init();
    const retained = await targetApp.persistence.query(`select state->>'name' as name from orgward.aggregates where tenant_id='tenant-recovery' and aggregate_id=$1`, [projectId]);
    assert.equal(retained.rows[0].name, 'Recovery journey retained project');
  } finally { await targetApp.close(); }
  const restarted = createApp({ databaseUrl: target.databaseUrl, secretEncryptionKey: Buffer.alloc(32, 6) });
  try {
    await restarted.init();
    assert.equal((await restarted.persistence.query(`select count(*)::int as count from orgward.aggregates where tenant_id='tenant-recovery' and aggregate_id=$1`, [projectId])).rows[0].count, 1);
  } finally { await restarted.close(); }

  const tamperedDir = path.join(temporary, 'tampered-backup');
  await cp(backup.backupDirectory, tamperedDir, { recursive: true });
  const dump = await readFile(path.join(tamperedDir, 'database.dump'));
  dump[Math.floor(dump.length / 2)] ^= 0x01;
  await writeFile(path.join(tamperedDir, 'database.dump'), dump, { mode: 0o600 });
  const tamperedStatus = path.join(temporary, 'tampered-status.json');
  await assert.rejects(restoreDatabase({ backupDirectory: tamperedDir, statusPath: tamperedStatus, targetUrlFile: tamperedFile }), { code: 'BACKUP_INTEGRITY_FAILED' });
  assert.equal(JSON.parse(await readFile(tamperedStatus, 'utf8')).state, 'failed');
  assert.equal(await assertNoOrgWardSchema(tamperedTarget), true);

  const failingTools = path.join(temporary, 'failing-tools');
  await mkdir(failingTools, { mode: 0o700 });
  const restorePath = path.join(pgBin, 'pg_restore');
  await writeFile(path.join(failingTools, 'pg_restore'), `#!/bin/sh\nfor arg in "$@"; do if [ "$arg" = "--list" ]; then exec "${restorePath}" "$@"; fi; done\nexit 23\n`, { mode: 0o700 });
  await chmod(path.join(failingTools, 'pg_restore'), 0o700);
  process.env.ORGWARD_PG_TOOLS_BIN = failingTools;
  const failedStatus = path.join(temporary, 'failed-status.json');
  await assert.rejects(restoreDatabase({ backupDirectory: backup.backupDirectory, statusPath: failedStatus, targetUrlFile: failedFile }), { code: 'PG_RESTORE_FAILED' });
  assert.equal(JSON.parse(await readFile(failedStatus, 'utf8')).state, 'failed');
  assert.equal(await assertNoOrgWardSchema(failedTarget), true);
});
