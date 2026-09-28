const INSTANCE_CONTROL_ACTORS = Object.freeze({
  ProcessTaskInstancePauseRequested: 'authorized controller',
  ProcessTaskInstancePaused: 'authorized controller',
  ProcessTaskInstanceResumed: 'authorized controller',
  ProcessTaskInstanceAbandonedUnverified: 'project owner',
  ProcessTaskInstanceCancelled: 'authorized controller',
});

const MAX_HISTORY_EVENTS = 100;
const MAX_REASON_LENGTH = 1000;
const MAX_EVIDENCE_COUNT = 20;
const MAX_EVIDENCE_LENGTH = 1000;
const MAX_REFERENCE_COUNT = 20;
const MAX_REFERENCE_LENGTH = 160;
const MAX_TIMESTAMP_LENGTH = 64;

function safeText(value, maximumLength) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maximumLength) : null;
}

function safeStringList(value, maximumCount = MAX_EVIDENCE_COUNT, maximumLength = MAX_EVIDENCE_LENGTH) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maximumCount).flatMap((entry) => {
    const text = safeText(entry, maximumLength);
    return text ? [text] : [];
  });
}

export function processInstanceControlHistoryEntries(events) {
  if (!Array.isArray(events)) return [];
  return events.slice(-MAX_HISTORY_EVENTS).flatMap((event) => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) return [];
    if (typeof event.type !== 'string' || !Object.hasOwn(INSTANCE_CONTROL_ACTORS, event.type)
      || typeof event.at !== 'string' || event.at.length > MAX_TIMESTAMP_LENGTH
      || !Number.isFinite(Date.parse(event.at))) return [];
    const actor = INSTANCE_CONTROL_ACTORS[event.type];
    const data = event.data && typeof event.data === 'object' && !Array.isArray(event.data) ? event.data : {};
    const unverifiedAbandonment = event.type === 'ProcessTaskInstanceAbandonedUnverified';
    const reason = safeText(data.reason, MAX_REASON_LENGTH);
    return [{
      type: event.type,
      actor: event.actor === 'system' ? 'system' : actor,
      at: event.at,
      ...(reason ? { reason } : {}),
      ...(unverifiedAbandonment ? {
        runIds: safeStringList(data.runIds, MAX_REFERENCE_COUNT, MAX_REFERENCE_LENGTH),
        attemptIds: safeStringList(data.attemptIds, MAX_REFERENCE_COUNT, MAX_REFERENCE_LENGTH),
        evidence: safeStringList(data.evidence),
        acknowledgeDuplicateCostWork: data.acknowledgeDuplicateCostWork === true,
      } : {}),
    }];
  });
}
