const activeStatuses = new Set(['IN_PROGRESS', 'ESCALATED']);

export function assignedHumanWorkItems(plans, runtimes, projectId) {
  const planByRevision = new Map(plans.filter((entry) => entry.source?.projectId === projectId)
    .map((plan) => [`${plan.id}\n${plan.revision ?? 1}`, plan]));
  const items = [];
  for (const runtime of runtimes) {
    if (runtime.projectId !== projectId || runtime.actorType !== 'human'
      || runtime.assignedToCurrentPrincipal !== true || !activeStatuses.has(runtime.status)) continue;
    const plan = planByRevision.get(`${runtime.processPlanId}\n${runtime.revision}`);
    const task = plan?.tasks?.find((entry) => entry.id === runtime.taskId);
    if (!plan || !task) continue;
    items.push({ projectId, planId: plan.id, revision: plan.revision ?? 1, planInstanceId: runtime.planInstanceId,
      sourceProcessId: task.sourceProcessId ?? plan.source.processId ?? null,
      taskId: task.id, taskTitle: task.title, processName: plan.source.processName, status: runtime.status,
      outputs: (task.outputs ?? []).map((output) => output.label), updatedAt: runtime.updatedAt ?? runtime.createdAt ?? null });
  }
  return items.sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? ''))
    || left.processName.localeCompare(right.processName) || left.taskTitle.localeCompare(right.taskTitle));
}

export function assignedHumanWorkItemsForProcess(items, processId) {
  return processId ? items.filter((item) => item.sourceProcessId === processId) : items;
}

export function findHistoricalProcessPlanCard(container) {
  return container.querySelector('.process-plan');
}

export function assignedHumanWorkRowId(item) {
  return `assigned-human-work-${item.planId}-${item.revision}-${item.planInstanceId}-${item.taskId}`;
}

export function openAssignedHumanWorkItem({ item, selectedInstances, render, findRow }) {
  selectedInstances.set(`${item.planId}\n${item.revision}`, item.planInstanceId);
  render();
  const row = findRow(assignedHumanWorkRowId(item));
  row?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  row?.focus?.({ preventScroll: true });
}

export function renderAssignedHumanWorkQueue({ items, el, onOpen, emptyMessage = 'No active human tasks are assigned to you in this project.' }) {
  const section = el('section', { className: 'run-section assigned-human-work-queue', attrs: {
    'aria-label': 'My assigned work', 'data-assigned-human-work': '',
  } }, [el('h3', { text: 'My assigned work' })]);
  if (!items.length) {
    section.append(el('p', { className: 'muted', text: emptyMessage }));
    return section;
  }
  section.append(el('p', { className: 'muted', text: 'Only active human tasks assigned to your current signed-in identity are listed.' }));
  section.append(el('ul', {}, items.map((item) => {
    const button = el('button', { className: 'button', text: `Open ${item.taskTitle} · ${item.status.replaceAll('_', ' ')}`,
      attrs: { type: 'button', 'data-assigned-work-item': item.taskId } });
    button.addEventListener('click', () => onOpen(item));
    return el('li', { attrs: { 'data-assigned-work-row': item.taskId } }, [
      el('strong', { text: `${item.taskTitle} · ${item.processName}` }),
      el('p', { text: `Status: ${item.status.replaceAll('_', ' ')} · instance ${item.planInstanceId}` }),
      el('p', { text: `Pinned plan revision ${item.revision}${item.outputs.length ? ` · outputs ${item.outputs.join(', ')}` : ''}` }),
      button,
    ]);
  })));
  return section;
}
