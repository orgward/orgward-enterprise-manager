import assert from 'node:assert/strict';
import test from 'node:test';
import { ENTERPRISE_LENSES, enterpriseScopeErrors, scopeState } from '../../src/enterprise/types.mjs';
import { normalizeEnterpriseCommand } from '../../src/enterprise/commands.mjs';
import { normalizeEnterpriseQuery } from '../../src/enterprise/projections.mjs';

test('enterprise perspectives keep their sixteen stable IDs and distinguish unknown from explicitly unscoped records', () => {
  assert.deepEqual(ENTERPRISE_LENSES.map(({ id }) => id), Array.from({ length: 16 }, (_, index) => `L-${String(index + 1).padStart(2, '0')}`));
  assert.equal(scopeState({ id: 'legacy-process' }), 'UNKNOWN');
  assert.equal(scopeState({ id: 'unscoped-process', enterpriseScope: { organizationId: null, legalEntityId: null, unitId: null } }), 'UNSCOPED');
});

test('enterprise hierarchy validation rejects cyclic organizational-unit parents', () => {
  const organization = { id: 'organization-example', type: 'organization', enterpriseScope: {
    organizationId: 'organization-example', legalEntityId: null, unitId: null,
  } };
  const unitA = { id: 'unit-a', type: 'unit', parentUnitId: 'unit-b', enterpriseScope: {
    organizationId: organization.id, legalEntityId: null, unitId: 'unit-a',
  } };
  const unitB = { id: 'unit-b', type: 'unit', parentUnitId: 'unit-a', enterpriseScope: {
    organizationId: organization.id, legalEntityId: null, unitId: 'unit-b',
  } };

  const errors = enterpriseScopeErrors([organization, unitA, unitB]);
  assert.ok(errors.some(({ code, path, message }) => code === 'INVALID_ENTERPRISE_SCOPE'
    && ['unit-a', 'unit-b'].includes(path) && /cycle/i.test(message)));
});

test('enterprise query and command references accept existing Studio IDs containing underscores', () => {
  assert.equal(normalizeEnterpriseQuery({ lensId: 'all', scopeId: 'org_north_1', selectedId: 'process_existing_7' }).selectedId,
    'process_existing_7');
  const command = normalizeEnterpriseCommand({ kind: 'assign-object-scope', blueprintId: 'blueprint-00000000-0000-4000-8000-000000000001',
    blueprintVersion: 1, objectId: 'process_existing_7', organizationId: 'org_north_1', legalEntityId: null, unitId: null, reason: 'Preserve the existing design identifier.' });
  assert.equal(command.objectId, 'process_existing_7');
  assert.equal(command.enterpriseScope.organizationId, 'org_north_1');
});
