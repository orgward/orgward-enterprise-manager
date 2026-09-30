import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveBlueprintProposalReviewState, proposalApplyFailureDisposition, proposalDesignLink } from '../../public/proposal-review-state.mjs';

const proposal = {
  runId: 'run-one', proposalHash: 'a'.repeat(64), sourceEnvelopeHash: 'b'.repeat(64),
  citations: [{ id: 'source-one', hash: 'c'.repeat(64), name: 'Pinned source', type: 'information' }],
  blueprintId: 'blueprint-one', blueprintVersion: 4,
  evaluation: { evaluatorVersion: 1, rubricVersion: 1, meaning: 'structural-checks-only', status: 'passed', checks: [] },
};
const project = {
  id: 'project-01234567-89ab-cdef-0123-456789abcdef',
  latestBlueprint: { id: proposal.blueprintId, version: proposal.blueprintVersion },
  graph: { nodes: [{ id: 'capability-service' }] },
};

const reviewEvent = (judgment = 'pass', overrides = {}) => ({
  eventId: 'event-review', type: 'BlueprintProposalReviewed', actor: 'owner-one', occurredAt: '2026-09-29T12:00:00.000Z',
  data: { rubricVersion: 1, runId: proposal.runId, proposalHash: proposal.proposalHash,
    blueprintId: proposal.blueprintId, blueprintVersion: proposal.blueprintVersion,
    sourceEnvelopeHash: proposal.sourceEnvelopeHash, reviewHash: 'd'.repeat(64), reviewedBy: 'owner-one',
    reviewedAt: '2026-09-29T12:00:00.000Z', criteria: [
      'relevance-to-task', 'source-support', 'actionability', 'scope-and-risk',
    ].map((criterionId) => ({ criterionId, judgment, reason: 'Reviewed against the cited source.',
      evidence: [{ sourceId: 'source-one', sourceHash: 'c'.repeat(64) }] })),
  }, ...overrides,
});

test('proposal requires a matching all-pass owner rubric review before apply', () => {
  const required = deriveBlueprintProposalReviewState({ proposal, project, membershipAccess: 'owner' });
  assert.equal(required.status, 'review-required');
  assert.equal(required.canRecordReview, true);
  assert.equal(required.canApply, false);

  const reviewedProject = { ...project, events: [reviewEvent()] };
  const owner = deriveBlueprintProposalReviewState({ proposal, project: reviewedProject, membershipAccess: 'owner' });
  assert.equal(owner.status, 'owner-can-apply');
  assert.equal(owner.canApply, true);
  assert.equal(owner.review.status, 'passed');

  const editor = deriveBlueprintProposalReviewState({ proposal, project: reviewedProject, membershipAccess: 'editor' });
  assert.equal(editor.status, 'owner-required');
  assert.equal(editor.canRecordReview, false);
  assert.equal(editor.canApply, false);
  assert.match(editor.message, /only a workspace owner/i);

  const needsAttention = deriveBlueprintProposalReviewState({ proposal,
    project: { ...project, events: [reviewEvent('needs-attention')] }, membershipAccess: 'owner' });
  assert.equal(needsAttention.status, 'review-needs-attention');
  assert.equal(needsAttention.canApply, false);
  assert.equal(needsAttention.canRecordReview, true, 'an owner can append a corrective review');
  const supersededPass = deriveBlueprintProposalReviewState({ proposal,
    project: { ...project, events: [reviewEvent(), reviewEvent('needs-attention', {
      eventId: 'event-review-later', occurredAt: '2026-09-29T12:01:00.000Z',
      data: { ...reviewEvent('needs-attention').data, reviewedAt: '2026-09-29T12:01:00.000Z' },
    })] }, membershipAccess: 'owner' });
  assert.equal(supersededPass.status, 'review-needs-attention');
  assert.equal(supersededPass.canApply, false, 'a later negative review supersedes an earlier all-pass review');

  const unsupportedLatest = deriveBlueprintProposalReviewState({ proposal,
    project: { ...project, events: [reviewEvent(), reviewEvent('pass', {
      eventId: 'event-review-unsupported-latest',
      data: { ...reviewEvent().data, rubricVersion: 99 },
    })] }, membershipAccess: 'owner' });
  assert.equal(unsupportedLatest.status, 'review-required');
  assert.equal(unsupportedLatest.review, null);
  assert.equal(unsupportedLatest.canApply, false,
    'an unsupported newer review must not expose an older all-pass review');

  const malformedLatest = deriveBlueprintProposalReviewState({ proposal,
    project: { ...project, events: [reviewEvent(), reviewEvent('pass', {
      eventId: 'event-review-malformed-latest',
      data: { ...reviewEvent().data, criteria: [] },
    })] }, membershipAccess: 'owner' });
  assert.equal(malformedLatest.status, 'review-required');
  assert.equal(malformedLatest.review, null);
  assert.equal(malformedLatest.canApply, false,
    'a malformed newer review must fail closed instead of falling back to an older pass');
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
    proposal, project: { latestBlueprint: { id: proposal.blueprintId, version: 5 }, events: [reviewEvent()] },
    membershipAccess: 'owner', appliedEvent: { eventId: 'event-apply', data: { appliedBlueprintVersion: 5, objectId: 'capability-service' } },
  });
  assert.equal(applied.status, 'applied');
  assert.equal(applied.canApply, false);
  assert.equal(applied.blueprintVersion, 5);
  assert.equal(applied.objectId, 'capability-service');
  assert.equal(applied.review.status, 'passed', 'the applied state keeps the human review inspectable');

  const unavailable = deriveBlueprintProposalReviewState({ proposal, project: null, membershipAccess: 'owner' });
  assert.equal(unavailable.status, 'project-unavailable');
  assert.equal(unavailable.canApply, false);
});

test('blocked, missing, and unknown evaluations remain review-only for owners', () => {
  const blocked = deriveBlueprintProposalReviewState({
    proposal: { ...proposal, evaluation: { ...proposal.evaluation, status: 'blocked', checks: [{ status: 'blocked', message: 'Proposed detail must change.' }] } },
    project, membershipAccess: 'owner',
  });
  assert.equal(blocked.status, 'evaluation-blocked');
  assert.equal(blocked.canApply, false);
  assert.match(blocked.message, /Proposed detail must change/);

  for (const evaluation of [null, { ...proposal.evaluation, evaluatorVersion: 999 }]) {
    const unsupported = deriveBlueprintProposalReviewState({
      proposal: { ...proposal, evaluation }, project, membershipAccess: 'owner',
    });
    assert.equal(unsupported.status, 'evaluation-blocked');
    assert.equal(unsupported.canApply, false);
    assert.match(unsupported.message, /no supported structural evaluation/i);
  }
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
    href, label: 'Open current design',
  });
  assert.equal(proposalDesignLink(null, { status: 'applied' }), null);
  assert.equal(proposalDesignLink({ id: 'invalid-project-id' }, { status: 'proposed' }), null);
});

test('applied proposal links select the changed graph object and safely fall back when it is absent', () => {
  const applied = deriveBlueprintProposalReviewState({
    proposal,
    project: { ...project, latestBlueprint: { id: proposal.blueprintId, version: 5 } },
    appliedEvent: { eventId: 'event-apply', data: { appliedBlueprintVersion: 5, objectId: 'capability-service' } },
  });
  assert.deepEqual(proposalDesignLink({ ...project, latestBlueprint: { id: proposal.blueprintId, version: 5 } }, applied), {
    href: '/?project=project-01234567-89ab-cdef-0123-456789abcdef&view=map&selected=capability-service',
    label: 'Open updated design',
  });
  assert.deepEqual(proposalDesignLink({ ...project, graph: { nodes: [] } }, applied), {
    href: '/?project=project-01234567-89ab-cdef-0123-456789abcdef', label: 'Open current design',
  });
  assert.deepEqual(proposalDesignLink(project, { status: 'applied', objectId: '../unsafe' }), {
    href: '/?project=project-01234567-89ab-cdef-0123-456789abcdef', label: 'Open current design',
  });
});
