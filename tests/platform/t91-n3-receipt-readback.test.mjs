import assert from 'node:assert/strict';
import test from 'node:test';
import { contentHash } from '../../src/platform/postgres.mjs';
import { PostgresChangeCaseStore } from '../../src/platform/postgres-stores.mjs';
import { digest } from '../../src/sdlc/contracts.mjs';
import { buildT91N3DeletedFailingTestMapping, T91_N3_DELETED_FAILING_TEST_HARNESS,
  t91N3DeletedFailingTestFixtureHash } from '../../src/sdlc/product-harness.mjs';

const tenantId = 'tenant-test';
const projectId = 'project-test';
const caseId = 'change-case-11111111-1111-4111-8111-111111111111';
const owner = 'oidc:owner';
const reviewer = 'oidc:reviewer';
const commandId = (name) => `t91-n3-readback-${name}`;
const sourceSnapshotHash = 'a'.repeat(64);
const treeDigest = 'b'.repeat(64);
const criterionContractHash = 'c'.repeat(64);
const fixtureRequestHash = 'd'.repeat(64);
const invocationId = 't91-n3-fixture-invocation-11111111-1111-4111-8111-111111111111';
const recordedAt = '2026-10-08T00:00:00.000Z';

function addEvent(current, { type, actor, command, version, timestamp, data }) {
  const event = { id: `event-${current.events.length + 1}`, type, schemaVersion: 1, tenantId,
    actor, correlationId: 'correlation-test', causationId: command, timestamp, aggregateVersion: version,
    data, contentHash: contentHash({ type, tenantId, data }) };
  current.events.push(event);
  return event;
}

test('N3 provider-style pre-fixture receipt passes persisted store readback as INCONCLUSIVE', async () => {
  const criterion = { id: 'LEARN-OUTCOME', text: 'Demonstrate the required outcome.', type: 'BUSINESS', mandatory: true };
  const contract = { version: 1, contentHash: criterionContractHash, criteria: [criterion] };
  const sourceRef = { snapshotHash: sourceSnapshotHash };
  const definition = { type: 'NEGATIVE', criterionId: criterion.id, authoredBy: owner, sourceRef,
    dataset: { cases: [{ id: 'N3', mutation: T91_N3_DELETED_FAILING_TEST_HARNESS.contract.mutation,
      path: T91_N3_DELETED_FAILING_TEST_HARNESS.sourcePath,
      sourceExpectedExitCode: T91_N3_DELETED_FAILING_TEST_HARNESS.sourceExpectedExitCode }] },
    expectedOutput: { cases: [{ id: 'N3', status: 'FAILED', deletedPathRejected: true, verifierDispatched: false }] } };
  const plan = { id: 'behavior-test-plan-11111111-1111-4111-8111-111111111111', planHash: 'e'.repeat(64),
    createdBy: owner, criterionContractVersion: 1, criterionContractHash,
    repository: { source: { snapshotId: 'snapshot-test' }, treeDigest }, caseDefinitions: { cases: [definition] } };
  const requirement = { id: 'REQ-PROC-111111111111', criterionContract: contract,
    criterionContractHistory: [contract] };
  const current = { tenantId, projectId, id: caseId, version: 5, correlationId: 'correlation-test',
    events: [], idempotency: {}, artifacts: { processBehaviorTestPlans: [plan],
      requirements: { requirements: [requirement] }, processBehaviorProductHarnessMappings: [],
      processBehaviorProductHarnessMappingReviews: [], processBehaviorProductHarnessExecutionReservations: [],
      processBehaviorProductHarnessExecutions: [] } };

  const mappingCore = buildT91N3DeletedFailingTestMapping({ changeCase: current, requirement, plan });
  const mappingId = 'product-behavior-harness-mapping-11111111-1111-4111-8111-111111111111';
  const mappingCommand = commandId('mapping');
  const mappingRequestHash = 'f'.repeat(64);
  const mappingAt = '2026-10-08T00:00:01.000Z';
  const mapping = { ...mappingCore, id: mappingId, requestedBy: owner, requestedAt: mappingAt,
    commandId: mappingCommand, requestHash: mappingRequestHash };
  current.artifacts.processBehaviorProductHarnessMappings.push(mapping);
  current.idempotency[mappingCommand] = { action: 'request-product-behavior-harness-mapping',
    requestHash: mappingRequestHash, mappingId, version: 2 };
  addEvent(current, { type: 'ProcessBehaviorProductHarnessMappingRequested', actor: owner,
    command: mappingCommand, version: 2, timestamp: mappingAt, data: { recordId: mappingId,
      mappingHash: mapping.mappingHash, planId: plan.id, planHash: plan.planHash, subcaseId: 'N3',
      requestedBy: owner, requestedAt: mappingAt, commandId: mappingCommand, requestHash: mappingRequestHash } });

  const reviewCommand = commandId('review');
  const reviewAt = '2026-10-08T00:00:02.000Z';
  const reviewRequestHash = '1'.repeat(64);
  const reviewCore = { schemaVersion: 1,
    id: 'product-behavior-harness-review-11111111-1111-4111-8111-111111111111', tenantId, projectId, caseId,
    mappingId, mappingHash: mapping.mappingHash, decision: 'APPROVE_FOR_TEST_EXECUTION', reviewerPrincipal: reviewer,
    reviewedAt: reviewAt, commandId: reviewCommand, requestHash: reviewRequestHash,
    status: 'REVIEWED_FOR_TEST_EXECUTION', businessTruthStatus: 'UNVERIFIED', scenarioStatus: 'NOT_EXECUTED' };
  const review = { ...reviewCore, reviewHash: contentHash(reviewCore) };
  current.artifacts.processBehaviorProductHarnessMappingReviews.push(review);
  current.idempotency[reviewCommand] = { action: 'review-product-behavior-harness-mapping',
    requestHash: reviewRequestHash, reviewId: review.id, version: 3 };
  addEvent(current, { type: 'ProcessBehaviorProductHarnessMappingReviewed', actor: reviewer,
    command: reviewCommand, version: 3, timestamp: reviewAt, data: { recordId: review.id, mappingId,
      mappingHash: mapping.mappingHash, reviewHash: review.reviewHash, decision: review.decision, status: review.status,
      reviewerPrincipal: reviewer, reviewedAt: reviewAt, commandId: reviewCommand, requestHash: reviewRequestHash } });

  const reservationId = 'product-behavior-harness-reservation-11111111-1111-4111-8111-111111111111';
  const reservationCommand = commandId('execute');
  const reservationRequestHash = '2'.repeat(64);
  const reservedAt = '2026-10-08T00:00:03.000Z';
  const reservationCore = { schemaVersion: 1, id: reservationId, tenantId, projectId, caseId, mappingId,
    mappingHash: mapping.mappingHash, reviewId: review.id, reviewHash: review.reviewHash, planId: plan.id,
    planHash: plan.planHash, subcaseId: 'N3', harnessId: mapping.harnessId, harnessVersion: mapping.harnessVersion,
    harnessHash: mapping.harnessHash, assertionId: mapping.assertionId, assertionHash: mapping.assertionHash,
    sourceRef, repositorySnapshotId: mapping.repositorySnapshotId, repositoryTreeDigest: mapping.repositoryTreeDigest,
    criterionId: mapping.criterionId, criterionHash: mapping.criterionHash,
    criterionContractVersion: mapping.criterionContractVersion, criterionContractHash: mapping.criterionContractHash,
    parentDefinitionHash: mapping.parentDefinitionHash, datasetHash: mapping.datasetHash, oracleHash: mapping.oracleHash,
    fixtureRequestHash, candidatePath: mapping.candidatePath, sourceTestBytesHash: mapping.sourceTestBytesHash,
    sourceExpectedExitCode: mapping.sourceExpectedExitCode, fixtureTemplateHash: mapping.fixtureTemplateHash,
    requestedBy: owner, commandId: reservationCommand, requestHash: reservationRequestHash,
    reservationVersion: 4, reservedAt, expectedCaseVersion: 3, status: 'RUNNING' };
  const reservation = { ...reservationCore, reservationHash: contentHash(reservationCore) };
  current.artifacts.processBehaviorProductHarnessExecutionReservations.push(reservation);
  current.idempotency[reservationCommand] = { action: 'execute-product-behavior-harness-subcase',
    requestHash: reservationRequestHash, mappingHash: mapping.mappingHash, subcaseId: 'N3', reservationId,
    reservationStatus: 'COMPLETED', version: 5 };
  addEvent(current, { type: 'ProcessBehaviorProductHarnessExecutionReserved', actor: owner,
    command: reservationCommand, version: 4, timestamp: reservedAt, data: { recordId: reservationId, mappingId,
      mappingHash: mapping.mappingHash, reviewId: review.id, reviewHash: review.reviewHash,
      planHash: plan.planHash, subcaseId: 'N3', requestHash: reservationRequestHash, fixtureRequestHash,
      reservationHash: reservation.reservationHash, candidatePath: mapping.candidatePath,
      sourceTestBytesHash: mapping.sourceTestBytesHash, fixtureTemplateHash: mapping.fixtureTemplateHash,
      commandId: reservationCommand, aggregateVersion: 4, reservedAt } });

  const receiptId = 'product-behavior-harness-execution-11111111-1111-4111-8111-111111111111';
  const expectedFixtureHash = t91N3DeletedFailingTestFixtureHash({ mapping, requestHash: fixtureRequestHash,
    fixtureTemplateHash: mapping.fixtureTemplateHash, invocationId });
  const receiptCore = { schemaVersion: 4, id: receiptId, tenantId, projectId, caseId, mappingId,
    mappingHash: mapping.mappingHash, reviewId: review.id, reviewHash: review.reviewHash, reservationId,
    commandId: reservationCommand, subcaseId: 'N3', planId: plan.id, planHash: plan.planHash, sourceRef,
    repositorySnapshotId: mapping.repositorySnapshotId, repositoryTreeDigest: mapping.repositoryTreeDigest,
    criterionId: mapping.criterionId, criterionHash: mapping.criterionHash,
    criterionContractVersion: mapping.criterionContractVersion, criterionContractHash: mapping.criterionContractHash,
    parentDefinitionHash: mapping.parentDefinitionHash, datasetHash: mapping.datasetHash, oracleHash: mapping.oracleHash,
    harnessId: mapping.harnessId, harnessVersion: mapping.harnessVersion, harnessHash: mapping.harnessHash,
    assertionId: mapping.assertionId, assertionHash: mapping.assertionHash, candidatePath: mapping.candidatePath,
    sourceTestBytesHash: mapping.sourceTestBytesHash, sourceExpectedExitCode: 1, fixtureRequestHash,
    reservationHash: reservation.reservationHash, fixtureInvocationId: invocationId,
    fixtureTemplateHash: mapping.fixtureTemplateHash, expectedFixtureHash, fixtureHash: null, terminal: false,
    fixtureCaseId: null, sourceStage: null, candidate: null, verifierDispatchCount: null, fixturePlan: null,
    run: null, acceptedControlPlanHash: null, control: null, attempt: null, before: null, after: null,
    httpStatus: null, errorCode: null, noMutationVerified: false, outcome: 'INCONCLUSIVE', status: 'INCONCLUSIVE',
    recordedBy: owner, recordedAt, requestHash: reservationRequestHash, scenarioExecutionStatus: 'NOT_EXECUTED',
    negativeSuiteStatus: 'INCOMPLETE', businessTruthStatus: 'UNVERIFIED', runtimeVerificationStatus: 'NOT_EXECUTED',
    statement: 'INCONCLUSIVE — the N3 source-failure/deletion result could not be confirmed.' };
  const receipt = { ...receiptCore, receiptHash: contentHash(receiptCore) };
  current.artifacts.processBehaviorProductHarnessExecutions.push(receipt);
  current.idempotency[reservationCommand] = { ...current.idempotency[reservationCommand], receiptId,
    reservationStatus: 'COMPLETED', version: 5 };
  const receiptEventData = { recordId: receiptId, receiptHash: receipt.receiptHash, mappingId,
    mappingHash: mapping.mappingHash, reviewId: review.id, reviewHash: review.reviewHash, reservationId,
    reservationHash: receipt.reservationHash, fixtureInvocationId: invocationId,
    fixtureTemplateHash: mapping.fixtureTemplateHash, candidatePath: mapping.candidatePath,
    sourceStage: null, candidate: null, sourceTestBytesHash: mapping.sourceTestBytesHash,
    sourceExpectedExitCode: 1, verifierDispatchCount: null, planHash: plan.planHash, subcaseId: 'N3',
    fixtureCaseId: null, outcome: 'INCONCLUSIVE', noMutationVerified: false, commandId: reservationCommand,
    requestHash: reservationRequestHash, recordedAt, scenarioExecutionStatus: 'NOT_EXECUTED',
    negativeSuiteStatus: 'INCOMPLETE', businessTruthStatus: 'UNVERIFIED', runtimeVerificationStatus: 'NOT_EXECUTED' };
  addEvent(current, { type: 'ProcessBehaviorProductHarnessSubcaseExecuted', actor: owner,
    command: reservationCommand, version: 5, timestamp: recordedAt, data: receiptEventData });

  const store = new PostgresChangeCaseStore({ query: async (_sql, params) => {
    const event = current.events.find((entry) => contentHash(entry) === params[2]);
    if (!event) return { rowCount: 0, rows: [] };
    return { rowCount: 1, rows: [{ event_hash: params[2], command_id: event.causationId,
      actor: event.actor, aggregate_version: event.aggregateVersion, event }] };
  } });
  await store.verifyProcessBehaviorProductHarnessMappings(current);
  const verifiedPins = await store.verifyT91N2AuthorizationExecutions(current);
  assert.deepEqual(verifiedPins.receipts, [{ id: receipt.id, receiptHash: receipt.receiptHash,
    status: 'INCONCLUSIVE' }]);
  assert.equal(mapping.integrityStatus, 'VALID');
  assert.equal(review.integrityStatus, 'VALID');
  assert.equal(receipt.status, 'INCONCLUSIVE');
});
