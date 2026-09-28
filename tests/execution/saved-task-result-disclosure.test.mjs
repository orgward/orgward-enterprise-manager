import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureExpandedSavedTaskResultKeys, restoreSavedTaskResultOpen, savedTaskResultDisclosureKey,
} from '../../public/saved-task-result-disclosure.mjs';

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
