import assert from 'node:assert/strict';
import test from 'node:test';
import {
  answerClarification,
  assessProofs,
  completeProofAction,
  createChangeCase,
  openClarification,
  reconcileClarification,
  recordProofResult,
  registerProofObligation,
  resumeProofAction,
  routeProofResult,
  workspaceStatus,
} from '../../src/sdlc/engine.mjs';
import { caseUiModel } from '../../public/sdlc-view.mjs';

test('workspace status exposes questions and their next allowed decision', () => {
  const changeCase = createChangeCase({ mode: 'golden' });
  assert.equal(workspaceStatus(changeCase).nextAllowedAction.type, 'REGISTER_PROOF');

  openClarification(changeCase, {
    actor: 'studio-operator', idempotencyKey: 'workspace-question',
    question: 'Is payment included?', targetField: 'nonGoals',
  });
  const question = changeCase.clarifications[0];
  let workspace = workspaceStatus(changeCase);
  assert.deepEqual(workspace.questions.map((entry) => entry.id), [question.id]);
  assert.equal(workspace.nextAllowedAction.type, 'ANSWER_CLARIFICATION');
  assert.equal(workspace.nextAllowedAction.clarificationRef, question.id);

  answerClarification(changeCase, {
    actor: changeCase.accountableOwner, idempotencyKey: 'workspace-answer',
    questionRef: question.id, answer: 'Payment is outside this release.',
  });
  workspace = workspaceStatus(changeCase);
  assert.equal(workspace.questions[0].status, 'ANSWERED');
  assert.equal(workspace.nextAllowedAction.type, 'RECONCILE_CLARIFICATION');

  reconcileClarification(changeCase, {
    actor: changeCase.accountableOwner, idempotencyKey: 'workspace-reconcile', questionRef: question.id,
  });
  workspace = workspaceStatus(changeCase);
  assert.deepEqual(workspace.questions, []);
  assert.equal(workspace.nextAllowedAction.type, 'REGISTER_PROOF');
});

test('workspace does not recommend reconciling a question from a superseded intent', () => {
  const changeCase = createChangeCase({ mode: 'golden' });
  for (const [key, question, targetField, answer] of [
    ['scope', 'Is payment included?', 'nonGoals', 'Payment is excluded.'],
    ['outcome', 'Must updates be immediate?', 'desiredOutcomes', 'Updates complete within one minute.'],
  ]) {
    openClarification(changeCase, { actor: 'studio-operator', idempotencyKey: `workspace-open-${key}`, question, targetField });
    answerClarification(changeCase, { actor: changeCase.accountableOwner, idempotencyKey: `workspace-answer-${key}`, questionRef: changeCase.clarifications.at(-1).id, answer });
  }
  reconcileClarification(changeCase, {
    actor: changeCase.accountableOwner, idempotencyKey: 'workspace-reconcile-scope', questionRef: changeCase.clarifications[0].id,
  });

  const workspace = workspaceStatus(changeCase);
  assert.deepEqual(workspace.questions, []);
  assert.equal(workspace.nextAllowedAction.type, 'REGISTER_PROOF');
  changeCase.workspace = workspace;
  assert.equal(caseUiModel(changeCase).clarifications[1].control, 'NONE');
  assessProofs(changeCase, { actor: 'controller', idempotencyKey: 'workspace-assess-superseded-question' });
  assert.equal(changeCase.proofs.assessments.at(-1).blockers.some((entry) => entry.code === 'UNRESOLVED_CLARIFICATION'), false);
  assert.equal(changeCase.clarifications[1].status, 'ANSWERED');
});

test('workspace status exposes proof gaps, failed evidence, and the exact recovery action', () => {
  const changeCase = createChangeCase({ mode: 'golden' });
  registerProofObligation(changeCase, {
    actor: 'designer', idempotencyKey: 'workspace-proof', targetRef: changeCase.intent.id,
    criterion: 'The bounded repair produces the requested behavior.', required: true,
  });
  const proofRef = changeCase.proofs.obligations[0].id;
  let workspace = workspaceStatus(changeCase);
  assert.equal(workspace.proofGaps[0].status, 'NOT_RUN');
  assert.equal(workspace.nextAllowedAction.type, 'RECORD_PROOF_RESULT');
  assert.equal(workspace.nextAllowedAction.proofRef, proofRef);

  recordProofResult(changeCase, {
    actor: 'runner', idempotencyKey: 'workspace-fail', proofRef, status: 'FAIL',
    summary: 'The requested behavior is missing.', observations: ['The scenario returned no result.'],
  });
  const failedResult = changeCase.proofs.results[0];
  workspace = workspaceStatus(changeCase);
  assert.equal(workspace.proofGaps[0].status, 'FAIL');
  assert.equal(workspace.failedResults[0].id, failedResult.id);
  assert.equal(workspace.failedResults[0].summary, failedResult.summary);
  assert.equal(workspace.nextAllowedAction.type, 'ROUTE_PROOF_RESULT');
  assert.deepEqual(workspace.nextAllowedAction.allowedActions, ['REPAIR', 'CLARIFY', 'REPLAN', 'REARCHITECT', 'STOP']);

  routeProofResult(changeCase, {
    actor: 'studio-operator', idempotencyKey: 'workspace-route', proofRef,
    resultRef: failedResult.id, action: 'REPAIR', reason: 'Repair the missing behavior.',
  });
  const action = changeCase.proofs.actions[0];
  workspace = workspaceStatus(changeCase);
  assert.equal(workspace.proofGaps[0].action.status, 'READY');
  assert.equal(workspace.nextAllowedAction.type, 'RESUME_PROOF_ACTION');
  assert.equal(workspace.nextAllowedAction.actionRef, action.id);

  resumeProofAction(changeCase, { actor: action.owner, idempotencyKey: 'workspace-resume', actionRef: action.id });
  workspace = workspaceStatus(changeCase);
  assert.equal(workspace.nextAllowedAction.type, 'COMPLETE_PROOF_ACTION');

  completeProofAction(changeCase, {
    actor: action.owner, idempotencyKey: 'workspace-complete', actionRef: action.id,
    outcome: 'SUCCEEDED', summary: 'The repair produced a new candidate for evaluation.',
  });
  assert.equal(workspaceStatus(changeCase).nextAllowedAction.type, 'RECORD_PROOF_RESULT');

  recordProofResult(changeCase, {
    actor: 'runner', idempotencyKey: 'workspace-pass', proofRef, status: 'PASS',
    summary: 'The repaired behavior now passes.', observations: ['The scenario completed successfully.'],
  });
  assert.equal(workspaceStatus(changeCase).nextAllowedAction.type, 'ASSESS_PROOFS');
  assessProofs(changeCase, { actor: 'controller', idempotencyKey: 'workspace-assess' });
  workspace = workspaceStatus(changeCase);
  assert.deepEqual(workspace.proofGaps, []);
  assert.equal(workspace.nextAllowedAction.type, 'ADVANCE_CASE');
});

test('stopped work has no next mutation while retaining failed results', () => {
  const changeCase = createChangeCase({ mode: 'golden' });
  registerProofObligation(changeCase, { actor: 'designer', idempotencyKey: 'stop-workspace-proof', criterion: 'The work is feasible.', required: true });
  const proofRef = changeCase.proofs.obligations[0].id;
  recordProofResult(changeCase, { actor: 'runner', idempotencyKey: 'stop-workspace-result', proofRef, status: 'INDETERMINATE', summary: 'Feasibility is unknown.', observations: ['A dependency is unavailable.'] });
  routeProofResult(changeCase, { actor: changeCase.accountableOwner, idempotencyKey: 'stop-workspace-route', proofRef, resultRef: changeCase.proofs.results[0].id, action: 'STOP', reason: 'Stop infeasible work.' });
  const workspace = workspaceStatus(changeCase);
  assert.equal(workspace.failedResults.length, 1);
  assert.equal(workspace.nextAllowedAction.type, 'NONE');
  assert.match(workspace.nextAllowedAction.reason, /stopped/i);
  changeCase.workspace = workspace;
  assert.equal(caseUiModel(changeCase).proofs[0].control, 'NONE');
});
