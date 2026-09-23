import assert from 'node:assert/strict';
import { constants as fsConstants } from 'node:fs';
import { mkdtemp, open, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { digest } from '../../src/sdlc/contracts.mjs';
import { CommandExecutionAdapter } from '../../src/sdlc/execution-adapter.mjs';
import { approveExecutionRun, createExecutionRun } from '../../src/execution/contracts.mjs';
import { ExecutionService } from '../../src/execution/service.mjs';

test('controlled execution requires independent approval, creates a real system, and persists evidence', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-execution-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const worker = fileURLToPath(new URL('../../workers/scaffold-node-service.mjs', import.meta.url));
  const workspaceRoot = path.join(root, 'workspaces');
  const profile = { id: 'node-scaffold', label: 'Node scaffold', kind: 'system-generator', executable: process.execPath, args: [worker], sandbox: { readOnlyFiles: [worker] }, workspaceRoot };
  const service = new ExecutionService({
    runDirectory: path.join(root, 'runs'),
    profiles: [profile],
  });

  let run = await service.create({
    tenantId: 'tenant-a', profileId: 'node-scaffold', requestedBy: 'requester-a', title: 'Create orders service',
    objective: 'Create an orders API', requirements: ['health check', 'automated test'], sourceRefs: ['REQ-1'],
  });
  assert.equal(run.status, 'AWAITING_APPROVAL');
  await assert.rejects(() => service.execute(run.id, 'tenant-a', { version: run.version }), /must be approved/);
  await assert.rejects(() => service.approve(run.id, 'tenant-a', { version: run.version, principal: 'requester-a', roles: ['execution-approver'] }), /own execution/);
  run = await service.approve(run.id, 'tenant-a', { version: run.version, principal: 'governor-a', roles: ['execution-approver'] });
  assert.equal(run.status, 'APPROVED');
  run = await service.execute(run.id, 'tenant-a', { version: run.version, principal: 'worker-a' });
  assert.equal(run.status, 'SUCCEEDED');
  assert.equal(run.execution.exitCode, 0);
  assert.ok(run.execution.changedArtifacts.some((entry) => entry.path === 'src/server.mjs'));
  assert.ok(run.execution.changedArtifacts.some((entry) => entry.path === 'orgward-manifest.json'));
  assert.equal(run.events.at(-1).type, 'ExecutionSucceeded');
  assert.equal(run.events.every((entry) => entry.contentHash.length === 64), true);

  const generatedTest = spawnSync(process.execPath, ['--test'], { cwd: path.join(workspaceRoot, run.id), encoding: 'utf8', timeout: 20_000 });
  assert.equal(generatedTest.status, 0, generatedTest.stderr);

  const restored = await service.get(run.id, 'tenant-a');
  assert.deepEqual(restored, run);
  assert.equal(await service.get(run.id, 'tenant-b'), null);

  const abandoned = await service.create({ tenantId: 'tenant-a', profileId: 'node-scaffold', requestedBy: 'requester-a', title: 'Interrupted run', objective: 'Prove restart recovery' });
  const stored = await service.store.get(abandoned.id); stored.status = 'RUNNING'; await service.store.save(stored);
  const restarted = new ExecutionService({ runDirectory: path.join(root, 'runs'), profiles: [profile] });
  await restarted.init();
  const recovered = await restarted.get(abandoned.id, 'tenant-a');
  assert.equal(recovered.status, 'INTERRUPTED');
  assert.equal(recovered.events.at(-1).type, 'ExecutionInterrupted');
});

test('credential-bound command profiles fail before worker spawn and approval binds the credential generation', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-bound-provider-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const marker = path.join(root, 'worker-started');
  const worker = path.join(root, 'worker.mjs');
  await import('node:fs/promises').then(({ writeFile }) => writeFile(worker, `await import('node:fs/promises').then(({writeFile}) => writeFile(${JSON.stringify(marker)}, 'spawned'));`));
  const profile = {
    id: 'bound-provider', executable: process.execPath, args: [worker], workspaceRoot: path.join(root, 'workspace'),
    credentialReference: 'secret-provider-a', credentialVersion: 4,
  };
  const service = new ExecutionService({ runDirectory: path.join(root, 'runs'), profiles: [profile] });
  let run = await service.create({ tenantId: 'tenant-a', profileId: profile.id, requestedBy: 'requester', title: 'Provider run', objective: 'Use the provider credential' });
  run = await service.approve(run.id, 'tenant-a', { version: run.version, principal: 'approver', roles: ['execution-approver'] });
  await assert.rejects(service.execute(run.id, 'tenant-a', { version: run.version }), { code: 'BROKER_PROVIDER_UNAVAILABLE' });
  await assert.rejects(import('node:fs/promises').then(({ access }) => access(marker)), { code: 'ENOENT' });
  const changed = await service.store.get(run.id, 'tenant-a');
  changed.profile.credential.version = 5;
  await service.store.save(changed, { expectedVersion: changed.version });
  await assert.rejects(service.execute(run.id, 'tenant-a', { version: changed.version }), /credential binding changed after approval/);
});

test('workspace snapshot rejects a parent symlink swap without publishing the outside file hash', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-snapshot-symlink-race-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspaceRoot = path.join(root, 'workspaces');
  const outside = path.join(root, 'outside-secret.txt');
  await writeFile(outside, 'outside workspace confidential payload');
  const outsideHash = digest(await readFile(outside));
  let runWorkspace;
  let swapped = false;
  const commandAdapterFactory = (options) => new CommandExecutionAdapter({
    ...options,
    snapshotFileSystem: {
      openFile: async (filename, flags) => {
        if (!swapped && filename.endsWith('/payload.txt') && flags & fsConstants.O_NOFOLLOW && !(flags & fsConstants.O_DIRECTORY)) {
          swapped = true;
          await rename(path.join(runWorkspace, 'payload.txt'), path.join(runWorkspace, 'payload-original.txt'));
          await symlink(outside, path.join(runWorkspace, 'payload.txt'));
        }
        return open(filename, flags);
      },
    },
  });
  const profile = {
    id: 'snapshot-race-worker', label: 'Snapshot race test', kind: 'command', version: '1.0.0',
    executable: process.execPath,
    args: ['-e', "require('node:fs').writeFileSync('payload.txt', 'inside workspace')"],
    workspaceRoot,
  };
  const service = new ExecutionService({ runDirectory: path.join(root, 'runs'), profiles: [profile], commandAdapterFactory });
  let run = await service.create({ tenantId: 'tenant-snapshot', profileId: profile.id, requestedBy: 'requester', title: 'Snapshot boundary', objective: 'Write one workspace file' });
  runWorkspace = path.join(workspaceRoot, run.id);
  run = await service.approve(run.id, 'tenant-snapshot', { version: run.version, principal: 'approver', roles: ['execution-approver'] });
  run = await service.execute(run.id, 'tenant-snapshot', { version: run.version, principal: 'worker' });

  assert.equal(swapped, true);
  assert.equal(run.status, 'FAILED');
  assert.deepEqual(run.execution.changedArtifacts, []);
  assert.equal(JSON.stringify(run.execution).includes(outsideHash), false);
  assert.ok(run.events.some((event) => event.type === 'ExecutionFailed'));
  assert.equal(JSON.stringify(run.events).includes(outsideHash), false);
  const persisted = await service.get(run.id, 'tenant-snapshot');
  assert.equal(JSON.stringify(persisted.execution).includes(outsideHash), false);
  assert.equal(JSON.stringify(persisted.events).includes(outsideHash), false);
  await service.shutdown();
});

test('execution service fails closed when principal-scoped store methods are unavailable', async () => {
  let unscopedReads = 0;
  let dispatches = 0;
  const store = {
    async list() { unscopedReads += 1; return []; },
    async listWithDiagnostics() { unscopedReads += 1; return { records: [], corruptRecords: 0 }; },
    async get() { unscopedReads += 1; return null; },
    async authorizeExecutionDispatch({ start }) { dispatches += 1; return start(); },
  };
  const service = new ExecutionService({ runDirectory: '/tmp/orgward-authorization-store-test', store });
  const id = 'execution-run-00000000-0000-4000-8000-000000000000';
  const principal = 'verified-principal';
  const tenantId = 'tenant-a';
  const unavailable = (error) => {
    assert.equal(error.statusCode, 503);
    assert.equal(error.code, 'PROJECT_AUTHORIZATION_UNAVAILABLE');
    assert.equal(error.retryable, false);
    return true;
  };

  await assert.rejects(service.list(tenantId, principal), unavailable);
  await assert.rejects(service.listWithDiagnostics(tenantId, principal), unavailable);
  await assert.rejects(service.get(id, tenantId, principal), unavailable);
  await assert.rejects(service.readArtifact(id, tenantId, principal, 'src/server.mjs'), unavailable);
  await assert.rejects(service.approve(id, tenantId, { scopePrincipal: principal }), unavailable);
  await assert.rejects(service.execute(id, tenantId, { scopePrincipal: principal }), unavailable);

  assert.equal(unscopedReads, 0);
  assert.equal(dispatches, 0);
});

test('execution reads reject membership-only fallbacks without current authority transactions', async () => {
  let membershipOnlyReads = 0;
  const store = {
    async list() { throw new Error('tenant-wide list must not run'); },
    async listForPrincipal() { membershipOnlyReads += 1; return []; },
    async listWithDiagnosticsForPrincipal() { membershipOnlyReads += 1; return { records: [], corruptRecords: 0 }; },
    async get() { throw new Error('tenant-wide get must not run'); },
    async getForPrincipal() { membershipOnlyReads += 1; return null; },
  };
  const service = new ExecutionService({ runDirectory: '/tmp/orgward-authority-read-test', store });
  const unavailable = (error) => error.code === 'PROJECT_AUTHORIZATION_UNAVAILABLE' && error.statusCode === 503;

  await assert.rejects(service.list('tenant-a', 'principal-a', { authzGeneration: 4 }), unavailable);
  await assert.rejects(service.listWithDiagnostics('tenant-a', 'principal-a'), unavailable);
  await assert.rejects(service.get('execution-run-00000000-0000-4000-8000-000000000000', 'tenant-a', 'principal-a', { authzGeneration: 4 }), unavailable);
  await assert.rejects(service.approve('execution-run-00000000-0000-4000-8000-000000000000', 'tenant-a', {
    scopePrincipal: 'principal-a', authorityGeneration: 4,
  }), unavailable);
  await assert.rejects(service.execute('execution-run-00000000-0000-4000-8000-000000000000', 'tenant-a', {
    scopePrincipal: 'principal-a', authorityGeneration: 4,
  }), unavailable);
  assert.equal(membershipOnlyReads, 0);
});

test('authenticated execution writes fail closed when principal-scoped save is unavailable', async () => {
  let unscopedWrites = 0;
  const profile = { id: 'scoped-worker', executable: process.execPath, workspaceRoot: '/tmp/orgward-scoped-write-test' };
  const awaiting = createExecutionRun({
    tenantId: 'tenant-a', projectId: 'project-a', profile, requestedBy: 'requester',
    title: 'Awaiting approval', objective: 'Preserve scoped authorization on approval.',
  });
  const approved = createExecutionRun({
    tenantId: 'tenant-a', projectId: 'project-a', profile, requestedBy: 'requester',
    title: 'Awaiting execution', objective: 'Preserve scoped authorization on execution.',
  });
  approveExecutionRun(approved, { principal: 'approver', roles: ['execution-approver'] });
  const records = new Map([[awaiting.id, awaiting], [approved.id, approved]]);
  const store = {
    async getForPrincipal(id) { return records.get(id) ?? null; },
    async save() { unscopedWrites += 1; },
  };
  const service = new ExecutionService({ runDirectory: '/tmp/orgward-scoped-write-test', store, profiles: [profile] });
  const scopePrincipal = 'verified-principal';
  const unavailable = (error) => {
    assert.equal(error.statusCode, 503);
    assert.equal(error.code, 'PROJECT_AUTHORIZATION_UNAVAILABLE');
    return true;
  };

  await assert.rejects(service.create({
    tenantId: 'tenant-a', projectId: 'project-a', scopePrincipal, profileId: profile.id,
    requestedBy: 'verified-principal', title: 'Create scoped', objective: 'Must not use a tenant-only save.',
  }), unavailable);
  await assert.rejects(service.approve(awaiting.id, 'tenant-a', {
    version: awaiting.version, principal: 'approver', roles: ['execution-approver'], scopePrincipal,
  }), unavailable);
  await assert.rejects(service.execute(approved.id, 'tenant-a', {
    version: approved.version, principal: 'worker', scopePrincipal,
  }), unavailable);

  assert.equal(unscopedWrites, 0);
  assert.equal(awaiting.status, 'AWAITING_APPROVAL');
  assert.equal(approved.status, 'APPROVED');
});

test('authenticated execution requires renewable fencing before it persists RUNNING or dispatches', async () => {
  let writes = 0;
  let dispatches = 0;
  const run = createExecutionRun({
    tenantId: 'tenant-a', projectId: 'project-a', profile: { id: 'bounded-worker', label: 'Bounded worker', kind: 'command', version: '1.0.0' },
    requestedBy: 'requester', title: 'Fenced run', objective: 'Run only while authorized',
  });
  approveExecutionRun(run, { principal: 'approver', roles: ['execution-approver'] });
  const store = {
    async withPrincipalAuthority({ operation }) { return operation(run); },
    async save() { writes += 1; },
    async saveForPrincipal() { writes += 1; },
    async authorizeExecutionDispatch({ start }) { dispatches += 1; return start(); },
  };
  const service = new ExecutionService({
    runDirectory: '/tmp/orgward-worker-fence-test',
    store,
    profiles: [{ id: 'bounded-worker', executable: '/usr/bin/node', workspaceRoot: '/tmp/orgward-worker-fence-workspace' }],
  });

  await assert.rejects(service.execute(run.id, 'tenant-a', {
    version: run.version, principal: 'worker', scopePrincipal: 'verified-principal',
  }), (error) => {
    assert.equal(error.statusCode, 503);
    assert.equal(error.code, 'DISPATCH_FENCE_UNAVAILABLE');
    return true;
  });
  assert.equal(writes, 0);
  assert.equal(dispatches, 0);
  assert.equal(service.active.size, 0);
  assert.equal(run.status, 'APPROVED');
});

test('sandbox setup failure is durable, produces no artifacts, and never runs the host command after restart', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sandbox-failure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const marker = path.join(root, 'host-effect.txt');
  const runDirectory = path.join(root, 'runs');
  const profile = {
    id: 'sandbox-required', executable: process.execPath,
    args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'escaped')`],
    sandbox: { executable: path.join(root, 'missing-bwrap') },
    workspaceRoot: path.join(root, 'workspaces'), timeoutMs: 2_000,
  };
  const service = new ExecutionService({ runDirectory, profiles: [profile] });
  await service.init();
  let run = await service.create({ tenantId: 'tenant-a', profileId: profile.id, requestedBy: 'requester', title: 'No fallback', objective: 'Do not execute outside isolation.' });
  run = await service.approve(run.id, 'tenant-a', { version: run.version, principal: 'independent-approver', roles: ['execution-approver'] });
  run = await service.execute(run.id, 'tenant-a', { version: run.version, principal: 'worker' });
  assert.equal(run.status, 'FAILED');
  assert.equal(run.execution.status, 'FAILED');
  assert.deepEqual(run.execution.changedArtifacts, []);
  assert.equal(run.events.at(-1).type, 'ExecutionFailed');
  await assert.rejects(readFile(marker), { code: 'ENOENT' });

  const restarted = new ExecutionService({ runDirectory, profiles: [profile] });
  await restarted.init();
  const restored = await restarted.get(run.id, 'tenant-a');
  assert.equal(restored.status, 'FAILED');
  assert.deepEqual(restored.execution.changedArtifacts, []);
  assert.equal(restored.events.at(-1).contentHash, run.events.at(-1).contentHash);
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
});
