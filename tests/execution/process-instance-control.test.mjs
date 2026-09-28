import assert from 'node:assert/strict';
import test from 'node:test';
import { applySettledProcessInstanceCommands, processInstanceCommandKey, processInstanceControlFailureDisposition, refreshAfterProcessInstanceControl, restoreProcessInstanceControlPresentation, submitProcessInstanceControl } from '../../public/process-instance-control.mjs';

test('definitive process-instance control failures reconcile while uncertain outcomes retain the command', () => {
  for (const status of [400, 401, 403, 404, 409, 422]) {
    assert.equal(processInstanceControlFailureDisposition({ status }), 'reconcile', `HTTP ${status} is definitive`);
  }
  for (const error of [{}, { status: 408 }, { status: 429 }, { status: 500 }, { status: 503 }, { status: 409, retryable: true }]) {
    assert.equal(processInstanceControlFailureDisposition(error), 'retry');
  }
});

function controlsFor(action) {
  const fields = action === 'abandon-unverified'
    ? [{ name: 'reason', value: 'checked reason', disabled: false }, { name: 'evidence', value: 'reviewed source', disabled: false },
      { name: 'acknowledgeDuplicateCostWork', checked: true, disabled: false }]
    : [{ name: 'reason', value: 'control reason', disabled: false }];
  const button = { type: 'submit', textContent: '', disabled: false };
  const form = { elements: [...fields, button], querySelector: (selector) => fields.find((field) => `[name="${field.name}"]` === selector) };
  const status = { textContent: '' };
  return { fields, button, form, status };
}

const actions = ['pause', 'resume', 'cancel', 'abandon-unverified'];

for (const action of actions) {
  test(`${action} freezes submitted controls and retries the same command and payload`, async () => {
    const pendingCommands = new Map();
    const { fields, button, form, status } = controlsFor(action);
    const key = processInstanceCommandKey(action, 'instance-1', 7);
    const originalPayload = { projectId: 'project-1', planInstanceId: 'instance-1', version: 7,
      ...(action === 'pause' || action === 'cancel' ? { reason: 'control reason' } : {}),
      ...(action === 'abandon-unverified' ? { reason: 'checked reason', evidence: ['reviewed source'], acknowledgeDuplicateCostWork: true } : {}) };
    let idCount = 0;
    let calls = [];
    let rejectFirst;
    const first = submitProcessInstanceControl({ action, key, pendingCommands, payload: originalPayload, form, button, status,
      commandIdFactory: () => `cmd-${++idCount}`,
      send: (pending) => { calls.push(structuredClone(pending)); return new Promise((_resolve, reject) => { rejectFirst = reject; }); },
    });
    assert.equal(button.disabled, true);
    assert.ok(fields.every((field) => field.disabled));
    assert.match(status.textContent, /Saving/);
    const inFlightRemount = controlsFor(action);
    restoreProcessInstanceControlPresentation({ action, pending: pendingCommands.get(key), form: inFlightRemount.form,
      button: inFlightRemount.button, status: inFlightRemount.status });
    assert.equal(inFlightRemount.button.disabled, true, 'an in-flight command cannot be resubmitted from a remounted form');
    assert.ok(inFlightRemount.fields.every((field) => field.disabled));
    rejectFirst({ status: 503 });
    assert.equal((await first).kind, 'retry');
    assert.equal(button.disabled, false, 'retry button is enabled');
    assert.ok(fields.every((field) => field.disabled), 'submitted details remain frozen');
    assert.match(status.textContent, /same saved command and details/);

    const remounted = controlsFor(action);
    assert.equal(restoreProcessInstanceControlPresentation({ action, pending: pendingCommands.get(key),
      form: remounted.form, button: remounted.button, status: remounted.status }), true);
    assert.equal(remounted.button.disabled, false, 'a remounted uncertain form exposes only its retry action');
    assert.ok(remounted.fields.every((field) => field.disabled));
    assert.match(remounted.status.textContent, /same saved command and details/);
    if (action === 'abandon-unverified') {
      assert.equal(remounted.fields.find((field) => field.name === 'reason').value, 'checked reason');
      assert.equal(remounted.fields.find((field) => field.name === 'evidence').value, 'reviewed source');
      assert.equal(remounted.fields.find((field) => field.name === 'acknowledgeDuplicateCostWork').checked, true);
    }

    const changedPayload = { ...originalPayload, reason: 'edited after uncertainty', evidence: ['different evidence'], acknowledgeDuplicateCostWork: false };
    const retry = await submitProcessInstanceControl({ action, key, pendingCommands, payload: changedPayload,
      form: remounted.form, button: remounted.button, status: remounted.status,
      commandIdFactory: () => `cmd-${++idCount}`,
      send: async (pending) => { calls.push(structuredClone(pending)); return { status: 'PAUSED' }; },
    });
    assert.equal(retry.kind, 'saved');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].commandId, calls[1].commandId);
    assert.deepEqual(calls[1].payload, originalPayload);
    assert.equal(idCount, 1);
    assert.equal(remounted.button.disabled, true, 'saved form stays locked until refresh replaces it');
    assert.ok(remounted.fields.every((field) => field.disabled));
    assert.match(remounted.status.textContent, /saved/i);
    await refreshAfterProcessInstanceControl({ kind: 'saved', refresh: async () => false, status: remounted.status, pending: pendingCommands.get(key) });
    assert.equal(remounted.button.disabled, true, 'failed refresh does not unlock a saved form');
    assert.match(remounted.status.textContent, /command was saved.*form stays locked/i);
    assert.equal(pendingCommands.get(key).mode, 'saved', 'retain the lock across a failed refresh or remount');
    const staleRemount = controlsFor(action);
    restoreProcessInstanceControlPresentation({ action, pending: pendingCommands.get(key), form: staleRemount.form,
      button: staleRemount.button, status: staleRemount.status });
    assert.equal(staleRemount.button.disabled, true);
    assert.match(staleRemount.status.textContent, /current process state could not be refreshed/i);
    if (action === 'abandon-unverified') {
      assert.deepEqual(calls[1].payload.evidence, ['reviewed source']);
      assert.equal(calls[1].payload.acknowledgeDuplicateCostWork, true);
    }
  });

  test(`${action} keeps a definitively rejected form locked during reconciliation`, async () => {
    const pendingCommands = new Map();
    const { fields, button, form, status } = controlsFor(action);
    const key = processInstanceCommandKey(action, 'instance-1', 8);
    const result = await submitProcessInstanceControl({ action, key, pendingCommands,
      payload: { projectId: 'project-1', planInstanceId: 'instance-1', version: 8 }, form, button, status,
      send: async () => { throw { status: 409 }; },
    });
    assert.equal(result.kind, 'reconcile');
    assert.equal(button.disabled, true);
    assert.ok(fields.every((field) => field.disabled));
    assert.match(status.textContent, /Checking/);
    assert.equal(pendingCommands.get(key).mode, 'reconcile');
    const remounted = controlsFor(action);
    restoreProcessInstanceControlPresentation({ action, pending: pendingCommands.get(key), form: remounted.form,
      button: remounted.button, status: remounted.status });
    assert.equal(remounted.button.disabled, true, 'a remounted conflicted form remains locked pending refresh');
    assert.ok(remounted.fields.every((field) => field.disabled));
    await refreshAfterProcessInstanceControl({ kind: 'reconcile', refresh: async () => { throw new Error('unavailable'); }, status,
      pending: pendingCommands.get(key) });
    assert.equal(button.disabled, true, 'failed conflict refresh does not unlock stale controls');
    assert.match(status.textContent, /action was rejected.*form stays locked/i);
    const staleRemount = controlsFor(action);
    restoreProcessInstanceControlPresentation({ action, pending: pendingCommands.get(key), form: staleRemount.form,
      button: staleRemount.button, status: staleRemount.status });
    assert.equal(staleRemount.button.disabled, true);
    assert.match(staleRemount.status.textContent, /current process state could not be refreshed/i);
  });
}

test('authoritative refresh replaces successful or rejected control forms', async () => {
  for (const kind of ['saved', 'reconcile']) {
    const status = { textContent: '' };
    let refreshed = false;
    assert.equal(await refreshAfterProcessInstanceControl({ kind, status, refresh: async () => { refreshed = true; return true; } }), true);
    assert.equal(refreshed, true);
    assert.equal(status.textContent, '');
  }
  const pending = new Map([
    ['saved', { mode: 'saved' }], ['reconcile', { mode: 'reconcile' }], ['retry', { mode: 'retry' }],
  ]);
  let rerenders = 0;
  assert.equal(applySettledProcessInstanceCommands({ disposition: 'defer-focus', pendingCommands: pending,
    render: () => { rerenders += 1; } }), false);
  assert.deepEqual([...pending.keys()], ['saved', 'reconcile', 'retry'], 'deferred snapshots preserve pending locks');
  assert.equal(applySettledProcessInstanceCommands({ disposition: 'unchanged', pendingCommands: pending,
    render: () => { rerenders += 1; } }), true);
  assert.deepEqual([...pending.keys()], ['retry'], 'authoritative refresh clears settled commands but preserves uncertain retries');
  assert.equal(rerenders, 1, 'an unchanged authoritative snapshot rerenders if it cleared a stale lock');
  assert.equal(applySettledProcessInstanceCommands({ disposition: 'apply', pendingCommands: pending }), false);
});
