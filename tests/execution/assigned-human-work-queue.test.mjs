import assert from 'node:assert/strict';
import test from 'node:test';
import { assignedHumanWorkItems, assignedHumanWorkItemsForProcess, assignedHumanWorkRowId, findHistoricalProcessPlanCard, openAssignedHumanWorkItem,
  renderAssignedHumanWorkQueue } from '../../public/assigned-human-work-queue.mjs';

function el(tag, options = {}, children = []) {
  const node = { tag, text: options.text ?? '', attrs: options.attrs ?? {}, children: Array.isArray(children) ? children : [children], listeners: new Map(),
    append(child) { this.children.push(child); }, addEventListener(type, listener) { this.listeners.set(type, listener); } };
  return node;
}

const plan = { id: 'plan-one', revision: 2, source: { projectId: 'project-one', processName: 'Inspect goods' }, tasks: [
  { id: 'inspect', title: 'Inspect shipment', outputs: [{ label: 'Inspection result' }] },
  { id: 'approve', title: 'Approve exception', outputs: [] },
] };
const runtime = (overrides = {}) => ({ projectId: 'project-one', processPlanId: 'plan-one', revision: 2,
  planInstanceId: 'instance-one', taskId: 'inspect', actorType: 'human', status: 'IN_PROGRESS',
  assignedToCurrentPrincipal: true, updatedAt: '2026-10-06T12:00:00.000Z', ...overrides });

test('My assigned work includes current-principal active human tasks pinned to retained plan revisions', () => {
  const items = assignedHumanWorkItems([plan, { ...plan, revision: 1 }], [
    runtime(), runtime({ taskId: 'approve', status: 'ESCALATED', planInstanceId: 'instance-two' }),
    runtime({ taskId: 'approve', assignedToCurrentPrincipal: false }),
    runtime({ actorType: 'agent' }), runtime({ projectId: 'project-other' }),
    runtime({ revision: 1, planInstanceId: 'old-instance' }), runtime({ status: 'SUCCEEDED' }),
  ], 'project-one');
  assert.deepEqual(items.map((item) => [item.taskId, item.status, item.revision]), [
    ['approve', 'ESCALATED', 2], ['inspect', 'IN_PROGRESS', 2], ['inspect', 'IN_PROGRESS', 1],
  ]);
  const inspection = items.find((item) => item.taskId === 'inspect');
  assert.deepEqual(inspection.outputs, ['Inspection result']);
  assert.equal(assignedHumanWorkRowId(inspection), 'assigned-human-work-plan-one-2-instance-one-inspect');
  const historical = items.find((item) => item.revision === 1);
  assert.equal(historical.planInstanceId, 'old-instance');
  assert.equal(assignedHumanWorkRowId(historical), 'assigned-human-work-plan-one-1-old-instance-inspect');
});

test('historical plan rendering selects the plan card even when a queue section is inserted first', () => {
  const queue = { className: 'assigned-human-work-queue' };
  const card = { className: 'process-plan' };
  const container = { firstElementChild: queue, querySelector(selector) {
    assert.equal(selector, '.process-plan');
    return this.children.find((entry) => entry.className === 'process-plan') ?? null;
  }, children: [queue, card] };
  assert.equal(findHistoricalProcessPlanCard(container), card);
});

test('My assigned work queue offers an exact-task navigation action and a clear empty state', () => {
  const items = assignedHumanWorkItems([plan], [runtime()], 'project-one');
  let opened = null;
  const queue = renderAssignedHumanWorkQueue({ items, el, onOpen: (item) => { opened = item; } });
  assert.equal(queue.attrs['aria-label'], 'My assigned work');
  assert.match(queue.children.map((child) => child.text).join(' '), /Only active human tasks assigned/);
  const row = queue.children[2].children[0];
  row.children[3].listeners.get('click')();
  assert.equal(opened.taskId, 'inspect');
  assert.equal(opened.planInstanceId, 'instance-one');
  const selected = new Map(); let rendered = 0; const calls = [];
  openAssignedHumanWorkItem({ item: opened, selectedInstances: selected, render: () => { rendered += 1; },
    findRow: (id) => ({ id, scrollIntoView: (options) => calls.push(['scroll', options]), focus: (options) => calls.push(['focus', options]) }) });
  assert.equal(selected.get('plan-one\n2'), 'instance-one');
  assert.equal(rendered, 1);
  assert.equal(calls.length, 2);
  const historical = assignedHumanWorkItems([plan, { ...plan, revision: 1 }], [runtime({ revision: 1, planInstanceId: 'old-instance' })], 'project-one')[0];
  let historicalRowId = null;
  openAssignedHumanWorkItem({ item: historical, selectedInstances: selected, render() {}, findRow: (id) => { historicalRowId = id; return { id }; } });
  assert.equal(selected.get('plan-one\n1'), 'old-instance');
  assert.equal(historicalRowId, 'assigned-human-work-plan-one-1-old-instance-inspect');
  const empty = renderAssignedHumanWorkQueue({ items: [], el, onOpen() {} });
  assert.match(empty.children[1].text, /No active human tasks are assigned/);
  const emptyProcess = renderAssignedHumanWorkQueue({ items: [], el, onOpen() {},
    emptyMessage: 'No active human tasks are assigned to you for this saved process.' });
  assert.equal(emptyProcess.children[1].text, 'No active human tasks are assigned to you for this saved process.');
});

test('opening one of multiple assigned tasks in the same instance targets only its task row', () => {
  const items = assignedHumanWorkItems([plan], [runtime(), runtime({ taskId: 'approve', planInstanceId: 'instance-one' })], 'project-one');
  assert.equal(items.length, 2);
  assert.equal(items[0].planInstanceId, items[1].planInstanceId);
  const selected = items.find((item) => item.taskId === 'approve');
  const selectedInstances = new Map(); let focusedRow = null;
  openAssignedHumanWorkItem({ item: selected, selectedInstances, render() {}, findRow: (id) => { focusedRow = id; return { id }; } });
  assert.equal(selectedInstances.get('plan-one\n2'), 'instance-one');
  assert.equal(focusedRow, 'assigned-human-work-plan-one-2-instance-one-approve');
});

test('process-filtered My Work selects each task source inside a mixed-process plan revision', () => {
  const mixedPlan = { ...plan, source: { ...plan.source, processId: 'process-root' }, tasks: [
    { ...plan.tasks[0], sourceProcessId: 'process-root' },
    { ...plan.tasks[1], sourceProcessId: 'process-child' },
  ] };
  const items = assignedHumanWorkItems([mixedPlan], [
    runtime({ taskId: 'inspect' }), runtime({ taskId: 'approve', planInstanceId: 'instance-one' }),
  ], 'project-one');
  assert.deepEqual(assignedHumanWorkItemsForProcess(items, 'process-root').map((item) => item.taskId), ['inspect']);
  assert.deepEqual(assignedHumanWorkItemsForProcess(items, 'process-child').map((item) => item.taskId), ['approve']);
  assert.deepEqual(assignedHumanWorkItemsForProcess(items, null), ['approve', 'inspect'].map((taskId) => items.find((item) => item.taskId === taskId)));
});
