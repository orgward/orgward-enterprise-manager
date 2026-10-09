import { randomUUID } from 'node:crypto';

export const TEST_POSTGRES_BASE_URL_ENV = 'ORGWARD_TEST_POSTGRES_BASE_URL';
export const TEST_POSTGRES_RUN_ID_ENV = 'ORGWARD_TEST_POSTGRES_RUN_ID';
export const TEST_CONCURRENCY_ENV = 'ORGWARD_TEST_CONCURRENCY';

export function readTestConcurrency(env = process.env) {
  const value = env[TEST_CONCURRENCY_ENV];
  if (value === undefined) return 2;
  if (value === '1' || value === '2') return Number(value);
  throw new Error(`${TEST_CONCURRENCY_ENV} must be exactly 1 or 2.`);
}

export function testFilesRequirePostgres(files, readSource) {
  return files.some((file) => {
    const source = readSource(file);
    return /from\s+['"][^'"]*helpers\/postgres\.mjs['"]/.test(source)
      || /\bstartPostgres\s*\(/.test(source);
  });
}

export function createTestWorkerEnvironment(parentEnvironment, ownedBaseUrl, runId = randomUUID()) {
  const env = { ...parentEnvironment };
  delete env[TEST_POSTGRES_BASE_URL_ENV];
  delete env[TEST_POSTGRES_RUN_ID_ENV];
  if (ownedBaseUrl) {
    env[TEST_POSTGRES_BASE_URL_ENV] = ownedBaseUrl;
    env[TEST_POSTGRES_RUN_ID_ENV] = runId;
  }
  return env;
}

export function readTestPostgresConfiguration(env) {
  const baseUrl = env[TEST_POSTGRES_BASE_URL_ENV];
  const runId = env[TEST_POSTGRES_RUN_ID_ENV];
  if (baseUrl === undefined && runId === undefined) return null;
  if (typeof baseUrl !== 'string' || typeof runId !== 'string' || !/^[a-f0-9-]{36}$/i.test(runId)) {
    throw new Error('Invalid runner-owned PostgreSQL test configuration.');
  }
  let parsed;
  try { parsed = new URL(baseUrl); }
  catch { throw new Error('Invalid runner-owned PostgreSQL test URL.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
    || !parsed.port || !parsed.username || parsed.password || parsed.pathname !== ''
    || parsed.search || parsed.hash) {
    throw new Error('PostgreSQL test URL must identify a local runner-owned cluster base URL.');
  }
  return { baseUrl, runId };
}

export function createTestDatabaseName(id = randomUUID()) {
  const suffix = String(id).replaceAll('-', '').slice(0, 20);
  if (!/^[a-f0-9]{20}$/i.test(suffix)) throw new Error('Invalid PostgreSQL test database identity.');
  return `orgward_test_${suffix}`;
}

export async function withRunnerOwnedCluster({ start, stop, run }) {
  let cluster;
  try {
    cluster = await start();
    return await run(cluster);
  } finally {
    if (cluster) await stop(cluster);
  }
}
