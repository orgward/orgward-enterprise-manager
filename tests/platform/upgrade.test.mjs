import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../../server.mjs';
import { createProject } from '../../src/model.mjs';
import { contentHash } from '../../src/platform/postgres.mjs';
import { startPostgres } from '../helpers/postgres.mjs';

const ISSUER = 'https://upgrade.identity.example.test';
const TENANT = 'tenant-legacy';
const SUBJECT = 'legacy-owner';
const PRINCIPAL = `oidc:${createHash('sha256').update(`${ISSUER}\n${SUBJECT}`).digest('hex')}`;
const SESSION_ID = 'L'.repeat(43);
const IDENTITY = { issuer: ISSUER, subject: SUBJECT, principal: PRINCIPAL, displayName: 'Legacy Owner',
  tenantId: TENANT, roles: ['workspace-read', 'workspace-write'], actorType: 'human', expiresAt: Math.floor(Date.now() / 1000) + 1800 };
const ROOT = path.resolve('migrations');

async function applyLegacyPrefix(database) {
  let projectId;
  let eventHash;
  await database.query('create schema orgward');
  await database.query(`create table orgward.schema_migrations (
    version text primary key, checksum text not null check (checksum ~ '^[a-f0-9]{64}$'), applied_at timestamptz not null default now()
  )`);
  const files = (await readdir(ROOT)).filter((file) => /^00[1-6]-[a-z0-9-]+\.sql$/.test(file)).sort();
  for (const file of files) {
    const sql = await readFile(path.join(ROOT, file), 'utf8');
    await database.query(sql);
    await database.query('insert into orgward.schema_migrations(version, checksum) values ($1, $2)', [file.slice(0, -4), contentHash(sql)]);
    if (file.startsWith('001-')) {
      const project = createProject('Legacy retained project');
      Object.assign(project, { tenantId: TENANT, createdBy: PRINCIPAL, version: 1 });
      projectId = project.id;
      await database.query(`insert into orgward.aggregates
        (tenant_id, aggregate_kind, aggregate_id, version, state, state_hash, updated_at)
        values ($1, 'project', $2, $3, $4::jsonb, $5, $6::timestamptz)`,
      [TENANT, project.id, project.version, JSON.stringify(project), contentHash(project), project.updatedAt]);
      const event = { eventId: 'legacy-project-created-event', type: 'ProjectCreated', tenantId: TENANT,
        projectId: project.id, principal: PRINCIPAL, version: 1 };
      await database.query(`insert into orgward.audit_log
        (tenant_id, aggregate_kind, aggregate_id, aggregate_version, event_type, actor, event, event_hash)
        values ($1, 'project', $2, 1, 'ProjectCreated', $3, $4::jsonb, $5)`,
      [TENANT, project.id, PRINCIPAL, JSON.stringify(event), contentHash(event)]);
      eventHash = contentHash(event);
    }
    if (file.startsWith('002-')) {
      const sessionHash = createHash('sha256').update(SESSION_ID).digest('hex');
      await database.query(`insert into orgward.oidc_sessions
        (session_hash, issuer, principal, tenant_id, roles, actor_type, expires_at)
        values ($1, $2, $3, $4, $5::text[], 'human', now() + interval '1 hour')`,
      [sessionHash, ISSUER, PRINCIPAL, TENANT, IDENTITY.roles]);
    }
    if (file.startsWith('003-')) {
      await database.query(`insert into orgward.oidc_principal_events
        (tenant_id, principal, event_type, actor, authz_generation)
        values ($1, $2, 'PrincipalAuthenticated', $2, 1)`, [TENANT, PRINCIPAL]);
    }
  }
  return { projectId, eventHash };
}

function appFor(databaseUrl) {
  return createApp({ databaseUrl, secretEncryptionKey: Buffer.alloc(32, 4),
    oidcAuthenticator: { async authenticate() { return IDENTITY; } } });
}
async function close(app) {
  if (app.server.listening) await new Promise((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
  await app.close();
}

test('upgrade from the 001–006 baseline preserves owner, project, audit and session; failed migration rolls back and retry is idempotent', async (t) => {
  const database = await startPostgres();
  t.after(database.close);
  const fixture = await applyLegacyPrefix(database);

  const legacyLedger = await database.query('select version from orgward.schema_migrations order by version');
  assert.equal(legacyLedger.rowCount, 6);
  assert.deepEqual((await database.query('select access from orgward.project_memberships where tenant_id = $1 and project_id = $2 and principal = $3',
    [TENANT, fixture.projectId, PRINCIPAL])).rows, [{ access: 'owner' }]);

  await database.query(`create function orgward.interrupt_upgrade() returns trigger language plpgsql as $$
    begin if new.version = '007-tenant-scoped-oidc-principals' then raise exception 'simulated interrupted migration'; end if; return new; end;
  $$`);
  await database.query(`create trigger interrupt_upgrade before insert on orgward.schema_migrations
    for each row execute function orgward.interrupt_upgrade()`);
  let interrupted = appFor(database.databaseUrl);
  await assert.rejects(interrupted.init(), /simulated interrupted migration/);
  await close(interrupted);
  interrupted = null;

  const rolledBack = await database.query(`
    select
      (select count(*)::int from orgward.schema_migrations) as migration_count,
      (select pg_get_constraintdef(oid) from pg_constraint where conrelid='orgward.oidc_principals'::regclass and contype='p') as principal_pk,
      (select count(*)::int from orgward.aggregates where tenant_id=$1 and aggregate_id=$2) as project_count
  `, [TENANT, fixture.projectId]);
  assert.equal(rolledBack.rows[0].migration_count, 6);
  assert.equal(rolledBack.rows[0].principal_pk, 'PRIMARY KEY (principal)');
  assert.equal(rolledBack.rows[0].project_count, 1);

  await database.query('drop trigger interrupt_upgrade on orgward.schema_migrations');
  await database.query('drop function orgward.interrupt_upgrade()');
  let app = appFor(database.databaseUrl);
  await app.init();
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { if (app) await close(app); });

  assert.equal(app.persistence.schemaVersion, '015-provider-dispatch-attempts');
  const retainedSession = await app.sessionStore.get(SESSION_ID);
  assert.equal(retainedSession.issuer, ISSUER);
  assert.equal(retainedSession.principal, PRINCIPAL);
  assert.equal(retainedSession.tenantId, TENANT);
  assert.equal(retainedSession.displayName, PRINCIPAL);
  assert.deepEqual(retainedSession.roles, ['workspace-read', 'workspace-write']);
  assert.equal(retainedSession.actorType, 'human');
  assert.equal(retainedSession.authzGeneration, 1);
  assert.ok(Number.isInteger(retainedSession.expiresAt));
  const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/v1/projects`, {
    headers: { authorization: 'Bearer legacy-owner' },
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.data.map((project) => project.id), [fixture.projectId]);

  const audit = await database.query(`select event_hash from orgward.audit_log where tenant_id=$1 and aggregate_id=$2 and event_type='ProjectCreated'`, [TENANT, fixture.projectId]);
  assert.deepEqual(audit.rows, [{ event_hash: fixture.eventHash }]);
  const afterRestart = await database.query(`
    select
      (select count(*)::int from orgward.project_memberships where tenant_id=$1 and project_id=$2 and principal=$3 and access='owner' and revoked_at is null) as owners,
      (select count(*)::int from orgward.oidc_principals where tenant_id=$1 and principal=$3) as principals,
      (select count(*)::int from orgward.oidc_principal_events where tenant_id=$1 and principal=$3 and event_type='PrincipalAuthenticated') as auth_events,
      (select count(*)::int from orgward.schema_migrations) as migrations
  `, [TENANT, fixture.projectId, PRINCIPAL]);
  assert.deepEqual(afterRestart.rows[0], { owners: 1, principals: 1, auth_events: 1, migrations: 15 });

  await close(app);
  app = appFor(database.databaseUrl);
  await app.init();
  assert.equal(app.persistence.schemaVersion, '015-provider-dispatch-attempts');
  assert.equal((await database.query('select count(*)::int count from orgward.oidc_bootstrap_grants')).rows[0].count, 0);
  assert.equal((await database.query('select count(*)::int count from orgward.aggregates where tenant_id=$1', [TENANT])).rows[0].count, 1);
});
