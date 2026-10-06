import { randomUUID } from 'node:crypto';
import { blueprintObjectEditInput, buildRelations, editBlueprintObject, latestBlueprint, validateBlueprint } from '../model.mjs';
import { digest } from '../sdlc/contracts.mjs';
import { blueprintObjects, enterpriseFailure, enterpriseText } from './types.mjs';
import { enterpriseSourceEvidenceHash, previewEnterpriseSourceEvidence, sourceEvidenceClaimStatus,
  validateEnterpriseSourceEvidenceBundle } from './source-onboarding.mjs';
import { previewEnterpriseAttestedSourceProposal, verifyEnterpriseAttestedSourceProposal } from './source-attestation.mjs';

export const ENTERPRISE_SOURCE_ACCEPTANCE_KINDS = new Set(['accept-source-evidence', 'compare-source-evidence', 'propose-attested-source-correction']);
const fail = (code, message, status = 400) => { throw enterpriseFailure(code, message, status); };
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeId = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9._:-]{0,119}$/i.test(value);

export function normalizeEnterpriseSourceAcceptanceCommand(input) {
  if (plainObject(input) && input.kind === 'propose-attested-source-correction') {
    if (!/^blueprint-[0-9a-f-]{36}$/.test(input.blueprintId ?? '') || !Number.isSafeInteger(input.blueprintVersion) || input.blueprintVersion < 1
      || !/^[a-f0-9]{64}$/.test(input.blueprintHash ?? '') || !/^[a-f0-9]{64}$/.test(input.previewHash ?? '')
      || !/^source-reconciliation-[0-9a-f-]{36}$/.test(input.reportId ?? '') || !/^[a-f0-9]{64}$/.test(input.reportHash ?? '')
      || !/^source-finding-[0-9a-f-]{36}$/.test(input.findingId ?? '') || !plainObject(input.manifest)
      || !Array.isArray(input.selections) || !input.selections.length || input.selections.length > 100
      || Object.keys(input).some((key) => !['kind', 'blueprintId', 'blueprintVersion', 'blueprintHash', 'previewHash', 'reportId', 'reportHash',
        'findingId', 'manifest', 'selections', 'reason'].includes(key))) {
      fail('INVALID_ATTESTED_SOURCE_PROPOSAL', 'Bind a proposed correction to one current design, immutable finding, exact report and signed manifest.');
    }
    const selections = [];
    const selectedRecords = new Set(); let selectedClaimCount = 0;
    for (const selection of input.selections) {
      if (!plainObject(selection) || !safeId(selection.sourceRecordId) || !safeId(selection.targetObjectId)
        || !Array.isArray(selection.claimIds) || !selection.claimIds.length || selection.claimIds.some((id) => !safeId(id))
        || new Set(selection.claimIds).size !== selection.claimIds.length || selectedRecords.has(selection.sourceRecordId)) {
        fail('INVALID_ATTESTED_SOURCE_PROPOSAL', 'Select exact source claims and canonical targets for the proposed correction.');
      }
      selectedRecords.add(selection.sourceRecordId); selectedClaimCount += selection.claimIds.length;
      selections.push({ sourceRecordId: selection.sourceRecordId, targetObjectId: selection.targetObjectId, claimIds: [...selection.claimIds].sort() });
    }
    if (selectedClaimCount > 100) fail('INVALID_ATTESTED_SOURCE_PROPOSAL', 'A proposed correction can contain at most 100 claims.');
    if (Buffer.byteLength(JSON.stringify(input.manifest), 'utf8') > 1_000_000) fail('ENTERPRISE_SOURCE_TOO_LARGE', 'The reuploaded signed manifest exceeds 1 MB.');
    return { kind: input.kind, blueprintId: input.blueprintId, blueprintVersion: input.blueprintVersion, blueprintHash: input.blueprintHash,
      previewHash: input.previewHash, reportId: input.reportId, reportHash: input.reportHash, findingId: input.findingId,
      manifest: structuredClone(input.manifest), selections, reason: enterpriseText(input.reason, 'Correction proposal reason', 500) };
  }
  if (plainObject(input) && input.kind === 'compare-source-evidence') {
    if (!/^blueprint-[0-9a-f-]{36}$/.test(input.blueprintId ?? '')
      || !Number.isSafeInteger(input.blueprintVersion) || input.blueprintVersion < 1
      || !/^source-acceptance-[0-9a-f-]{36}$/.test(input.acceptanceReceiptId ?? '')
      || !plainObject(input.bundle)
      || Object.keys(input).some((key) => !['kind', 'blueprintId', 'blueprintVersion', 'acceptanceReceiptId', 'bundle'].includes(key))) {
      fail('INVALID_SOURCE_EVIDENCE_COMPARISON', 'Bind an uploaded source-evidence bundle to one saved acceptance baseline and current main design.');
    }
    validateEnterpriseSourceEvidenceBundle(input.bundle);
    return { kind: input.kind, blueprintId: input.blueprintId, blueprintVersion: input.blueprintVersion,
      acceptanceReceiptId: input.acceptanceReceiptId, bundle: structuredClone(input.bundle) };
  }
  if (!plainObject(input) || input.kind !== 'accept-source-evidence'
    || !/^blueprint-[0-9a-f-]{36}$/.test(input.blueprintId ?? '')
    || !Number.isSafeInteger(input.blueprintVersion) || input.blueprintVersion < 1
    || !/^[a-f0-9]{64}$/.test(input.blueprintHash ?? '')
    || !/^[a-f0-9]{64}$/.test(input.previewHash ?? '')
    || !plainObject(input.bundle) || !Array.isArray(input.selections) || !input.selections.length || input.selections.length > 100) {
    fail('INVALID_SOURCE_EVIDENCE_ACCEPTANCE', 'Bind selected source claims to the exact preview and current proposed design.');
  }
  const selections = [];
  const seenRecords = new Set(); let totalClaims = 0;
  for (const selection of input.selections) {
    if (!plainObject(selection) || !safeId(selection.sourceRecordId) || !safeId(selection.targetObjectId)
      || !Array.isArray(selection.claimIds) || !selection.claimIds.length || selection.claimIds.some((id) => !safeId(id))
      || new Set(selection.claimIds).size !== selection.claimIds.length || seenRecords.has(selection.sourceRecordId)) {
      fail('INVALID_SOURCE_EVIDENCE_ACCEPTANCE', 'Each selected source record needs one canonical target and distinct claim IDs.');
    }
    seenRecords.add(selection.sourceRecordId); totalClaims += selection.claimIds.length;
    selections.push({ sourceRecordId: selection.sourceRecordId, targetObjectId: selection.targetObjectId, claimIds: [...selection.claimIds].sort() });
  }
  if (totalClaims > 100 || Object.keys(input).some((key) => !['kind', 'blueprintId', 'blueprintVersion', 'blueprintHash', 'previewHash', 'bundle', 'selections', 'reason'].includes(key))) {
    fail('INVALID_SOURCE_EVIDENCE_ACCEPTANCE', 'Accept at most 100 source claims and no unsupported command fields.');
  }
  if (Buffer.byteLength(JSON.stringify(input.bundle), 'utf8') > 1_000_000) fail('ENTERPRISE_SOURCE_TOO_LARGE', 'The retained source bundle exceeds 1 MB.');
  return { kind: input.kind, blueprintId: input.blueprintId, blueprintVersion: input.blueprintVersion, blueprintHash: input.blueprintHash,
    previewHash: input.previewHash, bundle: structuredClone(input.bundle), selections, reason: enterpriseText(input.reason, 'Acceptance reason', 500) };
}

export function applyEnterpriseSourceAcceptance(project, command, actor, options = {}) {
  if (command.kind === 'compare-source-evidence') return applyEnterpriseSourceComparison(project, command, actor, options);
  let attestedCorrection = null;
  if (command.kind === 'propose-attested-source-correction') {
    attestedCorrection = verifyEnterpriseAttestedSourceProposal(project, command, options.tenantId, options.receivedAt);
    const finding = attestedCorrection.finding;
    const foundRecord = attestedCorrection.manifest.records.find((record) => record.id === finding.sourceRecordId);
    const foundClaim = foundRecord?.claims.find((claim) => claim.id === finding.claimId);
    const selectedFinding = command.selections.some((selection) => selection.sourceRecordId === finding.sourceRecordId
      && selection.targetObjectId === finding.targetObjectId && selection.claimIds.includes(finding.claimId));
    if (!foundRecord || !foundClaim || foundRecord.type !== finding.sourceRecordType || foundRecord.name !== finding.sourceRecordName
      || foundClaim.path !== finding.path || canonical(foundClaim.value) !== canonical(finding.observedValue) || !selectedFinding) {
      fail('SOURCE_FINDING_MAPPING_MISMATCH', 'The selected correction must preserve the finding’s exact source record, claim, path, observed value and canonical target.', 409);
    }
    const preview = previewEnterpriseSourceEvidence(project, attestedCorrection.bundle);
    if (preview.previewHash !== command.previewHash) fail('ENTERPRISE_SOURCE_PREVIEW_STALE', 'The attested source preview changed; review it again before proposing a correction.', 409);
    command = { kind: 'accept-source-evidence', blueprintId: command.blueprintId, blueprintVersion: command.blueprintVersion,
      blueprintHash: command.blueprintHash, previewHash: command.previewHash, bundle: attestedCorrection.bundle,
      selections: command.selections, reason: command.reason };
  }
  const current = latestBlueprint(project);
  if (!current || current.id !== command.blueprintId || current.version !== command.blueprintVersion || digest(current) !== command.blueprintHash) {
    fail('ENTERPRISE_SOURCE_DESIGN_STALE', 'The proposed design changed after preview. Recheck the source bundle before accepting claims.', 409);
  }
  const preview = previewEnterpriseSourceEvidence(project, command.bundle);
  if (preview.previewHash !== command.previewHash || preview.currentSource.blueprintId !== command.blueprintId
    || preview.currentSource.blueprintVersion !== command.blueprintVersion || preview.currentSource.snapshotHash !== command.blueprintHash) {
    fail('ENTERPRISE_SOURCE_PREVIEW_STALE', 'The source preview changed. Recheck its identities and claims before accepting them.', 409);
  }
  const objects = new Map(blueprintObjects(current).map((object) => [object.id, object]));
  const sourceRecords = new Map(preview.proposals.map((proposal) => [proposal.identity.sourceRecordId, proposal]));
  const edits = new Map(); const accepted = [];
  for (const selection of command.selections) {
    const proposal = sourceRecords.get(selection.sourceRecordId);
    const target = objects.get(selection.targetObjectId);
    if (!proposal || !target || target.type !== proposal.identity.type) {
      fail('ENTERPRISE_SOURCE_IDENTITY_UNRESOLVED', 'Resolve the source identity to an existing canonical record of the exact source type.', 409);
    }
    const currentFields = Object.fromEntries(Object.entries(blueprintObjectEditInput(current, target)).filter(([key]) => key !== 'objectId'));
    const byId = new Map(objects);
    const claims = new Map(proposal.claims.map((claim) => [claim.id, claim]));
    for (const claimId of selection.claimIds) {
      const claim = claims.get(claimId);
      if (!claim || !Object.hasOwn(currentFields, claim.path)
        || !['PROPOSED', 'IDENTITY_UNRESOLVED'].includes(claim.status)
        || sourceEvidenceClaimStatus(claim.path, currentFields[claim.path], claim.value, byId) !== 'PROPOSED') {
        fail('ENTERPRISE_SOURCE_CLAIM_UNRESOLVED', `Claim ${claimId} is not a valid typed proposal for the selected canonical target.`, 409);
      }
      const values = edits.get(target.id) ?? { objectId: target.id, name: target.name, detail: target.detail,
        ...(target.type === 'process' ? { trigger: currentFields.trigger } : {}),
        ...(target.type === 'role' ? { proposedInstructions: currentFields.proposedInstructions,
          proposedScopeStatements: currentFields.proposedScopeStatements } : {}), claims: [] };
      if (values.claims.some((entry) => entry.path === claim.path)) fail('ENTERPRISE_SOURCE_CLAIM_COLLISION', `More than one selected claim targets ${claim.path}.`, 409);
      values[claim.path] = structuredClone(claim.value); values.claims.push(claim);
      edits.set(target.id, values); accepted.push({ sourceRecordId: selection.sourceRecordId, sourceRecordType: proposal.identity.type,
        sourceRecordName: proposal.identity.name, claimId, targetObjectId: target.id, path: claim.path, value: structuredClone(claim.value),
        sourceLocator: claim.provenance.sourceLocator, recordLocator: claim.provenance.recordLocator,
        claimLocator: claim.provenance.claimLocator, sourceHash: claim.provenance.sourceHash });
    }
  }

  // Roles have mandatory operating instructions and a declared scope. Never
  // fabricate these values when accepting unrelated evidence: report the
  // canonical role and fields that need human repair before applying a batch.
  for (const [targetId, entry] of edits) {
    const target = objects.get(targetId);
    if (target?.type !== 'role') continue;
    const invalidFields = [];
    if (typeof entry.proposedInstructions !== 'string' || !entry.proposedInstructions.trim()
      || entry.proposedInstructions.length > 700) invalidFields.push('proposedInstructions');
    if (!Array.isArray(entry.proposedScopeStatements) || !entry.proposedScopeStatements.length
      || entry.proposedScopeStatements.length > 12 || entry.proposedScopeStatements.some((value) => typeof value !== 'string'
        || !value.trim() || value.trim().length > 240)) invalidFields.push('proposedScopeStatements');
    if (invalidFields.length) {
      const error = enterpriseFailure('ENTERPRISE_SOURCE_ROLE_REPAIR_REQUIRED',
        `Role ${targetId} needs valid mandatory fields before source claims can be accepted.`, 409);
      error.roleId = targetId;
      error.invalidFields = invalidFields;
      throw error;
    }
  }

  const scratch = structuredClone(project); const initialBlueprintCount = scratch.blueprintVersions.length;
  const initialAuditCount = scratch.audit?.length ?? 0;
  let candidate = current;
  for (const [targetId, entry] of edits) {
    candidate = editBlueprintObject(scratch, Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'claims')), actor);
    const changed = blueprintObjects(candidate).find((object) => object.id === targetId);
    const provenance = changed?.provenance?.at(-1);
    if (provenance) Object.assign(provenance, { source: 'workspace:source-evidence-acceptance', reason: command.reason,
      sourceEvidence: { sourceId: preview.source.id, sourceHash: preview.source.snapshotHash,
        sourceLocator: preview.source.locator,
        sourceRecordIds: [...new Set(entry.claims.map((claim) => claim.provenance.sourceRecordId))].sort(),
        claimIds: entry.claims.map((claim) => claim.id).sort(),
        claimLocators: entry.claims.map((claim) => claim.provenance.claimLocator).filter(Boolean).sort() } });
  }
  if (candidate === current) fail('ENTERPRISE_SOURCE_NO_CHANGE', 'Select at least one accepted claim that changes the proposed design.', 409);
  candidate.version = current.version + 1; candidate.createdAt = new Date().toISOString(); candidate.id = `blueprint-${randomUUID()}`;
  candidate.epistemicStatus = 'proposed-design'; candidate.relations = buildRelations(candidate.areas); candidate.integrity = validateBlueprint(candidate);
  if (!candidate.integrity.valid) fail('INVALID_SOURCE_EVIDENCE_ACCEPTANCE', candidate.integrity.errors[0]?.message ?? 'The combined accepted claims are invalid.', 409);
  const acceptanceReceiptId = `source-acceptance-${randomUUID()}`;
  candidate.edit = { actor, at: candidate.createdAt, objectIds: [...edits.keys()].sort(), objectType: 'source-evidence',
    changedFields: ['acceptedSourceClaims'], before: null, after: null, reason: command.reason,
    source: { id: preview.source.id, snapshotHash: preview.source.snapshotHash }, acceptanceReceiptId, acceptedClaims: accepted };
  let correctionReceipts = [];
  if (attestedCorrection) {
    const { report, reportHash, manifestHash, finding, profile, key, manifest } = attestedCorrection;
    const record = manifest.records.find((entry) => entry.id === finding.sourceRecordId);
    const claim = record.claims.find((entry) => entry.id === finding.claimId);
    const correctionReceiptId = `source-correction-${randomUUID()}`;
    const currentDesign = { id: command.blueprintId, version: command.blueprintVersion, snapshotHash: command.blueprintHash };
    candidate.edit.attestedSourceFinding = { findingId: finding.findingId, findingStatus: 'PENDING_REVIEW', reportId: report.id,
      reportHash, manifestHash, derivedBundleHash: preview.source.snapshotHash, acceptedEvidenceBaseline: { acceptanceReceiptId: report.baseline.acceptanceReceiptId,
        receiptHash: report.baseline.receiptHash }, currentDesign, candidate: { id: candidate.id, version: candidate.version }, correctionReceiptId };
    const candidateSnapshotHash = digest(candidate);
    const receiptCore = { id: correctionReceiptId, status: 'PROPOSED', findingId: finding.findingId,
      findingStatus: 'PENDING_REVIEW', reportId: report.id, reportHash, findingRowIndex: finding.findingRowIndex,
      signedManifestHash: manifestHash, derivedBundleHash: preview.source.snapshotHash, source: { id: profile.sourceId, accountId: profile.sourceAccountId,
        instanceId: profile.sourceInstanceId, namespace: profile.resourceNamespace, profileId: profile.id,
        profileVersion: profile.version, collectorId: profile.collectorId, keyId: key.keyId, keyVersion: key.keyVersion,
        keyFingerprint: key.fingerprint, sequence: manifest.source.sequence, observedAt: manifest.observedAt,
        validTime: structuredClone(manifest.validTime) },
      acceptedEvidenceBaseline: { acceptanceReceiptId: report.baseline.acceptanceReceiptId, receiptHash: report.baseline.receiptHash },
      sourceClaim: { recordId: record.id, recordType: record.type, recordName: record.name, claimId: claim.id,
        path: claim.path, acceptedValue: structuredClone(finding.acceptedValue), observedValue: structuredClone(claim.value),
        targetObjectId: finding.targetObjectId }, reason: command.reason, createdBy: actor, createdAt: candidate.createdAt,
      currentDesign, candidate: { id: candidate.id, version: candidate.version, snapshotHash: digest(candidate) }, acceptanceReceiptId };
    correctionReceipts = [{ ...receiptCore, receiptHash: digest(receiptCore) }];
  }
  const acceptanceCore = { id: acceptanceReceiptId, commandId: options.commandId ?? null, uploader: actor,
    receivedAt: options.receivedAt ?? new Date().toISOString(), source: { id: preview.source.id,
      label: preview.source.label, locator: preview.source.locator ?? null, bundleHash: preview.source.snapshotHash },
    acceptedBlueprint: { id: candidate.id, version: candidate.version, snapshotHash: digest(candidate) },
    claims: accepted.map(({ sourceRecordId, sourceRecordType, sourceRecordName, claimId, targetObjectId, path, value,
      sourceLocator, recordLocator, claimLocator, sourceHash }) => ({ sourceRecordId, sourceRecordType, sourceRecordName,
      claimId, targetObjectId, path, value, sourceLocator, recordLocator, claimLocator, sourceHash })),
    ...(attestedCorrection ? { attestedCorrection: { reportId: attestedCorrection.report.id, reportHash: attestedCorrection.reportHash,
      manifestHash: attestedCorrection.manifestHash, findingId: attestedCorrection.finding.findingId,
      findingStatus: 'PENDING_REVIEW', correctionReceiptIds: correctionReceipts.map((entry) => entry.id) } } : {}) };
  const acceptanceReceipt = { ...acceptanceCore, receiptHash: digest(acceptanceCore) };
  scratch.blueprintVersions = [...project.blueprintVersions, candidate];
  scratch.audit = [...(project.audit ?? []).slice(0, initialAuditCount), { at: candidate.createdAt,
    action: attestedCorrection ? 'enterprise.propose-attested-source-correction' : 'enterprise.accept-source-evidence', actor,
    detail: attestedCorrection ? `Created proposed correction ${correctionReceipts[0].id} for pending finding ${attestedCorrection.finding.findingId}; no approval or publication was performed.`
      : `Accepted ${accepted.length} source-evidence claims into one proposed design version.` }];
  if (scratch.blueprintVersions.length !== initialBlueprintCount + 1) fail('ENTERPRISE_SOURCE_ATOMICITY', 'Source acceptance did not produce exactly one proposed design version.', 500);
  project.blueprintVersions = scratch.blueprintVersions; project.audit = scratch.audit;
  project.sourceAcceptanceReceipts = [...(project.sourceAcceptanceReceipts ?? []), acceptanceReceipt];
  if (correctionReceipts.length) project.sourceAttestationCorrectionReceipts = [...(project.sourceAttestationCorrectionReceipts ?? []), ...correctionReceipts];
  return { blueprint: candidate, affectedObjectId: accepted[0]?.targetObjectId ?? null, proposalId: null, source: preview.source,
    sourceHash: preview.source.snapshotHash, sourceAcceptanceReceiptId: acceptanceReceipt.id,
    acceptedClaims: accepted, sourceAttestationCorrectionReceiptIds: correctionReceipts.map((entry) => entry.id), recordedAt: candidate.createdAt };
}

const valueKind = (value) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const normalizedIdentityName = (value) => typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US') : null;

function acceptanceReceiptValid(receipt, project) {
  if (!plainObject(receipt) || !/^source-acceptance-[0-9a-f-]{36}$/.test(receipt.id ?? '')
    || !Array.isArray(receipt.claims) || !receipt.claims.length || !plainObject(receipt.acceptedBlueprint) || !plainObject(receipt.source)
    || !safeId(receipt.source.id) || typeof receipt.source.label !== 'string' || !receipt.source.label.trim()
    || !/^[a-f0-9]{64}$/.test(receipt.source.bundleHash ?? '')
    || !/^blueprint-[0-9a-f-]{36}$/.test(receipt.acceptedBlueprint.id ?? '')
    || !Number.isSafeInteger(receipt.acceptedBlueprint.version) || receipt.acceptedBlueprint.version < 1) return false;
  const { receiptHash, ...core } = receipt;
  if (!/^[a-f0-9]{64}$/.test(receiptHash ?? '') || digest(core) !== receiptHash) return false;
  const acceptedBlueprint = project.blueprintVersions?.find((entry) => entry.id === receipt.acceptedBlueprint.id
    && entry.version === receipt.acceptedBlueprint.version);
  return /^[a-f0-9]{64}$/.test(receipt.acceptedBlueprint.snapshotHash ?? '') && acceptedBlueprint
    && digest(acceptedBlueprint) === receipt.acceptedBlueprint.snapshotHash
    && digest(acceptedBlueprint.edit?.acceptedClaims ?? null) === digest(receipt.claims)
    && receipt.claims.every((claim) => plainObject(claim) && safeId(claim.sourceRecordId) && safeId(claim.claimId)
      && safeId(claim.targetObjectId) && typeof claim.sourceRecordType === 'string' && claim.sourceRecordType.trim()
      && typeof claim.sourceRecordName === 'string' && claim.sourceRecordName.trim()
      && typeof claim.path === 'string' && claim.path.length > 0 && Object.hasOwn(claim, 'value')
      && claim.sourceHash === receipt.source.bundleHash);
}

function applyEnterpriseSourceComparison(project, command, actor, options) {
  const current = latestBlueprint(project);
  if (!current || current.id !== command.blueprintId || current.version !== command.blueprintVersion) {
    fail('ENTERPRISE_SOURCE_COMPARISON_CONTEXT_STALE', 'Reload the current main design before recording this upload comparison.', 409);
  }
  const baseline = (project.sourceAcceptanceReceipts ?? []).find((entry) => entry.id === command.acceptanceReceiptId) ?? null;
  const baselineValid = acceptanceReceiptValid(baseline, project);
  const sourceBundleHash = enterpriseSourceEvidenceHash(command.bundle);
  const uploadedRecords = new Map(command.bundle.records.map((record) => [record.id, record]));
  const sourceIdentityMatches = baselineValid && command.bundle.source.id === baseline.source.id;
  const claims = (baselineValid ? baseline.claims : []).map((accepted) => {
    const common = { sourceRecordId: accepted.sourceRecordId, targetObjectId: accepted.targetObjectId,
      claimId: accepted.claimId, path: accepted.path, acceptedValue: structuredClone(accepted.value) };
    if (!baselineValid) return { ...common, uploadedValue: null, status: 'UNVERIFIABLE',
      reason: 'The pinned acceptance receipt is missing, malformed or failed its integrity check.' };
    if (!sourceIdentityMatches) return { ...common, uploadedValue: null, status: 'UNVERIFIABLE',
      reason: 'The uploaded source ID differs from the source pinned by the acceptance receipt.' };
    const record = uploadedRecords.get(accepted.sourceRecordId);
    if (!record) return { ...common, uploadedValue: null, status: 'MISSING',
      reason: 'This accepted source record is absent from the uploaded bundle; this does not assert that it was deleted at source.' };
    if (record.type !== accepted.sourceRecordType || normalizedIdentityName(record.name) !== normalizedIdentityName(accepted.sourceRecordName)) {
      return { ...common, uploadedValue: null, uploadedRecordType: record.type, uploadedRecordName: record.name,
        status: 'UNVERIFIABLE', reason: 'The source record type or canonical name changed, so the pinned identity cannot be assumed.' };
    }
    const claim = record.claims.find((entry) => entry.id === accepted.claimId);
    if (!claim) return { ...common, uploadedValue: null, status: 'MISSING',
      reason: 'This accepted claim is absent from this upload only; no source deletion or current truth is inferred.' };
    if (claim.path !== accepted.path) return { ...common, uploadedValue: structuredClone(claim.value), uploadedPath: claim.path,
      status: 'UNVERIFIABLE', reason: 'The claim path changed, so the original field meaning cannot be assumed.' };
    if (valueKind(claim.value) !== valueKind(accepted.value)) return { ...common, uploadedValue: structuredClone(claim.value),
      status: 'UNVERIFIABLE', reason: 'The claim value type changed, so the original field meaning cannot be compared.' };
    const matched = canonical(claim.value) === canonical(accepted.value);
    return { ...common, uploadedValue: structuredClone(claim.value), status: matched ? 'MATCHED' : 'DRIFTED',
      reason: matched ? 'The uploaded value equals the value pinned at explicit acceptance.'
        : 'The uploaded value differs from the value pinned at explicit acceptance.' };
  });
  const counts = Object.fromEntries(['MATCHED', 'DRIFTED', 'MISSING', 'UNVERIFIABLE'].map((status) => [status,
    claims.filter((claim) => claim.status === status).length]));
  const issues = baselineValid ? [] : [{ status: 'UNVERIFIABLE', reason: 'The pinned acceptance receipt is missing, malformed or failed its integrity check.' }];
  counts.UNVERIFIABLE += issues.length;
  const reportId = `source-reconciliation-${randomUUID()}`;
  const receivedAt = options.receivedAt ?? new Date().toISOString();
  const report = { id: reportId, comparatorVersion: 'uploaded-source-claims/v1', uploader: actor, receivedAt,
    projectId: project.id, expectedProjectVersion: options.expectedVersion ?? project.version,
    baseline: { acceptanceReceiptId: command.acceptanceReceiptId, receiptHash: baseline?.receiptHash ?? null,
      sourceId: baseline?.source?.id ?? null, sourceBundleHash: baseline?.source?.bundleHash ?? null,
      acceptedBlueprint: baseline?.acceptedBlueprint ? structuredClone(baseline.acceptedBlueprint) : null,
      integrity: baselineValid ? 'VERIFIED_INTERNAL_HASH' : 'UNVERIFIABLE' },
    input: { sourceId: command.bundle.source.id, sourceLabel: command.bundle.source.label,
      sourceBundleHash, recordCount: command.bundle.records.length,
      claimCount: command.bundle.records.reduce((sum, record) => sum + record.claims.length, 0) },
    sourceAuthentication: 'UNVERIFIED', freshness: 'UNKNOWN', claims, issues, counts,
    limitations: ['This compares uploaded claims with the explicit accepted input only; it does not read or authenticate a live source.',
      'The receipt time is when OrgWard recorded the upload comparison, not when the source was observed.',
      'The report is pinned to its acceptance baseline and does not describe later design versions or operational truth.'] };
  project.sourceReconciliationReports = [...(project.sourceReconciliationReports ?? []), report];
  project.audit ??= [];
  project.audit.push({ at: receivedAt, action: 'enterprise.compare-source-evidence', actor,
    detail: `Recorded ${counts.MATCHED} matched, ${counts.DRIFTED} changed, ${counts.MISSING} absent and ${counts.UNVERIFIABLE} unverifiable accepted claims against ${command.acceptanceReceiptId}.` });
  return { blueprint: current, affectedObjectId: null, sourceReconciliationReportId: reportId, sourceReconciliationReport: report,
    recordedAt: receivedAt };
}
