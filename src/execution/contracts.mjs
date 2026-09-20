import { randomUUID } from 'node:crypto';
import { digest, now } from '../sdlc/contracts.mjs';

export const EXECUTION_STATUSES = Object.freeze(['AWAITING_APPROVAL', 'APPROVED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED']);

function text(value, max = 2_000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function event(type, actor, data) {
  const value = { id: `execution-event-${randomUUID()}`, type, actor: text(actor, 120) || 'system', at: now(), data };
  return { ...value, contentHash: digest(value) };
}

export function createExecutionRun({ tenantId, profile, requestedBy, title, objective, requirements = [], sourceRefs = [] }) {
  if (!profile) throw new Error('A valid execution profile is required.');
  const cleanTitle = text(title, 160);
  const cleanObjective = text(objective, 4_000);
  if (!cleanTitle || !cleanObjective) throw new Error('Execution title and objective are required.');
  const createdAt = now();
  const run = {
    id: `execution-run-${randomUUID()}`,
    tenantId,
    version: 0,
    status: 'AWAITING_APPROVAL',
    title: cleanTitle,
    requestedBy: text(requestedBy, 120) || 'requester',
    createdAt,
    updatedAt: createdAt,
    profile: { id: profile.id, label: profile.label, kind: profile.kind, version: profile.version },
    workItem: {
      id: `work-item-${randomUUID()}`,
      objective: cleanObjective,
      requirements: [...new Set(requirements.map((entry) => text(entry, 500)).filter(Boolean))].slice(0, 50),
      sourceRefs: [...new Set(sourceRefs.map((entry) => text(entry, 240)).filter(Boolean))].slice(0, 50),
    },
    approval: null,
    execution: null,
    events: [],
  };
  run.events.push(event('ExecutionRequested', run.requestedBy, { profileId: profile.id, workItemId: run.workItem.id }));
  return run;
}

export function approveExecutionRun(run, { principal, roles = [] }) {
  if (run.status !== 'AWAITING_APPROVAL') throw new Error('Execution run is not awaiting approval.');
  const actor = text(principal, 120);
  if (!actor) throw new Error('Approval principal is required.');
  if (actor === run.requestedBy) throw new Error('The requester cannot approve their own execution run.');
  if (!roles.includes('execution-approver')) throw new Error('Execution approval requires the execution-approver role.');
  run.approval = { principal: actor, roles: [...new Set(roles)], approvedAt: now(), requestHash: digest(run.workItem) };
  run.status = 'APPROVED';
  run.version += 1;
  run.updatedAt = now();
  run.events.push(event('ExecutionApproved', actor, { requestHash: run.approval.requestHash }));
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
