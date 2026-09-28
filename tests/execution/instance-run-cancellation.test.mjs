import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cancelProcessTaskExecutionRun,
  cancelProcessTaskExecutionRunByInstance,
} from '../../src/execution/contracts.mjs';

const processTaskRef = {
  processPlanId: 'process-plan-1', revision: 2, planInstanceId: 'instance-1', taskId: 'task-1',
  blueprintId: 'blueprint-1', blueprintVersion: 3, actorId: 'actor-agent', roleId: 'role-agent', actorType: 'workload',
};

test('instance controller can cancel only undispatched linked runs while standalone withdrawal stays requester-only', () => {
  for (const status of ['AWAITING_APPROVAL', 'APPROVED', 'PAUSED']) {
    const run = { id: `run-${status}`, version: 4, status, requestedBy: 'requester', processTaskRef,
      approval: status === 'APPROVED' ? { principal: 'approver' } : null,
      execution: null, events: [{ type: 'ExecutionRequested', data: {} }] };
    assert.throws(() => cancelProcessTaskExecutionRun(structuredClone(run), {
      principal: 'owner', commandId: 'standalone-withdrawal',
    }), /Only the requester/);
    const cancelled = cancelProcessTaskExecutionRunByInstance(run, {
      principal: 'owner', commandId: 'instance-cancel-command', planInstanceId: 'instance-1',
    });
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(cancelled.approval, null);
    assert.equal(cancelled.execution, null);
    assert.equal(cancelled.events.at(-1).type, 'ExecutionCancelledByProcessInstanceController');
    assert.equal(cancelled.events.at(-1).actor, 'owner');
    assert.equal(cancelled.events.at(-1).causationId, 'instance-cancel-command');
    assert.equal(cancelled.events.at(-1).data.priorStatus, status);
    assert.equal(cancelled.events.at(-1).data.planInstanceId, 'instance-1');
  }
  const running = { status: 'RUNNING', processTaskRef };
  assert.throws(() => cancelProcessTaskExecutionRunByInstance(running, {
    principal: 'owner', commandId: 'instance-cancel-command', planInstanceId: 'instance-1',
  }), /Only undispatched/);
  assert.throws(() => cancelProcessTaskExecutionRunByInstance({
    status: 'PAUSED', processTaskRef: { ...processTaskRef, planInstanceId: 'other-instance' },
  }, { principal: 'owner', commandId: 'instance-cancel-command', planInstanceId: 'instance-1' }), /linked to this process instance/);
});
