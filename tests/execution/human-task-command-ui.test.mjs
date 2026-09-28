import assert from 'node:assert/strict';
import test from 'node:test';
import { submitHumanTaskCommand } from '../../public/human-task-command-ui.mjs';

const actions = [
  ['complete', 'Retry saved completion', 'completion'],
  ['escalate', 'Retry saved escalation', 'escalation'],
  ['resolve', 'Retry saved resolution', 'resolution'],
];

for (const [action, retryLabel, noun] of actions) {
  test(`${action} uncertainty freezes displayed details and retry resends the same saved command`, async () => {
    const key = `${action}:plan:instance:task`;
    const pendingCommands = new Map();
    const fields = [{ disabled: false }, { disabled: false }];
    const form = { elements: fields };
    const button = { disabled: false, textContent: `Initial ${action}` };
    const status = { textContent: '' };
    const submitted = [];
    let nextError = Object.assign(new Error('response lost'), { retryable: true });
    const send = async (pending) => {
      submitted.push(structuredClone({ commandId: pending.commandId, payload: pending.payload }));
      if (nextError) {
        const failure = nextError;
        nextError = null;
        throw failure;
      }
      return { saved: true };
    };
    const originalPayload = { taskId: 'task', evidence: [`${action} proof`], reason: `${action} reason` };
    const first = await submitHumanTaskCommand({ action, key, pendingCommands, payload: originalPayload,
      form, button, status, send, commandIdFactory: () => `cmd-${action}` });

    assert.equal(first.kind, 'retry');
    assert.equal(button.disabled, false, 'the retry control remains usable');
    assert.equal(button.textContent, retryLabel);
    assert.equal(fields.every((field) => field.disabled), true, 'all fields are frozen while outcome is uncertain');
    assert.match(status.textContent, new RegExp(`the ${noun} result is uncertain`, 'i'));
    assert.match(status.textContent, /retry sends the same saved action and evidence/i);

    // Even a stale caller value cannot replace the original command payload.
    originalPayload.evidence[0] = 'changed after uncertainty';
    originalPayload.reason = 'changed after uncertainty';
    const retried = await submitHumanTaskCommand({ action, key, pendingCommands,
      payload: { taskId: 'task', evidence: ['changed again'], reason: 'changed again' },
      form, button, status, send, commandIdFactory: () => `wrong-new-${action}` });

    assert.equal(retried.kind, 'saved');
    assert.equal(submitted.length, 2);
    assert.deepEqual(submitted[1], submitted[0], 'retry preserves both command ID and exact persisted payload');
    assert.deepEqual(submitted[0], {
      commandId: `cmd-${action}`,
      payload: { taskId: 'task', evidence: [`${action} proof`], reason: `${action} reason` },
    });
    assert.equal(pendingCommands.has(key), false);
    assert.equal(fields.every((field) => field.disabled), true, 'successful fields stay locked until the parent refreshes the task');
    assert.equal(button.disabled, true);
    assert.equal(button.textContent, `Saved ${noun}`);
    assert.match(status.textContent, /saved\. Refreshing checkpoint status/i);
  });
}

for (const [action] of actions) {
  test(`${action} locks fields and announces saving before the first request starts`, async () => {
    const pendingCommands = new Map();
    const fields = [{ disabled: false, value: 'original' }, { disabled: false, value: 'proof' }];
    const form = { elements: fields };
    const button = { disabled: false, textContent: 'Submit' };
    const status = { textContent: '' };
    let startSend;
    let finishSend;
    const enteredSend = new Promise((resolve) => { startSend = resolve; });
    const heldSend = new Promise((resolve) => { finishSend = resolve; });
    const request = submitHumanTaskCommand({ action, key: `${action}:in-flight`, pendingCommands,
      payload: { detail: 'displayed before send' }, form, button, status,
      send: async () => { startSend(); await heldSend; return { ok: true }; },
      commandIdFactory: () => `cmd-${action}-in-flight` });

    await enteredSend;
    assert.equal(fields.every((field) => field.disabled), true);
    assert.equal(button.disabled, true);
    assert.match(status.textContent, /form values are locked while the result is checked/i);
    for (const field of fields) {
      if (!field.disabled) field.value = 'attempted edit while sending';
    }
    assert.deepEqual(fields.map((field) => field.value), ['original', 'proof']);
    finishSend();
    assert.equal((await request).kind, 'saved');
    assert.equal(fields.every((field) => field.disabled), true, 'fields remain frozen until refresh replaces the form');
    assert.equal(button.disabled, true);
  });
}

test('definitive human task conflicts discard the pending command and unlock the form for reconciliation', async () => {
  const pendingCommands = new Map();
  const form = { elements: [{ disabled: false }] };
  const button = { disabled: false, textContent: 'Complete human task' };
  const status = { textContent: '' };
  const key = 'complete:plan:instance:task';
  const outcome = await submitHumanTaskCommand({ action: 'complete', key, pendingCommands,
    payload: { evidence: ['original'] }, form, button, status,
    send: async () => { throw Object.assign(new Error('state conflict'), { status: 409 }); },
    commandIdFactory: () => 'conflicted-command' });
  assert.equal(outcome.kind, 'reconcile');
  assert.equal(pendingCommands.has(key), false);
  assert.equal(form.elements[0].disabled, false);
  assert.equal(button.textContent, 'Complete human task');
  assert.equal(status.textContent, '');
});
