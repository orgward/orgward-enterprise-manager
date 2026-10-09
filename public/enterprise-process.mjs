import { enterpriseBranchWritable } from './enterprise-branches.mjs';
import { renderBlueprintImpactPreview } from './blueprint-impact-preview.mjs';

export const ENTERPRISE_PROCESS_COMMANDS = ['define-process-flow', 'define-decision-table', 'simulate-process', 'simulate-staffing',
  'run-sandbox-procurement-test', 'dispatch-sandbox-procurement-test', 'reconcile-sandbox-procurement-test', 'compensate-sandbox-procurement-test'];
const STEP_KINDS = [['manual', 'Manual activity'], ['manual-exception', 'Manual exception handling'], ['decision', 'Decision routing'], ['fork', 'Parallel fork'], ['join', 'Parallel join'], ['loop', 'Bounded loop'], ['loop-return', 'Return to loop'], ['sandbox-procurement', 'Sandbox procurement test effect'], ['end', 'End']];
const OPERATORS = [['eq', 'equals'], ['neq', 'does not equal'], ['lt', 'is less than'], ['lte', 'is at most'], ['gt', 'is greater than'], ['gte', 'is at least'], ['in', 'is one of']];
const VALUE_TYPES = [['string', 'Text'], ['number', 'Number'], ['boolean', 'True or false']];
const allObjects = (model) => Object.values(model.blueprint?.areas ?? {}).flatMap((area) => area.items ?? []);
const nextId = (prefix, ids) => { let number = 1; while (ids.includes(`${prefix}-${number}`)) number += 1; return `${prefix}-${number}`; };
const outcomesFor = (decision) => [...new Set([...(decision?.decisionTable?.rules ?? []).map((rule) => rule.outcome), decision?.decisionTable?.defaultOutcome].filter(Boolean))];

export function enterpriseTypedValue(valueType, value, multiple = false) {
  if (multiple) {
    const values = String(value).split('\n').filter((entry) => entry.trim());
    if (!values.length || values.length > 12) throw new Error('Enter one to twelve match values, one per line.');
    return values.map((entry) => enterpriseTypedValue(valueType, entry));
  }
  if (valueType === 'number') {
    if (!String(value).trim() || !Number.isFinite(Number(value))) throw new Error('Enter a finite number.');
    return Number(value);
  }
  if (valueType === 'boolean') {
    if (!['true', 'false'].includes(String(value).trim())) throw new Error('Enter true or false.');
    return String(value).trim() === 'true';
  }
  if (String(value).length > 240) throw new Error('Text match values must contain at most 240 characters.');
  return String(value);
}

export function enterpriseProcessWritable(model) {
  if (!model?.permissions?.processWrite || !model.blueprint || model.context?.effectiveAt != null || model.context?.recordedAtCutoff != null || model.context?.proposalId) return false;
  return model.context?.branchId ? enterpriseBranchWritable(model) : model.context?.isCurrent === true;
}

export function enterpriseProcessCommandPayload(model, payload) {
  if (!model?.blueprint || !ENTERPRISE_PROCESS_COMMANDS.includes(payload?.kind)) return null;
  if (['run-sandbox-procurement-test', 'dispatch-sandbox-procurement-test', 'reconcile-sandbox-procurement-test', 'compensate-sandbox-procurement-test'].includes(payload.kind)
    && !model.permissions?.sandboxExecute) return null;
  const simulation = ['simulate-process', 'simulate-staffing'].includes(payload.kind);
  if (simulation ? !model.permissions?.simulate : !enterpriseProcessWritable(model)) return null;
  const bound = { ...payload, blueprintId: model.context.blueprintId, blueprintVersion: model.context.blueprintVersion };
  if (model.context.branchId) Object.assign(bound, { branchId: model.context.branchId, branchRevision: model.context.branchRevision });
  if (simulation && model.context.proposalId) bound.proposalId = model.context.proposalId;
  return bound;
}

export function enterpriseSimulationSourceMatches(model, object, simulation) {
  const source = simulation?.source; const context = model?.context;
  return Boolean(source && context && model.blueprint && source.processId === object?.id
    && source.blueprintId === context.blueprintId && source.blueprintVersion === context.blueprintVersion
    && source.snapshotHash && source.snapshotHash === context.snapshotHash
    && (source.branchId ?? null) === (context.branchId ?? null)
    && (source.branchRevision ?? null) === (context.branchRevision ?? null)
    && (source.proposalId ?? null) === (context.proposalId ?? null));
}

export function enterpriseSimulationMatches(model, object, simulation) {
  const cutoff = model?.context?.recordedAtCutoff;
  return enterpriseSimulationSourceMatches(model, object, simulation)
    && (!cutoff || (Number.isFinite(Date.parse(simulation.createdAt)) && Date.parse(simulation.createdAt) <= Date.parse(cutoff)));
}

export function enterpriseProcessDraftMatches(model, object, payload) {
  return Boolean(payload && ENTERPRISE_PROCESS_COMMANDS.includes(payload.kind)
    && payload.blueprintId === model.context.blueprintId && payload.blueprintVersion === model.context.blueprintVersion
    && (payload.objectId ?? payload.processId) === object.id
    && (payload.branchId ?? null) === (model.context.branchId ?? null)
    && (payload.branchRevision ?? null) === (model.context.branchRevision ?? null)
    && (payload.proposalId ?? null) === (model.context.proposalId ?? null));
}

function replaceOptions(el, field, entries) {
  const value = field.control.value;
  field.control.replaceChildren(...entries.map(([id, name]) => el('option', { text: name, attrs: { value: id } })));
  field.control.value = entries.some(([id]) => id === value) ? value : '';
}
function disable(node, disabled) {
  if (disabled) for (const control of node.querySelectorAll('input,select,textarea,button')) control.disabled = true;
}
function action(el, label, callback, disabled = false) {
  const button = el('button', { className: 'button ghost', text: label, attrs: { type: 'button' } });
  button.disabled = disabled; button.addEventListener('click', callback); return button;
}
function referenceChecks(el, objects, selected, name, label) {
  const controls = objects.map((object) => {
    const control = el('input', { attrs: { name, value: object.id, type: 'checkbox' } });
    control.checked = selected.includes(object.id);
    return { control, node: el('label', { className: 'enterprise-reference-option' }, [control, el('span', { text: object.name })]) };
  });
  return { node: el('fieldset', { className: 'enterprise-reference-choices' }, [el('legend', { text: label }), ...controls.map(({ node }) => node)]), values: () => controls.filter(({ control }) => control.checked).map(({ control }) => control.value) };
}

function flowEditor({ model, object, el, ui, onCommand, onPreviewCommand, disabled, reasonValue = '' }) {
  const { field, form } = ui; const objects = allObjects(model);
  let invalidatePreview = () => {};
  const byType = (type) => objects.filter((entry) => entry.type === type);
  const reference = (name, label, type, value, optional = false) => field(name, label, { entries: [['', optional ? 'None specified' : 'Choose a saved record'], ...byType(type).map((entry) => [entry.id, entry.name])], value, required: !optional });
  const saved = object.processFlow;
  const defaults = [{ id: 'step-1', kind: 'manual', title: object.name, processId: object.id, roleId: object.owner ?? null, inputIds: [], outputIds: [], nextStepId: 'step-2', exceptionStepId: null }, { id: 'step-2', kind: 'end', title: 'End' }];
  const rows = []; const list = el('div', { className: 'enterprise-editor-rows', attrs: { 'data-enterprise-flow-steps': '' } });
  const targets = []; const starts = field('startStepId', 'Start step', { entries: [['', 'Choose a start step']], value: '', required: true });
  const stepOptions = (optional = false, predicate = () => true) => [[ '', optional ? 'Finish without another step' : 'Choose a step' ], ...rows.filter(predicate).map((row) => [row.id, row.title.control.value || `Step ${row.id}`])];
  const refresh = () => {
    replaceOptions(el, starts, stepOptions());
    for (const target of targets) replaceOptions(el, target.field, stepOptions(target.optional, target.predicate));
    const ordered = rows.map((row) => row.node);
    if (ordered.length !== list.children.length || ordered.some((node, index) => list.children[index] !== node)) list.replaceChildren(...ordered);
    for (const row of rows) { row.up.disabled = disabled || rows.indexOf(row) === 0; row.down.disabled = disabled || rows.indexOf(row) === rows.length - 1; }
  };
  const target = (name, label, value, optional = false, predicate = () => true) => {
    const result = field(name, label, { entries: stepOptions(optional, predicate), value, required: !optional });
    targets.push({ field: result, optional, predicate, initialValue: value }); return result;
  };
  function addStep(step) {
    const title = field('title', 'Step title', { value: step.title ?? '', maximum: 120 });
    const kind = field('kind', 'Step kind', { entries: STEP_KINDS, value: step.kind ?? 'manual' });
    const body = el('div', { className: 'enterprise-step-fields' });
    const row = { id: step.id, title, kind, node: el('section', { className: 'enterprise-editor-row', attrs: { 'data-enterprise-flow-step': step.id } }, [title.node, kind.node, body]), read: () => ({}) };
    const move = (direction) => { const index = rows.indexOf(row); const next = index + direction; if (next < 0 || next >= rows.length) return; invalidatePreview(); rows.splice(index, 1); rows.splice(next, 0, row); refresh(); row.title.control.focus?.(); };
    row.up = action(el, 'Move step earlier', () => move(-1), disabled); row.down = action(el, 'Move step later', () => move(1), disabled);
    const remove = action(el, 'Remove step', () => { invalidatePreview(); const index = rows.indexOf(row); rows.splice(index, 1); refresh(); (rows[index]?.title.control ?? rows[index - 1]?.title.control ?? starts.control).focus?.(); }, disabled);
    row.node.append(el('div', { className: 'enterprise-row-actions' }, [row.up, row.down, remove]), el('details', {}, [el('summary', { text: 'Stable step identity' }), el('p', { text: step.id })]));
    function renderKind(value) {
      // Drop references owned by the replaced row body before rebuilding its typed fields.
      for (let index = targets.length - 1; index >= 0; index -= 1) if (body.contains(targets[index].field.node)) targets.splice(index, 1);
      body.replaceChildren(); const selectedKind = kind.control.value;
      if (['manual', 'manual-exception'].includes(selectedKind)) {
        const process = reference('processId', 'Canonical activity process', 'process', value.processId ?? object.id);
        const role = reference('roleId', 'Proposed responsible role', 'role', value.roleId, true);
        const inputs = referenceChecks(el, byType('information'), value.inputIds ?? [], 'inputIds', 'Information consumed');
        const outputs = referenceChecks(el, byType('information'), value.outputIds ?? [], 'outputIds', 'Information produced');
        const next = target('nextStepId', 'Next step after success', value.nextStepId);
        const exception = target('exceptionStepId', 'Exception step after failure', value.exceptionStepId, true, (entry) => entry.kind.control.value === 'manual-exception');
        body.append(process.node, role.node, inputs.node, outputs.node, next.node, exception.node);
        row.read = () => ({ processId: process.control.value, roleId: role.control.value || null, inputIds: inputs.values(), outputIds: outputs.values(), nextStepId: next.control.value || null, exceptionStepId: exception.control.value || null });
      } else if (selectedKind === 'decision') {
        const decision = reference('decisionId', 'Canonical decision table', 'decision', value.decisionId);
        const routes = []; const routeList = el('div', { className: 'enterprise-editor-rows' });
        const choices = () => [['', 'Choose a declared outcome'], ...outcomesFor(objects.find((entry) => entry.id === decision.control.value)).map((outcome) => [outcome, outcome])];
        const addRoute = (savedRoute = {}) => {
          const outcome = field('outcome', 'Decision outcome', { entries: choices(), value: savedRoute.outcome });
          const destination = target('targetStepId', 'Route to step', savedRoute.targetStepId);
          const node = el('div', { className: 'enterprise-editor-row' }, [outcome.node, destination.node]); const route = { outcome, destination, node };
          node.append(action(el, 'Remove route', () => { invalidatePreview(); routes.splice(routes.indexOf(route), 1); node.remove(); }, disabled)); routes.push(route); routeList.append(node); disable(node, disabled);
        };
        for (const route of value.routes ?? [{}]) addRoute(route);
        decision.control.addEventListener('change', () => routes.forEach((route) => replaceOptions(el, route.outcome, choices())));
        body.append(decision.node, routeList, action(el, 'Add outcome route', () => { if (routes.length < 20) { invalidatePreview(); addRoute(); } }, disabled));
        row.read = () => ({ decisionId: decision.control.value, routes: routes.map(({ outcome, destination }) => ({ outcome: outcome.control.value, targetStepId: destination.control.value })) });
      } else if (selectedKind === 'fork') {
        const branches = []; const branchList = el('div', { className: 'enterprise-editor-rows' });
        const addBranch = (id = '') => { const entry = target('branchStepIds', 'Parallel branch starts at', id); const node = el('div', {}, [entry.node]); node.append(action(el, 'Remove parallel branch', () => { invalidatePreview(); branches.splice(branches.indexOf(entry), 1); node.remove(); }, disabled)); branches.push(entry); branchList.append(node); disable(node, disabled); };
        for (const id of value.branchStepIds ?? ['', '']) addBranch(id);
        const join = target('joinStepId', 'Matching join step', value.joinStepId, false, (entry) => entry.kind.control.value === 'join');
        body.append(branchList, action(el, 'Add parallel branch (up to four)', () => { if (branches.length < 4) { invalidatePreview(); addBranch(); } }, disabled), join.node);
        row.read = () => ({ branchStepIds: branches.map((entry) => entry.control.value), joinStepId: join.control.value });
      } else if (selectedKind === 'join') {
        const fork = target('forkStepId', 'Matching fork step', value.forkStepId, false, (entry) => entry.kind.control.value === 'fork');
        const mode = field('mode', 'Join policy', { entries: [['ALL', 'Wait for every parallel branch'], ['ANY', 'Continue after any parallel branch']], value: value.mode ?? 'ALL' });
        const next = target('nextStepId', 'Next step', value.nextStepId); body.append(fork.node, mode.node, next.node);
        row.read = () => ({ forkStepId: fork.control.value, mode: mode.control.value, nextStepId: next.control.value || null });
      } else if (selectedKind === 'loop') {
        const decision = reference('decisionId', 'Loop continuation decision', 'decision', value.decisionId);
        const choices = () => [['', 'Choose a declared outcome'], ...outcomesFor(objects.find((entry) => entry.id === decision.control.value)).map((outcome) => [outcome, outcome])];
        const continuation = field('continueOutcome', 'Outcome that continues the loop', { entries: choices(), value: value.continueOutcome });
        decision.control.addEventListener('change', () => replaceOptions(el, continuation, choices()));
        const start = target('bodyStepId', 'Loop body starts at', value.bodyStepId); const exit = target('exitStepId', 'Exit step', value.exitStepId);
        const maximum = field('maxIterations', 'Maximum iterations (1 to 10)', { type: 'number', value: String(value.maxIterations ?? 3) }); maximum.control.min = '1'; maximum.control.max = '10'; maximum.control.step = '1';
        body.append(decision.node, continuation.node, start.node, exit.node, maximum.node);
        row.read = () => ({ decisionId: decision.control.value, continueOutcome: continuation.control.value, bodyStepId: start.control.value, exitStepId: exit.control.value, maxIterations: Number(maximum.control.value) });
      } else if (selectedKind === 'loop-return') {
        const loop = target('loopStepId', 'Return to bounded loop', value.loopStepId, false, (entry) => entry.kind.control.value === 'loop'); body.append(loop.node); row.read = () => ({ loopStepId: loop.control.value });
      } else if (selectedKind === 'sandbox-procurement') {
        const resources = byType('resource').filter((entry) => entry.resourcePlan?.windows?.length);
        const resource = field('resourceId', 'Saved capacity resource', { entries: [['', 'Choose a saved resource plan'], ...resources.map((entry) => [entry.id, entry.name])], value: value.resourceId });
        const window = field('windowId', 'Committed capacity window', { entries: [['', 'Choose a window']], value: value.windowId });
        const allocation = field('allocationId', 'Human-reported committed allocation', { entries: [['', 'Choose a committed allocation']], value: value.allocationId });
        const windowsFor = () => resources.find((entry) => entry.id === resource.control.value)?.resourcePlan?.windows ?? [];
        const allocationsFor = () => windowsFor().find((entry) => entry.id === window.control.value)?.allocations
          ?.filter((entry) => entry.processId === object.id && entry.state === 'COMMITTED_REPORTED') ?? [];
        const refreshCommitments = () => {
          const previousWindow = window.control.value; const windowEntries = [['', 'Choose a window'], ...windowsFor().map((entry) => [entry.id, `${entry.window.start} → ${entry.window.end}`])];
          replaceOptions(el, window, windowEntries); window.control.value = windowEntries.some(([id]) => id === previousWindow) ? previousWindow : '';
          const previousAllocation = allocation.control.value; const allocationEntries = [['', 'Choose a committed allocation'], ...allocationsFor().map((entry) => [entry.id, `${entry.id} · ${entry.quantity.value ?? 'unknown'} ${entry.quantity.unit}`])];
          replaceOptions(el, allocation, allocationEntries); allocation.control.value = allocationEntries.some(([id]) => id === previousAllocation) ? previousAllocation : '';
        };
        resource.control.addEventListener('change', refreshCommitments); window.control.addEventListener('change', refreshCommitments); refreshCommitments();
        const next = target('nextStepId', 'Next step after owner-approved sandbox effect', value.nextStepId);
        const compensable = el('input', { attrs: { type: 'checkbox', name: `compensable-${row.id}` } }); compensable.checked = value.compensable === true;
        body.append(el('p', { text: 'This declares a local procurement test effect against one saved committed allocation. Owner approval first saves the exact request; a separate action dispatches it to the local test harness and may require reconciliation. No external connector, payment, supplier, legal or physical action is called.' }), resource.node, window.node, allocation.node, next.node,
          el('label', {}, [compensable, el('span', { text: 'This local test step is explicitly reversible and may be compensated after a paired step fails' })]));
        row.read = () => ({ resourceId: resource.control.value, windowId: window.control.value, allocationId: allocation.control.value, nextStepId: next.control.value, compensable: compensable.checked });
      } else row.read = () => ({});
      disable(body, disabled); refresh();
    }
    rows.push(row); renderKind(step); kind.control.addEventListener('change', () => renderKind({})); title.control.addEventListener('input', refresh); return row;
  }
  for (const step of saved?.steps ?? defaults) addStep(step);
  refresh();
  for (const descriptor of targets) descriptor.field.control.value = descriptor.initialValue ?? '';
  starts.control.value = saved?.startStepId ?? rows[0]?.id ?? '';
  const reason = field('reason', 'Reason for this flow design', { multiline: true, maximum: 500, value: reasonValue });
  let previewKey = null; let previewPanel = null; let previewRequestId = 0; let previewPending = false;
  const editor = form('define-process-flow', 'Preview process-flow impact', [el('p', { text: 'Activities, decision routes, exceptions, paired parallel forks and joins, one bounded loop, and local sandbox procurement test effects are proposed design. Sandbox effects require an exact committed capacity allocation and explicit project-owner approval; no external provider is contacted. Every step must be reachable. Local step identities stay stable across revisions.' }), starts.node, list,
    action(el, 'Add step', () => { if (rows.length < 32) { invalidatePreview(); addStep({ id: nextId('step', rows.map((row) => row.id)), kind: 'manual', title: '' }); } }, disabled), reason.node], () => {
      if (!rows.length) throw new Error('Add at least one step.');
      const payload = { kind: 'define-process-flow', objectId: object.id,
        processFlow: { schemaVersion: '1.0', startStepId: starts.control.value,
          steps: rows.map((row) => ({ id: row.id, kind: row.kind.control.value, title: row.title.control.value.trim(), ...row.read() })) },
        reason: reason.control.value.trim() };
      const key = JSON.stringify(payload);
      if (previewKey === key) { onCommand(payload); return; }
      if (previewPending) return;
      previewPanel?.remove(); previewPanel = null; previewKey = null;
      const submit = [...editor.querySelectorAll('button')].find((button) => (button.getAttribute?.('type') ?? button.attrs?.type) === 'submit');
      const error = editor.querySelectorAll('[role]')[0];
      const requestId = ++previewRequestId; previewPending = true; submit.disabled = true;
      void Promise.resolve(onPreviewCommand?.(payload)).then((preview) => {
        if (requestId !== previewRequestId) return;
        const source = preview?.source; const context = model.context;
        if (preview?.status !== 'INCOMPLETE' || source?.projectVersion !== context.projectVersion
          || source?.blueprintId !== context.blueprintId || source?.blueprintVersion !== context.blueprintVersion
          || source?.snapshotHash !== context.snapshotHash
          || (context.branchId ? (source?.kind !== 'BRANCH_DRAFT' || source.branchId !== context.branchId || source.branchRevision !== context.branchRevision)
            : source?.kind !== 'MAIN_DESIGN')) {
          throw new Error('The exact current design could not be verified for this preview. Reload and try again.');
        }
        if (preview.dependencyTraversal?.status !== 'COMPUTED') {
          throw new Error('Reverse dependency traversal is incomplete; saving this process flow is blocked until the impact path is complete.');
        }
        previewKey = key; previewPanel = renderBlueprintImpactPreview(preview, el); editor.append(previewPanel);
        submit.textContent = 'Save typed process flow';
      }).catch((failure) => {
        if (requestId !== previewRequestId) return;
        error.textContent = failure?.message ?? 'Impact preview failed.'; error.hidden = false;
      }).finally(() => {
        if (requestId !== previewRequestId) return;
        previewPending = false; submit.disabled = Boolean(disabled);
      });
    }, disabled);
  const invalidate = () => {
    previewRequestId += 1; previewPending = false; previewPanel?.remove(); previewPanel = null; previewKey = null;
    const submit = [...editor.querySelectorAll('button')].find((button) => (button.getAttribute?.('type') ?? button.attrs?.type) === 'submit');
    if (submit) { submit.textContent = 'Preview process-flow impact'; submit.disabled = Boolean(disabled); }
    const error = editor.querySelectorAll('[role]')[0];
    if (error) { error.hidden = true; error.textContent = ''; }
  };
  invalidatePreview = invalidate;
  editor.addEventListener('input', invalidate); editor.addEventListener('change', invalidate);
  return editor;
}

function decisionEditor({ model, object, el, ui, onCommand, onPreviewCommand, disabled, reasonValue = '' }) {
  const { field, form } = ui; const information = allObjects(model).filter((entry) => entry.type === 'information');
  const saved = object.decisionTable; const inputs = []; const rules = []; const conditions = [];
  const inputList = el('div', { className: 'enterprise-editor-rows', attrs: { 'data-enterprise-decision-inputs': '' } });
  const ruleList = el('div', { className: 'enterprise-editor-rows', attrs: { 'data-enterprise-decision-rules': '' } });
  const policy = field('hitPolicy', 'Rule hit policy', { entries: [['FIRST_MATCH', 'First matching rule in order'], ['UNIQUE', 'Exactly one matching rule; overlapping matches conflict']], value: saved?.hitPolicy ?? 'UNIQUE' });
  const decisionMode = field('decisionMode', 'Decision enforcement', { entries: [['ADVISORY', 'Advisory · human may choose any declared outcome'], ['ENFORCED', 'Enforced · human choice must match the resolved table outcome']], value: saved?.decisionMode ?? 'ADVISORY' });
  const informationOptions = () => [['', 'Choose declared information input'], ...inputs.filter((input) => input.information.control.value).map((input) => [input.information.control.value, information.find((entry) => entry.id === input.information.control.value)?.name ?? 'Saved information'])];
  const refreshConditions = () => conditions.forEach((entry) => replaceOptions(el, entry.information, informationOptions()));
  const addInput = (input = {}) => {
    const reference = field('informationId', 'Canonical information input', { entries: [['', 'Choose information'], ...information.map((entry) => [entry.id, entry.name])], value: input.informationId });
    const type = field('valueType', 'Input value type', { entries: VALUE_TYPES, value: input.valueType ?? 'string' });
    const node = el('div', { className: 'enterprise-editor-row' }, [reference.node, type.node]); const entry = { information: reference, type, node };
    node.append(action(el, 'Remove input', () => { inputs.splice(inputs.indexOf(entry), 1); node.remove(); refreshConditions(); }, disabled)); inputs.push(entry); inputList.append(node);
    reference.control.addEventListener('change', refreshConditions); disable(node, disabled); refreshConditions();
  };
  for (const input of saved?.inputs ?? []) addInput(input);
  const addRule = (rule = {}) => {
    const rowConditions = []; const list = el('div', { className: 'enterprise-editor-rows' });
    const outcome = field('outcome', 'Outcome token', { value: rule.outcome ?? '', maximum: 60 });
    const id = rule.id ?? nextId('rule', rules.map((entry) => entry.id));
    const node = el('section', { className: 'enterprise-editor-row', attrs: { 'data-enterprise-decision-rule': id } }); const entry = { id, outcome, conditions: rowConditions, node };
    const addCondition = (condition = {}) => {
      const reference = field('informationId', 'Condition information input', { entries: informationOptions(), value: condition.informationId });
      const operator = field('operator', 'Condition', { entries: OPERATORS, value: condition.operator ?? 'eq' });
      const value = field('value', 'Match value (one per line for “is one of”; booleans are true or false)', { multiline: true, maximum: 2900, required: false, value: Array.isArray(condition.value) ? condition.value.join('\n') : condition.value == null ? '' : String(condition.value) });
      const panel = el('div', { className: 'enterprise-editor-row' }, [reference.node, operator.node, value.node]); const record = { information: reference, operator, value, node: panel };
      panel.append(action(el, 'Remove condition', () => { rowConditions.splice(rowConditions.indexOf(record), 1); conditions.splice(conditions.indexOf(record), 1); panel.remove(); }, disabled)); rowConditions.push(record); conditions.push(record); list.append(panel); disable(panel, disabled);
    };
    for (const condition of rule.conditions ?? [{}]) addCondition(condition);
    const move = (direction) => { const index = rules.indexOf(entry); const target = index + direction; if (target < 0 || target >= rules.length) return; rules.splice(index, 1); rules.splice(target, 0, entry); ruleList.replaceChildren(...rules.map((rule) => rule.node)); entry.outcome.control.focus?.(); };
    node.append(outcome.node, list, action(el, 'Add condition', () => { if (rowConditions.length < 12) addCondition(); }, disabled), el('div', { className: 'enterprise-row-actions' }, [action(el, 'Move rule earlier', () => move(-1), disabled), action(el, 'Move rule later', () => move(1), disabled), action(el, 'Remove rule', () => { rules.splice(rules.indexOf(entry), 1); for (const record of rowConditions) conditions.splice(conditions.indexOf(record), 1); node.remove(); }, disabled)]));
    rules.push(entry); ruleList.append(node); disable(node, disabled);
  };
  for (const rule of saved?.rules ?? []) addRule(rule);
  const defaultOutcome = field('defaultOutcome', 'Default outcome when no rule matches (optional)', { required: false, value: saved?.defaultOutcome ?? '', maximum: 60 });
  const reason = field('reason', 'Reason for this decision table', { multiline: true, maximum: 500, value: reasonValue });
  let previewKey = null;
  let previewPanel = null;
  let previewRequestId = 0;
  let previewPending = false;
  const submitButton = () => [...editor.querySelectorAll('button')]
    .find((button) => (button.getAttribute?.('type') ?? button.attrs?.type) === 'submit');
  const editor = form('define-decision-table', 'Preview decision-table impact', [el('p', { text: 'Rules use typed saved information records. All conditions in a rule must match. Each rule needs at least one condition; UNIQUE treats overlapping matches as a conflict. Enforcement mode is versioned with this saved table.' }), policy.node, decisionMode.node, inputList,
    action(el, 'Add information input', () => { if (inputs.length < 12) addInput(); }, disabled), ruleList, action(el, 'Add rule', () => { if (rules.length < 20) addRule(); }, disabled), defaultOutcome.node, reason.node], () => {
      if (!inputs.length || !rules.length || rules.some((rule) => !rule.conditions.length)) throw new Error('Declare at least one input, one rule and one condition per rule.');
      const types = new Map(inputs.map((input) => [input.information.control.value, input.type.control.value]));
      const payload = { kind: 'define-decision-table', objectId: object.id, decisionTable: { schemaVersion: '1.0', hitPolicy: policy.control.value,
        decisionMode: decisionMode.control.value,
        inputs: inputs.map((input) => ({ informationId: input.information.control.value, valueType: input.type.control.value })),
        rules: rules.map((rule) => ({ id: rule.id, outcome: rule.outcome.control.value.trim(), conditions: rule.conditions.map((condition) => ({ informationId: condition.information.control.value, operator: condition.operator.control.value, value: enterpriseTypedValue(types.get(condition.information.control.value), condition.value.control.value, condition.operator.control.value === 'in') })) })), defaultOutcome: defaultOutcome.control.value.trim() || null }, reason: reason.control.value.trim() };
      const key = JSON.stringify(payload);
      const save = () => onCommand(payload);
      if (previewKey === key) { save(); return; }
      if (previewPending) return;
      if (previewPanel) previewPanel.remove(); previewPanel = null; previewKey = null;
      const button = submitButton();
      const error = editor.querySelectorAll('[role]')[0];
      const requestId = ++previewRequestId;
      previewPending = true;
      button.disabled = true;
      void Promise.resolve(onPreviewCommand?.(payload)).then((preview) => {
        if (requestId !== previewRequestId) return;
        const source = preview?.source; const context = model.context;
        if (preview?.status !== 'INCOMPLETE' || source?.projectVersion !== context.projectVersion
          || source?.blueprintId !== context.blueprintId || source?.blueprintVersion !== context.blueprintVersion
          || source?.snapshotHash !== context.snapshotHash
          || (context.branchId ? (source?.kind !== 'BRANCH_DRAFT' || source.branchId !== context.branchId || source.branchRevision !== context.branchRevision)
            : source?.kind !== 'MAIN_DESIGN')) {
          throw new Error('The exact current design could not be verified for this preview. Reload and try again.');
        }
        previewKey = key;
        previewPanel = renderBlueprintImpactPreview(preview, el);
        editor.append(previewPanel);
        button.textContent = 'Save typed decision table';
      }).catch((failure) => {
        if (requestId !== previewRequestId) return;
        error.textContent = failure?.message ?? 'Impact preview failed.'; error.hidden = false;
      }).finally(() => {
        if (requestId !== previewRequestId) return;
        previewPending = false;
        button.disabled = Boolean(disabled);
      });
    }, disabled);
  const invalidate = () => {
    previewRequestId += 1;
    previewPending = false;
    if (previewPanel) previewPanel.remove(); previewPanel = null; previewKey = null;
    const button = submitButton();
    if (button) { button.textContent = 'Preview decision-table impact'; button.disabled = Boolean(disabled); }
    const error = editor.querySelectorAll('[role]')[0];
    if (error) { error.hidden = true; error.textContent = ''; }
  };
  editor.addEventListener('input', invalidate); editor.addEventListener('change', invalidate);
  return editor;
}

export function renderEnterpriseSimulation({ simulation, model, el }) {
  if (simulation.simulationType === 'STAFFING_CAPACITY') {
    const sourceObject = allObjects(model).find((object) => object.id === simulation.source?.processId);
    const matching = enterpriseSimulationSourceMatches(model, sourceObject, simulation);
    const processName = matching ? sourceObject?.name : simulation.sourceLabels?.records?.[simulation.source?.processId] ?? simulation.source?.processId;
    const root = el('section', { attrs: { 'data-enterprise-simulation-result': simulation.id, 'aria-label': 'Saved staffing capacity simulation comparison' } }, [
      el('h5', { text: `Staffing capacity · SIMULATED · ${simulation.assumptionStatus ?? 'UNVALIDATED ASSUMPTIONS'}` }),
      el('p', { text: `Saved hypothetical for ${processName} at ${simulation.createdAt} by ${simulation.createdBy}. Inputs are unvalidated assumptions; this does not establish actual staffing or verified operating performance.` }),
      el('p', { text: `Arrivals: ${simulation.scenario.arrivals.value} ${simulation.scenario.arrivals.unit} per ${simulation.scenario.interval.value} ${simulation.scenario.interval.unit}. Capacity per worker: ${simulation.scenario.capacityPerWorker.value} ${simulation.scenario.capacityPerWorker.unit} per interval.` }),
      el('p', { text: 'Worker-count changes compare hypothetical capacity only. No hiring, reservation, assignment, spending, or work occurs.' }),
    ]);
    const table = el('table', { attrs: { 'data-staffing-simulation-comparison': '' } }, [el('caption', { text: 'Simulated throughput and queue by worker count' })]);
    table.append(el('thead', {}, [el('tr', {}, ['Workers', 'Capacity', 'Throughput', 'Queued'].map((label) => el('th', { text: label, attrs: { scope: 'col' } })))]));
    const body = el('tbody');
    for (const comparison of simulation.comparisons ?? []) body.append(el('tr', { attrs: { 'data-worker-count': comparison.workers } }, [
      el('th', { text: String(comparison.workers), attrs: { scope: 'row' } }),
      el('td', { text: `${comparison.capacity} ${comparison.workUnit}` }),
      el('td', { text: `${comparison.throughput} ${comparison.workUnit}` }),
      el('td', { text: `${comparison.queue} ${comparison.workUnit}` }),
    ]));
    table.append(body); root.append(table);
    root.append(el('details', {}, [el('summary', { text: 'Exact simulation source and result identity' }),
      el('p', { text: `Blueprint ${simulation.source?.blueprintId} · version ${simulation.source?.blueprintVersion} · process ${simulation.source?.processId} · snapshot ${simulation.source?.snapshotHash} · engine ${simulation.engineVersion} · scenario ${simulation.scenarioHash} · result ${simulation.resultHash}` })]));
    return root;
  }
  const labels = { COMPLETED: 'Simulation completed', BLOCKED: 'Simulation blocked by missing inputs or scripted results', UNKNOWN: 'Simulation evidence unknown', CONFLICTED: 'Conflicting decision rules', LIMIT_REACHED: 'Simulation step limit reached', FAILED: 'Scripted activity failed' };
  const sourceObject = allObjects(model).find((object) => object.id === simulation.source?.processId);
  const matching = enterpriseSimulationMatches(model, sourceObject, simulation);
  const names = matching ? new Map(allObjects(model).map((object) => [object.id, object.name])) : new Map(Object.entries(simulation.sourceLabels?.records ?? {}));
  const steps = matching ? new Map((sourceObject?.processFlow?.steps ?? []).map((step) => [step.id, step.title])) : new Map(Object.entries(simulation.sourceLabels?.steps ?? {}));
  const root = el('section', { attrs: { 'data-enterprise-simulation-result': simulation.id, 'aria-label': 'Exact saved process simulation result' } }, [el('h5', { text: labels[simulation.status] ?? `Simulation status: ${simulation.status ?? 'unknown'}` }),
    el('p', { text: `Saved ${simulation.createdAt} by ${simulation.createdBy}. This is a deterministic simulation of scripted inputs and outcomes; it does not complete human work or verify operating results.` }),
  ]);
  for (const input of simulation.scenario?.inputs ?? []) root.append(el('p', { text: `Input ${names.get(input.informationId) ?? input.informationId}: ${String(input.value)}` }));
  for (const unresolved of simulation.unresolved ?? []) root.append(el('p', { text: typeof unresolved === 'string' ? unresolved : unresolved.message ?? unresolved.detail ?? `${unresolved.code ?? unresolved.status ?? 'Unknown'}: ${steps.get(unresolved.stepId) ?? names.get(unresolved.informationId) ?? 'saved scenario evidence'}`, attrs: { role: 'status' } }));
  const trace = el('ol', { attrs: { 'data-enterprise-simulation-trace': '' } });
  for (const entry of simulation.trace ?? []) {
    const item = el('li', { text: `${steps.get(entry.stepId) ?? entry.stepId ?? 'Flow'} · iteration ${entry.iteration ?? 0} · ${entry.status}: ${entry.detail ?? ''}` });
    if (Object.hasOwn(entry, 'outcome')) item.append(el('p', { text: `Simulated decision outcome: ${entry.outcome ?? 'unknown'}` }));
    if (entry.evaluation) {
      const evaluation = el('details', {}, [el('summary', { text: `Saved decision rule evaluation: ${entry.evaluation.status}` })]);
      for (const rule of entry.evaluation.rules ?? []) {
        const row = el('section', {}, [el('p', { text: `Rule ${rule.id} → ${rule.outcome}: ${rule.status}` })]);
        for (const condition of rule.conditions ?? []) row.append(el('p', { text: `${names.get(condition.informationId) ?? condition.informationId} ${OPERATORS.find(([operator]) => operator === condition.operator)?.[1] ?? condition.operator} ${Array.isArray(condition.value) ? condition.value.join(', ') : String(condition.value)} · actual ${condition.actual == null ? 'unknown' : String(condition.actual)} · ${condition.status}` }));
        evaluation.append(row);
      }
      item.append(evaluation);
    }
    trace.append(item);
  }
  root.append(trace, el('details', {}, [el('summary', { text: 'Exact simulation source and deterministic result identity' }), el('p', { text: `Blueprint ${simulation.source?.blueprintId} · version ${simulation.source?.blueprintVersion} · process ${simulation.source?.processId} · snapshot ${simulation.source?.snapshotHash} · engine ${simulation.engineVersion} · scenario ${simulation.scenarioHash} · result ${simulation.resultHash}` })]));
  return root;
}

function staffingSimulationEditor({ model, object, el, ui, onCommand, disabled, scenario = null, reasonValue = '' }) {
  const { field, form } = ui;
  const arrivals = field('arrivals', 'Expected arrivals per interval (whole number)', { type: 'number', min: '0', max: '1000000', value: String(scenario?.arrivals?.value ?? 12) });
  const intervalValue = field('intervalValue', 'Interval length (positive whole number)', { type: 'number', min: '1', max: '10000', value: String(scenario?.interval?.value ?? 1) });
  const intervalUnit = field('intervalUnit', 'Interval unit', { entries: [['minutes', 'Minutes'], ['hours', 'Hours'], ['days', 'Days'], ['weeks', 'Weeks']], value: scenario?.interval?.unit ?? 'hours' });
  const capacity = field('capacityPerWorker', 'Capacity per worker per interval (whole number)', { type: 'number', min: '0', max: '1000000', value: String(scenario?.capacityPerWorker?.value ?? 8) });
  const workUnit = field('workUnit', 'Work unit for arrivals and capacity', { entries: [['cases', 'Cases'], ['customers', 'Customers'], ['orders', 'Orders'], ['requests', 'Requests'], ['tasks', 'Tasks'], ['tickets', 'Tickets'], ['units', 'Units']], value: scenario?.arrivals?.unit ?? 'requests' });
  for (const control of [arrivals.control, capacity.control]) { control.min = '0'; control.max = '1000000'; control.step = '1'; }
  intervalValue.control.min = '1'; intervalValue.control.max = '10000'; intervalValue.control.step = '1';
  const counts = []; const rows = el('div', { className: 'enterprise-editor-rows', attrs: { 'data-staffing-worker-counts': '' } });
  const addWorkerCount = (value = 1) => {
    const workerCount = field('workerCount', 'Worker count to compare (1 to 100)', { type: 'number', min: '1', max: '100', value: String(value) });
    workerCount.control.min = '1'; workerCount.control.max = '100'; workerCount.control.step = '1';
    const row = el('div', { className: 'enterprise-editor-row' }, [workerCount.node]);
    const entry = { workerCount, row }; counts.push(entry);
    const remove = action(el, 'Remove worker-count comparison', () => { counts.splice(counts.indexOf(entry), 1); row.remove();
      counts.forEach((item) => { item.remove.disabled = disabled || counts.length <= 1; }); }, disabled || counts.length <= 1);
    entry.remove = remove; row.append(remove);
    counts.forEach((item) => { item.remove.disabled = disabled || counts.length <= 1; });
    rows.append(row); disable(row, disabled);
  };
  for (const value of scenario?.workerCounts ?? [1, 2]) addWorkerCount(value);
  const reason = field('reason', 'Scenario purpose', { multiline: true, maximum: 500, value: reasonValue });
  return form('simulate-staffing', 'Compare staffing capacity', [el('p', { text: 'Enter arrivals and capacity for the same interval. This deterministic forecast uses unvalidated assumptions and never hires staff, reserves capacity, or starts work.' }),
    arrivals.node, intervalValue.node, intervalUnit.node, capacity.node, workUnit.node, rows,
    action(el, 'Add worker count to comparison', () => { if (counts.length < 100) addWorkerCount(1); }, disabled || counts.length >= 100), reason.node], () => {
      onCommand({ kind: 'simulate-staffing', processId: object.id, scenario: { schemaVersion: '1.0',
        arrivals: { value: Number(arrivals.control.value), unit: workUnit.control.value },
        interval: { value: Number(intervalValue.control.value), unit: intervalUnit.control.value },
        capacityPerWorker: { value: Number(capacity.control.value), unit: workUnit.control.value },
        workerCounts: counts.map(({ workerCount }) => Number(workerCount.control.value)) }, reason: reason.control.value.trim() });
    }, disabled || !model.permissions?.simulate);
}

function simulationEditor({ model, object, el, ui, onCommand, disabled, scenario = null, reasonValue = '' }) {
  const { field, form } = ui; const objects = allObjects(model); const steps = object.processFlow?.steps ?? [];
  const decisionIds = new Set(steps.map((step) => step.decisionId).filter(Boolean));
  const tableInputs = objects.filter((entry) => decisionIds.has(entry.id)).flatMap((entry) => entry.decisionTable?.inputs ?? []);
  const usedIds = new Set([...tableInputs.map((entry) => entry.informationId), ...steps.flatMap((step) => [...(step.inputIds ?? []), ...(step.outputIds ?? [])])]);
  const inputs = []; const inputList = el('div', { className: 'enterprise-editor-rows' });
  const information = objects.filter((entry) => entry.type === 'information' && usedIds.has(entry.id));
  const addInput = (savedInput = {}) => {
    const reference = field('informationId', 'Scenario information record', { entries: [['', 'Choose flow information'], ...information.map((entry) => [entry.id, entry.name])], value: savedInput.informationId });
    const known = field('known', 'Scripted input knowledge', { entries: [['known', 'Known value'], ['unknown', 'Explicitly unknown value']], value: savedInput.value === null ? 'unknown' : 'known' });
    const value = field('value', 'Scripted value (typed numbers; booleans are true or false)', { maximum: 240, required: false, value: savedInput.value == null ? '' : String(savedInput.value) });
    const node = el('div', { className: 'enterprise-editor-row' }, [reference.node, known.node, value.node]); const entry = { reference, known, value, node }; inputs.push(entry);
    const updateKnowledge = () => { value.control.disabled = disabled || known.control.value === 'unknown'; };
    known.control.addEventListener('change', updateKnowledge); updateKnowledge();
    node.append(action(el, 'Remove scenario input', () => { inputs.splice(inputs.indexOf(entry), 1); node.remove(); }, disabled)); inputList.append(node); disable(node, disabled);
  };
  for (const input of scenario?.inputs ?? []) addInput(input);
  const results = []; const resultList = el('div', { className: 'enterprise-editor-rows' });
  const manualSteps = steps.filter((step) => ['manual', 'manual-exception'].includes(step.kind));
  const choices = []; const choiceList = el('div', { className: 'enterprise-editor-rows' });
  const decisionSteps = steps.filter((step) => ['decision', 'loop'].includes(step.kind));
  const addScript = (rows, list, available, isDecision, savedScript = {}) => {
    const step = field('stepId', 'Scenario step', { entries: [['', 'Choose a saved step'], ...available.map((entry) => [entry.id, entry.title])], value: savedScript.stepId });
    const iteration = field('iteration', 'Iteration (0 outside a loop; 1 to 10 inside)', { type: 'number', value: String(savedScript.iteration ?? 0) }); iteration.control.min = '0'; iteration.control.max = '10'; iteration.control.step = '1';
    const outcomeChoices = () => [['', 'Choose scripted outcome'], ...(isDecision ? [['@unknown', 'Explicitly unknown choice'], ...outcomesFor(objects.find((entry) => entry.id === steps.find((entry) => entry.id === step.control.value)?.decisionId)).map((outcome) => [outcome, outcome])] : [['SUCCEEDED', 'Succeeded'], ['FAILED', 'Failed'], ['UNKNOWN', 'Explicitly unknown']])];
    const outcome = field('outcome', isDecision ? 'Explicit simulated decision choice' : 'Scripted manual outcome', { entries: outcomeChoices(), value: isDecision && savedScript.outcome === null ? '@unknown' : savedScript.outcome });
    if (isDecision) step.control.addEventListener('change', () => replaceOptions(el, outcome, outcomeChoices()));
    const node = el('div', { className: 'enterprise-editor-row' }, [step.node, iteration.node, outcome.node]); const row = { step, iteration, outcome, node }; rows.push(row);
    node.append(action(el, 'Remove scripted result', () => { rows.splice(rows.indexOf(row), 1); node.remove(); }, disabled)); list.append(node); disable(node, disabled);
  };
  for (const script of scenario?.activityOutcomes ?? []) addScript(results, resultList, manualSteps, false, script);
  for (const script of scenario?.decisionChoices ?? []) addScript(choices, choiceList, decisionSteps, true, script);
  const limit = field('stepLimit', 'Maximum simulation steps (1 to 200)', { type: 'number', value: String(scenario?.stepLimit ?? 100) }); limit.control.min = '1'; limit.control.max = '200'; limit.control.step = '1';
  const reason = field('reason', 'Scenario purpose', { multiline: true, maximum: 500, value: reasonValue });
  return form('simulate-process', 'Simulate exact saved process flow', [el('p', { text: 'Leave missing values or activity results absent to see where the flow is blocked. Scripted decision choices are hypothetical inputs. Simulation never starts work, approves a decision or applies a design.' }), inputList,
    action(el, 'Add scripted information value', () => { if (inputs.length < 100) addInput(); }, disabled), resultList, action(el, 'Add scripted activity outcome', () => { if (results.length < 200) addScript(results, resultList, manualSteps, false); }, disabled), choiceList,
    action(el, 'Add explicit simulated decision choice', () => { if (choices.length < 100) addScript(choices, choiceList, decisionSteps, true); }, disabled), limit.node, reason.node], () => {
      const script = (rows) => rows.map(({ step, iteration, outcome }) => ({ stepId: step.control.value, iteration: Number(iteration.control.value), outcome: outcome.control.value === '@unknown' ? null : outcome.control.value }));
      onCommand({ kind: 'simulate-process', processId: object.id, scenario: { inputs: inputs.map(({ reference, known, value }) => ({ informationId: reference.control.value, value: known.control.value === 'unknown' ? null : enterpriseTypedValue(tableInputs.find((entry) => entry.informationId === reference.control.value)?.valueType ?? 'string', value.control.value) })), activityOutcomes: script(results), decisionChoices: script(choices), stepLimit: Number(limit.control.value) }, reason: reason.control.value.trim() });
    }, disabled || !object.processFlow);
}

export function renderEnterpriseProcess({ model, object, pending = null, loading = false, simulation = null, draft = null, selectedSimulationId = null, el, ui, onCommand, onPreviewCommand, onInspectDraft, onSimulationSelection, onInspectSimulation }) {
  if (!['process', 'decision'].includes(object.type)) return null;
  const root = el('section', { attrs: { 'data-enterprise-process-model': object.id, 'aria-label': object.type === 'process' ? 'Typed process authoring and simulation' : 'Typed decision table authoring' } });
  const disabled = loading || Boolean(pending) || !enterpriseProcessWritable(model);
  const retained = enterpriseProcessDraftMatches(model, object, draft) ? draft : null;
  if (draft && !retained && (draft.objectId ?? draft.processId) === object.id) {
    const earlier = el('section', { attrs: { 'data-enterprise-retained-process-draft': '', role: 'status' } }, [el('p', { text: `The unsaved submitted draft is retained from saved source version ${draft.blueprintVersion}${draft.branchId ? `, branch revision ${draft.branchRevision}` : ''}. It has not been rebased onto this displayed source.` })]);
    if (onInspectDraft) earlier.append(action(el, 'Inspect original source and retained draft', () => onInspectDraft({ lensId: 'all', scopeId: null, blueprintVersion: draft.branchId || draft.proposalId ? null : draft.blueprintVersion, branchId: draft.branchId ?? null, branchRevision: draft.branchRevision ?? null, proposalId: draft.proposalId ?? null, effectiveAt: null, recordedAt: null }, draft.objectId ?? draft.processId), loading || Boolean(pending)));
    root.append(earlier);
  }
  const edited = retained?.kind === 'define-process-flow' ? { ...object, processFlow: retained.processFlow } : retained?.kind === 'define-decision-table' ? { ...object, decisionTable: retained.decisionTable } : object;
  if (object.type === 'decision') root.append(el('details', { attrs: retained?.kind === 'define-decision-table' ? { open: '' } : {} }, [el('summary', { text: 'Author a typed decision table' }), decisionEditor({ model, object: edited, el, ui, onCommand, onPreviewCommand, disabled, reasonValue: retained?.kind === 'define-decision-table' ? retained.reason : '' })]));
  else {
    root.append(el('details', { attrs: retained?.kind === 'define-process-flow' ? { open: '' } : {} }, [el('summary', { text: 'Author a typed process flow' }), flowEditor({ model, object: edited, el, ui, onCommand, onPreviewCommand, disabled, reasonValue: retained?.kind === 'define-process-flow' ? retained.reason : '' })]));
    if (!object.processFlow) root.append(el('p', { text: 'Save a typed process flow before simulating it. Existing simple planning graphs remain available in Execution.' }));
    root.append(el('details', { attrs: retained?.kind === 'simulate-process' ? { open: '' } : {} }, [el('summary', { text: 'Simulate this exact saved flow' }), simulationEditor({ model, object, el, ui, onCommand, disabled: loading || Boolean(pending) || !model.permissions?.simulate, scenario: retained?.kind === 'simulate-process' ? retained.scenario : null, reasonValue: retained?.kind === 'simulate-process' ? retained.reason : '' })]));
    root.append(el('details', { attrs: retained?.kind === 'simulate-staffing' ? { open: '' } : {} }, [el('summary', { text: 'Simulate staffing capacity' }), staffingSimulationEditor({ model, object, el, ui, onCommand, disabled: loading || Boolean(pending), scenario: retained?.kind === 'simulate-staffing' ? retained.scenario : null, reasonValue: retained?.kind === 'simulate-staffing' ? retained.reason : '' })]));
    if (object.processFlow) root.append(el('p', { text: 'Authored advanced flows can be designed and simulated here. Real manual routing for these flows is not available yet; the legacy planning graph cannot start them.' }));
    const sandboxSteps = (object.processFlow?.steps ?? []).filter((step) => step.kind === 'sandbox-procurement');
    for (const step of sandboxSteps) {
      const resource = allObjects(model).find((entry) => entry.id === step.resourceId);
      const window = resource?.resourcePlan?.windows?.find((entry) => entry.id === step.windowId);
      const allocation = window?.allocations?.find((entry) => entry.id === step.allocationId);
      const quantity = allocation?.quantity; const available = window?.available; const capacity = window?.capacity;
      const capacityReady = Boolean(allocation?.state === 'COMMITTED_REPORTED' && Number.isFinite(quantity?.value) && quantity.value > 0
        && Number.isFinite(available?.value) && available.value >= quantity.value && Number.isFinite(capacity?.value)
        && capacity.value >= available.value && quantity.unit === available.unit && available.unit === capacity.unit);
      const existingTransaction = (model.sandboxTransactions ?? []).find((entry) => entry.source?.processId === object.id && entry.source?.stepId === step.id
        && entry.source?.blueprintId === model.context.blueprintId && entry.source?.blueprintVersion === model.context.blueprintVersion);
      const button = action(el, `Approve local sandbox effect · ${step.title}`, () => onCommand({ kind: 'run-sandbox-procurement-test', processId: object.id, stepId: step.id,
        reason: `Approve one local sandbox test effect using committed allocation ${step.allocationId}.` }), !model.permissions?.sandboxExecute || loading || Boolean(pending) || !capacityReady || Boolean(existingTransaction));
      root.append(el('section', { attrs: { 'data-sandbox-transaction-intent': step.id } }, [el('h5', { text: `Sandbox procurement · ${step.title}` }),
        el('p', { text: `${resource?.name ?? step.resourceId} · ${step.windowId} · ${quantity?.value ?? 'unknown'} ${quantity?.unit ?? ''} · ${allocation?.state ?? 'allocation unavailable'} · ${capacityReady ? 'reported capacity is sufficient' : 'capacity is unknown or insufficient; update the saved commitment/capacity before approval'}. Owner approval records a local sandbox operation only; it does not call a supplier or external provider.` }), button]));
    }
    const sandboxRecords = (model.sandboxTransactions ?? []).filter((entry) => entry.source?.processId === object.id);
    if (sandboxRecords.length) {
      const list = el('section', { attrs: { 'data-sandbox-transaction-history': object.id } }, [el('h5', { text: 'Saved sandbox test effects' })]);
      for (const record of sandboxRecords) {
        const isCurrent = record.source.blueprintId === model.context.blueprintId && record.source.blueprintVersion === model.context.blueprintVersion
          && record.source.blueprintHash === model.context.snapshotHash;
        const groupLabel = record.group ? ` · two-step group ${record.group.id} · step ${record.group.sequence} of ${record.group.total}` : '';
        const article = el('article', {}, [el('strong', { text: `${record.status}${record.status === 'FAILED_IN_SANDBOX' ? ' · partial group failure' : ''} · ${isCurrent ? 'current source' : 'historical source'} · ${record.operationId}${groupLabel}` }),
          el('p', { text: `${record.label} · ${record.commitment.quantity.value} ${record.commitment.quantity.unit} · owner approval ${record.approval.at}` }),
          el('p', { text: `Stable local key: ${record.providerKey} · evidence ${record.evidenceHash}` }),
          el('p', { text: record.status === 'UNKNOWN_EFFECT'
            ? `The outcome is unknown. Reconcile this provider key before any retry or compensation. ${record.adapterId === 'orgward.loopback-sandbox.procurement-test/v1' ? 'Loopback test service only; no third-party provider or live transaction was used.' : 'In-process harness only; no external service/provider was called.'}`
            : record.status === 'APPROVED_PENDING' ? `Approval is saved; dispatch has not been confirmed. ${record.adapterId === 'orgward.loopback-sandbox.procurement-test/v1' ? 'Loopback test service only; no third-party provider or live transaction was used.' : 'In-process harness only; no external service/provider was called.'}`
              : record.effect?.externalServiceCalled ? 'A separate loopback sandbox service recorded this test effect and its durable receipt. No third-party provider or live commercial transaction was used.'
                : 'Local sandbox record only. No external provider was called. The in-process harness made no external service call.' })]);
        const providerEvidence = record.effect?.adapterResponse?.result?.providerEvidence;
        if (providerEvidence) article.append(el('p', { text: `Loopback service receipt: ${providerEvidence.receiptId} · evidence ${providerEvidence.evidenceHash}` }));
        if (record.compensatesOperationId) article.append(el('p', { text: `Separate compensation record linked to ${record.compensatesOperationId}. Original result remains in history; this is not an atomic rollback.` }));
        if (record.status === 'APPROVED_PENDING') article.append(action(el, 'Dispatch approved local test effect', () => onCommand({
          kind: 'dispatch-sandbox-procurement-test', operationId: record.operationId, reason: 'Dispatch the already approved local sandbox request once by its stable provider key.',
        }), !model.permissions?.sandboxExecute || loading || Boolean(pending)));
        if (record.status === 'UNKNOWN_EFFECT') article.append(action(el, 'Reconcile by provider key', () => onCommand({
          kind: 'reconcile-sandbox-procurement-test', operationId: record.operationId, reason: 'Reconcile the unknown local sandbox outcome by its stable provider key before any retry.',
        }), !model.permissions?.sandboxExecute || loading || Boolean(pending)));
        const peerFailed = record.group && sandboxRecords.some((entry) => entry.group?.id === record.group.id
          && entry.operationId !== record.operationId && entry.status === 'FAILED_IN_SANDBOX');
        const compensationExists = sandboxRecords.some((entry) => entry.compensatesOperationId === record.operationId);
        if (record.kind === 'PROCUREMENT_TEST_EFFECT' && record.status === 'RECORDED_IN_SANDBOX' && record.compensable && peerFailed && !compensationExists) {
          article.append(action(el, 'Approve separate local compensation', () => onCommand({
            kind: 'compensate-sandbox-procurement-test', operationId: record.operationId,
            reason: `Approve a separate local compensation for completed operation ${record.operationId} after paired-step failure.`,
          }), !model.permissions?.sandboxExecute || loading || Boolean(pending)));
        }
        list.append(article);
      }
      root.append(list);
    }
    if (enterpriseSimulationSourceMatches(model, object, simulation) && !enterpriseSimulationMatches(model, object, simulation)) {
      root.append(el('p', { text: 'The simulation was saved after this recorded-time cutoff. Its result is excluded from this dated view.', attrs: { role: 'status' } }));
      if (onInspectSimulation) root.append(action(el, 'Inspect saved simulation at its original source', () => onInspectSimulation(simulation), loading || Boolean(pending)));
    }
    if (selectedSimulationId && model.simulation && !enterpriseSimulationSourceMatches(model, object, model.simulation)) {
      root.append(el('p', { text: 'The requested simulation belongs to another exact saved source. Its trace is not attached to this displayed design.', attrs: { role: 'status' } }));
      if (onInspectSimulation) root.append(action(el, 'Inspect requested simulation at its saved source', () => onInspectSimulation(model.simulation), loading || Boolean(pending)));
    }
    const savedRecords = (model.simulations ?? []).filter((record) => enterpriseSimulationMatches(model, object, record));
    if (enterpriseSimulationMatches(model, object, simulation) && !savedRecords.some((record) => record.id === simulation.id)) savedRecords.push(simulation);
    const detail = enterpriseSimulationMatches(model, object, model.simulation) ? model.simulation : null;
    if (savedRecords.length) {
      const selected = selectedSimulationId ?? detail?.id ?? savedRecords[savedRecords.length - 1].id;
      const choice = ui.field('simulationId', 'Saved simulations of this exact source', { entries: [...savedRecords].reverse().map((record) => [record.id, `${record.createdAt} · ${record.status} · ${record.reason ?? 'saved scenario'}`]), value: selected });
      choice.control.disabled = loading || Boolean(pending);
      choice.control.addEventListener('change', () => { if (onSimulationSelection) onSimulationSelection(choice.control.value); });
      root.append(choice.node);
    }
    const visible = selectedSimulationId ? detail : (enterpriseSimulationMatches(model, object, simulation) ? simulation : detail);
    if (visible) root.append(renderEnterpriseSimulation({ simulation: visible, model, el }));
  }
  return root;
}
