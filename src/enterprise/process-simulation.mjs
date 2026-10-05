import { digest } from '../sdlc/contracts.mjs';
import { enterpriseFailure } from './types.mjs';
import { decisionOutcomes, normalizeDecisionTable, normalizeProcessFlow } from './process-model.mjs';

export const PROCESS_SIMULATION_ENGINE = 'orgward-declared-flow-v1';
export const STAFFING_SIMULATION_ENGINE = 'orgward-staffing-capacity-v1';
export const STAFFING_SIMULATION_LIMITS = Object.freeze({ arrivals: 1_000_000, capacityPerWorker: 1_000_000, workers: 100 });
const STAFFING_QUANTITY_UNITS = new Set(['cases', 'customers', 'orders', 'requests', 'tasks', 'tickets', 'units']);
const STAFFING_INTERVAL_UNITS = new Set(['minutes', 'hours', 'days', 'weeks']);
const scalar = (value) => value === null || typeof value === 'boolean' || typeof value === 'string' && value.length <= 240
  || typeof value === 'number' && Number.isFinite(value);
export function normalizeProcessScenario(input, flow, byId) {
  const fail = (message) => { throw enterpriseFailure('INVALID_PROCESS_SCENARIO', message); };
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !['inputs', 'activityOutcomes', 'decisionChoices', 'stepLimit'].includes(key))
    || !Array.isArray(input.inputs) || input.inputs.length > 100 || !Array.isArray(input.activityOutcomes)
    || input.activityOutcomes.length > 200 || !Array.isArray(input.decisionChoices) || input.decisionChoices.length > 100
    || !Number.isSafeInteger(input.stepLimit) || input.stepLimit < 1 || input.stepLimit > 200) fail('Provide bounded inputs, activity assumptions, decision choices and a step limit of 1–200.');
  const seen = new Set();
  const inputs = input.inputs.map((entry) => {
    if (!entry || Object.keys(entry).length !== 2 || byId.get(entry.informationId)?.type !== 'information'
      || !Object.hasOwn(entry, 'value') || !scalar(entry.value) || seen.has(entry.informationId)) fail('Scenario inputs need unique saved information IDs and a scalar value or explicit null for unknown.');
    seen.add(entry.informationId); return structuredClone(entry);
  }).sort((a, b) => a.informationId.localeCompare(b.informationId));
  const steps = new Map(flow.steps.map((step) => [step.id, step]));
  function assumptions(entries, decision) {
    const keys = new Set();
    return entries.map((entry) => {
      const step = steps.get(entry?.stepId); const key = `${entry?.stepId}#${entry?.iteration}`;
      if (!entry || Object.keys(entry).length !== 3 || !step || !Number.isSafeInteger(entry.iteration)
        || entry.iteration < 0 || entry.iteration > 10 || keys.has(key)) fail('Assumptions must identify a unique saved step occurrence.');
      if (decision ? !['decision', 'loop'].includes(step.kind) || (entry.outcome !== null
        && !decisionOutcomes(byId.get(step.decisionId).decisionTable).includes(entry.outcome))
        : !['manual', 'manual-exception'].includes(step.kind) || !['SUCCEEDED', 'FAILED', 'UNKNOWN'].includes(entry.outcome)) {
        fail('Use a declared decision outcome or a supported manual activity assumption.');
      }
      keys.add(key); return structuredClone(entry);
    }).sort((a, b) => a.stepId.localeCompare(b.stepId) || a.iteration - b.iteration);
  }
  return { inputs, activityOutcomes: assumptions(input.activityOutcomes, false), decisionChoices: assumptions(input.decisionChoices, true), stepLimit: input.stepLimit };
}
export function evaluateDecisionTable(table, inputs, byId) {
  const definition = normalizeDecisionTable(table, byId); const values = new Map(inputs.map((entry) => [entry.informationId, entry.value]));
  const missing = definition.inputs.filter((entry) => values.get(entry.informationId) == null
    || typeof values.get(entry.informationId) !== entry.valueType).map((entry) => entry.informationId);
  const compare = (operator, left, right) => operator === 'eq' ? left === right : operator === 'neq' ? left !== right
    : operator === 'lt' ? left < right : operator === 'lte' ? left <= right : operator === 'gt' ? left > right
      : operator === 'gte' ? left >= right : right.includes(left);
  const rules = definition.rules.map((rule) => {
    const conditions = rule.conditions.map((condition) => ({ ...structuredClone(condition),
      actual: values.get(condition.informationId) ?? null, status: missing.includes(condition.informationId) ? 'UNKNOWN'
        : compare(condition.operator, values.get(condition.informationId), condition.value) ? 'MATCH' : 'NO_MATCH' }));
    return { id: rule.id, outcome: rule.outcome, conditions,
      status: conditions.some((entry) => entry.status === 'NO_MATCH') ? 'NO_MATCH'
        : conditions.some((entry) => entry.status === 'UNKNOWN') ? 'UNKNOWN' : 'MATCH' };
  });
  // Missing declared inputs remain unknown, even when a default or one partial rule appears usable.
  if (missing.length) return { status: 'UNKNOWN', outcome: null, missing, rules, meaning: 'DESIGNED_RULE_EVALUATION' };
  const matches = rules.filter((rule) => rule.status === 'MATCH');
  if (definition.hitPolicy === 'UNIQUE' && matches.length > 1) return { status: 'CONFLICTED', outcome: null, missing: [], rules, meaning: 'DESIGNED_RULE_EVALUATION' };
  const result = matches[0]?.outcome ?? definition.defaultOutcome;
  return { status: result === null ? 'UNKNOWN' : 'RESOLVED', outcome: result, missing: [], rules, meaning: 'DESIGNED_RULE_EVALUATION' };
}
export function simulateProcessFlow(process, suppliedScenario, byId) {
  if (!process?.processFlow) throw enterpriseFailure('PROCESS_FLOW_REQUIRED', 'Define a typed process flow before simulating it.', 409);
  const flow = normalizeProcessFlow(process.processFlow, byId); const scenario = normalizeProcessScenario(suppliedScenario, flow, byId);
  const map = new Map(flow.steps.map((step) => [step.id, step]));
  const outcomes = new Map(scenario.activityOutcomes.map((entry) => [`${entry.stepId}#${entry.iteration}`, entry.outcome]));
  const choices = new Map(scenario.decisionChoices.map((entry) => [`${entry.stepId}#${entry.iteration}`, entry.outcome]));
  const queue = [{ stepId: flow.startStepId, iteration: 0, loopId: null, forks: [] }];
  const trace = []; const unresolved = []; const joins = new Map(); const visitedWork = new Set();
  let ended = false; let failed = false; let conflicted = false; let limitReached = false;
  const add = (token, status, detail, extra = {}) => {
    if (trace.length >= scenario.stepLimit) { limitReached = true; return; }
    trace.push({ sequence: trace.length + 1, stepId: token.stepId,
      iteration: token.iteration, kind: map.get(token.stepId)?.kind ?? 'unknown', status, detail, ...extra });
  };
  const unknown = (token, code, detail) => { unresolved.push({ stepId: token.stepId, iteration: token.iteration, status: 'UNKNOWN', code, detail }); add(token, 'UNKNOWN', detail); };
  const go = (token, target, extra = {}) => { if (target) queue.push({ ...token, ...extra, stepId: target }); else unknown(token, 'MISSING_ROUTE', 'This path has no explicit next step.'); };
  while (queue.length) {
    if (trace.length >= scenario.stepLimit) { limitReached = true; break; }
    const token = queue.shift(); const step = map.get(token.stepId); const key = `${step.id}#${token.iteration}`;
    if (['manual', 'manual-exception', 'decision', 'loop'].includes(step.kind)) {
      if (visitedWork.has(key)) { unknown(token, 'DUPLICATE_ACTIVATION', 'The same step occurrence was reached twice without an explicit join.'); continue; }
      visitedWork.add(key);
    }
    if (['manual', 'manual-exception'].includes(step.kind)) {
      const result = outcomes.get(key);
      if (!result || result === 'UNKNOWN') { unknown(token, 'ACTIVITY_OUTCOME_UNKNOWN', 'A declared activity result is missing or explicitly unknown.'); continue; }
      add(token, result, 'Declared scenario activity result; no work was performed.', { meaning: 'SCENARIO_ASSUMPTION' });
      if (result === 'SUCCEEDED') go(token, step.nextStepId);
      else if (step.exceptionStepId) go(token, step.exceptionStepId);
      else failed = true;
    } else if (['decision', 'loop'].includes(step.kind)) {
      const decision = byId.get(step.decisionId); const evaluation = evaluateDecisionTable(decision.decisionTable, scenario.inputs, byId);
      const choice = choices.get(key); const result = choices.has(key) ? choice : evaluation.outcome;
      if (choices.has(key)) add(token, choice === null ? 'UNKNOWN' : 'RESOLVED', 'Declared human-choice scenario assumption; this is not a recorded runtime choice.',
        { outcome: choice, evaluation, meaning: 'SCENARIO_ASSUMPTION' });
      else add(token, evaluation.status, 'Evaluated the exact saved designed decision table.', { outcome: result, evaluation, meaning: 'DESIGNED_RULE_EVALUATION' });
      if (result === null) {
        conflicted ||= evaluation.status === 'CONFLICTED' && !choices.has(key);
        unresolved.push({ stepId: step.id, iteration: token.iteration, status: !choices.has(key) && evaluation.status === 'CONFLICTED' ? 'CONFLICTED' : 'UNKNOWN',
          code: 'DECISION_UNRESOLVED', detail: 'Missing, ambiguous or explicitly unknown decision inputs prevent selecting a route.' }); continue;
      }
      if (step.kind === 'decision') {
        const target = step.routes.find((route) => route.outcome === result)?.targetStepId;
        if (!target) unknown(token, 'DECISION_ROUTE_UNDEFINED', 'The evaluated outcome has no declared route.'); else go(token, target);
      } else if (result !== step.continueOutcome) go(token, step.exitStepId, { iteration: 0, loopId: null });
      else if (token.iteration >= step.maxIterations) { limitReached = true; add(token, 'LIMIT_REACHED', 'The declared loop bound was reached; no further iteration was assumed.'); }
      else go(token, step.bodyStepId, { iteration: token.iteration + 1, loopId: step.id });
    } else if (step.kind === 'fork') {
      const forkKey = `${step.id}#${token.iteration}`;
      if (joins.has(forkKey)) { unknown(token, 'DUPLICATE_FORK', 'This fork occurrence was activated twice.'); continue; }
      joins.set(forkKey, { arrivals: new Set(), released: false, expected: step.branchStepIds.length });
      add(token, 'FORKED', 'Activated all declared scenario branches; no parallel work was dispatched.');
      for (const branchId of step.branchStepIds) go(token, branchId, { forks: [...token.forks, { id: step.id, key: forkKey, branchId }] });
    } else if (step.kind === 'join') {
      const fork = token.forks.at(-1); const group = fork && joins.get(fork.key);
      if (!group || fork.id !== step.forkStepId) { unknown(token, 'JOIN_NOT_ACTIVATED', 'This join was reached without its paired fork occurrence.'); continue; }
      group.arrivals.add(fork.branchId);
      if (group.released) { add(token, 'SKIPPED', 'This join already released its single downstream continuation.'); continue; }
      if (step.mode === 'ALL' && group.arrivals.size < group.expected) { add(token, 'WAITING', 'Waiting for every activated branch to reach this join.'); continue; }
      group.released = true; add(token, 'JOINED', `The ${step.mode} join released exactly one continuation.`);
      go(token, step.nextStepId, { forks: token.forks.slice(0, -1) });
    } else if (step.kind === 'loop-return') {
      if (token.loopId !== step.loopStepId || token.iteration < 1) unknown(token, 'LOOP_NOT_ACTIVATED', 'Loop-return was reached outside its own bounded loop.');
      else { add(token, 'RETURNED', 'Returned to the bounded loop decision.'); go(token, step.loopStepId); }
    } else {
      if (token.forks.length || token.loopId) { unknown(token, 'UNCLOSED_CONTROL_SCOPE', 'A path reached an end before its fork or loop scope closed.'); continue; }
      ended = true; add(token, 'ENDED', 'The declared scenario reached an explicit end.');
    }
  }
  if (!ended && !failed && !unresolved.length && !limitReached) unresolved.push({ stepId: null, iteration: 0, status: 'UNKNOWN', code: 'END_NOT_REACHED', detail: 'No explicit end was reached.' });
  const status = limitReached ? 'LIMIT_REACHED' : conflicted ? 'CONFLICTED' : unresolved.length ? 'BLOCKED' : failed ? 'FAILED' : ended ? 'COMPLETED' : 'BLOCKED';
  const core = { engineVersion: PROCESS_SIMULATION_ENGINE, scenarioHash: digest(scenario), status, trace, unresolved,
    meaning: 'SIMULATION_ONLY', scenario };
  return { ...core, resultHash: digest(core) };
}

export function normalizeStaffingScenario(input) {
  const fail = (message) => { throw enterpriseFailure('INVALID_STAFFING_SCENARIO', message); };
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !['schemaVersion', 'arrivals', 'interval', 'capacityPerWorker', 'workerCounts'].includes(key))
    || input.schemaVersion !== '1.0' || !input.arrivals || typeof input.arrivals !== 'object' || Array.isArray(input.arrivals)
    || !input.interval || typeof input.interval !== 'object' || Array.isArray(input.interval)
    || !input.capacityPerWorker || typeof input.capacityPerWorker !== 'object' || Array.isArray(input.capacityPerWorker)
    || !Array.isArray(input.workerCounts) || input.workerCounts.length < 1 || input.workerCounts.length > STAFFING_SIMULATION_LIMITS.workers) {
    fail('Use staffing scenario schema 1.0 with typed arrivals, interval, per-worker capacity, and one or more worker counts.');
  }
  const quantity = (entry, label, maximum) => {
    if (Object.keys(entry).sort().join(',') !== 'unit,value' || !Number.isSafeInteger(entry.value)
      || entry.value < 0 || entry.value > maximum || !STAFFING_QUANTITY_UNITS.has(entry.unit)) {
      fail(`${label} must be a bounded nonnegative whole number with a supported work unit.`);
    }
    return { value: entry.value, unit: entry.unit };
  };
  const arrivals = quantity(input.arrivals, 'Arrivals', STAFFING_SIMULATION_LIMITS.arrivals);
  const capacityPerWorker = quantity(input.capacityPerWorker, 'Per-worker capacity', STAFFING_SIMULATION_LIMITS.capacityPerWorker);
  if (arrivals.unit !== capacityPerWorker.unit) fail('Arrivals and per-worker capacity must use the same work unit.');
  if (Object.keys(input.interval).sort().join(',') !== 'unit,value' || !Number.isSafeInteger(input.interval.value)
    || input.interval.value < 1 || input.interval.value > 10_000 || !STAFFING_INTERVAL_UNITS.has(input.interval.unit)) {
    fail('Use a positive bounded interval with a supported time unit.');
  }
  const workerCounts = input.workerCounts.map((workers) => {
    if (!Number.isSafeInteger(workers) || workers < 1 || workers > STAFFING_SIMULATION_LIMITS.workers) {
      fail(`Worker counts must be whole numbers from 1 to ${STAFFING_SIMULATION_LIMITS.workers}.`);
    }
    return workers;
  });
  if (new Set(workerCounts).size !== workerCounts.length) fail('Worker count comparison values must be unique.');
  return { schemaVersion: '1.0', arrivals, interval: { value: input.interval.value, unit: input.interval.unit },
    capacityPerWorker, workerCounts: [...workerCounts].sort((a, b) => a - b) };
}

export function simulateStaffingCapacity(process, suppliedScenario) {
  if (!process || process.type !== 'process') throw enterpriseFailure('INVALID_PROCESS_REFERENCE', 'Choose a canonical saved process.');
  const scenario = normalizeStaffingScenario(suppliedScenario);
  const comparisons = scenario.workerCounts.map((workers) => {
    const capacity = scenario.capacityPerWorker.value * workers;
    const throughput = Math.min(scenario.arrivals.value, capacity);
    return { workers, capacity, throughput, queue: scenario.arrivals.value - throughput,
      workUnit: scenario.arrivals.unit, interval: structuredClone(scenario.interval),
      meaning: 'SIMULATED_UNVALIDATED_ASSUMPTIONS' };
  });
  const core = { simulationType: 'STAFFING_CAPACITY', engineVersion: STAFFING_SIMULATION_ENGINE,
    meaning: 'SIMULATION_ONLY', assumptionStatus: 'UNVALIDATED', status: 'SIMULATED', scenario, scenarioHash: digest(scenario),
    comparisons, explanations: ['This is a deterministic hypothetical from unvalidated assumptions, not measured operating performance.',
      'Changing worker counts changes the scenario only; no hiring, reservation, assignment, spend, or work occurs.'] };
  return { ...core, resultHash: digest(core) };
}
