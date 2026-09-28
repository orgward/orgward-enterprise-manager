import assert from 'node:assert/strict';
import test from 'node:test';
import { clearSettledLinkedRunAmendment, linkedRunAmendmentFailureDisposition, refreshLinkedRunAmendment,
  restoreLinkedRunAmendment, submitLinkedRunAmendment } from '../../public/linked-run-amendment.mjs';

const originalPayload = {
  objective: 'Prioritize the customer follow-up.',
  requirements: ['Use the approved source.', 'Keep the result concise.'],
  reason: 'Narrow the paused task for the review meeting.',
};

function formFor(values = originalPayload) {
  const fields = [
    { name: 'objective', value: values.objective, disabled: false },
    { name: 'requirements', value: values.requirements.join('\n'), disabled: false },
    { name: 'reason', value: values.reason, disabled: false },
  ];
  const button = { type: 'submit', textContent: '', disabled: false };
  const form = { elements: [...fields, button], querySelector: (selector) => fields.find((field) => `[name="${field.name}"]` === selector) };
  return { fields, button, form, status: { textContent: '' } };
}

test('amendment failures distinguish uncertain retry, conflict reconciliation and definitive validation', () => {
  for (const error of [{}, { status: 408 }, { status: 429 }, { status: 500 }, { retryable: true }]) {
    assert.equal(linkedRunAmendmentFailureDisposition(error), 'retry');
  }
  assert.equal(linkedRunAmendmentFailureDisposition({ status: 409 }), 'reconcile');
  assert.equal(linkedRunAmendmentFailureDisposition({ code: 'VERSION_CONFLICT' }), 'reconcile');
  assert.equal(linkedRunAmendmentFailureDisposition({ status: 422 }), 'discard');
});

test('uncertain amendment freezes fields and replays the exact command ID and payload after remount', async () => {
  const pendingCommands = new Map();
  const first = formFor();
  const key = 'run-1';
  let commandCount = 0;
  const calls = [];
  let rejectFirst;
  const submitted = submitLinkedRunAmendment({ key, pendingCommands, projectId: 'project-1', version: 6,
    payload: originalPayload, ...first,
    commandIdFactory: () => `amend-${++commandCount}`,
    send: (pending) => { calls.push(structuredClone(pending)); return new Promise((_resolve, reject) => { rejectFirst = reject; }); },
  });
  assert.ok(first.fields.every((field) => field.disabled), 'all fields lock before sending');
  assert.equal(first.button.disabled, true);
  assert.match(first.status.textContent, /Saving this instruction revision/);
  rejectFirst({ status: 503 });
  assert.equal((await submitted).kind, 'retry');
  assert.ok(first.fields.every((field) => field.disabled), 'fields stay locked after an uncertain outcome');
  assert.equal(first.button.disabled, false, 'only the retry button is enabled');

  const remounted = formFor({ objective: 'edited', requirements: ['edited'], reason: 'edited' });
  restoreLinkedRunAmendment({ pending: pendingCommands.get(key), ...remounted });
  assert.ok(remounted.fields.every((field) => field.disabled));
  assert.equal(remounted.button.disabled, false);
  assert.deepEqual(remounted.fields.map((field) => field.value), [
    originalPayload.objective, originalPayload.requirements.join('\n'), originalPayload.reason,
  ]);
  const changedPayload = { objective: 'Changed after uncertain send.', requirements: ['Other source.'], reason: 'Changed reason.' };
  const retried = await submitLinkedRunAmendment({ key, pendingCommands, projectId: 'project-1', version: 99,
    payload: changedPayload, ...remounted,
    commandIdFactory: () => `amend-${++commandCount}`,
    send: async (pending) => { calls.push(structuredClone(pending)); return { id: 'run-1', status: 'PAUSED' }; },
  });
  assert.equal(retried.kind, 'saved');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].commandId, calls[1].commandId);
  assert.equal(calls[1].projectId, 'project-1');
  assert.equal(calls[1].version, 6, 'retry retains the original optimistic version');
  assert.deepEqual(calls[1].payload, originalPayload);
  assert.equal(commandCount, 1);
  assert.equal(pendingCommands.get(key).mode, 'saved');
  assert.equal(remounted.button.disabled, true, 'saved state remains locked until a fresh run is loaded');
  assert.ok(remounted.fields.every((field) => field.disabled));
});

test('failed run refresh preserves saved or rejected amendment lock and truthful status across remount', async () => {
  for (const mode of ['saved', 'reconcile']) {
    const pendingCommands = new Map([[`run-${mode}`, { commandId: 'cmd', mode, payload: structuredClone(originalPayload) }]]);
    const form = formFor();
    const status = { textContent: '' };
    const key = `run-${mode}`;
    const result = await refreshLinkedRunAmendment({ key, pendingCommands, status,
      refresh: async () => { throw new Error('temporarily unavailable'); } });
    assert.equal(result.kind, 'refresh-failed');
    assert.equal(pendingCommands.has(key), true);
    const button = { disabled: false, textContent: '' };
    restoreLinkedRunAmendment({ pending: pendingCommands.get(key), form: form.form, button, status });
    assert.equal(button.disabled, true);
    assert.ok(form.fields.every((field) => field.disabled));
    assert.match(status.textContent, /could not be refreshed.*stays locked/i);
  }
});

test('definitive amendment conflict stays locked until current run reconciliation; validation errors unlock', async () => {
  const pendingCommands = new Map();
  const controls = formFor();
  const key = 'run-conflict';
  const conflict = await submitLinkedRunAmendment({ key, pendingCommands, projectId: 'project-1', version: 8,
    payload: originalPayload, ...controls,
    send: async () => { throw { status: 409, message: 'Run version changed.' }; },
  });
  assert.equal(conflict.kind, 'reconcile');
  assert.equal(controls.button.disabled, true);
  assert.ok(controls.fields.every((field) => field.disabled));
  assert.match(controls.status.textContent, /Checking the current run/);
  const reconciliation = await refreshLinkedRunAmendment({ key, pendingCommands, status: controls.status,
    refresh: async () => ({ id: key, status: 'PAUSED', version: 9 }) });
  assert.equal(reconciliation.kind, 'refreshed');
  assert.equal(reconciliation.run.version, 9);
  assert.equal(pendingCommands.has(key), false);
  assert.equal(clearSettledLinkedRunAmendment(pendingCommands, key), false);

  const validationControls = formFor();
  const rejected = await submitLinkedRunAmendment({ key: 'run-invalid', pendingCommands, projectId: 'project-1', version: 8,
    payload: originalPayload,
    ...validationControls, send: async () => { throw { status: 422, message: 'Invalid amendment.' }; } });
  assert.equal(rejected.kind, 'discard');
  assert.equal(validationControls.button.disabled, false);
  assert.ok(validationControls.fields.every((field) => !field.disabled));
  assert.equal(pendingCommands.has('run-invalid'), false);
});

test('an applied selected-run snapshot clears a settled amendment lock', () => {
  const pendingCommands = new Map([['run-1', { mode: 'saved', payload: structuredClone(originalPayload) }]]);
  assert.equal(clearSettledLinkedRunAmendment(pendingCommands, 'run-1'), true);
  assert.equal(pendingCommands.has('run-1'), false);
  pendingCommands.set('run-1', { mode: 'retry', payload: structuredClone(originalPayload) });
  assert.equal(clearSettledLinkedRunAmendment(pendingCommands, 'run-1'), false, 'uncertain retry survives refresh application');
});
