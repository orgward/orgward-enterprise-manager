import { digest } from '../sdlc/contracts.mjs';

export const PROPOSAL_HUMAN_RUBRIC_VERSION = 1;
export const PROPOSAL_HUMAN_RUBRIC = Object.freeze([
  { id: 'relevance-to-task', label: 'Relevant to the assigned task' },
  { id: 'source-support', label: 'Supported by the cited source' },
  { id: 'actionability', label: 'Concrete and actionable' },
  { id: 'scope-and-risk', label: 'Within approved scope and risk' },
]);

export function validateProposalHumanReview(criteria, citations) {
  const fail = (message, code = 'BLUEPRINT_PROPOSAL_REVIEW_INVALID', statusCode = 400) => {
    throw Object.assign(new Error(message), { code, statusCode });
  };
  if (!Array.isArray(criteria) || criteria.length !== PROPOSAL_HUMAN_RUBRIC.length) {
    fail('A review must answer every required rubric criterion.');
  }
  const citationByKey = new Map((citations ?? []).map(({ id, hash }) => [`${id}\n${hash}`, { id, hash }]));
  const byId = new Map();
  for (const item of criteria) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).sort().join(',') !== 'criterionId,evidence,judgment,reason'
      || !PROPOSAL_HUMAN_RUBRIC.some(({ id }) => id === item.criterionId)
      || byId.has(item.criterionId)
      || !['pass', 'needs-attention'].includes(item.judgment)
      || typeof item.reason !== 'string' || item.reason.trim().length < 1 || item.reason.trim().length > 400
      || !Array.isArray(item.evidence) || item.evidence.length < 1 || item.evidence.length > 8) {
      fail('Each rubric answer needs a unique criterion, judgment, 1–400 character reason, and cited evidence.');
    }
    const evidence = [];
    const seen = new Set();
    for (const ref of item.evidence) {
      if (!ref || typeof ref !== 'object' || Array.isArray(ref)
        || Object.keys(ref).sort().join(',') !== 'sourceHash,sourceId'
        || typeof ref.sourceId !== 'string' || typeof ref.sourceHash !== 'string') {
        fail('Review evidence must reference a cited source ID and hash.');
      }
      const key = `${ref.sourceId}\n${ref.sourceHash}`;
      if (!citationByKey.has(key) || seen.has(key)) fail('Review evidence must match a unique source cited by this proposal.');
      seen.add(key);
      evidence.push({ sourceId: citationByKey.get(key).id, sourceHash: citationByKey.get(key).hash });
    }
    byId.set(item.criterionId, {
      criterionId: item.criterionId,
      judgment: item.judgment,
      reason: item.reason.trim(),
      evidence,
    });
  }
  return PROPOSAL_HUMAN_RUBRIC.map(({ id }) => byId.get(id));
}

export function proposalHumanReviewHash(review) {
  const { reviewHash: _ignored, ...core } = review;
  return digest(core);
}

export function proposalHumanReviewMatches(event, proposal) {
  const data = event?.data;
  return event?.type === 'BlueprintProposalReviewed'
    && data?.rubricVersion === PROPOSAL_HUMAN_RUBRIC_VERSION
    && data?.runId === proposal?.runId
    && data?.proposalHash === proposal?.proposalHash
    && data?.blueprintId === proposal?.blueprintId
    && data?.blueprintVersion === proposal?.blueprintVersion
    && data?.sourceEnvelopeHash === proposal?.sourceEnvelopeHash
    && typeof data?.reviewedBy === 'string' && event.actor === data.reviewedBy
    && typeof data?.reviewedAt === 'string' && event.occurredAt === data.reviewedAt
    && Array.isArray(data?.criteria)
    && data.criteria.length === PROPOSAL_HUMAN_RUBRIC.length
    && data.criteria.every((criterion, index) => criterion.criterionId === PROPOSAL_HUMAN_RUBRIC[index].id
      && ['pass', 'needs-attention'].includes(criterion.judgment)
      && typeof criterion.reason === 'string' && criterion.reason.length >= 1 && criterion.reason.length <= 400
      && criterion.evidence?.length > 0
      && criterion.evidence.every((ref) => proposal.citations?.some((citation) => citation.id === ref.sourceId
        && citation.hash === ref.sourceHash)))
    && data.reviewHash === proposalHumanReviewHash(data);
}
