import assert from 'node:assert/strict';
import test from 'node:test';
import { humanTaskActionFailureDisposition } from '../../public/human-task-action-failure.mjs';

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
