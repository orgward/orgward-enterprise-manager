import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  PROCESS_TASK_ANNOUNCEMENT_DELAY_MS,
  processTaskStatusAnnouncement,
  scheduleProcessTaskAnnouncement,
  summarizeBlockedTaskTransitions,
} from '../../public/process-task-announcement.mjs';

test('announces a single newly blocked task with one recovery instruction', () => {
  assert.equal(processTaskStatusAnnouncement(undefined, 'BLOCKED'), false,
    'initial rendering is already available to the user and should not add a second announcement');
  assert.equal(processTaskStatusAnnouncement('IN_PROGRESS', 'BLOCKED'), true);
  assert.equal(processTaskStatusAnnouncement('BLOCKED', 'BLOCKED'), false,
    'unchanged refreshes must not repeat the announcement');
  assert.equal(processTaskStatusAnnouncement('BLOCKED', 'IN_PROGRESS'), false);
  assert.equal(processTaskStatusAnnouncement('IN_PROGRESS', 'BLOCKED'), true,
    'a later distinct transition is announced again');

  assert.equal(summarizeBlockedTaskTransitions([[{ taskId: 'intake', title: 'Intake', status: 'FAILED' }]]),
    '1 task became blocked after Intake (failed). Start a new process instance from the first task to retry the workflow; saved outcomes and evidence remain available.');
});

test('summarizes multiple newly blocked tasks once and deduplicates their causes', () => {
  const summary = summarizeBlockedTaskTransitions([
    [{ taskId: 'intake', title: 'Intake', status: 'FAILED' }],
    [
      { taskId: 'intake', title: 'Intake', status: 'FAILED' },
      { taskId: 'approval', title: 'Approval', status: 'INTERRUPTED' },
    ],
  ]);

  assert.equal(summary,
    '2 tasks became blocked after Intake (failed), Approval (interrupted). Start a new process instance from the first task to retry the workflow; saved outcomes and evidence remain available.');
  assert.equal((summary.match(/Start a new process instance/g) ?? []).length, 1);
  assert.equal((summary.match(/Intake \(failed\)/g) ?? []).length, 1);
});

test('defers the polite update until after the plan DOM refresh settles', () => {
  const liveRegion = { textContent: '' };
  const scheduled = [];
  const schedule = (callback, milliseconds) => { scheduled.push({ callback, milliseconds }); return scheduled.length; };
  scheduleProcessTaskAnnouncement(liveRegion, '3 tasks became blocked. Retry from the first task.', { schedule });

  assert.equal(liveRegion.textContent, '', 'the live region stays quiet while refreshed task rows are being announced');
  assert.equal(scheduled[0].milliseconds, PROCESS_TASK_ANNOUNCEMENT_DELAY_MS);
  assert.equal(scheduled[0].milliseconds, 500);
  scheduled[0].callback();
  assert.equal(liveRegion.textContent, '3 tasks became blocked. Retry from the first task.');
});

test('drops stale or superseded blocked summaries before they reach the live region', () => {
  const liveRegion = { textContent: '' };
  const scheduled = [];
  const schedule = (callback) => { scheduled.push(callback); return scheduled.length; };
  let currentInstance = 'instance-a';
  scheduleProcessTaskAnnouncement(liveRegion, 'Old instance became blocked.', {
    schedule, isCurrent: () => currentInstance === 'instance-a',
  });
  scheduleProcessTaskAnnouncement(liveRegion, 'Current instance became blocked.', {
    schedule, isCurrent: () => currentInstance === 'instance-b',
  });

  scheduled[0]();
  assert.equal(liveRegion.textContent, '', 'a superseded callback cannot announce stale context');
  currentInstance = 'instance-a';
  scheduled[1]();
  assert.equal(liveRegion.textContent, '', 'a changed project or instance context suppresses its pending summary');
  currentInstance = 'instance-b';
  scheduled[1]();
  assert.equal(liveRegion.textContent, 'Current instance became blocked.');
});

test('wires the transition announcer outside the repeatedly rendered plan region', async () => {
  const source = await readFile(new URL('../../public/execution.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../../public/execution.html', import.meta.url), 'utf8');

  assert.match(source, /processTaskStatusAnnouncement\(previousStatus, runtimeState\.status\)/);
  assert.match(source, /processInstanceStatusAnnouncement\(state\.taskInstances, instances, processPlansFor\(projectSnapshot\),\s*currentProjectRuns, projectRuns\)/,
    'cross-session announcements resolve task titles against the same project snapshot being applied');
  assert.match(source, /summarizeBlockedTaskTransitions\(blockedAnnouncements\)/);
  assert.ok(source.includes('scheduleProcessTaskAnnouncement'),
    'the served Execution client uses the tested deferred announcer');
  assert.match(source, /blockedDependencyText/,
    'the full per-task recovery instructions remain visible in the rendered task row');
  assert.match(source, /state\.processTaskStatuses\.set\(statusKey, runtimeState\.status\)/);
  assert.match(html, /id="process-plans" aria-live="off"/);
  assert.match(html, /id="execution-announcement"[^>]*role="status" aria-live="polite" aria-atomic="true"/);
  assert.ok(html.indexOf('</main>') < html.indexOf('id="execution-announcement"'),
    'the isolated live region must not be nested in the broadly refreshed execution content');
});
