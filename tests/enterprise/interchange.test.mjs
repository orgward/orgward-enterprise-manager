import assert from 'node:assert/strict';
import test from 'node:test';
import { addConversationTurn, createProject, latestBlueprint } from '../../src/model.mjs';
import { digest } from '../../src/sdlc/contracts.mjs';
import { applyEnterpriseBulkEdit, createEnterpriseInterchangeBundle, normalizeEnterpriseInterchangeCommand,
  previewEnterpriseInterchange } from '../../src/enterprise/interchange.mjs';
import { previewEnterpriseSourceEvidence } from '../../src/enterprise/source-onboarding.mjs';

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
