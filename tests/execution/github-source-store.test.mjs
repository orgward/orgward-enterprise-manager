import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PostgresPersistence } from '../../src/platform/postgres.mjs';
import { PostgresGitHubSourceStore } from '../../src/platform/postgres-stores.mjs';
import { ExecutionService } from '../../src/execution/service.mjs';
import { createApp } from '../../server.mjs';
import { startPostgres } from '../helpers/postgres.mjs';

test('GitHub bindings and snapshots survive store restart and require tenant-admin project-owner authority', async () => {
  const postgres = await startPostgres();
  const persistence = new PostgresPersistence({ databaseUrl: postgres.databaseUrl });
  try {
    await persistence.init();
    const tenantId = 'github-onboarding-test';
    const projectId = 'project-12345678-1234-4234-8234-123456789012';
    const principal = `oidc:${'a'.repeat(64)}`;
    const editor = `oidc:${'b'.repeat(64)}`;
    const reader = `oidc:${'c'.repeat(64)}`;
    const byteProjectId = 'project-22345678-1234-4234-8234-123456789012';
    const now = new Date().toISOString();
    const projectState = { id: projectId, tenantId, name: 'Fixture project', version: 0, createdAt: now, updatedAt: now,
      createdBy: principal, updatedBy: principal, conversation: [], events: [], memberships: [] };
    const stateHash = 'a'.repeat(64);
    await persistence.query(`insert into orgward.oidc_principals (principal,issuer,tenant_id,actor_type,display_name,roles)
      values ($1,'https://identity.example.test','github-onboarding-test','human','Owner',array['tenant-admin']),
             ($2,'https://identity.example.test','github-onboarding-test','human','Editor',array['workspace-write']),
             ($3,'https://identity.example.test','github-onboarding-test','human','Reader',array['workspace-read'])`, [principal, editor, reader]);
    await persistence.query(`insert into orgward.aggregates (tenant_id,aggregate_kind,aggregate_id,version,state,state_hash,updated_at)
      values ($1,'project',$2,0,$3::jsonb,$4,$5)`, [tenantId, projectId, JSON.stringify(projectState), stateHash, now]);
    await persistence.query(`insert into orgward.project_memberships (tenant_id,project_id,principal,access,granted_by)
      values ($1,$2,$3,'owner',$3),($1,$2,$4,'editor',$3),($1,$2,$5,'reader',$3)`, [tenantId, projectId, principal, editor, reader]);
    const byteProjectState = { ...projectState, id: byteProjectId, name: 'Byte bound fixture' };
    await persistence.query(`insert into orgward.aggregates (tenant_id,aggregate_kind,aggregate_id,version,state,state_hash,updated_at)
      values ($1,'project',$2,0,$3::jsonb,$4,$5)`, [tenantId, byteProjectId, JSON.stringify(byteProjectState), 'b'.repeat(64), now]);
    await persistence.query(`insert into orgward.project_memberships (tenant_id,project_id,principal,access,granted_by)
      values ($1,$2,$3,'owner',$3),($1,$2,$4,'editor',$3)`, [tenantId, byteProjectId, principal, editor]);

    const initial = new PostgresGitHubSourceStore(persistence);
    const binding = { tenantId, projectId, installationId: '123', repositoryId: '987654',
      repositoryName: 'fixture-org/service', branchRef: 'refs/heads/main', provider: 'github-app', credentialReference: 'github-installation:123' };
    const sourceBytes = Buffer.from('fix');
    const contentHash = createHash('sha256').update(sourceBytes).digest('hex');
    const blobSha = createHash('sha1').update(`blob ${sourceBytes.length}\0`).update(sourceBytes).digest('hex');
    const manifestDigest = createHash('sha256').update(JSON.stringify([{ path: 'README.md', mode: '100644', contentHash,
      size: sourceBytes.length, blobSha }])).digest('hex');
    const snapshot = { id: createHash('sha256').update(`987654\0refs/heads/main\0${'c'.repeat(40)}\0github-read-snapshot-v1`).digest('hex'),
      repositoryId: '987654', branchRef: 'refs/heads/main', commitOid: 'c'.repeat(40), treeOid: 'd'.repeat(40),
      treeDigest: manifestDigest, manifestDigest, policyVersion: 'github-read-snapshot-v1',
      fileCount: 1, totalBytes: sourceBytes.length,
      files: [{ path: 'README.md', mode: '100644', size: sourceBytes.length, contentHash, blobSha, contentBase64: sourceBytes.toString('base64') }] };
    const savedCapture = await initial.saveCapture({ tenantId, projectId, principal, authzGeneration: 1, binding, snapshot });
    assert.equal(Object.hasOwn(savedCapture.snapshots[0], 'files'), false, 'save response contains snapshot metadata only');

    const restartedStore = new PostgresGitHubSourceStore(persistence);
    const saved = await restartedStore.listForProject({ tenantId, projectId, principal, authzGeneration: 1 });
    assert.equal(Object.hasOwn(saved[0].snapshots[0], 'files'), false, 'project listing returns metadata only');
    assert.deepEqual(saved[0].snapshots[0], (({ files, ...metadata }) => metadata)(snapshot));
    const persistedSnapshot = await persistence.query(`select snapshots from orgward.github_repository_sources
      where tenant_id=$1 and project_id=$2 and repository_id=$3 and branch_ref=$4`, [tenantId, projectId, binding.repositoryId, binding.branchRef]);
    assert.equal(persistedSnapshot.rows[0].snapshots[0].files[0].contentBase64, sourceBytes.toString('base64'), 'metadata projection leaves persisted source bytes intact');
    assert.equal(saved[0].credentialReference, 'github-installation:123');
    const editorSnapshots = await restartedStore.listSnapshotsForExecution({ tenantId, projectId, principal: editor, authzGeneration: 1 });
    assert.equal(editorSnapshots.length, 1, 'project editors can select a saved snapshot for a task');
    assert.equal(editorSnapshots[0].snapshot.id, snapshot.id);
    assert.equal(Object.hasOwn(editorSnapshots[0].snapshot, 'files'), false, 'the execution selection list returns metadata only');
    const executionSelection = await new ExecutionService({ runDirectory: '/tmp/github-source-selection-test', githubSourceStore: restartedStore })
      .listGitHubSnapshots({ tenantId, projectId, principal: editor, authzGeneration: 1 });
    assert.equal(executionSelection.available, false, 'remote execution remains disabled until the structured patch path is implemented');
    assert.equal(executionSelection.repositories[0].snapshotId, snapshot.id);
    assert.equal(Object.hasOwn(executionSelection.repositories[0], 'files'), false);
    assert.equal(Object.hasOwn(executionSelection.repositories[0], 'credentialReference'), false);
    const selectableFiles = await new ExecutionService({ runDirectory: '/tmp/github-source-selection-test', githubSourceStore: restartedStore })
      .listGitHubSnapshotFiles({ tenantId, projectId, principal: editor, authzGeneration: 1, snapshotId: snapshot.id });
    assert.deepEqual(selectableFiles.files, [{ path: 'README.md', mode: '100644', size: 3, contentHash }]);
    assert.equal(JSON.stringify(selectableFiles).includes('contentBase64'), false, 'file selection never returns source bytes');
    assert.equal(JSON.stringify(selectableFiles).includes('credentialReference'), false);
    await assert.rejects(new ExecutionService({ runDirectory: '/tmp/github-source-selection-test', githubSourceStore: restartedStore })
      .listGitHubSnapshotFiles({ tenantId, projectId, principal: reader, authzGeneration: 1, snapshotId: snapshot.id }),
    { code: 'ACTION_FORBIDDEN' }, 'file metadata requires project-editor selection authority');
    await assert.rejects(new ExecutionService({ runDirectory: '/tmp/github-source-selection-test', githubSourceStore: restartedStore })
      .validateGitHubSnapshotSelection({ tenantId, projectId, principal: editor, authzGeneration: 0,
        snapshotId: snapshot.id, selectedPaths: ['README.md'] }),
    { code: 'AUTHORITY_GENERATION_STALE' }, 'selection validation rejects a stale caller authorization generation');
    await persistence.query(`update orgward.github_repository_sources
      set snapshots=jsonb_set(snapshots, '{0,manifestDigest}', to_jsonb($5::text))
      where tenant_id=$1 and project_id=$2 and repository_id=$3 and branch_ref=$4`,
    [tenantId, projectId, binding.repositoryId, binding.branchRef, 'f'.repeat(64)]);
    await assert.rejects(new ExecutionService({ runDirectory: '/tmp/github-source-selection-test', githubSourceStore: restartedStore })
      .listGitHubSnapshotFiles({ tenantId, projectId, principal: editor, authzGeneration: 1, snapshotId: snapshot.id }),
    { code: 'GITHUB_SNAPSHOT_MANIFEST_INVALID' }, 'metadata tampering fails closed before a file can be selected');
    await persistence.query(`update orgward.github_repository_sources
      set snapshots=jsonb_set(snapshots, '{0,manifestDigest}', to_jsonb($5::text))
      where tenant_id=$1 and project_id=$2 and repository_id=$3 and branch_ref=$4`,
    [tenantId, projectId, binding.repositoryId, binding.branchRef, manifestDigest]);
    const apiIdentities = new Map([
      ['editor', { issuer: 'https://identity.example.test', subject: 'editor', principal: editor, tenantId,
        roles: ['workspace-write'], actorType: 'human', displayName: 'Editor', expiresAt: Math.floor(Date.now() / 1000) + 300 }],
      ['reader', { issuer: 'https://identity.example.test', subject: 'reader', principal: reader, tenantId,
        roles: ['workspace-read'], actorType: 'human', displayName: 'Reader', expiresAt: Math.floor(Date.now() / 1000) + 300 }],
    ]);
    const apiApp = createApp({ databaseUrl: postgres.databaseUrl, oidcAuthenticator: {
      authenticate: async (request) => apiIdentities.get(request.headers.authorization?.slice(7)) ?? null,
    } });
    await apiApp.init();
    try {
      await new Promise((resolve) => apiApp.server.listen(0, '127.0.0.1', resolve));
      const apiBase = `http://127.0.0.1:${apiApp.server.address().port}`;
      const auth = (subject) => ({ headers: { authorization: `Bearer ${subject}` } });
      const validateSelection = (snapshotId, subject, payload) => fetch(`${apiBase}/api/execution/github-snapshots/${snapshotId}/selection-validation`, {
        ...auth(subject), method: 'POST', headers: { ...auth(subject).headers, 'content-type': 'application/json' }, body: JSON.stringify(payload),
      });
      const listResponse = await fetch(`${apiBase}/api/execution/local-repositories?projectId=${encodeURIComponent(projectId)}`, auth('editor'));
      assert.equal(listResponse.status, 200);
      const listed = await listResponse.json();
      assert.equal(listed.repositories[0].snapshotId, snapshot.id);
      assert.equal(listed.githubExecutionAvailable, false);
      assert.equal(JSON.stringify(listed).includes('contentBase64'), false);
      assert.equal(JSON.stringify(listed).includes('credentialReference'), false);
      const filesResponse = await fetch(`${apiBase}/api/execution/github-snapshots/${snapshot.id}/files?projectId=${encodeURIComponent(projectId)}`, auth('editor'));
      assert.equal(filesResponse.status, 200);
      const filesPayload = await filesResponse.json();
      assert.deepEqual(filesPayload.files, [{ path: 'README.md', mode: '100644', size: 3, contentHash }]);
      assert.equal(JSON.stringify(filesPayload).includes('contentBase64'), false);
      assert.equal(JSON.stringify(filesPayload).includes('credentialReference'), false);
      const deniedFiles = await fetch(`${apiBase}/api/execution/github-snapshots/${snapshot.id}/files?projectId=${encodeURIComponent(projectId)}`, auth('reader'));
      assert.equal(deniedFiles.status, 403, 'file metadata API enforces project-editor authority');
      const deniedBody = await deniedFiles.json();
      assert.equal(typeof deniedBody.error, 'string', 'the current execution route error envelope exposes a string message');
      const validated = await validateSelection(snapshot.id, 'editor', { projectId, selectedPaths: ['README.md'] });
      assert.equal(validated.status, 200);
      const validatedBody = await validated.json();
      assert.equal(validatedBody.validationOnly, true);
      assert.equal(validatedBody.sourceSnapshot.snapshotId, snapshot.id);
      assert.deepEqual(validatedBody.files, [{ path: 'README.md', mode: '100644', size: 3, contentHash }]);
      assert.equal(JSON.stringify(validatedBody).includes('contentBase64'), false);
      assert.equal(JSON.stringify(validatedBody).includes('credentialReference'), false);
      assert.equal(JSON.stringify(validatedBody).includes('"text"'), false, 'selected UTF-8 text never leaves the server');
      assert.equal((await validateSelection(snapshot.id, 'editor', { projectId, selectedPaths: ['../escape'] })).status, 400);
      assert.equal((await validateSelection(snapshot.id, 'editor', { projectId, selectedPaths: ['README.md', 'README.md'] })).status, 400);
      assert.equal((await validateSelection(snapshot.id, 'editor', { projectId, selectedPaths: ['README.md'], prompt: 'extra' })).status, 400);
      assert.equal((await validateSelection('f'.repeat(64), 'editor', { projectId, selectedPaths: ['README.md'] })).status, 404);
      assert.equal((await validateSelection(snapshot.id, 'editor', { projectId: byteProjectId, selectedPaths: ['README.md'] })).status, 404,
        'a snapshot ID cannot be resolved across project ownership');
      assert.equal((await validateSelection(snapshot.id, 'reader', { projectId, selectedPaths: ['README.md'] })).status, 403);
      await persistence.query(`update orgward.github_repository_sources
        set snapshots=jsonb_set(snapshots, '{0,files,0,contentBase64}', to_jsonb($5::text))
        where tenant_id=$1 and project_id=$2 and repository_id=$3 and branch_ref=$4`,
      [tenantId, projectId, binding.repositoryId, binding.branchRef, Buffer.from('bad').toString('base64')]);
      assert.equal((await validateSelection(snapshot.id, 'editor', { projectId, selectedPaths: ['README.md'] })).status, 409,
        'tampered persisted snapshot content is rejected before validation metadata is returned');
      await persistence.query(`update orgward.github_repository_sources
        set snapshots=jsonb_set(snapshots, '{0,files,0,contentBase64}', to_jsonb($5::text))
        where tenant_id=$1 and project_id=$2 and repository_id=$3 and branch_ref=$4`,
      [tenantId, projectId, binding.repositoryId, binding.branchRef, sourceBytes.toString('base64')]);
    } finally {
      await new Promise((resolve) => apiApp.server.close(resolve));
      await apiApp.close();
    }
    const resolvedSnapshot = await restartedStore.resolveSnapshotForExecution({ tenantId, projectId, principal: editor,
      authzGeneration: 1, snapshotId: snapshot.id });
    assert.equal(resolvedSnapshot.snapshot.files[0].contentBase64, sourceBytes.toString('base64'), 'only the server-side resolver receives pinned bytes');
    assert.equal(await restartedStore.resolveSnapshotForExecution({ tenantId, projectId, principal: editor,
      authzGeneration: 1, snapshotId: 'missing-snapshot' }), null, 'missing snapshot identities are not substituted with the latest ref');
    assert.equal(await restartedStore.resolveSnapshotForExecution({ tenantId, projectId: byteProjectId, principal: editor,
      authzGeneration: 1, snapshotId: snapshot.id }), null, 'an authorized different project cannot resolve this snapshot ID');
    await assert.rejects(restartedStore.listSnapshotsForExecution({ tenantId, projectId, principal: reader, authzGeneration: 1 }),
      { code: 'ACTION_FORBIDDEN' }, 'project readers cannot select source snapshots for task requests');
    await assert.rejects(restartedStore.listSnapshotsForExecution({ tenantId: 'other-tenant', projectId, principal: editor, authzGeneration: 1 }),
      { code: 'ACTION_FORBIDDEN' }, 'source metadata remains tenant scoped');
    await assert.rejects(restartedStore.resolveSnapshotForExecution({ tenantId, projectId, principal: editor,
      authzGeneration: 2, snapshotId: snapshot.id }), { code: 'AUTHORITY_GENERATION_STALE' });
    await assert.rejects(restartedStore.listForProject({ tenantId, projectId, principal: editor, authzGeneration: 1 }), { code: 'ACTION_FORBIDDEN' });
    await assert.rejects(restartedStore.listForProject({ tenantId, projectId: 'project-00000000-0000-4000-8000-000000000000', principal, authzGeneration: 1 }), { code: 'ACTION_FORBIDDEN' });
    await assert.rejects(restartedStore.listForProject({ tenantId, projectId, principal, authzGeneration: 2 }), { code: 'AUTHORITY_GENERATION_STALE' });

    for (let index = 2; index < 31; index += 1) {
      const next = { ...snapshot, id: `snapshot-${index}`, commitOid: index.toString(16).padStart(40, '0'),
        treeDigest: index.toString(16).padStart(64, '0'), manifestDigest: index.toString(16).padStart(64, '0') };
      await restartedStore.saveCapture({ tenantId, projectId, principal, authzGeneration: 1, binding, snapshot: next });
    }
    const moved = { ...snapshot, id: 'snapshot-31', commitOid: 'f'.repeat(40), treeDigest: '1'.repeat(64), manifestDigest: '1'.repeat(64) };
    await restartedStore.saveCapture({ tenantId, projectId, principal, authzGeneration: 1, binding, snapshot: moved });
    await restartedStore.saveCapture({ tenantId, projectId, principal, authzGeneration: 1, binding, snapshot: moved });

    const concurrent = ['987655', '987656'].map((repositoryId) => {
      const concurrentBinding = { ...binding, repositoryId, repositoryName: `fixture-org/service-${repositoryId}` };
      const concurrentSnapshot = { ...snapshot, id: `concurrent-${repositoryId}`, repositoryId, totalBytes: 1 };
      return restartedStore.saveCapture({ tenantId, projectId, principal, authzGeneration: 1,
        binding: concurrentBinding, snapshot: concurrentSnapshot });
    });
    const concurrentResults = await Promise.allSettled(concurrent);
    assert.equal(concurrentResults.filter((result) => result.status === 'fulfilled').length, 1,
      'project advisory lock serializes captures across different repository bindings at the shared snapshot ceiling');
    assert.equal(concurrentResults.filter((result) => result.status === 'rejected' && result.reason.code === 'GITHUB_PROJECT_SNAPSHOT_LIMIT').length, 1);

    const final = await restartedStore.listForProject({ tenantId, projectId, principal, authzGeneration: 1 });
    const mainBinding = final.find((entry) => entry.repositoryId === '987654');
    assert.equal(final.flatMap((entry) => entry.snapshots).length, PostgresGitHubSourceStore.MAX_SNAPSHOTS_PER_PROJECT);
    assert.equal(Object.hasOwn(mainBinding.snapshots[0], 'files'), false, 'project snapshot listing does not return source bytes');
    assert.equal(mainBinding.snapshots.at(-1).id, 'snapshot-31', 'ref movement adds one distinct snapshot');
    await restartedStore.saveCapture({ tenantId, projectId, principal, authzGeneration: 1, binding, snapshot: moved });
    await assert.rejects(restartedStore.saveCapture({ tenantId, projectId, principal, authzGeneration: 1,
      binding: { ...binding, repositoryId: '987657' }, snapshot: { ...moved, id: 'snapshot-33', repositoryId: '987657' } }), { code: 'GITHUB_PROJECT_SNAPSHOT_LIMIT' });
    const afterLimit = await restartedStore.listForProject({ tenantId, projectId, principal, authzGeneration: 1 });
    assert.deepEqual(afterLimit.map((entry) => [entry.repositoryId, entry.snapshots]).sort((left, right) => left[0].localeCompare(right[0])),
      final.map((entry) => [entry.repositoryId, entry.snapshots]).sort((left, right) => left[0].localeCompare(right[0])),
      'the project history cap rejects without rewriting or evicting immutable records');
    const retained = await persistence.query(`select snapshots from orgward.github_repository_sources
      where tenant_id=$1 and project_id=$2 and repository_id=$3 and branch_ref=$4`, [tenantId, projectId, binding.repositoryId, binding.branchRef]);
    assert.equal(retained.rows[0].snapshots[0].files[0].contentBase64, sourceBytes.toString('base64'), 'old source bytes remain persisted after metadata reads and cap rejection');

    const byteBinding = { ...binding, projectId: byteProjectId };
    for (let index = 1; index <= 8; index += 1) {
      await restartedStore.saveCapture({ tenantId, projectId: byteProjectId, principal, authzGeneration: 1, binding: byteBinding,
        snapshot: { ...snapshot, id: `byte-${index}`, commitOid: index.toString(16).padStart(40, '0'), totalBytes: 8_000_000 } });
    }
    const atByteLimit = await restartedStore.listForProject({ tenantId, projectId: byteProjectId, principal, authzGeneration: 1 });
    assert.equal(atByteLimit[0].snapshots.reduce((sum, entry) => sum + entry.totalBytes, 0), PostgresGitHubSourceStore.MAX_SNAPSHOT_BYTES_PER_PROJECT);
    await restartedStore.saveCapture({ tenantId, projectId: byteProjectId, principal, authzGeneration: 1, binding: byteBinding,
      snapshot: { ...snapshot, id: 'byte-8', commitOid: '8'.padStart(40, '0'), totalBytes: 8_000_000 } });
    await assert.rejects(restartedStore.saveCapture({ tenantId, projectId: byteProjectId, principal, authzGeneration: 1, binding: byteBinding,
      snapshot: { ...snapshot, id: 'byte-overflow', commitOid: '9'.padStart(40, '0'), totalBytes: 1 } }), { code: 'GITHUB_PROJECT_SNAPSHOT_BYTES_LIMIT' });
    assert.deepEqual(await restartedStore.listForProject({ tenantId, projectId: byteProjectId, principal, authzGeneration: 1 }), atByteLimit,
      'byte-limit rejection preserves all saved snapshots');
  } finally {
    await persistence.close();
    await postgres.close();
  }
});
