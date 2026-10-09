import { enterpriseBranchWritable } from './enterprise-branches.mjs';

export const ENTERPRISE_ECONOMIC_COMMANDS = ['define-economic-scenario', 'define-resource-plan', 'define-value-lifecycle', 'evaluate-economic-scenario'];
const definitionFields = { economics: ['economicScenario', 'define-economic-scenario'], resource: ['resourcePlan', 'define-resource-plan'], lifecycle: ['valueLifecycle', 'define-value-lifecycle'] };
const objectsOf = (model) => Object.values(model.blueprint?.areas ?? {}).flatMap((area) => area.items ?? []);
const nextId = (prefix, rows) => { let value = 1; while (rows.some((row) => row.id === `${prefix}-${value}`)) value += 1; return `${prefix}-${value}`; };
const inputTime = (value) => typeof value === 'string' && value.endsWith('Z') ? value.slice(0, -1) : '';
function utcTime(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) throw new Error('Enter a valid UTC date and time.');
  const instant = new Date(`${value}Z`);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 19) !== (value.length === 16 ? `${value}:00` : value.split('.')[0])) throw new Error('Enter a valid UTC date and time.');
  return instant.toISOString();
}
export function enterpriseEconomicWritable(model) {
  if (!(model?.permissions?.economicWrite ?? model?.permissions?.processWrite) || !model.blueprint || model.context?.effectiveAt != null
    || model.context?.recordedAtCutoff != null || model.context?.proposalId) return false;
  return model.context?.branchId ? enterpriseBranchWritable(model) : model.context?.isCurrent === true;
}
export function enterpriseEconomicCommandPayload(model, payload) {
  if (!model?.blueprint || !ENTERPRISE_ECONOMIC_COMMANDS.includes(payload?.kind)) return null;
  const evaluating = payload.kind === 'evaluate-economic-scenario';
  if (evaluating ? !(model.permissions?.economicEvaluate ?? model.permissions?.simulate) : !enterpriseEconomicWritable(model)) return null;
  const bound = { ...payload, blueprintId: model.context.blueprintId, blueprintVersion: model.context.blueprintVersion };
  if (model.context.branchId) Object.assign(bound, { branchId: model.context.branchId, branchRevision: model.context.branchRevision });
  if (evaluating && model.context.proposalId) bound.proposalId = model.context.proposalId;
  return bound;
}
export function enterpriseEconomicDraftMatches(model, object, payload) {
  return Boolean(payload && ENTERPRISE_ECONOMIC_COMMANDS.includes(payload.kind) && payload.objectId === object.id
    && payload.blueprintId === model.context.blueprintId && payload.blueprintVersion === model.context.blueprintVersion
    && (payload.branchId ?? null) === (model.context.branchId ?? null) && (payload.branchRevision ?? null) === (model.context.branchRevision ?? null)
    && (payload.proposalId ?? null) === (model.context.proposalId ?? null));
}
export function enterpriseEconomicEvaluationMatches(model, object, evaluation) {
  const source = evaluation?.source; const context = model?.context; const cutoff = context?.recordedAtCutoff;
  return Boolean(source && context && evaluation.economicsId === object?.id && source.blueprintId === context.blueprintId
    && source.blueprintVersion === context.blueprintVersion && source.snapshotHash === context.snapshotHash
    && (source.branchId ?? null) === (context.branchId ?? null) && (source.branchRevision ?? null) === (context.branchRevision ?? null)
    && (source.proposalId ?? null) === (context.proposalId ?? null)
    && (!cutoff || (Number.isFinite(Date.parse(evaluation.createdAt)) && Date.parse(evaluation.createdAt) <= Date.parse(cutoff))));
}
function disable(node, disabled) { if (disabled) for (const control of node.querySelectorAll('input,select,textarea,button')) control.disabled = true; }
function action(el, label, callback, disabled = false) {
  const node = el('button', { className: 'button ghost', text: label, attrs: { type: 'button' } }); node.disabled = disabled;
  node.addEventListener('click', callback); return node;
}
function optionalNumber(field, name, label, value, integer = false) {
  const input = field(name, `${label} (blank means unknown)`, { value: value ?? '', required: false, type: 'number' });
  input.control.min = '0'; input.control.max = '1000000000000'; input.control.step = integer ? '1' : '0.000001';
  return { ...input, read: () => {
    if (!input.control.value.trim()) return null;
    const number = Number(input.control.value);
    if (!Number.isFinite(number) || number < 0 || number > 1_000_000_000_000 || (integer ? !Number.isSafeInteger(number) : Number(number.toFixed(6)) !== number)) throw new Error(`${label} needs a bounded nonnegative ${integer ? 'integer' : 'number with at most six decimal places'}.`);
    return number;
  } };
}
function quantityEditor(el, field, name, label, saved = {}, integer = false) {
  const amount = optionalNumber(field, `${name}Value`, label, saved.value, integer);
  const unit = field(`${name}Unit`, `${label} unit`, { value: saved.unit ?? '', maximum: 40 });
  const source = field(`${name}Source`, `${label} assumption/report source`, { value: saved.source ?? '', maximum: 240 });
  return { amountControl: amount.control, node: el('fieldset', {}, [el('legend', { text: label }), amount.node, unit.node, source.node]),
    read: () => ({ value: amount.read(), unit: unit.control.value.trim(), source: source.control.value.trim() }) };
}
function moneyEditor(el, field, name, label, saved = {}, perUnit = false) {
  const amount = optionalNumber(field, `${name}Amount`, `${label} in integer minor units`, saved.minorUnits, true);
  const currency = field(`${name}Currency`, `${label} currency (three uppercase letters)`, { value: saved.currency ?? '', maximum: 3 });
  const decimals = field(`${name}Decimals`, `${label} decimal places`, { entries: [0, 1, 2, 3, 4].map((value) => [String(value), String(value)]), value: String(saved.decimalPlaces ?? 2) });
  const unit = perUnit ? field(`${name}PerUnit`, `${label} per output unit`, { value: saved.perUnit ?? '', maximum: 40 }) : null;
  const source = field(`${name}Source`, `${label} assumption/accounting source`, { value: saved.source ?? '', maximum: 240 });
  return { node: el('fieldset', {}, [el('legend', { text: label }), el('p', { text: 'With two decimal places, 12345 minor units represents 123.45. Currency and precision must match before totals are calculated.' }), amount.node, currency.node, decimals.node, ...(unit ? [unit.node] : []), source.node]),
    read: () => ({ minorUnits: amount.read(), currency: currency.control.value.trim(), decimalPlaces: Number(decimals.control.value),
      ...(unit ? { perUnit: unit.control.value.trim() } : {}), source: source.control.value.trim() }) };
}
function windowEditor(el, field, saved = {}) {
  const start = field('windowStart', 'Window start (UTC)', { type: 'datetime-local', value: inputTime(saved.start) });
  const end = field('windowEnd', 'Exclusive window end (UTC)', { type: 'datetime-local', value: inputTime(saved.end) });
  return { node: el('fieldset', {}, [el('legend', { text: 'Exact UTC interval' }), start.node, end.node]),
    read: () => { const from = utcTime(start.control.value); const to = utcTime(end.control.value); if (to <= from) throw new Error('Window end must be after its start.'); return { start: from, end: to, timezone: 'UTC' }; } };
}
function references(el, objects, selected, label) {
  const rows = objects.map((object) => { const control = el('input', { attrs: { type: 'checkbox', value: object.id } }); control.checked = selected.includes(object.id);
    return { control, node: el('label', {}, [control, el('span', { text: object.name })]) }; });
  return { node: el('fieldset', {}, [el('legend', { text: label }), ...rows.map((row) => row.node)]), read: () => rows.filter((row) => row.control.checked).map((row) => row.control.value) };
}
function reference(field, objects, name, label, type, value, nullable = false, filter = () => true) {
  return field(name, label, { entries: [['', nullable ? 'Unknown / none specified' : 'Choose a saved record'], ...objects.filter((object) => object.type === type && filter(object)).map((object) => [object.id, object.name])], value, required: !nullable });
}
function rowsEditor(el, label, maximum, disabled, renderRow) {
  const rows = []; const list = el('div', { className: 'enterprise-editor-rows' });
  const add = (saved = {}) => {
    if (rows.length >= maximum) return;
    const row = renderRow(saved, rows); rows.push(row);
    row.node.append(action(el, `Remove ${label.toLowerCase()}`, () => { rows.splice(rows.indexOf(row), 1); row.node.remove(); }, disabled)); list.append(row.node); disable(row.node, disabled);
  };
  return { rows, add, node: el('section', {}, [el('h5', { text: label }), list, action(el, `Add ${label.toLowerCase()} (up to ${maximum})`, () => add(), disabled)]), read: () => rows.map((row) => row.read()) };
}
function scenarioEditor({ model, object, el, ui, onCommand, disabled, reasonValue }) {
  const { field, form } = ui; const objects = objectsOf(model); const saved = object.economicScenario ?? {};
  const offering = reference(field, objects, 'offeringId', 'Canonical offering', 'offering', saved.offeringId);
  const processes = references(el, objects.filter((entry) => entry.type === 'process'), saved.processIds ?? [], 'Processes modeled by this scenario');
  const window = windowEditor(el, field, saved.window); const volume = quantityEditor(el, field, 'volume', 'Output volume (integer, at most one billion)', saved.volume, true);
  volume.amountControl.max = '1000000000';
  const price = moneyEditor(el, field, 'price', 'Price per output unit', saved.unitPrice, true);
  const variable = moneyEditor(el, field, 'variable', 'Variable cost per output unit', saved.unitVariableCost, true);
  const fixed = moneyEditor(el, field, 'fixed', 'Fixed cost for this interval', saved.fixedCost);
  const funding = moneyEditor(el, field, 'funding', 'Funding available for this interval', saved.availableFunding);
  const demands = rowsEditor(el, 'Resource demand', 12, disabled, (entry, rows) => {
    const id = entry.id ?? nextId('demand', rows); const process = reference(field, objects, 'demandProcessId', 'Scenario process using this resource', 'process', entry.processId,
      false, (candidate) => (candidate.resources ?? []).length > 0);
    const options = () => [['', 'Choose a resource used by the process'], ...objects.filter((candidate) => candidate.type === 'resource'
      && (objects.find((value) => value.id === process.control.value)?.resources ?? []).includes(candidate.id)).map((candidate) => [candidate.id, candidate.name])];
    const resource = field('demandResourceId', 'Canonical resource', { entries: options(), value: entry.resourceId });
    process.control.addEventListener('change', () => { const value = resource.control.value; resource.control.replaceChildren(...options().map(([id, title]) => el('option', { text: title, attrs: { value: id } }))); resource.control.value = options().some(([id]) => id === value) ? value : ''; });
    const required = quantityEditor(el, field, 'demandQuantity', 'Resource quantity per output unit', entry.quantityPerUnit);
    const perUnit = field('demandPerUnit', 'Demand per output unit', { value: entry.perUnit ?? saved.volume?.unit ?? '', maximum: 40 });
    return { id, node: el('section', { className: 'enterprise-editor-row' }, [process.node, resource.node, required.node, perUnit.node]),
      read: () => ({ resourceId: resource.control.value, processId: process.control.value, quantityPerUnit: required.read(), perUnit: perUnit.control.value.trim() }) };
  });
  (saved.resourceDemands ?? []).forEach(demands.add);
  const reason = field('reason', 'Reason for these assumptions', { multiline: true, maximum: 500, value: reasonValue });
  return form('define-economic-scenario', 'Save typed economic assumptions', [offering.node, processes.node, window.node, volume.node, price.node, variable.node, fixed.node, funding.node, demands.node, reason.node], () => {
    onCommand({ kind: 'define-economic-scenario', objectId: object.id, reason: reason.control.value.trim(), economicScenario: { schemaVersion: '1.0', offeringId: offering.control.value, processIds: processes.read(), window: window.read(), volume: volume.read(), unitPrice: price.read(), unitVariableCost: variable.read(), fixedCost: fixed.read(), availableFunding: funding.read(), resourceDemands: demands.read() } });
  }, disabled);
}
function resourceEditor({ model, object, el, ui, onCommand, disabled, reasonValue }) {
  const { field, form } = ui; const objects = objectsOf(model); const saved = object.resourcePlan ?? {};
  const provider = field('provider', 'Reported provider (blank means unknown)', { value: saved.provider ?? '', required: false, maximum: 240 });
  const windows = rowsEditor(el, 'Resource window', 24, disabled, (entry, rows) => {
    const id = entry.id ?? nextId('window', rows); const window = windowEditor(el, field, entry.window);
    const capacity = quantityEditor(el, field, 'capacity', 'Whole-window capacity', entry.capacity);
    const available = quantityEditor(el, field, 'available', 'Whole-window availability before allocations', entry.available);
    const allocations = rowsEditor(el, 'Declared allocation', 24, disabled, (allocation, allocationRows) => {
      const allocationId = allocation.id ?? nextId(`allocation-${id}`, allocationRows);
      const process = reference(field, objects, 'allocationProcessId', 'Canonical process using this resource', 'process', allocation.processId, false, (candidate) => (candidate.resources ?? []).includes(object.id));
      const amount = quantityEditor(el, field, 'allocation', 'Allocated amount', allocation.quantity);
      const state = field('allocationState', 'Declaration state', { entries: [['PLANNED', 'Planned design'], ['COMMITTED_REPORTED', 'Human-reported commitment, unverified']], value: allocation.state ?? 'PLANNED' });
      return { id: allocationId, node: el('section', { className: 'enterprise-editor-row' }, [process.node, amount.node, state.node]), read: () => ({ id: allocationId, processId: process.control.value, quantity: amount.read(), state: state.control.value }) };
    });
    (entry.allocations ?? []).forEach(allocations.add);
    return { id, node: el('section', { className: 'enterprise-editor-row' }, [el('p', { text: `Stable window: ${id}` }), window.node, capacity.node, available.node, allocations.node]),
      read: () => ({ id, window: window.read(), capacity: capacity.read(), available: available.read(), allocations: allocations.read() }) };
  });
  (saved.windows ?? [{}]).forEach(windows.add);
  const reason = field('reason', 'Reason for capacity and allocation declarations', { multiline: true, maximum: 500, value: reasonValue });
  return form('define-resource-plan', 'Save capacity and availability plan', [el('p', { text: 'Windows cannot overlap. Quantities cover each complete UTC interval. Planned and reported commitments count in full; this form does not reserve live resources.' }), provider.node, windows.node, reason.node], () => {
    onCommand({ kind: 'define-resource-plan', objectId: object.id, reason: reason.control.value.trim(), resourcePlan: { schemaVersion: '1.0', provider: provider.control.value.trim() || null, windows: windows.read() } });
  }, disabled);
}
function valueEditor({ model, object, el, ui, onCommand, disabled, reasonValue }) {
  const { field, form } = ui; const objects = objectsOf(model); const saved = object.valueLifecycle ?? {};
  const projection = model.economics?.valueLifecycles?.find((entry) => entry.lifecycleId === object.id);
  const offering = reference(field, objects, 'offeringId', 'Offering whose value is tracked', 'offering', saved.offeringId);
  const customer = reference(field, objects, 'customerId', 'Served customer', 'customer', saved.customerId, true);
  const stages = rowsEditor(el, 'Value stage', 16, disabled, (entry, rows) => {
    const id = entry.id ?? nextId('value-stage', rows); const projected = projection?.stages.find((stage) => stage.id === id);
    const title = field('stageTitle', 'Stage title', { value: entry.title ?? '', maximum: 120 });
    const phase = field('phase', 'Value lifecycle phase', { entries: [['DESIGN', 'Design'], ['DELIVERY', 'Delivery'], ['USE', 'Customer use'], ['RETIREMENT', 'Retirement']], value: entry.phase ?? 'DESIGN' });
    const process = reference(field, objects, 'stageProcessId', 'Canonical process', 'process', entry.processId, true);
    const resources = references(el, objects.filter((value) => value.type === 'resource'), entry.resourceIds ?? [], 'Resources used by this stage process');
    const intended = field('intendedValue', 'Intended customer/business value', { value: entry.intendedValue ?? '', multiline: true, maximum: 500 });
    const metric = reference(field, objects, 'metricId', 'Linked outcome measure', 'metric', entry.metricId, true);
    const mode = field('reportMode', 'Observation treatment', { entries: [['KEEP', 'Keep saved report and its original definition binding'], ['RECORD', 'Record an unverified human observation'], ['UNKNOWN', 'Set current observation to unknown']], value: 'KEEP' });
    const observation = entry.observation; const observedAt = field('observedAt', 'Reported observation time (UTC)', { type: 'datetime-local', value: inputTime(observation?.observedAt), required: false });
    const summary = field('observationSummary', 'Reported value summary', { value: observation?.summary ?? '', required: false, multiline: true, maximum: 500 });
    const source = field('observationSource', 'Value report source', { value: observation?.source ?? '', required: false, maximum: 240 });
    const measured = quantityEditor(el, field, 'valueObservation', 'Optional reported measure', observation?.quantity ?? {});
    for (const control of measured.node.querySelectorAll('input,textarea,select')) control.required = false;
    return { id, node: el('section', { className: 'enterprise-editor-row' }, [el('p', { text: `Stable value stage: ${id}` }), title.node, phase.node, process.node, resources.node, intended.node, metric.node,
      el('p', { text: `${projected?.observationStatus ?? 'UNKNOWN'} · Save intended stages first. A new report binds the saved stage definition; editing the stage makes earlier reports stale.` }), mode.node, observedAt.node, summary.node, source.node, measured.node]),
    read: () => {
      let report = observation ?? null;
      if (mode.control.value === 'UNKNOWN') report = null;
      if (mode.control.value === 'RECORD') {
        if (!projected?.basisHash) throw new Error('Save this stage design before recording its first observation.');
        const reportedMeasure = measured.read();
        report = { basisHash: projected.basisHash, observedAt: utcTime(observedAt.control.value), summary: summary.control.value.trim(), source: source.control.value.trim(),
          quantity: reportedMeasure.value === null ? null : reportedMeasure };
      }
      return { id, title: title.control.value.trim(), phase: phase.control.value, processId: process.control.value || null, resourceIds: resources.read(), intendedValue: intended.control.value.trim(), metricId: metric.control.value || null, observation: report };
    } };
  });
  (saved.stages ?? [{}]).forEach(stages.add);
  const reason = field('reason', 'Reason for value design/report', { multiline: true, maximum: 500, value: reasonValue });
  return form('define-value-lifecycle', 'Save linked value lifecycle', [offering.node, customer.node, stages.node, reason.node], () => {
    onCommand({ kind: 'define-value-lifecycle', objectId: object.id, reason: reason.control.value.trim(), valueLifecycle: { schemaVersion: '1.0', offeringId: offering.control.value, customerId: customer.control.value || null, stages: stages.read() } });
  }, disabled);
}
export function formatEconomicMetric(metric) {
  if (!metric || metric.status !== 'CALCULATED') return `${metric?.status ?? 'UNKNOWN'}: ${metric?.explanation ?? 'No calculated value.'}`;
  if (metric.minorUnits !== undefined) {
    const digits = String(Math.abs(metric.minorUnits)).padStart(metric.decimalPlaces + 1, '0');
    const amount = metric.decimalPlaces ? `${digits.slice(0, -metric.decimalPlaces)}.${digits.slice(-metric.decimalPlaces)}` : digits;
    return `${metric.currency} ${metric.minorUnits < 0 ? '-' : ''}${amount}`;
  }
  return `${metric.value} ${metric.unit}`;
}
function renderMetrics(el, metrics) {
  return el('dl', {}, Object.entries(metrics ?? {}).flatMap(([name, metric]) => [el('dt', { text: name.replace(/([A-Z])/g, ' $1') }), el('dd', { text: `${formatEconomicMetric(metric)}${metric?.status === 'CALCULATED' ? ` · ${metric.explanation}` : ''}` })]));
}
function renderResourceProjection(el, projection, labels = {}) {
  const node = el('section', { attrs: { 'data-enterprise-capacity': projection.resourceId } }, [el('h5', { text: `${projection.resourceName ?? 'Resource'} · ${projection.status}` })]);
  for (const window of projection.windows ?? [projection]) {
    node.append(el('p', { text: `${window.window?.start ?? 'Unknown start'} → ${window.window?.end ?? 'unknown end'} (exclusive UTC) · ${window.status}` }), renderMetrics(el, window.metrics));
    for (const allocation of window.allocations ?? []) node.append(el('p', { text: `Allocation ${allocation.id}: ${allocation.quantity.value ?? 'UNKNOWN'} ${allocation.quantity.unit} · ${labels[allocation.processId] ?? allocation.processId} · ${allocation.state} · source: ${allocation.quantity.source}` }));
    for (const demand of window.demands ?? []) node.append(el('p', { text: `Scenario demand: ${demand.quantity.value ?? 'UNKNOWN'} ${demand.quantity.unit} · ${labels[demand.processId] ?? demand.processId} · source: ${demand.quantity.source}` }));
    for (const constraint of window.constraints ?? []) node.append(el('p', { text: `${constraint.code}: ${constraint.message}` }));
  }
  return node;
}
export function renderEnterpriseEconomics({ model, object, pending = null, loading = false, evaluation = null, draft = null, selectedEvaluationId = null,
  el, ui, onCommand, onInspectDraft, onEconomicEvaluationSelection, onInspectEconomicEvaluation }) {
  if (!definitionFields[object.type]) return null;
  const [fieldName, commandKind] = definitionFields[object.type]; const retained = enterpriseEconomicDraftMatches(model, object, draft) ? draft : null;
  const edited = retained?.[fieldName] ? { ...object, [fieldName]: retained[fieldName] } : object;
  const disabled = loading || Boolean(pending) || !enterpriseEconomicWritable(model);
  const root = el('section', { attrs: { 'data-enterprise-economics': object.id } }, [el('h4', { text: 'Economics, resources and value' }),
    el('p', { text: 'Typed design assumptions and unverified reports. Unknowns and incompatible amounts remain explicit; scenario calculations do not verify business performance.' })]);
  if (draft && ENTERPRISE_ECONOMIC_COMMANDS.includes(draft.kind) && !retained) {
    root.append(el('p', { text: 'The retained draft belongs to an earlier exact source. Inspect that source before changing or resubmitting it.' }));
    if (onInspectDraft) root.append(action(el, 'Inspect original source and retained draft', () => onInspectDraft({ lensId: 'all', scopeId: null,
      blueprintVersion: draft.branchId || draft.proposalId ? null : draft.blueprintVersion, branchId: draft.branchId ?? null, branchRevision: draft.branchRevision ?? null,
      proposalId: draft.proposalId ?? null, effectiveAt: null, recordedAt: null, economicEvaluationId: null }, draft.objectId), loading || Boolean(pending)));
  }
  const editors = { economics: scenarioEditor, resource: resourceEditor, lifecycle: valueEditor };
  root.append(el('details', { attrs: retained?.kind === commandKind ? { open: '' } : {} }, [el('summary', { text: ({ economics: 'Author typed economic assumptions', resource: 'Author capacity, availability and allocations', lifecycle: 'Author value stages and reported observations' })[object.type] }),
    editors[object.type]({ model, object: edited, el, ui, onCommand, disabled, reasonValue: retained?.reason ?? '' })]));
  if (object.type === 'resource') {
    const projected = model.economics?.resources?.find((entry) => entry.resourceId === object.id);
    if (projected) root.append(renderResourceProjection(el, projected, Object.fromEntries(objectsOf(model).map((entry) => [entry.id, entry.name]))));
  }
  if (object.type === 'lifecycle') {
    const projected = model.economics?.valueLifecycles?.find((entry) => entry.lifecycleId === object.id);
    if (projected) for (const stage of projected.stages) root.append(el('article', {}, [el('h5', { text: `${stage.title} · ${stage.phase}` }),
      el('p', { text: `Intended value: ${stage.intendedValue}` }), el('p', { text: `Observation: ${stage.observationStatus}` }),
      ...(stage.observation ? [el('p', { text: `${stage.observation.summary} · ${stage.observation.observedAt} · source: ${stage.observation.source}` }),
        ...(stage.observation.quantity ? [el('p', { text: `${stage.observation.quantity.value ?? 'UNKNOWN'} ${stage.observation.quantity.unit} · ${stage.observation.quantity.source}` })] : [])] : [])]));
  }
  if (object.type !== 'economics') return root;
  if (object.economicScenario) {
    const reason = ui.field('reason', 'Reason for evaluating this exact saved scenario', { multiline: true, maximum: 500, value: retained?.kind === 'evaluate-economic-scenario' ? retained.reason : '' });
    root.append(ui.form('evaluate-economic-scenario', 'Save declared scenario evaluation', [reason.node], () => onCommand({ kind: 'evaluate-economic-scenario', objectId: object.id, reason: reason.control.value.trim() }),
      loading || Boolean(pending) || !(model.permissions?.economicEvaluate ?? model.permissions?.simulate)));
  }
  const history = (model.economics?.evaluations ?? []).filter((entry) => entry.economicsId === object.id);
  if (history.length && onEconomicEvaluationSelection) {
    const choice = ui.field('economicEvaluationId', 'Saved evaluation', { entries: [['', 'Latest at this exact source'], ...history.map((entry) => [entry.id, `${entry.createdAt} · ${entry.status} · ${entry.sourceLabels?.records?.[object.id] ?? object.name}`])], value: selectedEvaluationId ?? '', required: false });
    choice.control.disabled = loading || Boolean(pending); choice.control.addEventListener('change', () => onEconomicEvaluationSelection(choice.control.value || null)); root.append(choice.node);
  }
  const result = evaluation ?? model.economics?.evaluation;
  if (!result || result.economicsId !== object.id) return root;
  root.append(el('h5', { text: `Saved scenario: ${result.status} · SCENARIO_ONLY` }), el('p', { text: `${result.createdAt} · ${result.createdBy} · ${result.reason}` }));
  const inputProvenance = result.inputProvenance ?? { status: 'UNTRACKED', resultStatus: 'UNKNOWN',
    mandatoryEvaluationEligible: false, approvalEligible: false,
    reason: 'This historical result has no immutable input manifest.' };
  root.append(el('p', { attrs: { 'data-economic-input-provenance': inputProvenance.status },
    text: `Derived-result inputs: ${inputProvenance.status} · ${inputProvenance.reason}` }),
  el('p', { text: 'This scenario result is not eligible as mandatory evaluation or approval evidence. It uses declared scenario inputs only; it does not establish observed business truth.' }));
  if (!enterpriseEconomicEvaluationMatches(model, object, result)) {
    root.append(el('p', { text: 'This evaluation belongs to a different exact source or falls after the selected recording cutoff. Its captured result does not apply to the selected design.' }));
    if (onInspectEconomicEvaluation) root.append(action(el, 'Inspect evaluation at its saved source', () => onInspectEconomicEvaluation(result), loading || Boolean(pending)));
  }
  root.append(el('p', { text: `Captured source: ${result.sourceLabels?.records?.[object.id] ?? object.name} · blueprint v${result.source.blueprintVersion} · ${result.scenario.window.start} → ${result.scenario.window.end} (exclusive UTC)` }), renderMetrics(el, result.metrics));
  for (const resource of result.resources ?? []) root.append(renderResourceProjection(el, resource, result.sourceLabels?.records ?? {}));
  for (const constraint of result.constraints ?? []) root.append(el('p', { text: `${constraint.code}: ${constraint.message}` }));
  for (const explanation of result.explanations ?? []) root.append(el('p', { text: explanation }));
  root.append(el('details', {}, [el('summary', { text: 'Captured assumptions and exact source identity' }), el('pre', { text: JSON.stringify({ source: result.source, sourceLabels: result.sourceLabels, scenario: result.scenario, scenarioHash: result.scenarioHash, resultHash: result.resultHash }, null, 2) })]));
  return root;
}
