import assert from 'node:assert/strict';
import test from 'node:test';
import { addConversationTurn, createProject, latestBlueprint } from '../../src/model.mjs';
import { digest } from '../../src/sdlc/contracts.mjs';
import { applyEnterpriseBulkEdit, createEnterpriseInterchangeBundle, normalizeEnterpriseInterchangeCommand,
  previewEnterpriseInterchange } from '../../src/enterprise/interchange.mjs';

function completeProject() {
  const project = createProject('Interchange fixture');
  for (const answer of ['Transfer service', 'Small businesses', 'Clear status and fees', 'Humans approve exceptions']) addConversationTurn(project, answer);
  return project;
}

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
