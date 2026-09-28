const HUMAN_TASK_EVENT_LABELS = Object.freeze({
  HumanTaskStarted: { label: 'Started', actor: 'assigned human' },
  HumanTaskCompleted: { label: 'Completed', actor: 'assigned human' },
  HumanTaskEscalated: { label: 'Escalated to project owner', actor: 'assigned human' },
  HumanTaskEscalationResolved: { label: 'Owner resolution', actor: 'project owner' },
});

const MAX_HISTORY_EVENTS = 100;
const MAX_TEXT_LENGTH = 1000;
const MAX_EVIDENCE_COUNT = 20;
const MAX_TIMESTAMP_LENGTH = 64;
const HUMAN_OUTCOMES = new Set(['resume', 'reassign', 'succeeded', 'failed']);

function safeText(value, maximumLength = MAX_TEXT_LENGTH) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maximumLength) : null;
}

function safeEvidence(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_EVIDENCE_COUNT).flatMap((entry) => {
    const text = safeText(entry);
    return text ? [text] : [];
  });
}

export function humanTaskHistoryEntries(events) {
  if (!Array.isArray(events)) return [];
  return events.slice(-MAX_HISTORY_EVENTS).flatMap((event) => {
    if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string'
      || typeof event.at !== 'string' || event.at.length > MAX_TIMESTAMP_LENGTH) return [];
    if (!Object.hasOwn(HUMAN_TASK_EVENT_LABELS, event.type) || !Number.isFinite(Date.parse(event.at))) return [];
    const presentation = HUMAN_TASK_EVENT_LABELS[event.type];
    const data = event.data && typeof event.data === 'object' && !Array.isArray(event.data) ? event.data : {};
    const result = event.type === 'HumanTaskCompleted' ? data.result
      : event.type === 'HumanTaskEscalationResolved' && data.ownerAction !== 'reassign' ? data.disposition : null;
    const label = event.type === 'HumanTaskEscalationResolved' && data.ownerAction === 'reassign'
      ? 'Owner reassigned task' : presentation.label;
    const reason = safeText(data.reason);
    return [{
      at: event.at,
      label,
      actor: presentation.actor,
      ...(typeof result === 'string' && HUMAN_OUTCOMES.has(result) ? { result } : {}),
      ...(reason ? { reason } : {}),
      evidence: safeEvidence(data.evidence),
    }];
  });
}
