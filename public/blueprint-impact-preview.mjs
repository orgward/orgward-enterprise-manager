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
  const processFlows = el('ul');
  for (const flow of preview.directlyReferencingProcessFlows ?? []) {
    processFlows.append(el('li', { text: `${flow.name} (${flow.processId}) · decision steps: ${(flow.afterDecisionStepIds ?? flow.beforeDecisionStepIds).join(', ')} · process snapshot SHA-256 ${flow.afterProcessSnapshotHash ?? flow.beforeProcessSnapshotHash}` }));
  }
  const unknownList = el('ul');
  for (const unknown of preview.unknownAreas ?? []) unknownList.append(el('li', { text: unknown }));
  const dependencyPaths = el('ul');
  for (const entry of preview.dependencyTraversal?.paths ?? []) {
    const explanation = (entry.path ?? []).map((step) => step.field
      ? `${step.objectId} via ${step.field}`
      : `${step.relation ?? 'depends on'} ${step.objectId}${step.edgeState ? ` (${step.edgeState.toLowerCase()})` : ''}`).join(' → ');
    dependencyPaths.append(el('li', { text: `${entry.name} (${entry.objectId}) · ${entry.type} · ${explanation}` }));
  }
  const sensitivity = preview.fieldSensitivity;
  const sensitivityFields = (sensitivity?.fields ?? []).map((entry) =>
    `${entry.kind}: ${entry.field} · ${entry.reason}`);
  const branchPin = preview.source.kind === 'BRANCH_DRAFT'
    ? ` · branch ${preview.source.branchId} revision ${preview.source.branchRevision} · main blueprint ${preview.source.mainBlueprintId} v${preview.source.mainBlueprintVersion} SHA-256 ${preview.source.mainSnapshotHash}`
    : '';
  const proposed = preview.proposedBranchRevision
    ? `Proposed branch revision ${preview.proposedBranchRevision} · blueprint v${preview.proposedBlueprintVersion}.`
    : `Proposed result would be blueprint v${preview.proposedBlueprintVersion}.`;
  return el('section', { className: 'blueprint-impact-preview', attrs: { 'aria-label': 'Proposed design impact preview', 'aria-live': 'polite' } }, [
    el('h4', { text: `Impact preview · ${preview.status}` }),
    el('p', { text: `Source blueprint ${preview.source.blueprintId} v${preview.source.blueprintVersion} · workspace v${preview.source.projectVersion}${branchPin} · SHA-256 ${preview.source.snapshotHash}` }),
    el('p', { text: `Direct blueprint relationships computed. ${proposed}` }),
    el('h5', { text: 'Changed fields' }), fieldList,
    ...(sensitivity ? [el('h5', { text: `Declared field sensitivity · ${sensitivity.classification}` }),
      el('p', { text: sensitivity.reason ?? (sensitivity.layoutOnly ? 'Presentation order only; no semantic field changed.' : 'Material changes use the exact changed-field paths below.') }),
      el('ul', {}, sensitivityFields.map((entry) => el('li', { text: entry })))] : []),
    el('h5', { text: 'Directly affected saved design records' }), affectedList,
    ...(preview.directlyReferencingProcessFlows ? [el('h5', { text: 'Process flows referencing this decision' }), processFlows] : []),
    ...(preview.dependencyTraversal ? [el('h5', { text: `Reverse dependency paths · ${preview.dependencyTraversal.status}` }),
      el('p', { text: `${preview.dependencyTraversal.visitedCount} design records visited; traversal budget ${preview.dependencyTraversal.budget}.` }), dependencyPaths] : []),
    el('h5', { text: 'Not computed by this preview' }), unknownList,
    el('p', { className: 'edit-help', text: preview.limitation }),
  ]);
}
