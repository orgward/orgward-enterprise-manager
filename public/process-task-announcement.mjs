export function processTaskStatusAnnouncement(previousStatus, nextStatus) {
  return previousStatus !== undefined && previousStatus !== 'BLOCKED' && nextStatus === 'BLOCKED';
}

export const PROCESS_TASK_ANNOUNCEMENT_DELAY_MS = 500;
let processTaskAnnouncementRevision = 0;

export function scheduleProcessTaskAnnouncement(liveRegion, announcement, { schedule = setTimeout, isCurrent = () => true } = {}) {
  if (!liveRegion || typeof announcement !== 'string' || !announcement) return null;
  const revision = ++processTaskAnnouncementRevision;
  liveRegion.textContent = '';
  return schedule(() => {
    if (revision === processTaskAnnouncementRevision && isCurrent()) liveRegion.textContent = announcement;
  }, PROCESS_TASK_ANNOUNCEMENT_DELAY_MS);
}

export function summarizeBlockedTaskTransitions(transitions) {
  if (!transitions.length) return null;

  const causes = new Map();
  for (const transition of transitions) {
    for (const dependency of transition) {
      const key = `${dependency.taskId}\n${dependency.status}`;
      if (!causes.has(key)) causes.set(key, dependency);
    }
  }

  const causeList = [...causes.values()];
  const visibleCauses = causeList.slice(0, 3).map(({ title, taskId, status }) =>
    `${title ?? taskId} (${status.replaceAll('_', ' ').toLowerCase()})`);
  const remaining = causeList.length - visibleCauses.length;
  const reason = visibleCauses.length
    ? ` after ${visibleCauses.join(', ')}${remaining ? ` and ${remaining} more prerequisite${remaining === 1 ? '' : 's'}` : ''}`
    : ' after an upstream prerequisite ended without success';
  const taskCount = transitions.length;
  const taskPhrase = taskCount === 1 ? '1 task became blocked' : `${taskCount} tasks became blocked`;
  return `${taskPhrase}${reason}. Start a new process instance from the first task to retry the workflow; saved outcomes and evidence remain available.`;
}
