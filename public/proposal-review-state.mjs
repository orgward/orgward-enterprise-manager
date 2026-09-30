import { encodeStudioRoute } from './shared-interactions.mjs';

const SUPPORTED_EVALUATOR_VERSION = 1;
const SUPPORTED_RUBRIC_VERSION = 1;
const EVALUATION_MEANING = 'structural-checks-only';
export const HUMAN_PROPOSAL_RUBRIC = Object.freeze([
  { id: 'relevance-to-task', label: 'Relevant to the assigned task' },
  { id: 'source-support', label: 'Factually accurate and supported by pinned cited sources' },
  { id: 'actionability', label: 'Concrete and actionable' },
  { id: 'scope-and-risk', label: 'Within approved scope and risk' },
]);

function isValidHumanReview(event, proposal) {
  return event?.data?.rubricVersion === SUPPORTED_RUBRIC_VERSION
    && event.data?.blueprintId === proposal?.blueprintId
    && event.data?.blueprintVersion === proposal?.blueprintVersion
    && event.data?.sourceEnvelopeHash === proposal?.sourceEnvelopeHash
    && typeof event.data?.reviewHash === 'string'
    && Array.isArray(event.data?.criteria)
    && event.data.criteria.length === HUMAN_PROPOSAL_RUBRIC.length
    && event.data.criteria.every((criterion, index) => criterion.criterionId === HUMAN_PROPOSAL_RUBRIC[index].id
      && ['pass', 'needs-attention'].includes(criterion.judgment)
      && typeof criterion.reason === 'string' && criterion.reason.length >= 1 && criterion.reason.length <= 400
      && Array.isArray(criterion.evidence) && criterion.evidence.length > 0
      && criterion.evidence.every((ref) => proposal.citations?.some((citation) => citation.id === ref.sourceId
        && citation.hash === ref.sourceHash)));
}

function latestHumanReview(proposal, project) {
  const event = (project?.events ?? []).filter((candidate) => candidate?.type === 'BlueprintProposalReviewed'
    && candidate.data?.runId === proposal?.runId
    && candidate.data?.proposalHash === proposal?.proposalHash).at(-1) ?? null;
  if (!event || !isValidHumanReview(event, proposal)) return null;
  const passed = event.data.criteria.every((criterion) => criterion.judgment === 'pass');
  return {
    eventId: event.eventId,
    reviewHash: event.data.reviewHash,
    reviewer: event.data.reviewedBy,
    reviewedAt: event.data.reviewedAt,
    criteria: event.data.criteria,
    status: passed ? 'passed' : 'needs-attention',
  };
}

function proposalEvaluationFailure(proposal) {
  const evaluation = proposal?.evaluation;
  if (!evaluation || evaluation.evaluatorVersion !== SUPPORTED_EVALUATOR_VERSION
    || evaluation.rubricVersion !== SUPPORTED_RUBRIC_VERSION || evaluation.meaning !== EVALUATION_MEANING) {
    return 'This proposal has no supported structural evaluation and remains review-only.';
  }
  if (evaluation.status === 'passed') return null;
  const failures = Array.isArray(evaluation.checks)
    ? evaluation.checks.filter((check) => check?.status === 'blocked' && typeof check.message === 'string') : [];
  return failures.length
    ? `Structural checks blocked this proposal: ${failures.map((check) => check.message).join(' ')}`
    : 'Structural checks blocked this proposal; its evaluation record is incomplete.';
}

export function deriveBlueprintProposalReviewState({ proposal, project, membershipAccess = null, appliedEvent = null }) {
  if (!project) {
    return {
      status: 'project-unavailable', canApply: false,
      message: 'The current project version could not be loaded. This proposal remains review-only.',
    };
  }
  if (appliedEvent) {
    return {
      status: 'applied', canApply: false,
      review: latestHumanReview(proposal, project),
      blueprintVersion: appliedEvent.data?.appliedBlueprintVersion ?? null,
      objectId: typeof appliedEvent.data?.objectId === 'string' ? appliedEvent.data.objectId : null,
      eventId: appliedEvent.eventId ?? null,
      message: 'Applied to a new proposed blueprint version.',
    };
  }
  const latest = project.latestBlueprint;
  if (!proposal || latest?.id !== proposal.blueprintId || latest?.version !== proposal.blueprintVersion) {
    return {
      status: 'stale', canApply: false,
      currentBlueprintVersion: latest?.version ?? null,
      message: 'Stale proposal: the current blueprint changed after this proposal was generated. Review a proposal from the current version.',
    };
  }
  const evaluationFailure = proposalEvaluationFailure(proposal);
  if (evaluationFailure) {
    return {
      status: 'evaluation-blocked', canApply: false,
      currentBlueprintVersion: latest.version,
      message: evaluationFailure,
    };
  }
  const review = latestHumanReview(proposal, project);
  const reviewPassed = review?.status === 'passed';
  if (membershipAccess === 'owner') {
    return {
      status: reviewPassed ? 'owner-can-apply' : review ? 'review-needs-attention' : 'review-required',
      canRecordReview: true, canApply: reviewPassed, review, currentBlueprintVersion: latest.version,
      ...(reviewPassed ? {} : { message: review
        ? 'This review marked at least one item as needing attention. Record a new all-pass review before applying.'
        : 'Complete and save the owner rubric review before applying this proposal.' }),
    };
  }
  return {
    status: 'owner-required', canApply: false,
    canRecordReview: false, review,
    currentBlueprintVersion: latest.version,
    message: review
      ? `Owner review recorded: ${review.status}. Only a workspace owner can record a new review or apply this proposal.`
      : 'A workspace owner must record the rubric review and apply this proposal. Other project members can review it here.',
  };
}

export function proposalApplyFailureDisposition(error) {
  const status = Number(error?.status);
  return Number.isInteger(status) && status >= 400 && status < 500 && status !== 408 && status !== 429
    ? 'reconcile' : 'retry';
}

export function proposalDesignLink(project, application) {
  if (!project?.id) return null;
  const objectId = application?.status === 'applied' && typeof application.objectId === 'string'
    && Array.isArray(project.graph?.nodes) && project.graph.nodes.some((node) => node?.id === application.objectId)
    ? application.objectId : null;
  const href = encodeStudioRoute({
    projectId: project.id,
    ...(objectId ? { view: 'map', selectedId: objectId } : {}),
  });
  if (href === '/') return null;
  const selectedObject = Boolean(objectId && href.includes(`selected=${encodeURIComponent(objectId)}`));
  const linksToAppliedVersion = selectedObject
    && Number.isSafeInteger(application?.blueprintVersion)
    && application.blueprintVersion === project.latestBlueprint?.version;
  return {
    href,
    label: linksToAppliedVersion ? 'Open updated design' : 'Open current design',
  };
}
