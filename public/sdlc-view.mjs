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

export function n3StageStatusCopy(mapping, execution) {
  const testPath = mapping?.candidatePath ?? 'tests/learning.test.js';
  const sourceHash = mapping?.sourceTestBytesHash;
  if (!execution) {
    return `Original test fails: run the pinned source bytes for ${testPath} (SHA-256 ${sourceHash}) and retain TAP with exit code 1. Unauthorized deletion is rejected: delete that same path in the candidate and require BEHAVIOR_CANDIDATE_ORPHAN_PATH before verifier dispatch. Neither stage has executed yet.`;
  }
  if (execution.status === 'PASS') {
    const source = execution.sourceStage;
    const candidate = execution.candidate;
    const exactPassEvidence = source?.path === testPath && source?.bytesHash === sourceHash
      && source?.exitCode === 1 && typeof source?.tap === 'string' && /# fail 1\b/.test(source.tap)
      && candidate?.deletedPath === testPath && candidate.deletedPathHash === sourceHash
      && candidate?.changes?.length === 1 && candidate.changes[0]?.path === testPath
      && candidate.changes[0]?.change === 'deleted' && execution.run?.errorCode === 'BEHAVIOR_CANDIDATE_ORPHAN_PATH'
      && execution.verifierDispatchCount === 0;
    if (exactPassEvidence) {
      return `Original test fails: pinned source bytes for ${testPath} exited 1 and TAP records one failure. Unauthorized deletion is rejected: OrgWard rejected deletion of that same pinned path before verifier dispatch.`;
    }
    return 'N3 is marked PASS, but the saved receipt does not contain both exact stage proofs; review the receipt before relying on this result.';
  }
  if (execution.status === 'INCONCLUSIVE') {
    return `N3 result INCONCLUSIVE: the pinned source failure and same-path deletion rejection could not both be confirmed. No stage result is claimed; restore the isolated fixture and rerun.`;
  }
  if (execution.status === 'FAIL') {
    return 'N3 result FAIL: the saved stage evidence did not match the expected source-failure and deletion-rejection outcomes. Review the receipt and correct the fixture or guard before rerunning.';
  }
  return `Original test fails: run the pinned source bytes for ${testPath} (SHA-256 ${sourceHash}) and retain TAP with exit code 1. Unauthorized deletion is rejected: delete that same path in the candidate and require BEHAVIOR_CANDIDATE_ORPHAN_PATH before verifier dispatch. Neither stage has executed yet.`;
}

export function productHarnessEligiblePlanGroups(requirement) {
  const plans = (requirement?.processBehaviorTestPlans ?? []).filter((plan) => plan.caseDefinitions?.cases
    ?.some((entry) => entry.type === 'NEGATIVE'
      && ['N2', 'N3'].every((scenarioId) => entry.dataset?.cases?.some((scenario) => scenario.id === scenarioId)
        && entry.expectedOutput?.cases?.some((scenario) => scenario.id === scenarioId))));
  const r1Plans = (requirement?.processBehaviorTestPlans ?? []).filter((plan) => plan.criterionContractVersion === 1
    && plan.caseDefinitions?.cases?.some((entry) => entry.type === 'RECOVERY'
      && entry.dataset?.cases?.some((scenario) => scenario.id === 'R1')
      && entry.expectedOutput?.cases?.some((scenario) => scenario.id === 'R1'))
    && requirement.processRunEvidenceLinks?.some((link) => link.behaviorEvaluation?.planId === plan.id
      && link.behaviorEvaluation?.planHash === plan.planHash && link.behaviorEvaluation?.result === 'TEST_PASS'));
  const r2Plans = (requirement?.processBehaviorTestPlans ?? []).filter((plan) => plan.caseDefinitions?.cases?.some((entry) => entry.type === 'RECOVERY'
    && entry.dataset?.cases?.some((scenario) => scenario.id === 'R2')
    && entry.expectedOutput?.cases?.some((scenario) => scenario.id === 'R2'))
    && requirement.processRunEvidenceLinks?.some((link) => link.behaviorEvaluation?.planId === plan.id
      && link.behaviorEvaluation?.planHash === plan.planHash && link.behaviorEvaluation?.result === 'TEST_PASS'));
  return { plans, r1Plans, r2Plans };
}

export function productHarnessRequestFormVisibility({ owner, plans = [], r1Plans = [], r2Plans = [] } = {}) {
  return { subcaseForms: owner === true && plans.length > 0,
    r1RecoveryForm: owner === true && r1Plans.length > 0,
    r2RecoveryForm: owner === true && r2Plans.length > 0 };
}

export function savedProjectPinSummary(context) {
  if (context?.manifestVersion === 1 && !Object.hasOwn(context, 'savedProjectPin')) {
    return 'Historical context manifest v1 has no structured saved-project pin.';
  }
  const pin = context?.savedProjectPin;
  if (![2, 3, 4].includes(context?.manifestVersion) || !pin) return 'No saved project is pinned in this context manifest.';
  const snapshot = pin.blueprintSnapshotStatus === 'PINNED'
    ? `blueprint snapshot SHA-256 ${pin.blueprintSnapshotHash}`
    : 'blueprint snapshot hash unavailable in this legacy source binding';
  return `Project ${pin.projectId} v${pin.projectVersion} · blueprint ${pin.blueprintId} v${pin.blueprintVersion} · schema v${pin.blueprintSchemaVersion} · object ${pin.sourceObjectId} (${pin.sourceObjectType}) · source SHA-256 ${pin.sourceHash} · binding SHA-256 ${pin.bindingHash} · ${snapshot}`;
}

export function contextManifestPresentation(context) {
  if (!context || typeof context !== 'object') return null;
  const enterprise = context.enterpriseContext ?? {};
  const requirements = context.relevantRequirements;
  return {
    manifest: `Context manifest v${context.manifestVersion ?? 'unknown'} · revision ${context.manifestRevision ?? 'unknown'} · SHA-256 ${context.provenanceManifestHash ?? 'unavailable'}`,
    enterprise: `Enterprise context version ${enterprise.version ?? 'unavailable'} · ${enterprise.sourceLabel ?? 'source label unavailable'} · ${enterprise.sourceKind ?? 'source kind unavailable'}`,
    enterpriseStatus: enterprise.sourceKind === 'synthetic-reference-model'
      ? 'Synthetic reference context only; it is not authoritative evidence about the selected business or saved project.'
      : 'Source provenance is shown as recorded; this display does not assert authority.',
    guardrails: {
      intentRef: context.guardrails?.intentRef ?? 'unavailable',
      constraints: Array.isArray(context.guardrails?.constraints) ? context.guardrails.constraints : [],
      nonGoals: Array.isArray(context.guardrails?.nonGoals) ? context.guardrails.nonGoals : [],
    },
    requirements: requirements ? {
      status: 'PINNED_ACCEPTED',
      summary: `Accepted requirements baseline v${requirements.baselineVersion} · SHA-256 ${requirements.contentHash} · evidence ${requirements.evidenceRef}`,
      entries: Array.isArray(requirements.requirements) ? requirements.requirements : [],
    } : {
      status: 'NOT_YET_ACCEPTED',
      summary: 'No accepted requirements baseline is pinned in this manifest revision. Draft requirements remain separate until owner acceptance.',
      entries: [],
    },
    unknownDependencies: Array.isArray(context.unknownDependencies) ? context.unknownDependencies : [],
    excludedDependencies: Array.isArray(context.excludedDependencies) ? context.excludedDependencies : [],
    savedProjectCoverage: context.savedProjectCoverage && typeof context.savedProjectCoverage === 'object' ? {
      schemaVersion: context.savedProjectCoverage.schemaVersion ?? 1,
      status: context.savedProjectCoverage.status ?? 'UNKNOWN',
      sourcePinHash: context.savedProjectCoverage.sourcePinHash ?? 'unavailable',
      processTraceHash: context.savedProjectCoverage.processTraceHash ?? null,
      sourcePins: context.savedProjectCoverage.sourcePins ?? null,
      candidateUniverse: context.savedProjectCoverage.candidateUniverse ?? null,
      contextRequirements: Array.isArray(context.savedProjectCoverage.contextRequirements) ? context.savedProjectCoverage.contextRequirements : [],
      classifications: Array.isArray(context.savedProjectCoverage.classifications) ? context.savedProjectCoverage.classifications : [],
      classificationHash: context.savedProjectCoverage.classificationHash ?? null,
      represented: Array.isArray(context.savedProjectCoverage.represented) ? context.savedProjectCoverage.represented : [],
      unknownDependencies: Array.isArray(context.savedProjectCoverage.unknownDependencies) ? context.savedProjectCoverage.unknownDependencies : [],
      excludedDependencies: context.savedProjectCoverage.excludedDependencies ?? { status: 'UNKNOWN', reason: 'Unavailable.' },
    } : null,
  };
}

export function processRunEvidencePresentation(link) {
  if (!link?.plan?.taskId || !link?.instance?.id || (!link?.run?.id && link?.runtimeSource?.kind !== 'human-task-completion')) return null;
  const human = link.runtimeSource?.kind === 'human-task-completion';
  return {
    heading: `${human ? 'Human task completion' : link.run.id} · runtime ${link.instance.status ?? link.run?.status} · verification ${link.verificationStatus}`,
    identity: `Task ${link.plan.taskId} · plan ${link.plan.id} r${link.plan.revision} · instance ${link.instance.id}`,
    hashes: `${human ? `Completion event SHA-256 ${link.runtimeSource.completionEventHash}` : `Run aggregate SHA-256 ${link.run.aggregateHash}`} · plan SHA-256 ${link.plan.snapshotHash} · task SHA-256 ${link.plan.taskHash}`,
    outputs: (link.outputEvidence ?? []).map((output) => output.status === 'HUMAN_REPORTED'
      ? `${output.id}: HUMAN_REPORTED · self-reported value ${JSON.stringify(output.value)}${output.recordHash ? ` · record SHA-256 ${output.recordHash}` : ''}${output.reporterPrincipal ? ` · reported by ${output.reporterPrincipal}` : ''}`
      : `${output.id}: UNAVAILABLE${output.recordHash ? ` · record SHA-256 ${output.recordHash}` : ''}`),
    repositoryChecks: (link.repositoryCheckEvidence ?? []).map((receipt) =>
      `${receipt.id} v${receipt.version}: ${receipt.status} · repository ${receipt.repositoryId} · source snapshot ${receipt.sourceSnapshotId}${receipt.sourceCommitOid ? ` · commit ${receipt.sourceCommitOid}` : ''} · command SHA-256 ${receipt.commandHash} · check plan SHA-256 ${receipt.planHash} · source tree SHA-256 ${receipt.sourceTreeDigest} · candidate tree SHA-256 ${receipt.candidateTreeDigest} · candidate evidence SHA-256 ${receipt.candidateEvidenceHash} · output SHA-256 ${receipt.outputHash}`),
    repositoryCheckStatus: link.repositoryCheckEvidenceStatus ?? 'UNKNOWN',
    behaviorEvaluation: link.behaviorEvaluation ? {
      status: `Authorized assertion evaluation · ${link.behaviorEvaluation.status} · result ${link.behaviorEvaluation.result} · risk coverage ${link.behaviorEvaluation.riskCoverage ?? 'UNKNOWN'} · business truth ${link.behaviorEvaluation.businessTruthStatus}; overall verification remains ${link.verificationStatus}.`,
      assertions: (link.behaviorEvaluation.assertions ?? []).map((assertion) =>
        `${assertion.testName}: ${assertion.status}${assertion.reason ? ` · ${assertion.reason}` : ''} · output SHA-256 ${assertion.outputHash ?? 'UNAVAILABLE'}`),
      scenarioMappings: (link.behaviorEvaluation.scenarioMappings ?? []).map((mapping) =>
        `${mapping.type}: mapping ${mapping.status}${mapping.reason ? ` · ${mapping.reason}` : ''} · ${mapping.scope} · case remains ${mapping.caseStatus}`),
    } : null,
    applicability: link.applicability === 'CURRENT'
      ? 'Applies to this exact requirement draft.'
      : 'STALE · REGENERATION_REQUIRED: this immutable evidence remains pinned to its original requirement and criterion revision.',
  };
}

export function processBehaviorTestPlanPresentation(plan) {
  if (!plan?.id || !plan.planHash || !Number.isSafeInteger(plan.criterionContractVersion)) return null;
  const stale = plan.regenerationStatus === 'REGENERATION_REQUIRED';
  const regenerationAction = stale
    ? `Regenerate v${plan.currentCriterionContractVersion ?? 'current'} plan`
    : null;
  return {
    heading: `Pre-run plan ${plan.id} · ${stale ? 'REGENERATION_REQUIRED' : plan.regenerationStatus ?? 'APPLICABILITY_UNKNOWN'}`,
    pins: `Plan SHA-256 ${plan.planHash} · requirement SHA-256 ${plan.requirementHash} · criterion baseline v${plan.criterionContractVersion} SHA-256 ${plan.criterionContractHash} · repository snapshot ${plan.repository?.snapshotId ?? 'unavailable'}`,
    status: stale
      ? `Old plan and results remain immutably bound to criterion baseline v${plan.criterionContractVersion} and shared requirements draft r${plan.draftRevision}. Current baseline v${plan.currentCriterionContractVersion ?? 'unavailable'} and shared draft r${plan.currentDraftRevision ?? 'unavailable'} require a newly authorized plan${plan.regenerationReason ? ` (${plan.regenerationReason})` : ''}.`
      : plan.regenerationStatus === 'CURRENT'
        ? `Current for criterion baseline v${plan.criterionContractVersion} and shared requirements draft r${plan.currentDraftRevision ?? plan.draftRevision}. Authorization is pre-run only; it does not assert business truth.`
        : 'Applicability could not be established; do not treat this plan as current.',
    repositorySnapshotId: plan.repository?.snapshotId ?? null,
    regenerationAction,
    contextPins: plan.evaluationContext ? `Workspace ${plan.evaluationContext.workspace?.projectId ?? 'unavailable'} · branch ${plan.evaluationContext.branch?.branchRef ?? 'unavailable'} @ ${plan.evaluationContext.branch?.commitOid ?? 'unavailable'} · effective time ${plan.evaluationContext.effectiveTime?.value ?? 'unavailable'} (owner asserted from ${plan.evaluationContext.effectiveTime?.sourceRef?.id ?? 'unavailable'})` : null,
    scenarioMappingsStatus: plan.caseDefinitions?.mappingStatus
      ?? (plan.caseDefinitions?.cases?.every((entry) => entry.executionMapping?.status === 'OWNER_PROPOSED_UNVERIFIED')
        ? 'OWNER_PROPOSED_UNVERIFIED' : 'INCOMPLETE'),
    scenarioCases: Array.isArray(plan.caseDefinitions?.cases) ? plan.caseDefinitions.cases.map((entry) => {
      const mapping = entry.executionMapping;
      const hasDatasetAndOracle = Object.hasOwn(entry, 'dataset') && Object.hasOwn(entry, 'expectedOutput');
      const details = mapping?.status === 'OWNER_PROPOSED_UNVERIFIED'
        ? `dataset ${JSON.stringify(entry.dataset)} · expected ${JSON.stringify(entry.expectedOutput)} · assertion ${mapping.assertionId} / ${mapping.testName} · TEST ${mapping.testPath} SHA-256 ${mapping.testFileHash} · mapping ${mapping.status}`
        : hasDatasetAndOracle
          ? `dataset ${JSON.stringify(entry.dataset)} · expected ${JSON.stringify(entry.expectedOutput)} · dataset/oracle captured · execution mapping INCOMPLETE`
          : `dataset/oracle INCOMPLETE · execution mapping INCOMPLETE`;
      return `${entry.type} · ${entry.definition} · source ${entry.sourceRef?.id ?? 'unavailable'} · criterion ${entry.criterionId ?? 'unavailable'} · ${details} · ${entry.status ?? 'UNKNOWN'}`;
    }) : [],
  };
}

export function repositoryCheckObservationPresentation(observation, proposal = null) {
  if (!observation?.id || observation.category !== 'REPOSITORY_CHECK' || !observation.contentHash) return null;
  return {
    heading: `Repository-check observation · ${observation.id}`,
    pins: `Run ${observation.runId} · plan ${observation.planId} r${observation.planRevision} · task ${observation.taskId} · candidate evidence SHA-256 ${observation.candidateEvidenceHash}`,
    outcome: `Execution run ${observation.runOutcome ?? 'UNKNOWN'}${observation.verifierResult
      ? ` · verifier ${observation.verifierResult.id} v${observation.verifierResult.version}: ${observation.verifierResult.status} · output SHA-256 ${observation.verifierResult.outputHash}`
      : ' · verifier result unavailable'}`,
    checks: (observation.checks ?? []).map((entry) => `${entry.id} v${entry.version}: ${entry.status} · command SHA-256 ${entry.commandHash} · output SHA-256 ${entry.outputHash}`),
    status: `Code/check scope only · causality ${observation.causality} · business truth ${observation.businessTruthStatus} · verification ${observation.verificationStatus}`,
    proposal: proposal ? `${proposal.title} · ${proposal.status} · authority required · ${proposal.proposedClaim}` : 'No correction proposal was derived.',
  };
}

export function processEvidenceReviewPresentation(review) {
  if (!review?.id || !review?.linkId || !review?.reviewerPrincipal || !review?.reviewHash
    || review.status !== 'HUMAN_REVIEWED') return null;
  return {
    heading: `HUMAN_REVIEWED · ${review.disposition} · ${review.applicability ?? 'UNKNOWN'} · integrity ${review.integrityStatus ?? 'UNKNOWN'}`,
    identity: `Link ${review.linkId} · reviewer ${review.reviewerPrincipal} · source process ${review.source?.processId ?? 'UNKNOWN'} · blueprint ${review.source?.blueprintId ?? 'UNKNOWN'} v${review.source?.blueprintVersion ?? 'UNKNOWN'} · criteria baseline ${review.criterionContractVersion ?? 'legacy'} SHA-256 ${review.criterionContractHash ?? 'unavailable'} · review SHA-256 ${review.reviewHash}`,
    status: `Runtime verification ${review.verificationStatus ?? 'UNKNOWN'} · truth ${review.truthStatus ?? 'UNKNOWN'} · acceptance ${review.acceptanceStatus ?? 'UNASSESSED'}. This is a human attestation against saved evidence and does not establish external truth.`,
    criteria: (review.criteria ?? []).map((entry) => `${entry.disposition}: ${entry.criterion} · ${entry.note}`),
    scenarios: (review.scenarioCases ?? []).map((entry) => `${entry.type} definition ${entry.disposition} · ${entry.executionReviewStatus ?? 'REVIEW_ONLY'}${entry.executionDecision ? ` · ${entry.executionDecision}` : ''} · ${entry.note}`),
    resolution: review.conflictResolution
      ? `Explicit resolution by ${review.conflictResolution.recordedBy}: ${review.conflictResolution.decision} · ${review.conflictResolution.rationale} · business criteria ${review.conflictResolution.businessCriterionIds.join(', ') || 'none'} · technical criteria ${review.conflictResolution.technicalCriterionIds.join(', ') || 'none'} · failed mandatory criteria ${review.failedMandatoryCriterionIds?.join(', ') || 'none'}`
      : (review.failedMandatoryCriterionIds?.length
        ? `Mandatory failures remain failed: ${review.failedMandatoryCriterionIds.join(', ')}.`
        : null),
  };
}

export function processBehaviorScenarioExecutionPresentation(receipt, { current = false } = {}) {
  if (!receipt?.id || ![1, 2].includes(receipt.schemaVersion) || !receipt.receiptHash
    || !['PASS', 'FAIL', 'INCONCLUSIVE'].includes(receipt.result)
    || receipt.businessTruthStatus !== 'UNVERIFIED' || receipt.runtimeVerificationStatus !== 'NOT_EXECUTED') return null;
  return {
    heading: `${receipt.caseType ?? 'UNKNOWN'} case assertion ${receipt.result} · ${receipt.id} · ${current ? 'CURRENT' : 'HISTORICAL'}`,
    pins: `Case ${receipt.caseId} · plan SHA-256 ${receipt.planHash} · criterion SHA-256 ${receipt.criterionHash ?? 'not recorded in legacy receipt'} · run ${receipt.runId} · candidate tree SHA-256 ${receipt.candidateTreeDigest}`,
    assertion: `${receipt.testPath} SHA-256 ${receipt.testFileHash} · assertion ${receipt.assertionId} (${receipt.testName}) · dataset SHA-256 ${receipt.datasetHash} · oracle SHA-256 ${receipt.oracleHash}`,
    tap: `Node TAP ${receipt.tap?.status ?? 'UNKNOWN'} · tests ${receipt.tap?.tests ?? 'UNKNOWN'} · pass ${receipt.tap?.passed ?? 'UNKNOWN'} · fail ${receipt.tap?.failed ?? 'UNKNOWN'} · TAP output SHA-256 ${receipt.tap?.outputHash ?? 'unavailable'}`,
    status: `One saved assertion against its pinned dataset and oracle. This is not a suite or business PASS. Business truth ${receipt.businessTruthStatus}; runtime verification ${receipt.runtimeVerificationStatus}. ${receipt.statement ?? ''}`,
  };
}

export function intentEvaluationAcceptancePresentation(acceptance) {
  if (!acceptance?.id || acceptance.status !== 'ACCEPTED' || !acceptance.acceptanceHash) return null;
  return {
    heading: `ACCEPTED · ${acceptance.applicability ?? 'UNKNOWN'} · integrity ${acceptance.integrityStatus ?? 'UNKNOWN'}`,
    pins: `Requirement ${acceptance.requirementId} · draft r${acceptance.draftRevision} · source process ${acceptance.source?.processId ?? 'UNKNOWN'} · blueprint ${acceptance.source?.blueprintId ?? 'UNKNOWN'} v${acceptance.source?.blueprintVersion ?? 'UNKNOWN'} · evaluation SHA-256 ${acceptance.evaluationHash} · review SHA-256 ${acceptance.reviewHash} · record SHA-256 ${acceptance.acceptanceHash}`,
    status: `Scoped intent evaluation accepted by ${acceptance.acceptedBy}. Runtime verification remains ${acceptance.verificationStatus}; business truth remains ${acceptance.truthStatus}. ${acceptance.statement}`,
    reason: acceptance.reason,
  };
}

export function canAcceptIntentEvaluation({ authenticated, principal, accountableOwner, baseline = false,
  requirement, draftRevision, link, reviews = [], acceptances = [] }) {
  if (!authenticated || !principal || principal !== accountableOwner || baseline || !requirement || !link
    || link.applicability !== 'CURRENT' || link.behaviorEvaluation?.status !== 'CHECKED_BEHAVIOR'
    || link.behaviorEvaluation?.result !== 'TEST_PASS' || link.behaviorEvaluation?.businessTruthStatus !== 'UNVERIFIED'
    || link.status !== 'UNVERIFIED' || link.verificationStatus !== 'NOT_EXECUTED') return false;
  if (acceptances.some((entry) => entry.status === 'ACCEPTED' && entry.integrityStatus === 'VALID'
    && entry.applicability === 'CURRENT' && entry.requirementId === requirement.id
    && entry.draftRevision === draftRevision)) return false;
  const planId = link.behaviorEvaluation.planId;
  const latest = reviews.filter((review) => review.linkId === link.id && review.behaviorPlanId === planId
    && review.behaviorPlanHash === link.behaviorEvaluation.planHash && review.integrityStatus === 'VALID'
    && review.applicability === 'CURRENT' && review.reviewerPrincipal !== principal)
    .sort((left, right) => Number(left.recordedVersion ?? 0) - Number(right.recordedVersion ?? 0)
      || String(left.reviewedAt ?? '').localeCompare(String(right.reviewedAt ?? ''))
      || String(left.id).localeCompare(String(right.id))).at(-1);
  return Boolean(latest && latest.acceptanceStatus === 'REVIEW_ONLY_NOT_ACCEPTED' && !latest.conflictResolution
    && latest.criteria?.length === (requirement.reviewCriteria ?? []).length
    && latest.criteria.every((entry) => entry.disposition === 'SUPPORTED'));
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
