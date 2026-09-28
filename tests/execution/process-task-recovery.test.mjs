import assert from 'node:assert/strict';
import test from 'node:test';
import { blockedProcessTaskRecoveryCopy, processTaskRecoveryAction, selectFreshProcessTaskInstance }
  from '../../public/process-task-recovery.mjs';

test('unknown provider delivery asks for reconciliation before any retry decision', () => {
  const copy = blockedProcessTaskRecoveryCopy({ blockedTitles: ['Send proposal (interrupted)'], uncertainDelivery: true });
  assert.match(copy, /unverified external delivery/);
  assert.match(copy, /Reconcile the provider outcome before deciding whether to start a new process instance/);
  assert.doesNotMatch(copy, /retry the workflow/i);
});

test('ordinary failed local work keeps new-instance recovery instructions', () => {
  const copy = blockedProcessTaskRecoveryCopy({ blockedTitles: ['Local verification (failed)'] });
  assert.match(copy, /Start a new process instance from the first task to retry the workflow/);
  assert.match(copy, /saved outcomes and evidence in this instance remain available/);
});

test('a fresh-instance choice is offered only for terminal blockers with a current reusable plan', () => {
  const blockedDependencies = [{ taskId: 'task-local', status: 'FAILED' }];
  const action = processTaskRecoveryAction({ blockedDependencies, canStartNewInstance: true });
  assert.deepEqual(action, { kind: 'select-new-instance', label: 'Choose a new process instance' });
  assert.equal(processTaskRecoveryAction({ blockedDependencies, uncertainDelivery: true,
    canStartNewInstance: true }).kind, 'reconcile');
  assert.equal(processTaskRecoveryAction({ blockedDependencies, canStartNewInstance: false }).kind, 'unavailable');
  assert.equal(processTaskRecoveryAction({ blockedDependencies: [{ taskId: 'task-running', status: 'IN_PROGRESS' },
    { taskId: 'task-waiting', status: 'WAITING' }], canStartNewInstance: true }), null);
});

test('selecting fresh recovery changes only the selected instance and preserves prior instance selections', () => {
  const selectedInstances = new Map([['plan-a\n1', 'old-instance-a'], ['plan-b\n1', 'old-instance-b']]);
  const runtimes = [{ planInstanceId: 'old-instance-a', status: 'FAILED' }];
  assert.equal(selectFreshProcessTaskInstance(selectedInstances, 'plan-a\n1', { kind: 'unavailable' }), false);
  assert.equal(selectedInstances.get('plan-a\n1'), 'old-instance-a');
  assert.equal(selectFreshProcessTaskInstance(selectedInstances, 'plan-a\n1', {
    kind: 'select-new-instance', label: 'Choose a new process instance',
  }), true);
  assert.equal(selectedInstances.get('plan-a\n1'), 'new');
  assert.equal(selectedInstances.get('plan-b\n1'), 'old-instance-b');
  assert.deepEqual(runtimes, [{ planInstanceId: 'old-instance-a', status: 'FAILED' }],
    'choosing a new instance does not mutate old durable results');
});
