import { encodeStudioRoute } from './shared-interactions.mjs';

const SUPPORTED_EVALUATOR_VERSION = 1;
const SUPPORTED_RUBRIC_VERSION = 1;
const EVALUATION_MEANING = 'structural-checks-only';

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
  if (membershipAccess === 'owner') {
    return { status: 'owner-can-apply', canApply: true, currentBlueprintVersion: latest.version };
  }
  return {
    status: 'owner-required', canApply: false,
    currentBlueprintVersion: latest.version,
    message: 'A workspace owner can apply this proposal as a new immutable proposed version. Other project members can review it here.',
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
