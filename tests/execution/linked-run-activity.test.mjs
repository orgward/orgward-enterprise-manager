import assert from 'node:assert/strict';
import test from 'node:test';
import { linkedRunActivityLabel } from '../../public/linked-run-activity.mjs';

test('linked task rows distinguish pending approval from approved and executed runs', () => {
  const run = (status) => linkedRunActivityLabel({ id: 'run-123', status });
  assert.equal(run('AWAITING_APPROVAL'), 'Approval request run-123 · Awaiting approval');
  assert.equal(run('APPROVED'), 'Linked run run-123 · Approved');
  assert.equal(run('PAUSED'), 'Linked run run-123 · Paused');
  assert.equal(run('RUNNING'), 'Linked run run-123 · Running');
  assert.equal(run('SUCCEEDED'), 'Linked run run-123 · Succeeded');
  assert.equal(run('FAILED'), 'Linked run run-123 · Failed');
  assert.equal(run('INTERRUPTED'), 'Linked run run-123 · Interrupted');
  assert.equal(run('CANCELLED'), 'Linked run run-123 · Cancelled');
});

test('malformed linked runs and unknown statuses receive safe fallbacks', () => {
  assert.equal(linkedRunActivityLabel(null), null);
  assert.equal(linkedRunActivityLabel({ id: '', status: 'SUCCEEDED' }), null);
  assert.equal(linkedRunActivityLabel({ id: 'run-123', status: 'toString' }), 'Linked run run-123 · Status unavailable');
  assert.equal(linkedRunActivityLabel({ id: 'run-123' }), 'Linked run run-123 · Status unavailable');
});
