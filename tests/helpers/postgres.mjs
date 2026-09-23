import { randomUUID } from 'node:crypto';
import { after } from 'node:test';
import { Pool } from 'pg';
import { startTestPostgresCluster, stopTestPostgresCluster } from './postgres-cluster.mjs';

let clusterPromise;
const openDatabases = new Set();
const sharedRunId = process.env.ORGWARD_TEST_POSTGRES_RUN_ID;
const sharedBaseUrl = process.env.ORGWARD_TEST_POSTGRES_BASE_URL;

async function getCluster() {
  if (sharedRunId && sharedBaseUrl) {
    let endpoint;
    try { endpoint = new URL(sharedBaseUrl); } catch {
      throw new Error('Shared PostgreSQL test endpoint is invalid.');
    }
    if (!/^[a-f0-9]{12}$/.test(sharedRunId) || endpoint.protocol !== 'postgresql:'
      || endpoint.hostname !== '127.0.0.1' || !endpoint.port || endpoint.pathname !== ''
      || endpoint.password) {
      throw new Error('Shared PostgreSQL test endpoint must be a runner-provided loopback URL.');
    }
    const baseUrl = sharedBaseUrl;
    const admin = new Pool({ connectionString: `${baseUrl}/postgres`, max: 2 });
    admin.on('error', () => { /* A later fixture query reports database failure. */ });
    return { baseUrl, admin, shared: true };
  }
  return startTestPostgresCluster();
}

export async function startPostgres() {
  clusterPromise ??= getCluster();
  const cluster = await clusterPromise;
  const suffix = randomUUID().replaceAll('-', '').slice(0, 20);
  const name = sharedRunId && cluster.shared
    ? `orgward_test_${sharedRunId}_${suffix}`
    : `orgward_test_${suffix}`;
  await cluster.admin.query(`create database "${name}"`);
  const databaseUrl = `${cluster.baseUrl}/${name}`;
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  pool.on('error', () => { /* The next query reports database failure. */ });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    openDatabases.delete(close);
    try { await pool.end(); }
    finally { await cluster.admin.query(`drop database "${name}" with (force)`); }
  };
  openDatabases.add(close);
  return { databaseUrl, query: (text, values) => pool.query(text, values), close };
}

after(async () => {
  const cluster = await clusterPromise?.catch(() => null);
  if (!cluster) return;
  try {
    for (const close of [...openDatabases]) await close();
  } finally {
    if (cluster.shared) await cluster.admin.end();
    else await stopTestPostgresCluster(cluster);
  }
});
