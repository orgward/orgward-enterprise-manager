import assert from 'node:assert/strict';
import test from 'node:test';
import { PROPOSAL_HUMAN_RUBRIC, proposalHumanReviewHash, proposalHumanReviewMatches,
  validateProposalHumanReview } from '../../src/execution/proposal-human-review.mjs';

const citations = [{ id: 'source-one', hash: 'a'.repeat(64) }];
const criteria = (judgment = 'pass') => PROPOSAL_HUMAN_RUBRIC.map(({ id }) => ({
  criterionId: id, judgment, reason: `Reviewed ${id} against the cited source.`,
  evidence: [{ sourceId: citations[0].id, sourceHash: citations[0].hash }],
}));

test('human proposal rubric requires every fixed judgment, bounded reason and exact cited evidence', () => {
  assert.deepEqual(validateProposalHumanReview(criteria(), citations), criteria().map((entry) => ({
    ...entry, evidence: [{ sourceId: citations[0].id, sourceHash: citations[0].hash }],
  })));
  for (const invalid of [
    criteria().slice(1),
    [...criteria().slice(0, 3), { ...criteria()[3], criterionId: criteria()[2].criterionId }],
    [...criteria().slice(0, 3), { ...criteria()[3], reason: ' ' }],
    [...criteria().slice(0, 3), { ...criteria()[3], reason: 'x'.repeat(401) }],
    [...criteria().slice(0, 3), { ...criteria()[3], evidence: [] }],
    [...criteria().slice(0, 3), { ...criteria()[3], evidence: [{ sourceId: 'source-one', sourceHash: 'b'.repeat(64) }] }],
    [...criteria().slice(0, 3), { ...criteria()[3], extra: 'caller metadata' }],
  ]) assert.throws(() => validateProposalHumanReview(invalid, citations));
});

test('all-pass review hash binds immutable proposal inputs and exact evidence references', () => {
  const proposal = { runId: 'run-one', proposalHash: 'b'.repeat(64), blueprintId: 'blueprint-one',
    blueprintVersion: 3, sourceEnvelopeHash: 'c'.repeat(64), citations };
  const reviewCore = { rubricVersion: 1, runId: proposal.runId, proposalHash: proposal.proposalHash,
    blueprintId: proposal.blueprintId, blueprintVersion: proposal.blueprintVersion,
    sourceEnvelopeHash: proposal.sourceEnvelopeHash, reviewedBy: 'owner-one',
    reviewedAt: '2026-09-29T12:00:00.000Z', criteria: criteria() };
  const reviewHash = proposalHumanReviewHash(reviewCore);
  const persistedOrder = JSON.parse(JSON.stringify({ ...reviewCore, reviewHash }));
  assert.equal(proposalHumanReviewHash(persistedOrder), reviewHash,
    'canonical hashes survive JSONB serialization and key-order changes');
  const event = { type: 'BlueprintProposalReviewed', actor: reviewCore.reviewedBy,
    occurredAt: reviewCore.reviewedAt, eventId: 'event-review', data: { ...reviewCore, reviewHash } };
  assert.equal(proposalHumanReviewMatches(event, proposal), true);
  assert.equal(proposalHumanReviewMatches({ ...event, data: { ...event.data, proposalHash: 'd'.repeat(64) } }, proposal), false);
  assert.equal(proposalHumanReviewMatches({ ...event, data: { ...event.data, sourceEnvelopeHash: 'e'.repeat(64) } }, proposal), false);
  assert.equal(proposalHumanReviewMatches(event, { ...proposal, blueprintId: 'blueprint-replaced' }), false);
  assert.equal(proposalHumanReviewMatches(event, { ...proposal, blueprintVersion: 4 }), false);
  assert.equal(proposalHumanReviewMatches(event, { ...proposal, citations: [{ id: 'source-one', hash: 'f'.repeat(64) }] }), false);
  assert.equal(proposalHumanReviewMatches({ ...event, data: { ...event.data,
    criteria: criteria('needs-attention'), reviewHash: proposalHumanReviewHash({ ...reviewCore, criteria: criteria('needs-attention') }),
  } }, proposal), true, 'a valid negative review is current, but it cannot authorize apply');
  assert.equal(proposalHumanReviewMatches({ ...event, actor: 'different-owner' }, proposal), false);
});
