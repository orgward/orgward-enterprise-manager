import assert from 'node:assert/strict';
import test from 'node:test';
import { isCurrentProcessInstanceRefresh, processInstanceRefreshDisposition, processInstanceRefreshMessage, processInstanceStatusAnnouncement } from '../../public/process-instance-refresh.mjs';

function taskInstance(taskId, status, planInstanceId = 'instance-1', processPlanId = 'plan-1', revision = 1) {
  return { projectId: 'project-1', processPlanId, revision, planInstanceId, taskId, status };
}

function containerFixture({ focused = false, dirty = false } = {}) {
  const control = { disabled: false, type: 'text', tagName: 'INPUT', value: dirty ? 'unsaved' : '', defaultValue: '', checked: false, defaultChecked: false };
  const container = {
    contains(node) { return node === (focused ? control : null); },
    querySelectorAll() { return [control]; },
  };
  return { container, documentRef: { body: {}, activeElement: focused ? control : {} } };
}
function projectSnapshot(version = 1, events = []) {
  return { id: 'project-1', version, events };
}

test('unchanged cross-session snapshots do not defer on focused controls', () => {
  assert.equal(processInstanceRefreshDisposition({ currentInstances: [{ version: 3 }], nextInstances: [{ version: 3 }],
    ...containerFixture({ focused: true }) }), 'unchanged');
});

test('linked run-only status changes defer with focused plans and apply after focus leaves', () => {
  const args = { currentInstances: [taskInstance('task-a', 'RUNNING')], nextInstances: [taskInstance('task-a', 'RUNNING')],
    currentRuns: [{ id: 'run-a', status: 'RUNNING' }], nextRuns: [{ id: 'run-a', status: 'INTERRUPTED' }] };
  const focused = processInstanceRefreshDisposition({ ...args, ...containerFixture({ focused: true }) });
  assert.equal(focused, 'defer-focus');
  assert.equal(processInstanceRefreshDisposition({ ...args, ...containerFixture() }), 'apply');
});

test('changed cross-session snapshots defer for focused clean controls with an accurate instruction', () => {
  const disposition = processInstanceRefreshDisposition({ currentInstances: [{ version: 2 }], nextInstances: [{ version: 3 }],
    ...containerFixture({ focused: true }) });
  assert.equal(disposition, 'defer-focus');
  assert.equal(processInstanceRefreshMessage(disposition), 'New saved project updates are available. Move focus outside the plan to show them.');
});

test('changed cross-session snapshots defer dirty input with a save/discard instruction', () => {
  const disposition = processInstanceRefreshDisposition({ currentInstances: [{ version: 2 }], nextInstances: [{ version: 3 }],
    ...containerFixture({ dirty: true }) });
  assert.equal(disposition, 'defer-dirty');
  assert.equal(processInstanceRefreshMessage(disposition), 'New saved project updates are available. Save or discard your current edit to show them.');
});

test('changed cross-session snapshots apply when clean and unfocused', () => {
  assert.equal(processInstanceRefreshDisposition({ currentInstances: [{ version: 2 }], nextInstances: [{ version: 3 }],
    ...containerFixture() }), 'apply');
});

test('project event-only changes apply when clean, defer with focused/dirty task controls, and identical projects stay unchanged', () => {
  const currentProject = projectSnapshot(3);
  const nextProject = projectSnapshot(4, [{ type: 'BlueprintProposalApplied', data: { runId: 'run-a' } }]);
  const unchangedData = {
    currentInstances: [{ id: 'instance-a', status: 'SUCCEEDED' }],
    nextInstances: [{ id: 'instance-a', status: 'SUCCEEDED' }],
    currentRuns: [{ id: 'run-a', status: 'SUCCEEDED' }],
    nextRuns: [{ id: 'run-a', status: 'SUCCEEDED' }],
    currentProject, nextProject,
  };
  assert.equal(processInstanceRefreshDisposition({ ...unchangedData, ...containerFixture() }), 'apply');
  assert.equal(processInstanceRefreshDisposition({ ...unchangedData, ...containerFixture({ focused: true }) }), 'defer-focus');
  assert.equal(processInstanceRefreshDisposition({ ...unchangedData, ...containerFixture({ dirty: true }) }), 'defer-dirty');
  assert.equal(processInstanceRefreshDisposition({ ...unchangedData, nextProject: structuredClone(currentProject),
    ...containerFixture({ focused: true }) }), 'unchanged');
  assert.equal(processInstanceRefreshDisposition({ ...unchangedData, nextProject: projectSnapshot(4),
    ...containerFixture() }), 'apply', 'a project version-only change also triggers task-row refresh');
});

test('cross-session refresh rejects responses from an older request or prior project', () => {
  assert.equal(isCurrentProcessInstanceRefresh({ requestId: 2, currentRequestId: 2, projectId: 'p1', currentProjectId: 'p1' }), true);
  assert.equal(isCurrentProcessInstanceRefresh({ requestId: 1, currentRequestId: 2, projectId: 'p1', currentProjectId: 'p1' }), false);
  assert.equal(isCurrentProcessInstanceRefresh({ requestId: 2, currentRequestId: 2, projectId: 'p1', currentProjectId: 'p2' }), false);
  assert.equal(isCurrentProcessInstanceRefresh({ requestId: 2, currentRequestId: 2, projectId: 'p1', currentProjectId: 'p1', routeKey: '/execution?project=p1', currentRouteKey: '/execution?project=p2' }), false);
  assert.equal(isCurrentProcessInstanceRefresh({ requestId: 2, currentRequestId: 2, projectId: 'p1', currentProjectId: 'p1', snapshotProjectId: 'p2' }), false,
    'a project response for another project is rejected even when the request itself is current');
  assert.equal(isCurrentProcessInstanceRefresh({ requestId: 1, currentRequestId: 2, projectId: 'p1', currentProjectId: 'p1', snapshotProjectId: 'p1' }), false,
    'a late project snapshot from an older poll cannot overwrite a newer response');
});

test('cross-session task status announcements ignore first snapshots and unchanged statuses', () => {
  const next = [taskInstance('task-a', 'IN_PROGRESS')];
  assert.equal(processInstanceStatusAnnouncement([], next), '');
  assert.equal(processInstanceStatusAnnouncement(next, next), '');
});

function linkedInstance(status) {
  return { ...taskInstance('task-a', status), executionRunId: 'run-a' };
}

function linkedRun(status, providerDiagnostic = undefined) {
  return { id: 'run-a', projectId: 'project-1', status,
    processTaskRef: { processPlanId: 'plan-1', revision: 1, planInstanceId: 'instance-1', taskId: 'task-a' },
    execution: providerDiagnostic ? { providerDiagnostic } : {} };
}

test('new unknown delivery announces safe reconciliation copy with task title', () => {
  const previous = [linkedInstance('RUNNING')];
  const next = [linkedInstance('INTERRUPTED')];
  const plans = [{ id: 'plan-1', revision: 1, tasks: [{ id: 'task-a', title: 'Send proposal' }] }];
  const announcement = processInstanceStatusAnnouncement(previous, next, plans,
    [linkedRun('RUNNING')], [linkedRun('INTERRUPTED', { outcome: 'outcome_unknown', requestId: 'private-id', body: 'private-body' })]);
  assert.equal(announcement,
    'Send proposal: Outcome unknown. An external request may have been received. Delivery is unverified. Reconcile with the provider before retrying.');
  assert.doesNotMatch(announcement, /private-id|private-body/);
});

test('restart-shaped unknown delivery announcement includes only allowlisted DeepSeek detail copy', () => {
  const previous = [linkedInstance('FAILED')];
  const next = [linkedInstance('FAILED')];
  const plans = [{ id: 'plan-1', revision: 1, tasks: [{ id: 'task-a', title: 'Send proposal' }] }];
  const canary = 'private-body-request-id-message-code';
  const restoredUnknownRun = JSON.parse(JSON.stringify(linkedRun('FAILED', {
    outcome: 'outcome_unknown', provider: 'deepseek', httpStatus: 503,
    parserFailureClass: 'invalid_json', transportFailureClass: 'connection_reset',
    body: canary, requestId: canary, message: canary, code: canary,
  })));
  const announcement = processInstanceStatusAnnouncement(previous, next, plans,
    [linkedRun('FAILED')], [restoredUnknownRun]);
  assert.equal(announcement,
    'Send proposal: Outcome unknown. DeepSeek returned HTTP 503; response parsing failed (invalid JSON); DeepSeek connection was reset. An external request may have been received. Delivery is unverified. Reconcile with the provider before retrying.');
  assert.equal(announcement.includes(canary), false);
  const invalidDetails = JSON.parse(JSON.stringify(linkedRun('FAILED', {
    outcome: 'outcome_unknown', provider: 'other', httpStatus: 700,
    parserFailureClass: canary, body: canary,
  })));
  const fallback = processInstanceStatusAnnouncement(previous, next, plans,
    [linkedRun('FAILED')], [invalidDetails]);
  assert.equal(fallback,
    'Send proposal: Outcome unknown. An external request may have been received. Delivery is unverified. Reconcile with the provider before retrying.');
  assert.equal(fallback.includes(canary), false);
});

test('marker-only unknown transition is announced once while first-seen and repeated snapshots stay silent', () => {
  const sameStatus = [linkedInstance('FAILED')];
  const ordinary = [linkedRun('FAILED')];
  const unknown = [linkedRun('FAILED', { outcome: 'outcome_unknown' })];
  const plans = [{ id: 'plan-1', revision: 1, tasks: [{ id: 'task-a', title: 'Run local check' }] }];
  assert.equal(processInstanceStatusAnnouncement([], sameStatus, plans, [], unknown), '');
  const markerOnly = processInstanceStatusAnnouncement(sameStatus, sameStatus, plans, ordinary, unknown);
  assert.match(markerOnly, /Run local check: Outcome unknown\./);
  assert.match(markerOnly, /Reconcile with the provider before retrying/);
  assert.equal(processInstanceStatusAnnouncement(sameStatus, sameStatus, plans, unknown, unknown), '');
});

test('ordinary linked failure uses generic status announcement without reconciliation copy', () => {
  const previous = [linkedInstance('RUNNING')];
  const next = [linkedInstance('FAILED')];
  const announcement = processInstanceStatusAnnouncement(previous, next, [],
    [linkedRun('RUNNING')], [linkedRun('FAILED')]);
  assert.equal(announcement, 'task-a changed from running to failed.');
  assert.doesNotMatch(announcement, /Outcome unknown|Reconcile with the provider/);
});

test('bounded multi-task announcements prioritize unknown delivery over generic status changes', () => {
  const previous = Array.from({ length: 4 }, (_, index) => ({
    ...taskInstance(`task-${index}`, 'RUNNING'), executionRunId: `run-${index}`,
  }));
  const next = previous.map((instance) => ({ ...instance, status: 'INTERRUPTED' }));
  const runSnapshot = (markerIndex = -1) => previous.map((instance, index) => ({
    id: `run-${index}`, projectId: 'project-1', status: 'INTERRUPTED',
    processTaskRef: { processPlanId: 'plan-1', revision: 1, planInstanceId: 'instance-1', taskId: instance.taskId },
    execution: markerIndex === index ? { providerDiagnostic: { outcome: 'outcome_unknown' } } : {},
  }));
  const plans = [{ id: 'plan-1', revision: 1, tasks: previous.map((instance) => ({ id: instance.taskId, title: `Task ${instance.taskId}` })) }];
  const announcement = processInstanceStatusAnnouncement(previous, next, plans, runSnapshot(-1), runSnapshot(3));
  assert.match(announcement, /Task task-3: Outcome unknown\./);
  assert.match(announcement, /and 1 more/);
});

test('cross-session task status announcement uses the matching plan revision title', () => {
  const plans = [{ id: 'plan-1', revision: 2, tasks: [{ id: 'task-a', title: 'Prepare deliverables' }] }];
  const previous = [taskInstance('task-a', 'ESCALATED', 'instance-1', 'plan-1', 2)];
  const next = [taskInstance('task-a', 'IN_PROGRESS', 'instance-1', 'plan-1', 2)];
  assert.equal(processInstanceStatusAnnouncement(previous, next, plans),
    'Prepare deliverables changed from escalated to in progress.');
});

test('cross-session multiple task transitions have a bounded readable summary', () => {
  const previous = Array.from({ length: 5 }, (_, index) => taskInstance(`task-${index}`, 'PLANNED'));
  const next = previous.map((instance) => ({ ...instance, status: 'IN_PROGRESS' }));
  const plans = [{ id: 'plan-1', revision: 1, tasks: previous.map(({ taskId }) => ({ id: taskId, title: `Task ${taskId}` })) }];
  assert.equal(processInstanceStatusAnnouncement(previous, next, plans, [], [], 2),
    '5 process tasks changed status: Task task-0 changed from planned to in progress; Task task-1 changed from planned to in progress; and 3 more.');
});

test('cross-session task status announcements keep separate plan instance identities distinct', () => {
  const previous = [taskInstance('task-a', 'ESCALATED', 'instance-old')];
  const next = [taskInstance('task-a', 'IN_PROGRESS', 'instance-new')];
  assert.equal(processInstanceStatusAnnouncement(previous, next), '');
});
