import { digest } from './contracts.mjs';

const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,79}$/;
const TYPES = new Set(['BUSINESS', 'TECHNICAL', 'GUARDRAIL']);
const PRIORITIES = new Set(['MUST', 'SHOULD', 'COULD']);
const SCOPE_TYPES = new Set(['process', 'capability', 'system', 'resource']);

export function requirementCriterionSources(trace) {
  if (!trace) return [];
  const refs = [{ id: trace.process.id, type: 'process', snapshotHash: trace.source.processSnapshotHash }];
  const append = (items, type) => (items ?? []).forEach((entry) => refs.push({ ...entry, type: entry.type ?? type }));
  append(trace.process.inputs, 'input'); append(trace.process.outputs, 'output');
  append(trace.scope.capabilityRefs, 'capability'); append(trace.scope.systemRefs, 'system');
  append(trace.scope.resourceRefs, 'resource'); append(trace.risk.refs, 'risk');
  append(trace.outcome.outputRefs, 'output'); append(trace.outcome.metricRefs, 'metric');
  const byId = new Map();
  for (const ref of refs) if (ref?.id && ref?.type && /^[a-f0-9]{64}$/.test(ref.snapshotHash ?? '')) byId.set(ref.id, ref);
  return [...byId.values()].map(({ id, type, snapshotHash }) => ({ id, type, snapshotHash }));
}

export function createRequirementCriterionContract({ requirement, request }) {
  const prior = requirement.criterionContract ?? null;
  const priorVersion = prior?.version ?? 0;
  if (!request || Object.keys(request).some((key) => !['schemaVersion', 'version', 'criteria'].includes(key))
    || request.schemaVersion !== 1 || request.version !== priorVersion + 1
    || !Array.isArray(request.criteria) || request.criteria.length !== requirement.acceptanceCriteria?.length
    || request.criteria.length < 1 || request.criteria.length > 32) {
    throw new Error('Provide a new version with one typed definition for each exact acceptance criterion.');
  }
  const sources = new Map(requirementCriterionSources(requirement.processTrace).map((entry) => [entry.id, entry]));
  const ids = new Set();
  const priorFloor = new Set(prior?.mandatoryFloor ?? []);
  const priorCriteria = new Map((prior?.criteria ?? []).map((entry) => [entry.id, entry]));
  const criteria = request.criteria.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).some((key) => !['id', 'text', 'type', 'mandatory', 'sourceRefId', 'scopeRefId'].includes(key))) {
      throw new Error('A criterion definition contains unsupported fields.');
    }
    const source = sources.get(entry.sourceRefId); const scope = sources.get(entry.scopeRefId);
    const old = priorCriteria.get(entry.id);
    if (!ID.test(entry.id ?? '') || ids.has(entry.id) || entry.text !== requirement.acceptanceCriteria[index]
      || typeof entry.text !== 'string' || !entry.text.trim() || !TYPES.has(entry.type)
      || typeof entry.mandatory !== 'boolean' || !source || !scope || !SCOPE_TYPES.has(scope.type)
      || (old && (entry.text !== old.text || entry.type !== old.type
        || digest(source) !== digest(old.source) || digest(scope) !== digest(old.scope)
        || (old.mandatory && !entry.mandatory)))
      || (requirement.priority === 'MUST' && !entry.mandatory)
      || (entry.type === 'GUARDRAIL' && (!entry.mandatory || source.type !== 'risk'))
      || (priorFloor.has(entry.id) && !entry.mandatory)) {
      throw new Error('Criterion identity, exact text, type, mandatory floor, source, or scope is invalid.');
    }
    ids.add(entry.id);
    return { id: entry.id, text: entry.text, type: entry.type, mandatory: entry.mandatory,
      source: structuredClone(source), scope: structuredClone(scope) };
  });
  for (const id of priorCriteria.keys()) if (!ids.has(id)) throw new Error('A versioned criterion cannot be removed; preserve it or use a separately reviewed supersession workflow.');
  for (const id of priorFloor) if (!ids.has(id)) throw new Error('A previously mandatory criterion cannot be removed from the obligation floor.');
  const mandatoryFloor = [...new Set([...priorFloor, ...criteria.filter((entry) => entry.mandatory).map((entry) => entry.id)])].sort();
  if (!PRIORITIES.has(requirement.priority)) throw new Error('Requirement priority is not a supported versioned obligation state.');
  const core = { schemaVersion: 1, version: request.version, requirementId: requirement.id,
    priority: requirement.priority, acceptanceCriteria: [...requirement.acceptanceCriteria],
    draftRevision: requirement.draftRevision + 1, criteria, mandatoryFloor, status: 'OWNER_VERSIONED' };
  return { ...core, contentHash: digest(core) };
}

export function verifyRequirementCriterionContract(requirement, contract = requirement?.criterionContract, { historical = false } = {}) {
  if (!contract) return false;
  const { contentHash, ...core } = contract;
  if (contract.schemaVersion !== 1 || !Number.isSafeInteger(contract.version) || contract.version < 1
    || contract.requirementId !== requirement.id || contract.status !== 'OWNER_VERSIONED'
    || !PRIORITIES.has(contract.priority) || !Array.isArray(contract.acceptanceCriteria)
    || contract.acceptanceCriteria.some((text) => typeof text !== 'string' || !text.trim())
    || !Number.isSafeInteger(contract.draftRevision) || contract.draftRevision < 1
    || !Array.isArray(contract.criteria) || contract.criteria.length !== contract.acceptanceCriteria.length
    || (!historical && (contract.priority !== requirement.priority
      || digest(contract.acceptanceCriteria) !== digest(requirement.acceptanceCriteria ?? [])))
    || !Array.isArray(contract.mandatoryFloor) || digest(core) !== contentHash) return false;
  const sources = new Map(requirementCriterionSources(requirement.processTrace).map((entry) => [entry.id, entry]));
  const ids = new Set();
  const valid = contract.criteria.every((entry, index) => {
    if (!ID.test(entry.id ?? '') || ids.has(entry.id) || entry.text !== contract.acceptanceCriteria[index]
      || !TYPES.has(entry.type) || typeof entry.mandatory !== 'boolean'
      || (contract.priority === 'MUST' && !entry.mandatory)
      || (entry.type === 'GUARDRAIL' && (!entry.mandatory || entry.source?.type !== 'risk'))
      || !entry.scope || !SCOPE_TYPES.has(entry.scope.type)
      || !entry.source || !entry.scope || digest(sources.get(entry.source.id) ?? null) !== digest(entry.source)
      || digest(sources.get(entry.scope.id) ?? null) !== digest(entry.scope)) return false;
    ids.add(entry.id); return true;
  });
  const requiredFloor = contract.criteria.filter((entry) => entry.mandatory).map((entry) => entry.id).sort();
  const currentById = new Map(contract.criteria.map((entry) => [entry.id, entry]));
  return valid && contract.mandatoryFloor.every((id) => currentById.get(id)?.mandatory === true)
    && requiredFloor.every((id) => contract.mandatoryFloor.includes(id));
}
