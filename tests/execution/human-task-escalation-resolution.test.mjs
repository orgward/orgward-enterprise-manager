import assert from 'node:assert/strict';
import test from 'node:test';
import { humanTaskEscalationResolutionOptions } from '../../public/human-task-escalation-resolution.mjs';

test('owner resolution choices match a pending instance pause boundary', () => {
  const options = humanTaskEscalationResolutionOptions({ instanceControlStatus: 'PAUSE_REQUESTED', reassignmentAvailable: true });
  assert.equal(options.initialChoiceRequired, true);
  assert.equal(options.resume.disabled, true);
  assert.equal(options.reassign.disabled, true);
  assert.equal(options.succeeded.disabled, false);
  assert.equal(options.failed.disabled, false);
  assert.match(options.pauseMessage, /draining a pause request/);
  assert.match(options.pauseMessage, /succeeded or failed/);
  assert.match(options.pauseMessage, /until the instance is resumed/);
});

test('paused instances require resuming the process before any escalation resolution', () => {
  const options = humanTaskEscalationResolutionOptions({ instanceControlStatus: 'PAUSED', reassignmentAvailable: true });
  assert.equal(options.initialChoiceRequired, true);
  assert.equal(options.resume.disabled, true);
  assert.equal(options.reassign.disabled, true);
  assert.equal(options.succeeded.disabled, true);
  assert.equal(options.failed.disabled, true);
  assert.match(options.pauseMessage, /Resume the process instance before a project owner resolves/);
});

test('active instances retain eligible owner resolution actions and unavailable targets stay disabled', () => {
  const eligible = humanTaskEscalationResolutionOptions({ instanceControlStatus: 'ACTIVE', reassignmentAvailable: true });
  assert.equal(eligible.resume.disabled, false);
  assert.equal(eligible.reassign.disabled, false);
  assert.equal(eligible.pauseMessage, '');
  assert.equal(eligible.initialChoiceRequired, false);
  assert.equal(eligible.succeeded.disabled, false);
  assert.equal(eligible.failed.disabled, false);
  const noTarget = humanTaskEscalationResolutionOptions({ instanceControlStatus: 'ACTIVE', reassignmentAvailable: false });
  assert.equal(noTarget.resume.disabled, false);
  assert.equal(noTarget.reassign.disabled, true);
});
