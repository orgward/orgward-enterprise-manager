import assert from 'node:assert/strict';
import test from 'node:test';
import { processTaskDesignFreshness, processTaskPinnedDesignRoute, processTaskRepositoryReference } from '../../public/process-task-repository-view.mjs';

test('process task run links back to its exact pinned design and process', () => {
  const run = { projectId: 'project-11111111-1111-4111-8111-111111111111', processTaskRef: {
    processId: 'process-order-intake', blueprintId: 'blueprint-22222222-2222-4222-8222-222222222222', blueprintVersion: 7,
  } };
  const project = { id: run.projectId, blueprintVersions: [{ id: run.processTaskRef.blueprintId, version: 7,
    areas: { capabilitiesProcesses: { items: [{ id: 'process-order-intake', type: 'process' }] } } }],
  latestBlueprint: { id: run.processTaskRef.blueprintId, version: 7 } };
  assert.equal(processTaskPinnedDesignRoute(run, project), '/?project=project-11111111-1111-4111-8111-111111111111&view=map&selected=process-order-intake&blueprintVersion=7');
  assert.deepEqual(processTaskDesignFreshness(run, project), { kind: 'current', blueprintVersion: 7 });
});

test('process task run omits pinned design navigation for invalid source identity', () => {
  const projectId = 'project-11111111-1111-4111-8111-111111111111';
  const blueprintId = 'blueprint-22222222-2222-4222-8222-222222222222';
  const project = { id: projectId, blueprintVersions: [{ id: blueprintId, version: 7,
    areas: { capabilitiesProcesses: { items: [{ id: 'process-order-intake', type: 'process' }] } } }] };
  assert.equal(processTaskPinnedDesignRoute({ projectId: 'not-a-project', processTaskRef: {
    processId: 'process-order-intake', blueprintId, blueprintVersion: 7,
  } }, project), null);
  assert.equal(processTaskPinnedDesignRoute({ projectId: 'project-11111111-1111-4111-8111-111111111111', processTaskRef: {
    processId: '../invalid', blueprintId, blueprintVersion: 7,
  } }, project), null);
  assert.equal(processTaskPinnedDesignRoute({ projectId, processTaskRef: {
    processId: 'process-order-intake', blueprintId, blueprintVersion: 6,
  } }, project), null, 'a neighboring blueprint version is not substituted');
  assert.equal(processTaskPinnedDesignRoute({ projectId, processTaskRef: {
    processId: 'process-order-intake', blueprintId: 'blueprint-33333333-3333-4333-8333-333333333333', blueprintVersion: 7,
  } }, project), null, 'a different blueprint identity is not substituted');
  assert.equal(processTaskPinnedDesignRoute({ projectId, processTaskRef: {
    processId: 'process-missing', blueprintId, blueprintVersion: 7,
  } }, project), null, 'a process absent from the pinned blueprint is not linked');
});

test('process task run marks an older exact source as historical without changing its pin', () => {
  const run = { projectId: 'project-11111111-1111-4111-8111-111111111111', processTaskRef: {
    processId: 'process-order-intake', blueprintId: 'blueprint-22222222-2222-4222-8222-222222222222', blueprintVersion: 7,
  } };
  const pinned = { id: run.processTaskRef.blueprintId, version: 7,
    areas: { capabilitiesProcesses: { items: [{ id: 'process-order-intake', type: 'process' }] } } };
  const project = { id: run.projectId, blueprintVersions: [pinned, { id: pinned.id, version: 8 }],
    latestBlueprint: { id: pinned.id, version: 8 } };
  assert.deepEqual(processTaskDesignFreshness(run, project), {
    kind: 'historical', blueprintVersion: 7, currentBlueprintVersion: 8,
  });
});

test('process task run view names the exact selected Git repository, ref, commit, and tree', () => {
  const run = { processTaskRef: { repository: { id: 'inventory-service', treeDigest: 'a'.repeat(64), source: {
    type: 'git', identity: 'org/inventory-service', ref: 'refs/heads/main', commitOid: 'b'.repeat(40),
  } } } };
  assert.equal(processTaskRepositoryReference(run), `Pinned repository inventory-service · Git · org/inventory-service · ref refs/heads/main · commit ${'b'.repeat(40)} · tree ${'a'.repeat(64)}`);
});

test('process task run view labels other repository kinds without exposing captured source bytes', () => {
  const directoryRun = { processTaskRef: { repository: { id: 'legacy-import', treeDigest: 'c'.repeat(64) } },
    repositorySnapshot: { files: [{ path: 'secret.txt', contentBase64: 'c2VjcmV0' }] } };
  const directorySummary = processTaskRepositoryReference(directoryRun);
  assert.equal(directorySummary, `Pinned repository legacy-import · configured local directory · tree ${'c'.repeat(64)}`);
  assert.equal(directorySummary.includes('c2VjcmV0'), false);

  const githubRun = { processTaskRef: { repository: { id: 'github-987654', treeDigest: 'd'.repeat(64), source: {
    type: 'github-app', repositoryId: '987654', branchRef: 'refs/heads/release', commitOid: 'e'.repeat(40),
  } } } };
  assert.equal(processTaskRepositoryReference(githubRun), `Pinned repository github-987654 · GitHub App · repository 987654 · refs/heads/release · commit ${'e'.repeat(40)} · tree ${'d'.repeat(64)}`);
});

test('process task run view omits repository text when no source was selected', () => {
  assert.equal(processTaskRepositoryReference({ processTaskRef: { taskId: 'task-no-repository' } }), null);
});
