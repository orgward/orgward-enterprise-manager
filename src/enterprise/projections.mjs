import { graphForBlueprint, latestBlueprint } from '../model.mjs';
import { ENTERPRISE_LENSES, ENTERPRISE_SCOPE_TYPES, blueprintObjects, enterpriseFailure, enterpriseScopeErrors, scopeState } from './types.mjs';

export function normalizeEnterpriseQuery(input = {}) {
  const accepted = ['lensId', 'scopeId', 'blueprintVersion', 'selectedId'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !accepted.includes(key))) {
    throw enterpriseFailure('INVALID_ENTERPRISE_CONTEXT', 'Choose a supported lens, scope, saved blueprint version and selection.');
  }
  const lensId = input.lensId || 'all';
  if (lensId !== 'all' && !ENTERPRISE_LENSES.some((lens) => lens.id === lensId)) {
    throw enterpriseFailure('ENTERPRISE_LENS_NOT_FOUND', 'Choose all objects or one of the sixteen named perspectives.');
  }
  const query = { lensId, scopeId: input.scopeId || null, selectedId: input.selectedId || null, blueprintVersion: null };
  for (const field of ['scopeId', 'selectedId']) {
    if (query[field] !== null && (typeof query[field] !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,119}$/i.test(query[field]))) {
      throw enterpriseFailure('INVALID_ENTERPRISE_CONTEXT', `${field} must identify a saved design record.`);
    }
  }
  if (input.blueprintVersion != null && input.blueprintVersion !== '') {
    const value = String(input.blueprintVersion);
    if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) {
      throw enterpriseFailure('INVALID_ENTERPRISE_CONTEXT', 'The saved blueprint version must be a positive integer.');
    }
    query.blueprintVersion = Number(value);
  }
  return query;
}
export function projectEnterprise(project, query = {}, authority = {}) {
  const context = normalizeEnterpriseQuery(query);
  const current = latestBlueprint(project);
  const blueprint = context.blueprintVersion === null ? current
    : project.blueprintVersions.find((entry) => entry.version === context.blueprintVersion);
  if (!blueprint && context.blueprintVersion !== null) throw enterpriseFailure('ENTERPRISE_BLUEPRINT_NOT_FOUND', 'The saved blueprint version was not found in this project.', 404);
  const objects = blueprintObjects(blueprint);
  const scopeErrors = enterpriseScopeErrors(objects);
  if (scopeErrors.length) throw enterpriseFailure('INVALID_ENTERPRISE_SCOPE', 'The saved blueprint has invalid organizational scope references. Repair its design before exploring these perspectives.', 409);
  const byId = new Map(objects.map((object) => [object.id, object]));
  const scope = context.scopeId ? byId.get(context.scopeId) : null;
  if (context.scopeId && !ENTERPRISE_SCOPE_TYPES.includes(scope?.type)) {
    throw enterpriseFailure('ENTERPRISE_SCOPE_NOT_FOUND', 'The selected scope is not present in this saved blueprint.', 404);
  }
  const inScope = (object) => !scope || (scope.type === 'organization' ? object.enterpriseScope?.organizationId === scope.id
    : scope.type === 'legal-entity' ? object.enterpriseScope?.legalEntityId === scope.id : object.enterpriseScope?.unitId === scope.id);
  const lens = ENTERPRISE_LENSES.find((entry) => entry.id === context.lensId);
  const inLens = (object) => !lens?.types || lens.types.includes(object.type);
  const visible = new Set(objects.filter((object) => inScope(object) && inLens(object)).map((object) => object.id));
  const canonicalGraph = graphForBlueprint(blueprint);
  const graph = { nodes: canonicalGraph.nodes.filter((node) => visible.has(node.id)).map((node) => ({ ...structuredClone(node),
    enterpriseScope: structuredClone(byId.get(node.id).enterpriseScope ?? null), scopeState: scopeState(byId.get(node.id)) })),
  links: structuredClone(canonicalGraph.links.filter((relation) => visible.has(relation.source) && visible.has(relation.target))),
  types: [...new Set(objects.filter((object) => visible.has(object.id)).map((object) => object.type))].sort() };
  const selected = context.selectedId ? byId.get(context.selectedId) : null;
  if (context.selectedId && !selected) throw enterpriseFailure('ENTERPRISE_OBJECT_NOT_FOUND', 'The selected object is not present in this saved blueprint.', 404);
  const hiddenBy = selected ? [...(!inScope(selected) ? ['scope'] : []), ...(!inLens(selected) ? ['lens'] : [])] : [];
  const isCurrent = Boolean(blueprint && current?.id === blueprint.id);
  const gaps = [
    { code: 'PROPOSED_DESIGN_ONLY', message: 'These perspectives show saved organizational design. They do not establish enabled operations or verified outcomes.' },
    { code: 'TEMPORAL_CONTEXT_UNAVAILABLE', message: 'Effective dates, recorded-time queries and alternative branches are not available in this view.' },
    { code: 'DOMAIN_DETAILS_PARTIAL', message: 'Advanced process decisions, economic scenarios, capacity calendars, refinement and simulations need further modeling.' },
  ];
  if (!blueprint) gaps.unshift({ code: 'BLUEPRINT_REQUIRED', message: 'Save the initial blueprint to explore and define enterprise scopes.' });
  const unknownCount = objects.filter((object) => scopeState(object) === 'UNKNOWN').length;
  if (unknownCount) gaps.push({ code: 'LEGACY_SCOPE_UNKNOWN', message: `${unknownCount} design objects have no recorded organizational scope.`, count: unknownCount });
  const runtimeLensGap = { code: 'DESIGN_EVIDENCE_ONLY', message: 'This perspective includes design records. Case, run, release and independently verified evidence are not included in its graph.' };
  const lenses = ENTERPRISE_LENSES.map((entry) => ({ ...structuredClone(entry),
    gaps: ['L-11', 'L-12', 'L-13', 'L-16'].includes(entry.id) ? [{ ...runtimeLensGap }] : [] }));
  if (lens) gaps.push(...lenses.find((entry) => entry.id === lens.id).gaps.map((gap) => ({ ...gap, lensId: lens.id })));
  return { context: { projectVersion: project.version, blueprintId: blueprint?.id ?? null, blueprintVersion: blueprint?.version ?? null,
    isCurrent, lensId: context.lensId, scopeId: context.scopeId, branch: 'main' }, graph,
    blueprint: blueprint ? structuredClone(blueprint) : null,
    selection: selected ? { object: structuredClone(selected), visible: visible.has(selected.id), hiddenBy } : null,
    lenses, scopes: objects.filter((object) => ENTERPRISE_SCOPE_TYPES.includes(object.type)).map((object) => ({
      id: object.id, type: object.type, name: object.name, detail: object.detail,
      organizationId: object.enterpriseScope.organizationId, legalEntityId: object.enterpriseScope.legalEntityId,
      parentUnitId: object.parentUnitId ?? null, jurisdiction: object.jurisdiction ?? null, ownerRoleId: object.owner ?? null })),
    versions: project.blueprintVersions.map(({ id, version, createdAt }) => ({ id, version, createdAt })),
    permissions: { write: isCurrent && Boolean(authority.write), scopeAdmin: isCurrent && Boolean(authority.scopeAdmin) },
    exclusions: { totalObjects: objects.length, visibleObjects: visible.size,
      scopeUnknownCount: unknownCount, unscopedCount: objects.filter((object) => scopeState(object) === 'UNSCOPED').length,
      filteredByScope: objects.filter((object) => !inScope(object)).length,
      filteredByLens: objects.filter((object) => inScope(object) && !inLens(object)).length }, gaps };
}
