import { digest } from '../sdlc/contracts.mjs';
import { enterpriseFailure } from './types.mjs';

export const ENTERPRISE_STATE_VALUES = {
  lifecycle: ['UNKNOWN', 'PLANNED', 'ACTIVE', 'RETIRED'],
  review: ['UNREVIEWED', 'ACCEPTED', 'REJECTED'],
  implementation: ['UNKNOWN', 'NOT_IMPLEMENTED', 'IMPLEMENTED_UNVERIFIED'],
  observation: ['UNKNOWN', 'NOT_OBSERVED', 'OBSERVED_UNVERIFIED'],
};
export function enterpriseStateErrors(objects) {
  const errors = [];
  for (const object of objects) {
    if (object.enterpriseStates === undefined) continue;
    const states = object.enterpriseStates;
    if (!states || typeof states !== 'object' || Array.isArray(states)
      || Object.keys(states).some((dimension) => !Object.hasOwn(ENTERPRISE_STATE_VALUES, dimension))) {
      errors.push({ code: 'INVALID_ENTERPRISE_STATE', path: object.id, message: 'State reports must use the four supported independent dimensions.' }); continue;
    }
    for (const [dimension, saved] of Object.entries(states)) {
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)
        || !ENTERPRISE_STATE_VALUES[dimension].includes(saved.value)
        || saved.evidenceKind !== (dimension === 'review' ? 'HUMAN_REVIEW' : 'HUMAN_REPORTED')
        || !/^[a-f0-9]{64}$/.test(saved.basisHash ?? '') || typeof saved.recordedBy !== 'string'
        || !Number.isFinite(Date.parse(saved.recordedAt)) || typeof saved.reason !== 'string' || !saved.reason.trim()
        || typeof saved.evidenceSummary !== 'string') {
        errors.push({ code: 'INVALID_ENTERPRISE_STATE', path: `${object.id}.${dimension}`, message: 'The independent state report lacks supported values and declared report provenance.' });
      }
    }
  }
  return errors;
}
export function objectBasisHash(object) {
  const { enterpriseStates, provenance, ...meaning } = object;
  return digest(meaning);
}
export function objectStates(object) {
  if (enterpriseStateErrors([object]).length) throw enterpriseFailure('INVALID_ENTERPRISE_STATE', 'The saved design state report is malformed.', 409);
  const basisHash = objectBasisHash(object);
  return { basisHash, ...Object.fromEntries(Object.keys(ENTERPRISE_STATE_VALUES).map((dimension) => {
    const saved = object.enterpriseStates?.[dimension];
    const unknown = dimension === 'review' ? 'UNREVIEWED' : 'UNKNOWN';
    const stale = Boolean(saved && saved.basisHash !== basisHash);
    return [dimension, saved ? { ...structuredClone(saved), value: stale ? unknown : saved.value, stale,
      ...(stale ? { priorValue: saved.value } : {}) } : { value: unknown, evidenceKind: 'UNKNOWN', recordedBy: null,
      recordedAt: null, reason: '', evidenceSummary: '', basisHash, stale: false }];
  })) };
}
export function enterpriseInstant(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw enterpriseFailure('INVALID_ENTERPRISE_TIME', `${label} must be a valid UTC ISO instant.`);
  }
  return new Date(value).toISOString();
}
export function enterpriseInterval(from, to) {
  const effectiveFrom = from === null ? null : enterpriseInstant(from, 'Effective start');
  const effectiveTo = to === null ? null : enterpriseInstant(to, 'Effective end');
  if ((!effectiveFrom && effectiveTo) || (effectiveFrom && effectiveTo && effectiveTo <= effectiveFrom)) {
    throw enterpriseFailure('INVALID_ENTERPRISE_INTERVAL', 'Provide an effective start before the optional exclusive end, or explicit unknown dates.');
  }
  return { effectiveFrom, effectiveTo };
}
export function effectiveStatus(blueprint, instant) {
  const validity = blueprint?.enterpriseValidity;
  if (!validity?.effectiveFrom) return 'UNKNOWN';
  const at = Date.parse(instant); const from = Date.parse(validity.effectiveFrom);
  const to = validity.effectiveTo ? Date.parse(validity.effectiveTo) : null;
  if (!Number.isFinite(at) || !Number.isFinite(from) || (to !== null && !Number.isFinite(to))) return 'UNKNOWN';
  return at >= from && (to === null || at < to) ? 'IN_RANGE' : 'OUT_OF_RANGE';
}
