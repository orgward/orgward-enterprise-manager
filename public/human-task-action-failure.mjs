export function humanTaskActionFailureDisposition(error) {
  if (error?.retryable) return 'retry';
  if (['INVALID_HUMAN_TASK_OUTCOME', 'INVALID_HUMAN_TASK_ESCALATION'].includes(error?.code)) return 'notify';
  if (error?.status === 409) return 'reconcile';
  return 'notify';
}

export function definitiveHumanTaskStartRejection(error) {
  return Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
    && error.status !== 409 && error.retryable === false;
}
