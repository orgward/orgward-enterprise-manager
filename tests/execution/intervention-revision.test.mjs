import assert from 'node:assert/strict';
import test from 'node:test';
import {
  amendPausedProcessTaskExecutionRun,
  createExecutionRun,
  executionApprovalRequestHash,
  pauseProcessTaskExecutionRun,
} from '../../src/execution/contracts.mjs';

test('amended instruction approval hash binds the append-only event and effective snapshot', () => {
  const run = createExecutionRun({
    tenantId: 'tenant-a', projectId: 'project-a',
    profile: { id: 'fixture', label: 'Fixture', kind: 'command', version: '1' },
    requestedBy: 'requester', title: 'Pinned task', objective: 'Original objective', requirements: ['Original requirement'],
    processTaskRef: { processPlanId: 'plan-a', revision: 1, planInstanceId: 'instance-a', taskId: 'task-a' },
  });
  const originalHash = executionApprovalRequestHash(run);
  pauseProcessTaskExecutionRun(run, { principal: 'requester', commandId: 'pause-1' });
  amendPausedProcessTaskExecutionRun(run, {
    principal: 'requester', commandId: 'amend-1', objective: 'Revised objective',
    requirements: ['Revised requirement'], reason: 'Clarify the requested outcome.',
  });

  const amendedHash = executionApprovalRequestHash(run);
  assert.notEqual(amendedHash, originalHash);
  assert.equal(run.workItem.objective, 'Original objective');
  assert.equal(run.interventionRevisions[0].priorInstructionHash.length, 64);
  assert.equal(run.events.at(-1).data.revision.instructionHash, run.interventionRevisions[0].instructionHash);

  const missingRevision = structuredClone(run);
  missingRevision.interventionRevisions = [];
  assert.throws(() => executionApprovalRequestHash(missingRevision), /history is incomplete/i);

  const editedSnapshot = structuredClone(run);
  editedSnapshot.interventionRevisions[0].objective = 'Unapproved objective';
  assert.throws(() => executionApprovalRequestHash(editedSnapshot), /does not match its append-only evidence/i);

  const editedEvent = structuredClone(run);
  editedEvent.events.at(-1).contentHash = '0'.repeat(64);
  assert.throws(() => executionApprovalRequestHash(editedEvent), /does not match its append-only evidence/i);
});
