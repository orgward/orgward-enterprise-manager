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
import { digest } from '../../src/sdlc/contracts.mjs';
import { caseUiModel, createSourceSelectionGuard, sourceBindingDesignRoute } from '../../public/sdlc-view.mjs';

test('source selection guard ignores a slower response for a previous project', () => {
  const guard = createSourceSelectionGuard();
  const first = guard.begin('project-first');
  const second = guard.begin('project-second');
  assert.equal(guard.isCurrent(first, 'project-second'), false);
  assert.equal(guard.isCurrent(second, 'project-second'), true);
  assert.equal(guard.isCurrent(second, 'project-first'), false);
});

test('case UI keeps the pinned source identity visible when the saved project advances', () => {
  const snapshot = { id: 'info-source', type: 'information', name: 'Owner data', detail: 'Pinned detail.' };
  const binding = {
    projectId: 'project-source', projectVersion: 4, blueprintId: 'blueprint-source', blueprintVersion: 2,
    blueprintSchemaVersion: 1, objectId: 'info-source', objectType: 'information', sourceHash: digest(snapshot), snapshot,
  };
  binding.bindingHash = digest({
    projectId: binding.projectId, projectVersion: binding.projectVersion, blueprintId: binding.blueprintId,
    blueprintVersion: binding.blueprintVersion, blueprintSchemaVersion: binding.blueprintSchemaVersion,
    objectId: binding.objectId, objectType: binding.objectType, sourceHash: binding.sourceHash,
  });
  const changeCase = createChangeCase({ mode: 'golden' }, { sourceBinding: {
    ...binding,
  } });
  changeCase.workspace = workspaceStatus(changeCase);
  changeCase.sourceBindingIntegrity = { valid: true };
  changeCase.artifacts.requirements = { acceptedBaseline: { sourceHash: binding.sourceHash, contentHash: 'requirements-hash' } };
  changeCase.artifacts.architecture = { acceptedBaseline: { sourceHash: binding.sourceHash, draftHash: 'architecture-hash' } };
  changeCase.evaluations = [{ id: 'evaluation-id' }];
  changeCase.approvals = [{ id: 'approval-id' }];
  const pinned = caseUiModel(changeCase, {}, { id: 'project-source', version: 5, blueprintVersions: [{ version: 3 }] }).sourceBinding;
  assert.equal(pinned.state, 'PINNED_OLDER_VERSION');
  assert.equal(pinned.snapshot.detail, 'Pinned detail.');
  assert.equal(pinned.sourceHash, binding.sourceHash);
  assert.equal(pinned.invalidation.status, 'DEPENDENCIES_STALE');
  assert.deepEqual(pinned.invalidation.staleArtifacts, [
    { type: 'Accepted requirements baseline', referenceLabel: 'SHA-256', reference: 'requirements-hash' },
    { type: 'Accepted architecture baseline', referenceLabel: 'SHA-256', reference: 'architecture-hash' },
    { type: 'Evaluation', referenceLabel: 'ID', reference: 'evaluation-id' },
    { type: 'Approval', referenceLabel: 'ID', reference: 'approval-id' },
  ]);
  assert.equal(caseUiModel(changeCase).sourceBinding.state, 'PROJECT_UNAVAILABLE');
  changeCase.sourceBindingIntegrity = { valid: false };
  assert.equal(caseUiModel(changeCase, {}, { id: 'project-source', version: 5, blueprintVersions: [{ version: 3 }] }).sourceBinding.state, 'INTEGRITY_FAILED');
});

test('an accepted upstream authority change invalidates dependent artifacts while retaining the pinned history', () => {
  const snapshot = { id: 'control-human-authority', type: 'control', name: 'Human authority boundary', detail: 'Only the accountable owner may approve changes.' };
  const binding = {
    projectId: 'project-authority', projectVersion: 8, blueprintId: 'blueprint-authority', blueprintVersion: 4,
    blueprintSchemaVersion: 1, objectId: snapshot.id, objectType: snapshot.type, sourceHash: digest(snapshot), snapshot,
  };
  binding.bindingHash = digest({ projectId: binding.projectId, projectVersion: binding.projectVersion,
    blueprintId: binding.blueprintId, blueprintVersion: binding.blueprintVersion,
    blueprintSchemaVersion: binding.blueprintSchemaVersion, objectId: binding.objectId,
    objectType: binding.objectType, sourceHash: binding.sourceHash });
  const changeCase = createChangeCase({ mode: 'golden' }, { sourceBinding: binding });
  changeCase.workspace = workspaceStatus(changeCase);
  changeCase.sourceBindingIntegrity = { valid: true };
  changeCase.artifacts.requirements = { acceptedBaseline: { sourceHash: binding.sourceHash, contentHash: 'accepted-requirements' } };
  changeCase.artifacts.architecture = { acceptedBaseline: { sourceHash: binding.sourceHash, draftHash: 'accepted-architecture' } };
  changeCase.evaluations = [{ id: 'historical-evaluation' }];
  changeCase.approvals = [{ id: 'historical-approval' }];
  const historicalContext = structuredClone(changeCase.sourceBinding);
  const currentProject = { id: binding.projectId, version: 9, latestBlueprint: {
    id: binding.blueprintId, version: 5,
    areas: { governance: { items: [{ ...snapshot, detail: 'The requester may approve changes without an independent owner.' }] } },
  } };

  const current = caseUiModel(changeCase, {}, currentProject).sourceBinding;

  assert.equal(current.state, 'PINNED_OLDER_VERSION');
  assert.equal(current.invalidation.status, 'DEPENDENCIES_STALE');
  assert.deepEqual(current.invalidation.staleArtifacts.map((artifact) => artifact.reference), [
    'accepted-requirements', 'accepted-architecture', 'historical-evaluation', 'historical-approval',
  ]);
  assert.deepEqual(current.snapshot, historicalContext.snapshot);
  assert.deepEqual(changeCase.sourceBinding, historicalContext, 'the pinned historical source remains unchanged');
});

test('case UI needs full active-project detail to distinguish current pin from unavailable summary', () => {
  const snapshot = { id: 'info-current', type: 'information', name: 'Current source', detail: 'Exact saved detail.' };
  const binding = {
    projectId: 'project-current', projectVersion: 5, blueprintId: 'blueprint-current', blueprintVersion: 1,
    blueprintSchemaVersion: 1, objectId: snapshot.id, objectType: snapshot.type, sourceHash: digest(snapshot), snapshot,
  };
  binding.bindingHash = digest({
    projectId: binding.projectId, projectVersion: binding.projectVersion, blueprintId: binding.blueprintId,
    blueprintVersion: binding.blueprintVersion, blueprintSchemaVersion: binding.blueprintSchemaVersion,
    objectId: binding.objectId, objectType: binding.objectType, sourceHash: binding.sourceHash,
  });
  const changeCase = createChangeCase({ mode: 'golden' }, { sourceBinding: binding });
  changeCase.workspace = workspaceStatus(changeCase);
  changeCase.sourceBindingIntegrity = { valid: true };
  const detail = {
    id: binding.projectId, version: 5,
    latestBlueprint: { id: binding.blueprintId, version: 1, areas: { domain: { items: [snapshot] } } },
  };
  assert.equal(caseUiModel(changeCase, {}, detail).sourceBinding.state, 'CURRENT');
  assert.equal(caseUiModel(changeCase, {}, { id: detail.id, version: detail.version }).sourceBinding.state, 'PROJECT_UNAVAILABLE');
});

test('SDLC source evidence links to the exact pinned design object and omits mismatched context', () => {
  const source = { id: 'info-pinned', type: 'information', name: 'Pinned information', detail: 'Exact source.' };
  const projectId = 'project-11111111-1111-4111-8111-111111111111';
  const blueprintId = 'blueprint-22222222-2222-4222-8222-222222222222';
  const binding = { projectId, blueprintId, blueprintVersion: 4, objectId: source.id,
    objectType: source.type, snapshot: source };
  const changeCase = { sourceBinding: binding, sourceBindingIntegrity: { valid: true } };
  const project = { id: projectId, blueprintVersions: [{ id: blueprintId, version: 4,
    areas: { informationTechnology: { items: [source] } } }] };
  assert.equal(sourceBindingDesignRoute(changeCase, project),
    '/?project=project-11111111-1111-4111-8111-111111111111&view=map&selected=info-pinned&blueprintVersion=4');
  assert.equal(sourceBindingDesignRoute(changeCase, { ...project, id: 'project-33333333-3333-4333-8333-333333333333' }), null);
  assert.equal(sourceBindingDesignRoute({ ...changeCase, sourceBindingIntegrity: { valid: false } }, project), null);
  assert.equal(sourceBindingDesignRoute(changeCase, { ...project, blueprintVersions: [] }), null);
  assert.equal(sourceBindingDesignRoute(changeCase, { ...project, blueprintVersions: [{ id: blueprintId, version: 4,
    areas: { informationTechnology: { items: [{ ...source, detail: 'Changed source.' }] } } }] }), null);
});

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
