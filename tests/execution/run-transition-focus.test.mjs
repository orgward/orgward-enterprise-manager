import assert from 'node:assert/strict';
import test from 'node:test';
import { isRunActionKeyboardActivation, restoreRunTransitionFocus } from '../../public/run-transition-focus.mjs';

test('recognizes a trusted keyboard click only while its button owns focus', () => {
  const button = {};
  const documentRef = { activeElement: button };
  assert.equal(isRunActionKeyboardActivation({ isTrusted: true, detail: 0 }, button, documentRef), true);
  assert.equal(isRunActionKeyboardActivation({ isTrusted: true, detail: 1 }, button, documentRef), false);
  assert.equal(isRunActionKeyboardActivation({ isTrusted: false, detail: 0 }, button, documentRef), false);
  assert.equal(isRunActionKeyboardActivation({ isTrusted: true, detail: 0 }, {}, documentRef), false);
});

function fixture({
  action = 'approve',
  runStatus = 'APPROVED',
  keyboardInvoked = true,
  focusMoved = false,
  transitionSucceeded = true,
  controlConnected = false,
  activeTarget = 'body',
  targetExists = true,
} = {}) {
  const body = {};
  const other = {};
  const documentRef = { body, activeElement: activeTarget === 'body' ? body : other };
  let focusOptions = null;
  let scrollOptions = null;
  let searches = 0;
  const target = targetExists ? {
    focus(options) { focusOptions = options; documentRef.activeElement = target; },
    scrollIntoView(options) { scrollOptions = options; },
  } : null;
  const result = restoreRunTransitionFocus({
    initiatingControl: { isConnected: controlConnected },
    documentRef,
    findTarget: () => { searches += 1; return target; },
    action,
    runStatus,
    keyboardInvoked,
    focusMoved,
    transitionSucceeded,
  });
  return { result, body, other, documentRef, target, focusOptions, scrollOptions, searches };
}

test('hands keyboard approval focus to Execute after the approved view renders', () => {
  const result = fixture();
  assert.equal(result.result, true);
  assert.equal(result.documentRef.activeElement, result.target);
  assert.deepEqual(result.scrollOptions, { block: 'nearest' });
  assert.deepEqual(result.focusOptions, { preventScroll: true });
});

test('hands keyboard execution focus to terminal run status', () => {
  const result = fixture({ action: 'execute', runStatus: 'SUCCEEDED' });
  assert.equal(result.result, true);
  assert.equal(result.documentRef.activeElement, result.target);
});

test('hands keyboard re-entry focus to the selected run status after linked-run navigation', () => {
  const result = fixture({ action: 'open-run', runStatus: 'SUCCEEDED' });
  assert.equal(result.result, true);
  assert.equal(result.documentRef.activeElement, result.target);
});

test('does not hand off focus when the action failed or its refreshed state is not the transition target', () => {
  const failedAction = fixture({ transitionSucceeded: false });
  assert.equal(failedAction.result, false);
  assert.equal(failedAction.searches, 0);

  const approvalNotReady = fixture({ runStatus: 'AWAITING_APPROVAL' });
  assert.equal(approvalNotReady.result, false);
  assert.equal(approvalNotReady.searches, 0);
});

test('does not hand off for pointer activation or a nonterminal execution response', () => {
  const pointer = fixture({ keyboardInvoked: false });
  assert.equal(pointer.result, false);
  assert.equal(pointer.searches, 0);

  const nonterminal = fixture({ action: 'execute', runStatus: 'RUNNING' });
  assert.equal(nonterminal.result, false);
  assert.equal(nonterminal.searches, 0);

  const missingRunStatus = fixture({ action: 'open-run', runStatus: null });
  assert.equal(missingRunStatus.result, false);
  assert.equal(missingRunStatus.searches, 0);
});

test('does not steal focus moved elsewhere while the request was pending', () => {
  const result = fixture({ focusMoved: true });
  assert.equal(result.result, false);
  assert.equal(result.searches, 0);
  assert.equal(result.documentRef.activeElement, result.body);

  const otherElement = fixture({ activeTarget: 'other' });
  assert.equal(otherElement.result, false);
  assert.equal(otherElement.searches, 0);
  assert.equal(otherElement.documentRef.activeElement, otherElement.other);
});

test('requires a removed initiator and an available next target', () => {
  const connected = fixture({ controlConnected: true });
  assert.equal(connected.result, false);
  assert.equal(connected.searches, 0);

  const missing = fixture({ targetExists: false });
  assert.equal(missing.result, false);
  assert.equal(missing.documentRef.activeElement, missing.body);
});
