import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceCase, createChangeCase, normalizeChangeCase, recordProofResult, registerProofObligation, routeProofResult } from '../../src/sdlc/engine.mjs';

function caseWithResult(status = 'FAIL') {
  const changeCase = createChangeCase({ mode: 'golden' });
  registerProofObligation(changeCase, {
    actor: 'designer', idempotencyKey: `register-${status}`, targetRef: changeCase.intent.id,
    criterion: 'The requested behavior is observable.', evaluatorType: 'DETERMINISTIC', required: true,
  });
  const proofRef = changeCase.proofs.obligations[0].id;
  recordProofResult(changeCase, {
    actor: 'test-runner', idempotencyKey: `result-${status}`, proofRef, status,
    summary: status === 'FAIL' ? 'The behavior is missing.' : 'The available evidence cannot decide the criterion.',
    observations: ['The evaluator retained its actual observation.'],
  });
  return { changeCase, proofRef, result: structuredClone(changeCase.proofs.results[0]) };
}

test('failed and indeterminate results route to the five bounded actions without deleting evidence', () => {
  const routes = [
    ['FAIL', 'REPAIR', 'implementation'],
    ['FAIL', 'REPLAN', 'planning'],
    ['FAIL', 'REARCHITECT', 'architecture'],
    ['INDETERMINATE', 'CLARIFY', 'clarification'],
    ['INDETERMINATE', 'STOP', 'stopped'],
  ];

  for (const [status, action, destination] of routes) {
    const { changeCase, proofRef, result } = caseWithResult(status);
    const actor = action === 'STOP' ? changeCase.accountableOwner : 'studio-operator';
    routeProofResult(changeCase, {
      actor, idempotencyKey: `route-${action}`, proofRef, resultRef: result.id, action,
      reason: `Route the ${status.toLowerCase()} result to ${destination}.`,
    });

    assert.deepEqual(changeCase.proofs.results, [result]);
    assert.equal(changeCase.proofs.actions.length, 1);
    assert.equal(changeCase.proofs.actions[0].action, action);
    assert.equal(changeCase.proofs.actions[0].destination, destination);
    assert.equal(changeCase.proofs.actions[0].resultRef, result.id);
    assert.equal(changeCase.proofs.actions[0].status, action === 'STOP' ? 'COMPLETED' : 'READY');
    assert.equal(changeCase.events.at(-1).type, 'ProofActionRouted');
    if (action === 'STOP') assert.equal(changeCase.status, 'STOPPED');
  }
});

test('routing is idempotent, one decision per result, and rejects invalid or stale evidence', () => {
  const { changeCase, proofRef, result } = caseWithResult('FAIL');
  const command = {
    actor: 'studio-operator', idempotencyKey: 'route-failure', proofRef, resultRef: result.id,
    action: 'REPAIR', reason: 'Correct the local implementation defect.',
  };
  routeProofResult(changeCase, command);
  assert.equal(routeProofResult(changeCase, command).replayed, true);
  assert.throws(() => routeProofResult(changeCase, { ...command, idempotencyKey: 'route-again', action: 'REPLAN' }), /already has a route/i);
  assert.throws(() => routeProofResult(changeCase, { ...command, idempotencyKey: 'route-invalid', action: 'RETRY' }), /action is invalid/i);

  const second = caseWithResult('FAIL');
  recordProofResult(second.changeCase, {
    actor: 'test-runner', idempotencyKey: 'replacement-result', proofRef: second.proofRef, status: 'PASS',
    summary: 'The repaired behavior passes.', observations: ['The scenario completed successfully.'],
  });
  assert.throws(() => routeProofResult(second.changeCase, {
    actor: 'studio-operator', idempotencyKey: 'route-stale', proofRef: second.proofRef,
    resultRef: second.result.id, action: 'REPAIR', reason: 'Try to route old evidence.',
  }), /latest result/i);
});

test('passing proofs cannot be routed and only the accountable owner can stop work', () => {
  const passing = caseWithResult('FAIL');
  recordProofResult(passing.changeCase, {
    actor: 'test-runner', idempotencyKey: 'pass-result', proofRef: passing.proofRef, status: 'PASS',
    summary: 'The behavior now passes.', observations: ['The test completed.'],
  });
  const passedResult = passing.changeCase.proofs.results.at(-1);
  assert.throws(() => routeProofResult(passing.changeCase, {
    actor: 'studio-operator', idempotencyKey: 'route-pass', proofRef: passing.proofRef,
    resultRef: passedResult.id, action: 'REPAIR', reason: 'Invalid route.',
  }), /failed or indeterminate/i);

  const stopped = caseWithResult('INDETERMINATE');
  assert.throws(() => routeProofResult(stopped.changeCase, {
    actor: 'studio-operator', idempotencyKey: 'unauthorized-stop', proofRef: stopped.proofRef,
    resultRef: stopped.result.id, action: 'STOP', reason: 'Stop the infeasible work.',
  }), /accountable owner/i);
  assert.equal(stopped.changeCase.proofs.actions.length, 0);
  assert.equal(stopped.changeCase.status, 'DRAFT');

  routeProofResult(stopped.changeCase, {
    actor: stopped.changeCase.accountableOwner, idempotencyKey: 'authorized-stop', proofRef: stopped.proofRef,
    resultRef: stopped.result.id, action: 'STOP', reason: 'The owner determined that work is infeasible.',
  });
  assert.throws(() => advanceCase(stopped.changeCase, { actor: 'orchestrator', idempotencyKey: 'advance-stopped' }), /stopped/i);
  assert.throws(() => recordProofResult(stopped.changeCase, {
    actor: 'runner', idempotencyKey: 'result-after-stop', proofRef: stopped.proofRef,
    status: 'PASS', summary: 'Attempted after stop.', observations: ['This must not be saved.'],
  }), /stopped/i);
  assert.deepEqual(stopped.changeCase.proofs.results, [stopped.result]);
});

test('saved cases from before proof routing support are upgraded in memory', () => {
  const changeCase = createChangeCase({ mode: 'golden' });
  delete changeCase.proofs.actions;
  normalizeChangeCase(changeCase);
  assert.deepEqual(changeCase.proofs.actions, []);
});
