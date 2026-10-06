import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { addConversationTurn, createProject, latestBlueprint } from '../../src/model.mjs';
import { digest } from '../../src/sdlc/contracts.mjs';
import { applyEnterpriseSourceAcceptance, normalizeEnterpriseSourceAcceptanceCommand } from '../../src/enterprise/source-acceptance.mjs';
import { previewEnterpriseSourceEvidence } from '../../src/enterprise/source-onboarding.mjs';
import { projectEnterprise } from '../../src/enterprise/projections.mjs';
import { applyEnterpriseSourceAttestationCommand, normalizeEnterpriseSourceAttestationCommand,
  previewEnterpriseAttestedSourceProposal, projectEnterpriseSourceAttestationPushStatus,
  projectEnterpriseSourceReconciliationCurrentness } from '../../src/enterprise/source-attestation.mjs';

const TENANT = 'tenant-test';
const PROJECT_NOW = '2026-10-06T10:00:00.000Z';
function projectFixture() {
  const project = createProject('Source attestation fixture');
  for (const answer of ['Transfers', 'Small businesses', 'Clear status', 'People approve exceptions']) addConversationTurn(project, answer);
  const blueprint = latestBlueprint(project);
  const originalCustomer = blueprint.areas.customersOfferingsValueEconomics.items.find((entry) => entry.type === 'customer');
  const alternateCustomer = structuredClone(originalCustomer); alternateCustomer.id = 'customer-alternate'; alternateCustomer.name = 'Alternate customer';
  blueprint.areas.customersOfferingsValueEconomics.items.push(alternateCustomer);
  const customer = blueprint.areas.customersOfferingsValueEconomics.items.find((entry) => entry.type === 'customer');
  const bundle = { kind: 'orgward-enterprise-source-evidence', schemaVersion: '1.0',
    source: { id: 'crm-main', label: 'CRM main source' }, records: [{ id: 'crm-customer-1', type: 'customer', name: customer.name,
      claims: [{ id: 'crm-detail', path: 'detail', value: 'Accepted customer detail', locator: 'accounts/1/detail' }] }] };
  const preview = (awaitPreview(project, bundle));
  const accepted = applyEnterpriseSourceAcceptance(project, normalizeEnterpriseSourceAcceptanceCommand({ kind: 'accept-source-evidence',
    blueprintId: blueprint.id, blueprintVersion: blueprint.version, blueprintHash: digest(blueprint), previewHash: preview.previewHash,
    bundle, selections: [{ sourceRecordId: 'crm-customer-1', targetObjectId: customer.id, claimIds: ['crm-detail'] }],
    reason: 'Pin the accepted source fact for collector comparison.' }), 'owner-principal',
  { commandId: 'acceptance-1', receivedAt: PROJECT_NOW });
  const keys = generateKeyPairSync('ed25519');
  const profileInput = { sourceId: 'crm-main', sourceAccountId: 'account-main', sourceInstanceId: 'instance-main',
    resourceNamespace: 'customer-records', coverageScope: { recordTypes: ['customer'], paths: ['detail'] },
    collectorId: 'collector-main', keyId: 'key-v1', publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }),
    intervalSeconds: 300, freshnessPolicy: { maxAgeSeconds: 3600, maxClockSkewSeconds: 60 } };
  const configured = applyEnterpriseSourceAttestationCommand(project, normalizeEnterpriseSourceAttestationCommand({
    kind: 'configure-source-attestation-profile', mode: 'CREATE', blueprintId: accepted.blueprint.id,
    blueprintVersion: accepted.blueprint.version, profile: profileInput, reason: 'Trust the isolated collector fixture.' }),
  'owner-principal', { tenantId: TENANT, receivedAt: PROJECT_NOW });
  return { project, customer, bundle, accepted, profile: configured.sourceAttestationProfile, profileInput, keys };
}
function awaitPreview(project, bundle) {
  // Kept synchronous so the fixture has one exact source bundle and no async provider path.
  return previewEnterpriseSourceEvidence(project, bundle);
}
function signedManifest(fixture, { sequence = 1, previousManifestHash = null, value = 'Accepted customer detail',
  observedAt = PROJECT_NOW, validTime = { from: PROJECT_NOW, to: '2026-10-06T12:00:00.000Z' },
  complete = true, mode = 'SNAPSHOT', records = null, profile = fixture.profile, key = fixture.keys.privateKey,
  baselineReceiptId = fixture.accepted.sourceAcceptanceReceiptId,
  tenantId = TENANT, workspaceId = fixture.project.id, sourceId = 'crm-main', signatureKeyId = profile.activeKeyId ?? 'key-v1',
  signatureKeyVersion = profile.keys.find((entry) => entry.keyId === signatureKeyId)?.keyVersion ?? 1 } = {}) {
  const manifest = { kind: 'orgward-enterprise-observation-manifest', schemaVersion: '1.0',
    domain: 'orgward-enterprise-observation-attestation/v1', tenantId, workspaceId,
    profile: { id: profile.id, version: profile.version },
    baseline: { acceptanceReceiptId: baselineReceiptId,
      receiptHash: fixture.project.sourceAcceptanceReceipts.find((entry) => entry.id === baselineReceiptId)?.receiptHash },
    source: { id: sourceId, accountId: 'account-main', instanceId: 'instance-main', resourceNamespace: 'customer-records',
      sequence, previousManifestHash, upstreamRevision: `upstream-${sequence}`, cursor: `collector-cursor-${sequence}` },
    collector: { id: 'collector-main', version: '1.0' }, extractor: { id: 'extractor-main', version: '1.0' },
    observedAt, validTime, coverage: { mode, complete, resourceNamespace: 'customer-records', recordTypes: ['customer'], paths: ['detail'],
      exclusions: [], errors: [] }, records: records ?? [{ id: 'crm-customer-1', type: 'customer', name: fixture.customer.name,
        claims: [{ id: 'crm-detail', path: 'detail', value, locator: 'accounts/1/detail', artifactHash: null }] }] };
  const signature = sign(null, Buffer.from(stableCanonical(manifest)), key).toString('base64');
  return { ...manifest, signature: { algorithm: 'Ed25519', keyId: signatureKeyId, keyVersion: signatureKeyVersion, value: signature } };
}
function stableCanonical(value) { return Array.isArray(value) ? `[${value.map(stableCanonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableCanonical(value[key])}`).join(',')}}`
    : JSON.stringify(value); }
function ingest(fixture, manifest, receivedAt = PROJECT_NOW, commandId = `attest-${manifest.source.sequence}-${Math.random()}`) {
  const current = latestBlueprint(fixture.project);
  const command = normalizeEnterpriseSourceAttestationCommand({ kind: 'ingest-source-attestation-manifest',
    blueprintId: current.id, blueprintVersion: current.version, manifest });
  return applyEnterpriseSourceAttestationCommand(fixture.project, command, 'editor-principal', { tenantId: TENANT,
    commandId, expectedVersion: fixture.project.version, receivedAt });
}
function addPinnedAcceptanceReceipt(project, { id, sourceId, sourceRecordId, claimId, targetObjectId, sourceRecordName, value, receivedAt }) {
  const blueprint = latestBlueprint(project);
  const core = { id, uploader: 'owner-principal', receivedAt, source: { id: sourceId, label: sourceId, bundleHash: 'a'.repeat(64) },
    acceptedBlueprint: { id: blueprint.id, version: blueprint.version, snapshotHash: digest(blueprint) },
    claims: [{ sourceRecordId, sourceRecordType: 'customer', sourceRecordName, claimId, targetObjectId, path: 'detail', value,
      sourceLocator: 'test/source', recordLocator: 'record', claimLocator: 'claim', sourceHash: 'b'.repeat(64) }] };
  const receipt = { ...core, receiptHash: digest(core) };
  project.sourceAcceptanceReceipts.push(receipt);
  return receipt;
}

test('owner-pinned Ed25519 collector manifests distinguish current, contradicted, missing, stale and unverifiable without design mutation', () => {
  const fixture = projectFixture(); const { project } = fixture;
  const beforeBlueprints = JSON.stringify(project.blueprintVersions);
  const firstManifest = signedManifest(fixture);
  const current = ingest(fixture, firstManifest, PROJECT_NOW);
  assert.equal(current.sourceAttestationReport.claims.find((entry) => entry.claimId === 'crm-detail').status, 'CURRENT');
  assert.equal(current.sourceAttestationReport.sourceAuthentication, 'COLLECTOR_ATTESTED');
  assert.equal(current.sourceAttestationReport.thirdPartyAcquisitionIndependentlyVerified, false);
  assert.equal(current.sourceAttestationReport.sourceTruthIndependentlyVerified, false);
  assert.equal(current.sourceAttestationReport.freshness, 'WITHIN_POLICY_WINDOW');
  assert.equal(project.sourceAttestationStreams[0].manifestHash, current.manifestHash);

  const contradictionManifest = signedManifest(fixture, { sequence: 2, previousManifestHash: current.manifestHash, value: 'Contradictory customer detail' });
  const contradiction = ingest(fixture, contradictionManifest, '2026-10-06T10:01:00.000Z');
  assert.equal(contradiction.sourceAttestationReport.claims.find((entry) => entry.claimId === 'crm-detail').status, 'CONTRADICTED');
  assert.equal(contradiction.sourceAttestationReport.claims.find((entry) => entry.claimId === 'crm-detail').acceptedValue, 'Accepted customer detail');
  assert.equal(contradiction.sourceAttestationReport.claims.find((entry) => entry.claimId === 'crm-detail').observedValue, 'Contradictory customer detail');

  const missingManifest = signedManifest(fixture, { sequence: 3, previousManifestHash: contradiction.manifestHash, records: [] });
  assert.equal(ingest(fixture, missingManifest, '2026-10-06T10:02:00.000Z').sourceAttestationReport.claims[0].status, 'MISSING');
  const partialManifest = signedManifest(fixture, { sequence: 4, previousManifestHash: digest(missingManifest), records: [], complete: false });
  assert.equal(ingest(fixture, partialManifest, '2026-10-06T10:03:00.000Z').sourceAttestationReport.claims[0].status, 'UNVERIFIABLE');
  const staleManifest = signedManifest(fixture, { sequence: 5, previousManifestHash: digest(partialManifest), observedAt: '2026-10-06T08:00:00.000Z' });
  assert.equal(ingest(fixture, staleManifest, '2026-10-06T10:04:00.000Z').sourceAttestationReport.claims[0].status, 'STALE');
  assert.deepEqual(project.blueprintVersions.map((entry) => entry.id), JSON.parse(beforeBlueprints).map((entry) => entry.id));
});

test('attestation profile rejects private keys, signature/scope/time errors, replay conflicts and sequence gaps fail closed', () => {
  const fixture = projectFixture(); const good = signedManifest(fixture);
  const replay = ingest(fixture, good, PROJECT_NOW, 'attestation-idempotent-first');
  const replayAgain = ingest(fixture, good, '2026-10-06T10:00:30.000Z', 'attestation-idempotent-second');
  assert.equal(replayAgain.idempotent, true);
  assert.equal(fixture.project.sourceReconciliationReports.length, 1);
  const changedSameSequence = signedManifest(fixture, { value: 'Different payload' });
  assert.throws(() => ingest(fixture, changedSameSequence, PROJECT_NOW), { code: 'SOURCE_ATTESTATION_SEQUENCE_CONFLICT', statusCode: 409 });
  const badSignature = structuredClone(good); badSignature.records[0].claims[0].value = 'Tampered after signature';
  assert.throws(() => ingest(fixture, badSignature, PROJECT_NOW), { code: 'SOURCE_ATTESTATION_SIGNATURE_INVALID', statusCode: 409 });
  const unknownKey = signedManifest(fixture);
  unknownKey.signature.keyId = 'untrusted-key';
  assert.throws(() => ingest(fixture, unknownKey, PROJECT_NOW), { code: 'SOURCE_ATTESTATION_KEY_REVOKED', statusCode: 409 });
  const wrongSource = signedManifest(fixture, { sourceId: 'another-source' });
  assert.throws(() => ingest(fixture, wrongSource, PROJECT_NOW), { code: 'SOURCE_ATTESTATION_SCOPE_MISMATCH', statusCode: 409 });
  const wrongTenant = signedManifest(fixture, { tenantId: 'tenant-other' });
  assert.throws(() => ingest(fixture, wrongTenant, PROJECT_NOW), { code: 'SOURCE_ATTESTATION_SCOPE_MISMATCH', statusCode: 409 });
  const future = signedManifest(fixture, { observedAt: '2026-10-06T10:02:00.000Z' });
  assert.throws(() => ingest(fixture, future, PROJECT_NOW), { code: 'SOURCE_ATTESTATION_FUTURE_TIME', statusCode: 409 });
  const gap = signedManifest(fixture, { sequence: 3, previousManifestHash: 'f'.repeat(64) });
  const gapReport = ingest(fixture, gap, '2026-10-06T10:01:00.000Z').sourceAttestationReport;
  assert.equal(gapReport.claims[0].status, 'UNVERIFIABLE');
  assert.match(gapReport.issues[0].reason, /sequence or prior manifest hash has a gap/);
  const afterGap = signedManifest(fixture, { sequence: 4, previousManifestHash: digest(gap) });
  assert.equal(ingest(fixture, afterGap, '2026-10-06T10:02:00.000Z').sourceAttestationReport.claims[0].status, 'UNVERIFIABLE');
  assert.equal(fixture.project.sourceAttestationStreams[0].receivedHeadSequence, 4);
  assert.deepEqual(fixture.project.sourceAttestationStreams[0].unresolvedGaps, [{ from: 2, to: 2 }]);
  const outOfOrder = signedManifest(fixture, { sequence: 2, previousManifestHash: replay.manifestHash });
  assert.throws(() => ingest(fixture, outOfOrder, PROJECT_NOW), { code: 'SOURCE_ATTESTATION_SEQUENCE_CONFLICT', statusCode: 409 });

  const initialGapFixture = projectFixture();
  const skippedGenesis = signedManifest(initialGapFixture, { sequence: 2, previousManifestHash: 'a'.repeat(64) });
  const genesisGapReport = ingest(initialGapFixture, skippedGenesis, PROJECT_NOW).sourceAttestationReport;
  assert.equal(genesisGapReport.claims[0].status, 'UNVERIFIABLE');
  assert.match(genesisGapReport.issues[0].reason, /sequence or prior manifest hash has a gap/);

  const privateKeyInput = { ...fixture.profileInput, publicKeyPem: fixture.keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const current = latestBlueprint(fixture.project);
  assert.throws(() => normalizeEnterpriseSourceAttestationCommand({ kind: 'configure-source-attestation-profile', mode: 'CREATE',
    blueprintId: current.id, blueprintVersion: current.version, profile: privateKeyInput }), { code: 'INVALID_SOURCE_ATTESTATION_KEY' });
});

test('late signed sequence repair closes only its linked gap; snapshots cannot erase missing history', () => {
  const fixture = projectFixture();
  const first = signedManifest(fixture, { observedAt: PROJECT_NOW });
  const firstResult = ingest(fixture, first, PROJECT_NOW);
  const second = signedManifest(fixture, { sequence: 2, previousManifestHash: digest(first), observedAt: '2026-10-06T10:01:00.000Z' });
  const third = signedManifest(fixture, { sequence: 3, previousManifestHash: digest(second), observedAt: '2026-10-06T10:02:00.000Z' });
  const thirdResult = ingest(fixture, third, '2026-10-06T10:02:00.000Z');
  const fourth = signedManifest(fixture, { sequence: 4, previousManifestHash: digest(third), observedAt: '2026-10-06T10:03:00.000Z' });
  const fourthResult = ingest(fixture, fourth, '2026-10-06T10:03:00.000Z');
  assert.equal(thirdResult.sourceAttestationReport.claims[0].status, 'UNVERIFIABLE');
  assert.equal(fourthResult.sourceAttestationReport.claims[0].status, 'UNVERIFIABLE');
  assert.deepEqual(fixture.project.sourceAttestationStreams[0].unresolvedGaps, [{ from: 2, to: 2 }]);

  const repaired = ingest(fixture, second, '2026-10-06T10:04:00.000Z');
  assert.equal(repaired.sourceAttestationReport.claims[0].status, 'CURRENT');
  assert.equal(fixture.project.sourceAttestationStreams[0].sequence, 4, 'late backfill does not lower received head');
  assert.equal(fixture.project.sourceAttestationStreams[0].validatedThroughSequence, 4);
  assert.deepEqual(fixture.project.sourceAttestationStreams[0].unresolvedGaps, []);
  assert.equal(fixture.project.sourceAttestationStreams[0].currentCoverage.status, 'CURRENT',
    'the latest complete snapshot regains current coverage only after its sequence chain is repaired');
  assert.equal(fixture.project.sourceAttestationRepairReceipts.length, 1);
  assert.deepEqual(fixture.project.sourceAttestationRepairReceipts[0].closedIntervals, [{ from: 2, to: 2 }]);
  assert.equal(fixture.project.sourceAttestationRepairReceipts[0].coverageReanchored, false);
  assert.equal(fixture.project.sourceReconciliationReports.find((report) => report.id === thirdResult.sourceAttestationReport.id)
    .claims[0].status, 'UNVERIFIABLE', 'repair retains the original gap report');
  assert.equal(fixture.project.sourceReconciliationReports.find((report) => report.id === fourthResult.sourceAttestationReport.id)
    .claims[0].status, 'UNVERIFIABLE', 'repair retains the later gap report');
  const versionCount = fixture.project.version; const reportCount = fixture.project.sourceReconciliationReports.length;
  assert.equal(projectEnterpriseSourceAttestationPushStatus(fixture.project, fixture.profile, '2026-10-06T10:09:00.000Z').status, 'OVERDUE');
  assert.equal(projectEnterpriseSourceAttestationPushStatus(fixture.project, fixture.profile, '2026-10-06T11:05:00.000Z').status, 'STALE');
  assert.equal(fixture.project.version, versionCount, 'read-time freshness projection does not mutate project state');
  assert.equal(fixture.project.sourceReconciliationReports.length, reportCount, 'reads do not append or refresh reports');

  const missingFixture = projectFixture();
  const one = signedManifest(missingFixture);
  ingest(missingFixture, one, PROJECT_NOW);
  const missingTwo = signedManifest(missingFixture, { sequence: 2, previousManifestHash: digest(one) });
  const three = signedManifest(missingFixture, { sequence: 3, previousManifestHash: digest(missingTwo) });
  ingest(missingFixture, three, PROJECT_NOW);
  const completeFour = signedManifest(missingFixture, { sequence: 4, previousManifestHash: digest(three), mode: 'SNAPSHOT', complete: true });
  ingest(missingFixture, completeFour, '2026-10-06T10:01:00.000Z');
  assert.equal(missingFixture.project.sourceAttestationStreams[0].currentCoverage.status, 'GAP',
    'a full snapshot cannot claim recovery while sequence history remains missing');
  assert.deepEqual(missingFixture.project.sourceAttestationStreams[0].unresolvedGaps, [{ from: 2, to: 2 }]);
});

test('mapping repair stales only matching report currentness; explicit recompute creates a fresh immutable successor', () => {
  const fixture = projectFixture(); const manifest = signedManifest(fixture);
  const alternate = latestBlueprint(fixture.project).areas.customersOfferingsValueEconomics.items.find((entry) => entry.id === 'customer-alternate');
  const original = ingest(fixture, manifest, PROJECT_NOW).sourceAttestationReport;
  const originalHash = original.reportHash;
  assert.equal(fixture.project.sourceReconciliationCurrentness.at(-1).state, 'FRESH', JSON.stringify(original.claims.map((entry) => entry.status)));
  const replacement = alternate;
  const oldBinding = { sourceRecordId: 'crm-customer-1', claimId: 'crm-detail', path: 'detail', targetObjectId: fixture.customer.id };
  const current = latestBlueprint(fixture.project);
  const repair = applyEnterpriseSourceAttestationCommand(fixture.project, normalizeEnterpriseSourceAttestationCommand({
    kind: 'repair-source-claim-mapping', blueprintId: current.id, blueprintVersion: current.version,
    profileId: fixture.profile.id, expectedProfileVersion: fixture.profile.version, expectedMappingVersion: 1,
    baselineAcceptanceReceiptId: fixture.accepted.sourceAcceptanceReceiptId,
    baselineReceiptHash: fixture.project.sourceAcceptanceReceipts.find((entry) => entry.id === fixture.accepted.sourceAcceptanceReceiptId).receiptHash,
    reportId: original.id, reportHash: original.reportHash,
    oldBinding, replacementTargetObjectId: replacement.id,
    reason: 'The source record was mapped to the wrong canonical customer.' }), 'owner-principal',
  { tenantId: TENANT, receivedAt: '2026-10-06T10:01:00.000Z' });
  assert.equal(repair.sourceAttestationMappingRepairReceipt.mappingVersion, 2);
  assert.equal(fixture.project.sourceReconciliationCurrentness.at(-1).reportId, original.id);
  assert.equal(fixture.project.sourceReconciliationCurrentness.at(-1).state, 'STALE');
  assert.equal(original.reportHash, originalHash);
  assert.equal(original.claims[0].targetObjectId, fixture.customer.id, 'historical report content is unchanged');
  const latestObservation = signedManifest(fixture, { sequence: 2, previousManifestHash: digest(manifest) });
  const second = ingest(fixture, latestObservation, '2026-10-06T10:01:30.000Z').sourceAttestationReport;
  assert.equal(fixture.project.sourceReconciliationCurrentness.filter((entry) => entry.reportId === second.id).at(-1).state, 'FRESH');
  const beforeSecondRepair = latestBlueprint(fixture.project);
  applyEnterpriseSourceAttestationCommand(fixture.project, normalizeEnterpriseSourceAttestationCommand({
    kind: 'repair-source-claim-mapping', blueprintId: beforeSecondRepair.id, blueprintVersion: beforeSecondRepair.version,
    profileId: fixture.profile.id, expectedProfileVersion: fixture.profile.version, expectedMappingVersion: 2,
    baselineAcceptanceReceiptId: fixture.accepted.sourceAcceptanceReceiptId,
    baselineReceiptHash: fixture.project.sourceAcceptanceReceipts.find((entry) => entry.id === fixture.accepted.sourceAcceptanceReceiptId).receiptHash,
    reportId: second.id, reportHash: second.reportHash,
    oldBinding: { ...oldBinding, targetObjectId: replacement.id }, replacementTargetObjectId: fixture.customer.id,
    reason: 'Restore the reviewed canonical target mapping.' }), 'owner-principal',
  { tenantId: TENANT, receivedAt: '2026-10-06T10:01:45.000Z' });
  assert.equal(fixture.project.sourceReconciliationCurrentness.filter((entry) => entry.reportId === original.id).at(-1).state, 'STALE');
  assert.equal(fixture.project.sourceReconciliationCurrentness.filter((entry) => entry.reportId === second.id).at(-1).state, 'STALE');
  const afterRepair = latestBlueprint(fixture.project);
  const recomputed = applyEnterpriseSourceAttestationCommand(fixture.project, normalizeEnterpriseSourceAttestationCommand({
    kind: 'recompute-source-reconciliation-report', blueprintId: afterRepair.id, blueprintVersion: afterRepair.version,
    reportId: second.id, reportHash: second.reportHash, manifest: latestObservation }), 'owner-principal',
  { tenantId: TENANT, receivedAt: '2026-10-06T10:02:00.000Z' });
  assert.notEqual(recomputed.sourceAttestationReport.id, second.id);
  assert.equal(recomputed.sourceAttestationReport.recomputedFromReportId, second.id);
  assert.equal(recomputed.sourceAttestationReport.mappingRevision, 3);
  assert.equal(recomputed.sourceAttestationReport.claims[0].targetObjectId, fixture.customer.id);
  assert.equal(recomputed.sourceAttestationReport.claims[0].status, 'CURRENT');
  assert.equal(fixture.project.sourceReconciliationCurrentness.at(-1).reportId, recomputed.sourceAttestationReport.id);
  assert.equal(fixture.project.sourceReconciliationCurrentness.at(-1).state, 'FRESH');
  assert.equal(fixture.project.sourceReconciliationCurrentness.filter((entry) => entry.reportId === original.id).at(-1).state, 'STALE');
  assert.equal(fixture.project.sourceReconciliationCurrentness.filter((entry) => entry.reportId === second.id).at(-1).state, 'STALE');
  assert.equal(fixture.project.sourceReconciliationCurrentness.find((entry) => entry.reportId === original.id && entry.state === 'STALE') !== undefined, true);
  assert.equal(fixture.project.sourceReconciliationReports.find((entry) => entry.id === original.id).reportHash, originalHash);
  assert.equal(fixture.project.sourceAttestationRecomputeReceipts.length, 1);
  const persistedCurrentnessCount = fixture.project.sourceReconciliationCurrentness.length;
  const expiredProjection = projectEnterpriseSourceReconciliationCurrentness(fixture.project, '2026-10-06T13:00:00.000Z')
    .filter((entry) => entry.reportId === recomputed.sourceAttestationReport.id).at(-1);
  assert.equal(expiredProjection.state, 'STALE', 'read-time freshness expires without mutating the report or its saved currentness history');
  assert.equal(fixture.project.sourceReconciliationCurrentness.length, persistedCurrentnessCount);
  assert.throws(() => applyEnterpriseSourceAttestationCommand(fixture.project, normalizeEnterpriseSourceAttestationCommand({
    kind: 'repair-source-claim-mapping', blueprintId: afterRepair.id, blueprintVersion: afterRepair.version,
    profileId: fixture.profile.id, expectedProfileVersion: fixture.profile.version, expectedMappingVersion: 2,
    baselineAcceptanceReceiptId: fixture.accepted.sourceAcceptanceReceiptId,
    baselineReceiptHash: fixture.project.sourceAcceptanceReceipts.find((entry) => entry.id === fixture.accepted.sourceAcceptanceReceiptId).receiptHash,
    reportId: second.id, reportHash: second.reportHash,
    oldBinding: { ...oldBinding, targetObjectId: replacement.id }, replacementTargetObjectId: fixture.customer.id,
    reason: 'Attempt stale mapping repair.' }), 'owner-principal', { tenantId: TENANT, receivedAt: PROJECT_NOW }),
  { code: 'SOURCE_MAPPING_STALE', statusCode: 409 });
});

test('profile mapping repair leaves disjoint report dependencies current and recorded-time projection excludes later sequence', () => {
  const fixture = projectFixture(); const profile = fixture.profile;
  const current = latestBlueprint(fixture.project);
  const start = Math.max(Date.parse(current.createdAt) + 1000, Date.parse(PROJECT_NOW) + 1000);
  const firstAt = new Date(start).toISOString();
  const secondAt = new Date(start + 10_000).toISOString();
  const firstManifest = signedManifest(fixture, { observedAt: firstAt,
    validTime: { from: new Date(start - 1000).toISOString(), to: new Date(start + 3_600_000).toISOString() } });
  const first = ingest(fixture, firstManifest, firstAt).sourceAttestationReport;
  const alternate = current.areas.customersOfferingsValueEconomics.items.find((entry) => entry.id === 'customer-alternate');
  const unrelatedBaseline = addPinnedAcceptanceReceipt(fixture.project, { id: 'source-acceptance-00000000-0000-4000-8000-000000000099',
    sourceId: 'crm-main', sourceRecordId: 'crm-independent-record', claimId: 'crm-independent-claim', targetObjectId: alternate.id,
    sourceRecordName: alternate.name, value: alternate.detail, receivedAt: firstAt });
  const secondManifest = signedManifest(fixture, { sequence: 2, previousManifestHash: digest(firstManifest), observedAt: secondAt,
    baselineReceiptId: unrelatedBaseline.id,
    validTime: { from: firstAt, to: new Date(start + 3_600_000).toISOString() },
    records: [{ id: 'crm-independent-record', type: 'customer', name: alternate.name,
      claims: [{ id: 'crm-independent-claim', path: 'detail', value: alternate.detail, locator: 'other/detail', artifactHash: null }] }] });
  const unrelated = ingest(fixture, secondManifest, secondAt).sourceAttestationReport;
  assert.equal(fixture.project.sourceReconciliationCurrentness.filter((entry) => entry.reportId === unrelated.id).at(-1).state, 'FRESH');

  const overlappingSameSourceBaseline = addPinnedAcceptanceReceipt(fixture.project, { id: 'source-acceptance-00000000-0000-4000-8000-000000000097',
    sourceId: 'crm-main', sourceRecordId: 'crm-independent-record', claimId: 'crm-independent-claim', targetObjectId: current.areas.customersOfferingsValueEconomics.items.find((entry) => entry.type === 'customer').id,
    sourceRecordName: current.areas.customersOfferingsValueEconomics.items.find((entry) => entry.type === 'customer').name,
    value: 'Different accepted value for same source claim identity', receivedAt: firstAt });
  const currentTarget = current.areas.customersOfferingsValueEconomics.items.find((entry) => entry.type === 'customer');
  assert.throws(() => applyEnterpriseSourceAttestationCommand(fixture.project, normalizeEnterpriseSourceAttestationCommand({
    kind: 'repair-source-claim-mapping', blueprintId: current.id, blueprintVersion: current.version, profileId: profile.id,
    expectedProfileVersion: profile.version, expectedMappingVersion: 1,
    baselineAcceptanceReceiptId: overlappingSameSourceBaseline.id, baselineReceiptHash: overlappingSameSourceBaseline.receiptHash,
    reportId: unrelated.id, reportHash: unrelated.reportHash,
    oldBinding: { sourceRecordId: 'crm-independent-record', claimId: 'crm-independent-claim', path: 'detail', targetObjectId: alternate.id },
    replacementTargetObjectId: currentTarget.id, reason: 'Reject a same-source alternate baseline.' }),
  'owner-principal', { tenantId: TENANT, receivedAt: new Date(start + 15_000).toISOString() }),
  { code: 'SOURCE_MAPPING_REPORT_UNAVAILABLE', statusCode: 409 },
  'an alternate same-source acceptance receipt cannot authorize a report pinned to another baseline');

  const mappingRepair = normalizeEnterpriseSourceAttestationCommand({ kind: 'repair-source-claim-mapping',
    blueprintId: current.id, blueprintVersion: current.version, profileId: profile.id, expectedProfileVersion: profile.version,
    expectedMappingVersion: 1, baselineAcceptanceReceiptId: fixture.accepted.sourceAcceptanceReceiptId,
    baselineReceiptHash: fixture.project.sourceAcceptanceReceipts.find((entry) => entry.id === fixture.accepted.sourceAcceptanceReceiptId).receiptHash,
    reportId: first.id, reportHash: first.reportHash,
    oldBinding: { sourceRecordId: 'crm-customer-1', claimId: 'crm-detail', path: 'detail', targetObjectId: fixture.customer.id },
    replacementTargetObjectId: alternate.id, reason: 'Repair one exact customer mapping.' });
  applyEnterpriseSourceAttestationCommand(fixture.project, mappingRepair, 'owner-principal', { tenantId: TENANT,
    receivedAt: new Date(start + 20_000).toISOString() });
  const projected = projectEnterpriseSourceReconciliationCurrentness(fixture.project, new Date(start + 21_000).toISOString());
  assert.equal(projected.filter((entry) => entry.reportId === first.id).at(-1).state, 'STALE', 'the matching old binding is stale');
  assert.equal(projected.filter((entry) => entry.reportId === unrelated.id).at(-1).state, 'FRESH',
    'an unrelated binding in the same profile remains fresh across the mapping revision');

  const historical = projectEnterprise(fixture.project, { recordedAt: firstAt });
  assert.equal(historical.sourceReconciliationCurrentness.filter((entry) => entry.reportId === first.id).at(-1).state, 'FRESH',
    'the recorded-time view excludes the future second sequence and later mapping repair');
  assert.equal(historical.sourceReconciliationReports.some((entry) => entry.id === unrelated.id), false);

  const wrongSourceBaseline = addPinnedAcceptanceReceipt(fixture.project, { id: 'source-acceptance-00000000-0000-4000-8000-000000000098',
    sourceId: 'crm-other-source', sourceRecordId: 'crm-customer-1', claimId: 'crm-detail', targetObjectId: fixture.customer.id,
    sourceRecordName: fixture.customer.name, value: 'Overlapping claim identifier', receivedAt: firstAt });
  const latest = latestBlueprint(fixture.project);
  assert.throws(() => applyEnterpriseSourceAttestationCommand(fixture.project, normalizeEnterpriseSourceAttestationCommand({
    kind: 'repair-source-claim-mapping', blueprintId: latest.id, blueprintVersion: latest.version, profileId: profile.id,
    expectedProfileVersion: profile.version, expectedMappingVersion: 2, baselineAcceptanceReceiptId: wrongSourceBaseline.id,
    baselineReceiptHash: wrongSourceBaseline.receiptHash,
    reportId: unrelated.id, reportHash: unrelated.reportHash,
    oldBinding: { sourceRecordId: 'crm-customer-1', claimId: 'crm-detail', path: 'detail', targetObjectId: alternate.id },
    replacementTargetObjectId: fixture.customer.id, reason: 'Reject mapping authority from another source.' }),
  'owner-principal', { tenantId: TENANT, receivedAt: new Date(start + 30_000).toISOString() }),
  { code: 'SOURCE_MAPPING_BASELINE_UNAVAILABLE', statusCode: 409 },
  'overlapping record and claim IDs from another source cannot authorize the repair');
});

test('collector key rotation and revocation preserve versions and reject retired keys', () => {
  const fixture = projectFixture();
  const rotatedKeys = generateKeyPairSync('ed25519');
  const current = latestBlueprint(fixture.project);
  const rotated = applyEnterpriseSourceAttestationCommand(fixture.project, normalizeEnterpriseSourceAttestationCommand({
    kind: 'configure-source-attestation-profile', mode: 'ROTATE_KEY', profileId: fixture.profile.id, expectedProfileVersion: 1,
    blueprintId: current.id, blueprintVersion: current.version,
    profile: { ...fixture.profileInput, keyId: 'key-v2', publicKeyPem: rotatedKeys.publicKey.export({ type: 'spki', format: 'pem' }) },
    reason: 'Rotate collector test key.' }), 'owner-principal', { tenantId: TENANT, receivedAt: '2026-10-06T10:00:01.000Z' });
  assert.equal(rotated.sourceAttestationProfile.version, 2);
  assert.equal(rotated.sourceAttestationProfile.keys.find((key) => key.keyId === 'key-v1').status, 'ROTATED');
  assert.equal(rotated.sourceAttestationProfile.keys.find((key) => key.keyId === 'key-v2').status, 'ACTIVE');
  const retiredManifest = signedManifest(fixture, { profile: rotated.sourceAttestationProfile,
    signatureKeyId: 'key-v1', signatureKeyVersion: 1 });
  assert.throws(() => ingest(fixture, retiredManifest, PROJECT_NOW), { code: 'SOURCE_ATTESTATION_KEY_REVOKED', statusCode: 409 });
  const latest = latestBlueprint(fixture.project);
  const { keyId, publicKeyPem, ...revocationProfile } = fixture.profileInput;
  const revoked = applyEnterpriseSourceAttestationCommand(fixture.project, normalizeEnterpriseSourceAttestationCommand({
    kind: 'configure-source-attestation-profile', mode: 'REVOKE_KEY', profileId: fixture.profile.id, expectedProfileVersion: 2,
    blueprintId: latest.id, blueprintVersion: latest.version, profile: revocationProfile, reason: 'Revoke collector test key.' }),
  'owner-principal', { tenantId: TENANT, receivedAt: '2026-10-06T10:00:02.000Z' });
  assert.equal(revoked.sourceAttestationProfile.version, 3);
  assert.equal(revoked.sourceAttestationProfile.active, false);
  assert.equal(revoked.sourceAttestationProfile.keys.find((key) => key.keyId === 'key-v2').status, 'REVOKED');
});

test('attested correction refuses an expired finding without changing design or pending status', () => {
  const fixture = projectFixture(); const manifest = signedManifest(fixture, { value: 'Observed source correction' });
  const report = ingest(fixture, manifest, PROJECT_NOW).sourceAttestationReport;
  const finding = report.claims.find((entry) => entry.status === 'CONTRADICTED');
  assert.equal(finding.findingStatus, 'PENDING_REVIEW');
  const preview = previewEnterpriseAttestedSourceProposal(fixture.project, { reportId: report.id, reportHash: report.reportHash,
    findingId: finding.findingId, manifest }, TENANT, PROJECT_NOW);
  const current = latestBlueprint(fixture.project); const beforeVersions = structuredClone(fixture.project.blueprintVersions);
  const commandInput = { kind: 'propose-attested-source-correction',
    blueprintId: current.id, blueprintVersion: current.version, blueprintHash: digest(current), previewHash: preview.previewHash,
    reportId: report.id, reportHash: report.reportHash, findingId: finding.findingId, manifest,
    selections: [{ sourceRecordId: finding.sourceRecordId, targetObjectId: finding.targetObjectId, claimIds: [finding.claimId] }],
    reason: 'Owner reviewed the exact attested finding.' };
  assert.throws(() => normalizeEnterpriseSourceAcceptanceCommand({ ...commandInput,
    bundle: { kind: 'orgward-enterprise-source-evidence', schemaVersion: '1.0', source: { id: 'caller-source', label: 'arbitrary' }, records: [] } }),
  { code: 'INVALID_ATTESTED_SOURCE_PROPOSAL' }, 'the caller cannot attach a substitute source bundle to a report');
  const command = normalizeEnterpriseSourceAcceptanceCommand(commandInput);
  assert.throws(() => applyEnterpriseSourceAcceptance(fixture.project, command, 'owner-principal', { tenantId: TENANT,
    receivedAt: '2026-10-06T14:00:00.000Z' }), { code: 'SOURCE_FINDING_STALE', statusCode: 409 });
  assert.deepEqual(fixture.project.blueprintVersions, beforeVersions);
  assert.equal(fixture.project.sourceAttestationCorrectionReceipts, undefined);
  assert.equal(fixture.project.sourceReconciliationReports.find((entry) => entry.id === report.id).claims
    .find((entry) => entry.findingId === finding.findingId).findingStatus, 'PENDING_REVIEW');
});
