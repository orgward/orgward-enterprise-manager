export function processTaskGuidanceReview(run) {
  const ref = run?.processTaskRef;
  if (!ref || !run.workItem?.proposalContext) return null;
  const snapshot = run.workItem.taskGuidance;
  if (!snapshot) {
    return {
      kind: 'legacy',
      message: 'This saved model task predates pinned role-guidance snapshots. Its prompt uses the saved task, target and source envelope; current editable role text is not added.',
    };
  }
  const envelope = run.workItem.proposalContext.sourceEnvelope;
  if (typeof snapshot.roleId !== 'string' || snapshot.roleId !== ref.roleId
    || typeof snapshot.actorId !== 'string' || snapshot.actorId !== ref.actorId
    || typeof snapshot.blueprintId !== 'string' || snapshot.blueprintId !== ref.blueprintId
    || snapshot.blueprintVersion !== ref.blueprintVersion
    || !Number.isSafeInteger(snapshot.blueprintVersion) || snapshot.graphRevision !== ref.revision
    || !Number.isSafeInteger(snapshot.graphRevision)
    || typeof snapshot.proposedInstructions !== 'string' || snapshot.proposedInstructions.length > 700
    || !Array.isArray(snapshot.proposedScope) || !snapshot.proposedScope.length || snapshot.proposedScope.length > 12
    || snapshot.proposedScope.some((entry) => typeof entry !== 'string' || !entry.trim() || entry.length > 240)
    || envelope?.blueprintId !== ref.blueprintId || envelope?.blueprintVersion !== ref.blueprintVersion
    || !/^[a-f0-9]{64}$/.test(snapshot.guidanceDigest ?? '')) {
    return { kind: 'unavailable', message: 'The saved task-guidance snapshot does not match this run reference.' };
  }
  return {
    kind: 'snapshot',
    roleId: snapshot.roleId,
    actorId: snapshot.actorId,
    blueprintVersion: snapshot.blueprintVersion,
    graphRevision: snapshot.graphRevision,
    proposedInstructions: snapshot.proposedInstructions.trim() || 'Not specified',
    proposedScope: snapshot.proposedScope.map((entry) => typeof entry === 'string' && entry.trim()).filter(Boolean),
  };
}
