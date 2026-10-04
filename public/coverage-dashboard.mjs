export const COVERAGE_LENSES = [
  { id: 'commercial', label: 'Commercial', areas: ['purposeStrategy', 'customersOfferingsValueEconomics'] },
  { id: 'operating', label: 'Operating', areas: ['capabilitiesProcesses', 'lifecycle'] },
  { id: 'financial-resources', label: 'Financial & resources', areas: ['customersOfferingsValueEconomics', 'resources'] },
  { id: 'people-agents', label: 'People & agents', areas: ['peopleAgents', 'responsibilityAuthority'] },
  { id: 'technology-information', label: 'Technology & information', areas: ['informationTechnology'] },
  { id: 'governance-feedback', label: 'Governance & feedback', areas: ['governanceRiskControls', 'metricsFeedback'] },
];

export const ENTERPRISE_COVERAGE_PERSPECTIVES = [
  ['L-01', 'Strategy and outcomes', ['goal', 'strategy', 'metric', 'feedback-loop']],
  ['L-02', 'Customer and value', ['customer', 'offering', 'economics', 'capability', 'process']],
  ['L-03', 'Capability and domain', ['capability', 'process', 'role', 'metric']],
  ['L-04', 'Process and case', ['process', 'decision', 'information', 'role', 'capability']],
  ['L-05', 'Organization and authority', ['organization', 'legal-entity', 'unit', 'role', 'decision', 'actor-human', 'actor-agent']],
  ['L-06', 'Resources and economics', ['resource', 'economics', 'role', 'metric']],
  ['L-07', 'Information and lineage', ['information', 'system', 'process', 'metric']],
  ['L-08', 'System and architecture', ['system', 'information', 'process', 'capability']],
  ['L-09', 'Risk, control and obligation', ['risk', 'control', 'decision', 'metric']],
  ['L-10', 'People and agent autonomy', ['actor-human', 'actor-agent', 'role', 'process']],
  ['L-11', 'SDLC and delivery', ['system', 'process', 'capability']],
  ['L-12', 'Execution and operations', ['process', 'actor-human', 'actor-agent', 'role', 'resource']],
  ['L-13', 'Evidence and integrity', ['information', 'risk', 'control', 'metric', 'feedback-loop']],
  ['L-14', 'Change and time', null],
  ['L-15', 'Federation and scope', ['organization', 'legal-entity', 'unit', 'role', 'system']],
  ['L-16', 'Lifecycle and resilience', ['lifecycle', 'risk', 'control', 'system', 'process', 'resource']],
].map(([id, label, types]) => ({ id, label, types }));

const scopeOf = (object) => !Object.hasOwn(object, 'enterpriseScope') ? 'UNKNOWN'
  : Object.values(object.enterpriseScope ?? {}).some(Boolean) ? 'SCOPED' : 'UNSCOPED';

export function coverageAreaStateLabel(area) {
  if (!area?.exists) return 'not represented';
  if (area.status === 'designed') return `proposed design · ${area.objectCount} objects`;
  if (area.status === 'out_of_scope') return 'explicitly out of scope';
  return 'unknown';
}

export function coverageForBlueprint(blueprint, { scopeId = null } = {}) {
  if (!blueprint) return null;
  const areas = blueprint.areas ?? {};
  const gaps = blueprint.integrity?.gaps ?? [];
  const allObjects = Object.values(areas).flatMap((area) => area.items ?? []);
  const scopeRecords = allObjects.filter((object) => ['organization', 'legal-entity', 'unit'].includes(object.type));
  const selectedScope = scopeRecords.find((scope) => scope.id === scopeId) ?? null;
  const matchesScope = (object) => !selectedScope || (selectedScope.type === 'organization'
    ? object.enterpriseScope?.organizationId === selectedScope.id : selectedScope.type === 'legal-entity'
      ? object.enterpriseScope?.legalEntityId === selectedScope.id : object.enterpriseScope?.unitId === selectedScope.id);
  const scopedObjects = allObjects.filter(matchesScope);
  const areaByObject = new Map(Object.entries(areas).flatMap(([key, area]) => (area.items ?? []).map((object) => [object.id, key])));
  const allObjectIds = new Set(allObjects.map((object) => object.id));
  const relations = blueprint.relations ?? [];
  const boundGapObjectId = (gap) => {
    if (gap.objectId && allObjectIds.has(gap.objectId)) return gap.objectId;
    if (gap.path && allObjectIds.has(gap.path)) return gap.path;
    for (const prefix of ['gap-provenance-', 'gap-owner-', 'gap-authority-', 'gap-flow-']) {
      if (typeof gap.id === 'string' && gap.id.startsWith(prefix)) {
        const objectId = gap.id.slice(prefix.length);
        if (allObjectIds.has(objectId)) return objectId;
      }
    }
    return null;
  };
  const summarizeArea = (key) => {
    const area = areas[key];
    const objects = area?.items ?? [];
    const gapItems = gaps.filter((gap) => gap.area === key);
    return {
      key,
      exists: Boolean(area),
      label: area?.label ?? key,
      status: area?.status ?? 'unknown',
      objectCount: objects.length,
      unknownCount: objects.filter((object) => object.status === 'unknown').length,
      outOfScopeCount: objects.filter((object) => object.status === 'out_of_scope').length,
      confidence: Object.fromEntries(['low', 'medium', 'high'].map((level) => [level, objects.filter((object) => object.confidence === level).length])),
      provenanceCount: objects.reduce((sum, object) => sum + (object.provenance?.length ?? 0), 0),
      gapCount: gapItems.length,
      highGapCount: gapItems.filter((gap) => gap.severity === 'high' || gap.severity === 'critical').length,
      gaps: gapItems,
      objects,
    };
  };
  const lenses = COVERAGE_LENSES.map((lens) => {
    const lensAreas = lens.areas.map(summarizeArea);
    const flatObjects = lensAreas.flatMap((area) => area.objects);
    return {
      ...lens,
      areas: lensAreas,
      objectCount: lensAreas.reduce((sum, area) => sum + area.objectCount, 0),
      designedAreaCount: lensAreas.filter((area) => area.status === 'designed').length,
      unknownAreaCount: lensAreas.filter((area) => area.status === 'unknown').length,
      outOfScopeAreaCount: lensAreas.filter((area) => area.status === 'out_of_scope').length,
      unknownObjectCount: lensAreas.reduce((sum, area) => sum + area.unknownCount, 0),
      outOfScopeObjectCount: lensAreas.reduce((sum, area) => sum + area.outOfScopeCount, 0),
      gapCount: lensAreas.reduce((sum, area) => sum + area.gapCount, 0),
      highGapCount: lensAreas.reduce((sum, area) => sum + area.highGapCount, 0),
      confidence: Object.fromEntries(['low', 'medium', 'high'].map((level) => [level, flatObjects.filter((object) => object.confidence === level).length])),
      provenanceCount: lensAreas.reduce((sum, area) => sum + area.provenanceCount, 0),
    };
  });
  const perspectives = ENTERPRISE_COVERAGE_PERSPECTIVES.map((perspective) => {
    const expectedTypes = perspective.types;
    const lensObjects = allObjects.filter((object) => !expectedTypes || expectedTypes.includes(object.type));
    const objects = lensObjects.filter(matchesScope);
    const ids = new Set(objects.map((object) => object.id));
    const typeCounts = Object.fromEntries([...new Set(expectedTypes ?? lensObjects.map((object) => object.type))].sort()
      .map((type) => [type, objects.filter((object) => object.type === type).length]));
    const lensIds = new Set(lensObjects.map((object) => object.id));
    const scopeIds = new Set(scopedObjects.map((object) => object.id));
    const relevantRelations = relations.filter((relation) => ids.has(relation.source) || ids.has(relation.target));
    const objectGaps = gaps.filter((gap) => { const objectId = boundGapObjectId(gap); return objectId ? ids.has(objectId) : false; });
    const areaContextGaps = gaps.filter((gap) => !boundGapObjectId(gap) && gap.area
      && objects.some((object) => areaByObject.get(object.id) === gap.area));
    const relevantGaps = [...objectGaps, ...areaContextGaps];
    const assignments = new Map();
    for (const object of objects) for (const [field, type] of [['organizationId', 'organization'], ['legalEntityId', 'legal-entity'], ['unitId', 'unit']]) {
      const id = object.enterpriseScope?.[field];
      if (!id) continue;
      const record = scopeRecords.find((scope) => scope.id === id && scope.type === type);
      const item = assignments.get(id) ?? { id, name: record?.name ?? id, type, objectCount: 0 };
      item.objectCount += 1; assignments.set(id, item);
    }
    const counts = Object.fromEntries(['low', 'medium', 'high'].map((level) => [level, objects.filter((object) => object.confidence === level).length]));
    return { id: perspective.id, label: perspective.label, expectedTypes, objectCount: objects.length,
      typeCounts, missingTypes: expectedTypes ? expectedTypes.filter((type) => !typeCounts[type]) : [],
      scope: { selectedScopeId: selectedScope?.id ?? null, scoped: lensObjects.filter((object) => scopeOf(object) === 'SCOPED').length,
        unscoped: lensObjects.filter((object) => scopeOf(object) === 'UNSCOPED').length,
        unknown: lensObjects.filter((object) => scopeOf(object) === 'UNKNOWN').length,
        totalPerspectiveRecords: lensObjects.length,
        assignments: [...assignments.values()].sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)) },
      relationships: { internal: relevantRelations.filter((relation) => ids.has(relation.source) && ids.has(relation.target)).length,
        crossingLens: relevantRelations.filter((relation) => {
          const sourceSelected = ids.has(relation.source); const targetSelected = ids.has(relation.target);
          if (sourceSelected === targetSelected) return false;
          const other = sourceSelected ? relation.target : relation.source;
          return scopeIds.has(other) && !lensIds.has(other);
        }).length,
        crossingScope: relevantRelations.filter((relation) => {
          if (!selectedScope) return false;
          const sourceSelected = ids.has(relation.source); const targetSelected = ids.has(relation.target);
          if (sourceSelected === targetSelected) return false;
          const other = sourceSelected ? relation.target : relation.source;
          return lensIds.has(other) && !scopeIds.has(other);
        }).length,
        crossingBoth: relevantRelations.filter((relation) => {
          const sourceSelected = ids.has(relation.source); const targetSelected = ids.has(relation.target);
          if (sourceSelected === targetSelected) return false;
          const other = sourceSelected ? relation.target : relation.source;
          return allObjectIds.has(other) && !scopeIds.has(other) && !lensIds.has(other);
        }).length,
        dangling: relevantRelations.filter((relation) => !allObjectIds.has(relation.source) || !allObjectIds.has(relation.target)).length },
      design: { recordStatus: Object.fromEntries(['designed', 'unknown', 'out_of_scope'].map((status) =>
        [status, objects.filter((object) => object.status === status).length])),
        gaps: relevantGaps.length, objectSpecificGaps: objectGaps.length, areaContextGaps: areaContextGaps.length,
        highSeverityGaps: relevantGaps.filter((gap) => ['high', 'critical'].includes(gap.severity)).length,
        confidence: counts, provenanceRecords: objects.reduce((sum, object) => sum + (object.provenance?.length ?? 0), 0) },
      time: { status: blueprint.enterpriseValidity ? 'DECLARED' : 'UNKNOWN', validity: blueprint.enterpriseValidity ? { ...blueprint.enterpriseValidity } : null },
    };
  });
  return {
    blueprintVersion: blueprint.version,
    epistemicStatus: blueprint.epistemicStatus ?? 'proposed-design',
    lenses,
    scope: selectedScope ? { id: selectedScope.id, type: selectedScope.type, name: selectedScope.name, objectCount: scopedObjects.length } : null,
    availableScopes: scopeRecords.map(({ id, type, name }) => ({ id, type, name })),
    excludedByScope: allObjects.length - scopedObjects.length,
    perspectives,
    assumptions: [...(blueprint.assumptions ?? [])],
    unknowns: [...(blueprint.unknowns ?? [])],
    gaps: gaps.map((gap) => ({ ...gap })),
    errors: [...(blueprint.integrity?.errors ?? [])],
    confidence: Object.fromEntries(['low', 'medium', 'high'].map((level) => [level,
      Object.values(areas).flatMap((area) => area.items ?? []).filter((object) => object.confidence === level).length])),
    provenanceCount: Object.values(areas).flatMap((area) => area.items ?? []).reduce((sum, object) => sum + (object.provenance?.length ?? 0), 0),
    areaCounts: {
      designed: Object.values(areas).filter((area) => area.status === 'designed').length,
      unknown: Object.values(areas).filter((area) => area.status === 'unknown').length,
      outOfScope: Object.values(areas).filter((area) => area.status === 'out_of_scope').length,
      missing: COVERAGE_LENSES.flatMap((lens) => lens.areas).filter((key, index, all) => all.indexOf(key) === index && !areas[key]).length,
    },
  };
}
