import { digest } from '../sdlc/contracts.mjs';
import { blueprintObjects, enterpriseFailure } from './types.mjs';
import { ECONOMIC_LIMITS, ECONOMIC_MODEL, normalizeEconomicScenario, normalizeResourcePlan,
  normalizeValueLifecycle, valueStageBasisHash, QUANTITY_DECIMAL_PLACES } from './economics-model.mjs';

export const ECONOMIC_ENGINE_VERSION = 'declared-economics-1.0';
const unknown = (message) => ({ status: 'UNKNOWN', explanation: message });
const incompatible = (message) => ({ status: 'INCOMPATIBLE', explanation: message });
const limited = (message) => ({ status: 'LIMIT_REACHED', explanation: message });
const quantity = (value, unit, explanation) => value === null ? unknown(explanation) : { status: 'CALCULATED', value, unit, explanation };
const money = (minorUnits, basis, explanation) => ({ status: 'CALCULATED', minorUnits, currency: basis.currency,
  decimalPlaces: basis.decimalPlaces, explanation });
const moneyCompatible = (left, right) => left.currency === right.currency && left.decimalPlaces === right.decimalPlaces;
const safeMoney = (value, basis, explanation) => value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)
  ? limited('The calculated amount exceeds the safe integer minor-unit limit.') : money(Number(value), basis, explanation);
const exactWindow = (left, right) => left.start === right.start && left.end === right.end && left.timezone === right.timezone;
const scaledQuantity = (value) => BigInt(value.toFixed(QUANTITY_DECIMAL_PLACES).replace('.', ''));
function fixedQuantity(value, unit, explanation) {
  const sign = value < 0n ? '-' : ''; const absolute = value < 0n ? -value : value;
  const digits = String(absolute).padStart(QUANTITY_DECIMAL_PLACES + 1, '0');
  const decoded = Number(`${sign}${digits.slice(0, -QUANTITY_DECIMAL_PLACES)}.${digits.slice(-QUANTITY_DECIMAL_PLACES)}`);
  if (!Number.isFinite(decoded) || Math.abs(decoded) > ECONOMIC_LIMITS.amount || scaledQuantity(decoded) !== value) return limited('The calculated quantity exceeds the numeric bound or supported six-place precision.');
  return quantity(decoded, unit, explanation);
}
function statusOf(metrics, constraints = []) {
  const statuses = metrics.map((entry) => entry.status);
  if (statuses.includes('INCOMPATIBLE')) return 'INCOMPATIBLE';
  if (statuses.includes('LIMIT_REACHED')) return 'LIMIT_REACHED';
  if (statuses.includes('UNKNOWN')) return 'UNKNOWN';
  return constraints.length || statuses.includes('CONSTRAINED') ? 'CONSTRAINED' : 'COMPLETE';
}
function productMoney(amount, volume, explanation) {
  if (amount.minorUnits === null || volume.value === null) return unknown('The money amount or scenario volume is unknown.');
  return safeMoney(BigInt(amount.minorUnits) * BigInt(volume.value), amount, explanation);
}
function combineMoney(left, right, operation, explanation) {
  if (left.status === 'INCOMPATIBLE' || right.status === 'INCOMPATIBLE') return incompatible('A preceding amount is incompatible.');
  if (left.status === 'LIMIT_REACHED' || right.status === 'LIMIT_REACHED') return limited('A preceding calculation exceeded its numeric bound.');
  if (left.status !== 'CALCULATED' || right.status !== 'CALCULATED') return unknown('A required amount is unknown.');
  if (!moneyCompatible(left, right)) return incompatible('Currency or declared minor-unit precision differs; no conversion or total was made.');
  return safeMoney(operation(BigInt(left.minorUnits), BigInt(right.minorUnits)), left, explanation);
}
function amountMetric(amount, explanation) {
  return amount.minorUnits === null ? unknown('This declared amount is unknown.') : money(amount.minorUnits, amount, explanation);
}
function sumQuantities(entries, unit, explanation) {
  if (entries.some((entry) => entry.unit !== unit)) return incompatible('Quantity units differ; no unit conversion or total was made.');
  if (entries.some((entry) => entry.value === null)) return unknown('One or more declared quantities are unknown.');
  return fixedQuantity(entries.reduce((sum, entry) => sum + scaledQuantity(entry.value), 0n), unit, explanation);
}
function demandMetric(demands, unit) {
  if (demands.some((entry) => entry.issue === 'INCOMPATIBLE')) return incompatible('A resource demand per-output unit differs from the scenario output unit.');
  if (demands.some((entry) => entry.issue === 'LIMIT_REACHED')) return limited('Calculated scenario resource demand exceeded its numeric bound.');
  return sumQuantities(demands.map((entry) => entry.quantity), unit, 'Sum of additional scenario demand for this resource.');
}
function evaluateNormalizedResourceWindow(resource, plan, requestedWindow, demands, initial = null) {
  const base = initial ?? { resourceId: resource.id, resourceName: resource.name, meaning: 'SCENARIO_ONLY', window: structuredClone(requestedWindow),
    constraints: [], allocationTreatment: 'Scenario demand is additional to every saved planned or reported commitment in this window.' };
  const saved = plan.windows.find((entry) => exactWindow(entry.window, requestedWindow));
  if (!saved) {
    const metric = unknown('No exact resource window matches the scenario interval; partial coverage is not prorated.');
    const metrics = { ...Object.fromEntries(['capacity', 'available', 'allocated', 'remaining', 'headroom'].map((name) => [name, { ...metric }])),
      required: demandMetric(demands, demands[0]?.quantity.unit ?? plan.windows[0].capacity.unit) };
    return { ...base, status: statusOf(Object.values(metrics)), windowId: null, metrics, allocations: [], demands: structuredClone(demands) };
  }
  const unit = saved.capacity.unit;
  const capacity = quantity(saved.capacity.value, unit, 'Declared whole-window capacity.');
  const available = saved.available.unit === unit ? quantity(saved.available.value, unit, 'Declared available amount before saved allocations.')
    : incompatible('Available and capacity units differ.');
  const allocated = sumQuantities(saved.allocations.map((entry) => entry.quantity), unit, 'Sum of every planned and reported commitment in this exact window.');
  const required = demandMetric(demands, unit);
  const subtract = (left, right, explanation) => {
    const status = statusOf([left, right]);
    if (status === 'INCOMPATIBLE') return incompatible('Units differ in a required quantity.');
    if (status === 'LIMIT_REACHED') return limited('A required quantity exceeded its numeric bound.');
    if (status === 'UNKNOWN') return unknown('A required capacity, availability, allocation or demand quantity is unknown.');
    return fixedQuantity(scaledQuantity(left.value) - scaledQuantity(right.value), unit, explanation);
  };
  const remaining = subtract(available, allocated, 'Available amount minus every saved allocation.');
  const headroom = subtract(remaining, required, 'Remaining available amount minus additional scenario demand.');
  if (capacity.status === 'CALCULATED' && available.status === 'CALCULATED' && available.value > capacity.value) {
    base.constraints.push({ code: 'RESOURCE_AVAILABILITY_EXCEEDS_CAPACITY', resourceId: resource.id, message: 'Declared availability exceeds declared capacity; reconcile these assumptions.' });
  }
  if (remaining.status === 'CALCULATED' && remaining.value < 0) base.constraints.push({ code: 'RESOURCE_OVERALLOCATED', resourceId: resource.id, message: 'Saved allocations exceed declared availability.' });
  if (headroom.status === 'CALCULATED' && headroom.value < 0) base.constraints.push({ code: 'RESOURCE_CAPACITY_EXCEEDED', resourceId: resource.id, message: 'Additional scenario demand exceeds remaining declared availability.' });
  const metrics = { capacity, available, allocated, remaining, required, headroom };
  return { ...base, windowId: saved.id, status: statusOf(Object.values(metrics), base.constraints), metrics,
    allocations: structuredClone(saved.allocations), demands: demands.map(({ resourceId, processId, quantity: requiredQuantity }) => ({ resourceId, processId, quantity: structuredClone(requiredQuantity) })) };
}
export function evaluateEconomicScenario(object, byId) {
  const scenario = normalizeEconomicScenario(object.economicScenario, byId);
  const constraints = []; const warnings = [];
  const priceUnitMatches = scenario.unitPrice.perUnit === scenario.volume.unit;
  const costUnitMatches = scenario.unitVariableCost.perUnit === scenario.volume.unit;
  const revenue = priceUnitMatches ? productMoney(scenario.unitPrice, scenario.volume, 'Integer volume × declared price in integer minor units.')
    : incompatible('Price per-unit and volume units differ.');
  const variableCost = costUnitMatches ? productMoney(scenario.unitVariableCost, scenario.volume, 'Integer volume × declared variable cost in integer minor units.')
    : incompatible('Variable cost per-unit and volume units differ.');
  const contributionPerUnit = !priceUnitMatches || !costUnitMatches ? incompatible('Price, variable cost and output units must match.')
    : combineMoney(amountMetric(scenario.unitPrice), amountMetric(scenario.unitVariableCost), (a, b) => a - b, 'Declared price minus variable cost per output unit.');
  const fixedCost = amountMetric(scenario.fixedCost, 'Declared fixed cost for the complete scenario interval.');
  const totalCost = combineMoney(variableCost, fixedCost, (a, b) => a + b, 'Calculated variable cost plus declared fixed cost in the same currency and precision.');
  const operatingResult = combineMoney(revenue, totalCost, (a, b) => a - b, 'Calculated revenue minus total declared cost; no actual profit or revenue is established.');
  const funding = amountMetric(scenario.availableFunding, 'Declared funding available for this interval; no bank balance is verified.');
  const fundingHeadroom = combineMoney(funding, totalCost, (a, b) => a - b, 'Declared funding minus total upfront cost; receipts and payment timing are not assumed.');
  let breakEvenVolume;
  if (contributionPerUnit.status !== 'CALCULATED' || fixedCost.status !== 'CALCULATED') {
    const status = statusOf([contributionPerUnit, fixedCost]);
    breakEvenVolume = status === 'INCOMPATIBLE' ? incompatible('A break-even input is incompatible.') : status === 'LIMIT_REACHED' ? limited('A break-even input exceeded its bound.') : unknown('A break-even input is unknown.');
  } else if (!moneyCompatible(contributionPerUnit, fixedCost)) breakEvenVolume = incompatible('Break-even currencies or declared precision differ.');
  else if (contributionPerUnit.minorUnits === 0 && fixedCost.minorUnits === 0) {
    breakEvenVolume = quantity(0, scenario.volume.unit, 'No fixed cost is declared; the break-even threshold is zero output, not an unattainable positive target.');
  }
  else if (contributionPerUnit.minorUnits <= 0) {
    breakEvenVolume = { status: 'NO_FINITE_BREAK_EVEN', unit: scenario.volume.unit, explanation: 'Contribution per unit is zero or negative; this model has no finite break-even volume.' };
  } else {
    const contribution = BigInt(contributionPerUnit.minorUnits); const fixed = BigInt(fixedCost.minorUnits);
    const value = (fixed + contribution - 1n) / contribution;
    breakEvenVolume = value > BigInt(ECONOMIC_LIMITS.volume) ? limited('Break-even volume exceeds the supported scenario volume bound.')
      : quantity(Number(value), scenario.volume.unit, 'Ceiling of fixed cost ÷ positive contribution per unit.');
  }
  if (contributionPerUnit.status === 'CALCULATED' && contributionPerUnit.minorUnits <= 0) constraints.push({ code: 'NONPOSITIVE_UNIT_CONTRIBUTION', economicsId: object.id, message: 'The declared price does not exceed variable cost per unit.' });
  if (operatingResult.status === 'CALCULATED' && operatingResult.minorUnits < 0) constraints.push({ code: 'NEGATIVE_SCENARIO_RESULT', economicsId: object.id, message: 'Calculated scenario revenue is below declared total cost.' });
  if (fundingHeadroom.status === 'CALCULATED' && fundingHeadroom.minorUnits < 0) constraints.push({ code: 'SCENARIO_FUNDING_SHORTFALL', economicsId: object.id, message: 'Declared funding is below total upfront cost.' });
  const demandsByResource = new Map();
  for (const entry of scenario.resourceDemands) {
    const resource = byId.get(entry.resourceId); let demand; let issue = null;
    if (entry.perUnit !== scenario.volume.unit) { demand = { ...entry.quantityPerUnit, value: null }; issue = 'INCOMPATIBLE'; }
    else {
      const metric = entry.quantityPerUnit.value === null || scenario.volume.value === null ? unknown('The resource requirement or output volume is unknown.')
        : fixedQuantity(scaledQuantity(entry.quantityPerUnit.value) * BigInt(scenario.volume.value), entry.quantityPerUnit.unit, 'Per-output resource quantity multiplied by integer scenario volume.');
      demand = { ...entry.quantityPerUnit, value: metric.status === 'CALCULATED' ? metric.value : null };
      if (metric.status === 'LIMIT_REACHED') { issue = 'LIMIT_REACHED'; warnings.push({ code: 'RESOURCE_DEMAND_LIMIT_REACHED', resourceId: resource.id, message: 'Calculated scenario resource demand exceeded its numeric bound or supported precision.' }); }
    }
    if (!demandsByResource.has(resource.id)) demandsByResource.set(resource.id, []);
    demandsByResource.get(resource.id).push({ resourceId: resource.id, processId: entry.processId, quantity: demand, issue });
  }
  for (const processId of scenario.processIds) {
    const process = byId.get(processId);
    for (const resourceId of process.resources ?? []) {
      if (!demandsByResource.has(resourceId)) demandsByResource.set(resourceId, []);
      if (demandsByResource.get(resourceId).some((entry) => entry.processId === processId)) continue;
      const resource = byId.get(resourceId);
      const matchingWindow = resource.resourcePlan?.windows?.find((entry) => exactWindow(entry.window, scenario.window));
      const unit = matchingWindow?.capacity?.unit ?? 'unknown';
      demandsByResource.get(resourceId).push({ resourceId, processId,
        quantity: { value: null, unit, source: 'No scenario demand is declared for this process/resource pair.' }, issue: null });
      warnings.push({ code: 'RESOURCE_DEMAND_UNKNOWN', resourceId, processId,
        message: `No demand assumption is declared for ${process.name} using ${resource.name}; capacity is unknown for this requirement.` });
    }
  }
  const resources = [...demandsByResource].map(([id, demands]) => {
    const resource = byId.get(id);
    if (!resource.resourcePlan) {
      const metric = unknown('No capacity/availability plan is saved for this canonical resource.');
      const metrics = { capacity: metric, available: metric, allocated: metric, remaining: metric, required: demandMetric(demands, demands[0].quantity.unit), headroom: metric };
      return { resourceId: resource.id, resourceName: resource.name, status: statusOf(Object.values(metrics)), meaning: 'SCENARIO_ONLY', windowId: null,
        window: structuredClone(scenario.window), metrics, constraints: [], allocations: [], demands };
    }
    return evaluateNormalizedResourceWindow(resource, normalizeResourcePlan(resource.resourcePlan, byId, resource.id), scenario.window, demands);
  });
  const metrics = { revenue, variableCost, fixedCost, totalCost, contributionPerUnit, operatingResult, funding, fundingHeadroom, breakEvenVolume };
  const allConstraints = [...constraints, ...resources.flatMap((entry) => entry.constraints)];
  const calculatedStatus = statusOf([...Object.values(metrics), ...resources.map((entry) => ({ status: entry.status }))], allConstraints);
  const core = { engineVersion: ECONOMIC_ENGINE_VERSION, meaning: 'SCENARIO_ONLY', economicsId: object.id, scenario,
    scenarioHash: digest(scenario), status: calculatedStatus === 'COMPLETE' && warnings.length ? 'LIMIT_REACHED' : calculatedStatus,
    metrics, resources, constraints: allConstraints, warnings,
    explanations: ['All numeric inputs are declared assumptions or reports. Calculations perform no work and establish no verified business performance.',
      'Revenue and variable cost use integer output volume and integer currency minor units. Currency and precision must match before any money total or comparison.',
      'Capacity amounts cover the exact UTC scenario interval; all saved allocations count and scenario demand is additional.',
      'Resource quantities use at most six decimal places with fixed decimal arithmetic. Every scenario process/resource link must have an explicit demand; omitted demands are represented as unknown and prevent a complete capacity result.',
      'Funding compares total upfront costs to declared funding. Credit, tax, receipts timing and external accounting reconciliation are outside this engine.'] };
  return { ...core, resultHash: digest(core) };
}
export function projectResourcePlan(object, byId) {
  if (!object.resourcePlan) return { resourceId: object.id, status: 'UNKNOWN', meaning: 'DECLARED_DESIGN', windows: [] };
  const plan = normalizeResourcePlan(object.resourcePlan, byId, object.id);
  const windows = plan.windows.map((entry) => evaluateNormalizedResourceWindow(object, plan, entry.window, []));
  return { resourceId: object.id, resourceName: object.name, provider: plan.provider, meaning: 'DECLARED_DESIGN', status: statusOf(windows), windows };
}
export function projectValueLifecycle(object, byId) {
  if (!object.valueLifecycle) return { lifecycleId: object.id, status: 'UNKNOWN', meaning: 'DECLARED_DESIGN', stages: [] };
  const definition = normalizeValueLifecycle(object.valueLifecycle, byId);
  const stages = definition.stages.map((stage) => {
    const basisHash = valueStageBasisHash(stage, { offeringId: definition.offeringId, customerId: definition.customerId });
    const stale = Boolean(stage.observation && stage.observation.basisHash !== basisHash);
    return { ...structuredClone(stage), basisHash, observationStatus: !stage.observation ? 'UNKNOWN' : stale ? 'STALE_REPORTED' : 'REPORTED_UNVERIFIED', stale,
      sourceLabels: { process: stage.processId ? byId.get(stage.processId).name : null, metric: stage.metricId ? byId.get(stage.metricId).name : null,
        resources: Object.fromEntries(stage.resourceIds.map((id) => [id, byId.get(id).name])) } };
  });
  return { lifecycleId: object.id, lifecycleName: object.name, offeringId: definition.offeringId, offeringName: byId.get(definition.offeringId).name,
    customerId: definition.customerId, customerName: definition.customerId ? byId.get(definition.customerId).name : null,
    meaning: 'DECLARED_DESIGN_WITH_UNVERIFIED_REPORTS', stages,
    counts: { stages: stages.length, unknown: stages.filter((entry) => entry.observationStatus === 'UNKNOWN').length,
      reportedUnverified: stages.filter((entry) => entry.observationStatus === 'REPORTED_UNVERIFIED').length,
      staleReported: stages.filter((entry) => entry.stale).length },
    explanation: 'Intended value and human-reported observations stay separate. Reports are not verified customer outcomes; definition changes stale earlier reports.' };
}
export function projectEconomicPortfolio(project, blueprint, context = {}) {
  const objects = blueprintObjects(blueprint); const byId = new Map(objects.map((object) => [object.id, object]));
  const cutoff = context.recordedAtCutoff ?? null;
  const savedBy = (at) => !cutoff || Date.parse(at) <= Date.parse(cutoff);
  const visible = (project.enterpriseEconomicEvaluations ?? []).filter((entry) => savedBy(entry.createdAt));
  const selectedId = context.selectedId ?? context.selectionId ?? null;
  const matches = (entry) => blueprint && entry.source.blueprintId === blueprint.id && entry.source.blueprintVersion === blueprint.version
    && entry.source.snapshotHash === digest(blueprint) && entry.source.branchId === (context.branchId ?? null)
    && entry.source.branchRevision === (context.branchRevision ?? null) && entry.source.proposalId === (context.proposalId ?? null);
  let evaluation = context.economicEvaluationId ? (project.enterpriseEconomicEvaluations ?? []).find((entry) => entry.id === context.economicEvaluationId)
    : visible.filter((entry) => (!selectedId || entry.economicsId === selectedId) && matches(entry)).at(-1) ?? null;
  if (context.economicEvaluationId && !evaluation) throw enterpriseFailure('ECONOMIC_EVALUATION_NOT_FOUND', 'The saved economic evaluation was not found in this project.', 404);
  if (evaluation && !savedBy(evaluation.createdAt)) throw enterpriseFailure('ENTERPRISE_CONTEXT_NOT_RECORDED', 'This economic evaluation was not yet saved at the selected recorded-time cutoff.', 404);
  if (evaluation) {
    const { id, createdAt, createdBy, reason, resultHash, ...core } = evaluation;
    const source = core.source;
    const sourceSnapshot = source?.branchId ? (project.enterpriseBranches ?? []).find((entry) => entry.id === source.branchId)?.revisions
      .find((entry) => entry.revision === source.branchRevision)?.snapshot
      : source?.proposalId ? (project.enterpriseProposals ?? []).find((entry) => entry.id === source.proposalId)?.snapshot
        : project.blueprintVersions.find((entry) => entry.id === source?.blueprintId && entry.version === source?.blueprintVersion);
    if (digest(core) !== resultHash || digest(core.scenario) !== core.scenarioHash || core.meaning !== 'SCENARIO_ONLY'
      || core.engineVersion !== ECONOMIC_ENGINE_VERSION || source?.projectId !== project.id || !sourceSnapshot
      || sourceSnapshot.id !== source.blueprintId || sourceSnapshot.version !== source.blueprintVersion || digest(sourceSnapshot) !== source.snapshotHash) {
      throw enterpriseFailure('ECONOMIC_EVALUATION_INTEGRITY', 'The saved economic evaluation failed its immutable scenario/result checks.', 409);
    }
    evaluation = { ...structuredClone(evaluation), matchesSelectedSource: Boolean(matches(evaluation)) };
  }
  return { model: structuredClone(ECONOMIC_MODEL), scenarios: objects.filter((object) => object.type === 'economics').map((object) => ({ objectId: object.id,
    name: object.name, definition: structuredClone(object.economicScenario ?? null), status: object.economicScenario ? 'DECLARED_ASSUMPTIONS' : 'UNKNOWN' })),
    resources: objects.filter((object) => object.type === 'resource').map((object) => projectResourcePlan(object, byId)),
    valueLifecycles: objects.filter((object) => object.type === 'lifecycle').map((object) => projectValueLifecycle(object, byId)),
    evaluations: visible.map(({ id, createdAt, createdBy, reason, economicsId, source, sourceLabels, status, meaning, engineVersion, scenarioHash, resultHash }) =>
      ({ id, createdAt, createdBy, reason, economicsId, source: structuredClone(source), sourceLabels: structuredClone(sourceLabels), status, meaning, engineVersion, scenarioHash, resultHash })), evaluation };
}
