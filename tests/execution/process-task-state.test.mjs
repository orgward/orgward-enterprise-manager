import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveProcessTaskState } from '../../public/process-task-state.mjs';

const dependency = { id: 'task-upstream', dependencies: [] };
const task = { id: 'task-downstream', dependencies: ['task-upstream'] };
const runtime = (taskId, status, instanceId = 'instance-a', actorType = 'workload', executionRunId = null) => ({
  taskId, status, planInstanceId: instanceId, actorType, executionRunId,
});

test('process task status and dependency readiness come from canonical mixed human and agent runtimes', () => {
  assert.deepEqual(deriveProcessTaskState(dependency, []), {
    status: 'PLANNED', runtime: null, executionRunId: null, dependenciesSucceeded: true, blockedDependencies: [], canStart: true,
  });
  const requestedAgent = runtime('task-upstream', 'AWAITING_APPROVAL', 'instance-a', 'workload', 'run-agent');
  assert.deepEqual(deriveProcessTaskState(task, [requestedAgent]), {
    status: 'WAITING', runtime: null, executionRunId: null, dependenciesSucceeded: false, blockedDependencies: [], canStart: false,
  });
  assert.equal(deriveProcessTaskState(task, []).status, 'WAITING',
    'dependency-bearing tasks remain waiting in a new process instance');
  const completedHuman = runtime('task-upstream', 'SUCCEEDED', 'instance-a', 'human');
  const ready = deriveProcessTaskState(task, [completedHuman]);
  assert.equal(ready.status, 'PLANNED');
  assert.equal(ready.dependenciesSucceeded, true);
  assert.equal(ready.canStart, true);

  const linkedAgent = runtime('task-downstream', 'APPROVED', 'instance-a', 'workload', 'run-downstream');
  const linked = deriveProcessTaskState(task, [completedHuman, linkedAgent]);
  assert.equal(linked.status, 'APPROVED');
  assert.equal(linked.runtime, linkedAgent);
  assert.equal(linked.executionRunId, 'run-downstream');
  assert.equal(linked.dependenciesSucceeded, true);
  assert.equal(linked.canStart, false);

  assert.equal(deriveProcessTaskState(task, [
    runtime('task-upstream', 'SUCCEEDED', 'instance-a'), runtime('task-upstream', 'FAILED', 'instance-b'),
  ], 'instance-a').canStart, true);
  assert.equal(deriveProcessTaskState(task, [
    runtime('task-upstream', 'SUCCEEDED', 'instance-b'),
  ], 'instance-a').canStart, false);

  const escalated = runtime('task-upstream', 'ESCALATED', 'instance-a', 'human');
  assert.equal(deriveProcessTaskState(dependency, [escalated], 'instance-a').status, 'ESCALATED');
  const waitingOnEscalation = deriveProcessTaskState(task, [escalated], 'instance-a');
  assert.equal(waitingOnEscalation.status, 'WAITING');
  assert.equal(waitingOnEscalation.dependenciesSucceeded, false);
  assert.equal(waitingOnEscalation.canStart, false,
    'an escalated human runtime remains nonterminal and keeps downstream work gated');

  for (const terminalStatus of ['FAILED', 'INTERRUPTED', 'CANCELLED']) {
    const blocked = deriveProcessTaskState(task, [runtime('task-upstream', terminalStatus)], 'instance-a');
    assert.equal(blocked.status, 'BLOCKED');
    assert.deepEqual(blocked.blockedDependencies, [{ taskId: 'task-upstream', status: terminalStatus }]);
    assert.equal(blocked.dependenciesSucceeded, false);
    assert.equal(blocked.canStart, false);
  }
  const anotherInstanceSucceeded = deriveProcessTaskState(task, [
    runtime('task-upstream', 'FAILED', 'instance-a'), runtime('task-upstream', 'SUCCEEDED', 'instance-b'),
  ], 'instance-a');
  assert.equal(anotherInstanceSucceeded.status, 'BLOCKED',
    'a dependency outcome from another process instance cannot unblock this one');
  assert.deepEqual(anotherInstanceSucceeded.blockedDependencies, [{ taskId: 'task-upstream', status: 'FAILED' }]);

  const taskChain = [
    { id: 'task-a', dependencies: [] },
    { id: 'task-b', dependencies: ['task-a'] },
    { id: 'task-c', dependencies: ['task-b'] },
  ];
  const transitivelyBlocked = deriveProcessTaskState(taskChain[2], [runtime('task-a', 'FAILED')], 'instance-a', taskChain);
  assert.equal(transitivelyBlocked.status, 'BLOCKED');
  assert.deepEqual(transitivelyBlocked.blockedDependencies, [{ taskId: 'task-a', status: 'FAILED' }],
    'an unstarted intermediate task carries its failed prerequisite to downstream tasks');
});
