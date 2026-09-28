import assert from 'node:assert/strict';
import test from 'node:test';
import { humanTaskHistoryEntries } from '../../public/human-task-history.mjs';

test('human task history presents persisted transitions with safe actor labels and review details', () => {
  const entries = humanTaskHistoryEntries([
    null,
    false,
    'not an event object',
    { type: 'HumanTaskStarted', actor: 'principal:secret', at: '2026-09-25T10:00:00.000Z', data: {} },
    { type: 'HumanTaskEscalated', actor: 'principal:secret', at: '2026-09-25T10:05:00.000Z', data: {
      reason: 'Needs a second review.', evidence: ['Initial inspection note.'],
    } },
    { type: 'HumanTaskEscalationResolved', actor: 'principal:owner-secret', at: '2026-09-25T10:10:00.000Z', data: {
      disposition: 'resume', reason: 'Binding remains current.', evidence: ['Owner checked binding.'],
    } },
    { type: 'HumanTaskCompleted', actor: 'principal:secret', at: '2026-09-25T10:15:00.000Z', data: {
      result: 'succeeded', evidence: ['Review completed.'],
    } },
    { type: 'ExecutionSecretRead', actor: 'principal:secret', at: '2026-09-25T10:16:00.000Z', data: { token: 'private' } },
    ...['toString', '__proto__', 'constructor', 'hasOwnProperty'].map((type) => ({
      type, actor: 'principal:secret', at: '2026-09-25T10:17:00.000Z', data: {},
    })),
  ]);

  assert.deepEqual(entries, [
    { at: '2026-09-25T10:00:00.000Z', label: 'Started', actor: 'assigned human', evidence: [] },
    { at: '2026-09-25T10:05:00.000Z', label: 'Escalated to project owner', actor: 'assigned human',
      reason: 'Needs a second review.', evidence: ['Initial inspection note.'] },
    { at: '2026-09-25T10:10:00.000Z', label: 'Owner resolution', actor: 'project owner', result: 'resume',
      reason: 'Binding remains current.', evidence: ['Owner checked binding.'] },
    { at: '2026-09-25T10:15:00.000Z', label: 'Completed', actor: 'assigned human', result: 'succeeded',
      evidence: ['Review completed.'] },
  ]);
  assert.equal(JSON.stringify(entries).includes('principal:'), false);
  assert.equal(entries.some((entry) => ['toString', '__proto__', 'constructor', 'hasOwnProperty'].includes(entry.type)), false);
  assert.deepEqual(humanTaskHistoryEntries([
    { type: 'HumanTaskStarted', at: 'not-a-time', data: {} },
    { type: 'HumanTaskStarted', at: null, data: {} },
    { type: 'HumanTaskStarted', at: 'x'.repeat(1000), data: {} },
    [],
  ]), []);
});

test('human task history bounds event count, text lengths, and evidence arrays', () => {
  const events = Array.from({ length: 105 }, (_, index) => ({
    type: 'HumanTaskEscalated',
    actor: 'principal:secret',
    at: `2026-09-25T10:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
    data: { reason: 'R'.repeat(1500), evidence: Array.from({ length: 25 }, () => 'E'.repeat(1500)), secret: 'not copied' },
  }));
  const entries = humanTaskHistoryEntries(events);
  assert.equal(entries.length, 100);
  assert.ok(entries.every((entry) => entry.reason.length === 1000));
  assert.ok(entries.every((entry) => entry.evidence.length === 20 && entry.evidence.every((note) => note.length === 1000)));
  assert.equal(JSON.stringify(entries).includes('principal:'), false);
  assert.equal(JSON.stringify(entries).includes('not copied'), false);
});

test('human task history labels owner reassignment without exposing target identity data', () => {
  const [entry] = humanTaskHistoryEntries([{
    type: 'HumanTaskEscalationResolved', at: '2026-09-28T12:00:00.000Z', actor: 'principal:owner', data: {
      disposition: 'resume', ownerAction: 'reassign', fromPrincipal: 'principal:former', toPrincipal: 'principal:new',
      reason: 'Coverage changed.', evidence: ['Owner confirmed the handoff.'],
    },
  }]);
  assert.deepEqual(entry, {
    at: '2026-09-28T12:00:00.000Z', label: 'Owner reassigned task', actor: 'project owner',
    reason: 'Coverage changed.', evidence: ['Owner confirmed the handoff.'],
  });
  assert.equal(JSON.stringify(entry).includes('principal:'), false);
});
