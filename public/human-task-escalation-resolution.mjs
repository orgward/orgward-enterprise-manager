export function humanTaskEscalationResolutionOptions({ instanceControlStatus, reassignmentAvailable = false } = {}) {
  const paused = instanceControlStatus === 'PAUSED';
  const pauseRequested = instanceControlStatus === 'PAUSE_REQUESTED';
  const pauseFence = paused || pauseRequested;
  return {
    paused,
    pauseRequested,
    initialChoiceRequired: pauseFence,
    pauseMessage: paused
      ? 'This process instance is paused. Resume the process instance before a project owner resolves this escalated checkpoint.'
      : pauseRequested
        ? 'This process instance is draining a pause request. Resolve this checkpoint as succeeded or failed to reach the pause boundary; resume or reassignment is unavailable until the instance is resumed.'
      : '',
    resume: {
      disabled: pauseFence,
      label: paused ? 'Resume unavailable · instance is paused'
        : pauseRequested ? 'Resume unavailable · instance pause is pending' : 'Resume assigned human task',
    },
    reassign: {
      disabled: pauseFence || !reassignmentAvailable,
      label: paused ? 'Reassignment unavailable · instance is paused'
        : pauseRequested ? 'Reassignment unavailable · instance pause is pending'
        : reassignmentAvailable ? 'Reassign to an eligible project human' : 'Reassignment unavailable · no eligible human members',
    },
    succeeded: { disabled: paused },
    failed: { disabled: paused },
  };
}
