import { randomUUID } from 'node:crypto';
import { blueprintObjectEditInput, buildRelations, editBlueprintObject, latestBlueprint, validateBlueprint } from '../model.mjs';
import { digest } from '../sdlc/contracts.mjs';
import { blueprintObjects, enterpriseFailure, enterpriseText } from './types.mjs';

export const ENTERPRISE_INTERCHANGE_LIMITS = Object.freeze({ bundleBytes: 1_000_000, records: 500, selectedRecords: 100 });
export const ENTERPRISE_INTERCHANGE_KINDS = new Set(['bulk-edit-objects']);
const fail = (code, message, status = 400) => { throw enterpriseFailure(code, message, status); };
const recordId = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,119}$/i.test(value);
const objectMap = (blueprint) => new Map(blueprintObjects(blueprint).map((object) => [object.id, object]));
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const jsonSize = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const rawEditableKeys = new Set(['id', 'type', 'name', 'detail', 'owner', 'goals', 'serves', 'enabledBy', 'metrics', 'trigger', 'capability',
  'inputs', 'outputs', 'resources', 'systems', 'responsibilities', 'proposedInstructions', 'proposedScopeStatements',
  'proposedToolStatements', 'proposedEscalationRules', 'authority', 'by', 'scope', 'assignedRoles', 'evidence', 'goal',
  'decisionIds', 'reads', 'consumerLoop', 'control']);

export function createEnterpriseInterchangeBundle(projectId, blueprint) {
  if (!blueprint) fail('BLUEPRINT_NOT_FOUND', 'Save an initial proposed design before exporting it.', 409);
  const source = { projectId, blueprintId: blueprint.id, blueprintVersion: blueprint.version, snapshotHash: digest(blueprint) };
  const records = blueprintObjects(blueprint).map((object) => {
    const { objectId, ...fields } = blueprintObjectEditInput(blueprint, object);
    return { id: object.id, type: object.type, fields };
  });
  return { kind: 'orgward-enterprise-blueprint', schemaVersion: '1.0', source,
    baseline: structuredClone(blueprint), records, recordsCount: records.length,
    meaning: 'PROPOSED_DESIGN_EDITABLE_FIELDS_ONLY' };
}

export function normalizeEnterpriseInterchangeCommand(input) {
  if (!plainObject(input) || input.kind !== 'bulk-edit-objects'
    || !/^blueprint-[0-9a-f-]{36}$/.test(input.blueprintId ?? '') || !Number.isSafeInteger(input.blueprintVersion) || input.blueprintVersion < 1
    || !plainObject(input.bundle) || !Array.isArray(input.recordIds) || !input.recordIds.length
    || input.recordIds.length > ENTERPRISE_INTERCHANGE_LIMITS.selectedRecords
    || input.recordIds.some((id) => !recordId(id)) || new Set(input.recordIds).size !== input.recordIds.length) {
    fail('INVALID_ENTERPRISE_BULK_EDIT', 'Bind up to 100 distinct imported record edits to the exact current proposed design.');
  }
  if (Object.keys(input).some((key) => !['kind', 'blueprintId', 'blueprintVersion', 'reason', 'bundle', 'recordIds'].includes(key))) {
    fail('INVALID_ENTERPRISE_BULK_EDIT', 'The bulk edit contains unsupported fields.');
  }
  if (jsonSize(input.bundle) > ENTERPRISE_INTERCHANGE_LIMITS.bundleBytes) fail('ENTERPRISE_IMPORT_TOO_LARGE', 'Choose an enterprise blueprint bundle no larger than 1 MB.');
  return { kind: input.kind, blueprintId: input.blueprintId, blueprintVersion: input.blueprintVersion,
    reason: enterpriseText(input.reason, 'Bulk edit reason', 500), bundle: structuredClone(input.bundle), recordIds: [...input.recordIds].sort() };
}

export function previewEnterpriseInterchange(project, bundle) {
  if (!plainObject(bundle) || jsonSize(bundle) > ENTERPRISE_INTERCHANGE_LIMITS.bundleBytes
    || bundle.kind !== 'orgward-enterprise-blueprint' || bundle.schemaVersion !== '1.0'
    || !plainObject(bundle.source) || !plainObject(bundle.baseline) || !Array.isArray(bundle.records) || !bundle.records.length
    || bundle.records.length > ENTERPRISE_INTERCHANGE_LIMITS.records) {
    fail('INVALID_ENTERPRISE_BUNDLE', 'Choose a supported enterprise blueprint JSON bundle of at most 1 MB and 500 records.');
  }
  const source = bundle.source; const baseline = bundle.baseline;
  if (!recordId(source.projectId) || !/^blueprint-[0-9a-f-]{36}$/.test(source.blueprintId ?? '')
    || !Number.isSafeInteger(source.blueprintVersion) || source.blueprintVersion < 1
    || !/^[a-f0-9]{64}$/.test(source.snapshotHash ?? '')
    || baseline.id !== source.blueprintId || baseline.version !== source.blueprintVersion || digest(baseline) !== source.snapshotHash) {
    fail('ENTERPRISE_IMPORT_SOURCE_INVALID', 'The bundle source identity does not match its saved baseline and snapshot hash.');
  }
  const current = latestBlueprint(project);
  if (!current) fail('BLUEPRINT_NOT_FOUND', 'Save an initial proposed design before importing edits.', 409);
  const sourceProjectMatches = source.projectId === project.id;
  const savedSource = sourceProjectMatches && (project.blueprintVersions ?? []).find((version) => version.id === source.blueprintId
    && version.version === source.blueprintVersion && digest(version) === source.snapshotHash);
  const sourceVerified = Boolean(savedSource);
  const baselineById = objectMap(baseline); const currentById = objectMap(current);
  const seen = new Set(); const rows = []; const bundleUnknownFields = Object.keys(bundle)
    .filter((key) => !['kind', 'schemaVersion', 'source', 'baseline', 'records', 'recordsCount', 'meaning'].includes(key));
  for (const record of bundle.records) {
    if (!plainObject(record) || !recordId(record.id) || typeof record.type !== 'string' || !plainObject(record.fields)
      ) {
      fail('INVALID_ENTERPRISE_BUNDLE_RECORD', 'Each imported record must contain only its canonical ID, type and editable fields.');
    }
    if (seen.has(record.id)) fail('ENTERPRISE_IMPORT_DUPLICATE_ID', `The bundle repeats record ${record.id}.`);
    seen.add(record.id);
    const base = baselineById.get(record.id); const target = currentById.get(record.id);
    const conflicts = []; const unknownFields = Object.keys(record).filter((key) => !['id', 'type', 'fields'].includes(key)); const lossFields = [];
    if (!sourceProjectMatches) conflicts.push({ code: 'SOURCE_PROJECT_MISMATCH', field: 'source.projectId' });
    else if (!sourceVerified) conflicts.push({ code: 'SOURCE_VERSION_UNVERIFIED', field: 'source.snapshotHash' });
    if (!base) conflicts.push({ code: 'SOURCE_RECORD_MISSING', field: 'id' });
    if (base && base.type !== record.type) conflicts.push({ code: 'SOURCE_TYPE_MISMATCH', field: 'type' });
    if (!target) conflicts.push({ code: 'TARGET_RECORD_MISSING', field: 'id' });
    if (target && target.type !== record.type) conflicts.push({ code: 'TARGET_TYPE_MISMATCH', field: 'type' });
    if (base && target && base.type === record.type && target.type === record.type) {
      const baselineFields = blueprintObjectEditInput(baseline, base);
      const currentFields = blueprintObjectEditInput(current, target);
      const recognized = new Set(Object.keys(baselineFields).filter((key) => key !== 'objectId'));
      for (const key of Object.keys(record.fields)) if (!recognized.has(key)) unknownFields.push(key);
      const changedFields = Object.keys(record.fields).filter((key) => recognized.has(key)
        && JSON.stringify(record.fields[key]) !== JSON.stringify(baselineFields[key]));
      for (const key of changedFields) if (JSON.stringify(currentFields[key]) !== JSON.stringify(baselineFields[key])
        && JSON.stringify(currentFields[key]) !== JSON.stringify(record.fields[key])) conflicts.push({ code: 'FIELD_CONFLICT', field: key });
      lossFields.push(...Object.keys(base).filter((key) => !rawEditableKeys.has(key)));
      const edit = { objectId: record.id, name: currentFields.name, detail: currentFields.detail,
        ...(target.type === 'process' ? { trigger: currentFields.trigger } : {}),
        ...(target.type === 'role' ? { proposedInstructions: currentFields.proposedInstructions,
          proposedScopeStatements: currentFields.proposedScopeStatements } : {}),
        ...Object.fromEntries(changedFields.map((key) => [key, record.fields[key]])) };
      const validationErrors = [];
      if (!conflicts.length && !unknownFields.length && changedFields.length) {
        try { editBlueprintObject({ ...project, blueprintVersions: [structuredClone(current)], audit: [] }, edit, 'interchange-preview'); }
        catch (error) { validationErrors.push({ code: error.code ?? 'INVALID_BLUEPRINT_EDIT', message: error.message }); }
      }
      rows.push({ id: record.id, type: record.type, recognizedFields: Object.keys(record.fields).filter((key) => recognized.has(key)),
        changedFields, unknownFields, lossFields: [...new Set(lossFields)].sort(), collisions: conflicts, validationErrors,
        status: conflicts.length || unknownFields.length || validationErrors.length ? 'REVIEW_REQUIRED' : changedFields.length ? 'READY' : 'NO_CHANGE', edit });
    } else {
      for (const key of Object.keys(record.fields)) unknownFields.push(key);
      rows.push({ id: record.id, type: record.type, recognizedFields: [], changedFields: [], unknownFields,
        lossFields: [], collisions: conflicts, validationErrors: [], status: 'REVIEW_REQUIRED', edit: null });
    }
  }
  const currentSource = { projectId: project.id, blueprintId: current.id, blueprintVersion: current.version, snapshotHash: digest(current) };
  const core = { source: structuredClone(source), currentSource, recordCount: rows.length,
    recognizedFields: rows.reduce((sum, row) => sum + row.recognizedFields.length, 0),
    unknownFields: [...bundleUnknownFields.map((field) => ({ recordId: null, field })),
      ...rows.flatMap((row) => row.unknownFields.map((field) => ({ recordId: row.id, field })))],
    lossyFields: rows.flatMap((row) => row.lossFields.map((field) => ({ recordId: row.id, field }))),
    collisions: rows.flatMap((row) => row.collisions.map((collision) => ({ recordId: row.id, ...collision }))),
    validationErrors: rows.flatMap((row) => row.validationErrors.map((error) => ({ recordId: row.id, ...error }))),
    readyRecordIds: rows.filter((row) => row.status === 'READY').map((row) => row.id),
    rows, meaning: 'PROPOSED_DESIGN_ONLY' };
  return { ...core, previewHash: digest(core), currentSource };
}

export function applyEnterpriseBulkEdit(project, command, actor) {
  const current = latestBlueprint(project);
  if (!current || current.id !== command.blueprintId || current.version !== command.blueprintVersion) {
    fail('ENTERPRISE_BLUEPRINT_STALE', 'Reload the exact current proposed design before applying these imported edits.', 409);
  }
  const preview = previewEnterpriseInterchange(project, command.bundle);
  const rows = new Map(preview.rows.map((row) => [row.id, row]));
  if (preview.unknownFields.some((entry) => entry.recordId === null)) {
    fail('ENTERPRISE_IMPORT_REVIEW_REQUIRED', 'Remove unrecognized bundle-level fields before applying imported edits.', 409);
  }
  if (command.recordIds.some((id) => !preview.readyRecordIds.includes(id))) {
    fail('ENTERPRISE_IMPORT_REVIEW_REQUIRED', 'Only collision-free records with recognized, changed fields can be applied. Review the current import preview.', 409);
  }
  const scratch = { ...project, blueprintVersions: [structuredClone(current)], audit: [] };
  let candidate = current;
  for (const id of command.recordIds) {
    const planned = rows.get(id); const edit = { ...planned.edit };
    candidate = editBlueprintObject(scratch, edit, actor);
    const changed = blueprintObjects(candidate).find((object) => object.id === id);
    const provenance = changed?.provenance?.at(-1);
    if (provenance) Object.assign(provenance, { source: 'workspace:enterprise-bulk-import', reason: command.reason,
      importSource: { blueprintId: preview.source.blueprintId, blueprintVersion: preview.source.blueprintVersion, snapshotHash: preview.source.snapshotHash } });
  }
  if (!candidate || candidate === current) fail('ENTERPRISE_NO_CHANGE', 'The selected imported records have no editable changes.', 409);
  const at = new Date().toISOString();
  candidate.version = current.version + 1; candidate.createdAt = at; candidate.epistemicStatus = 'proposed-design';
  candidate.relations = buildRelations(candidate.areas); candidate.integrity = validateBlueprint(candidate);
  if (!candidate.integrity.valid) fail('INVALID_ENTERPRISE_BULK_EDIT', candidate.integrity.errors[0]?.message ?? 'The combined edits are invalid.', 409);
  candidate.summary = { areaCount: Object.keys(candidate.areas).length, objectCount: blueprintObjects(candidate).length,
    relationCount: candidate.relations.length, designedAreas: Object.values(candidate.areas).filter((entry) => entry.status === 'designed').length };
  candidate.edit = { actor, at, objectIds: [...command.recordIds], objectType: 'bulk', changedFields: ['enterpriseInterchange'],
    before: null, after: null, reason: command.reason, source: structuredClone(preview.source),
    sourceHash: preview.source.snapshotHash, importedRecordIds: [...command.recordIds], relationsBefore: current.relations,
    relationsAfter: candidate.relations };
  project.blueprintVersions.push(candidate); project.audit ??= [];
  project.audit.push({ at, action: 'enterprise.bulk-edit-objects', actor,
    detail: `Applied ${command.recordIds.length} imported proposed-design edits from blueprint ${preview.source.blueprintId} v${preview.source.blueprintVersion} (${preview.source.snapshotHash}).` });
  return { blueprint: candidate, affectedObjectId: null, proposalId: null, recordedAt: at, importedRecordIds: [...command.recordIds],
    source: preview.source, sourceHash: preview.source.snapshotHash };
}
