import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptProcessTaskRequest, clearPendingProcessTaskRequest, findPendingProcessTaskRequest,
  processTaskRequestPresentation, processTaskRequestReconciled, processTaskRequestScopeMatches, processTaskRequestStorageKey,
  readPendingProcessTaskRequest, reconciledSavedProcessTaskRequests, savePendingProcessTaskRequest } from '../../public/process-task-request.mjs';

function memoryStorage() {
  const values = new Map();
  return { get length() { return values.size; }, key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}

test('pending task request survives a page reload and keeps repository snapshot identity for replay', () => {
  const storage = memoryStorage();
  const key = processTaskRequestStorageKey({ tenantId: 'tenant-a', principal: 'oidc:alice', projectId: 'project-one',
    planId: 'plan-one', revision: 3, planInstanceId: null, taskId: 'build' });
  const pending = { commandId: 'process-task-request:request-1', payload: {
    projectId: 'project-one', planId: 'plan-one', revision: 3, taskId: 'build', profileId: 'local-runner',
    repositoryId: 'repo-one', snapshotDigest: 'a'.repeat(64),
  } };
  savePendingProcessTaskRequest(storage, key, pending);
  assert.deepEqual(readPendingProcessTaskRequest(storage, key), pending,
    'a newly loaded page retries with the same command and pinned repository digest');
  clearPendingProcessTaskRequest(storage, key);
  assert.equal(readPendingProcessTaskRequest(storage, key), null, 'a confirmed receipt clears the pending intent');
});

test('task request intent keys isolate tenant, principal, project, plan revision, instance, and task', () => {
  const base = { tenantId: 'tenant-a', principal: 'alice', projectId: 'project-one', planId: 'plan-one', revision: 3, taskId: 'build' };
  const key = processTaskRequestStorageKey({ ...base, planInstanceId: 'instance-one' });
  for (const patch of [
    { tenantId: 'tenant-b' }, { principal: 'bob' }, { projectId: 'project-two' }, { planId: 'plan-two' },
    { revision: 4 }, { planInstanceId: 'instance-two' }, { taskId: 'test' },
  ]) assert.notEqual(processTaskRequestStorageKey({ ...base, planInstanceId: 'instance-one', ...patch }), key);
});

test('task request inputs freeze for exact uncertain retry and expose only the retry action', () => {
  const storage = memoryStorage();
  const key = processTaskRequestStorageKey({ tenantId: 'tenant-a', principal: 'alice', projectId: 'project-one',
    planId: 'plan-one', revision: 3, planInstanceId: null, taskId: 'build' });
  const pending = { commandId: 'process-task-request:uncertain-1', tenantId: 'tenant-a', principal: 'alice', payload: {
    projectId: 'project-one', planId: 'plan-one', revision: 3, taskId: 'build', profileId: 'local-runner',
    repositoryId: 'repo-one', snapshotDigest: 'a'.repeat(64),
  } };
  savePendingProcessTaskRequest(storage, key, pending);
  const retry = readPendingProcessTaskRequest(storage, key);
  assert.deepEqual(retry, pending, 'retry uses the original command ID and submitted profile/repository payload');
  assert.deepEqual(processTaskRequestPresentation(retry), {
    locked: true, buttonDisabled: false, buttonLabel: 'Retry same approval request',
    status: 'The request result is uncertain. Retry sends the same saved command and selections.',
  });
  assert.deepEqual(processTaskRequestPresentation(retry, { submitting: true }), {
    locked: true, buttonDisabled: true, buttonLabel: 'Submitting approval request…',
    status: 'Submitting the saved task approval request.',
  }, 'fields and submit action stay locked while the transport is in flight');
});

test('uncertain new-instance intent recovers by original command and payload from a concrete-instance view', () => {
  const storage = memoryStorage();
  const scope = { tenantId: 'tenant-a', principal: 'alice', projectId: 'project-one', planId: 'plan-one', revision: 3, taskId: 'build' };
  const originalKey = processTaskRequestStorageKey({ ...scope, planInstanceId: null });
  const original = { commandId: 'process-task-request:new-uncertain-1', ...scope, payload: {
    projectId: scope.projectId, planId: scope.planId, revision: scope.revision, taskId: scope.taskId,
    profileId: 'local-runner', repositoryId: 'repo-one', snapshotDigest: 'b'.repeat(64),
  } };
  savePendingProcessTaskRequest(storage, originalKey, original);

  for (const currentInstance of ['instance-created-before-lost-response', 'another-visible-instance']) {
    const viewKey = processTaskRequestStorageKey({ ...scope, planInstanceId: currentInstance });
    const recovered = findPendingProcessTaskRequest(storage, { ...scope, planInstanceId: currentInstance, key: viewKey });
    assert.deepEqual(recovered, { key: originalKey, pending: original },
      'a concrete view recovers the original new-instance command instead of creating an instance-specific command');
    assert.equal(recovered.pending.commandId, original.commandId);
    assert.deepEqual(recovered.pending.payload, original.payload,
      'replay remains the original new-instance payload with no arbitrary instance attached');
    assert.deepEqual(processTaskRequestPresentation(recovered.pending, { recoveringNewInstance: true }), {
      locked: true, buttonDisabled: false, buttonLabel: 'Retry saved new-instance request',
      status: 'This uncertain request was originally submitted to create a new process instance. It is not tied to the instance currently displayed; retry sends the same saved command and selections.',
    });
  }
});

test('accepted request remains locked after refresh failure and clears only on matching authoritative run and task snapshots', () => {
  const storage = memoryStorage();
  const scope = { tenantId: 'tenant-a', principal: 'alice', projectId: 'project-one', planId: 'plan-one', revision: 3, taskId: 'build' };
  const key = processTaskRequestStorageKey({ ...scope, planInstanceId: null });
  const pending = { commandId: 'process-task-request:saved-1', ...scope, payload: {
    projectId: scope.projectId, planId: scope.planId, revision: scope.revision, taskId: scope.taskId, profileId: 'local-runner',
  } };
  const acceptedRun = { id: 'execution-run-one', tenantId: scope.tenantId, projectId: scope.projectId,
    processTaskRef: { processPlanId: scope.planId, revision: scope.revision, planInstanceId: 'instance-one', taskId: scope.taskId } };
  const accepted = acceptProcessTaskRequest(pending, acceptedRun);
  assert.ok(accepted);
  assert.equal(accepted.commandId, pending.commandId);
  assert.deepEqual(accepted.payload, pending.payload, 'accepted state retains the exact replay payload');
  savePendingProcessTaskRequest(storage, key, accepted);
  assert.equal(processTaskRequestReconciled(readPendingProcessTaskRequest(storage, key), { runs: [], instances: [] }), false,
    'a successful response without an authoritative refresh leaves the receipt pending');
  assert.deepEqual(reconciledSavedProcessTaskRequests(storage, { tenantId: scope.tenantId, principal: 'alice',
    projectId: scope.projectId, runs: [], instances: [] }), [], 'reload does not clear an accepted receipt when refreshed state is incomplete');
  assert.equal(processTaskRequestPresentation(readPendingProcessTaskRequest(storage, key)).locked, true);

  const runtime = { projectId: scope.projectId, processPlanId: scope.planId, revision: scope.revision,
    planInstanceId: 'instance-one', taskId: scope.taskId, executionRunId: acceptedRun.id };
  assert.equal(processTaskRequestReconciled(accepted, { runs: [{ ...acceptedRun, processTaskRef: { ...acceptedRun.processTaskRef, taskId: 'other' } }], instances: [runtime] }), false);
  assert.equal(processTaskRequestReconciled(accepted, { runs: [{ ...acceptedRun, tenantId: 'tenant-b' }], instances: [runtime] }), false);
  assert.equal(processTaskRequestReconciled(accepted, { runs: [acceptedRun], instances: [{ ...runtime, planInstanceId: 'other-instance' }] }), false);
  assert.equal(processTaskRequestReconciled(accepted, { runs: [acceptedRun], instances: [runtime] }), true,
    'a later authorized snapshot containing the exact linked run and task reconciles the receipt');
  assert.deepEqual(reconciledSavedProcessTaskRequests(storage, { tenantId: scope.tenantId, principal: 'alice',
    projectId: scope.projectId, runs: [acceptedRun], instances: [runtime] }), [{ key, pending: accepted }],
  'the first authorized snapshot after reload can reconcile the persisted accepted receipt');

  const concreteKey = processTaskRequestStorageKey({ ...scope, planInstanceId: 'instance-one' });
  assert.deepEqual(findPendingProcessTaskRequest(storage, { ...scope, planInstanceId: 'instance-one', key: concreteKey }),
    { key, pending: accepted }, 'a remounted concrete-instance view finds the original new-instance request');
  clearPendingProcessTaskRequest(storage, key);
  assert.equal(findPendingProcessTaskRequest(storage, { ...scope, planInstanceId: 'instance-one', key: concreteKey }), null);
});

test('recovery lookup cannot adopt another tenant or principal pending request', () => {
  const storage = memoryStorage();
  const request = { tenantId: 'tenant-a', principal: 'alice', projectId: 'project-shared-id', planId: 'plan-one', revision: 3, taskId: 'build' };
  const key = processTaskRequestStorageKey({ ...request, planInstanceId: null });
  const pending = { commandId: 'process-task-request:isolated-1', ...request,
    payload: { projectId: request.projectId, planId: request.planId, revision: request.revision, taskId: request.taskId } };
  const accepted = acceptProcessTaskRequest(pending, { id: 'execution-run-a', tenantId: request.tenantId,
    projectId: request.projectId, processTaskRef: { processPlanId: request.planId, revision: request.revision,
      planInstanceId: 'instance-a', taskId: request.taskId } });
  savePendingProcessTaskRequest(storage, key, accepted);
  for (const other of [
    { ...request, tenantId: 'tenant-b', principal: 'alice' },
    { ...request, principal: 'mallory' },
  ]) {
    const otherKey = processTaskRequestStorageKey({ ...other, planInstanceId: 'instance-a' });
    assert.equal(findPendingProcessTaskRequest(storage, { ...other, planInstanceId: 'instance-a', key: otherKey }), null,
      'pending recovery remains scoped to its original tenant and principal');
    assert.deepEqual(reconciledSavedProcessTaskRequests(storage, { tenantId: other.tenantId,
      principal: other.principal, projectId: other.projectId, runs: [], instances: [] }), [],
    'reload reconciliation cannot adopt another tenant or principal receipt');
  }
});

test('pending agent request recovery matches its exact tenant, caller, plan revision, task and instance', () => {
  const scope = { tenantId: 'tenant-a', principal: 'oidc:editor', projectId: 'project-agent-flow',
    planId: 'process-plan-agent-flow', revision: 4, taskId: 'task-flow-review', planInstanceId: 'instance-agent-flow' };
  const pending = { commandId: 'process-task-request:agent-flow-1', tenantId: scope.tenantId, principal: scope.principal,
    payload: { projectId: scope.projectId, planId: scope.planId, revision: scope.revision,
      taskId: scope.taskId, planInstanceId: scope.planInstanceId, profileId: 'fixed-local-agent' } };
  assert.equal(processTaskRequestScopeMatches(pending, scope), true);
  for (const patch of [
    { tenantId: 'tenant-other' }, { principal: 'oidc:other' }, { projectId: 'project-other' },
    { planId: 'process-plan-other' }, { revision: 3 }, { taskId: 'task-flow-other' }, { planInstanceId: 'instance-other' },
  ]) assert.equal(processTaskRequestScopeMatches(pending, { ...scope, ...patch }), false,
    `saved request cannot be recovered in ${JSON.stringify(patch)} scope`);
  const legacy = { commandId: 'process-task-request:legacy-agent', payload: {
    projectId: scope.projectId, planId: scope.planId, revision: scope.revision, taskId: scope.taskId,
  } };
  assert.equal(processTaskRequestScopeMatches(legacy, { ...scope, planInstanceId: undefined }), true,
    'legacy pending request envelopes retain their documented unscoped compatibility');
  assert.equal(processTaskRequestScopeMatches(legacy, scope), true,
    'a legacy uncertain new-instance request can still be retried after an instance ID was created');
  const acceptedNewIntent = { ...legacy, tenantId: scope.tenantId, principal: scope.principal, status: 'accepted',
    acceptedRunId: 'execution-run-flow-agent', acceptedProcessTaskRef: { tenantId: scope.tenantId, principal: scope.principal,
      projectId: scope.projectId, processPlanId: scope.planId, revision: scope.revision, taskId: scope.taskId,
      planInstanceId: scope.planInstanceId } };
  assert.equal(processTaskRequestScopeMatches(acceptedNewIntent, scope), true,
    'an accepted original new-instance intent matches only its confirmed created instance');
  assert.equal(processTaskRequestScopeMatches(acceptedNewIntent, { ...scope, planInstanceId: 'instance-other' }), false,
    'an accepted new-instance intent cannot be adopted by another displayed instance');
});
