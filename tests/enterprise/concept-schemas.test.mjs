import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEnterpriseConceptRecord, applyEnterpriseConceptSchema, normalizeConceptSchemaDefinition,
  validateConceptRecordPredicates, verifyEnterpriseConceptRecords, verifyEnterpriseConceptSchemas } from '../../src/enterprise/concept-schemas.mjs';
import { digest } from '../../src/sdlc/contracts.mjs';

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

test('concept records reject blank required text and blank entries in MANY text values', () => {
  const target = project();
  target.blueprintVersions = [{ id: 'blueprint-00000000-0000-4000-8000-000000000001', version: 1 }];
  const schema = normalizeConceptSchemaDefinition({ formatVersion: 1, namespace: 'customer.quality', conceptId: 'notes', fields: [
    { id: 'title', label: 'Title', type: 'text', required: true, cardinality: 'ONE' },
    { id: 'notes', label: 'Notes', type: 'text', required: false, cardinality: 'MANY', minItems: 0, maxItems: 3 },
  ], predicates: [] }, target, target.tenantId);
  target.enterpriseConceptSchemas.push({ ...schema, createdAt: '2026-10-06T00:00:00.000Z', createdBy: 'owner' });
  const baseCommand = { kind: 'create-concept-record', blueprintId: target.blueprintVersions[0].id, blueprintVersion: 1,
    namespace: schema.namespace, conceptId: schema.conceptId, schemaVersion: schema.version, schemaHash: schema.schemaHash,
    reason: 'Whitespace validation.' };
  assert.throws(() => applyEnterpriseConceptRecord(target, { ...baseCommand, values: { title: '  ' } }, 'owner', target.tenantId),
    { code: 'INVALID_CONCEPT_RECORD' });
  assert.throws(() => applyEnterpriseConceptRecord(target, { ...baseCommand, values: { title: 'Valid', notes: ['ok', '\t'] } }, 'owner', target.tenantId),
    { code: 'INVALID_CONCEPT_RECORD' });
  assert.deepEqual(target.enterpriseConceptRecords ?? [], [], 'invalid values append no record');
  assert.deepEqual(target.audit ?? [], [], 'invalid values append no audit effect');
});

test('predicate evaluator v1 applies exact typed operators to every MANY item and rejects missing or empty values', () => {
  const target = project();
  const schema = normalizeConceptSchemaDefinition({ formatVersion: 1, namespace: 'customer.quality', conceptId: 'predicate-check', fields: [
    { id: 'title', label: 'Title', type: 'text', required: true, cardinality: 'ONE' },
    { id: 'state', label: 'State', type: 'enum', required: true, cardinality: 'ONE', enumValues: ['PASS', 'FAIL'] },
    { id: 'amounts', label: 'Amounts', type: 'number', required: true, cardinality: 'MANY', minItems: 1, maxItems: 4 },
    { id: 'temperatures', label: 'Temperatures', type: 'quantity', required: true, cardinality: 'MANY', minItems: 1, maxItems: 4, units: ['C', 'F'] },
    { id: 'note', label: 'Note', type: 'text', required: false, cardinality: 'ONE' },
    { id: 'tags', label: 'Tags', type: 'text', required: false, cardinality: 'MANY', minItems: 0, maxItems: 3 },
  ], predicates: [
    { id: 'note-exists', fieldId: 'note', operator: 'exists' },
    { id: 'tags-exist', fieldId: 'tags', operator: 'exists' },
    { id: 'state-eq', fieldId: 'state', operator: 'eq', value: 'PASS' },
    { id: 'title-neq', fieldId: 'title', operator: 'neq', value: 'blocked' },
    { id: 'amount-in', fieldId: 'amounts', operator: 'in', value: [2, 3, 4] },
    { id: 'amount-gt', fieldId: 'amounts', operator: 'gt', value: 2 },
    { id: 'amount-gte', fieldId: 'amounts', operator: 'gte', value: 2 },
    { id: 'amount-lt', fieldId: 'amounts', operator: 'lt', value: 5 },
    { id: 'amount-lte', fieldId: 'amounts', operator: 'lte', value: 3 },
    { id: 'temperature-gt', fieldId: 'temperatures', operator: 'gt', value: { value: 20, unit: 'C' } },
  ] }, target, target.tenantId);
  assert.equal(schema.fields.find((field) => field.id === 'amounts').cardinality, 'MANY', 'format v1 MANY predicates remain registrable');
  const valid = { title: 'ready', state: 'PASS', amounts: [3, 3], temperatures: [{ value: 21, unit: 'C' }, { value: 22, unit: 'C' }], note: 'present', tags: ['a'] };
  assert.doesNotThrow(() => validateConceptRecordPredicates(valid, schema));
  for (const [values, message] of [
    [{ ...valid, state: 'FAIL' }, /state-eq/],
    [{ ...valid, title: 'blocked' }, /title-neq/],
    [{ ...valid, amounts: [3, 5] }, /amount-in/],
    [{ ...valid, amounts: [2, 3] }, /amount-gt/],
    [{ ...valid, amounts: [4, 4] }, /amount-lte/],
    [{ ...valid, temperatures: [{ value: 21, unit: 'F' }] }, /unit F does not match required unit C.*conversions are not applied/],
    [{ ...valid, note: undefined }, /note-exists/],
    [{ ...valid, tags: [] }, /tags-exist/],
    [{ ...valid, amounts: [] }, /amount-in/],
  ]) assert.throws(() => validateConceptRecordPredicates(values, schema), { code: 'CONCEPT_RECORD_CONSTRAINT_FAILED', message });
});

test('predicate evaluation marker preserves legacy hashes and rejects removed, null or unsupported markers', () => {
  const target = project();
  target.blueprintVersions = [{ id: 'blueprint-00000000-0000-4000-8000-000000000001', version: 1 }];
  const schema = normalizeConceptSchemaDefinition({ formatVersion: 1, namespace: 'customer.quality', conceptId: 'legacy-check', fields: [
    { id: 'state', label: 'State', type: 'enum', required: true, cardinality: 'ONE', enumValues: ['PASS', 'FAIL'] },
  ], predicates: [{ id: 'must-pass', fieldId: 'state', operator: 'eq', value: 'PASS' }] }, target, target.tenantId);
  target.enterpriseConceptSchemas.push({ ...schema, createdAt: '2026-10-06T00:00:00.000Z', createdBy: 'owner' });
  const at = '2026-10-06T00:01:00.000Z';
  const legacyCore = { formatVersion: 1, id: 'concept-record-00000000-0000-4000-8000-000000000010', projectId: target.id,
    tenantId: target.tenantId, namespace: schema.namespace, conceptId: schema.conceptId, schemaVersion: schema.version,
    schemaHash: schema.schemaHash, values: { state: 'FAIL' }, epistemicStatus: 'HUMAN_REPORTED', verificationStatus: 'UNVERIFIED',
    createdAt: at, createdBy: 'owner', reason: 'Pre-evaluator record.' };
  const legacyRecord = { ...legacyCore, recordHash: digest(legacyCore) };
  target.enterpriseConceptRecords = [legacyRecord];
  target.audit = [{ at, action: 'enterprise.create-concept-record', actor: 'owner',
    detail: `${legacyRecord.id} · ${schema.namespace}/${schema.conceptId}@${schema.version} · ${legacyRecord.reason}` }];
  target.events = [{ type: 'EnterpriseConceptRecordCreated', tenantId: target.tenantId, workspaceId: target.id,
    actor: 'owner', occurredAt: at, data: { conceptRecordId: legacyRecord.id, conceptRecordHash: legacyRecord.recordHash,
      conceptRecordSchemaHash: schema.schemaHash } }];
  assert.equal(verifyEnterpriseConceptRecords(target)[0].recordHash, digest(legacyCore), 'legacy bytes retain the original pre-marker hash recipe');

  const createdProject = structuredClone(target);
  createdProject.enterpriseConceptRecords = [];
  createdProject.events = [];
  createdProject.audit = [];
  const created = applyEnterpriseConceptRecord(createdProject, { kind: 'create-concept-record', blueprintId: createdProject.blueprintVersions[0].id,
    blueprintVersion: 1, namespace: schema.namespace, conceptId: schema.conceptId, schemaVersion: schema.version,
    schemaHash: schema.schemaHash, values: { state: 'PASS' }, reason: 'Evaluator v1 record.' }, 'owner', createdProject.tenantId).conceptRecord;
  assert.equal(created.predicateEvaluationVersion, 1);
  createdProject.events.push({ type: 'EnterpriseConceptRecordCreated', tenantId: createdProject.tenantId, workspaceId: createdProject.id,
    actor: 'owner', occurredAt: created.createdAt, data: { conceptRecordId: created.id, conceptRecordHash: created.recordHash,
      conceptRecordSchemaHash: created.schemaHash } });
  assert.equal(verifyEnterpriseConceptRecords(createdProject)[0].predicateEvaluationVersion, 1);
  for (const mutate of [
    (record) => { delete record.predicateEvaluationVersion; },
    (record) => { record.predicateEvaluationVersion = null; },
    (record) => { record.predicateEvaluationVersion = 2; },
  ]) {
    const tampered = structuredClone(createdProject);
    mutate(tampered.enterpriseConceptRecords[0]);
    assert.throws(() => verifyEnterpriseConceptRecords(tampered), { code: 'CONCEPT_RECORD_INTEGRITY' });
  }
});

test('concept record corrections require an earlier exact-pin target and reject malformed pointers on readback', () => {
  const target = project();
  target.blueprintVersions = [{ id: 'blueprint-00000000-0000-4000-8000-000000000001', version: 1 }];
  const schema = normalizeConceptSchemaDefinition({ ...inspection, predicates: [] }, target, target.tenantId);
  target.enterpriseConceptSchemas = [{ ...schema, createdAt: '2026-10-06T00:00:00.000Z', createdBy: 'owner' }];
  const command = { kind: 'create-concept-record', blueprintId: target.blueprintVersions[0].id, blueprintVersion: 1,
    namespace: schema.namespace, conceptId: schema.conceptId, schemaVersion: schema.version, schemaHash: schema.schemaHash,
    values: { sample: 'batch-1', temperature: { value: 82, unit: 'C' }, decision: 'PASS' }, reason: 'Correction integrity test.' };
  const appendEvent = (record) => target.events.push({ type: 'EnterpriseConceptRecordCreated', tenantId: target.tenantId,
    workspaceId: target.id, actor: record.createdBy, occurredAt: record.createdAt,
    data: { conceptRecordId: record.id, conceptRecordHash: record.recordHash, conceptRecordSchemaHash: record.schemaHash,
      ...(Object.hasOwn(record, 'supersedesRecordId') ? { supersedesRecordId: record.supersedesRecordId } : {}) } });
  target.events = [];
  const first = applyEnterpriseConceptRecord(target, command, 'owner', target.tenantId).conceptRecord;
  appendEvent(first);
  const corrected = applyEnterpriseConceptRecord(target, { ...command, values: { ...command.values, sample: 'batch-1-fixed' },
    supersedesRecordId: first.id }, 'owner', target.tenantId).conceptRecord;
  appendEvent(corrected);
  assert.equal(verifyEnterpriseConceptRecords(target).length, 2);
  const nullPointer = structuredClone(target);
  nullPointer.enterpriseConceptRecords[1].supersedesRecordId = null;
  assert.throws(() => verifyEnterpriseConceptRecords(nullPointer), { code: 'CONCEPT_RECORD_INTEGRITY' });
  const removedPointer = structuredClone(target);
  delete removedPointer.enterpriseConceptRecords[1].supersedesRecordId;
  assert.throws(() => verifyEnterpriseConceptRecords(removedPointer), { code: 'CONCEPT_RECORD_INTEGRITY' });
  const reversed = structuredClone(target);
  reversed.enterpriseConceptRecords.reverse();
  assert.throws(() => verifyEnterpriseConceptRecords(reversed), { code: 'CONCEPT_RECORD_INTEGRITY' });
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
