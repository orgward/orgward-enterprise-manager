import assert from 'node:assert/strict';
import test from 'node:test';
import { answerClarification, assessProofs, createChangeCase, openClarification, reconcileClarification, recordProofResult, registerProofObligation } from '../../src/sdlc/engine.mjs';

function latestAssessment(changeCase) { return changeCase.proofs.assessments.at(-1); }

test('acceptance is derived from current required proof results', () => {
  const changeCase = createChangeCase({ mode: 'golden' });
  registerProofObligation(changeCase, {
    actor: 'designer', idempotencyKey: 'register-recurring', targetRef: changeCase.intent.id,
    criterion: 'An authorized customer can create a recurring booking.', evaluatorType: 'DETERMINISTIC', required: true,
  });
  const proofRef = changeCase.proofs.obligations[0].id;

  assessProofs(changeCase, { actor: 'controller', idempotencyKey: 'assess-unrun' });
  assert.equal(latestAssessment(changeCase).phase, 'INCOMPLETE');
  assert.equal(latestAssessment(changeCase).accepted, false);
  assert.equal(latestAssessment(changeCase).blockers[0].code, 'PROOF_NOT_RUN');

  recordProofResult(changeCase, {
    actor: 'test-runner', idempotencyKey: 'record-fail', proofRef, status: 'FAIL',
    summary: 'Single bookings work, recurring bookings are not implemented.', observations: ['POST /bookings rejects recurrenceRule.'],
  });
  assessProofs(changeCase, { actor: 'controller', idempotencyKey: 'assess-fail' });
  assert.equal(latestAssessment(changeCase).phase, 'REJECTED');
  assert.equal(latestAssessment(changeCase).accepted, false);

  recordProofResult(changeCase, {
    actor: 'test-runner', idempotencyKey: 'record-pass', proofRef, status: 'PASS',
    summary: 'Recurring booking is created and retrieved.', observations: ['Created a 4-occurrence series.', 'Reload returned the same series and schedule.'],
  });
  assessProofs(changeCase, { actor: 'controller', idempotencyKey: 'assess-pass', accepted: false });
  assert.equal(latestAssessment(changeCase).phase, 'ACCEPTED');
  assert.equal(latestAssessment(changeCase).accepted, true);
  assert.equal(changeCase.proofs.results.length, 2);
  assert.equal(changeCase.proofs.results[1].priorResultRef, changeCase.proofs.results[0].id);
  assert.equal(changeCase.proofs.results[0].status, 'FAIL');
});

test('a pass requires observations and idempotency keys bind exact proof commands', () => {
  const changeCase = createChangeCase({ mode: 'golden' });
  const command = { actor: 'designer', idempotencyKey: 'register-proof', criterion: 'The current intent has a saved owner.', evaluatorType: 'HUMAN' };
  registerProofObligation(changeCase, command);
  assert.equal(registerProofObligation(changeCase, command).replayed, true);
  assert.throws(() => registerProofObligation(changeCase, { ...command, criterion: 'Different criterion' }), /different command/i);
  assert.throws(() => recordProofResult(changeCase, { actor: 'reviewer', idempotencyKey: 'empty-pass', proofRef: changeCase.proofs.obligations[0].id, status: 'PASS', summary: 'Looks good.' }), /observation/i);
});

test('proofs from a superseded intent revision cannot accept the new intent', () => {
  const changeCase = createChangeCase({ mode: 'golden' });
  registerProofObligation(changeCase, { actor: 'designer', idempotencyKey: 'proof-v1', criterion: 'Payment is excluded.', required: true });
  const proofRef = changeCase.proofs.obligations[0].id;
  recordProofResult(changeCase, { actor: 'reviewer', idempotencyKey: 'pass-v1', proofRef, status: 'PASS', summary: 'No payment path exists.', observations: ['Checkout routes are absent.'] });

  openClarification(changeCase, { actor: 'studio-operator', idempotencyKey: 'open-scope', question: 'Is payment included?', targetField: 'nonGoals' });
  const questionRef = changeCase.clarifications[0].id;
  assessProofs(changeCase, { actor: 'controller', idempotencyKey: 'assess-open-question' });
  assert.equal(latestAssessment(changeCase).phase, 'INCOMPLETE');
  assert.ok(latestAssessment(changeCase).blockers.some((entry) => entry.code === 'UNRESOLVED_CLARIFICATION'));
  answerClarification(changeCase, { actor: 'actor-accountable-owner', idempotencyKey: 'answer-scope', questionRef, answer: 'Payment is outside this release.' });
  reconcileClarification(changeCase, { actor: 'actor-accountable-owner', idempotencyKey: 'reconcile-scope', questionRef });

  assert.throws(() => recordProofResult(changeCase, { actor: 'reviewer', idempotencyKey: 'stale-result', proofRef, status: 'PASS', summary: 'Old check rerun.', observations: ['Old observation.'] }), /current revision/i);
  assessProofs(changeCase, { actor: 'controller', idempotencyKey: 'assess-v2' });
  assert.equal(latestAssessment(changeCase).phase, 'INCOMPLETE');
  assert.equal(latestAssessment(changeCase).blockers[0].code, 'NO_REQUIRED_PROOFS');
});

test('tampered proof results never satisfy acceptance', () => {
  const changeCase = createChangeCase({ mode: 'golden' });
  registerProofObligation(changeCase, { actor: 'designer', idempotencyKey: 'proof-integrity', criterion: 'A saved result remains intact.', required: true });
  recordProofResult(changeCase, { actor: 'reviewer', idempotencyKey: 'pass-integrity', proofRef: changeCase.proofs.obligations[0].id, status: 'PASS', summary: 'Original result.', observations: ['Original observation.'] });
  changeCase.proofs.results[0].summary = 'Tampered result.';
  assessProofs(changeCase, { actor: 'controller', idempotencyKey: 'assess-tamper' });
  assert.equal(latestAssessment(changeCase).phase, 'INCOMPLETE');
  assert.equal(latestAssessment(changeCase).blockers[0].code, 'PROOF_INTEGRITY_INVALID');
});
