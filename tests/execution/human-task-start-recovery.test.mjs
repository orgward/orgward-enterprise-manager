import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptHumanTaskStart, clearHumanTaskStart, humanTaskStartCommandKey,
  humanTaskStartPresentation, humanTaskStartReconciled, humanTaskStartStorageKey,
  readHumanTaskStart, restoreHumanTaskStarts, saveHumanTaskStart } from '../../public/human-task-start-recovery.mjs';

function memoryStorage() {
  const values = new Map();
  return { get length() { return values.size; }, key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key) };
}

const scope = { tenantId: 'tenant-a', principal: 'alice', projectId: 'project-one',
  planId: 'plan-one', revision: 3, taskId: 'checkpoint' };
const runtime = { projectId: scope.projectId, processPlanId: scope.planId, revision: scope.revision,
  planInstanceId: 'instance-created', taskId: scope.taskId, status: 'IN_PROGRESS', assignedToCurrentPrincipal: true };

test('uncertain new-instance start persists and reloads the exact task command without instance attribution', () => {
  const storage = memoryStorage();
  const requestScope = { ...scope, planInstanceId: 'new' };
  const key = humanTaskStartStorageKey(requestScope);
  const commandKey = humanTaskStartCommandKey(requestScope);
  const pending = { commandId: 'human-task-start:uncertain-1', status: 'pending', ...scope,
    payload: { projectId: scope.projectId, planId: scope.planId, revision: scope.revision, taskId: scope.taskId } };
  saveHumanTaskStart(storage, key, pending);

  const reloaded = restoreHumanTaskStarts(storage, { tenantId: scope.tenantId, principal: scope.principal,
    projectId: scope.projectId, planId: scope.planId, revision: scope.revision });
  assert.deepEqual(reloaded, [{ key, commandKey, pending }]);
  assert.deepEqual(restoreHumanTaskStarts(storage, { tenantId: 'tenant-b', principal: scope.principal,
    projectId: scope.projectId, planId: scope.planId, revision: scope.revision }), [],
  'another tenant cannot adopt this pending start');
  assert.deepEqual(restoreHumanTaskStarts(storage, { tenantId: scope.tenantId, principal: 'mallory',
    projectId: scope.projectId, planId: scope.planId, revision: scope.revision }), [],
  'another principal cannot adopt this pending start');
  assert.equal(readHumanTaskStart(storage, key).commandId, pending.commandId);
  assert.deepEqual(readHumanTaskStart(storage, key).payload, pending.payload,
    'the retry keeps the original new-instance payload after remount');
  assert.equal(humanTaskStartReconciled(pending, { ...scope, instances: [runtime] }), false,
    'an uncertain response cannot be attributed to any matching-looking instance before command replay returns its instance');
  assert.deepEqual(humanTaskStartPresentation(pending, { displayedInstanceId: 'another-instance' }), {
    buttonDisabled: false, buttonLabel: 'Retry saved new-instance start',
    status: 'This uncertain start was submitted for a new process instance. It is not tied to the instance currently displayed; retry sends the same command and task references.',
  });
  assert.deepEqual(humanTaskStartPresentation(pending, { submitting: true }), {
    buttonDisabled: true, buttonLabel: 'Starting assigned human task…',
    status: 'Starting the saved task command. Its command and task references are locked.',
  });
});

test('accepted start survives refresh failure and clears only for its exact in-progress assigned runtime', () => {
  const storage = memoryStorage();
  const requestScope = { ...scope, planInstanceId: 'new' };
  const key = humanTaskStartStorageKey(requestScope);
  const pending = { commandId: 'human-task-start:saved-1', status: 'pending', ...scope,
    payload: { projectId: scope.projectId, planId: scope.planId, revision: scope.revision, taskId: scope.taskId } };
  saveHumanTaskStart(storage, key, pending);
  const accepted = acceptHumanTaskStart(pending, runtime);
  assert.ok(accepted);
  assert.equal(accepted.commandId, pending.commandId);
  assert.deepEqual(accepted.payload, pending.payload, 'accepting does not add the generated instance to the original payload');
  assert.deepEqual(accepted.accepted, { projectId: scope.projectId, planId: scope.planId,
    revision: scope.revision, planInstanceId: runtime.planInstanceId, taskId: scope.taskId });
  saveHumanTaskStart(storage, key, accepted);

  const afterFailedRefresh = readHumanTaskStart(storage, key);
  assert.equal(afterFailedRefresh.status, 'accepted');
  assert.equal(humanTaskStartReconciled(afterFailedRefresh, { ...scope, instances: [] }), false,
    'a successful POST followed by a failed refresh retains the receipt');
  assert.equal(humanTaskStartReconciled(afterFailedRefresh, { ...scope,
    instances: [{ ...runtime, planInstanceId: 'different-instance' }] }), false);
  assert.equal(humanTaskStartReconciled(afterFailedRefresh, { ...scope,
    instances: [{ ...runtime, taskId: 'different-task' }] }), false);
  assert.equal(humanTaskStartReconciled(afterFailedRefresh, { ...scope,
    instances: [{ ...runtime, status: 'ESCALATED' }] }), false);
  assert.equal(humanTaskStartReconciled(afterFailedRefresh, { ...scope,
    instances: [{ ...runtime, assignedToCurrentPrincipal: false }] }), false,
  'reconciliation requires the current principal to remain assigned');
  assert.equal(humanTaskStartReconciled(afterFailedRefresh, { ...scope, tenantId: 'tenant-b', instances: [runtime] }), false);
  assert.equal(humanTaskStartReconciled(afterFailedRefresh, { ...scope, principal: 'mallory', instances: [runtime] }), false);
  assert.equal(humanTaskStartReconciled(afterFailedRefresh, { ...scope, instances: [runtime] }), true);
  clearHumanTaskStart(storage, key);
  assert.equal(readHumanTaskStart(storage, key), null);
});

test('start response validation rejects mismatched task refs and caller assignment before persisting acceptance', () => {
  const pending = { commandId: 'human-task-start:response-1', status: 'pending', ...scope,
    payload: { projectId: scope.projectId, planId: scope.planId, revision: scope.revision, taskId: scope.taskId } };
  assert.equal(acceptHumanTaskStart(pending, { ...runtime, projectId: 'project-other' }), null);
  assert.equal(acceptHumanTaskStart(pending, { ...runtime, processPlanId: 'plan-other' }), null);
  assert.equal(acceptHumanTaskStart(pending, { ...runtime, revision: 4 }), null);
  assert.equal(acceptHumanTaskStart(pending, { ...runtime, taskId: 'other-task' }), null);
  assert.equal(acceptHumanTaskStart(pending, { ...runtime, assignedToCurrentPrincipal: false }), null);
  assert.equal(acceptHumanTaskStart(pending, { ...runtime, status: 'PLANNED' }), null);
});
