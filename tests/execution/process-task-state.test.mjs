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
    status: 'PLANNED', runtime: null, executionRunId: null, dependenciesSucceeded: true, canStart: true,
  });
  const requestedAgent = runtime('task-upstream', 'AWAITING_APPROVAL', 'instance-a', 'workload', 'run-agent');
  assert.deepEqual(deriveProcessTaskState(task, [requestedAgent]), {
    status: 'WAITING', runtime: null, executionRunId: null, dependenciesSucceeded: false, canStart: false,
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
});
