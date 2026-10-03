export const ENTERPRISE_SCOPE_TYPES = ['organization', 'legal-entity', 'unit'];
export const ENTERPRISE_LENSES = [
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
].map(([id, label, types]) => ({ id, label, types, gaps: [] }));

export function enterpriseFailure(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode, retryable: false });
}
export function blueprintObjects(blueprint) {
  return Object.values(blueprint?.areas ?? {}).flatMap((area) => area.items ?? []);
}
export function enterpriseText(value, label, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw enterpriseFailure('INVALID_ENTERPRISE_COMMAND', `${label} is required and must be within ${maximum} characters.`);
  }
  return value.trim();
}
export function scopeState(object) {
  if (!Object.hasOwn(object, 'enterpriseScope')) return 'UNKNOWN';
  return Object.values(object.enterpriseScope ?? {}).some(Boolean) ? 'SCOPED' : 'UNSCOPED';
}
export function enterpriseScopeErrors(objects) {
  const errors = [];
  const byId = new Map(objects.map((object) => [object.id, object]));
  const fail = (object, message) => errors.push({ code: 'INVALID_ENTERPRISE_SCOPE', path: object.id, message });
  for (const object of objects) {
    const typedScope = ENTERPRISE_SCOPE_TYPES.includes(object.type);
    if (!Object.hasOwn(object, 'enterpriseScope')) {
      if (typedScope) fail(object, 'A scope record must declare its typed organization, legal entity and unit references.');
      continue;
    }
    const scope = object.enterpriseScope;
    if (!scope || typeof scope !== 'object' || Array.isArray(scope)
      || Object.keys(scope).length !== 3
      || ['organizationId', 'legalEntityId', 'unitId'].some((field) => !Object.hasOwn(scope, field)
        || (scope[field] !== null && (typeof scope[field] !== 'string' || !scope[field])))) {
      fail(object, 'Scope references must explicitly name an organization, legal entity and unit, or null.'); continue;
    }
    const organization = byId.get(scope.organizationId);
    const legal = byId.get(scope.legalEntityId);
    const unit = byId.get(scope.unitId);
    if ((scope.organizationId !== null && organization?.type !== 'organization')
      || (scope.legalEntityId !== null && legal?.type !== 'legal-entity')
      || (scope.unitId !== null && unit?.type !== 'unit')
      || ((legal || unit) && !organization)
      || (legal && legal.enterpriseScope?.organizationId !== scope.organizationId)
      || (unit && unit.enterpriseScope?.organizationId !== scope.organizationId)
      || (unit?.enterpriseScope?.legalEntityId && unit.enterpriseScope.legalEntityId !== scope.legalEntityId)) {
      fail(object, 'Choose compatible organization, legal entity and unit records from this saved design.');
    }
    if (object.type === 'organization' && (scope.organizationId !== object.id || scope.legalEntityId !== null || scope.unitId !== null)) {
      fail(object, 'An organization identifies its own organizational scope.');
    }
    if (object.type === 'legal-entity' && (scope.legalEntityId !== object.id || scope.unitId !== null || !organization
      || typeof object.jurisdiction !== 'string' || !object.jurisdiction.trim() || object.jurisdiction.length > 120)) {
      fail(object, 'A legal entity needs an organization and an explicit human-reported jurisdiction.');
    }
    if (object.type === 'unit') {
      const parent = byId.get(object.parentUnitId);
      if (scope.unitId !== object.id || !organization
        || (object.parentUnitId != null && (parent?.type !== 'unit' || parent.id === object.id
          || parent.enterpriseScope?.organizationId !== scope.organizationId
          || (parent.enterpriseScope?.legalEntityId && parent.enterpriseScope.legalEntityId !== scope.legalEntityId)))) {
        fail(object, 'A unit needs a matching organization and a compatible parent unit.');
      }
      const seen = new Set([object.id]);
      let ancestor = parent;
      while (ancestor) {
        if (seen.has(ancestor.id)) { fail(object, 'The organizational unit hierarchy cannot contain a cycle.'); break; }
        seen.add(ancestor.id); ancestor = byId.get(ancestor.parentUnitId);
      }
    }
    if (typedScope && object.owner != null && byId.get(object.owner)?.type !== 'role') {
      fail(object, 'Scope ownership must refer to an existing design role.');
    }
  }
  return errors;
}
export function enterpriseScopeRelations(objects) {
  const relations = [];
  const add = (object, target, type) => {
    if (target && target !== object.id) relations.push({ id: `${object.id}--${type}--${target}`, source: object.id, target, type });
  };
  for (const object of objects) {
    add(object, object.enterpriseScope?.organizationId, 'within-organization');
    add(object, object.enterpriseScope?.legalEntityId, 'within-legal-entity');
    add(object, object.enterpriseScope?.unitId, 'within-unit');
    if (object.type === 'unit') add(object, object.parentUnitId, 'unit-parent');
  }
  return relations;
}
