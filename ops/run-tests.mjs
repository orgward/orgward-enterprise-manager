import { spawn } from 'node:child_process';
import { closeSync, fchmodSync, mkdtempSync, openSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { startTestPostgresCluster, stopTestPostgresCluster } from '../tests/helpers/postgres-cluster.mjs';
import { createTestWorkerEnvironment, readTestConcurrency, testFilesRequirePostgres, withRunnerOwnedCluster } from '../tests/helpers/postgres-runner.mjs';

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
  ...readdirSync('tests/release').filter((file) => file.endsWith('.test.mjs')).sort().map((file) => `tests/release/${file}`),
  ...readdirSync('tests/outcomes').filter((file) => file.endsWith('.test.mjs')).sort().map((file) => `tests/outcomes/${file}`),
  ...readdirSync('tests/enterprise').filter((file) => file.endsWith('.test.mjs')).sort().map((file) => `tests/enterprise/${file}`),
  ...readdirSync('tests/helpers').filter((file) => file.endsWith('.test.mjs')).sort().map((file) => `tests/helpers/${file}`),
];

const requested = process.argv.slice(2);
const testConcurrency = readTestConcurrency(process.env);
const namePatterns = requested.filter((argument) => argument.startsWith('--test-name-pattern='));
const requestedFiles = requested.filter((argument) => !argument.startsWith('--test-name-pattern='));
const selectedFiles = requestedFiles.length ? requestedFiles : files;
const logDirectory = mkdtempSync(path.join(tmpdir(), 'orgward-tests-'));
const logPath = path.join(logDirectory, 'node-test.tap.log');
const logFd = openSync(logPath, 'wx', 0o600);
fchmodSync(logFd, 0o600);
const startedAt = performance.now();

let child;
let interruptedSignal;
const signalNumbers = { SIGINT: 2, SIGTERM: 15, SIGHUP: 1, SIGQUIT: 3 };
const forwardSignal = (signal) => {
  interruptedSignal ??= signal;
  if (child && child.exitCode === null && child.signalCode === null) child.kill(signal);
};
for (const signal of Object.keys(signalNumbers)) process.on(signal, forwardSignal);

let result;
let runnerError;
try {
  const needsPostgres = testFilesRequirePostgres(selectedFiles, (file) => readFileSync(file, 'utf8'));
  result = await withRunnerOwnedCluster({
    start: () => needsPostgres ? startTestPostgresCluster() : Promise.resolve(null),
    stop: (cluster) => cluster ? stopTestPostgresCluster(cluster) : Promise.resolve(),
    run: async (cluster) => {
      if (interruptedSignal) return { status: 128 + signalNumbers[interruptedSignal] };
      const env = createTestWorkerEnvironment(process.env, cluster?.baseUrl, randomUUID());
      await new Promise((resolve) => {
        child = spawn(process.execPath, ['--test', `--test-concurrency=${testConcurrency}`, ...namePatterns, ...selectedFiles], {
          stdio: ['inherit', logFd, logFd], env,
        });
        child.once('error', (error) => resolve({ error, status: 1 }));
        child.once('close', (status, signal) => resolve({ status: status ?? (signal ? 128 + (signalNumbers[signal] ?? 1) : 1), signal }));
      }).then((outcome) => { result = outcome; });
      child = undefined;
      return result;
    },
  });
} catch (error) {
  runnerError = error;
} finally {
  closeSync(logFd);
  for (const signal of Object.keys(signalNumbers)) process.off(signal, forwardSignal);
}

const elapsedSeconds = ((performance.now() - startedAt) / 1000).toFixed(2);
const log = readFileSync(logPath, 'utf8');
const summary = (label) => log.match(new RegExp(`^ℹ ${label} (.+)$`, 'm'))?.[1];
const status = runnerError || result?.error ? 1 : interruptedSignal ? 128 + signalNumbers[interruptedSignal] : result?.status ?? 1;

if (runnerError || result?.error || status !== 0) {
  process.stderr.write(`Tests failed after ${elapsedSeconds}s. Full TAP log: ${logPath}\n`);
  if (runnerError) process.stderr.write(`${runnerError.message}\n`);
  if (result?.error) process.stderr.write(`${result.error.message}\n`);
  const failures = log.split('\n').filter((line) => /^(✖|not ok )/.test(line));
  if (failures.length) process.stderr.write(`${failures.slice(0, 20).join('\n')}\n`);
  else if (log) process.stderr.write(`${log.split('\n').slice(-30).join('\n')}\n`);
  process.exitCode = status;
} else {
  process.stdout.write(`Tests passed: ${summary('pass') ?? '?'} / ${summary('tests') ?? '?'} in ${elapsedSeconds}s. TAP log: ${logPath}\n`);
}
