import assert from 'node:assert/strict';
import test from 'node:test';
import { processTaskGuidanceReview } from '../../public/process-task-guidance-review.mjs';

const run = (overrides = {}) => ({
  processTaskRef: { actorId: 'actor-1', roleId: 'role-1', blueprintId: 'blueprint-1', blueprintVersion: 4, revision: 3 },
  workItem: {
    proposalContext: { sourceEnvelope: { blueprintId: 'blueprint-1', blueprintVersion: 4 } },
    taskGuidance: { actorId: 'actor-1', roleId: 'role-1', blueprintId: 'blueprint-1', blueprintVersion: 4,
      graphRevision: 3, proposedInstructions: 'Propose a bounded result.', proposedScope: ['Use the saved signal.'], guidanceDigest: 'a'.repeat(64) },
  },
  ...overrides,
});

test('run review exposes the exact saved proposed guidance and never elevates proposed tools', () => {
  const view = processTaskGuidanceReview(run());
  assert.equal(view.kind, 'snapshot');
  assert.equal(view.roleId, 'role-1');
  assert.equal(view.blueprintVersion, 4);
  assert.equal(view.graphRevision, 3);
  assert.equal(view.proposedInstructions, 'Propose a bounded result.');
  assert.deepEqual(view.proposedScope, ['Use the saved signal.']);
  assert.equal(JSON.stringify(view).includes('tool'), false);
});

test('legacy run review explains that only the saved pre-guidance prompt is used', () => {
  const legacy = run({ workItem: { proposalContext: { sourceEnvelope: {} } } });
  const view = processTaskGuidanceReview(legacy);
  assert.equal(view.kind, 'legacy');
  assert.match(view.message, /predates pinned role-guidance snapshots/);
  assert.match(view.message, /current editable role text is not added/);
});

test('missing or mismatched run snapshot is unavailable and non-model runs have no guidance section', () => {
  const mismatched = run();
  mismatched.workItem.taskGuidance.roleId = 'other-role';
  assert.equal(processTaskGuidanceReview(mismatched).kind, 'unavailable');
  assert.equal(processTaskGuidanceReview({ processTaskRef: run().processTaskRef, workItem: {} }), null);
});
