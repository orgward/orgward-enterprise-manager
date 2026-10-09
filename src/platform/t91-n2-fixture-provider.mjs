import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const FIXTURE_DATABASE_PREFIX = 'orgward_t91_fixture_';

export function annotateT91FixtureDispatchError(error, { invocationId, fixtureTemplateHash }) {
  if (error && typeof error === 'object') {
    error.fixtureInvocationId ??= invocationId;
    error.fixtureTemplateHash ??= fixtureTemplateHash ?? null;
  }
  return error;
}
const CONNECT_TIMEOUT_MS = 3_000;
const QUERY_TIMEOUT_MS = 5_000;
const CLOSE_TIMEOUT_MS = 1_000;
const FIXTURE_RUN_TIMEOUT_MS = 30_000;

function createBoundedClient(connectionString) {
  return new Client({ connectionString, connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS, statement_timeout: QUERY_TIMEOUT_MS, lock_timeout: 2_000 });
}

function destroyClient(client) {
  try { client?.connection?.stream?.destroy(); } catch { /* best-effort socket cancellation */ }
}

async function bounded(client, label, operation, timeoutMs = QUERY_TIMEOUT_MS) {
  let timer;
  const operationPromise = Promise.resolve().then(operation);
  try {
    return await Promise.race([operationPromise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`Fixture provider ${label} timed out.`), { code: 'FIXTURE_PROVIDER_TIMEOUT' })), timeoutMs);
    })]);
  } catch (error) {
    if (error?.code === 'FIXTURE_PROVIDER_TIMEOUT') {
      operationPromise.catch(() => {});
      destroyClient(client);
    }
    throw error;
  } finally { clearTimeout(timer); }
}

async function closeClient(client, timeoutMs = CLOSE_TIMEOUT_MS) {
  let timer;
  const closePromise = Promise.resolve().then(() => client.end()).catch(() => {});
  let timedOut = false;
  await Promise.race([closePromise, new Promise((resolve) => { timer = setTimeout(() => { timedOut = true; resolve(); }, timeoutMs); })]);
  clearTimeout(timer);
  if (timedOut) destroyClient(client);
}

function databaseUrlFor(databaseUrl, databaseName) {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function quoteGeneratedIdentifier(value) {
  if (!/^orgward_t91_fixture_[a-f0-9]{32}$/.test(value)) throw new Error('Invalid generated fixture database identifier.');
  return `"${value}"`;
}

export async function readPostgresDatabaseIdentity(client) {
  const result = await client.query(`select control.system_identifier::text as cluster_id,
      database.oid::text as database_oid, database.datname as database_name
    from pg_catalog.pg_control_system() control
    cross join pg_catalog.pg_database database
    where database.datname = current_database()`);
  if (result.rowCount !== 1 || !/^\d+$/.test(result.rows[0].cluster_id ?? '')
    || !/^\d+$/.test(result.rows[0].database_oid ?? '') || !/^[A-Za-z0-9_]+$/.test(result.rows[0].database_name ?? '')) {
    throw new Error('PostgreSQL did not provide a complete cluster and database identity.');
  }
  return { clusterId: result.rows[0].cluster_id, databaseOid: result.rows[0].database_oid,
    databaseName: result.rows[0].database_name };
}

export class T91N2FixtureDatabaseProvider {
  constructor({ applicationDatabaseUrl, fixtureAdminDatabaseUrl,
    createClient = null, runFixture, timeouts = {} }) {
    this.applicationDatabaseUrl = applicationDatabaseUrl;
    this.fixtureAdminDatabaseUrl = fixtureAdminDatabaseUrl;
    this.timeouts = { connect: timeouts.connect ?? CONNECT_TIMEOUT_MS, query: timeouts.query ?? QUERY_TIMEOUT_MS,
      close: timeouts.close ?? CLOSE_TIMEOUT_MS, run: timeouts.run ?? FIXTURE_RUN_TIMEOUT_MS,
      abortGrace: timeouts.abortGrace ?? 5_000 };
    this.createClient = createClient ?? ((connectionString) => new Client({ connectionString,
      connectionTimeoutMillis: this.timeouts.connect, query_timeout: this.timeouts.query,
      statement_timeout: this.timeouts.query, lock_timeout: Math.min(this.timeouts.query, 2_000) }));
    this.runFixture = runFixture;
    this.ready = false;
    this.lastInitializationError = null;
    this.fixtureClusterIdentity = null;
  }

  get available() { return this.ready && typeof this.runFixture === 'function'; }

  async initialize() {
    this.ready = false;
    this.lastInitializationError = null;
    if (!this.applicationDatabaseUrl || !this.fixtureAdminDatabaseUrl || typeof this.runFixture !== 'function') return false;
    let sourceClient = null;
    let fixtureClient = null;
    try {
      sourceClient = this.createClient(this.applicationDatabaseUrl);
      fixtureClient = this.createClient(this.fixtureAdminDatabaseUrl);
      await Promise.all([bounded(sourceClient, 'application database connection', () => sourceClient.connect(), this.timeouts.connect),
        bounded(fixtureClient, 'fixture administrator connection', () => fixtureClient.connect(), this.timeouts.connect)]);
      const [sourceIdentity, fixtureIdentity, fixtureCapabilities] = await Promise.all([
        bounded(sourceClient, 'application identity query', () => readPostgresDatabaseIdentity(sourceClient), this.timeouts.query),
        bounded(fixtureClient, 'fixture identity query', () => readPostgresDatabaseIdentity(fixtureClient), this.timeouts.query),
        bounded(fixtureClient, 'fixture capability query', async () => {
          const result = await fixtureClient.query(`select (role.rolsuper or role.rolcreatedb) as can_create_database,
              not pg_catalog.pg_is_in_recovery() as writable_primary,
              current_setting('transaction_read_only') = 'off' as session_writable
            from pg_catalog.pg_roles role where role.rolname=current_user`);
          if (result.rowCount !== 1) throw new Error('Fixture database role capability could not be verified.');
          return result.rows[0];
        }, this.timeouts.query),
      ]);
      if (sourceIdentity.clusterId === fixtureIdentity.clusterId) {
        throw new Error('The N2 fixture database must use a PostgreSQL cluster distinct from the application cluster.');
      }
      if (fixtureCapabilities.can_create_database !== true || fixtureCapabilities.writable_primary !== true
        || fixtureCapabilities.session_writable !== true) {
        throw new Error('The fixture administrator must have CREATEDB on a writable PostgreSQL primary.');
      }
      this.fixtureClusterIdentity = fixtureIdentity;
      this.ready = true;
      return true;
    } catch (error) {
      this.lastInitializationError = error;
      this.ready = false;
      return false;
    } finally {
      await Promise.all([sourceClient ? closeClient(sourceClient, this.timeouts.close) : Promise.resolve(),
        fixtureClient ? closeClient(fixtureClient, this.timeouts.close) : Promise.resolve()]);
    }
  }

  async dispatch(input) {
    if (!this.available) throw Object.assign(new Error('The isolated N2 fixture provider is unavailable.'), {
      code: 'PRODUCT_HARNESS_UNAVAILABLE', statusCode: 503,
    });
    const databaseName = `${FIXTURE_DATABASE_PREFIX}${randomUUID().replaceAll('-', '')}`;
    const invocationId = `t91-n2-fixture-invocation-${randomUUID()}`;
    const quotedName = quoteGeneratedIdentifier(databaseName);
    let admin = null;
    let createdIdentity = null;
    let invocationCreatedDatabase = false;
    let preserveDatabaseForTimedOutRunner = false;
    let result;
    let dispatchError = null;
    try {
      admin = this.createClient(this.fixtureAdminDatabaseUrl);
      await bounded(admin, 'fixture administrator connection', () => admin.connect(), this.timeouts.connect);
      const adminIdentity = await bounded(admin, 'fixture identity query', () => readPostgresDatabaseIdentity(admin), this.timeouts.query);
      if (adminIdentity.clusterId !== this.fixtureClusterIdentity.clusterId
        || adminIdentity.databaseName !== this.fixtureClusterIdentity.databaseName
        || adminIdentity.databaseOid !== this.fixtureClusterIdentity.databaseOid) {
        throw new Error('The configured fixture administrator connection changed identity after provider readiness.');
      }
      await bounded(admin, 'database allocation', () => admin.query(`create database ${quotedName} template template0`), this.timeouts.query);
      invocationCreatedDatabase = true;
      const databaseRecord = await bounded(admin, 'database identity query', () => admin.query('select oid::text as database_oid from pg_catalog.pg_database where datname=$1', [databaseName]), this.timeouts.query);
      if (databaseRecord.rowCount !== 1 || !/^\d+$/.test(databaseRecord.rows[0].database_oid ?? '')) {
        throw new Error('The generated fixture database identity could not be recorded.');
      }
      createdIdentity = { clusterId: adminIdentity.clusterId, databaseName, databaseOid: databaseRecord.rows[0].database_oid };
      const fixtureClient = this.createClient(databaseUrlFor(this.fixtureAdminDatabaseUrl, databaseName));
      try {
        await bounded(fixtureClient, 'new fixture database connection', () => fixtureClient.connect(), this.timeouts.connect);
        const connectedIdentity = await bounded(fixtureClient, 'new fixture identity query', () => readPostgresDatabaseIdentity(fixtureClient), this.timeouts.query);
        if (connectedIdentity.clusterId !== this.fixtureClusterIdentity.clusterId
          || connectedIdentity.databaseName !== databaseName || connectedIdentity.databaseOid !== createdIdentity.databaseOid) {
          throw new Error('The newly created fixture database does not match its generated identity.');
        }
      } finally { await closeClient(fixtureClient, this.timeouts.close); }
      const controller = new AbortController();
      const runnerPromise = Promise.resolve().then(() => this.runFixture({ ...input,
        databaseUrl: databaseUrlFor(this.fixtureAdminDatabaseUrl, databaseName), databaseName,
        databaseOid: createdIdentity.databaseOid, fixtureClusterId: createdIdentity.clusterId, invocationId,
        signal: controller.signal }));
      try {
        result = await bounded(null, 'fixed fixture execution', () => runnerPromise, this.timeouts.run);
      } catch (error) {
        if (error?.code === 'FIXTURE_PROVIDER_TIMEOUT') {
          preserveDatabaseForTimedOutRunner = true;
          controller.abort();
          await Promise.race([runnerPromise.then(() => {}, () => {}), new Promise((resolve) => setTimeout(resolve, this.timeouts.abortGrace))]);
        }
        throw error;
      }
    } catch (error) {
      dispatchError = error; this.ready = false;
      annotateT91FixtureDispatchError(error, { invocationId, fixtureTemplateHash: input.fixtureTemplateHash });
    }
    finally {
      try {
        if (invocationCreatedDatabase && !preserveDatabaseForTimedOutRunner) {
          const cleanupIdentity = await bounded(admin, 'cleanup identity query', () => readPostgresDatabaseIdentity(admin), this.timeouts.query);
          if (cleanupIdentity.clusterId !== this.fixtureClusterIdentity.clusterId
            || !/^orgward_t91_fixture_[a-f0-9]{32}$/.test(databaseName)) {
            throw new Error('Fixture cleanup refused because the generated database name or cluster identity no longer matches its reservation.');
          }
          if (!createdIdentity) {
            throw new Error('Fixture cleanup refused because the generated database OID was not captured and verified; the database is retained for operator cleanup.');
          }
          const existing = await bounded(admin, 'cleanup database identity query', () => admin.query('select oid::text as database_oid from pg_catalog.pg_database where datname=$1', [databaseName]), this.timeouts.query);
          if (existing.rowCount === 1 && existing.rows[0].database_oid === createdIdentity.databaseOid) {
            await bounded(admin, 'database cleanup', () => admin.query(`drop database ${quotedName}`), this.timeouts.query);
          } else if (existing.rowCount !== 0) {
            throw new Error('Fixture cleanup refused because the database identity no longer matches its reservation.');
          }
        }
      } catch (cleanupError) {
        this.ready = false;
        if (dispatchError) dispatchError.cleanupError = cleanupError;
        else dispatchError = cleanupError;
      }
      if (admin) await closeClient(admin, this.timeouts.close);
    }
    if (dispatchError) throw dispatchError;
    return result;
  }
}
