import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../../server.mjs';
import { T91_N1_ORPHAN_PATH_HARNESS, T91_N2_AUTHORIZATION_HARNESS, T91_N2_MISSING_ASSERTION_HARNESS,
  T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH, T91_N3_DELETED_FAILING_TEST_HARNESS,
  T91_N3_PRODUCT_FIXTURE_TEMPLATE_HASH, T91_R1_CRITERION_RECOVERY_HARNESS,
  classifyT91N3DeletedFailingTestObservation, classifyT91R1RecoveryObservation,
  T91_R2_SHARED_DRAFT_RECOVERY_HARNESS, classifyT91R2RecoveryObservation } from '../../src/sdlc/product-harness.mjs';
import { T91N2FixtureDatabaseProvider } from '../../src/platform/t91-n2-fixture-provider.mjs';
import { runT91N2AuthorizationProductFixture } from '../../src/platform/t91-n2-product-fixture.mjs';
import { startTestPostgresCluster, stopTestPostgresCluster } from '../helpers/postgres-cluster.mjs';

test('N2 product fixture uses real isolated APIs for valid control and mutation-free empty-assertion denial', async (t) => {
  const source = await startTestPostgresCluster();
  const fixture = await startTestPostgresCluster();
  t.after(async () => { await stopTestPostgresCluster(fixture); await stopTestPostgresCluster(source); });
  const mappingHash = '1'.repeat(64);
  const requestHash = '2'.repeat(64);
  const reservationHash = '3'.repeat(64);
  const request = { subcaseId: 'N2.AUTHORIZATION', mappingHash, planHash: '4'.repeat(64),
    datasetHash: '5'.repeat(64), oracleHash: '6'.repeat(64) };
  const pins = { mappingHash, planHash: request.planHash, datasetHash: request.datasetHash,
    oracleHash: request.oracleHash, reservationHash, fixtureRequestHash: requestHash,
    harnessHash: '7'.repeat(64), assertionHash: '8'.repeat(64) };
  const provider = new T91N2FixtureDatabaseProvider({ applicationDatabaseUrl: `${source.baseUrl}/postgres`,
    fixtureAdminDatabaseUrl: `${fixture.baseUrl}/postgres`,
    runFixture: (input) => runT91N2AuthorizationProductFixture({ ...input, createApp,
      fixtureTemplateHash: T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH,
      harness: T91_N2_AUTHORIZATION_HARNESS, fixtureCaseId: 'saved-owner-case-ignored-by-private-fixture',
      request, pins }) });
  assert.equal(await provider.initialize(), true);
  const observation = await provider.dispatch({ harness: T91_N2_AUTHORIZATION_HARNESS,
    fixtureCaseId: 'saved-owner-case-ignored-by-private-fixture', request, pins });
  assert.equal(observation.terminal, true);
  assert.equal(observation.fixtureTemplateHash, T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH);
  assert.match(observation.invocationId, /^t91-n2-fixture-invocation-[0-9a-f-]{36}$/);
  assert.equal(observation.control.httpStatus, 201);
  assert.equal(observation.attempt.httpStatus, 400);
  assert.equal(observation.attempt.errorCode, 'INVALID_PROCESS_BEHAVIOR_TEST_PLAN');
  assert.deepEqual(observation.attempt.before, observation.attempt.after);
  assert.equal(observation.control.fixtureCaseId, observation.attempt.fixtureCaseId);
  assert.equal(provider.available, true);
  assert.equal(observation.fixtureClusterId, provider.fixtureClusterIdentity.clusterId);
  assert.match(observation.fixtureDatabaseName, /^orgward_t91_fixture_[a-f0-9]{32}$/);
  const retained = await fixture.admin.query('select 1 from pg_catalog.pg_database where datname=$1', [observation.fixtureDatabaseName]);
  assert.equal(retained.rowCount, 0);
});

test('N1 fixed product fixture adds exactly the unmapped candidate path and fails before verifier dispatch', async (t) => {
  const source = await startTestPostgresCluster();
  const fixture = await startTestPostgresCluster();
  t.after(async () => { await stopTestPostgresCluster(fixture); await stopTestPostgresCluster(source); });
  const mappingHash = '1'.repeat(64);
  const requestHash = '2'.repeat(64);
  const reservationHash = '3'.repeat(64);
  const request = { subcaseId: 'N1', mappingHash, planHash: '4'.repeat(64), datasetHash: '5'.repeat(64),
    oracleHash: '6'.repeat(64), candidatePath: 'src/unmapped.mjs' };
  const pins = { mappingHash, planHash: request.planHash, datasetHash: request.datasetHash,
    oracleHash: request.oracleHash, reservationHash, fixtureRequestHash: requestHash,
    sourceTreeDigest: '7'.repeat(64), harnessHash: '8'.repeat(64), assertionHash: '9'.repeat(64) };
  const provider = new T91N2FixtureDatabaseProvider({ applicationDatabaseUrl: `${source.baseUrl}/postgres`,
    fixtureAdminDatabaseUrl: `${fixture.baseUrl}/postgres`,
    runFixture: (input) => runT91N2AuthorizationProductFixture({ ...input, createApp,
      fixtureTemplateHash: T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH, harness: T91_N1_ORPHAN_PATH_HARNESS,
      fixtureCaseId: 'saved-owner-case-ignored-by-private-fixture', request, pins }) });
  assert.equal(await provider.initialize(), true);
  const observation = await provider.dispatch({ harness: T91_N1_ORPHAN_PATH_HARNESS,
    fixtureCaseId: 'saved-owner-case-ignored-by-private-fixture', request, pins });
  assert.equal(observation.terminal, true);
  assert.equal(observation.run.status, 'FAILED', JSON.stringify(observation.run));
  assert.equal(observation.run.errorCode, 'BEHAVIOR_CANDIDATE_ORPHAN_PATH', JSON.stringify(observation.run));
  assert.equal(observation.source.planTreeDigest, pins.sourceTreeDigest);
  assert.match(observation.source.treeDigest, /^[a-f0-9]{64}$/);
  assert.equal(observation.candidate.addedPath, 'src/unmapped.mjs');
  assert.equal(observation.candidate.changes.length, 1);
  assert.equal(observation.candidate.changes[0].change, 'added');
  assert.equal(observation.candidate.changes[0].path, 'src/unmapped.mjs');
  assert.match(observation.candidate.addedPathHash, /^[a-f0-9]{64}$/);
  assert.notEqual(observation.source.treeDigest, observation.candidate.treeDigest);
  assert.equal(observation.verifierDispatchCount, 0);
  assert.equal(provider.available, true);
});

test('R1 fixed product fixture uses real APIs to preserve v1 history and link distinct v2 evidence', async (t) => {
  const source = await startTestPostgresCluster();
  const fixture = await startTestPostgresCluster();
  t.after(async () => { await stopTestPostgresCluster(fixture); await stopTestPostgresCluster(source); });
  const mappingHash = '1'.repeat(64);
  const requestHash = '2'.repeat(64);
  const reservationHash = '3'.repeat(64);
  const fixtureTemplateHash = T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH;
  const request = { subcaseId: 'R1', mappingId: 'product-behavior-harness-mapping-r1-fixture', mappingHash,
    planId: 'behavior-test-plan-owner-v1', planHash: '4'.repeat(64), sourceTreeDigest: '5'.repeat(64),
    criterionId: 'LEARN-OUTCOME', criterionHash: '6'.repeat(64), parentDefinitionHash: '7'.repeat(64),
    datasetHash: '8'.repeat(64), oracleHash: '9'.repeat(64), harnessId: T91_R1_CRITERION_RECOVERY_HARNESS.id,
    harnessVersion: T91_R1_CRITERION_RECOVERY_HARNESS.version, harnessHash: 'a'.repeat(64),
    assertionId: T91_R1_CRITERION_RECOVERY_HARNESS.assertionId, assertionHash: 'b'.repeat(64),
    oldPlanId: 'behavior-test-plan-owner-v1', oldPlanHash: '4'.repeat(64), oldLinkId: 'process-run-link-owner-v1',
    oldLinkHash: 'c'.repeat(64), oldRunId: 'execution-run-owner-v1', fixtureTemplateHash };
  const pins = { mappingHash, planHash: request.planHash, datasetHash: request.datasetHash,
    oracleHash: request.oracleHash, reservationHash, fixtureRequestHash: requestHash,
    harnessHash: request.harnessHash, assertionHash: request.assertionHash,
    oldPlanId: request.oldPlanId, oldPlanHash: request.oldPlanHash, oldLinkId: request.oldLinkId,
    oldLinkHash: request.oldLinkHash, oldRunId: request.oldRunId, fixtureTemplateHash,
    sourceTreeDigest: request.sourceTreeDigest };
  const provider = new T91N2FixtureDatabaseProvider({ applicationDatabaseUrl: `${source.baseUrl}/postgres`,
    fixtureAdminDatabaseUrl: `${fixture.baseUrl}/postgres`,
    runFixture: (input) => runT91N2AuthorizationProductFixture({ ...input, createApp,
      fixtureTemplateHash, harness: T91_R1_CRITERION_RECOVERY_HARNESS,
      fixtureCaseId: 'saved-owner-case-ignored-by-private-fixture', request, pins }) });
  assert.equal(await provider.initialize(), true);
  const observation = await provider.dispatch({ harness: T91_R1_CRITERION_RECOVERY_HARNESS,
    fixtureCaseId: 'saved-owner-case-ignored-by-private-fixture', request, pins });
  assert.equal(observation.terminal, true);
  assert.equal(observation.fixtureTemplateHash, fixtureTemplateHash);
  assert.equal(observation.old.sourcePlanHash, request.oldPlanHash);
  assert.equal(observation.old.sourceLinkHash, request.oldLinkHash);
  assert.equal(observation.old.planStatusAfterRevision, 'REGENERATION_REQUIRED');
  assert.equal(observation.old.linkStatusAfterRevision, 'STALE');
  assert.equal(observation.staleAttempt.httpStatus, 409);
  assert.equal(observation.staleAttempt.errorCode, 'BEHAVIOR_TEST_PLAN_STALE');
  assert.deepEqual(observation.staleAttempt.before, observation.staleAttempt.after);
  assert.equal(observation.fresh.criterionContractVersion, 2);
  assert.equal(observation.fresh.runStatus, 'SUCCEEDED');
  assert.notEqual(observation.fresh.runId, observation.old.sourceRunId);
  const mapping = { ...request, repositoryTreeDigest: request.sourceTreeDigest };
  assert.equal(classifyT91R1RecoveryObservation({ observation, mapping, requestHash,
    fixtureTemplateHash, invocationId: observation.invocationId, reservationHash }).status, 'PASS');
  assert.equal(provider.available, true);
  const retained = await fixture.admin.query('select 1 from pg_catalog.pg_database where datname=$1', [observation.fixtureDatabaseName]);
  assert.equal(retained.rowCount, 0);
});

test('R2 fixed product fixture edits only the other rationale and rebinds fresh evidence', async (t) => {
  const source = await startTestPostgresCluster();
  const fixture = await startTestPostgresCluster();
  t.after(async () => { await stopTestPostgresCluster(fixture); await stopTestPostgresCluster(source); });
  const mappingHash = '1'.repeat(64);
  const requestHash = '2'.repeat(64);
  const reservationHash = '3'.repeat(64);
  const fixtureTemplateHash = T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH;
  const request = { subcaseId: 'R2', mappingId: 'product-behavior-harness-mapping-r2-fixture', mappingHash,
    planId: 'behavior-test-plan-owner-a', planHash: '4'.repeat(64), sourceTreeDigest: '5'.repeat(64),
    criterionId: 'LEARN-OUTCOME', criterionHash: '6'.repeat(64), parentDefinitionHash: '7'.repeat(64),
    datasetHash: '8'.repeat(64), oracleHash: '9'.repeat(64), harnessId: T91_R2_SHARED_DRAFT_RECOVERY_HARNESS.id,
    harnessVersion: T91_R2_SHARED_DRAFT_RECOVERY_HARNESS.version, harnessHash: 'a'.repeat(64),
    assertionId: T91_R2_SHARED_DRAFT_RECOVERY_HARNESS.assertionId, assertionHash: 'b'.repeat(64),
    oldPlanId: 'behavior-test-plan-owner-a', oldPlanHash: '4'.repeat(64), oldLinkId: 'process-run-link-owner-a',
    oldLinkHash: 'c'.repeat(64), oldRunId: 'execution-run-owner-a', selectedRequirementHash: 'd'.repeat(64),
    otherRequirementId: 'REQ-PROC-owner-b', otherRequirementHash: 'e'.repeat(64), fixtureTemplateHash };
  const pins = { mappingHash, planHash: request.planHash, datasetHash: request.datasetHash,
    oracleHash: request.oracleHash, reservationHash, fixtureRequestHash: requestHash,
    harnessHash: request.harnessHash, assertionHash: request.assertionHash,
    oldPlanId: request.oldPlanId, oldPlanHash: request.oldPlanHash, oldLinkId: request.oldLinkId,
    oldLinkHash: request.oldLinkHash, oldRunId: request.oldRunId,
    selectedRequirementHash: request.selectedRequirementHash, otherRequirementId: request.otherRequirementId,
    otherRequirementHash: request.otherRequirementHash, fixtureTemplateHash };
  const provider = new T91N2FixtureDatabaseProvider({ applicationDatabaseUrl: `${source.baseUrl}/postgres`,
    fixtureAdminDatabaseUrl: `${fixture.baseUrl}/postgres`,
    runFixture: (input) => runT91N2AuthorizationProductFixture({ ...input, createApp,
      fixtureTemplateHash, harness: T91_R2_SHARED_DRAFT_RECOVERY_HARNESS,
      fixtureCaseId: 'saved-owner-case-ignored-by-private-fixture', request, pins }) });
  assert.equal(await provider.initialize(), true);
  const observation = await provider.dispatch({ harness: T91_R2_SHARED_DRAFT_RECOVERY_HARNESS,
    fixtureCaseId: 'saved-owner-case-ignored-by-private-fixture', request, pins });
  assert.equal(observation.terminal, true);
  assert.equal(observation.fixtureTemplateHash, fixtureTemplateHash);
  assert.equal(observation.old.ownerSelectedRequirementHash, request.selectedRequirementHash);
  assert.equal(observation.old.selectedRequirementHashAfter, observation.old.selectedRequirementHashBefore);
  assert.notEqual(observation.old.otherRequirementHashAfter, observation.old.otherRequirementHashBefore);
  assert.equal(observation.old.planStatusAfterEdit, 'REGENERATION_REQUIRED');
  assert.equal(observation.old.regenerationReason, 'SHARED_REQUIREMENTS_DRAFT_CHANGED');
  assert.equal(observation.old.linkStatusAfterEdit, 'STALE');
  assert.equal(observation.staleAttempt.httpStatus, 409);
  assert.equal(observation.staleAttempt.errorCode, 'BEHAVIOR_TEST_PLAN_STALE');
  assert.deepEqual(observation.staleAttempt.before, observation.staleAttempt.after);
  assert.notEqual(observation.fresh.planId, observation.old.fixturePlanId);
  assert.notEqual(observation.fresh.runId, observation.old.fixtureRunId);
  assert.notEqual(observation.fresh.linkId, observation.old.fixtureLinkId);
  const mapping = { ...request };
  assert.equal(classifyT91R2RecoveryObservation({ observation, mapping, requestHash,
    fixtureTemplateHash, invocationId: observation.invocationId, reservationHash }).status, 'PASS');
  assert.equal(provider.available, true);
  const retained = await fixture.admin.query('select 1 from pg_catalog.pg_database where datname=$1', [observation.fixtureDatabaseName]);
  assert.equal(retained.rowCount, 0);
});

test('N3 fixed product fixture captures failing source TAP then rejects deletion before verifier dispatch', async (t) => {
  const source = await startTestPostgresCluster();
  const fixture = await startTestPostgresCluster();
  t.after(async () => { await stopTestPostgresCluster(fixture); await stopTestPostgresCluster(source); });
  const mappingHash = '1'.repeat(64);
  const requestHash = '2'.repeat(64);
  const reservationHash = '3'.repeat(64);
  const request = { subcaseId: 'N3', mappingHash, planHash: '4'.repeat(64), datasetHash: '5'.repeat(64),
    oracleHash: '6'.repeat(64), candidatePath: 'tests/learning.test.js',
    sourceTestBytesHash: T91_N3_DELETED_FAILING_TEST_HARNESS.sourceBytesHash, sourceExpectedExitCode: 1,
    fixtureTemplateHash: T91_N3_PRODUCT_FIXTURE_TEMPLATE_HASH };
  const pins = { mappingHash, planHash: request.planHash, datasetHash: request.datasetHash, oracleHash: request.oracleHash,
    reservationHash, fixtureRequestHash: requestHash, sourceTreeDigest: '7'.repeat(64),
    sourceTestBytesHash: request.sourceTestBytesHash, sourceExpectedExitCode: 1,
    fixtureTemplateHash: T91_N3_PRODUCT_FIXTURE_TEMPLATE_HASH, harnessHash: '8'.repeat(64), assertionHash: '9'.repeat(64) };
  const provider = new T91N2FixtureDatabaseProvider({ applicationDatabaseUrl: `${source.baseUrl}/postgres`,
    fixtureAdminDatabaseUrl: `${fixture.baseUrl}/postgres`,
    runFixture: (input) => runT91N2AuthorizationProductFixture({ ...input, createApp,
      fixtureTemplateHash: T91_N3_PRODUCT_FIXTURE_TEMPLATE_HASH, harness: T91_N3_DELETED_FAILING_TEST_HARNESS,
      fixtureCaseId: 'saved-owner-case-ignored-by-private-fixture', request, pins }) });
  assert.equal(await provider.initialize(), true);
  const observation = await provider.dispatch({ harness: T91_N3_DELETED_FAILING_TEST_HARNESS,
    fixtureCaseId: 'saved-owner-case-ignored-by-private-fixture', request, pins });
  assert.equal(observation.terminal, true);
  assert.equal(observation.sourceStage.path, 'tests/learning.test.js');
  assert.equal(observation.sourceStage.bytesHash, T91_N3_DELETED_FAILING_TEST_HARNESS.sourceBytesHash);
  assert.equal(observation.sourceStage.exitCode, 1);
  assert.match(observation.sourceStage.tap, /# fail 1/);
  assert.equal(observation.run.status, 'FAILED', JSON.stringify(observation.run));
  assert.equal(observation.run.errorCode, 'BEHAVIOR_CANDIDATE_ORPHAN_PATH', JSON.stringify(observation.run));
  assert.equal(observation.candidate.deletedPath, 'tests/learning.test.js');
  assert.equal(observation.candidate.deletedPathHash, T91_N3_DELETED_FAILING_TEST_HARNESS.sourceBytesHash);
  assert.equal(observation.candidate.changes.length, 1);
  assert.equal(observation.candidate.changes[0].change, 'deleted');
  assert.equal(observation.candidate.changes[0].beforeHash, T91_N3_DELETED_FAILING_TEST_HARNESS.sourceBytesHash);
  assert.equal(observation.verifierDispatchCount, 0);
  const mapping = { harnessId: request.harnessId ?? T91_N3_DELETED_FAILING_TEST_HARNESS.id,
    harnessHash: pins.harnessHash, assertionHash: pins.assertionHash, repositoryTreeDigest: pins.sourceTreeDigest,
    sourceTestBytesHash: request.sourceTestBytesHash, fixtureTemplateHash: T91_N3_PRODUCT_FIXTURE_TEMPLATE_HASH };
  assert.equal(classifyT91N3DeletedFailingTestObservation({ observation, mapping, requestHash,
    fixtureTemplateHash: T91_N3_PRODUCT_FIXTURE_TEMPLATE_HASH, invocationId: observation.invocationId,
    reservationHash }).status, 'PASS');
});

test('N2.MISSING_ASSERTION fixture executes a real task/check and records the real mutation-free 409 link denial', async (t) => {
  const source = await startTestPostgresCluster();
  const fixture = await startTestPostgresCluster();
  t.after(async () => { await stopTestPostgresCluster(fixture); await stopTestPostgresCluster(source); });
  const mappingHash = 'a'.repeat(64);
  const requestHash = 'b'.repeat(64);
  const reservationHash = 'c'.repeat(64);
  const requiredPlanAssertionId = 'required-synthetic-assertion';
  const requiredPlanAssertionName = 'A fixed mandatory assertion omitted by the generic check';
  const request = { subcaseId: 'N2.MISSING_ASSERTION', mappingHash, planHash: 'd'.repeat(64),
    datasetHash: 'e'.repeat(64), oracleHash: 'f'.repeat(64) };
  const pins = { mappingHash, planHash: request.planHash, datasetHash: request.datasetHash, oracleHash: request.oracleHash,
    reservationHash, fixtureRequestHash: requestHash, harnessHash: '1'.repeat(64), assertionHash: '2'.repeat(64),
    requiredPlanAssertionId, requiredPlanAssertionName, requiredPlanAssertionHash: '3'.repeat(64) };
  const provider = new T91N2FixtureDatabaseProvider({ applicationDatabaseUrl: `${source.baseUrl}/postgres`,
    fixtureAdminDatabaseUrl: `${fixture.baseUrl}/postgres`,
    runFixture: (input) => runT91N2AuthorizationProductFixture({ ...input, createApp,
      fixtureTemplateHash: T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH, harness: T91_N2_MISSING_ASSERTION_HARNESS,
      fixtureCaseId: 'saved-owner-case-ignored-by-private-fixture', request, pins }) });
  assert.equal(await provider.initialize(), true);
  const observation = await provider.dispatch({ harness: T91_N2_MISSING_ASSERTION_HARNESS,
    fixtureCaseId: 'saved-owner-case-ignored-by-private-fixture', request, pins });
  assert.equal(observation.terminal, true);
  assert.equal(observation.fixtureTemplateHash, T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH);
  assert.equal(observation.fixturePlan.httpStatus, 201);
  assert.equal(observation.run.status, 'SUCCEEDED', JSON.stringify(observation.run));
  assert.equal(observation.run.assertion.id, requiredPlanAssertionId);
  assert.equal(observation.run.assertion.name, requiredPlanAssertionName);
  assert.equal(observation.run.assertion.status, 'UNKNOWN');
  assert.equal(observation.run.assertion.reason, 'ASSERTION_RESULT_NOT_FOUND');
  assert.equal(observation.attempt.httpStatus, 409);
  assert.equal(observation.attempt.errorCode, 'BEHAVIOR_CANDIDATE_REJECTED');
  assert.deepEqual(observation.attempt.before, observation.attempt.after);
  assert.equal(provider.available, true);
  const retained = await fixture.admin.query('select 1 from pg_catalog.pg_database where datname=$1', [observation.fixtureDatabaseName]);
  assert.equal(retained.rowCount, 0);
});
