import { encodeStudioRoute } from './shared-interactions.mjs';

const PROJECT_ID = /^project-[0-9a-f-]{36}$/i;
const BLUEPRINT_ID = /^blueprint-[0-9a-f-]{36}$/i;
const OBJECT_ID = /^[a-z0-9][a-z0-9_-]{0,119}$/i;

export function sourceBindingDesignRoute(changeCase, project) {
  const binding = changeCase?.sourceBinding;
  if (!binding || changeCase.sourceBindingIntegrity?.valid !== true
    || !PROJECT_ID.test(binding.projectId ?? '') || project?.id !== binding.projectId
    || !BLUEPRINT_ID.test(binding.blueprintId ?? '') || !Number.isSafeInteger(binding.blueprintVersion)
    || binding.blueprintVersion < 1 || !OBJECT_ID.test(binding.objectId ?? '')
    || !Array.isArray(project.blueprintVersions)) return null;
  const blueprint = project.blueprintVersions.find((entry) => entry?.id === binding.blueprintId
    && entry.version === binding.blueprintVersion);
  const source = blueprint && Object.values(blueprint.areas ?? {}).flatMap((area) => Array.isArray(area?.items) ? area.items : [])
    .find((item) => item.id === binding.objectId);
  if (!source || source.type !== binding.objectType || source.type !== binding.snapshot?.type
    || source.name !== binding.snapshot?.name || source.detail !== binding.snapshot?.detail) return null;
  return encodeStudioRoute({ projectId: binding.projectId, view: 'map', selectedId: binding.objectId,
    blueprintVersion: binding.blueprintVersion });
}

export function eligibleActorBindings(response, blueprintVersion) {
  return (response.data?.proposals ?? []).filter((entry) => entry.status === 'enabled'
    && entry.eligibilityStatus.includes('eligible') && entry.blueprintVersion === blueprintVersion);
}

export function sentinelAssessmentChoices(project) {
  const blueprint = project?.latestBlueprint;
  if (!blueprint || !Array.isArray(project.enterpriseSentinelAssessments)) return [];
  return project.enterpriseSentinelAssessments.filter((entry) => entry?.source?.blueprintId === blueprint.id
    && entry.source.blueprintVersion === blueprint.version && typeof entry.id === 'string'
    && typeof entry.reportHash === 'string');
}

export function savedProjectPinSummary(context) {
  if (context?.manifestVersion === 1 && !Object.hasOwn(context, 'savedProjectPin')) {
    return 'Historical context manifest v1 has no structured saved-project pin.';
  }
  const pin = context?.savedProjectPin;
  if (context?.manifestVersion !== 2 || !pin) return 'No saved project is pinned in this context manifest.';
  const snapshot = pin.blueprintSnapshotStatus === 'PINNED'
    ? `blueprint snapshot SHA-256 ${pin.blueprintSnapshotHash}`
    : 'blueprint snapshot hash unavailable in this legacy source binding';
  return `Project ${pin.projectId} v${pin.projectVersion} · blueprint ${pin.blueprintId} v${pin.blueprintVersion} · schema v${pin.blueprintSchemaVersion} · object ${pin.sourceObjectId} (${pin.sourceObjectType}) · source SHA-256 ${pin.sourceHash} · binding SHA-256 ${pin.bindingHash} · ${snapshot}`;
}

function clarificationModel(entry, currentRevision) {
  const isCurrent = entry.intentRevision === currentRevision;
  const control = isCurrent && entry.status === 'OPEN' ? 'ANSWER'
    : isCurrent && entry.status === 'ANSWERED' ? 'RECONCILE'
      : 'NONE';
  return {
    id: entry.id,
    status: entry.status,
    question: entry.question,
    rationale: entry.rationale,
    targetField: entry.targetField,
    eligibleRespondent: entry.eligibleRespondent,
    answer: entry.answer?.value ?? null,
    intentRevisionAfter: entry.intentRevisionAfter ?? null,
    isCurrent,
    control,
  };
}

function actionModel(action) {
  if (!action) return null;
  return {
    id: action.id,
    action: action.action,
    destination: action.destination,
    status: action.status,
    owner: action.owner,
    reason: action.reason,
    outcome: action.outcome,
    completionSummary: action.completionSummary,
    attempt: action.attempt,
  };
}

function proofModel(changeCase, proof, attemptLimit) {
  const results = changeCase.proofs.results.filter((entry) => (
    entry.proofRef === proof.id && entry.intentRevision === changeCase.intent.revision
  ));
  const result = results.at(-1) ?? null;
  const actionFor = (resultRef) => changeCase.proofs.actions.find((entry) => entry.resultRef === resultRef) ?? null;
  const action = result ? actionFor(result.id) : null;
  const attempts = changeCase.proofs.loopCounters[proof.id] ?? 0;
  let control = 'RECORD_RESULT';
  if (action?.status === 'READY') control = 'RESUME';
  else if (action?.status === 'IN_PROGRESS') control = 'COMPLETE';
  else if (!action && ['FAIL', 'INDETERMINATE'].includes(result?.status)) control = 'ROUTE';
  if (changeCase.status === 'STOPPED') control = 'NONE';

  return {
    id: proof.id,
    criterion: proof.criterion,
    required: proof.required,
    evaluatorType: proof.evaluatorType,
    intentRevision: proof.intentRevision,
    resultStatus: result?.status ?? 'NOT RUN',
    result: result ? {
      id: result.id,
      status: result.status,
      summary: result.summary,
      observations: [...result.observations],
    } : null,
    action: actionModel(action),
    attempts,
    attemptLimit,
    control,
    routeChoices: attempts >= attemptLimit
      ? [['STOP', 'Stop work']]
      : [['REPAIR', 'Repair implementation'], ['CLARIFY', 'Request clarification'], ['REPLAN', 'Re-plan work'], ['REARCHITECT', 'Re-architect design'], ['STOP', 'Stop work']],
    history: results.slice(0, -1).reverse().map((entry) => ({
      id: entry.id,
      status: entry.status,
      summary: entry.summary,
      recordedAt: entry.recordedAt,
      action: actionModel(actionFor(entry.id)),
    })),
  };
}

function checkpointModel(changeCase, stages) {
  const last = changeCase.gateHistory.at(-1);
  if (changeCase.status === 'PASSED') {
    return { title: 'Reference loop complete', body: 'The full lineage is saved. Learning proposed a follow-up but did not silently rewrite enterprise truth.', control: 'NONE' };
  }
  if (changeCase.status === 'STOPPED') {
    const stopped = changeCase.proofs.actions.findLast((entry) => entry.action === 'STOP');
    return { title: 'Work stopped by the accountable owner', body: stopped?.reason ?? 'The case has a terminal stop decision.', control: 'NONE' };
  }
  if (changeCase.status === 'BLOCKED' || changeCase.status === 'FAILED') {
    return { title: `${last?.gate ?? 'Gate'} blocked safely`, body: last?.findings?.[0]?.message ?? 'A blocking invariant failed.', remediation: last?.findings?.[0]?.remediation ?? 'Repair the evidence or design before retrying.', control: 'NONE' };
  }
  if (changeCase.status === 'NEEDS_HUMAN' && changeCase.currentStage === 'S9') {
    return { title: 'Independent release approval', body: 'A HIGH-risk production-like release cannot be self-approved by the implementation principal.', control: 'APPROVE_RELEASE' };
  }
  if (changeCase.status === 'NEEDS_HUMAN' && changeCase.currentStage === 'S10') {
    return { title: 'Outcome observation required', body: 'Record a synthetic observation. The default proves technical success can coexist with a failed business outcome.', control: 'RECORD_OBSERVATION' };
  }
  const stage = stages[changeCase.currentStageIndex];
  return {
    title: stage ? `${stage.id} · ${stage.label}` : 'Ready',
    body: stage ? `Next: execute the stage and evaluate ${stage.gate} — ${stage.gateLabel}.` : 'No stage remains.',
    control: 'ADVANCE',
  };
}

export function createSourceSelectionGuard() {
  let revision = 0;
  return {
    begin(projectId) { return { projectId, revision: ++revision }; },
    isCurrent(ticket, selectedProjectId) { return ticket?.revision === revision && ticket.projectId === selectedProjectId; },
  };
}

export function caseUiModel(changeCase, meta = {}, currentProject = null) {
  const attemptLimit = meta.proofActionAttemptLimit ?? 2;
  const revision = changeCase.intent.revision;
  const sourceBinding = changeCase.sourceBinding ? (() => {
    const blueprint = currentProject?.latestBlueprint ?? currentProject?.blueprintVersions?.at(-1);
    const source = blueprint && Object.values(blueprint.areas ?? {}).flatMap((area) => area.items ?? [])
      .find((item) => item.id === changeCase.sourceBinding.objectId);
    const pinned = changeCase.sourceBinding.snapshot;
    const hasBlueprintDetail = Boolean(currentProject?.latestBlueprint || Array.isArray(currentProject?.blueprintVersions));
    const isCurrent = currentProject?.id === changeCase.sourceBinding.projectId && hasBlueprintDetail
        && blueprint?.id === changeCase.sourceBinding.blueprintId
        && blueprint?.version === changeCase.sourceBinding.blueprintVersion
        && source?.type === pinned?.type && source?.name === pinned?.name && source?.detail === pinned?.detail
      ? true
      : hasBlueprintDetail && currentProject?.id === changeCase.sourceBinding.projectId ? false : null;
    const state = !changeCase.sourceBindingIntegrity?.valid ? 'INTEGRITY_FAILED'
      : isCurrent === false ? 'PINNED_OLDER_VERSION'
        : isCurrent === true ? 'CURRENT' : 'PROJECT_UNAVAILABLE';
    const staleArtifacts = [];
    if (state === 'PINNED_OLDER_VERSION') {
      const requirements = changeCase.artifacts?.requirements?.acceptedBaseline;
      if (requirements?.sourceHash === changeCase.sourceBinding.sourceHash) {
        staleArtifacts.push({ type: 'Accepted requirements baseline', referenceLabel: 'SHA-256', reference: requirements.contentHash });
      }
      const architecture = changeCase.artifacts?.architecture?.acceptedBaseline;
      if (architecture?.sourceHash === changeCase.sourceBinding.sourceHash) {
        staleArtifacts.push({ type: 'Accepted architecture baseline', referenceLabel: 'SHA-256', reference: architecture.draftHash });
      }
      const plan = changeCase.artifacts?.plan;
      if (plan?.binding?.sourceHash === changeCase.sourceBinding.sourceHash) {
        staleArtifacts.push({ type: 'Delivery plan', referenceLabel: 'SHA-256', reference: plan.binding.planHash ?? plan.binding.sourceHash });
      }
      for (const evaluation of changeCase.evaluations ?? []) {
        if (evaluation?.id) staleArtifacts.push({ type: 'Evaluation', referenceLabel: 'ID', reference: evaluation.id });
      }
      for (const approval of changeCase.approvals ?? []) {
        if (approval?.id) staleArtifacts.push({ type: 'Approval', referenceLabel: 'ID', reference: approval.id });
      }
    }
    const invalidation = state === 'PINNED_OLDER_VERSION' ? {
      status: staleArtifacts.length ? 'DEPENDENCIES_STALE' : 'SOURCE_STALE',
      reason: 'The saved project advanced beyond this case’s pinned blueprint. Dependent accepted artifacts remain historical evidence and need review in a new case.',
      staleArtifacts,
    } : null;
    return { ...changeCase.sourceBinding, state, invalidation };
  })() : null;
  return {
    sourceBinding,
    queue: {
      nextAction: { ...changeCase.workspace.nextAllowedAction },
      questions: changeCase.workspace.questions.map((entry) => ({ ...entry })),
      proofGaps: changeCase.workspace.proofGaps.map((entry) => ({ ...entry })),
      failedResults: changeCase.workspace.failedResults.map((entry) => ({ ...entry })),
    },
    clarifications: changeCase.clarifications.map((entry) => clarificationModel(entry, revision)),
    proofs: changeCase.proofs.obligations
      .filter((entry) => entry.intentRevision === revision)
      .map((entry) => proofModel(changeCase, entry, attemptLimit)),
    checkpoint: checkpointModel(changeCase, meta.stages ?? []),
  };
}
