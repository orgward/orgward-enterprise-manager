import { digest } from './contracts.mjs';

// Updated only with a versioned fixture template; the runner independently hashes its bytes.
export const T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH = '7a19386c258e72dca6316ae0245e1399ee661fdd466109154f8be983517b9eb1';
export const T91_N3_PRODUCT_FIXTURE_TEMPLATE_HASH = '7dcb70f53d2f0bff4d955a51d007042f8360d82fc00a2d58d91402011dc49f88';

export function t91ProductHarnessDispatchFailureObservation({ subcaseId, error, reservationHash }) {
  const invocationId = typeof error?.fixtureInvocationId === 'string' ? error.fixtureInvocationId : null;
  const registeredTemplateHash = subcaseId === 'N3'
    ? T91_N3_PRODUCT_FIXTURE_TEMPLATE_HASH : T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH;
  const suppliedTemplateHash = typeof error?.fixtureTemplateHash === 'string' ? error.fixtureTemplateHash : null;
  return { terminal: false,
    errorCode: typeof error?.code === 'string' ? error.code : 'FIXTURE_DISPATCH_FAILED',
    invocationId,
    fixtureTemplateHash: invocationId
      ? (suppliedTemplateHash ?? registeredTemplateHash) : null,
    reservationHash };
}

export function isValidT91ProductHarnessInvocationPair(invocationId, fixtureTemplateHash) {
  return invocationId === null
    ? fixtureTemplateHash === null
    : typeof invocationId === 'string' && typeof fixtureTemplateHash === 'string';
}

export function isValidT91N3ReceiptObservedPins(receipt, mapping) {
  if (!receipt || !mapping || !isValidT91ProductHarnessInvocationPair(receipt.fixtureInvocationId, receipt.fixtureTemplateHash)) return false;
  if (receipt.fixtureInvocationId !== null && receipt.fixtureTemplateHash !== mapping.fixtureTemplateHash) return false;
  if (receipt.fixtureCaseId !== null) return /^change-case-[0-9a-f-]{36}$/i.test(receipt.fixtureCaseId);
  return receipt.status === 'INCONCLUSIVE' && receipt.fixturePlan === null
    && receipt.sourceStage === null && receipt.candidate === null && receipt.run === null;
}

export function t91N2AuthorizationInvocationFixtureHash({ mapping, requestHash, fixtureTemplateHash, invocationId }) {
  return digest({ baseFixtureHash: t91N2AuthorizationFixtureHash({ mapping, requestHash }),
    fixtureTemplateHash, invocationId });
}

export const T91_N2_AUTHORIZATION_HARNESS = Object.freeze({
  id: 't91-n2-authorization',
  version: 1,
  subcaseId: 'N2.AUTHORIZATION',
  assertionId: 'rejects-empty-assertion-selection',
  scope: 'ORGWARD_PRODUCT_PATH_FIXTURE',
  contract: Object.freeze({
    method: 'FIXED_SEQUENCE',
    route: 'criterion-v1-to-v2-stale-denial-and-new-plan-link',
    method: 'POST',
    route: '/api/sdlc/cases/:fixtureCaseId/process-behavior-test-plans',
    request: 'otherwise-valid saved plan request with assertions: []',
    expectedStatus: 400,
    expectedEffects: Object.freeze({ caseVersionChanged: false, eventAdded: false, planAdded: false }),
  }),
});

// This is a separate product-path case. It intentionally binds one named
// assertion from the saved customer plan and proves that a passing TAP check
// which omits that name cannot be linked as evidence.
export const T91_N2_MISSING_ASSERTION_HARNESS = Object.freeze({
  id: 't91-n2-missing-assertion',
  version: 1,
  subcaseId: 'N2.MISSING_ASSERTION',
  assertionId: 'rejects-missing-required-named-assertion',
  scope: 'ORGWARD_PRODUCT_PATH_FIXTURE',
  contract: Object.freeze({
    method: 'POST',
    route: '/api/sdlc/cases/:fixtureCaseId/process-run-evidence',
    request: 'link the real passing repository-check run whose TAP omits the exact mandatory plan assertion',
    expectedStatus: 409,
    expectedErrorCode: 'BEHAVIOR_CANDIDATE_REJECTED',
    expectedAssertionStatus: 'UNKNOWN',
    expectedAssertionReason: 'ASSERTION_RESULT_NOT_FOUND',
    expectedEffects: Object.freeze({ caseVersionChanged: false, eventAdded: false, evidenceLinkAdded: false,
      evaluationAdded: false, reviewAdded: false, auditAdded: false, outboxAdded: false }),
  }),
});

// N1 exercises the real candidate admission guard with one fixed, unselected
// path added inside the isolated fixture. It has its own mapping and receipt.
export const T91_N1_ORPHAN_PATH_HARNESS = Object.freeze({
  id: 't91-n1-orphan-path',
  version: 1,
  subcaseId: 'N1',
  assertionId: 'rejects-unmapped-candidate-path-before-verifier',
  scope: 'ORGWARD_PRODUCT_PATH_FIXTURE',
  candidatePath: 'src/unmapped.mjs',
  contract: Object.freeze({
    mutation: 'ADD_UNMAPPED_PATH',
    expectedStatus: 'FAILED',
    expectedErrorCode: 'BEHAVIOR_CANDIDATE_ORPHAN_PATH',
    verifierDispatched: false,
  }),
});

// The synthetic source bytes are pinned independently from the repository tree:
// the fixture must run these exact bytes and retain their failing TAP before the
// candidate deletion stage is measured.
export const T91_N3_DELETED_FAILING_TEST_HARNESS = Object.freeze({
  id: 't91-n3-deleted-failing-test',
  version: 1,
  subcaseId: 'N3',
  assertionId: 'rejects-deletion-of-known-failing-test',
  scope: 'ORGWARD_PRODUCT_PATH_FIXTURE',
  sourcePath: 'tests/learning.test.js',
  sourceBytesHash: '1161115b3960df1b636a0f837f1adcbba444a6af768928cf6fb9906d50c83d1f',
  sourceExpectedExitCode: 1,
  contract: Object.freeze({
    mutation: 'DELETE_UNAUTHORIZED_TEST',
    method: 'POST',
    route: '/api/execution/runs/:runId/execute',
    expectedStatus: 'FAILED',
    expectedErrorCode: 'BEHAVIOR_CANDIDATE_ORPHAN_PATH',
    verifierDispatched: false,
  }),
});

export const T91_R1_CRITERION_RECOVERY_HARNESS = Object.freeze({
  id: 't91-r1-criterion-recovery',
  version: 1,
  subcaseId: 'R1',
  assertionId: 'retains-v1-history-and-rebinds-v2-evidence',
  scope: 'ORGWARD_PRODUCT_PATH_FIXTURE',
  contract: Object.freeze({
    staleExecutionStatus: 409,
    staleExecutionError: 'BEHAVIOR_TEST_PLAN_STALE',
    oldPlanStatus: 'REGENERATION_REQUIRED',
    oldLinkStatus: 'STALE',
    newPlanCriterionVersion: 2,
    oldPlanHashPreserved: true,
    newRunDistinct: true,
  }),
});

export const T91_R2_SHARED_DRAFT_RECOVERY_HARNESS = Object.freeze({
  id: 't91-r2-shared-draft-recovery',
  version: 1,
  subcaseId: 'R2',
  assertionId: 'preserves-selected-requirement-and-rebinds-after-shared-draft-edit',
  scope: 'ORGWARD_PRODUCT_PATH_FIXTURE',
  contract: Object.freeze({
    oldPlanStatus: 'REGENERATION_REQUIRED',
    regenerationReason: 'SHARED_REQUIREMENTS_DRAFT_CHANGED',
    staleExecutionStatus: 409,
    staleExecutionError: 'BEHAVIOR_TEST_PLAN_STALE',
    selectedRequirementHashPreserved: true,
    newPlanAppended: true,
    newRunDistinct: true,
  }),
});

export function isSupportedT91R1RecoveryDefinition({ mapping, plan }) {
  const definition = plan?.caseDefinitions?.cases?.find((entry) => entry.type === 'RECOVERY');
  const dataset = definition?.dataset?.cases?.find((entry) => entry.id === 'R1');
  const oracle = definition?.expectedOutput?.cases?.find((entry) => entry.id === 'R1');
  return Boolean(definition && dataset && oracle
    && digest(definition) === mapping?.parentDefinitionHash
    && digest(dataset) === mapping?.datasetHash && digest(oracle) === mapping?.oracleHash
    && dataset.fromCriterionVersion === 1 && dataset.toCriterionVersion === 2 && dataset.retainHistory === true
    && oracle.oldPlanStatus === 'REGENERATION_REQUIRED' && oracle.oldLinkStatus === 'STALE'
    && oracle.staleExecutionError === 'BEHAVIOR_TEST_PLAN_STALE'
    && oracle.newPlanBindsVersion === 2 && oracle.oldPlanHashPreserved === true && oracle.newRunDistinct === true);
}

export function buildT91R1RecoveryMapping({ changeCase, requirement, plan }) {
  const definition = plan?.caseDefinitions?.cases?.find((entry) => entry.type === 'RECOVERY');
  const input = definition?.dataset?.cases?.find((entry) => entry.id === 'R1');
  const oracle = definition?.expectedOutput?.cases?.find((entry) => entry.id === 'R1');
  const contract = requirement?.criterionContractHistory?.find((entry) => entry.version === plan?.criterionContractVersion
    && entry.contentHash === plan?.criterionContractHash)
    ?? (requirement?.criterionContract?.version === plan?.criterionContractVersion
      && requirement?.criterionContract?.contentHash === plan?.criterionContractHash ? requirement.criterionContract : null);
  const criterion = contract?.criteria?.find((entry) => entry.id === definition?.criterionId);
  const oldLink = (requirement?.processRunEvidenceLinks ?? []).find((entry) => entry.behaviorEvaluation?.planId === plan?.id
    && entry.behaviorEvaluation?.planHash === plan?.planHash && entry.behaviorEvaluation?.result === 'TEST_PASS');
  const harness = T91_R1_CRITERION_RECOVERY_HARNESS;
  if (!changeCase?.tenantId || !changeCase?.projectId || !changeCase?.id || !requirement?.id || !plan?.planHash
    || plan.criterionContractVersion !== 1 || !plan.repository?.source?.snapshotId
    || !/^[a-f0-9]{64}$/.test(plan.repository?.treeDigest ?? '') || !definition || !input || !oracle
    || !criterion || !definition.sourceRef?.snapshotHash || !oldLink?.linkHash || !oldLink.run?.id
    || !isSupportedT91R1RecoveryDefinition({ mapping: { parentDefinitionHash: digest(definition),
      datasetHash: digest(input), oracleHash: digest(oracle) }, plan })) return null;
  const core = { schemaVersion: 1, tenantId: changeCase.tenantId, projectId: changeCase.projectId,
    caseId: changeCase.id, requirementId: requirement.id, planId: plan.id, planHash: plan.planHash,
    repositorySnapshotId: plan.repository.source.snapshotId, repositoryTreeDigest: plan.repository.treeDigest,
    sourceRef: structuredClone(definition.sourceRef), criterionId: criterion.id, criterionHash: digest(criterion),
    criterionContractVersion: contract.version, criterionContractHash: contract.contentHash,
    parentDefinitionHash: digest(definition), datasetHash: digest(input), oracleHash: digest(oracle),
    oldPlanId: plan.id, oldPlanHash: plan.planHash, oldLinkId: oldLink.id, oldLinkHash: oldLink.linkHash,
    oldRunId: oldLink.run.id, oldRunHash: digest(oldLink.run), subcaseId: harness.subcaseId,
    harnessId: harness.id, harnessVersion: harness.version, harnessHash: digest(harness),
    assertionId: harness.assertionId, assertionHash: digest({ id: harness.assertionId, contract: harness.contract }),
    fixtureTemplateHash: T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH, scope: harness.scope };
  return { ...core, mappingHash: digest(core) };
}

export function t91R1RecoveryFixtureHash({ mapping, requestHash, fixtureTemplateHash, invocationId }) {
  return digest({ fixtureId: 't91-r1-v1-v2-recovery-create-app-postgres-v1', mappingHash: mapping?.mappingHash,
    oldPlanHash: mapping?.oldPlanHash, oldLinkHash: mapping?.oldLinkHash,
    harnessHash: mapping?.harnessHash, requestHash, fixtureTemplateHash, invocationId });
}

export function classifyT91R1RecoveryObservation({ observation, mapping, requestHash,
  fixtureTemplateHash, invocationId, reservationHash }) {
  const old = observation?.old;
  const stale = observation?.staleAttempt;
  const fresh = observation?.fresh;
  const validPins = observation?.terminal === true && observation.fixtureTemplateHash === fixtureTemplateHash
    && typeof invocationId === 'string' && observation.invocationId === invocationId
    && /^change-case-[0-9a-f-]{36}$/i.test(observation.fixtureCaseId ?? '')
    && observation.reservationHash === reservationHash
    && observation.fixtureHash === t91R1RecoveryFixtureHash({ mapping, requestHash, fixtureTemplateHash, invocationId });
  const complete = validPins
    && old?.sourcePlanId === mapping?.oldPlanId && old.sourcePlanHash === mapping?.oldPlanHash
    && old.sourceLinkId === mapping?.oldLinkId && old.sourceLinkHash === mapping?.oldLinkHash
    && old.sourceRunId === mapping?.oldRunId
    && old.fixturePlanId && old.fixturePlanHash && old.fixtureCriterionContractVersion === 1
    && old.fixtureLinkId && old.fixtureLinkHash && old.fixtureRunId
    && typeof old.planStatusAfterRevision === 'string' && typeof old.linkStatusAfterRevision === 'string'
    && /^[a-f0-9]{64}$/.test(old.oldPlanHashAfterRevision ?? '')
    && Number.isSafeInteger(stale?.httpStatus) && (stale.errorCode === null || typeof stale.errorCode === 'string')
    && stale.before && stale.after && digest(stale.before) === digest(stale.after)
    && Number.isSafeInteger(stale.before.caseVersion) && Number.isSafeInteger(stale.before.eventCount)
    && Number.isSafeInteger(stale.before.runCount) && Number.isSafeInteger(stale.before.auditCount)
    && Number.isSafeInteger(stale.before.outboxCount)
    && fresh?.planId && fresh.planHash && fresh.planId !== old.fixturePlanId
    && Number.isSafeInteger(fresh.criterionContractVersion) && fresh.runId && fresh.runId !== old.fixtureRunId
    && typeof fresh.runStatus === 'string' && /^[a-f0-9]{64}$/.test(fresh.checkOutputHash ?? '')
    && fresh.linkId && fresh.linkHash && fresh.linkPlanId === fresh.planId
    && fresh.linkPlanHash === fresh.planHash && fresh.linkRunId === fresh.runId
    && fresh.oldPlanHashStillPresent === old.oldPlanHashAfterRevision;
  if (!complete) return { status: 'INCONCLUSIVE', expectedFixtureHash: null, noMutationVerified: false };
  const contractMatches = old.planStatusAfterRevision === 'REGENERATION_REQUIRED' && old.linkStatusAfterRevision === 'STALE'
    && old.oldPlanHashAfterRevision === old.fixturePlanHash
    && stale.httpStatus === 409 && stale.errorCode === 'BEHAVIOR_TEST_PLAN_STALE'
    && fresh.criterionContractVersion === 2 && fresh.runStatus === 'SUCCEEDED'
    && digest(stale.before) === digest(stale.after);
  const status = contractMatches ? 'PASS' : 'FAIL';
  return { status, expectedFixtureHash: observation.fixtureHash, noMutationVerified: status === 'PASS',
    staleBeforeHash: digest(stale.before), staleAfterHash: digest(stale.after),
    oldPlanHash: old.sourcePlanHash, oldLinkHash: old.sourceLinkHash, newPlanHash: fresh.planHash,
    newRunId: fresh.runId, newLinkHash: fresh.linkHash };
}

export function t91R1RecoveryReceiptStatement({ status }) {
  if (status === 'PASS') return 'PASS — v1 evidence remained pinned and stale, the old plan was denied without mutation, and independent v2 evidence was linked to a distinct run. This is R1 recovery-path evidence only; business truth remains unverified.';
  if (status === 'FAIL') return 'FAIL — the observed v1-to-v2 recovery path contradicted its pinned stale-denial or history-retention contract. Review the receipt before another attempt; no pass is claimed.';
  return 'INCONCLUSIVE — the v1-to-v2 recovery path could not be fully confirmed from the isolated fixture. No stale-denial or recovery pass is claimed; restore fixture readiness and rerun.';
}

export function isSupportedT91R2RecoveryDefinition({ mapping, plan }) {
  const definition = plan?.caseDefinitions?.cases?.find((entry) => entry.type === 'RECOVERY');
  const dataset = definition?.dataset?.cases?.find((entry) => entry.id === 'R2');
  const oracle = definition?.expectedOutput?.cases?.find((entry) => entry.id === 'R2');
  return Boolean(definition && dataset && oracle && digest(definition) === mapping?.parentDefinitionHash
    && digest(dataset) === mapping?.datasetHash && digest(oracle) === mapping?.oracleHash
    && dataset.editTarget === 'OTHER_REQUIREMENT' && dataset.change === 'RATIONALE'
    && dataset.selectedRequirementUnchanged === true
    && oracle.oldPlanStatus === 'REGENERATION_REQUIRED'
    && oracle.reason === 'SHARED_REQUIREMENTS_DRAFT_CHANGED'
    && oracle.staleExecutionError === 'BEHAVIOR_TEST_PLAN_STALE'
    && oracle.selectedRequirementHashPreserved === true && oracle.newPlanAppended === true);
}

export function buildT91R2RecoveryMapping({ changeCase, requirement, plan,
  selectedRequirementSnapshot = requirement, otherRequirementSnapshot = null }) {
  const definition = plan?.caseDefinitions?.cases?.find((entry) => entry.type === 'RECOVERY');
  const dataset = definition?.dataset?.cases?.find((entry) => entry.id === 'R2');
  const oracle = definition?.expectedOutput?.cases?.find((entry) => entry.id === 'R2');
  const linked = (requirement?.processRunEvidenceLinks ?? []).find((entry) => entry.behaviorEvaluation?.planId === plan?.id
    && entry.behaviorEvaluation?.planHash === plan?.planHash && entry.behaviorEvaluation?.result === 'TEST_PASS');
  const otherRequirement = otherRequirementSnapshot
    ?? changeCase?.artifacts?.requirements?.requirements?.find((entry) => entry.id !== requirement?.id);
  const assertion = plan?.assertions?.find((entry) => entry.criterionId === definition?.criterionId);
  const harness = T91_R2_SHARED_DRAFT_RECOVERY_HARNESS;
  if (!changeCase?.tenantId || !changeCase?.projectId || !changeCase?.id || !requirement?.id || !plan?.planHash
    || !plan.repository?.source?.snapshotId || !/^[a-f0-9]{64}$/.test(plan.repository?.treeDigest ?? '')
    || !definition || !dataset || !oracle || !selectedRequirementSnapshot || !otherRequirement
    || selectedRequirementSnapshot.id !== requirement.id || otherRequirement.id === requirement.id
    || !linked?.linkHash || !linked.run?.id
    || !assertion?.criterionHash
    || !definition.sourceRef?.snapshotHash
    || !isSupportedT91R2RecoveryDefinition({ mapping: { parentDefinitionHash: digest(definition),
      datasetHash: digest(dataset), oracleHash: digest(oracle) }, plan })) return null;
  const core = { schemaVersion: 1, tenantId: changeCase.tenantId, projectId: changeCase.projectId,
    caseId: changeCase.id, requirementId: requirement.id, planId: plan.id, planHash: plan.planHash,
    repositorySnapshotId: plan.repository.source.snapshotId, repositoryTreeDigest: plan.repository.treeDigest,
    sourceRef: structuredClone(definition.sourceRef), criterionId: definition.criterionId,
    criterionHash: assertion.criterionHash,
    criterionContractVersion: plan.criterionContractVersion, criterionContractHash: plan.criterionContractHash,
    parentDefinitionHash: digest(definition), datasetHash: digest(dataset), oracleHash: digest(oracle),
    oldPlanId: plan.id, oldPlanHash: plan.planHash, oldLinkId: linked.id, oldLinkHash: linked.linkHash,
    oldRunId: linked.run.id, oldRunHash: digest(linked.run), draftRevision: plan.draftRevision,
    selectedRequirementSnapshot: structuredClone(selectedRequirementSnapshot),
    selectedRequirementHash: digest(selectedRequirementSnapshot),
    selectedRequirementSnapshotHash: digest(selectedRequirementSnapshot),
    otherRequirementSnapshot: structuredClone(otherRequirement),
    otherRequirementSnapshotHash: digest(otherRequirement),
    otherRequirementId: otherRequirement.id, otherRequirementHash: digest(otherRequirement),
    subcaseId: harness.subcaseId, harnessId: harness.id, harnessVersion: harness.version,
    harnessHash: digest(harness), assertionId: harness.assertionId,
    assertionHash: digest({ id: harness.assertionId, contract: harness.contract }),
    fixtureTemplateHash: T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH, scope: harness.scope };
  return { ...core, mappingHash: digest(core) };
}

export function t91R2RecoveryFixtureHash({ mapping, requestHash, fixtureTemplateHash, invocationId }) {
  return digest({ fixtureId: 't91-r2-shared-draft-recovery-create-app-postgres-v1',
    mappingHash: mapping?.mappingHash, oldPlanHash: mapping?.oldPlanHash,
    oldLinkHash: mapping?.oldLinkHash, selectedRequirementHash: mapping?.selectedRequirementHash,
    otherRequirementId: mapping?.otherRequirementId, otherRequirementHash: mapping?.otherRequirementHash,
    harnessHash: mapping?.harnessHash, requestHash, fixtureTemplateHash, invocationId });
}

export function classifyT91R2RecoveryObservation({ observation, mapping, requestHash,
  fixtureTemplateHash, invocationId, reservationHash }) {
  const old = observation?.old;
  const staleAttempt = observation?.staleAttempt;
  const fresh = observation?.fresh;
  const validPins = observation?.terminal === true && observation.fixtureTemplateHash === fixtureTemplateHash
    && typeof invocationId === 'string' && observation.invocationId === invocationId
    && /^change-case-[0-9a-f-]{36}$/i.test(observation.fixtureCaseId ?? '')
    && observation.reservationHash === reservationHash
    && observation.fixtureHash === t91R2RecoveryFixtureHash({ mapping, requestHash, fixtureTemplateHash, invocationId });
  const complete = validPins && old?.sourcePlanId === mapping?.oldPlanId
    && old.sourcePlanHash === mapping?.oldPlanHash && old.sourceLinkId === mapping?.oldLinkId
    && old.sourceLinkHash === mapping?.oldLinkHash && old.sourceRunId === mapping?.oldRunId
    && old.fixturePlanId && old.fixturePlanHash && old.fixtureLinkId && old.fixtureLinkHash && old.fixtureRunId
    && old.ownerSelectedRequirementHash === mapping?.selectedRequirementHash
    && /^[a-f0-9]{64}$/.test(old.selectedRequirementHashBefore ?? '')
    && old.selectedRequirementHashAfter === old.selectedRequirementHashBefore
    && old.ownerOtherRequirementId === mapping?.otherRequirementId
    && old.ownerOtherRequirementHash === mapping?.otherRequirementHash
    && typeof old.otherRequirementId === 'string'
    && /^[a-f0-9]{64}$/.test(old.otherRequirementHashBefore ?? '')
    && /^[a-f0-9]{64}$/.test(old.otherRequirementHashAfter ?? '')
    && old.otherRequirementHashAfter !== old.otherRequirementHashBefore
    && old.planStatusAfterEdit === 'REGENERATION_REQUIRED'
    && old.linkStatusAfterEdit === 'STALE'
    && old.regenerationReason === 'SHARED_REQUIREMENTS_DRAFT_CHANGED'
    && old.oldPlanHashAfterEdit === old.fixturePlanHash
    && staleAttempt?.httpStatus === 409 && staleAttempt.errorCode === 'BEHAVIOR_TEST_PLAN_STALE'
    && staleAttempt.before && staleAttempt.after && digest(staleAttempt.before) === digest(staleAttempt.after)
    && Number.isSafeInteger(staleAttempt.before.caseVersion) && Number.isSafeInteger(staleAttempt.before.eventCount)
    && Number.isSafeInteger(staleAttempt.before.runCount) && Number.isSafeInteger(staleAttempt.before.auditCount)
    && Number.isSafeInteger(staleAttempt.before.outboxCount)
    && fresh?.planId && fresh.planHash && fresh.planId !== old.fixturePlanId
    && fresh.draftRevision > old.draftRevision && fresh.runId && fresh.runId !== old.fixtureRunId
    && fresh.runStatus === 'SUCCEEDED' && /^[a-f0-9]{64}$/.test(fresh.checkOutputHash ?? '')
    && fresh.linkId && fresh.linkHash && fresh.linkId !== old.fixtureLinkId && fresh.linkPlanId === fresh.planId
    && fresh.linkPlanHash === fresh.planHash && fresh.linkRunId === fresh.runId
    && fresh.oldPlanHashStillPresent === old.oldPlanHashAfterEdit
    && fresh.oldLinkHashStillPresent === old.fixtureLinkHash
    && fresh.fixtureSelectedRequirementHash === old.selectedRequirementHashBefore
    && fresh.ownerSelectedRequirementHash === mapping.selectedRequirementHash;
  if (!complete) return { status: 'INCONCLUSIVE', noMutationVerified: false, expectedFixtureHash: null };
  const status = old.planStatusAfterEdit === 'REGENERATION_REQUIRED'
    && old.regenerationReason === 'SHARED_REQUIREMENTS_DRAFT_CHANGED'
    && staleAttempt.httpStatus === 409 && staleAttempt.errorCode === 'BEHAVIOR_TEST_PLAN_STALE'
    && fresh.runStatus === 'SUCCEEDED' ? 'PASS' : 'FAIL';
  return { status, expectedFixtureHash: observation.fixtureHash, noMutationVerified: status === 'PASS',
    selectedRequirementHash: mapping.selectedRequirementHash, oldPlanHash: mapping.oldPlanHash,
    oldLinkHash: mapping.oldLinkHash, newPlanHash: fresh.planHash, newRunId: fresh.runId, newLinkHash: fresh.linkHash };
}

export function t91R2RecoveryReceiptStatement({ status }) {
  if (status === 'PASS') return 'PASS — an unrelated rationale edit advanced the shared draft, the selected requirement hash stayed unchanged, stale execution was denied without mutation, and fresh evidence was linked to a distinct plan and run. This is R2 recovery-path evidence only; business truth remains unverified.';
  if (status === 'FAIL') return 'FAIL — the observed shared-draft recovery contradicted its pinned stale-denial or selected-requirement preservation contract. No pass is claimed.';
  return 'INCONCLUSIVE — the shared-draft recovery could not be fully confirmed from the isolated fixture. No stale-denial or recovery pass is claimed; restore fixture readiness and rerun.';
}

export function t91N3DeletedFailingTestReceiptStatement({ status }) {
  if (status === 'PASS') return 'PASS — the pinned source test failed as expected, and deletion of tests/learning.test.js was rejected before verifier dispatch.';
  if (status === 'FAIL') return 'FAIL — the N3 safeguard evidence contradicted the expected failing source and deletion rejection. Review both stages before rerunning; no pass is claimed.';
  return 'INCONCLUSIVE — the N3 source-failure/deletion result could not be confirmed. No rejection or pass is claimed; restore the isolated fixture and rerun.';
}

export function t91N3DeletedFailingTestFixtureHash({ mapping, requestHash, fixtureTemplateHash, invocationId }) {
  return digest({ fixtureId: 't91-n3-deleted-failing-test-product-fixture-v1', harnessId: mapping?.harnessId,
    harnessHash: mapping?.harnessHash, assertionHash: mapping?.assertionHash,
    sourceTreeDigest: mapping?.repositoryTreeDigest, sourceTestBytesHash: mapping?.sourceTestBytesHash,
    requestHash, fixtureTemplateHash, invocationId });
}

export function classifyT91N3DeletedFailingTestObservation({ observation, mapping, requestHash,
  fixtureTemplateHash, invocationId, reservationHash }) {
  const source = observation?.sourceStage;
  const candidate = observation?.candidate;
  const run = observation?.run;
  const changes = candidate?.changes;
  const tap = source?.tap;
  const sourceComplete = source?.terminal === true && source?.path === T91_N3_DELETED_FAILING_TEST_HARNESS.sourcePath
    && source?.bytesHash === T91_N3_DELETED_FAILING_TEST_HARNESS.sourceBytesHash
    && source?.exitCode === T91_N3_DELETED_FAILING_TEST_HARNESS.sourceExpectedExitCode
    && typeof tap === 'string' && tap.length > 0 && tap.length <= 20_000
    && /# tests 1\b/.test(tap) && /# pass 0\b/.test(tap) && /# fail 1\b/.test(tap)
    && /not ok 1 - pinned criterion fails on the candidate/i.test(tap)
    && /1 !== 2/.test(tap);
  const complete = observation?.terminal === true && observation.fixtureTemplateHash === fixtureTemplateHash
    && mapping?.fixtureTemplateHash === fixtureTemplateHash
    && typeof invocationId === 'string' && observation.invocationId === invocationId
    && observation.reservationHash === reservationHash
    && observation.fixtureHash === t91N3DeletedFailingTestFixtureHash({ mapping, requestHash, fixtureTemplateHash, invocationId })
    && sourceComplete && /^[a-f0-9]{64}$/.test(source?.treeDigest ?? '')
    && /^[a-f0-9]{64}$/.test(candidate?.treeDigest ?? '') && candidate.treeDigest !== source.treeDigest
    && candidate.deletedPath === T91_N3_DELETED_FAILING_TEST_HARNESS.sourcePath
    && candidate.deletedPathHash === T91_N3_DELETED_FAILING_TEST_HARNESS.sourceBytesHash
    && Array.isArray(changes) && changes.length === 1
    && changes[0]?.path === T91_N3_DELETED_FAILING_TEST_HARNESS.sourcePath
    && changes[0]?.change === 'deleted' && changes[0]?.beforeHash === candidate.deletedPathHash
    && /^execution-run-[0-9a-f-]{36}$/i.test(run?.id ?? '') && run?.status === 'FAILED'
    && run?.errorCode === T91_N3_DELETED_FAILING_TEST_HARNESS.contract.expectedErrorCode
    && Number.isSafeInteger(observation.verifierDispatchCount) && observation.verifierDispatchCount >= 0;
  if (!complete) return { status: 'INCONCLUSIVE', noMutationVerified: false, expectedFixtureHash: null };
  const status = observation.verifierDispatchCount === 0 ? 'PASS' : 'FAIL';
  return { status, noMutationVerified: false, expectedFixtureHash: observation.fixtureHash,
    sourceTreeDigest: source.treeDigest, sourceTestBytesHash: source.bytesHash, sourceTapHash: digest(tap),
    sourceExitCode: source.exitCode, candidateTreeDigest: candidate.treeDigest,
    deletedPath: candidate.deletedPath, deletedPathHash: candidate.deletedPathHash,
    verifierDispatchCount: observation.verifierDispatchCount };
}

export function t91N1OrphanPathReceiptStatement({ status, candidatePath = T91_N1_ORPHAN_PATH_HARNESS.candidatePath }) {
  if (status === 'PASS') {
    return `PASS — the N1 candidate added ${candidatePath}, and OrgWard rejected it before verifier dispatch. Other negative/recovery cases and business truth remain unverified.`;
  }
  if (status === 'FAIL') {
    return `FAIL — the N1 safeguard outcome contradicted the expected rejection of ${candidatePath}. Review the receipt evidence and correct the guard or fixture before rerunning; no pass is claimed.`;
  }
  return `INCONCLUSIVE — the N1 safeguard result for ${candidatePath} could not be confirmed, so no rejection or pass is claimed. Check isolated fixture availability and rerun after it is restored.`;
}

export function isSupportedT91N1OrphanPathDefinition({ mapping, plan }) {
  const definition = plan?.caseDefinitions?.cases?.find((entry) => entry.type === 'NEGATIVE');
  const dataset = definition?.dataset?.cases?.find((entry) => entry.id === 'N1');
  const oracle = definition?.expectedOutput?.cases?.find((entry) => entry.id === 'N1');
  return Boolean(definition && dataset && oracle
    && digest(definition) === mapping?.parentDefinitionHash
    && digest(dataset) === mapping?.datasetHash && digest(oracle) === mapping?.oracleHash
    && dataset.mutation === 'ADD_UNMAPPED_PATH' && dataset.path === T91_N1_ORPHAN_PATH_HARNESS.candidatePath
    && oracle.status === 'FAILED' && oracle.category === T91_N1_ORPHAN_PATH_HARNESS.contract.expectedErrorCode
    && oracle.verifierDispatched === false);
}

export function isSupportedT91N3DeletedFailingTestDefinition({ mapping, plan }) {
  const definition = plan?.caseDefinitions?.cases?.find((entry) => entry.type === 'NEGATIVE');
  const dataset = definition?.dataset?.cases?.find((entry) => entry.id === 'N3');
  const oracle = definition?.expectedOutput?.cases?.find((entry) => entry.id === 'N3');
  const harness = T91_N3_DELETED_FAILING_TEST_HARNESS;
  return Boolean(definition && dataset && oracle
    && digest(definition) === mapping?.parentDefinitionHash
    && digest(dataset) === mapping?.datasetHash && digest(oracle) === mapping?.oracleHash
    && dataset.mutation === harness.contract.mutation && dataset.path === harness.sourcePath
    && dataset.sourceExpectedExitCode === harness.sourceExpectedExitCode
    && mapping.fixtureTemplateHash === T91_N3_PRODUCT_FIXTURE_TEMPLATE_HASH
    && mapping.sourceTestBytesHash === harness.sourceBytesHash
    && oracle.status === harness.contract.expectedStatus && oracle.deletedPathRejected === true
    && oracle.verifierDispatched === false);
}

export function classifyT91N1OrphanPathObservation({ observation, mapping, requestHash,
  fixtureTemplateHash, invocationId, reservationHash }) {
  const source = observation?.source;
  const candidate = observation?.candidate;
  const run = observation?.run;
  const changes = candidate?.changes;
  const complete = observation?.terminal === true
    && observation.fixtureTemplateHash === fixtureTemplateHash && typeof invocationId === 'string'
    && observation.invocationId === invocationId && observation.reservationHash === reservationHash
    && observation.fixtureHash === t91N1OrphanPathFixtureHash({ mapping, requestHash, fixtureTemplateHash, invocationId })
    && /^[a-f0-9]{64}$/.test(source?.treeDigest ?? '')
    && /^[a-f0-9]{64}$/.test(candidate?.treeDigest ?? '')
    && candidate.treeDigest !== source?.treeDigest
    && /^[a-f0-9]{64}$/.test(candidate?.addedPathHash ?? '')
    && source.planTreeDigest === mapping?.repositoryTreeDigest
    && candidate.addedPath === T91_N1_ORPHAN_PATH_HARNESS.candidatePath
    && Array.isArray(changes) && changes.length === 1
    && changes[0]?.path === T91_N1_ORPHAN_PATH_HARNESS.candidatePath && changes[0]?.change === 'added'
    && changes[0]?.afterHash === candidate.addedPathHash
    && /^execution-run-[0-9a-f-]{36}$/i.test(run?.id ?? '')
    && run?.status === 'FAILED' && run?.errorCode === T91_N1_ORPHAN_PATH_HARNESS.contract.expectedErrorCode
    && Number.isSafeInteger(observation.verifierDispatchCount) && observation.verifierDispatchCount >= 0;
  if (!complete) return { status: 'INCONCLUSIVE', noMutationVerified: false, expectedFixtureHash: null, addedPath: candidate?.addedPath ?? null };
  const status = observation.verifierDispatchCount === 0 && candidate.addedPath === T91_N1_ORPHAN_PATH_HARNESS.candidatePath
    ? 'PASS' : 'FAIL';
  return { status, noMutationVerified: false, expectedFixtureHash: observation.fixtureHash, addedPath: candidate.addedPath,
    sourceTreeDigest: source.treeDigest, candidateTreeDigest: candidate.treeDigest,
    addedPathHash: candidate.addedPathHash, verifierDispatchCount: observation.verifierDispatchCount };
}

export function t91N1OrphanPathFixtureHash({ mapping, requestHash, fixtureTemplateHash, invocationId }) {
  return digest({ fixtureId: 't91-n1-orphan-path-product-fixture-v1', harnessId: mapping?.harnessId,
    harnessHash: mapping?.harnessHash, assertionHash: mapping?.assertionHash,
    sourceTreeDigest: mapping?.repositoryTreeDigest, requestHash, fixtureTemplateHash, invocationId });
}

export function t91N2AuthorizationFixtureHash({ mapping, requestHash }) {
  return digest({ fixtureId: 't91-n2-authorization-create-app-postgres-fixture', fixtureVersion: 1,
    harnessId: mapping.harnessId, harnessVersion: mapping.harnessVersion, harnessHash: mapping.harnessHash,
    assertionId: mapping.assertionId, assertionHash: mapping.assertionHash,
    route: T91_N2_AUTHORIZATION_HARNESS.contract.route, requestHash });
}

export function t91N2MissingAssertionFixtureHash({ mapping, requestHash, fixtureTemplateHash = null, invocationId = null }) {
  const core = { fixtureId: 't91-n2-missing-assertion-create-app-postgres-fixture', fixtureVersion: 1,
    harnessId: mapping.harnessId, harnessVersion: mapping.harnessVersion, harnessHash: mapping.harnessHash,
    assertionId: mapping.assertionId, assertionHash: mapping.assertionHash,
    requiredPlanAssertionId: mapping.requiredPlanAssertionId,
    requiredPlanAssertionName: mapping.requiredPlanAssertionName,
    requiredPlanAssertionHash: mapping.requiredPlanAssertionHash,
    requestHash };
  return digest({ ...core, ...(fixtureTemplateHash && invocationId ? { fixtureTemplateHash, invocationId } : {}) });
}

export function isSupportedT91N2MissingAssertionDefinition({ mapping, plan }) {
  const definition = plan?.caseDefinitions?.cases?.find((entry) => entry.type === 'NEGATIVE');
  const dataset = definition?.dataset?.cases?.find((entry) => entry.id === 'N2');
  const oracle = definition?.expectedOutput?.cases?.find((entry) => entry.id === 'N2');
  const assertion = plan?.assertions?.find((entry) => entry.id === mapping?.requiredPlanAssertionId);
  return Boolean(definition && dataset && oracle && assertion
    && digest(definition) === mapping?.parentDefinitionHash && digest(dataset) === mapping?.datasetHash
    && digest(oracle) === mapping?.oracleHash && digest(assertion) === mapping?.requiredPlanAssertionHash
    && assertion.testName === mapping?.requiredPlanAssertionName
    && dataset.criterionId === mapping?.criterionId && dataset.mandatory === true
    && Array.isArray(dataset.assertions) && dataset.assertions.length === 0
    && oracle.missingNamedAssertionLinkStatus === 409
    && oracle.missingNamedAssertionError === 'BEHAVIOR_CANDIDATE_REJECTED'
    && oracle.caseVersionChanged === false && oracle.evidenceLinkCreated === false);
}

export function classifyT91N2MissingAssertionObservation({ observation, mapping, requestHash,
  fixtureTemplateHash, invocationId, reservationHash }) {
  const validCounters = (value) => value && Number.isSafeInteger(value.caseVersion) && value.caseVersion >= 0
    && Number.isSafeInteger(value.eventCount) && value.eventCount >= 0
    && Number.isSafeInteger(value.linkCount) && value.linkCount >= 0
    && Number.isSafeInteger(value.evaluationCount) && value.evaluationCount >= 0
    && Number.isSafeInteger(value.reviewCount) && value.reviewCount >= 0
    && Number.isSafeInteger(value.auditCount) && value.auditCount >= 0
    && Number.isSafeInteger(value.outboxCount) && value.outboxCount >= 0
    && /^[a-f0-9]{64}$/.test(value.digest ?? '');
  const before = observation?.attempt?.before;
  const after = observation?.attempt?.after;
  const assertion = observation?.run?.assertion;
  const attempt = observation?.attempt;
  const fixturePlan = observation?.fixturePlan;
  const check = observation?.run?.check;
  const tapLines = typeof check?.stdout === 'string' ? check.stdout.split(/\r?\n/) : [];
  const exactAssertionReported = tapLines.some((line) => /^(?:ok|not ok) \d+ - /.test(line)
    && line.endsWith(` - ${mapping?.requiredPlanAssertionName}`));
  const completePassingTap = check?.id === 't91-n2-inert-check' && check?.status === 'PASSED'
    && check?.executionStatus === 'COMPLETED' && check?.exitCode === 0
    && check?.stdoutTruncated === false && check?.stderrTruncated === false
    && typeof check?.stdout === 'string' && typeof check?.stderr === 'string'
    && check.stdout.length > 0 && /^[a-f0-9]{64}$/.test(check.outputHash ?? '')
    && /^[a-f0-9]{40,64}$/.test(check.candidateTreeDigest ?? '')
    && check.candidateTreeDigest === check.candidateTreeDigestAfter
    && tapLines.includes('ok 1 - Fixed synthetic scenario contract')
    && tapLines.includes('# tests 1') && tapLines.includes('# pass 1')
    && tapLines.includes('# fail 0') && !exactAssertionReported;
  const expectedFixtureHash = t91N2MissingAssertionFixtureHash({ mapping, requestHash, fixtureTemplateHash, invocationId });
  const structurallyComplete = observation?.terminal === true && observation.fixtureTemplateHash === fixtureTemplateHash
    && observation.invocationId === invocationId && observation.reservationHash === reservationHash
    && observation.fixtureHash === expectedFixtureHash && /^[a-f0-9]{64}$/.test(observation.run?.tapHash ?? '')
    && /^[a-f0-9]{64}$/.test(observation.run?.outputHash ?? '')
    && fixturePlan?.httpStatus === 201 && typeof fixturePlan.id === 'string'
    && fixturePlan.id === observation.run?.planId && fixturePlan.planHash === observation.run?.planHash
    && /^[a-f0-9]{64}$/.test(fixturePlan.planHash ?? '')
    && typeof observation.run?.id === 'string' && observation.run?.status === 'SUCCEEDED' && typeof observation.run?.checkId === 'string'
    && completePassingTap && observation.run.checkId === check.id
    && observation.run.tapHash === digest(check.stdout) && observation.run.outputHash === check.outputHash
    && typeof observation.run?.planId === 'string' && /^[a-f0-9]{64}$/.test(observation.run?.planHash ?? '')
    && validCounters(before) && validCounters(after) && attempt?.terminal === true && Number.isSafeInteger(attempt?.httpStatus)
    && (typeof attempt?.errorCode === 'string' || attempt?.errorCode === null)
    && assertion?.id === mapping.requiredPlanAssertionId
    && assertion?.name === mapping.requiredPlanAssertionName
    && ['UNKNOWN', 'PASS', 'FAIL'].includes(assertion?.status)
    && typeof assertion?.reason === 'string';
  if (!structurallyComplete) return { status: 'INCONCLUSIVE', noMutationVerified: false, expectedFixtureHash };
  const noMutationVerified = before.caseVersion === after.caseVersion && before.eventCount === after.eventCount
    && before.linkCount === after.linkCount && before.evaluationCount === after.evaluationCount
    && before.reviewCount === after.reviewCount && before.auditCount === after.auditCount
    && before.outboxCount === after.outboxCount && before.digest === after.digest;
  const expectedRejection = observation.run.status === 'SUCCEEDED' && assertion.status === 'UNKNOWN'
    && assertion.reason === 'ASSERTION_RESULT_NOT_FOUND' && attempt.httpStatus === 409
    && attempt.errorCode === 'BEHAVIOR_CANDIDATE_REJECTED';
  const status = expectedRejection && noMutationVerified ? 'PASS'
    : (observation.run.status === 'SUCCEEDED' && assertion.status !== 'UNKNOWN' && noMutationVerified ? 'FAIL'
      : 'FAIL');
  return { status, noMutationVerified, expectedFixtureHash };
}

export function isSupportedT91N2AuthorizationDefinition({ mapping, plan }) {
  const definition = plan?.caseDefinitions?.cases?.find((entry) => entry.type === 'NEGATIVE');
  const dataset = definition?.dataset?.cases?.find((entry) => entry.id === 'N2');
  const oracle = definition?.expectedOutput?.cases?.find((entry) => entry.id === 'N2');
  return Boolean(definition && dataset && oracle
    && digest(definition) === mapping?.parentDefinitionHash
    && digest(dataset) === mapping?.datasetHash && digest(oracle) === mapping?.oracleHash
    && dataset.criterionId === mapping.criterionId && dataset.mandatory === true
    && Array.isArray(dataset.assertions) && dataset.assertions.length === 0
    && oracle.authorizationStatus === 400 && oracle.planSaved === false
    && oracle.caseVersionChanged === false && oracle.evidenceLinkCreated === false);
}

export function classifyT91N2AuthorizationObservation({ observation, mapping, requestHash, fixtureTemplateHash = null,
  invocationId = null, reservationHash = null }) {
  const validCounters = (value) => value && Number.isSafeInteger(value.caseVersion) && value.caseVersion >= 0
    && Number.isSafeInteger(value.eventCount) && value.eventCount >= 0
    && Number.isSafeInteger(value.planCount) && value.planCount >= 0
    && Number.isSafeInteger(value.auditCount) && value.auditCount >= 0
    && Number.isSafeInteger(value.outboxCount) && value.outboxCount >= 0
    && /^[a-f0-9]{64}$/.test(value.digest ?? '');
  const control = observation?.control;
  const attempt = observation?.attempt;
  const expectedFixtureHash = fixtureTemplateHash && invocationId
    ? t91N2AuthorizationInvocationFixtureHash({ mapping, requestHash, fixtureTemplateHash, invocationId })
    : t91N2AuthorizationFixtureHash({ mapping, requestHash });
  if (!observation || observation.terminal !== true || observation.fixtureHash !== expectedFixtureHash
    || (fixtureTemplateHash && (observation.fixtureTemplateHash !== fixtureTemplateHash || observation.invocationId !== invocationId))
    || (reservationHash && (observation.reservationHash !== reservationHash
      || !fixtureTemplateHash || !invocationId))
    || !control || control.terminal !== true || !Number.isSafeInteger(control.httpStatus)
    || !control.fixtureCreated || !/^[a-f0-9]{64}$/.test(control.acceptedPlanHash ?? '')
    || !/^change-case-[0-9a-f-]{36}$/i.test(control.fixtureCaseId ?? '')
    || control.fixtureHash !== expectedFixtureHash
    || !validCounters(control.before) || !validCounters(control.after)
    || !attempt || attempt.terminal !== true || !Number.isSafeInteger(attempt.httpStatus)
    || attempt.fixtureCaseId !== control.fixtureCaseId
    || !(typeof attempt.errorCode === 'string' || (attempt.errorCode === null && Number.isSafeInteger(attempt.httpStatus)))
    || attempt.fixtureHash !== expectedFixtureHash
    || !validCounters(attempt.before) || !validCounters(attempt.after)) {
    return { status: 'INCONCLUSIVE', noMutationVerified: false, expectedFixtureHash };
  }
  const controlValid = control.httpStatus === 201
    && control.after.caseVersion === control.before.caseVersion + 1
    && control.after.eventCount === control.before.eventCount + 1
    && control.after.planCount === control.before.planCount + 1
    && control.after.auditCount === control.before.auditCount + 1
    && control.after.outboxCount === control.before.outboxCount + 1
    && control.after.digest !== control.before.digest;
  const noMutationVerified = attempt.before.caseVersion === attempt.after.caseVersion
    && attempt.before.eventCount === attempt.after.eventCount && attempt.before.planCount === attempt.after.planCount
    && attempt.before.auditCount === attempt.after.auditCount && attempt.before.outboxCount === attempt.after.outboxCount
    && attempt.before.digest === attempt.after.digest;
  const controlContinuity = control.after.caseVersion === attempt.before.caseVersion
    && control.after.eventCount === attempt.before.eventCount && control.after.planCount === attempt.before.planCount
    && control.after.auditCount === attempt.before.auditCount && control.after.outboxCount === attempt.before.outboxCount
    && control.after.digest === attempt.before.digest;
  const targetRejected = attempt.httpStatus === 400 && attempt.errorCode === 'INVALID_PROCESS_BEHAVIOR_TEST_PLAN';
  return { status: controlValid && targetRejected && noMutationVerified && controlContinuity ? 'PASS' : 'FAIL', noMutationVerified,
    expectedFixtureHash };
}

export function verifyT91N2AuthorizationReservationPins({ reservation, event, mapping, review, current }) {
  if (!reservation || !event || !mapping || !review || !current) return false;
  const { reservationHash, integrityStatus: _integrityStatus, ...core } = reservation;
  return digest(core) === reservationHash && reservation.reservationHash === event.data?.reservationHash
    && reservation.tenantId === current.tenantId && reservation.projectId === current.projectId
    && reservation.caseId === current.id && reservation.mappingId === mapping.id
    && reservation.mappingHash === mapping.mappingHash && reservation.reviewId === review.id
    && reservation.reviewHash === review.reviewHash && reservation.planId === mapping.planId
    && reservation.planHash === mapping.planHash && digest(reservation.sourceRef) === digest(mapping.sourceRef)
    && reservation.repositorySnapshotId === mapping.repositorySnapshotId
    && reservation.repositoryTreeDigest === mapping.repositoryTreeDigest
    && reservation.criterionId === mapping.criterionId && reservation.criterionHash === mapping.criterionHash
    && reservation.criterionContractVersion === mapping.criterionContractVersion
    && reservation.criterionContractHash === mapping.criterionContractHash
    && reservation.parentDefinitionHash === mapping.parentDefinitionHash
    && reservation.datasetHash === mapping.datasetHash && reservation.oracleHash === mapping.oracleHash
    && reservation.harnessId === mapping.harnessId && reservation.harnessVersion === mapping.harnessVersion
    && reservation.harnessHash === mapping.harnessHash && reservation.assertionId === mapping.assertionId
    && reservation.assertionHash === mapping.assertionHash;
}

export function projectT91N2AuthorizationExecutionIntegrity(receipts, verifiedPins) {
  const verified = new Map((verifiedPins ?? []).map((entry) => [`${entry.id}:${entry.receiptHash}`, entry]));
  return (receipts ?? []).map((receipt) => {
    const pin = verified.get(`${receipt.id}:${receipt.receiptHash}`);
    return { ...receipt, ...(pin?.status ? { status: pin.status, outcome: pin.status,
      ...(pin.historicalOutcome ? { historicalOutcome: pin.historicalOutcome } : {}) } : {}),
    integrityStatus: pin ? 'VALID' : 'INVALID' };
  });
}

export function isIndependentT91N2MappingReviewer({ reviewerPrincipal, mappingRequester, planAuthor, definitionAuthor }) {
  return Boolean(reviewerPrincipal && [mappingRequester, planAuthor, definitionAuthor].every((actor) => actor !== reviewerPrincipal));
}

export function buildT91N2AuthorizationMapping({ changeCase, requirement, plan }) {
  const parent = plan?.caseDefinitions?.cases?.find((entry) => entry.type === 'NEGATIVE');
  const input = parent?.dataset?.cases?.find((entry) => entry.id === 'N2');
  const oracle = parent?.expectedOutput?.cases?.find((entry) => entry.id === 'N2');
  const contract = requirement?.criterionContractHistory?.find((entry) => entry.version === plan?.criterionContractVersion
    && entry.contentHash === plan?.criterionContractHash)
    ?? (requirement?.criterionContract?.version === plan?.criterionContractVersion
      && requirement?.criterionContract?.contentHash === plan?.criterionContractHash ? requirement.criterionContract : null);
  const criterion = contract?.criteria?.find((entry) => entry.id === parent?.criterionId);
  if (!changeCase?.tenantId || !changeCase?.projectId || !changeCase?.id || !requirement?.id
    || !plan?.planHash || !plan.repository?.source?.snapshotId || !/^[a-f0-9]{64}$/.test(plan.repository?.treeDigest ?? '')
    || !parent || !input || !oracle || !criterion || !parent.sourceRef?.snapshotHash) return null;
  const harness = { ...T91_N2_AUTHORIZATION_HARNESS,
    contract: { ...T91_N2_AUTHORIZATION_HARNESS.contract,
      expectedEffects: { ...T91_N2_AUTHORIZATION_HARNESS.contract.expectedEffects } } };
  const core = {
    schemaVersion: 1,
    tenantId: changeCase.tenantId,
    projectId: changeCase.projectId,
    caseId: changeCase.id,
    requirementId: requirement.id,
    planId: plan.id,
    planHash: plan.planHash,
    repositorySnapshotId: plan.repository?.source?.snapshotId ?? null,
    repositoryTreeDigest: plan.repository?.treeDigest ?? null,
    sourceRef: structuredClone(parent.sourceRef),
    criterionId: criterion.id,
    criterionHash: digest(criterion),
    criterionContractVersion: contract.version,
    criterionContractHash: contract.contentHash,
    parentDefinitionHash: digest(parent),
    datasetHash: digest(input),
    oracleHash: digest(oracle),
    subcaseId: 'N2.AUTHORIZATION',
    harnessId: harness.id,
    harnessVersion: harness.version,
    harnessHash: digest(harness),
    assertionId: harness.assertionId,
    assertionHash: digest({ id: harness.assertionId, contract: harness.contract }),
    scope: harness.scope,
  };
  return { ...core, mappingHash: digest(core) };
}

export function buildT91N2MissingAssertionMapping({ changeCase, requirement, plan }) {
  const parent = plan?.caseDefinitions?.cases?.find((entry) => entry.type === 'NEGATIVE');
  const input = parent?.dataset?.cases?.find((entry) => entry.id === 'N2');
  const oracle = parent?.expectedOutput?.cases?.find((entry) => entry.id === 'N2');
  const assertion = plan?.assertions?.find((entry) => entry.criterionId === parent?.criterionId
    && typeof entry.testName === 'string' && entry.testName.trim() && typeof entry.id === 'string');
  const contract = requirement?.criterionContractHistory?.find((entry) => entry.version === plan?.criterionContractVersion
    && entry.contentHash === plan?.criterionContractHash)
    ?? (requirement?.criterionContract?.version === plan?.criterionContractVersion
      && requirement?.criterionContract?.contentHash === plan?.criterionContractHash ? requirement.criterionContract : null);
  const criterion = contract?.criteria?.find((entry) => entry.id === parent?.criterionId);
  if (!changeCase?.tenantId || !changeCase?.projectId || !changeCase?.id || !requirement?.id || !plan?.planHash
    || !plan.repository?.source?.snapshotId || !/^[a-f0-9]{64}$/.test(plan.repository?.treeDigest ?? '')
    || !parent || !input || !oracle || !assertion || !criterion || !parent.sourceRef?.snapshotHash
    || input.criterionId !== criterion.id || input.mandatory !== true || !Array.isArray(input.assertions)
    || input.assertions.length !== 0 || criterion.mandatory !== true
    || oracle.missingNamedAssertionLinkStatus !== 409 || oracle.missingNamedAssertionError !== 'BEHAVIOR_CANDIDATE_REJECTED'
    || oracle.caseVersionChanged !== false || oracle.evidenceLinkCreated !== false) return null;
  const harness = T91_N2_MISSING_ASSERTION_HARNESS;
  const core = {
    schemaVersion: 1, tenantId: changeCase.tenantId, projectId: changeCase.projectId, caseId: changeCase.id,
    requirementId: requirement.id, planId: plan.id, planHash: plan.planHash,
    repositorySnapshotId: plan.repository.source.snapshotId, repositoryTreeDigest: plan.repository.treeDigest,
    sourceRef: structuredClone(parent.sourceRef), criterionId: criterion.id, criterionHash: digest(criterion),
    criterionContractVersion: contract.version, criterionContractHash: contract.contentHash,
    parentDefinitionHash: digest(parent), datasetHash: digest(input), oracleHash: digest(oracle),
    subcaseId: harness.subcaseId, harnessId: harness.id, harnessVersion: harness.version, harnessHash: digest(harness),
    assertionId: harness.assertionId, assertionHash: digest({ id: harness.assertionId, contract: harness.contract }),
    requiredPlanAssertionId: assertion.id, requiredPlanAssertionName: assertion.testName,
    requiredPlanAssertionHash: digest(assertion), scope: harness.scope,
  };
  return { ...core, mappingHash: digest(core) };
}

export function buildT91N1OrphanPathMapping({ changeCase, requirement, plan }) {
  const parent = plan?.caseDefinitions?.cases?.find((entry) => entry.type === 'NEGATIVE');
  const input = parent?.dataset?.cases?.find((entry) => entry.id === 'N1');
  const oracle = parent?.expectedOutput?.cases?.find((entry) => entry.id === 'N1');
  const contract = requirement?.criterionContractHistory?.find((entry) => entry.version === plan?.criterionContractVersion
    && entry.contentHash === plan?.criterionContractHash)
    ?? (requirement?.criterionContract?.version === plan?.criterionContractVersion
      && requirement?.criterionContract?.contentHash === plan?.criterionContractHash ? requirement.criterionContract : null);
  const criterion = contract?.criteria?.find((entry) => entry.id === parent?.criterionId);
  if (!changeCase?.tenantId || !changeCase?.projectId || !changeCase?.id || !requirement?.id || !plan?.planHash
    || !plan.repository?.source?.snapshotId || !/^[a-f0-9]{64}$/.test(plan.repository?.treeDigest ?? '')
    || !parent || !input || !oracle || !criterion || !parent.sourceRef?.snapshotHash
    || input.mutation !== 'ADD_UNMAPPED_PATH'
    || input.path !== T91_N1_ORPHAN_PATH_HARNESS.candidatePath
    || oracle.status !== 'FAILED' || oracle.category !== T91_N1_ORPHAN_PATH_HARNESS.contract.expectedErrorCode
    || oracle.verifierDispatched !== false) return null;
  const harness = T91_N1_ORPHAN_PATH_HARNESS;
  const core = {
    schemaVersion: 1, tenantId: changeCase.tenantId, projectId: changeCase.projectId, caseId: changeCase.id,
    requirementId: requirement.id, planId: plan.id, planHash: plan.planHash,
    repositorySnapshotId: plan.repository.source.snapshotId, repositoryTreeDigest: plan.repository.treeDigest,
    sourceRef: structuredClone(parent.sourceRef), criterionId: criterion.id, criterionHash: digest(criterion),
    criterionContractVersion: contract.version, criterionContractHash: contract.contentHash,
    parentDefinitionHash: digest(parent), datasetHash: digest(input), oracleHash: digest(oracle),
    subcaseId: harness.subcaseId, harnessId: harness.id, harnessVersion: harness.version, harnessHash: digest(harness),
    assertionId: harness.assertionId, assertionHash: digest({ id: harness.assertionId, contract: harness.contract,
      candidatePath: harness.candidatePath }), candidatePath: harness.candidatePath, scope: harness.scope,
  };
  return { ...core, mappingHash: digest(core) };
}

export function buildT91N3DeletedFailingTestMapping({ changeCase, requirement, plan }) {
  const parent = plan?.caseDefinitions?.cases?.find((entry) => entry.type === 'NEGATIVE');
  const input = parent?.dataset?.cases?.find((entry) => entry.id === 'N3');
  const oracle = parent?.expectedOutput?.cases?.find((entry) => entry.id === 'N3');
  const contract = requirement?.criterionContractHistory?.find((entry) => entry.version === plan?.criterionContractVersion
    && entry.contentHash === plan?.criterionContractHash)
    ?? (requirement?.criterionContract?.version === plan?.criterionContractVersion
      && requirement?.criterionContract?.contentHash === plan?.criterionContractHash ? requirement.criterionContract : null);
  const criterion = contract?.criteria?.find((entry) => entry.id === parent?.criterionId);
  const harness = T91_N3_DELETED_FAILING_TEST_HARNESS;
  if (!changeCase?.tenantId || !changeCase?.projectId || !changeCase?.id || !requirement?.id || !plan?.planHash
    || !plan.repository?.source?.snapshotId || !/^[a-f0-9]{64}$/.test(plan.repository?.treeDigest ?? '')
    || !parent || !input || !oracle || !criterion || !parent.sourceRef?.snapshotHash
    || input.mutation !== harness.contract.mutation || input.path !== harness.sourcePath
    || input.sourceExpectedExitCode !== harness.sourceExpectedExitCode
    || oracle.status !== harness.contract.expectedStatus || oracle.deletedPathRejected !== true
    || oracle.verifierDispatched !== false) return null;
  const core = { schemaVersion: 1, tenantId: changeCase.tenantId, projectId: changeCase.projectId, caseId: changeCase.id,
    requirementId: requirement.id, planId: plan.id, planHash: plan.planHash,
    repositorySnapshotId: plan.repository.source.snapshotId, repositoryTreeDigest: plan.repository.treeDigest,
    sourceRef: structuredClone(parent.sourceRef), criterionId: criterion.id, criterionHash: digest(criterion),
    criterionContractVersion: contract.version, criterionContractHash: contract.contentHash,
    parentDefinitionHash: digest(parent), datasetHash: digest(input), oracleHash: digest(oracle),
    subcaseId: harness.subcaseId, harnessId: harness.id, harnessVersion: harness.version, harnessHash: digest(harness),
    assertionId: harness.assertionId, assertionHash: digest({ id: harness.assertionId, contract: harness.contract,
      sourcePath: harness.sourcePath, sourceBytesHash: harness.sourceBytesHash,
      sourceExpectedExitCode: harness.sourceExpectedExitCode }),
    candidatePath: harness.sourcePath, sourceTestBytesHash: harness.sourceBytesHash,
    sourceExpectedExitCode: harness.sourceExpectedExitCode, fixtureTemplateHash: T91_N3_PRODUCT_FIXTURE_TEMPLATE_HASH,
    scope: harness.scope };
  return { ...core, mappingHash: digest(core) };
}

export function verifyT91N2AuthorizationMapping(mapping, expected) {
  if (!mapping || !expected) return false;
  const { mappingHash, integrityStatus: _integrityStatus, ...core } = mapping;
  const { mappingHash: expectedHash, ...expectedCore } = expected;
  const pinned = Object.fromEntries(Object.keys(expectedCore).map((key) => [key, core[key]]));
  return mappingHash === expectedHash && digest(pinned) === mappingHash && digest(expectedCore) === expectedHash
    && Object.keys(core).filter((key) => Object.hasOwn(expectedCore, key)).length === Object.keys(expectedCore).length;
}
