import assert from 'node:assert/strict';
import test from 'node:test';
import { humanTaskEffectiveAssigneePresentation } from '../../public/human-task-effective-assignee.mjs';

test('effective human assignment names the current actor without replacing the pinned plan actor', () => {
  assert.deepEqual(humanTaskEffectiveAssigneePresentation({ actorType: 'human',
    assignedToCurrentPrincipal: true, effectiveAssignmentOverridden: false }), {
    label: 'Current assigned human: You',
    detail: 'This current assignment follows the human actor pinned in the saved plan.',
    overridden: false,
  });
  assert.deepEqual(humanTaskEffectiveAssigneePresentation({ actorType: 'human',
    assignedToCurrentPrincipal: true, effectiveAssignmentOverridden: true }), {
    label: 'Current assigned human: You',
    detail: 'An owner reassigned this checkpoint. The pinned blueprint actor remains part of the saved plan; this current assignment controls who may act.',
    overridden: true,
  });
});

test('owner-provided names render while other readers get a neutral label', () => {
  assert.deepEqual(humanTaskEffectiveAssigneePresentation({ actorType: 'human',
    assignedToCurrentPrincipal: false, effectiveAssignmentOverridden: true,
    effectiveAssigneeDisplayName: '  Carol Reviewer  ' }), {
    label: 'Current assigned human: Carol Reviewer',
    detail: 'An owner reassigned this checkpoint. The pinned blueprint actor remains part of the saved plan; this current assignment controls who may act.',
    overridden: true,
  });
  const reader = humanTaskEffectiveAssigneePresentation({ actorType: 'human',
    assignedToCurrentPrincipal: false, effectiveAssignmentOverridden: true,
  });
  assert.equal(reader.label, 'Current assigned human: Assigned member');
  assert.equal(Object.hasOwn(reader, 'displayName'), false);
  assert.equal(humanTaskEffectiveAssigneePresentation({ actorType: 'agent' }), null);
  assert.equal(humanTaskEffectiveAssigneePresentation({ actorType: 'human',
    effectiveAssigneeDisplayName: '   ' }).label, 'Current assigned human: Assigned member');
});
