import assert from 'node:assert/strict';
import test from 'node:test';
import { digest } from '../../src/sdlc/contracts.mjs';
import { behaviorEvaluationVersionFields } from '../../src/platform/postgres-stores.mjs';
import { candidateChangesCoveredByPathMap, deriveScenarioMappingEvidence, nodeTestCommandTargetsFile, parseNodeTestAssertions, processBehaviorCandidateDisposition, verifyProcessBehaviorTestPlan } from '../../src/sdlc/behavior-test-evidence.mjs';
import { buildT91N2AuthorizationMapping, isIndependentT91N2MappingReviewer,
  projectT91N2AuthorizationExecutionIntegrity, classifyT91N2AuthorizationObservation,
  isSupportedT91N2AuthorizationDefinition, t91N2AuthorizationFixtureHash,
  verifyT91N2AuthorizationReservationPins,
  verifyT91N2AuthorizationMapping } from '../../src/sdlc/product-harness.mjs';

function fixture() {
  const hash = (value) => digest(value);
  const source = { blueprintSnapshotHash: hash('blueprint'), processSnapshotHash: hash('process'), bindingHash: hash('binding') };
  const checkPlanHash = hash('check-plan');
  const check = { id: 'unit-check', version: '1', commandHash: hash('command'), planHash: checkPlanHash };
  const criterionContractVersion = 1;
  const criteria = [
    { id: 'criterion-one', text: 'An approved task is created.', type: 'BUSINESS', mandatory: true,
      source: { id: 'process-approved', type: 'process', snapshotHash: source.processSnapshotHash },
      scope: { id: 'process-approved', type: 'process', snapshotHash: source.processSnapshotHash } },
    { id: 'criterion-two', text: 'An unapproved task is rejected.', type: 'BUSINESS', mandatory: true,
      source: { id: 'process-approved', type: 'process', snapshotHash: source.processSnapshotHash },
      scope: { id: 'process-approved', type: 'process', snapshotHash: source.processSnapshotHash } },
  ];
  const criterionContractHash = hash({ version: criterionContractVersion, criteria });
  const assertions = [
    { id: 'assert-one', testName: 'creates an approved task', expected: 'PASS', criterionIndex: 0,
      criterionId: criteria[0].id, criterionContractVersion, criterion: criteria[0], criterionHash: hash(criteria[0]),
      outcome: { id: 'output-created' }, scope: { id: 'process-approved' }, risk: { status: 'LINKED', refs: [{ id: 'risk-control', snapshotHash: hash('risk') }] }, source, check },
    { id: 'assert-two', testName: 'rejects an unapproved task', expected: 'PASS', criterionIndex: 1,
      criterionId: criteria[1].id, criterionContractVersion, criterion: criteria[1], criterionHash: hash(criteria[1]),
      outcome: { id: 'output-rejected' }, scope: { id: 'process-approved' }, risk: { status: 'LINKED', refs: [{ id: 'risk-control', snapshotHash: hash('risk') }] }, source, check },
  ];
  const repository = { kind: 'github-app', treeDigest: hash('tree'), source: { snapshotId: hash('snapshot') },
    selectedFiles: [{ path: 'test.mjs', mode: '100644', size: 10, contentHash: hash('file') }] };
  const fileMappings = [{ path: 'test.mjs', role: 'TEST', criterionIds: criteria.map((entry) => entry.id) }];
  const core = { schemaVersion: 2, id: 'behavior-test-plan-test', tenantId: 'tenant-a', projectId: 'project-a',
    caseId: 'case-a', requirementId: 'REQ-PROC-123456789abc', requirementHash: hash('req'), draftRevision: 1,
    criterionContractVersion, criterionContractHash,
    traceHash: hash('trace'), source, processPlan: { id: 'process-plan-a', revision: 1, hash: hash('plan'), taskId: 'task-a', taskHash: hash('task') },
    repository, repositoryHash: hash(repository), fileMappings, checkPlan: { hash: checkPlanHash }, assertions,
    status: 'AUTHORIZED_BEFORE_EXECUTION', createdAt: '2026-10-07T10:00:00.000Z', createdBy: 'oidc:owner' };
  return { ...core, planHash: hash(core) };
}

function receipt(stdout, overrides = {}) {
  const stderr = '';
  return { checkId: 'unit-check', checkVersion: '1', commandHash: digest('command'),
    planHash: digest('check-plan'), status: 'PASSED', executionStatus: 'COMPLETED', exitCode: 0,
    stdout, stderr, stdoutTruncated: false, stderrTruncated: false,
    candidateTreeDigest: digest('tree'), candidateTreeDigestAfter: digest('tree'),
    outputHash: digest({ stdout, stderr }), ...overrides };
}

function mappedFixture() {
  const plan = fixture();
  const sourceSnapshotId = digest('snapshot');
  const testPath = 'test.mjs';
  const testFileHash = plan.repository.selectedFiles[0].contentHash;
  plan.source.blueprintId = 'blueprint-a';
  plan.source.blueprintVersion = 1;
  for (const assertion of plan.assertions) assertion.source = plan.source;
  plan.repository.source = { snapshotId: sourceSnapshotId, repositoryId: 'repo-a',
    branchRef: 'refs/heads/main', commitOid: 'c'.repeat(40) };
  const requiredCheck = { id: 'unit-check', version: '1', commandHash: digest('command'),
    executable: process.execPath, args: ['--test', '--test-reporter=tap', testPath] };
  plan.assertions[0].check = { ...plan.assertions[0].check,
    executable: requiredCheck.executable, args: [...requiredCheck.args] };
  plan.assertions[1].check = { ...plan.assertions[1].check,
    executable: requiredCheck.executable, args: [...requiredCheck.args] };
  plan.repository.checkPlan = { planHash: digest('repository-check-plan'), requiredChecks: [requiredCheck] };
  plan.repositoryHash = digest(plan.repository);
  plan.schemaVersion = 4;
  plan.evaluationContext = { schemaVersion: 1,
    workspace: { projectId: plan.projectId, blueprintId: plan.source.blueprintId,
      blueprintVersion: plan.source.blueprintVersion, processTraceHash: plan.traceHash },
    branch: { snapshotId: sourceSnapshotId, treeDigest: plan.repository.treeDigest,
      repositoryId: plan.repository.source.repositoryId, branchRef: plan.repository.source.branchRef,
      commitOid: plan.repository.source.commitOid },
    effectiveTime: { status: 'OWNER_ASSERTED', assertedBy: plan.createdBy,
      value: '2026-10-07T10:00:00.000Z', sourceRef: { id: 'input-effective-time', snapshotHash: digest('time-input') } } };
  const positive = { id: 'positive', type: 'POSITIVE', definition: 'A declared positive case is evaluated.',
    criterionId: 'criterion-one', criterionHash: digest(plan.assertions[0].criterion),
    sourceRef: { id: 'output-created', type: 'output', snapshotHash: digest('output') },
    dataset: { input: 'positive' }, expectedOutput: { output: 'created' }, status: 'NOT_EXECUTED', authoredBy: plan.createdBy,
    executionMapping: { status: 'OWNER_PROPOSED_UNVERIFIED', assertionId: 'assert-one',
      testName: plan.assertions[0].testName, testPath, testFileHash, repositorySnapshotId: sourceSnapshotId,
      repositoryTreeDigest: plan.repository.treeDigest, assertionHash: digest(plan.assertions[0]) } };
  const negative = { id: 'negative', type: 'NEGATIVE', definition: 'A declared negative case is rejected.',
    criterionId: 'criterion-two', criterionHash: digest(plan.assertions[1].criterion),
    sourceRef: { id: 'risk-control', type: 'risk', snapshotHash: digest('risk') },
    dataset: { criterionId: 'criterion-two', mandatory: true, assertions: [] },
    expectedOutput: { status: 400, planSaved: false },
    status: 'NOT_EXECUTED', authoredBy: plan.createdBy, executionMapping: { status: 'INCOMPLETE' } };
  const recovery = { id: 'recovery', type: 'RECOVERY', definition: 'A declared recovery case restores state.',
    criterionId: 'criterion-two', criterionHash: digest(plan.assertions[1].criterion),
    sourceRef: { id: 'process-approved', type: 'process', snapshotHash: plan.source.processSnapshotHash },
    dataset: { fromCriterionVersion: 1, toCriterionVersion: 2, retainHistory: true },
    expectedOutput: { oldPlanStatus: 'REGENERATION_REQUIRED', staleExecutionError: 'BEHAVIOR_TEST_PLAN_STALE' },
    status: 'NOT_EXECUTED', authoredBy: plan.createdBy, executionMapping: { status: 'INCOMPLETE' } };
  plan.caseDefinitions = { schemaVersion: 1, status: 'OWNER_AUTHORED_NOT_EXECUTED',
    mappingStatus: 'INCOMPLETE', cases: [positive, negative, recovery] };
  const { planHash: _planHash, ...core } = plan;
  plan.planHash = digest(core);
  return plan;
}

function passingAssertionResult(plan, overrides = {}) {
  const assertion = plan.assertions[0];
  return { id: assertion.id, testName: assertion.testName, criterionIndex: assertion.criterionIndex,
    status: 'TEST_PASS', checkId: assertion.check.id, checkVersion: assertion.check.version,
    commandHash: assertion.check.commandHash, checkPlanHash: assertion.check.planHash,
    candidateTreeDigest: digest('candidate-tree'), outputHash: digest('tap-output'), ...overrides };
}

function candidateFor(plan, overrides = {}) {
  return { sourceSnapshotId: plan.repository.source.snapshotId, sourceTreeDigest: plan.repository.treeDigest,
    treeDigest: digest('candidate-tree'), changes: [{ path: 'src/implementation.mjs', change: 'modified' }], ...overrides };
}

test('behavior-test plan maps exact declared criteria and parses only persisted unique TAP outcomes', () => {
  const plan = fixture();
  assert.equal(verifyProcessBehaviorTestPlan(plan), true);
  assert.deepEqual(parseNodeTestAssertions('TAP version 13\nok 1 - creates an approved task\nnot ok 2 - rejects an unapproved task\n', plan,
    receipt('TAP version 13\nok 1 - creates an approved task\nnot ok 2 - rejects an unapproved task\n')).map((entry) => entry.status), ['TEST_PASS', 'TEST_FAIL']);
});

test('legacy behavior evaluations retain the exact v1 field shape while mapped plans use v2', () => {
  const legacy = behaviorEvaluationVersionFields({ schemaVersion: 3 }, [{ caseId: 'case-positive' }]);
  assert.deepEqual(legacy, { schemaVersion: 1 });
  const current = behaviorEvaluationVersionFields({ schemaVersion: 4 }, [{ caseId: 'case-positive' }]);
  assert.deepEqual(current, { schemaVersion: 2, scenarioMappings: [{ caseId: 'case-positive' }] });
  const intermediate = behaviorEvaluationVersionFields({ schemaVersion: 4 }, [{ caseId: 'case-positive' }], 1);
  assert.deepEqual(intermediate, { schemaVersion: 1 },
    'a v4 plan can reconstruct the hash-protected v1 evaluation shape persisted before v2 was introduced');
  assert.equal(behaviorEvaluationVersionFields({ schemaVersion: 3 }, [], 2), null,
    'v2 mappings cannot be retrofitted onto a historical v3 plan');
});

test('missing, skipped, truncated, duplicate and tampered assertion output cannot pass', () => {
  const plan = fixture();
  const missing = 'TAP version 13\nok 1 - creates an approved task\n';
  assert.equal(parseNodeTestAssertions(missing, plan, receipt(missing))[1].status, 'UNKNOWN');
  const skipped = 'TAP version 13\nok 1 - creates an approved task\nok 2 - rejects an unapproved task # SKIP fixture unavailable\n';
  assert.equal(parseNodeTestAssertions(skipped, plan, receipt(skipped))[1].status, 'UNKNOWN');
  const duplicate = 'TAP version 13\nok 1 - creates an approved task\nok 2 - creates an approved task\nok 3 - rejects an unapproved task\n';
  assert.equal(parseNodeTestAssertions(duplicate, plan, receipt(duplicate)), null);
  const complete = 'ok 1 - creates an approved task\nok 2 - rejects an unapproved task\n';
  assert.equal(parseNodeTestAssertions(complete, plan, receipt(complete, { stdoutTruncated: true }))[0].status, 'UNKNOWN');
  assert.equal(parseNodeTestAssertions(`${complete}tampered`, plan, receipt(complete)), null);
  const missingResults = parseNodeTestAssertions(missing, plan, receipt(missing));
  const skippedResults = parseNodeTestAssertions(skipped, plan, receipt(skipped));
  assert.equal(processBehaviorCandidateDisposition({ evaluationStatus: 'CHECKED_BEHAVIOR', riskCoverage: 'LINKED', assertions: missingResults }), 'REJECTED',
    'deleting or omitting a preauthorized test leaves no named result and rejects candidate admission');
  assert.equal(processBehaviorCandidateDisposition({ evaluationStatus: 'CHECKED_BEHAVIOR', riskCoverage: 'LINKED', assertions: skippedResults }), 'REJECTED');
  assert.equal(processBehaviorCandidateDisposition({ evaluationStatus: 'CHECKED_BEHAVIOR', riskCoverage: 'LINKED',
    assertions: [{ status: 'TEST_PASS' }, { status: 'TEST_FAIL' }] }), 'REJECTED');
  assert.equal(processBehaviorCandidateDisposition({ evaluationStatus: 'CHECKED_BEHAVIOR', riskCoverage: 'UNKNOWN',
    assertions: [{ status: 'TEST_PASS' }] }), 'BLOCKED_INCOMPLETE');
  assert.equal(processBehaviorCandidateDisposition({ evaluationStatus: 'CHECKED_BEHAVIOR', riskCoverage: 'LINKED',
    assertions: [{ status: 'TEST_PASS' }] }), 'PENDING_INDEPENDENT_REVIEW');
});

test('owner-proposed scenario mappings verify only to the exact passing pinned assertion', () => {
  const plan = mappedFixture();
  assert.equal(verifyProcessBehaviorTestPlan(plan), true);
  assert.deepEqual(plan.caseDefinitions.cases[1].dataset, { criterionId: 'criterion-two', mandatory: true, assertions: [] });
  assert.equal(plan.caseDefinitions.cases[1].executionMapping.status, 'INCOMPLETE',
    'a typed negative dataset/oracle can be saved before its product-path test mapping is available');
  const evidence = deriveScenarioMappingEvidence({ plan, assertionResults: [passingAssertionResult(plan)],
    candidate: candidateFor(plan), checkEvidenceVerified: true });
  assert.equal(evidence[0].status, 'VERIFIED_TO_PASSING_ASSERTION');
  assert.equal(evidence[0].scope, 'ASSERTION_LINKAGE_ONLY');
  assert.equal(evidence[0].caseStatus, 'NOT_EXECUTED');
  assert.equal(evidence[1].status, 'INCOMPLETE');
  assert.equal(evidence[2].status, 'INCOMPLETE');

  const wrongFile = structuredClone(plan);
  wrongFile.repository.selectedFiles.push({ path: 'other.test.mjs', mode: '100644', size: 20,
    contentHash: digest('other-test-file') });
  wrongFile.fileMappings.push({ path: 'other.test.mjs', role: 'TEST', criterionIds: ['criterion-one'] });
  wrongFile.caseDefinitions.cases[0].executionMapping.testPath = 'other.test.mjs';
  wrongFile.caseDefinitions.cases[0].executionMapping.testFileHash = digest('other-test-file');
  wrongFile.repositoryHash = digest(wrongFile.repository);
  const { planHash: _wrongFileHash, ...wrongFileCore } = wrongFile;
  wrongFile.planHash = digest(wrongFileCore);
  assert.equal(verifyProcessBehaviorTestPlan(wrongFile), true);
  const wrongFileEvidence = deriveScenarioMappingEvidence({ plan: wrongFile,
    assertionResults: [passingAssertionResult(wrongFile)], candidate: candidateFor(wrongFile), checkEvidenceVerified: true });
  assert.equal(wrongFileEvidence[0].status, 'UNVERIFIED');
  assert.equal(wrongFileEvidence[0].reason, 'CHECK_COMMAND_DOES_NOT_TARGET_MAPPED_TEST_FILE');

  for (const corrupt of [
    (value) => { value.caseDefinitions.cases[0].executionMapping.testFileHash = digest('wrong-hash'); },
    (value) => { value.caseDefinitions.cases[0].executionMapping.assertionId = 'assert-two'; },
  ]) {
    const altered = structuredClone(plan);
    corrupt(altered);
    const { planHash: _oldHash, ...alteredCore } = altered;
    altered.planHash = digest(alteredCore);
    const result = deriveScenarioMappingEvidence({ plan: altered, assertionResults: [passingAssertionResult(altered)],
      candidate: candidateFor(altered), checkEvidenceVerified: true });
    assert.equal(result[0].status, 'UNVERIFIED');
    assert.equal(result[0].reason, 'PLAN_INTEGRITY_INVALID');
  }

  const failedTap = deriveScenarioMappingEvidence({ plan, assertionResults: [passingAssertionResult(plan, { status: 'TEST_FAIL' })],
    candidate: candidateFor(plan), checkEvidenceVerified: true });
  assert.equal(failedTap[0].status, 'UNVERIFIED');
  assert.equal(failedTap[0].reason, 'ASSERTION_RESULT_NOT_PASSING');
  const staleTree = deriveScenarioMappingEvidence({ plan, assertionResults: [passingAssertionResult(plan)],
    candidate: candidateFor(plan, { sourceTreeDigest: digest('stale-tree') }), checkEvidenceVerified: true });
  assert.equal(staleTree[0].status, 'UNVERIFIED');
  assert.equal(staleTree[0].reason, 'SOURCE_TREE_MISMATCH');
  assert.equal(nodeTestCommandTargetsFile({ executable: process.execPath,
    args: ['--test', '--test-reporter=tap', '--test-name-pattern', 'test.mjs', 'other.test.mjs'] }, 'test.mjs'), false,
  'an option value equal to the requested path is consumed as an option value, not treated as an executed file');
  assert.equal(nodeTestCommandTargetsFile({ executable: process.execPath,
    args: ['--test', '--test-reporter=tap', 'test.mjs'] }, 'test.mjs'), true);
  assert.equal(nodeTestCommandTargetsFile({ executable: '/opt/other/node-wrapper',
    args: ['--test', '--test-reporter=tap', 'test.mjs'] }, 'test.mjs'), false,
  'an unsupported executable does not establish file execution');
});

test('candidate diffs require exact path mappings, including additions, deletions and both sides of renames', () => {
  const mapping = [{ path: 'README.md', role: 'IMPLEMENTATION', criterionIds: ['criterion-one'] }];
  assert.equal(candidateChangesCoveredByPathMap(mapping, [{ path: 'README.md', change: 'modified' }]), true);
  assert.equal(candidateChangesCoveredByPathMap(mapping, [
    { path: 'README.md', change: 'modified' }, { path: 'extra.js', change: 'added' },
  ]), false, 'an added unmapped file cannot join the candidate');
  assert.equal(candidateChangesCoveredByPathMap(mapping, [{ path: 'renamed-old.md', change: 'deleted' }]), false,
    'a rename deletion needs its exact path mapping');
  assert.equal(candidateChangesCoveredByPathMap(mapping, [
    { path: 'README.md', change: 'deleted' }, { path: 'renamed-new.md', change: 'added' },
  ]), false, 'both paths in a rename must map before execution');
});

test('fixed N2 product-harness mapping binds parent definition, exact N2 data/oracle and source pins', () => {
  const hash = (value) => digest(value);
  const criterion = { id: 'LEARN-OUTCOME', text: 'Reject missing named assertion cases.', type: 'BUSINESS', mandatory: true };
  const negative = { id: 'negative', type: 'NEGATIVE', definition: 'Reject candidate authorization without a named assertion.',
    criterionId: criterion.id, criterionHash: hash(criterion), sourceRef: { id: 'process-1', type: 'process', snapshotHash: hash('source') },
    dataset: { cases: [{ id: 'N2', criterionId: criterion.id, assertions: [] }] },
    expectedOutput: { cases: [{ id: 'N2', authorizationStatus: 400, planSaved: false,
      caseVersionChanged: false, evidenceLinkCreated: false }] } };
  const changeCase = { id: 'change-case-1', tenantId: 'tenant-1', projectId: 'project-1' };
  const contract = { version: 1, contentHash: hash('contract'), criteria: [criterion] };
  const requirement = { id: 'REQ-PROC-123456789abc', criterionContract: contract, criterionContractHistory: [contract] };
  const plan = { id: 'behavior-test-plan-1', planHash: hash('plan'), criterionContractVersion: 1,
    criterionContractHash: contract.contentHash, repository: { source: { snapshotId: 'snapshot-1' }, treeDigest: hash('tree') },
    caseDefinitions: { cases: [negative] } };
  const mapping = buildT91N2AuthorizationMapping({ changeCase, requirement, plan });
  assert.equal(mapping.subcaseId, 'N2.AUTHORIZATION');
  assert.equal(mapping.parentDefinitionHash, hash(negative));
  assert.equal(mapping.datasetHash, hash(negative.dataset.cases[0]));
  assert.equal(mapping.oracleHash, hash(negative.expectedOutput.cases[0]));
  assert.equal(mapping.planHash, plan.planHash);
  assert.equal(mapping.repositorySnapshotId, 'snapshot-1');
  assert.equal(mapping.repositoryTreeDigest, hash('tree'));
  assert.equal(mapping.criterionContractVersion, 1);
  assert.equal(mapping.criterionContractHash, contract.contentHash);
  assert.equal(mapping.sourceRef.snapshotHash, hash('source'));
  assert.equal(verifyT91N2AuthorizationMapping(mapping, mapping), true);
  assert.equal(verifyT91N2AuthorizationMapping({ ...mapping, oracleHash: hash('altered') }, mapping), false);
  assert.equal(verifyT91N2AuthorizationMapping({ ...mapping, planHash: hash('stale') }, mapping), false);
  assert.equal(isIndependentT91N2MappingReviewer({ reviewerPrincipal: 'plan-author', mappingRequester: 'new-owner',
    planAuthor: 'plan-author', definitionAuthor: 'plan-author' }), false,
  'a former owner who authored the immutable plan cannot review a new owner’s mapping');
  assert.equal(isIndependentT91N2MappingReviewer({ reviewerPrincipal: 'reviewer', mappingRequester: 'new-owner',
    planAuthor: 'plan-author', definitionAuthor: 'plan-author' }), true);
});

test('N2 authorization fixed profile requires the authored oracle and complete control/denial observations', () => {
  const hash = (value) => digest(value);
  const dataset = { id: 'N2', criterionId: 'C-N2', mandatory: true, assertions: [] };
  const oracle = { id: 'N2', authorizationStatus: 400, planSaved: false, caseVersionChanged: false, evidenceLinkCreated: false };
  const definition = { type: 'NEGATIVE', dataset: { cases: [dataset] }, expectedOutput: { cases: [oracle] } };
  const mapping = { id: 'm', criterionId: 'C-N2', parentDefinitionHash: hash(definition), datasetHash: hash(dataset),
    oracleHash: hash(oracle), harnessId: 't91-n2-authorization', harnessVersion: 1, harnessHash: hash('harness'),
    assertionId: 'rejects-empty-assertion-selection', assertionHash: hash('assertion') };
  const plan = { caseDefinitions: { cases: [definition] } };
  assert.equal(isSupportedT91N2AuthorizationDefinition({ mapping, plan }), true);
  const badOracle = { ...plan, caseDefinitions: { cases: [{ ...definition,
    expectedOutput: { cases: [{ ...oracle, authorizationStatus: 409 }] } }] } };
  assert.equal(isSupportedT91N2AuthorizationDefinition({ mapping, plan: badOracle }), false);
  const requestHash = hash('request');
  const fixtureHash = t91N2AuthorizationFixtureHash({ mapping, requestHash });
  const fixtureCaseId = 'change-case-12345678-1234-1234-1234-123456789abc';
  const counters = (caseVersion, eventCount, planCount, auditCount, outboxCount, value) => ({
    caseVersion, eventCount, planCount, auditCount, outboxCount, digest: hash(value),
  });
  const observation = { terminal: true, fixtureHash, control: { terminal: true, httpStatus: 201, fixtureCreated: true,
    acceptedPlanHash: hash('accepted-plan'), fixtureCaseId,
    fixtureHash, before: counters(1, 2, 0, 2, 2, 'before-control'), after: counters(2, 3, 1, 3, 3, 'after-control') },
  attempt: { terminal: true, fixtureCaseId, httpStatus: 400, errorCode: 'INVALID_PROCESS_BEHAVIOR_TEST_PLAN', fixtureHash,
    before: counters(2, 3, 1, 3, 3, 'after-control'), after: counters(2, 3, 1, 3, 3, 'after-control') } };
  assert.deepEqual(classifyT91N2AuthorizationObservation({ observation, mapping, requestHash }), {
    status: 'PASS', noMutationVerified: true, expectedFixtureHash: fixtureHash });
  const incomplete = structuredClone(observation);
  delete incomplete.attempt.after.eventCount;
  assert.equal(classifyT91N2AuthorizationObservation({ observation: incomplete, mapping, requestHash }).status, 'INCONCLUSIVE');
  const missingAuditObservation = structuredClone(observation);
  delete missingAuditObservation.attempt.after.auditCount;
  assert.equal(classifyT91N2AuthorizationObservation({ observation: missingAuditObservation, mapping, requestHash }).status,
    'INCONCLUSIVE', 'missing audit/outbox counters cannot prove no mutation');
  const contradictory = structuredClone(observation);
  contradictory.attempt.after.eventCount += 1;
  assert.equal(classifyT91N2AuthorizationObservation({ observation: contradictory, mapping, requestHash }).status, 'FAIL');
});

test('N2 reservation verification binds the complete hash to the event and every current mapping pin', () => {
  const current = { tenantId: 'tenant-a', projectId: 'project-a', id: 'case-a' };
  const mapping = { id: 'mapping-a', mappingHash: digest('mapping'), planId: 'plan-a', planHash: digest('plan'),
    sourceRef: { sourceHash: digest('source') }, repositorySnapshotId: 'snapshot-a', repositoryTreeDigest: digest('tree'),
    criterionId: 'criterion-a', criterionHash: digest('criterion'), criterionContractVersion: 2,
    criterionContractHash: digest('contract'), parentDefinitionHash: digest('definition'), datasetHash: digest('dataset'),
    oracleHash: digest('oracle'), harnessId: 'harness-a', harnessVersion: 1, harnessHash: digest('harness'),
    assertionId: 'assertion-a', assertionHash: digest('assertion') };
  const review = { id: 'review-a', reviewHash: digest('review') };
  const core = { tenantId: current.tenantId, projectId: current.projectId, caseId: current.id, mappingId: mapping.id,
    mappingHash: mapping.mappingHash, reviewId: review.id, reviewHash: review.reviewHash,
    planId: mapping.planId, planHash: mapping.planHash, sourceRef: mapping.sourceRef,
    repositorySnapshotId: mapping.repositorySnapshotId, repositoryTreeDigest: mapping.repositoryTreeDigest,
    criterionId: mapping.criterionId, criterionHash: mapping.criterionHash,
    criterionContractVersion: mapping.criterionContractVersion, criterionContractHash: mapping.criterionContractHash,
    parentDefinitionHash: mapping.parentDefinitionHash, datasetHash: mapping.datasetHash, oracleHash: mapping.oracleHash,
    harnessId: mapping.harnessId, harnessVersion: mapping.harnessVersion, harnessHash: mapping.harnessHash,
    assertionId: mapping.assertionId, assertionHash: mapping.assertionHash };
  const reservation = { ...core, reservationHash: digest(core) };
  const event = { data: { reservationHash: reservation.reservationHash } };
  assert.equal(verifyT91N2AuthorizationReservationPins({ reservation, event, mapping, review, current }), true);
  assert.equal(verifyT91N2AuthorizationReservationPins({ reservation: { ...reservation, planHash: digest('other') },
    event, mapping, review, current }), false);
  assert.equal(verifyT91N2AuthorizationReservationPins({ reservation, event: { data: { reservationHash: digest('other') } },
    mapping, review, current }), false);
});

test('N2 product-harness read projection marks only hash-pinned verifier results valid', () => {
  const verified = { id: 'execution-a', receiptHash: digest('receipt-a'), status: 'PASS' };
  const altered = { ...verified, receiptHash: digest('altered') };
  const projection = projectT91N2AuthorizationExecutionIntegrity([verified, altered], [
    { id: verified.id, receiptHash: verified.receiptHash },
  ]);
  assert.equal(projection[0].integrityStatus, 'VALID');
  assert.equal(projection[1].integrityStatus, 'INVALID');
  assert.equal(projection[0].status, 'PASS');
  assert.equal(projection[1].status, 'PASS');
  assert.equal(Object.hasOwn(verified, 'integrityStatus'), false);
  assert.equal(Object.hasOwn(altered, 'integrityStatus'), false);
});
