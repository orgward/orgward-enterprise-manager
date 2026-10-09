import assert from 'node:assert/strict';
import test from 'node:test';
import { contentHash } from '../../src/platform/postgres.mjs';
import { PostgresChangeCaseStore } from '../../src/platform/postgres-stores.mjs';
import { buildT91R1RecoveryMapping, T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH,
  t91R1RecoveryFixtureHash } from '../../src/sdlc/product-harness.mjs';

const tenantId = 'tenant-r1-readback';
const projectId = 'project-r1-readback';
const caseId = 'change-case-22222222-2222-4222-8222-222222222222';
const owner = 'oidc:r1-owner';
const reviewer = 'oidc:r1-reviewer';

function appendEvent(current, { type, actor, command, version, timestamp, data }) {
  const event = { id: `event-${current.events.length + 1}`, type, schemaVersion: 1, tenantId, actor,
    correlationId: 'r1-readback-correlation', causationId: command, timestamp, aggregateVersion: version,
    data, contentHash: contentHash({ type, tenantId, data }) };
  current.events.push(event);
  return event;
}

test('R1 pre-invocation INCONCLUSIVE receipt remains integrity-valid on store readback', async () => {
  const criterion = { id: 'LEARN-OUTCOME', text: 'Demonstrate the pinned process outcome.', type: 'BUSINESS', mandatory: true };
  const contract = { version: 1, contentHash: 'c'.repeat(64), criteria: [criterion] };
  const sourceRef = { snapshotHash: 'a'.repeat(64) };
  const definition = { type: 'RECOVERY', criterionId: criterion.id, authoredBy: owner, sourceRef,
    dataset: { cases: [{ id: 'R1', fromCriterionVersion: 1, toCriterionVersion: 2, retainHistory: true }] },
    expectedOutput: { cases: [{ id: 'R1', oldPlanStatus: 'REGENERATION_REQUIRED', oldLinkStatus: 'STALE',
      staleExecutionStatus: 409, staleExecutionError: 'BEHAVIOR_TEST_PLAN_STALE', newPlanBindsVersion: 2,
      oldPlanHashPreserved: true, newRunDistinct: true }] } };
  const plan = { id: 'behavior-test-plan-22222222-2222-4222-8222-222222222222', planHash: 'e'.repeat(64),
    createdBy: owner, criterionContractVersion: 1, criterionContractHash: contract.contentHash,
    repository: { source: { snapshotId: 'snapshot-r1' }, treeDigest: 'b'.repeat(64) },
    caseDefinitions: { cases: [definition] } };
  const requirement = { id: 'REQ-PROC-R1READBACK', criterionContract: contract,
    criterionContractHistory: [contract], processRunEvidenceLinks: [{ id: 'link-r1-old', linkHash: 'd'.repeat(64),
      behaviorEvaluation: { planId: plan.id, planHash: plan.planHash, result: 'TEST_PASS' },
      run: { id: 'execution-run-22222222-2222-4222-8222-222222222222' } }] };
  const current = { tenantId, projectId, id: caseId, version: 5, correlationId: 'r1-readback-correlation',
    events: [], idempotency: {}, artifacts: { processBehaviorTestPlans: [plan], requirements: { requirements: [requirement] },
      processBehaviorProductHarnessMappings: [], processBehaviorProductHarnessMappingReviews: [],
      processBehaviorProductHarnessExecutionReservations: [], processBehaviorProductHarnessExecutions: [] } };

  const mappingCore = buildT91R1RecoveryMapping({ changeCase: current, requirement, plan });
  assert.ok(mappingCore);
  const mappingId = 'product-behavior-harness-mapping-22222222-2222-4222-8222-222222222222';
  const mappingCommand = 'r1-readback-mapping-command';
  const mappingAt = '2026-10-08T00:00:01.000Z';
  const mappingRequestHash = 'f'.repeat(64);
  const mapping = { ...mappingCore, id: mappingId, requestedBy: owner, requestedAt: mappingAt,
    commandId: mappingCommand, requestHash: mappingRequestHash };
  current.artifacts.processBehaviorProductHarnessMappings.push(mapping);
  current.idempotency[mappingCommand] = { action: 'request-product-behavior-harness-mapping',
    requestHash: mappingRequestHash, mappingId, version: 2 };
  appendEvent(current, { type: 'ProcessBehaviorProductHarnessMappingRequested', actor: owner, command: mappingCommand,
    version: 2, timestamp: mappingAt, data: { recordId: mappingId, mappingHash: mapping.mappingHash,
      planId: plan.id, planHash: plan.planHash, subcaseId: 'R1', requestedBy: owner, requestedAt: mappingAt,
      commandId: mappingCommand, requestHash: mappingRequestHash } });

  const reviewId = 'product-behavior-harness-review-22222222-2222-4222-8222-222222222222';
  const reviewCommand = 'r1-readback-review-command';
  const reviewedAt = '2026-10-08T00:00:02.000Z';
  const reviewRequestHash = '1'.repeat(64);
  const reviewCore = { schemaVersion: 1, id: reviewId, tenantId, projectId, caseId, mappingId,
    mappingHash: mapping.mappingHash, decision: 'APPROVE_FOR_TEST_EXECUTION', reviewerPrincipal: reviewer,
    reviewedAt, commandId: reviewCommand, requestHash: reviewRequestHash,
    status: 'REVIEWED_FOR_TEST_EXECUTION', businessTruthStatus: 'UNVERIFIED', scenarioStatus: 'NOT_EXECUTED' };
  const review = { ...reviewCore, reviewHash: contentHash(reviewCore) };
  current.artifacts.processBehaviorProductHarnessMappingReviews.push(review);
  current.idempotency[reviewCommand] = { action: 'review-product-behavior-harness-mapping',
    requestHash: reviewRequestHash, reviewId, version: 3 };
  appendEvent(current, { type: 'ProcessBehaviorProductHarnessMappingReviewed', actor: reviewer, command: reviewCommand,
    version: 3, timestamp: reviewedAt, data: { recordId: reviewId, mappingId, mappingHash: mapping.mappingHash,
      reviewHash: review.reviewHash, decision: review.decision, status: review.status,
      reviewerPrincipal: reviewer, reviewedAt, commandId: reviewCommand, requestHash: reviewRequestHash } });

  const reservationId = 'product-behavior-harness-reservation-22222222-2222-4222-8222-222222222222';
  const executeCommand = 'r1-readback-execution-command';
  const requestHash = '2'.repeat(64);
  const fixtureRequestHash = '3'.repeat(64);
  const reservedAt = '2026-10-08T00:00:03.000Z';
  const reservationCore = { schemaVersion: 1, id: reservationId, tenantId, projectId, caseId, mappingId,
    mappingHash: mapping.mappingHash, reviewId, reviewHash: review.reviewHash, planId: plan.id, planHash: plan.planHash,
    subcaseId: 'R1', harnessId: mapping.harnessId, harnessVersion: mapping.harnessVersion,
    harnessHash: mapping.harnessHash, assertionId: mapping.assertionId, assertionHash: mapping.assertionHash,
    sourceRef: mapping.sourceRef, repositorySnapshotId: mapping.repositorySnapshotId,
    repositoryTreeDigest: mapping.repositoryTreeDigest, criterionId: mapping.criterionId,
    criterionHash: mapping.criterionHash, criterionContractVersion: mapping.criterionContractVersion,
    criterionContractHash: mapping.criterionContractHash, parentDefinitionHash: mapping.parentDefinitionHash,
    datasetHash: mapping.datasetHash, oracleHash: mapping.oracleHash, oldPlanId: mapping.oldPlanId,
    oldPlanHash: mapping.oldPlanHash, oldLinkId: mapping.oldLinkId, oldLinkHash: mapping.oldLinkHash,
    oldRunId: mapping.oldRunId, fixtureRequestHash, fixtureTemplateHash: mapping.fixtureTemplateHash,
    requestedBy: owner, commandId: executeCommand, requestHash, reservationVersion: 4, reservedAt,
    expectedCaseVersion: 3, status: 'RUNNING' };
  const reservation = { ...reservationCore, reservationHash: contentHash(reservationCore) };
  current.artifacts.processBehaviorProductHarnessExecutionReservations.push(reservation);
  current.idempotency[executeCommand] = { action: 'execute-product-behavior-harness-subcase', requestHash,
    mappingHash: mapping.mappingHash, subcaseId: 'R1', reservationId, reservationStatus: 'COMPLETED', version: 5 };
  appendEvent(current, { type: 'ProcessBehaviorProductHarnessExecutionReserved', actor: owner, command: executeCommand,
    version: 4, timestamp: reservedAt, data: { recordId: reservationId, mappingId, mappingHash: mapping.mappingHash,
      reviewId, reviewHash: review.reviewHash, planHash: plan.planHash, subcaseId: 'R1', requestHash,
      fixtureRequestHash, reservationHash: reservation.reservationHash, oldPlanHash: mapping.oldPlanHash,
      oldLinkHash: mapping.oldLinkHash, fixtureTemplateHash: mapping.fixtureTemplateHash,
      commandId: executeCommand, aggregateVersion: 4, reservedAt } });

  const receiptId = 'product-behavior-harness-execution-22222222-2222-4222-8222-222222222222';
  const fixtureInvocationId = null;
  const fixtureTemplateHash = null;
  const expectedFixtureHash = t91R1RecoveryFixtureHash({ mapping, requestHash: fixtureRequestHash,
    fixtureTemplateHash, invocationId: fixtureInvocationId });
  const receiptCore = { schemaVersion: 4, id: receiptId, tenantId, projectId, caseId, mappingId,
    mappingHash: mapping.mappingHash, reviewId, reviewHash: review.reviewHash, reservationId,
    commandId: executeCommand, subcaseId: 'R1', planId: plan.id, planHash: plan.planHash, sourceRef: mapping.sourceRef,
    repositorySnapshotId: mapping.repositorySnapshotId, repositoryTreeDigest: mapping.repositoryTreeDigest,
    criterionId: mapping.criterionId, criterionHash: mapping.criterionHash,
    criterionContractVersion: mapping.criterionContractVersion, criterionContractHash: mapping.criterionContractHash,
    parentDefinitionHash: mapping.parentDefinitionHash, datasetHash: mapping.datasetHash, oracleHash: mapping.oracleHash,
    harnessId: mapping.harnessId, harnessVersion: mapping.harnessVersion, harnessHash: mapping.harnessHash,
    assertionId: mapping.assertionId, assertionHash: mapping.assertionHash, oldPlanId: mapping.oldPlanId,
    oldPlanHash: mapping.oldPlanHash, oldLinkId: mapping.oldLinkId, oldLinkHash: mapping.oldLinkHash,
    oldRunId: mapping.oldRunId, fixtureRequestHash, reservationHash: reservation.reservationHash,
    fixtureInvocationId, fixtureTemplateHash, expectedFixtureHash, fixtureHash: null, terminal: false,
    fixtureCaseId: null, recovery: null, noMutationVerified: false, outcome: 'INCONCLUSIVE', status: 'INCONCLUSIVE',
    recordedBy: owner, recordedAt: '2026-10-08T00:00:04.000Z', requestHash,
    scenarioExecutionStatus: 'NOT_EXECUTED', negativeSuiteStatus: 'INCOMPLETE',
    businessTruthStatus: 'UNVERIFIED', runtimeVerificationStatus: 'NOT_EXECUTED',
    statement: 'INCONCLUSIVE — the v1-to-v2 recovery path could not be fully confirmed from the isolated fixture.' };
  const receipt = { ...receiptCore, receiptHash: contentHash(receiptCore) };
  current.artifacts.processBehaviorProductHarnessExecutions.push(receipt);
  current.idempotency[executeCommand] = { ...current.idempotency[executeCommand], receiptId, version: 5 };
  appendEvent(current, { type: 'ProcessBehaviorProductHarnessSubcaseExecuted', actor: owner, command: executeCommand,
    version: 5, timestamp: receipt.recordedAt, data: { recordId: receiptId, receiptHash: receipt.receiptHash,
      mappingId, mappingHash: mapping.mappingHash, reviewId, reviewHash: review.reviewHash, reservationId,
      reservationHash: reservation.reservationHash, fixtureInvocationId, fixtureTemplateHash,
      oldPlanHash: mapping.oldPlanHash, oldLinkHash: mapping.oldLinkHash, recovery: null,
      planHash: plan.planHash, subcaseId: 'R1', fixtureCaseId: null, outcome: 'INCONCLUSIVE',
      noMutationVerified: false, commandId: executeCommand, requestHash, recordedAt: receipt.recordedAt,
      scenarioExecutionStatus: 'NOT_EXECUTED', negativeSuiteStatus: 'INCOMPLETE',
      businessTruthStatus: 'UNVERIFIED', runtimeVerificationStatus: 'NOT_EXECUTED' } });

  const store = new PostgresChangeCaseStore({ query: async (_sql, params) => {
    const event = current.events.find((entry) => contentHash(entry) === params[2]);
    return event ? { rowCount: 1, rows: [{ event_hash: params[2], command_id: event.causationId,
      actor: event.actor, aggregate_version: event.aggregateVersion, event }] } : { rowCount: 0, rows: [] };
  } });
  await store.verifyProcessBehaviorProductHarnessMappings(current);
  const verified = await store.verifyT91N2AuthorizationExecutions(current);
  assert.deepEqual(verified.receipts, [{ id: receiptId, receiptHash: receipt.receiptHash, status: 'INCONCLUSIVE' }]);
  assert.equal(mapping.integrityStatus, 'VALID');
  assert.equal(review.integrityStatus, 'VALID');
  assert.equal(receipt.receiptHash, contentHash(receiptCore), 'readback does not alter the immutable receipt hash');
  assert.equal(receipt.integrityStatus, undefined, 'the verifier validates without mutating the persisted record');

  const alteredReservation = structuredClone(current);
  const altered = alteredReservation.artifacts.processBehaviorProductHarnessExecutionReservations[0];
  altered.fixtureTemplateHash = '9'.repeat(64);
  const { reservationHash: _oldHash, ...alteredCore } = altered;
  altered.reservationHash = contentHash(alteredCore);
  await assert.rejects(() => store.verifyT91N2AuthorizationExecutions(alteredReservation), /reservation|pins|immutable/i,
    'a resealed reservation cannot change its pinned template independently of the mapping/event');
});
