import { blueprintObjectEditInput, latestBlueprint } from '../model.mjs';
import { digest } from '../sdlc/contracts.mjs';
import { blueprintObjects, enterpriseFailure } from './types.mjs';

export const ENTERPRISE_SOURCE_LIMITS = Object.freeze({ bytes: 1_000_000, records: 500, claimsPerRecord: 25, valueBytes: 12_000 });
const fail = (code, message) => { throw enterpriseFailure(code, message, 400); };
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeId = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9._:-]{0,119}$/i.test(value);
const normalizedName = (value) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
const byteLength = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const referenceFields = {
  strategyGoalIds: ['goal'], servesCustomerIds: ['customer'], enabledByCapabilityIds: ['capability'], capabilityMetricIds: ['metric'],
  capabilityId: ['capability'], inputInformationIds: ['information'], outputInformationIds: ['information'], inputDecisionIds: ['decision'],
  outputDecisionIds: ['decision'], resourceIds: ['resource'], systemIds: ['system'], responsibilityIds: ['goal', 'capability', 'process', 'system'],
  assignedRoleIds: ['role'], decisionMakerRoleId: ['role'], decisionScopeIds: ['goal', 'strategy', 'customer', 'offering', 'economics', 'capability', 'process', 'resource', 'information', 'system', 'risk', 'control', 'metric', 'feedback-loop', 'lifecycle'],
  evidenceMetricIds: ['metric'], feedbackGoalId: ['goal'], feedbackDecisionIds: ['decision'], readInformationId: ['information'],
  consumerLoopId: ['feedback-loop'], mitigatingControlId: ['control'], metricId: ['metric'],
};
export function sourceEvidenceClaimStatus(path, expected, value, byId) {
  const arrayValue = Array.isArray(expected);
  const validType = arrayValue ? Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    : Object.hasOwn(referenceFields, path) ? value === null || typeof value === 'string'
      : expected !== null && value !== null && typeof value === typeof expected;
  if (!validType) return 'TYPE_MISMATCH';
  const allowedTypes = referenceFields[path];
  if (allowedTypes) {
    const values = arrayValue ? value : value === null ? [] : [value];
    if (values.some((id) => !allowedTypes.includes(byId.get(id)?.type))) return 'INVALID_REFERENCE';
  }
  if (path === 'ownerRoleName' && ![...byId.values()].some((object) => object.type === 'role' && object.name === value)) return 'INVALID_REFERENCE';
  return 'PROPOSED';
}

function validateSourceBundle(bundle) {
  if (!plainObject(bundle) || byteLength(bundle) > ENTERPRISE_SOURCE_LIMITS.bytes
    || bundle.kind !== 'orgward-enterprise-source-evidence' || bundle.schemaVersion !== '1.0'
    || Object.keys(bundle).some((key) => !['kind', 'schemaVersion', 'source', 'records'].includes(key))
    || !plainObject(bundle.source) || Object.keys(bundle.source).some((key) => !['id', 'label', 'locator'].includes(key))
    || !safeId(bundle.source.id) || typeof bundle.source.label !== 'string' || !bundle.source.label.trim() || bundle.source.label.length > 160
    || (bundle.source.locator !== undefined && (typeof bundle.source.locator !== 'string' || bundle.source.locator.length > 500))
    || !Array.isArray(bundle.records) || bundle.records.length < 1 || bundle.records.length > ENTERPRISE_SOURCE_LIMITS.records) {
    fail('INVALID_ENTERPRISE_SOURCE_BUNDLE', 'Provide a source-evidence JSON bundle with a named source and 1–500 records, no larger than 1 MB.');
  }
  const recordIds = new Set();
  for (const record of bundle.records) {
    if (!plainObject(record) || Object.keys(record).some((key) => !['id', 'type', 'name', 'claims'].includes(key))
      || !safeId(record.id) || recordIds.has(record.id) || typeof record.type !== 'string' || !record.type.trim() || record.type.length > 80
      || typeof record.name !== 'string' || !record.name.trim() || record.name.length > 240
      || !Array.isArray(record.claims) || record.claims.length > ENTERPRISE_SOURCE_LIMITS.claimsPerRecord) {
      fail('INVALID_ENTERPRISE_SOURCE_RECORD', 'Each source record needs a unique ID, typed name and at most 25 explicit claims.');
    }
    recordIds.add(record.id);
    const claimIds = new Set();
    for (const claim of record.claims) {
      if (!plainObject(claim) || Object.keys(claim).some((key) => !['id', 'path', 'value', 'locator'].includes(key))
        || !safeId(claim.id) || claimIds.has(claim.id) || typeof claim.path !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,119}$/.test(claim.path)
        || !Object.hasOwn(claim, 'value') || byteLength(claim.value) > ENTERPRISE_SOURCE_LIMITS.valueBytes
        || (claim.locator !== undefined && (typeof claim.locator !== 'string' || claim.locator.length > 500))) {
        fail('INVALID_ENTERPRISE_SOURCE_CLAIM', 'Each source claim needs a unique ID, bounded field path, value and optional bounded locator.');
      }
      claimIds.add(claim.id);
    }
  }
}

export function validateEnterpriseSourceEvidenceBundle(bundle) {
  validateSourceBundle(bundle);
  return true;
}

export function enterpriseSourceEvidenceHash(bundle) {
  validateSourceBundle(bundle);
  return digest({ kind: bundle.kind, schemaVersion: bundle.schemaVersion, source: bundle.source, records: bundle.records });
}

export function previewEnterpriseSourceEvidence(project, bundle) {
  validateSourceBundle(bundle);
  const blueprint = latestBlueprint(project);
  if (!blueprint) throw enterpriseFailure('BLUEPRINT_NOT_FOUND', 'Save an initial proposed design before previewing source evidence.', 409);
  const objects = blueprintObjects(blueprint);
  const byId = new Map(objects.map((object) => [object.id, object]));
  const byName = new Map();
  for (const object of objects) {
    const key = `${object.type}\n${normalizedName(object.name ?? '')}`;
    byName.set(key, [...(byName.get(key) ?? []), object]);
  }
  const currentSource = { projectId: project.id, blueprintId: blueprint.id, blueprintVersion: blueprint.version, snapshotHash: digest(blueprint) };
  const sourceHash = enterpriseSourceEvidenceHash(bundle);
  const proposals = bundle.records.map((record) => {
    const key = `${record.type}\n${normalizedName(record.name)}`;
    const candidates = byName.get(key) ?? [];
    const identity = { sourceRecordId: record.id, type: record.type, name: record.name,
      status: candidates.length === 1 ? 'CANDIDATE' : candidates.length > 1 ? 'AMBIGUOUS' : 'UNMATCHED',
      candidateObjectIds: candidates.map((candidate) => candidate.id).sort(),
      provenance: { sourceId: bundle.source.id, sourceLabel: bundle.source.label, sourceHash,
        sourceLocator: bundle.source.locator ?? null, sourceRecordId: record.id, recordLocator: record.id } };
    const target = candidates.length === 1 ? candidates[0] : null;
    const targetFields = target ? Object.fromEntries(Object.entries(blueprintObjectEditInput(blueprint, target))
      .filter(([field]) => field !== 'objectId')) : {};
    const claims = record.claims.map((claim) => ({ id: claim.id, path: claim.path, value: structuredClone(claim.value),
      status: !target ? 'IDENTITY_UNRESOLVED'
        : Object.hasOwn(targetFields, claim.path) ? sourceEvidenceClaimStatus(claim.path, targetFields[claim.path], claim.value, byId) : 'UNKNOWN_FIELD',
      targetObjectId: target?.id ?? null,
      expectedValueType: Object.hasOwn(targetFields, claim.path) ? Array.isArray(targetFields[claim.path])
        ? `${referenceFields[claim.path]?.join(' or ') ?? 'string'} array`
        : Object.hasOwn(referenceFields, claim.path) ? `${referenceFields[claim.path].join(' or ')} ID or null`
          : targetFields[claim.path] === null ? 'unknown' : typeof targetFields[claim.path] : null,
      provenance: { sourceId: bundle.source.id, sourceLabel: bundle.source.label, sourceHash,
        sourceLocator: bundle.source.locator ?? null, sourceRecordId: record.id, recordLocator: record.id,
        claimLocator: claim.locator ?? null } }));
    return { identity, claims };
  });
  const targetIds = proposals.flatMap((proposal) => proposal.identity.status === 'CANDIDATE' ? proposal.identity.candidateObjectIds : []);
  const duplicateTargets = new Set(targetIds.filter((id, index) => targetIds.indexOf(id) !== index));
  const collisions = proposals.flatMap((proposal) => proposal.identity.status === 'AMBIGUOUS'
    ? proposal.identity.candidateObjectIds.map((id) => ({ sourceRecordId: proposal.identity.sourceRecordId, targetObjectId: id, code: 'AMBIGUOUS_CANONICAL_NAME' }))
    : proposal.identity.candidateObjectIds.filter((id) => duplicateTargets.has(id))
      .map((id) => ({ sourceRecordId: proposal.identity.sourceRecordId, targetObjectId: id, code: 'MULTIPLE_SOURCE_RECORDS_MATCH_TARGET' })));
  for (const proposal of proposals) if (proposal.identity.candidateObjectIds.some((id) => duplicateTargets.has(id))) {
    proposal.identity.status = 'COLLISION';
    for (const claim of proposal.claims) { claim.identityResolution = 'COLLISION'; claim.targetObjectId = null; }
  }
  const unknowns = proposals.flatMap((proposal) => [
    ...(proposal.identity.status !== 'CANDIDATE' ? [{ sourceRecordId: proposal.identity.sourceRecordId, kind: 'identity', status: proposal.identity.status }] : []),
    ...proposal.claims.filter((claim) => claim.status !== 'PROPOSED').map((claim) => ({ sourceRecordId: proposal.identity.sourceRecordId,
      claimId: claim.id, path: claim.path, kind: 'claim', status: claim.status,
      identityResolution: claim.identityResolution ?? null, expectedValueType: claim.expectedValueType })),
  ]);
  const core = { mode: 'SOURCE_ONBOARDING_PREVIEW', meaning: 'UNTRUSTED_EVIDENCE_PROPOSALS_ONLY', source: {
      id: bundle.source.id, label: bundle.source.label, locator: bundle.source.locator ?? null, snapshotHash: sourceHash },
    currentSource, recordCount: proposals.length, claimCount: proposals.reduce((sum, entry) => sum + entry.claims.length, 0),
    proposals, unknowns, collisions, limitations: [
      'Source identity and claims are supplied data; preview does not authenticate the external source or verify claim truth.',
      'Name and type matches are suggestions only. Unknown, ambiguous and colliding identities remain unresolved.',
      'No source, identity, claim, design snapshot, publication or operational record is written by preview.',
    ] };
  return { ...core, previewHash: digest(core) };
}
