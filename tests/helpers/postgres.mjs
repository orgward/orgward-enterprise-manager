import { after } from 'node:test';
import { Pool } from 'pg';
import { startTestPostgresCluster, stopTestPostgresCluster } from './postgres-cluster.mjs';
import { createTestDatabaseName, readTestPostgresConfiguration } from './postgres-runner.mjs';

let clusterPromise;
const openDatabases = new Set();
const scenarioDatabases = new Set();

export async function startPostgres() {
  clusterPromise ??= (async () => {
    const config = readTestPostgresConfiguration(process.env);
    if (!config) return { ...await startTestPostgresCluster(), owned: true };
    const admin = new Pool({ connectionString: `${config.baseUrl}/postgres`, max: 2, connectionTimeoutMillis: 3_000 });
    admin.on('error', () => { /* A later fixture query reports database failure. */ });
    await admin.query('select 1');
    return { baseUrl: config.baseUrl, admin, owned: false, runId: config.runId };
  })();
  const cluster = await clusterPromise;
  const name = createTestDatabaseName();
  await cluster.admin.query(`create database "${name}"`);
  scenarioDatabases.add(name);
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
      await cluster.admin.query(`drop database if exists "${name}" with (force)`);
      closed = true;
      openDatabases.delete(close);
      scenarioDatabases.delete(name);
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
    for (const name of scenarioDatabases) {
      await cluster.admin.query(`drop database if exists "${name}" with (force)`);
    }
  } finally {
    if (cluster.owned) await stopTestPostgresCluster(cluster);
    else await cluster.admin.end();
  }
});
