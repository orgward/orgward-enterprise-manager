import assert from 'node:assert/strict';
import test from 'node:test';
import { processTaskPinnedIntegrityContext } from '../../public/process-task-integrity-context.mjs';

const run = { projectId: 'project-11111111-1111-4111-8111-111111111111', processTaskRef: {
  blueprintId: 'blueprint-22222222-2222-4222-8222-222222222222', blueprintVersion: 7,
} };
const snapshotHash = 'a'.repeat(64);
const projection = (current = null) => ({ context: { projectVersion: 12,
  blueprintId: run.processTaskRef.blueprintId, blueprintVersion: run.processTaskRef.blueprintVersion, snapshotHash },
integrity: { current } });
const assessment = { id: 'enterprise-integrity-33333333-3333-4333-8333-333333333333', status: 'REVIEW',
  reportHash: 'b'.repeat(64), appliesToContext: true, source: { projectId: run.projectId,
    blueprintId: run.processTaskRef.blueprintId, blueprintVersion: run.processTaskRef.blueprintVersion, snapshotHash },
  counts: { findings: 2 } };

test('process task integrity context exposes the exact matching report identity', () => {
  assert.deepEqual(processTaskPinnedIntegrityContext(run, projection(assessment)), {
    kind: 'assessment', reportId: assessment.id, status: 'REVIEW', reportHash: assessment.reportHash,
    blueprintId: run.processTaskRef.blueprintId, blueprintVersion: 7, snapshotHash, findingCount: 2,
  });
});

test('process task integrity context distinguishes an exact blueprint with no assessment', () => {
  assert.deepEqual(processTaskPinnedIntegrityContext(run, projection()), {
    kind: 'not-assessed', blueprintId: run.processTaskRef.blueprintId, blueprintVersion: 7, snapshotHash,
  });
});

test('process task integrity context rejects reports for a different pinned source', () => {
  assert.deepEqual(processTaskPinnedIntegrityContext(run, projection({ ...assessment,
    source: { ...assessment.source, snapshotHash: 'c'.repeat(64) } })), { kind: 'unavailable' });
  assert.deepEqual(processTaskPinnedIntegrityContext(run, { ...projection(assessment), context: {
    ...projection(assessment).context, blueprintVersion: 6,
  } }), { kind: 'unavailable' });
});
