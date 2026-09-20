import assert from 'node:assert/strict';
import test from 'node:test';
import { MUTATIONS, STAGES, digest } from '../../src/sdlc/contracts.mjs';
import { advanceCase, approveRelease, createChangeCase, recordObservation, runToCheckpoint, traceability, verifyEvidenceLedger } from '../../src/sdlc/engine.mjs';

test('golden case runs to protected approval, resumes, observes, and learns', () => {
  const changeCase = createChangeCase({ mode: 'golden' });
  const first = runToCheckpoint(changeCase, { actor: 'orchestrator', idempotencyKey: 'golden-run-1' });
  assert.equal(first.steps, 10);
  assert.equal(changeCase.currentStage, 'S9');
  assert.equal(changeCase.status, 'NEEDS_HUMAN');
  assert.equal(changeCase.gateHistory.at(-1).gate, 'G9');
  assert.equal(changeCase.gateHistory.at(-1).status, 'NEEDS_HUMAN');

  approveRelease(changeCase, { principal: 'actor-accountable-owner', roles: ['release-approver', 'control-owner'], idempotencyKey: 'approve-1' });
  advanceCase(changeCase, { actor: 'actor-accountable-owner', idempotencyKey: 'release-1' });
  assert.equal(changeCase.artifacts.release.status, 'RELEASED');
  assert.equal(changeCase.artifacts.release.externalEffect, false);
  assert.equal(changeCase.artifacts.assurance.releaseEvidenceBundle.contentHash, digest(Object.fromEntries(Object.entries(changeCase.artifacts.assurance.releaseEvidenceBundle).filter(([key]) => key !== 'contentHash'))));
  assert.ok(changeCase.artifacts.assurance.draftReleaseEvidenceBundle);
  assert.equal(changeCase.currentStage, 'S10');

  advanceCase(changeCase, { actor: 'operations', idempotencyKey: 'observe-missing' });
  assert.equal(changeCase.status, 'NEEDS_HUMAN');
  recordObservation(changeCase, { actor: 'operations', signals: { technicalHealthy: true, controlExceptions: 0, manualWorkReduction: 35 }, idempotencyKey: 'observation-1' });
  advanceCase(changeCase, { actor: 'orchestrator', idempotencyKey: 'outcome-1' });
  advanceCase(changeCase, { actor: 'orchestrator', idempotencyKey: 'learning-1' });
  assert.equal(changeCase.status, 'PASSED');
  assert.equal(changeCase.currentStage, null);
  assert.equal(changeCase.artifacts.outcome.technicalOutcome, 'PASS');
  assert.equal(changeCase.artifacts.outcome.controlOutcome, 'PASS');
  assert.equal(changeCase.artifacts.outcome.businessOutcome, 'FAIL');
  assert.equal(changeCase.artifacts.learning.proposals.length, 1);
  assert.equal(changeCase.artifacts.learning.proposals[0].status, 'PROPOSED_NOT_APPLIED');

  const lineage = traceability(changeCase);
  assert.ok(lineage.nodes.some((node) => node.type === 'Intent'));
  assert.ok(lineage.nodes.some((node) => node.type === 'Requirement'));
  assert.ok(lineage.nodes.some((node) => node.type === 'ArchitectureDecision'));
  assert.ok(lineage.nodes.some((node) => node.type === 'ChangeSet'));
  assert.ok(lineage.nodes.some((node) => node.type === 'Release'));
  assert.ok(lineage.nodes.some((node) => node.type === 'Outcome'));
  assert.ok(lineage.nodes.some((node) => node.type === 'FollowUp'));
});

for (const [mutation, expectedGate] of Object.entries({
  missing_aml: 'G1', stale_architecture: 'G1', forged_provenance: 'G1', omitted_reporting: 'G2', unresolved_interpretation: 'G3', contradictory_requirement: 'G4',
  direct_database: 'G5', authority_bypass: 'G5', missing_rollback: 'G5', plan_cycle: 'G6', failing_ci: 'G7', artifact_tamper: 'G8', unauthorized_release: 'G9',
})) {
  test(`${mutation} mutation is blocked at ${expectedGate}`, () => {
    const changeCase = createChangeCase({ mode: 'golden', mutation });
    runToCheckpoint(changeCase, { actor: 'mutation-runner', idempotencyKey: `run-${mutation}` });
    assert.equal(changeCase.gateHistory.at(-1).gate, expectedGate);
    assert.ok(['BLOCKED', 'NEEDS_HUMAN'].includes(changeCase.status));
    assert.notEqual(changeCase.gateHistory.at(-1).status, 'PASSED');
    assert.equal(MUTATIONS[mutation].expectedGate, expectedGate);
  });
}

test('prompt injection remains untrusted data and cannot block or authorize the flow', () => {
  const changeCase = createChangeCase({ mode: 'golden', mutation: 'prompt_injection' });
  runToCheckpoint(changeCase, { actor: 'orchestrator', idempotencyKey: 'prompt-run' });
  assert.equal(changeCase.currentStage, 'S9');
  assert.equal(changeCase.status, 'NEEDS_HUMAN');
  assert.ok(changeCase.evaluations.find((entry) => entry.definitionRef === 'context-sufficiency').findings.some((entry) => entry.code === 'UNTRUSTED_CONTENT_ISOLATED'));
  assert.equal(changeCase.approvals.length, 0);
});

test('segregation of duties rejects self approval and missing roles', () => {
  const changeCase = createChangeCase({ mode: 'golden' });
  runToCheckpoint(changeCase, { idempotencyKey: 'sod-run' });
  assert.throws(() => approveRelease(changeCase, { principal: 'actor-implementation-agent', roles: ['release-approver', 'control-owner'] }), /cannot approve/i);
  assert.throws(() => approveRelease(changeCase, { principal: 'someone', roles: ['release-approver'] }), /control owner/i);
  assert.equal(changeCase.approvals.length, 0);
});

test('stage commands are idempotent and evidence tampering is detected', () => {
  const changeCase = createChangeCase({ mode: 'golden' });
  const first = advanceCase(changeCase, { actor: 'orchestrator', idempotencyKey: 'same-key' });
  const version = changeCase.version;
  const gates = changeCase.gateHistory.length;
  const second = advanceCase(changeCase, { actor: 'orchestrator', idempotencyKey: 'same-key' });
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(changeCase.version, version);
  assert.equal(changeCase.gateHistory.length, gates);

  advanceCase(changeCase, { idempotencyKey: 'context-step' });
  assert.ok(verifyEvidenceLedger(changeCase).every((entry) => entry.valid));
  changeCase.evidenceLedger[0].content.name = 'tampered';
  assert.ok(verifyEvidenceLedger(changeCase).some((entry) => !entry.valid));
});

test('custom incomplete intent fails G0 rather than fabricating certainty', () => {
  const changeCase = createChangeCase({ mode: 'custom', rawIntent: 'Make customer maintenance better.' });
  advanceCase(changeCase, { idempotencyKey: 'incomplete-intent' });
  assert.equal(changeCase.status, 'BLOCKED');
  assert.equal(changeCase.gateHistory[0].gate, 'G0');
  assert.ok(changeCase.gateHistory[0].findings.length >= 4);
});

test('contracts expose the complete twelve-stage lifecycle and stable hashing', () => {
  assert.equal(STAGES.length, 12);
  assert.deepEqual(STAGES.map((stage) => stage.id), ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11']);
  assert.equal(digest({ b: 2, a: 1 }), digest({ a: 1, b: 2 }));
});
