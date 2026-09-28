import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { startPostgres } from './postgres.mjs';

test('runner-shared cluster keeps each PostgreSQL scenario in a fresh database', async (t) => {
  const first = await startPostgres();
  const second = await startPostgres();
  t.after(async () => { await Promise.all([first.close(), second.close()]); });

  const firstUrl = new URL(first.databaseUrl);
  const secondUrl = new URL(second.databaseUrl);
  assert.equal(firstUrl.hostname, secondUrl.hostname, 'both scenarios use the same runner-owned local cluster');
  assert.equal(firstUrl.port, secondUrl.port, 'both scenarios use the same runner-owned local cluster port');
  assert.notEqual(firstUrl.pathname, secondUrl.pathname, 'each scenario receives a distinct database');
  await first.query('create table scenario_isolation_probe (value text not null)');
  await assert.rejects(second.query("select * from scenario_isolation_probe"), /does not exist/);
  await first.close();
  const removedScenario = new Pool({ connectionString: first.databaseUrl, max: 1, connectionTimeoutMillis: 1_000 });
  try { await assert.rejects(removedScenario.query('select 1'), /does not exist/i); }
  finally { await removedScenario.end(); }
});
