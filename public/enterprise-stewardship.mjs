const sourceOf = (model) => {
  const context = model.context ?? {};
  return context.isCurrent && context.sourceKind === 'MAIN_DESIGN' && context.blueprintId && context.snapshotHash
    ? { blueprintId: context.blueprintId, blueprintVersion: context.blueprintVersion, snapshotHash: context.snapshotHash } : null;
};

export function enterpriseStewardshipPayload(model, kind, fields = {}) {
  const selected = model.selection?.object; const source = sourceOf(model);
  if (!source || selected?.type !== 'information' || selected.id !== fields.objectId
    || (kind === 'assign-information-steward' && !model.permissions?.stewardAssign)
    || (kind === 'record-information-stewardship-review' && !model.permissions?.stewardReview)) return null;
  if (kind === 'assign-information-steward' && !model.blueprint?.areas) return null;
  const current = model.stewardship?.assignments?.find((entry) => entry.objectId === selected.id
    && entry.appliesToContext && !entry.sourceDrift);
  if (kind === 'assign-information-steward') {
    const roleExists = Object.values(model.blueprint.areas).flatMap((area) => area.items ?? [])
      .some((entry) => entry.id === fields.roleId && entry.type === 'role');
    if (!roleExists || !fields.reason?.trim()) return null;
    return { kind, ...source, objectId: selected.id, roleId: fields.roleId, reason: fields.reason.trim() };
  }
  if (!current || current.assignmentRevision !== fields.assignmentRevision
    || !['CONFIRMED', 'NEEDS_ATTENTION', 'UNKNOWN'].includes(fields.outcome) || !fields.reason?.trim()) return null;
  return { kind, ...source, objectId: selected.id, assignmentRevision: current.assignmentRevision,
    outcome: fields.outcome, reason: fields.reason.trim() };
}

export function renderEnterpriseStewardship({ model, pending = false, loading = false, el, ui, onCommand }) {
  const selected = model.selection?.object;
  if (!selected || selected.type !== 'information') return null;
  const actionsDisabled = Boolean(pending || loading) || !sourceOf(model);
  const current = model.stewardship?.assignments?.find((entry) => entry.objectId === selected.id
    && entry.appliesToContext && !entry.sourceDrift);
  const history = model.stewardship?.assignments?.find((entry) => entry.objectId === selected.id);
  const root = el('section', { className: 'enterprise-stewardship', attrs: { 'aria-label': `Data stewardship for ${selected.name}` } }, [
    el('h3', { text: 'Data stewardship' }),
    el('p', { text: 'Assign a project role to steward this information definition. Reviews are human-reported records tied to the exact saved blueprint and assignment revision; they do not change the definition.' }),
    el('p', { attrs: { role: 'status' }, text: `${model.stewardship?.ledgerLength ?? 0} stewardship history entries · ledger head ${model.stewardship?.ledgerHead ?? 'not started'}.` }),
  ]);
  if (history && (!history.appliesToContext || history.sourceDrift)) root.append(el('p', { attrs: { role: 'status' }, text: `STALE · Prior steward role ${history.roleId} applied to blueprint ${history.source.blueprintVersion}; this assignment does not carry to the selected source. Assign a steward again for the current blueprint.` }));
  if (history) root.append(el('details', {}, [el('summary', { text: `Assignment and review history (${history.history.length})` }),
    el('ol', {}, history.history.map((entry) => el('li', { text: `${entry.action.replaceAll('-', ' ')} · ${entry.actor} · ${entry.at} · blueprint ${entry.source.blueprintVersion} (${entry.source.snapshotHash}) · revision ${entry.assignmentRevision} · ${entry.outcome ?? entry.roleId} · ${entry.reason}` })))]));
  if (current) {
    root.append(el('p', { text: `Current steward role: ${model.stewardship?.roleNames?.[current.roleId] ?? current.roleId} · assigned by ${current.assignedBy} at ${current.assignedAt} · revision ${current.assignmentRevision}.` }));
    if (current.latestReview) root.append(el('p', { attrs: { role: 'status' }, text: `Latest review: ${current.latestReview.outcome} · reported by ${current.latestReview.actor} at ${current.latestReview.at}. ${current.latestReview.reason}` }));
    if (model.permissions?.stewardReview) {
      const outcome = ui.field('outcome', 'Review outcome', { entries: [['CONFIRMED', 'Confirmed'], ['NEEDS_ATTENTION', 'Needs attention'], ['UNKNOWN', 'Unable to determine']], value: 'UNKNOWN' });
      const reason = ui.field('reason', 'Human review note', { multiline: true, maximum: 1000 });
      root.append(ui.form('record-information-stewardship-review', 'Record steward review', [outcome.node, reason.node], () => {
        const payload = enterpriseStewardshipPayload(model, 'record-information-stewardship-review', {
          objectId: selected.id, assignmentRevision: current.assignmentRevision, outcome: outcome.control.value, reason: reason.control.value,
        });
        if (payload) onCommand(payload);
      }, actionsDisabled));
    }
  } else root.append(el('p', { attrs: { role: 'status' }, text: 'No steward is assigned for this exact saved source.' }));
  if (model.permissions?.stewardAssign) {
    const roles = Object.values(model.blueprint?.areas ?? {}).flatMap((area) => area.items ?? []).filter((entry) => entry.type === 'role');
    const role = ui.field('roleId', 'Steward role', { entries: [['', 'Choose saved role'], ...roles.map((entry) => [entry.id, entry.name])], value: current?.roleId ?? '' });
    const reason = ui.field('reason', current ? 'Reason for assigning or changing the steward' : 'Reason for steward assignment', { multiline: true, maximum: 500 });
    root.append(ui.form('assign-information-steward', current ? 'Change steward role' : 'Assign steward role', [role.node, reason.node], () => {
      const payload = enterpriseStewardshipPayload(model, 'assign-information-steward', {
        objectId: selected.id, roleId: role.control.value, reason: reason.control.value,
      });
      if (payload) onCommand(payload);
    }, actionsDisabled));
  }
  return root;
}
