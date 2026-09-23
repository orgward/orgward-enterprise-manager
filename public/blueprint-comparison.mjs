const DISPLAY_FIELDS = [
  'name', 'detail', 'type', 'status', 'confidence', 'trigger',
  'proposedInstructions', 'proposedScopeStatements', 'proposedToolStatements', 'proposedEscalationRules',
];

function objectsIn(blueprint) {
  return Object.values(blueprint?.areas ?? {}).flatMap((area) => Array.isArray(area.items) ? area.items : []);
}

function objectFor(blueprint, objectId) {
  return objectsIn(blueprint).find((object) => object.id === objectId) ?? null;
}

function valueFor(object, field) {
  if (field === 'proposedScopeStatements' && object[field] === undefined && Array.isArray(object.authority)) {
    return object.authority.filter((value) => !(typeof value === 'string' && value.startsWith('decision-')));
  }
  if (field === 'proposedInstructions') return object[field] ?? '';
  if (field === 'proposedScopeStatements' || field === 'proposedToolStatements' || field === 'proposedEscalationRules') return object[field] ?? [];
  return object[field];
}

function relationLabels(blueprint, objectId) {
  if (!objectFor(blueprint, objectId)) return [];
  const objects = new Map(objectsIn(blueprint).map((object) => [object.id, object.name]));
  return (blueprint?.relations ?? []).filter((relation) => relation.source === objectId || relation.target === objectId)
    .map((relation) => {
      const source = objects.get(relation.source) ?? 'Unresolved object';
      const target = objects.get(relation.target) ?? 'Unresolved object';
      return { key: `${relation.source}\u0000${relation.type}\u0000${relation.target}`, label: `${source} ${relation.type} ${target}` };
    });
}

export function compareBlueprintObjectVersions(versions, objectId, fromVersion, toVersion) {
  if (!Array.isArray(versions) || typeof objectId !== 'string') throw new TypeError('Blueprint versions and an object ID are required.');
  const byVersion = new Map(versions.map((blueprint) => [blueprint.version, blueprint]));
  const fromBlueprint = byVersion.get(fromVersion) ?? null;
  const toBlueprint = byVersion.get(toVersion) ?? null;
  const before = fromBlueprint ? objectFor(fromBlueprint, objectId) : null;
  const after = toBlueprint ? objectFor(toBlueprint, objectId) : null;
  const fields = [];
  if (before && after) {
    for (const field of DISPLAY_FIELDS) {
      const beforeValue = valueFor(before, field);
      const afterValue = valueFor(after, field);
      if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) fields.push({ field, before: beforeValue ?? null, after: afterValue ?? null });
    }
  }
  const beforeRelations = fromBlueprint ? relationLabels(fromBlueprint, objectId) : [];
  const afterRelations = toBlueprint ? relationLabels(toBlueprint, objectId) : [];
  const beforeKeys = new Set(beforeRelations.map((relation) => relation.key));
  const afterKeys = new Set(afterRelations.map((relation) => relation.key));
  return {
    fromVersion,
    toVersion,
    fromEpistemicStatus: fromBlueprint?.epistemicStatus ?? null,
    toEpistemicStatus: toBlueprint?.epistemicStatus ?? null,
    fromExists: Boolean(before),
    toExists: Boolean(after),
    fromStatus: before?.status ?? null,
    toStatus: after?.status ?? null,
    fields,
    linksAdded: afterRelations.filter((relation) => !beforeKeys.has(relation.key)).map(({ label }) => label),
    linksRemoved: beforeRelations.filter((relation) => !afterKeys.has(relation.key)).map(({ label }) => label),
  };
}
