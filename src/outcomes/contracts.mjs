import { digest } from '../sdlc/contracts.mjs';

export const OUTCOME_CATEGORIES = ['improvement', 'incident', 'support'];
export const OUTCOME_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED'];
export const OUTCOME_DIMENSIONS = ['technical', 'control', 'business'];
export function outcomeFailure(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode, retryable: false });
}
export function outcomeCommand(input, fields, { version = true } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !fields.includes(key))
    || typeof input.commandId !== 'string' || !/^[a-z0-9][a-z0-9_.:-]{0,159}$/i.test(input.commandId)
    || (version && (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1))) {
    throw outcomeFailure('INVALID_OUTCOME_COMMAND', 'Provide the accepted fields, a stable commandId and the current outcome version.', 400);
  }
}
export function outcomeText(value, label, maximum = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw outcomeFailure('INVALID_OUTCOME_COMMAND', `${label} is required and must be within ${maximum} characters.`, 400);
  }
  return value.trim();
}
export function normalizeOutcomeMeasures(input) {
  if (!Array.isArray(input) || !input.length || input.length > 24) {
    throw outcomeFailure('INVALID_OUTCOME_MEASURES', 'Provide one to 24 technical, control or business measures.', 400);
  }
  const fields = new Set(['id', 'name', 'dimension', 'actual', 'target', 'comparison', 'unit', 'evidenceSummary', 'observedAt']);
  const measures = input.map((measure) => {
    if (!measure || typeof measure !== 'object' || Array.isArray(measure)
      || Object.keys(measure).some((key) => !fields.has(key))
      || typeof measure.id !== 'string' || !/^[a-z0-9][a-z0-9_.:-]{0,79}$/i.test(measure.id)
      || !OUTCOME_DIMENSIONS.includes(measure.dimension) || !['gte', 'lte', 'eq'].includes(measure.comparison)
      || ['actual', 'target'].some((key) => measure[key] != null && (typeof measure[key] !== 'number' || !Number.isFinite(measure[key])))
      || (measure.observedAt != null && (typeof measure.observedAt !== 'string' || !Number.isFinite(Date.parse(measure.observedAt))
        || Date.parse(measure.observedAt) > Date.now() + 60_000))
      || (measure.evidenceSummary != null && (typeof measure.evidenceSummary !== 'string' || measure.evidenceSummary.length > 1000))) {
      throw outcomeFailure('INVALID_OUTCOME_MEASURES', 'Measures need explicit dimensions, numeric values or unknowns, comparison, and bounded dated evidence.', 400);
    }
    const normalized = { id: measure.id, name: outcomeText(measure.name, 'Measure name', 160), dimension: measure.dimension,
      actual: measure.actual ?? null, target: measure.target ?? null, comparison: measure.comparison,
      unit: typeof measure.unit === 'string' ? measure.unit.trim().slice(0, 80) : '',
      evidenceSummary: measure.evidenceSummary?.trim() ?? '',
      observedAt: measure.observedAt ? new Date(measure.observedAt).toISOString() : null };
    const known = normalized.actual !== null && normalized.target !== null && normalized.evidenceSummary && normalized.observedAt;
    const met = normalized.comparison === 'gte' ? normalized.actual >= normalized.target
      : normalized.comparison === 'lte' ? normalized.actual <= normalized.target : normalized.actual === normalized.target;
    return { ...normalized, status: !known ? 'UNKNOWN' : met ? 'MET' : 'NOT_MET', evidenceKind: 'HUMAN_REPORTED' };
  });
  if (new Set(measures.map((measure) => measure.id)).size !== measures.length) {
    throw outcomeFailure('INVALID_OUTCOME_MEASURES', 'Measure IDs must be unique within the observation.', 400);
  }
  return measures;
}
export function outcomeEvaluation(measures = [], observationHash = null) {
  return { ...Object.fromEntries(OUTCOME_DIMENSIONS.map((dimension) => {
    const selected = measures.filter((measure) => measure.dimension === dimension);
    return [dimension, selected.some((measure) => measure.status === 'NOT_MET') ? 'NOT_MET'
      : !selected.length || selected.some((measure) => measure.status === 'UNKNOWN') ? 'UNKNOWN' : 'MET'];
  })), observationHash, evidenceKind: 'HUMAN_REPORTED', measures: structuredClone(measures) };
}
export function learningProposal(input, observationHash, principal, id, at) {
  const core = { id, title: outcomeText(input.title, 'Proposal title', 160),
    recommendation: outcomeText(input.recommendation, 'Recommended change', 2000),
    rationale: outcomeText(input.rationale, 'Learning rationale', 1000), observationHash,
    createdBy: principal, createdAt: at };
  return { ...core, proposalHash: digest(core), status: 'PROPOSED', review: null, followUpCaseId: null,
    followUpSourceSelectionHash: null };
}

export function outcomeImport(bundle) {
  const fail = () => { throw outcomeFailure('INVALID_OUTCOME_IMPORT', 'Choose an intact OrgWard outcome export within one megabyte. Imported evidence does not transfer approval authority.', 400); };
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)
    || Object.keys(bundle).some((key) => !['version', 'projectId', 'outcome', 'exportHash'].includes(key))
    || bundle.version !== 'orgward-outcome-export-v1' || !/^[a-f0-9]{64}$/.test(bundle.exportHash ?? '')
    || Buffer.byteLength(JSON.stringify(bundle)) > 1_000_000) fail();
  const { exportHash, ...envelope } = bundle;
  if (digest(envelope) !== exportHash) fail();
  const original = bundle.outcome;
  if (!original || typeof original !== 'object' || Array.isArray(original)
    || !/^outcome-[0-9a-f-]{36}$/.test(original.id ?? '')
    || !/^project-[0-9a-f-]{36}$/.test(original.projectId ?? '')
    || original.projectId !== bundle.projectId || typeof original.tenantId !== 'string'
    || !original.tenantId || original.tenantId.length > 80
    || !Number.isSafeInteger(original.version) || original.version < 1
    || !OUTCOME_CATEGORIES.includes(original.category)
    || !/^[a-f0-9]{64}$/.test(original.source?.bindingHash ?? '')
    || !Array.isArray(original.observations) || original.observations.length > 500) fail();
  const observations = original.observations.map((observation) => {
    if (!observation || typeof observation !== 'object' || Array.isArray(observation)
      || !/^observation-[0-9a-f-]{36}$/.test(observation.id ?? '')
      || !/^[a-f0-9]{64}$/.test(observation.observationHash ?? '')
      || typeof observation.reportedBy !== 'string' || observation.reportedBy.length > 120
      || typeof observation.recordedAt !== 'string' || !Number.isFinite(Date.parse(observation.recordedAt))
      || observation.evidenceKind !== 'HUMAN_REPORTED'
      || observation.sourceBindingHash !== original.source.bindingHash
      || !Array.isArray(observation.measures)) fail();
    const { observationHash, ...core } = observation;
    if (digest(core) !== observationHash) fail();
    const measures = normalizeOutcomeMeasures(observation.measures.map((measure) => {
      if (!measure || typeof measure !== 'object' || Array.isArray(measure)) fail();
      const { status, evidenceKind, ...input } = measure;
      if (evidenceKind !== 'HUMAN_REPORTED') fail();
      return input;
    }));
    if (new Set(observation.measures.map((measure) => measure.id)).size !== measures.length
      || measures.some((measure, index) => observation.measures[index].status !== measure.status)) fail();
    return { id: observation.id, observationHash, window: outcomeText(observation.window, 'Imported observation window', 200),
      measures, reportedBy: observation.reportedBy, recordedAt: new Date(observation.recordedAt).toISOString(),
      sourceBindingHash: observation.sourceBindingHash };
  });
  if (new Set(observations.map((observation) => observation.id)).size !== observations.length) fail();
  const core = { version: 'orgward-outcome-import-v1', exportHash,
    origin: { tenantId: original.tenantId, projectId: original.projectId, outcomeId: original.id,
      version: original.version, sourceBindingHash: original.source.bindingHash },
    title: outcomeText(original.title, 'Imported outcome title', 160), category: original.category, observations };
  return { ...core, importHash: digest(core) };
}

export function outcomeImportPreview(prepared) {
  const last = prepared.observations.at(-1);
  return { importHash: prepared.importHash, exportHash: prepared.exportHash, origin: prepared.origin,
    title: prepared.title, category: prepared.category, observationCount: prepared.observations.length,
    latestEvaluation: outcomeEvaluation(last?.measures ?? [], last?.observationHash ?? null),
    evidenceKind: 'HUMAN_REPORTED', authorityImported: false };
}
