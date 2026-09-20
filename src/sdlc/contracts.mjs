import { createHash, randomUUID } from 'node:crypto';

export const CASE_STATUSES = ['DRAFT', 'RUNNING', 'BLOCKED', 'NEEDS_HUMAN', 'PASSED', 'FAILED', 'SUPERSEDED'];

export const STAGES = [
  { id: 'S0', key: 'intake', label: 'Intent', gate: 'G0', gateLabel: 'Intent quality' },
  { id: 'S1', key: 'context', label: 'Context', gate: 'G1', gateLabel: 'Context sufficiency' },
  { id: 'S2', key: 'impact', label: 'Impact', gate: 'G2', gateLabel: 'Impact completeness' },
  { id: 'S3', key: 'governance', label: 'Governance', gate: 'G3', gateLabel: 'Governance applicability' },
  { id: 'S4', key: 'requirements', label: 'Requirements', gate: 'G4', gateLabel: 'Requirements quality' },
  { id: 'S5', key: 'architecture', label: 'Architecture', gate: 'G5', gateLabel: 'Architecture conformance' },
  { id: 'S6', key: 'planning', label: 'Plan', gate: 'G6', gateLabel: 'Plan executability' },
  { id: 'S7', key: 'implementation', label: 'Implementation', gate: 'G7', gateLabel: 'Implementation verification' },
  { id: 'S8', key: 'assurance', label: 'Assurance', gate: 'G8', gateLabel: 'Release readiness' },
  { id: 'S9', key: 'release', label: 'Authority & release', gate: 'G9', gateLabel: 'Release authority' },
  { id: 'S10', key: 'observation', label: 'Observation', gate: 'G10', gateLabel: 'Outcome evaluation' },
  { id: 'S11', key: 'learning', label: 'Learning', gate: 'G11', gateLabel: 'Learning integrity' },
];

export const MUTATIONS = {
  none: { label: 'Clean golden scenario', expectedGate: null },
  missing_aml: { label: 'Missing AML/control evidence', expectedGate: 'G1' },
  stale_architecture: { label: 'Stale architecture standard', expectedGate: 'G1' },
  forged_provenance: { label: 'Forged enterprise provenance', expectedGate: 'G1' },
  omitted_reporting: { label: 'Omitted reporting dependency', expectedGate: 'G2' },
  unresolved_interpretation: { label: 'Unresolved regulatory interpretation', expectedGate: 'G3' },
  contradictory_requirement: { label: 'Contradictory requirement', expectedGate: 'G4' },
  direct_database: { label: 'Cross-system database access', expectedGate: 'G5' },
  authority_bypass: { label: 'Authority path bypass', expectedGate: 'G5' },
  missing_rollback: { label: 'Missing rollback design', expectedGate: 'G5' },
  plan_cycle: { label: 'Cyclic delivery plan', expectedGate: 'G6' },
  failing_ci: { label: 'Failing implementation checks', expectedGate: 'G7' },
  artifact_tamper: { label: 'Artifact changed after evaluation', expectedGate: 'G8' },
  unauthorized_release: { label: 'Unauthorized protected release', expectedGate: 'G9' },
  prompt_injection: { label: 'Untrusted prompt injection', expectedGate: null },
};

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function digest(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
}

export function id(prefix) {
  return `${prefix}-${randomUUID()}`;
}

export function now() {
  return new Date().toISOString();
}

export function eventEnvelope(changeCase, type, actor, data = {}, causationId = null) {
  const eventId = id('event');
  return {
    id: eventId,
    type,
    schemaVersion: 1,
    tenantId: changeCase.tenantId,
    actor,
    correlationId: changeCase.correlationId,
    causationId,
    timestamp: now(),
    data,
    contentHash: digest({ type, tenantId: changeCase.tenantId, data }),
  };
}

export function evidence(changeCase, { sourceId, sourceType, objectRef, authority = 'AUTHORITATIVE', freshness = 'CURRENT', classification = 'INTERNAL', content, relevance = 1, provenanceChain = [] }) {
  const value = {
    id: id('evidence'), sourceId, sourceType, objectRef, version: 1, retrievedAt: now(),
    authority, freshness, classification, relevance, provenanceChain, content,
  };
  value.contentHash = digest(content);
  value.tenantId = changeCase.tenantId;
  return value;
}

export function finding(code, severity, message, subjectRef, remediation, evidenceRefs = []) {
  return { id: id('finding'), code, severity, message, subjectRef, remediation, evidenceRefs, confidence: 1 };
}

export function evaluation(definitionRef, subjectRefs, status, findings = [], score = null, evaluatorType = 'DETERMINISTIC') {
  return {
    id: id('evaluation'), definitionRef, definitionVersion: 1, subjectRefs, status, score,
    findings, evidenceRefs: [...new Set(findings.flatMap((entry) => entry.evidenceRefs ?? []))],
    evaluator: { type: evaluatorType, identity: `orgward-${definitionRef}`, version: '1.0.0' },
    traceRef: id('trace'), timestamp: now(),
  };
}

export function safeText(value, max = 2_000) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function stageAt(index) {
  return STAGES[index] ?? null;
}
