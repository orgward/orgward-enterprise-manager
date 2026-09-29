import assert from 'node:assert/strict';
import test from 'node:test';
import { definitiveHumanTaskStartRejection, humanTaskActionFailureDisposition } from '../../public/human-task-action-failure.mjs';

test('human task action failures reconcile definitive conflicts and preserve uncertain retries', () => {
  assert.equal(humanTaskActionFailureDisposition({ status: 409, retryable: false }), 'reconcile');
  assert.equal(humanTaskActionFailureDisposition({ status: 409, retryable: false, code: 'INVALID_HUMAN_TASK_OUTCOME' }), 'notify');
  assert.equal(humanTaskActionFailureDisposition({ status: 409, retryable: false, code: 'INVALID_HUMAN_TASK_ESCALATION' }), 'notify');
  assert.equal(humanTaskActionFailureDisposition({ status: 500, retryable: true }), 'retry');
  assert.equal(humanTaskActionFailureDisposition({ status: 409, retryable: true }), 'retry');
  assert.equal(humanTaskActionFailureDisposition({ status: 400, retryable: false }), 'notify');
  assert.equal(humanTaskActionFailureDisposition({ retryable: true }), 'retry');
  assert.equal(humanTaskActionFailureDisposition(null), 'notify');
});

test('definitive human task start rejection discards its pending command without clearing uncertain or conflict outcomes', () => {
  assert.equal(definitiveHumanTaskStartRejection({ status: 403, code: 'CROSS_SITE_REQUEST_DENIED', retryable: false }), true);
  assert.equal(definitiveHumanTaskStartRejection({ status: 400, retryable: false }), true);
  assert.equal(definitiveHumanTaskStartRejection({ status: 409, retryable: false }), false);
  assert.equal(definitiveHumanTaskStartRejection({ status: 500, retryable: true }), false);
  assert.equal(definitiveHumanTaskStartRejection({ status: 403, retryable: true }), false);
  assert.equal(definitiveHumanTaskStartRejection({ retryable: false }), false);
});
