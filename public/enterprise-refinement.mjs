import { enterpriseBranchWritable } from './enterprise-branches.mjs';

export const ENTERPRISE_REFINEMENT_COMMANDS = ['define-refinement'];
const objectsOf = (model) => Object.values(model.blueprint?.areas ?? {}).flatMap((area) => area.items ?? []);

export function enterpriseRefinementWritable(model) {
  if (!(model?.permissions?.economicWrite ?? model?.permissions?.processWrite) || !model.blueprint
    || model.context?.effectiveAt != null || model.context?.recordedAtCutoff != null || model.context?.proposalId) return false;
  return model.context?.branchId ? enterpriseBranchWritable(model) : model.context?.isCurrent === true;
}
export function enterpriseRefinementCommandPayload(model, payload) {
  if (!model?.blueprint || payload?.kind !== 'define-refinement' || !enterpriseRefinementWritable(model)) return null;
  return { ...payload, blueprintId: model.context.blueprintId, blueprintVersion: model.context.blueprintVersion,
    ...(model.context.branchId ? { branchId: model.context.branchId, branchRevision: model.context.branchRevision } : {}) };
}
export function enterpriseRefinementDraftMatches(model, object, payload) {
  return Boolean(payload?.kind === 'define-refinement' && payload.objectId === object.id
    && payload.blueprintId === model.context.blueprintId && payload.blueprintVersion === model.context.blueprintVersion
    && (payload.branchId ?? null) === (model.context.branchId ?? null) && (payload.branchRevision ?? null) === (model.context.branchRevision ?? null));
}
function form(el, ui, kind, label, controls, submit, disabled) {
  return ui.form(kind, label, controls, submit, disabled);
}
export function renderEnterpriseRefinement({ model, object, draft = null, pending = null, loading = false, el, ui, onCommand, onInspectDraft }) {
  if (!model.blueprint || !object) return null;
  const objects = objectsOf(model); const retained = enterpriseRefinementDraftMatches(model, object, draft) ? draft : null;
  const pendingPayload = pending?.kind === 'define-refinement' ? pending : null;
  const chosen = new Set(pendingPayload?.refines ?? retained?.refines ?? object.refines ?? []);
  const writable = enterpriseRefinementWritable(model) && !loading && !pending;
  const root = el('section', { attrs: { 'data-enterprise-refinement': object.id } }, [
    el('h4', { text: 'Refinement and reverse trace' }),
    el('p', { text: 'Links record proposed design decomposition. They do not establish implementation, evidence or operational status.' }),
  ]);
  const trace = model.refinementTrace;
  const names = new Map(objects.map((entry) => [entry.id, entry.name]));
  if (trace?.selectedId === object.id) {
    root.append(el('p', { text: `Trace status: ${trace.status} · ${trace.explanation}` }));
    if (trace.truncated?.ancestors || trace.truncated?.descendants) root.append(el('p', { attrs: { role: 'status' },
      text: `Trace results are incomplete at the bounded limit: ${trace.truncated.ancestors ? 'higher-level paths are truncated' : ''}${trace.truncated.ancestors && trace.truncated.descendants ? '; ' : ''}${trace.truncated.descendants ? 'lower-level paths are truncated' : ''}.` }));
    for (const [label, entries] of [['Refines / higher-level', trace.ancestors], ['Refined by / lower-level', trace.descendants]]) {
      const list = el('ul', { attrs: { 'aria-label': label } });
      for (const entry of entries) list.append(el('li', {}, [el('strong', { text: `${entry.name} (${entry.type})` }), el('span', { text: ` · depth ${entry.depth} · path: ${entry.path.map((id) => names.get(id) ?? id).join(' → ')}` })]));
      root.append(el('h5', { text: `${label} (${entries.length})` }), list);
    }
  }
  if (draft?.kind === 'define-refinement' && !retained && !pendingPayload && onInspectDraft) {
    root.append(el('p', { text: 'A rejected refinement draft belongs to a different exact source.' }));
    const inspect = el('button', { className: 'button ghost', text: 'Inspect original refinement source', attrs: { type: 'button' } });
    inspect.addEventListener('click', () => onInspectDraft({ lensId: 'all', scopeId: null,
      blueprintVersion: draft.branchId ? null : draft.blueprintVersion, branchId: draft.branchId ?? null,
      branchRevision: draft.branchRevision ?? null, proposalId: null, effectiveAt: null, recordedAt: null }, draft.objectId)); root.append(inspect);
  }
  const fieldset = el('fieldset'); fieldset.append(el('legend', { text: 'This record refines these saved design records' }));
  for (const target of objects.filter((entry) => entry.id !== object.id)) {
    const checkbox = el('input', { attrs: { type: 'checkbox', name: 'refines', value: target.id } }); checkbox.checked = chosen.has(target.id); checkbox.disabled = !writable;
    fieldset.append(el('label', {}, [checkbox, el('span', { text: `${target.name} (${target.type})` })]));
  }
  const reason = ui.field('reason', 'Reason for this refinement', { multiline: true, maximum: 500, value: pendingPayload?.reason ?? retained?.reason ?? '' });
  root.append(form(el, ui, 'define-refinement', 'Save exact refinement links', [fieldset, reason.node], () => {
    const refines = Array.from(fieldset.querySelectorAll('input')).filter((control) => (control.getAttribute?.('name') ?? control.attrs?.name ?? control.name) === 'refines' && control.checked).map((control) => control.value);
    if (refines.length > 12) throw new Error('Choose at most twelve refinement links for one record.');
    onCommand({ kind: 'define-refinement', objectId: object.id, refines, reason: reason.control.value.trim() });
  }, !writable));
  return root;
}
