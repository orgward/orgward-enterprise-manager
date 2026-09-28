const statusLabels = Object.freeze({
  APPROVED: 'Approved',
  PAUSED: 'Paused',
  RUNNING: 'Running',
  SUCCEEDED: 'Succeeded',
  FAILED: 'Failed',
  INTERRUPTED: 'Interrupted',
  CANCELLED: 'Cancelled',
});

export function linkedRunActivityLabel(run) {
  if (!run || typeof run.id !== 'string' || !run.id.trim()) return null;
  if (run.status === 'AWAITING_APPROVAL') return `Approval request ${run.id} · Awaiting approval`;
  const statusLabel = typeof run.status === 'string' && Object.hasOwn(statusLabels, run.status)
    ? statusLabels[run.status] : 'Status unavailable';
  return `Linked run ${run.id} · ${statusLabel}`;
}
