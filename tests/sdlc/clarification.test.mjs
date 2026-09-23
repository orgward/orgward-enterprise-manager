import assert from 'node:assert/strict';
import test from 'node:test';
import { answerClarification, createChangeCase, normalizeChangeCase, openClarification, reconcileClarification } from '../../src/sdlc/engine.mjs';
import { digest } from '../../src/sdlc/contracts.mjs';

test('clarification answer is durable but changes intent only after owner reconciliation', () => {
  const changeCase = createChangeCase({ mode: 'golden' });
  const openCommand = {
    actor: 'studio-operator', idempotencyKey: 'open-payment',
    question: 'May this release charge customers automatically?', targetField: 'nonGoals',
  };
  const opened = openClarification(changeCase, openCommand);
  assert.equal(opened.replayed, false);
  const question = changeCase.clarifications[0];
  assert.equal(question.status, 'OPEN');
  assert.deepEqual(changeCase.intent.nonGoals, []);

  assert.equal(openClarification(changeCase, openCommand).replayed, true);
  assert.throws(() => openClarification(changeCase, { ...openCommand, question: 'Different question' }), /different command/i);
  assert.equal(changeCase.clarifications.length, 1);
  assert.throws(() => answerClarification(changeCase, { questionRef: question.id, actor: 'someone-else', answer: 'No.' }), /eligible respondent/i);

  answerClarification(changeCase, {
    actor: 'actor-accountable-owner', idempotencyKey: 'answer-payment',
    questionRef: question.id, answer: 'Payment is outside this release.',
  });
  assert.equal(question.status, 'ANSWERED');
  assert.deepEqual(changeCase.intent.nonGoals, []);

  reconcileClarification(changeCase, {
    actor: 'actor-accountable-owner', idempotencyKey: 'reconcile-payment', questionRef: question.id,
  });
  assert.equal(question.status, 'RECONCILED');
  assert.deepEqual(changeCase.intent.nonGoals, ['Payment is outside this release.']);
  assert.equal(changeCase.intent.revision, 2);
  assert.equal(changeCase.intentHistory.length, 2);
  assert.deepEqual(changeCase.intent.openQuestions, []);
  assert.equal(changeCase.intent.contentHash, digest(Object.fromEntries(Object.entries(changeCase.intent).filter(([key]) => key !== 'contentHash'))));
  assert.deepEqual(changeCase.intentHistory.at(-1), changeCase.intent);
  assert.deepEqual(changeCase.events.slice(-3).map((event) => event.type), ['ClarificationOpened', 'ClarificationAnswered', 'ClarificationReconciled']);
});

test('reconciliation rejects stale question context instead of overwriting newer intent', () => {
  const changeCase = createChangeCase({ mode: 'golden' });
  for (const [key, question, targetField, answer] of [
    ['scope', 'Is payment included?', 'nonGoals', 'Payment is excluded.'],
    ['outcome', 'Must updates be visible immediately?', 'desiredOutcomes', 'Updates are visible within one minute.'],
  ]) {
    openClarification(changeCase, { actor: 'studio-operator', idempotencyKey: `open-${key}`, question, targetField });
    answerClarification(changeCase, { actor: 'actor-accountable-owner', idempotencyKey: `answer-${key}`, questionRef: changeCase.clarifications.at(-1).id, answer });
  }
  reconcileClarification(changeCase, { actor: 'actor-accountable-owner', idempotencyKey: 'reconcile-scope', questionRef: changeCase.clarifications[0].id });
  assert.throws(
    () => reconcileClarification(changeCase, { actor: 'actor-accountable-owner', idempotencyKey: 'reconcile-outcome', questionRef: changeCase.clarifications[1].id }),
    /revision conflict/i,
  );
  assert.equal(changeCase.clarifications[1].status, 'ANSWERED');
  assert.equal(changeCase.intent.desiredOutcomes.includes('Updates are visible within one minute.'), false);
});

test('saved cases from before clarification support are upgraded in memory', () => {
  const changeCase = createChangeCase({ mode: 'golden' });
  delete changeCase.clarifications;
  delete changeCase.intentHistory;
  delete changeCase.intent.nonGoals;
  delete changeCase.intent.revision;
  delete changeCase.intent.contentHash;
  normalizeChangeCase(changeCase);
  assert.deepEqual(changeCase.clarifications, []);
  assert.deepEqual(changeCase.proofs, { obligations: [], results: [], assessments: [], actions: [], loopCounters: {} });
  assert.deepEqual(changeCase.intent.nonGoals, []);
  assert.equal(changeCase.intent.revision, 1);
  assert.equal(changeCase.intentHistory.length, 1);
  assert.match(changeCase.intent.contentHash, /^[a-f0-9]{64}$/);
});
