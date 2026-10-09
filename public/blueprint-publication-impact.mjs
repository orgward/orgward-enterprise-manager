export function renderBlueprintPublicationImpact(manifest, el) {
  const flows = el('ul', { attrs: { 'aria-label': 'Declared process-flow publication impact' } });
  for (const flow of manifest?.flows ?? []) {
    flows.append(el('li', { text: `${flow.processId} · ${flow.status} · ${flow.visitedCount}/${flow.budget} design records visited` }));
  }
  if (!manifest?.flows?.length) flows.append(el('li', { text: 'No saved process flows in this blueprint.' }));
  const source = manifest?.blueprintId
    ? `Blueprint ${manifest.blueprintId} v${manifest.blueprintVersion} · project v${manifest.projectVersion} · source SHA-256 ${manifest.sourceSnapshotHash}`
    : `Project v${manifest?.projectVersion ?? 'unknown'} · no saved blueprint`;
  return el('section', { className: 'blueprint-publication-impact', attrs: { 'aria-label': 'Publication impact preview' } }, [
    el('h5', { text: `Declared flow impact · ${manifest?.status ?? 'UNKNOWN'}` }),
    el('p', { text: source }),
    el('p', { text: `Impact manifest SHA-256 ${manifest?.impactHash ?? 'unavailable'}` }),
    flows,
    el('p', { className: 'edit-help', text: 'This records declared design-flow dependencies only. It does not establish downstream operational currentness or approval status.' }),
  ]);
}
