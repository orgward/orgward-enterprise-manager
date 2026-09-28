export function humanTaskEffectiveAssigneePresentation(runtime) {
  if (!runtime || runtime.actorType !== 'human') return null;
  const overridden = runtime.effectiveAssignmentOverridden === true;
  const candidateName = typeof runtime.effectiveAssigneeDisplayName === 'string'
    ? runtime.effectiveAssigneeDisplayName.trim().slice(0, 120) : '';
  const name = candidateName || '';
  const assignedToCurrentPrincipal = runtime.assignedToCurrentPrincipal === true;
  return {
    label: assignedToCurrentPrincipal ? 'Current assigned human: You'
      : name ? `Current assigned human: ${name}` : 'Current assigned human: Assigned member',
    detail: overridden
      ? 'An owner reassigned this checkpoint. The pinned blueprint actor remains part of the saved plan; this current assignment controls who may act.'
      : 'This current assignment follows the human actor pinned in the saved plan.',
    overridden,
  };
}
