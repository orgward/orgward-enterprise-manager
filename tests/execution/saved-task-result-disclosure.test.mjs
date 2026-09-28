import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureExpandedSavedTaskResultKeys, captureFocusedSavedTaskResult, restoreFocusedSavedTaskResult,
  restoreSavedTaskResultOpen, savedTaskResultDisclosureKey,
} from '../../public/saved-task-result-disclosure.mjs';

function disclosure(key, { open = false } = {}) {
  const summary = { tagName: 'SUMMARY', focus(options) { this.focusOptions = options; } };
  const link = { tagName: 'A', href: '/design/current', getAttribute(name) { return name === 'href' ? this.href : null; },
    focus(options) { this.focusOptions = options; } };
  const details = { open, dataset: { savedTaskResultKey: key }, summary, link,
    contains(element) { return element === summary || element === link; },
    querySelector(selector) { return selector === 'summary' ? summary : null; },
    querySelectorAll(selector) { return selector === 'a[href]' ? [link] : []; } };
  return details;
}

test('expanded saved task results survive rerenders by exact project and run identity', () => {
  const openKey = savedTaskResultDisclosureKey('project-one', 'run-one');
  const closedKey = savedTaskResultDisclosureKey('project-one', 'run-two');
  const expanded = captureExpandedSavedTaskResultKeys([
    { open: true, dataset: { savedTaskResultKey: openKey } },
    { open: false, dataset: { savedTaskResultKey: closedKey } },
    { open: true, dataset: {} },
    { open: true, dataset: { savedTaskResultKey: '' } },
  ]);

  assert.deepEqual([...expanded], [openKey]);
  assert.equal(restoreSavedTaskResultOpen(savedTaskResultDisclosureKey('project-one', 'run-one'), expanded), true);
  assert.equal(restoreSavedTaskResultOpen(savedTaskResultDisclosureKey('project-one', 'run-two'), expanded), false);
  assert.equal(restoreSavedTaskResultOpen(savedTaskResultDisclosureKey('project-two', 'run-one'), expanded), false,
    'a matching run ID in another project does not inherit the open state');
  assert.equal(savedTaskResultDisclosureKey(null, 'run-one'), null);
  assert.equal(savedTaskResultDisclosureKey('project-one', ''), null);
});

test('expanded saved result state ignores malformed detail collections safely', () => {
  assert.deepEqual([...captureExpandedSavedTaskResultKeys(null)], []);
  assert.deepEqual([...captureExpandedSavedTaskResultKeys([
    null, {}, { open: true, dataset: { savedTaskResultKey: 7 } },
  ])], []);
  assert.equal(restoreSavedTaskResultOpen('key', []), false);
});

test('saved result details preserve ordinary close and reopen state across a rerender', () => {
  const key = savedTaskResultDisclosureKey('project-one', 'run-one');
  const details = disclosure(key, { open: true });
  assert.equal(restoreSavedTaskResultOpen(key, captureExpandedSavedTaskResultKeys([details])), true);

  details.open = false;
  const closedSnapshot = captureExpandedSavedTaskResultKeys([details]);
  assert.equal(restoreSavedTaskResultOpen(key, closedSnapshot), false,
    'a user-closed result remains closed after rerender');

  details.open = true;
  const reopenedSnapshot = captureExpandedSavedTaskResultKeys([details]);
  assert.equal(restoreSavedTaskResultOpen(key, reopenedSnapshot), true,
    'a user-reopened result remains open after rerender');
});

test('focused saved result summary and link restore by exact project/run identity', () => {
  const key = savedTaskResultDisclosureKey('project-one', 'run-one');
  const original = disclosure(key, { open: true });
  const summaryFocus = captureFocusedSavedTaskResult([original], original.summary);
  assert.deepEqual(summaryFocus, { key, target: 'summary' });
  const replacement = disclosure(key, { open: true });
  assert.equal(restoreFocusedSavedTaskResult(summaryFocus, [replacement]), true);
  assert.deepEqual(replacement.summary.focusOptions, { preventScroll: true });

  const linkFocus = captureFocusedSavedTaskResult([original], original.link);
  assert.deepEqual(linkFocus, { key, target: 'link', href: '/design/current' });
  const next = disclosure(key, { open: true });
  assert.equal(restoreFocusedSavedTaskResult(linkFocus, [next]), true);
  assert.deepEqual(next.link.focusOptions, { preventScroll: true });
  assert.equal(restoreFocusedSavedTaskResult(linkFocus, [disclosure(savedTaskResultDisclosureKey('project-two', 'run-one'))]), false,
    'focus cannot move to another project or a different run');
  assert.equal(restoreFocusedSavedTaskResult({ ...linkFocus, href: '/missing' }, [next]), false,
    'removed result actions do not receive replacement focus');
});
