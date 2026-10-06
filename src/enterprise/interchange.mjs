import { randomUUID } from 'node:crypto';
import { AREA_DEFINITIONS, blueprintObjectEditInput, buildRelations, editBlueprintObject, latestBlueprint, validateBlueprint } from '../model.mjs';
import { digest } from '../sdlc/contracts.mjs';
import { blueprintObjects, enterpriseFailure, enterpriseText } from './types.mjs';

export const ENTERPRISE_INTERCHANGE_LIMITS = Object.freeze({ bundleBytes: 1_000_000, records: 500, selectedRecords: 100 });
export const ENTERPRISE_INTERCHANGE_KINDS = new Set(['bulk-edit-objects', 'import-design-pack']);
const fail = (code, message, status = 400) => { throw enterpriseFailure(code, message, status); };
const recordId = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,119}$/i.test(value);
const objectMap = (blueprint) => new Map(blueprintObjects(blueprint).map((object) => [object.id, object]));
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const jsonSize = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');
function canonicalBaselineAreas(baseline) {
  if (!plainObject(baseline?.areas)) return false;
  const requiredKeys = AREA_DEFINITIONS.map(([key]) => key).sort();
  const actualKeys = Object.keys(baseline.areas).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(requiredKeys)) return false;
  const ids = new Set();
  for (const [key] of AREA_DEFINITIONS) {
    const area = baseline.areas[key];
    if (!plainObject(area) || typeof area.label !== 'string' || !area.label.trim()
      || !['designed', 'unknown', 'out_of_scope'].includes(area.status) || !Array.isArray(area.items)) return false;
    for (const object of area.items) {
      if (!plainObject(object) || !recordId(object.id) || typeof object.type !== 'string' || !object.type.trim()
        || typeof object.name !== 'string' || typeof object.detail !== 'string' || ids.has(object.id)) return false;
      ids.add(object.id);
    }
  }
  return true;
}
const rawEditableKeys = new Set(['id', 'type', 'name', 'detail', 'owner', 'goals', 'serves', 'enabledBy', 'metrics', 'trigger', 'capability',
  'inputs', 'outputs', 'resources', 'systems', 'responsibilities', 'proposedInstructions', 'proposedScopeStatements',
  'proposedToolStatements', 'proposedEscalationRules', 'authority', 'by', 'scope', 'assignedRoles', 'evidence', 'goal',
  'decisionIds', 'reads', 'consumerLoop', 'control']);

export function createEnterpriseInterchangeBundle(projectId, blueprint, conceptSchemas = null, conceptRecords = null) {
  if (!blueprint) fail('BLUEPRINT_NOT_FOUND', 'Save an initial proposed design before exporting it.', 409);
  const source = { projectId, blueprintId: blueprint.id, blueprintVersion: blueprint.version, snapshotHash: digest(blueprint) };
  const records = blueprintObjects(blueprint).map((object) => {
    const { objectId, ...fields } = blueprintObjectEditInput(blueprint, object);
    return { id: object.id, type: object.type, fields };
  });
  const bundle = { kind: 'orgward-enterprise-blueprint', schemaVersion: '1.0', source,
    baseline: structuredClone(blueprint), records, recordsCount: records.length,
    ...(conceptSchemas?.length ? { projectPrivateConceptSchemas: structuredClone(conceptSchemas),
      projectPrivateConceptSchemasHash: digest(conceptSchemas) } : {}),
    ...(conceptRecords?.length ? { projectPrivateConceptRecords: structuredClone(conceptRecords),
      projectPrivateConceptRecordsHash: digest(conceptRecords) } : {}),
    meaning: 'PROPOSED_DESIGN_EDITABLE_FIELDS_ONLY' };
  if ((conceptSchemas?.length || conceptRecords?.length) && jsonSize(bundle) > ENTERPRISE_INTERCHANGE_LIMITS.bundleBytes) {
    fail('ENTERPRISE_EXPORT_TOO_LARGE', 'The lossless design and project-private schema/record bundle exceeds 1 MB; reduce its scope before export.');
  }
  return bundle;
}

const PACK_TYPES = Object.freeze({
  process: 'capabilitiesProcesses', capability: 'capabilitiesProcesses', role: 'responsibilityAuthority',
  information: 'informationTechnology', resource: 'resources', system: 'informationTechnology',
});
const PACK_REFERENCE_FIELDS = Object.freeze({
  process: ['capability', 'owner', 'inputs', 'outputs', 'resources', 'systems'],
  capability: ['owner'], role: ['owner', 'responsibilities'], information: ['owner'], resource: ['owner'], system: ['owner', 'supports'],
});
const PACK_ARRAY_REFERENCE_FIELDS = new Set(['inputs', 'outputs', 'resources', 'systems', 'responsibilities', 'supports']);
const PACK_CONTENT_FIELDS = Object.freeze({
  process: ['trigger', 'capability', 'inputs', 'outputs', 'resources', 'systems', 'owner'],
  capability: ['owner'], role: ['owner', 'responsibilities', 'proposedInstructions', 'proposedScopeStatements', 'proposedToolStatements', 'proposedEscalationRules'],
  information: ['owner'], resource: ['owner'], system: ['owner', 'supports'],
});

function packObjects(baseline) { return blueprintObjects(baseline); }

function packRecord(record, includedIds, rootId) {
  const allowed = new Set(['id', 'type', 'name', 'detail', 'status', 'confidence', 'provenance', ...PACK_CONTENT_FIELDS[record.type]]);
  const result = Object.fromEntries(Object.entries(record).filter(([key]) => allowed.has(key)).map(([key, value]) => [key, structuredClone(value)]));
  if (record.type === 'capability') { delete result.metrics; delete result.realisers; }
  if (record.type === 'role') result.responsibilities = (record.responsibilities ?? []).filter((id) => includedIds.has(id));
  if (record.type === 'system') result.supports = (record.supports ?? []).filter((id) => includedIds.has(id) && id === rootId);
  return result;
}

function processPackRecords(baseline, rootId) {
  const objects = packObjects(baseline); const byId = new Map(objects.map((object) => [object.id, object]));
  const root = byId.get(rootId);
  if (!root || root.type !== 'process') fail('INVALID_DESIGN_PACK_ROOT', 'Choose a saved process as the root of a reusable process pack.');
  if (!root.capability || !root.owner || ![...(root.inputs ?? []), ...(root.outputs ?? [])].length) {
    fail('DESIGN_PACK_DEPENDENCY_MISSING', 'A reusable process pack needs a declared capability, accountable role, and at least one information input or output.', 409);
  }
  if (root.processFlow || root.decisionTable || (root.inputs ?? []).some((id) => byId.get(id)?.type === 'decision')
    || (root.outputs ?? []).some((id) => byId.get(id)?.type === 'decision')) {
    fail('DESIGN_PACK_PROCESS_UNSUPPORTED', 'This first process pack supports a declared process with information inputs and outputs; attached decision or executable flow models need separate review.');
  }
  const ids = new Set([root.id]);
  const addReference = (id, expectedType, label) => {
    const target = byId.get(id);
    if (!target || target.type !== expectedType || !PACK_TYPES[target.type]) {
      fail('DESIGN_PACK_DEPENDENCY_MISSING', `The process pack dependency ${label} is missing or has the wrong type.`, 409);
    }
    ids.add(id);
  };
  if (root.capability) addReference(root.capability, 'capability', 'capability');
  if (root.owner) addReference(root.owner, 'role', 'process owner');
  for (const id of [...(root.inputs ?? []), ...(root.outputs ?? [])]) addReference(id, 'information', 'information input/output');
  for (const id of root.resources ?? []) addReference(id, 'resource', 'resource');
  for (const id of root.systems ?? []) addReference(id, 'system', 'system');
  // Ownership is part of the pack closure, including owners of its supporting records.
  for (const id of [...ids]) {
    const owner = byId.get(id)?.owner;
    if (owner) addReference(owner, 'role', 'accountable role');
  }
  if (ids.size > ENTERPRISE_INTERCHANGE_LIMITS.selectedRecords) fail('DESIGN_PACK_TOO_LARGE', 'The process dependency closure exceeds the 100-record pack limit.');
  const ordered = objects.filter((object) => ids.has(object.id));
  const packRows = ordered.map((object) => packRecord(object, ids, root.id));
  const omissions = [];
  for (const object of ordered) {
    for (const field of Object.keys(object)) {
      if (!['metrics', 'realisers', 'supports', 'responsibilities', 'enterpriseScope'].includes(field)) continue;
      const retained = packRows.find((row) => row.id === object.id)?.[field];
      const removed = Array.isArray(object[field]) ? object[field].filter((id) => !retained?.includes(id)) : object[field] ? [object[field]] : [];
      if (removed.length) omissions.push({ recordId: object.id, field, count: removed.length,
        meaning: field === 'enterpriseScope' ? 'Organizational scope is not copied by this process pack.' : 'Relationships outside the selected process dependency closure are not copied.' });
    }
  }
  return { root, ids, records: packRows, omissions };
}

export function createEnterpriseDesignPack(projectId, blueprint, rootId) {
  if (!blueprint) fail('BLUEPRINT_NOT_FOUND', 'Save an initial proposed design before exporting a process pack.', 409);
  const { root, records, omissions } = processPackRecords(blueprint, rootId);
  const source = { projectId, blueprintId: blueprint.id, blueprintVersion: blueprint.version, snapshotHash: digest(blueprint) };
  const core = { kind: 'orgward-enterprise-process-pack', schemaVersion: '1.0', source, baseline: structuredClone(blueprint),
    rootId: root.id, records, omissions, meaning: 'UNTRUSTED_PROPOSED_PROCESS_DESIGN_AND_DECLARED_DEPENDENCIES' };
  if (jsonSize(core) > ENTERPRISE_INTERCHANGE_LIMITS.bundleBytes) fail('ENTERPRISE_IMPORT_TOO_LARGE', 'The selected process dependency pack is larger than 1 MB.');
  return { ...core, packHash: digest(core) };
}

function verifyEnterpriseDesignPack(bundle) {
  if (!plainObject(bundle) || jsonSize(bundle) > ENTERPRISE_INTERCHANGE_LIMITS.bundleBytes
    || bundle.kind !== 'orgward-enterprise-process-pack' || bundle.schemaVersion !== '1.0'
    || !plainObject(bundle.source) || !plainObject(bundle.baseline) || !Array.isArray(bundle.records)
    || !Array.isArray(bundle.omissions) || bundle.records.length < 2 || bundle.records.length > ENTERPRISE_INTERCHANGE_LIMITS.selectedRecords
    || !recordId(bundle.rootId) || typeof bundle.packHash !== 'string' || !/^[a-f0-9]{64}$/.test(bundle.packHash)) {
    fail('INVALID_DESIGN_PACK', 'Choose a supported process pack with a valid schema and no more than 100 records.');
  }
  if (Object.keys(bundle).some((key) => !['kind', 'schemaVersion', 'source', 'baseline', 'rootId', 'records', 'omissions', 'meaning', 'packHash'].includes(key))
    || Object.keys(bundle.source).some((key) => !['projectId', 'blueprintId', 'blueprintVersion', 'snapshotHash'].includes(key))) {
    fail('INVALID_DESIGN_PACK', 'The process pack contains unsupported manifest or source fields.');
  }
  if (!canonicalBaselineAreas(bundle.baseline) || !recordId(bundle.source.projectId)
    || !/^blueprint-[0-9a-f-]{36}$/.test(bundle.source.blueprintId ?? '')
    || !Number.isSafeInteger(bundle.source.blueprintVersion) || bundle.source.blueprintVersion < 1
    || bundle.baseline.id !== bundle.source.blueprintId || bundle.baseline.version !== bundle.source.blueprintVersion
    || !/^[a-f0-9]{64}$/.test(bundle.source.snapshotHash ?? '') || digest(bundle.baseline) !== bundle.source.snapshotHash) {
    fail('DESIGN_PACK_SOURCE_INVALID', 'The process pack source pin does not match its self-consistent baseline. Uploaded source identity is not authenticated.');
  }
  const expected = createEnterpriseDesignPack(bundle.source.projectId, bundle.baseline, bundle.rootId);
  const packCore = { ...bundle }; delete packCore.packHash;
  if (digest(packCore) !== bundle.packHash || digest(expected.records) !== digest(bundle.records)
    || digest(expected.omissions) !== digest(bundle.omissions) || bundle.meaning !== expected.meaning) {
    fail('DESIGN_PACK_CONTENT_INVALID', 'The process pack records or omissions do not match the pinned baseline and selected process.');
  }
  return expected;
}

function packCollisionCandidates(project, record) {
  return blueprintObjects(latestBlueprint(project)).filter((target) => target.type === record.type
    && target.name.trim().toLocaleLowerCase() === record.name.trim().toLocaleLowerCase()).map((target) => ({ id: target.id, name: target.name, type: target.type }));
}

export function previewEnterpriseDesignPack(project, bundle, mappings = {}) {
  const verified = verifyEnterpriseDesignPack(bundle);
  const current = latestBlueprint(project);
  if (!current) fail('BLUEPRINT_NOT_FOUND', 'Save an initial proposed design before importing a process pack.', 409);
  if (!plainObject(mappings) || Object.keys(mappings).length > verified.records.length
    || Object.keys(mappings).some((id) => !verified.records.some((record) => record.id === id)
      || (mappings[id] !== null && !recordId(mappings[id])))) {
    fail('INVALID_DESIGN_PACK_MAPPINGS', 'Provide only explicit choices for records in this process pack.');
  }
  const currentObjects = blueprintObjects(current); const currentById = new Map(currentObjects.map((object) => [object.id, object]));
  const identityMap = {}; const rows = []; const unresolvedDependencies = [];
  for (const record of verified.records) {
    const candidates = packCollisionCandidates(project, record);
    const hasChoice = Object.hasOwn(mappings, record.id);
    const requested = hasChoice ? mappings[record.id] : undefined;
    let targetId;
    let status = 'CREATE_NEW';
    if (requested === null) targetId = `${record.type}-${digest({ projectId: project.id, current: { id: current.id, version: current.version }, packHash: bundle.packHash, sourceId: record.id }).slice(0, 32)}`;
    else if (typeof requested === 'string') {
      const target = currentById.get(requested);
      if (!target || target.type !== record.type) {
        unresolvedDependencies.push({ sourceRecordId: record.id, sourceName: record.name, expectedType: record.type,
          targetId: requested, reason: 'The explicit mapping is missing or has a different type.' });
        status = 'INVALID_MAPPING';
      } else { targetId = target.id; status = 'REUSE_TARGET'; }
    } else if (candidates.length) {
      unresolvedDependencies.push({ sourceRecordId: record.id, sourceName: record.name, expectedType: record.type,
        candidates, reason: 'Choose a matching target record or explicitly create a separate local copy.' });
      status = 'MAPPING_REQUIRED';
    } else targetId = `${record.type}-${digest({ projectId: project.id, current: { id: current.id, version: current.version }, packHash: bundle.packHash, sourceId: record.id }).slice(0, 32)}`;
    if (targetId) identityMap[record.id] = targetId;
    rows.push({ sourceRecordId: record.id, sourceName: record.name, type: record.type, status, targetId: targetId ?? null, candidates });
  }
  const mappedTargets = Object.values(identityMap);
  for (const [sourceId, targetId] of Object.entries(identityMap)) {
    if (targetId !== sourceId && currentById.has(targetId) && rows.find((row) => row.sourceRecordId === sourceId)?.status === 'CREATE_NEW') {
      unresolvedDependencies.push({ sourceRecordId: sourceId, targetId, reason: 'A generated local ID collides with an existing target record.' });
    }
  }
  if (new Set(mappedTargets).size !== mappedTargets.length) unresolvedDependencies.push({ sourceRecordId: null, reason: 'Two pack records cannot map to the same destination record.' });
  const sourceIds = new Set(verified.records.map((record) => record.id));
  for (const record of verified.records) {
    for (const field of PACK_REFERENCE_FIELDS[record.type] ?? []) {
      const value = record[field]; const refs = PACK_ARRAY_REFERENCE_FIELDS.has(field) ? value ?? [] : value ? [value] : [];
      for (const ref of refs) if (!sourceIds.has(ref)) unresolvedDependencies.push({ sourceRecordId: record.id, sourceName: record.name,
        dependencyId: ref, field, reason: 'The process pack is missing a declared dependency.' });
    }
  }
  const currentSource = { projectId: project.id, blueprintId: current.id, blueprintVersion: current.version, snapshotHash: digest(current) };
  const dependencies = verified.records.flatMap((record) => (PACK_REFERENCE_FIELDS[record.type] ?? []).flatMap((field) => {
    const value = record[field]; const refs = PACK_ARRAY_REFERENCE_FIELDS.has(field) ? value ?? [] : value ? [value] : [];
    return refs.map((sourceId) => ({ recordId: record.id, recordName: record.name, sourceId, field,
      sourceName: verified.records.find((entry) => entry.id === sourceId)?.name ?? null,
      includedInPack: verified.records.some((entry) => entry.id === sourceId) }));
  }));
  const core = { mode: 'DESIGN_PACK_PREVIEW', source: structuredClone(bundle.source), sourceTrust: 'UNTRUSTED_UPLOADED_JSON',
    currentSource, rootId: bundle.rootId, rootName: verified.records.find((record) => record.id === bundle.rootId)?.name,
    recordCount: verified.records.length, rows, identityMap, dependencies, missingDependencies: unresolvedDependencies,
    unresolvedDependencies, omissions: verified.omissions,
    ready: unresolvedDependencies.length === 0, meaning: 'PROPOSED_DESIGN_ONLY', packHash: bundle.packHash };
  return { ...core, previewHash: digest(core) };
}

export function normalizeEnterpriseDesignPackCommand(input) {
  if (!plainObject(input) || input.kind !== 'import-design-pack'
    || !/^blueprint-[0-9a-f-]{36}$/.test(input.blueprintId ?? '') || !Number.isSafeInteger(input.blueprintVersion) || input.blueprintVersion < 1
    || !plainObject(input.bundle) || !/^[a-f0-9]{64}$/.test(input.previewHash ?? '') || !plainObject(input.mappings)
    || Object.keys(input).some((key) => !['kind', 'blueprintId', 'blueprintVersion', 'reason', 'bundle', 'previewHash', 'mappings'].includes(key))) {
    fail('INVALID_DESIGN_PACK_COMMAND', 'Bind the reviewed process pack to the exact current target design and preview.');
  }
  if (jsonSize(input.bundle) > ENTERPRISE_INTERCHANGE_LIMITS.bundleBytes) fail('ENTERPRISE_IMPORT_TOO_LARGE', 'Choose a process pack no larger than 1 MB.');
  return { kind: input.kind, blueprintId: input.blueprintId, blueprintVersion: input.blueprintVersion,
    reason: enterpriseText(input.reason, 'Process pack import reason', 500), bundle: structuredClone(input.bundle),
    previewHash: input.previewHash, mappings: structuredClone(input.mappings) };
}

export function applyEnterpriseDesignPack(project, command, actor) {
  const current = latestBlueprint(project);
  if (!current || current.id !== command.blueprintId || current.version !== command.blueprintVersion) {
    fail('ENTERPRISE_BLUEPRINT_STALE', 'Reload the exact current target design before applying this process pack.', 409);
  }
  const preview = previewEnterpriseDesignPack(project, command.bundle, command.mappings);
  if (!preview.ready || preview.previewHash !== command.previewHash) {
    fail('DESIGN_PACK_REVIEW_REQUIRED', 'Resolve every process pack dependency and collision in a fresh preview before applying.', 409);
  }
  const scratch = structuredClone(current); const targetObjects = blueprintObjects(scratch);
  const sourceRecords = new Map(command.bundle.records.map((record) => [record.id, record]));
  const existingIds = new Set(targetObjects.map((object) => object.id));
  const targetById = new Map(targetObjects.map((object) => [object.id, object]));
  const remap = preview.identityMap;
  const records = [];
  for (const row of preview.rows) {
    if (row.status === 'REUSE_TARGET') continue;
    const source = sourceRecords.get(row.sourceRecordId); const record = structuredClone(source);
    record.id = remap[source.id];
    for (const field of PACK_REFERENCE_FIELDS[record.type] ?? []) {
      if (PACK_ARRAY_REFERENCE_FIELDS.has(field)) record[field] = (record[field] ?? []).map((id) => remap[id] ?? id);
      else if (record[field]) record[field] = remap[record[field]] ?? record[field];
    }
    record.provenance = [...(record.provenance ?? []), { source: 'workspace:enterprise-process-pack', note: `Imported from untrusted pack ${command.bundle.packHash}; source identity is not authenticated.` }];
    records.push(record);
  }
  for (const row of preview.rows.filter((entry) => entry.status === 'REUSE_TARGET')) {
    const incoming = sourceRecords.get(row.sourceRecordId);
    if (!targetById.has(row.targetId) || targetById.get(row.targetId).type !== incoming.type) {
      fail('DESIGN_PACK_REVIEW_REQUIRED', 'A mapped target record changed. Preview the current target again.', 409);
    }
  }
  for (const record of records) {
    if (existingIds.has(record.id) || targetById.has(record.id)) fail('DESIGN_PACK_ID_COLLISION', 'A generated target record ID already exists. Preview the current target again.', 409);
    const area = scratch.areas[PACK_TYPES[record.type]];
    if (!area) fail('DESIGN_PACK_TYPE_UNSUPPORTED', `The process pack contains unsupported record type ${record.type}.`);
    area.items.push(record); existingIds.add(record.id);
  }
  const allObjects = blueprintObjects(scratch); const byId = new Map(allObjects.map((object) => [object.id, object]));
  const sourceObjects = new Map(command.bundle.records.map((record) => [record.id, record]));
  for (const record of records) for (const field of PACK_REFERENCE_FIELDS[record.type] ?? []) {
    const refs = PACK_ARRAY_REFERENCE_FIELDS.has(field) ? record[field] ?? [] : record[field] ? [record[field]] : [];
    for (const ref of refs) {
      const expectedSource = sourceObjects.get(Object.keys(remap).find((sourceId) => remap[sourceId] === ref) ?? '');
      if (!byId.has(ref) || (expectedSource && byId.get(ref).type !== expectedSource.type)) {
        fail('DESIGN_PACK_DEPENDENCY_MISSING', `The imported ${field} dependency ${ref} is missing or has the wrong type.`, 409);
      }
    }
  }
  const at = new Date().toISOString();
  scratch.id = `blueprint-${randomUUID()}`; scratch.version = current.version + 1; scratch.createdAt = at;
  scratch.epistemicStatus = 'proposed-design'; scratch.relations = buildRelations(scratch.areas);
  scratch.integrity = validateBlueprint(scratch);
  if (!scratch.integrity.valid) fail('INVALID_DESIGN_PACK', scratch.integrity.errors[0]?.message ?? 'The combined process pack is not a valid proposed design.', 409);
  scratch.summary = { areaCount: Object.keys(scratch.areas).length, objectCount: allObjects.length,
    relationCount: scratch.relations.length, designedAreas: Object.values(scratch.areas).filter((entry) => entry.status === 'designed').length };
  scratch.edit = { actor, at, objectIds: records.map((record) => record.id), objectType: 'process-pack', changedFields: ['enterpriseProcessPack'],
    before: null, after: null, reason: command.reason, source: structuredClone(command.bundle.source), sourceHash: command.bundle.source.snapshotHash,
    packHash: command.bundle.packHash, rootId: remap[command.bundle.rootId], importedRecordIds: records.map((record) => record.id),
    mappings: Object.fromEntries(preview.rows.map((row) => [row.sourceRecordId, row.targetId])) };
  project.blueprintVersions.push(scratch); project.audit ??= [];
  project.audit.push({ at, action: 'enterprise.import-design-pack', actor,
    detail: `Imported reviewed process pack ${command.bundle.packHash} from untrusted source ${command.bundle.source.projectId}; source identity is not authenticated.` });
  return { blueprint: scratch, affectedObjectId: remap[command.bundle.rootId], proposalId: null, recordedAt: at,
    importedRecordIds: records.map((record) => record.id), source: structuredClone(command.bundle.source), packHash: command.bundle.packHash };
}

export function normalizeEnterpriseInterchangeCommand(input) {
  if (input?.kind === 'import-design-pack') return normalizeEnterpriseDesignPackCommand(input);
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
  if (Object.hasOwn(bundle, 'projectPrivateConceptSchemas') || Object.hasOwn(bundle, 'projectPrivateConceptSchemasHash')) {
    if (!Array.isArray(bundle.projectPrivateConceptSchemas) || bundle.projectPrivateConceptSchemas.length > 500
      || typeof bundle.projectPrivateConceptSchemasHash !== 'string' || digest(bundle.projectPrivateConceptSchemas) !== bundle.projectPrivateConceptSchemasHash) {
      fail('ENTERPRISE_IMPORT_EXTENSION_UNVERIFIED', 'The project-private concept schemas are not intact. Keep the source project or use a supported schema migration path.', 409);
    }
  }
  if (Object.hasOwn(bundle, 'projectPrivateConceptRecords') || Object.hasOwn(bundle, 'projectPrivateConceptRecordsHash')) {
    if (!Array.isArray(bundle.projectPrivateConceptRecords) || bundle.projectPrivateConceptRecords.length > 5_000
      || typeof bundle.projectPrivateConceptRecordsHash !== 'string'
      || digest(bundle.projectPrivateConceptRecords) !== bundle.projectPrivateConceptRecordsHash) {
      fail('ENTERPRISE_IMPORT_EXTENSION_UNVERIFIED', 'The project-private concept records are not intact. Keep the source project or use a supported record/schema migration path.', 409);
    }
  }
  const source = bundle.source; const baseline = bundle.baseline;
  if (!canonicalBaselineAreas(baseline)) {
    fail('INVALID_ENTERPRISE_BUNDLE_BASELINE', 'The source baseline must contain each canonical enterprise area and well-formed, uniquely identified records.', 400);
  }
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
  const currentSource = { projectId: project.id, projectVersion: project.version, blueprintId: current.id,
    blueprintVersion: current.version, snapshotHash: digest(current) };
  const impactPins = { ...currentSource };
  const currentRelations = current.relations ?? [];
  const currentObjects = objectMap(current);
  for (const row of rows.filter((entry) => entry.status === 'READY')) {
    const scratch = { ...structuredClone(project), blueprintVersions: [structuredClone(current)], audit: [] };
    const candidate = editBlueprintObject(scratch, row.edit, 'interchange-impact-preview');
    const beforeObject = currentObjects.get(row.id);
    const afterObject = objectMap(candidate).get(row.id);
    const direct = (relations, id) => relations.filter((relation) => relation.source === id || relation.target === id);
    const beforeRelations = direct(currentRelations, row.id);
    const afterRelations = direct(candidate.relations ?? [], row.id);
    const affectedIds = new Set([row.id]);
    for (const relation of [...beforeRelations, ...afterRelations]) {
      affectedIds.add(relation.source === row.id ? relation.target : relation.source);
    }
    const candidateObjects = objectMap(candidate);
    row.impact = { status: 'INCOMPLETE', source: impactPins,
      importSource: structuredClone(source),
      changedFields: row.changedFields.map((field) => ({ field,
        before: blueprintObjectEditInput(current, beforeObject)[field] ?? null,
        after: blueprintObjectEditInput(candidate, afterObject)[field] ?? null })),
      directRelationshipChanges: { before: beforeRelations, after: afterRelations },
      directlyAffectedObjects: [...affectedIds].sort().flatMap((id) => {
        const object = candidateObjects.get(id) ?? currentObjects.get(id);
        return object ? [{ objectId: id, name: object.name, type: object.type, edited: id === row.id,
          source: impactPins }] : [];
      }),
      coverage: { directBlueprintRelationships: 'COMPUTED', operationalAndDownstreamImpact: 'UNKNOWN' },
      unknownAreas: ['Role constraints, Sentinel/SDLC, approvals, queued or completed work, and cross-project effects'],
    };
  }
  const core = { source: structuredClone(source), currentSource, recordCount: rows.length,
    recognizedFields: rows.reduce((sum, row) => sum + row.recognizedFields.length, 0),
      unknownFields: [...bundleUnknownFields.map((field) => ({ recordId: null, field })),
      ...rows.flatMap((row) => row.unknownFields.map((field) => ({ recordId: row.id, field })))],
    lossyFields: rows.flatMap((row) => row.lossFields.map((field) => ({ recordId: row.id, field }))),
    collisions: rows.flatMap((row) => row.collisions.map((collision) => ({ recordId: row.id, ...collision }))),
    validationErrors: rows.flatMap((row) => row.validationErrors.map((error) => ({ recordId: row.id, ...error }))),
    readyRecordIds: rows.filter((row) => row.status === 'READY').map((row) => row.id),
    rows, ...(Object.hasOwn(bundle, 'projectPrivateConceptSchemas') || Object.hasOwn(bundle, 'projectPrivateConceptRecords')
      ? { unsupportedExtensions: [
        ...(Object.hasOwn(bundle, 'projectPrivateConceptSchemas') ? [{ field: 'projectPrivateConceptSchemas',
          reason: 'Project-private concept schemas are preserved in export but this design import path cannot merge them.' }] : []),
        ...(Object.hasOwn(bundle, 'projectPrivateConceptRecords') ? [{ field: 'projectPrivateConceptRecords',
          reason: 'Project-private concept records are preserved in export but this design import path cannot merge or migrate them.' }] : []),
      ] } : {}),
    meaning: 'PROPOSED_DESIGN_ONLY' };
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
