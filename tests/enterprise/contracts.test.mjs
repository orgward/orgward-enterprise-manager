import assert from 'node:assert/strict';
import test from 'node:test';
import { ENTERPRISE_LENSES, enterpriseScopeErrors, scopeState } from '../../src/enterprise/types.mjs';
import { normalizeEnterpriseCommand } from '../../src/enterprise/commands.mjs';
import { normalizeEnterpriseQuery } from '../../src/enterprise/projections.mjs';
import { effectiveStatus, enterpriseInstant, enterpriseInterval, objectBasisHash, objectStates } from '../../src/enterprise/state.mjs';
import { normalizeDecisionTable, normalizeProcessFlow } from '../../src/enterprise/process-model.mjs';
import { evaluateDecisionTable, simulateProcessFlow } from '../../src/enterprise/process-simulation.mjs';

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

test('enterprise decision tables preserve typed input identity and reject malformed or excessive rules', () => {
  const input = { id: 'information-score', type: 'information' };
  const decision = { id: 'decision-risk', type: 'decision' };
  const byId = new Map([[input.id, input], [decision.id, decision]]);
  const table = { schemaVersion: '1.0', hitPolicy: 'UNIQUE', inputs: [{ informationId: input.id, valueType: 'number' }],
    rules: [{ id: 'rule-high', conditions: [{ informationId: input.id, operator: 'gte', value: 5 }], outcome: 'APPROVE' },
      { id: 'rule-low', conditions: [{ informationId: input.id, operator: 'lt', value: 5 }], outcome: 'REVIEW' }], defaultOutcome: null };
  assert.deepEqual(normalizeDecisionTable(table, byId), table);
  assert.throws(() => normalizeDecisionTable({ ...table, inputs: [{ informationId: 'information-missing', valueType: 'number' }] }, byId),
    { code: 'INVALID_PROCESS_REFERENCE' });
  assert.throws(() => normalizeDecisionTable({ ...table, rules: Array.from({ length: 21 }, (_, index) => ({
    id: `rule-${index}`, conditions: [{ informationId: input.id, operator: 'gte', value: 0 }], outcome: `OUTCOME-${index}`,
  })) }, byId), { code: 'INVALID_DECISION_TABLE' });
  assert.throws(() => normalizeDecisionTable({ ...table, rules: [{ id: 'rule-typed', conditions: [
    { informationId: input.id, operator: 'gt', value: '5' }], outcome: 'APPROVE' }] }, byId), { code: 'INVALID_DECISION_TABLE' });
  assert.equal(decision.type, 'decision');
});

test('bounded process flow simulation is deterministic across routes, joins, loops, exceptions, unknowns and limits', () => {
  const infoScore = { id: 'information-score', type: 'information' };
  const infoAttempts = { id: 'information-attempts', type: 'information' };
  const process = { id: 'process-transfer', type: 'process' };
  const role = { id: 'role-operator', type: 'role' };
  const gateTable = { schemaVersion: '1.0', hitPolicy: 'UNIQUE', inputs: [{ informationId: infoScore.id, valueType: 'number' }],
    rules: [{ id: 'rule-approve', conditions: [{ informationId: infoScore.id, operator: 'gte', value: 5 }], outcome: 'APPROVE' },
      { id: 'rule-review', conditions: [{ informationId: infoScore.id, operator: 'lt', value: 5 }], outcome: 'REVIEW' }], defaultOutcome: null };
  const loopTable = { schemaVersion: '1.0', hitPolicy: 'FIRST_MATCH', inputs: [{ informationId: infoAttempts.id, valueType: 'number' }],
    rules: [{ id: 'rule-continue', conditions: [{ informationId: infoAttempts.id, operator: 'eq', value: 1 }], outcome: 'AGAIN' }], defaultOutcome: 'STOP' };
  const gate = { id: 'decision-gate', type: 'decision', decisionTable: gateTable };
  const loopDecision = { id: 'decision-loop', type: 'decision', decisionTable: loopTable };
  const byId = new Map([infoScore, infoAttempts, process, role, gate, loopDecision].map((object) => [object.id, object]));
  const manual = (id, kind, nextStepId, exceptionStepId = null) => ({ id, kind, title: id, processId: process.id, roleId: role.id,
    inputIds: [infoScore.id], outputIds: [], nextStepId, exceptionStepId });
  const flow = { schemaVersion: '1.0', startStepId: 'intake', steps: [
    manual('intake', 'manual', 'gate', 'exception'),
    { id: 'gate', kind: 'decision', title: 'Risk gate', decisionId: gate.id, routes: [
      { outcome: 'APPROVE', targetStepId: 'fork' }, { outcome: 'REVIEW', targetStepId: 'exception' }] },
    { id: 'fork', kind: 'fork', title: 'Parallel checks', branchStepIds: ['check-a', 'check-b'], joinStepId: 'join' },
    manual('check-a', 'manual', 'join'), manual('check-b', 'manual', 'join'),
    { id: 'join', kind: 'join', title: 'Join checks', forkStepId: 'fork', mode: 'ALL', nextStepId: 'loop' },
    { id: 'loop', kind: 'loop', title: 'Bounded retry', decisionId: loopDecision.id, continueOutcome: 'AGAIN',
      bodyStepId: 'loop-work', exitStepId: 'end', maxIterations: 2 },
    manual('loop-work', 'manual', 'return'), { id: 'return', kind: 'loop-return', title: 'Loop return', loopStepId: 'loop' },
    manual('exception', 'manual-exception', 'end'), { id: 'end', kind: 'end', title: 'End' },
  ] };
  assert.deepEqual(normalizeProcessFlow(flow, byId), flow);
  assert.throws(() => normalizeProcessFlow({ ...flow, steps: flow.steps.slice(0, -1) }, byId), { code: 'INVALID_PROCESS_FLOW' });
  assert.throws(() => normalizeProcessFlow({ ...flow, steps: flow.steps.map((step) => step.id === 'intake'
    ? { ...step, nextStepId: 'intake' } : step) }, byId), { code: 'PROCESS_FLOW_CYCLE' });

  const scenario = { inputs: [{ informationId: infoScore.id, value: 10 }, { informationId: infoAttempts.id, value: 1 }],
    activityOutcomes: ['intake', 'check-a', 'check-b'].map((stepId) => ({ stepId, iteration: 0, outcome: 'SUCCEEDED' }))
      .concat([{ stepId: 'loop-work', iteration: 1, outcome: 'SUCCEEDED' }]),
    decisionChoices: [{ stepId: 'loop', iteration: 0, outcome: 'AGAIN' }, { stepId: 'loop', iteration: 1, outcome: 'STOP' }], stepLimit: 80 };
  const first = simulateProcessFlow({ ...process, processFlow: flow }, scenario, byId);
  const second = simulateProcessFlow({ ...process, processFlow: flow }, scenario, byId);
  assert.deepEqual(first, second);
  assert.equal(first.status, 'COMPLETED');
  assert.equal(first.meaning, 'SIMULATION_ONLY');
  assert.ok(first.trace.some((entry) => entry.status === 'FORKED'));
  assert.ok(first.trace.some((entry) => entry.status === 'JOINED'));
  assert.ok(first.trace.some((entry) => entry.status === 'RETURNED'));
  assert.ok(first.trace.some((entry) => entry.status === 'ENDED'));
  const loopBound = simulateProcessFlow({ ...process, processFlow: flow }, { ...scenario,
    activityOutcomes: [...scenario.activityOutcomes, { stepId: 'loop-work', iteration: 2, outcome: 'SUCCEEDED' }],
    decisionChoices: [{ stepId: 'loop', iteration: 0, outcome: 'AGAIN' }, { stepId: 'loop', iteration: 1, outcome: 'AGAIN' },
      { stepId: 'loop', iteration: 2, outcome: 'AGAIN' }] }, byId);
  assert.equal(loopBound.status, 'LIMIT_REACHED', 'a declared loop stops at its saved maximum iteration count');

  const unknown = simulateProcessFlow({ ...process, processFlow: flow }, { ...scenario,
    inputs: [{ informationId: infoAttempts.id, value: 1 }] }, byId);
  assert.equal(unknown.status, 'BLOCKED');
  assert.equal(unknown.trace.find((entry) => entry.stepId === 'gate').status, 'UNKNOWN');
  const limited = simulateProcessFlow({ ...process, processFlow: flow }, { ...scenario, stepLimit: 1 }, byId);
  assert.equal(limited.status, 'LIMIT_REACHED');

  const overlappingTable = { ...gateTable, rules: [
    { id: 'rule-overlap-a', conditions: [{ informationId: infoScore.id, operator: 'gte', value: 1 }], outcome: 'APPROVE' },
    { id: 'rule-overlap-b', conditions: [{ informationId: infoScore.id, operator: 'lte', value: 20 }], outcome: 'REVIEW' },
  ] };
  const conflict = evaluateDecisionTable(overlappingTable, [{ informationId: infoScore.id, value: 10 }], byId);
  assert.equal(conflict.status, 'CONFLICTED');
  const conflictedFlow = { ...flow, steps: flow.steps.map((step) => step.id === 'gate' ? { ...step, decisionId: 'decision-overlap' } : step) };
  const conflictedObjects = new Map(byId); conflictedObjects.set('decision-overlap', { id: 'decision-overlap', type: 'decision', decisionTable: overlappingTable });
  const conflicted = simulateProcessFlow({ ...process, processFlow: conflictedFlow }, scenario, conflictedObjects);
  assert.equal(conflicted.status, 'CONFLICTED');
  assert.ok(conflicted.unresolved.some((entry) => entry.code === 'DECISION_UNRESOLVED' && entry.status === 'CONFLICTED'));

  const failedActivity = simulateProcessFlow({ ...process, processFlow: flow }, { ...scenario,
    activityOutcomes: [{ stepId: 'intake', iteration: 0, outcome: 'FAILED' }, { stepId: 'exception', iteration: 0, outcome: 'SUCCEEDED' }],
    decisionChoices: [], stepLimit: 20 }, byId);
  assert.equal(failedActivity.status, 'COMPLETED', 'a declared manual exception route is traceable without performing work');
  assert.ok(failedActivity.trace.some((entry) => entry.stepId === 'exception' && entry.kind === 'manual-exception'));
});
