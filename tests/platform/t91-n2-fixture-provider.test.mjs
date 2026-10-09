import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import pg from 'pg';
import { T91N2FixtureDatabaseProvider } from '../../src/platform/t91-n2-fixture-provider.mjs';
import { T91_N3_PRODUCT_FIXTURE_TEMPLATE_HASH } from '../../src/sdlc/product-harness.mjs';
import { startTestPostgresCluster, stopTestPostgresCluster } from '../helpers/postgres-cluster.mjs';

const { Client } = pg;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

async function cluster(t) {
  const value = await startTestPostgresCluster();
  t.after(() => stopTestPostgresCluster(value));
  return value;
}

test('fixed fixture provider requires distinct live clusters and drops its generated database after dispatch', async (t) => {
  const source = await cluster(t);
  const fixture = await cluster(t);
  let observedDatabase = null;
  const provider = new T91N2FixtureDatabaseProvider({
    applicationDatabaseUrl: `${source.baseUrl}/postgres`,
    fixtureAdminDatabaseUrl: `${fixture.baseUrl}/postgres`,
    runFixture: async ({ databaseUrl, databaseName, databaseOid, fixtureClusterId }) => {
      observedDatabase = databaseName;
      assert.match(databaseName, /^orgward_t91_fixture_[a-f0-9]{32}$/);
      const client = new Client({ connectionString: databaseUrl });
      try {
        await client.connect();
        const row = await client.query(`select current_database() as name, oid::text as oid
          from pg_catalog.pg_database where datname=current_database()`);
        assert.equal(row.rows[0].name, databaseName);
        assert.equal(row.rows[0].oid, databaseOid);
      } finally { await client.end(); }
      return { fixtureClusterId, databaseName };
    },
  });

  assert.equal(await provider.initialize(), true);
  assert.equal(provider.available, true);
  const result = await provider.dispatch({ subcaseId: 'N2.AUTHORIZATION' });
  assert.equal(result.databaseName, observedDatabase);
  assert.equal(result.fixtureClusterId, provider.fixtureClusterIdentity.clusterId);
  const remaining = await fixture.admin.query('select 1 from pg_catalog.pg_database where datname=$1', [observedDatabase]);
  assert.equal(remaining.rowCount, 0, 'the exact per-invocation database is removed after the fixed runner returns');
});

test('fixture provider rejects identical live clusters and remains unavailable when config is missing', async (t) => {
  const source = await cluster(t);
  const sameClusterProvider = new T91N2FixtureDatabaseProvider({
    applicationDatabaseUrl: `${source.baseUrl}/postgres`,
    fixtureAdminDatabaseUrl: `${source.baseUrl}/postgres`,
    runFixture: async () => assert.fail('same-cluster provider must never dispatch'),
  });
  assert.equal(await sameClusterProvider.initialize(), false);
  assert.match(sameClusterProvider.lastInitializationError?.message ?? '', /cluster distinct from the application cluster/);
  assert.equal(sameClusterProvider.available, false);
  await assert.rejects(sameClusterProvider.dispatch({}), (error) => error.code === 'PRODUCT_HARNESS_UNAVAILABLE');

  let connected = false;
  const missing = new T91N2FixtureDatabaseProvider({ createClient: () => {
    connected = true;
    throw new Error('should not connect');
  } });
  assert.equal(await missing.initialize(), false);
  assert.equal(missing.available, false);
  assert.equal(connected, false);
  await assert.rejects(missing.dispatch({}), (error) => error.code === 'PRODUCT_HARNESS_UNAVAILABLE');
});

test('fixture provider removes its generated database when the fixed runner fails', async (t) => {
  const source = await cluster(t);
  const fixture = await cluster(t);
  let generatedName = null;
  const provider = new T91N2FixtureDatabaseProvider({
    applicationDatabaseUrl: `${source.baseUrl}/postgres`,
    fixtureAdminDatabaseUrl: `${fixture.baseUrl}/postgres`,
    runFixture: async ({ databaseName }) => {
      generatedName = databaseName;
      throw Object.assign(new Error('synthetic fixture setup failure'), { code: 'FIXTURE_SETUP_FAILED' });
    },
  });
  await provider.initialize();
  await assert.rejects(provider.dispatch({}), (error) => error.code === 'FIXTURE_SETUP_FAILED');
  assert.ok(generatedName);
  const remaining = await fixture.admin.query('select 1 from pg_catalog.pg_database where datname=$1', [generatedName]);
  assert.equal(remaining.rowCount, 0, 'cleanup runs after setup/dispatch failure');
});

test('fixture provider annotates pre-fixture allocation failures with invocation and template pins', async (t) => {
  const source = await cluster(t);
  const fixture = await cluster(t);
  const fixtureAdminUrl = `${fixture.baseUrl}/postgres`;
  let createAttempted = false;
  const provider = new T91N2FixtureDatabaseProvider({
    applicationDatabaseUrl: `${source.baseUrl}/postgres`,
    fixtureAdminDatabaseUrl: fixtureAdminUrl,
    createClient: (connectionString) => {
      const client = new Client({ connectionString });
      if (connectionString !== fixtureAdminUrl) return client;
      return { connect: () => client.connect(), end: () => client.end(), query: async (sql, values) => {
        if (/^create database /.test(sql)) {
          createAttempted = true;
          throw Object.assign(new Error('synthetic pre-fixture connection failure'), { code: 'FIXTURE_SETUP_FAILED' });
        }
        return client.query(sql, values);
      } };
    },
    runFixture: async () => assert.fail('fixture runner must not launch after allocation failure'),
  });
  assert.equal(await provider.initialize(), true);
  await assert.rejects(provider.dispatch({ fixtureTemplateHash: T91_N3_PRODUCT_FIXTURE_TEMPLATE_HASH }), (error) => {
    assert.equal(error.code, 'FIXTURE_SETUP_FAILED');
    assert.match(error.fixtureInvocationId ?? '', /^t91-n2-fixture-invocation-[0-9a-f-]{36}$/i);
    assert.equal(error.fixtureTemplateHash, T91_N3_PRODUCT_FIXTURE_TEMPLATE_HASH);
    return true;
  });
  assert.equal(createAttempted, true);
  assert.equal(provider.available, false);
});

test('fixture provider retains and disables a created database when its OID proof is unavailable', async (t) => {
  const source = await cluster(t);
  const fixture = await cluster(t);
  let generatedName = null;
  let failOidRead = true;
  const provider = new T91N2FixtureDatabaseProvider({
    applicationDatabaseUrl: `${source.baseUrl}/postgres`,
    fixtureAdminDatabaseUrl: `${fixture.baseUrl}/postgres`,
    createClient: (connectionString) => {
      const client = new Client({ connectionString });
      if (connectionString !== `${fixture.baseUrl}/postgres`) return client;
      return {
        connect: () => client.connect(),
        end: () => client.end(),
        query: async (sql, values) => {
          const createMatch = sql.match(/^create database "(orgward_t91_fixture_[a-f0-9]{32})"/);
          if (createMatch) generatedName = createMatch[1];
          if (failOidRead && sql.includes('select oid::text as database_oid from pg_catalog.pg_database')) {
            failOidRead = false;
            throw new Error('synthetic OID query failure');
          }
          return client.query(sql, values);
        },
      };
    },
    runFixture: async () => assert.fail('fixture runner must not launch without a captured OID'),
  });
  await provider.initialize();
  await assert.rejects(provider.dispatch({}), (error) => error.message === 'synthetic OID query failure'
    && /OID was not captured and verified/.test(error.cleanupError?.message ?? ''));
  assert.equal(provider.available, false);
  assert.ok(generatedName);
  const remaining = await fixture.admin.query('select oid::text from pg_catalog.pg_database where datname=$1', [generatedName]);
  assert.equal(remaining.rowCount, 1, 'unproven ownership is retained instead of being dropped by name');
  await fixture.admin.query(`drop database "${generatedName}"`);
});

test('optional fixture connection timeout fails startup readiness within its bound', async () => {
  let destroyed = false;
  const makeClient = (connectionString) => ({
    connection: { stream: { destroy() { destroyed = true; } } },
    connect: () => connectionString.includes('fixture') ? new Promise(() => {}) : Promise.resolve(),
    query: async () => assert.fail('timed out connection must not issue identity queries'),
    end: async () => {},
  });
  const provider = new T91N2FixtureDatabaseProvider({
    applicationDatabaseUrl: 'postgresql://app@source.test/app',
    fixtureAdminDatabaseUrl: 'postgresql://fixture@fixture.test/admin',
    createClient: makeClient, runFixture: async () => {}, timeouts: { connect: 30, close: 10 },
  });
  const started = Date.now();
  assert.equal(await provider.initialize(), false);
  assert.ok(Date.now() - started < 500, 'optional provider initialization is bounded');
  assert.equal(provider.available, false);
  assert.equal(provider.lastInitializationError?.code, 'FIXTURE_PROVIDER_TIMEOUT');
  assert.equal(destroyed, true);
});

test('synchronous fixture client factory failure is nonfatal and closes the partial source client', async () => {
  let sourceClosed = false;
  const provider = new T91N2FixtureDatabaseProvider({
    applicationDatabaseUrl: 'postgresql://app@source.test/app',
    fixtureAdminDatabaseUrl: 'postgresql://fixture@fixture.test/admin',
    createClient: (connectionString) => {
      if (connectionString.includes('fixture')) throw new Error('synthetic invalid TLS configuration');
      return { connect: async () => {}, end: async () => { sourceClosed = true; } };
    },
    runFixture: async () => {},
  });
  assert.equal(await provider.initialize(), false);
  assert.equal(provider.available, false);
  assert.match(provider.lastInitializationError?.message ?? '', /synthetic invalid TLS configuration/);
  assert.equal(sourceClosed, true);
});

async function makeScopedFixtureAdminRole(t, cluster, { createdb }) {
  const roleName = `t91_fixture_${Math.random().toString(16).slice(2, 12)}`;
  const password = `pw_${Math.random().toString(16).slice(2, 14)}`;
  await cluster.admin.query(`create role "${roleName}" login password '${password}' ${createdb ? 'createdb' : 'nocreatedb'} nosuperuser`);
  await cluster.admin.query(`grant execute on function pg_catalog.pg_control_system() to "${roleName}"`);
  t.after(async () => { await cluster.admin.query(`drop role if exists "${roleName}"`).catch(() => {}); });
  const base = new URL(cluster.baseUrl);
  return `postgresql://${encodeURIComponent(roleName)}:${encodeURIComponent(password)}@${base.host}/postgres`;
}

test('fixture identity readiness stays unavailable without CREATEDB privilege', async (t) => {
  const source = await cluster(t);
  const fixture = await cluster(t);
  const fixtureAdminDatabaseUrl = await makeScopedFixtureAdminRole(t, fixture, { createdb: false });
  const provider = new T91N2FixtureDatabaseProvider({ applicationDatabaseUrl: `${source.baseUrl}/postgres`,
    fixtureAdminDatabaseUrl, runFixture: async () => assert.fail('unqualified provider must not dispatch') });
  assert.equal(await provider.initialize(), false);
  assert.equal(provider.available, false);
  assert.match(provider.lastInitializationError?.message ?? '', /CREATEDB on a writable PostgreSQL primary/);
});

test('allocation failure after readiness demotes provider and creates no fixture database', async (t) => {
  const source = await cluster(t);
  const fixture = await cluster(t);
  const fixtureAdminDatabaseUrl = await makeScopedFixtureAdminRole(t, fixture, { createdb: true });
  const provider = new T91N2FixtureDatabaseProvider({ applicationDatabaseUrl: `${source.baseUrl}/postgres`,
    fixtureAdminDatabaseUrl, runFixture: async () => assert.fail('allocation failure must precede runner') });
  assert.equal(await provider.initialize(), true);
  const role = new URL(fixtureAdminDatabaseUrl).username;
  await fixture.admin.query(`alter role "${decodeURIComponent(role)}" nocreatedb`);
  await assert.rejects(provider.dispatch({}), (error) => error.code === '42501');
  assert.equal(provider.available, false);
  const allocated = await fixture.admin.query("select 1 from pg_catalog.pg_database where datname like 'orgward_t91_fixture_%'");
  assert.equal(allocated.rowCount, 0);
});

test('synchronous dispatch client factory failure demotes provider after caller reservation', async (t) => {
  const source = await cluster(t);
  const fixture = await cluster(t);
  let rejectAdminConstruction = false;
  const fixtureAdminDatabaseUrl = `${fixture.baseUrl}/postgres`;
  const provider = new T91N2FixtureDatabaseProvider({
    applicationDatabaseUrl: `${source.baseUrl}/postgres`,
    fixtureAdminDatabaseUrl,
    createClient: (connectionString) => {
      if (rejectAdminConstruction && connectionString === fixtureAdminDatabaseUrl) {
        throw new Error('synthetic dispatch TLS configuration failure');
      }
      return new Client({ connectionString, connectionTimeoutMillis: 3_000,
        query_timeout: 5_000, statement_timeout: 5_000, lock_timeout: 2_000 });
    },
    runFixture: async () => assert.fail('client construction failure must precede runner'),
  });
  assert.equal(await provider.initialize(), true);
  rejectAdminConstruction = true;
  await assert.rejects(provider.dispatch({}), /synthetic dispatch TLS configuration failure/);
  assert.equal(provider.available, false);
  const allocated = await fixture.admin.query("select 1 from pg_catalog.pg_database where datname like 'orgward_t91_fixture_%'");
  assert.equal(allocated.rowCount, 0);
});

test('post-reservation fixed runner timeout aborts, retains its database, and disables provider', async (t) => {
  const source = await cluster(t);
  const fixture = await cluster(t);
  let generatedName = null;
  let runnerSignal = null;
  let runnerCleanupFinished = false;
  const provider = new T91N2FixtureDatabaseProvider({
    applicationDatabaseUrl: `${source.baseUrl}/postgres`,
    fixtureAdminDatabaseUrl: `${fixture.baseUrl}/postgres`,
    runFixture: async ({ databaseName, signal }) => {
      generatedName = databaseName;
      runnerSignal = signal;
      return new Promise((resolve) => signal.addEventListener('abort', () => {
        setTimeout(() => { runnerCleanupFinished = true; resolve({ terminal: false }); }, 5);
      }, { once: true }));
    },
    timeouts: { run: 30, abortGrace: 100 },
  });
  assert.equal(await provider.initialize(), true);
  await assert.rejects(provider.dispatch({}), (error) => error.code === 'FIXTURE_PROVIDER_TIMEOUT');
  assert.equal(runnerSignal?.aborted, true);
  assert.equal(runnerCleanupFinished, true, 'provider waits boundedly for the runner to close its inner app/server after abort');
  assert.equal(provider.available, false);
  const retained = await fixture.admin.query('select oid::text from pg_catalog.pg_database where datname=$1', [generatedName]);
  assert.equal(retained.rowCount, 1, 'timed-out work keeps its DB instead of racing cleanup against a live runner');
  await fixture.admin.query(`drop database "${generatedName}"`);
});

test('owner mapping UI renders the provider capability enum directly', async () => {
  const source = await readFile(path.join(ROOT, 'public/sdlc.js'), 'utf8');
  assert.match(source, /Provider status: \$\{fixtureStatus\}/);
  assert.match(source, /fixtureStatus === 'UNAVAILABLE'/);
  assert.match(source, /dedicated writable fixture cluster, its protected administrator URL, and fixture-admin CREATEDB permission/);
  assert.match(source, /fixture-admin CREATEDB permission, and narrow application-role permission for pg_control_system/);
});
