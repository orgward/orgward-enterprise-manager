import assert from 'node:assert/strict';
import test from 'node:test';
import { digest } from '../../src/sdlc/contracts.mjs';
import { T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH, classifyT91N2AuthorizationObservation,
  buildT91N2MissingAssertionMapping, classifyT91N2MissingAssertionObservation,
  T91_N2_MISSING_ASSERTION_HARNESS, t91N2MissingAssertionFixtureHash,
  t91N2AuthorizationInvocationFixtureHash, t91N2AuthorizationFixtureHash,
  T91_N1_ORPHAN_PATH_HARNESS, classifyT91N1OrphanPathObservation, t91N1OrphanPathFixtureHash,
  t91N1OrphanPathReceiptStatement, T91_N3_DELETED_FAILING_TEST_HARNESS,
  buildT91N3DeletedFailingTestMapping, isSupportedT91N3DeletedFailingTestDefinition,
  classifyT91N3DeletedFailingTestObservation, t91N3DeletedFailingTestFixtureHash,
  T91_N3_PRODUCT_FIXTURE_TEMPLATE_HASH, t91ProductHarnessDispatchFailureObservation,
  isValidT91ProductHarnessInvocationPair, isValidT91N3ReceiptObservedPins,
  T91_R1_CRITERION_RECOVERY_HARNESS, buildT91R1RecoveryMapping, isSupportedT91R1RecoveryDefinition,
  classifyT91R1RecoveryObservation, t91R1RecoveryFixtureHash,
  T91_R2_SHARED_DRAFT_RECOVERY_HARNESS, buildT91R2RecoveryMapping, isSupportedT91R2RecoveryDefinition,
  classifyT91R2RecoveryObservation, t91R2RecoveryFixtureHash } from '../../src/sdlc/product-harness.mjs';
import { annotateT91FixtureDispatchError } from '../../src/platform/t91-n2-fixture-provider.mjs';

const mapping = { harnessId: 't91-n2-authorization', harnessVersion: 1, harnessHash: '1'.repeat(64),
  assertionId: 'rejects-empty-assertion-selection', assertionHash: '2'.repeat(64) };
const requestHash = '3'.repeat(64);
const reservationHash = '4'.repeat(64);
const invocationId = 't91-n2-fixture-invocation-12345678-1234-1234-1234-123456789abc';
const caseId = 'change-case-12345678-1234-1234-1234-123456789abc';
const before = { caseVersion: 1, eventCount: 2, planCount: 0, auditCount: 2, outboxCount: 2, digest: '5'.repeat(64) };
const after = { caseVersion: 2, eventCount: 3, planCount: 1, auditCount: 3, outboxCount: 3, digest: '6'.repeat(64) };

test('N2 and N3 v4 dispatch-failure receipts keep invocation/template pins paired for readback', () => {
  for (const subcaseId of ['N2.AUTHORIZATION', 'N3']) {
    const observation = t91ProductHarnessDispatchFailureObservation({ subcaseId,
      error: Object.assign(new Error('synthetic fixture interruption'), { code: 'FIXTURE_DISPATCH_FAILED' }),
      reservationHash });
    assert.equal(observation.terminal, false);
    assert.equal(observation.invocationId, null);
    assert.equal(observation.fixtureTemplateHash, null);
    assert.equal(isValidT91ProductHarnessInvocationPair(observation.invocationId, observation.fixtureTemplateHash), true);
  }
  assert.equal(isValidT91ProductHarnessInvocationPair(null, T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH), false);
  assert.equal(isValidT91ProductHarnessInvocationPair(null, T91_N3_PRODUCT_FIXTURE_TEMPLATE_HASH), false);
});

test('N3 readback permits provider-allocated invocation pins without a fixture case only while inconclusive', () => {
  const error = annotateT91FixtureDispatchError(new Error('connection failed before fixture creation'), {
    invocationId: 't91-n3-fixture-invocation-11111111-1111-4111-8111-111111111111',
    fixtureTemplateHash: T91_N3_PRODUCT_FIXTURE_TEMPLATE_HASH,
  });
  const mapping = { fixtureTemplateHash: T91_N3_PRODUCT_FIXTURE_TEMPLATE_HASH };
  const receipt = { status: 'INCONCLUSIVE', fixtureInvocationId: error.fixtureInvocationId,
    fixtureTemplateHash: error.fixtureTemplateHash, fixtureCaseId: null, fixturePlan: null,
    sourceStage: null, candidate: null, run: null };
  assert.equal(isValidT91N3ReceiptObservedPins(receipt, mapping), true);
  assert.equal(isValidT91N3ReceiptObservedPins({ ...receipt, status: 'PASS' }, mapping), false);
  assert.equal(isValidT91N3ReceiptObservedPins({ ...receipt, candidate: { deletedPath: 'tests/learning.test.js' } }, mapping), false);
  assert.equal(isValidT91N3ReceiptObservedPins({ ...receipt, fixtureTemplateHash: 'e'.repeat(64) }, mapping), false);
});

function observation({ status = 400, code = 'INVALID_PROCESS_BEHAVIOR_TEST_PLAN', pins = true } = {}) {
  const fixtureHash = pins ? t91N2AuthorizationInvocationFixtureHash({ mapping, requestHash,
    fixtureTemplateHash: T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH, invocationId })
    : t91N2AuthorizationFixtureHash({ mapping, requestHash });
  return { terminal: true, fixtureHash, invocationId: pins ? invocationId : null,
    fixtureTemplateHash: pins ? T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH : null,
    reservationHash: pins ? reservationHash : null,
    control: { terminal: true, fixtureCreated: true, acceptedPlanHash: '7'.repeat(64), fixtureCaseId: caseId,
      httpStatus: 201, errorCode: null, fixtureHash, before, after },
    attempt: { terminal: true, fixtureCaseId: caseId, httpStatus: status, errorCode: code, fixtureHash, before: after, after } };
}

test('schema-v4 harness classifier requires invocation/template/reservation pins and classifies terminal wrong status as FAIL', () => {
  const legacyFallback = observation({ pins: false });
  assert.equal(classifyT91N2AuthorizationObservation({ observation: legacyFallback, mapping, requestHash,
    reservationHash }).status, 'INCONCLUSIVE');
  const valid = observation();
  assert.equal(classifyT91N2AuthorizationObservation({ observation: valid, mapping, requestHash,
    fixtureTemplateHash: T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH, invocationId, reservationHash }).status, 'PASS');
  const wrongTerminalStatus = observation({ status: 201, code: null });
  const classified = classifyT91N2AuthorizationObservation({ observation: wrongTerminalStatus, mapping,
    requestHash, fixtureTemplateHash: T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH, invocationId, reservationHash });
  assert.equal(classified.status, 'FAIL');
  assert.equal(classified.noMutationVerified, true);
});

test('N1 orphan-path classifier requires the exact added path, tree hashes and zero verifier dispatch', () => {
  const n1Mapping = { harnessId: T91_N1_ORPHAN_PATH_HARNESS.id, harnessHash: 'a'.repeat(64),
    assertionHash: 'b'.repeat(64), repositoryTreeDigest: 'c'.repeat(64) };
  const fixtureHash = t91N1OrphanPathFixtureHash({ mapping: n1Mapping, requestHash,
    fixtureTemplateHash: T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH, invocationId });
  const observation = { terminal: true, fixtureHash, fixtureTemplateHash: T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH,
    invocationId, reservationHash, source: { treeDigest: 'f'.repeat(64), planTreeDigest: n1Mapping.repositoryTreeDigest },
    candidate: { treeDigest: 'd'.repeat(64), addedPath: 'src/unmapped.mjs', addedPathHash: 'e'.repeat(64),
      changes: [{ path: 'src/unmapped.mjs', change: 'added', afterHash: 'e'.repeat(64) }] },
    run: { id: 'execution-run-12345678-1234-1234-1234-123456789abc', status: 'FAILED',
      errorCode: 'BEHAVIOR_CANDIDATE_ORPHAN_PATH' }, verifierDispatchCount: 0 };
  const classify = (value) => classifyT91N1OrphanPathObservation({ observation: value, mapping: n1Mapping,
    requestHash, fixtureTemplateHash: T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH, invocationId, reservationHash });
  assert.equal(classify(observation).status, 'PASS');
  assert.equal(classify({ ...observation, verifierDispatchCount: 1 }).status, 'FAIL');
  assert.equal(classify({ ...observation, candidate: { ...observation.candidate, addedPath: 'src/other.mjs' } }).status, 'INCONCLUSIVE');
  assert.equal(classify({ ...observation, candidate: { ...observation.candidate,
    changes: [{ path: 'src/unmapped.mjs', change: 'added', afterHash: null }] } }).status, 'INCONCLUSIVE');
});

test('N1 receipt wording claims rejection only for PASS and keeps incomplete outcomes actionable', () => {
  const pass = t91N1OrphanPathReceiptStatement({ status: 'PASS', candidatePath: 'src/unmapped.mjs' });
  assert.match(pass, /rejected it before verifier dispatch/);
  const inconclusive = t91N1OrphanPathReceiptStatement({ status: 'INCONCLUSIVE', candidatePath: 'src/unmapped.mjs' });
  assert.match(inconclusive, /could not be confirmed/);
  assert.match(inconclusive, /no rejection or pass is claimed/);
  assert.match(inconclusive, /rerun after it is restored/);
  assert.doesNotMatch(inconclusive, /rejected it before verifier dispatch/);
  const failed = t91N1OrphanPathReceiptStatement({ status: 'FAIL', candidatePath: 'src/unmapped.mjs' });
  assert.match(failed, /contradicted the expected rejection/);
  assert.match(failed, /no pass is claimed/);
  assert.doesNotMatch(failed, /rejected it before verifier dispatch/);
});

test('R1 recovery mapping binds the exact v1 plan, passing link, contract and delegated recovery oracle', () => {
  const recovery = { type: 'RECOVERY', authoredBy: 'alice', criterionId: 'LEARN-OUTCOME',
    sourceRef: { id: 'process-learn', snapshotHash: 'a'.repeat(64) },
    dataset: { cases: [{ id: 'R1', fromCriterionVersion: 1, toCriterionVersion: 2, retainHistory: true }] },
    expectedOutput: { cases: [{ id: 'R1', oldPlanStatus: 'REGENERATION_REQUIRED', oldLinkStatus: 'STALE',
      staleExecutionStatus: 409, staleExecutionError: 'BEHAVIOR_TEST_PLAN_STALE', newPlanBindsVersion: 2,
      oldPlanHashPreserved: true, newRunDistinct: true }] } };
  const criterion = { id: 'LEARN-OUTCOME', text: 'The process output is supported.', mandatory: true };
  const contract = { version: 1, contentHash: 'b'.repeat(64), criteria: [criterion] };
  const plan = { id: 'behavior-test-plan-12345678-1234-1234-1234-123456789abc', planHash: 'c'.repeat(64),
    criterionContractVersion: 1, criterionContractHash: contract.contentHash,
    repository: { source: { snapshotId: 'snapshot-v1' }, treeDigest: 'd'.repeat(64) }, caseDefinitions: { cases: [recovery] } };
  const oldLink = { id: 'process-run-evidence-link-12345678-1234-1234-1234-123456789abc', linkHash: 'e'.repeat(64),
    behaviorEvaluation: { planId: plan.id, planHash: plan.planHash, result: 'TEST_PASS' },
    run: { id: 'execution-run-12345678-1234-1234-1234-123456789abc', status: 'SUCCEEDED' } };
  const requirement = { id: 'REQ-PROC-123456789abc', criterionContractHistory: [contract], processRunEvidenceLinks: [oldLink] };
  const changeCase = { tenantId: 'tenant', projectId: 'project', id: 'case' };
  const mapping = buildT91R1RecoveryMapping({ changeCase, requirement, plan });
  assert.equal(mapping.subcaseId, 'R1');
  assert.equal(mapping.oldPlanHash, plan.planHash);
  assert.equal(mapping.oldLinkId, oldLink.id);
  assert.equal(mapping.oldLinkHash, oldLink.linkHash);
  assert.equal(mapping.datasetHash, digest(recovery.dataset.cases[0]));
  assert.equal(mapping.oracleHash, digest(recovery.expectedOutput.cases[0]));
  assert.equal(mapping.harnessId, T91_R1_CRITERION_RECOVERY_HARNESS.id);
  assert.equal(isSupportedT91R1RecoveryDefinition({ mapping, plan }), true);
  assert.equal(buildT91R1RecoveryMapping({ changeCase, requirement: { ...requirement, processRunEvidenceLinks: [] }, plan }), null,
    'R1 mapping is unavailable until the historical plan has passing linked evidence');
  const alteredPlan = { ...plan, caseDefinitions: { cases: [{ ...recovery,
    expectedOutput: { cases: [{ ...recovery.expectedOutput.cases[0], newRunDistinct: false }] } }] } };
  assert.equal(isSupportedT91R1RecoveryDefinition({ mapping, plan: alteredPlan }), false,
    'readback validation rejects an altered recovery oracle');
});

test('R2 mapping and classifier pin the selected plan and unrelated requirement edit separately', () => {
  const recovery = { type: 'RECOVERY', authoredBy: 'alice', criterionId: 'LEARN-OUTCOME',
    sourceRef: { id: 'process-learn', snapshotHash: 'a'.repeat(64) },
    dataset: { cases: [{ id: 'R2', editTarget: 'OTHER_REQUIREMENT', change: 'RATIONALE', selectedRequirementUnchanged: true }] },
    expectedOutput: { cases: [{ id: 'R2', oldPlanStatus: 'REGENERATION_REQUIRED',
      reason: 'SHARED_REQUIREMENTS_DRAFT_CHANGED', staleExecutionError: 'BEHAVIOR_TEST_PLAN_STALE',
      selectedRequirementHashPreserved: true, newPlanAppended: true }] } };
  const criterion = { id: 'LEARN-OUTCOME', text: 'The process output is supported.', mandatory: true };
  const contract = { version: 1, contentHash: 'b'.repeat(64), criteria: [criterion] };
  const plan = { id: 'behavior-test-plan-12345678-1234-1234-1234-123456789abc', planHash: 'c'.repeat(64),
    criterionContractVersion: 1, criterionContractHash: contract.contentHash,
    assertions: [{ criterionId: criterion.id, criterionHash: 'f'.repeat(64) }],
    repository: { source: { snapshotId: 'snapshot-v1' }, treeDigest: 'd'.repeat(64) }, caseDefinitions: { cases: [recovery] } };
  const oldLink = { id: 'process-run-evidence-link-12345678-1234-1234-1234-123456789abc', linkHash: 'e'.repeat(64),
    behaviorEvaluation: { planId: plan.id, planHash: plan.planHash, result: 'TEST_PASS' },
    run: { id: 'execution-run-12345678-1234-1234-1234-123456789abc', status: 'SUCCEEDED' } };
  const requirement = { id: 'REQ-PROC-123456789abc', criterionContractHistory: [contract], processRunEvidenceLinks: [oldLink] };
  const other = { id: 'REQ-PROC-abcdef123456', statement: 'Other' };
  const changeCase = { tenantId: 'tenant', projectId: 'project', id: 'case', artifacts: { requirements: { requirements: [requirement, other] } } };
  const mapping = buildT91R2RecoveryMapping({ changeCase, requirement, plan });
  assert.equal(mapping.subcaseId, 'R2');
  assert.equal(mapping.harnessId, T91_R2_SHARED_DRAFT_RECOVERY_HARNESS.id);
  assert.equal(mapping.criterionHash, 'f'.repeat(64));
  assert.equal(mapping.selectedRequirementHash, digest(requirement));
  assert.equal(mapping.selectedRequirementSnapshotHash, digest(mapping.selectedRequirementSnapshot));
  assert.equal(mapping.otherRequirementId, other.id);
  assert.equal(mapping.otherRequirementSnapshotHash, digest(mapping.otherRequirementSnapshot));
  assert.equal(isSupportedT91R2RecoveryDefinition({ mapping, plan }), true);
  const changedOther = { ...other, rationale: 'A later owner edit changes B.' };
  const readbackAfterOtherEdit = buildT91R2RecoveryMapping({ changeCase: { ...changeCase,
    artifacts: { requirements: { requirements: [requirement, changedOther] } } }, requirement, plan,
  selectedRequirementSnapshot: mapping.selectedRequirementSnapshot,
  otherRequirementSnapshot: mapping.otherRequirementSnapshot });
  assert.equal(readbackAfterOtherEdit.mappingHash, mapping.mappingHash,
    'historical mapping verification remains stable from its immutable requirement snapshots');
  const requestHash = '9'.repeat(64);
  const reservationHash = '8'.repeat(64);
  const invocationId = 't91-r2-fixture-invocation-12345678-1234-1234-1234-123456789abc';
  const templateHash = mapping.fixtureTemplateHash;
  const fixtureHash = t91R2RecoveryFixtureHash({ mapping, requestHash, fixtureTemplateHash: templateHash, invocationId });
  const stable = { caseVersion: 12, eventCount: 20, runCount: 1, auditCount: 20, outboxCount: 0, digest: '7'.repeat(64) };
  const observation = { terminal: true, fixtureHash, fixtureTemplateHash: templateHash, invocationId,
    fixtureCaseId: 'change-case-12345678-1234-1234-1234-123456789abc', reservationHash,
    old: { sourcePlanId: plan.id, sourcePlanHash: plan.planHash, sourceLinkId: oldLink.id, sourceLinkHash: oldLink.linkHash,
      sourceRunId: oldLink.run.id, fixturePlanId: 'fixture-plan-v1', fixturePlanHash: '6'.repeat(64),
      fixtureLinkId: 'fixture-link-v1', fixtureLinkHash: '5'.repeat(64), fixtureRunId: 'fixture-run-v1', draftRevision: 4,
      ownerSelectedRequirementHash: mapping.selectedRequirementHash, selectedRequirementHashBefore: 'a'.repeat(64),
      selectedRequirementHashAfter: 'a'.repeat(64), ownerOtherRequirementId: mapping.otherRequirementId,
      ownerOtherRequirementHash: mapping.otherRequirementHash, otherRequirementId: 'fixture-requirement-b',
      otherRequirementHashBefore: 'b'.repeat(64), otherRequirementHashAfter: 'c'.repeat(64),
      planStatusAfterEdit: 'REGENERATION_REQUIRED', linkStatusAfterEdit: 'STALE',
      regenerationReason: 'SHARED_REQUIREMENTS_DRAFT_CHANGED', oldPlanHashAfterEdit: '6'.repeat(64) },
    staleAttempt: { httpStatus: 409, errorCode: 'BEHAVIOR_TEST_PLAN_STALE', before: stable, after: structuredClone(stable) },
    fresh: { planId: 'fixture-plan-v2', planHash: '4'.repeat(64), draftRevision: 5, criterionContractVersion: 1,
      runId: 'fixture-run-v2', runStatus: 'SUCCEEDED', checkOutputHash: '3'.repeat(64), linkId: 'fixture-link-v2',
      linkHash: '2'.repeat(64), linkPlanId: 'fixture-plan-v2', linkPlanHash: '4'.repeat(64), linkRunId: 'fixture-run-v2',
      oldPlanHashStillPresent: '6'.repeat(64), oldLinkHashStillPresent: '5'.repeat(64),
      ownerSelectedRequirementHash: mapping.selectedRequirementHash, fixtureSelectedRequirementHash: 'a'.repeat(64) } };
  const classify = (value) => classifyT91R2RecoveryObservation({ observation: value, mapping, requestHash,
    fixtureTemplateHash: templateHash, invocationId, reservationHash });
  assert.equal(classify(observation).status, 'PASS');
  assert.equal(classify({ ...observation, fresh: { ...observation.fresh, fixtureSelectedRequirementHash: 'd'.repeat(64) } }).status, 'INCONCLUSIVE');
  assert.equal(classify({ ...observation, staleAttempt: { ...observation.staleAttempt,
    before: { caseVersion: 1 }, after: { caseVersion: 1 } } }).status, 'INCONCLUSIVE');
});

test('R1 persisted receipt classification requires the observed fixture case pin for PASS', () => {
  const mapping = { mappingHash: '1'.repeat(64), oldPlanId: 'owner-v1-plan', oldPlanHash: '2'.repeat(64),
    oldLinkId: 'owner-v1-link', oldLinkHash: '3'.repeat(64), oldRunId: 'owner-v1-run', harnessHash: '4'.repeat(64) };
  const requestHash = '5'.repeat(64);
  const fixtureTemplateHash = T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH;
  const invocationId = 't91-n2-fixture-invocation-12345678-1234-1234-1234-123456789abc';
  const reservationHash = '6'.repeat(64);
  const before = { caseVersion: 2, eventCount: 3, planCount: 1, linkCount: 1,
    evaluationCount: 1, reviewCount: 0, runCount: 1, auditCount: 10, outboxCount: 10, digest: '7'.repeat(64) };
  const oldPlanHashAfterRevision = '8'.repeat(64);
  const observation = { terminal: true, invocationId, fixtureTemplateHash, fixtureCaseId: 'change-case-12345678-1234-1234-1234-123456789abc',
    reservationHash, fixtureHash: t91R1RecoveryFixtureHash({ mapping, requestHash, fixtureTemplateHash, invocationId }),
    old: { sourcePlanId: mapping.oldPlanId, sourcePlanHash: mapping.oldPlanHash,
      sourceLinkId: mapping.oldLinkId, sourceLinkHash: mapping.oldLinkHash, sourceRunId: mapping.oldRunId,
      fixturePlanId: 'fixture-v1-plan', fixturePlanHash: oldPlanHashAfterRevision, fixtureCriterionContractVersion: 1,
      fixtureLinkId: 'fixture-v1-link', fixtureLinkHash: '9'.repeat(64), fixtureRunId: 'fixture-v1-run',
      planStatusAfterRevision: 'REGENERATION_REQUIRED', linkStatusAfterRevision: 'STALE', oldPlanHashAfterRevision },
    staleAttempt: { httpStatus: 409, errorCode: 'BEHAVIOR_TEST_PLAN_STALE', before, after: structuredClone(before) },
    fresh: { planId: 'fixture-v2-plan', planHash: 'a'.repeat(64), criterionContractVersion: 2,
      runId: 'fixture-v2-run', runStatus: 'SUCCEEDED', checkOutputHash: 'b'.repeat(64),
      linkId: 'fixture-v2-link', linkHash: 'c'.repeat(64), linkPlanId: 'fixture-v2-plan',
      linkPlanHash: 'a'.repeat(64), linkRunId: 'fixture-v2-run', oldPlanHashStillPresent: oldPlanHashAfterRevision } };
  const classify = (value) => classifyT91R1RecoveryObservation({ observation: value, mapping, requestHash,
    fixtureTemplateHash, invocationId, reservationHash });
  assert.equal(classify(observation).status, 'PASS');
  assert.equal(classify({ ...observation, fixtureCaseId: null }).status, 'INCONCLUSIVE',
    'a missing observed fixture case cannot be read back as PASS');
  assert.equal(classify({ ...observation, fixtureCaseId: 'unknown-case' }).status, 'INCONCLUSIVE');
  assert.equal(classifyT91R1RecoveryObservation({ observation: { terminal: false, invocationId: null,
    fixtureTemplateHash: null, fixtureHash: null, fixtureCaseId: null, reservationHash,
    old: null, staleAttempt: null, fresh: null }, mapping, requestHash,
  fixtureTemplateHash, invocationId: null, reservationHash }).status, 'INCONCLUSIVE',
  'a provider failure before invocation evidence is available remains inconclusive');
});

test('N3 mapping pins the exact source-failing test path, bytes, exit code and deletion oracle', () => {
  const parent = { type: 'NEGATIVE', criterionId: 'LEARN-OUTCOME', authoredBy: 'owner',
    sourceRef: { snapshotHash: 'a'.repeat(64) },
    dataset: { cases: [{ id: 'N3', mutation: 'DELETE_UNAUTHORIZED_TEST', path: 'tests/learning.test.js', sourceExpectedExitCode: 1 }] },
    expectedOutput: { cases: [{ id: 'N3', status: 'FAILED', deletedPathRejected: true, verifierDispatched: false }] } };
  const criterion = { id: 'LEARN-OUTCOME', text: 'The process output is supported.', mandatory: true };
  const contract = { version: 1, contentHash: 'b'.repeat(64), criteria: [criterion] };
  const plan = { id: 'behavior-test-plan-12345678-1234-1234-1234-123456789abc', planHash: 'c'.repeat(64),
    repository: { source: { snapshotId: 'snapshot' }, treeDigest: 'd'.repeat(64) },
    caseDefinitions: { cases: [parent] }, criterionContractVersion: 1, criterionContractHash: contract.contentHash };
  const requirement = { id: 'REQ-PROC-123456789abc', criterionContractHistory: [contract] };
  const changeCase = { tenantId: 'tenant', projectId: 'project', id: 'case' };
  const mapping = buildT91N3DeletedFailingTestMapping({ changeCase, requirement, plan });
  assert.equal(mapping.subcaseId, 'N3');
  assert.equal(mapping.candidatePath, 'tests/learning.test.js');
  assert.equal(mapping.sourceTestBytesHash, T91_N3_DELETED_FAILING_TEST_HARNESS.sourceBytesHash);
  assert.equal(mapping.sourceExpectedExitCode, 1);
  assert.equal(mapping.mappingHash.length, 64);
  assert.equal(isSupportedT91N3DeletedFailingTestDefinition({ mapping, plan }), true);
  assert.equal(buildT91N3DeletedFailingTestMapping({ changeCase, requirement, plan: {
    ...plan, caseDefinitions: { cases: [{ ...parent,
      dataset: { cases: [{ ...parent.dataset.cases[0], path: 'tests/other.test.js' }] } }] },
  } }), null);
  assert.equal(buildT91N3DeletedFailingTestMapping({ changeCase, requirement, plan: {
    ...plan, caseDefinitions: { cases: [{ ...parent,
      expectedOutput: { cases: [{ ...parent.expectedOutput.cases[0], verifierDispatched: true }] } }] },
  } }), null);
});

test('N3 classifier requires the pinned failing source TAP and exact pre-verifier deletion', () => {
  const parent = { type: 'NEGATIVE', criterionId: 'LEARN-OUTCOME', authoredBy: 'owner', sourceRef: { snapshotHash: 'a'.repeat(64) },
    dataset: { cases: [{ id: 'N3', mutation: 'DELETE_UNAUTHORIZED_TEST', path: 'tests/learning.test.js', sourceExpectedExitCode: 1 }] },
    expectedOutput: { cases: [{ id: 'N3', status: 'FAILED', deletedPathRejected: true, verifierDispatched: false }] } };
  const criterion = { id: 'LEARN-OUTCOME', text: 'The process output is supported.', mandatory: true };
  const contract = { version: 1, contentHash: 'b'.repeat(64), criteria: [criterion] };
  const plan = { id: 'behavior-test-plan-12345678-1234-1234-1234-123456789abc', planHash: 'c'.repeat(64),
    repository: { source: { snapshotId: 'snapshot' }, treeDigest: 'd'.repeat(64) }, caseDefinitions: { cases: [parent] },
    criterionContractVersion: 1, criterionContractHash: contract.contentHash };
  const requirement = { id: 'REQ-PROC-123456789abc', criterionContractHistory: [contract] };
  const mapping = buildT91N3DeletedFailingTestMapping({ changeCase: { tenantId: 'tenant', projectId: 'project', id: 'case' }, requirement, plan });
  const requestHash = 'e'.repeat(64);
  const reservationHash = 'f'.repeat(64);
  const invocationId = 't91-n3-fixture-invocation-12345678-1234-1234-1234-123456789abc';
  const tap = ['TAP version 13', 'not ok 1 - pinned criterion fails on the candidate', '  error: |', '    1 !== 2',
    '1..1', '# tests 1', '# pass 0', '# fail 1', '# cancelled 0', '# skipped 0', '# todo 0', ''].join('\n');
  const fixtureHash = t91N3DeletedFailingTestFixtureHash({ mapping, requestHash,
    fixtureTemplateHash: T91_N3_PRODUCT_FIXTURE_TEMPLATE_HASH, invocationId });
  const observation = { terminal: true, fixtureHash, fixtureTemplateHash: T91_N3_PRODUCT_FIXTURE_TEMPLATE_HASH,
    invocationId, reservationHash, sourceStage: { path: 'tests/learning.test.js', bytesHash: mapping.sourceTestBytesHash,
      treeDigest: '1'.repeat(64), exitCode: 1, tap, terminal: true },
    candidate: { treeDigest: '2'.repeat(64), deletedPath: 'tests/learning.test.js', deletedPathHash: mapping.sourceTestBytesHash,
      changes: [{ path: 'tests/learning.test.js', change: 'deleted', beforeHash: mapping.sourceTestBytesHash }] },
    run: { id: 'execution-run-12345678-1234-1234-1234-123456789abc', status: 'FAILED',
      errorCode: 'BEHAVIOR_CANDIDATE_ORPHAN_PATH' }, verifierDispatchCount: 0 };
  const classify = (value) => classifyT91N3DeletedFailingTestObservation({ observation: value, mapping, requestHash,
    fixtureTemplateHash: T91_N3_PRODUCT_FIXTURE_TEMPLATE_HASH, invocationId, reservationHash });
  assert.equal(classify(observation).status, 'PASS');
  assert.equal(classify({ ...observation, verifierDispatchCount: 1 }).status, 'FAIL');
  assert.equal(classify({ ...observation, sourceStage: { ...observation.sourceStage, exitCode: 0 } }).status, 'INCONCLUSIVE');
  assert.equal(classify({ ...observation, candidate: { ...observation.candidate, deletedPath: 'tests/other.test.js' } }).status,
    'INCONCLUSIVE');
});

test('N2.MISSING_ASSERTION mapping binds a saved required assertion, N2 oracle, plan and repository pins separately', () => {
  const parent = { type: 'NEGATIVE', criterionId: 'LEARN-OUTCOME', authoredBy: 'owner',
    sourceRef: { snapshotHash: 'a'.repeat(64) },
    dataset: { cases: [{ id: 'N2', criterionId: 'LEARN-OUTCOME', mandatory: true, assertions: [] }] },
    expectedOutput: { cases: [{ id: 'N2', missingNamedAssertionLinkStatus: 409,
      missingNamedAssertionError: 'BEHAVIOR_CANDIDATE_REJECTED', caseVersionChanged: false, evidenceLinkCreated: false }] } };
  const criterion = { id: 'LEARN-OUTCOME', text: 'The process output is supported.', mandatory: true };
  const contract = { version: 1, contentHash: 'b'.repeat(64), criteria: [criterion] };
  const plan = { id: 'behavior-test-plan-12345678-1234-1234-1234-123456789abc', planHash: 'c'.repeat(64),
    repository: { source: { snapshotId: 'snapshot' }, treeDigest: 'd'.repeat(64) },
    caseDefinitions: { cases: [parent] }, criterionContractVersion: 1, criterionContractHash: contract.contentHash,
    assertions: [{ id: 'required-check', testName: 'Exact mandatory assertion', criterionId: 'LEARN-OUTCOME' }] };
  const requirement = { id: 'REQ-PROC-123456789abc', criterionContractHistory: [contract] };
  const mapping = buildT91N2MissingAssertionMapping({ changeCase: { tenantId: 'tenant', projectId: 'project', id: 'case' },
    requirement, plan });
  assert.equal(mapping.subcaseId, 'N2.MISSING_ASSERTION');
  assert.equal(mapping.harnessId, T91_N2_MISSING_ASSERTION_HARNESS.id);
  assert.equal(mapping.requiredPlanAssertionName, 'Exact mandatory assertion');
  assert.equal(mapping.planHash, plan.planHash);
  assert.equal(mapping.oracleHash.length, 64);
  assert.equal(mapping.mappingHash.length, 64);
});

test('N2.MISSING_ASSERTION classifier requires a terminal complete passing TAP check and terminal link response', () => {
  const mapping = { harnessId: T91_N2_MISSING_ASSERTION_HARNESS.id, harnessVersion: 1,
    harnessHash: 'a'.repeat(64), assertionId: T91_N2_MISSING_ASSERTION_HARNESS.assertionId,
    assertionHash: 'b'.repeat(64), requiredPlanAssertionId: 'required-check',
    requiredPlanAssertionName: 'Exact mandatory assertion', requiredPlanAssertionHash: 'c'.repeat(64) };
  const fixtureRequestHash = 'd'.repeat(64);
  const currentReservationHash = 'e'.repeat(64);
  const currentInvocationId = 't91-n2-fixture-invocation-12345678-1234-1234-1234-123456789abc';
  const stdout = [
    'TAP version 13', 'ok 1 - Fixed synthetic scenario contract', '1..1', '# tests 1',
    '# pass 1', '# fail 0', '# cancelled 0', '# skipped 0', '# todo 0', '',
  ].join('\n');
  const counter = { caseVersion: 3, eventCount: 5, linkCount: 0, evaluationCount: 0, reviewCount: 0,
    auditCount: 5, outboxCount: 5, digest: 'f'.repeat(64) };
  const check = { id: 't91-n2-inert-check', status: 'PASSED', executionStatus: 'COMPLETED', exitCode: 0,
    checkVersion: '1.0.0', planHash: '1'.repeat(64), commandHash: '2'.repeat(64),
    candidateTreeDigest: '3'.repeat(40), candidateTreeDigestAfter: '3'.repeat(40),
    stdoutTruncated: false, stderrTruncated: false, stdout, stderr: '', outputHash: '4'.repeat(64) };
  const fixturePlan = { id: 'behavior-test-plan-12345678-1234-1234-1234-123456789abc',
    planHash: '5'.repeat(64), httpStatus: 201 };
  const requiredAssertion = { id: mapping.requiredPlanAssertionId, name: mapping.requiredPlanAssertionName,
    status: 'UNKNOWN', reason: 'ASSERTION_RESULT_NOT_FOUND' };
  const run = { id: 'execution-run-12345678-1234-1234-1234-123456789abc', status: 'SUCCEEDED',
    planId: fixturePlan.id, planHash: fixturePlan.planHash, checkId: check.id,
    tapHash: digest(stdout), outputHash: check.outputHash, check, assertion: requiredAssertion };
  const before = { ...counter };
  const after = { ...counter };
  const attempt = { terminal: true, fixtureCaseId: 'change-case-12345678-1234-1234-1234-123456789abc',
    httpStatus: 409, errorCode: 'BEHAVIOR_CANDIDATE_REJECTED', before, after };
  const fixtureHash = t91N2MissingAssertionFixtureHash({ mapping, requestHash: fixtureRequestHash,
    fixtureTemplateHash: T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH, invocationId: currentInvocationId });
  const completeObservation = { terminal: true, fixtureHash,
    fixtureTemplateHash: T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH, invocationId: currentInvocationId,
    reservationHash: currentReservationHash, fixturePlan, run, attempt };
  const classify = (value) => classifyT91N2MissingAssertionObservation({ observation: value, mapping,
    requestHash: fixtureRequestHash, fixtureTemplateHash: T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH,
    invocationId: currentInvocationId, reservationHash: currentReservationHash });
  assert.equal(classify(completeObservation).status, 'PASS');
  assert.equal(classify({ ...completeObservation, attempt: { ...attempt, terminal: false } }).status, 'INCONCLUSIVE');
  assert.equal(classify({ ...completeObservation, run: { ...run,
    check: { ...check, stdoutTruncated: true } } }).status, 'INCONCLUSIVE');
  assert.equal(classify({ ...completeObservation, run: { ...run, check: null } }).status, 'INCONCLUSIVE');
});
