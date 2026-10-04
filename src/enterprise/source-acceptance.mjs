import { randomUUID } from 'node:crypto';
import { blueprintObjectEditInput, buildRelations, editBlueprintObject, latestBlueprint, validateBlueprint } from '../model.mjs';
import { digest } from '../sdlc/contracts.mjs';
import { blueprintObjects, enterpriseFailure, enterpriseText } from './types.mjs';
import { previewEnterpriseSourceEvidence, sourceEvidenceClaimStatus } from './source-onboarding.mjs';

export const ENTERPRISE_SOURCE_ACCEPTANCE_KINDS = new Set(['accept-source-evidence']);
const fail = (code, message, status = 400) => { throw enterpriseFailure(code, message, status); };
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeId = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9._:-]{0,119}$/i.test(value);

export function normalizeEnterpriseSourceAcceptanceCommand(input) {
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

export function applyEnterpriseSourceAcceptance(project, command, actor) {
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
      edits.set(target.id, values); accepted.push({ sourceRecordId: selection.sourceRecordId, claimId, targetObjectId: target.id,
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
  candidate.edit = { actor, at: candidate.createdAt, objectIds: [...edits.keys()].sort(), objectType: 'source-evidence',
    changedFields: ['acceptedSourceClaims'], before: null, after: null, reason: command.reason,
    source: { id: preview.source.id, snapshotHash: preview.source.snapshotHash }, acceptedClaims: accepted };
  scratch.blueprintVersions = [...project.blueprintVersions, candidate];
  scratch.audit = [...(project.audit ?? []).slice(0, initialAuditCount), { at: candidate.createdAt,
    action: 'enterprise.accept-source-evidence', actor, detail: `Accepted ${accepted.length} source-evidence claims into one proposed design version.` }];
  if (scratch.blueprintVersions.length !== initialBlueprintCount + 1) fail('ENTERPRISE_SOURCE_ATOMICITY', 'Source acceptance did not produce exactly one proposed design version.', 500);
  project.blueprintVersions = scratch.blueprintVersions; project.audit = scratch.audit;
  return { blueprint: candidate, affectedObjectId: accepted[0]?.targetObjectId ?? null, proposalId: null, source: preview.source,
    sourceHash: preview.source.snapshotHash,
    acceptedClaims: accepted, recordedAt: candidate.createdAt };
}
