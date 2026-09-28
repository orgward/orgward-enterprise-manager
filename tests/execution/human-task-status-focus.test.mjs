import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreHumanTaskStatusFocus } from '../../public/human-task-status-focus.mjs';

function fixture({ controlConnected = false, activeIsBody = true, targetExists = true } = {}) {
  const body = {};
  const otherFocus = {};
  const documentRef = { body, activeElement: activeIsBody ? body : otherFocus };
  let scrollOptions = null;
  let focusOptions = null;
  let targetSearches = 0;
  const target = targetExists ? {
    scrollIntoView(options) { scrollOptions = options; },
    focus(options) { focusOptions = options; documentRef.activeElement = target; },
  } : null;
  const result = restoreHumanTaskStatusFocus({
    initiatingControl: { isConnected: controlConnected },
    documentRef,
    findTarget: () => { targetSearches += 1; return target; },
  });
  return { result, documentRef, body, otherFocus, target, scrollOptions, focusOptions, targetSearches };
}

test('restores focus to the refreshed task status only after its initiating control is removed', () => {
  const result = fixture();
  assert.equal(result.result, true);
  assert.equal(result.documentRef.activeElement, result.target);
  assert.deepEqual(result.scrollOptions, { block: 'nearest' });
  assert.deepEqual(result.focusOptions, { preventScroll: true });
});

test('does not steal focus from a connected control or another active element', () => {
  const connectedControl = fixture({ controlConnected: true });
  assert.equal(connectedControl.result, false);
  assert.equal(connectedControl.targetSearches, 0);
  assert.equal(connectedControl.documentRef.activeElement, connectedControl.body);

  const otherElementFocused = fixture({ activeIsBody: false });
  assert.equal(otherElementFocused.result, false);
  assert.equal(otherElementFocused.targetSearches, 0);
  assert.equal(otherElementFocused.documentRef.activeElement, otherElementFocused.otherFocus);
});

test('leaves body focus in place when no matching task status is rendered', () => {
  const result = fixture({ targetExists: false });
  assert.equal(result.result, false);
  assert.equal(result.documentRef.activeElement, result.body);
});
