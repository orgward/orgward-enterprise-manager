import { randomUUID } from 'node:crypto';
import { digest, now } from '../sdlc/contracts.mjs';

export const EXECUTION_STATUSES = Object.freeze(['AWAITING_APPROVAL', 'APPROVED', 'PAUSED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CANCELLED']);

function text(value, max = 2_000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function event(type, actor, data) {
  const value = { id: `execution-event-${randomUUID()}`, type, actor: text(actor, 120) || 'system', at: now(), data };
  return { ...value, contentHash: digest(value) };
}

export function createExecutionRun({ tenantId, projectId = null, profile, requestedBy, title, objective, requirements = [], sourceRefs = [], processTaskRef = null, proposalContext = null }) {
  if (!profile) throw new Error('A valid execution profile is required.');
  const cleanTitle = text(title, 160);
  const cleanObjective = text(objective, 4_000);
  if (!cleanTitle || !cleanObjective) throw new Error('Execution title and objective are required.');
  const createdAt = now();
  const run = {
    id: `execution-run-${randomUUID()}`,
    tenantId,
    projectId,
    version: 0,
    status: 'AWAITING_APPROVAL',
    title: cleanTitle,
    requestedBy: text(requestedBy, 120) || 'requester',
    createdAt,
    updatedAt: createdAt,
    profile: {
      id: profile.id, label: profile.label, kind: profile.kind, version: profile.version,
      ...(profile.credentialReference ? { credential: { reference: profile.credentialReference, version: profile.credentialVersion } } : {}),
      ...(profile.providerEndpoint ? { providerDestinationHash: digest(profile.providerEndpoint) } : {}),
      ...(profile.model ? { providerModel: profile.model } : {}),
    },
    workItem: {
      id: `work-item-${randomUUID()}`,
      objective: cleanObjective,
      requirements: [...new Set(requirements.map((entry) => text(entry, 500)).filter(Boolean))].slice(0, 50),
      sourceRefs: [...new Set(sourceRefs.map((entry) => text(entry, 240)).filter(Boolean))].slice(0, 50),
      ...(proposalContext && processTaskRef ? { proposalContext: structuredClone(proposalContext) } : {}),
    },
    ...(processTaskRef ? { processTaskRef: structuredClone(processTaskRef) } : {}),
    approval: null,
    execution: null,
    events: [],
  };
  run.events.push(event('ExecutionRequested', run.requestedBy, {
    profileId: profile.id,
    workItemId: run.workItem.id,
    ...(run.processTaskRef ? {
      processTaskRef: {
        processPlanId: run.processTaskRef.processPlanId,
        revision: run.processTaskRef.revision,
        planInstanceId: run.processTaskRef.planInstanceId,
        taskId: run.processTaskRef.taskId,
        blueprintId: run.processTaskRef.blueprintId,
        blueprintVersion: run.processTaskRef.blueprintVersion,
      },
    } : {}),
  }));
  return run;
}

export function executionApprovalRequestHash(run) {
  const amendmentEvents = run.events?.filter((entry) => entry.type === 'ExecutionInstructionsAmended') ?? [];
  const revisions = run.interventionRevisions ?? [];
  if (amendmentEvents.length !== revisions.length) {
    throw new Error('The amended instruction history is incomplete.');
  }
  if (run.interventionRevisions?.length) {
    let expectedPriorHash = digest({ objective: run.workItem.objective, requirements: run.workItem.requirements });
    run.interventionRevisions.forEach((revision, index) => {
      const { contentHash, ...eventValue } = amendmentEvents[index];
      const snapshot = { objective: revision.objective, requirements: revision.requirements };
      if (revision.revision !== index + 1 || revision.priorInstructionHash !== expectedPriorHash
        || revision.instructionHash !== digest(snapshot)
        || contentHash !== digest(eventValue)
        || digest(amendmentEvents[index]?.data?.revision) !== digest(revision)
        || digest(amendmentEvents[index]?.data?.processTaskRef) !== digest(run.processTaskRef)
        || amendmentEvents[index]?.actor !== revision.actor || amendmentEvents[index]?.at !== revision.at) {
        throw new Error('The amended instruction history does not match its append-only evidence.');
      }
      expectedPriorHash = revision.instructionHash;
    });
  }
  const profile = { id: run.profile?.id, version: run.profile?.version };
  if (run.profile?.credential) profile.credential = run.profile.credential;
  if (run.profile?.providerDestinationHash) profile.providerDestinationHash = run.profile.providerDestinationHash;
  if (run.profile?.providerModel) profile.providerModel = run.profile.providerModel;
  return digest({
    workItem: run.workItem,
    ...(run.interventionRevisions?.length
      ? { interventionRevision: run.interventionRevisions.at(-1).instructionHash } : {}),
    profile,
    ...(run.processTaskRef ? { processTaskRef: run.processTaskRef } : {}),
  });
}

export function amendPausedProcessTaskExecutionRun(run, { principal, commandId, objective, requirements, reason }) {
  if (!run.processTaskRef) throw new Error('Only a saved process task run can be amended.');
  if (run.requestedBy !== principal) throw new Error('Only the requester can amend this execution request.');
  if (run.status !== 'PAUSED' || run.approval !== null || run.execution !== null) {
    throw new Error('Only a paused, unapproved linked run can be amended before execution.');
  }
  const cleanObjective = text(objective, 4_000);
  const cleanReason = text(reason, 1_000);
  const cleanRequirements = Array.isArray(requirements)
    ? [...new Set(requirements.map((entry) => text(entry, 500)).filter(Boolean))].slice(0, 50) : null;
  if (!cleanObjective || !cleanReason || !cleanRequirements) {
    throw new Error('Amended instructions and a reason are required.');
  }
  const prior = run.interventionRevisions?.at(-1);
  const priorInstructionHash = prior?.instructionHash ?? digest({
    objective: run.workItem.objective, requirements: run.workItem.requirements,
  });
  const snapshot = { objective: cleanObjective, requirements: cleanRequirements };
  const revision = {
    revision: (prior?.revision ?? 0) + 1,
    actor: text(principal, 120),
    at: now(),
    reason: cleanReason,
    priorInstructionHash,
    ...snapshot,
    instructionHash: digest(snapshot),
  };
  run.interventionRevisions ??= [];
  run.interventionRevisions.push(revision);
  const priorVersion = run.version;
  run.version += 1;
  run.updatedAt = revision.at;
  const value = {
    id: `execution-event-${randomUUID()}`,
    type: 'ExecutionInstructionsAmended',
    actor: revision.actor,
    at: revision.at,
    causationId: commandId,
    data: { processTaskRef: structuredClone(run.processTaskRef), priorVersion, revision: structuredClone(revision) },
  };
  run.events.push({ ...value, contentHash: digest(value) });
  return run;
}

export function approveExecutionRun(run, { principal, roles = [], authorityGeneration = null }) {
  const staleApprovalRecovery = run.status === 'INTERRUPTED'
    && run.events.at(-1)?.type === 'ExecutionInterrupted'
    && run.events.at(-1)?.data?.reason === 'execution_approval_stale';
  if (run.status !== 'AWAITING_APPROVAL' && !staleApprovalRecovery) {
    throw new Error('Execution run must be awaiting approval or require renewed approval after authority changed.');
  }
  const actor = text(principal, 120);
  if (!actor) throw new Error('Approval principal is required.');
  if (actor === run.requestedBy) throw new Error('The requester cannot approve their own execution run.');
  if (!roles.includes('execution-approver')) throw new Error('Execution approval requires the execution-approver role.');
  run.approval = {
    principal: actor, roles: [...new Set(roles)], approvedAt: now(), requestHash: executionApprovalRequestHash(run),
    authorityGeneration: Number.isSafeInteger(authorityGeneration) ? authorityGeneration : null,
  };
  if (staleApprovalRecovery) run.execution = null;
  run.status = 'APPROVED';
  run.version += 1;
  run.updatedAt = now();
  run.events.push(event(staleApprovalRecovery ? 'ExecutionReapproved' : 'ExecutionApproved', actor, {
    requestHash: run.approval.requestHash,
    ...(staleApprovalRecovery ? { reason: 'execution_approval_stale' } : {}),
  }));
  return run;
}

export function cancelProcessTaskExecutionRun(run, { principal, commandId }) {
  if (!run.processTaskRef) throw new Error('Only a saved process task run can be withdrawn.');
  if (run.requestedBy !== principal) throw new Error('Only the requester can withdraw this execution request.');
  if (!['AWAITING_APPROVAL', 'APPROVED', 'PAUSED'].includes(run.status)) {
    throw new Error('Only a pending or approved run can be withdrawn before work starts.');
  }
  const persistedVersion = run.version;
  const priorStatus = run.status;
  run.status = 'CANCELLED';
  run.version += 1;
  run.updatedAt = now();
  const value = {
    id: `execution-event-${randomUUID()}`,
    type: 'ExecutionCancelled',
    actor: text(principal, 120) || 'requester',
    at: run.updatedAt,
    causationId: commandId,
    data: {
      processTaskRef: {
        processPlanId: run.processTaskRef.processPlanId,
        revision: run.processTaskRef.revision,
        planInstanceId: run.processTaskRef.planInstanceId,
        taskId: run.processTaskRef.taskId,
      },
      priorStatus,
      fromVersion: persistedVersion,
    },
  };
  run.events.push({ ...value, contentHash: digest(value) });
  return run;
}

export function pauseProcessTaskExecutionRun(run, { principal, commandId, instanceControl = false, actor = null }) {
  if (!run.processTaskRef) throw new Error('Only a saved process task run can be paused.');
  if (!instanceControl && run.requestedBy !== principal) throw new Error('Only the requester can pause this execution request.');
  if (!['AWAITING_APPROVAL', 'APPROVED'].includes(run.status)) {
    throw new Error('Only a pending or approved linked run can be paused before work starts.');
  }
  const priorVersion = run.version;
  const priorStatus = run.status;
  run.status = 'PAUSED';
  run.version += 1;
  run.updatedAt = now();
  if (priorStatus === 'APPROVED') run.approval = null;
  const value = {
    id: `execution-event-${randomUUID()}`,
    type: 'ExecutionPaused',
    actor: text(actor ?? principal, 120) || 'requester',
    at: run.updatedAt,
    causationId: commandId,
    data: {
      processTaskRef: {
        processPlanId: run.processTaskRef.processPlanId,
        revision: run.processTaskRef.revision,
        planInstanceId: run.processTaskRef.planInstanceId,
        taskId: run.processTaskRef.taskId,
      },
      priorStatus,
      approvalInvalidated: priorStatus === 'APPROVED',
      fromVersion: priorVersion,
    },
  };
  run.events.push({ ...value, contentHash: digest(value) });
  return run;
}

export function pauseUndispatchedProcessTaskExecutionRun(run, { actor, commandId }) {
  if (!run.processTaskRef || run.status !== 'RUNNING') throw new Error('Only a running linked task can pause at a process-instance boundary.');
  const priorVersion = run.version;
  run.status = 'PAUSED';
  run.approval = null;
  run.execution = null;
  run.version += 1;
  run.updatedAt = now();
  const value = {
    id: `execution-event-${randomUUID()}`,
    type: 'ExecutionPaused', actor: text(actor, 120) || 'process instance controller',
    at: run.updatedAt, causationId: commandId,
    data: {
      processTaskRef: structuredClone(run.processTaskRef),
      priorStatus: 'RUNNING', approvalInvalidated: true, processInstanceBoundary: true,
      instructionRevision: run.interventionRevisions?.at(-1)?.revision ?? 0,
      instructionHash: digest(run.interventionRevisions?.at(-1) ?? run.workItem),
      fromVersion: priorVersion,
    },
  };
  run.events.push({ ...value, contentHash: digest(value) });
  return run;
}

export function resumeProcessTaskExecutionRun(run, { principal, commandId, ownerRecovery = false, reason = null }) {
  if (!run.processTaskRef) throw new Error('Only a saved process task run can be resumed.');
  if (!ownerRecovery && run.requestedBy !== principal) throw new Error('Only the requester can resume this execution request.');
  if (ownerRecovery && (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500)) {
    throw new Error('Project owner recovery requires a short reason.');
  }
  if (run.status !== 'PAUSED') throw new Error('Only a paused linked run can be resumed.');
  const priorVersion = run.version;
  run.status = 'AWAITING_APPROVAL';
  run.approval = null;
  run.version += 1;
  run.updatedAt = now();
  const value = {
    id: `execution-event-${randomUUID()}`,
    type: 'ExecutionResumed',
    actor: text(principal, 120) || 'requester',
    at: run.updatedAt,
    causationId: commandId,
    data: {
      processTaskRef: {
        processPlanId: run.processTaskRef.processPlanId,
        revision: run.processTaskRef.revision,
        planInstanceId: run.processTaskRef.planInstanceId,
        taskId: run.processTaskRef.taskId,
      },
      priorStatus: 'PAUSED',
      requiresFreshApproval: true,
      fromVersion: priorVersion,
      ...(ownerRecovery ? { ownerRecovery: true, reason: text(reason, 500), originalRequester: run.requestedBy } : {}),
    },
  };
  run.events.push({ ...value, contentHash: digest(value) });
  return run;
}

export function executionEvent(run, type, actor, data) {
  run.events.push(event(type, actor, data));
  run.updatedAt = now();
  return run;
}

export function executionRunView(run) {
  const view = structuredClone(run);
  if (view.execution?.workspace) {
    delete view.execution.workspace;
    view.execution.workspaceRef = `workspace:${run.id}`;
  }
  return view;
}
