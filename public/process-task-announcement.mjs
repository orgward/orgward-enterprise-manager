export function processTaskStatusAnnouncement(previousStatus, nextStatus) {
  return previousStatus !== undefined && previousStatus !== 'BLOCKED' && nextStatus === 'BLOCKED';
}

export const PROCESS_TASK_ANNOUNCEMENT_DELAY_MS = 500;
const liveRegionAnnouncementState = new WeakMap();

export function scheduleLiveRegionAnnouncement(liveRegion, announcement, { schedule = setTimeout, isCurrent = () => true } = {}) {
  if (!liveRegion || typeof announcement !== 'string' || !announcement) return null;
  const previous = liveRegionAnnouncementState.get(liveRegion);
  if (previous?.announcement === announcement && previous.state === 'pending') return null;
  if (previous?.announcement === announcement && previous.state === 'announced'
    && liveRegion.textContent === announcement) return null;
  const revision = (previous?.revision ?? 0) + 1;
  liveRegion.textContent = '';
  const next = { revision, announcement, state: 'pending', timer: null };
  liveRegionAnnouncementState.set(liveRegion, next);
  next.timer = schedule(() => {
    const current = liveRegionAnnouncementState.get(liveRegion);
    if (current?.revision !== revision || current.announcement !== announcement || current.state !== 'pending') return;
    if (!isCurrent()) {
      liveRegionAnnouncementState.set(liveRegion, { revision, announcement: null, state: 'stale', timer: null });
      return;
    }
    liveRegion.textContent = announcement;
    liveRegionAnnouncementState.set(liveRegion, { revision, announcement, state: 'announced', timer: null });
  }, PROCESS_TASK_ANNOUNCEMENT_DELAY_MS);
  return next.timer;
}

export function cancelLiveRegionAnnouncement(liveRegion) {
  if (!liveRegion) return false;
  const previous = liveRegionAnnouncementState.get(liveRegion);
  const changed = previous?.state === 'pending' || liveRegion.textContent !== '';
  liveRegionAnnouncementState.set(liveRegion, {
    revision: (previous?.revision ?? 0) + 1, announcement: null, state: 'cancelled', timer: null,
  });
  if (liveRegion.textContent !== '') liveRegion.textContent = '';
  return Boolean(changed);
}

export function scheduleProcessTaskAnnouncement(liveRegion, announcement, options = {}) {
  return scheduleLiveRegionAnnouncement(liveRegion, announcement, options);
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
