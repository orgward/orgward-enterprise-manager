import { enterpriseTypedValue } from './enterprise-process.mjs';

export const isManualFlowPlan = (plan) => plan?.kind === 'manual_process_flow_plan';
export const manualFlowKindLabel = (kind) => ({ manual: 'Assigned activity', 'manual-exception': 'Exception handler', decision: 'Human decision', fork: 'Parallel branches', join: 'Branch join', loop: 'Bounded loop decision', 'loop-return': 'Return to loop', end: 'Flow end' })[kind] ?? 'Flow step';
export const manualFlowAllowsAgent = (task) => ['manual', 'manual-exception'].includes(task?.flowRef?.kind);

export function manualFlowAgentRequestReady(plan, instanceRows, task, instanceId) {
  return isManualFlowPlan(plan) && manualFlowAllowsAgent(task)
    && plan.tasks.some((saved) => saved.id === task.id && saved.flowRef?.stepId === task.flowRef.stepId
      && saved.flowRef?.iteration === task.flowRef.iteration && saved.flowRef?.kind === task.flowRef.kind)
    && activationForTask(plan, instanceRows, task.id, instanceId)?.state === 'READY';
}
export const manualFlowInputLabel = (task, informationId) => task.inputs?.find((input) => input.objectId === informationId)?.label ?? 'Declared information input';

export function mergeProcessPlanActivation(savedPlans, runtimePlans) {
  const derived = new Map(runtimePlans.map((plan) => [`${plan.id}\n${plan.revision ?? 1}`, plan]));
  const result = savedPlans.map((plan) => {
    const key = `${plan.id}\n${plan.revision ?? 1}`;
    const runtime = derived.get(key); derived.delete(key);
    return runtime && isManualFlowPlan(plan) ? { ...plan, activation: runtime.activation } : plan;
  });
  return [...result, ...derived.values()];
}

export function manualFlowActivation(plan, instanceRows, instanceId) {
  if (!isManualFlowPlan(plan)) return null;
  const activation = instanceId === null ? plan.activation
    : instanceRows.find((row) => row.projectId === plan.source?.projectId && row.processPlanId === plan.id
      && row.revision === plan.revision && row.planInstanceId === instanceId
      && row.activation?.planInstanceId === instanceId)?.activation;
  return activation?.planInstanceId === instanceId ? activation : null;
}

export function activationForTask(plan, instanceRows, taskId, instanceId) {
  return manualFlowActivation(plan, instanceRows, instanceId)?.tasks?.find((row) => row.taskId === taskId) ?? null;
}

export function manualFlowDecisionDefinition(plan, project, task) {
  if (!isManualFlowPlan(plan) || !['decision', 'loop'].includes(task?.flowRef?.kind)) return null;
  if (task.flowRef.decisionTable) return task.flowRef.decisionTable;
  const blueprint = project.blueprintVersions?.find((entry) => entry.id === plan.source.blueprintId
    && entry.version === plan.source.blueprintVersion);
  return Object.values(blueprint?.areas ?? {}).flatMap((area) => area.items ?? [])
    .find((entry) => entry.id === task.flowRef.decisionId)?.decisionTable ?? null;
}

export function evaluateManualFlowAdvice(table, observations) {
  if (!table) return { status: 'UNAVAILABLE', outcome: null };
  const values = new Map(observations.map((entry) => [entry.informationId, entry.value]));
  if (table.inputs.some((input) => !values.has(input.informationId)
    || typeof values.get(input.informationId) !== input.valueType)) return { status: 'UNKNOWN', outcome: null };
  const compare = (condition) => {
    const actual = values.get(condition.informationId); const expected = condition.value;
    return condition.operator === 'eq' ? actual === expected : condition.operator === 'neq' ? actual !== expected
      : condition.operator === 'lt' ? actual < expected : condition.operator === 'lte' ? actual <= expected
        : condition.operator === 'gt' ? actual > expected : condition.operator === 'gte' ? actual >= expected
          : condition.operator === 'in' && Array.isArray(expected) ? expected.includes(actual) : false;
  };
  const matches = table.rules.filter((rule) => rule.conditions.every(compare));
  if (table.hitPolicy === 'UNIQUE' && matches.length > 1) return { status: 'CONFLICTED', outcome: null };
  const outcome = matches[0]?.outcome ?? table.defaultOutcome ?? null;
  return { status: outcome === null ? 'UNKNOWN' : 'RESOLVED', outcome };
}

export function renderManualFlowDecisionChoice({ project, plan, task, el }) {
  if (!isManualFlowPlan(plan) || !['decision', 'loop'].includes(task.flowRef?.kind)) return null;
  const table = manualFlowDecisionDefinition(plan, project, task);
  const node = el('fieldset', { className: 'manual-flow-decision-choice' }, [
    el('legend', { text: `Human decision — ${task.title ?? 'Declared choice'}` }),
    el('p', { className: 'muted', text: table?.decisionMode === 'ENFORCED'
      ? 'Record observed inputs and an outcome resolved by this pinned enforced decision table. A conflicting, unknown or different outcome cannot be saved.'
      : 'Record your observed inputs, explicit declared outcome and reason. Table evaluation is advice; your saved choice controls this occurrence.' }),
  ]);
  const outcome = el('select', { attrs: { name: 'decisionOutcome', required: 'required', 'aria-label': `Declared human outcome for ${task.title}` } }, [
    el('option', { text: 'Choose a declared outcome', attrs: { value: '' } }),
    ...(task.flowRef.outcomes ?? []).map((value) => el('option', { text: value, attrs: { value } })),
  ]);
  const fields = (task.flowRef.decisionInputs ?? table?.inputs ?? []).map((input) => {
    const control = input.valueType === 'boolean' ? el('select', { attrs: { name: input.informationId, required: 'required' } }, [
      el('option', { text: 'Choose observed value', attrs: { value: '' } }),
      el('option', { text: 'True', attrs: { value: 'true' } }),
      el('option', { text: 'False', attrs: { value: 'false' } }),
    ]) : el('input', { attrs: { name: input.informationId, type: input.valueType === 'number' ? 'number' : 'text',
      ...(input.valueType === 'number' ? { step: 'any' } : { maxlength: '240' }), required: 'required' } });
    const known = el('select', { attrs: { name: `known:${input.informationId}` } }, [
      el('option', { text: 'Observed value', attrs: { value: 'known' } }),
      el('option', { text: 'Explicitly unknown', attrs: { value: 'unknown' } }),
    ]);
    const label = manualFlowInputLabel(task, input.informationId);
    node.append(el('label', { text: `Observation status for ${label}` }, known), el('label', { text: `Observed ${label} (${input.valueType})` }, control));
    return { ...input, control, known };
  });
  const reason = el('textarea', { attrs: { name: 'decisionReason', rows: '2', maxlength: '1000', required: 'required', 'aria-label': `Human decision reason for ${task.title}` } });
  const advice = el('p', { className: 'manual-flow-table-advice', attrs: { role: 'status', 'aria-live': 'polite' }, text: 'Table advice: enter typed observations to evaluate the pinned table.' });
  const observations = () => fields.map((entry) => ({ informationId: entry.informationId, value: entry.known.value === 'unknown' ? null : enterpriseTypedValue(entry.valueType, entry.control.value) }));
  const updateAdvice = () => {
    try {
      if (fields.some((entry) => entry.known.value === 'known' && !entry.control.value.trim())) { advice.textContent = 'Table advice: UNKNOWN — observed inputs are incomplete.'; return; }
      const evaluation = evaluateManualFlowAdvice(table, observations());
      advice.textContent = table?.decisionMode === 'ENFORCED'
        ? `Enforced table result: ${evaluation.status}${evaluation.outcome ? ` — ${evaluation.outcome}` : ''}.${evaluation.status === 'RESOLVED' ? ' Choose this outcome to continue.' : ' A resolved outcome is required.'}`
        : `Table advice: ${evaluation.status}${evaluation.outcome ? ` — ${evaluation.outcome}` : ''}. Choose the human outcome explicitly.`;
    } catch { advice.textContent = 'Table advice: UNKNOWN — enter valid typed observations.'; }
  };
  let choiceRequired = true;
  const syncFields = () => {
    for (const field of fields) { field.control.disabled = field.known.value === 'unknown'; field.control.required = choiceRequired && field.known.value === 'known'; }
  };
  for (const field of fields) {
    field.control.addEventListener('input', updateAdvice);
    field.known.addEventListener('change', () => { syncFields(); updateAdvice(); });
  }
  node.append(advice, el('label', { text: 'Declared human outcome' }, outcome), el('label', { text: 'Human choice reason (required for succeeded work)' }, reason));
  node.append(el('details', {}, [el('summary', { text: 'Pinned decision and input references' }),
    el('p', { text: `Decision: ${task.flowRef.decisionId} · step: ${task.flowRef.stepId} · iteration ${task.flowRef.iteration}` }),
    el('ul', {}, fields.map((field) => el('li', { text: `${manualFlowInputLabel(task, field.informationId)}: ${field.informationId}` }))),
  ]));
  return { node,
    setRequired(required) { choiceRequired = required; outcome.required = required; reason.required = required; syncFields(); },
    read() {
      if (!table) throw new Error('The pinned decision table is unavailable. Reload before recording a decision.');
      if (!outcome.value || !reason.value.trim()) throw new Error('Choose a declared human outcome and enter its reason.');
      if (fields.some((field) => field.known.value === 'known' && !field.control.value.trim())) throw new Error('Record every declared observed input or mark it explicitly unknown.');
      if (table.decisionMode === 'ENFORCED') {
        const evaluation = evaluateManualFlowAdvice(table, observations());
        if (evaluation.status !== 'RESOLVED' || evaluation.outcome !== outcome.value) throw new Error('The recorded outcome must match a resolved outcome from this enforced decision table.');
      }
      return { outcome: outcome.value, observations: observations(), reason: reason.value.trim() };
    },
    restore(choice) {
      if (!choice) return;
      outcome.value = choice.outcome; reason.value = choice.reason;
      for (const field of fields) { const observation = choice.observations.find((entry) => entry.informationId === field.informationId); if (observation) { field.known.value = observation.value === null ? 'unknown' : 'known'; field.control.value = observation.value === null ? '' : String(observation.value); } }
      syncFields();
      updateAdvice();
    },
  };
}
