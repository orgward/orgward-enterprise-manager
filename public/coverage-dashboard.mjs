export const COVERAGE_LENSES = [
  { id: 'commercial', label: 'Commercial', areas: ['purposeStrategy', 'customersOfferingsValueEconomics'] },
  { id: 'operating', label: 'Operating', areas: ['capabilitiesProcesses', 'lifecycle'] },
  { id: 'financial-resources', label: 'Financial & resources', areas: ['customersOfferingsValueEconomics', 'resources'] },
  { id: 'people-agents', label: 'People & agents', areas: ['peopleAgents', 'responsibilityAuthority'] },
  { id: 'technology-information', label: 'Technology & information', areas: ['informationTechnology'] },
  { id: 'governance-feedback', label: 'Governance & feedback', areas: ['governanceRiskControls', 'metricsFeedback'] },
];

export function coverageAreaStateLabel(area) {
  if (!area?.exists) return 'not represented';
  if (area.status === 'designed') return `proposed design · ${area.objectCount} objects`;
  if (area.status === 'out_of_scope') return 'explicitly out of scope';
  return 'unknown';
}

export function coverageForBlueprint(blueprint) {
  if (!blueprint) return null;
  const areas = blueprint.areas ?? {};
  const gaps = blueprint.integrity?.gaps ?? [];
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
  return {
    blueprintVersion: blueprint.version,
    epistemicStatus: blueprint.epistemicStatus ?? 'proposed-design',
    lenses,
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
