import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../../server.mjs';
import { caseUiModel } from '../../public/sdlc-view.mjs';

async function start(root) {
  const app = createApp({
    dataDirectory: path.join(root, 'blueprints'),
    sdlcDirectory: path.join(root, 'sdlc'),
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  return { ...app, base: `http://127.0.0.1:${app.server.address().port}` };
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function request(base, route, options = {}, expected = 200) {
  const response = await fetch(`${base}${route}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  const body = await response.json();
  assert.equal(response.status, expected, JSON.stringify(body));
  return body;
}

function command(changeCase, action, body) {
  return {
    method: 'POST',
    body: JSON.stringify({ version: changeCase.version, ...body }),
  };
}

test('intent clarification, proof repair, human decision, and UI state survive restart end to end', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-journey-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let app = await start(root);
  t.after(async () => { if (app.server.listening) await close(app.server); });

  const uiModule = await fetch(`${app.base}/sdlc-view.mjs`);
  assert.equal(uiModule.status, 200);
  assert.match(uiModule.headers.get('content-type'), /^text\/javascript/);

  let changeCase = await request(app.base, '/api/sdlc/cases', {
    method: 'POST',
    body: JSON.stringify({ mode: 'golden', rawIntent: 'Digitize beneficial-owner updates without weakening control.' }),
  }, 201);
  const caseId = changeCase.id;

  changeCase = await request(app.base, `/api/sdlc/cases/${caseId}/clarify`, command(changeCase, 'clarify', {
    idempotencyKey: 'journey-open-scope', actor: 'studio-operator',
    question: 'May this release collect customer payments?', targetField: 'nonGoals',
  }));
  let ui = caseUiModel(changeCase);
  assert.equal(ui.queue.nextAction.type, 'ANSWER_CLARIFICATION');
  assert.deepEqual(ui.clarifications.map((entry) => [entry.status, entry.question, entry.control]), [
    ['OPEN', 'May this release collect customer payments?', 'ANSWER'],
  ]);

  const questionRef = changeCase.clarifications[0].id;
  changeCase = await request(app.base, `/api/sdlc/cases/${caseId}/answer-clarification`, command(changeCase, 'answer-clarification', {
    idempotencyKey: 'journey-answer-scope', actor: changeCase.accountableOwner,
    questionRef, answer: 'Payments are outside this release.',
  }));
  changeCase = await request(app.base, `/api/sdlc/cases/${caseId}/reconcile-clarification`, command(changeCase, 'reconcile-clarification', {
    idempotencyKey: 'journey-reconcile-scope', actor: changeCase.accountableOwner, questionRef,
  }));
  assert.equal(changeCase.intent.revision, 2);
  assert.deepEqual(changeCase.intent.nonGoals, ['Payments are outside this release.']);

  changeCase = await request(app.base, `/api/sdlc/cases/${caseId}/register-proof`, command(changeCase, 'register-proof', {
    idempotencyKey: 'journey-proof', actor: 'designer', required: true,
    criterion: 'An authorized owner update is accepted once and remains auditable.',
  }));
  const proofRef = changeCase.proofs.obligations[0].id;
  changeCase = await request(app.base, `/api/sdlc/cases/${caseId}/record-proof`, command(changeCase, 'record-proof', {
    idempotencyKey: 'journey-failed-proof', actor: 'proof-runner', proofRef, status: 'FAIL',
    summary: 'Duplicate submissions create two audit entries.', observations: ['Two audit entries were observed for one command.'],
  }));
  const failedResult = structuredClone(changeCase.proofs.results[0]);
  ui = caseUiModel(changeCase);
  assert.equal(ui.queue.nextAction.type, 'ROUTE_PROOF_RESULT');
  assert.deepEqual(ui.queue.failedResults.map((entry) => entry.summary), [failedResult.summary]);
  assert.equal(ui.proofs[0].resultStatus, 'FAIL');
  assert.equal(ui.proofs[0].control, 'ROUTE');

  await request(app.base, `/api/sdlc/cases/${caseId}/run`, command(changeCase, 'run', {
    idempotencyKey: 'journey-premature-run', actor: 'orchestrator',
  }), 409);
  assert.equal((await request(app.base, `/api/sdlc/cases/${caseId}`)).currentStage, 'S0');

  changeCase = await request(app.base, `/api/sdlc/cases/${caseId}/route-proof`, command(changeCase, 'route-proof', {
    idempotencyKey: 'journey-route-repair', actor: 'studio-operator', proofRef,
    resultRef: failedResult.id, action: 'REPAIR', reason: 'Make the audit write idempotent and rerun the proof.',
  }));
  const repair = changeCase.proofs.actions[0];
  assert.equal(caseUiModel(changeCase).proofs[0].control, 'RESUME');

  await close(app.server);
  app = await start(root);

  changeCase = await request(app.base, `/api/sdlc/cases/${caseId}`);
  ui = caseUiModel(changeCase);
  assert.equal(ui.queue.nextAction.type, 'RESUME_PROOF_ACTION');
  assert.equal(ui.proofs[0].action.status, 'READY');
  assert.deepEqual(changeCase.proofs.results, [failedResult]);

  changeCase = await request(app.base, `/api/sdlc/cases/${caseId}/resume-proof-action`, command(changeCase, 'resume-proof-action', {
    idempotencyKey: 'journey-resume-repair', actor: repair.owner, actionRef: repair.id,
  }));
  changeCase = await request(app.base, `/api/sdlc/cases/${caseId}/complete-proof-action`, command(changeCase, 'complete-proof-action', {
    idempotencyKey: 'journey-complete-repair', actor: repair.owner, actionRef: repair.id,
    outcome: 'SUCCEEDED', summary: 'The audit write now uses the command idempotency key.',
  }));
  changeCase = await request(app.base, `/api/sdlc/cases/${caseId}/record-proof`, command(changeCase, 'record-proof', {
    idempotencyKey: 'journey-passing-proof', actor: 'proof-runner', proofRef, status: 'PASS',
    summary: 'The repaired flow records one durable audit entry.', observations: ['One entry remained after duplicate submission and restart.'],
  }));
  changeCase = await request(app.base, `/api/sdlc/cases/${caseId}/assess-proofs`, command(changeCase, 'assess-proofs', {
    idempotencyKey: 'journey-assess-proof', actor: 'acceptance-controller',
  }));
  assert.equal(changeCase.proofs.assessments.at(-1).phase, 'ACCEPTED');

  changeCase = await request(app.base, `/api/sdlc/cases/${caseId}/run`, command(changeCase, 'run', {
    idempotencyKey: 'journey-run-to-approval', actor: 'orchestrator',
  }));
  assert.equal(changeCase.status, 'NEEDS_HUMAN');
  assert.equal(changeCase.currentStage, 'S9');
  ui = caseUiModel(changeCase);
  assert.equal(ui.queue.nextAction.type, 'HUMAN_DECISION');
  assert.equal(ui.checkpoint.control, 'APPROVE_RELEASE');
  assert.match(ui.checkpoint.title, /independent release approval/i);
  const checkpointVersion = changeCase.version;
  const runReplay = await request(app.base, `/api/sdlc/cases/${caseId}/run`, command(changeCase, 'run', {
    idempotencyKey: 'journey-run-to-approval', actor: 'orchestrator',
  }));
  assert.equal(runReplay.command.replayed, true);
  assert.equal(runReplay.version, checkpointVersion);

  await request(app.base, `/api/sdlc/cases/${caseId}/approve`, command(changeCase, 'approve', {
    idempotencyKey: 'journey-invalid-self-approval', principal: 'actor-implementation-agent',
    roles: ['release-approver', 'control-owner'],
  }), 400);
  changeCase = await request(app.base, `/api/sdlc/cases/${caseId}/approve`, command(changeCase, 'approve', {
    idempotencyKey: 'journey-human-approval', principal: changeCase.accountableOwner,
    roles: ['release-approver', 'control-owner'],
  }));
  changeCase = await request(app.base, `/api/sdlc/cases/${caseId}/run`, command(changeCase, 'run', {
    idempotencyKey: 'journey-apply-approval', actor: 'orchestrator',
  }));
  assert.equal(changeCase.currentStage, 'S10');
  assert.equal(changeCase.status, 'NEEDS_HUMAN');
  assert.equal(changeCase.artifacts.authority.decision, 'ALLOW');
  assert.equal(changeCase.metrics.humanInterventions, 1);

  const persistedVersion = changeCase.version;
  await close(app.server);
  app = await start(root);

  changeCase = await request(app.base, `/api/sdlc/cases/${caseId}`);
  ui = caseUiModel(changeCase);
  assert.equal(changeCase.version, persistedVersion);
  assert.equal(changeCase.intent.revision, 2);
  assert.deepEqual(changeCase.intent.nonGoals, ['Payments are outside this release.']);
  assert.deepEqual(changeCase.proofs.results[0], failedResult);
  assert.equal(changeCase.proofs.loopCounters[proofRef], 1);
  assert.equal(changeCase.proofs.actions[0].status, 'COMPLETED');
  assert.equal(changeCase.approvals[0].principal, changeCase.accountableOwner);
  assert.ok(changeCase.approvals[0].usedAt);
  assert.equal(changeCase.artifacts.release.status, 'RELEASED');
  assert.deepEqual(ui.proofs[0].history.map((entry) => entry.status), ['FAIL']);
  assert.equal(ui.checkpoint.control, 'RECORD_OBSERVATION');
});
