import { enterpriseFailure, enterpriseText } from './types.mjs';

export const PROCESS_STEP_KINDS = ['manual', 'manual-exception', 'decision', 'fork', 'join', 'loop', 'loop-return', 'end'];
export const DECISION_OPERATORS = ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in'];
const fail = (message, code = 'INVALID_PROCESS_FLOW') => { throw enterpriseFailure(code, message); };
const safeId = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,119}$/i.test(value);
const outcome = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9 _-]{0,59}$/i.test(value);
function keys(input, allowed, code) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !allowed.includes(key))) fail('The definition contains unsupported fields.', code);
}
function reference(value, byId, type, nullable = false) {
  if (nullable && value === null) return null;
  if (!safeId(value) || byId.get(value)?.type !== type) fail(`Choose a saved ${type} from this exact blueprint.`, 'INVALID_PROCESS_REFERENCE');
  return value;
}
function refList(values, byId, type) {
  if (!Array.isArray(values) || values.length > 12 || new Set(values).size !== values.length) fail('Reference lists must contain at most twelve unique saved records.', 'INVALID_PROCESS_REFERENCE');
  return values.map((value) => reference(value, byId, type));
}
function typedValue(value, type) {
  return type === 'number' ? typeof value === 'number' && Number.isFinite(value)
    : type === 'boolean' ? typeof value === 'boolean' : typeof value === 'string' && value.length <= 240;
}
export function normalizeDecisionTable(input, byId) {
  const code = 'INVALID_DECISION_TABLE';
  keys(input, ['schemaVersion', 'hitPolicy', 'inputs', 'rules', 'defaultOutcome'], code);
  if (input.schemaVersion !== '1.0' || !['FIRST_MATCH', 'UNIQUE'].includes(input.hitPolicy)
    || !Array.isArray(input.inputs) || input.inputs.length < 1 || input.inputs.length > 12
    || !Array.isArray(input.rules) || input.rules.length < 1 || input.rules.length > 20
    || (input.defaultOutcome !== null && !outcome(input.defaultOutcome))) fail('Provide a supported decision table with 1–12 typed inputs, 1–20 rules and an explicit default outcome or null.', code);
  const types = new Map();
  const inputs = input.inputs.map((entry) => {
    keys(entry, ['informationId', 'valueType'], code);
    const informationId = reference(entry.informationId, byId, 'information');
    if (!['string', 'number', 'boolean'].includes(entry.valueType) || types.has(informationId)) fail('Decision inputs must be unique information records with a scalar type.', code);
    types.set(informationId, entry.valueType); return { informationId, valueType: entry.valueType };
  });
  const ids = new Set();
  const rules = input.rules.map((rule) => {
    keys(rule, ['id', 'conditions', 'outcome'], code);
    if (!safeId(rule.id) || ids.has(rule.id) || !outcome(rule.outcome) || !Array.isArray(rule.conditions)
      || rule.conditions.length < 1 || rule.conditions.length > 12) fail('Each rule needs a unique ID, declared outcome and 1–12 typed conditions.', code);
    ids.add(rule.id);
    return { id: rule.id, outcome: rule.outcome, conditions: rule.conditions.map((condition) => {
      keys(condition, ['informationId', 'operator', 'value'], code);
      const type = types.get(condition.informationId);
      if (!type || !DECISION_OPERATORS.includes(condition.operator)) fail('Conditions must use declared inputs and supported operators.', code);
      if (['lt', 'lte', 'gt', 'gte'].includes(condition.operator) && type !== 'number') fail('Ordering comparisons require numeric inputs.', code);
      if (condition.operator === 'in' ? !Array.isArray(condition.value) || condition.value.length < 1 || condition.value.length > 12
        || condition.value.some((value) => !typedValue(value, type)) : !typedValue(condition.value, type)) fail('Condition values must match their declared scalar input type.', code);
      return structuredClone(condition);
    }) };
  });
  return { schemaVersion: '1.0', hitPolicy: input.hitPolicy, inputs, rules, defaultOutcome: input.defaultOutcome };
}
export function decisionOutcomes(table) {
  return [...new Set([...(table?.rules ?? []).map((rule) => rule.outcome), ...(table?.defaultOutcome ? [table.defaultOutcome] : [])])];
}
export function normalizeProcessFlow(input, byId) {
  keys(input, ['schemaVersion', 'startStepId', 'steps'], 'INVALID_PROCESS_FLOW');
  if (input.schemaVersion !== '1.0' || !Array.isArray(input.steps) || !input.steps.length || input.steps.length > 32 || !safeId(input.startStepId)) fail('A flow needs 1–32 typed steps and an explicit start.');
  const ids = new Set();
  const steps = input.steps.map((step) => {
    const common = ['id', 'kind', 'title'];
    if (!safeId(step?.id) || ids.has(step.id) || !PROCESS_STEP_KINDS.includes(step.kind)) fail('Step IDs must be unique and use a supported step kind.');
    ids.add(step.id); const normalized = { id: step.id, kind: step.kind, title: enterpriseText(step.title, 'Step title', 120) };
    const local = (value, nullable = false) => {
      if (nullable && value === null) return null;
      if (!safeId(value)) fail('Routes must identify a saved local step or explicit null.'); return value;
    };
    if (['manual', 'manual-exception'].includes(step.kind)) {
      keys(step, [...common, 'processId', 'roleId', 'inputIds', 'outputIds', 'nextStepId', 'exceptionStepId']);
      Object.assign(normalized, { processId: reference(step.processId, byId, 'process'), roleId: reference(step.roleId, byId, 'role', true),
        inputIds: refList(step.inputIds, byId, 'information'), outputIds: refList(step.outputIds, byId, 'information'),
        nextStepId: local(step.nextStepId, true), exceptionStepId: local(step.exceptionStepId, true) });
    } else if (step.kind === 'decision') {
      keys(step, [...common, 'decisionId', 'routes']);
      const decisionId = reference(step.decisionId, byId, 'decision'); const outcomes = decisionOutcomes(byId.get(decisionId).decisionTable);
      if (!Array.isArray(step.routes) || !step.routes.length || step.routes.length > 20
        || step.routes.some((route) => !route || typeof route !== 'object' || Array.isArray(route))
        || new Set(step.routes.map((route) => route.outcome)).size !== step.routes.length) fail('A decision needs unique outcome routes.');
      Object.assign(normalized, { decisionId, routes: step.routes.map((route) => {
        keys(route, ['outcome', 'targetStepId']);
        if (!outcomes.includes(route.outcome)) fail('Decision routes must name outcomes from the saved decision table.', 'INVALID_PROCESS_REFERENCE');
        return { outcome: route.outcome, targetStepId: local(route.targetStepId) };
      }) });
    } else if (step.kind === 'fork') {
      keys(step, [...common, 'branchStepIds', 'joinStepId']);
      if (!Array.isArray(step.branchStepIds) || step.branchStepIds.length < 2 || step.branchStepIds.length > 4 || new Set(step.branchStepIds).size !== step.branchStepIds.length) fail('A fork needs two to four unique branches.');
      Object.assign(normalized, { branchStepIds: step.branchStepIds.map((id) => local(id)), joinStepId: local(step.joinStepId) });
    } else if (step.kind === 'join') {
      keys(step, [...common, 'forkStepId', 'mode', 'nextStepId']);
      if (!['ALL', 'ANY'].includes(step.mode)) fail('Choose ALL or ANY join behavior.');
      Object.assign(normalized, { forkStepId: local(step.forkStepId), mode: step.mode, nextStepId: local(step.nextStepId, true) });
    } else if (step.kind === 'loop') {
      keys(step, [...common, 'decisionId', 'continueOutcome', 'bodyStepId', 'exitStepId', 'maxIterations']);
      const decisionId = reference(step.decisionId, byId, 'decision');
      if (!decisionOutcomes(byId.get(decisionId).decisionTable).includes(step.continueOutcome)
        || !Number.isSafeInteger(step.maxIterations) || step.maxIterations < 1 || step.maxIterations > 10) fail('A loop needs a saved continue outcome and a bound of 1–10 iterations.');
      Object.assign(normalized, { decisionId, continueOutcome: step.continueOutcome, bodyStepId: local(step.bodyStepId), exitStepId: local(step.exitStepId), maxIterations: step.maxIterations });
    } else if (step.kind === 'loop-return') {
      keys(step, [...common, 'loopStepId']); normalized.loopStepId = local(step.loopStepId);
    } else keys(step, common);
    return normalized;
  });
  const flow = { schemaVersion: '1.0', startStepId: input.startStepId, steps };
  const map = new Map(steps.map((step) => [step.id, step]));
  if (!map.has(flow.startStepId) || !steps.some((step) => step.kind === 'end')) fail('Choose an available start and at least one explicit end.');
  if (steps.filter((step) => step.kind === 'loop').length > 1) fail('Version 1 supports one bounded loop per flow; nested or multiple loops are unsupported.', 'PROCESS_FLOW_UNSUPPORTED');
  for (const step of steps) {
    for (const target of processStepTargets(step)) if (!map.has(target)) fail('Every route must target a step in this same flow.', 'INVALID_PROCESS_REFERENCE');
    if (step.kind === 'fork' && (map.get(step.joinStepId)?.kind !== 'join' || map.get(step.joinStepId).forkStepId !== step.id)) fail('A fork must pair with its declared join.');
    if (step.kind === 'join' && (map.get(step.forkStepId)?.kind !== 'fork' || map.get(step.forkStepId).joinStepId !== step.id)) fail('A join must pair with its declared fork.');
    if (step.kind === 'loop-return' && map.get(step.loopStepId)?.kind !== 'loop') fail('A loop return must identify its bounded loop.');
    if (step.exceptionStepId && map.get(step.exceptionStepId)?.kind !== 'manual-exception') fail('Failure routes must target a manual exception handler.');
    if (['manual', 'manual-exception', 'join'].includes(step.kind) && !step.nextStepId) fail('Successful manual work and joins must route to an explicit end or another saved step.');
  }
  const visiting = new Set(); const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) fail('Cycles must use an explicit bounded loop and loop-return.', 'PROCESS_FLOW_CYCLE');
    if (visited.has(id)) return;
    visiting.add(id); const step = map.get(id);
    if (step.kind !== 'loop-return') for (const target of processStepTargets(step)) visit(target);
    visiting.delete(id); visited.add(id);
  };
  visit(flow.startStepId);
  if (visited.size !== steps.length) fail('Every defined step must be reachable from the start.');
  const closesAt = (start, target, seen = new Set()) => {
    if (start === target) return true;
    if (seen.has(start)) return false;
    const nextSeen = new Set([...seen, start]); const step = map.get(start);
    if (['end', 'loop-return'].includes(step.kind)) return false;
    const targets = step.kind === 'loop' ? [step.exitStepId] : step.kind === 'fork' ? [step.joinStepId] : processStepTargets(step);
    return targets.length > 0 && targets.every((id) => closesAt(id, target, nextSeen));
  };
  for (const fork of steps.filter((step) => step.kind === 'fork')) {
    if (!fork.branchStepIds.every((id) => closesAt(id, fork.joinStepId))) fail('Every fork branch must reach its paired join before ending or leaving that branch.');
  }
  const loop = steps.find((step) => step.kind === 'loop');
  if (loop) {
    const returns = steps.filter((step) => step.kind === 'loop-return' && step.loopStepId === loop.id);
    if (!returns.length || !returns.some((step) => closesAt(loop.bodyStepId, step.id))) fail('The loop body must close at its own loop-return.');
    const body = new Set();
    const collect = (id) => { if (body.has(id)) return; body.add(id); if (map.get(id).kind !== 'loop-return') processStepTargets(map.get(id)).forEach(collect); };
    collect(loop.bodyStepId);
    if (body.has(loop.id) || body.has(loop.exitStepId) || body.has(flow.startStepId)) fail('The loop body must be entered only through its loop and close at loop-return.');
    for (const step of steps.filter((step) => !body.has(step.id))) {
      const targets = step.kind === 'loop' ? [step.exitStepId] : processStepTargets(step);
      if (targets.some((id) => body.has(id))) fail('Routes outside a loop cannot enter its body or loop-return.');
    }
  } else if (steps.some((step) => step.kind === 'loop-return')) fail('A loop-return needs a reachable bounded loop.');
  return flow;
}
export function processStepTargets(step) {
  if (['manual', 'manual-exception'].includes(step.kind)) return [step.nextStepId, step.exceptionStepId].filter(Boolean);
  if (step.kind === 'decision') return step.routes.map((route) => route.targetStepId);
  if (step.kind === 'fork') return [...step.branchStepIds, step.joinStepId];
  if (step.kind === 'join') return [step.nextStepId].filter(Boolean);
  if (step.kind === 'loop') return [step.bodyStepId, step.exitStepId];
  if (step.kind === 'loop-return') return [step.loopStepId];
  return [];
}
export function processModelErrors(objects) {
  const errors = []; const byId = new Map(objects.map((object) => [object.id, object]));
  for (const object of objects) {
    try {
      if (object.decisionTable !== undefined) {
        if (object.type !== 'decision') fail('Only a canonical decision may own a decision table.', 'INVALID_DECISION_TABLE');
        normalizeDecisionTable(object.decisionTable, byId);
      }
      if (object.processFlow !== undefined) {
        if (object.type !== 'process') fail('Only a canonical process may own a process flow.');
        normalizeProcessFlow(object.processFlow, byId);
      }
    } catch (error) { errors.push({ code: error.code, path: object.id, message: error.message }); }
  }
  return errors;
}
export function processModelRelations(objects) {
  const relations = []; const seen = new Set();
  const add = (source, target, type) => {
    const id = `rel-${source}-${type}-${target}`;
    if (!target || source === target || seen.has(id)) return;
    seen.add(id); relations.push({ id, source, target, type });
  };
  for (const object of objects) {
    for (const input of object.decisionTable?.inputs ?? []) add(object.id, input.informationId, 'decision-reads');
    for (const step of object.processFlow?.steps ?? []) {
      if (step.processId) add(object.id, step.processId, 'flow-uses-process');
      if (step.decisionId) add(object.id, step.decisionId, 'flow-uses-decision');
      if (step.roleId) add(object.id, step.roleId, 'flow-owned-by');
      for (const id of step.inputIds ?? []) add(object.id, id, 'flow-reads');
      for (const id of step.outputIds ?? []) add(object.id, id, 'flow-writes');
    }
  }
  return relations;
}
export const PROCESS_MODEL = { supportedStepKinds: PROCESS_STEP_KINDS, operators: DECISION_OPERATORS,
  limits: { steps: 32, forkBranches: 4, loops: 1, loopIterations: 10, simulationSteps: 200, decisionInputs: 12, decisionRules: 20 },
  gaps: ['Simulation is a declared scenario, not actual work or verified business performance.',
    'Advanced flow routing requires an explicitly compiled pinned manual-flow plan and assigned human work.',
    'Nested loops, advanced agent automation and timed activation are unsupported.'] };
