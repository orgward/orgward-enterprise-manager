import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateEconomicScenario } from '../../src/enterprise/economics-scenario.mjs';
import { valueStageBasisHash } from '../../src/enterprise/economics-model.mjs';

const window = { start: '2026-10-01T00:00:00.000Z', end: '2026-10-02T00:00:00.000Z', timezone: 'UTC' };
const money = (minorUnits, perUnit = undefined) => ({ minorUnits, currency: 'USD', decimalPlaces: 2,
  ...(perUnit ? { perUnit } : {}), source: 'human-reported fixture assumption' });
const quantity = (value, unit) => ({ value, unit, source: 'human-reported fixture assumption' });

test('economic evaluation treats omitted process-resource demands as unknown and zero/zero break-even as zero output', () => {
  const process = { id: 'process-delivery', type: 'process', name: 'Deliver orders', resources: ['resource-staff'] };
  const resource = { id: 'resource-staff', type: 'resource', name: 'Staff hours', resourcePlan: { schemaVersion: '1.0', provider: 'reported staffing plan', windows: [
    { id: 'staff-window', window, capacity: quantity(40, 'hours'), available: quantity(40, 'hours'), allocations: [] },
  ] } };
  const offering = { id: 'offering-orders', type: 'offering', name: 'Order delivery' };
  const economics = { id: 'economics-orders', type: 'economics', economicScenario: { schemaVersion: '1.0', offeringId: offering.id,
    processIds: [process.id], window, volume: quantity(100, 'orders'), unitPrice: money(0, 'orders'),
    unitVariableCost: money(0, 'orders'), fixedCost: money(0), availableFunding: money(0), resourceDemands: [] } };
  const objects = [process, resource, offering, economics]; const byId = new Map(objects.map((object) => [object.id, object]));
  const result = evaluateEconomicScenario(economics, byId);
  assert.equal(result.metrics.breakEvenVolume.status, 'CALCULATED');
  assert.equal(result.metrics.breakEvenVolume.value, 0);
  assert.equal(result.resources[0].metrics.required.status, 'UNKNOWN');
  assert.equal(result.status, 'UNKNOWN');
  assert.ok(result.warnings.some((warning) => warning.code === 'RESOURCE_DEMAND_UNKNOWN'
    && warning.processId === process.id && warning.resourceId === resource.id));
  assert.equal(result.resources[0].demands[0].quantity.value, null);
});

test('value report basis includes the linked offering and served customer identities', () => {
  const stage = { id: 'stage-use', title: 'Customer use', phase: 'USE', processId: null, resourceIds: [],
    intendedValue: 'Complete the work with fewer handoffs.', metricId: null, observation: null };
  const basis = valueStageBasisHash(stage, { offeringId: 'offering-a', customerId: 'customer-a' });
  assert.notEqual(valueStageBasisHash(stage, { offeringId: 'offering-b', customerId: 'customer-a' }), basis);
  assert.notEqual(valueStageBasisHash(stage, { offeringId: 'offering-a', customerId: 'customer-b' }), basis);
});
