const TASK_STATUSES = new Set([
  'PLANNED', 'IN_PROGRESS', 'ESCALATED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CANCELLED',
]);
const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CANCELLED']);
const CONTROL_STATUSES = new Set(['ACTIVE', 'PAUSE_REQUESTED', 'PAUSED', 'CANCELLED', 'ABANDONED_UNVERIFIED']);

function taskStatusSummary(runtimes) {
  const statuses = runtimes.map((runtime) => runtime.status);
  if (!statuses.length || statuses.some((status) => !TASK_STATUSES.has(status))) return 'Status unavailable';
  if (statuses.every((status) => status === 'SUCCEEDED')) return 'Succeeded';
  if (statuses.every((status) => status === 'CANCELLED')) return 'Cancelled';
  if (statuses.every((status) => status === 'INTERRUPTED')) return 'Interrupted';
  if (statuses.every((status) => status === 'FAILED')) return 'Failed';
  if (statuses.includes('RUNNING')) return 'Running';
  if (statuses.includes('ESCALATED')) return 'Escalated';
  if (statuses.includes('IN_PROGRESS')) return 'In progress';
  if (statuses.some((status) => TERMINAL_STATUSES.has(status))) {
    return statuses.every((status) => TERMINAL_STATUSES.has(status)) ? 'Mixed results' : 'Partially complete';
  }
  if (statuses.every((status) => status === 'PLANNED')) return 'Not started';
  return 'Status unavailable';
}

function activityLabel(runtimes, nowMs) {
  const timestamps = [];
  for (const runtime of runtimes) {
    for (const value of [runtime.updatedAt, runtime.completedAt, runtime.startedAt, runtime.createdAt]) {
      if (typeof value !== 'string') continue;
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) timestamps.push(parsed);
    }
    const controlEvents = runtime.instanceControl?.events;
    for (const event of Array.isArray(controlEvents) ? controlEvents : []) {
      if (typeof event?.at !== 'string') continue;
      const parsed = Date.parse(event.at);
      if (Number.isFinite(parsed)) timestamps.push(parsed);
    }
  }
  if (!timestamps.length || !Number.isFinite(nowMs)) return 'activity time unavailable';
  const latest = Math.max(...timestamps);
  const difference = nowMs - latest;
  if (difference < -60_000) return 'activity time unavailable';
  const minutes = Math.floor(Math.max(0, difference) / 60_000);
  if (minutes < 1) return 'updated just now';
  if (minutes < 60) return `updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `updated ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `updated ${days}d ago`;
  const date = new Date(latest);
  return `updated ${new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date)}`;
}

export function processInstanceOptionLabel(instanceId, runtimes, nowMs = Date.now()) {
  const reference = typeof instanceId === 'string' && instanceId ? instanceId.slice(0, 8) : 'unknown';
  if (!Array.isArray(runtimes) || runtimes.length === 0 || runtimes.some((runtime) => !runtime || typeof runtime !== 'object')) {
    return `Instance ${reference} · Status unavailable · terminal count unavailable · activity time unavailable`;
  }
  const controlStatuses = [...new Set(runtimes.map((runtime) => runtime.instanceControl?.status).filter((status) => status !== undefined && status !== null))];
  const controlStatus = controlStatuses.length === 1 && CONTROL_STATUSES.has(controlStatuses[0]) ? controlStatuses[0] : null;
  const status = controlStatuses.length > 0 && !controlStatus
    ? 'Status unavailable'
    : controlStatus === 'PAUSE_REQUESTED' ? 'Pausing'
      : controlStatus === 'PAUSED' ? 'Paused'
        : controlStatus === 'CANCELLED' ? 'Cancelled'
          : controlStatus === 'ABANDONED_UNVERIFIED' ? 'Unverified'
            : taskStatusSummary(runtimes);
  const validTaskStatuses = runtimes.every((runtime) => TASK_STATUSES.has(runtime.status));
  const terminal = runtimes.filter((runtime) => TERMINAL_STATUSES.has(runtime.status)).length;
  const terminalLabel = validTaskStatuses ? `${terminal}/${runtimes.length} terminal` : 'terminal count unavailable';
  return `Instance ${reference} · ${status} · ${terminalLabel} · ${activityLabel(runtimes, nowMs)}`;
}
