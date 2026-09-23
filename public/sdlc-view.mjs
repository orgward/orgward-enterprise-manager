function clarificationModel(entry, currentRevision) {
  const isCurrent = entry.intentRevision === currentRevision;
  const control = isCurrent && entry.status === 'OPEN' ? 'ANSWER'
    : isCurrent && entry.status === 'ANSWERED' ? 'RECONCILE'
      : 'NONE';
  return {
    id: entry.id,
    status: entry.status,
    question: entry.question,
    rationale: entry.rationale,
    targetField: entry.targetField,
    eligibleRespondent: entry.eligibleRespondent,
    answer: entry.answer?.value ?? null,
    intentRevisionAfter: entry.intentRevisionAfter ?? null,
    isCurrent,
    control,
  };
}

function actionModel(action) {
  if (!action) return null;
  return {
    id: action.id,
    action: action.action,
    destination: action.destination,
    status: action.status,
    owner: action.owner,
    reason: action.reason,
    outcome: action.outcome,
    completionSummary: action.completionSummary,
    attempt: action.attempt,
  };
}

function proofModel(changeCase, proof, attemptLimit) {
  const results = changeCase.proofs.results.filter((entry) => (
    entry.proofRef === proof.id && entry.intentRevision === changeCase.intent.revision
  ));
  const result = results.at(-1) ?? null;
  const actionFor = (resultRef) => changeCase.proofs.actions.find((entry) => entry.resultRef === resultRef) ?? null;
  const action = result ? actionFor(result.id) : null;
  const attempts = changeCase.proofs.loopCounters[proof.id] ?? 0;
  let control = 'RECORD_RESULT';
  if (action?.status === 'READY') control = 'RESUME';
  else if (action?.status === 'IN_PROGRESS') control = 'COMPLETE';
  else if (!action && ['FAIL', 'INDETERMINATE'].includes(result?.status)) control = 'ROUTE';
  if (changeCase.status === 'STOPPED') control = 'NONE';

  return {
    id: proof.id,
    criterion: proof.criterion,
    required: proof.required,
    evaluatorType: proof.evaluatorType,
    intentRevision: proof.intentRevision,
    resultStatus: result?.status ?? 'NOT RUN',
    result: result ? {
      id: result.id,
      status: result.status,
      summary: result.summary,
      observations: [...result.observations],
    } : null,
    action: actionModel(action),
    attempts,
    attemptLimit,
    control,
    routeChoices: attempts >= attemptLimit
      ? [['STOP', 'Stop work']]
      : [['REPAIR', 'Repair implementation'], ['CLARIFY', 'Request clarification'], ['REPLAN', 'Re-plan work'], ['REARCHITECT', 'Re-architect design'], ['STOP', 'Stop work']],
    history: results.slice(0, -1).reverse().map((entry) => ({
      id: entry.id,
      status: entry.status,
      summary: entry.summary,
      recordedAt: entry.recordedAt,
      action: actionModel(actionFor(entry.id)),
    })),
  };
}

function checkpointModel(changeCase, stages) {
  const last = changeCase.gateHistory.at(-1);
  if (changeCase.status === 'PASSED') {
    return { title: 'Reference loop complete', body: 'The full lineage is saved. Learning proposed a follow-up but did not silently rewrite enterprise truth.', control: 'NONE' };
  }
  if (changeCase.status === 'STOPPED') {
    const stopped = changeCase.proofs.actions.findLast((entry) => entry.action === 'STOP');
    return { title: 'Work stopped by the accountable owner', body: stopped?.reason ?? 'The case has a terminal stop decision.', control: 'NONE' };
  }
  if (changeCase.status === 'BLOCKED' || changeCase.status === 'FAILED') {
    return { title: `${last?.gate ?? 'Gate'} blocked safely`, body: last?.findings?.[0]?.message ?? 'A blocking invariant failed.', remediation: last?.findings?.[0]?.remediation ?? 'Repair the evidence or design before retrying.', control: 'NONE' };
  }
  if (changeCase.status === 'NEEDS_HUMAN' && changeCase.currentStage === 'S9') {
    return { title: 'Independent release approval', body: 'A HIGH-risk production-like release cannot be self-approved by the implementation principal.', control: 'APPROVE_RELEASE' };
  }
  if (changeCase.status === 'NEEDS_HUMAN' && changeCase.currentStage === 'S10') {
    return { title: 'Outcome observation required', body: 'Record a synthetic observation. The default proves technical success can coexist with a failed business outcome.', control: 'RECORD_OBSERVATION' };
  }
  const stage = stages[changeCase.currentStageIndex];
  return {
    title: stage ? `${stage.id} · ${stage.label}` : 'Ready',
    body: stage ? `Next: execute the stage and evaluate ${stage.gate} — ${stage.gateLabel}.` : 'No stage remains.',
    control: 'ADVANCE',
  };
}

export function caseUiModel(changeCase, meta = {}) {
  const attemptLimit = meta.proofActionAttemptLimit ?? 2;
  const revision = changeCase.intent.revision;
  return {
    queue: {
      nextAction: { ...changeCase.workspace.nextAllowedAction },
      questions: changeCase.workspace.questions.map((entry) => ({ ...entry })),
      proofGaps: changeCase.workspace.proofGaps.map((entry) => ({ ...entry })),
      failedResults: changeCase.workspace.failedResults.map((entry) => ({ ...entry })),
    },
    clarifications: changeCase.clarifications.map((entry) => clarificationModel(entry, revision)),
    proofs: changeCase.proofs.obligations
      .filter((entry) => entry.intentRevision === revision)
      .map((entry) => proofModel(changeCase, entry, attemptLimit)),
    checkpoint: checkpointModel(changeCase, meta.stages ?? []),
  };
}
