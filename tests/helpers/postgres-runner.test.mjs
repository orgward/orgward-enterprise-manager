import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTestDatabaseName,
  createTestWorkerEnvironment,
  readTestConcurrency,
  readTestPostgresConfiguration,
  testFilesRequirePostgres,
  withRunnerOwnedCluster,
} from './postgres-runner.mjs';

test('test runner concurrency defaults to two and accepts only one or two workers', () => {
  assert.equal(readTestConcurrency({}), 2);
  assert.equal(readTestConcurrency({ ORGWARD_TEST_CONCURRENCY: '1' }), 1);
  assert.equal(readTestConcurrency({ ORGWARD_TEST_CONCURRENCY: '2' }), 2);
  for (const value of ['', '0', '3', '01', '1.0', 'true']) {
    assert.throws(() => readTestConcurrency({ ORGWARD_TEST_CONCURRENCY: value }), /must be exactly 1 or 2/);
  }
});

test('test worker environment drops caller URLs and receives only the runner-owned local cluster', () => {
  const env = createTestWorkerEnvironment({
    PATH: '/bin',
    ORGWARD_TEST_POSTGRES_BASE_URL: 'postgresql://caller@live.example/db',
    ORGWARD_TEST_POSTGRES_RUN_ID: 'caller-id',
  }, 'postgresql://ubuntu@127.0.0.1:54321', '123e4567-e89b-12d3-a456-426614174000');
  assert.equal(env.PATH, '/bin');
  assert.equal(readTestPostgresConfiguration(env).baseUrl, 'postgresql://ubuntu@127.0.0.1:54321');
  assert.equal(readTestPostgresConfiguration(env).runId, '123e4567-e89b-12d3-a456-426614174000');
  const noPostgres = createTestWorkerEnvironment({ ORGWARD_TEST_POSTGRES_BASE_URL: 'caller-url' }, null);
  assert.equal(readTestPostgresConfiguration(noPostgres), null);
  assert.throws(() => readTestPostgresConfiguration({
    ORGWARD_TEST_POSTGRES_BASE_URL: 'postgresql://caller@live.example/db',
    ORGWARD_TEST_POSTGRES_RUN_ID: '123e4567-e89b-12d3-a456-426614174000',
  }), /local runner-owned/);
  assert.throws(() => readTestPostgresConfiguration({ ORGWARD_TEST_POSTGRES_BASE_URL: 'postgresql://user@127.0.0.1:5432' }), /Invalid runner-owned/);
});

test('only selected files that open test PostgreSQL trigger a disposable cluster', () => {
  const sources = new Map([
    ['tests/no-db.test.mjs', "import test from 'node:test';"],
    ['tests/db.test.mjs', `import { startPostgres } from '${'../helpers/' + 'postgres.mjs'}';`],
  ]);
  const readSource = (file) => sources.get(file);
  assert.equal(testFilesRequirePostgres(['tests/no-db.test.mjs'], readSource), false);
  assert.equal(testFilesRequirePostgres(['tests/db.test.mjs'], readSource), true);
});

test('runner-owned clusters are stopped after successful and failed suite execution', async () => {
  const stopped = [];
  const runOnce = (fail) => withRunnerOwnedCluster({
    start: async () => ({ id: `cluster-${stopped.length}` }),
    stop: async (cluster) => { stopped.push(cluster.id); },
    run: async () => { if (fail) throw new Error('suite failure'); return 'ok'; },
  });
  assert.equal(await runOnce(false), 'ok');
  await assert.rejects(runOnce(true), /suite failure/);
  assert.deepEqual(stopped, ['cluster-0', 'cluster-1']);
});

test('each database scenario receives a distinct safe database name', () => {
  const first = createTestDatabaseName('123e4567-e89b-12d3-a456-426614174000');
  const second = createTestDatabaseName('223e4567-e89b-12d3-a456-426614174000');
  assert.equal(first, 'orgward_test_123e4567e89b12d3a456');
  assert.notEqual(first, second);
  assert.throws(() => createTestDatabaseName('unsafe/name'), /identity/);
});
