import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { Pool } from 'pg';

const execFileAsync = promisify(execFile);

function postgresBin() {
  const candidates = [
    process.env.ORGWARD_TEST_POSTGRES_BIN,
    '/tmp/orgward-postgres-runtime/usr/lib/postgresql/18/bin',
    '/usr/lib/postgresql/18/bin',
    '/usr/lib/postgresql/17/bin',
    '/usr/lib/postgresql/16/bin',
  ].filter(Boolean);
  return candidates.find((candidate) => {
    try { return process.getBuiltinModule('node:fs').statSync(path.join(candidate, 'postgres')).isFile(); }
    catch { return false; }
  });
}

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => probe.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const onExit = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { child.off('exit', onExit); resolve(); }, 5_000);
    child.once('exit', onExit);
    child.kill('SIGTERM');
  });
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await new Promise((resolve) => child.once('exit', resolve));
  }
}

export async function startTestPostgresCluster() {
  const bin = postgresBin();
  if (!bin) throw new Error('PostgreSQL test binaries are required. Set ORGWARD_TEST_POSTGRES_BIN to a directory containing initdb and postgres.');
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-postgres-test-'));
  const data = path.join(root, 'data');
  const socket = path.join(root, 'socket');
  const log = [];
  let child;
  let admin;
  try {
    await mkdir(socket, { mode: 0o700 });
    const runtimeLibrary = '/tmp/orgward-postgres-runtime/usr/lib/x86_64-linux-gnu';
    const env = {
      ...process.env,
      ...(process.env.LD_LIBRARY_PATH || !runtimeLibrary ? {} : { LD_LIBRARY_PATH: runtimeLibrary }),
    };
    const initArgs = ['-D', data, '--no-locale', '--encoding=UTF8', '--auth=trust', '--no-sync'];
    const packagedShare = '/tmp/orgward-postgres-runtime/usr/share/postgresql/18';
    if (bin.startsWith('/tmp/orgward-postgres-runtime/')) initArgs.push('-L', packagedShare);
    await execFileAsync(path.join(bin, 'initdb'), initArgs, { env });
    const port = await availablePort();
    child = spawn(path.join(bin, 'postgres'), [
      '-D', data, '-h', '127.0.0.1', '-k', socket, '-p', String(port),
      '-c', 'fsync=on', '-c', 'synchronous_commit=on', '-c', 'full_page_writes=on',
    ], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => log.push(chunk.toString()));
    child.stderr.on('data', (chunk) => log.push(chunk.toString()));
    const user = encodeURIComponent(process.env.USER || 'ubuntu');
    const baseUrl = `postgresql://${user}@127.0.0.1:${port}`;
    admin = new Pool({ connectionString: `${baseUrl}/postgres`, max: 2 });
    admin.on('error', () => { /* A later fixture query reports database failure. */ });
    const deadline = Date.now() + 15_000;
    while (true) {
      try {
        await admin.query('select 1');
        return { root, child, admin, baseUrl };
      } catch (error) {
        if (child.exitCode !== null || child.signalCode !== null || Date.now() >= deadline) {
          throw new Error(`PostgreSQL test server did not start: ${error.message}\n${log.join('')}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  } catch (error) {
    await admin?.end().catch(() => {});
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function cleanupTestDatabases(admin, runId) {
  const prefix = `orgward_test_${runId}_`;
  const databases = await admin.query('select datname from pg_database where left(datname, length($1)) = $1 and datallowconn', [prefix]);
  for (const { datname } of databases.rows) {
    await admin.query('select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()', [datname]);
    await admin.query(`drop database if exists "${datname.replaceAll('"', '""')}" with (force)`);
  }
}

export async function stopTestPostgresCluster(cluster, runId) {
  if (!cluster) return;
  try {
    if (runId) await cleanupTestDatabases(cluster.admin, runId);
  } finally {
    try { await cluster.admin.end(); }
    finally {
      try { await stopServer(cluster.child); }
      finally { await rm(cluster.root, { recursive: true, force: true }); }
    }
  }
}
