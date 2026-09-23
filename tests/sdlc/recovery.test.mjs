import assert from 'node:assert/strict';
import test from 'node:test';
import {
  completeProofAction,
  createChangeCase,
  normalizeChangeCase,
  recordProofResult,
  registerProofObligation,
  resumeProofAction,
  routeProofResult,
} from '../../src/sdlc/engine.mjs';

function setupFailure() {
  const changeCase = createChangeCase({ mode: 'golden' });
  registerProofObligation(changeCase, {
    actor: 'designer', idempotencyKey: 'recovery-proof', targetRef: changeCase.intent.id,
    criterion: 'The repair loop reaches an evidenced result.', required: true,
  });
  const proofRef = changeCase.proofs.obligations[0].id;
  recordProofResult(changeCase, {
    actor: 'runner', idempotencyKey: 'recovery-result-1', proofRef, status: 'FAIL',
    summary: 'The first implementation is incomplete.', observations: ['The required behavior is absent.'],
  });
  routeProofResult(changeCase, {
    actor: 'studio-operator', idempotencyKey: 'recovery-route-1', proofRef,
    resultRef: changeCase.proofs.results.at(-1).id, action: 'REPAIR', reason: 'Repair the local defect.',
  });
  return { changeCase, proofRef, action: changeCase.proofs.actions[0] };
}

test('a pending action resumes exactly once and records one persisted loop attempt', () => {
  const { changeCase, proofRef, action } = setupFailure();
  assert.equal(action.status, 'READY');
  assert.equal(changeCase.proofs.loopCounters[proofRef] ?? 0, 0);

  const version = changeCase.version;
  resumeProofAction(changeCase, {
    actor: action.owner, idempotencyKey: 'resume-action-1', actionRef: action.id,
  });
  assert.equal(action.status, 'IN_PROGRESS');
  assert.equal(action.attempt, 1);
  assert.equal(changeCase.proofs.loopCounters[proofRef], 1);
  assert.equal(changeCase.version, version + 1);
  assert.equal(changeCase.events.at(-1).type, 'ProofActionResumed');
  assert.throws(() => recordProofResult(changeCase, {
    actor: 'runner', idempotencyKey: 'result-before-completion', proofRef, status: 'PASS',
    summary: 'This result raced the pending action.', observations: ['It must not be saved.'],
  }), /complete the pending/i);
  assert.equal(changeCase.proofs.results.length, 1);

  const resumedVersion = changeCase.version;
  const resumedEvents = changeCase.events.length;
  assert.equal(resumeProofAction(changeCase, {
    actor: action.owner, idempotencyKey: 'resume-action-after-restart', actionRef: action.id,
  }).replayed, true);
  assert.equal(changeCase.proofs.loopCounters[proofRef], 1);
  assert.equal(changeCase.version, resumedVersion);
  assert.equal(changeCase.events.length, resumedEvents);
});

test('only the action owner can resume or complete pending work', () => {
  const { changeCase, action } = setupFailure();
  assert.throws(() => resumeProofAction(changeCase, {
    actor: 'someone-else', idempotencyKey: 'unauthorized-resume', actionRef: action.id,
  }), /action owner/i);
  assert.equal(action.status, 'READY');

  resumeProofAction(changeCase, { actor: action.owner, idempotencyKey: 'owner-resume', actionRef: action.id });
  assert.throws(() => completeProofAction(changeCase, {
    actor: 'someone-else', idempotencyKey: 'unauthorized-complete', actionRef: action.id,
    outcome: 'SUCCEEDED', summary: 'Unauthorized completion.',
  }), /action owner/i);
  completeProofAction(changeCase, {
    actor: action.owner, idempotencyKey: 'owner-complete', actionRef: action.id,
    outcome: 'FAILED', summary: 'The repair ran, but the proof still fails.',
  });
  assert.equal(action.status, 'FAILED');
  assert.equal(action.outcome, 'FAILED');
  assert.equal(changeCase.proofs.loopCounters[action.proofRef], 1);
});

test('two started actions exhaust the proof loop without deleting its history', () => {
  const { changeCase, proofRef, action } = setupFailure();
  resumeProofAction(changeCase, { actor: action.owner, idempotencyKey: 'resume-loop-1', actionRef: action.id });
  completeProofAction(changeCase, { actor: action.owner, idempotencyKey: 'complete-loop-1', actionRef: action.id, outcome: 'FAILED', summary: 'The first repair did not resolve the failure.' });

  recordProofResult(changeCase, {
    actor: 'runner', idempotencyKey: 'recovery-result-2', proofRef, status: 'FAIL',
    summary: 'The second evaluation still fails.', observations: ['The same behavior remains absent.'],
  });
  routeProofResult(changeCase, {
    actor: 'studio-operator', idempotencyKey: 'recovery-route-2', proofRef,
    resultRef: changeCase.proofs.results.at(-1).id, action: 'REPLAN', reason: 'Revise the missing work plan.',
  });
  const secondAction = changeCase.proofs.actions.at(-1);
  resumeProofAction(changeCase, { actor: secondAction.owner, idempotencyKey: 'resume-loop-2', actionRef: secondAction.id });
  completeProofAction(changeCase, { actor: secondAction.owner, idempotencyKey: 'complete-loop-2', actionRef: secondAction.id, outcome: 'FAILED', summary: 'The revised plan did not resolve the proof.' });
  assert.equal(changeCase.proofs.loopCounters[proofRef], 2);

  recordProofResult(changeCase, {
    actor: 'runner', idempotencyKey: 'recovery-result-3', proofRef, status: 'INDETERMINATE',
    summary: 'No new evidence can establish success.', observations: ['The available evidence is unchanged.'],
  });
  const thirdResult = changeCase.proofs.results.at(-1);
  assert.throws(() => routeProofResult(changeCase, {
    actor: 'studio-operator', idempotencyKey: 'recovery-route-3', proofRef,
    resultRef: thirdResult.id, action: 'REARCHITECT', reason: 'Attempt another loop.',
  }), /loop limit/i);
  assert.equal(changeCase.proofs.actions.length, 2);
  assert.equal(changeCase.proofs.results.length, 3);

  routeProofResult(changeCase, {
    actor: changeCase.accountableOwner, idempotencyKey: 'recovery-stop', proofRef,
    resultRef: thirdResult.id, action: 'STOP', reason: 'Stop after the bounded loop is exhausted.',
  });
  assert.equal(changeCase.status, 'STOPPED');
  assert.equal(changeCase.proofs.actions.length, 3);
});

test('saved cases from before loop recovery support are upgraded in memory', () => {
  const changeCase = createChangeCase({ mode: 'golden' });
  delete changeCase.proofs.loopCounters;
  normalizeChangeCase(changeCase);
  assert.deepEqual(changeCase.proofs.loopCounters, {});
});
