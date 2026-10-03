import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { CommandExecutionAdapter } from '../../src/sdlc/execution-adapter.mjs';

test('provider-neutral command adapter runs a bounded coding agent and captures immutable evidence', async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'orgward-agent-adapter-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const fixture = fileURLToPath(new URL('./fixtures/reference-agent.mjs', import.meta.url));
  const adapter = new CommandExecutionAdapter({ executable: process.execPath, args: [fixture], name: 'reference-process-coding-agent', sandbox: { readOnlyFiles: [fixture] } });
  const result = await adapter.execute(
    { id: 'WORK-REFERENCE', objective: 'Implement a bounded reference change' },
    { id: 'context-1', requirements: ['REQ-FUN-1'], exclusions: ['production credentials'], contentHash: 'fixture' },
    { workspace },
  );
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /implemented WORK-REFERENCE/);
  assert.equal(result.stdoutTruncated, false);
  assert.equal(result.stderrTruncated, false);
  assert.deepEqual(result.changedArtifacts.map((entry) => entry.path), ['src/bounded-change.json']);
  const artifactBytes = await readFile(path.join(workspace, 'src/bounded-change.json'));
  assert.equal(result.changedArtifacts[0].contentHash, createHash('sha256').update(artifactBytes).digest('hex'));
  assert.equal(result.evidenceHash.length, 64);
});

test('command adapter flags capped stdout and stderr while retaining their bounded tails', async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'orgward-agent-adapter-output-cap-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const adapter = new CommandExecutionAdapter({
    executable: process.execPath,
    args: ['-e', "process.stdout.write('S'.repeat(25_000)+'stdout-tail');process.stderr.write('E'.repeat(25_000)+'stderr-tail')"],
  });
  const result = await adapter.execute({ id: 'WORK-OUTPUT-CAP', objective: 'Capture bounded output.' }, {}, { workspace });
  assert.equal(result.stdout.length, 20_000);
  assert.equal(result.stderr.length, 20_000);
  assert.ok(result.stdout.endsWith('stdout-tail'));
  assert.ok(result.stderr.endsWith('stderr-tail'));
  assert.equal(result.stdoutTruncated, true);
  assert.equal(result.stderrTruncated, true);
});

test('command adapter rejects PATH lookup and therefore cannot invoke an ambiguous executable', () => {
  assert.throws(() => new CommandExecutionAdapter({ executable: 'node' }), /absolute path/);
});

test('command adapter isolates host files and networking and keeps approved context read-only', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-command-sandbox-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  const hostCanary = path.join(root, 'host-secret.txt');
  await writeFile(hostCanary, 'host-only-canary');
  const hostServer = createServer((_request, response) => response.end('host network must remain unreachable'));
  await new Promise((resolve) => hostServer.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => hostServer.close(resolve)));
  const fixture = fileURLToPath(new URL('./fixtures/sandbox-boundary-probe.mjs', import.meta.url));
  const adapter = new CommandExecutionAdapter({
    executable: process.execPath,
    args: [fixture, hostCanary, String(hostServer.address().port)],
    sandbox: { readOnlyFiles: [fixture] },
  });
  await assert.rejects(adapter.execute({ id: 'WORK-SANDBOX', objective: 'Probe isolation' }, { id: 'context-sandbox' }, { workspace }), /symbolic link/);
  const probe = JSON.parse(await readFile(path.join(workspace, 'sandbox-probe.json'), 'utf8'));
  assert.deepEqual(probe, { hostCanaryReadable: false, networkReachable: false, contextWritable: false, leakedEnvironment: null });
  assert.equal(await readFile(hostCanary, 'utf8'), 'host-only-canary');
});

test('command adapter keeps a build candidate read-only while exposing only its private output mount', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-build-sandbox-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  const outputDirectory = await mkdtemp(path.join(root, 'output-'));
  await mkdir(workspace, { mode: 0o700 });
  await writeFile(path.join(workspace, 'README.md'), 'candidate bytes\n');
  const adapter = new CommandExecutionAdapter({
    executable: process.execPath,
    args: ['-e', `const fs = require('node:fs'); let writable = true; try { fs.writeFileSync('/workspace/README.md', 'changed'); } catch { writable = false; } if (writable) process.exit(17); fs.mkdirSync('/build-output/dist', { recursive: true }); fs.writeFileSync('/build-output/dist/app.js', fs.readFileSync('/workspace/README.md'));`],
    sandbox: { workspaceReadOnly: true, writableDirectories: [{ path: outputDirectory, target: '/build-output' }] },
  });
  const result = await adapter.execute({ id: 'WORK-BUILD-SANDBOX', objective: 'Keep source read-only and capture a build output.' }, {}, { workspace });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.changedArtifacts, []);
  assert.equal(await readFile(path.join(workspace, 'README.md'), 'utf8'), 'candidate bytes\n');
  assert.equal(await readFile(path.join(outputDirectory, 'dist', 'app.js'), 'utf8'), 'candidate bytes\n');
});

test('command adapter stops the sandbox payload and its writes when the worker is revoked', async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'orgward-command-revoked-'));
  const controller = new AbortController();
  let handle;
  t.after(async () => {
    controller.abort();
    handle?.terminate();
    await handle?.result.catch(() => {});
    await rm(workspace, { recursive: true, force: true });
  });
  const adapter = new CommandExecutionAdapter({
    executable: process.execPath,
    args: ['-e', "const fs = require('node:fs'); setInterval(() => fs.appendFileSync('heartbeat.txt', 'x'), 25)"],
    timeoutMs: 2_000,
  });
  handle = await adapter.start(
    { id: 'WORK-REVOKED', objective: 'Stop all work after revocation.' },
    { id: 'context-revoked' },
    { workspace, signal: controller.signal },
  );
  const heartbeat = path.join(workspace, 'heartbeat.txt');
  const heartbeatDeadline = Date.now() + 1_500;
  let heartbeatBytes = 0;
  while (Date.now() < heartbeatDeadline && heartbeatBytes === 0) {
    try {
      heartbeatBytes = (await readFile(heartbeat)).length;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (heartbeatBytes === 0) await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(heartbeatBytes > 0, 'the sandbox payload should start and write its first heartbeat');
  controller.abort();
  await assert.rejects(handle.result, { code: 'EXECUTION_REVOKED' });
  assert.ok(handle.child.exitCode !== null || handle.child.signalCode !== null);
  const stoppedAt = (await readFile(heartbeat)).length;
  await new Promise((resolve) => setTimeout(resolve, 125));
  assert.equal((await readFile(heartbeat)).length, stoppedAt, 'the isolated payload must stop writing after revocation');
});

test('command adapter rejects unapproved environment and never falls back when bubblewrap is missing', async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'orgward-command-no-fallback-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  assert.throws(() => new CommandExecutionAdapter({
    executable: process.execPath, environment: { HOST_SECRET_CANARY: 'never expose this' }, sandbox: {},
  }), /environment is not allowlisted/);

  const marker = path.join(workspace, 'host-effect.txt');
  const adapter = new CommandExecutionAdapter({
    executable: process.execPath,
    args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'escaped')`],
    sandbox: { executable: path.join(workspace, 'missing-bwrap') },
  });
  await assert.rejects(adapter.execute({ id: 'WORK-NO-FALLBACK', objective: 'Do not run directly' }, {}, { workspace }), { code: 'ENOENT' });
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
});
