export function renderBlueprintImpactPreview(preview, el) {
  const fieldList = el('ul');
  for (const change of preview.changedFields ?? []) {
    const showValue = (value) => JSON.stringify(value ?? null).slice(0, 180);
    fieldList.append(el('li', { text: `${change.field}: ${showValue(change.before)} → ${showValue(change.after)}` }));
  }
  const affectedList = el('ul');
  for (const affected of preview.directlyAffectedObjects ?? []) {
    affectedList.append(el('li', { text: `${affected.name} · ${affected.type}${affected.edited ? ' · edited' : ' · directly connected'} · source v${affected.source.blueprintVersion}` }));
  }
  const unknownList = el('ul');
  for (const unknown of preview.unknownAreas ?? []) unknownList.append(el('li', { text: unknown }));
  return el('section', { className: 'blueprint-impact-preview', attrs: { 'aria-label': 'Proposed design impact preview', 'aria-live': 'polite' } }, [
    el('h4', { text: `Impact preview · ${preview.status}` }),
    el('p', { text: `Source blueprint ${preview.source.blueprintId} v${preview.source.blueprintVersion} · workspace v${preview.source.projectVersion} · SHA-256 ${preview.source.snapshotHash}` }),
    el('p', { text: `Direct blueprint relationships computed. Proposed result would be blueprint v${preview.proposedBlueprintVersion}.` }),
    el('h5', { text: 'Changed fields' }), fieldList,
    el('h5', { text: 'Directly affected saved design records' }), affectedList,
    el('h5', { text: 'Not computed by this preview' }), unknownList,
    el('p', { className: 'edit-help', text: preview.limitation }),
  ]);
}
