import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEGACY_SOFTWARE_PLAN_COMPILER_VERSION,
  SOFTWARE_PLAN_COMPILER_VERSION,
  softwareDeliveryIdentity,
} from '../../src/sdlc/software-plan-compiler.mjs';

const binding = {
  projectId: 'project-one',
  caseId: 'change-case-one',
  sourceHash: 'a'.repeat(64),
  blueprintId: 'blueprint-one',
  blueprintVersion: 3,
  sourceObjectId: 'information-one',
  sourceObjectType: 'information',
  g6PlanHash: 'b'.repeat(64),
};

test('software delivery identities are stable per case and pinned source, and distinct across bindings', () => {
  const original = softwareDeliveryIdentity(binding, ['WORK-1', 'WORK-2']);
  const replay = softwareDeliveryIdentity(binding, ['WORK-1', 'WORK-2']);
  assert.deepEqual(replay, original, 'same case/source compilation remains deterministic');

  for (const changedBinding of [
    { ...binding, caseId: 'change-case-two' },
    { ...binding, sourceHash: 'c'.repeat(64) },
    { ...binding, sourceObjectId: 'information-two' },
    { ...binding, blueprintId: 'blueprint-two', blueprintVersion: 1 },
  ]) {
    const changed = softwareDeliveryIdentity(changedBinding, ['WORK-1', 'WORK-2']);
    assert.notEqual(changed.generationKey, original.generationKey);
    assert.notEqual(changed.planId, original.planId);
    assert.notEqual(changed.taskIds['WORK-1'], original.taskIds['WORK-1']);
    assert.notEqual(changed.taskIds['WORK-2'], original.taskIds['WORK-2']);
  }
});

test('v1 software delivery identity preserves its historical project/G6 key shape', () => {
  const original = softwareDeliveryIdentity(binding, ['WORK-1'], LEGACY_SOFTWARE_PLAN_COMPILER_VERSION);
  const changedCase = softwareDeliveryIdentity({ ...binding, caseId: 'change-case-two', sourceHash: 'c'.repeat(64) }, ['WORK-1'], LEGACY_SOFTWARE_PLAN_COMPILER_VERSION);
  assert.deepEqual(changedCase, original);
  assert.equal(SOFTWARE_PLAN_COMPILER_VERSION, 't28-g6-software-delivery-v2');
});
