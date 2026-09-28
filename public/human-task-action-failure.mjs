export function humanTaskActionFailureDisposition(error) {
  if (error?.retryable) return 'retry';
  if (['INVALID_HUMAN_TASK_OUTCOME', 'INVALID_HUMAN_TASK_ESCALATION'].includes(error?.code)) return 'notify';
  if (error?.status === 409) return 'reconcile';
  return 'notify';
}
