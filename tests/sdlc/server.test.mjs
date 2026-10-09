import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../../server.mjs';
import { addConversationTurn, createProject, editBlueprintObject, latestBlueprint } from '../../src/model.mjs';
import { digest } from '../../src/sdlc/contracts.mjs';
import { evaluateProcessVerificationContract, verifyContextManifest } from '../../src/sdlc/engine.mjs';
import { applyEnterpriseIntegrityCommand } from '../../src/enterprise/integrity.mjs';
import { canAcceptIntentEvaluation, caseUiModel, eligibleActorBindings, intentEvaluationAcceptancePresentation, n3StageStatusCopy, processBehaviorTestPlanPresentation, processEvidenceReviewPresentation, processRunEvidencePresentation, productHarnessEligiblePlanGroups, productHarnessRequestFormVisibility, repositoryCheckObservationPresentation } from '../../public/sdlc-view.mjs';

async function start(root) {
  const app = createApp({ dataDirectory: path.join(root, 'blueprints'), sdlcDirectory: path.join(root, 'sdlc') });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  return { ...app, base: `http://127.0.0.1:${app.server.address().port}` };
}

async function close(server) { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }

async function request(base, route, options = {}, expected = 200) {
  const response = await fetch(`${base}${route}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers ?? {}) } });
  const body = await response.json();
  assert.equal(response.status, expected, JSON.stringify(body));
  return body;
}

test('SDLC client selects and renders eligible actor bindings from the API data envelope', () => {
  const response = { schemaVersion: '1.0', data: { proposals: [
    { id: 'human-current', targetType: 'human', status: 'enabled', eligibilityStatus: 'eligible', blueprintVersion: 7 },
    { id: 'agent-current', targetType: 'agent', status: 'enabled', eligibilityStatus: 'eligible', blueprintVersion: 7 },
    { id: 'human-pending', targetType: 'human', status: 'proposed', eligibilityStatus: 'eligible', blueprintVersion: 7 },
    { id: 'human-stale', targetType: 'human', status: 'enabled', eligibilityStatus: 'eligible', blueprintVersion: 6 },
    { id: 'human-ineligible', targetType: 'human', status: 'enabled', eligibilityStatus: 'membership-missing', blueprintVersion: 7 },
  ] }, meta: { correlationId: 'test' } };
  const renderedBindings = eligibleActorBindings(response, 7);
  assert.deepEqual(renderedBindings.map((binding) => binding.id), ['human-current', 'agent-current']);
});

test('criterion editor and behavior plan form expose typed obligations and exact path mappings', () => {
  const client = readFileSync(new URL('../../public/sdlc.js', import.meta.url), 'utf8');
  assert.match(client, /function renderCriterionContractEditor\(card, requirement\)/);
  assert.match(client, /Legacy string criteria are UNKNOWN/);
  assert.match(client, /MUST requirements force all criteria mandatory; guardrails cannot be optional/);
  assert.ok(client.includes("'aria-label': `Criterion ${index + 1} source pin`"));
  assert.ok(client.includes("'aria-label': `Criterion ${index + 1} scope pin`"));
  assert.match(client, /Map each changed candidate path \(path \| role \| criterion IDs\)/);
  assert.match(client, /Changed, deleted or renamed paths without a pre-run criterion mapping are rejected before checks execute/);
  assert.match(client, /criterionId: requirement\.criterionContract\.criteria\[criterionIndex\]\.id/);
  assert.match(client, /const savedPlans = requirement\.processBehaviorTestPlans \?\? \[\]/,
    'the UI renders server-derived plan applicability instead of raw immutable rows');
  assert.match(client, /processBehaviorTestPlanPresentation\(plan\)/);
  assert.match(client, /aria-label': 'Effective time context \(UTC\)'/);
  assert.match(client, /\$\{type\[0\]\.toUpperCase\(\)\}\$\{type\.slice\(1\)\} case definition/);
  assert.match(client, /typed dataset JSON/);
  assert.match(client, /expected output oracle JSON/);
  assert.match(client, /Capture a complete dataset\/oracle pair now.*mapping INCOMPLETE.*exact selected test path and assertion together later/);
  assert.match(client, /enter dataset and oracle together/);
  assert.match(client, /dataset\/oracle captured; exact test mapping is a later step/);
  assert.match(client, /case NOT_EXECUTED/);
  assert.match(client, /exact pinned test file path/);
  assert.match(client, /exact executable assertion/);
  assert.match(client, /OWNER_PROPOSED_UNVERIFIED mappings require a repository-check run/);
  assert.match(client, /view\?\.repositorySnapshotId/,
    'the plan card renders the sanitized repository.snapshotId pin');
  assert.match(client, /Regenerate v\$\{currentCriterionVersion\} plan/);
  assert.match(client, /Create v\$\{currentCriterionVersion\} plan/);
  assert.match(client, /linked evidence is STALE/);
});

test('behavior plan recovery presentation retains old revision pins and calls for regeneration', () => {
  const stale = processBehaviorTestPlanPresentation({ id: 'behavior-plan-v1', planHash: 'a'.repeat(64),
    requirementHash: 'b'.repeat(64), criterionContractVersion: 1, criterionContractHash: 'c'.repeat(64),
    draftRevision: 4, currentDraftRevision: 5, repository: { snapshotId: 'snapshot-exact-v1' },
    regenerationStatus: 'REGENERATION_REQUIRED', regenerationReason: 'CRITERION_BASELINE_CHANGED',
    currentCriterionContractVersion: 2 });
  assert.match(stale.heading, /REGENERATION_REQUIRED/);
  assert.match(stale.pins, /criterion baseline v1 SHA-256 c{64}/);
  assert.match(stale.status, /Old plan and results remain immutably bound.*baseline v1.*Current baseline v2.*require a newly authorized plan/);
  assert.match(stale.pins, /repository snapshot snapshot-exact-v1/);
  assert.match(stale.status, /shared requirements draft r4.*Current baseline v2.*shared draft r5/);
  assert.equal(stale.regenerationAction, 'Regenerate v2 plan');
  assert.equal(stale.repositorySnapshotId, 'snapshot-exact-v1');
  const current = processBehaviorTestPlanPresentation({ id: 'behavior-plan-v2', planHash: 'd'.repeat(64),
    requirementHash: 'e'.repeat(64), criterionContractVersion: 2, criterionContractHash: 'f'.repeat(64),
    draftRevision: 5, currentDraftRevision: 5, repository: { snapshotId: 'snapshot-exact-v2' },
    regenerationStatus: 'CURRENT', currentCriterionContractVersion: 2,
    evaluationContext: { workspace: { projectId: 'project-exact' }, branch: { branchRef: 'refs/heads/main', commitOid: 'a'.repeat(40) },
      effectiveTime: { value: '2026-10-07T00:00:00.000Z', sourceRef: { id: 'information-effective-date' } } },
    caseDefinitions: { mappingStatus: 'INCOMPLETE', cases: [{ type: 'POSITIVE', definition: 'Produce the declared output.', sourceRef: { id: 'output-1' },
      dataset: { ownerInput: 1 }, expectedOutput: { ownerOutput: 'ready' }, status: 'NOT_EXECUTED',
      executionMapping: { status: 'OWNER_PROPOSED_UNVERIFIED', assertionId: 'assertion-1', testName: 'positive exact test',
        testPath: 'test/positive.test.mjs', testFileHash: 'a'.repeat(64) } },
      { type: 'NEGATIVE', definition: 'Reject the unsafe case.', sourceRef: { id: 'risk-1' },
        dataset: { criterionId: 'C1', mandatory: true, assertions: [] },
        expectedOutput: { status: 400, planSaved: false }, status: 'NOT_EXECUTED',
        executionMapping: { status: 'INCOMPLETE' } },
      { type: 'RECOVERY', definition: 'Regenerate after revision.', sourceRef: { id: 'process-1' }, status: 'NOT_EXECUTED' }] } });
  assert.match(current.heading, /CURRENT/);
  assert.match(current.status, /does not assert business truth/);
  assert.equal(current.repositorySnapshotId, 'snapshot-exact-v2');
  assert.equal(current.regenerationAction, null);
  assert.match(current.contextPins, /project-exact.*refs\/heads\/main.*2026-10-07T00:00:00.000Z.*information-effective-date/);
  assert.equal(current.scenarioCases.length, 3);
  assert.ok(current.scenarioCases.every((entry) => entry.includes('NOT_EXECUTED')));
  assert.equal(current.scenarioMappingsStatus, 'INCOMPLETE');
  assert.match(current.scenarioCases[0], /dataset \{"ownerInput":1\}.*expected \{"ownerOutput":"ready"\}.*assertion assertion-1.*TEST test\/positive.test.mjs.*OWNER_PROPOSED_UNVERIFIED/);
  assert.match(current.scenarioCases[1], /dataset \{"criterionId":"C1","mandatory":true,"assertions":\[\]\}.*expected \{"status":400,"planSaved":false\}.*dataset\/oracle captured · execution mapping INCOMPLETE/);
});

test('R1 recovery mapping remains available when N2 and N3 definitions are absent', () => {
  const plan = { id: 'plan-r1-v1', planHash: 'a'.repeat(64), criterionContractVersion: 1,
    caseDefinitions: { cases: [{ type: 'RECOVERY', dataset: { cases: [{ id: 'R1' }] },
      expectedOutput: { cases: [{ id: 'R1' }] } }] } };
  const requirement = { processBehaviorTestPlans: [plan], processRunEvidenceLinks: [{
    behaviorEvaluation: { planId: plan.id, planHash: plan.planHash, result: 'TEST_PASS' },
  }] };
  const eligible = productHarnessEligiblePlanGroups(requirement);
  assert.deepEqual(eligible.plans, [], 'N2/N3 request forms have no eligible definitions');
  assert.deepEqual(eligible.r1Plans, [plan], 'the linked v1 recovery plan remains eligible on its own');
  assert.deepEqual(productHarnessRequestFormVisibility({ owner: true, ...eligible }), {
    subcaseForms: false, r1RecoveryForm: true,
  });
  assert.deepEqual(productHarnessRequestFormVisibility({ owner: false, ...eligible }), {
    subcaseForms: false, r1RecoveryForm: false,
  });
  const client = readFileSync(new URL('../../public/sdlc.js', import.meta.url), 'utf8');
  assert.match(client, /if \(requestFormVisibility\.r1RecoveryForm\)/,
    'the R1 form renders outside the N2/N3 form gate');
  assert.match(client, /product-harness-r1-request-form/);
});

test('R2 shared-draft recovery mapping is independently selectable from a passing linked plan', () => {
  const plan = { id: 'plan-r2-shared-draft', planHash: 'b'.repeat(64), criterionContractVersion: 1,
    caseDefinitions: { cases: [{ type: 'RECOVERY', dataset: { cases: [{ id: 'R2' }] },
      expectedOutput: { cases: [{ id: 'R2' }] } }] } };
  const requirement = { processBehaviorTestPlans: [plan], processRunEvidenceLinks: [{
    behaviorEvaluation: { planId: plan.id, planHash: plan.planHash, result: 'TEST_PASS' },
  }] };
  const eligible = productHarnessEligiblePlanGroups(requirement);
  assert.deepEqual(eligible.plans, []);
  assert.deepEqual(eligible.r2Plans, [plan]);
  assert.deepEqual(productHarnessRequestFormVisibility({ owner: true, ...eligible }), {
    subcaseForms: false, r1RecoveryForm: false, r2RecoveryForm: true,
  });
  assert.deepEqual(productHarnessRequestFormVisibility({ owner: false, ...eligible }), {
    subcaseForms: false, r1RecoveryForm: false, r2RecoveryForm: false,
  });
  const client = readFileSync(new URL('../../public/sdlc.js', import.meta.url), 'utf8');
  assert.match(client, /if \(requestFormVisibility\.r2RecoveryForm\)/,
    'the R2 request form renders independently from N2/N3 definitions');
  assert.match(client, /product-harness-r2-request-form/);
  assert.match(client, /SHARED_REQUIREMENTS_DRAFT_CHANGED/);
});

test('N3 stage copy follows saved receipt evidence instead of claiming both stages are pending', () => {
  const mapping = { candidatePath: 'tests/learning.test.js', sourceTestBytesHash: 'a'.repeat(64) };
  const pending = n3StageStatusCopy(mapping, null);
  assert.match(pending, /Neither stage has executed yet/);
  assert.match(pending, /tests\/learning\.test\.js/);

  const passed = n3StageStatusCopy(mapping, { status: 'PASS', sourceStage: {
    path: mapping.candidatePath, bytesHash: mapping.sourceTestBytesHash, exitCode: 1,
    tap: '# tests 1\n# pass 0\n# fail 1\n',
  }, candidate: { deletedPath: mapping.candidatePath, deletedPathHash: mapping.sourceTestBytesHash,
    changes: [{ path: mapping.candidatePath, change: 'deleted' }] },
  run: { errorCode: 'BEHAVIOR_CANDIDATE_ORPHAN_PATH' }, verifierDispatchCount: 0 });
  assert.match(passed, /pinned source bytes.*exited 1.*one failure/);
  assert.match(passed, /rejected deletion of that same pinned path before verifier dispatch/);
  assert.doesNotMatch(passed, /Neither stage has executed yet/);

  const inconclusive = n3StageStatusCopy(mapping, { status: 'INCONCLUSIVE' });
  assert.match(inconclusive, /could not both be confirmed/);
  assert.match(inconclusive, /No stage result is claimed/);
  assert.doesNotMatch(inconclusive, /Original test fails:/);
  assert.doesNotMatch(inconclusive, /Unauthorized deletion is rejected:/);
});

test('evidence review presentation preserves explicit conflict resolution and mandatory failure', () => {
  const view = processEvidenceReviewPresentation({ id: 'review-ac4', linkId: 'link-ac4', reviewerPrincipal: 'oidc:reviewer',
    reviewHash: 'a'.repeat(64), status: 'HUMAN_REVIEWED', disposition: 'CONTRADICTED', applicability: 'CURRENT',
    integrityStatus: 'VALID', verificationStatus: 'NOT_EXECUTED', truthStatus: 'UNVERIFIED',
    acceptanceStatus: 'BLOCKED_MANDATORY_FAILURE', failedMandatoryCriterionIds: ['TECH-BOUNDARY'],
    conflictResolution: { decision: 'PRESERVE_CRITERION_OUTCOMES', rationale: 'Keep both findings.',
      recordedBy: 'oidc:reviewer', businessCriterionIds: ['BUSINESS-OUTCOME'],
      technicalCriterionIds: ['TECH-BOUNDARY'], failedMandatoryCriterionIds: ['TECH-BOUNDARY'] },
    criteria: [{ disposition: 'SUPPORTED', criterion: 'Business outcome', note: 'Supported.' },
      { disposition: 'CONTRADICTED', criterion: 'Technical boundary', note: 'Failed.' }],
    scenarioCases: [{ type: 'POSITIVE', executionReviewStatus: 'REVIEWED_FOR_TEST_EXECUTION',
      executionDecision: 'APPROVE_FOR_TEST_EXECUTION', note: 'Pinned positive case is ready for test execution.' },
    { type: 'NEGATIVE', executionReviewStatus: 'CHANGES_REQUESTED', executionDecision: 'REQUEST_CHANGES',
      note: 'Complete the negative mapping before execution.' }] });
  assert.match(view.status, /acceptance BLOCKED_MANDATORY_FAILURE/);
  assert.match(view.status, /truth UNVERIFIED/);
  assert.match(view.resolution, /Explicit resolution by oidc:reviewer: PRESERVE_CRITERION_OUTCOMES/);
  assert.match(view.resolution, /failed mandatory criteria TECH-BOUNDARY/);
  assert.deepEqual(view.criteria.map((entry) => entry.split(':')[0]), ['SUPPORTED', 'CONTRADICTED']);
  assert.match(view.scenarios[0], /POSITIVE definition.*REVIEWED_FOR_TEST_EXECUTION.*APPROVE_FOR_TEST_EXECUTION/);
  assert.match(view.scenarios[1], /NEGATIVE definition.*CHANGES_REQUESTED.*REQUEST_CHANGES/);
  assert.doesNotMatch(view.scenarios[0], /ACCEPTED|EXECUTED|VERIFIED/,
    'scenario review status does not imply acceptance, execution or verification');
});

test('intent evaluation acceptance presentation stays scoped and does not claim truth or verification', () => {
  const view = intentEvaluationAcceptancePresentation({ id: 'intent-evaluation-acceptance-123e4567-e89b-12d3-a456-426614174000',
    status: 'ACCEPTED', applicability: 'CURRENT', integrityStatus: 'VALID', requirementId: 'REQ-PROC-abc123def456',
    draftRevision: 2, source: { processId: 'process-a', blueprintId: 'blueprint-a', blueprintVersion: 4 },
    evaluationHash: 'a'.repeat(64), reviewHash: 'b'.repeat(64), acceptanceHash: 'c'.repeat(64),
    acceptedBy: 'oidc:owner', verificationStatus: 'NOT_EXECUTED', truthStatus: 'UNVERIFIED', reason: 'Evidence was reviewed.',
    statement: 'This accepts the current scoped intent evaluation record only.' });
  assert.match(view.heading, /ACCEPTED · CURRENT · integrity VALID/);
  assert.match(view.pins, /blueprint-a v4.*evaluation SHA-256 a{64}.*review SHA-256 b{64}/);
  assert.match(view.status, /accepted by oidc:owner.*verification remains NOT_EXECUTED.*business truth remains UNVERIFIED/);
});

test('intent evaluation acceptance action is reachable from the reviewed process evidence card', () => {
  const client = readFileSync(new URL('../../public/sdlc.js', import.meta.url), 'utf8');
  assert.match(client, /intent-evaluation-acceptances/);
  assert.match(client, /Accept intent evaluation/);
  assert.match(client, /canAcceptIntentEvaluation\(\{ authenticated: state\.authenticated/);
  assert.match(client, /accountableOwner: state\.changeCase\.accountableOwner/);
  assert.match(client, /review\.reviewerPrincipal !== state\.principal/);
  assert.match(client, /review\.criteria\.every\(\(entry\) => entry\.disposition === 'SUPPORTED'\)/);
  assert.match(client, /Business truth remains UNVERIFIED and runtime verification remains NOT EXECUTED/);
});

test('intent evaluation acceptance action requires owner, independent current review and unaccepted current revision', () => {
  const input = { authenticated: true, principal: 'owner-1', accountableOwner: 'owner-1', draftRevision: 3,
    requirement: { id: 'REQ-PROC-abc123def456', reviewCriteria: [{ criterionId: 'C1' }] },
    link: { id: 'link-1', applicability: 'CURRENT', status: 'UNVERIFIED', verificationStatus: 'NOT_EXECUTED', behaviorEvaluation: {
      status: 'CHECKED_BEHAVIOR', result: 'TEST_PASS', businessTruthStatus: 'UNVERIFIED' } },
    reviews: [{ linkId: 'link-1', integrityStatus: 'VALID', applicability: 'CURRENT',
      acceptanceStatus: 'REVIEW_ONLY_NOT_ACCEPTED', reviewerPrincipal: 'reviewer-1',
      criteria: [{ disposition: 'SUPPORTED' }] }], acceptances: [] };
  assert.equal(canAcceptIntentEvaluation(input), true);
  assert.equal(canAcceptIntentEvaluation({ ...input, principal: 'reviewer-1' }), false,
    'the reviewer cannot accept their own review');
  assert.equal(canAcceptIntentEvaluation({ ...input, principal: 'other-1' }), false,
    'a non-owner cannot accept');
  assert.equal(canAcceptIntentEvaluation({ ...input, reviews: [{ ...input.reviews[0], reviewerPrincipal: 'owner-1' }] }), false);
  assert.equal(canAcceptIntentEvaluation({ ...input, link: { ...input.link, applicability: 'STALE' } }), false);
  assert.equal(canAcceptIntentEvaluation({ ...input, acceptances: [{ status: 'ACCEPTED', integrityStatus: 'VALID',
    applicability: 'CURRENT', requirementId: input.requirement.id, draftRevision: 3 }] }), false,
  'a valid acceptance for the current revision hides the action');
  assert.equal(canAcceptIntentEvaluation({ ...input, acceptances: [{ status: 'ACCEPTED', integrityStatus: 'VALID',
    applicability: 'STALE', requirementId: input.requirement.id, draftRevision: 2 }] }), true,
  'a historical stale acceptance does not suppress a new current-revision action');
});

test('evidence review UI surfaces conflict resolution and preserves criterion outcomes', () => {
  const client = readFileSync(new URL('../../public/sdlc.js', import.meta.url), 'utf8');
  assert.match(client, /Explicit reviewer resolution when required/);
  assert.match(client, /data-review-conflict-rationale/);
  assert.match(client, /Conflict detected between typed business and technical criteria/);
  assert.match(client, /A mandatory criterion is failed\. Record a rationale; the failure remains failed and acceptance stays blocked/);
  assert.match(client, /decision: 'PRESERVE_CRITERION_OUTCOMES'/);
  assert.match(client, /cannot override a failed mandatory criterion/);
});

test('SDLC API persists and resumes a golden case across process restart', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-api-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let app = await start(root);
  t.after(async () => { if (app.server.listening) await close(app.server); });
  let changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ mode: 'golden' }) }, 201);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/run`, { method: 'POST', body: JSON.stringify({ version: changeCase.version, actor: 'orchestrator', idempotencyKey: 'api-run-1' }) });
  assert.equal(changeCase.status, 'NEEDS_HUMAN');
  assert.equal(changeCase.currentStage, 'S9');
  const id = changeCase.id;
  const version = changeCase.version;
  await close(app.server);

  app = await start(root);
  changeCase = await request(app.base, `/api/sdlc/cases/${id}`);
  assert.equal(changeCase.version, version);
  assert.equal(changeCase.currentStage, 'S9');
  assert.ok(changeCase.traceability.nodes.some((node) => node.type === 'ChangeSet'));
  assert.ok(changeCase.evidenceIntegrity.every((entry) => entry.valid));
});

test('runtime observations persist a non-authorizing design correction proposal across restart', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-observation-proposal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let app = await start(root);
  t.after(async () => { if (app.server.listening) await close(app.server); });
  let changeCase = await request(app.base, '/api/sdlc/cases', {
    method: 'POST', body: JSON.stringify({ mode: 'golden' }),
  }, 201);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/run`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, actor: 'orchestrator', idempotencyKey: 'ac4-run' }),
  });
  assert.equal(changeCase.currentStage, 'S9');
  const approved = await request(app.base, `/api/sdlc/cases/${changeCase.id}/approve`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'ac4-approve',
      principal: 'independent-release-owner', roles: ['release-approver', 'control-owner'] }),
  });
  const released = await request(app.base, `/api/sdlc/cases/${changeCase.id}/advance`, {
    method: 'POST', body: JSON.stringify({ version: approved.version, actor: 'release-stage', idempotencyKey: 'ac4-release' }),
  });
  assert.equal(released.artifacts.release.status, 'RELEASED');
  const releaseBeforeObservation = structuredClone(released.artifacts.release);
  const observation = await request(app.base, `/api/sdlc/cases/${changeCase.id}/observe`, {
    method: 'POST', body: JSON.stringify({ version: released.version, actor: 'operations-observer',
      idempotencyKey: 'ac4-observe', signals: { technicalHealthy: false, controlExceptions: 2, manualWorkReduction: 60 } }),
  });
  assert.equal(observation.artifacts.observation.window, 'synthetic:first-30-days');
  const outcome = await request(app.base, `/api/sdlc/cases/${changeCase.id}/advance`, {
    method: 'POST', body: JSON.stringify({ version: observation.version, actor: 'outcome-stage', idempotencyKey: 'ac4-outcome' }),
  });
  const learned = await request(app.base, `/api/sdlc/cases/${changeCase.id}/advance`, {
    method: 'POST', body: JSON.stringify({ version: outcome.version, actor: 'learning-stage', idempotencyKey: 'ac4-learning' }),
  });
  const proposal = learned.artifacts.learning.proposals.find((entry) => entry.type === 'DESIGN_CORRECTION_CLAIM');
  assert.ok(proposal);
  assert.equal(proposal.status, 'PROPOSED_NOT_APPLIED');
  assert.equal(proposal.authorityRequired, true);
  assert.deepEqual(proposal.derivedFrom, [learned.artifacts.observation.id, learned.artifacts.observation.contentHash,
    learned.artifacts.observation.releaseRef, learned.artifacts.outcome.id]);
  assert.equal(learned.artifacts.learning.authoritativeModelMutated, false);
  assert.equal(learned.artifacts.release.contentHash, releaseBeforeObservation.contentHash);
  assert.equal(learned.approvals.length, 1, 'observation and correction proposal add no release approval');
  const caseId = learned.id;
  await close(app.server);
  app = await start(root);
  const restored = await request(app.base, `/api/sdlc/cases/${caseId}`);
  assert.deepEqual(restored.artifacts.learning.proposals, learned.artifacts.learning.proposals);
  assert.equal(restored.artifacts.observation.window, 'synthetic:first-30-days');
  assert.equal(restored.artifacts.release.contentHash, releaseBeforeObservation.contentHash);
  assert.equal(restored.approvals.length, 1);
  assert.ok(restored.evidenceIntegrity.every((entry) => entry.valid));
});

test('SDLC actions block when a sealed context manifest no longer verifies', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-context-integrity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await start(root);
  t.after(async () => { if (app.server.listening) await close(app.server); });
  let changeCase = await request(app.base, '/api/sdlc/cases', {
    method: 'POST', body: JSON.stringify({ mode: 'golden' }),
  }, 201);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/run`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, actor: 'orchestrator', idempotencyKey: 'context-pin-run' }),
  });
  assert.equal(changeCase.contextManifestIntegrity.valid, true);
  assert.equal(changeCase.artifacts.context.manifestVersion, 4);
  assert.equal(changeCase.artifacts.context.savedProjectCoverage, null);
  const tampered = await app.sdlcStore.get(changeCase.id);
  tampered.artifacts.context.coverage[0].rationale = 'Tampered coverage';
  await app.sdlcStore.save(tampered);

  const blocked = await request(app.base, `/api/sdlc/cases/${changeCase.id}/advance`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, actor: 'orchestrator', idempotencyKey: 'context-pin-advance' }),
  }, 409);
  assert.equal(blocked.error.code, 'CONTEXT_MANIFEST_INTEGRITY_INVALID');
  assert.match(blocked.error.message, /planning and case changes are blocked/i);
  assert.equal(blocked.error.recoveryActions[0].type, 'create_new_case');
  const unchanged = await request(app.base, `/api/sdlc/cases/${changeCase.id}`);
  assert.equal(unchanged.version, changeCase.version);
  assert.equal(unchanged.contextManifestIntegrity.valid, false);

  const unsupported = await app.sdlcStore.get(changeCase.id);
  unsupported.artifacts.context.manifestVersion = 77;
  unsupported.artifacts.context.provenanceManifestHash = digest(Object.fromEntries(Object.entries(unsupported.artifacts.context)
    .filter(([key]) => key !== 'provenanceManifestHash')));
  await app.sdlcStore.save(unsupported);
  const blockedUnsupported = await request(app.base, `/api/sdlc/cases/${changeCase.id}/run`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, actor: 'orchestrator', idempotencyKey: 'context-pin-unsupported-version' }),
  }, 409);
  assert.equal(blockedUnsupported.error.code, 'CONTEXT_MANIFEST_INTEGRITY_INVALID');
  const unchangedUnsupported = await request(app.base, `/api/sdlc/cases/${changeCase.id}`);
  assert.equal(unchangedUnsupported.version, changeCase.version);
  assert.equal(unchangedUnsupported.contextManifestIntegrity.valid, false);
  assert.match(unchangedUnsupported.contextManifestIntegrity.reason, /unsupported version/);

  const missingVersion = await app.sdlcStore.get(changeCase.id);
  delete missingVersion.artifacts.context.manifestVersion;
  missingVersion.artifacts.context.provenanceManifestHash = digest(Object.fromEntries(Object.entries(missingVersion.artifacts.context)
    .filter(([key]) => key !== 'provenanceManifestHash')));
  await app.sdlcStore.save(missingVersion);
  const blockedMissingVersion = await request(app.base, `/api/sdlc/cases/${changeCase.id}/run`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, actor: 'orchestrator', idempotencyKey: 'context-pin-missing-version' }),
  }, 409);
  assert.equal(blockedMissingVersion.error.code, 'CONTEXT_MANIFEST_INTEGRITY_INVALID');
  const unchangedMissingVersion = await request(app.base, `/api/sdlc/cases/${changeCase.id}`);
  assert.equal(unchangedMissingVersion.version, changeCase.version);
  assert.equal(unchangedMissingVersion.contextManifestIntegrity.valid, false);
  assert.match(unchangedMissingVersion.contextManifestIntegrity.reason, /missing its version/);
});

test('source selection from an inaccessible tenant blocks without exposing project data and gives recovery guidance', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-inaccessible-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceTenant = 'tenant-source-private';
  const requestingTenant = 'tenant-requester';
  const principal = 'principal-without-source-membership';
  let principalProjectReads = 0;
  let caseSaves = 0;
  const projectStore = {
    async init() {},
    async getWithPrincipalAuthority(query) {
      principalProjectReads += 1;
      assert.equal(query.tenantId, requestingTenant);
      assert.equal(query.principal, principal);
      assert.deepEqual(query.anyPrincipalRoleGroups, [['workspace-read', 'workspace-write', 'tenant-admin']]);
      return null;
    },
  };
  const changeCaseStore = { async init() {}, async saveForPrincipal() { caseSaves += 1; } };
  const identity = { tenantId: requestingTenant, principal, roles: ['workspace-write'], actorType: 'human' };
  const app = createApp({
    dataDirectory: path.join(root, 'blueprints'), sdlcDirectory: path.join(root, 'sdlc'),
    projectStore, changeCaseStore,
    oidcAuthenticator: { async authenticate() { return identity; } },
    oidcSessionStore: { async get() { return null; }, async resolve() { return { ...identity, authzGeneration: 1 }; } },
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  app.base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(() => close(app.server));
  const project = createProject('Private source project name');
  for (const answer of [
    'A private design goal.',
    'Only the source tenant can read this design detail.',
    'Private financial assumptions remain in the source tenant.',
    'Only the accountable owner may approve changes.',
  ]) addConversationTurn(project, answer);
  project.version = 1;
  project.tenantId = sourceTenant;
  const blueprint = latestBlueprint(project);
  const source = Object.values(blueprint.areas).flatMap((area) => area.items).find((item) => item.type === 'information');
  assert.ok(source);
  const headers = { authorization: 'Bearer unavailable-source-principal' };

  const denied = await request(app.base, '/api/sdlc/cases', {
    method: 'POST', headers,
    body: JSON.stringify({ projectId: project.id, sourceObjectId: source.id,
      expectedProjectVersion: project.version, expectedBlueprintId: blueprint.id,
      expectedBlueprintVersion: blueprint.version, mode: 'golden' }),
  }, 404);
  assert.match(denied.error, /saved project source is unavailable in this workspace/i);
  assert.match(denied.error, /choose a saved project you can access and select its current design/i);
  assert.doesNotMatch(JSON.stringify(denied), new RegExp(project.name));
  assert.doesNotMatch(JSON.stringify(denied), new RegExp(source.name));
  assert.doesNotMatch(JSON.stringify(denied), new RegExp(source.detail));
  assert.equal(principalProjectReads, 1);
  assert.equal(caseSaves, 0, 'an inaccessible source cannot create a planning case or truncate its context');
});

test('missing critical context blocks the saved case with domain-specific recovery guidance', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-critical-context-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let app = await start(root);
  t.after(async () => { if (app.server.listening) await close(app.server); });
  const created = await request(app.base, '/api/sdlc/cases', {
    method: 'POST', body: JSON.stringify({ mode: 'golden', mutation: 'missing_aml' }),
  }, 201);
  const blocked = await request(app.base, `/api/sdlc/cases/${created.id}/run`, {
    method: 'POST', body: JSON.stringify({ version: created.version, actor: 'orchestrator', idempotencyKey: 'missing-critical-context-run' }),
  });
  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(blocked.currentStage, 'S1');
  assert.equal(blocked.gateHistory.at(-1).gate, 'G1');
  assert.equal(blocked.gateHistory.at(-1).status, 'FAILED');
  const contextGate = blocked.evaluations.find((entry) => entry.definitionRef === 'context-sufficiency');
  assert.equal(contextGate.status, 'FAILED');
  const missingContextFindings = contextGate.findings.filter((entry) => entry.code === 'CRITICAL_CONTEXT_MISSING');
  assert.deepEqual(missingContextFindings.map((entry) => entry.message).sort(), [
    'Critical control context is missing.', 'Critical regulation context is missing.',
  ]);
  assert.match(missingContextFindings.find((entry) => /regulation/.test(entry.message)).remediation, /Provide current authoritative regulation evidence/);
  assert.match(missingContextFindings.find((entry) => /control/.test(entry.message)).remediation, /Provide current authoritative control evidence/);
  assert.equal(blocked.artifacts.requirements, undefined, 'planning artifacts are not created after the critical context gap');
  assert.equal(blocked.contextManifestIntegrity.valid, true, 'the truthful incomplete-context record remains verifiable');
  const view = caseUiModel(blocked);
  assert.match(view.checkpoint.body, /Critical regulation context is missing/);
  assert.match(view.checkpoint.remediation, /Provide current authoritative regulation evidence/);

  const caseId = blocked.id;
  await close(app.server);
  app = await start(root);
  const reloaded = await request(app.base, `/api/sdlc/cases/${caseId}`);
  assert.equal(reloaded.version, blocked.version);
  assert.equal(reloaded.gateHistory.at(-1).gate, 'G1');
  assert.deepEqual(reloaded.artifacts.context.unknownDependencies.map((entry) => entry.domain), ['regulation', 'control']);
  assert.equal(reloaded.contextManifestIntegrity.valid, true);
  assert.match(caseUiModel(reloaded).checkpoint.remediation, /Provide current authoritative regulation evidence/);
});

test('local SDLC case creation rejects Sentinel pins or required scope without a saved source', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-sentinel-without-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await start(root);
  t.after(async () => { if (app.server.listening) await close(app.server); });
  const before = (await request(app.base, '/api/sdlc/cases')).cases.length;
  const pinned = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({
    mode: 'golden', sentinelAssessmentId: 'sentinel-assessment-00000000-0000-4000-8000-000000000001', sentinelReportHash: 'a'.repeat(64),
  }) }, 400);
  assert.match(pinned.error, /Sentinel assessment pins and required scopes need a selected saved-project source/);
  const required = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({
    mode: 'golden', sentinelRequiredScope: 'PROCESS_ACCOUNTABILITY',
  }) }, 400);
  assert.match(required.error, /Sentinel assessment pins and required scopes need a selected saved-project source/);
  const forgedPin = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({
    mode: 'golden', savedProjectPin: { projectVersion: 9001 },
  }) }, 400);
  assert.match(forgedPin.error, /derived from the verified source selection/);
  assert.equal((await request(app.base, '/api/sdlc/cases')).cases.length, before, 'invalid local requests create no synthetic cases');
});

test('SDLC case pins a saved design source, rejects stale or unresolved selections, and retains provenance after project edits and restart', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-source-pin-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let app = await start(root);
  const project = createProject('Saved source binding');
  for (const answer of [
    'A membership that reduces restaurant equipment downtime.',
    'Independent restaurant owners need clear maintenance records.',
    'Monthly membership funds preventive service.',
    'Owners approve safety critical work.',
  ]) addConversationTurn(project, answer);
  delete project.version;
  project.tenantId = 'tenant-reference-bank';
  await app.store.save(project);
  const normalizedLegacyProject = await request(app.base, `/api/v1/projects/${project.id}`);
  assert.equal(normalizedLegacyProject.data.version, 1);
  const blueprint = latestBlueprint(project);
  const source = Object.values(blueprint.areas).flatMap((area) => area.items).find((item) => item.id === 'control-human-authority');
  assert.ok(source);
  const selection = {
    mode: 'golden', projectId: project.id, sourceObjectId: source.id,
    expectedProjectVersion: 1, expectedBlueprintId: blueprint.id,
    expectedBlueprintVersion: blueprint.version,
    // This client snapshot is deliberately false; the server must resolve saved state.
    sourceBinding: { snapshot: { id: source.id, name: 'forged client snapshot' }, sourceHash: 'forged' },
    rawIntent: 'Change the saved information object while preserving its current meaning.',
  };
  const before = (await request(app.base, '/api/sdlc/cases')).cases.length;
  const nullBody = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: 'null' }, 400);
  const arrayBody = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: '[]' }, 400);
  assert.match(nullBody.error, /JSON object/);
  assert.match(arrayBody.error, /JSON object/);
  await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ ...selection, sourceObjectId: 'missing-object' }) }, 404);
  await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ ...selection, expectedProjectVersion: 0 }) }, 409);
  await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ ...selection, expectedBlueprintVersion: blueprint.version - 1 }) }, 409);
  await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ projectId: project.id, mode: 'golden' }) }, 400);
  assert.equal((await request(app.base, '/api/sdlc/cases')).cases.length, before);

  let changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify(selection) }, 201);
  assert.equal(changeCase.sourceBinding.snapshot.name, source.name);
  assert.notEqual(changeCase.sourceBinding.snapshot.name, 'forged client snapshot');
  assert.equal(changeCase.sourceBinding.sourceHash.length, 64);
  assert.equal(changeCase.sourceBinding.blueprintSchemaVersion, 1);
  assert.equal(changeCase.sourceBindingIntegrity.valid, true);
  assert.equal(changeCase.contextManifestIntegrity, null, 'the context manifest is reported after context discovery runs');
  assert.equal(changeCase.sourceBinding.integrityContext.state, 'NOT_ASSESSED');
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/run`, { method: 'POST', body: JSON.stringify({ version: changeCase.version, actor: 'orchestrator', idempotencyKey: 'source-pin-run' }) });
  assert.ok(changeCase.artifacts.context.sourceBindingEvidenceRef);
  assert.ok(changeCase.artifacts.context.evidenceRefs.includes(changeCase.artifacts.context.sourceBindingEvidenceRef));
  assert.equal(changeCase.evidenceLedger.find((entry) => entry.id === changeCase.artifacts.context.sourceBindingEvidenceRef).authority, 'SAVED_PROJECT_DESIGN');
  assert.equal(changeCase.artifacts.context.integrityContext.state, 'NOT_ASSESSED');
  assert.equal(changeCase.contextManifestIntegrity.valid, true);
  assert.equal(changeCase.artifacts.context.manifestVersion, 4);
  const savedCoverage = changeCase.artifacts.context.savedProjectCoverage;
  assert.equal(savedCoverage.status, 'PARTIAL');
  assert.equal(savedCoverage.candidateUniverse.exhaustive, true);
  assert.match(savedCoverage.candidateUniverse.description, /not a project-wide or enterprise-wide inventory/);
  assert.ok(savedCoverage.classifications.some((entry) => entry.status === 'REPRESENTED' && entry.objectRef === source.id));
  assert.ok(savedCoverage.classifications.some((entry) => entry.status === 'UNKNOWN' && /external/.test(entry.domain)));
  assert.equal(savedCoverage.sourcePins.projectPinHash, digest(changeCase.artifacts.context.savedProjectPin));
  assert.equal(savedCoverage.sourcePins.blueprintSnapshotHash, changeCase.sourceBinding.sentinelContext.blueprintSnapshotHash);
  assert.equal(savedCoverage.sourcePins.sentinel.availableProfile.id, 'orgward-sentinel-operational-accountability');
  assert.equal(savedCoverage.sourcePins.sentinel.availableProfile.hash.length, 64);
  assert.ok(savedCoverage.classifications.some((entry) => entry.domain === 'sentinel-profile' && entry.status === 'REPRESENTED'));
  assert.equal(savedCoverage.classificationHash, digest(savedCoverage.classifications));
  const historicalV3 = structuredClone(changeCase);
  const oldCoverage = historicalV3.artifacts.context.savedProjectCoverage;
  historicalV3.artifacts.context.manifestVersion = 3;
  historicalV3.artifacts.context.savedProjectCoverage = { schemaVersion: 1, status: 'PARTIAL',
    sourcePinHash: oldCoverage.sourcePinHash, processTraceHash: oldCoverage.processTraceHash,
    represented: oldCoverage.represented, unknownDependencies: oldCoverage.unknownDependencies.slice(0, 4)
      .map((entry) => ({ domain: entry.domain, description: entry.reason })),
    excludedDependencies: { status: 'NOT_ENUMERATED', reason: 'The source adapter does not retrieve a complete project inventory; unselected project dependencies remain unknown rather than being declared excluded.' } };
  const v3Creation = historicalV3.evidenceLedger.find((entry) => entry.id === historicalV3.artifacts.context.contextCreationEvidenceRef);
  v3Creation.sourceId = `sdlc:case:${historicalV3.id}:context-manifest-created:v3`;
  v3Creation.content = { manifestVersion: 3, sourceBindingHash: historicalV3.sourceBinding.bindingHash,
    savedProjectPinHash: digest(historicalV3.artifacts.context.savedProjectPin),
    savedProjectCoverageHash: digest(historicalV3.artifacts.context.savedProjectCoverage) };
  v3Creation.contentHash = digest(v3Creation.content);
  v3Creation.provenanceChain = [`case:${historicalV3.id}`, 'context-manifest-version:3',
    `saved-project-pin:sha256:${digest(historicalV3.artifacts.context.savedProjectPin)}`,
    `saved-project-coverage:sha256:${digest(historicalV3.artifacts.context.savedProjectCoverage)}`];
  historicalV3.artifacts.context.evidenceManifest = historicalV3.evidenceLedger
    .filter((entry) => historicalV3.artifacts.context.evidenceRefs.includes(entry.id)).map((entry) => ({
      evidenceRef: entry.id, contentHash: entry.contentHash, sourceId: entry.sourceId, sourceType: entry.sourceType,
      objectRef: entry.objectRef, authority: entry.authority, freshness: entry.freshness,
    }));
  const { provenanceManifestHash: _v4Hash, ...v3Manifest } = historicalV3.artifacts.context;
  historicalV3.artifacts.context.provenanceManifestHash = digest(v3Manifest);
  assert.equal(verifyContextManifest(historicalV3).valid, true, 'historical source-bound v3 coverage still verifies under its original recipe');
  const changedIntent = structuredClone(changeCase);
  changedIntent.intent.nonGoals = [...changedIntent.intent.nonGoals, 'No unrelated source reuse.'];
  const { provenanceManifestHash: _changedIntentHash, ...changedIntentManifest } = changedIntent.artifacts.context;
  changedIntent.artifacts.context.provenanceManifestHash = digest(changedIntentManifest);
  assert.equal(verifyContextManifest(changedIntent).valid, false, 'a changed intent cannot reuse the original classifications even if the manifest is resealed');
  const changedSource = structuredClone(changeCase);
  changedSource.sourceBinding.sourceHash = 'f'.repeat(64);
  const { provenanceManifestHash: _changedSourceHash, ...changedSourceManifest } = changedSource.artifacts.context;
  changedSource.artifacts.context.provenanceManifestHash = digest(changedSourceManifest);
  assert.equal(verifyContextManifest(changedSource).valid, false, 'a changed source cannot reuse the original classifications even if the manifest is resealed');
  const requestedImpact = changeCase.artifacts.impact.impacts.find((entry) => entry.isRequestedSource);
  assert.equal(requestedImpact.objectRef, source.id);
  assert.equal(requestedImpact.sourceHash, changeCase.sourceBinding.sourceHash);
  assert.match(requestedImpact.reason, /saved-design/);
  assert.equal(changeCase.enterpriseSnapshot.sourceKind, 'synthetic-reference-model');

  const seededCase = await app.sdlcStore.get(changeCase.id);
  seededCase.artifacts.requirements = { acceptedBaseline: { sourceHash: changeCase.sourceBinding.sourceHash, contentHash: 'accepted-requirements-hash' } };
  seededCase.artifacts.architecture = { acceptedBaseline: { sourceHash: changeCase.sourceBinding.sourceHash, draftHash: 'accepted-architecture-hash' } };
  seededCase.evaluations = [{ id: 'historical-evaluation' }];
  seededCase.approvals = [{ id: 'historical-approval' }];
  await app.sdlcStore.save(seededCase);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}`);
  const originalPin = structuredClone(changeCase.sourceBinding);

  const editedProject = await app.store.get(project.id, project.tenantId);
  const target = Object.values(latestBlueprint(editedProject).areas).flatMap((area) => area.items).find((item) => item.id === source.id);
  editBlueprintObject(editedProject, {
    objectId: target.id,
    name: target.name,
    detail: 'The requester may approve safety critical work without an independent owner.',
  }, 'test-owner');
  assert.equal(latestBlueprint(editedProject).blueprintSchemaVersion, 1);
  editedProject.version = (editedProject.version ?? 1) + 1;
  await app.store.save(editedProject);
  const caseId = changeCase.id;
  await close(app.server);

  app = await start(root); t.after(() => close(app.server));
  changeCase = await request(app.base, `/api/sdlc/cases/${caseId}`);
  const latestProject = await request(app.base, `/api/projects/${project.id}`);
  assert.equal(latestProject.version, 2);
  assert.match(Object.values(latestBlueprint(latestProject).areas).flatMap((area) => area.items).find((item) => item.id === source.id).detail, /requester may approve/);
  assert.deepEqual(changeCase.sourceBinding, originalPin);
  const staleUiBinding = caseUiModel(changeCase, {}, latestProject).sourceBinding;
  assert.equal(staleUiBinding.state, 'PINNED_OLDER_VERSION');
  assert.equal(staleUiBinding.invalidation.status, 'DEPENDENCIES_STALE');
  assert.deepEqual(staleUiBinding.invalidation.staleArtifacts.map((artifact) => artifact.reference), [
    'accepted-requirements-hash', 'accepted-architecture-hash', 'historical-evaluation', 'historical-approval',
  ]);
  assert.equal(staleUiBinding.sourceHash, originalPin.sourceHash);
  assert.equal(changeCase.sourceBindingIntegrity.valid, true);
  assert.equal(changeCase.artifacts.context.sourceBindingHash, originalPin.sourceHash);
  assert.deepEqual(changeCase.artifacts.context.integrityContext, originalPin.integrityContext);
  assert.equal(changeCase.contextManifestIntegrity.valid, true);
  assert.deepEqual(changeCase.artifacts.context.savedProjectCoverage.classifications,
    savedCoverage.classifications, 'the exact classification set survives persisted readback and restart');
  const beforeCoverageTamper = await app.sdlcStore.get(caseId);
  const tamperedCoverage = structuredClone(beforeCoverageTamper);
  tamperedCoverage.artifacts.context.savedProjectCoverage.classifications[0].reason = 'resealed altered classification';
  const { provenanceManifestHash: _oldCoverageSeal, ...coverageManifest } = tamperedCoverage.artifacts.context;
  tamperedCoverage.artifacts.context.provenanceManifestHash = digest(coverageManifest);
  await app.sdlcStore.save(tamperedCoverage);
  changeCase = await request(app.base, `/api/sdlc/cases/${caseId}`);
  assert.equal(changeCase.contextManifestIntegrity.valid, false, 'creation evidence pins the v4 classification set independently of the manifest seal');
  await app.sdlcStore.save(beforeCoverageTamper);
  changeCase = await request(app.base, `/api/sdlc/cases/${caseId}`);
  assert.equal(changeCase.contextManifestIntegrity.valid, true);
  assert.ok(changeCase.artifacts.context.evidenceRefs.includes(changeCase.artifacts.context.sourceBindingEvidenceRef));
  assert.equal(changeCase.artifacts.impact.impacts.find((entry) => entry.isRequestedSource).sourceHash, originalPin.sourceHash);

  const beforeStaleAction = { version: changeCase.version, events: structuredClone(changeCase.events), artifacts: structuredClone(changeCase.artifacts) };
  const staleAction = await request(app.base, `/api/sdlc/cases/${caseId}/run`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, actor: 'orchestrator', idempotencyKey: 'stale-pin-run' }),
  }, 409);
  assert.match(staleAction.error, /older saved design/);
  changeCase = await request(app.base, `/api/sdlc/cases/${caseId}`);
  assert.equal(changeCase.version, beforeStaleAction.version);
  assert.deepEqual(changeCase.events, beforeStaleAction.events);
  assert.deepEqual(changeCase.artifacts, beforeStaleAction.artifacts);

  const tampered = await app.sdlcStore.get(caseId);
  tampered.sourceBinding.snapshot.detail = 'Tampered persisted source';
  await app.sdlcStore.save(tampered);
  changeCase = await request(app.base, `/api/sdlc/cases/${caseId}`);
  assert.equal(changeCase.sourceBindingIntegrity.valid, false);
  const invalidAction = await request(app.base, `/api/sdlc/cases/${caseId}/advance`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, actor: 'orchestrator', idempotencyKey: 'invalid-pin-advance' }),
  }, 409);
  assert.equal(invalidAction.error.code, 'CONTEXT_MANIFEST_INTEGRITY_INVALID');
  assert.match(invalidAction.error.message, /saved context manifest or its evidence references failed verification/);
  const unchangedTampered = await request(app.base, `/api/sdlc/cases/${caseId}`);
  assert.equal(unchangedTampered.version, changeCase.version);
  assert.deepEqual(unchangedTampered.events, changeCase.events);
});

test('SDLC source binding freezes the exact matching integrity report through restart', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-integrity-pin-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let app = await start(root);
  t.after(async () => { if (app.server.listening) await close(app.server); });
  const project = createProject('Design with integrity assessment');
  for (const answer of [
    'A membership that reduces restaurant equipment downtime.',
    'Independent restaurant owners need clear maintenance records.',
    'Monthly membership funds preventive service.',
    'Owners approve safety critical work.',
  ]) addConversationTurn(project, answer);
  const blueprint = latestBlueprint(project);
  const snapshotHash = digest(blueprint);
  applyEnterpriseIntegrityCommand(project, { kind: 'run-integrity-checks', blueprintId: blueprint.id,
    blueprintVersion: blueprint.version, snapshotHash, reason: 'Pin the reviewed saved design.' }, 'test-owner');
  project.version = 1;
  await app.store.save(project);
  const source = Object.values(blueprint.areas).flatMap((area) => area.items).find((item) => item.type === 'information');
  const changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({
    mode: 'golden', projectId: project.id, sourceObjectId: source.id,
    expectedProjectVersion: project.version, expectedBlueprintId: blueprint.id,
    expectedBlueprintVersion: blueprint.version,
  }) }, 201);
  const report = project.enterpriseIntegrityAssessments[0];
  assert.deepEqual(changeCase.sourceBinding.integrityContext, {
    state: 'ASSESSED', blueprintSnapshotHash: snapshotHash,
    assessment: { id: report.id, reportHash: report.reportHash, status: report.status, createdAt: report.createdAt },
  });
  const runCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/run`, { method: 'POST', body: JSON.stringify({
    version: changeCase.version, actor: 'orchestrator', idempotencyKey: 'integrity-pin-run',
  }) });
  assert.deepEqual(runCase.artifacts.context.integrityContext, changeCase.sourceBinding.integrityContext);
  assert.ok(runCase.artifacts.context.evidenceRefs.includes(runCase.artifacts.context.integrityAssessmentEvidenceRef));
  const pinnedReport = runCase.evidenceLedger.find((entry) => entry.id === runCase.artifacts.context.integrityAssessmentEvidenceRef);
  assert.equal(pinnedReport.content.assessment.reportHash, report.reportHash);
  const caseId = changeCase.id;
  await close(app.server);
  app = await start(root);
  const reloaded = await request(app.base, `/api/sdlc/cases/${caseId}`);
  assert.equal(reloaded.sourceBindingIntegrity.valid, true);
  assert.deepEqual(reloaded.sourceBinding.integrityContext, changeCase.sourceBinding.integrityContext);
  assert.deepEqual(reloaded.artifacts.context.integrityContext, changeCase.sourceBinding.integrityContext);
});

test('source-bound requirements are revisioned, validated, owner-accepted and integrity-bound across restart', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-requirements-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let app = await start(root);
  t.after(async () => { if (app.server.listening) await close(app.server); });
  const project = createProject('Requirements source');
  for (const answer of [
    'A membership that reduces restaurant equipment downtime.',
    'Independent restaurant owners need clear maintenance records.',
    'Monthly membership funds preventive service.',
    'Owners approve safety critical work.',
  ]) addConversationTurn(project, answer);
  project.version = 1;
  project.tenantId = 'tenant-reference-bank';
  await app.store.save(project);
  const blueprint = latestBlueprint(project);
  const source = Object.values(blueprint.areas).flatMap((area) => area.items).find((item) => item.type === 'information');
  let changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({
    mode: 'golden', projectId: project.id, sourceObjectId: source.id, expectedProjectVersion: project.version,
    expectedBlueprintId: blueprint.id, expectedBlueprintVersion: blueprint.version,
  }) }, 201);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/run`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'requirements-to-g4' }),
  });
  assert.equal(changeCase.currentStage, 'S4');
  assert.equal(changeCase.status, 'NEEDS_HUMAN');
  const sentinelContext = changeCase.artifacts.context.coverage.find((entry) => entry.domain === 'sentinel');
  assert.equal(sentinelContext.status, 'UNKNOWN', 'unrequired Sentinel scope stays visible without blocking the existing requirements-to-planning journey');
  assert.equal(sentinelContext.required, false);
  assert.ok(changeCase.artifacts.context.unknownDependencies.some((entry) => entry.domain === 'sentinel'));
  const artifact = changeCase.artifacts.requirements;
  assert.equal(artifact.draftRevision, 1);
  assert.equal(artifact.acceptedBaseline, undefined);
  assert.equal(artifact.requirements[0].rationale.startsWith('Synthetic reference template'), true);
  assert.deepEqual(artifact.requirements[0].sourceLinks, [
    { type: 'INTENT', ref: changeCase.intent.id },
    { type: 'SAVED_DESIGN_OBJECT', ref: source.id, hash: changeCase.sourceBinding.sourceHash },
  ]);
  const editable = artifact.requirements[0];
  const patch = { statement: 'Members submit an ownership update through the saved service.', actor: 'Member administrator' };
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/edit-requirements`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, expectedDraftRevision: 1, requirementId: editable.id, changes: patch, idempotencyKey: 'requirements-edit-1' }),
  });
  assert.equal(changeCase.artifacts.requirements.draftRevision, 2);
  assert.equal(changeCase.artifacts.requirements.draftHistory[0].actor, 'local-studio-user');
  assert.equal(changeCase.artifacts.requirements.requirements[0].statement, patch.statement);
  const replayedEdit = await request(app.base, `/api/sdlc/cases/${changeCase.id}/edit-requirements`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, expectedDraftRevision: 1, requirementId: editable.id, changes: patch, idempotencyKey: 'requirements-edit-1' }),
  });
  assert.equal(replayedEdit.command.replayed, true);
  assert.equal(replayedEdit.artifacts.requirements.draftRevision, 2);
  const beforeStaleEdit = structuredClone(changeCase);
  await request(app.base, `/api/sdlc/cases/${changeCase.id}/edit-requirements`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, expectedDraftRevision: 1, requirementId: editable.id, changes: { rationale: 'Stale edit.' }, idempotencyKey: 'requirements-edit-stale' }),
  }, 409);
  let unchanged = await request(app.base, `/api/sdlc/cases/${changeCase.id}`);
  assert.equal(unchanged.version, beforeStaleEdit.version);
  assert.deepEqual(unchanged.events, beforeStaleEdit.events);
  const denied = await request(app.base, `/api/sdlc/cases/${changeCase.id}/accept-requirements`, {
    method: 'POST', body: JSON.stringify({ version: unchanged.version, expectedDraftRevision: 2, actor: 'other-owner', idempotencyKey: 'requirements-accept-denied' }),
  }, 403);
  assert.match(denied.error, /Only the case owner/);
  unchanged = await request(app.base, `/api/sdlc/cases/${changeCase.id}`);
  assert.equal(unchanged.artifacts.requirements.acceptedBaseline, undefined);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/edit-requirements`, {
    method: 'POST', body: JSON.stringify({ version: unchanged.version, expectedDraftRevision: 2, requirementId: editable.id, changes: { statement: '' }, idempotencyKey: 'requirements-edit-invalid' }),
  });
  await request(app.base, `/api/sdlc/cases/${changeCase.id}/accept-requirements`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, expectedDraftRevision: 3, actor: changeCase.accountableOwner, idempotencyKey: 'requirements-accept-invalid' }),
  }, 409);
  unchanged = await request(app.base, `/api/sdlc/cases/${changeCase.id}`);
  assert.equal(unchanged.artifacts.requirements.acceptedBaseline, undefined);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/edit-requirements`, {
    method: 'POST', body: JSON.stringify({ version: unchanged.version, expectedDraftRevision: 3, requirementId: editable.id, changes: { statement: patch.statement }, idempotencyKey: 'requirements-edit-fix-invalid' }),
  });
  const accepted = await request(app.base, `/api/sdlc/cases/${changeCase.id}/accept-requirements`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, expectedDraftRevision: 4, actor: changeCase.accountableOwner, idempotencyKey: 'requirements-accept-1' }),
  });
  assert.equal(accepted.currentStage, 'S5');
  assert.equal(accepted.gateHistory.at(-1).gate, 'G4');
  const baseline = accepted.artifacts.requirements.acceptedBaseline;
  assert.equal(baseline.draftRevision, 4);
  assert.equal(baseline.intentHash.length, 64);
  assert.equal(baseline.sourceHash, accepted.sourceBinding.sourceHash);
  assert.equal(baseline.requirements[0].status, 'ACCEPTED');
  assert.equal(accepted.artifacts.requirements.requirements[0].status, 'ACCEPTED');
  assert.equal(accepted.contextManifestIntegrity.valid, true);
  assert.equal(accepted.artifacts.context.manifestVersion, 4);
  assert.equal(accepted.artifacts.context.manifestRevision, 2);
  assert.equal(accepted.artifacts.context.savedProjectCoverage.status, 'PARTIAL');
  assert.equal(accepted.artifacts.context.savedProjectCoverage.schemaVersion, 2);
  assert.equal(accepted.artifacts.context.savedProjectCoverage.sourcePinHash,
    digest(accepted.artifacts.context.savedProjectPin));
  assert.equal(accepted.artifacts.context.relevantRequirements.contentHash, baseline.contentHash);
  assert.deepEqual(accepted.artifacts.context.relevantRequirements.requirements, baseline.requirements);
  assert.ok(accepted.artifacts.context.evidenceRefs.includes(accepted.artifacts.context.relevantRequirements.evidenceRef));
  await request(app.base, `/api/sdlc/cases/${accepted.id}/edit-requirements`, {
    method: 'POST', body: JSON.stringify({ version: accepted.version, expectedDraftRevision: 4, requirementId: editable.id, changes: { statement: 'Late edit.' }, idempotencyKey: 'requirements-edit-after-accept' }),
  }, 409);
  const acceptedId = accepted.id;
  await close(app.server);
  app = await start(root);
  changeCase = await request(app.base, `/api/sdlc/cases/${acceptedId}`);
  assert.deepEqual(changeCase.artifacts.requirements.acceptedBaseline, baseline);
  assert.equal(changeCase.contextManifestIntegrity.valid, true);
  assert.equal(changeCase.artifacts.context.relevantRequirements.contentHash, baseline.contentHash);
  assert.equal(changeCase.events.some((event) => event.type === 'RequirementBaselineAccepted'), true);
  changeCase = await request(app.base, `/api/sdlc/cases/${acceptedId}/advance`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'requirements-valid-g5' }),
  });
  assert.equal(changeCase.currentStage, 'S5');
  assert.equal(changeCase.status, 'NEEDS_HUMAN');
  assert.equal(changeCase.gateHistory.at(-1).status, 'NEEDS_HUMAN');
  const architecture = changeCase.artifacts.architecture;
  assert.equal(architecture.options.length, 2);
  assert.ok(architecture.options.every((option) => option.id && option.migration.length >= 2 && option.healthCriteria.length));
  assert.equal(architecture.requirementsBaselineHash, baseline.contentHash);
  assert.equal(architecture.sourceHash, changeCase.sourceBinding.sourceHash);
  assert.equal(architecture.intentHash.length, 64);
  assert.equal(architecture.draftHash.length, 64);
  const selectedOption = architecture.options[0];
  const fitnessCases = [
    [{ dataOwnership: 'The portal performs a direct database write into Party MDM.' }, 'ARCHITECTURE_CROSS_SYSTEM_WRITE', { dataOwnership: 'Party MDM remains authoritative; the portal writes through its owned API.' }],
    [{ dataOwnership: 'The request path skips authorization and approval.' }, 'ARCHITECTURE_AUTHORITY_BYPASS', { dataOwnership: 'Party MDM remains authoritative; IAM and owner approval authorize writes through its API.' }],
    [{ migration: [{ step: 1, action: 'Drop and replace the existing schema immediately.', healthCheck: 'Deployment completes.' }, { step: 2, action: 'Add backward compatibility and reconciliation after replacement.', healthCheck: 'Consumers now coexist.' }, ...selectedOption.migration.slice(2)] }, 'ARCHITECTURE_MIGRATION_INCOMPATIBLE', { migration: selectedOption.migration }],
  ];
  for (const [unsafeChanges, findingCode, repairChanges] of fitnessCases) {
    changeCase = await request(app.base, `/api/sdlc/cases/${acceptedId}/edit-architecture`, {
      method: 'POST', body: JSON.stringify({ version: changeCase.version, expectedDraftRevision: changeCase.artifacts.architecture.draftRevision, optionId: selectedOption.id, changes: unsafeChanges, idempotencyKey: `architecture-${findingCode.toLowerCase()}-edit` }),
    });
    assert.ok(changeCase.artifacts.architecture.validationFindings.some((entry) => entry.code === findingCode), findingCode);
    await request(app.base, `/api/sdlc/cases/${acceptedId}/accept-architecture`, {
      method: 'POST', body: JSON.stringify({ version: changeCase.version, expectedDraftRevision: changeCase.artifacts.architecture.draftRevision, actor: changeCase.accountableOwner, idempotencyKey: `architecture-${findingCode.toLowerCase()}-denied` }),
    }, 409);
    changeCase = await request(app.base, `/api/sdlc/cases/${acceptedId}/edit-architecture`, {
      method: 'POST', body: JSON.stringify({ version: changeCase.version, expectedDraftRevision: changeCase.artifacts.architecture.draftRevision, optionId: selectedOption.id, changes: repairChanges, idempotencyKey: `architecture-${findingCode.toLowerCase()}-repair` }),
    });
    assert.equal(changeCase.artifacts.architecture.validationFindings.some((entry) => entry.code === findingCode), false);
  }
  const beforeOwnerDenial = structuredClone(changeCase);
  await request(app.base, `/api/sdlc/cases/${acceptedId}/accept-architecture`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, expectedDraftRevision: changeCase.artifacts.architecture.draftRevision, actor: 'not-the-owner', idempotencyKey: 'architecture-owner-denial' }),
  }, 403);
  let unchangedArchitecture = await request(app.base, `/api/sdlc/cases/${acceptedId}`);
  assert.equal(unchangedArchitecture.version, beforeOwnerDenial.version);
  assert.deepEqual(unchangedArchitecture.events, beforeOwnerDenial.events);
  const edit = { selectedOptionId: architecture.options[1].id, selectionRationale: 'The selected synchronous option fits the accepted latency requirement and has an explicit reconciliation path.' };
  changeCase = await request(app.base, `/api/sdlc/cases/${acceptedId}/edit-architecture`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, expectedDraftRevision: changeCase.artifacts.architecture.draftRevision, changes: edit, idempotencyKey: 'architecture-edit-1' }),
  });
  const selectedDraftRevision = changeCase.artifacts.architecture.draftRevision;
  const replayedArchitectureEdit = await request(app.base, `/api/sdlc/cases/${acceptedId}/edit-architecture`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, expectedDraftRevision: selectedDraftRevision - 1, changes: edit, idempotencyKey: 'architecture-edit-1' }),
  });
  assert.equal(replayedArchitectureEdit.command.replayed, true);
  assert.equal(replayedArchitectureEdit.artifacts.architecture.draftRevision, selectedDraftRevision);
  await request(app.base, `/api/sdlc/cases/${acceptedId}/edit-architecture`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, expectedDraftRevision: selectedDraftRevision - 1, changes: { selectionRationale: 'stale edit' }, idempotencyKey: 'architecture-edit-stale' }),
  }, 409);
  changeCase = await request(app.base, `/api/sdlc/cases/${acceptedId}`);
  const acceptedArchitecture = await request(app.base, `/api/sdlc/cases/${acceptedId}/accept-architecture`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, expectedDraftRevision: selectedDraftRevision, actor: changeCase.accountableOwner, idempotencyKey: 'architecture-accept-1' }),
  });
  assert.equal(acceptedArchitecture.currentStage, 'S6');
  assert.equal(acceptedArchitecture.gateHistory.at(-1).gate, 'G5');
  assert.equal(acceptedArchitecture.gateHistory.at(-1).status, 'PASSED');
  const architectureBaseline = acceptedArchitecture.artifacts.architecture.acceptedBaseline;
  assert.equal(architectureBaseline.selectedOptionId, architecture.options[1].id);
  assert.equal(architectureBaseline.requirementsBaselineHash, baseline.contentHash);
  assert.equal(architectureBaseline.sourceHash, acceptedArchitecture.sourceBinding.sourceHash);
  assert.equal(architectureBaseline.intentHash.length, 64);
  assert.deepEqual(acceptedArchitecture.artifacts.architecture.decisions[0].requirementsSatisfied, baseline.requirements.map((entry) => entry.id));
  const persistedArchitecture = await request(app.base, `/api/sdlc/cases/${acceptedId}`);
  assert.deepEqual(persistedArchitecture.artifacts.architecture.acceptedBaseline, architectureBaseline);
  assert.equal(persistedArchitecture.events.some((event) => event.type === 'ArchitectureBaselineAccepted'), true);
  const tampered = await app.sdlcStore.get(acceptedId);
  tampered.artifacts.architecture.acceptedBaseline.draftHash = '0'.repeat(64);
  await app.sdlcStore.save(tampered);
  const blockedArchitecture = await request(app.base, `/api/sdlc/cases/${acceptedId}/advance`, {
    method: 'POST', body: JSON.stringify({ version: tampered.version, idempotencyKey: 'architecture-tamper-g6' }),
  });
  assert.equal(blockedArchitecture.currentStage, 'S6');
  assert.equal(blockedArchitecture.status, 'BLOCKED');
  assert.ok(blockedArchitecture.gateHistory.at(-1).findings.some((entry) => entry.code === 'ACCEPTED_ARCHITECTURE_INVALID'));
});

test('owner can append a requirement from the saved process trace with exact replay and preserved history', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-add-process-requirement-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await start(root);
  t.after(async () => { if (app.server.listening) await close(app.server); });
  const project = createProject('Append process requirement');
  for (const answer of [
    'A membership that reduces restaurant equipment downtime.',
    'Independent restaurant owners need clear maintenance records.',
    'Monthly membership funds preventive service.',
    'Owners approve safety critical work.',
  ]) addConversationTurn(project, answer);
  project.version = 1;
  project.tenantId = 'tenant-reference-bank';
  await app.store.save(project);
  const blueprint = latestBlueprint(project);
  const process = Object.values(blueprint.areas).flatMap((area) => area.items).find((item) => item.type === 'process');
  assert.ok(process);
  let current = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({
    mode: 'golden', projectId: project.id, sourceObjectId: process.id, expectedProjectVersion: project.version,
    expectedBlueprintId: blueprint.id, expectedBlueprintVersion: blueprint.version,
  }) }, 201);
  current = await request(app.base, `/api/sdlc/cases/${current.id}/run`, { method: 'POST',
    body: JSON.stringify({ version: current.version, idempotencyKey: 'append-process-req-to-s4' }) });
  assert.equal(current.currentStage, 'S4');
  const before = structuredClone(current);
  const originalRequirement = structuredClone(before.artifacts.requirements.requirements[0]);
  const requestBody = { version: before.version, expectedDraftRevision: before.artifacts.requirements.draftRevision,
    statement: 'The owner records a distinct exception outcome for each process execution.',
    rationale: 'This separate concern follows from the exact saved process and preserves the original requirement.',
    acceptanceCriteria: ['Each exception is linked to the process trace.', 'The exception outcome remains reviewable.'],
    traceRefIds: [before.processRequirementTrace.process.id, before.processRequirementTrace.outcome.outputRefs[0].id],
    idempotencyKey: 'append-process-requirement-owner-command' };
  const invalid = await fetch(`${app.base}/api/sdlc/cases/${before.id}/add-requirement`, { method: 'POST',
    body: JSON.stringify({ ...requestBody, processTrace: { traceHash: 'caller-forgery' } }) });
  assert.equal(invalid.status, 400, 'clients cannot supply trace or source pin fields');
  const deniedState = await request(app.base, `/api/sdlc/cases/${before.id}`);
  assert.equal(deniedState.version, before.version);
  assert.deepEqual(deniedState.events, before.events);
  const invalidReference = await fetch(`${app.base}/api/sdlc/cases/${before.id}/add-requirement`, { method: 'POST',
    body: JSON.stringify({ ...requestBody, traceRefIds: ['caller-invented-reference'], idempotencyKey: 'append-process-requirement-invalid-ref' }) });
  assert.equal(invalidReference.status, 400, 'trace references must be selected from the saved case trace');
  const afterInvalidReference = await request(app.base, `/api/sdlc/cases/${before.id}`);
  assert.equal(afterInvalidReference.version, before.version);
  assert.deepEqual(afterInvalidReference.events, before.events);
  const duplicateStatement = await fetch(`${app.base}/api/sdlc/cases/${before.id}/add-requirement`, { method: 'POST',
    body: JSON.stringify({ ...requestBody,
      statement: originalRequirement.statement.toUpperCase().replace(/\s+/g, '   '),
      idempotencyKey: 'append-process-requirement-duplicate' }) });
  assert.equal(duplicateStatement.status, 409, 'a case- and whitespace-normalized duplicate statement is rejected before append');
  const afterDuplicateStatement = await request(app.base, `/api/sdlc/cases/${before.id}`);
  assert.equal(afterDuplicateStatement.version, before.version);
  assert.deepEqual(afterDuplicateStatement.events, before.events);

  const added = await request(app.base, `/api/sdlc/cases/${before.id}/add-requirement`, {
    method: 'POST', body: JSON.stringify(requestBody),
  });
  const requirement = added.artifacts.requirements.requirements.find((entry) => entry.id === added.events.at(-1).data.requirementId);
  assert.ok(requirement);
  assert.equal(added.version, before.version + 1);
  assert.equal(added.artifacts.requirements.draftRevision, before.artifacts.requirements.draftRevision + 1);
  assert.equal(requirement.status, 'DRAFT');
  assert.equal(requirement.criterionContract, undefined);
  assert.deepEqual(requirement.processTrace, before.processRequirementTrace);
  assert.deepEqual(requirement.verificationContract, originalRequirement.verificationContract);
  assert.deepEqual(requirement.sourceLinks, originalRequirement.sourceLinks);
  assert.deepEqual(requirement.derivedFrom, requestBody.traceRefIds);
  assert.deepEqual(requirement.affectedObjects, requestBody.traceRefIds);
  assert.deepEqual(added.artifacts.requirements.requirements[0], originalRequirement,
    'existing requirement content, criterion history and evidence remain byte-for-byte unchanged');
  assert.equal(added.events.at(-1).type, 'RequirementAddedFromSavedProcess');
  assert.equal(added.events.at(-1).data.processTraceHash, before.processRequirementTrace.traceHash);
  const replay = await request(app.base, `/api/sdlc/cases/${before.id}/add-requirement`, {
    method: 'POST', body: JSON.stringify(requestBody),
  });
  assert.equal(replay.command.replayed, true);
  assert.equal(replay.version, added.version);
  assert.equal(replay.artifacts.requirements.requirements.length, added.artifacts.requirements.requirements.length);
  assert.deepEqual(replay.events, added.events);

  const client = readFileSync(new URL('../../public/sdlc.js', import.meta.url), 'utf8');
  assert.match(client, /add-saved-process-requirement-form/);
  assert.match(client, /Add requirement from this saved process/);
  assert.match(client, /The server supplies the trace, source links, and verification contract/);
  assert.match(client, /saved-process-trace-reference-list/);
  assert.match(client, /Your entries and selected references remain in the form/);
});

test('process-bound requirement draft traces the exact selected process and stays explicitly unexecuted across restart', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-process-requirement-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let app = await start(root);
  t.after(async () => { if (app.server.listening) await close(app.server); });
  const project = createProject('Process requirement source');
  for (const answer of [
    'A membership that reduces restaurant equipment downtime.',
    'Independent restaurant owners need clear maintenance records.',
    'Monthly membership funds preventive service.',
    'Owners approve safety critical work.',
  ]) addConversationTurn(project, answer);
  project.version = 1;
  project.tenantId = 'tenant-reference-bank';
  await app.store.save(project);
  const blueprint = latestBlueprint(project);
  const processes = ['process-learn', 'process-deliver', 'process-review'].map((id) => Object.values(blueprint.areas).flatMap((area) => area.items).find((item) => item.id === id));
  const createFor = (sourceObjectId) => request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({
    mode: 'golden', projectId: project.id, sourceObjectId, expectedProjectVersion: project.version,
    expectedBlueprintId: blueprint.id, expectedBlueprintVersion: blueprint.version,
    processRequirementTrace: { traceHash: 'client-forgery' },
  }) }, 201);
  const first = await createFor(processes[0].id);
  const second = await createFor(processes[1].id);
  const review = await createFor(processes[2].id);
  const run = async (changeCase, idempotencyKey) => request(app.base, `/api/sdlc/cases/${changeCase.id}/run`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey }),
  });
  const firstAtG4 = await run(first, 'process-req-first');
  const secondAtG4 = await run(second, 'process-req-second');
  const reviewAtG4 = await run(review, 'process-req-review');
  for (const [changeCase, process] of [[firstAtG4, processes[0]], [secondAtG4, processes[1]], [reviewAtG4, processes[2]]]) {
    assert.equal(changeCase.currentStage, 'S4');
    const requirement = changeCase.artifacts.requirements.requirements[0];
    assert.equal(changeCase.artifacts.requirements.requirements.length, 1);
    assert.equal(requirement.status, 'DRAFT');
    assert.equal(requirement.processTrace.process.id, process.id);
    assert.equal(requirement.processTrace.source.processSnapshotHash, digest(process));
    assert.equal(requirement.processTrace.source.projectId, project.id);
    assert.equal(requirement.processTrace.source.projectVersion, project.version);
    assert.equal(requirement.processTrace.source.blueprintSnapshotHash, digest(blueprint));
    assert.equal(requirement.processTrace.source.bindingHash, changeCase.sourceBinding.bindingHash);
    assert.equal(requirement.processTrace.outcome.outputRefs[0].id, process.outputs[0]);
    assert.equal(requirement.processTrace.outcome.outputRefs[0].type,
      process.id === 'process-review' ? 'decision' : 'information');
    assert.equal(requirement.verificationContract.type, 'PROCESS_RUN_OUTPUTS');
    assert.equal(requirement.verificationContract.status, 'NOT_EXECUTED');
    assert.match(requirement.verificationContract.reason, /No authorized persisted-runtime adapter/);
    assert.equal(changeCase.artifacts.requirements.acceptedBaseline, undefined);
  }
  const reqA = firstAtG4.artifacts.requirements.requirements[0];
  const reqB = secondAtG4.artifacts.requirements.requirements[0];
  assert.notEqual(reqA.processTrace.traceHash, reqB.processTrace.traceHash);
  assert.notEqual(reqA.statement, reqB.statement);
  assert.equal(evaluateProcessVerificationContract(reqA.processTrace, reqA.verificationContract, { kind: 'SIMULATION_ONLY' }).status, 'NOT_EXECUTED');
  const evidenceCore = { kind: 'PROCESS_RUN', status: 'COMPLETED', source: {
    projectId: reqA.processTrace.source.projectId, projectVersion: reqA.processTrace.source.projectVersion,
    blueprintId: reqA.processTrace.source.blueprintId, blueprintVersion: reqA.processTrace.source.blueprintVersion,
    blueprintSnapshotHash: reqA.processTrace.source.blueprintSnapshotHash, processId: reqA.processTrace.source.processId,
    processSnapshotHash: reqA.processTrace.source.processSnapshotHash, bindingHash: reqA.processTrace.source.bindingHash,
    sourceTraceHash: reqA.processTrace.traceHash,
  }, steps: [], producedOutputIds: reqA.verificationContract.requiredOutputIds };
  const runEvidence = { ...evidenceCore, contentHash: digest(evidenceCore) };
  assert.equal(evaluateProcessVerificationContract(reqA.processTrace, reqA.verificationContract, runEvidence).status, 'NOT_EXECUTED');
  assert.equal(evaluateProcessVerificationContract(reqA.processTrace, { ...reqA.verificationContract, status: 'PASS' }, runEvidence).status, 'INVALID_CONTRACT');
  const otherSourceEvidenceCore = { ...evidenceCore, source: { ...evidenceCore.source, processId: reqB.processTrace.process.id } };
  const otherSourceEvidence = { ...otherSourceEvidenceCore, contentHash: digest(otherSourceEvidenceCore) };
  assert.equal(evaluateProcessVerificationContract(reqA.processTrace, reqA.verificationContract, otherSourceEvidence).status, 'NOT_EXECUTED');
  const missingOutput = { ...runEvidence, producedOutputIds: [], contentHash: undefined };
  delete missingOutput.contentHash;
  missingOutput.contentHash = digest(Object.fromEntries(Object.entries(missingOutput).filter(([key]) => key !== 'contentHash')));
  assert.equal(evaluateProcessVerificationContract(reqA.processTrace, reqA.verificationContract, missingOutput).status, 'NOT_EXECUTED');
  const denied = await request(app.base, `/api/sdlc/cases/${firstAtG4.id}/accept-requirements`, {
    method: 'POST', body: JSON.stringify({ version: firstAtG4.version, expectedDraftRevision: 1, actor: 'not-the-owner', idempotencyKey: 'process-requirement-denied' }),
  }, 403);
  assert.match(denied.error, /Only the case owner/);
  const wrongSource = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({
    mode: 'golden', projectId: project.id, sourceObjectId: 'process-not-in-blueprint', expectedProjectVersion: project.version,
    expectedBlueprintId: blueprint.id, expectedBlueprintVersion: blueprint.version,
  }) }, 404);
  assert.match(wrongSource.error, /not present in the current saved blueprint/i);
  const staleSource = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({
    mode: 'golden', projectId: project.id, sourceObjectId: processes[0].id, expectedProjectVersion: project.version + 1,
    expectedBlueprintId: blueprint.id, expectedBlueprintVersion: blueprint.version,
  }) }, 409);
  assert.match(staleSource.error, /saved project changed/i);
  const id = firstAtG4.id;
  const expectedTrace = reqA.processTrace;
  await close(app.server);
  app = await start(root);
  const reloaded = await request(app.base, `/api/sdlc/cases/${id}`);
  assert.deepEqual(reloaded.artifacts.requirements.requirements[0].processTrace, expectedTrace);
  assert.equal(reloaded.artifacts.requirements.requirements[0].verificationContract.status, 'NOT_EXECUTED');
});

test('SDLC API enforces optimistic concurrency, authority, isolation, and immutable action replay', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-api-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await start(root); t.after(() => close(app.server));
  const tenantA = { 'x-orgward-tenant': 'tenant-a' }; const tenantB = { 'x-orgward-tenant': 'tenant-b' };
  let first = await request(app.base, '/api/sdlc/cases', { method: 'POST', headers: tenantA, body: JSON.stringify({ mode: 'golden', tenantId: 'attempted-body-override' }) }, 201);
  const second = await request(app.base, '/api/sdlc/cases', { method: 'POST', headers: tenantB, body: JSON.stringify({ mode: 'golden' }) }, 201);
  assert.notEqual(first.id, second.id);
  assert.equal(first.tenantId, 'tenant-a');
  first = await request(app.base, `/api/sdlc/cases/${first.id}/advance`, { method: 'POST', headers: tenantA, body: JSON.stringify({ version: first.version, idempotencyKey: 'advance-once' }) });
  await request(app.base, `/api/sdlc/cases/${first.id}/advance`, { method: 'POST', headers: tenantA, body: JSON.stringify({ version: 0, idempotencyKey: 'stale' }) }, 409);
  const replay = await request(app.base, `/api/sdlc/cases/${first.id}/advance`, { method: 'POST', headers: tenantA, body: JSON.stringify({ version: first.version, idempotencyKey: 'advance-once' }) });
  assert.equal(replay.command.replayed, true);
  assert.equal(replay.version, first.version);
  await request(app.base, `/api/sdlc/cases/${first.id}/advance`, { method: 'POST', headers: tenantA, body: JSON.stringify({ version: first.version, idempotencyKey: 'advance-once', actor: 'different-actor' }) }, 409);
  const listingA = await request(app.base, '/api/sdlc/cases', { headers: tenantA });
  const listingB = await request(app.base, '/api/sdlc/cases', { headers: tenantB });
  assert.deepEqual(listingA.cases.map((entry) => entry.tenantId), ['tenant-a']);
  assert.deepEqual(listingB.cases.map((entry) => entry.tenantId), ['tenant-b']);
  await request(app.base, `/api/sdlc/cases/${second.id}`, { headers: tenantA }, 404);
  assert.equal((await request(app.base, `/api/sdlc/cases/${second.id}`, { headers: tenantB })).tenantId, 'tenant-b');
});

test('process-run evidence links require verified human identity and never accept caller provenance', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-run-link-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await start(root); t.after(() => close(app.server));
  const created = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ mode: 'golden' }) }, 201);
  await request(app.base, `/api/sdlc/cases/${created.id}/process-run-evidence`, { method: 'POST', body: JSON.stringify({
    version: created.version, draftRevision: 1, requirementId: 'REQ-PROC-000000000000',
    runId: `execution-run-${'1'.repeat(8)}-${'1'.repeat(4)}-${'1'.repeat(4)}-${'1'.repeat(4)}-${'1'.repeat(12)}`,
    idempotencyKey: 'unauthenticated-run-link', status: 'SUCCEEDED', outputHash: 'forged',
  }) }, 401);
  await request(app.base, `/api/sdlc/cases/${created.id}/process-run-evidence-reviews`, { method: 'POST', body: JSON.stringify({}) }, 401);
  const unchanged = await request(app.base, `/api/sdlc/cases/${created.id}`);
  assert.equal(unchanged.version, created.version);
  assert.equal(unchanged.events.length, created.events.length);
});

test('process-run evidence presentation shows exact runtime identity, hashes, and stale applicability', () => {
  const presentation = processRunEvidencePresentation({
    run: { id: 'execution-run-00000000-0000-4000-8000-000000000001', status: 'SUCCEEDED', aggregateHash: 'a'.repeat(64) },
    plan: { id: 'process-plan-00000000-0000-4000-8000-000000000002', revision: 3, taskId: 'task-process-learn', taskHash: 'b'.repeat(64) },
    instance: { id: '00000000-0000-4000-8000-000000000003' },
    verificationStatus: 'NOT_EXECUTED', applicability: 'STALE',
  });
  assert.match(presentation.heading, /SUCCEEDED · verification NOT_EXECUTED/);
  assert.match(presentation.identity, /task-process-learn.*process-plan-.*r3.*instance 00000000/);
  assert.match(presentation.hashes, new RegExp(`Run aggregate SHA-256 ${'a'.repeat(64)} · plan SHA-256`));
  assert.match(presentation.hashes, new RegExp(`task SHA-256 ${'b'.repeat(64)}`));
  assert.match(presentation.applicability, /^STALE · REGENERATION_REQUIRED: this immutable evidence remains pinned to its original requirement and criterion revision\.$/);
});

test('human output evidence presentation separates reported values from execution verification', () => {
  const presentation = processRunEvidencePresentation({
    runtimeSource: { kind: 'human-task-completion', completionEventHash: 'c'.repeat(64) },
    plan: { id: 'plan-human', revision: 2, taskId: 'task-human', snapshotHash: 'a'.repeat(64), taskHash: 'b'.repeat(64) },
    instance: { id: '00000000-0000-4000-8000-000000000003', status: 'SUCCEEDED' },
    verificationStatus: 'NOT_EXECUTED', applicability: 'CURRENT',
    outputEvidence: [{ id: 'information-prioritised-need', status: 'HUMAN_REPORTED', value: 'Reported callback value', recordHash: 'd'.repeat(64), reporterPrincipal: 'oidc:reporter' }],
  });
  assert.match(presentation.heading, /Human task completion · runtime SUCCEEDED · verification NOT_EXECUTED/);
  assert.match(presentation.hashes, new RegExp(`Completion event SHA-256 ${'c'.repeat(64)}`));
  assert.match(presentation.outputs[0], /HUMAN_REPORTED · self-reported value "Reported callback value".*record SHA-256.*reported by oidc:reporter/);
  const unavailable = processRunEvidencePresentation({
    runtimeSource: { kind: 'human-task-completion', completionEventHash: 'c'.repeat(64) },
    plan: { id: 'plan-human', revision: 2, taskId: 'task-human', snapshotHash: 'a'.repeat(64), taskHash: 'b'.repeat(64) },
    instance: { id: '00000000-0000-4000-8000-000000000003', status: 'SUCCEEDED' },
    verificationStatus: 'NOT_EXECUTED', applicability: 'CURRENT',
    outputEvidence: [{ id: 'information-prioritised-need', status: 'UNAVAILABLE' }],
  });
  assert.equal(unavailable.outputs[0], 'information-prioritised-need: UNAVAILABLE');
});

test('repository check receipts remain a separate evidence category', () => {
  const presentation = processRunEvidencePresentation({
    run: { id: 'execution-run-00000000-0000-4000-8000-000000000001', status: 'SUCCEEDED', aggregateHash: 'a'.repeat(64) },
    plan: { id: 'plan-repository', revision: 3, taskId: 'task-process-learn', snapshotHash: 'b'.repeat(64), taskHash: 'c'.repeat(64) },
    instance: { id: '00000000-0000-4000-8000-000000000003', status: 'SUCCEEDED' },
    verificationStatus: 'NOT_EXECUTED', applicability: 'CURRENT', repositoryCheckEvidenceStatus: 'AVAILABLE',
    repositoryCheckEvidence: [{ id: 'unit-check', version: '1', status: 'PASSED', repositoryId: 'github-123',
      sourceSnapshotId: 'snapshot-abc', commandHash: 'd'.repeat(64),
      planHash: 'e'.repeat(64), sourceTreeDigest: 'f'.repeat(64), candidateTreeDigest: '1'.repeat(64),
      candidateEvidenceHash: '2'.repeat(64), outputHash: '3'.repeat(64) }],
  });
  assert.match(presentation.repositoryChecks[0], /^unit-check v1: PASSED · repository github-123 · source snapshot snapshot-abc · command SHA-256/);
  assert.match(presentation.repositoryChecks[0], /candidate evidence SHA-256/);
  assert.equal(presentation.repositoryCheckStatus, 'AVAILABLE');
  const pending = processRunEvidencePresentation({
    run: { id: 'execution-run-00000000-0000-4000-8000-000000000001', status: 'AWAITING_APPROVAL', aggregateHash: 'a'.repeat(64) },
    plan: { id: 'plan-repository', revision: 3, taskId: 'task-process-learn', snapshotHash: 'b'.repeat(64), taskHash: 'c'.repeat(64) },
    instance: { id: '00000000-0000-4000-8000-000000000003', status: 'AWAITING_APPROVAL' },
    verificationStatus: 'NOT_EXECUTED', applicability: 'CURRENT', repositoryCheckEvidenceStatus: 'PENDING',
  });
  assert.equal(pending.repositoryCheckStatus, 'PENDING');
});

test('repository-check observation presentation keeps code scope and proposal authority explicit', () => {
  const view = repositoryCheckObservationPresentation({ id: 'repository-check-observation-1', category: 'REPOSITORY_CHECK',
    runId: 'execution-run-1', planId: 'plan-1', planRevision: 4, taskId: 'task-1',
    runOutcome: 'SUCCEEDED', verifierResult: { id: 'verifier-1', version: '3', status: 'PASSED', outputHash: 'e'.repeat(64) },
    candidateEvidenceHash: 'a'.repeat(64), contentHash: 'b'.repeat(64), causality: 'HYPOTHESIS',
    businessTruthStatus: 'UNVERIFIED', verificationStatus: 'NOT_EXECUTED',
    checks: [{ id: 'unit-check', version: '1', status: 'FAILED', commandHash: 'c'.repeat(64), outputHash: 'd'.repeat(64) }] },
  { title: 'Review failed check', status: 'PROPOSED_NOT_APPLIED', proposedClaim: 'Review pinned candidate code.', authorityRequired: true });
  assert.match(view.heading, /Repository-check observation/);
  assert.match(view.pins, /execution-run-1.*plan-1 r4.*task-1.*candidate evidence SHA-256/);
  assert.match(view.outcome, /Execution run SUCCEEDED.*verifier verifier-1 v3: PASSED.*output SHA-256/);
  assert.match(view.checks[0], /unit-check v1: FAILED.*command SHA-256.*output SHA-256/);
  assert.match(view.status, /causality HYPOTHESIS.*business truth UNVERIFIED.*verification NOT_EXECUTED/);
  assert.match(view.proposal, /PROPOSED_NOT_APPLIED.*authority required.*Review pinned candidate code/);
  assert.equal(repositoryCheckObservationPresentation({ ...{ id: 'bad', category: 'HUMAN_REPORTED', contentHash: 'x' } }), null);
});

test('behavior evaluation presentation keeps checked scope separate from unknown risk and business truth', () => {
  const presentation = processRunEvidencePresentation({
    run: { id: 'execution-run-1', status: 'SUCCEEDED', aggregateHash: 'a'.repeat(64) },
    plan: { id: 'process-plan-1', revision: 3, taskId: 'task-check', taskHash: 'b'.repeat(64) },
    instance: { id: 'instance-1', status: 'SUCCEEDED' }, verificationStatus: 'NOT_EXECUTED',
    applicability: 'CURRENT', behaviorEvaluation: { status: 'CHECKED_BEHAVIOR', result: 'UNKNOWN',
      riskCoverage: 'UNKNOWN', businessTruthStatus: 'UNVERIFIED', assertions: [{ testName: 'named criterion check',
        status: 'TEST_PASS', outputHash: 'c'.repeat(64) }], scenarioMappings: [{ type: 'POSITIVE',
        status: 'VERIFIED_TO_PASSING_ASSERTION', scope: 'ASSERTION_LINKAGE_ONLY', caseStatus: 'NOT_EXECUTED' }] },
  });
  assert.match(presentation.behaviorEvaluation.status, /CHECKED_BEHAVIOR.*result UNKNOWN.*risk coverage UNKNOWN.*business truth UNVERIFIED.*verification remains NOT_EXECUTED/);
  assert.match(presentation.behaviorEvaluation.assertions[0], /named criterion check: TEST_PASS.*output SHA-256/);
  assert.match(presentation.behaviorEvaluation.scenarioMappings[0], /POSITIVE: mapping VERIFIED_TO_PASSING_ASSERTION.*ASSERTION_LINKAGE_ONLY.*case remains NOT_EXECUTED/);
});

test('authenticated SDLC routes fail closed when principal-scoped store methods are unavailable', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-scope-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let unscopedCalls = 0;
  const changeCaseStore = {
    async init() {},
    async list() { unscopedCalls += 1; return []; },
    async listWithDiagnostics() { unscopedCalls += 1; return { records: [], corruptRecords: 0 }; },
    async get() { unscopedCalls += 1; return null; },
    async getForPrincipal() { unscopedCalls += 1; return null; },
    async save() { unscopedCalls += 1; },
  };
  const identity = { tenantId: 'tenant-a', principal: 'principal-a', roles: ['workspace-write'], actorType: 'human' };
  const app = createApp({
    dataDirectory: path.join(root, 'blueprints'), sdlcDirectory: path.join(root, 'sdlc'),
    changeCaseStore,
    oidcAuthenticator: { async authenticate() { return identity; } },
    oidcSessionStore: {
      async get() { return null; },
      async resolve() { return { ...identity, authzGeneration: 1 }; },
    },
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => close(app.server));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const headers = { authorization: 'Bearer signed-by-test', 'content-type': 'application/json' };
  const id = 'change-case-00000000-0000-4000-8000-000000000000';
  const assertDenied = async (route, options = {}) => {
    const response = await fetch(`${base}${route}`, { ...options, headers: { ...headers, ...(options.headers ?? {}) } });
    const body = await response.json();
    assert.equal(response.status, 503, JSON.stringify(body));
    assert.match(body.error, /cannot enforce principal-scoped access/i);
  };

  await assertDenied('/api/sdlc/cases');
  await assertDenied(`/api/sdlc/cases/${id}`);
  await assertDenied(`/api/sdlc/cases/${id}/traceability`);
  await assertDenied('/api/sdlc/cases', {
    method: 'POST', body: JSON.stringify({ projectId: 'project-00000000-0000-4000-8000-000000000000', mode: 'golden' }),
  });
  await assertDenied(`/api/sdlc/cases/${id}/advance`, {
    method: 'POST', body: JSON.stringify({ version: 0 }),
  });
  const foundationResponse = await fetch(`${base}/api/v1/foundation`, { headers });
  const foundation = await foundationResponse.json();
  assert.equal(foundationResponse.status, 200);
  assert.equal(foundation.data.sources.changeCases.status, 'unavailable');
  assert.equal(unscopedCalls, 0);
});

test('served SDLC product surface and meta contract expose stages and mutation lab', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-api-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await start(root); t.after(() => close(app.server));
  const meta = await request(app.base, '/api/sdlc/meta');
  assert.equal(meta.stages.length, 12);
  assert.equal(meta.mutations.missing_aml.expectedGate, 'G1');
  const response = await fetch(`${app.base}/sdlc.html`);
  assert.equal(response.status, 200);
  const markup = await response.text();
  assert.match(markup, /Synthetic SDLC reference/i);
  assert.match(markup, /Saved design object/);
  assert.match(markup, /Synthetic reference condition/);
  const [styles, script] = await Promise.all([
    fetch(`${app.base}/sdlc.css`).then((entry) => entry.text()),
    fetch(`${app.base}/sdlc.js`).then((entry) => entry.text()),
  ]);
  assert.match(styles, /min-height:\s*44px/);
  assert.match(styles, /scroll-snap-type:\s*x proximity/);
  assert.match(script, /crypto\?\.randomUUID\?\.\(\)/);
  assert.match(script, /expectedProjectVersion/);
  assert.match(script, /if \(detail\.data\?\.id === changeCase\.projectId\) activeSourceProject = detail\.data/);
  assert.match(script, /if \(selectionId !== caseSelectionId\) return;[\s\S]*?state\.activeSourceProject = activeSourceProject/);
  assert.match(script, /api\(`\/api\/v1\/projects\/\$\{encodeURIComponent\(changeCase\.projectId\)\}`\)/);
  assert.match(script, /caseUiModel\(changeCase, state\.meta, state\.activeSourceProject\)/);
  assert.match(script, /Pinned saved-design evidence/);
  assert.match(script, /Saved-project manifest pin/);
  assert.match(script, /savedProjectPinSummary\(context\)/);
  assert.match(script, /contextManifestPresentation\(context\)/);
  assert.match(script, /Synthetic reference context coverage/);
  assert.match(script, /Saved-project source coverage · PARTIAL/);
  assert.match(script, /process trace SHA-256/);
  assert.match(script, /Saved-project dependencies not retrieved/);
  assert.match(script, /projectCoverage\.unknownDependencies\.map/);
  assert.match(script, /Synthetic-context unknown dependencies/);
  assert.match(script, /Synthetic-context excluded dependencies/);
  assert.match(script, /Enterprise context source/);
  assert.match(script, /Intent guardrails/);
  assert.match(script, /Accepted requirements in context/);
  assert.match(script, /attrs: \{ role: 'status' \}/);
  assert.match(script, /requirement-edit-disclosure/);
  assert.match(script, /Pinned process requirement trace · DRAFT · NOT EXECUTED/);
  assert.match(script, /Independent evidence reviews/);
  assert.match(script, /Record independent review/);
  assert.match(script, /processEvidenceReviewPresentation\(review\)/);
  assert.match(script, /This does not verify truth or execute behavior; status remains NOT EXECUTED/);
  assert.match(script, /section\('Proposed design corrections', learningProposals\.map/,
    'runtime observations are surfaced in the SDLC case UI as proposed corrections');
  assert.match(script, /proposal\.status\.replaceAll\('_', ' '\)/,
    'the rendered proposal exposes the explicit unapplied status');
  assert.match(script, /This proposal does not change the saved design or authorize another release\./,
    'the UI states that the observation grants no design or release authority');
  assert.match(script, /\$\{contract\.type\}/);
  assert.match(script, /Simulation results and caller-supplied records do not count as verified execution/);
  assert.match(script, /text: `Edit \$\{requirement\.id\}`/);
  assert.match(script, /aria-label': `\$\{requirement\.id\} actor`/);
  assert.match(script, /Comparable target architecture alternatives/);
  assert.match(script, /Accept architecture and pass G5/);
  assert.match(script, /Rollback \/ forward recovery/);
  assert.match(script, /Compile software delivery draft/);
  assert.match(script, /text: task\.g6WorkItemId/);
  assert.match(script, /Engine task ID \$\{task\.id\}/);
  assert.match(script, /taskById\.get\(dependencyId\)\?\.g6WorkItemId/);
  assert.match(script, /PROPOSED DRAFT · No owner-reviewed assignment snapshot yet/);
  assert.match(script, /SOURCE STALE · This saved draft remains available as history/,
    'stale software delivery drafts remain visible with their immutable source pins');
  assert.match(script, /sourceIsCurrent && review && humanAssignments/,
    'stale source status hides promotion controls');
  assert.match(script, /\.\.\.\(sourceIsCurrent \? \[\(\(\) => \{/,
    'stale source status hides assignment editing while keeping the saved draft visible');
  assert.match(script, /OWNER REVIEWED · Revision/);
  assert.match(script, /Save owner review snapshot/);
  assert.match(script, /assignment-review/);
  assert.match(script, /eligibleActorBindings\(bindings, changeCase\.sourceBinding\.blueprintVersion\)/,
    'the client parses enabled, eligible bindings from the API response envelope');
  assert.match(script, /state\.actorBindings\.some\(\(binding\) => binding\.targetType === 'human'\)/,
    'assignment guidance appears when eligible bindings do not include a human');
  assert.match(script, /No eligible human actor binding is enabled for this blueprint[\s\S]*?sign in if needed[\s\S]*?verified identity to this project’s membership[\s\S]*?In the map, choose the correct human actor and role[\s\S]*?propose and enable its binding[\s\S]*?changes the project revision[\s\S]*?create a new governed change case from the updated design before compiling/,
    'owner copy explains enrollment, map binding selection, and the new-case requirement after the source revision changes');
  assert.match(script, /encodeStudioRoute\(\{ projectId: changeCase\.projectId, view: 'map' \}\)/,
    'the contextual project map link selects no actor and only navigates to the existing map route');
  assert.match(script, /Open this project’s Enterprise design map/,
    'the owner is told to choose the correct actor and role in the linked project map');
  assert.match(script, /href: '\/platform\.html#administration'/,
    'the enrollment guidance links to the existing Administration view');
  assert.match(script, /Save revised owner review snapshot/);
  assert.match(script, /expectedReviewRevision/);
  assert.match(script, /not executable/);
  assert.match(script, /pendingSoftwareStartKey/);
  assert.match(script, /software-runtime-start\.mjs/);
  assert.match(script, /Promote human checkpoint plan/);
  assert.match(script, /Start human checkpoint instance/);
  assert.match(script, /Immutable human checkpoint revision/);
  assert.match(script, /Agent tasks need the separate PR-08 software output contract/);
  assert.match(script, /\/compile-software-plan/);
  assert.match(styles, /requirement-edit-disclosure > summary:focus-visible/);
  assert.match(styles, /architecture-option > summary:focus-visible/);
  const startHelper = await fetch(`${app.base}/software-runtime-start.mjs`);
  assert.equal(startHelper.status, 200);
  assert.match(await startHelper.text(), /createSoftwareStartFlightGuard/);
});

test('clarification survives restart and reconciles through the API', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-clarification-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let app = await start(root);
  let changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ mode: 'golden' }) }, 201);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/clarify`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'open-api-question', actor: 'studio-operator', question: 'Is payment part of this release?', targetField: 'nonGoals' }),
  });
  await request(app.base, `/api/sdlc/cases/${changeCase.id}/clarify`, {
    method: 'POST', body: JSON.stringify({ version: 0, idempotencyKey: 'open-api-question', actor: 'studio-operator', question: 'Is payment part of this release?', targetField: 'nonGoals' }),
  });
  await request(app.base, `/api/sdlc/cases/${changeCase.id}/clarify`, {
    method: 'POST', body: JSON.stringify({ version: 0, idempotencyKey: 'open-api-question', actor: 'studio-operator', question: 'Different question', targetField: 'nonGoals' }),
  }, 409);
  const questionRef = changeCase.clarifications[0].id;
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/answer-clarification`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'answer-api-question', actor: 'actor-accountable-owner', questionRef, answer: 'Payment is outside this release.' }),
  });
  const { id, version } = changeCase;
  await close(app.server);

  app = await start(root); t.after(() => close(app.server));
  changeCase = await request(app.base, `/api/sdlc/cases/${id}`);
  assert.equal(changeCase.version, version);
  assert.equal(changeCase.clarifications[0].status, 'ANSWERED');
  assert.deepEqual(changeCase.intent.nonGoals, []);
  changeCase = await request(app.base, `/api/sdlc/cases/${id}/reconcile-clarification`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'reconcile-api-question', actor: 'actor-accountable-owner', questionRef }),
  });
  assert.equal(changeCase.clarifications[0].status, 'RECONCILED');
  assert.deepEqual(changeCase.intent.nonGoals, ['Payment is outside this release.']);
  assert.equal(changeCase.intent.revision, 2);
});

test('simultaneous clarification writes use persisted compare-and-swap', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-race-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await start(root); t.after(() => close(app.server));
  const changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ mode: 'golden' }) }, 201);
  const submit = (key, question) => fetch(`${app.base}/api/sdlc/cases/${changeCase.id}/clarify`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: changeCase.version, idempotencyKey: key, actor: 'studio-operator', question, targetField: 'nonGoals' }),
  });
  const responses = await Promise.all([submit('race-a', 'Is payment included?'), submit('race-b', 'Is invoicing included?')]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const saved = await request(app.base, `/api/sdlc/cases/${changeCase.id}`);
  assert.equal(saved.version, 1);
  assert.equal(saved.clarifications.length, 1);
});

test('proof results persist across restart and acceptance is derived by the API', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-proofs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let app = await start(root);
  let changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ mode: 'golden' }) }, 201);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/register-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'api-register-proof', actor: 'designer', criterion: 'The intent can be reconstructed after restart.', evaluatorType: 'DETERMINISTIC', required: true }),
  });
  const proofRef = changeCase.proofs.obligations[0].id;
  await request(app.base, `/api/sdlc/cases/${changeCase.id}/record-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'api-invalid-proof', actor: 'test-runner', proofRef, status: 'GREEN', summary: 'Invalid client status.' }),
  }, 400);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/record-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'api-record-proof', actor: 'test-runner', proofRef, status: 'PASS', summary: 'Reloaded state matches the saved revision.', observations: ['Intent revision and content hash matched after restart.'] }),
  });
  const { id } = changeCase;
  await close(app.server);

  app = await start(root); t.after(() => close(app.server));
  changeCase = await request(app.base, `/api/sdlc/cases/${id}`);
  assert.equal(changeCase.proofs.results[0].status, 'PASS');
  changeCase = await request(app.base, `/api/sdlc/cases/${id}/assess-proofs`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'api-assess-proofs', actor: 'controller', accepted: false }),
  });
  assert.equal(changeCase.proofs.assessments.at(-1).phase, 'ACCEPTED');
  assert.equal(changeCase.proofs.assessments.at(-1).accepted, true);
});

test('proof action routing persists across restart and preserves the failed result', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-routing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let app = await start(root);
  let changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ mode: 'golden' }) }, 201);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/register-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'route-api-proof', actor: 'designer', criterion: 'The bounded workflow succeeds.', required: true }),
  });
  const proofRef = changeCase.proofs.obligations[0].id;
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/record-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'route-api-fail', actor: 'runner', proofRef, status: 'FAIL', summary: 'The implementation is incomplete.', observations: ['The expected response was absent.'] }),
  });
  const failedResult = structuredClone(changeCase.proofs.results[0]);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/route-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'route-api-replan', actor: 'studio-operator', proofRef, resultRef: failedResult.id, action: 'REPLAN', reason: 'Add the missing work to the plan.' }),
  });
  assert.deepEqual(changeCase.proofs.results, [failedResult]);
  assert.equal(changeCase.proofs.actions[0].action, 'REPLAN');
  const { id, version } = changeCase;
  await close(app.server);

  app = await start(root); t.after(() => close(app.server));
  changeCase = await request(app.base, `/api/sdlc/cases/${id}`);
  assert.equal(changeCase.version, version);
  assert.deepEqual(changeCase.proofs.results, [failedResult]);
  assert.equal(changeCase.proofs.actions[0].status, 'READY');
});

test('a terminal proof stop blocks later API mutations while replay remains safe', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-stop-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await start(root); t.after(() => close(app.server));
  let changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ mode: 'golden' }) }, 201);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/register-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'stop-api-proof', actor: 'designer', criterion: 'The outcome is feasible.', required: true }),
  });
  const proofRef = changeCase.proofs.obligations[0].id;
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/record-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'stop-api-result', actor: 'runner', proofRef, status: 'INDETERMINATE', summary: 'Feasibility cannot be established.', observations: ['The required dependency is unavailable.'] }),
  });
  const stopCommand = { version: changeCase.version, idempotencyKey: 'stop-api-route', actor: changeCase.accountableOwner, proofRef, resultRef: changeCase.proofs.results[0].id, action: 'STOP', reason: 'The owner stopped infeasible work.' };
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/route-proof`, { method: 'POST', body: JSON.stringify(stopCommand) });
  assert.equal(changeCase.status, 'STOPPED');
  const replay = await request(app.base, `/api/sdlc/cases/${changeCase.id}/route-proof`, { method: 'POST', body: JSON.stringify(stopCommand) });
  assert.equal(replay.command.replayed, true);
  await request(app.base, `/api/sdlc/cases/${changeCase.id}/advance`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'advance-after-stop', actor: 'orchestrator' }),
  }, 409);
  await request(app.base, `/api/sdlc/cases/${changeCase.id}/clarify`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'clarify-after-stop', actor: 'studio-operator', question: 'Can scope change?', targetField: 'nonGoals' }),
  }, 409);
  const saved = await request(app.base, `/api/sdlc/cases/${changeCase.id}`);
  assert.equal(saved.version, changeCase.version);
  assert.equal(saved.events.at(-1).type, 'ProofActionRouted');
});

test('a pending proof action resumes once after restart without chat history', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-resume-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let app = await start(root);
  let changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ mode: 'golden' }) }, 201);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/register-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'resume-api-proof', actor: 'designer', criterion: 'The queued repair resumes once.', required: true }),
  });
  const proofRef = changeCase.proofs.obligations[0].id;
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/record-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'resume-api-result', actor: 'runner', proofRef, status: 'FAIL', summary: 'Repair is required.', observations: ['The expected result is absent.'] }),
  });
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/route-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'resume-api-route', actor: 'studio-operator', proofRef, resultRef: changeCase.proofs.results[0].id, action: 'REPAIR', reason: 'Queue a bounded repair.' }),
  });
  const action = changeCase.proofs.actions[0];
  const id = changeCase.id;
  assert.equal(action.status, 'READY');
  await close(app.server);

  app = await start(root);
  changeCase = await request(app.base, `/api/sdlc/cases/${id}`);
  assert.equal(changeCase.proofs.actions[0].status, 'READY');
  assert.equal(changeCase.workspace.nextAllowedAction.type, 'RESUME_PROOF_ACTION');
  assert.equal(changeCase.workspace.failedResults[0].id, changeCase.proofs.results[0].id);
  changeCase = await request(app.base, `/api/sdlc/cases/${id}/resume-proof-action`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'resume-after-restart', actor: action.owner, actionRef: action.id }),
  });
  assert.equal(changeCase.proofs.actions[0].status, 'IN_PROGRESS');
  assert.equal(changeCase.proofs.loopCounters[proofRef], 1);
  assert.equal(changeCase.workspace.nextAllowedAction.type, 'COMPLETE_PROOF_ACTION');
  const resumedVersion = changeCase.version;
  await close(app.server);

  app = await start(root); t.after(() => close(app.server));
  changeCase = await request(app.base, `/api/sdlc/cases/${id}`);
  const replay = await request(app.base, `/api/sdlc/cases/${id}/resume-proof-action`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'different-key-after-second-restart', actor: action.owner, actionRef: action.id }),
  });
  assert.equal(replay.command.replayed, true);
  assert.equal(replay.version, resumedVersion);
  assert.equal(replay.proofs.loopCounters[proofRef], 1);
  assert.equal(replay.events.filter((entry) => entry.type === 'ProofActionResumed').length, 1);
});

test('simultaneous pending-action claims persist exactly one attempt', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-resume-race-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await start(root); t.after(() => close(app.server));
  let changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ mode: 'golden' }) }, 201);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/register-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'race-resume-proof', actor: 'designer', criterion: 'Only one worker claims the repair.', required: true }),
  });
  const proofRef = changeCase.proofs.obligations[0].id;
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/record-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'race-resume-result', actor: 'runner', proofRef, status: 'FAIL', summary: 'A repair is pending.', observations: ['The result failed.'] }),
  });
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/route-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'race-resume-route', actor: 'studio-operator', proofRef, resultRef: changeCase.proofs.results[0].id, action: 'REPAIR', reason: 'Queue one repair.' }),
  });
  const action = changeCase.proofs.actions[0];
  const claim = (key) => fetch(`${app.base}/api/sdlc/cases/${changeCase.id}/resume-proof-action`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: changeCase.version, idempotencyKey: key, actor: action.owner, actionRef: action.id }),
  });
  const responses = await Promise.all([claim('race-resume-a'), claim('race-resume-b')]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const saved = await request(app.base, `/api/sdlc/cases/${changeCase.id}`);
  assert.equal(saved.proofs.actions[0].status, 'IN_PROGRESS');
  assert.equal(saved.proofs.loopCounters[proofRef], 1);
  assert.equal(saved.events.filter((entry) => entry.type === 'ProofActionResumed').length, 1);
});
