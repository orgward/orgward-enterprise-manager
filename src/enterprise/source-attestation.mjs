import { createHash, createPublicKey, randomUUID, verify as verifySignature } from 'node:crypto';
import { latestBlueprint } from '../model.mjs';
import { digest } from '../sdlc/contracts.mjs';
import { blueprintObjects, enterpriseFailure, enterpriseText } from './types.mjs';
import { previewEnterpriseSourceEvidence } from './source-onboarding.mjs';

export const ENTERPRISE_SOURCE_ATTESTATION_KINDS = new Set([
  'configure-source-attestation-profile', 'ingest-source-attestation-manifest',
  'repair-source-claim-mapping', 'recompute-source-reconciliation-report',
]);
const fail = (code, message, status = 400) => { throw enterpriseFailure(code, message, status); };
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeId = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9._:-]{0,119}$/i.test(value);
const isoTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const fingerprint = (key) => createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');
const commandFields = ['kind', 'blueprintId', 'blueprintVersion'];
const MAX_MANIFEST_BYTES = 1_000_000;
const MAX_POLICY_AGE = 365 * 24 * 60 * 60;

function profileInput(input) {
  const profile = input.profile;
  if (!isObject(profile)) fail('INVALID_SOURCE_ATTESTATION_PROFILE', 'Provide the complete source, collector, scope, key and freshness profile.');
  const mode = input.mode;
  if (!['CREATE', 'UPDATE', 'ROTATE_KEY', 'REVOKE_KEY'].includes(mode)) fail('INVALID_SOURCE_ATTESTATION_PROFILE', 'Choose CREATE, UPDATE, ROTATE_KEY or REVOKE_KEY.');
  const allowedProfile = ['sourceId', 'sourceAccountId', 'sourceInstanceId', 'resourceNamespace', 'coverageScope',
    'collectorId', 'keyId', 'publicKeyPem', 'intervalSeconds', 'freshnessPolicy'];
  if (Object.keys(profile).some((key) => !allowedProfile.includes(key))) fail('INVALID_SOURCE_ATTESTATION_PROFILE', 'The profile contains unsupported fields.');
  for (const field of ['sourceId', 'sourceAccountId', 'sourceInstanceId', 'resourceNamespace', 'collectorId']) {
    if (!safeId(profile[field])) fail('INVALID_SOURCE_ATTESTATION_PROFILE', `${field} must be a bounded stable identifier.`);
  }
  if (!isObject(profile.coverageScope) || Object.keys(profile.coverageScope).some((key) => !['recordTypes', 'paths'].includes(key))
    || !Array.isArray(profile.coverageScope.recordTypes) || !profile.coverageScope.recordTypes.length
    || !profile.coverageScope.recordTypes.every((entry) => typeof entry === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(entry))
    || !Array.isArray(profile.coverageScope.paths) || !profile.coverageScope.paths.length
    || !profile.coverageScope.paths.every((entry) => typeof entry === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,119}$/.test(entry))) {
    fail('INVALID_SOURCE_ATTESTATION_PROFILE', 'Declare at least one exact record type and claim path in the coverage scope.');
  }
  const recordTypes = [...new Set(profile.coverageScope.recordTypes)].sort();
  const paths = [...new Set(profile.coverageScope.paths)].sort();
  if (recordTypes.length !== profile.coverageScope.recordTypes.length || paths.length !== profile.coverageScope.paths.length) {
    fail('INVALID_SOURCE_ATTESTATION_PROFILE', 'Coverage scope entries must be unique.');
  }
  const policy = profile.freshnessPolicy;
  if (!isObject(policy) || Object.keys(policy).some((key) => !['maxAgeSeconds', 'maxClockSkewSeconds'].includes(key))
    || !Number.isSafeInteger(policy.maxAgeSeconds) || policy.maxAgeSeconds < 1 || policy.maxAgeSeconds > MAX_POLICY_AGE
    || !Number.isSafeInteger(policy.maxClockSkewSeconds) || policy.maxClockSkewSeconds < 0 || policy.maxClockSkewSeconds > 3600) {
    fail('INVALID_SOURCE_ATTESTATION_PROFILE', 'Freshness policy needs a bounded maximum age and clock-skew window.');
  }
  if (!Number.isSafeInteger(profile.intervalSeconds) || profile.intervalSeconds < 60 || profile.intervalSeconds > MAX_POLICY_AGE) {
    fail('INVALID_SOURCE_ATTESTATION_PROFILE', 'Configure a collector push interval from 60 seconds to one year.');
  }
  if (mode === 'REVOKE_KEY' || mode === 'UPDATE') {
    if (profile.publicKeyPem !== undefined || profile.keyId !== undefined) fail('INVALID_SOURCE_ATTESTATION_PROFILE', `${mode} cannot replace the active key.`);
    return { mode, profileId: input.profileId, expectedProfileVersion: input.expectedProfileVersion, profile: { ...profile,
      coverageScope: { recordTypes, paths }, intervalSeconds: profile.intervalSeconds, freshnessPolicy: { ...policy } } };
  }
  if (!safeId(profile.keyId) || typeof profile.publicKeyPem !== 'string' || !profile.publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----')) {
    fail('INVALID_SOURCE_ATTESTATION_KEY', 'Pin an Ed25519 SubjectPublicKeyInfo public key; private keys are not accepted.');
  }
  let publicKey;
  try { publicKey = createPublicKey(profile.publicKeyPem); } catch { fail('INVALID_SOURCE_ATTESTATION_KEY', 'The pinned public key is malformed.'); }
  if (publicKey.asymmetricKeyType !== 'ed25519' || publicKey.type !== 'public') fail('INVALID_SOURCE_ATTESTATION_KEY', 'The pinned key must be an Ed25519 public key.');
  return { mode, profileId: input.profileId, expectedProfileVersion: input.expectedProfileVersion,
    profile: { sourceId: profile.sourceId, sourceAccountId: profile.sourceAccountId, sourceInstanceId: profile.sourceInstanceId,
      resourceNamespace: profile.resourceNamespace, coverageScope: { recordTypes, paths }, collectorId: profile.collectorId,
      keyId: profile.keyId, publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }), keyFingerprint: fingerprint(publicKey),
      intervalSeconds: profile.intervalSeconds, freshnessPolicy: { ...policy } } };
}

function validateManifest(manifest) {
  if (!isObject(manifest) || Buffer.byteLength(JSON.stringify(manifest), 'utf8') > MAX_MANIFEST_BYTES
    || manifest.kind !== 'orgward-enterprise-observation-manifest' || manifest.schemaVersion !== '1.0'
    || manifest.domain !== 'orgward-enterprise-observation-attestation/v1'
    || Object.keys(manifest).some((key) => !['kind', 'schemaVersion', 'domain', 'tenantId', 'workspaceId', 'profile', 'baseline', 'source', 'collector',
      'extractor', 'observedAt', 'validTime', 'coverage', 'records', 'signature'].includes(key))) {
    fail('INVALID_SOURCE_ATTESTATION_MANIFEST', 'Provide a bounded version 1 source-observation manifest.');
  }
  if (typeof manifest.tenantId !== 'string' || typeof manifest.workspaceId !== 'string' || !isObject(manifest.profile)
    || !safeId(manifest.profile.id) || !Number.isSafeInteger(manifest.profile.version) || manifest.profile.version < 1) {
    fail('INVALID_SOURCE_ATTESTATION_MANIFEST', 'Bind the manifest to one tenant, workspace and source-profile version.');
  }
  if (!isObject(manifest.baseline) || !/^source-acceptance-[0-9a-f-]{36}$/.test(manifest.baseline.acceptanceReceiptId ?? '')
    || !/^[a-f0-9]{64}$/.test(manifest.baseline.receiptHash ?? '')
    || Object.keys(manifest.baseline).some((key) => !['acceptanceReceiptId', 'receiptHash'].includes(key))) {
    fail('INVALID_SOURCE_ATTESTATION_MANIFEST', 'Pin one exact accepted baseline receipt and hash in the signed manifest.');
  }
  const source = manifest.source;
  if (!isObject(source) || !safeId(source.id) || !safeId(source.accountId) || !safeId(source.instanceId) || !safeId(source.resourceNamespace)
    || !Number.isSafeInteger(source.sequence) || source.sequence < 1
    || (source.previousManifestHash !== null && !/^[a-f0-9]{64}$/.test(source.previousManifestHash ?? ''))
    || (source.upstreamRevision !== null && (typeof source.upstreamRevision !== 'string' || source.upstreamRevision.length > 240))
    || (source.cursor !== null && (typeof source.cursor !== 'string' || source.cursor.length > 500))
    || Object.keys(source).some((key) => !['id', 'accountId', 'instanceId', 'resourceNamespace', 'sequence', 'previousManifestHash', 'upstreamRevision', 'cursor'].includes(key))) {
    fail('INVALID_SOURCE_ATTESTATION_MANIFEST', 'Source identity and monotonic collector sequence are required; upstream revision and cursor are separate optional fields.');
  }
  for (const field of ['collector', 'extractor']) if (!isObject(manifest[field]) || !safeId(manifest[field].id)
    || typeof manifest[field].version !== 'string' || !manifest[field].version.trim() || manifest[field].version.length > 80
    || Object.keys(manifest[field]).some((key) => !['id', 'version'].includes(key))) {
    fail('INVALID_SOURCE_ATTESTATION_MANIFEST', `The manifest needs a bounded ${field} identity and version.`);
  }
  if (!isoTime(manifest.observedAt)) fail('INVALID_SOURCE_ATTESTATION_TIME', 'Use a canonical UTC observation timestamp.');
  const validTime = manifest.validTime;
  if (!(isObject(validTime) && Object.keys(validTime).length === 1 && validTime.unknown === true)
    && !(isObject(validTime) && Object.keys(validTime).length === 2 && isoTime(validTime.from) && isoTime(validTime.to)
      && Date.parse(validTime.from) <= Date.parse(validTime.to))) {
    fail('INVALID_SOURCE_ATTESTATION_TIME', 'Declare valid-time bounds or explicitly mark valid time unknown.');
  }
  const coverage = manifest.coverage;
  if (!isObject(coverage) || !['SNAPSHOT', 'DELTA'].includes(coverage.mode) || typeof coverage.complete !== 'boolean'
    || !safeId(coverage.resourceNamespace) || !Array.isArray(coverage.recordTypes)
    || !coverage.recordTypes.every((entry) => typeof entry === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(entry))
    || !Array.isArray(coverage.paths) || !coverage.paths.every((entry) => typeof entry === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,119}$/.test(entry))
    || !Array.isArray(coverage.exclusions) || !coverage.exclusions.every((value) => typeof value === 'string' && value.length <= 300)
    || !Array.isArray(coverage.errors) || !coverage.errors.every((value) => typeof value === 'string' && value.length <= 500)
    || Object.keys(coverage).some((key) => !['mode', 'complete', 'resourceNamespace', 'recordTypes', 'paths', 'exclusions', 'errors'].includes(key))) {
    fail('INVALID_SOURCE_ATTESTATION_COVERAGE', 'Declare bounded snapshot/delta coverage, completeness, scope, exclusions and errors.');
  }
  if (!Array.isArray(manifest.records) || manifest.records.length > 500) fail('INVALID_SOURCE_ATTESTATION_MANIFEST', 'Include at most 500 source records.');
  const recordIds = new Set();
  for (const record of manifest.records) {
    if (!isObject(record) || !safeId(record.id) || recordIds.has(record.id) || typeof record.type !== 'string' || !record.type.trim()
      || typeof record.name !== 'string' || !record.name.trim() || !Array.isArray(record.claims) || record.claims.length > 25
      || Object.keys(record).some((key) => !['id', 'type', 'name', 'claims'].includes(key))) fail('INVALID_SOURCE_ATTESTATION_MANIFEST', 'Each record needs a unique stable identity and bounded claims.');
    recordIds.add(record.id); const claimIds = new Set();
    if (!coverage.recordTypes.includes(record.type)) fail('INVALID_SOURCE_ATTESTATION_COVERAGE', 'Every record must fall within the manifest declared coverage.');
    for (const claim of record.claims) {
      if (!isObject(claim) || !safeId(claim.id) || claimIds.has(claim.id) || typeof claim.path !== 'string'
        || !/^[A-Za-z][A-Za-z0-9_.-]{0,119}$/.test(claim.path) || !Object.hasOwn(claim, 'value')
        || typeof claim.locator !== 'string' || !claim.locator.trim() || claim.locator.length > 500
        || (claim.artifactHash !== null && !/^[a-f0-9]{64}$/.test(claim.artifactHash ?? ''))
        || Object.keys(claim).some((key) => !['id', 'path', 'value', 'locator', 'artifactHash'].includes(key))) {
        fail('INVALID_SOURCE_ATTESTATION_MANIFEST', 'Each claim needs an exact path/value, stable locator and optional artifact hash.');
      }
      if (!coverage.paths.includes(claim.path)) fail('INVALID_SOURCE_ATTESTATION_COVERAGE', 'Every claim path must fall within the manifest declared coverage.');
      claimIds.add(claim.id);
    }
  }
  if (!isObject(manifest.signature) || manifest.signature.algorithm !== 'Ed25519' || !safeId(manifest.signature.keyId)
    || !Number.isSafeInteger(manifest.signature.keyVersion) || manifest.signature.keyVersion < 1
    || typeof manifest.signature.value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(manifest.signature.value)
    || Buffer.from(manifest.signature.value, 'base64').length !== 64
    || Object.keys(manifest.signature).some((key) => !['algorithm', 'keyId', 'keyVersion', 'value'].includes(key))) {
    fail('INVALID_SOURCE_ATTESTATION_SIGNATURE', 'Provide a bounded Ed25519 signature with a key ID and key version.');
  }
}

function unsignedManifest(manifest) { const value = structuredClone(manifest); delete value.signature; return value; }
function sourceProfiles(project) { return project.sourceAttestationProfiles ?? []; }
function latestProfile(project, profileId) { return sourceProfiles(project).filter((entry) => entry.id === profileId).sort((a, b) => b.version - a.version)[0] ?? null; }
function acceptedReceipt(project, id) {
  const receipt = (project.sourceAcceptanceReceipts ?? []).find((entry) => entry.id === id);
  if (!receipt || !/^[a-f0-9]{64}$/.test(receipt.receiptHash ?? '')) return null;
  const { receiptHash, ...core } = receipt;
  if (digest(core) !== receiptHash || !Array.isArray(receipt.claims) || !receipt.claims.length
    || !receipt.acceptedBlueprint || !project.blueprintVersions?.some((bp) => bp.id === receipt.acceptedBlueprint.id
      && bp.version === receipt.acceptedBlueprint.version && digest(bp) === receipt.acceptedBlueprint.snapshotHash)) return null;
  return receipt;
}

function sourceSequenceState(project, profileId) {
  const receipts = (project.sourceAttestationManifestReceipts ?? []).filter((entry) => entry.profileId === profileId)
    .sort((a, b) => a.sequence - b.sequence);
  const bySequence = new Map(receipts.map((entry) => [entry.sequence, entry]));
  const head = receipts.at(-1) ?? null;
  let validatedThroughSequence = 0; let priorHash = null;
  while (bySequence.has(validatedThroughSequence + 1)) {
    const receipt = bySequence.get(validatedThroughSequence + 1);
    if (receipt.previousManifestHash !== priorHash) break;
    validatedThroughSequence = receipt.sequence; priorHash = receipt.manifestHash;
  }
  const gaps = []; let expected = 1;
  for (const receipt of receipts) {
    if (receipt.sequence > expected) gaps.push({ from: expected, to: receipt.sequence - 1 });
    expected = receipt.sequence + 1;
  }
  return { receipts, bySequence, head, validatedThroughSequence, gaps };
}

function currentSnapshotCoverage(project, profile, now) {
  if (!profile.active || !profile.activeKeyId) return { status: 'UNAVAILABLE', reason: 'The owner revoked this collector profile key.' };
  const reports = (project.sourceReconciliationReports ?? []).filter((report) => report.sourceProfile?.id === profile.id
    && report.sourceProfile?.version === profile.version);
  const latest = reports.sort((a, b) => Date.parse(b.manifest?.observedAt ?? '') - Date.parse(a.manifest?.observedAt ?? '')
    || Date.parse(b.receivedAt ?? '') - Date.parse(a.receivedAt ?? ''))[0] ?? null;
  if (!latest) return { status: 'OVERDUE', reason: 'No collector manifest has been received.' };
  const ageSeconds = Math.max(0, (Date.parse(now) - Date.parse(latest.manifest.observedAt)) / 1000);
  if (ageSeconds > profile.freshnessPolicy.maxAgeSeconds || latest.freshness !== 'WITHIN_POLICY_WINDOW') return { status: 'STALE', reportId: latest.id,
    observedAt: latest.manifest.observedAt, reason: 'The latest collector observation is outside the owner-pinned freshness policy.' };
  if (ageSeconds > profile.intervalSeconds) return { status: 'OVERDUE', reportId: latest.id,
    observedAt: latest.manifest.observedAt, reason: 'The configured collector push interval has elapsed.' };
  if (latest.manifest.validTime?.unknown === true) return { status: 'UNKNOWN', reportId: latest.id,
    observedAt: latest.manifest.observedAt, reason: 'The latest observation has no declared valid-time window.' };
  if (Date.parse(latest.manifest.validTime?.to ?? '') < Date.parse(now)) return { status: 'STALE', reportId: latest.id,
    observedAt: latest.manifest.observedAt, reason: 'The latest observation valid-time window has expired.' };
  if (Date.parse(latest.manifest.validTime?.from ?? '') > Date.parse(now)) return { status: 'UNKNOWN', reportId: latest.id,
    observedAt: latest.manifest.observedAt, reason: 'The latest observation valid-time window has not started.' };
  if (latest.manifest.coverage?.mode !== 'SNAPSHOT' || latest.manifest.coverage?.complete !== true
    || latest.manifest.coverage.exclusions?.length || latest.manifest.coverage.errors?.length) return { status: 'UNKNOWN', reportId: latest.id,
    observedAt: latest.manifest.observedAt, reason: 'The latest manifest does not establish complete snapshot coverage.' };
  const sequence = sourceSequenceState(project, profile.id);
  if (sequence.validatedThroughSequence < sequence.head?.sequence) return { status: 'GAP', reportId: latest.id,
    observedAt: latest.manifest.observedAt, unresolvedGaps: sequence.gaps, reason: 'Collector sequence history has unresolved gaps.' };
  return { status: 'CURRENT', reportId: latest.id, observedAt: latest.manifest.observedAt,
    validatedThroughSequence: sequence.validatedThroughSequence,
    reason: 'A complete snapshot is current under the owner-pinned interval and freshness policy; collector attestation does not independently verify third-party acquisition or source truth.' };
}

function mappingRevision(project, profileId, baseline) {
  const revisions = (project.sourceAttestationMappingRevisions ?? []).filter((entry) => entry.profileId === profileId);
  const latest = revisions.at(-1);
  return { version: latest?.version ?? 1, bindings: latest?.bindings ?? (baseline?.claims ?? []).map((entry) => ({
    sourceRecordId: entry.sourceRecordId, claimId: entry.claimId, path: entry.path, targetObjectId: entry.targetObjectId,
  })) };
}
function bindingKey(binding) { return `${binding.sourceRecordId}\u0000${binding.claimId}\u0000${binding.path}\u0000${binding.targetObjectId}`; }
function reportCurrentness(project, reportId) {
  return (project.sourceReconciliationCurrentness ?? []).filter((entry) => entry.reportId === reportId).at(-1) ?? null;
}

export function authorizeEnterpriseCollectorPush(project, { profileId, tenantId, projectId, manifest, now = new Date().toISOString() }) {
  try {
    validateManifest(manifest);
    if (!project || project.id !== projectId || project.tenantId !== tenantId
      || manifest.tenantId !== tenantId || manifest.workspaceId !== projectId || manifest.profile.id !== profileId) {
      fail('SOURCE_ATTESTATION_DENIED', 'Collector request denied.', 404);
    }
    const profile = latestProfile(project, profileId);
    if (!profile || !profile.active || !profile.activeKeyId || profile.version !== manifest.profile.version
      || profile.tenantId !== tenantId || profile.workspaceId !== projectId
      || manifest.source.id !== profile.sourceId || manifest.source.accountId !== profile.sourceAccountId
      || manifest.source.instanceId !== profile.sourceInstanceId || manifest.source.resourceNamespace !== profile.resourceNamespace
      || manifest.coverage.resourceNamespace !== profile.resourceNamespace || manifest.collector.id !== profile.collectorId
      || manifest.coverage.recordTypes.some((type) => !profile.coverageScope.recordTypes.includes(type))
      || manifest.coverage.paths.some((path) => !profile.coverageScope.paths.includes(path))) {
      fail('SOURCE_ATTESTATION_DENIED', 'Collector request denied.', 404);
    }
    const key = profile.keys.find((entry) => entry.keyId === manifest.signature.keyId && entry.keyVersion === manifest.signature.keyVersion);
    if (!key || key.status !== 'ACTIVE' || key.keyId !== profile.activeKeyId
      || fingerprint(createPublicKey(key.publicKeyPem)) !== key.fingerprint
      || !verifySignature(null, Buffer.from(canonical(unsignedManifest(manifest))), createPublicKey(key.publicKeyPem),
        Buffer.from(manifest.signature.value, 'base64'))) {
      fail('SOURCE_ATTESTATION_DENIED', 'Collector request denied.', 404);
    }
    const nowMs = Date.parse(now); const observedMs = Date.parse(manifest.observedAt);
    if (!Number.isFinite(nowMs) || observedMs > nowMs + profile.freshnessPolicy.maxClockSkewSeconds * 1000
      || (manifest.validTime.unknown !== true && Date.parse(manifest.validTime.from) > Date.parse(manifest.validTime.to))) {
      fail('SOURCE_ATTESTATION_DENIED', 'Collector request denied.', 404);
    }
    return { profile, key, manifestHash: digest(manifest) };
  } catch {
    fail('SOURCE_ATTESTATION_DENIED', 'Collector request denied.', 404);
  }
}

export function projectEnterpriseSourceAttestationPushStatus(project, profile, now = new Date().toISOString()) {
  return currentSnapshotCoverage(project, profile, now);
}

export function projectEnterpriseSourceReconciliationCurrentness(project, now = new Date().toISOString()) {
  const rows = project.sourceReconciliationCurrentness ?? [];
  const latestByReport = new Map();
  rows.forEach((entry, index) => latestByReport.set(entry.reportId, index));
  return rows.map((entry, index) => {
    if (latestByReport.get(entry.reportId) !== index || entry.state !== 'FRESH') return structuredClone(entry);
    const report = (project.sourceReconciliationReports ?? []).find((candidate) => candidate.id === entry.reportId);
    const profile = report?.sourceProfile ? latestProfile(project, report.sourceProfile.id) : null;
    const sequence = report?.sourceProfile ? sourceSequenceState(project, report.sourceProfile.id) : null;
    const observedAt = report?.manifest?.observedAt;
    const age = Number.isFinite(Date.parse(observedAt)) ? Date.parse(now) - Date.parse(observedAt) : Infinity;
    const accepted = report?.baseline?.acceptanceReceiptId ? acceptedReceipt(project, report.baseline.acceptanceReceiptId) : null;
    const mapping = report?.sourceProfile ? mappingRevision(project, report.sourceProfile.id, accepted) : null;
    const latestHeadReportId = sequence?.head?.reportId ?? null;
    const headReport = (project.sourceReconciliationReports ?? []).find((candidate) => candidate.id === latestHeadReportId);
    const headEvaluationIds = new Set(latestHeadReportId ? [latestHeadReportId] : []);
    let advanced = true;
    while (advanced) {
      advanced = false;
      for (const candidate of project.sourceReconciliationReports ?? []) if (!headEvaluationIds.has(candidate.id)
        && headEvaluationIds.has(candidate.recomputedFromReportId) && candidate.manifest?.hash === headReport?.manifest?.hash) {
        headEvaluationIds.add(candidate.id); advanced = true;
      }
    }
    const isHeadEvaluation = headEvaluationIds.has(report?.id);
    const reasons = [];
    if (!profile?.active || profile.version !== report?.sourceProfile?.version) reasons.push('The source profile is no longer the active pinned version.');
    if (!profile || age > profile.freshnessPolicy.maxAgeSeconds * 1000 || age > profile.intervalSeconds * 1000) reasons.push('The observation is outside the current profile freshness or push interval.');
    if (mapping) {
      const dependencies = report?.dependencyManifest;
      const reportBindings = (report?.claims ?? []).filter((claim) => claim.targetObjectId).map((claim) => ({ profileId: report.sourceProfile.id,
        sourceRecordId: claim.sourceRecordId, claimId: claim.claimId, path: claim.path, targetObjectId: claim.targetObjectId }));
      const dependencyComplete = Number.isSafeInteger(report?.mappingRevision) && Array.isArray(dependencies)
        && dependencies.length === reportBindings.length
        && dependencies.every((dependency) => reportBindings.some((binding) => bindingKey(binding) === bindingKey(dependency)))
        && reportBindings.every((binding) => dependencies.some((dependency) => bindingKey(binding) === bindingKey(dependency)));
      if (!dependencyComplete) reasons.push('The report’s source dependency manifest is absent or incomplete.');
      else if (mapping.version > report.mappingRevision) {
        const intervening = (project.sourceAttestationMappingRevisions ?? []).filter((revision) => revision.profileId === report.sourceProfile.id
          && revision.version > report.mappingRevision && revision.version <= mapping.version).sort((a, b) => a.version - b.version);
        let expectedVersion = report.mappingRevision + 1;
        for (const revision of intervening) {
          if (revision.version !== expectedVersion || revision.priorVersion !== expectedVersion - 1
            || !revision.oldBinding || !revision.replacementBinding) {
            reasons.push('Source mapping revision history is incomplete; this report cannot be marked fresh.'); break;
          }
          expectedVersion += 1;
          const oldBinding = { ...revision.oldBinding, profileId: revision.profileId };
          const replacementBinding = { ...revision.replacementBinding, profileId: revision.profileId };
          if (dependencies.some((dependency) => bindingKey(dependency) === bindingKey(oldBinding)
            || bindingKey(dependency) === bindingKey(replacementBinding))) {
            reasons.push('An intervening source mapping repair intersects this report’s pinned dependencies.'); break;
          }
        }
        if (expectedVersion !== mapping.version + 1 && !reasons.some((reason) => /revision history is incomplete/.test(reason))) {
          reasons.push('Source mapping revision history is incomplete; this report cannot be marked fresh.');
        }
      }
    }
    if (sequence && (sequence.validatedThroughSequence < sequence.head?.sequence || !isHeadEvaluation)) reasons.push('A newer source sequence or unresolved sequence gap superseded this report.');
    if (report?.manifest?.validTime?.unknown === true || Date.parse(report?.manifest?.validTime?.from ?? '') > Date.parse(now)
      || Date.parse(report?.manifest?.validTime?.to ?? '') < Date.parse(now)) reasons.push('The observation is outside its declared valid-time window.');
    if (report?.manifest?.coverage?.mode !== 'SNAPSHOT' || report?.manifest?.coverage?.complete !== true
      || report.manifest.coverage.exclusions?.length || report.manifest.coverage.errors?.length) reasons.push('The report lacks complete snapshot coverage.');
    return reasons.length ? { ...structuredClone(entry), state: 'STALE', reason: reasons.join(' ') } : structuredClone(entry);
  });
}

export function normalizeEnterpriseSourceAttestationCommand(input) {
  if (!isObject(input) || !ENTERPRISE_SOURCE_ATTESTATION_KINDS.has(input.kind)
    || !/^blueprint-[0-9a-f-]{36}$/.test(input.blueprintId ?? '') || !Number.isSafeInteger(input.blueprintVersion) || input.blueprintVersion < 1) {
    fail('INVALID_SOURCE_ATTESTATION_COMMAND', 'Bind source attestation changes to the current main design.');
  }
  if (input.kind === 'repair-source-claim-mapping') {
    const binding = (value) => isObject(value) && Object.keys(value).every((key) => ['sourceRecordId', 'claimId', 'path', 'targetObjectId'].includes(key))
      && safeId(value.sourceRecordId) && safeId(value.claimId) && typeof value.path === 'string'
      && /^[A-Za-z][A-Za-z0-9_.-]{0,119}$/.test(value.path) && safeId(value.targetObjectId);
    if (Object.keys(input).some((key) => ![...commandFields, 'profileId', 'expectedProfileVersion', 'expectedMappingVersion',
      'baselineAcceptanceReceiptId', 'baselineReceiptHash', 'reportId', 'reportHash', 'oldBinding', 'replacementTargetObjectId', 'reason'].includes(key))
      || !/^source-profile-[0-9a-f-]{36}$/.test(input.profileId ?? '') || !Number.isSafeInteger(input.expectedProfileVersion)
      || input.expectedProfileVersion < 1 || !Number.isSafeInteger(input.expectedMappingVersion)
      || input.expectedMappingVersion < 1 || !/^source-acceptance-[0-9a-f-]{36}$/.test(input.baselineAcceptanceReceiptId ?? '')
      || !/^[a-f0-9]{64}$/.test(input.baselineReceiptHash ?? '')
      || !/^source-reconciliation-[0-9a-f-]{36}$/.test(input.reportId ?? '') || !/^[a-f0-9]{64}$/.test(input.reportHash ?? '')
      || !binding(input.oldBinding) || !safeId(input.replacementTargetObjectId)
      || input.oldBinding.targetObjectId === input.replacementTargetObjectId) {
      fail('INVALID_SOURCE_MAPPING_REPAIR', 'Bind a mapping repair to one exact source claim, old target and current mapping revision.');
    }
    return { kind: input.kind, blueprintId: input.blueprintId, blueprintVersion: input.blueprintVersion,
      profileId: input.profileId, expectedProfileVersion: input.expectedProfileVersion, expectedMappingVersion: input.expectedMappingVersion,
      baselineAcceptanceReceiptId: input.baselineAcceptanceReceiptId, baselineReceiptHash: input.baselineReceiptHash,
      reportId: input.reportId, reportHash: input.reportHash,
      oldBinding: structuredClone(input.oldBinding), replacementTargetObjectId: input.replacementTargetObjectId,
      reason: enterpriseText(input.reason, 'Mapping repair reason', 500) };
  }
  if (input.kind === 'recompute-source-reconciliation-report') {
    if (Object.keys(input).some((key) => ![...commandFields, 'reportId', 'reportHash', 'manifest'].includes(key))
      || !/^source-reconciliation-[0-9a-f-]{36}$/.test(input.reportId ?? '') || !/^[a-f0-9]{64}$/.test(input.reportHash ?? '')
      || !isObject(input.manifest) || Buffer.byteLength(JSON.stringify(input.manifest), 'utf8') > MAX_MANIFEST_BYTES) {
      fail('INVALID_SOURCE_RECONCILIATION_RECOMPUTE', 'Bind recomputation to one saved report and its exact signed manifest.');
    }
    validateManifest(input.manifest);
    return { kind: input.kind, blueprintId: input.blueprintId, blueprintVersion: input.blueprintVersion,
      reportId: input.reportId, reportHash: input.reportHash, manifest: structuredClone(input.manifest) };
  }
  if (input.kind === 'configure-source-attestation-profile') {
    const allowed = new Set([...commandFields, 'mode', 'profileId', 'expectedProfileVersion', 'profile', 'reason']);
    if (Object.keys(input).some((key) => !allowed.has(key))
      || (input.profileId !== undefined && !/^source-profile-[0-9a-f-]{36}$/.test(input.profileId))
      || (input.expectedProfileVersion !== undefined && (!Number.isSafeInteger(input.expectedProfileVersion) || input.expectedProfileVersion < 1))) {
      fail('INVALID_SOURCE_ATTESTATION_PROFILE', 'Bind profile changes to one exact source-profile revision.');
    }
    return { kind: input.kind, blueprintId: input.blueprintId, blueprintVersion: input.blueprintVersion,
      ...profileInput(input), reason: typeof input.reason === 'string' ? input.reason.trim().slice(0, 500) : '' };
  }
  if (Object.keys(input).some((key) => ![...commandFields, 'manifest'].includes(key)) || !isObject(input.manifest)) {
    fail('INVALID_SOURCE_ATTESTATION_COMMAND', 'Submit exactly one signed observation manifest.');
  }
  validateManifest(input.manifest);
  return { kind: input.kind, blueprintId: input.blueprintId, blueprintVersion: input.blueprintVersion, manifest: structuredClone(input.manifest) };
}

function configureProfile(project, command, actor, options) {
  const now = options.receivedAt ?? new Date().toISOString();
  const prior = command.profileId ? latestProfile(project, command.profileId) : null;
  if (command.mode === 'CREATE') {
    if (prior || command.profileId || command.expectedProfileVersion) fail('SOURCE_ATTESTATION_PROFILE_CONFLICT', 'Choose a new profile ID for profile creation.', 409);
  } else if (!prior || prior.version !== command.expectedProfileVersion) {
    fail('SOURCE_ATTESTATION_PROFILE_STALE', 'Reload the source profile before changing its key or policy.', 409);
  }
  if (prior && ['sourceId', 'sourceAccountId', 'sourceInstanceId', 'resourceNamespace', 'collectorId'].some((key) => prior[key] !== command.profile[key])) {
    fail('SOURCE_ATTESTATION_SCOPE_IMMUTABLE', 'Create a new source profile to change its pinned source or collector identity.', 409);
  }
  const keys = structuredClone(prior?.keys ?? []); let activeKeyId = prior?.activeKeyId ?? null;
  if (command.mode === 'CREATE') {
    if (sourceProfiles(project).some((profile) => profile.version === 1 && profile.sourceId === command.profile.sourceId && profile.active)) {
      fail('SOURCE_ATTESTATION_PROFILE_EXISTS', 'An active profile already pins this source ID.', 409);
    }
    keys.push({ keyId: command.profile.keyId, keyVersion: 1, publicKeyPem: command.profile.publicKeyPem,
      fingerprint: command.profile.keyFingerprint, status: 'ACTIVE', createdAt: now, owner: actor });
    activeKeyId = command.profile.keyId;
  } else if (command.mode === 'ROTATE_KEY') {
    if (!prior.active || !command.profile.publicKeyPem || command.profile.keyId === activeKeyId
      || keys.some((key) => key.keyId === command.profile.keyId)) fail('SOURCE_ATTESTATION_KEY_CONFLICT', 'Rotate an active profile to one new, unused collector key ID.', 409);
    const old = keys.find((key) => key.keyId === activeKeyId);
    if (old) old.status = 'ROTATED';
    const keyVersion = Math.max(0, ...keys.map((key) => key.keyVersion)) + 1;
    keys.push({ keyId: command.profile.keyId, keyVersion, publicKeyPem: command.profile.publicKeyPem,
      fingerprint: command.profile.keyFingerprint, status: 'ACTIVE', createdAt: now, owner: actor });
    activeKeyId = command.profile.keyId;
  } else if (command.mode === 'REVOKE_KEY') {
    if (!prior.active || !activeKeyId) fail('SOURCE_ATTESTATION_KEY_CONFLICT', 'Only an active collector key can be revoked.', 409);
    const old = keys.find((key) => key.keyId === activeKeyId); if (old) old.status = 'REVOKED';
    activeKeyId = null;
  } else {
    if (!prior.active) fail('SOURCE_ATTESTATION_PROFILE_REVOKED', 'A revoked source profile cannot be reactivated in place.', 409);
    if (command.mode !== 'UPDATE') {
      const active = keys.find((key) => key.keyId === activeKeyId);
      if (!active || command.profile.keyId !== activeKeyId || command.profile.keyFingerprint !== active.fingerprint) {
        fail('SOURCE_ATTESTATION_KEY_CONFLICT', 'Use ROTATE_KEY when changing the active public key.', 409);
      }
    }
  }
  const profile = { id: prior?.id ?? `source-profile-${randomUUID()}`, version: (prior?.version ?? 0) + 1,
    tenantId: options.tenantId, workspaceId: project.id, sourceId: command.profile.sourceId,
    sourceAccountId: command.profile.sourceAccountId, sourceInstanceId: command.profile.sourceInstanceId,
    resourceNamespace: command.profile.resourceNamespace, coverageScope: structuredClone(command.profile.coverageScope),
    collectorId: command.profile.collectorId, intervalSeconds: command.profile.intervalSeconds,
    freshnessPolicy: structuredClone(command.profile.freshnessPolicy),
    keys, activeKeyId, active: command.mode !== 'REVOKE_KEY', owner: actor, recordedAt: now,
    reason: command.reason || `Source attestation profile ${command.mode.toLowerCase()}.` };
  project.sourceAttestationProfiles = [...sourceProfiles(project), profile];
  project.audit ??= []; project.audit.push({ at: now, action: `enterprise.source-attestation-profile-${command.mode.toLowerCase()}`, actor,
    detail: `${profile.id} v${profile.version} · ${profile.sourceId} · collector ${profile.collectorId} · key ${activeKeyId ?? 'revoked'}` });
  return { blueprint: latestBlueprint(project), sourceAttestationProfile: profile, sourceAttestationProfileId: profile.id, recordedAt: now };
}

function compareManifest(project, command, actor, options) {
  const now = options.receivedAt ?? new Date().toISOString(); const nowMs = Date.parse(now); const manifest = command.manifest;
  const current = latestBlueprint(project);
  if (!current || current.id !== command.blueprintId || current.version !== command.blueprintVersion) fail('SOURCE_ATTESTATION_CONTEXT_STALE', 'Reload the current main design before reconciling a source manifest.', 409);
  const profile = latestProfile(project, manifest.profile.id);
  if (!profile || !profile.active || profile.version !== manifest.profile.version || profile.tenantId !== options.tenantId
    || profile.workspaceId !== project.id) fail('SOURCE_ATTESTATION_PROFILE_UNAVAILABLE', 'The signed manifest does not reference an active profile for this tenant and workspace.', 409);
  const source = manifest.source; const collector = manifest.collector; const coverage = manifest.coverage;
  if (source.id !== profile.sourceId || source.accountId !== profile.sourceAccountId || source.instanceId !== profile.sourceInstanceId
    || source.resourceNamespace !== profile.resourceNamespace || coverage.resourceNamespace !== profile.resourceNamespace
    || collector.id !== profile.collectorId || coverage.recordTypes.some((type) => !profile.coverageScope.recordTypes.includes(type))
    || coverage.paths.some((path) => !profile.coverageScope.paths.includes(path))) fail('SOURCE_ATTESTATION_SCOPE_MISMATCH', 'Manifest source, collector or coverage scope differs from its owner-pinned profile.', 409);
  if (!profile.activeKeyId) fail('SOURCE_ATTESTATION_KEY_REVOKED', 'The source profile has no active collector key.', 409);
  const key = profile.keys.find((entry) => entry.keyId === manifest.signature.keyId && entry.keyVersion === manifest.signature.keyVersion);
  if (!key || key.status !== 'ACTIVE' || key.keyId !== profile.activeKeyId) fail('SOURCE_ATTESTATION_KEY_REVOKED', 'The signature key is unknown, rotated or revoked for this profile version.', 409);
  const publicKey = createPublicKey(key.publicKeyPem);
  if (fingerprint(publicKey) !== key.fingerprint) fail('SOURCE_ATTESTATION_KEY_INVALID', 'The pinned key fingerprint does not match the stored public key.', 409);
  const signed = Buffer.from(canonical(unsignedManifest(manifest)));
  if (!verifySignature(null, signed, publicKey, Buffer.from(manifest.signature.value, 'base64'))) fail('SOURCE_ATTESTATION_SIGNATURE_INVALID', 'The manifest signature does not verify against the owner-pinned collector key.', 409);
  if (manifest.tenantId !== options.tenantId || manifest.workspaceId !== project.id) fail('SOURCE_ATTESTATION_SCOPE_MISMATCH', 'The signed manifest is bound to another tenant or workspace.', 409);
  const observedMs = Date.parse(manifest.observedAt);
  if (observedMs > nowMs + profile.freshnessPolicy.maxClockSkewSeconds * 1000) fail('SOURCE_ATTESTATION_FUTURE_TIME', 'Collector observation time is too far in the future.', 409);
  if (manifest.validTime.unknown !== true && Date.parse(manifest.validTime.from) > Date.parse(manifest.validTime.to)) fail('SOURCE_ATTESTATION_TIME_ORDER', 'The valid-time window is reversed.', 409);
  const hash = digest(manifest); const streams = project.sourceAttestationStreams ?? [];
  const stream = streams.find((entry) => entry.profileId === profile.id) ?? null;
  const sequenceState = sourceSequenceState(project, profile.id);
  const historical = sequenceState.bySequence.get(source.sequence);
  if (historical && !options.recomputeFrom) {
    if (historical.manifestHash !== hash) fail('SOURCE_ATTESTATION_SEQUENCE_CONFLICT', 'This source sequence was already recorded with a different manifest hash.', 409);
    const existing = project.sourceReconciliationReports?.find((entry) => entry.id === historical.reportId);
    return { blueprint: current, sourceAttestationReport: existing, sourceReconciliationReportId: existing?.id ?? null,
      sourceAttestationProfileId: profile.id, manifestHash: hash, idempotent: true, recordedAt: now };
  }
  const previous = sequenceState.bySequence.get(source.sequence - 1) ?? null;
  const next = sequenceState.bySequence.get(source.sequence + 1) ?? null;
  if (source.sequence === 1 && source.previousManifestHash !== null) fail('SOURCE_ATTESTATION_SEQUENCE_CONFLICT', 'Sequence 1 must have no prior manifest hash.', 409);
  if (previous && source.previousManifestHash !== previous.manifestHash) fail('SOURCE_ATTESTATION_SEQUENCE_CONFLICT', 'The backfilled manifest does not link to its known previous sequence.', 409);
  if (next && next.previousManifestHash !== hash) fail('SOURCE_ATTESTATION_SEQUENCE_CONFLICT', 'The backfilled manifest does not link to its known next sequence.', 409);
  const backfill = Boolean(sequenceState.head && source.sequence <= sequenceState.head.sequence);
  const chainGap = !previous && source.sequence !== 1 || (!sequenceState.head && source.sequence !== 1)
    || sequenceState.gaps.some((gap) => gap.from < source.sequence);
  const baseline = acceptedReceipt(project, manifest.baseline.acceptanceReceiptId);
  const baselineValid = Boolean(baseline && baseline.receiptHash === manifest.baseline.receiptHash && baseline.source.id === profile.sourceId);
  const fresh = nowMs - observedMs <= profile.freshnessPolicy.maxAgeSeconds * 1000;
  const validTimeKnown = manifest.validTime.unknown !== true;
  const inValidTime = validTimeKnown && Date.parse(manifest.validTime.from) <= nowMs && Date.parse(manifest.validTime.to) >= nowMs;
  const completeSnapshot = coverage.mode === 'SNAPSHOT' && coverage.complete && !coverage.exclusions.length && !coverage.errors.length
    && coverage.recordTypes.length > 0 && coverage.paths.length > 0;
  const baselineAcceptedAt = Date.parse(baseline?.receivedAt ?? '');
  const overlapsAccepted = validTimeKnown && Number.isFinite(baselineAcceptedAt) && Date.parse(manifest.validTime.to) >= baselineAcceptedAt;
  const records = new Map(manifest.records.map((record) => [record.id, record]));
  const mapping = mappingRevision(project, profile.id, baseline);
  const accepted = baselineValid ? baseline.claims.map((entry) => {
    const binding = mapping.bindings.find((candidate) => candidate.sourceRecordId === entry.sourceRecordId
      && candidate.claimId === entry.claimId && candidate.path === entry.path);
    return binding ? { ...entry, targetObjectId: binding.targetObjectId } : entry;
  }) : [];
  const reportClaims = [];
  const issues = [];
  if (!baselineValid) issues.push({ status: 'UNVERIFIABLE', reason: 'An exact, intact accepted baseline for this source is required.' });
  if (chainGap) issues.push({ status: 'UNVERIFIABLE', reason: 'Collector sequence or prior manifest hash has a gap; this report cannot establish continuous currentness.' });
  for (const prior of accepted) {
    if (!coverage.recordTypes.includes(prior.sourceRecordType) || !coverage.paths.includes(prior.path)) {
      reportClaims.push({ sourceRecordId: prior.sourceRecordId, targetObjectId: prior.targetObjectId, claimId: prior.claimId, path: prior.path,
        acceptedValue: structuredClone(prior.value), observedValue: null, status: 'UNVERIFIABLE', reason: 'This manifest coverage does not include the accepted claim path.' });
      continue;
    }
    const record = records.get(prior.sourceRecordId);
    if (!record) {
      const status = completeSnapshot && baselineValid && fresh && inValidTime && overlapsAccepted && !chainGap ? 'MISSING' : 'UNVERIFIABLE';
      reportClaims.push({ sourceRecordId: prior.sourceRecordId, targetObjectId: prior.targetObjectId, claimId: prior.claimId, path: prior.path,
        acceptedValue: structuredClone(prior.value), observedValue: null, status,
        reason: status === 'MISSING' ? 'A fresh complete snapshot covered this source namespace but omitted the accepted source record.'
          : 'Record absence is unverified because this upload is not a fresh complete matching snapshot.' });
      continue;
    }
    if (record.type !== prior.sourceRecordType || record.name !== prior.sourceRecordName) {
      reportClaims.push({ sourceRecordId: prior.sourceRecordId, targetObjectId: prior.targetObjectId, claimId: prior.claimId, path: prior.path,
        acceptedValue: structuredClone(prior.value), observedValue: null, status: 'UNVERIFIABLE', reason: 'Exact source record identity/type/name no longer matches the accepted mapping.' });
      continue;
    }
    const observed = record.claims.find((claim) => claim.id === prior.claimId);
    if (!observed) {
      const status = completeSnapshot && baselineValid && fresh && inValidTime && overlapsAccepted && !chainGap ? 'MISSING' : 'UNVERIFIABLE';
      reportClaims.push({ sourceRecordId: prior.sourceRecordId, targetObjectId: prior.targetObjectId, claimId: prior.claimId, path: prior.path,
        acceptedValue: structuredClone(prior.value), observedValue: null, status,
        reason: status === 'MISSING' ? 'A fresh complete snapshot covered this namespace and omitted the accepted claim.'
          : 'Claim absence is unverified because source coverage is incomplete, stale, out of valid time or discontinuous.' });
      continue;
    }
    if (observed.path !== prior.path) {
      reportClaims.push({ sourceRecordId: prior.sourceRecordId, targetObjectId: prior.targetObjectId, claimId: prior.claimId, path: prior.path,
        observedPath: observed.path, acceptedValue: structuredClone(prior.value), observedValue: structuredClone(observed.value), status: 'UNVERIFIABLE',
        reason: 'Claim path or meaning differs from the accepted mapping.' });
      continue;
    }
    const equal = digest(observed.value) === digest(prior.value);
    let status; let reason;
    if (chainGap || !baselineValid || !coverage.complete || coverage.exclusions.length || coverage.errors.length) {
      status = 'UNVERIFIABLE'; reason = 'Baseline, source continuity or coverage is insufficient to assert currentness.';
    } else if (!fresh || (validTimeKnown && Date.parse(manifest.validTime.to) < nowMs)) {
      status = 'STALE'; reason = !fresh ? 'The collector attestation is older than the owner-pinned freshness window.'
        : 'The collector attestation valid-time window has expired.';
    } else if (!validTimeKnown || !inValidTime || !overlapsAccepted) {
      status = 'UNVERIFIABLE'; reason = 'Valid-time scope is unknown, not current, or does not overlap the pinned accepted baseline.';
    }
    else if (!equal) { status = 'CONTRADICTED'; reason = 'Fresh collector-attested evidence differs from the accepted value over an overlapping valid-time window.'; }
    else { status = 'CURRENT'; reason = 'Fresh collector-attested evidence matches the accepted value over an overlapping valid-time window.'; }
    reportClaims.push({ sourceRecordId: prior.sourceRecordId, sourceRecordType: prior.sourceRecordType, sourceRecordName: prior.sourceRecordName,
      targetObjectId: prior.targetObjectId, claimId: prior.claimId, path: prior.path,
      acceptedValue: structuredClone(prior.value), observedValue: structuredClone(observed.value), validTime: structuredClone(manifest.validTime), status, reason,
      comparison: equal ? 'MATCHES_ACCEPTED' : 'DIFFERS_FROM_ACCEPTED' });
  }
  for (const record of manifest.records) for (const claim of record.claims) {
    const mapped = accepted.some((entry) => entry.sourceRecordId === record.id && entry.claimId === claim.id && entry.path === claim.path);
    if (!mapped) reportClaims.push({ sourceRecordId: record.id, targetObjectId: null, claimId: claim.id, path: claim.path,
      observedValue: structuredClone(claim.value), status: 'PROPOSED', reason: 'This collector-attested claim has no exact accepted mapping and awaits normal human acceptance.' });
  }
  if (chainGap) for (const item of reportClaims) if (item.status !== 'PROPOSED') { item.status = 'UNVERIFIABLE'; item.reason = 'Collector sequence gap prevents this report from asserting currentness.'; }
  const statuses = ['CURRENT', 'ASSERTED', 'PROPOSED', 'STALE', 'CONTRADICTED', 'MISSING', 'UNVERIFIABLE'];
  const counts = Object.fromEntries(statuses.map((status) => [status, reportClaims.filter((entry) => entry.status === status).length]));
  const reportId = `source-reconciliation-${randomUUID()}`;
  const report = { id: reportId, comparatorVersion: 'collector-attestation/v1', uploader: actor, receivedAt: now, evaluatedAt: now,
    projectId: project.id, tenantId: options.tenantId, sourceAuthentication: 'COLLECTOR_ATTESTED', freshness: fresh ? 'WITHIN_POLICY_WINDOW' : 'STALE',
    thirdPartyAcquisitionIndependentlyVerified: false, sourceTruthIndependentlyVerified: false,
    sourceProfile: { id: profile.id, version: profile.version, sourceId: profile.sourceId, keyId: key.keyId, keyVersion: key.keyVersion,
      keyFingerprint: key.fingerprint, freshnessPolicy: structuredClone(profile.freshnessPolicy), coverageScope: structuredClone(profile.coverageScope) },
    baseline: { acceptanceReceiptId: baseline?.id ?? manifest.baseline.acceptanceReceiptId, receiptHash: baseline?.receiptHash ?? null,
      acceptedBlueprint: baseline?.acceptedBlueprint ? structuredClone(baseline.acceptedBlueprint) : null },
    ...(options.recomputeFrom ? { recomputedFromReportId: options.recomputeFrom.id, evaluatorVersion: 'source-report-evaluator/v1',
      predecessorReportHash: options.recomputeFrom.reportHash } : {}),
    manifest: { hash, sequence: source.sequence, previousManifestHash: source.previousManifestHash,
      upstreamRevision: source.upstreamRevision, cursor: source.cursor, observedAt: manifest.observedAt,
      validTime: structuredClone(manifest.validTime), collector: structuredClone(collector), extractor: structuredClone(manifest.extractor),
      coverage: structuredClone(coverage) }, mappingRevision: mapping.version,
    dependencyManifest: [...new Map(reportClaims.filter((claim) => claim.targetObjectId).map((claim) => {
      const binding = { profileId: profile.id, sourceRecordId: claim.sourceRecordId, claimId: claim.claimId,
        path: claim.path, targetObjectId: claim.targetObjectId };
      return [bindingKey(binding), binding];
    })).values()], claims: reportClaims, issues, counts,
    limitations: ['This authenticates the configured collector signature over the submitted manifest; it does not independently verify third-party acquisition or source truth.',
      'Currentness is relative to the pinned accepted baseline, manifest coverage and owner-pinned freshness policy.',
      'The report does not mutate the accepted design or operational authority.'] };
  report.claims = report.claims.map((claim, rowIndex) => claim.status === 'CONTRADICTED'
    ? { ...claim, findingId: `source-finding-${randomUUID()}`, findingStatus: 'PENDING_REVIEW', findingRowIndex: rowIndex } : claim);
  report.reportHash = digest(report);
  const receipt = { profileId: profile.id, sequence: source.sequence, manifestHash: hash,
    previousManifestHash: source.previousManifestHash, reportId, receivedAt: now };
  if (!options.recomputeFrom) project.sourceAttestationManifestReceipts = [...(project.sourceAttestationManifestReceipts ?? []), receipt];
  const updatedSequences = sourceSequenceState(project, profile.id);
  const priorValidatedThrough = stream?.validatedThroughSequence ?? 0;
  const newValidatedThrough = updatedSequences.validatedThroughSequence;
  const repaired = backfill && newValidatedThrough > priorValidatedThrough
    && (source.sequence === 1 ? Boolean(next) : Boolean(previous && next));
  const repairReceipts = project.sourceAttestationRepairReceipts ?? [];
  if (repaired) project.sourceAttestationRepairReceipts = [...repairReceipts, {
    id: `source-gap-repair-${randomUUID()}`, profileId: profile.id, repairedSequence: source.sequence,
    closedThroughSequence: newValidatedThrough, priorValidatedThroughSequence: priorValidatedThrough,
    closedIntervals: sequenceState.gaps.filter((gap) => gap.from <= source.sequence && gap.to >= source.sequence)
      .map((gap) => ({ from: gap.from, to: gap.to })),
    reportId, manifestHash: hash, priorManifestHash: previous?.manifestHash ?? null,
    nextManifestHash: next?.manifestHash ?? null, recordedAt: now, actor,
    coverageReanchored: false, reason: 'The exact missing manifest hash links both adjacent signed receipts; this repair establishes continuity only for the linked interval.' }];
  if (!options.recomputeFrom) project.sourceAttestationStreams = [...streams.filter((entry) => entry.profileId !== profile.id),
    { profileId: profile.id, sequence: Math.max(stream?.sequence ?? 0, source.sequence),
      manifestHash: source.sequence >= (stream?.sequence ?? 0) ? hash : stream?.manifestHash,
      reportId: source.sequence >= (stream?.sequence ?? 0) ? reportId : stream?.reportId,
      receivedHeadSequence: updatedSequences.head?.sequence ?? source.sequence,
      receivedHeadManifestHash: updatedSequences.head?.manifestHash ?? hash,
      validatedThroughSequence: updatedSequences.validatedThroughSequence, unresolvedGaps: updatedSequences.gaps,
      currentCoverage: currentSnapshotCoverage(project, profile, now), updatedAt: now }];
  project.sourceReconciliationReports = [...(project.sourceReconciliationReports ?? []), report];
  const currentRows = report.claims.filter((claim) => claim.status !== 'PROPOSED');
  const reportFresh = currentRows.length > 0 && currentRows.every((claim) => claim.status === 'CURRENT');
  project.sourceReconciliationCurrentness = [...(project.sourceReconciliationCurrentness ?? []), {
    reportId, state: reportFresh ? 'FRESH' : 'NOT_FRESH', mappingRevision: mapping.version,
    dependencyHash: digest(report.dependencyManifest), reason: reportFresh ? 'All mapped claims match this report’s pinned evidence.'
      : 'At least one mapped claim is stale, contradicted, absent or unverifiable.', recordedAt: now }];
  project.audit ??= []; project.audit.push({ at: now, action: 'enterprise.source-attestation-reconciled', actor,
    detail: `${profile.id} sequence ${source.sequence} · ${counts.CURRENT} current · ${counts.CONTRADICTED} contradicted · ${counts.MISSING} missing · ${counts.UNVERIFIABLE} unverifiable` });
  return { blueprint: current, sourceAttestationReport: report, sourceReconciliationReport: report, sourceReconciliationReportId: reportId,
    sourceAttestationProfileId: profile.id, manifestHash: hash, recordedAt: now };
}

function repairSourceClaimMapping(project, command, actor, options) {
  const profile = latestProfile(project, command.profileId); const now = options.receivedAt ?? new Date().toISOString();
  if (!profile || !profile.active || profile.version !== command.expectedProfileVersion
    || profile.tenantId !== options.tenantId || profile.workspaceId !== project.id) {
    fail('SOURCE_MAPPING_PROFILE_UNAVAILABLE', 'Choose an active source profile in this workspace.', 409);
  }
  const baseline = acceptedReceipt(project, command.baselineAcceptanceReceiptId);
  if (!baseline || baseline.receiptHash !== command.baselineReceiptHash || baseline.source.id !== profile.sourceId) {
    fail('SOURCE_MAPPING_BASELINE_UNAVAILABLE', 'Choose an intact accepted source receipt pinned to this profile’s source.', 409);
  }
  const report = (project.sourceReconciliationReports ?? []).find((entry) => entry.id === command.reportId);
  if (!reportCoreValid(report, command.reportHash) || report.sourceProfile?.id !== profile.id
    || report.sourceProfile?.version !== profile.version
    || report.baseline?.acceptanceReceiptId !== baseline.id || report.baseline?.receiptHash !== baseline.receiptHash) {
    fail('SOURCE_MAPPING_REPORT_UNAVAILABLE', 'The exact intact report must pin this profile version and accepted source receipt.', 409);
  }
  const mapping = mappingRevision(project, profile.id, baseline);
  if (mapping.version !== command.expectedMappingVersion) fail('SOURCE_MAPPING_STALE', 'Reload the exact current source mapping revision before repairing it.', 409);
  const old = { ...command.oldBinding, profileId: profile.id };
  const bindings = mapping.bindings.map((entry) => ({ ...entry, profileId: profile.id }));
  const index = bindings.findIndex((entry) => bindingKey(entry) === bindingKey(old));
  if (index < 0) fail('SOURCE_MAPPING_BINDING_MISMATCH', 'The exact old source claim binding is not present in this mapping revision.', 409);
  const reportClaim = report.claims.find((claim) => claim.sourceRecordId === command.oldBinding.sourceRecordId
    && claim.claimId === command.oldBinding.claimId && claim.path === command.oldBinding.path
    && claim.targetObjectId === command.oldBinding.targetObjectId);
  const reportDependency = report.dependencyManifest?.find((dependency) => bindingKey(dependency) === bindingKey(old));
  if (!reportClaim || !reportDependency) {
    fail('SOURCE_MAPPING_REPORT_BINDING_MISMATCH', 'The report’s exact claim and dependency must match the old source binding.', 409);
  }
  const acceptedSourceClaim = baseline.claims.find((claim) => claim.sourceRecordId === command.oldBinding.sourceRecordId
    && claim.claimId === command.oldBinding.claimId && claim.path === command.oldBinding.path);
  const replacementTarget = blueprintObjects(latestBlueprint(project)).find((object) => object.id === command.replacementTargetObjectId);
  const oldTarget = blueprintObjects(latestBlueprint(project)).find((object) => object.id === command.oldBinding.targetObjectId);
  if (!oldTarget || !replacementTarget || !acceptedSourceClaim || reportClaim.sourceRecordType !== acceptedSourceClaim.sourceRecordType
    || oldTarget.type !== acceptedSourceClaim.sourceRecordType || replacementTarget.type !== acceptedSourceClaim.sourceRecordType) {
    fail('SOURCE_MAPPING_TARGET_NOT_FOUND', 'The report and both canonical targets must match the exact accepted source record type.', 409);
  }
  const replacement = { ...old, targetObjectId: command.replacementTargetObjectId };
  const nextBindings = bindings.map((entry, row) => row === index ? replacement : entry);
  const revision = { profileId: profile.id, version: mapping.version + 1, bindings: nextBindings.map(({ profileId: _profileId, ...binding }) => binding),
    priorVersion: mapping.version, oldBinding: command.oldBinding, replacementBinding: { ...command.oldBinding,
      targetObjectId: command.replacementTargetObjectId }, reason: command.reason, actor, recordedAt: now };
  revision.revisionHash = digest(revision);
  const affected = [];
  for (const report of project.sourceReconciliationReports ?? []) {
    if (report.sourceProfile?.id !== profile.id) continue;
    const dependencies = report.dependencyManifest ?? (report.claims ?? []).filter((claim) => claim.targetObjectId)
      .map((claim) => ({ profileId: profile.id, sourceRecordId: claim.sourceRecordId, claimId: claim.claimId,
        path: claim.path, targetObjectId: claim.targetObjectId }));
    if (!dependencies.some((dependency) => bindingKey(dependency) === bindingKey(old) || bindingKey(dependency) === bindingKey(replacement))) continue;
    affected.push(report.id);
    project.sourceReconciliationCurrentness = [...(project.sourceReconciliationCurrentness ?? []), {
      reportId: report.id, state: 'STALE', mappingRevision: revision.version,
      dependencyHash: digest(dependencies), reason: `Source mapping ${profile.id} advanced to revision ${revision.version}; recompute this matching report consumer.`, recordedAt: now }];
  }
  project.sourceAttestationMappingRevisions = [...(project.sourceAttestationMappingRevisions ?? []), revision];
  const repair = { id: `source-mapping-repair-${randomUUID()}`, profileId: profile.id, priorMappingVersion: mapping.version,
    baselineAcceptanceReceiptId: baseline.id, baselineReceiptHash: baseline.receiptHash, reportId: report.id, reportHash: report.reportHash,
    mappingVersion: revision.version, oldBinding: command.oldBinding, replacementBinding: revision.replacementBinding,
    affectedReportIds: affected, reason: command.reason, actor, recordedAt: now };
  repair.receiptHash = digest(repair);
  project.sourceAttestationMappingRepairReceipts = [...(project.sourceAttestationMappingRepairReceipts ?? []), repair];
  project.audit ??= []; project.audit.push({ at: now, action: 'enterprise.source-claim-mapping-repaired', actor,
    detail: `${profile.id} mapping v${mapping.version} → v${revision.version}; invalidated ${affected.length} matching report consumers.` });
  return { blueprint: latestBlueprint(project), sourceAttestationMappingRepairReceipt: repair, recordedAt: now };
}

function recomputeSourceReport(project, command, actor, options) {
  const now = options.receivedAt ?? new Date().toISOString();
  const verified = verifiedReportManifest(project, command, options.tenantId);
  const currentProfile = latestProfile(project, verified.profile.id);
  const sequence = sourceSequenceState(project, verified.profile.id);
  if (!currentProfile?.active || currentProfile.version !== verified.report.sourceProfile.version
    || currentProfile.activeKeyId !== verified.key.keyId || verified.manifest.source.sequence !== sequence.head?.sequence
    || reportCurrentness(project, verified.report.id)?.state !== 'STALE') {
    fail('SOURCE_RECONCILIATION_RECOMPUTE_UNAVAILABLE', 'Only a stale report at the current active source/profile head can be recomputed.', 409);
  }
  const current = latestBlueprint(project);
  if (!current || current.id !== command.blueprintId || current.version !== command.blueprintVersion) {
    fail('SOURCE_RECONCILIATION_CONTEXT_STALE', 'Reload the current main design before recomputing source reconciliation.', 409);
  }
  const result = compareManifest(project, { kind: 'ingest-source-attestation-manifest', blueprintId: current.id,
    blueprintVersion: current.version, manifest: verified.manifest }, actor,
  { ...options, receivedAt: now, recomputeFrom: verified.report });
  const mapping = mappingRevision(project, verified.profile.id, acceptedReceipt(project, verified.manifest.baseline.acceptanceReceiptId));
  const report = result.sourceAttestationReport;
  const latestState = reportCurrentness(project, report.id);
  if (mapping.version !== report.mappingRevision) fail('SOURCE_RECONCILIATION_RECOMPUTE_STALE', 'The mapping changed while this report was being recomputed.', 409);
  project.sourceAttestationRecomputeReceipts = [...(project.sourceAttestationRecomputeReceipts ?? []), {
    id: `source-recompute-${randomUUID()}`, priorReportId: verified.report.id, priorReportHash: verified.report.reportHash,
    reportId: report.id, reportHash: report.reportHash, manifestHash: verified.manifestHash,
    mappingRevision: mapping.version, dependencyHash: digest(report.dependencyManifest), state: latestState?.state ?? 'NOT_FRESH',
    evaluatorVersion: 'source-report-evaluator/v1', actor, recordedAt: now }];
  return { ...result, sourceAttestationRecomputeReceipt: project.sourceAttestationRecomputeReceipts.at(-1) };
}

function reportCoreValid(report, expectedHash) {
  if (!report || report.comparatorVersion !== 'collector-attestation/v1' || !/^[a-f0-9]{64}$/.test(report.reportHash ?? '')
    || report.reportHash !== expectedHash) return false;
  const { reportHash, ...core } = report;
  return digest(core) === reportHash;
}

function verifiedReportManifest(project, { reportId, reportHash, manifest }, tenantId) {
  validateManifest(manifest);
  const report = (project.sourceReconciliationReports ?? []).find((entry) => entry.id === reportId);
  if (!reportCoreValid(report, reportHash) || digest(manifest) !== report.manifest?.hash) {
    fail('SOURCE_FINDING_MANIFEST_MISMATCH', 'Reupload the exact signed manifest pinned by this immutable finding.', 409);
  }
  const profile = (project.sourceAttestationProfiles ?? []).find((entry) => entry.id === report.sourceProfile?.id
    && entry.version === report.sourceProfile.version);
  if (!profile || profile.tenantId !== tenantId || profile.workspaceId !== project.id
    || manifest.profile.id !== profile.id || manifest.profile.version !== profile.version) {
    fail('SOURCE_FINDING_PROFILE_UNAVAILABLE', 'The finding does not resolve to its exact saved source profile version.', 409);
  }
  const key = profile.keys.find((entry) => entry.keyId === report.sourceProfile.keyId
    && entry.keyVersion === report.sourceProfile.keyVersion);
  if (!key || key.fingerprint !== report.sourceProfile.keyFingerprint) {
    fail('SOURCE_FINDING_KEY_UNAVAILABLE', 'The finding does not resolve to its exact saved collector key.', 409);
  }
  const publicKey = createPublicKey(key.publicKeyPem);
  if (fingerprint(publicKey) !== key.fingerprint
    || !verifySignature(null, Buffer.from(canonical(unsignedManifest(manifest))), publicKey, Buffer.from(manifest.signature.value, 'base64'))) {
    fail('SOURCE_FINDING_SIGNATURE_INVALID', 'The reuploaded manifest does not verify against the collector key pinned by this finding.', 409);
  }
  if (manifest.tenantId !== tenantId || manifest.workspaceId !== project.id
    || manifest.source.id !== profile.sourceId || manifest.source.accountId !== profile.sourceAccountId
    || manifest.source.instanceId !== profile.sourceInstanceId || manifest.source.resourceNamespace !== profile.resourceNamespace
    || manifest.collector.id !== profile.collectorId || manifest.signature.keyId !== key.keyId
    || manifest.signature.keyVersion !== key.keyVersion) {
    fail('SOURCE_FINDING_SCOPE_MISMATCH', 'The reuploaded manifest does not match the report’s saved tenant, workspace, source and collector pins.', 409);
  }
  const baseline = acceptedReceipt(project, manifest.baseline.acceptanceReceiptId);
  if (!baseline || baseline.receiptHash !== manifest.baseline.receiptHash
    || report.baseline.acceptanceReceiptId !== baseline.id || report.baseline.receiptHash !== baseline.receiptHash) {
    fail('SOURCE_FINDING_BASELINE_UNAVAILABLE', 'The finding’s exact accepted evidence baseline failed integrity validation.', 409);
  }
  return { report, reportHash, manifestHash: report.manifest.hash, profile, key, manifest, bundle: { kind: 'orgward-enterprise-source-evidence', schemaVersion: '1.0',
    source: { id: profile.sourceId, label: `Collector attestation · ${profile.sourceId}`, locator: `collector-attestation:${report.id}` },
    records: manifest.records.map((record) => ({ id: record.id, type: record.type, name: record.name,
      claims: record.claims.map((claim) => ({ id: claim.id, path: claim.path, value: structuredClone(claim.value), locator: claim.locator })) })) } };
}

export function previewEnterpriseAttestedSourceProposal(project, input, tenantId, now = new Date().toISOString()) {
  const verified = verifiedReportManifest(project, input, tenantId);
  const finding = verified.report.claims.find((entry) => entry.findingId === input.findingId);
  if (!finding || finding.status !== 'CONTRADICTED' || finding.findingStatus !== 'PENDING_REVIEW') {
    fail('SOURCE_FINDING_NOT_PENDING', 'Choose one unresolved contradiction finding.', 409);
  }
  if ((project.sourceAttestationCorrectionReceipts ?? []).some((entry) => entry.findingId === finding.findingId)) {
    fail('SOURCE_FINDING_ALREADY_PROPOSED', 'This finding already has a proposed correction receipt.', 409);
  }
  const nowMs = Date.parse(now); const observedMs = Date.parse(verified.manifest.observedAt);
  if (nowMs - observedMs > verified.profile.freshnessPolicy.maxAgeSeconds * 1000
    || verified.manifest.validTime.unknown === true || Date.parse(verified.manifest.validTime.from) > nowMs
    || Date.parse(verified.manifest.validTime.to) < nowMs) {
    fail('SOURCE_FINDING_STALE', 'The attested contradiction is outside its owner-pinned freshness or valid-time window; obtain a current observation.', 409);
  }
  return { ...previewEnterpriseSourceEvidence(project, verified.bundle), reportId: verified.report.id,
    reportHash: verified.report.reportHash, manifestHash: verified.report.manifest.hash,
    finding };
}

export function verifyEnterpriseAttestedSourceProposal(project, input, tenantId, now = new Date().toISOString()) {
  const verified = verifiedReportManifest(project, input, tenantId);
  const finding = verified.report.claims.find((entry) => entry.findingId === input.findingId);
  if (!finding || finding.status !== 'CONTRADICTED' || finding.findingStatus !== 'PENDING_REVIEW') {
    fail('SOURCE_FINDING_NOT_PENDING', 'Choose one unresolved contradiction finding.', 409);
  }
  if ((project.sourceAttestationCorrectionReceipts ?? []).some((entry) => entry.findingId === finding.findingId)) {
    fail('SOURCE_FINDING_ALREADY_PROPOSED', 'This finding already has a proposed correction receipt.', 409);
  }
  const nowMs = Date.parse(now); const observedMs = Date.parse(verified.manifest.observedAt);
  if (!Number.isFinite(nowMs) || nowMs - observedMs > verified.profile.freshnessPolicy.maxAgeSeconds * 1000
    || verified.manifest.validTime.unknown === true || Date.parse(verified.manifest.validTime.from) > nowMs
    || Date.parse(verified.manifest.validTime.to) < nowMs) {
    fail('SOURCE_FINDING_STALE', 'The attested contradiction is outside its owner-pinned freshness or valid-time window; obtain a current observation.', 409);
  }
  return { ...verified, finding };
}

export function applyEnterpriseSourceAttestationCommand(project, command, actor, options = {}) {
  const current = latestBlueprint(project);
  if (!current || current.id !== command.blueprintId || current.version !== command.blueprintVersion) fail('SOURCE_ATTESTATION_CONTEXT_STALE', 'Reload the current main design before changing source attestation.', 409);
  if (command.kind === 'configure-source-attestation-profile') return configureProfile(project, command, actor, options);
  if (command.kind === 'repair-source-claim-mapping') return repairSourceClaimMapping(project, command, actor, options);
  if (command.kind === 'recompute-source-reconciliation-report') return recomputeSourceReport(project, command, actor, options);
  return compareManifest(project, command, actor, options);
}
