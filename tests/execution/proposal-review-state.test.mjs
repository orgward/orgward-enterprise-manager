import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveBlueprintProposalReviewState, proposalApplyFailureDisposition, proposalDesignLink } from '../../public/proposal-review-state.mjs';

const proposal = { blueprintId: 'blueprint-one', blueprintVersion: 4 };
const project = {
  id: 'project-01234567-89ab-cdef-0123-456789abcdef',
  latestBlueprint: { id: proposal.blueprintId, version: proposal.blueprintVersion },
};

test('proposal review state allows only an owner to apply a current unapplied proposal', () => {
  assert.deepEqual(deriveBlueprintProposalReviewState({ proposal, project, membershipAccess: 'owner' }), {
    status: 'owner-can-apply', canApply: true, currentBlueprintVersion: 4,
  });

  const editor = deriveBlueprintProposalReviewState({ proposal, project, membershipAccess: 'editor' });
  assert.equal(editor.status, 'owner-required');
  assert.equal(editor.canApply, false);
  assert.match(editor.message, /workspace owner can apply/i);
});

test('stale, applied, and unavailable proposals never expose the apply action', () => {
  const stale = deriveBlueprintProposalReviewState({
    proposal, project: { latestBlueprint: { id: proposal.blueprintId, version: 5 } }, membershipAccess: 'owner',
  });
  assert.equal(stale.status, 'stale');
  assert.equal(stale.canApply, false);
  assert.match(stale.message, /blueprint changed/i);
  assert.equal(deriveBlueprintProposalReviewState({
    proposal, project: { latestBlueprint: { id: 'blueprint-replaced', version: proposal.blueprintVersion } }, membershipAccess: 'owner',
  }).status, 'stale', 'a matching version number with a different blueprint ID is stale');

  const applied = deriveBlueprintProposalReviewState({
    proposal, project: { latestBlueprint: { id: proposal.blueprintId, version: 5 } },
    membershipAccess: 'owner', appliedEvent: { eventId: 'event-apply', data: { appliedBlueprintVersion: 5 } },
  });
  assert.equal(applied.status, 'applied');
  assert.equal(applied.canApply, false);
  assert.equal(applied.blueprintVersion, 5);

  const unavailable = deriveBlueprintProposalReviewState({ proposal, project: null, membershipAccess: 'owner' });
  assert.equal(unavailable.status, 'project-unavailable');
  assert.equal(unavailable.canApply, false);
});

test('definitive apply denials reconcile state while uncertain outcomes retain the command for replay', () => {
  for (const status of [400, 401, 403, 404, 409, 422]) {
    assert.equal(proposalApplyFailureDisposition({ status }), 'reconcile', `HTTP ${status} is definitive`);
  }
  for (const error of [{}, { status: 408 }, { status: 429 }, { status: 500 }, { status: 503 }]) {
    assert.equal(proposalApplyFailureDisposition(error), 'retry');
  }
});

test('proposal review links preserve the current project and label updated versus current design', () => {
  const href = '/?project=project-01234567-89ab-cdef-0123-456789abcdef';
  assert.deepEqual(proposalDesignLink(project, { status: 'owner-can-apply' }), {
    href, label: 'Open current design',
  });
  assert.deepEqual(proposalDesignLink(project, { status: 'stale' }), {
    href, label: 'Open current design',
  });
  assert.deepEqual(proposalDesignLink(project, { status: 'applied' }), {
    href, label: 'Open updated design',
  });
  assert.equal(proposalDesignLink(null, { status: 'applied' }), null);
  assert.equal(proposalDesignLink({ id: 'invalid-project-id' }, { status: 'proposed' }), null);
});
