import assert from 'node:assert/strict';
import test from 'node:test';
import { processTaskRepositoryReference } from '../../public/process-task-repository-view.mjs';

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
