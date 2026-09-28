const MAX_INPUTS = 20;
const MAX_NAME_BYTES = 512;
const MAX_DETAIL_BYTES = 4096;

const isRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const boundedText = (value, maximumBytes, { empty = true } = {}) => typeof value === 'string'
  && new TextEncoder().encode(value).byteLength <= maximumBytes
  && (empty || Boolean(value.trim()));

function unavailable() {
  return { kind: 'unavailable', label: 'Pinned task inputs are unavailable. Open the saved design to review its exact blueprint version.' };
}

export function humanTaskInputDisclosureKey({ projectId, planId, revision, taskId } = {}) {
  if (![projectId, planId, taskId].every((value) => typeof value === 'string' && value.trim())
    || !Number.isSafeInteger(revision) || revision < 1) return null;
  return [projectId, planId, revision, taskId].map((value) => encodeURIComponent(String(value))).join(':');
}

export function humanTaskInputDisclosureOpen(key, expandedKeys) {
  return Boolean(key && expandedKeys?.has(key));
}

export function rememberHumanTaskInputDisclosure(key, open, expandedKeys) {
  if (!key || !expandedKeys || typeof expandedKeys.add !== 'function' || typeof expandedKeys.delete !== 'function') return;
  if (open) expandedKeys.add(key);
  else expandedKeys.delete(key);
}

export function processTaskHumanInputReview({ task, plan, project } = {}) {
  if (!isRecord(task) || !isRecord(plan) || !isRecord(project)) return null;
  const source = plan.source;
  if (source?.projectId !== project.id || typeof source.blueprintId !== 'string'
    || !source.blueprintId.trim() || !Number.isSafeInteger(source.blueprintVersion) || source.blueprintVersion < 1) return unavailable();

  const blueprints = project.blueprintVersions;
  if (!Array.isArray(blueprints)) return unavailable();
  const blueprint = blueprints.find((entry) => entry?.id === source.blueprintId
    && entry.version === source.blueprintVersion);
  if (!blueprint) return unavailable();
  const objects = Object.values(blueprint.areas ?? {}).flatMap((area) => Array.isArray(area?.items) ? area.items : []);
  const actor = objects.find((entry) => entry?.id === task.assignee?.actorId);
  if (actor?.type !== 'actor-human') return null;

  const inputs = task.inputs;
  if (!Array.isArray(inputs)) return unavailable();
  if (inputs.length > MAX_INPUTS) return unavailable();
  if (inputs.length === 0) return { kind: 'inputs', blueprintVersion: blueprint.version, entries: [] };

  const seen = new Set();
  const entries = [];
  for (const reference of inputs) {
    if (!isRecord(reference) || typeof reference.objectId !== 'string' || !reference.objectId.trim()
      || typeof reference.label !== 'string' || !reference.label.trim()
      || typeof reference.type !== 'string' || !reference.type.trim() || seen.has(reference.objectId)) return unavailable();
    seen.add(reference.objectId);
    const object = objects.find((entry) => entry?.id === reference.objectId);
    if (!object || object.name !== reference.label || object.type !== reference.type
      || !boundedText(object.name, MAX_NAME_BYTES, { empty: false })
      || !boundedText(object.detail, MAX_DETAIL_BYTES)) return unavailable();
    entries.push({ objectId: object.id, type: object.type, name: object.name,
      detail: object.detail.trim() || 'No detail is saved for this input.' });
  }
  return { kind: 'inputs', blueprintVersion: blueprint.version, entries };
}
