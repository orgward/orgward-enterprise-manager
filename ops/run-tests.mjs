import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, fchmodSync, mkdtempSync, openSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { startTestPostgresCluster, stopTestPostgresCluster } from '../tests/helpers/postgres-cluster.mjs';

const files = [
  'tests/model.test.mjs',
  'tests/map-state.test.mjs',
  'tests/foundation.test.mjs',
  'tests/persistence.test.mjs',
  'tests/secrets.test.mjs',
  'tests/oidc.test.mjs',
  'tests/oidc-login.test.mjs',
  'tests/server.test.mjs',
  ...readdirSync('tests/platform').filter((file) => file.endsWith('.test.mjs')).sort().map((file) => `tests/platform/${file}`),
  ...readdirSync('tests/sdlc').filter((file) => file.endsWith('.test.mjs')).sort().map((file) => `tests/sdlc/${file}`),
  ...readdirSync('tests/execution').filter((file) => file.endsWith('.test.mjs')).sort().map((file) => `tests/execution/${file}`),
];

const requested = process.argv.slice(2);
const namePatterns = requested.filter((argument) => argument.startsWith('--test-name-pattern='));
const requestedFiles = requested.filter((argument) => !argument.startsWith('--test-name-pattern='));
const selectedFiles = requestedFiles.length ? requestedFiles : files;
const postgresFiles = new Set([
  'tests/persistence.test.mjs', 'tests/secrets.test.mjs', 'tests/execution/provider.test.mjs',
  'tests/platform/https-oidc-journey.test.mjs', 'tests/platform/preflight.test.mjs',
  'tests/platform/bootstrap-retry.test.mjs', 'tests/platform/release-bundle.test.mjs',
  'tests/platform/upgrade.test.mjs',
  'tests/platform/database-recovery.test.mjs',
]);
const postgresPaths = new Set([...postgresFiles].map((file) => path.resolve(file)));
const needsPostgres = selectedFiles.some((file) => postgresPaths.has(path.resolve(file)));
const logDirectory = mkdtempSync(path.join(tmpdir(), 'orgward-tests-'));
const logPath = path.join(logDirectory, 'node-test.tap.log');
const logFd = openSync(logPath, 'wx', 0o600);
fchmodSync(logFd, 0o600);
const startedAt = performance.now();
const runId = randomUUID().replaceAll('-', '').slice(0, 12);
let cluster;
let result;
let runnerError;
try {
  if (needsPostgres) cluster = await startTestPostgresCluster();
  const env = cluster ? {
    ...process.env,
    ORGWARD_TEST_POSTGRES_BASE_URL: cluster.baseUrl,
    ORGWARD_TEST_POSTGRES_RUN_ID: runId,
  } : process.env;
  result = spawnSync(process.execPath, ['--test', '--test-concurrency=2', ...namePatterns, ...selectedFiles], {
    stdio: ['inherit', logFd, logFd], env,
  });
  if (result.error) runnerError = result.error;
} catch (error) {
  runnerError = error;
} finally {
  try { if (cluster) await stopTestPostgresCluster(cluster, runId); }
  catch (error) { runnerError ??= error; }
  closeSync(logFd);
}

const elapsedSeconds = ((performance.now() - startedAt) / 1000).toFixed(2);
const log = readFileSync(logPath, 'utf8');
const summary = (label) => log.match(new RegExp(`^ℹ ${label} (.+)$`, 'm'))?.[1];

if (runnerError || result?.status !== 0) {
  process.stderr.write(`Tests failed after ${elapsedSeconds}s. Full TAP log: ${logPath}\n`);
  if (runnerError) process.stderr.write(`${runnerError.message}\n`);
  const failures = log.split('\n').filter((line) => /^(✖|not ok )/.test(line));
  if (failures.length) process.stderr.write(`${failures.slice(0, 20).join('\n')}\n`);
  else process.stderr.write(`${log.split('\n').slice(-30).join('\n')}\n`);
  process.exit(result?.status ?? 1);
}

process.stdout.write(`Tests passed: ${summary('pass') ?? '?'} / ${summary('tests') ?? '?'} in ${elapsedSeconds}s. TAP log: ${logPath}\n`);
