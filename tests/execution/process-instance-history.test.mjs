import assert from 'node:assert/strict';
import test from 'node:test';
import { processInstanceControlHistoryEntries } from '../../public/process-instance-history.mjs';

test('instance-control history preserves useful fields and hides raw principals', () => {
  const entries = processInstanceControlHistoryEntries([
    null,
    false,
    'not an event object',
    { type: 'ProcessTaskInstancePauseRequested', actor: 'oidc:secret-initiator', at: '2026-09-25T10:00:00.000Z',
      data: { reason: 'Stop for review.', privateField: 'must not appear' } },
    { type: 'ProcessTaskInstancePaused', actor: 'oidc:secret-initiator', at: '2026-09-25T10:01:00.000Z', data: {} },
    { type: 'ProcessTaskInstanceResumed', actor: 'oidc:secret-owner', at: '2026-09-25T10:02:00.000Z', data: {} },
    { type: 'ProcessTaskInstanceAbandonedUnverified', actor: 'oidc:secret-owner', at: '2026-09-25T10:03:00.000Z',
      data: { reason: 'Provider result cannot be verified.', runIds: ['execution-run-1'], attemptIds: ['attempt-1'],
        evidence: ['Attempt remains unknown.'], acknowledgeDuplicateCostWork: true, secret: 'must not appear' } },
    { type: 'ProcessTaskInstanceCancelled', actor: 'oidc:secret-initiator', at: '2026-09-25T10:03:30.000Z',
      data: { reason: 'Drained work was closed.', authzGeneration: 7 } },
    { type: 'ProcessTaskInstancePaused', actor: 'system', at: '2026-09-25T10:04:00.000Z', data: {} },
    { type: 'UnknownControlEvent', actor: 'oidc:secret-owner', at: '2026-09-25T10:05:00.000Z', data: { reason: 'unknown' } },
    ...['toString', '__proto__', 'constructor', 'hasOwnProperty'].map((type) => ({
      type, actor: 'oidc:secret-owner', at: '2026-09-25T10:05:30.000Z', data: {},
    })),
    { type: 'ProcessTaskInstanceResumed', actor: 'oidc:secret-owner', at: 'invalid-time', data: {} },
    { type: 'ProcessTaskInstanceResumed', actor: 'oidc:secret-owner', at: null, data: {} },
    { type: 'ProcessTaskInstanceResumed', actor: 'oidc:secret-owner', at: 'x'.repeat(1000), data: {} },
    { actor: 'oidc:secret-owner', at: '2026-09-25T10:06:00.000Z', data: {} },
    [],
  ]);

  assert.deepEqual(entries, [
    { type: 'ProcessTaskInstancePauseRequested', actor: 'authorized controller', at: '2026-09-25T10:00:00.000Z', reason: 'Stop for review.' },
    { type: 'ProcessTaskInstancePaused', actor: 'authorized controller', at: '2026-09-25T10:01:00.000Z' },
    { type: 'ProcessTaskInstanceResumed', actor: 'authorized controller', at: '2026-09-25T10:02:00.000Z' },
    { type: 'ProcessTaskInstanceAbandonedUnverified', actor: 'project owner', at: '2026-09-25T10:03:00.000Z',
      reason: 'Provider result cannot be verified.', runIds: ['execution-run-1'], attemptIds: ['attempt-1'],
      evidence: ['Attempt remains unknown.'], acknowledgeDuplicateCostWork: true },
    { type: 'ProcessTaskInstanceCancelled', actor: 'authorized controller', at: '2026-09-25T10:03:30.000Z',
      reason: 'Drained work was closed.' },
    { type: 'ProcessTaskInstancePaused', actor: 'system', at: '2026-09-25T10:04:00.000Z' },
  ]);
  assert.equal(JSON.stringify(entries).includes('oidc:'), false);
  assert.equal(JSON.stringify(entries).includes('must not appear'), false);
});

test('instance-control history bounds event count, text lengths, and evidence/reference arrays', () => {
  const events = Array.from({ length: 105 }, (_, index) => ({
    type: 'ProcessTaskInstanceAbandonedUnverified',
    actor: 'oidc:secret-owner',
    at: `2026-09-25T10:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
    data: {
      reason: 'r'.repeat(1500),
      runIds: Array.from({ length: 25 }, () => 'R'.repeat(240)),
      attemptIds: Array.from({ length: 25 }, () => 'A'.repeat(240)),
      evidence: Array.from({ length: 25 }, () => 'E'.repeat(1500)),
      acknowledgeDuplicateCostWork: true,
      arbitraryPayload: { secret: 'must not be copied' },
    },
  }));
  const entries = processInstanceControlHistoryEntries(events);
  assert.equal(entries.length, 100);
  assert.ok(entries.every((entry) => entry.reason.length === 1000));
  assert.ok(entries.every((entry) => entry.runIds.length === 20 && entry.runIds.every((id) => id.length === 160)));
  assert.ok(entries.every((entry) => entry.attemptIds.length === 20 && entry.attemptIds.every((id) => id.length === 160)));
  assert.ok(entries.every((entry) => entry.evidence.length === 20 && entry.evidence.every((note) => note.length === 1000)));
  assert.equal(JSON.stringify(entries).includes('oidc:'), false);
  assert.equal(JSON.stringify(entries).includes('must not be copied'), false);
});
