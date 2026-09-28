export function isCurrentSelectedRunRefresh({ requestId, currentRequestId, runId, currentRunId, routeRunId,
  projectId, currentProjectId, routeProjectId }) {
  return requestId === currentRequestId && runId === currentRunId && runId === routeRunId
    && projectId === currentProjectId && projectId === routeProjectId;
}

export function selectedRunRefreshDisposition({ currentRun, nextRun, container, documentRef }) {
  if (!currentRun || !nextRun || currentRun.id !== nextRun.id
    || Number(nextRun.version) < Number(currentRun.version)) return 'stale';
  if (JSON.stringify(currentRun) === JSON.stringify(nextRun)) return 'unchanged';
  if (Number(nextRun.version) <= Number(currentRun.version)) return 'stale';
  for (const control of container?.querySelectorAll('input, textarea, select') ?? []) {
    if (control.disabled) continue;
    if (control.type === 'checkbox' || control.type === 'radio') {
      if (control.checked !== control.defaultChecked) return 'defer-dirty';
    } else if (control.tagName === 'SELECT') {
      if ([...control.options].some((option) => option.selected !== option.defaultSelected)) return 'defer-dirty';
    } else if (control.value !== control.defaultValue) return 'defer-dirty';
  }
  const active = documentRef?.activeElement;
  if (active && active !== documentRef.body && container?.contains(active)) return 'defer-focus';
  return 'apply';
}

export function selectedRunStatusAnnouncement(currentRun, nextRun) {
  if (!currentRun || !nextRun || currentRun.id !== nextRun.id || currentRun.status === nextRun.status) return '';
  const display = (status) => String(status ?? '').replaceAll('_', ' ').toLowerCase();
  return `${nextRun.title || 'Execution run'} changed from ${display(currentRun.status)} to ${display(nextRun.status)}.`;
}

export function selectedRunRefreshMessage(disposition) {
  if (disposition === 'defer-dirty') return 'A run update is waiting. Save or discard your current edit to show it.';
  if (disposition === 'defer-focus') return 'A run update is waiting. Move focus outside the run details to show it.';
  return '';
}
