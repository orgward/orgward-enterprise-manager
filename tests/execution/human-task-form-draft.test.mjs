import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { clearHumanTaskFormDraft, humanTaskFormDraftKey, humanTaskFormDraftScope,
  humanTaskDraftForgetPresentation, readHumanTaskFormDraft, restoreHumanTaskFormDraftControls,
  saveHumanTaskFormDraft } from '../../public/human-task-form-draft.mjs';

const scope = (overrides = {}) => humanTaskFormDraftScope({ tenantId: 'tenant-1', principal: 'worker-1', projectId: 'project-1',
  planId: 'plan-1', revision: 2, planInstanceId: 'instance-1', taskId: 'task-1', ...overrides });

function memoryStorage() {
  const values = new Map();
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key) };
}

test('human task form drafts round trip only for the exact tenant, principal, project and pinned task instance', () => {
  const storage = memoryStorage(); const pinned = scope();
  const values = [{ name: 'result', value: 'succeeded' }, { name: 'evidence', value: 'Inspection started' },
    { name: 'temperature', value: '4.5' }, { name: 'decisionOutcome', value: '' }];
  assert.equal(saveHumanTaskFormDraft(storage, pinned, values), true);
  assert.deepEqual(readHumanTaskFormDraft(storage, pinned), { values });
  assert.equal(readHumanTaskFormDraft(storage, scope({ revision: 3 })), null);
  assert.equal(readHumanTaskFormDraft(storage, scope({ principal: 'worker-2' })), null);
  assert.equal(readHumanTaskFormDraft(storage, scope({ planInstanceId: 'instance-2' })), null);
  assert.notEqual(humanTaskFormDraftKey(pinned), humanTaskFormDraftKey(scope({ revision: 3 })));
  assert.equal(clearHumanTaskFormDraft(storage, pinned), true);
  assert.equal(readHumanTaskFormDraft(storage, pinned), null);
});

test('human task form draft storage rejects oversized, malformed and scope-mismatched data', () => {
  const storage = memoryStorage(); const pinned = scope();
  assert.equal(saveHumanTaskFormDraft(storage, pinned, [{ name: 'evidence', value: 'x'.repeat(20_101) }]), false);
  assert.equal(readHumanTaskFormDraft(storage, pinned), null);
  assert.equal(saveHumanTaskFormDraft(storage, pinned, [{ name: 'evidence', value: 'x'.repeat(18_000) },
    { name: 'notes', value: 'y'.repeat(18_000) }]), false);
  const key = humanTaskFormDraftKey(pinned);
  storage.setItem(key, JSON.stringify({ schemaVersion: 1, scope: scope({ projectId: 'other-project' }), values: [] }));
  assert.equal(readHumanTaskFormDraft(storage, pinned), null);
  storage.setItem(key, '{broken');
  assert.equal(readHumanTaskFormDraft(storage, pinned), null);
});

test('restoring a failed draft dispatches outcome change so success-only controls become optional', () => {
  const decision = { required: true };
  const evidence = { value: '', required: true, dispatchEvent() {} };
  const outputs = { value: 'stale output', disabled: false, dispatchEvent() {} };
  const result = { value: 'succeeded', dispatchEvent() {
    decision.required = this.value === 'succeeded'; evidence.required = this.value === 'succeeded'; outputs.disabled = this.value !== 'succeeded';
  } };
  const controls = new Map([['result', result], ['evidence', evidence], ['temperature', outputs]]);
  const form = { elements: { namedItem: (name) => controls.get(name) ?? null } };
  assert.equal(restoreHumanTaskFormDraftControls(form, [{ name: 'result', value: 'failed' },
    { name: 'evidence', value: 'Work interrupted' }, { name: 'temperature', value: '' }]), true);
  assert.equal(decision.required, false);
  assert.equal(evidence.required, false);
  assert.equal(outputs.disabled, true);
  assert.equal(evidence.value, 'Work interrupted');
});

test('failed local draft removal keeps the forget control and reports that the saved copy may remain', () => {
  const storage = { removeItem() { throw new Error('storage unavailable'); } };
  const removed = clearHumanTaskFormDraft(storage, scope());
  assert.equal(removed, false);
  assert.deepEqual(humanTaskDraftForgetPresentation(removed), {
    buttonHidden: false, status: 'Could not remove the saved browser copy. It may still be restored on this device.',
  });
  assert.deepEqual(humanTaskDraftForgetPresentation(true), {
    buttonHidden: true, status: 'Saved browser copy removed. Current fields remain on screen and are not submitted.',
  });
});

test('completion UI restores and saves only local unsent drafts, then clears them after confirmed completion', async () => {
  const source = await readFile(new URL('../../public/execution.js', import.meta.url), 'utf8');
  assert.match(source, /readHumanTaskFormDraft\(processTaskIntentStorage\(\), draftScope\)/);
  assert.match(source, /restoreHumanTaskFormDraftControls\(form, savedDraft\.values\)/);
  assert.match(source, /form\.addEventListener\('input', persistDraft\)/);
  assert.match(source, /form\.addEventListener\('change', persistDraft\)/);
  assert.match(source, /Saved in this browser only · not submitted to the process runtime/);
  assert.match(source, /clearHumanTaskFormDraft\(processTaskIntentStorage\(\), draftScope\);\s*await refresh\(\)/);
  assert.match(source, /Forget saved browser draft/);
  assert.match(source, /humanTaskDraftForgetPresentation\(clearHumanTaskFormDraft\(processTaskIntentStorage\(\), draftScope\)\)/);
});
