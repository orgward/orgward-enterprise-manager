import { randomUUID } from 'node:crypto';
import { digest } from '../sdlc/contracts.mjs';
import { normalizeProcessFlow, normalizeDecisionTable, decisionOutcomes, processStepTargets } from './process-model.mjs';
import { evaluateDecisionTable } from './process-simulation.mjs';

const workKinds = new Set(['manual', 'manual-exception', 'decision', 'loop']);
const fail = (message, code = 'PROCESS_FLOW_RUNTIME_INVALID', statusCode = 409) => { throw Object.assign(new Error(message), { code, statusCode }); };
const objectsOf = (blueprint) => Object.values(blueprint?.areas ?? {}).flatMap((area) => area.items ?? []);
const occurrence = (id, iteration) => `${id}#${iteration}`;
export function manualFlowSnapshotHash(plan) {
  return digest({ id: plan.id, kind: plan.kind, revision: plan.revision, source: plan.source, flow: plan.flow, tasks: plan.tasks });
}
export function planManualProcessFlow(project, payload, actor) {
  const blueprint = project.blueprintVersions?.at(-1);
  if (!blueprint || blueprint.id !== payload.blueprintId || blueprint.version !== payload.blueprintVersion) fail('Compile against the exact current saved blueprint.', 'PROCESS_PLAN_BLUEPRINT_STALE');
  const byId = new Map(objectsOf(blueprint).map((object) => [object.id, object]));
  const root = byId.get(payload.processId);
  if (root?.type !== 'process' || !root.processFlow) fail('Choose a saved process with an advanced flow.', 'PROCESS_FLOW_NOT_FOUND');
  const flow = normalizeProcessFlow(root.processFlow, byId);
  const steps = new Map(flow.steps.map((step) => [step.id, step]));
  const body = new Set(); const loop = flow.steps.find((step) => step.kind === 'loop');
  const collect = (id) => { if (body.has(id)) return; body.add(id); const step = steps.get(id); if (step.kind !== 'loop-return') processStepTargets(step).forEach(collect); };
  if (loop) collect(loop.bodyStepId);
  const occurrences = flow.steps.flatMap((step) => (step.kind === 'loop' ? Array.from({ length: loop.maxIterations + 1 }, (_, index) => index)
    : body.has(step.id) ? Array.from({ length: loop.maxIterations }, (_, index) => index + 1) : [0])
    .map((iteration) => ({ step, iteration })));
  if (occurrences.length > 32) fail('The expanded flow exceeds 32 occurrences. Reduce the loop bound or steps.', 'PROCESS_GRAPH_TOO_LARGE', 400);
  const reference = (id) => { const object = byId.get(id); return { objectId: id, label: object.name, type: object.type }; };
  const tasks = occurrences.filter(({ step }) => workKinds.has(step.kind)).map(({ step, iteration }) => {
    const decision = step.decisionId ? byId.get(step.decisionId) : null;
    const role = byId.get(decision ? decision.by : step.roleId);
    const process = byId.get(step.processId) ?? root;
    const table = decision ? normalizeDecisionTable(decision.decisionTable, byId) : null;
    return { id: `task-flow-${digest({ stepId: step.id, iteration }).slice(0, 24)}`, sourceProcessId: process.id,
      title: `${step.title}${iteration ? ` · iteration ${iteration}` : ''}`.slice(0, 120), detail: process.detail || step.title,
      trigger: process.trigger ?? '', status: 'planned', dependencies: [],
      inputs: (step.inputIds ?? table?.inputs.map((input) => input.informationId) ?? []).map(reference),
      outputs: (step.outputIds ?? []).map(reference),
      assignee: role?.type === 'role' ? { kind: 'role-reference', roleId: role.id, roleName: role.name, state: 'unassigned' } : { kind: 'unassigned', state: 'unassigned' },
      flowRef: { stepId: step.id, iteration, kind: step.kind, ...(decision ? { decisionId: decision.id, decisionHash: digest(table), decisionTable: table,
        outcomes: decisionOutcomes(table), decisionInputs: table.inputs } : {}) } };
  });
  const plan = { id: `process-plan-${randomUUID()}`, kind: 'manual_process_flow_plan', version: 1, revision: 1,
    state: 'planned', epistemicStatus: 'proposed-design', createdAt: new Date().toISOString(), createdBy: actor,
    source: { projectId: project.id, blueprintId: blueprint.id, blueprintVersion: blueprint.version, blueprintHash: digest(blueprint), processId: root.id, processName: root.name },
    flow: { definition: flow, definitionHash: digest(flow), occurrences: occurrences.map(({ step, iteration }) => ({ stepId: step.id, iteration, kind: step.kind })) }, tasks };
  plan.snapshotHash = manualFlowSnapshotHash(plan); return plan;
}
export function verifyManualFlowPlan(plan, blueprint) {
  if (plan?.kind !== 'manual_process_flow_plan') return;
  if (!blueprint || digest(blueprint) !== plan.source.blueprintHash || plan.snapshotHash !== manualFlowSnapshotHash(plan)
    || plan.flow.definitionHash !== digest(plan.flow.definition)) fail('The pinned manual flow snapshot failed verification.', 'PERSISTENCE_INTEGRITY_FAILURE', 500);
  const expected = planManualProcessFlow({ id: plan.source.projectId, blueprintVersions: [blueprint] }, { processId: plan.source.processId,
    blueprintId: blueprint.id, blueprintVersion: blueprint.version }, plan.createdBy);
  const routing = (task) => ({ id: task.id, sourceProcessId: task.sourceProcessId, dependencies: task.dependencies,
    inputs: task.inputs, outputs: task.outputs, flowRef: task.flowRef });
  if (digest(expected.source) !== digest(plan.source) || digest(expected.flow) !== digest(plan.flow)
    || digest(expected.tasks.map(routing)) !== digest(plan.tasks.map(routing))) fail('The runtime routing differs from its pinned blueprint.', 'PERSISTENCE_INTEGRITY_FAILURE', 500);
}
export function normalizeHumanDecisionChoice(task, choice, result) {
  if (!task.flowRef?.decisionId) { if (choice !== undefined) fail('Only a decision task accepts a saved decision choice.', 'INVALID_HUMAN_DECISION_CHOICE', 400); return null; }
  if (result !== 'succeeded') { if (choice !== undefined) fail('A failed decision cannot route a chosen outcome.', 'INVALID_HUMAN_DECISION_CHOICE', 400); return null; }
  const ref = task.flowRef;
  if (!choice || typeof choice !== 'object' || Array.isArray(choice) || Object.keys(choice).some((key) => !['outcome', 'observations', 'reason'].includes(key))
    || !ref.outcomes.includes(choice.outcome) || typeof choice.reason !== 'string' || !choice.reason.trim() || choice.reason.trim().length > 1000
    || !Array.isArray(choice.observations) || choice.observations.length !== ref.decisionInputs.length) fail('Save a declared outcome, typed input observations and a reason.', 'INVALID_HUMAN_DECISION_CHOICE', 400);
  const seen = new Set();
  const observations = choice.observations.map((entry) => {
    const input = ref.decisionInputs.find((input) => input.informationId === entry?.informationId);
    if (!input || seen.has(input.informationId) || Object.keys(entry).some((key) => !['informationId', 'value'].includes(key))
      || !(entry.value === null || (input.valueType === 'number' ? typeof entry.value === 'number' && Number.isFinite(entry.value)
        : input.valueType === 'boolean' ? typeof entry.value === 'boolean' : typeof entry.value === 'string' && entry.value.length <= 240))) fail('Each declared input needs one typed observation or explicit unknown.', 'INVALID_HUMAN_DECISION_CHOICE', 400);
    seen.add(input.informationId); return { informationId: input.informationId, value: entry.value };
  }).sort((a, b) => a.informationId.localeCompare(b.informationId));
  const byId = new Map(ref.decisionInputs.map((input) => [input.informationId, { id: input.informationId, type: 'information' }]));
  const advisory = evaluateDecisionTable(ref.decisionTable, observations, byId);
  if (ref.decisionTable.decisionMode === 'ENFORCED'
    && (advisory.status !== 'RESOLVED' || advisory.outcome !== choice.outcome)) {
    fail('The recorded outcome must match a resolved outcome from this enforced decision table.', 'PROCESS_DECISION_POLICY_BLOCKED', 409);
  }
  const core = { decisionId: ref.decisionId, decisionHash: ref.decisionHash, outcome: choice.outcome,
    observations, reason: choice.reason.trim(), advisory, meaning: 'HUMAN_REPORTED_CHOICE' };
  return { ...core, choiceHash: digest(core) };
}
export function projectManualFlowActivation(plan, outcomes = new Map(), { planInstanceId = null, control = null } = {}) {
  const map = new Map(plan.flow.definition.steps.map((step) => [step.id, step]));
  const tasksByKey = new Map(plan.tasks.map((task) => [occurrence(task.flowRef.stepId, task.flowRef.iteration), task]));
  const activation = new Map(); const trace = []; const joins = new Map(); const visited = new Set();
  const pending = []; const queue = [{ stepId: plan.flow.definition.startStepId, iteration: 0, forks: [], loopId: null }];
  let failed = false; let ended = false; let blocked = false;
  const emit = (token, state, reason) => { const key = occurrence(token.stepId, token.iteration); activation.set(key, { state, reason }); trace.push({ stepId: token.stepId, iteration: token.iteration, kind: map.get(token.stepId).kind, state, reason }); };
  const go = (token, stepId, extra = {}) => {
    if (!stepId || !map.has(stepId)) { blocked = true; emit(token, 'WAITING', 'The route has no explicit saved target.'); return; }
    queue.push({ ...token, ...extra, stepId });
  };
  while (queue.length && trace.length < 200) {
    const token = queue.shift(); const step = map.get(token.stepId); const key = occurrence(step.id, token.iteration);
    if (workKinds.has(step.kind)) {
      if (visited.has(key)) { emit(token, 'WAITING', 'Duplicate activation requires design correction.'); blocked = true; continue; }
      visited.add(key); const task = tasksByKey.get(key); const outcome = task && outcomes.get(task.id);
      if (!task) { emit(token, 'WAITING', 'The saved occurrence is unavailable.'); blocked = true; continue; }
      if (!outcome) { pending.push(token); emit(token, 'READY', 'Reached by verified saved outcomes.'); continue; }
      if (!outcome.verified) { pending.push(token); emit(token, 'WAITING', outcome.reason ?? 'Work is active or its durable outcome is unverified.'); continue; }
      if (!['succeeded', 'failed'].includes(outcome.result) || (outcome.result === 'succeeded' && step.decisionId
        && !task.flowRef.outcomes.includes(outcome.decisionChoice?.outcome))) { blocked = true; emit(token, 'WAITING', 'The verified outcome has no declared human decision choice.'); continue; }
      emit(token, outcome.result === 'succeeded' ? 'SUCCEEDED' : 'FAILED', outcome.runId ? 'Verified durable governed agent execution result.' : 'Verified durable human outcome.');
      if (outcome.result === 'failed') { if (step.exceptionStepId) go(token, step.exceptionStepId); else failed = true; continue; }
      if (step.kind === 'decision') {
        const target = step.routes.find((route) => route.outcome === outcome.decisionChoice?.outcome)?.targetStepId;
        if (!target) { blocked = true; emit(token, 'WAITING', 'The saved choice has no declared route.'); } else go(token, target);
      } else if (step.kind === 'loop') {
        if (outcome.decisionChoice?.outcome !== step.continueOutcome) go(token, step.exitStepId, { iteration: 0, loopId: null });
        else if (token.iteration >= step.maxIterations) { blocked = true; emit(token, 'WAITING', 'Loop bound exhausted. The saved continue choice is retained; stop this instance or revise and compile a new flow.'); }
        else go(token, step.bodyStepId, { iteration: token.iteration + 1, loopId: step.id });
      } else go(token, step.nextStepId);
    } else if (step.kind === 'fork') {
      const forkKey = key; if (joins.has(forkKey)) { blocked = true; emit(token, 'WAITING', 'Duplicate fork activation.'); continue; }
      joins.set(forkKey, { arrived: new Set(), released: false, expected: step.branchStepIds.length }); emit(token, 'SUCCEEDED', 'All declared branches activated.');
      for (const branchId of step.branchStepIds) go(token, branchId, { forks: [...token.forks, { id: step.id, key: forkKey, branchId }] });
    } else if (step.kind === 'join') {
      const fork = token.forks.at(-1); const group = fork && joins.get(fork.key);
      if (!group || fork.id !== step.forkStepId) { blocked = true; emit(token, 'WAITING', 'Paired fork has not activated this join.'); continue; }
      group.arrived.add(fork.branchId); if (group.released) continue;
      if (step.mode === 'ALL' && group.arrived.size < group.expected) { emit(token, 'WAITING', 'Waiting for every activated branch.'); continue; }
      group.released = true; emit(token, 'SUCCEEDED', `Verified ${step.mode} join released one continuation.`); go(token, step.nextStepId, { forks: token.forks.slice(0, -1) });
    } else if (step.kind === 'loop-return') {
      if (token.loopId !== step.loopStepId || token.iteration < 1) { blocked = true; emit(token, 'WAITING', 'Loop-return was reached outside its own bounded loop.'); }
      else { emit(token, 'SUCCEEDED', 'Returned to the next bounded decision occurrence.'); go(token, step.loopStepId); }
    } else {
      if (token.forks.length || token.loopId) { blocked = true; emit(token, 'WAITING', 'An end was reached before its fork or loop scope closed.'); }
      else { emit(token, 'SUCCEEDED', 'Explicit end reached.'); ended = true; }
    }
  }
  const unresolved = [...activation.values()].some((entry) => ['READY', 'WAITING'].includes(entry.state));
  const possible = new Set(); const future = [...pending];
  while (future.length) {
    const token = future.shift(); const key = occurrence(token.stepId, token.iteration); if (possible.has(key)) continue; possible.add(key);
    const step = map.get(token.stepId);
    const add = (stepId, iteration = token.iteration) => future.push({ stepId, iteration });
    if (step.kind === 'loop') { add(step.exitStepId, 0); if (token.iteration < step.maxIterations) add(step.bodyStepId, token.iteration + 1); }
    else if (step.kind === 'loop-return') add(step.loopStepId);
    else processStepTargets(step).forEach((id) => add(id));
  }
  const state = blocked ? 'BLOCKED' : failed ? 'FAILED' : ended && !unresolved ? 'COMPLETED' : 'WAITING';
  const identity = digest({ snapshotHash: plan.snapshotHash, planInstanceId, control, outcomes: [...outcomes].sort(([a], [b]) => a.localeCompare(b)) });
  const decorate = (entry, taskId) => {
    const found = activation.get(occurrence(entry.stepId, entry.iteration));
    let value = found ?? { state: possible.has(occurrence(entry.stepId, entry.iteration)) ? 'WAITING' : 'SKIPPED', reason: possible.has(occurrence(entry.stepId, entry.iteration)) ? 'Not yet reached; awaiting a saved upstream outcome.' : 'Not selected by the saved route.' };
    if (value.state === 'READY' && control && control.status !== 'ACTIVE') value = { state: 'WAITING', reason: `Instance is ${control.status.toLowerCase()}.` };
    return { ...(taskId ? { taskId } : entry), ...value, trace: trace.filter((traceEntry) => traceEntry.stepId === entry.stepId && traceEntry.iteration === entry.iteration), identity };
  };
  return { planInstanceId, state: control && control.status !== 'ACTIVE' ? control.status : state, identity, trace, tasks: plan.tasks.map((task) => decorate(task.flowRef, task.id)), steps: plan.flow.occurrences.map((entry) => decorate(entry)) };
}
