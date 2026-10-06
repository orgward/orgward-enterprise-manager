import { randomUUID } from 'node:crypto';
import { digest } from '../sdlc/contracts.mjs';
import { enterpriseFailure, enterpriseText } from './types.mjs';

export const ENTERPRISE_CONCEPT_SCHEMA_KINDS = new Set(['define-concept-schema']);
export const ENTERPRISE_CONCEPT_RECORD_KINDS = new Set(['create-concept-record']);
const MAX_FIELDS = 32;
const MAX_PREDICATES = 32;
const MAX_JSON_BYTES = 32_768;
const MAX_REGISTRY_BYTES = 400_000;
const MAX_CONCEPT_RECORDS = 5_000;
const MAX_CONCEPT_RECORD_BYTES = 32_768;
const MAX_CONCEPT_RECORDS_BYTES = 2_000_000;
const SAFE = /^[a-z][a-z0-9_-]{0,63}$/;
const NAMESPACE = /^customer\.[a-z][a-z0-9]*(?:[.-][a-z0-9]+){0,5}$/;
const TYPES = new Set(['text', 'number', 'boolean', 'enum', 'quantity', 'reference']);
const RESERVED_NAMESPACES = new Set(['orgward', 'core', 'system', 'platform', 'authority', 'permission', 'security']);
const RESERVED_CONCEPTS = new Set(['organization', 'tenant', 'project', 'blueprint', 'role', 'actor', 'permission',
  'authority', 'policy', 'process', 'decision', 'information', 'resource', 'system', 'capability']);
const fail = (code, message, status = 400) => { throw enterpriseFailure(code, message, status); };
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, allowed, code) => {
  if (!plain(value) || Object.keys(value).some((key) => !allowed.includes(key))) fail(code, 'The concept schema contains an unsupported field.');
};
const hashValue = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const byteLength = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');

function normalizedField(field, knownSchemas) {
  exactKeys(field, ['id', 'label', 'type', 'required', 'cardinality', 'minItems', 'maxItems', 'enumValues', 'units', 'referenceTarget'], 'INVALID_CONCEPT_SCHEMA');
  if (!SAFE.test(field.id ?? '') || !TYPES.has(field.type) || typeof field.required !== 'boolean'
    || !['ONE', 'MANY'].includes(field.cardinality)) fail('INVALID_CONCEPT_SCHEMA', 'Each field needs a safe ID, supported type, required flag and ONE/MANY cardinality.');
  const many = field.cardinality === 'MANY';
  if (many) {
    if (!Number.isSafeInteger(field.minItems) || field.minItems < (field.required ? 1 : 0) || field.minItems > 12
      || !Number.isSafeInteger(field.maxItems) || field.maxItems < 1 || field.maxItems > 12 || field.minItems > field.maxItems) {
      fail('INVALID_CONCEPT_SCHEMA', 'MANY fields need a valid bounded minItems/maxItems range from 0 to 12.');
    }
  } else if (Object.hasOwn(field, 'minItems') || Object.hasOwn(field, 'maxItems')) {
    fail('INVALID_CONCEPT_SCHEMA', 'ONE fields do not accept list cardinality limits.');
  }
  const result = { id: field.id, label: enterpriseText(field.label, 'Field label', 80), type: field.type,
    required: field.required, cardinality: field.cardinality };
  if (many) Object.assign(result, { minItems: field.minItems, maxItems: field.maxItems });
  if (field.type === 'enum') {
    if (!Array.isArray(field.enumValues) || field.enumValues.length < 1 || field.enumValues.length > 32
      || field.enumValues.some((entry) => typeof entry !== 'string' || !entry.trim() || entry.length > 80)) {
      fail('INVALID_CONCEPT_SCHEMA', 'Enum fields need 1–32 unique non-empty values.');
    }
    const enumValues = field.enumValues.map((entry) => entry.trim());
    if (new Set(enumValues).size !== enumValues.length) fail('INVALID_CONCEPT_SCHEMA', 'Enum fields need 1–32 unique non-empty values.');
    result.enumValues = enumValues;
  } else if (Object.hasOwn(field, 'enumValues')) fail('INVALID_CONCEPT_SCHEMA', 'Only enum fields accept enumValues.');
  if (field.type === 'quantity') {
    if (!Array.isArray(field.units) || field.units.length < 1 || field.units.length > 12
      || field.units.some((unit) => typeof unit !== 'string' || !/^[A-Za-z][A-Za-z0-9._/-]{0,19}$/.test(unit))
      || new Set(field.units).size !== field.units.length) fail('INVALID_CONCEPT_SCHEMA', 'Quantity fields need 1–12 unique explicit units.');
    result.units = [...field.units];
  } else if (Object.hasOwn(field, 'units')) fail('INVALID_CONCEPT_SCHEMA', 'Only quantity fields accept units.');
  if (field.type === 'reference') {
    exactKeys(field.referenceTarget, ['namespace', 'conceptId', 'version', 'schemaHash'], 'INVALID_CONCEPT_SCHEMA');
    const target = knownSchemas.find((schema) => schema.namespace === field.referenceTarget.namespace
      && schema.conceptId === field.referenceTarget.conceptId && schema.version === field.referenceTarget.version
      && schema.schemaHash === field.referenceTarget.schemaHash);
    if (!target) fail('INVALID_CONCEPT_SCHEMA', 'Reference fields must pin an exact concept schema version and hash already registered in this project.');
    result.referenceTarget = { namespace: field.referenceTarget.namespace, conceptId: field.referenceTarget.conceptId,
      version: field.referenceTarget.version, schemaHash: field.referenceTarget.schemaHash };
  } else if (Object.hasOwn(field, 'referenceTarget')) fail('INVALID_CONCEPT_SCHEMA', 'Only reference fields accept referenceTarget.');
  return result;
}

function normalizedPredicate(predicate, fieldsById) {
  exactKeys(predicate, ['id', 'fieldId', 'operator', 'value'], 'INVALID_CONCEPT_SCHEMA');
  const field = fieldsById.get(predicate.fieldId);
  if (!SAFE.test(predicate.id ?? '') || !field) fail('INVALID_CONCEPT_SCHEMA', 'Each predicate must have a unique ID and reference a declared field.');
  const exists = predicate.operator === 'exists';
  if (exists) {
    if (Object.hasOwn(predicate, 'value')) fail('INVALID_CONCEPT_SCHEMA', 'The exists predicate does not accept a value.');
    return { id: predicate.id, fieldId: field.id, operator: 'exists' };
  }
  const allowed = field.type === 'number' || field.type === 'quantity' ? ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in']
    : field.type === 'reference' ? ['eq', 'neq'] : ['eq', 'neq', 'in'];
  if (!allowed.includes(predicate.operator)) fail('INVALID_CONCEPT_SCHEMA', `Operator ${predicate.operator} is unsupported for ${field.type} fields.`);
  const normalizeValue = (value) => {
    if (field.type === 'text') {
      if (typeof value !== 'string' || value.length > 240) fail('INVALID_CONCEPT_SCHEMA', 'Text predicates need a text value of at most 240 characters.');
      return value;
    }
    if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) fail('INVALID_CONCEPT_SCHEMA', 'Number predicates need a finite numeric value.');
      return value;
    }
    if (field.type === 'boolean') {
      if (typeof value !== 'boolean') fail('INVALID_CONCEPT_SCHEMA', 'Boolean predicates need a boolean value.');
      return value;
    }
    if (field.type === 'enum') {
      if (typeof value !== 'string' || !field.enumValues.includes(value)) fail('INVALID_CONCEPT_SCHEMA', 'Enum predicates must use a declared value.');
      return value;
    }
    if (field.type === 'quantity') {
      exactKeys(value, ['value', 'unit'], 'INVALID_CONCEPT_SCHEMA');
      if (typeof value.value !== 'number' || !Number.isFinite(value.value) || !field.units.includes(value.unit)) fail('INVALID_CONCEPT_SCHEMA', 'Quantity predicates must use a finite value and declared unit.');
      return { value: value.value, unit: value.unit };
    }
    exactKeys(value, ['recordId'], 'INVALID_CONCEPT_SCHEMA');
    if (!SAFE.test(value.recordId ?? '')) fail('INVALID_CONCEPT_SCHEMA', 'Reference predicates need a valid record ID.');
    return { recordId: value.recordId };
  };
  let value;
  if (predicate.operator === 'in') {
    if (!Array.isArray(predicate.value) || predicate.value.length < 1 || predicate.value.length > 12) fail('INVALID_CONCEPT_SCHEMA', 'The in predicate needs 1–12 typed values.');
    value = predicate.value.map(normalizeValue);
  } else value = normalizeValue(predicate.value);
  return { id: predicate.id, fieldId: field.id, operator: predicate.operator, value };
}

export function normalizeConceptSchemaDefinition(input, project, tenantId) {
  exactKeys(input, ['formatVersion', 'namespace', 'conceptId', 'fields', 'predicates'], 'INVALID_CONCEPT_SCHEMA');
  if (input.formatVersion !== 1 || !NAMESPACE.test(input.namespace ?? '')
    || RESERVED_NAMESPACES.has(input.namespace.split('.')[0]) || !SAFE.test(input.conceptId ?? '')
    || RESERVED_CONCEPTS.has(input.conceptId.toLowerCase())) fail('INVALID_CONCEPT_SCHEMA', 'Use format version 1, a customer.<namespace>, and a non-core concept ID.');
  const schemas = project.enterpriseConceptSchemas ?? [];
  const knownSchemas = schemas;
  if (!Array.isArray(input.fields) || input.fields.length < 1 || input.fields.length > MAX_FIELDS
    || !Array.isArray(input.predicates) || input.predicates.length > MAX_PREDICATES) {
    fail('INVALID_CONCEPT_SCHEMA', `Provide 1–${MAX_FIELDS} named fields and at most ${MAX_PREDICATES} predicates.`);
  }
  const fields = input.fields.map((field) => normalizedField(field, knownSchemas));
  if (new Set(fields.map((field) => field.id)).size !== fields.length) fail('INVALID_CONCEPT_SCHEMA', 'Field IDs must be unique.');
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const predicates = input.predicates.map((predicate) => normalizedPredicate(predicate, fieldsById));
  if (new Set(predicates.map((predicate) => predicate.id)).size !== predicates.length) fail('INVALID_CONCEPT_SCHEMA', 'Predicate IDs must be unique.');
  const prior = schemas.filter((schema) => schema.namespace === input.namespace && schema.conceptId === input.conceptId).at(-1) ?? null;
  const version = (prior?.version ?? 0) + 1;
  const core = { formatVersion: 1, projectId: project.id, tenantId, namespace: input.namespace,
    conceptId: input.conceptId, version, predecessorHash: prior?.schemaHash ?? null, fields, predicates };
  const schemaHash = digest(core);
  const record = { ...core, schemaHash };
  if (byteLength(record) > MAX_JSON_BYTES) fail('CONCEPT_SCHEMA_TOO_LARGE', 'The normalized concept schema exceeds 32 KB.');
  if (prior && digest({ fields: prior.fields, predicates: prior.predicates }) === digest({ fields, predicates })) {
    fail('CONCEPT_SCHEMA_NO_CHANGE', 'Change at least one field or predicate before defining a successor version.', 409);
  }
  return record;
}

export function normalizeEnterpriseConceptSchemaCommand(input) {
  if (!input || !plain(input) || input.kind !== 'define-concept-schema'
    || !/^blueprint-[0-9a-f-]{36}$/.test(input.blueprintId ?? '')
    || !Number.isSafeInteger(input.blueprintVersion) || input.blueprintVersion < 1
    || Object.keys(input).some((key) => !['kind', 'blueprintId', 'blueprintVersion', 'reason', 'definition'].includes(key))) {
    fail('INVALID_CONCEPT_SCHEMA_COMMAND', 'Bind a declarative concept schema to the current saved design.');
  }
  return { kind: input.kind, blueprintId: input.blueprintId, blueprintVersion: input.blueprintVersion,
    reason: enterpriseText(input.reason, 'Change reason', 500), definition: structuredClone(input.definition) };
}

export function verifyEnterpriseConceptSchemas(project) {
  const schemas = project.enterpriseConceptSchemas ?? [];
  if (!Array.isArray(schemas) || schemas.length > 500) fail('CONCEPT_SCHEMA_INTEGRITY', 'The project concept-schema registry is invalid.', 409);
  if (byteLength(schemas) > MAX_REGISTRY_BYTES) fail('CONCEPT_SCHEMA_INTEGRITY', 'The project concept-schema registry exceeds its storage limit.', 409);
  const latest = new Map();
  for (const [index, schema] of schemas.entries()) {
    if (!plain(schema) || schema.projectId !== project.id || schema.tenantId !== project.tenantId
      || schema.formatVersion !== 1 || !NAMESPACE.test(schema.namespace ?? '')
      || !SAFE.test(schema.conceptId ?? '') || !Number.isSafeInteger(schema.version) || schema.version < 1
      || !hashValue(schema.schemaHash) || !Array.isArray(schema.fields) || !Array.isArray(schema.predicates)
      || typeof schema.createdBy !== 'string' || !Number.isFinite(Date.parse(schema.createdAt ?? ''))) {
      fail('CONCEPT_SCHEMA_INTEGRITY', 'A saved concept schema has invalid identity or scope.', 409);
    }
    const key = `${schema.namespace}/${schema.conceptId}`; const prior = latest.get(key) ?? null;
    const core = { formatVersion: schema.formatVersion, projectId: schema.projectId, tenantId: schema.tenantId,
      namespace: schema.namespace, conceptId: schema.conceptId, version: schema.version,
      predecessorHash: schema.predecessorHash, fields: schema.fields, predicates: schema.predicates };
    if (schema.version !== (prior?.version ?? 0) + 1 || schema.predecessorHash !== (prior?.schemaHash ?? null)
      || digest(core) !== schema.schemaHash) fail('CONCEPT_SCHEMA_INTEGRITY', 'A saved concept schema version or hash chain is invalid.', 409);
    latest.set(key, schema);
  }
  for (const schema of schemas) for (const field of schema.fields) if (field.type === 'reference'
    && !schemas.some((target) => target.namespace === field.referenceTarget?.namespace
      && target.conceptId === field.referenceTarget?.conceptId && target.version === field.referenceTarget?.version
      && target.schemaHash === field.referenceTarget?.schemaHash)) {
    fail('CONCEPT_SCHEMA_INTEGRITY', 'A saved concept schema reference target is unavailable.', 409);
  }
  for (const [index, schema] of schemas.entries()) {
    const { createdAt: _createdAt, createdBy: _createdBy, schemaHash: _schemaHash, projectId: _projectId,
      tenantId: _tenantId, version: _version, predecessorHash: _predecessorHash, ...definition } = schema;
    // Re-normalize every immutable historical declaration against its own predecessor set.
    const priorSchemas = schemas.slice(0, index);
    const scratch = { ...project, enterpriseConceptSchemas: priorSchemas };
    const checked = normalizeConceptSchemaDefinition(definition, scratch, project.tenantId);
    if (checked.version !== schema.version || checked.predecessorHash !== schema.predecessorHash || checked.schemaHash !== schema.schemaHash) {
      fail('CONCEPT_SCHEMA_INTEGRITY', 'A saved concept schema declaration does not match its canonical typed definition.', 409);
    }
  }
  return schemas.map((schema) => structuredClone(schema));
}

export function applyEnterpriseConceptSchema(project, command, actor, tenantId) {
  const blueprint = project.blueprintVersions?.at(-1);
  if (!blueprint || blueprint.id !== command.blueprintId || blueprint.version !== command.blueprintVersion) {
    fail('ENTERPRISE_BLUEPRINT_STALE', 'Reload the current saved design before defining a concept schema.', 409);
  }
  const record = normalizeConceptSchemaDefinition(command.definition, project, tenantId);
  const schemas = project.enterpriseConceptSchemas ?? [];
  if (schemas.length >= 500) fail('CONCEPT_SCHEMA_REGISTRY_FULL', 'This project has reached the 500-version concept-schema limit.', 409);
  const persistedRecord = { ...record, createdAt: new Date().toISOString(), createdBy: actor };
  const candidateSchemas = [...schemas, persistedRecord];
  if (byteLength(candidateSchemas) > MAX_REGISTRY_BYTES) fail('CONCEPT_SCHEMA_REGISTRY_FULL', 'This project has reached the 400 KB concept-schema registry limit.', 409);
  project.enterpriseConceptSchemas = candidateSchemas;
  project.audit ??= [];
  project.audit.push({ at: persistedRecord.createdAt, action: 'enterprise.define-concept-schema', actor,
    detail: `${record.namespace}/${record.conceptId} version ${record.version} · ${command.reason}` });
  return { blueprint, conceptSchema: structuredClone(persistedRecord), recordedAt: persistedRecord.createdAt };
}

export function normalizeEnterpriseConceptRecordCommand(input) {
  if (!plain(input) || input.kind !== 'create-concept-record'
    || !/^blueprint-[0-9a-f-]{36}$/.test(input.blueprintId ?? '')
    || !Number.isSafeInteger(input.blueprintVersion) || input.blueprintVersion < 1
    || typeof input.namespace !== 'string' || !NAMESPACE.test(input.namespace)
    || typeof input.conceptId !== 'string' || !SAFE.test(input.conceptId)
    || !Number.isSafeInteger(input.schemaVersion) || input.schemaVersion < 1
    || !hashValue(input.schemaHash) || !plain(input.values)
    || Object.keys(input).some((key) => !['kind', 'blueprintId', 'blueprintVersion', 'namespace', 'conceptId', 'schemaVersion', 'schemaHash', 'values', 'reason'].includes(key))) {
    fail('INVALID_CONCEPT_RECORD_COMMAND', 'Pin a registered concept schema and provide a record values object for the current saved design.');
  }
  return { kind: input.kind, blueprintId: input.blueprintId, blueprintVersion: input.blueprintVersion,
    namespace: input.namespace, conceptId: input.conceptId, schemaVersion: input.schemaVersion,
    schemaHash: input.schemaHash, values: structuredClone(input.values), reason: enterpriseText(input.reason, 'Record reason', 500) };
}

function normalizeConceptRecordValues(values, schema, availableRecords) {
  exactKeys(values, schema.fields.map((field) => field.id), 'INVALID_CONCEPT_RECORD');
  const normalized = {};
  const normalizeScalar = (value, field) => {
    if (field.type === 'text') {
      if (typeof value !== 'string' || !value.trim() || value.length > 2_000) {
        fail('INVALID_CONCEPT_RECORD', `${field.label} must be non-blank text of at most 2,000 characters.`);
      }
      return value;
    }
    if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) fail('INVALID_CONCEPT_RECORD', `${field.label} must be a finite number.`);
      return value;
    }
    if (field.type === 'boolean') {
      if (typeof value !== 'boolean') fail('INVALID_CONCEPT_RECORD', `${field.label} must be true or false.`);
      return value;
    }
    if (field.type === 'enum') {
      if (typeof value !== 'string' || !field.enumValues.includes(value)) fail('INVALID_CONCEPT_RECORD', `${field.label} must use a declared enum value.`);
      return value;
    }
    if (field.type === 'quantity') {
      exactKeys(value, ['value', 'unit'], 'INVALID_CONCEPT_RECORD');
      if (typeof value.value !== 'number' || !Number.isFinite(value.value) || !field.units.includes(value.unit)) {
        fail('INVALID_CONCEPT_RECORD', `${field.label} must use a finite value and a declared unit.`);
      }
      return { value: value.value, unit: value.unit };
    }
    exactKeys(value, ['recordId'], 'INVALID_CONCEPT_RECORD');
    if (!/^concept-record-[0-9a-f-]{36}$/.test(value.recordId ?? '')) fail('INVALID_CONCEPT_RECORD', `${field.label} must reference a saved project concept record.`);
    const referenced = availableRecords.find((record) => record.id === value.recordId
      && record.namespace === field.referenceTarget.namespace && record.conceptId === field.referenceTarget.conceptId
      && record.schemaVersion === field.referenceTarget.version && record.schemaHash === field.referenceTarget.schemaHash);
    if (!referenced) fail('CONCEPT_RECORD_REFERENCE_NOT_FOUND', `${field.label} must reference a record in this project using the exact registered schema version and hash.`, 409);
    return { recordId: referenced.id };
  };
  for (const field of schema.fields) {
    const supplied = Object.hasOwn(values, field.id);
    if (!supplied) {
      if (field.required) fail('CONCEPT_RECORD_REQUIRED_FIELD', `${field.label} is required.`);
      continue;
    }
    const value = values[field.id];
    if (field.cardinality === 'MANY') {
      if (!Array.isArray(value) || value.length < field.minItems || value.length > field.maxItems) {
        fail('INVALID_CONCEPT_RECORD', `${field.label} needs ${field.minItems}–${field.maxItems} values.`);
      }
      normalized[field.id] = value.map((entry) => normalizeScalar(entry, field));
    } else {
      if (Array.isArray(value) || value === null) fail('INVALID_CONCEPT_RECORD', `${field.label} accepts exactly one value.`);
      normalized[field.id] = normalizeScalar(value, field);
    }
  }
  return normalized;
}

function recordHashCore(record) {
  const { recordHash: _recordHash, ...core } = record;
  return core;
}

export function verifyEnterpriseConceptRecords(project, schemas = verifyEnterpriseConceptSchemas(project)) {
  const records = project.enterpriseConceptRecords ?? [];
  if (!Array.isArray(records) || records.length > MAX_CONCEPT_RECORDS || byteLength(records) > MAX_CONCEPT_RECORDS_BYTES) {
    fail('CONCEPT_RECORD_INTEGRITY', 'The project concept-record collection exceeds its storage limits.', 409);
  }
  const seen = new Set(); const checked = [];
  for (const record of records) {
    if (!plain(record) || !/^concept-record-[0-9a-f-]{36}$/.test(record.id ?? '') || seen.has(record.id)
      || record.projectId !== project.id || record.tenantId !== project.tenantId || record.formatVersion !== 1
      || typeof record.namespace !== 'string' || typeof record.conceptId !== 'string'
      || !Number.isSafeInteger(record.schemaVersion) || !hashValue(record.schemaHash)
      || record.epistemicStatus !== 'HUMAN_REPORTED' || record.verificationStatus !== 'UNVERIFIED'
      || typeof record.createdBy !== 'string' || !record.createdBy || !Number.isFinite(Date.parse(record.createdAt ?? ''))
      || typeof record.reason !== 'string' || record.reason.length > 500 || !plain(record.values) || !hashValue(record.recordHash)) {
      fail('CONCEPT_RECORD_INTEGRITY', 'A saved concept record has invalid identity, provenance or verification status.', 409);
    }
    exactKeys(record, ['formatVersion', 'id', 'projectId', 'tenantId', 'namespace', 'conceptId', 'schemaVersion', 'schemaHash',
      'values', 'epistemicStatus', 'verificationStatus', 'createdAt', 'createdBy', 'reason', 'recordHash'], 'CONCEPT_RECORD_INTEGRITY');
    const schema = schemas.find((entry) => entry.namespace === record.namespace && entry.conceptId === record.conceptId
      && entry.version === record.schemaVersion && entry.schemaHash === record.schemaHash);
    if (!schema) fail('CONCEPT_RECORD_INTEGRITY', 'A saved concept record does not pin a retained project schema version.', 409);
    const normalizedValues = normalizeConceptRecordValues(record.values, schema, checked);
    if (digest(normalizedValues) !== digest(record.values) || byteLength(record) > MAX_CONCEPT_RECORD_BYTES
      || digest(recordHashCore(record)) !== record.recordHash) {
      fail('CONCEPT_RECORD_INTEGRITY', 'A saved concept record value or hash does not match its declared schema.', 409);
    }
    const recordAuditDetail = `${record.id} · ${record.namespace}/${record.conceptId}@${record.schemaVersion} · ${record.reason}`;
    const eventMatches = (project.events ?? []).filter((event) => event.type === 'EnterpriseConceptRecordCreated'
      && event.data?.conceptRecordId === record.id);
    const auditMatches = (project.audit ?? []).filter((entry) => entry.action === 'enterprise.create-concept-record'
      && entry.actor === record.createdBy && entry.at === record.createdAt && entry.detail === recordAuditDetail);
    if (eventMatches.length !== 1 || auditMatches.length !== 1
      || eventMatches[0].tenantId !== project.tenantId || eventMatches[0].workspaceId !== project.id
      || eventMatches[0].actor !== record.createdBy || eventMatches[0].occurredAt !== record.createdAt
      || eventMatches[0].data.conceptRecordHash !== record.recordHash
      || eventMatches[0].data.conceptRecordSchemaHash !== record.schemaHash) {
      fail('CONCEPT_RECORD_INTEGRITY', 'A saved concept record is missing its matching creation event or audit record.', 409);
    }
    seen.add(record.id); checked.push(record);
  }
  return checked.map((record) => structuredClone(record));
}

export function applyEnterpriseConceptRecord(project, command, actor, tenantId) {
  const blueprint = project.blueprintVersions?.at(-1);
  if (!blueprint || blueprint.id !== command.blueprintId || blueprint.version !== command.blueprintVersion) {
    fail('ENTERPRISE_BLUEPRINT_STALE', 'Reload the current saved design before creating a concept record.', 409);
  }
  const schemas = verifyEnterpriseConceptSchemas(project);
  const records = verifyEnterpriseConceptRecords(project, schemas);
  const schema = schemas.find((entry) => entry.namespace === command.namespace && entry.conceptId === command.conceptId
    && entry.version === command.schemaVersion && entry.schemaHash === command.schemaHash);
  if (!schema) fail('CONCEPT_SCHEMA_STALE', 'Reload the current project and select an exact registered concept schema version.', 409);
  if (records.length >= MAX_CONCEPT_RECORDS) fail('CONCEPT_RECORD_LIMIT', 'This project has reached the 5,000 concept-record limit.', 409);
  const values = normalizeConceptRecordValues(command.values, schema, records);
  const at = new Date().toISOString();
  const core = { formatVersion: 1, id: `concept-record-${randomUUID()}`, projectId: project.id, tenantId,
    namespace: schema.namespace, conceptId: schema.conceptId, schemaVersion: schema.version, schemaHash: schema.schemaHash,
    values, epistemicStatus: 'HUMAN_REPORTED', verificationStatus: 'UNVERIFIED', createdAt: at, createdBy: actor,
    reason: command.reason };
  const record = { ...core, recordHash: digest(core) };
  if (byteLength(record) > MAX_CONCEPT_RECORD_BYTES || byteLength([...records, record]) > MAX_CONCEPT_RECORDS_BYTES) {
    fail('CONCEPT_RECORD_LIMIT', 'This project has reached its 2 MB concept-record storage limit.', 409);
  }
  project.enterpriseConceptRecords = [...records, record];
  project.audit ??= [];
  project.audit.push({ at, action: 'enterprise.create-concept-record', actor,
    detail: `${record.id} · ${schema.namespace}/${schema.conceptId}@${schema.version} · ${command.reason}` });
  return { blueprint, conceptRecord: structuredClone(record), recordedAt: at };
}
