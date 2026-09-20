import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ExecutionService } from '../../src/execution/service.mjs';

test('controlled execution requires independent approval, creates a real system, and persists evidence', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-execution-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const worker = fileURLToPath(new URL('../../workers/scaffold-node-service.mjs', import.meta.url));
  const workspaceRoot = path.join(root, 'workspaces');
  const profile = { id: 'node-scaffold', label: 'Node scaffold', kind: 'system-generator', executable: process.execPath, args: [worker], workspaceRoot };
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
