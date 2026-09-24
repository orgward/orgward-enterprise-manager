import { randomUUID } from 'node:crypto';
import { after } from 'node:test';
import { Pool } from 'pg';
import { startTestPostgresCluster, stopTestPostgresCluster } from './postgres-cluster.mjs';

let clusterPromise;
const openDatabases = new Set();

export async function startPostgres() {
  clusterPromise ??= startTestPostgresCluster();
  const cluster = await clusterPromise;
  const suffix = randomUUID().replaceAll('-', '').slice(0, 20);
  const name = `orgward_test_${suffix}`;
  await cluster.admin.query(`create database "${name}"`);
  const databaseUrl = `${cluster.baseUrl}/${name}`;
  const pool = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 3_000 });
  pool.on('error', () => { /* The next query reports database failure. */ });
  let closed = false;
  let closePromise;
  const close = async () => {
    if (closed) return;
    if (closePromise) return closePromise;
    closePromise = (async () => {
      await pool.end();
      closed = true;
      openDatabases.delete(close);
    })();
    try { await closePromise; }
    catch (error) { closePromise = undefined; throw error; }
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
    await stopTestPostgresCluster(cluster);
  }
});
