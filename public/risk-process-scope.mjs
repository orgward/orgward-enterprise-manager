export function renderRiskProcessScopePicker({ riskId, processes, selectedIds = [], el }) {
  if (typeof riskId !== 'string' || !Array.isArray(processes) || typeof el !== 'function') return null;
  const declaredProcesses = processes.filter((entry) => entry?.type === 'process' && typeof entry.id === 'string');
  const selected = new Set(Array.isArray(selectedIds) ? selectedIds : []);
  const group = el('fieldset', { className: 'risk-process-scope-select', attrs: { 'aria-describedby': `risk-process-scope-help-${riskId}` } }, [
    el('legend', { text: 'Processes this risk explicitly applies to' }),
    el('p', { className: 'edit-help', text: 'Select only processes the owner declares are in this risk’s scope. No process is selected automatically; this records design scope and does not accept the risk or verify behavior.', attrs: { id: `risk-process-scope-help-${riskId}` } }),
  ]);
  for (const process of declaredProcesses) {
    const id = `blueprint-risk-process-${riskId}-${process.id}`;
    const checkbox = el('input', { attrs: { id, name: 'processIds', type: 'checkbox', value: process.id } });
    checkbox.checked = selected.has(process.id);
    group.append(el('label', { className: 'risk-process-option', attrs: { for: id } }, [checkbox, el('span', { text: process.name ?? process.id })]));
  }
  if (!declaredProcesses.length) group.append(el('p', { className: 'edit-help', text: 'Add a process before declaring process-specific risk scope.' }));
  return group;
}
