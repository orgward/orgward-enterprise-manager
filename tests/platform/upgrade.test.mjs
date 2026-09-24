import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
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

async function applyLegacyPrefix(database, through = '006') {
  let projectId;
  let eventHash;
  await database.query('create schema orgward');
  await database.query(`create table orgward.schema_migrations (
    version text primary key, checksum text not null check (checksum ~ '^[a-f0-9]{64}$'), applied_at timestamptz not null default now()
  )`);
  const files = (await readdir(ROOT)).filter((file) => /^\d{3}-[a-z0-9-]+\.sql$/.test(file)
    && Number(file.slice(0, 3)) <= Number(through.slice(0, 3))).sort();
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

  assert.equal(app.persistence.schemaVersion, '027-process-instance-unverified-abandonment');
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
  assert.deepEqual(afterRestart.rows[0], { owners: 1, principals: 1, auth_events: 1, migrations: 27 });

  await close(app);
  app = appFor(database.databaseUrl);
  await app.init();
  assert.equal(app.persistence.schemaVersion, '027-process-instance-unverified-abandonment');
  assert.equal((await database.query('select count(*)::int count from orgward.oidc_bootstrap_grants')).rows[0].count, 0);
  assert.equal((await database.query('select count(*)::int count from orgward.aggregates where tenant_id=$1', [TENANT])).rows[0].count, 1);
});

test('migration 020 backfills linked agent task status without inventing an assigned principal', async (t) => {
  const database = await startPostgres();
  t.after(database.close);
  const fixture = await applyLegacyPrefix(database, '019');
  const runId = 'execution-run-00000000-0000-4000-8000-000000000001';
  const planInstanceId = '00000000-0000-4000-8000-000000000002';
  const now = new Date().toISOString();
  const run = {
    id: runId, tenantId: TENANT, projectId: fixture.projectId, version: 3, status: 'SUCCEEDED',
    createdAt: now, updatedAt: now,
    processTaskRef: {
      processPlanId: 'process-plan-00000000-0000-4000-8000-000000000003',
      revision: 4, planInstanceId, taskId: 'task-root',
      blueprintId: 'blueprint-00000000-0000-4000-8000-000000000004', blueprintVersion: 2,
      processId: 'process-deliver', actorId: 'actor-agent', roleId: 'role-operations',
    },
  };
  await database.query(`insert into orgward.aggregates
    (tenant_id, aggregate_kind, aggregate_id, version, state, state_hash, updated_at)
    values ($1,'execution_run',$2,$3,$4::jsonb,$5,$6::timestamptz)`,
  [TENANT, run.id, run.version, JSON.stringify(run), contentHash(run), now]);
  await database.query(`insert into orgward.aggregate_project_scopes
    (tenant_id, aggregate_kind, aggregate_id, project_id) values ($1,'execution_run',$2,$3)`,
  [TENANT, run.id, fixture.projectId]);

  const app = appFor(database.databaseUrl);
  await app.init();
  t.after(() => close(app));
  const migrated = await database.query(`select project_id, process_plan_id, plan_revision,
    plan_instance_id, task_id, status, execution_run_id, actor_type, assigned_principal,
    assigned_membership_generation, assigned_authz_generation, started_at, completed_at
    from orgward.process_task_instances where tenant_id=$1 and plan_instance_id=$2`, [TENANT, planInstanceId]);
  assert.deepEqual(migrated.rows[0], {
    project_id: fixture.projectId,
    process_plan_id: run.processTaskRef.processPlanId,
    plan_revision: 4,
    plan_instance_id: planInstanceId,
    task_id: 'task-root', status: 'SUCCEEDED', execution_run_id: runId,
    actor_type: 'workload', assigned_principal: null,
    assigned_membership_generation: null, assigned_authz_generation: null,
    started_at: migrated.rows[0].started_at, completed_at: migrated.rows[0].completed_at,
  });
  assert.ok(migrated.rows[0].started_at instanceof Date);
  assert.ok(migrated.rows[0].completed_at instanceof Date);
  assert.equal(app.persistence.schemaVersion, '027-process-instance-unverified-abandonment');
});

test('upgrade from 017 preserves an eligible OpenAI revocation obligation and initializes reconciler state', async (t) => {
  const database = await startPostgres();
  t.after(database.close);
  await applyLegacyPrefix(database, '017');

  const oldLedger = await database.query('select version from orgward.schema_migrations order by version');
  assert.equal(oldLedger.rowCount, 17);
  assert.equal(oldLedger.rows.at(-1).version, '017-managed-openai-candidate-provisioning');
  await database.query(`insert into orgward.secret_references
    (tenant_id, reference, version, status, ciphertext, nonce, auth_tag, created_by, updated_by,
     upstream_revocation_status, active_provider, active_model)
    values ($1, 'secret-managed', 2, 'active', $2, $3, $4, $5, $5, 'unconfirmed', 'openai', 'gpt-test')`,
  [TENANT, Buffer.from('ciphertext'), Buffer.alloc(12, 1), Buffer.alloc(16, 2), PRINCIPAL]);
  await database.query(`insert into orgward.secret_upstream_revocation_obligations
    (tenant_id, reference, credential_version, provider, status, reason, created_by,
     provider_organization_id, provider_project_id, provider_service_account_id, provider_api_key_id,
     target_provenance)
    values ($1, 'secret-managed', 1, 'openai', 'unconfirmed', 'Previous managed generation', $2,
     'org-test', 'proj-test', 'sa-test', 'key-test', 'orgward_created_exclusive_service_account')`, [TENANT, PRINCIPAL]);

  const app = appFor(database.databaseUrl);
  try {
    await app.init();
    const migrated = await database.query(`select status, provider_organization_id, provider_project_id,
      provider_service_account_id, provider_api_key_id, target_provenance,
      claim_token, claim_until, attempt_count, next_attempt_at, last_attempt_at
      from orgward.secret_upstream_revocation_obligations
      where tenant_id=$1 and reference='secret-managed' and credential_version=1`, [TENANT]);
    const { next_attempt_at: nextAttemptAt, ...obligation } = migrated.rows[0];
    assert.deepEqual(obligation, { status: 'unconfirmed', provider_organization_id: 'org-test',
      provider_project_id: 'proj-test', provider_service_account_id: 'sa-test', provider_api_key_id: 'key-test',
      target_provenance: 'orgward_created_exclusive_service_account', claim_token: null, claim_until: null,
      attempt_count: 0, last_attempt_at: null });
    assert.ok(nextAttemptAt instanceof Date);
    assert.equal(app.persistence.schemaVersion, '027-process-instance-unverified-abandonment');
  } finally {
    await close(app);
  }
});

test('upgrade from 012 preserves legacy OpenAI credentials and leaves metadata-free revocation obligations untouched across restart', async (t) => {
  const database = await startPostgres();
  t.after(database.close);
  await applyLegacyPrefix(database, '011');

  const credential = {
    ciphertext: Buffer.from('legacy-encrypted-openai-credential'),
    nonce: Buffer.alloc(12, 11),
    auth_tag: Buffer.alloc(16, 12),
  };
  await database.query(`insert into orgward.secret_references
    (tenant_id, reference, version, status, ciphertext, nonce, auth_tag, created_by, updated_by,
     upstream_revocation_status, active_provider, active_model)
    values ($1, 'secret-legacy-openai', 2, 'active', $2, $3, $4, $5, $5, 'unconfirmed', 'openai', 'gpt-legacy')`,
  [TENANT, credential.ciphertext, credential.nonce, credential.auth_tag, PRINCIPAL]);

  const migration012 = await readFile(path.join(ROOT, '012-secret-revocation-obligations.sql'), 'utf8');
  await database.query(migration012);
  await database.query('insert into orgward.schema_migrations(version, checksum) values ($1, $2)',
    ['012-secret-revocation-obligations', contentHash(migration012)]);

  const providerRequests = [];
  const providerFixture = createServer((request, response) => {
    providerRequests.push(`${request.method} ${request.url}`);
    response.writeHead(404).end();
  });
  await new Promise((resolve, reject) => providerFixture.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  t.after(() => new Promise((resolve, reject) => providerFixture.close((error) => error ? reject(error) : resolve())));
  const adminEndpoint = `http://127.0.0.1:${providerFixture.address().port}`;
  const configuredApp = () => createApp({ databaseUrl: database.databaseUrl,
    secretEncryptionKey: Buffer.alloc(32, 4),
    oidcAuthenticator: { async authenticate() { return IDENTITY; } },
    openAiAdminApiKey: 'sk-admin-loopback-fixture', openAiOrganizationId: 'org-legacy', openAiAdminEndpoint: adminEndpoint });
  const waitForRevocationDrain = async (currentApp) => {
    const deadline = Date.now() + 1_000;
    while (currentApp.secretStore.revocationDrainActive && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(currentApp.secretStore.revocationDrainActive, false,
      'OpenAI revocation reconciliation did not settle within 1 second after app initialization');
  };

  let app = configuredApp();
  t.after(async () => { if (app) await close(app); });
  await app.init();
  assert.equal(app.persistence.schemaVersion, '027-process-instance-unverified-abandonment');
  await waitForRevocationDrain(app);

  const active = await database.query(`select version, status, ciphertext, nonce, auth_tag, upstream_revocation_status,
    active_provider, active_model from orgward.secret_references where tenant_id=$1 and reference='secret-legacy-openai'`, [TENANT]);
  assert.deepEqual(active.rows[0], { version: 2, status: 'active', ...credential,
    upstream_revocation_status: 'unconfirmed', active_provider: 'openai', active_model: 'gpt-legacy' });
  const obligation = await database.query(`select provider, status, provider_organization_id, provider_project_id,
    provider_service_account_id, provider_api_key_id, target_provenance, claim_token, claim_until, attempt_count
    from orgward.secret_upstream_revocation_obligations
    where tenant_id=$1 and reference='secret-legacy-openai' and credential_version=1`, [TENANT]);
  assert.deepEqual(obligation.rows[0], { provider: 'openai', status: 'unconfirmed', provider_organization_id: null,
    provider_project_id: null, provider_service_account_id: null, provider_api_key_id: null, target_provenance: null,
    claim_token: null, claim_until: null, attempt_count: 0 });
  assert.deepEqual(providerRequests, []);

  await close(app);
  app = configuredApp();
  await app.init();
  assert.equal(app.persistence.schemaVersion, '027-process-instance-unverified-abandonment');
  await waitForRevocationDrain(app);
  const afterRestart = await database.query(`select ref.version, ref.status as reference_status, ref.ciphertext, ref.nonce, ref.auth_tag,
    ref.upstream_revocation_status, ref.active_provider, ref.active_model, obligation.provider, obligation.status as obligation_status,
    obligation.provider_organization_id, obligation.provider_project_id, obligation.provider_service_account_id,
    obligation.provider_api_key_id, obligation.target_provenance, obligation.claim_token, obligation.claim_until,
    obligation.attempt_count
    from orgward.secret_references ref join orgward.secret_upstream_revocation_obligations obligation
      on obligation.tenant_id=ref.tenant_id and obligation.reference=ref.reference and obligation.credential_version=1
    where ref.tenant_id=$1 and ref.reference='secret-legacy-openai'`, [TENANT]);
  assert.deepEqual(afterRestart.rows[0], { version: 2, reference_status: 'active', ...credential,
    upstream_revocation_status: 'unconfirmed', active_provider: 'openai', active_model: 'gpt-legacy',
    provider: 'openai', obligation_status: 'unconfirmed', provider_organization_id: null, provider_project_id: null,
    provider_service_account_id: null, provider_api_key_id: null, target_provenance: null,
    claim_token: null, claim_until: null, attempt_count: 0 });
  assert.deepEqual(providerRequests, []);
  await close(app);
  app = null;
});

test('upgrade from migration 023 installs the assigned-human success evidence guard', async (t) => {
  const database = await startPostgres();
  t.after(database.close);
  await applyLegacyPrefix(database, '023');
  const priorVersion = await database.query('select version from orgward.schema_migrations order by version desc limit 1');
  assert.equal(priorVersion.rows[0].version, '023-process-task-pre-dispatch-pause');

  const app = appFor(database.databaseUrl);
  t.after(async () => { await close(app); });
  await app.init();
  assert.equal(app.persistence.schemaVersion, '027-process-instance-unverified-abandonment');
  const trigger = await database.query(`
    select tgname from pg_trigger
    where tgrelid='orgward.process_task_instances'::regclass and not tgisinternal
      and tgname='process_task_human_success_evidence_guard'
  `);
  assert.deepEqual(trigger.rows, [{ tgname: 'process_task_human_success_evidence_guard' }]);
  const runtimeGuard = await database.query(`
    select pg_get_functiondef('orgward.guard_process_task_cancellation()'::regprocedure) as definition,
      pg_get_functiondef('orgward.guard_process_task_instance_undispatched_pause()'::regprocedure) as undispatched_definition
  `);
  assert.match(runtimeGuard.rows[0].definition, /old\.status <> 'RUNNING'/,
    'the original linked pause guard admits only the separately fenced RUNNING transition');
  assert.match(runtimeGuard.rows[0].definition, /runVersion/,
    'the guard retains the runtime event and linked run version check');
  assert.match(runtimeGuard.rows[0].undispatched_definition, /control_status is distinct from 'PAUSE_REQUESTED'/);
  assert.match(runtimeGuard.rows[0].undispatched_definition, /new\.started_at is not null/);
  assert.match(runtimeGuard.rows[0].undispatched_definition, /'handed_off', 'outcome_unknown'/);
});
