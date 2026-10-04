import { digest } from '../sdlc/contracts.mjs';
import { enterpriseFailure, enterpriseText } from './types.mjs';
import { enterpriseInstant } from './state.mjs';

export const ECONOMIC_LIMITS = { windows: 24, allocationsPerWindow: 24, resourceDemands: 12,
  processReferences: 12, valueStages: 16, evaluations: 50, amount: 1_000_000_000_000, volume: 1_000_000_000 };
export const VALUE_PHASES = ['DESIGN', 'DELIVERY', 'USE', 'RETIREMENT'];
export const QUANTITY_DECIMAL_PLACES = 6;
const fail = (message, code = 'INVALID_ECONOMIC_DEFINITION') => { throw enterpriseFailure(code, message); };
const safeId = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,119}$/i.test(value);
function keys(value, allowed, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
    fail('The typed definition contains unsupported fields.', code);
  }
}
function reference(value, byId, type, nullable = false) {
  if (nullable && value === null) return null;
  if (!safeId(value) || byId.get(value)?.type !== type) fail(`Choose a saved ${type} from this exact blueprint.`, 'INVALID_ECONOMIC_REFERENCE');
  return value;
}
function refs(values, byId, type, maximum = ECONOMIC_LIMITS.processReferences) {
  if (!Array.isArray(values) || values.length > maximum || new Set(values).size !== values.length) fail('Use a bounded list of unique canonical references.', 'INVALID_ECONOMIC_REFERENCE');
  return values.map((value) => reference(value, byId, type));
}
function numeric(value, label, { integer = false, maximum = ECONOMIC_LIMITS.amount } = {}) {
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum
    || (integer ? !Number.isSafeInteger(value) : Number(value.toFixed(QUANTITY_DECIMAL_PLACES)) !== value))) {
    fail(`${label} must be a bounded nonnegative ${integer ? 'integer' : 'number with at most six decimal places'}, or explicit null for unknown.`);
  }
  return value === 0 ? 0 : value;
}
export function normalizeEconomicWindow(input) {
  keys(input, ['start', 'end', 'timezone']);
  const start = enterpriseInstant(input.start, 'Scenario/window start'); const end = enterpriseInstant(input.end, 'Exclusive scenario/window end');
  if (end <= start || input.timezone !== 'UTC') fail('Use an increasing exclusive UTC interval; recurring and local/DST calendars are unsupported.');
  return { start, end, timezone: 'UTC' };
}
export function normalizeEconomicQuantity(input, { integer = false, maximum } = {}) {
  keys(input, ['value', 'unit', 'source']);
  return { value: numeric(input.value, 'Quantity', { integer, ...(maximum === undefined ? {} : { maximum }) }),
    unit: enterpriseText(input.unit, 'Quantity unit', 40), source: enterpriseText(input.source, 'Assumption/report source', 240) };
}
export function normalizeEconomicMoney(input, perUnit = false) {
  keys(input, ['minorUnits', 'currency', 'decimalPlaces', 'source', ...(perUnit ? ['perUnit'] : [])]);
  if (!/^[A-Z]{3}$/.test(input.currency ?? '') || !Number.isSafeInteger(input.decimalPlaces) || input.decimalPlaces < 0 || input.decimalPlaces > 4) {
    fail('Money needs a declared three-letter currency and 0–4 decimal places. Amounts are integer minor units; exchange conversion is unsupported.');
  }
  return { minorUnits: numeric(input.minorUnits, 'Money amount in minor units', { integer: true }), currency: input.currency,
    decimalPlaces: input.decimalPlaces, ...(perUnit ? { perUnit: enterpriseText(input.perUnit, 'Pricing/cost unit', 40) } : {}),
    source: enterpriseText(input.source, 'Assumption/accounting source', 240) };
}
export function normalizeEconomicScenario(input, byId) {
  keys(input, ['schemaVersion', 'offeringId', 'processIds', 'window', 'volume', 'unitPrice', 'unitVariableCost', 'fixedCost', 'availableFunding', 'resourceDemands']);
  if (input.schemaVersion !== '1.0' || !Array.isArray(input.resourceDemands) || input.resourceDemands.length > ECONOMIC_LIMITS.resourceDemands) fail('Use economic schema 1.0 with at most twelve declared resource demands.');
  const processIds = refs(input.processIds, byId, 'process');
  const seen = new Set();
  const resourceDemands = input.resourceDemands.map((entry) => {
    keys(entry, ['resourceId', 'processId', 'quantityPerUnit', 'perUnit']);
    const resourceId = reference(entry.resourceId, byId, 'resource'); const processId = reference(entry.processId, byId, 'process');
    if (!processIds.includes(processId) || !(byId.get(processId).resources ?? []).includes(resourceId)) {
      fail('Each resource demand must name a scenario process that uses that canonical resource.', 'INVALID_ECONOMIC_REFERENCE');
    }
    const identity = `${resourceId}:${processId}`;
    if (seen.has(identity)) fail('Resource/process demand pairs must be unique.'); seen.add(identity);
    return { resourceId, processId, quantityPerUnit: normalizeEconomicQuantity(entry.quantityPerUnit),
      perUnit: enterpriseText(entry.perUnit, 'Demand output unit', 40) };
  });
  return { schemaVersion: '1.0', offeringId: reference(input.offeringId, byId, 'offering'), processIds,
    window: normalizeEconomicWindow(input.window), volume: normalizeEconomicQuantity(input.volume, { integer: true, maximum: ECONOMIC_LIMITS.volume }),
    unitPrice: normalizeEconomicMoney(input.unitPrice, true), unitVariableCost: normalizeEconomicMoney(input.unitVariableCost, true),
    fixedCost: normalizeEconomicMoney(input.fixedCost), availableFunding: normalizeEconomicMoney(input.availableFunding), resourceDemands };
}
export function normalizeResourcePlan(input, byId, resourceId) {
  keys(input, ['schemaVersion', 'provider', 'windows']);
  if (input.schemaVersion !== '1.0' || !Array.isArray(input.windows) || !input.windows.length || input.windows.length > ECONOMIC_LIMITS.windows
    || (input.provider !== null && (typeof input.provider !== 'string' || !input.provider.trim() || input.provider.length > 240))) {
    fail('A resource plan needs schema 1.0, an explicit provider or null, and 1–24 finite windows.', 'INVALID_RESOURCE_PLAN');
  }
  const ids = new Set(); const allocationIds = new Set();
  const windows = input.windows.map((entry) => {
    keys(entry, ['id', 'window', 'capacity', 'available', 'allocations'], 'INVALID_RESOURCE_PLAN');
    if (!safeId(entry.id) || ids.has(entry.id) || !Array.isArray(entry.allocations) || entry.allocations.length > ECONOMIC_LIMITS.allocationsPerWindow) fail('Windows need unique IDs and at most 24 allocations.', 'INVALID_RESOURCE_PLAN');
    ids.add(entry.id);
    return { id: entry.id, window: normalizeEconomicWindow(entry.window), capacity: normalizeEconomicQuantity(entry.capacity),
      available: normalizeEconomicQuantity(entry.available), allocations: entry.allocations.map((allocation) => {
        keys(allocation, ['id', 'processId', 'quantity', 'state'], 'INVALID_RESOURCE_PLAN');
        if (!safeId(allocation.id) || allocationIds.has(allocation.id) || !['PLANNED', 'COMMITTED_REPORTED'].includes(allocation.state)) fail('Allocations need unique IDs and a planned or reported commitment state.', 'INVALID_RESOURCE_PLAN');
        allocationIds.add(allocation.id); const processId = reference(allocation.processId, byId, 'process');
        if (!(byId.get(processId).resources ?? []).includes(resourceId)) fail('Allocation processes must declare this resource in their canonical resource links.', 'INVALID_ECONOMIC_REFERENCE');
        return { id: allocation.id, processId, quantity: normalizeEconomicQuantity(allocation.quantity), state: allocation.state };
      }) };
  }).sort((a, b) => a.window.start.localeCompare(b.window.start) || a.id.localeCompare(b.id));
  if (windows.some((entry, index) => index > 0 && entry.window.start < windows[index - 1].window.end)) fail('Resource windows cannot overlap; quantities are whole-window totals and are never prorated.', 'INVALID_RESOURCE_PLAN');
  return { schemaVersion: '1.0', provider: input.provider === null ? null : input.provider.trim(), windows };
}
export function valueStageBasisHash(stage, { offeringId, customerId } = {}) {
  const { observation, ...definition } = stage;
  return digest({ offeringId, customerId, stage: definition });
}
export function normalizeValueLifecycle(input, byId) {
  keys(input, ['schemaVersion', 'offeringId', 'customerId', 'stages'], 'INVALID_VALUE_LIFECYCLE');
  if (input.schemaVersion !== '1.0' || !Array.isArray(input.stages) || !input.stages.length || input.stages.length > ECONOMIC_LIMITS.valueStages) fail('Use value lifecycle schema 1.0 with 1–16 linked stages.', 'INVALID_VALUE_LIFECYCLE');
  const offeringId = reference(input.offeringId, byId, 'offering'); const customerId = reference(input.customerId, byId, 'customer', true);
  if (customerId && !(byId.get(offeringId).serves ?? []).includes(customerId)) fail('The selected offering must serve this canonical customer.', 'INVALID_ECONOMIC_REFERENCE');
  const ids = new Set();
  const stages = input.stages.map((entry) => {
    keys(entry, ['id', 'title', 'phase', 'processId', 'resourceIds', 'intendedValue', 'metricId', 'observation'], 'INVALID_VALUE_LIFECYCLE');
    if (!safeId(entry.id) || ids.has(entry.id) || !VALUE_PHASES.includes(entry.phase)) fail('Value stages need unique identities and a supported lifecycle phase.', 'INVALID_VALUE_LIFECYCLE');
    ids.add(entry.id); const processId = reference(entry.processId, byId, 'process', true); const resourceIds = refs(entry.resourceIds, byId, 'resource');
    if (resourceIds.length && (!processId || resourceIds.some((id) => !(byId.get(processId).resources ?? []).includes(id)))) fail('Value-stage resources must be used by its canonical process.', 'INVALID_ECONOMIC_REFERENCE');
    const stage = { id: entry.id, title: enterpriseText(entry.title, 'Value stage title', 120), phase: entry.phase, processId, resourceIds,
      intendedValue: enterpriseText(entry.intendedValue, 'Intended value', 500), metricId: reference(entry.metricId, byId, 'metric', true) };
    if (entry.observation === null) return { ...stage, observation: null };
    keys(entry.observation, ['basisHash', 'observedAt', 'quantity', 'summary', 'source'], 'INVALID_VALUE_LIFECYCLE');
    if (!/^[a-f0-9]{64}$/.test(entry.observation.basisHash ?? '')) fail('A value report must name the exact stage definition basis hash; stale reports stay visible.', 'INVALID_VALUE_LIFECYCLE');
    return { ...stage, observation: { basisHash: entry.observation.basisHash, observedAt: enterpriseInstant(entry.observation.observedAt, 'Value observation time'),
      quantity: entry.observation.quantity === null ? null : normalizeEconomicQuantity(entry.observation.quantity),
      summary: enterpriseText(entry.observation.summary, 'Reported value summary', 500), source: enterpriseText(entry.observation.source, 'Value report source', 240) } };
  });
  return { schemaVersion: '1.0', offeringId, customerId, stages };
}
export function economicModelErrors(objects) {
  const errors = []; const byId = new Map(objects.map((object) => [object.id, object]));
  for (const object of objects) {
    try {
      if (object.economicScenario !== undefined) {
        if (object.type !== 'economics') fail('Only a canonical economics object may own an economic scenario.');
        normalizeEconomicScenario(object.economicScenario, byId);
      }
      if (object.resourcePlan !== undefined) {
        if (object.type !== 'resource') fail('Only a canonical resource may own a resource plan.', 'INVALID_RESOURCE_PLAN');
        normalizeResourcePlan(object.resourcePlan, byId, object.id);
      }
      if (object.valueLifecycle !== undefined) {
        if (object.type !== 'lifecycle') fail('Only a canonical lifecycle may own a value lifecycle.', 'INVALID_VALUE_LIFECYCLE');
        normalizeValueLifecycle(object.valueLifecycle, byId);
      }
    } catch (error) { errors.push({ code: error.code, path: object.id, message: error.message }); }
  }
  return errors;
}
export function economicModelRelations(objects) {
  const relations = []; const add = (source, target, type) => {
    if (target && source !== target) relations.push({ id: `${source}--${type}--${target}`, source, target, type });
  };
  for (const object of objects) {
    const scenario = object.economicScenario;
    if (scenario) {
      add(object.id, scenario.offeringId, 'models-offering');
      scenario.processIds.forEach((id) => add(object.id, id, 'models-process'));
      scenario.resourceDemands.forEach((entry) => add(object.id, entry.resourceId, 'requires-scenario-resource'));
    }
    for (const window of object.resourcePlan?.windows ?? []) for (const allocation of window.allocations) add(object.id, allocation.processId, 'allocated-to-process');
    const value = object.valueLifecycle;
    if (value) {
      add(object.id, value.offeringId, 'tracks-offering-value'); add(object.id, value.customerId, 'tracks-customer-value');
      for (const stage of value.stages) {
        add(object.id, stage.processId, 'value-through-process'); add(object.id, stage.metricId, 'value-measured-by');
        stage.resourceIds.forEach((id) => add(object.id, id, 'value-uses-resource'));
      }
    }
  }
  return [...new Map(relations.map((relation) => [relation.id, relation])).values()];
}
export const ECONOMIC_MODEL = { schemaVersion: '1.0', valuePhases: VALUE_PHASES, limits: ECONOMIC_LIMITS,
  money: { representation: 'INTEGER_MINOR_UNITS', declaredDecimalPlaces: [0, 1, 2, 3, 4], conversion: 'UNSUPPORTED' },
  quantity: { maximumDecimalPlaces: QUANTITY_DECIMAL_PLACES, arithmetic: 'FIXED_DECIMAL', conversion: 'UNSUPPORTED' },
  meaning: 'SCENARIO_ONLY', gaps: ['Declared assumptions, availability and commitments are unverified reports; evaluation performs no work, reservation, purchase or payment.',
    'Capacity uses exact UTC windows and explicit units; recurring/DST calendars, partial-window proration and unit/currency conversion are unsupported.',
    'Accounting, supplier and consumption evidence remain identified sources; this design model does not reconcile live accounting or resource usage.'] };
