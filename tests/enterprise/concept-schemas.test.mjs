import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEnterpriseConceptSchema, normalizeConceptSchemaDefinition, verifyEnterpriseConceptSchemas } from '../../src/enterprise/concept-schemas.mjs';

const project = (id = 'project-one', tenantId = 'tenant-one') => ({ id, tenantId, enterpriseConceptSchemas: [] });
const inspection = {
  formatVersion: 1, namespace: 'customer.quality', conceptId: 'inspection',
  fields: [
    { id: 'sample', label: 'Sample', type: 'text', required: true, cardinality: 'ONE' },
    { id: 'temperature', label: 'Temperature', type: 'quantity', required: true, cardinality: 'ONE', units: ['C'] },
    { id: 'decision', label: 'Decision', type: 'enum', required: true, cardinality: 'ONE', enumValues: ['PASS', 'FAIL'] },
  ],
  predicates: [{ id: 'temperature-warn', fieldId: 'temperature', operator: 'gt', value: { value: 80, unit: 'C' } }],
};

test('concept schema registry validates bounded typed definitions, pins immutable versions and project scope', () => {
  const target = project();
  const first = normalizeConceptSchemaDefinition(inspection, target, target.tenantId);
  target.enterpriseConceptSchemas.push({ ...first, createdAt: '2026-10-06T00:00:00.000Z', createdBy: 'owner' });
  const successor = normalizeConceptSchemaDefinition({ ...inspection, fields: [...inspection.fields,
    { id: 'notes', label: 'Notes', type: 'text', required: false, cardinality: 'MANY', minItems: 0, maxItems: 4 }] }, target, target.tenantId);
  assert.equal(first.version, 1);
  assert.equal(successor.version, 2);
  assert.equal(successor.predecessorHash, first.schemaHash);
  assert.notEqual(successor.schemaHash, first.schemaHash);
  target.enterpriseConceptSchemas.push({ ...successor, createdAt: '2026-10-06T00:00:01.000Z', createdBy: 'owner' });
  assert.equal(verifyEnterpriseConceptSchemas(target).length, 2);
  assert.equal(verifyEnterpriseConceptSchemas(project('project-two')).length, 0);
  assert.notEqual(normalizeConceptSchemaDefinition(inspection, project('project-two'), 'tenant-one').schemaHash, first.schemaHash,
    'schema identity is project-bound');
});

test('concept schema registry rejects reserved identities, untyped fields, invalid predicates and unpinned references', () => {
  const target = project();
  assert.throws(() => normalizeConceptSchemaDefinition({ ...inspection, namespace: 'orgward.core' }, target, target.tenantId), { code: 'INVALID_CONCEPT_SCHEMA' });
  assert.throws(() => normalizeConceptSchemaDefinition({ ...inspection, conceptId: 'process' }, target, target.tenantId), { code: 'INVALID_CONCEPT_SCHEMA' });
  assert.throws(() => normalizeConceptSchemaDefinition({ ...inspection, extra: true }, target, target.tenantId), { code: 'INVALID_CONCEPT_SCHEMA' });
  assert.throws(() => normalizeConceptSchemaDefinition({ ...inspection, fields: [{ ...inspection.fields[0], type: 'script' }] }, target, target.tenantId), { code: 'INVALID_CONCEPT_SCHEMA' });
  assert.throws(() => normalizeConceptSchemaDefinition({ ...inspection, fields: [{ ...inspection.fields[0], cardinality: 'MANY', minItems: 0, maxItems: 0 }] }, target, target.tenantId), { code: 'INVALID_CONCEPT_SCHEMA' });
  assert.throws(() => normalizeConceptSchemaDefinition({ ...inspection, fields: Array.from({ length: 33 }, (_, index) => ({ id: `field-${index}`,
    label: 'Field', type: 'text', required: false, cardinality: 'ONE' })) }, target, target.tenantId), { code: 'INVALID_CONCEPT_SCHEMA' });
  assert.throws(() => normalizeConceptSchemaDefinition({ ...inspection, predicates: [{ id: 'bad', fieldId: 'sample', operator: 'gt', value: 2 }] }, target, target.tenantId), { code: 'INVALID_CONCEPT_SCHEMA' });
  assert.throws(() => normalizeConceptSchemaDefinition({ ...inspection, fields: [{ id: 'lot', label: 'Lot', type: 'reference', required: true,
    cardinality: 'ONE', referenceTarget: { namespace: 'customer.quality', conceptId: 'lot' } }] }, target, target.tenantId), { code: 'INVALID_CONCEPT_SCHEMA' });
  assert.throws(() => normalizeConceptSchemaDefinition({ ...inspection, fields: inspection.fields.map((field) => field.id === 'decision'
    ? { ...field, enumValues: [' PASS ', 'PASS'] } : field) }, target, target.tenantId), { code: 'INVALID_CONCEPT_SCHEMA' },
  'enum uniqueness is evaluated after trimming values');
});

test('concept schema registry capacity checks complete persisted records before changing schemas or audit', () => {
  const target = project();
  target.blueprintVersions = [{ id: 'blueprint-00000000-0000-4000-8000-000000000001', version: 1 }];
  const before = structuredClone(target);
  assert.throws(() => applyEnterpriseConceptSchema(target, { blueprintId: target.blueprintVersions[0].id,
    blueprintVersion: 1, definition: inspection, reason: 'bounded capacity test' }, 'owner-'.padEnd(400_000, 'x'), target.tenantId),
  { code: 'CONCEPT_SCHEMA_REGISTRY_FULL' });
  assert.deepEqual(target, before, 'capacity rejection leaves the registry and audit byte-for-byte unchanged');
});

test('concept schema references pin an exact prior schema version and unchanged successor declarations are rejected', () => {
  const target = project();
  const first = normalizeConceptSchemaDefinition(inspection, target, target.tenantId);
  target.enterpriseConceptSchemas.push({ ...first, createdAt: '2026-10-06T00:00:00.000Z', createdBy: 'owner' });
  const referenceSchema = normalizeConceptSchemaDefinition({ formatVersion: 1, namespace: 'customer.quality', conceptId: 'sample-record',
    fields: [{ id: 'inspection', label: 'Inspection', type: 'reference', required: true, cardinality: 'ONE',
      referenceTarget: { namespace: first.namespace, conceptId: first.conceptId, version: first.version, schemaHash: first.schemaHash } }], predicates: [] }, target, target.tenantId);
  assert.deepEqual(referenceSchema.fields[0].referenceTarget, { namespace: first.namespace, conceptId: first.conceptId, version: 1, schemaHash: first.schemaHash });
  assert.throws(() => normalizeConceptSchemaDefinition(inspection, target, target.tenantId), { code: 'CONCEPT_SCHEMA_NO_CHANGE' });
});

test('concept schema registry readback detects changed immutable content or a broken predecessor chain', () => {
  const target = project();
  const first = normalizeConceptSchemaDefinition(inspection, target, target.tenantId);
  target.enterpriseConceptSchemas.push({ ...first, createdAt: '2026-10-06T00:00:00.000Z', createdBy: 'owner' });
  assert.throws(() => verifyEnterpriseConceptSchemas({ ...target, enterpriseConceptSchemas: [{ ...target.enterpriseConceptSchemas[0],
    fields: [{ ...target.enterpriseConceptSchemas[0].fields[0], label: 'Tampered' }] }] }), { code: 'CONCEPT_SCHEMA_INTEGRITY' });
});
