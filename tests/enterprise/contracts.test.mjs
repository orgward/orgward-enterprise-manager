import assert from 'node:assert/strict';
import test from 'node:test';
import { ENTERPRISE_LENSES, enterpriseScopeErrors, scopeState } from '../../src/enterprise/types.mjs';
import { normalizeEnterpriseCommand } from '../../src/enterprise/commands.mjs';
import { normalizeEnterpriseQuery } from '../../src/enterprise/projections.mjs';
import { effectiveStatus, enterpriseInstant, enterpriseInterval, objectBasisHash, objectStates } from '../../src/enterprise/state.mjs';

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

test('enterprise lifecycle, review, implementation and observation remain independent honest evidence dimensions', () => {
  const object = { id: 'process-deliver', type: 'process', name: 'Deliver a transfer', detail: 'Complete work.' };
  const empty = objectStates(object);
  assert.equal(empty.lifecycle.value, 'UNKNOWN');
  assert.equal(empty.review.value, 'UNREVIEWED');
  assert.equal(empty.implementation.value, 'UNKNOWN');
  assert.equal(empty.observation.value, 'UNKNOWN');

  const basisHash = objectBasisHash(object);
  const reported = { ...object, enterpriseStates: {
    lifecycle: { value: 'ACTIVE', basisHash, evidenceKind: 'HUMAN_REPORTED', recordedBy: 'oidc:owner', recordedAt: '2026-10-03T10:00:00.000Z', reason: 'Record the current report.', evidenceSummary: 'Owner reported active work.' },
    review: { value: 'ACCEPTED', basisHash, evidenceKind: 'HUMAN_REVIEW', recordedBy: 'oidc:owner', recordedAt: '2026-10-03T10:01:00.000Z', reason: 'Accept the design review.', evidenceSummary: '' },
    implementation: { value: 'NOT_IMPLEMENTED', basisHash, evidenceKind: 'HUMAN_REPORTED', recordedBy: 'oidc:owner', recordedAt: '2026-10-03T10:02:00.000Z', reason: 'Record implementation status.', evidenceSummary: '' },
    observation: { value: 'OBSERVED_UNVERIFIED', basisHash, evidenceKind: 'HUMAN_REPORTED', recordedBy: 'oidc:owner', recordedAt: '2026-10-03T10:03:00.000Z', reason: 'Record the observation.', evidenceSummary: 'Owner reported one observed handoff.' },
  } };
  const states = objectStates(reported);
  assert.deepEqual(Object.fromEntries(['lifecycle', 'review', 'implementation', 'observation'].map((dimension) => [dimension, states[dimension].value])), {
    lifecycle: 'ACTIVE', review: 'ACCEPTED', implementation: 'NOT_IMPLEMENTED', observation: 'OBSERVED_UNVERIFIED',
  });
  assert.equal(states.lifecycle.evidenceKind, 'HUMAN_REPORTED');
  assert.equal(states.review.evidenceKind, 'HUMAN_REVIEW');
  assert.equal(states.observation.evidenceKind, 'HUMAN_REPORTED');
  const changedMeaning = objectStates({ ...reported, name: 'Different transfer process' });
  assert.equal(changedMeaning.lifecycle.value, 'UNKNOWN');
  assert.equal(changedMeaning.lifecycle.priorValue, 'ACTIVE');
  assert.equal(changedMeaning.lifecycle.stale, true);
  assert.equal(changedMeaning.review.value, 'UNREVIEWED');
});

test('enterprise validity intervals accept UTC instants and return UNKNOWN, IN_RANGE or OUT_OF_RANGE without guessing', () => {
  const interval = enterpriseInterval('2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');
  assert.equal(effectiveStatus({}, '2026-10-15T00:00:00.000Z'), 'UNKNOWN');
  assert.equal(effectiveStatus({ enterpriseValidity: interval }, '2026-09-30T23:59:59.999Z'), 'OUT_OF_RANGE');
  assert.equal(effectiveStatus({ enterpriseValidity: interval }, '2026-10-15T00:00:00.000Z'), 'IN_RANGE');
  assert.equal(effectiveStatus({ enterpriseValidity: interval }, '2026-11-01T00:00:00.000Z'), 'OUT_OF_RANGE', 'the end is exclusive');
  assert.throws(() => enterpriseInstant('2026-02-30T12:00:00.000Z', 'Effective start'), { code: 'INVALID_ENTERPRISE_TIME' });
  assert.throws(() => enterpriseInterval('2026-10-02T00:00:00.000Z', '2026-10-01T00:00:00.000Z'), { code: 'INVALID_ENTERPRISE_INTERVAL' });
  assert.throws(() => enterpriseInterval(null, '2026-10-01T00:00:00.000Z'), { code: 'INVALID_ENTERPRISE_INTERVAL' });
  assert.throws(() => normalizeEnterpriseQuery({ effectiveAt: '' }), { code: 'INVALID_ENTERPRISE_TIME' });
  assert.throws(() => normalizeEnterpriseQuery({ recordedAt: '2026-03-08T02:30:00-05:00' }), { code: 'INVALID_ENTERPRISE_TIME' });
});
