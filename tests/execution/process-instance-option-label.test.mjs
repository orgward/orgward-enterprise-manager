import assert from 'node:assert/strict';
import test from 'node:test';
import { processInstanceOptionLabel } from '../../public/process-instance-option-label.mjs';

const now = Date.UTC(2026, 8, 28, 12, 0, 0);
const at = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();

test('process instance option keeps its short reference and summarizes task lifecycle and latest activity', () => {
  const label = processInstanceOptionLabel('d35e8f01-2345-6789-abcd-ef0123456789', [
    { status: 'SUCCEEDED', updatedAt: at(17) },
    { status: 'IN_PROGRESS', updatedAt: at(4), createdAt: at(30) },
    { status: 'PLANNED', updatedAt: at(8) },
  ], now);
  assert.equal(label, 'Instance d35e8f01 · In progress · 1/3 terminal · updated 4m ago');
});

test('control lifecycle takes precedence and control event time contributes to latest activity', () => {
  const label = processInstanceOptionLabel('instance-1234', [
    { status: 'ESCALATED', updatedAt: at(90), instanceControl: {
      status: 'PAUSED', events: [{ at: at(2) }],
    } },
    { status: 'PLANNED', createdAt: at(120), instanceControl: {
      status: 'PAUSED', events: [{ at: at(2) }],
    } },
  ], now);
  assert.equal(label, 'Instance instance · Paused · 0/2 terminal · updated 2m ago');
});

test('terminal outcomes, no-activity time, and malformed runtime data fail safely', () => {
  assert.equal(processInstanceOptionLabel('run-12345', [
    { status: 'SUCCEEDED', completedAt: at(2 * 24 * 60) },
    { status: 'FAILED', updatedAt: at(2 * 24 * 60) },
  ], now), 'Instance run-1234 · Mixed results · 2/2 terminal · updated 2d ago');
  assert.equal(processInstanceOptionLabel('run-12345', [{ status: 'PLANNED' }], now),
    'Instance run-1234 · Not started · 0/1 terminal · activity time unavailable');
  assert.equal(processInstanceOptionLabel('run-12345', [{ status: 'ALIEN', updatedAt: 'not-a-date' }], now),
    'Instance run-1234 · Status unavailable · terminal count unavailable · activity time unavailable');
  assert.equal(processInstanceOptionLabel('run-12345', [{ status: 'PLANNED', instanceControl: { status: 'UNKNOWN' } }], now),
    'Instance run-1234 · Status unavailable · 0/1 terminal · activity time unavailable');
  assert.equal(processInstanceOptionLabel('run-12345', [{ status: 'PLANNED', updatedAt: 'invalid', instanceControl: {
    status: 'PAUSED', events: { at: at(2) },
  } }], now), 'Instance run-1234 · Paused · 0/1 terminal · activity time unavailable',
  'non-array control history is ignored instead of breaking selector rendering');
  assert.equal(processInstanceOptionLabel(null, null, now),
    'Instance unknown · Status unavailable · terminal count unavailable · activity time unavailable');
  assert.equal(processInstanceOptionLabel('run-12345', [{ status: 'PLANNED', updatedAt: at(-10) }], now),
    'Instance run-1234 · Not started · 0/1 terminal · activity time unavailable',
    'a future timestamp outside clock-skew tolerance is not presented as elapsed activity');
});
