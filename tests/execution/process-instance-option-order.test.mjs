import assert from 'node:assert/strict';
import test from 'node:test';
import { orderProcessInstancesByLatestActivity, processInstanceLatestActivityMs } from '../../public/process-instance-option-label.mjs';

const now = Date.UTC(2026, 8, 28, 12, 0, 0);
const at = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();

test('existing instances render newest activity first and the first row matches the default selection', () => {
  const oldestFirst = [
    ['instance-old', [{ status: 'SUCCEEDED', updatedAt: at(40) }]],
    ['instance-control-new', [{ status: 'PAUSED', updatedAt: at(90), instanceControl: { events: [{ at: at(1) }] } }]],
    ['instance-middle', [{ status: 'IN_PROGRESS', updatedAt: at(12) }]],
  ];
  const ordered = orderProcessInstancesByLatestActivity(oldestFirst, now);

  assert.deepEqual(ordered.map(([instanceId]) => instanceId), [
    'instance-control-new', 'instance-middle', 'instance-old',
  ]);
  assert.equal(ordered[0][0], 'instance-control-new', 'the default-selected latest instance is the first existing option');
  assert.deepEqual(oldestFirst.map(([instanceId]) => instanceId), [
    'instance-old', 'instance-control-new', 'instance-middle',
  ], 'ordering does not mutate the API/runtime row order');
});

test('equal and unavailable activity use deterministic ID ordering with valid activity first', () => {
  const rows = [
    ['z-tie', [{ status: 'PLANNED', createdAt: at(5) }]],
    ['unknown-z', [{ status: 'PLANNED', updatedAt: 'not-a-date' }]],
    ['a-tie', [{ status: 'PLANNED', createdAt: at(5) }]],
    ['unknown-a', [{ status: 'PLANNED', instanceControl: { events: { at: at(1) } } }]],
    ['newest', [{ status: 'FAILED', completedAt: at(1) }]],
  ];

  assert.deepEqual(orderProcessInstancesByLatestActivity(rows, now).map(([instanceId]) => instanceId), [
    'newest', 'a-tie', 'z-tie', 'unknown-a', 'unknown-z',
  ]);
  assert.equal(processInstanceLatestActivityMs([{ updatedAt: 'not-a-date' }], now), null);
  assert.equal(processInstanceLatestActivityMs([{ updatedAt: at(-5) }], now), null,
    'a malformed future activity time falls back to unavailable');
  assert.equal(processInstanceLatestActivityMs([{ createdAt: at(20), updatedAt: at(-5) }], now), null,
    'an out-of-tolerance future value does not fall back to an older timestamp');
  assert.deepEqual(orderProcessInstancesByLatestActivity([
    ['future-invalid', [{ createdAt: at(20), updatedAt: at(-5) }]],
    ['older-valid', [{ updatedAt: at(30) }]],
  ], now).map(([instanceId]) => instanceId), ['older-valid', 'future-invalid']);
  assert.deepEqual(orderProcessInstancesByLatestActivity([
    ['bad-a', null], ['bad-z', { updatedAt: at(1) }], ['valid', [{ updatedAt: at(2) }]],
  ], now).map(([instanceId]) => instanceId), ['valid', 'bad-a', 'bad-z']);
});
