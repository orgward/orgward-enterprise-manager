import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { assertNoRestoreGuard } from './recovery-guard.mjs';

const { Pool, Client } = pg;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS = path.join(ROOT, 'migrations');
export const RECOVERY_ADVISORY_LOCK_KEY = 0x4f72675761726431n.toString();

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function contentHash(value) {
  return createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonicalJson(value)).digest('hex');
}

export function persistenceIntegrity(message = 'Stored state failed its integrity check.') {
  const error = new Error(message);
  Object.assign(error, {
    statusCode: 503,
    code: 'PERSISTENCE_INTEGRITY',
    retryable: false,
    recoveryActions: [{ type: 'operator_repair', label: 'Ask an operator to repair storage' }],
  });
  return error;
}

export function verifyAggregateRow(row) {
  const state = row?.state;
  if (!state || typeof state !== 'object' || Array.isArray(state)
    || state.id !== row.aggregate_id || state.tenantId !== row.tenant_id
    || !Number.isInteger(state.version) || BigInt(state.version) !== BigInt(row.version)
    || contentHash(state) !== row.state_hash) {
    throw persistenceIntegrity();
  }
  return structuredClone(state);
}

export function verifyCommandRow(row) {
  if (!row?.result || contentHash(row.result) !== row.result_hash) {
    throw persistenceIntegrity('A stored command result failed its integrity check.');
  }
  return structuredClone(row.result);
}

export function eventIdentity(event) {
  return event?.eventId ?? event?.id ?? null;
}

export async function recordEvent(client, { tenantId, kind, id, version, commandId = null, event }) {
  if (!event) return;
  const eventId = eventIdentity(event);
  if (!eventId) throw persistenceIntegrity('A persisted event has no stable event ID.');
  const hash = contentHash(event);
  await client.query(`
    insert into orgward.audit_log
      (tenant_id, aggregate_kind, aggregate_id, aggregate_version, command_id, event_type, actor, event, event_hash)
    values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
  `, [tenantId, kind, id, version, commandId, String(event.type ?? 'StateChanged'), String(event.actor ?? 'system'), canonicalJson(event), hash]);
  await client.query(`
    insert into orgward.outbox
      (event_id, tenant_id, aggregate_kind, aggregate_id, aggregate_version, event, event_hash)
    values ($1, $2, $3, $4, $5, $6::jsonb, $7)
  `, [eventId, tenantId, kind, id, version, canonicalJson(event), hash]);
}

export class PostgresPersistence {
  constructor({ databaseUrl, faults = {} }) {
    if (!databaseUrl) throw new Error('ORGWARD_DATABASE_URL is required for PostgreSQL persistence.');
    this.databaseUrl = databaseUrl;
    this.pool = new Pool({ connectionString: databaseUrl, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
    this.pool.on('error', () => { /* A later query reports database unavailability through the safe API boundary. */ });
    this.faults = faults;
    this.initialization = null;
    this.schemaVersion = null;
    this.recoveryLockClient = null;
    this.recoveryLockHealthy = false;
    this.recoveryLockLostError = null;
    this.recoveryLockLostHandler = null;
    this.poolShutdown = null;
    this.releasingRecoveryLock = false;
  }

  async init() {
    this.initialization ??= this.#acquireRecoverySharedLock().then(async () => {
      await assertNoRestoreGuard(this.recoveryLockClient);
      await this.#migrate();
    }).catch(async (error) => {
      this.initialization = null;
      await this.#releaseRecoveryLock().catch(() => {});
      throw error;
    });
    return this.initialization;
  }

  async #acquireRecoverySharedLock() {
    if (this.recoveryLockClient) return;
    const client = new Client({ connectionString: this.databaseUrl, connectionTimeoutMillis: 5_000 });
    await client.connect();
    try {
      const result = await client.query('select pg_try_advisory_lock_shared($1::bigint) as acquired', [RECOVERY_ADVISORY_LOCK_KEY]);
      if (!result.rows[0].acquired) throw Object.assign(new Error('A database recovery operation is active; service startup is refused.'), { code: 'RECOVERY_OPERATION_ACTIVE' });
      this.recoveryLockClient = client;
      this.recoveryLockHealthy = true;
      this.releasingRecoveryLock = false;
      client.on('error', () => this.#markRecoveryLockLost(client));
      client.on('end', () => this.#markRecoveryLockLost(client));
    } catch (error) {
      await client.end().catch(() => {});
      throw error;
    }
  }

  async #releaseRecoveryLock() {
    const client = this.recoveryLockClient;
    const wasHealthy = this.recoveryLockHealthy;
    this.recoveryLockClient = null;
    this.releasingRecoveryLock = true;
    this.recoveryLockHealthy = false;
    if (!client) return;
    try {
      if (wasHealthy) await client.query('select pg_advisory_unlock_shared($1::bigint)', [RECOVERY_ADVISORY_LOCK_KEY]);
    } catch { /* A lost lock session has already released its server-side lock. */ }
    finally { await client.end().catch(() => {}); }
  }

  setRecoveryLockLostHandler(handler) {
    this.recoveryLockLostHandler = typeof handler === 'function' ? handler : null;
  }

  #markRecoveryLockLost(client) {
    if (this.releasingRecoveryLock || client !== this.recoveryLockClient || !this.recoveryLockHealthy) return;
    this.recoveryLockHealthy = false;
    this.recoveryLockLostError = Object.assign(new Error('The service database recovery fence is unavailable.'), {
      statusCode: 503, code: 'RECOVERY_LOCK_UNAVAILABLE', retryable: false,
    });
    this.poolShutdown ??= this.pool.end().catch(() => {});
    try { this.recoveryLockLostHandler?.(); } catch { /* Runtime remains fenced even if shutdown signaling fails. */ }
  }

  #assertRecoveryLock() {
    if (!this.recoveryLockHealthy) throw this.recoveryLockLostError
      ?? Object.assign(new Error('The service database recovery fence is unavailable.'), { statusCode: 503, code: 'RECOVERY_LOCK_UNAVAILABLE', retryable: false });
  }

  async #migrate() {
    this.#assertRecoveryLock();
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock_shared($1::bigint)', [RECOVERY_ADVISORY_LOCK_KEY]);
      this.#assertRecoveryLock();
      await client.query('select pg_advisory_xact_lock($1)', [684_027_401]);
      await client.query('create schema if not exists orgward');
      await client.query(`
        create table if not exists orgward.schema_migrations (
          version text primary key,
          checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
          applied_at timestamptz not null default now()
        )
      `);
      const files = (await readdir(MIGRATIONS)).filter((file) => /^\d{3}-[a-z0-9-]+\.sql$/.test(file)).sort();
      if (!files.length) throw persistenceIntegrity('No database migrations are available.');
      const knownVersions = new Set(files.map((file) => file.slice(0, -4)));
      const applied = await client.query('select version from orgward.schema_migrations');
      const unknown = applied.rows.map((row) => row.version).filter((version) => !knownVersions.has(version));
      if (unknown.length) throw persistenceIntegrity(`Database schema version ${unknown.sort().join(', ')} is not supported by this application.`);
      for (const file of files) {
        const sql = await readFile(path.join(MIGRATIONS, file), 'utf8');
        const version = file.slice(0, -4);
        const checksum = contentHash(sql);
        const prior = await client.query('select checksum from orgward.schema_migrations where version = $1', [version]);
        if (prior.rowCount) {
          if (prior.rows[0].checksum !== checksum) throw persistenceIntegrity(`Migration ${version} no longer matches the applied checksum.`);
          continue;
        }
        await client.query(sql);
        await client.query('insert into orgward.schema_migrations (version, checksum) values ($1, $2)', [version, checksum]);
      }
      this.#assertRecoveryLock();
      await client.query('commit');
      this.schemaVersion = files.at(-1)?.slice(0, -4) ?? null;
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async transaction(operation) {
    await this.init();
    this.#assertRecoveryLock();
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("set local statement_timeout = '10s'");
      await client.query('select pg_advisory_xact_lock_shared($1::bigint)', [RECOVERY_ADVISORY_LOCK_KEY]);
      this.#assertRecoveryLock();
      const result = await operation(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async query(text, values) {
    await this.init();
    this.#assertRecoveryLock();
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("set local statement_timeout = '10s'");
      await client.query('select pg_advisory_xact_lock_shared($1::bigint)', [RECOVERY_ADVISORY_LOCK_KEY]);
      this.#assertRecoveryLock();
      const result = await client.query(text, values);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async afterCommit(context) {
    try { await this.faults.afterCommit?.(context); }
    catch {
      const error = new Error('The command committed, but its response could not be confirmed. Retry with the same command ID.');
      Object.assign(error, {
        statusCode: 503,
        code: 'COMMIT_OUTCOME_UNKNOWN',
        retryable: true,
        recoveryActions: [{ type: 'retry_same_command', label: 'Retry with the same command ID' }],
      });
      throw error;
    }
  }

  async status() {
    await this.init();
    this.#assertRecoveryLock();
    const result = await this.query('select max(applied_at) applied_at from orgward.schema_migrations');
    return { status: 'postgresql_transactional', schemaVersion: this.schemaVersion, migratedAt: result.rows[0].applied_at?.toISOString() ?? null };
  }

  async applyRetention(now = new Date()) {
    const result = await this.query(`
      delete from orgward.outbox
      where published_at is not null and retain_until < $1
      returning id
    `, [now]);
    return { deletedOutbox: result.rowCount };
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    try { await this.#releaseRecoveryLock(); }
    finally { await (this.poolShutdown ??= this.pool.end()); }
  }
}
