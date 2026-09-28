import assert from 'node:assert/strict';
import test from 'node:test';
import { isCurrentSelectedRunRefresh, selectedRunRefreshDisposition, selectedRunRefreshMessage, selectedRunStatusAnnouncement } from '../../public/selected-run-refresh.mjs';

const current = { id: 'run-1', title: 'Catalog service', version: 2, status: 'APPROVED', events: [{ type: 'ExecutionApproved' }] };
const next = { ...current, version: 3, status: 'SUCCEEDED', events: [...current.events, { type: 'ExecutionSucceeded' }] };

function containerFixture({ focused = false, dirty = false } = {}) {
  const control = { disabled: false, type: 'text', tagName: 'INPUT', value: dirty ? 'unsaved' : '', defaultValue: '', checked: false, defaultChecked: false };
  const container = { contains(node) { return node === (focused ? control : null); }, querySelectorAll() { return [control]; } };
  return { container, documentRef: { body: {}, activeElement: focused ? control : {} } };
}

test('selected-run refresh rejects stale generations, run identities, route changes, and older versions', () => {
  const identity = { requestId: 4, currentRequestId: 4, runId: 'run-1', currentRunId: 'run-1', routeRunId: 'run-1',
    projectId: 'project-1', currentProjectId: 'project-1', routeProjectId: 'project-1' };
  assert.equal(isCurrentSelectedRunRefresh(identity), true);
  assert.equal(isCurrentSelectedRunRefresh({ ...identity, requestId: 3 }), false);
  assert.equal(isCurrentSelectedRunRefresh({ ...identity, currentRunId: 'run-2' }), false);
  assert.equal(isCurrentSelectedRunRefresh({ ...identity, routeRunId: 'run-2' }), false);
  assert.equal(isCurrentSelectedRunRefresh({ ...identity, routeProjectId: 'project-2' }), false);
  assert.equal(selectedRunRefreshDisposition({ currentRun: next, nextRun: current }), 'stale');
});

test('unchanged selected-run snapshots are silent and do not rerender', () => {
  assert.equal(selectedRunRefreshDisposition({ currentRun: current, nextRun: structuredClone(current) }), 'unchanged');
  assert.equal(selectedRunStatusAnnouncement(current, structuredClone(current)), '');
  assert.equal(selectedRunRefreshDisposition({ currentRun: current, nextRun: { ...current, status: 'SUCCEEDED' } }), 'stale',
    'divergent snapshots with the same aggregate version are rejected');
});

test('selected-run refresh announces only a status transition', () => {
  assert.equal(selectedRunRefreshDisposition({ currentRun: current, nextRun: next }), 'apply');
  assert.equal(selectedRunStatusAnnouncement(current, next), 'Catalog service changed from approved to succeeded.');
  assert.equal(selectedRunStatusAnnouncement(current, { ...next, status: current.status }), '');
  assert.equal(selectedRunStatusAnnouncement(null, next), '');
});

test('selected-run refresh defers while controls are dirty or focused', () => {
  assert.equal(selectedRunRefreshDisposition({ currentRun: current, nextRun: next, ...containerFixture({ dirty: true }) }), 'defer-dirty');
  assert.equal(selectedRunRefreshDisposition({ currentRun: current, nextRun: next, ...containerFixture({ focused: true }) }), 'defer-focus');
  assert.equal(selectedRunRefreshDisposition({ currentRun: current, nextRun: next, ...containerFixture() }), 'apply');
  assert.equal(selectedRunRefreshMessage('defer-dirty'), 'A run update is waiting. Save or discard your current edit to show it.');
  assert.equal(selectedRunRefreshMessage('defer-focus'), 'A run update is waiting. Move focus outside the run details to show it.');
  assert.equal(selectedRunRefreshMessage('apply'), '');
});
