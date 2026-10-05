import assert from 'node:assert/strict';
import test from 'node:test';
import { addConversationTurn, createProject, latestBlueprint } from '../../src/model.mjs';
import { digest } from '../../src/sdlc/contracts.mjs';
import { applyEnterpriseBulkEdit, applyEnterpriseDesignPack, createEnterpriseDesignPack, createEnterpriseInterchangeBundle,
  normalizeEnterpriseInterchangeCommand, previewEnterpriseDesignPack, previewEnterpriseInterchange } from '../../src/enterprise/interchange.mjs';
import { previewEnterpriseSourceEvidence } from '../../src/enterprise/source-onboarding.mjs';
import { applyEnterpriseSourceAcceptance, normalizeEnterpriseSourceAcceptanceCommand } from '../../src/enterprise/source-acceptance.mjs';

function completeProject() {
  const project = createProject('Interchange fixture');
  for (const answer of ['Transfer service', 'Small businesses', 'Clear status and fees', 'Humans approve exceptions']) addConversationTurn(project, answer);
  return project;
}

test('source onboarding preview proposes typed identities and claims with exact provenance without writes', () => {
  const project = completeProject(); const blueprint = latestBlueprint(project);
  const customer = blueprint.areas.customersOfferingsValueEconomics.items.find((entry) => entry.type === 'customer');
  const process = blueprint.areas.capabilitiesProcesses.items.find((entry) => entry.type === 'process');
  const capability = Object.values(blueprint.areas).flatMap((area) => area.items).find((entry) => entry.type === 'capability');
  const information = Object.values(blueprint.areas).flatMap((area) => area.items).find((entry) => entry.type === 'information');
  process.capability = capability.id;
  const sourceBundle = { kind: 'orgward-enterprise-source-evidence', schemaVersion: '1.0',
    source: { id: 'crm-export', label: 'CRM export', locator: 'crm://customers/export-7' }, records: [
      { id: 'crm-customer-1', type: 'customer', name: customer.name, claims: [
        { id: 'claim-customer-name', path: 'name', value: 'Potentially updated customer name', locator: 'customers/7/name' },
        { id: 'claim-customer-count', path: 'name', value: 7, locator: 'customers/7/score' },
        { id: 'claim-unknown', path: 'externalStatus', value: 'active', locator: 'customers/7/status' },
      ] },
      { id: 'crm-process-1', type: 'process', name: process.name, claims: [
        { id: 'claim-trigger', path: 'trigger', value: 'A reported request arrives', locator: 'processes/1/trigger' },
        { id: 'claim-info-ref', path: 'inputInformationIds', value: [information.id], locator: 'processes/1/input' },
        { id: 'claim-bad-info-ref', path: 'outputInformationIds', value: ['missing-information'], locator: 'processes/1/output' },
        { id: 'claim-clear-capability', path: 'capabilityId', value: null, locator: 'processes/1/capability' },
        { id: 'claim-set-capability', path: 'capabilityId', value: capability.id, locator: 'processes/1/capability' },
      ] },
      { id: 'crm-customer-2', type: 'customer', name: customer.name, claims: [
        { id: 'claim-duplicate', path: 'detail', value: 'Second source row', locator: 'customers/8/detail' },
      ] },
      { id: 'crm-new', type: 'customer', name: 'Unmatched name', claims: [
        { id: 'claim-new', path: 'name', value: 'Unmatched name', locator: 'customers/9/name' },
      ] },
    ] };
  const before = JSON.stringify(project);
  const preview = previewEnterpriseSourceEvidence(project, sourceBundle);
  const processProposal = preview.proposals.find((entry) => entry.identity.sourceRecordId === 'crm-process-1');
  assert.equal(processProposal.identity.status, 'CANDIDATE');
  assert.equal(processProposal.identity.provenance.sourceId, 'crm-export');
  assert.equal(processProposal.identity.provenance.sourceRecordId, 'crm-process-1');
  assert.equal(processProposal.identity.provenance.sourceLocator, 'crm://customers/export-7');
  assert.equal(processProposal.identity.provenance.recordLocator, 'crm-process-1');
  assert.match(processProposal.identity.provenance.sourceHash, /^[a-f0-9]{64}$/);
  assert.equal(processProposal.claims[0].status, 'PROPOSED');
  assert.equal(processProposal.claims[0].targetObjectId, process.id);
  assert.equal(processProposal.claims[0].provenance.sourceId, 'crm-export');
  assert.equal(processProposal.claims[0].provenance.sourceLocator, 'crm://customers/export-7');
  assert.equal(processProposal.claims[0].provenance.claimLocator, 'processes/1/trigger');
  assert.match(processProposal.claims[0].provenance.sourceHash, /^[a-f0-9]{64}$/);
  assert.equal(processProposal.claims.find((entry) => entry.id === 'claim-info-ref').status, 'PROPOSED');
  assert.equal(processProposal.claims.find((entry) => entry.id === 'claim-bad-info-ref').status, 'INVALID_REFERENCE');
  assert.equal(processProposal.claims.find((entry) => entry.id === 'claim-clear-capability').status, 'PROPOSED');
  assert.equal(processProposal.claims.find((entry) => entry.id === 'claim-clear-capability').expectedValueType, 'capability ID or null');
  assert.equal(processProposal.claims.find((entry) => entry.id === 'claim-set-capability').status, 'PROPOSED');
  const collisionRows = preview.proposals.filter((entry) => ['crm-customer-1', 'crm-customer-2'].includes(entry.identity.sourceRecordId));
  assert.deepEqual(collisionRows.map((entry) => entry.identity.status), ['COLLISION', 'COLLISION']);
  assert.ok(preview.collisions.every((entry) => entry.code === 'MULTIPLE_SOURCE_RECORDS_MATCH_TARGET'));
  const firstClaims = collisionRows[0].claims;
  assert.equal(firstClaims.find((entry) => entry.id === 'claim-customer-name').status, 'PROPOSED');
  assert.equal(firstClaims.find((entry) => entry.id === 'claim-customer-name').identityResolution, 'COLLISION');
  assert.equal(firstClaims.find((entry) => entry.id === 'claim-customer-count').status, 'TYPE_MISMATCH');
  assert.equal(firstClaims.find((entry) => entry.id === 'claim-unknown').status, 'UNKNOWN_FIELD');
  assert.equal(preview.proposals.find((entry) => entry.identity.sourceRecordId === 'crm-new').identity.status, 'UNMATCHED');
  assert.deepEqual(preview.meaning, 'UNTRUSTED_EVIDENCE_PROPOSALS_ONLY');
  assert.equal(preview.previewHash, previewEnterpriseSourceEvidence(project, sourceBundle).previewHash);
  assert.equal(JSON.stringify(project), before);
  assert.throws(() => previewEnterpriseSourceEvidence(project, { ...sourceBundle, records: [{ ...sourceBundle.records[0], claims: [{ id: 'claim', path: 'name', value: 'x', unexpected: true }] }] }),
    { code: 'INVALID_ENTERPRISE_SOURCE_CLAIM', statusCode: 400 });
});

test('accepted source claims create one exact-source proposed snapshot and reject stale or unresolved input atomically', () => {
  const project = completeProject(); const blueprint = latestBlueprint(project);
  const customer = blueprint.areas.customersOfferingsValueEconomics.items.find((entry) => entry.type === 'customer');
  const process = blueprint.areas.capabilitiesProcesses.items.find((entry) => entry.id === 'process-learn');
  const role = blueprint.areas.responsibilityAuthority.items.find((entry) => entry.id === 'role-founder');
  role.proposedInstructions = 'Review and approve proposed business changes within the founder role.';
  role.proposedScopeStatements = ['Business design and evidence review'];
  const sustainabilityMetric = blueprint.areas.metricsFeedback.items.find((entry) => entry.id === 'metric-sustainability');
  const sourceBundle = { kind: 'orgward-enterprise-source-evidence', schemaVersion: '1.0',
    source: { id: 'crm-export', label: 'CRM export', locator: 'crm://customers/export-7' }, records: [
      { id: 'crm-customer-1', type: 'customer', name: customer.name,
        claims: [{ id: 'claim-customer-name', path: 'name', value: 'Reviewed customer name', locator: 'customers/7/name' }] },
      { id: 'crm-process-1', type: 'process', name: process.name,
        claims: [{ id: 'claim-process-trigger', path: 'trigger', value: 'Reviewed request trigger', locator: 'processes/1/trigger' }] },
      { id: 'crm-role-1', type: 'role', name: role.name,
        claims: [{ id: 'claim-role-name', path: 'name', value: 'Reviewed human approver', locator: 'roles/1/name' }] },
      { id: 'crm-sustainability-metric', type: 'metric', name: sustainabilityMetric.name,
        claims: [{ id: 'claim-metric-name', path: 'name', value: 'Reviewed sustainability measure', locator: 'metrics/sustainability/name' }] },
    ] };
  const preview = previewEnterpriseSourceEvidence(project, sourceBundle);
  const command = normalizeEnterpriseSourceAcceptanceCommand({ kind: 'accept-source-evidence', blueprintId: blueprint.id,
    blueprintVersion: blueprint.version, blueprintHash: digest(blueprint), previewHash: preview.previewHash, bundle: sourceBundle,
    selections: [{ sourceRecordId: 'crm-role-1', targetObjectId: role.id, claimIds: ['claim-role-name'] },
      { sourceRecordId: 'crm-process-1', targetObjectId: process.id, claimIds: ['claim-process-trigger'] },
      { sourceRecordId: 'crm-customer-1', targetObjectId: customer.id, claimIds: ['claim-customer-name'] },
      { sourceRecordId: 'crm-sustainability-metric', targetObjectId: sustainabilityMetric.id, claimIds: ['claim-metric-name'] }],
    reason: 'Reviewed source evidence and accepted these four proposed fields.' });
  const priorCount = project.blueprintVersions.length; const priorVersion = blueprint.version;
  const result = applyEnterpriseSourceAcceptance(project, command, 'owner');
  assert.equal(project.blueprintVersions.length, priorCount + 1);
  assert.equal(result.blueprint.version, priorVersion + 1);
  assert.equal(result.acceptedClaims.length, 4);
  assert.equal(result.blueprint.areas.customersOfferingsValueEconomics.items.find((entry) => entry.id === customer.id).name, 'Reviewed customer name');
  const acceptedProcess = result.blueprint.areas.capabilitiesProcesses.items.find((entry) => entry.id === process.id);
  assert.equal(acceptedProcess.trigger, 'Reviewed request trigger');
  assert.equal(result.blueprint.areas.responsibilityAuthority.items.find((entry) => entry.id === role.id).name, 'Reviewed human approver');
  assert.equal(result.blueprint.areas.metricsFeedback.items.find((entry) => entry.id === sustainabilityMetric.id).name, 'Reviewed sustainability measure');
  assert.equal(result.blueprint.areas.metricsFeedback.items.find((entry) => entry.id === sustainabilityMetric.id).reads, 'economics-launch',
    'a name-only source claim does not send an unchanged invalid readInformationId:null field');
  assert.equal(acceptedProcess.provenance.at(-1).source, 'workspace:source-evidence-acceptance');
  assert.equal(acceptedProcess.provenance.at(-1).sourceEvidence.sourceHash, preview.source.snapshotHash);
  assert.equal(project.audit.filter((entry) => entry.action === 'enterprise.accept-source-evidence').length, 1);
  assert.equal(project.audit.some((entry) => entry.action === 'blueprint.object-edited'), false);

  const staleProject = completeProject(); const staleBlueprint = latestBlueprint(staleProject);
  const stalePreview = previewEnterpriseSourceEvidence(staleProject, sourceBundle);
  const staleCommand = { ...command, blueprintHash: 'f'.repeat(64) };
  assert.throws(() => applyEnterpriseSourceAcceptance(staleProject, staleCommand, 'owner'), (error) => error.code === 'ENTERPRISE_SOURCE_DESIGN_STALE' && error.statusCode === 409);
  const staleCustomer = staleBlueprint.areas.customersOfferingsValueEconomics.items.find((entry) => entry.type === 'customer');
  const staleProcess = staleBlueprint.areas.capabilitiesProcesses.items.find((entry) => entry.id === 'process-learn');
  const invalidCommand = { ...command, blueprintId: staleBlueprint.id, blueprintVersion: staleBlueprint.version, blueprintHash: digest(staleBlueprint),
    previewHash: stalePreview.previewHash,
    selections: [{ sourceRecordId: 'crm-customer-1', targetObjectId: staleCustomer.id, claimIds: ['claim-customer-name'] },
      { sourceRecordId: 'crm-process-1', targetObjectId: staleProcess.id, claimIds: ['claim-process-trigger', 'not-in-preview'] }] };
  const beforeRejected = JSON.stringify(staleProject);
  assert.throws(() => applyEnterpriseSourceAcceptance(staleProject, invalidCommand, 'owner'), (error) => error.code === 'ENTERPRISE_SOURCE_CLAIM_UNRESOLVED' && error.statusCode === 409);
  assert.equal(JSON.stringify(staleProject), beforeRejected);

  const rollbackProject = completeProject(); const rollbackBlueprint = latestBlueprint(rollbackProject);
  const rollbackCustomer = rollbackBlueprint.areas.customersOfferingsValueEconomics.items.find((entry) => entry.type === 'customer');
  const rollbackProcess = rollbackBlueprint.areas.capabilitiesProcesses.items.find((entry) => entry.id === 'process-learn');
  const rollbackRole = rollbackBlueprint.areas.responsibilityAuthority.items.find((entry) => entry.id === 'role-founder');
  const rollbackBundle = { kind: 'orgward-enterprise-source-evidence', schemaVersion: '1.0', source: { id: 'review-source', label: 'Reviewed source' }, records: [
    { id: 'source-customer', type: 'customer', name: rollbackCustomer.name, claims: [{ id: 'customer-name', path: 'name', value: 'Would be staged first' }] },
    { id: 'source-process', type: 'process', name: rollbackProcess.name, claims: [{ id: 'process-trigger', path: 'trigger', value: 'Would be staged first too' }] },
    { id: 'source-role', type: 'role', name: rollbackRole.name, claims: [{ id: 'empty-role-scope', path: 'proposedScopeStatements', value: [] }] },
  ] };
  const rollbackPreview = previewEnterpriseSourceEvidence(rollbackProject, rollbackBundle);
  assert.equal(rollbackPreview.proposals[2].claims[0].status, 'PROPOSED', 'the typed preview defers canonical edit constraints to atomic apply');
  const rollbackCommand = normalizeEnterpriseSourceAcceptanceCommand({ kind: 'accept-source-evidence', blueprintId: rollbackBlueprint.id,
    blueprintVersion: rollbackBlueprint.version, blueprintHash: digest(rollbackBlueprint), previewHash: rollbackPreview.previewHash,
    bundle: rollbackBundle, selections: [
      { sourceRecordId: 'source-customer', targetObjectId: rollbackCustomer.id, claimIds: ['customer-name'] },
      { sourceRecordId: 'source-process', targetObjectId: rollbackProcess.id, claimIds: ['process-trigger'] },
      { sourceRecordId: 'source-role', targetObjectId: rollbackRole.id, claimIds: ['empty-role-scope'] },
    ], reason: 'Verify grouped edits remain all-or-nothing if canonical validation rejects a later item.' });
  const beforeLateFailure = JSON.stringify(rollbackProject);
  assert.throws(() => applyEnterpriseSourceAcceptance(rollbackProject, rollbackCommand, 'owner'), (error) =>
    error.code === 'ENTERPRISE_SOURCE_ROLE_REPAIR_REQUIRED' && error.statusCode === 409
      && error.roleId === rollbackRole.id
      && error.invalidFields.includes('proposedInstructions')
      && error.invalidFields.includes('proposedScopeStatements'));
  assert.equal(JSON.stringify(rollbackProject), beforeLateFailure, 'earlier scratch edits are not persisted when a later canonical edit fails');
});

test('enterprise bundle preview binds source identity, reports known/unknown/loss fields and applies multiple edits as one atomic proposed version', () => {
  const project = completeProject(); const blueprint = latestBlueprint(project);
  const bundle = createEnterpriseInterchangeBundle(project.id, blueprint);
  const customer = bundle.records.find((record) => record.type === 'customer');
  const process = bundle.records.find((record) => record.type === 'process');
  assert.ok(customer);
  customer.fields.name = 'Imported small-business customers';
  process.fields.trigger = 'Imported qualified request';
  const preview = previewEnterpriseInterchange(project, bundle);
  const row = preview.rows.find((entry) => entry.id === customer.id);
  assert.equal(row.status, 'READY');
  assert.deepEqual(row.changedFields, ['name']);
  assert.ok(row.recognizedFields.includes('name'));
  assert.ok(row.lossFields.includes('provenance'));
  assert.deepEqual(row.unknownFields, []);
  assert.equal(preview.source.snapshotHash, bundle.source.snapshotHash);
  assert.match(preview.previewHash, /^[a-f0-9]{64}$/);
  assert.equal(preview.rows.find((entry) => entry.id === process.id).status, 'READY');

  const command = normalizeEnterpriseInterchangeCommand({ kind: 'bulk-edit-objects', blueprintId: blueprint.id,
    blueprintVersion: blueprint.version, bundle, recordIds: [customer.id, process.id], reason: 'Import reviewed proposed-design wording.' });
  const result = applyEnterpriseBulkEdit(project, command, 'human:owner');
  assert.equal(result.blueprint.version, blueprint.version + 1);
  assert.equal(result.blueprint.id === blueprint.id, false);
  const updatedCustomer = Object.values(result.blueprint.areas).flatMap((area) => area.items).find((entry) => entry.id === customer.id);
  assert.equal(updatedCustomer.name, 'Imported small-business customers');
  assert.equal(updatedCustomer.provenance.at(-1).source, 'workspace:enterprise-bulk-import');
  assert.equal(updatedCustomer.provenance.at(-1).reason, 'Import reviewed proposed-design wording.');
  const updatedProcess = Object.values(result.blueprint.areas).flatMap((area) => area.items).find((entry) => entry.id === process.id);
  assert.equal(updatedProcess.trigger, 'Imported qualified request');
  assert.deepEqual(result.importedRecordIds, [customer.id, process.id].sort());
  assert.equal(project.blueprintVersions.length, 2);
  assert.equal(project.audit.filter((entry) => entry.action === 'enterprise.bulk-edit-objects').length, 1);
});

test('enterprise import preview blocks malformed source, unknown fields and references with the wrong canonical type', () => {
  const project = completeProject(); const blueprint = latestBlueprint(project);
  const malformed = createEnterpriseInterchangeBundle(project.id, blueprint);
  malformed.baseline.areas.purposeStrategy.items[0].name = 'tampered source';
  assert.throws(() => previewEnterpriseInterchange(project, malformed), { code: 'ENTERPRISE_IMPORT_SOURCE_INVALID', statusCode: 400 });

  const inventedSource = createEnterpriseInterchangeBundle(project.id, blueprint);
  inventedSource.baseline.areas.purposeStrategy.items[0].detail = 'Invented baseline with a self-consistent hash';
  inventedSource.source.snapshotHash = digest(inventedSource.baseline);
  assert.equal(previewEnterpriseInterchange(project, inventedSource).rows[0].status, 'REVIEW_REQUIRED');

  const bundle = createEnterpriseInterchangeBundle(project.id, blueprint);
  bundle.unrecognizedTopLevel = true;
  const customer = bundle.records.find((record) => record.type === 'customer');
  customer.fields.name = 'Incoming name'; customer.fields.unmodeled = 'Keep visible, do not apply';
  const customerPreview = previewEnterpriseInterchange(project, bundle);
  assert.ok(customerPreview.unknownFields.some((entry) => entry.field === 'unrecognizedTopLevel' && entry.recordId === null));
  assert.ok(customerPreview.unknownFields.some((entry) => entry.recordId === customer.id && entry.field === 'unmodeled'));
  assert.equal(customerPreview.rows.find((entry) => entry.id === customer.id).status, 'REVIEW_REQUIRED');

  const typedBundle = createEnterpriseInterchangeBundle(project.id, blueprint);
  const process = typedBundle.records.find((record) => record.type === 'process');
  const customerId = typedBundle.records.find((record) => record.type === 'customer').id;
  process.fields.resourceIds = [customerId];
  const typedPreview = previewEnterpriseInterchange(project, typedBundle);
  const typedRow = typedPreview.rows.find((entry) => entry.id === process.id);
  assert.equal(typedRow.status, 'REVIEW_REQUIRED');
  assert.ok(typedRow.validationErrors.some((error) => error.code === 'INVALID_BLUEPRINT_RELATION'));

  const rejectedCommand = normalizeEnterpriseInterchangeCommand({ kind: 'bulk-edit-objects', blueprintId: blueprint.id,
    blueprintVersion: blueprint.version, bundle, recordIds: [customer.id], reason: 'Unknown fields must block apply.' });
  const before = JSON.stringify(project.blueprintVersions);
  assert.throws(() => applyEnterpriseBulkEdit(project, rejectedCommand, 'human:owner'),
    { code: 'ENTERPRISE_IMPORT_REVIEW_REQUIRED', statusCode: 409 });
  assert.equal(JSON.stringify(project.blueprintVersions), before, 'a blocked import leaves the canonical project unchanged');

  const partiallyInvalid = createEnterpriseInterchangeBundle(project.id, blueprint);
  const validCustomer = partiallyInvalid.records.find((record) => record.type === 'customer');
  validCustomer.fields.name = 'Would otherwise be applied';
  const invalidProcess = partiallyInvalid.records.find((record) => record.type === 'process');
  invalidProcess.fields.resourceIds = [customerId];
  const atomicCommand = normalizeEnterpriseInterchangeCommand({ kind: 'bulk-edit-objects', blueprintId: blueprint.id,
    blueprintVersion: blueprint.version, bundle: partiallyInvalid, recordIds: [validCustomer.id, invalidProcess.id], reason: 'Reject the entire mixed edit.' });
  assert.throws(() => applyEnterpriseBulkEdit(project, atomicCommand, 'human:owner'),
    { code: 'ENTERPRISE_IMPORT_REVIEW_REQUIRED', statusCode: 409 });
  assert.equal(JSON.stringify(project.blueprintVersions), before, 'one invalid selected record prevents every edit from being saved');
});

test('selected process pack carries its dependency closure across workspaces with explicit collision choices and local reference remapping', () => {
  const source = completeProject(); const target = completeProject();
  const sourceBlueprint = latestBlueprint(source); const targetBlueprint = latestBlueprint(target);
  const sourceBefore = JSON.stringify(source); const targetBefore = JSON.stringify(target);
  const pack = createEnterpriseDesignPack(source.id, sourceBlueprint, 'process-deliver');
  assert.equal(pack.kind, 'orgward-enterprise-process-pack');
  assert.equal(pack.source.projectId, source.id);
  assert.equal(pack.source.blueprintId, sourceBlueprint.id);
  assert.match(pack.source.snapshotHash, /^[a-f0-9]{64}$/);
  assert.ok(pack.records.length >= 7, 'the process pack includes a coherent multi-record dependency closure');
  assert.deepEqual(new Set(pack.records.map((record) => record.type)), new Set(['process', 'capability', 'role', 'information', 'resource', 'system']));
  assert.equal(pack.records.some((record) => record.type === 'customer'), false, 'the pack does not become a whole-blueprint export');

  const blocked = previewEnterpriseDesignPack(target, pack);
  assert.equal(blocked.sourceTrust, 'UNTRUSTED_UPLOADED_JSON');
  assert.equal(blocked.currentSource.projectId, target.id);
  assert.equal(blocked.currentSource.blueprintId, targetBlueprint.id);
  assert.equal(blocked.ready, false, 'same-name target records require an explicit reuse or copy decision');
  assert.ok(blocked.unresolvedDependencies.some((entry) => entry.candidates?.length));
  const reusedRole = pack.records.find((record) => record.type === 'role' && record.name === 'Operations owner');
  assert.ok(reusedRole);
  const mappings = Object.fromEntries(pack.records.map((record) => [record.id, null]));
  mappings[reusedRole.id] = 'role-operations';
  const preview = previewEnterpriseDesignPack(target, pack, mappings);
  assert.equal(preview.ready, true);
  assert.equal(preview.rows.find((row) => row.sourceRecordId === reusedRole.id).status, 'REUSE_TARGET');
  assert.deepEqual(preview.unresolvedDependencies, []);
  const command = normalizeEnterpriseInterchangeCommand({ kind: 'import-design-pack', blueprintId: targetBlueprint.id,
    blueprintVersion: targetBlueprint.version, bundle: pack, mappings, previewHash: preview.previewHash,
    reason: 'Review and reuse the selected customer delivery process and its declared dependencies.' });
  const applied = applyEnterpriseDesignPack(target, command, 'human:editor');
  assert.equal(applied.blueprint.version, targetBlueprint.version + 1);
  assert.equal(applied.blueprint.edit.objectType, 'process-pack');
  assert.equal(applied.blueprint.edit.packHash, pack.packHash);
  assert.equal(applied.blueprint.edit.source.projectId, source.id);
  assert.equal(applied.blueprint.edit.importedRecordIds.length, pack.records.length - 1);
  assert.notEqual(applied.affectedObjectId, 'process-deliver');
  const imported = new Map(Object.values(applied.blueprint.areas).flatMap((area) => area.items).map((record) => [record.id, record]));
  const importedRoot = imported.get(applied.affectedObjectId);
  assert.equal(importedRoot.type, 'process');
  assert.notEqual(importedRoot.capability, 'capability-delivery');
  assert.ok(imported.has(importedRoot.capability));
  const targetIds = new Set([...imported.keys(), ...Object.values(targetBlueprint.areas).flatMap((area) => area.items).map((record) => record.id)]);
  for (const id of [...importedRoot.inputs, ...importedRoot.outputs, ...importedRoot.resources, ...importedRoot.systems, importedRoot.owner]) {
    assert.ok(targetIds.has(id), `remapped process dependency ${id} exists in the target`);
  }
  assert.ok(importedRoot.provenance.at(-1).note.includes('source identity is not authenticated'));
  assert.equal(JSON.stringify(source), sourceBefore, 'pack creation and target apply never mutate the source workspace');
  assert.equal(target.blueprintVersions.length, 2);
  assert.equal(target.blueprintVersions[0].id, targetBlueprint.id);
  assert.notEqual(JSON.stringify(target), targetBefore);
  assert.throws(() => applyEnterpriseDesignPack(target, command, 'human:editor'), { code: 'ENTERPRISE_BLUEPRINT_STALE', statusCode: 409 });
});

test('process pack import rejects invalid source content, unresolved collisions, and malformed target mappings without writes', () => {
  const source = completeProject(); const target = completeProject();
  const pack = createEnterpriseDesignPack(source.id, latestBlueprint(source), 'process-deliver');
  const before = JSON.stringify(target);
  const tampered = structuredClone(pack); tampered.records[0].name = 'Tampered process';
  assert.throws(() => previewEnterpriseDesignPack(target, tampered), { code: 'DESIGN_PACK_CONTENT_INVALID', statusCode: 400 });
  const invalidHash = structuredClone(pack); invalidHash.baseline.title = 'Changed source baseline';
  assert.throws(() => previewEnterpriseDesignPack(target, invalidHash), { code: 'DESIGN_PACK_SOURCE_INVALID', statusCode: 400 });
  const invalidSchema = structuredClone(pack); invalidSchema.schemaVersion = '2.0';
  assert.throws(() => previewEnterpriseDesignPack(target, invalidSchema), { code: 'INVALID_DESIGN_PACK', statusCode: 400 });
  const unresolved = previewEnterpriseDesignPack(target, pack);
  const blockedCommand = normalizeEnterpriseInterchangeCommand({ kind: 'import-design-pack', blueprintId: latestBlueprint(target).id,
    blueprintVersion: latestBlueprint(target).version, bundle: pack, mappings: {}, previewHash: unresolved.previewHash,
    reason: 'Attempt to apply unresolved collisions.' });
  assert.throws(() => applyEnterpriseDesignPack(target, blockedCommand, 'human:editor'), { code: 'DESIGN_PACK_REVIEW_REQUIRED', statusCode: 409 });
  const record = pack.records.find((entry) => entry.type === 'process');
  const wrongType = previewEnterpriseDesignPack(target, pack, { [record.id]: 'information-customer-signal' });
  assert.equal(wrongType.ready, false);
  assert.ok(wrongType.unresolvedDependencies.some((entry) => entry.sourceRecordId === record.id));
  assert.equal(JSON.stringify(target), before, 'preview and rejected apply do not mutate target state');
});
