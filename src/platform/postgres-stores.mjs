import { randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, readlink } from 'node:fs/promises';
import path from 'node:path';
import {
  canonicalJson,
  contentHash,
  persistenceIntegrity,
  recordEvent,
  verifyAggregateRow,
  verifyCommandRow,
} from './postgres.mjs';
import { releaseApprovalCandidate } from '../sdlc/engine.mjs';
import { digest } from '../sdlc/contracts.mjs';
import { buildBlueprintProposalPrompt } from '../execution/proposals.mjs';
import {
  cancelProcessTaskExecutionRun,
  amendPausedProcessTaskExecutionRun,
  executionApprovalRequestHash,
  pauseProcessTaskExecutionRun,
  pauseUndispatchedProcessTaskExecutionRun,
  resumeProcessTaskExecutionRun,
} from '../execution/contracts.mjs';

const IDENTIFIERS = {
  project: /^project-[0-9a-f-]{36}$/,
  change_case: /^change-case-[0-9a-f-]{36}$/,
  execution_run: /^execution-run-[0-9a-f-]{36}$/,
};
const HUMAN_APPROVER_ROLES = new Set(['execution-approver', 'release-approver', 'control-owner']);

function requiresHumanApprover(roles) {
  return Array.isArray(roles) && roles.some((role) => HUMAN_APPROVER_ROLES.has(role));
}

function conflict(message, currentVersion = null, code = 'VERSION_CONFLICT') {
  const error = new Error(message);
  Object.assign(error, {
    statusCode: 409,
    code,
    currentVersion,
    retryable: code === 'VERSION_CONFLICT',
    recoveryActions: code === 'VERSION_CONFLICT'
      ? [{ type: 'reload', label: 'Reload current version' }, { type: 'retry', label: 'Retry with retained input' }]
      : [],
  });
  return error;
}

function projectAccessDenied() {
  const error = new Error('Project membership does not allow this action.');
  Object.assign(error, { statusCode: 403, code: 'ACTION_FORBIDDEN', retryable: false });
  return error;
}

async function lockProjectAccess(client, { tenantId, projectId, principal, minimum = 'reader' }) {
  if (!principal || !projectId) throw projectAccessDenied();
  const identity = await client.query(`
    select principal from orgward.oidc_principals
    where tenant_id = $1 and principal = $2 and status = 'active'
    for share
  `, [tenantId, principal]);
  if (!identity.rowCount) throw projectAccessDenied();
  const membership = await client.query(`
    select access, generation from orgward.project_memberships
    where tenant_id = $1 and project_id = $2 and principal = $3 and revoked_at is null
    for share
  `, [tenantId, projectId, principal]);
  if (!membership.rowCount) throw projectAccessDenied();
  const access = membership.rows[0].access;
  if (minimum === 'editor' && !['owner', 'editor'].includes(access)) throw projectAccessDenied();
  if (minimum === 'owner' && access !== 'owner') throw projectAccessDenied();
  const project = await client.query(`
    select 1 from orgward.aggregates
    where tenant_id = $1 and aggregate_kind = 'project' and aggregate_id = $2
    for key share
  `, [tenantId, projectId]);
  if (!project.rowCount) throw projectAccessDenied();
  return { access, generation: Number(membership.rows[0].generation) };
}

async function lockIdentityRows(client, tenantId, principals) {
  const keys = [...new Set(principals.filter((principal) => typeof principal === 'string' && principal))].sort();
  if (!keys.length) return new Map();
  const result = await client.query(`
    select principal, status, actor_type, roles, authz_generation
    from orgward.oidc_principals
    where tenant_id = $1 and principal = any($2::text[])
    order by principal
    for share
  `, [tenantId, keys]);
  return new Map(result.rows.map((row) => [row.principal, row]));
}

async function requirePrincipalAuthority(client, {
  tenantId, principal, roles = [], anyRoleGroups = [], authzGeneration, actorType = null,
}) {
  const identity = await client.query(`
    select status, actor_type, roles, authz_generation from orgward.oidc_principals
    where tenant_id = $1 and principal = $2 for share
  `, [tenantId, principal]);
  if (!identity.rowCount || identity.rows[0].status !== 'active'
    || roles.some((role) => !identity.rows[0].roles.includes(role))
    || anyRoleGroups.some((group) => !group.some((role) => identity.rows[0].roles.includes(role)))) {
    const error = new Error('The identity no longer has the required authority for this operation.');
    Object.assign(error, { statusCode: 403, code: 'ACTION_FORBIDDEN', retryable: false });
    throw error;
  }
  if (actorType && identity.rows[0].actor_type !== actorType) {
    const error = new Error('Human identity is required for this approval.');
    Object.assign(error, { statusCode: 403, code: 'HUMAN_APPROVER_REQUIRED', retryable: false });
    throw error;
  }
  if (!Number.isSafeInteger(authzGeneration)
    || Number(identity.rows[0].authz_generation) !== authzGeneration) {
    throw conflict('The identity authority changed before this operation was saved.', null, 'AUTHORITY_GENERATION_STALE');
  }
}

function processTaskRuntimeView(row, principal = null) {
  const events = Array.isArray(row.events) ? row.events.map((entry) => ({
    id: entry.id, type: entry.type, at: entry.at,
    actor: entry.type === 'HumanTaskEscalationResolved' ? 'project owner'
      : String(entry.type ?? '').startsWith('HumanTask') ? 'assigned human' : entry.actor,
    data: structuredClone(entry.data ?? {}),
  })) : [];
  return {
    projectId: row.project_id,
    processPlanId: row.process_plan_id,
    revision: Number(row.plan_revision),
    planInstanceId: row.plan_instance_id,
    taskId: row.task_id,
    blueprintId: row.blueprint_id,
    blueprintVersion: Number(row.blueprint_version),
    processId: row.process_id,
    actorId: row.actor_id,
    roleId: row.role_id,
    actorType: row.actor_type,
    status: row.status,
    executionRunId: row.execution_run_id,
    version: Number(row.version),
    outcome: structuredClone(row.outcome ?? {}),
    evidence: structuredClone(row.evidence ?? []),
    events,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assignedToCurrentPrincipal: Boolean(principal && row.assigned_to_current_principal),
      canResolveEscalation: Boolean(principal && row.can_resolve_escalation),
    instanceControl: row.instance_control_status ? {
      status: row.instance_control_status,
      version: Number(row.instance_control_version),
      canControl: Boolean(row.can_control_instance),
      canRecover: Boolean(row.can_recover_instance),
      pauseReason: row.instance_control_pause_reason ?? null,
      pauseBoundary: structuredClone(row.instance_control_pause_boundary ?? {}),
      events: structuredClone(row.instance_control_events ?? []),
      canAbandonUnverified: Boolean(row.can_abandon_unverified),
    } : null,
  };
}

function validateHumanTaskNotes(evidence, { required = false } = {}) {
  if (!Array.isArray(evidence) || evidence.length > 20
    || evidence.some((entry) => typeof entry !== 'string' || !entry.trim() || entry.trim().length > 1000)
    || (required && evidence.length === 0)) {
    throw conflict('Provide up to 20 short evidence notes; at least one is required for a succeeded resolution.', null, 'INVALID_HUMAN_TASK_OUTCOME');
  }
  return evidence.map((entry) => entry.trim());
}

function validateHumanTaskReason(reason) {
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 1000) {
    throw conflict('Provide a short reason of up to 1000 characters.', null, 'INVALID_HUMAN_TASK_ESCALATION');
  }
  return reason.trim();
}

async function hasVerifiedHumanTaskSuccess(client, runtime) {
  const outcome = runtime?.outcome;
  const evidence = runtime?.evidence;
  if (runtime?.actor_type !== 'human' || outcome?.result !== 'succeeded'
    || !Array.isArray(evidence) || evidence.length === 0
    || evidence.some((entry) => typeof entry !== 'string' || !entry.trim())
    || !runtime.completed_at || !Array.isArray(runtime.events)) return false;

  const sameEvidence = (candidate) => contentHash(candidate) === contentHash(evidence);
  const sameTaskRef = (data) => data?.taskId === runtime.task_id
    && data.processPlanId === runtime.process_plan_id
    && Number(data.revision) === Number(runtime.plan_revision)
    && data.planInstanceId === runtime.plan_instance_id;
  const successfulEvents = runtime.events.filter((event) => {
    if (!sameTaskRef(event?.data) || !event.id || typeof event.actor !== 'string' || !event.actor) return false;
    const { contentHash: declaredContentHash, ...eventContent } = event;
    if (!declaredContentHash || contentHash(eventContent) !== declaredContentHash) return false;
    if (event.type === 'HumanTaskCompleted') {
      return event.actor === runtime.assigned_principal
        && event.data.result === 'succeeded' && Array.isArray(event.data.evidence)
        && sameEvidence(event.data.evidence)
        && sameEvidence(evidence);
    }
    if (event.type === 'HumanTaskEscalationResolved') {
      return event.data.disposition === 'succeeded'
        && typeof event.data.reason === 'string' && Boolean(event.data.reason.trim())
        && Array.isArray(event.data.evidence) && event.data.evidence.length > 0
        && sameEvidence(event.data.evidence) && sameEvidence(evidence);
    }
    return false;
  });
  if (successfulEvents.length !== 1) return false;

  const event = successfulEvents[0];
  const aggregateId = `${runtime.plan_instance_id}:${runtime.task_id}`;
  const audited = await client.query(`
    select 1 from orgward.audit_log
    where tenant_id=$1 and aggregate_kind='process_task_instance' and aggregate_id=$2
      and event_type=$3 and actor=$4 and event=$5::jsonb and event_hash=$6
  `, [runtime.tenant_id, aggregateId, event.type, event.actor,
    canonicalJson(event), contentHash(event)]);
  return audited.rowCount === 1;
}

async function selectProcessTaskRuntimeForPrincipal(client, {
  tenantId, projectId, planInstanceId, taskId, principal, authzGeneration, forUpdate = false,
}) {
  return client.query(`
    select r.*,
      (r.assigned_principal = $5 and assigned.status = 'active'
        and r.assigned_authz_generation = assigned.authz_generation
        and r.assigned_membership_generation = assigned_membership.generation
        and assigned_membership.revoked_at is null) as assigned_to_current_principal,
      (caller.status = 'active' and caller.actor_type = 'human'
        and caller.authz_generation = $6 and caller.roles @> array['workspace-write']::text[]
        and caller_membership.access = 'owner' and caller_membership.revoked_at is null)
        as can_resolve_escalation
    from orgward.process_task_instances r
    left join orgward.oidc_principals assigned
      on assigned.tenant_id = r.tenant_id and assigned.principal = r.assigned_principal
    left join orgward.project_memberships assigned_membership
      on assigned_membership.tenant_id = r.tenant_id and assigned_membership.project_id = r.project_id
        and assigned_membership.principal = r.assigned_principal
    left join orgward.oidc_principals caller
      on caller.tenant_id = r.tenant_id and caller.principal = $5
    left join orgward.project_memberships caller_membership
      on caller_membership.tenant_id = r.tenant_id and caller_membership.project_id = r.project_id
        and caller_membership.principal = $5
    where r.tenant_id = $1 and r.project_id = $2 and r.plan_instance_id = $3 and r.task_id = $4
    ${forUpdate ? 'for update of r' : ''}
  `, [tenantId, projectId, planInstanceId, taskId, principal, authzGeneration]);
}

function processTaskRuntimeEvent(type, actor, data, causationId = null) {
  const value = { id: `process-task-event-${randomUUID()}`, type, actor, at: new Date().toISOString(), data,
    ...(causationId ? { causationId } : {}) };
  return { ...value, contentHash: contentHash(value) };
}

function assertLinkedWorkloadRuntime(runtime, run) {
  const ref = run.processTaskRef;
  if (!ref || !runtime || runtime.project_id !== run.projectId
    || runtime.process_plan_id !== ref.processPlanId || Number(runtime.plan_revision) !== ref.revision
    || runtime.plan_instance_id !== ref.planInstanceId || runtime.task_id !== ref.taskId
    || runtime.blueprint_id !== ref.blueprintId || Number(runtime.blueprint_version) !== ref.blueprintVersion
    || runtime.actor_id !== ref.actorId || runtime.role_id !== ref.roleId
    || runtime.actor_type !== 'workload' || runtime.execution_run_id !== run.id
    || runtime.status !== run.status) {
    throw persistenceIntegrity('The canonical process task runtime does not match its linked run reference.');
  }
  return runtime;
}

async function syncProcessTaskRuntimeFromRun(client, run, { commandId = null } = {}) {
  const ref = run.processTaskRef;
  if (!ref) return;
  const selected = await client.query(`
    select * from orgward.process_task_instances
    where tenant_id = $1 and plan_instance_id = $2 and task_id = $3
    for update
  `, [run.tenantId, ref.planInstanceId, ref.taskId]);
  if (!selected.rowCount) throw persistenceIntegrity('A linked execution run has no canonical process task instance.');
  const current = selected.rows[0];
  if (current.project_id !== run.projectId || current.process_plan_id !== ref.processPlanId
    || Number(current.plan_revision) !== ref.revision || current.blueprint_id !== ref.blueprintId
    || Number(current.blueprint_version) !== ref.blueprintVersion || current.actor_id !== ref.actorId
    || current.role_id !== ref.roleId || current.actor_type !== 'workload'
    || current.execution_run_id && current.execution_run_id !== run.id) {
    throw persistenceIntegrity('A process task runtime does not match its immutable execution run reference.');
  }
  if (current.status === run.status && current.execution_run_id === run.id) return;
  const runtimeEvent = processTaskRuntimeEvent('ProcessTaskRunStatusChanged', 'execution run', {
    runId: run.id, status: run.status, runVersion: run.version,
  }, commandId);
  const terminal = ['SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CANCELLED'].includes(run.status);
  await client.query(`
    update orgward.process_task_instances
    set status = $4,
      execution_run_id = $5,
      version = version + 1,
      started_at = case when $4 = 'PAUSED' then null when $4 in ('RUNNING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED') then coalesce(started_at, $6::timestamptz) else started_at end,
      completed_at = case when $7 then $6::timestamptz else null end,
      updated_at = $6::timestamptz,
      events = events || $8::jsonb
    where tenant_id = $1 and plan_instance_id = $2 and task_id = $3
  `, [run.tenantId, ref.planInstanceId, ref.taskId, run.status, run.id, run.updatedAt, terminal, canonicalJson([runtimeEvent])]);
  await recordEvent(client, {
    tenantId: run.tenantId, kind: 'process_task_instance', id: `${ref.planInstanceId}:${ref.taskId}`,
    version: Number(current.version) + 1, commandId, event: runtimeEvent,
  });
}

function processTaskControlEvent(type, actor, planInstanceId, resultingStatus, commandId, data = {}) {
  const value = { id: `process-control-event-${randomUUID()}`, type, actor, at: new Date().toISOString(),
    causationId: commandId, data: { planInstanceId, resultingStatus, ...data } };
  return { ...value, contentHash: contentHash(value) };
}

async function lockProcessTaskControl(client, tenantId, planInstanceId) {
  await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `${tenantId}:process-plan-instance:${planInstanceId}`,
  ]);
  const selected = await client.query(`select * from orgward.process_task_instance_controls
    where tenant_id=$1 and plan_instance_id=$2 for update`, [tenantId, planInstanceId]);
  return selected.rows[0] ?? null;
}

async function lockLinkedRunControl(client, tenantId, runId) {
  const hint = await client.query(`select state->'processTaskRef' as ref from orgward.aggregates
    where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2`, [tenantId, runId]);
  const planInstanceId = hint.rows[0]?.ref?.planInstanceId;
  return planInstanceId ? lockProcessTaskControl(client, tenantId, planInstanceId) : null;
}

function requireActiveProcessTaskControl(control, version = null) {
  requireProcessTaskControlNotAbandoned(control, version);
  if (!control || control.status !== 'ACTIVE') {
    throw conflict('This process instance is paused or pausing; no new task work can start.', version, 'PROCESS_INSTANCE_PAUSED');
  }
}

function requireProcessTaskControlNotAbandoned(control, version = null) {
  if (control?.status === 'ABANDONED_UNVERIFIED') {
    throw conflict('This process instance was closed with an unverified provider outcome and is terminal.',
      version ?? Number(control.version), 'PROCESS_INSTANCE_ABANDONED_UNVERIFIED');
  }
}

async function appendProcessTaskControl(client, control, { status, reason, boundary, actor, commandId, eventType, eventData = {} }) {
  const event = processTaskControlEvent(eventType, actor, control.plan_instance_id, status, commandId, {
    priorStatus: control.status, reason: reason ?? null, boundary: boundary ?? control.pause_boundary, ...eventData,
  });
  const updated = await client.query(`update orgward.process_task_instance_controls
    set status=$3,pause_reason=$4,pause_boundary=$5::jsonb,version=version+1,updated_at=now(),events=events || $6::jsonb
    where tenant_id=$1 and plan_instance_id=$2 and version=$7 returning *`,
  [control.tenant_id, control.plan_instance_id, status, reason ?? null, canonicalJson(boundary ?? control.pause_boundary),
    canonicalJson([event]), Number(control.version)]);
  if (!updated.rowCount) throw conflict('The process instance control changed concurrently.', Number(control.version), 'PROCESS_INSTANCE_CONTROL_CONFLICT');
  await recordEvent(client, { tenantId: control.tenant_id, kind: 'process_task_instance_control',
    id: control.plan_instance_id, version: Number(updated.rows[0].version), commandId, event });
  return updated.rows[0];
}

async function settleProcessTaskPauseIfDrained(client, tenantId, planInstanceId) {
  const controlResult = await client.query(`select * from orgward.process_task_instance_controls
    where tenant_id=$1 and plan_instance_id=$2 for update`, [tenantId, planInstanceId]);
  const control = controlResult.rows[0];
  if (!control || control.status !== 'PAUSE_REQUESTED') return control;
  const active = await client.query(`select 1 from orgward.process_task_instances r
    where r.tenant_id=$1 and r.plan_instance_id=$2 and r.status in ('IN_PROGRESS','ESCALATED','RUNNING') limit 1`, [tenantId, planInstanceId]);
  const lease = await client.query(`select 1 from orgward.execution_worker_leases l
    join orgward.aggregates a on a.tenant_id=l.tenant_id and a.aggregate_kind='execution_run' and a.aggregate_id=l.run_id
    where l.tenant_id=$1 and a.state #>> '{processTaskRef,planInstanceId}'=$2 and l.lease_until>now() limit 1`, [tenantId, planInstanceId]);
  const unresolved = await client.query(`select 1 from orgward.provider_dispatch_attempts d
    join orgward.aggregates a on a.tenant_id=d.tenant_id and a.aggregate_kind='execution_run' and a.aggregate_id=d.run_id
    where d.tenant_id=$1 and a.state #>> '{processTaskRef,planInstanceId}'=$2
      and d.status in ('handed_off','outcome_unknown') limit 1`, [tenantId, planInstanceId]);
  if (active.rowCount || lease.rowCount || unresolved.rowCount) return control;
  const priorPause = (control.events ?? []).findLast?.((entry) => entry.type === 'ProcessTaskInstancePauseRequested');
  const commandId = priorPause?.causationId;
  if (!commandId) throw persistenceIntegrity('A pausing process instance has no durable pause command event.');
  return appendProcessTaskControl(client, control, {
    status: 'PAUSED', reason: control.pause_reason, boundary: control.pause_boundary,
    actor: priorPause.actor ?? control.initiated_by ?? 'system', commandId,
    eventType: 'ProcessTaskInstancePaused',
  });
}

async function requestExecutionLeaseCancellation(client, { tenantId, projectId = null, principal, reason }) {
  if (!principal) return;
  await client.query(`
    update orgward.execution_worker_leases
    set cancel_requested_at = coalesce(cancel_requested_at, now()),
      cancel_reason = coalesce(cancel_reason, $4), updated_at = now()
    where tenant_id = $1
      and ($3::text is null or project_id = $3)
      and lease_until > now() and cancel_requested_at is null
       and (
         principal = $2 or exists (
           select 1 from orgward.aggregates a
           where a.tenant_id = orgward.execution_worker_leases.tenant_id
             and a.aggregate_kind = 'execution_run'
             and a.aggregate_id = orgward.execution_worker_leases.run_id
             and a.state #>> '{approval,principal}' = $2
         )
       )
  `, [tenantId, principal, projectId, reason]);
}

function rowValues(state, kind) {
  if (!IDENTIFIERS[kind]?.test(state?.id ?? '') || !state?.tenantId || !Number.isInteger(state.version) || state.version < 0) {
    throw persistenceIntegrity('Aggregate identity, tenant, or version is invalid.');
  }
  return [state.tenantId, kind, state.id, state.version, canonicalJson(state), contentHash(state), state.updatedAt ?? new Date().toISOString()];
}

async function insertAggregate(client, state, kind) {
  await client.query(`
    insert into orgward.aggregates
      (tenant_id, aggregate_kind, aggregate_id, version, state, state_hash, updated_at)
    values ($1, $2, $3, $4, $5::jsonb, $6, $7::timestamptz)
  `, rowValues(state, kind));
}

async function updateAggregate(client, state, kind, expectedVersion) {
  const values = rowValues(state, kind);
  const result = await client.query(`
    update orgward.aggregates
    set version = $4, state = $5::jsonb, state_hash = $6, updated_at = $7::timestamptz
    where tenant_id = $1 and aggregate_kind = $2 and aggregate_id = $3 and version = $8
  `, [...values, expectedVersion]);
  if (result.rowCount !== 1) throw conflict(`Version conflict: expected persisted version ${expectedVersion}. Reload before retrying.`);
}

class PostgresDocumentStore {
  constructor(persistence, kind) {
    this.persistence = persistence;
    this.kind = kind;
  }

  async init() { await this.persistence.init(); }

  async get(id, tenantId = null) {
    if (!tenantId) throw new Error('Tenant context is required for aggregate reads.');
    const result = await this.persistence.query(
      'select * from orgward.aggregates where tenant_id = $1 and aggregate_kind = $2 and aggregate_id = $3',
      [tenantId, this.kind, id],
    );
    return result.rowCount ? verifyAggregateRow(result.rows[0]) : null;
  }

  async getForPrincipal(id, tenantId, principal) {
    if (!tenantId || !principal) return null;
    const result = await this.persistence.query(`
      select a.*, s.project_id as scoped_project_id
      from orgward.aggregates a
      join orgward.aggregate_project_scopes s
        on s.tenant_id = a.tenant_id and s.aggregate_kind = a.aggregate_kind and s.aggregate_id = a.aggregate_id
      join orgward.project_memberships m
        on m.tenant_id = s.tenant_id and m.project_id = s.project_id and m.principal = $3
      join orgward.oidc_principals p
        on p.tenant_id = m.tenant_id and p.principal = m.principal and p.status = 'active'
      where a.tenant_id = $1 and a.aggregate_kind = $2 and a.aggregate_id = $4
        and m.revoked_at is null
    `, [tenantId, this.kind, principal, id]);
    if (!result.rowCount) return null;
    const state = verifyAggregateRow(result.rows[0]);
    if (Object.hasOwn(state, 'projectId') && state.projectId !== result.rows[0].scoped_project_id) throw persistenceIntegrity('Aggregate project scope does not match aggregate state.');
    state.projectId = result.rows[0].scoped_project_id;
    return state;
  }

  async withPrincipalAuthority({
    id, tenantId, principal, minimumProjectAccess = 'reader',
    requiredPrincipalRoles = [], anyPrincipalRoleGroups = [], authzGeneration, operation,
  }) {
    if (!id || !tenantId || !principal || typeof operation !== 'function') return null;
    return this.persistence.transaction(async (client) => {
      const scope = await client.query(`
        select project_id from orgward.aggregate_project_scopes
        where tenant_id = $1 and aggregate_kind = $2 and aggregate_id = $3
        for key share
      `, [tenantId, this.kind, id]);
      if (!scope.rowCount) return null;
      const projectId = scope.rows[0].project_id;
      let membershipAuthority;
      try { membershipAuthority = await lockProjectAccess(client, { tenantId, projectId, principal, minimum: minimumProjectAccess }); }
      catch (error) {
        if (['ACTION_FORBIDDEN', 'PROJECT_NOT_FOUND'].includes(error.code)) return null;
        throw error;
      }
      if (requiredPrincipalRoles.length || anyPrincipalRoleGroups.length) {
        await requirePrincipalAuthority(client, {
          tenantId, principal, roles: requiredPrincipalRoles,
          anyRoleGroups: anyPrincipalRoleGroups, authzGeneration,
          actorType: requiresHumanApprover(requiredPrincipalRoles) ? 'human' : null,
        });
      }
      const selected = await client.query(`
        select * from orgward.aggregates
        where tenant_id = $1 and aggregate_kind = $2 and aggregate_id = $3
        for share
      `, [tenantId, this.kind, id]);
      if (!selected.rowCount) return null;
      const state = verifyAggregateRow(selected.rows[0]);
      if (Object.hasOwn(state, 'projectId') && state.projectId !== projectId) {
        throw persistenceIntegrity('Aggregate project scope does not match aggregate state.');
      }
      state.projectId = projectId;
      return operation(state, { projectId, ...membershipAuthority });
    });
  }

  async listWithDiagnosticsForPrincipal(tenantId, principal) {
    const result = await this.persistence.query(`
      select a.*, s.project_id as scoped_project_id
      from orgward.aggregates a
      join orgward.aggregate_project_scopes s
        on s.tenant_id = a.tenant_id and s.aggregate_kind = a.aggregate_kind and s.aggregate_id = a.aggregate_id
      join orgward.project_memberships m
        on m.tenant_id = s.tenant_id and m.project_id = s.project_id and m.principal = $2
      join orgward.oidc_principals p
        on p.tenant_id = m.tenant_id and p.principal = m.principal and p.status = 'active'
      where a.tenant_id = $1 and a.aggregate_kind = $3 and m.revoked_at is null
      order by a.updated_at desc, a.aggregate_id
    `, [tenantId, principal, this.kind]);
    const records = [];
    let corruptRecords = 0;
    for (const row of result.rows) {
      try {
        const state = verifyAggregateRow(row);
        if (Object.hasOwn(state, 'projectId') && state.projectId !== row.scoped_project_id) throw persistenceIntegrity('Aggregate project scope does not match aggregate state.');
        state.projectId = row.scoped_project_id;
        records.push(state);
      } catch { corruptRecords += 1; }
    }
    return { records, corruptRecords };
  }

  async listWithPrincipalAuthority({
    tenantId, principal, anyPrincipalRoleGroups = [], authzGeneration, operation,
  }) {
    if (!tenantId || !principal || typeof operation !== 'function') return null;
    return this.persistence.transaction(async (client) => {
      await requirePrincipalAuthority(client, {
        tenantId, principal, anyRoleGroups: anyPrincipalRoleGroups, authzGeneration,
      });
      const result = await client.query(`
        select a.*, s.project_id as scoped_project_id
        from orgward.aggregates a
        join orgward.aggregate_project_scopes s
          on s.tenant_id = a.tenant_id and s.aggregate_kind = a.aggregate_kind and s.aggregate_id = a.aggregate_id
        join orgward.project_memberships m
          on m.tenant_id = s.tenant_id and m.project_id = s.project_id and m.principal = $2
        where a.tenant_id = $1 and a.aggregate_kind = $3 and m.revoked_at is null
        order by a.updated_at desc, a.aggregate_id
        for share of a, m
      `, [tenantId, principal, this.kind]);
      const records = [];
      let corruptRecords = 0;
      for (const row of result.rows) {
        try {
          const state = verifyAggregateRow(row);
          if (Object.hasOwn(state, 'projectId') && state.projectId !== row.scoped_project_id) {
            throw persistenceIntegrity('Aggregate project scope does not match aggregate state.');
          }
          state.projectId = row.scoped_project_id;
          records.push(state);
        } catch { corruptRecords += 1; }
      }
      return operation({ records, corruptRecords });
    });
  }

  async listForPrincipal(tenantId, principal) {
    return (await this.listWithDiagnosticsForPrincipal(tenantId, principal)).records;
  }

  async list(tenantId) { return (await this.listWithDiagnostics(tenantId)).records; }

  async listWithDiagnostics(tenantId) {
    const result = await this.persistence.query(`
      select * from orgward.aggregates
      where tenant_id = $1 and aggregate_kind = $2
      order by updated_at desc, aggregate_id
    `, [tenantId, this.kind]);
    const records = [];
    let corruptRecords = 0;
    for (const row of result.rows) {
      try { records.push(verifyAggregateRow(row)); }
      catch { corruptRecords += 1; }
    }
    return { records, corruptRecords };
  }

  async all() {
    const result = await this.persistence.query('select * from orgward.aggregates where aggregate_kind = $1 order by aggregate_id', [this.kind]);
    return result.rows.map(verifyAggregateRow);
  }

  async save(state, { expectedVersion = null, principal = null, requiredPrincipalRoles = null, authzGeneration = null, validateCurrent = null } = {}) {
    return this.persistence.transaction((client) => this.saveInTransaction(client, state, {
      expectedVersion, principal, requiredPrincipalRoles, authzGeneration, validateCurrent,
    }));
  }

  async saveInTransaction(client, state, {
    expectedVersion = null, principal = null, requiredPrincipalRoles = null,
    authzGeneration = null, workerFinalization = false, instanceControlMutation = false,
    validateCurrent = null, runtimeCommandId = null,
  } = {}) {
      let membershipAuthority = null;
      if (this.kind !== 'project' && principal) {
        membershipAuthority = await lockProjectAccess(client, { tenantId: state.tenantId, projectId: state.projectId, principal, minimum: 'editor' });
      }
      if (requiredPrincipalRoles) {
        if (!principal || !Array.isArray(requiredPrincipalRoles) || !requiredPrincipalRoles.length) throw projectAccessDenied();
        await requirePrincipalAuthority(client, {
          tenantId: state.tenantId, principal, roles: requiredPrincipalRoles, authzGeneration,
          actorType: requiresHumanApprover(requiredPrincipalRoles) ? 'human' : null,
        });
      }
      if (this.kind === 'execution_run' && state.processTaskRef && expectedVersion !== null) {
        const control = await lockProcessTaskControl(client, state.tenantId, state.processTaskRef.planInstanceId);
        if (!control) throw persistenceIntegrity('A linked process task has no durable instance control record.');
        if (workerFinalization && control.status === 'ABANDONED_UNVERIFIED') {
          throw conflict('A late worker result cannot advance an instance closed with an unverified provider outcome.', state.version, 'PROCESS_INSTANCE_ABANDONED_UNVERIFIED');
        }
        if (!instanceControlMutation && ['AWAITING_APPROVAL', 'APPROVED', 'RUNNING'].includes(state.status)) {
          requireActiveProcessTaskControl(control, state.version);
        }
      }
      if (this.kind === 'execution_run' && principal && requiredPrincipalRoles?.includes('execution-approver')) {
        if (state.approval?.principal !== principal || !membershipAuthority?.generation) {
          throw persistenceIntegrity('An execution approval must bind the authenticated project membership.');
        }
        state.approval.projectMembershipGeneration = membershipAuthority.generation;
      }
      let currentProjectId = null;
      if (this.kind !== 'project' && expectedVersion !== null) {
        const scope = await client.query(`
          select project_id from orgward.aggregate_project_scopes
          where tenant_id = $1 and aggregate_kind = $2 and aggregate_id = $3
          for key share
        `, [state.tenantId, this.kind, state.id]);
        currentProjectId = scope.rows[0]?.project_id ?? null;
        if (currentProjectId !== (state.projectId ?? null)) {
          throw conflict('The aggregate project scope cannot be changed by this command.', null, 'PROJECT_SCOPE_CONFLICT');
        }
      }
      const existing = await client.query(`
        select * from orgward.aggregates
        where tenant_id = $1 and aggregate_kind = $2 and aggregate_id = $3
        for update
      `, [state.tenantId, this.kind, state.id]);
      if (this.kind === 'execution_run' && state.processTaskRef && existing.rowCount) {
        const control = await client.query(`select status from orgward.process_task_instance_controls
          where tenant_id=$1 and plan_instance_id=$2`, [state.tenantId, state.processTaskRef.planInstanceId]);
        const current = verifyAggregateRow(existing.rows[0]);
        if (['PAUSED', 'ABANDONED_UNVERIFIED'].includes(control.rows[0]?.status) && current.status === 'RUNNING'
          && ['SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CANCELLED'].includes(state.status)) {
          throw conflict('A late run result cannot change a process instance after its terminal boundary.', current.version,
            control.rows[0]?.status === 'ABANDONED_UNVERIFIED' ? 'PROCESS_INSTANCE_ABANDONED_UNVERIFIED' : 'PROCESS_INSTANCE_PAUSED');
        }
      }
      if (expectedVersion === null) {
        if (existing.rowCount) throw conflict('The aggregate already exists.', Number(existing.rows[0].version));
        await insertAggregate(client, state, this.kind);
        if (this.kind !== 'project' && state.projectId) {
          await client.query(`
            insert into orgward.aggregate_project_scopes
              (tenant_id, aggregate_kind, aggregate_id, project_id)
            values ($1, $2, $3, $4)
          `, [state.tenantId, this.kind, state.id, state.projectId]);
        }
      } else {
        if (!existing.rowCount) throw conflict('The aggregate no longer exists.', null);
        const current = verifyAggregateRow(existing.rows[0]);
        if (validateCurrent) await validateCurrent(current, client);
        if (current.version !== expectedVersion) throw conflict(`Version conflict: expected persisted version ${expectedVersion}. Reload before retrying.`, current.version);
        if (this.kind === 'execution_run' && principal && requiredPrincipalRoles?.includes('execution-approver')) {
          const latestResume = [...(current.events ?? [])].reverse().find((event) => event.type === 'ExecutionResumed');
          if (latestResume?.data?.ownerRecovery === true && latestResume.actor === principal) {
            throw conflict('The owner who recovered this task cannot approve its fresh request.', current.version, 'INDEPENDENT_APPROVER_REQUIRED');
          }
        }
        if (state.version <= expectedVersion) throw persistenceIntegrity('The aggregate version did not advance.');
        if (!workerFinalization && this.kind === 'execution_run' && current.state?.status === 'RUNNING' && state.status !== 'RUNNING') {
          const lease = await client.query(`
            select 1 from orgward.execution_worker_leases
            where tenant_id = $1 and run_id = $2
          `, [state.tenantId, state.id]);
          if (lease.rowCount) {
            throw conflict('Active execution outcomes must pass through the worker authorization fence.', current.version, 'WORKER_FINALIZATION_REQUIRED');
          }
        }
        if (this.kind !== 'project') {
          if (Object.hasOwn(current, 'projectId') && current.projectId !== currentProjectId) {
            throw conflict('The aggregate project scope cannot be changed by this command.', current.version, 'PROJECT_SCOPE_CONFLICT');
          }
        }
        const currentEvents = Array.isArray(current.events) ? current.events : [];
        const nextEvents = Array.isArray(state.events) ? state.events : [];
        if (nextEvents.length < currentEvents.length || contentHash(nextEvents.slice(0, currentEvents.length)) !== contentHash(currentEvents)) {
          throw persistenceIntegrity('Persisted event history cannot be removed or rewritten.');
        }
        await updateAggregate(client, state, this.kind, expectedVersion);
      }
      const priorEventCount = existing.rowCount && Array.isArray(existing.rows[0].state?.events) ? existing.rows[0].state.events.length : 0;
      const newEvents = Array.isArray(state.events) ? state.events.slice(priorEventCount) : [];
      for (const event of newEvents) {
        await recordEvent(client, {
          tenantId: state.tenantId, kind: this.kind, id: state.id,
          version: event.aggregateVersion ?? event.version ?? state.version,
          commandId: event.causationId ?? null, event,
        });
      }
      if (this.kind === 'execution_run' && state.processTaskRef) {
        await syncProcessTaskRuntimeFromRun(client, state, { commandId: runtimeCommandId });
        if (['SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CANCELLED'].includes(state.status)) {
          await settleProcessTaskPauseIfDrained(client, state.tenantId, state.processTaskRef.planInstanceId);
        }
      }
    return state;
  }

  async authorizeExecutionDispatch({ tenantId, projectId, principal, authzGeneration, runId, expectedVersion, workerId, leaseDurationMs = 5_000, start }) {
    if (this.kind !== 'execution_run' || typeof start !== 'function') throw projectAccessDenied();
    if (!/^[a-f0-9-]{36}$/.test(workerId ?? '') || !Number.isInteger(leaseDurationMs)
      || leaseDurationMs < 1_000 || leaseDurationMs > 60_000) throw new Error('The execution worker lease is invalid.');
    return this.persistence.transaction(async (client) => {
      const hintResult = await client.query(`
        select * from orgward.aggregates
        where tenant_id = $1 and aggregate_kind = 'execution_run' and aggregate_id = $2
      `, [tenantId, runId]);
      if (!hintResult.rowCount) throw projectAccessDenied();
      const hint = verifyAggregateRow(hintResult.rows[0]);
      if (hint.projectId !== projectId || hint.status !== 'RUNNING' || hint.version !== expectedVersion) {
        throw conflict('Execution dispatch no longer matches the authorized run version.', hint.version, 'DISPATCH_CONFLICT');
      }
      if (hint.processTaskRef) {
        const control = await lockProcessTaskControl(client, tenantId, hint.processTaskRef.planInstanceId);
        if (!control) throw persistenceIntegrity('A linked process task has no durable instance control record.');
        requireActiveProcessTaskControl(control, hint.version);
      }
      const approvalPrincipal = hint.approval?.principal;
      const lockedIdentities = await lockIdentityRows(client, tenantId, [principal, approvalPrincipal]);
      await requirePrincipalAuthority(client, {
        tenantId, principal, roles: ['workspace-write'], authzGeneration,
      });
      await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
      const selected = await client.query(`
        select * from orgward.aggregates
        where tenant_id = $1 and aggregate_kind = 'execution_run' and aggregate_id = $2
        for key share
      `, [tenantId, runId]);
      if (!selected.rowCount) throw projectAccessDenied();
      const run = verifyAggregateRow(selected.rows[0]);
      if (run.projectId !== projectId || run.status !== 'RUNNING' || run.version !== expectedVersion) {
        throw conflict('Execution dispatch no longer matches the authorized run version.', run.version, 'DISPATCH_CONFLICT');
      }
      const approval = run.approval;
      const approver = lockedIdentities.get(approval?.principal);
      if (approval?.principal !== approvalPrincipal || !approver || approver.status !== 'active'
        || approver.actor_type !== 'human'
        || !approver.roles.includes('execution-approver')
        || !Number.isSafeInteger(approval.authorityGeneration)
        || Number(approver.authz_generation) !== approval.authorityGeneration
        || (approval.requestHash !== executionApprovalRequestHash(run)
          && (run.interventionRevisions?.length || approval.requestHash !== contentHash(run.workItem)))) {
        throw conflict('Execution approval is stale; obtain a new approval before dispatch.', run.version, 'EXECUTION_APPROVAL_STALE');
      }
      const approverMembership = await client.query(`
        select access, generation from orgward.project_memberships
        where tenant_id = $1 and project_id = $2 and principal = $3 and revoked_at is null
        for share
      `, [tenantId, projectId, approvalPrincipal]);
      if (!approverMembership.rowCount
        || !['owner', 'editor'].includes(approverMembership.rows[0].access)
        || !Number.isSafeInteger(approval.projectMembershipGeneration)
        || Number(approverMembership.rows[0].generation) !== approval.projectMembershipGeneration) {
        throw conflict('Execution approval is stale after a project membership change; obtain a new approval.', run.version, 'EXECUTION_APPROVAL_STALE');
      }
      const lease = await client.query(`
        select worker_id from orgward.execution_worker_leases
        where tenant_id = $1 and run_id = $2 and lease_until > now()
        for update
      `, [tenantId, runId]);
      if (lease.rowCount) throw conflict('Another worker currently holds this execution lease.', run.version, 'WORKER_LEASE_HELD');
      await client.query(`
        insert into orgward.execution_worker_leases
          (tenant_id, run_id, project_id, principal, worker_id, lease_until)
        values ($1, $2, $3, $4, $5, now() + ($6 * interval '1 millisecond'))
        on conflict (tenant_id, run_id) do update set
          project_id = excluded.project_id, principal = excluded.principal,
          worker_id = excluded.worker_id, lease_until = excluded.lease_until,
          cancel_requested_at = null, cancel_reason = null, updated_at = now()
      `, [tenantId, runId, projectId, principal, workerId, leaseDurationMs]);
      return start();
    });
  }

  async renewExecutionLease({ tenantId, projectId, principal, authzGeneration, runId, workerId, leaseDurationMs = 5_000 }) {
    if (this.kind !== 'execution_run' || !/^[a-f0-9-]{36}$/.test(workerId ?? '')
      || !Number.isInteger(leaseDurationMs) || leaseDurationMs < 1_000 || leaseDurationMs > 60_000) {
      return { active: false, reason: 'worker_lease_invalid' };
    }
    return this.persistence.transaction(async (client) => {
      try { await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' }); }
      catch (error) {
        if (['ACTION_FORBIDDEN', 'PROJECT_NOT_FOUND'].includes(error.code)) {
          await client.query(`
            update orgward.execution_worker_leases
            set cancel_requested_at = coalesce(cancel_requested_at, now()),
              cancel_reason = coalesce(cancel_reason, 'authorization_revoked'), updated_at = now()
            where tenant_id = $1 and run_id = $2 and worker_id = $3
          `, [tenantId, runId, workerId]);
          const lease = await client.query(`
            select cancel_reason from orgward.execution_worker_leases
            where tenant_id = $1 and run_id = $2 and worker_id = $3
          `, [tenantId, runId, workerId]);
          await client.query(`
            update orgward.execution_worker_leases
            set lease_until = greatest(lease_until, now() + ($4 * interval '1 millisecond')),
              updated_at = now()
            where tenant_id = $1 and run_id = $2 and worker_id = $3
          `, [tenantId, runId, workerId, leaseDurationMs]);
          return { active: false, reason: lease.rows[0]?.cancel_reason ?? 'authorization_revoked' };
        }
        throw error;
      }
      try {
        await requirePrincipalAuthority(client, {
          tenantId, principal, roles: ['workspace-write'], authzGeneration,
        });
      } catch (error) {
        if (!['ACTION_FORBIDDEN', 'AUTHORITY_GENERATION_STALE'].includes(error.code)) throw error;
        await client.query(`
          update orgward.execution_worker_leases
          set cancel_requested_at = coalesce(cancel_requested_at, now()),
            cancel_reason = coalesce(cancel_reason, 'principal_authority_changed'), updated_at = now()
          where tenant_id = $1 and run_id = $2 and worker_id = $3
        `, [tenantId, runId, workerId]);
        const lease = await client.query(`
          select cancel_reason from orgward.execution_worker_leases
          where tenant_id = $1 and run_id = $2 and worker_id = $3
        `, [tenantId, runId, workerId]);
        await client.query(`
          update orgward.execution_worker_leases
          set lease_until = greatest(lease_until, now() + ($4 * interval '1 millisecond')),
            updated_at = now()
          where tenant_id = $1 and run_id = $2 and worker_id = $3
        `, [tenantId, runId, workerId, leaseDurationMs]);
        return { active: false, reason: lease.rows[0]?.cancel_reason ?? 'principal_authority_changed' };
      }
      const lease = await client.query(`
        select worker_id, lease_until, cancel_requested_at, cancel_reason
        from orgward.execution_worker_leases
        where tenant_id = $1 and run_id = $2
        for update
      `, [tenantId, runId]);
      if (!lease.rowCount || lease.rows[0].worker_id !== workerId) return { active: false, reason: 'worker_lease_lost' };
      if (lease.rows[0].cancel_requested_at) {
        await client.query(`
          update orgward.execution_worker_leases
          set lease_until = greatest(lease_until, now() + ($4 * interval '1 millisecond')),
            updated_at = now()
          where tenant_id = $1 and run_id = $2 and worker_id = $3
        `, [tenantId, runId, workerId, leaseDurationMs]);
        return { active: false, reason: lease.rows[0].cancel_reason ?? 'authorization_revoked' };
      }
      if (new Date(lease.rows[0].lease_until).getTime() <= Date.now()) {
        await client.query(`
          update orgward.execution_worker_leases
          set cancel_requested_at = now(), cancel_reason = 'worker_lease_expired', updated_at = now()
          where tenant_id = $1 and run_id = $2 and worker_id = $3
        `, [tenantId, runId, workerId]);
        return { active: false, reason: 'worker_lease_expired' };
      }
      const run = await client.query(`
        select state from orgward.aggregates
        where tenant_id = $1 and aggregate_kind = 'execution_run' and aggregate_id = $2
      `, [tenantId, runId]);
      if (!run.rowCount || run.rows[0].state.projectId !== projectId || run.rows[0].state.status !== 'RUNNING') {
        await client.query(`
          update orgward.execution_worker_leases
          set cancel_requested_at = now(), cancel_reason = 'execution_no_longer_running', updated_at = now()
          where tenant_id = $1 and run_id = $2 and worker_id = $3
        `, [tenantId, runId, workerId]);
        return { active: false, reason: 'execution_no_longer_running' };
      }
      await client.query(`
        update orgward.execution_worker_leases
        set lease_until = now() + ($4 * interval '1 millisecond'), updated_at = now()
        where tenant_id = $1 and run_id = $2 and worker_id = $3
      `, [tenantId, runId, workerId, leaseDurationMs]);
      return { active: true };
    });
  }

  async finalizeExecution({ tenantId, projectId, principal, runId, workerId, expectedVersion, dispatchStarted = true, forceInterruptionReason = null, complete, interrupt }) {
    if (this.kind !== 'execution_run' || typeof complete !== 'function' || typeof interrupt !== 'function'
      || !/^[a-f0-9-]{36}$/.test(workerId ?? '')) {
      throw new Error('The execution finalization request is invalid.');
    }
    return this.persistence.transaction(async (client) => {
      let authorized = true;
      try { await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' }); }
      catch (error) {
        if (error.code === 'ACTION_FORBIDDEN' || error.code === 'PROJECT_NOT_FOUND') authorized = false;
        else throw error;
      }

      const runHint = await client.query(`select state->'processTaskRef' as ref from orgward.aggregates
        where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2`, [tenantId, runId]);
      const processTaskRef = runHint.rows[0]?.ref;
      if (processTaskRef?.planInstanceId) {
        const control = await lockProcessTaskControl(client, tenantId, processTaskRef.planInstanceId);
        if (control?.status === 'ABANDONED_UNVERIFIED') {
          throw conflict('A late worker result cannot advance an instance closed with an unverified provider outcome.', expectedVersion, 'PROCESS_INSTANCE_ABANDONED_UNVERIFIED');
        }
      }

      const selected = await client.query(`
        select * from orgward.aggregates
        where tenant_id = $1 and aggregate_kind = 'execution_run' and aggregate_id = $2
        for update
      `, [tenantId, runId]);
      if (!selected.rowCount) throw projectAccessDenied();
      const current = verifyAggregateRow(selected.rows[0]);
      if (current.projectId !== projectId || current.status !== 'RUNNING' || current.version !== expectedVersion) {
        throw conflict('Execution finalization no longer matches the active run version.', current.version, 'WORKER_FINALIZATION_CONFLICT');
      }

      const lease = await client.query(`
        select worker_id, project_id, principal, lease_until <= clock_timestamp() expired,
          cancel_requested_at, cancel_reason
        from orgward.execution_worker_leases
        where tenant_id = $1 and run_id = $2
        for update
      `, [tenantId, runId]);
      if (!lease.rowCount && dispatchStarted) {
        throw conflict('The worker no longer owns this execution lease.', current.version, 'WORKER_LEASE_LOST');
      }
      if (lease.rowCount && (lease.rows[0].worker_id !== workerId
        || lease.rows[0].project_id !== projectId || lease.rows[0].principal !== principal)) {
        throw conflict('The worker no longer owns this execution lease.', current.version, 'WORKER_LEASE_LOST');
      }

      const leaseState = lease.rows[0] ?? {};
      let interruptionReason = forceInterruptionReason
        ?? (!authorized ? leaseState.cancel_reason ?? 'authorization_revoked' : null);
      if (leaseState.cancel_requested_at) interruptionReason ??= leaseState.cancel_reason ?? 'execution_cancelled';
      if (leaseState.expired) {
        interruptionReason ??= 'worker_lease_expired';
        await client.query(`
          update orgward.execution_worker_leases
          set cancel_requested_at = coalesce(cancel_requested_at, now()),
            cancel_reason = coalesce(cancel_reason, 'worker_lease_expired'), updated_at = now()
          where tenant_id = $1 and run_id = $2 and worker_id = $3
        `, [tenantId, runId, workerId]);
      }

      const nextRun = interruptionReason ? await interrupt(interruptionReason) : await complete();
      if (!nextRun || nextRun.id !== runId || nextRun.tenantId !== tenantId || nextRun.projectId !== projectId
        || nextRun.version !== expectedVersion + 1 || !['SUCCEEDED', 'FAILED', 'INTERRUPTED'].includes(nextRun.status)) {
        throw persistenceIntegrity('The worker finalization produced an invalid terminal run.');
      }
      if (interruptionReason && (nextRun.status !== 'INTERRUPTED'
        || nextRun.execution?.changedArtifacts?.length !== 0)) {
        throw persistenceIntegrity('A revoked or expired worker cannot persist successful artifact metadata.');
      }
      await this.saveInTransaction(client, nextRun, { expectedVersion, workerFinalization: true });
      return { run: nextRun, status: nextRun.status, interrupted: Boolean(interruptionReason), reason: interruptionReason };
    });
  }

  async releaseExecutionLease({ tenantId, runId, workerId }) {
    if (this.kind !== 'execution_run') return false;
    return this.persistence.transaction(async (client) => {
      const run = await client.query(`select state->'processTaskRef' as process_task_ref from orgward.aggregates
        where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2`, [tenantId, runId]);
      const instanceId = run.rows[0]?.process_task_ref?.planInstanceId;
      if (instanceId) await lockProcessTaskControl(client, tenantId, instanceId);
      const deleted = await client.query(`delete from orgward.execution_worker_leases
        where tenant_id=$1 and run_id=$2 and worker_id=$3`, [tenantId, runId, workerId]);
      if (instanceId) await settleProcessTaskPauseIfDrained(client, tenantId, instanceId);
      return deleted.rowCount === 1;
    });
  }
}

export class PostgresProjectStore extends PostgresDocumentStore {
  constructor(persistence) { super(persistence, 'project'); }

  async listWithPrincipalAuthority({
    tenantId, principal, anyPrincipalRoleGroups = [], authzGeneration, operation,
  }) {
    if (!tenantId || !principal || typeof operation !== 'function') return null;
    return this.persistence.transaction(async (client) => {
      await requirePrincipalAuthority(client, {
        tenantId, principal, anyRoleGroups: anyPrincipalRoleGroups, authzGeneration,
      });
      const result = await client.query(`
        select a.* from orgward.aggregates a
        join orgward.project_memberships m
          on m.tenant_id = a.tenant_id and m.project_kind = a.aggregate_kind and m.project_id = a.aggregate_id
        where a.tenant_id = $1 and a.aggregate_kind = 'project'
          and m.principal = $2 and m.revoked_at is null
        order by a.updated_at desc, a.aggregate_id
        for share of a, m
      `, [tenantId, principal]);
      const records = [];
      let corruptRecords = 0;
      for (const row of result.rows) {
        try {
          const project = verifyAggregateRow(row);
          records.push({
            id: project.id, name: project.name, tenantId: project.tenantId,
            version: project.version, phase: project.phase, updatedAt: project.updatedAt,
            blueprintVersion: project.blueprintVersions?.at(-1)?.version ?? null,
          });
        } catch { corruptRecords += 1; }
      }
      return operation({ records, corruptRecords });
    });
  }

  async getWithPrincipalAuthority({
    id, tenantId, principal, anyPrincipalRoleGroups = [], authzGeneration, operation,
  }) {
    if (!id || !tenantId || !principal || typeof operation !== 'function') return null;
    return this.persistence.transaction(async (client) => {
      await requirePrincipalAuthority(client, {
        tenantId, principal, anyRoleGroups: anyPrincipalRoleGroups, authzGeneration,
      });
      const result = await client.query(`
        select a.* from orgward.aggregates a
        join orgward.project_memberships m
          on m.tenant_id = a.tenant_id and m.project_kind = a.aggregate_kind and m.project_id = a.aggregate_id
        where a.tenant_id = $1 and a.aggregate_kind = 'project' and a.aggregate_id = $2
          and m.principal = $3 and m.revoked_at is null
        for share of a, m
      `, [tenantId, id, principal]);
      return result.rowCount ? operation(verifyAggregateRow(result.rows[0])) : null;
    });
  }

  async withPrincipalFoundationAuthority({ tenantId, principal, authzGeneration, operation }) {
    if (!tenantId || !principal || typeof operation !== 'function') return null;
    return this.persistence.transaction(async (client) => {
      await requirePrincipalAuthority(client, {
        tenantId, principal, anyRoleGroups: [['workspace-read', 'workspace-write', 'tenant-admin']], authzGeneration,
      });
      const projects = await client.query(`
        select a.* from orgward.aggregates a
        join orgward.project_memberships m
          on m.tenant_id = a.tenant_id and m.project_kind = 'project' and m.project_id = a.aggregate_id
        where a.tenant_id = $1 and a.aggregate_kind = 'project'
          and m.principal = $2 and m.revoked_at is null
        order by a.aggregate_id
        for share of a, m
      `, [tenantId, principal]);
      const scopedAggregates = await client.query(`
        select a.*, s.project_id as scoped_project_id
        from orgward.aggregates a
        join orgward.aggregate_project_scopes s
          on s.tenant_id = a.tenant_id and s.aggregate_kind = a.aggregate_kind and s.aggregate_id = a.aggregate_id
        join orgward.project_memberships m
          on m.tenant_id = s.tenant_id and m.project_kind = 'project'
          and m.project_id = s.project_id and m.principal = $2
        where a.tenant_id = $1 and a.aggregate_kind in ('change_case', 'execution_run')
          and m.revoked_at is null
        order by a.aggregate_kind, a.aggregate_id
        for share of a, m
      `, [tenantId, principal]);
      const snapshot = {
        projects: { records: [], corruptRecords: 0 },
        changeCases: { records: [], corruptRecords: 0 },
        executionRuns: { records: [], corruptRecords: 0 },
      };
      for (const row of projects.rows) {
        try { snapshot.projects.records.push(verifyAggregateRow(row)); }
        catch { snapshot.projects.corruptRecords += 1; }
      }
      for (const row of scopedAggregates.rows) {
        const target = row.aggregate_kind === 'change_case' ? snapshot.changeCases : snapshot.executionRuns;
        try {
          const state = verifyAggregateRow(row);
          if (state.projectId !== row.scoped_project_id) {
            throw persistenceIntegrity('Aggregate project scope does not match aggregate state.');
          }
          state.projectId = row.scoped_project_id;
          target.records.push(state);
        } catch { target.corruptRecords += 1; }
      }
      return operation(snapshot);
    });
  }

  async createWithCommandForPrincipal(project, commandId, payloadHash, principal, {
    requiredPrincipalRoles = ['workspace-write'], authzGeneration = null,
  } = {}) {
    if (!principal || principal !== project.createdBy) throw projectAccessDenied();
    return this.createWithCommand(project, commandId, payloadHash, principal, { requiredPrincipalRoles, authzGeneration });
  }

  async updateWithCommandForPrincipal(id, tenantId, command, principal, {
    requiredPrincipalRoles = ['workspace-write'], authzGeneration = null, minimumProjectAccess = null,
  } = {}) {
    if (!principal) throw projectAccessDenied();
    return this.updateWithCommand(id, tenantId, {
      ...command, principal, requiredPrincipalRoles, authzGeneration, minimumProjectAccess,
    });
  }

  async #membership(client, { tenantId, projectId, principal, lock = false }) {
    if (lock) {
      const identity = await client.query(`
        select principal from orgward.oidc_principals
        where tenant_id = $1 and principal = $2 and status = 'active' for share
      `, [tenantId, principal]);
      if (!identity.rowCount) return { rowCount: 0, rows: [] };
    }
    return client.query(`
      select m.access, m.generation
      from orgward.project_memberships m
      where m.tenant_id = $1 and m.project_id = $2 and m.principal = $3
        and m.revoked_at is null
      ${lock ? 'for share of m' : ''}
    `, [tenantId, projectId, principal]);
  }

  async #recordMembershipEvent(client, { tenantId, projectId, principal, eventType, access, actor, generation }) {
    await client.query(`
      insert into orgward.project_membership_events
        (tenant_id, project_id, principal, event_type, access, actor, generation)
      values ($1, $2, $3, $4, $5, $6, $7)
    `, [tenantId, projectId, principal, eventType, access, actor, generation]);
  }

  async #hasReadableMembership(client, tenantId, projectId, principal, lock = false) {
    const member = await this.#membership(client, { tenantId, projectId, principal, lock });
    return member.rowCount > 0;
  }

  async listWithDiagnosticsForPrincipal(tenantId, principal) {
    const result = await this.persistence.query(`
      select a.* from orgward.aggregates a
      join orgward.project_memberships m
        on m.tenant_id = a.tenant_id and m.project_kind = a.aggregate_kind and m.project_id = a.aggregate_id
      join orgward.oidc_principals p
        on p.principal = m.principal and p.tenant_id = m.tenant_id
      where a.tenant_id = $1 and a.aggregate_kind = 'project' and m.principal = $2
        and m.revoked_at is null and p.status = 'active'
      order by a.updated_at desc, a.aggregate_id
    `, [tenantId, principal]);
    const records = [];
    let corruptRecords = 0;
    for (const row of result.rows) {
      try { records.push(verifyAggregateRow(row)); }
      catch { corruptRecords += 1; }
    }
    return {
      corruptRecords,
      records: records.map((project) => ({
        id: project.id, name: project.name, tenantId: project.tenantId,
        version: project.version, phase: project.phase, updatedAt: project.updatedAt,
        blueprintVersion: project.blueprintVersions?.at(-1)?.version ?? null,
      })),
    };
  }

  async listForPrincipal(tenantId, principal) {
    return (await this.listWithDiagnosticsForPrincipal(tenantId, principal)).records;
  }

  async getForPrincipal(id, tenantId, principal) {
    const result = await this.persistence.query(`
      select a.* from orgward.aggregates a
      join orgward.project_memberships m
        on m.tenant_id = a.tenant_id and m.project_kind = a.aggregate_kind and m.project_id = a.aggregate_id
      join orgward.oidc_principals p
        on p.principal = m.principal and p.tenant_id = m.tenant_id
      where a.tenant_id = $1 and a.aggregate_kind = 'project' and a.aggregate_id = $2
        and m.principal = $3 and m.revoked_at is null and p.status = 'active'
    `, [tenantId, id, principal]);
    return result.rowCount ? verifyAggregateRow(result.rows[0]) : null;
  }

  async listMembers(tenantId, projectId, actor, { actorAuthzGeneration = null, operation = null } = {}) {
    return this.persistence.transaction(async (client) => {
      await requirePrincipalAuthority(client, {
        tenantId, principal: actor,
        anyRoleGroups: [['workspace-read', 'workspace-write', 'tenant-admin']],
        authzGeneration: actorAuthzGeneration,
      });
      const identity = await client.query(`
        select principal from orgward.oidc_principals
        where tenant_id = $1 and principal = $2 and status = 'active'
        for share
      `, [tenantId, actor]);
      if (!identity.rowCount) return null;
      const membership = await client.query(`
        select access from orgward.project_memberships
        where tenant_id = $1 and project_id = $2 and principal = $3 and revoked_at is null
        for share
      `, [tenantId, projectId, actor]);
      if (!membership.rowCount || !['owner', 'editor'].includes(membership.rows[0].access)) return null;
      const project = await client.query(`
        select 1 from orgward.aggregates
        where tenant_id = $1 and aggregate_kind = 'project' and aggregate_id = $2
        for key share
      `, [tenantId, projectId]);
      if (!project.rowCount) return null;
      const result = await client.query(`
        select m.principal, p.display_name, p.actor_type, m.access, m.generation, m.granted_at
        from orgward.project_memberships m
        join orgward.oidc_principals p on p.principal = m.principal and p.tenant_id = m.tenant_id
        where m.tenant_id = $1 and m.project_id = $2 and m.revoked_at is null and p.status = 'active'
        order by case m.access when 'owner' then 0 when 'editor' then 1 else 2 end, p.display_name
        for share of m, p
      `, [tenantId, projectId]);
      const members = result.rows.map((row) => ({
        principal: row.principal, displayName: row.display_name, actorType: row.actor_type,
        access: row.access, generation: Number(row.generation), grantedAt: row.granted_at,
      }));
      return operation ? operation(members) : members;
    });
  }

  async listActorBindingProposals({ tenantId, projectId, principal, authzGeneration = null }) {
    return this.persistence.transaction(async (client) => {
      await requirePrincipalAuthority(client, {
        tenantId, principal, anyRoleGroups: [['workspace-read', 'workspace-write', 'tenant-admin']], authzGeneration,
      });
      const membership = await client.query(`
        select access from orgward.project_memberships
        where tenant_id = $1 and project_id = $2 and principal = $3 and revoked_at is null
        for share
      `, [tenantId, projectId, principal]);
      if (!membership.rowCount || !['owner', 'editor'].includes(membership.rows[0].access)) return null;
      const selected = await client.query(`
        select * from orgward.aggregates
        where tenant_id = $1 and aggregate_kind = 'project' and aggregate_id = $2
        for key share
      `, [tenantId, projectId]);
      if (!selected.rowCount) return null;
      const project = verifyAggregateRow(selected.rows[0]);
      const result = await client.query(`
        select b.blueprint_version, b.actor_id, b.role_id, b.target_principal,
          b.target_membership_generation, b.target_authz_generation,
          b.status, b.proposed_by, b.proposed_at, b.enabled_at,
          target.display_name as target_name, target.actor_type as target_type, target.status as identity_status,
          target.authz_generation as current_authz_generation,
          member.access as member_access, member.generation as current_membership_generation, member.revoked_at as member_revoked_at,
          proposer.display_name as proposer_name
        from orgward.project_actor_binding_proposals b
        join orgward.oidc_principals target
          on target.tenant_id = b.tenant_id and target.principal = b.target_principal
        left join orgward.project_memberships member
          on member.tenant_id = b.tenant_id and member.project_id = b.project_id and member.principal = b.target_principal
        join orgward.oidc_principals proposer
          on proposer.tenant_id = b.tenant_id and proposer.principal = b.proposed_by
        where b.tenant_id = $1 and b.project_id = $2
        order by b.blueprint_version desc, b.proposed_at desc, b.actor_id, b.role_id
        for share of b, target, proposer
      `, [tenantId, projectId]);
      const proposals = result.rows.map((row) => {
        const blueprint = project.blueprintVersions?.find((candidate) => candidate.version === row.blueprint_version);
        const objects = Object.values(blueprint?.areas ?? {}).flatMap((area) => area.items ?? []);
        const actor = objects.find((object) => object.id === row.actor_id);
        const role = objects.find((object) => object.id === row.role_id);
        const targetEligible = row.identity_status === 'active' && row.member_revoked_at === null
          && ['owner', 'editor'].includes(row.member_access)
          && Number(row.target_authz_generation) === Number(row.current_authz_generation)
          && Number(row.target_membership_generation) === Number(row.current_membership_generation)
          && ((actor?.type === 'actor-human' && row.target_type === 'human')
            || (actor?.type === 'actor-agent' && row.target_type === 'workload'));
        const blueprintCurrent = row.blueprint_version === (project.blueprintVersions?.at(-1)?.version ?? null);
        const eligibilityStatus = [
          ...(!blueprintCurrent ? ['stale_blueprint'] : []),
          ...(!targetEligible ? ['no_longer_eligible'] : []),
        ];
        if (!eligibilityStatus.length) eligibilityStatus.push('eligible');
        return {
          blueprintVersion: row.blueprint_version,
          currentBlueprintVersion: project.blueprintVersions?.at(-1)?.version ?? null,
          actorId: row.actor_id,
          actorName: actor?.name ?? 'Unknown blueprint actor',
          roleId: row.role_id,
          roleName: role?.name ?? 'Unknown blueprint role',
          targetName: row.target_name,
          targetType: row.target_type,
          targetStatus: targetEligible ? 'active_project_member' : 'no_longer_eligible',
          eligibilityStatus,
          status: row.status,
          proposedByName: row.proposer_name,
          proposedAt: row.proposed_at,
          enabledAt: row.enabled_at,
        };
      });
      return { currentBlueprintVersion: project.blueprintVersions?.at(-1)?.version ?? null, proposals };
    });
  }

  async grantMember({ tenantId, projectId, actor, actorAuthzGeneration, principal, access, beforeReaderAccess = null }) {
    if (!['reader', 'editor'].includes(access) || actor === principal) throw projectAccessDenied();
    const outcome = await this.persistence.transaction(async (client) => {
      const identities = await lockIdentityRows(client, tenantId, [actor, principal]);
      if (identities.get(actor)?.status !== 'active') return null;
      await requirePrincipalAuthority(client, {
        tenantId, principal: actor, roles: ['workspace-write'], authzGeneration: actorAuthzGeneration,
      });
      const ownerMembership = await client.query(`
        select access from orgward.project_memberships
        where tenant_id = $1 and project_id = $2 and principal = $3 and revoked_at is null
        for share
      `, [tenantId, projectId, actor]);
      if (!ownerMembership.rowCount) return null;
      if (ownerMembership.rows[0].access !== 'owner') throw projectAccessDenied();
      if (identities.get(principal)?.status !== 'active') return null;
      const existing = await client.query(`
        select access, generation, revoked_at from orgward.project_memberships
        where tenant_id = $1 and project_id = $2 and principal = $3 for update
      `, [tenantId, projectId, principal]);
      if (existing.rowCount && existing.rows[0].revoked_at === null && existing.rows[0].access === access) {
        if (access === 'reader') {
          await requestExecutionLeaseCancellation(client, { tenantId, projectId, principal, reason: 'project_access_downgraded' });
        }
        return { result: { principal, access, generation: Number(existing.rows[0].generation) }, cancelWorker: access === 'reader' };
      }
      if (existing.rowCount && existing.rows[0].revoked_at === null && existing.rows[0].access === 'owner') {
        throw projectAccessDenied();
      }
      if (access === 'reader') {
        await requestExecutionLeaseCancellation(client, { tenantId, projectId, principal, reason: 'project_access_downgraded' });
      }
      const upserted = await client.query(`
        insert into orgward.project_memberships
          (tenant_id, project_id, principal, access, granted_by)
        values ($1, $2, $3, $4, $5)
        on conflict (tenant_id, project_id, principal) do update set
          access = excluded.access, generation = orgward.project_memberships.generation + 1,
          granted_by = excluded.granted_by, granted_at = now(), revoked_at = null, revoked_by = null
        returning generation
      `, [tenantId, projectId, principal, access, actor]);
      const generation = Number(upserted.rows[0].generation);
      await this.#recordMembershipEvent(client, {
        tenantId, projectId, principal, eventType: 'MembershipGranted', access, actor, generation,
      });
      return { result: { principal, access, generation }, cancelWorker: access === 'reader' };
    });
    if (outcome?.cancelWorker) await beforeReaderAccess?.({ tenantId, projectId, principal });
    return outcome?.result ?? null;
  }

  async revokeMember({ tenantId, projectId, actor, actorAuthzGeneration, principal, beforeRevoke = null }) {
    if (actor === principal) throw projectAccessDenied();
    const outcome = await this.persistence.transaction(async (client) => {
      const identities = await lockIdentityRows(client, tenantId, [actor, principal]);
      if (identities.get(actor)?.status !== 'active') return null;
      await requirePrincipalAuthority(client, {
        tenantId, principal: actor, roles: ['workspace-write'], authzGeneration: actorAuthzGeneration,
      });
      const ownerMembership = await client.query(`
        select access from orgward.project_memberships
        where tenant_id = $1 and project_id = $2 and principal = $3 and revoked_at is null
        for share
      `, [tenantId, projectId, actor]);
      if (!ownerMembership.rowCount) return null;
      if (ownerMembership.rows[0].access !== 'owner') throw projectAccessDenied();
      if (!identities.has(principal)) return false;
      const member = await client.query(`
        select access, generation, revoked_at from orgward.project_memberships
        where tenant_id = $1 and project_id = $2 and principal = $3 for update
      `, [tenantId, projectId, principal]);
      if (!member.rowCount) return false;
      if (member.rows[0].access === 'owner') throw projectAccessDenied();
      if (member.rows[0].revoked_at) {
        await requestExecutionLeaseCancellation(client, { tenantId, projectId, principal, reason: 'project_membership_revoked' });
        return { result: true, cancelWorker: true };
      }
      await requestExecutionLeaseCancellation(client, { tenantId, projectId, principal, reason: 'project_membership_revoked' });
      const revoked = await client.query(`
        update orgward.project_memberships
        set revoked_at = now(), revoked_by = $4, generation = generation + 1
        where tenant_id = $1 and project_id = $2 and principal = $3
        returning access, generation
      `, [tenantId, projectId, principal, actor]);
      await this.#recordMembershipEvent(client, {
        tenantId, projectId, principal, eventType: 'MembershipRevoked',
        access: revoked.rows[0].access, actor, generation: Number(revoked.rows[0].generation),
      });
      return { result: true, cancelWorker: true };
    });
    if (outcome?.cancelWorker) await beforeRevoke?.({ tenantId, projectId, principal });
    return outcome?.result ?? outcome;
  }

  async listWithDiagnostics(tenantId) {
    const result = await super.listWithDiagnostics(tenantId);
    return {
      corruptRecords: result.corruptRecords,
      records: result.records.map((project) => ({
        id: project.id,
        name: project.name,
        tenantId: project.tenantId,
        version: project.version,
        phase: project.phase,
        updatedAt: project.updatedAt,
        blueprintVersion: project.blueprintVersions?.at(-1)?.version ?? null,
      })),
    };
  }

  commandSnapshot(project) {
    const { commandRecords: _commandRecords, ...snapshot } = project;
    return structuredClone(snapshot);
  }

  async #priorCommand(client, tenantId, operation, commandId, payloadHash) {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
    const prior = await client.query(`
      select * from orgward.command_results
      where tenant_id = $1 and operation = $2 and command_id = $3
    `, [tenantId, operation, commandId]);
    if (!prior.rowCount) return null;
    if (prior.rows[0].payload_hash !== payloadHash) {
      throw conflict('This command ID was already used with different input.', null, 'IDEMPOTENCY_CONFLICT');
    }
    const result = verifyCommandRow(prior.rows[0]);
    if (prior.rows[0].aggregate_kind !== 'project'
      || result.id !== prior.rows[0].aggregate_id
      || result.tenantId !== tenantId) {
      throw persistenceIntegrity('A durable command result does not match its aggregate identity.');
    }
    const aggregate = await client.query(`
      select * from orgward.aggregates
      where tenant_id = $1 and aggregate_kind = $2 and aggregate_id = $3
    `, [tenantId, prior.rows[0].aggregate_kind, prior.rows[0].aggregate_id]);
    if (!aggregate.rowCount) throw persistenceIntegrity('A durable command result has no aggregate state.');
    const current = verifyAggregateRow(aggregate.rows[0]);
    if (current.version < result.version) throw persistenceIntegrity('A durable command result is ahead of aggregate state.');
    return result;
  }

  async #recordCommand(client, { tenantId, operation, commandId, payloadHash, project }) {
    const result = this.commandSnapshot(project);
    await client.query(`
      insert into orgward.command_results
        (tenant_id, operation, command_id, payload_hash, aggregate_kind, aggregate_id, result, result_hash)
      values ($1, $2, $3, $4, 'project', $5, $6::jsonb, $7)
    `, [tenantId, operation, commandId, payloadHash, project.id, canonicalJson(result), contentHash(result)]);
    await recordEvent(client, {
      tenantId, kind: 'project', id: project.id, version: project.version, commandId, event: project.events.at(-1),
    });
    return result;
  }

  async createWithCommand(project, commandId, payloadHash, principal = project.createdBy, {
    requiredPrincipalRoles = null, authzGeneration = null,
  } = {}) {
    const operation = 'project.create';
    const result = await this.persistence.transaction(async (client) => {
      if (requiredPrincipalRoles) await requirePrincipalAuthority(client, {
        tenantId: project.tenantId, principal, roles: requiredPrincipalRoles, authzGeneration,
      });
      const prior = await this.#priorCommand(client, project.tenantId, operation, commandId, payloadHash);
      if (prior) {
        const member = await this.#membership(client, {
          tenantId: project.tenantId, projectId: prior.id, principal, lock: true,
        });
        return member.rowCount ? { project: prior, replayed: true } : null;
      }
      if (principal !== project.createdBy) throw projectAccessDenied();
      delete project.commandRecords;
      await insertAggregate(client, project, 'project');
      const owner = await client.query(`
        insert into orgward.project_memberships
          (tenant_id, project_id, principal, access, granted_by)
        values ($1, $2, $3, 'owner', $3)
        returning generation
      `, [project.tenantId, project.id, principal]);
      await this.#recordMembershipEvent(client, {
        tenantId: project.tenantId, projectId: project.id, principal,
        eventType: 'MembershipGranted', access: 'owner', actor: principal,
        generation: Number(owner.rows[0].generation),
      });
      const snapshot = await this.#recordCommand(client, { tenantId: project.tenantId, operation, commandId, payloadHash, project });
      return { project: snapshot, replayed: false };
    });
    if (result && !result.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId: project.tenantId });
    return result;
  }

  async updateWithCommand(id, tenantId, {
    commandId, operation = 'project.record-answer', payloadHash, expectedVersion, principal = null,
    requiredPrincipalRoles = null, authzGeneration = null, minimumProjectAccess = null, apply,
  }) {
    const result = await this.persistence.transaction(async (client) => {
      if (principal) {
        const member = await this.#membership(client, { tenantId, projectId: id, principal, lock: true });
        if (!member.rowCount) return null;
        if (!['owner', 'editor'].includes(member.rows[0].access)) throw projectAccessDenied();
        if (minimumProjectAccess === 'owner' && member.rows[0].access !== 'owner') throw projectAccessDenied();
      }
      if (requiredPrincipalRoles) await requirePrincipalAuthority(client, {
        tenantId, principal, roles: requiredPrincipalRoles, authzGeneration,
      });
      const prior = await this.#priorCommand(client, tenantId, operation, commandId, payloadHash);
      if (prior) {
        if (prior.id !== id) throw conflict('This command ID belongs to a different project.', null, 'IDEMPOTENCY_CONFLICT');
        return { project: prior, replayed: true };
      }
      const selected = await client.query(`
        select * from orgward.aggregates
        where tenant_id = $1 and aggregate_kind = 'project' and aggregate_id = $2
        for update
      `, [tenantId, id]);
      if (!selected.rowCount) return null;
      const project = verifyAggregateRow(selected.rows[0]);
      if (project.version !== expectedVersion) {
        throw conflict(`Version conflict: the current version is ${project.version}. Reload before retrying.`, project.version);
      }
      const priorEvents = structuredClone(project.events ?? []);
      await apply(project, client);
      if (project.version !== expectedVersion + 1) throw persistenceIntegrity('The project version did not advance exactly once.');
      if (!Array.isArray(project.events) || project.events.length !== priorEvents.length + 1
        || contentHash(project.events.slice(0, priorEvents.length)) !== contentHash(priorEvents)) {
        throw persistenceIntegrity('A project command must append exactly one event without rewriting history.');
      }
      delete project.commandRecords;
      await updateAggregate(client, project, 'project', expectedVersion);
      const snapshot = await this.#recordCommand(client, { tenantId, operation, commandId, payloadHash, project });
      return { project: snapshot, replayed: false };
    });
    if (result && !result.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return result;
  }
}

export class PostgresChangeCaseStore extends PostgresDocumentStore {
  constructor(persistence) { super(persistence, 'change_case'); }
  async saveForPrincipal(changeCase, {
    expectedVersion = null, principal, commandAuthority = null,
    approvalAuthority = null, effectAuthority = null,
  } = {}) {
    if (!principal) throw projectAccessDenied();
    const saveOptions = {
      expectedVersion, principal,
      requiredPrincipalRoles: commandAuthority?.requiredRoles ?? null,
      authzGeneration: commandAuthority?.authzGeneration ?? null,
    };
    if (!approvalAuthority && !effectAuthority) return super.save(changeCase, saveOptions);
    return this.persistence.transaction(async (client) => {
      // Lock all relevant identity authority before project membership and case rows.
      await lockIdentityRows(client, changeCase.tenantId, [principal, effectAuthority?.principal]);
      if (approvalAuthority) {
        await requirePrincipalAuthority(client, {
          tenantId: changeCase.tenantId, principal,
          roles: approvalAuthority.requiredRoles, authzGeneration: approvalAuthority.authzGeneration,
          actorType: 'human',
        });
      }
      if (commandAuthority) {
        await requirePrincipalAuthority(client, {
          tenantId: changeCase.tenantId, principal,
          roles: commandAuthority.requiredRoles, authzGeneration: commandAuthority.authzGeneration,
        });
      }
      if (effectAuthority) {
        await requirePrincipalAuthority(client, {
          tenantId: changeCase.tenantId, principal: effectAuthority.principal,
          roles: ['release-approver', 'control-owner'], authzGeneration: effectAuthority.authzGeneration,
          actorType: 'human',
        });
      }
      return this.saveInTransaction(client, changeCase, {
        ...saveOptions,
        validateCurrent: (current) => {
          if (approvalAuthority) {
            if (current.currentStage !== 'S9' || current.version !== expectedVersion
              || current.createdBy === principal) {
              throw conflict('The persisted release case is no longer approvable by this principal.', current.version, 'RELEASE_APPROVAL_STALE');
            }
            const added = (changeCase.approvals ?? []).slice(current.approvals?.length ?? 0);
            const events = (changeCase.events ?? []).slice(current.events?.length ?? 0);
            const approval = added.length === 1 ? added[0] : null;
            const bundleRef = current.artifacts?.assurance?.releaseEvidenceBundle?.id;
            if (contentHash(changeCase.approvals?.slice(0, current.approvals?.length ?? 0) ?? [])
                !== contentHash(current.approvals ?? [])
              || !approval || approval.action !== 'release' || approval.principal !== principal
              || approval.authorityGeneration !== approvalAuthority.authzGeneration
              || approval.evidenceBundleRef !== bundleRef
              || events.length !== 1 || events[0].type !== 'ReleaseApprovalRecorded'
              || events[0].actor !== principal || events[0].data?.approvalRef !== approval.id) {
              throw persistenceIntegrity('A release approval must append exactly the authenticated principal approval for the persisted evidence bundle.');
            }
          }
          if (effectAuthority) {
            const currentApproval = releaseApprovalCandidate(current);
            const nextApproval = (changeCase.approvals ?? []).find(({ id }) => id === effectAuthority.approvalRef);
            const draftBundle = current.artifacts?.assurance?.releaseEvidenceBundle;
            const finalBundle = changeCase.artifacts?.assurance?.releaseEvidenceBundle;
            const release = changeCase.artifacts?.release;
            const approvalPayload = nextApproval && Object.fromEntries(Object.entries(nextApproval).filter(([key]) => key !== 'contentHash'));
            const addedEvents = (changeCase.events ?? []).slice(current.events?.length ?? 0);
            const otherApprovalChanged = (current.approvals ?? []).some((approval) => {
              if (approval.id === effectAuthority.approvalRef) return false;
              const next = (changeCase.approvals ?? []).find((entry) => entry.id === approval.id);
              return !next || contentHash(approval) !== contentHash(next);
            });
            if (current.currentStage !== 'S9' || current.version !== expectedVersion
              || !currentApproval || currentApproval.id !== effectAuthority.approvalRef
              || currentApproval.principal !== effectAuthority.principal
              || currentApproval.authorityGeneration !== effectAuthority.authzGeneration
              || currentApproval.action !== 'release' || currentApproval.status !== 'APPROVED'
              || currentApproval.principal === current.createdBy
              || currentApproval.evidenceBundleRef !== draftBundle?.id
              || (changeCase.approvals ?? []).length !== (current.approvals ?? []).length
              || !nextApproval?.usedAt || nextApproval.principal !== currentApproval.principal
              || nextApproval.authorityGeneration !== currentApproval.authorityGeneration
              || nextApproval.evidenceBundleRef !== currentApproval.evidenceBundleRef
              || !Array.isArray(nextApproval.roles)
              || !nextApproval.roles.includes('release-approver') || !nextApproval.roles.includes('control-owner')
              || otherApprovalChanged || contentHash(approvalPayload) !== nextApproval.contentHash
              || !finalBundle || finalBundle.priorBundleRef !== draftBundle?.id
              || contentHash(finalBundle.approvals) !== contentHash([effectAuthority.approvalRef])
              || !release || release.status !== 'RELEASED' || release.externalEffect !== false
              || release.authorizedBy !== effectAuthority.approvalRef || release.evidenceBundleRef !== finalBundle.id
              || changeCase.artifacts?.authority?.decision !== 'ALLOW'
              || changeCase.artifacts?.authority?.approvalRef !== effectAuthority.approvalRef
              || !addedEvents.some((event) => event.type === 'GatePassed' && event.data?.stage === 'S9')) {
              throw conflict('The persisted release approval is stale or was not consumed by this release transition.', current.version, 'RELEASE_APPROVAL_STALE');
            }
          }
        },
      });
    });
  }
  async listWithDiagnostics(tenantId) {
    const result = await super.listWithDiagnostics(tenantId);
    return {
      corruptRecords: result.corruptRecords,
      records: result.records.map((value) => ({
        id: value.id, tenantId: value.tenantId, title: value.title, status: value.status,
        currentStage: value.currentStage, mutation: value.mutation, riskClass: value.riskClass,
        version: value.version, updatedAt: value.updatedAt,
      })),
    };
  }
}

export class PostgresExecutionRunStore extends PostgresDocumentStore {
  constructor(persistence) { super(persistence, 'execution_run'); }

  async createForProcessTask({
    tenantId, projectId, principal, authzGeneration, planId, revision, planInstanceId = null,
    taskId, commandId, requestHash, buildRun,
  }) {
    if (!tenantId || !projectId || !principal || typeof buildRun !== 'function') throw projectAccessDenied();
    const operation = 'execution.process-task.request';
    let outcome;
    try {
      outcome = await this.persistence.transaction(async (client) => {
        await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
        await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration });
        await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
        const priorCommand = await client.query(`
          select * from orgward.command_results
          where tenant_id = $1 and operation = $2 and command_id = $3
        `, [tenantId, operation, commandId]);
        if (priorCommand.rowCount) {
          if (priorCommand.rows[0].payload_hash !== requestHash) {
            throw conflict('This command ID was already used with different process task input.', null, 'IDEMPOTENCY_CONFLICT');
          }
          const recorded = verifyCommandRow(priorCommand.rows[0]);
          if (priorCommand.rows[0].aggregate_kind !== 'execution_run'
            || recorded.id !== priorCommand.rows[0].aggregate_id || recorded.tenantId !== tenantId
            || recorded.projectId !== projectId || recorded.processTaskRef?.processPlanId !== planId
            || recorded.processTaskRef?.revision !== revision
            || (planInstanceId && recorded.processTaskRef?.planInstanceId !== planInstanceId)
            || recorded.processTaskRef?.taskId !== taskId) {
            throw persistenceIntegrity('A process task command result does not match its execution run reference.');
          }
          const selected = await client.query(`
            select a.*, s.project_id as scoped_project_id
            from orgward.aggregates a
            join orgward.aggregate_project_scopes s
              on s.tenant_id = a.tenant_id and s.aggregate_kind = a.aggregate_kind and s.aggregate_id = a.aggregate_id
            where a.tenant_id = $1 and a.aggregate_kind = 'execution_run' and a.aggregate_id = $2
              and s.project_id = $3
            for share of a, s
          `, [tenantId, recorded.id, projectId]);
          if (!selected.rowCount) throw persistenceIntegrity('A process task command result has no linked run.');
          const run = verifyAggregateRow(selected.rows[0]);
          if (run.projectId !== projectId || contentHash(run.processTaskRef) !== contentHash(recorded.processTaskRef)) {
            throw persistenceIntegrity('A process task command result no longer matches its linked run.');
          }
          return { run, replayed: true };
        }

        const selectedProject = await client.query(`
          select * from orgward.aggregates
          where tenant_id = $1 and aggregate_kind = 'project' and aggregate_id = $2
          for update
        `, [tenantId, projectId]);
        if (!selectedProject.rowCount) return null;
        const project = verifyAggregateRow(selectedProject.rows[0]);
        const revisions = (project.processPlans ?? []).filter((plan) => plan.id === planId)
          .sort((left, right) => (left.revision ?? 1) - (right.revision ?? 1));
        const plan = revisions.find((candidate) => candidate.revision === revision);
        if (!plan) throw conflict('The saved process plan revision was not found.', null, 'PROCESS_PLAN_REVISION_NOT_FOUND');
        if (!/^[0-9a-f-]{36}$/i.test(planInstanceId ?? '') && planInstanceId !== null) {
          throw conflict('The plan instance reference is invalid.', null, 'INVALID_PROCESS_PLAN_INSTANCE');
        }
        const task = plan.tasks.find((candidate) => candidate.id === taskId);
        if (!task) throw conflict('The task was not found in this saved graph revision.', null, 'PROCESS_PLAN_TASK_NOT_FOUND');
        const instanceId = planInstanceId ?? randomUUID();
        await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `${tenantId}:process-plan-instance:${instanceId}`,
        ]);

        const instanceTasks = await client.query(`
          select * from orgward.process_task_instances
          where tenant_id = $1 and plan_instance_id = $2
          order by task_id
          for update
        `, [tenantId, instanceId]);
        const taskInstances = instanceTasks.rows;
        const instanceExists = instanceTasks.rowCount > 0;
        let instanceControl = await lockProcessTaskControl(client, tenantId, instanceId);
        if (instanceExists) {
          if (!instanceControl) throw persistenceIntegrity('An existing process instance has no durable control record.');
          requireActiveProcessTaskControl(instanceControl);
        }
        if (!instanceExists && planInstanceId !== null) {
          throw conflict('A task can join only an existing plan instance; start a new instance from a root task without supplying an instance ID.', null, 'PROCESS_TASK_INSTANCE_NOT_FOUND');
        }
        if (instanceExists && taskInstances.some((runtime) => runtime.project_id !== projectId
          || runtime.process_plan_id !== planId || Number(runtime.plan_revision) !== revision
          || runtime.blueprint_id !== plan.source.blueprintId
          || Number(runtime.blueprint_version) !== plan.source.blueprintVersion)) {
          throw conflict('This plan instance is already pinned to another immutable graph revision.', null, 'PROCESS_TASK_INSTANCE_PIN_CONFLICT');
        }
        if (!instanceExists) {
          const latest = revisions.at(-1);
          if (latest?.revision !== revision) {
            throw conflict('A new plan instance must start from the latest saved graph revision.', null, 'PROCESS_PLAN_REVISION_STALE');
          }
          if (project.id !== plan.source.projectId || project.blueprintVersions?.at(-1)?.version !== plan.source.blueprintVersion) {
            throw conflict('A new plan instance must use the current saved blueprint version.', null, 'PROCESS_PLAN_BLUEPRINT_STALE');
          }
          await client.query(`insert into orgward.process_task_instance_controls
            (tenant_id,project_id,process_plan_id,plan_revision,plan_instance_id,status,initiated_by,version,events)
            values ($1,$2,$3,$4,$5,'ACTIVE',$6,0,'[]'::jsonb)`,
          [tenantId, projectId, plan.id, plan.revision, instanceId, principal]);
        }
        if (project.id !== plan.source.projectId) {
          throw conflict('The plan belongs to another project.', null, 'PROCESS_PLAN_PROJECT_MISMATCH');
        }
        if (!Array.isArray(task.dependencies)) throw persistenceIntegrity('A saved process task has invalid dependencies.');
        const duplicateTask = taskInstances.some((runtime) => runtime.task_id === taskId);
        if (duplicateTask) throw conflict('This task already has an approval request in this plan instance.', null, 'PROCESS_TASK_ALREADY_REQUESTED');
        if (!instanceExists && task.dependencies.length) {
          throw conflict('A plan instance must start with a root task that has no dependencies.', null, 'PROCESS_TASK_DEPENDENCY_UNSATISFIED');
        }
        const linkedByTask = new Map(taskInstances.map((runtime) => [runtime.task_id, runtime]));
        for (const dependencyId of task.dependencies) {
          const dependencyRuntime = linkedByTask.get(dependencyId);
          const verifiedHumanSuccess = dependencyRuntime?.status === 'SUCCEEDED'
            && dependencyRuntime.actor_type === 'human'
            ? await hasVerifiedHumanTaskSuccess(client, dependencyRuntime)
            : true;
          if (dependencyRuntime?.status !== 'SUCCEEDED' || !verifiedHumanSuccess) {
            throw conflict('Every task dependency must be succeeded in this same plan instance.', null, 'PROCESS_TASK_DEPENDENCY_UNSATISFIED');
          }
        }

        const assignee = task.assignee;
        if (assignee?.kind !== 'blueprint-actor' || !assignee.actorId || !assignee.roleId) {
          throw conflict('Assign this task to a currently enabled blueprint actor and role before requesting approval.', null, 'PROCESS_TASK_ASSIGNMENT_REQUIRED');
        }
        const blueprint = project.blueprintVersions?.find((candidate) => candidate.id === plan.source.blueprintId
          && candidate.version === plan.source.blueprintVersion);
        const blueprintObjects = Object.values(blueprint?.areas ?? {}).flatMap((area) => area.items ?? []);
        const actor = blueprintObjects.find((item) => item.id === assignee.actorId);
        const role = blueprintObjects.find((item) => item.id === assignee.roleId);
        const linkedRole = actor && role?.type === 'role'
          && ((actor.assignedRoles ?? []).includes(role.id)
            || (blueprint.relations ?? []).some((relation) => relation.source === actor.id
              && relation.target === role.id && relation.type === 'assigned-to'));
        const expectedActorType = actor?.type === 'actor-agent' ? 'workload' : null;
        if (actor?.type === 'actor-human') {
          throw conflict('Human-assigned tasks require a durable human checkpoint flow; they cannot be represented as executor runs.', null, 'PROCESS_TASK_HUMAN_CHECKPOINT_REQUIRED');
        }
        if (!blueprint || !linkedRole || !expectedActorType) {
          throw conflict('The task assignment does not match an actor and role in its pinned blueprint.', null, 'PROCESS_TASK_ASSIGNMENT_INVALID');
        }
        const binding = await client.query(`
          select b.status, b.target_principal, b.target_membership_generation, b.target_authz_generation,
            identity.actor_type, identity.status as identity_status,
            identity.authz_generation as current_authz_generation
          from orgward.project_actor_binding_proposals b
          join orgward.oidc_principals identity
            on identity.tenant_id = b.tenant_id and identity.principal = b.target_principal
          where b.tenant_id = $1 and b.project_id = $2 and b.blueprint_version = $3
            and b.actor_id = $4 and b.role_id = $5
          for update of b, identity
        `, [tenantId, projectId, plan.source.blueprintVersion, actor.id, role.id]);
        if (!binding.rowCount || binding.rows[0].status !== 'enabled') {
          throw conflict('The task requires an enabled actor binding for its pinned blueprint version.', null, 'PROCESS_TASK_ACTOR_BINDING_UNAVAILABLE');
        }
        const target = binding.rows[0];
        const membership = await client.query(`
          select access, generation, revoked_at
          from orgward.project_memberships
          where tenant_id = $1 and project_id = $2 and principal = $3
          for update
        `, [tenantId, projectId, target.target_principal]);
        if (target.actor_type !== expectedActorType) {
          throw conflict('The assigned identity type no longer matches its blueprint actor.', null, 'PROCESS_TASK_ACTOR_TYPE_MISMATCH');
        }
        if (target.identity_status !== 'active' || !membership.rowCount || membership.rows[0].revoked_at !== null
          || !['owner', 'editor'].includes(membership.rows[0].access)) {
          throw conflict('The assigned identity is no longer an active project owner or editor.', null, 'PROCESS_TASK_ACTOR_BINDING_INELIGIBLE');
        }
        if (Number(target.target_authz_generation) !== Number(target.current_authz_generation)
          || Number(target.target_membership_generation) !== Number(membership.rows[0].generation)) {
          throw conflict('The assigned identity or project membership changed after binding approval.', null, 'PROCESS_TASK_ACTOR_BINDING_STALE');
        }

        const processTaskRef = {
          processPlanId: plan.id, revision: plan.revision,
          planInstanceId: instanceId, taskId: task.id,
          blueprintId: plan.source.blueprintId, blueprintVersion: plan.source.blueprintVersion,
          processId: plan.source.processId, processName: plan.source.processName,
          actorId: actor.id, roleId: role.id,
        };
        const run = await buildRun({ project, plan, task, processTaskRef, client });
        if (!run || run.tenantId !== tenantId || run.projectId !== projectId
          || run.processTaskRef && contentHash(run.processTaskRef) !== contentHash(processTaskRef)) {
          throw persistenceIntegrity('A process task run builder returned mismatched immutable references.');
        }
        run.processTaskRef = processTaskRef;
        await client.query(`
          insert into orgward.process_task_instances (
            tenant_id, project_id, process_plan_id, plan_revision, plan_instance_id, task_id,
            blueprint_id, blueprint_version, process_id, actor_id, role_id, actor_type,
            assigned_principal, assigned_membership_generation, assigned_authz_generation,
            status, version, created_at, updated_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'PLANNED',0,now(),now())
        `, [tenantId, projectId, plan.id, plan.revision, instanceId, task.id,
          plan.source.blueprintId, plan.source.blueprintVersion, plan.source.processId,
          actor.id, role.id, expectedActorType, target.target_principal,
          Number(target.target_membership_generation), Number(target.target_authz_generation)]);
        await this.saveInTransaction(client, run, {
          principal, requiredPrincipalRoles: ['workspace-write'], authzGeneration,
        });
        const commandResult = { id: run.id, tenantId, projectId, version: run.version, processTaskRef };
        await client.query(`
          insert into orgward.command_results
            (tenant_id, operation, command_id, payload_hash, aggregate_kind, aggregate_id, result, result_hash)
          values ($1, $2, $3, $4, 'execution_run', $5, $6::jsonb, $7)
        `, [tenantId, operation, commandId, requestHash, run.id, canonicalJson(commandResult), contentHash(commandResult)]);
        return { run, replayed: false };
      });
    } catch (error) {
      if (error.code === '23505' && error.constraint === 'aggregates_execution_process_task_once_idx') {
        throw conflict('This task already has an approval request in this plan instance.', null, 'PROCESS_TASK_ALREADY_REQUESTED');
      }
      throw error;
    }
    if (outcome && !outcome.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return outcome;
  }

  async cancelProcessTaskRun({
    tenantId, projectId, runId, principal, authzGeneration, version, commandId, requestHash,
  }) {
    if (!tenantId || !projectId || !runId || !principal || !commandId || !requestHash) throw projectAccessDenied();
    const operation = 'execution.process-task.cancel';
    const outcome = await this.persistence.transaction(async (client) => {
      await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      const priorCommand = await client.query(`
        select * from orgward.command_results
        where tenant_id = $1 and operation = $2 and command_id = $3
      `, [tenantId, operation, commandId]);
      if (priorCommand.rowCount) {
        if (priorCommand.rows[0].payload_hash !== requestHash) {
          throw conflict('This command ID was already used with different cancellation input.', null, 'IDEMPOTENCY_CONFLICT');
        }
        const recorded = verifyCommandRow(priorCommand.rows[0]);
        if (priorCommand.rows[0].aggregate_kind !== 'execution_run'
          || recorded.id !== runId || priorCommand.rows[0].aggregate_id !== runId
          || recorded.tenantId !== tenantId || recorded.projectId !== projectId
          || recorded.status !== 'CANCELLED') {
          throw persistenceIntegrity('A cancellation command result does not match its linked execution run.');
        }
        const selected = await client.query(`
          select a.*, s.project_id as scoped_project_id
          from orgward.aggregates a
          join orgward.aggregate_project_scopes s
            on s.tenant_id = a.tenant_id and s.aggregate_kind = a.aggregate_kind and s.aggregate_id = a.aggregate_id
          where a.tenant_id = $1 and a.aggregate_kind = 'execution_run' and a.aggregate_id = $2
            and s.project_id = $3
          for share of a, s
        `, [tenantId, runId, projectId]);
        if (!selected.rowCount) throw persistenceIntegrity('A cancellation command result has no scoped execution run.');
        const run = verifyAggregateRow(selected.rows[0]);
        const cancellation = run.events?.filter((entry) => entry.type === 'ExecutionCancelled' && entry.causationId === commandId) ?? [];
        if (run.status !== 'CANCELLED' || run.requestedBy !== principal
          || contentHash(run.processTaskRef) !== contentHash(recorded.processTaskRef)
          || cancellation.length !== 1) {
          throw persistenceIntegrity('A cancellation replay no longer matches its immutable run event.');
        }
        return { run, replayed: true };
      }

      await lockLinkedRunControl(client, tenantId, runId);

      const selected = await client.query(`
        select a.*, s.project_id as scoped_project_id
        from orgward.aggregates a
        join orgward.aggregate_project_scopes s
          on s.tenant_id = a.tenant_id and s.aggregate_kind = a.aggregate_kind and s.aggregate_id = a.aggregate_id
        where a.tenant_id = $1 and a.aggregate_kind = 'execution_run' and a.aggregate_id = $2
          and s.project_id = $3
        for update of a
      `, [tenantId, runId, projectId]);
      if (!selected.rowCount) return null;
      const run = verifyAggregateRow(selected.rows[0]);
      if (run.projectId !== projectId || run.tenantId !== tenantId) {
        throw persistenceIntegrity('The linked execution run project scope does not match its aggregate.');
      }
      if (run.requestedBy !== principal) throw projectAccessDenied();
      if (!run.processTaskRef) throw conflict('Only a linked process-task run can be withdrawn.', run.version, 'PROCESS_TASK_CANCELLATION_UNAVAILABLE');
      if (!['AWAITING_APPROVAL', 'APPROVED', 'PAUSED'].includes(run.status)) {
        throw conflict('Only pending, approved, or paused linked runs can be withdrawn; a running task cannot be withdrawn here.', run.version, 'PROCESS_TASK_CANCELLATION_UNAVAILABLE');
      }
      if (run.version !== version) throw conflict(`Version conflict: expected persisted version ${version}. Reload before retrying.`, run.version);
      const ref = run.processTaskRef;
      const runtimeRows = await client.query(`
        select * from orgward.process_task_instances
        where tenant_id = $1 and project_id = $2 and plan_instance_id = $3 and task_id = $4
        for update
      `, [tenantId, projectId, ref.planInstanceId, ref.taskId]);
      assertLinkedWorkloadRuntime(runtimeRows.rows[0], run);
      cancelProcessTaskExecutionRun(run, { principal, commandId });
      await this.saveInTransaction(client, run, {
        expectedVersion: version, principal, requiredPrincipalRoles: ['workspace-write'], authzGeneration,
        runtimeCommandId: commandId,
      });
      const commandResult = {
        id: run.id, tenantId, projectId, version: run.version, status: 'CANCELLED',
        processTaskRef: structuredClone(run.processTaskRef),
      };
      await client.query(`
        insert into orgward.command_results
          (tenant_id, operation, command_id, payload_hash, aggregate_kind, aggregate_id, result, result_hash)
        values ($1, $2, $3, $4, 'execution_run', $5, $6::jsonb, $7)
      `, [tenantId, operation, commandId, requestHash, run.id, canonicalJson(commandResult), contentHash(commandResult)]);
      return { run, replayed: false };
    });
    if (outcome && !outcome.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return outcome;
  }

  async pauseProcessTaskRun({
    tenantId, projectId, runId, principal, authzGeneration, version, commandId, requestHash,
  }) {
    if (!tenantId || !projectId || !runId || !principal || !commandId || !requestHash) throw projectAccessDenied();
    const operation = 'execution.process-task.pause';
    const outcome = await this.persistence.transaction(async (client) => {
      await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      const priorCommand = await client.query(`
        select * from orgward.command_results
        where tenant_id = $1 and operation = $2 and command_id = $3
      `, [tenantId, operation, commandId]);
      if (priorCommand.rowCount) {
        if (priorCommand.rows[0].payload_hash !== requestHash) {
          throw conflict('This command ID was already used with different pause input.', null, 'IDEMPOTENCY_CONFLICT');
        }
        const recorded = verifyCommandRow(priorCommand.rows[0]);
        if (priorCommand.rows[0].aggregate_kind !== 'execution_run'
          || recorded.id !== runId || recorded.tenantId !== tenantId || recorded.projectId !== projectId
          || recorded.status !== 'PAUSED') {
          throw persistenceIntegrity('A pause command result does not match its linked execution run.');
        }
        const selected = await client.query(`
          select a.* from orgward.aggregates a
          join orgward.aggregate_project_scopes s
            on s.tenant_id = a.tenant_id and s.aggregate_kind = a.aggregate_kind and s.aggregate_id = a.aggregate_id
          where a.tenant_id = $1 and a.aggregate_kind = 'execution_run' and a.aggregate_id = $2
            and s.project_id = $3
          for share of a, s
        `, [tenantId, runId, projectId]);
        if (!selected.rowCount) throw persistenceIntegrity('A pause command result has no scoped execution run.');
        const run = verifyAggregateRow(selected.rows[0]);
        const pauseEvents = run.events?.filter((event) => event.type === 'ExecutionPaused' && event.causationId === commandId) ?? [];
        if (run.projectId !== projectId || run.requestedBy !== principal
          || contentHash(run.processTaskRef) !== contentHash(recorded.processTaskRef) || pauseEvents.length !== 1) {
          throw persistenceIntegrity('A pause replay no longer matches its immutable run event.');
        }
        return { run, replayed: true };
      }

      await lockLinkedRunControl(client, tenantId, runId);

      const selected = await client.query(`
        select a.* from orgward.aggregates a
        join orgward.aggregate_project_scopes s
          on s.tenant_id = a.tenant_id and s.aggregate_kind = a.aggregate_kind and s.aggregate_id = a.aggregate_id
        where a.tenant_id = $1 and a.aggregate_kind = 'execution_run' and a.aggregate_id = $2
          and s.project_id = $3
        for update of a
      `, [tenantId, runId, projectId]);
      if (!selected.rowCount) return null;
      const run = verifyAggregateRow(selected.rows[0]);
      if (run.projectId !== projectId || run.tenantId !== tenantId) {
        throw persistenceIntegrity('The linked execution run project scope does not match its aggregate.');
      }
      if (run.requestedBy !== principal) throw projectAccessDenied();
      if (!run.processTaskRef) throw conflict('Only a linked process-task run can be paused.', run.version, 'PROCESS_TASK_PAUSE_UNAVAILABLE');
      if (!['AWAITING_APPROVAL', 'APPROVED'].includes(run.status)) {
        throw conflict('Only a pending or approved linked run can be paused before work starts.', run.version, 'PROCESS_TASK_PAUSE_UNAVAILABLE');
      }
      if (run.version !== version) throw conflict(`Version conflict: expected persisted version ${version}. Reload before retrying.`, run.version);
      const ref = run.processTaskRef;
      const runtimeRows = await client.query(`
        select * from orgward.process_task_instances
        where tenant_id = $1 and project_id = $2 and plan_instance_id = $3 and task_id = $4
        for update
      `, [tenantId, projectId, ref.planInstanceId, ref.taskId]);
      const runtime = assertLinkedWorkloadRuntime(runtimeRows.rows[0], run);
      if (runtime.started_at !== null || runtime.completed_at !== null) {
        throw persistenceIntegrity('A linked run can only be paused before its task runtime starts.');
      }
      pauseProcessTaskExecutionRun(run, { principal, commandId });
      await this.saveInTransaction(client, run, {
        expectedVersion: version, principal, requiredPrincipalRoles: ['workspace-write'], authzGeneration,
        runtimeCommandId: commandId,
      });
      const commandResult = {
        id: run.id, tenantId, projectId, version: run.version, status: 'PAUSED',
        processTaskRef: structuredClone(run.processTaskRef),
      };
      await client.query(`
        insert into orgward.command_results
          (tenant_id, operation, command_id, payload_hash, aggregate_kind, aggregate_id, result, result_hash)
        values ($1, $2, $3, $4, 'execution_run', $5, $6::jsonb, $7)
      `, [tenantId, operation, commandId, requestHash, run.id, canonicalJson(commandResult), contentHash(commandResult)]);
      return { run, replayed: false };
    });
    if (outcome && !outcome.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return outcome;
  }

  async amendPausedProcessTaskRun({
    tenantId, projectId, runId, principal, authzGeneration, version, commandId, requestHash,
    objective, requirements, reason,
  }) {
    if (!tenantId || !projectId || !runId || !principal || !commandId || !requestHash) throw projectAccessDenied();
    const operation = 'execution.process-task.amend';
    const outcome = await this.persistence.transaction(async (client) => {
      await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      const priorCommand = await client.query(`
        select * from orgward.command_results
        where tenant_id = $1 and operation = $2 and command_id = $3
      `, [tenantId, operation, commandId]);
      if (priorCommand.rowCount) {
        if (priorCommand.rows[0].payload_hash !== requestHash) {
          throw conflict('This command ID was already used with different amendment input.', null, 'IDEMPOTENCY_CONFLICT');
        }
        const recorded = verifyCommandRow(priorCommand.rows[0]);
        if (priorCommand.rows[0].aggregate_kind !== 'execution_run' || recorded.id !== runId
          || recorded.tenantId !== tenantId || recorded.projectId !== projectId || recorded.status !== 'PAUSED') {
          throw persistenceIntegrity('An amendment command result does not match its linked execution run.');
        }
        const selected = await client.query(`
          select a.* from orgward.aggregates a
          join orgward.aggregate_project_scopes s
            on s.tenant_id = a.tenant_id and s.aggregate_kind = a.aggregate_kind and s.aggregate_id = a.aggregate_id
          where a.tenant_id = $1 and a.aggregate_kind = 'execution_run' and a.aggregate_id = $2
            and s.project_id = $3
          for share of a, s
        `, [tenantId, runId, projectId]);
        if (!selected.rowCount) throw persistenceIntegrity('An amendment command result has no scoped execution run.');
        const run = verifyAggregateRow(selected.rows[0]);
        const amendmentEvents = run.events?.filter((entry) => entry.type === 'ExecutionInstructionsAmended'
          && entry.causationId === commandId) ?? [];
        const recordedRevision = run.interventionRevisions?.find((entry) => entry.revision === recorded.interventionRevision?.revision);
        if (run.projectId !== projectId || run.requestedBy !== principal || amendmentEvents.length !== 1
          || contentHash(recordedRevision) !== contentHash(recorded.interventionRevision)
          || contentHash(amendmentEvents[0]?.data?.revision) !== contentHash(recorded.interventionRevision)) {
          throw persistenceIntegrity('An amendment replay no longer matches its immutable run revision.');
        }
        return { run, replayed: true };
      }

      await lockLinkedRunControl(client, tenantId, runId);

      const selected = await client.query(`
        select a.* from orgward.aggregates a
        join orgward.aggregate_project_scopes s
          on s.tenant_id = a.tenant_id and s.aggregate_kind = a.aggregate_kind and s.aggregate_id = a.aggregate_id
        where a.tenant_id = $1 and a.aggregate_kind = 'execution_run' and a.aggregate_id = $2
          and s.project_id = $3
        for update of a
      `, [tenantId, runId, projectId]);
      if (!selected.rowCount) return null;
      const run = verifyAggregateRow(selected.rows[0]);
      if (run.projectId !== projectId || run.tenantId !== tenantId) {
        throw persistenceIntegrity('The linked execution run project scope does not match its aggregate.');
      }
      if (run.requestedBy !== principal) throw projectAccessDenied();
      if (!run.processTaskRef) throw conflict('Only a linked process-task run can be amended.', run.version, 'PROCESS_TASK_AMEND_UNAVAILABLE');
      if (run.status !== 'PAUSED' || run.approval !== null || run.execution !== null) {
        throw conflict('Only a paused, unapproved linked run can be amended before execution.', run.version, 'PROCESS_TASK_AMEND_UNAVAILABLE');
      }
      if (run.version !== version) throw conflict(`Version conflict: expected persisted version ${version}. Reload before retrying.`, run.version);
      const ref = run.processTaskRef;
      const runtimeRows = await client.query(`
        select * from orgward.process_task_instances
        where tenant_id = $1 and project_id = $2 and plan_instance_id = $3 and task_id = $4
        for update
      `, [tenantId, projectId, ref.planInstanceId, ref.taskId]);
      const runtime = assertLinkedWorkloadRuntime(runtimeRows.rows[0], run);
      if (runtime.started_at !== null || runtime.completed_at !== null) {
        throw conflict('Instructions can only be amended before the linked task runtime starts.', run.version, 'PROCESS_TASK_AMEND_UNAVAILABLE');
      }
      amendPausedProcessTaskExecutionRun(run, { principal, commandId, objective, requirements, reason });
      const revision = run.interventionRevisions.at(-1);
      if (run.workItem.proposalContext) {
        buildBlueprintProposalPrompt({
          task: { id: ref.taskId, title: run.title, detail: revision.objective },
          proposalContext: run.workItem.proposalContext,
          amendedRequirements: revision.requirements,
        });
      }
      await this.saveInTransaction(client, run, {
        expectedVersion: version, principal, requiredPrincipalRoles: ['workspace-write'], authzGeneration,
        runtimeCommandId: commandId,
      });
      const commandResult = {
        id: run.id, tenantId, projectId, version: run.version, status: 'PAUSED',
        processTaskRef: structuredClone(run.processTaskRef),
        interventionRevision: structuredClone(run.interventionRevisions.at(-1)),
      };
      await client.query(`
        insert into orgward.command_results
          (tenant_id, operation, command_id, payload_hash, aggregate_kind, aggregate_id, result, result_hash)
        values ($1, $2, $3, $4, 'execution_run', $5, $6::jsonb, $7)
      `, [tenantId, operation, commandId, requestHash, run.id, canonicalJson(commandResult), contentHash(commandResult)]);
      return { run, replayed: false };
    });
    if (outcome && !outcome.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return outcome;
  }

  async resumeProcessTaskRun({
    tenantId, projectId, runId, principal, authzGeneration, version, commandId, requestHash,
    validateCurrentProfile, reason = null,
  }) {
    if (!tenantId || !projectId || !runId || !principal || !commandId || !requestHash
      || typeof validateCurrentProfile !== 'function'
      || (reason !== null && (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500))) throw projectAccessDenied();
    reason = reason?.replace(/\s+/g, ' ').trim() ?? null;
    const operation = 'execution.process-task.resume';
    const outcome = await this.persistence.transaction(async (client) => {
      const callerMembership = await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human' });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      const priorCommand = await client.query(`
        select * from orgward.command_results
        where tenant_id = $1 and operation = $2 and command_id = $3
      `, [tenantId, operation, commandId]);
      if (priorCommand.rowCount) {
        if (priorCommand.rows[0].payload_hash !== requestHash) {
          throw conflict('This command ID was already used with different resume input.', null, 'IDEMPOTENCY_CONFLICT');
        }
        const recorded = verifyCommandRow(priorCommand.rows[0]);
        if (priorCommand.rows[0].aggregate_kind !== 'execution_run'
          || recorded.id !== runId || recorded.tenantId !== tenantId || recorded.projectId !== projectId
          || recorded.status !== 'AWAITING_APPROVAL') {
          throw persistenceIntegrity('A resume command result does not match its linked execution run.');
        }
        const selected = await client.query(`
          select a.* from orgward.aggregates a
          join orgward.aggregate_project_scopes s
            on s.tenant_id = a.tenant_id and s.aggregate_kind = a.aggregate_kind and s.aggregate_id = a.aggregate_id
          where a.tenant_id = $1 and a.aggregate_kind = 'execution_run' and a.aggregate_id = $2
            and s.project_id = $3
          for share of a, s
        `, [tenantId, runId, projectId]);
        if (!selected.rowCount) throw persistenceIntegrity('A resume command result has no scoped execution run.');
        const run = verifyAggregateRow(selected.rows[0]);
        const resumeEvents = run.events?.filter((event) => event.type === 'ExecutionResumed' && event.causationId === commandId) ?? [];
        const resumeEvent = resumeEvents[0];
        const ownerRecovery = run.requestedBy !== principal && callerMembership.access === 'owner';
        if (run.projectId !== projectId || (run.requestedBy !== principal && !ownerRecovery)
          || resumeEvent?.actor !== principal || Boolean(resumeEvent?.data?.ownerRecovery) !== ownerRecovery
          || (ownerRecovery && (resumeEvent?.data?.reason !== reason || !reason?.trim()))
          || contentHash(run.processTaskRef) !== contentHash(recorded.processTaskRef) || resumeEvents.length !== 1) {
          throw persistenceIntegrity('A resume replay no longer matches its immutable run event.');
        }
        return { run, replayed: true };
      }

      const selectedProject = await client.query(`
        select * from orgward.aggregates
        where tenant_id = $1 and aggregate_kind = 'project' and aggregate_id = $2
        for share
      `, [tenantId, projectId]);
      if (!selectedProject.rowCount) return null;
      const project = verifyAggregateRow(selectedProject.rows[0]);
      await lockLinkedRunControl(client, tenantId, runId);
      const selected = await client.query(`
        select a.* from orgward.aggregates a
        join orgward.aggregate_project_scopes s
          on s.tenant_id = a.tenant_id and s.aggregate_kind = a.aggregate_kind and s.aggregate_id = a.aggregate_id
        where a.tenant_id = $1 and a.aggregate_kind = 'execution_run' and a.aggregate_id = $2
          and s.project_id = $3
        for update of a
      `, [tenantId, runId, projectId]);
      if (!selected.rowCount) return null;
      const run = verifyAggregateRow(selected.rows[0]);
      if (run.projectId !== projectId || run.tenantId !== tenantId) {
        throw persistenceIntegrity('The linked execution run project scope does not match its aggregate.');
      }
      const ownerRecovery = run.requestedBy !== principal && callerMembership.access === 'owner';
      if (run.requestedBy !== principal && !ownerRecovery) throw projectAccessDenied();
      if (ownerRecovery && !reason?.trim()) throw conflict('Current project owner recovery requires a reason.', run.version, 'RECOVERY_REASON_REQUIRED');
      if (!run.processTaskRef) throw conflict('Only a linked process-task run can be resumed.', run.version, 'PROCESS_TASK_RESUME_UNAVAILABLE');
      if (run.status !== 'PAUSED') throw conflict('Only a paused linked run can be resumed.', run.version, 'PROCESS_TASK_RESUME_UNAVAILABLE');
      if (run.version !== version) throw conflict(`Version conflict: expected persisted version ${version}. Reload before retrying.`, run.version);

      const ref = run.processTaskRef;
      const runtimeRows = await client.query(`
        select * from orgward.process_task_instances
        where tenant_id = $1 and project_id = $2 and plan_instance_id = $3 and task_id = $4
        for update
      `, [tenantId, projectId, ref.planInstanceId, ref.taskId]);
      const runtime = assertLinkedWorkloadRuntime(runtimeRows.rows[0], run);
      if (runtime.started_at !== null || runtime.completed_at !== null || run.approval !== null) {
        throw persistenceIntegrity('A paused process task must remain unstarted and require a new approval.');
      }

      const plans = (project.processPlans ?? []).filter((candidate) => candidate.id === ref.processPlanId);
      const plan = plans.find((candidate) => (candidate.revision ?? 1) === ref.revision);
      if (!plan || plan.source?.projectId !== projectId || plan.source?.blueprintId !== ref.blueprintId
        || plan.source?.blueprintVersion !== ref.blueprintVersion || plan.source?.processId !== ref.processId) {
        throw conflict('The immutable plan revision pinned to this paused task is no longer available.', run.version, 'PROCESS_PLAN_REVISION_NOT_FOUND');
      }
      const task = plan.tasks?.find((candidate) => candidate.id === ref.taskId);
      const assignee = task?.assignee;
      if (!task || assignee?.kind !== 'blueprint-actor' || assignee.actorId !== ref.actorId || assignee.roleId !== ref.roleId) {
        throw conflict('The immutable task or actor assignment no longer matches the paused request.', run.version, 'PROCESS_TASK_ASSIGNMENT_STALE');
      }
      const expectedRequirements = [
        ...task.inputs.map((entry) => `Use input: ${entry.label}`),
        ...task.outputs.map((entry) => `Produce output: ${entry.label}`),
      ];
      const expectedSourceRefs = [
        `process-plan:${plan.id}:revision:${plan.revision}`,
        `task:${task.id}`,
        ...task.inputs.map((entry) => `input:${entry.objectId}`),
        ...task.outputs.map((entry) => `output:${entry.objectId}`),
      ];
      if (task.title !== run.title || task.detail !== run.workItem.objective
        || contentHash(expectedRequirements) !== contentHash(run.workItem.requirements)
        || contentHash(expectedSourceRefs) !== contentHash(run.workItem.sourceRefs)) {
        throw conflict('The pinned task instructions or dependencies no longer match the paused request.', run.version, 'PROCESS_TASK_ASSIGNMENT_STALE');
      }
      if (!Array.isArray(task.dependencies)) throw persistenceIntegrity('The pinned process task has invalid dependencies.');
      if (task.dependencies.length) {
        const dependencies = await client.query(`
          select task_id, status from orgward.process_task_instances
          where tenant_id = $1 and project_id = $2 and plan_instance_id = $3 and task_id = any($4::text[])
          order by task_id for share
        `, [tenantId, projectId, ref.planInstanceId, task.dependencies]);
        const completed = new Map(dependencies.rows.map((entry) => [entry.task_id, entry.status]));
        if (task.dependencies.some((dependencyId) => completed.get(dependencyId) !== 'SUCCEEDED')) {
          throw conflict('A paused task cannot resume until its dependencies are still succeeded in the same instance.', run.version, 'PROCESS_TASK_DEPENDENCY_UNSATISFIED');
        }
      }

      const blueprint = project.blueprintVersions?.find((entry) => entry.id === ref.blueprintId && entry.version === ref.blueprintVersion);
      const blueprintObjects = Object.values(blueprint?.areas ?? {}).flatMap((area) => area.items ?? []);
      const actor = blueprintObjects.find((entry) => entry.id === ref.actorId);
      const role = blueprintObjects.find((entry) => entry.id === ref.roleId);
      const linkedRole = actor?.type === 'actor-agent' && role?.type === 'role'
        && ((actor.assignedRoles ?? []).includes(role.id)
          || (blueprint.relations ?? []).some((entry) => entry.source === actor.id
            && entry.target === role.id && entry.type === 'assigned-to'));
      if (!blueprint || !linkedRole) {
        throw conflict('The pinned blueprint actor or role assignment is no longer valid.', run.version, 'PROCESS_TASK_ASSIGNMENT_STALE');
      }
      const bindingRows = await client.query(`
        select b.status, b.target_principal, b.target_membership_generation, b.target_authz_generation,
          identity.actor_type, identity.status as identity_status,
          identity.authz_generation as current_authz_generation
        from orgward.project_actor_binding_proposals b
        join orgward.oidc_principals identity
          on identity.tenant_id = b.tenant_id and identity.principal = b.target_principal
        where b.tenant_id = $1 and b.project_id = $2 and b.blueprint_version = $3
          and b.actor_id = $4 and b.role_id = $5
        for update of b, identity
      `, [tenantId, projectId, ref.blueprintVersion, ref.actorId, ref.roleId]);
      const binding = bindingRows.rows[0];
      if (!binding || binding.status !== 'enabled' || binding.target_principal !== runtime.assigned_principal
        || binding.actor_type !== 'workload' || binding.identity_status !== 'active'
        || Number(binding.target_authz_generation) !== Number(binding.current_authz_generation)
        || Number(binding.target_authz_generation) !== Number(runtime.assigned_authz_generation)) {
        throw conflict('The original workload binding is no longer current; the paused request remains paused.', run.version, 'PROCESS_TASK_ACTOR_BINDING_STALE');
      }
      const membershipRows = await client.query(`
        select access, generation, revoked_at from orgward.project_memberships
        where tenant_id = $1 and project_id = $2 and principal = $3
        for update
      `, [tenantId, projectId, binding.target_principal]);
      const membership = membershipRows.rows[0];
      if (!membership || membership.revoked_at !== null || !['owner', 'editor'].includes(membership.access)
        || Number(membership.generation) !== Number(binding.target_membership_generation)
        || Number(membership.generation) !== Number(runtime.assigned_membership_generation)) {
        throw conflict('The original workload project membership is no longer current; the paused request remains paused.', run.version, 'PROCESS_TASK_ACTOR_BINDING_STALE');
      }
      await validateCurrentProfile(run, client);

      resumeProcessTaskExecutionRun(run, { principal, commandId, ownerRecovery, reason });
      await this.saveInTransaction(client, run, {
        expectedVersion: version, principal, requiredPrincipalRoles: ['workspace-write'], authzGeneration,
        runtimeCommandId: commandId,
      });
      const commandResult = {
        id: run.id, tenantId, projectId, version: run.version, status: 'AWAITING_APPROVAL',
        processTaskRef: structuredClone(run.processTaskRef),
      };
      await client.query(`
        insert into orgward.command_results
          (tenant_id, operation, command_id, payload_hash, aggregate_kind, aggregate_id, result, result_hash)
        values ($1, $2, $3, $4, 'execution_run', $5, $6::jsonb, $7)
      `, [tenantId, operation, commandId, requestHash, run.id, canonicalJson(commandResult), contentHash(commandResult)]);
      return { run, replayed: false };
    });
    if (outcome && !outcome.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return outcome;
  }

  async listProcessTaskInstancesForPrincipal({ tenantId, projectId, principal, authzGeneration }) {
    if (!tenantId || !projectId || !principal) return null;
    return this.persistence.transaction(async (client) => {
      await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'reader' });
      await requirePrincipalAuthority(client, {
        tenantId, principal, anyRoleGroups: [['workspace-read', 'workspace-write', 'tenant-admin']], authzGeneration,
      });
      const result = await client.query(`
        select r.*, c.status as instance_control_status, c.version as instance_control_version,
          c.initiated_by as instance_control_initiated_by, c.pause_reason as instance_control_pause_reason,
          c.pause_boundary as instance_control_pause_boundary, c.events as instance_control_events,
          (caller.status = 'active' and caller.actor_type = 'human'
            and caller.authz_generation = $4 and caller.roles @> array['workspace-write']::text[]
            and caller_membership.access in ('editor','owner') and caller_membership.revoked_at is null
            and (c.initiated_by = $3 or caller_membership.access = 'owner')) as can_control_instance,
          (caller.status = 'active' and caller.actor_type = 'human'
            and caller.authz_generation = $4 and caller.roles @> array['workspace-write']::text[]
            and caller_membership.access = 'owner' and caller_membership.revoked_at is null) as can_recover_instance,
          (caller.status = 'active' and caller.actor_type = 'human'
            and caller.authz_generation = $4 and caller.roles @> array['workspace-write']::text[]
            and caller_membership.access = 'owner' and caller_membership.revoked_at is null
            and c.status in ('PAUSE_REQUESTED','PAUSED')
            and not exists (select 1 from orgward.process_task_instances active
              where active.tenant_id=r.tenant_id and active.plan_instance_id=r.plan_instance_id
                and active.status in ('IN_PROGRESS','ESCALATED','RUNNING'))
            and not exists (select 1 from orgward.execution_worker_leases l
              join orgward.aggregates la on la.tenant_id=l.tenant_id and la.aggregate_kind='execution_run' and la.aggregate_id=l.run_id
              where l.tenant_id=r.tenant_id and l.lease_until>now()
                and la.state #>> '{processTaskRef,planInstanceId}'=r.plan_instance_id::text)
            and exists (select 1 from orgward.provider_dispatch_attempts d
              join orgward.aggregates da on da.tenant_id=d.tenant_id and da.aggregate_kind='execution_run' and da.aggregate_id=d.run_id
              where d.tenant_id=r.tenant_id and da.state #>> '{processTaskRef,planInstanceId}'=r.plan_instance_id::text
                and d.status in ('reserved','handed_off','outcome_unknown')
                and da.state #>> '{profile,kind}'='provider-openai'
                and da.state #>> '{workItem,proposalContext,target,type}'='information'
                and case when jsonb_typeof(da.state #> '{workItem,proposalContext,sourceEnvelope,sources}')='array'
                  then jsonb_array_length(da.state #> '{workItem,proposalContext,sourceEnvelope,sources}') between 1 and 8 else false end
                and not (da.state ?| array['toolPlan','toolPlans','externalActions','capabilities','effects','effectPlan']
                  or (da.state->'workItem') ?| array['toolPlan','toolPlans','externalActions','capabilities','effects','effectPlan','tools']))
            and not exists (select 1 from orgward.provider_dispatch_attempts d
              join orgward.aggregates da on da.tenant_id=d.tenant_id and da.aggregate_kind='execution_run' and da.aggregate_id=d.run_id
              where d.tenant_id=r.tenant_id and da.state #>> '{processTaskRef,planInstanceId}'=r.plan_instance_id::text
                and d.status in ('reserved','handed_off','outcome_unknown')
                and (d.status <> 'outcome_unknown' or da.state #>> '{profile,kind}' <> 'provider-openai'
                  or da.state #>> '{workItem,proposalContext,target,type}' <> 'information'
                  or case when jsonb_typeof(da.state #> '{workItem,proposalContext,sourceEnvelope,sources}')='array'
                    then jsonb_array_length(da.state #> '{workItem,proposalContext,sourceEnvelope,sources}') not between 1 and 8 else true end
                  or da.state ?| array['toolPlan','toolPlans','externalActions','capabilities','effects','effectPlan']
                  or (da.state->'workItem') ?| array['toolPlan','toolPlans','externalActions','capabilities','effects','effectPlan','tools']))
          ) as can_abandon_unverified,
          (r.assigned_principal = $3 and p.status = 'active'
            and r.assigned_authz_generation = p.authz_generation
            and r.assigned_membership_generation = m.generation and m.revoked_at is null)
            as assigned_to_current_principal,
          (caller.status = 'active' and caller.actor_type = 'human'
            and caller.authz_generation = $4 and caller.roles @> array['workspace-write']::text[]
            and caller_membership.access = 'owner' and caller_membership.revoked_at is null)
            as can_resolve_escalation
        from orgward.process_task_instances r
        left join orgward.process_task_instance_controls c
          on c.tenant_id = r.tenant_id and c.plan_instance_id = r.plan_instance_id
        left join orgward.oidc_principals p
          on p.tenant_id = r.tenant_id and p.principal = r.assigned_principal
        left join orgward.project_memberships m
          on m.tenant_id = r.tenant_id and m.project_id = r.project_id and m.principal = r.assigned_principal
        left join orgward.oidc_principals caller
          on caller.tenant_id = r.tenant_id and caller.principal = $3
        left join orgward.project_memberships caller_membership
          on caller_membership.tenant_id = r.tenant_id and caller_membership.project_id = r.project_id
            and caller_membership.principal = $3
        where r.tenant_id = $1 and r.project_id = $2
        order by r.created_at, r.plan_instance_id, r.task_id
        for share of r
      `, [tenantId, projectId, principal, authzGeneration]);
      return result.rows.map((row) => processTaskRuntimeView(row, principal));
    });
  }

  async pauseProcessTaskInstance({ tenantId, projectId, planInstanceId, principal, authzGeneration, version, reason, commandId, requestHash }) {
    const operation = 'execution.process-instance.pause';
    if (!tenantId || !projectId || !planInstanceId || !principal || !commandId || !requestHash
      || typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) throw projectAccessDenied();
    const outcome = await this.persistence.transaction(async (client) => {
      const membership = await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human' });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      const prior = await client.query(`select * from orgward.command_results where tenant_id=$1 and operation=$2 and command_id=$3`, [tenantId, operation, commandId]);
      if (prior.rowCount) {
        if (prior.rows[0].payload_hash !== requestHash) throw conflict('This command ID was already used with different pause input.', null, 'IDEMPOTENCY_CONFLICT');
        const recorded = verifyCommandRow(prior.rows[0]);
        if (recorded.planInstanceId !== planInstanceId || recorded.projectId !== projectId) throw persistenceIntegrity('A process pause replay has mismatched instance references.');
        const control = await lockProcessTaskControl(client, tenantId, planInstanceId);
        if (control?.initiated_by !== principal && membership.access !== 'owner') throw projectAccessDenied();
        if (!control || !control.events.some((event) => event.causationId === commandId && event.type === 'ProcessTaskInstancePauseRequested')) {
          throw persistenceIntegrity('A process pause replay no longer matches its append-only event.');
        }
        return { control, replayed: true };
      }
      const control = await lockProcessTaskControl(client, tenantId, planInstanceId);
      if (!control || control.project_id !== projectId) return null;
      if (Number(control.version) !== version) throw conflict('The process instance control changed; reload before retrying.', Number(control.version), 'PROCESS_INSTANCE_CONTROL_CONFLICT');
      if (control.initiated_by !== principal && membership.access !== 'owner') throw projectAccessDenied();
      requireProcessTaskControlNotAbandoned(control);
      if (control.status !== 'ACTIVE') throw conflict('This process instance is already pausing or paused.', Number(control.version), 'PROCESS_INSTANCE_PAUSED');
      const runtimes = await client.query(`select * from orgward.process_task_instances
        where tenant_id=$1 and project_id=$2 and plan_instance_id=$3 order by task_id for update`, [tenantId, projectId, planInstanceId]);
      if (!runtimes.rowCount) throw conflict('The process instance was not found.', null, 'PROCESS_TASK_INSTANCE_NOT_FOUND');
      const boundary = [];
      let unresolvedWork = runtimes.rows.some((row) => ['IN_PROGRESS', 'ESCALATED', 'RUNNING'].includes(row.status));
      for (const runtime of runtimes.rows) {
        if (runtime.actor_type === 'human' && runtime.status === 'IN_PROGRESS') {
          boundary.push({ taskId: runtime.task_id, actorType: 'human', runtimeVersion: Number(runtime.version), status: runtime.status });
        }
        if (runtime.actor_type !== 'workload' || !runtime.execution_run_id) continue;
        const selected = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2 for update`, [tenantId, runtime.execution_run_id]);
        if (!selected.rowCount) throw persistenceIntegrity('A linked process task run is missing during instance pause.');
        const run = verifyAggregateRow(selected.rows[0]);
        assertLinkedWorkloadRuntime(runtime, run);
        const attempts = await client.query(`select * from orgward.provider_dispatch_attempts where tenant_id=$1 and run_id=$2 for update`, [tenantId, run.id]);
        const leases = await client.query(`select worker_id from orgward.execution_worker_leases where tenant_id=$1 and run_id=$2 and lease_until>now() for update`, [tenantId, run.id]);
        for (const attempt of attempts.rows) {
          if (attempt.status === 'reserved') await client.query(`update orgward.provider_dispatch_attempts set status='cancelled',finished_at=now(),updated_at=now() where tenant_id=$1 and run_id=$2 and attempt_id=$3 and status='reserved'`, [tenantId, run.id, attempt.attempt_id]);
        }
        if (leases.rowCount && !attempts.rows.some((attempt) => attempt.status === 'handed_off')) {
          await client.query(`update orgward.execution_worker_leases set cancel_requested_at=coalesce(cancel_requested_at,now()),cancel_reason=coalesce(cancel_reason,'process_instance_pause'),updated_at=now() where tenant_id=$1 and run_id=$2 and lease_until>now()`, [tenantId, run.id]);
        }
        if (['AWAITING_APPROVAL', 'APPROVED'].includes(run.status)) {
          pauseProcessTaskExecutionRun(run, { principal: run.requestedBy, commandId, instanceControl: true, actor: principal });
          await this.saveInTransaction(client, run, { expectedVersion: Number(selected.rows[0].version),
            principal, requiredPrincipalRoles: ['workspace-write'], authzGeneration, runtimeCommandId: commandId,
            instanceControlMutation: true });
          continue;
        }
        const unresolvedAttempt = attempts.rows.find((attempt) => ['handed_off', 'outcome_unknown'].includes(attempt.status));
        const hasLiveLease = Boolean(leases.rowCount);
        if (run.status === 'RUNNING' || unresolvedAttempt || hasLiveLease) {
          if (unresolvedAttempt || hasLiveLease) unresolvedWork = true;
          const instructionRevision = run.interventionRevisions?.at(-1)?.revision ?? 0;
          boundary.push({ taskId: runtime.task_id, actorType: 'workload', runId: run.id,
            runVersion: Number(run.version), instructionRevision,
            instructionHash: contentHash(run.interventionRevisions?.at(-1) ?? run.workItem), status: run.status,
            attemptId: unresolvedAttempt?.attempt_id ?? null,
            attemptStatus: unresolvedAttempt?.status ?? null,
            liveLease: hasLiveLease });
        }
      }
      let next = await appendProcessTaskControl(client, control, { status: 'PAUSE_REQUESTED',
        reason: reason.trim(), boundary: { tasks: boundary, requestedAt: new Date().toISOString() },
        actor: principal, commandId, eventType: 'ProcessTaskInstancePauseRequested' });
      if (!unresolvedWork) next = await settleProcessTaskPauseIfDrained(client, tenantId, planInstanceId);
      const result = { planInstanceId, projectId, status: next.status, version: Number(next.version), reason: next.pause_reason, pauseBoundary: next.pause_boundary };
      await client.query(`insert into orgward.command_results (tenant_id,operation,command_id,payload_hash,aggregate_kind,aggregate_id,result,result_hash)
        values ($1,$2,$3,$4,'process_task_instance_control',$5,$6::jsonb,$7)`,
      [tenantId, operation, commandId, requestHash, planInstanceId, canonicalJson(result), contentHash(result)]);
      return { control: next, replayed: false };
    });
    if (outcome && !outcome.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return outcome;
  }

  async resumeProcessTaskInstance({ tenantId, projectId, planInstanceId, principal, authzGeneration, version, commandId, requestHash }) {
    const operation = 'execution.process-instance.resume';
    if (!tenantId || !projectId || !planInstanceId || !principal || !commandId || !requestHash) throw projectAccessDenied();
    const outcome = await this.persistence.transaction(async (client) => {
      const membership = await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human' });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      const prior = await client.query(`select * from orgward.command_results where tenant_id=$1 and operation=$2 and command_id=$3`, [tenantId, operation, commandId]);
      if (prior.rowCount) {
        if (prior.rows[0].payload_hash !== requestHash) throw conflict('This command ID was already used with different resume input.', null, 'IDEMPOTENCY_CONFLICT');
        const recorded = verifyCommandRow(prior.rows[0]);
        if (recorded.planInstanceId !== planInstanceId || recorded.projectId !== projectId) throw persistenceIntegrity('A process resume replay has mismatched instance references.');
        const control = await lockProcessTaskControl(client, tenantId, planInstanceId);
        if (control?.initiated_by !== principal && membership.access !== 'owner') throw projectAccessDenied();
        if (!control || !control.events.some((event) => event.causationId === commandId && event.type === 'ProcessTaskInstanceResumed')) throw persistenceIntegrity('A process resume replay no longer matches its append-only event.');
        return { control, replayed: true };
      }
      const projectRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='project' and aggregate_id=$2 for share`, [tenantId, projectId]);
      if (!projectRow.rowCount) return null;
      const project = verifyAggregateRow(projectRow.rows[0]);
      const control = await lockProcessTaskControl(client, tenantId, planInstanceId);
      if (!control || control.project_id !== projectId) return null;
      if (Number(control.version) !== version) throw conflict('The process instance control changed; reload before retrying.', Number(control.version), 'PROCESS_INSTANCE_CONTROL_CONFLICT');
      requireProcessTaskControlNotAbandoned(control);
      if (control.status !== 'PAUSED') throw conflict('The process instance must reach its recorded paused boundary before it can resume.', Number(control.version), 'PROCESS_INSTANCE_NOT_PAUSED');
      if (control.initiated_by !== principal && membership.access !== 'owner') throw projectAccessDenied();
      const plan = (project.processPlans ?? []).find((candidate) => candidate.id === control.process_plan_id && candidate.revision === Number(control.plan_revision));
      if (!plan || plan.source?.projectId !== projectId) throw conflict('The immutable plan revision at the pause boundary is no longer available.', null, 'PROCESS_PLAN_REVISION_NOT_FOUND');
      const runtimes = await client.query(`select * from orgward.process_task_instances where tenant_id=$1 and plan_instance_id=$2 order by task_id for update`, [tenantId, planInstanceId]);
      const byTask = new Map(runtimes.rows.map((runtime) => [runtime.task_id, runtime]));
      for (const taskId of (control.pause_boundary?.tasks ?? []).map((task) => task.taskId)) {
        const task = plan.tasks.find((candidate) => candidate.id === taskId);
        if (!task) throw conflict('The paused task is no longer present in its pinned plan revision.', null, 'PROCESS_PLAN_REVISION_NOT_FOUND');
        for (const dependencyId of task.dependencies ?? []) {
          if (byTask.get(dependencyId)?.status !== 'SUCCEEDED') throw conflict('A pause-boundary task dependency is no longer satisfied; the instance remains paused.', null, 'PROCESS_TASK_DEPENDENCY_UNSATISFIED');
        }
      }
      const live = await client.query(`select 1 from orgward.execution_worker_leases l
        join orgward.aggregates a on a.tenant_id=l.tenant_id and a.aggregate_kind='execution_run' and a.aggregate_id=l.run_id
        where l.tenant_id=$1 and a.state #>> '{processTaskRef,planInstanceId}'=$2 and l.lease_until>now() limit 1`, [tenantId, planInstanceId]);
      const unresolved = await client.query(`select 1 from orgward.provider_dispatch_attempts d
        join orgward.aggregates a on a.tenant_id=d.tenant_id and a.aggregate_kind='execution_run' and a.aggregate_id=d.run_id
        where d.tenant_id=$1 and a.state #>> '{processTaskRef,planInstanceId}'=$2 and d.status in ('handed_off','outcome_unknown') limit 1`, [tenantId, planInstanceId]);
      if (live.rowCount || unresolved.rowCount || runtimes.rows.some((runtime) => ['IN_PROGRESS', 'ESCALATED', 'RUNNING'].includes(runtime.status))) {
        throw conflict('The recorded pause boundary still has unresolved work; reconcile it before resuming.', Number(control.version), 'PROCESS_INSTANCE_WORK_UNRESOLVED');
      }
      const next = await appendProcessTaskControl(client, control, { status: 'ACTIVE', reason: null,
        boundary: control.pause_boundary, actor: principal, commandId, eventType: 'ProcessTaskInstanceResumed' });
      const result = { planInstanceId, projectId, status: next.status, version: Number(next.version), pauseBoundary: next.pause_boundary,
        freshApprovalRequired: true };
      await client.query(`insert into orgward.command_results (tenant_id,operation,command_id,payload_hash,aggregate_kind,aggregate_id,result,result_hash)
        values ($1,$2,$3,$4,'process_task_instance_control',$5,$6::jsonb,$7)`,
      [tenantId, operation, commandId, requestHash, planInstanceId, canonicalJson(result), contentHash(result)]);
      return { control: next, replayed: false };
    });
    if (outcome && !outcome.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return outcome;
  }

  async abandonUnverifiedProcessTaskInstance({ tenantId, projectId, planInstanceId, principal, authzGeneration,
    version, commandId, requestHash, reason, evidence, acknowledgeDuplicateCostWork }) {
    const operation = 'execution.process-instance.abandon-unverified';
    const safeReason = typeof reason === 'string' ? reason.trim() : '';
    const safeEvidence = Array.isArray(evidence) ? evidence.map((entry) => typeof entry === 'string' ? entry.trim() : '') : [];
    if (!tenantId || !projectId || !planInstanceId || !principal || !commandId || !requestHash
      || !safeReason || safeReason.length > 1000 || !safeEvidence.length || safeEvidence.length > 20
      || safeEvidence.some((entry) => !entry || entry.length > 1000) || acknowledgeDuplicateCostWork !== true) {
      throw conflict('Unverified abandonment requires a reason, evidence, and explicit duplicate-cost acknowledgement.', null, 'INVALID_UNVERIFIED_ABANDONMENT');
    }
    const outcome = await this.persistence.transaction(async (client) => {
      await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'owner' });
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human' });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      const prior = await client.query(`select * from orgward.command_results where tenant_id=$1 and operation=$2 and command_id=$3`, [tenantId, operation, commandId]);
      if (prior.rowCount) {
        if (prior.rows[0].payload_hash !== requestHash) throw conflict('This command ID was already used with different abandonment input.', null, 'IDEMPOTENCY_CONFLICT');
        const recorded = verifyCommandRow(prior.rows[0]);
        if (recorded.planInstanceId !== planInstanceId || recorded.projectId !== projectId) throw persistenceIntegrity('An abandonment replay has mismatched instance references.');
        const control = await lockProcessTaskControl(client, tenantId, planInstanceId);
        if (!control || control.project_id !== projectId || control.status !== 'ABANDONED_UNVERIFIED'
          || !control.events.some((event) => event.causationId === commandId && event.type === 'ProcessTaskInstanceAbandonedUnverified'
            && event.actor === principal)) throw persistenceIntegrity('An abandonment replay no longer matches its append-only event.');
        return { control, replayed: true };
      }
      const control = await lockProcessTaskControl(client, tenantId, planInstanceId);
      if (!control || control.project_id !== projectId) return null;
      if (Number(control.version) !== version) throw conflict('The process instance control changed; reload before retrying.', Number(control.version), 'PROCESS_INSTANCE_CONTROL_CONFLICT');
      if (!['PAUSE_REQUESTED', 'PAUSED'].includes(control.status)) {
        throw conflict('Only a paused or pausing process instance with an unresolved provider result may be abandoned as unverified.', Number(control.version), 'PROCESS_INSTANCE_ABANDONMENT_NOT_ALLOWED');
      }
      const runtimes = await client.query(`select * from orgward.process_task_instances
        where tenant_id=$1 and project_id=$2 and plan_instance_id=$3 order by task_id for update`, [tenantId, projectId, planInstanceId]);
      if (!runtimes.rowCount) throw conflict('The process instance was not found.', null, 'PROCESS_TASK_INSTANCE_NOT_FOUND');
      if (runtimes.rows.some((runtime) => ['IN_PROGRESS', 'ESCALATED', 'RUNNING'].includes(runtime.status))) {
        throw conflict('Active human or agent task work must settle before this instance can be abandoned as unverified.', Number(control.version), 'PROCESS_INSTANCE_WORK_UNRESOLVED');
      }
      const live = await client.query(`select l.run_id from orgward.execution_worker_leases l
        join orgward.aggregates a on a.tenant_id=l.tenant_id and a.aggregate_kind='execution_run' and a.aggregate_id=l.run_id
        where l.tenant_id=$1 and a.state #>> '{processTaskRef,planInstanceId}'=$2 and l.lease_until>now() limit 1`, [tenantId, planInstanceId]);
      if (live.rowCount) throw conflict('An active worker lease must settle before this instance can be abandoned as unverified.', Number(control.version), 'PROCESS_INSTANCE_WORK_UNRESOLVED');
      const attempts = await client.query(`select d.run_id,d.attempt_id,d.status,a.state #>> '{profile,kind}' as profile_kind,
          (a.state #>> '{workItem,proposalContext,target,type}'='information'
            and case when jsonb_typeof(a.state #> '{workItem,proposalContext,sourceEnvelope,sources}')='array'
              then jsonb_array_length(a.state #> '{workItem,proposalContext,sourceEnvelope,sources}') between 1 and 8 else false end
            and not (a.state ?| array['toolPlan','toolPlans','externalActions','capabilities','effects','effectPlan']
              or (a.state->'workItem') ?| array['toolPlan','toolPlans','externalActions','capabilities','effects','effectPlan','tools'])) as read_only_model_proposal
        from orgward.provider_dispatch_attempts d
        join orgward.aggregates a on a.tenant_id=d.tenant_id and a.aggregate_kind='execution_run' and a.aggregate_id=d.run_id
        where d.tenant_id=$1 and a.state #>> '{processTaskRef,planInstanceId}'=$2
          and d.status in ('reserved','handed_off','outcome_unknown')
        order by d.run_id,d.attempt_id for update of d`, [tenantId, planInstanceId]);
      if (!attempts.rowCount || attempts.rows.some((attempt) => attempt.status !== 'outcome_unknown'
        || attempt.profile_kind !== 'provider-openai' || !attempt.read_only_model_proposal)) {
        throw conflict('This disposition is available only when every unresolved attempt is an outcome-unknown read-only OpenAI model proposal.', Number(control.version), 'PROCESS_INSTANCE_ABANDONMENT_NOT_ALLOWED');
      }
      const runIds = [...new Set(attempts.rows.map((attempt) => attempt.run_id))].sort();
      const attemptIds = attempts.rows.map((attempt) => attempt.attempt_id).sort();
      const next = await appendProcessTaskControl(client, control, {
        status: 'ABANDONED_UNVERIFIED', reason: safeReason, boundary: control.pause_boundary,
        actor: principal, commandId, eventType: 'ProcessTaskInstanceAbandonedUnverified',
        eventData: { runIds, attemptIds, evidence: safeEvidence, acknowledgeDuplicateCostWork: true,
          authzGeneration: Number(authzGeneration) },
      });
      const result = { projectId, planInstanceId, status: next.status, version: Number(next.version),
        runIds, attemptIds, reason: safeReason, evidence: safeEvidence, acknowledgeDuplicateCostWork: true };
      await client.query(`insert into orgward.command_results (tenant_id,operation,command_id,payload_hash,aggregate_kind,aggregate_id,result,result_hash)
        values ($1,$2,$3,$4,'process_task_instance_control',$5,$6::jsonb,$7)`,
      [tenantId, operation, commandId, requestHash, planInstanceId, canonicalJson(result), contentHash(result)]);
      return { control: next, replayed: false };
    });
    if (outcome && !outcome.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return outcome;
  }

  async pauseUndispatchedProcessTaskRun({ tenantId, projectId, runId, principal, authzGeneration, workerId, expectedVersion }) {
    return this.persistence.transaction(async (client) => {
      await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration });
      const hint = await client.query(`select state->'processTaskRef' as ref from orgward.aggregates
        where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2`, [tenantId, runId]);
      const instanceId = hint.rows[0]?.ref?.planInstanceId;
      if (!instanceId) return null;
      const control = await lockProcessTaskControl(client, tenantId, instanceId);
      if (!control || control.project_id !== projectId || control.status !== 'PAUSE_REQUESTED') return null;
      const selected = await client.query(`select * from orgward.aggregates
        where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2 for update`, [tenantId, runId]);
      if (!selected.rowCount) return null;
      const run = verifyAggregateRow(selected.rows[0]);
      if (run.status !== 'RUNNING' || run.version !== expectedVersion || run.projectId !== projectId) return null;
      const attempt = await client.query(`select status from orgward.provider_dispatch_attempts
        where tenant_id=$1 and run_id=$2 for update`, [tenantId, runId]);
      if (attempt.rows.some((row) => row.status !== 'cancelled')) return null;
      const lease = await client.query(`select worker_id from orgward.execution_worker_leases
        where tenant_id=$1 and run_id=$2 and lease_until>now() for update`, [tenantId, runId]);
      if (lease.rows.some((row) => row.worker_id !== workerId)) return null;
      const pauseEvent = (control.events ?? []).findLast?.((event) => event.type === 'ProcessTaskInstancePauseRequested');
      if (!pauseEvent?.causationId) throw persistenceIntegrity('A paused run has no instance pause command to bind its boundary event.');
      pauseUndispatchedProcessTaskExecutionRun(run, { actor: principal, commandId: pauseEvent.causationId });
      await this.saveInTransaction(client, run, { expectedVersion, workerFinalization: true,
        instanceControlMutation: true, runtimeCommandId: pauseEvent.causationId });
      return run;
    });
  }

  async startHumanProcessTask({
    tenantId, projectId, planId, revision, planInstanceId, taskId,
    principal, authzGeneration, commandId, requestHash,
  }) {
    if (!tenantId || !projectId || !planId || !taskId || !principal) throw projectAccessDenied();
    const operation = 'execution.process-task.human-start';
    const outcome = await this.persistence.transaction(async (client) => {
      const callerMembership = await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
      await requirePrincipalAuthority(client, {
        tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human',
      });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      const prior = await client.query(`
        select * from orgward.command_results
        where tenant_id = $1 and operation = $2 and command_id = $3
      `, [tenantId, operation, commandId]);
      if (prior.rowCount) {
        if (prior.rows[0].payload_hash !== requestHash) throw conflict('This human task command ID was already used with different input.', null, 'IDEMPOTENCY_CONFLICT');
        const recorded = verifyCommandRow(prior.rows[0]);
        if (recorded.projectId !== projectId || recorded.planId !== planId || recorded.revision !== revision
          || (planInstanceId && recorded.planInstanceId !== planInstanceId) || recorded.taskId !== taskId) {
          throw persistenceIntegrity('A human task start command result has mismatched task references.');
        }
        const replay = await selectProcessTaskRuntimeForPrincipal(client, {
          tenantId, projectId, planInstanceId: recorded.planInstanceId, taskId, principal, authzGeneration,
        });
        if (!replay.rowCount) throw persistenceIntegrity('A human task start command has no assigned runtime record.');
        return { runtime: processTaskRuntimeView(replay.rows[0], principal), replayed: true };
      }

      const selectedProject = await client.query(`
        select * from orgward.aggregates
        where tenant_id = $1 and aggregate_kind = 'project' and aggregate_id = $2
        for update
      `, [tenantId, projectId]);
      if (!selectedProject.rowCount) return null;
      const project = verifyAggregateRow(selectedProject.rows[0]);
      const plan = (project.processPlans ?? []).find((candidate) => candidate.id === planId && candidate.revision === revision);
      if (!plan || plan.source?.projectId !== projectId) throw conflict('The saved process graph revision was not found for this project.', null, 'PROCESS_PLAN_REVISION_NOT_FOUND');
      const task = plan.tasks.find((candidate) => candidate.id === taskId);
      if (!task) throw conflict('The task was not found in this saved graph revision.', null, 'PROCESS_PLAN_TASK_NOT_FOUND');
      if (!Array.isArray(task.dependencies)) throw persistenceIntegrity('A saved process task has invalid dependencies.');
      let instanceId = planInstanceId;
      if (!instanceId) {
        if (task.dependencies.length) throw conflict('A dependent human task must join an existing process instance.', null, 'PROCESS_TASK_DEPENDENCY_UNSATISFIED');
        const latestRevision = (project.processPlans ?? []).filter((candidate) => candidate.id === planId)
          .sort((left, right) => (left.revision ?? 1) - (right.revision ?? 1)).at(-1);
        if (latestRevision?.revision !== revision) throw conflict('A new process instance must start from the latest saved graph revision.', null, 'PROCESS_PLAN_REVISION_STALE');
        if (project.blueprintVersions?.at(-1)?.version !== plan.source.blueprintVersion) {
          throw conflict('A new process instance must use the current saved blueprint version.', null, 'PROCESS_PLAN_BLUEPRINT_STALE');
        }
        instanceId = randomUUID();
      }
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${tenantId}:process-plan-instance:${instanceId}`,
      ]);
      let control = await lockProcessTaskControl(client, tenantId, instanceId);
      const instanceRows = await client.query(`
        select * from orgward.process_task_instances
        where tenant_id = $1 and plan_instance_id = $2
        order by task_id for update
      `, [tenantId, instanceId]);
      if (planInstanceId && !instanceRows.rowCount) throw conflict('Start a root task before this task joins a process instance.', null, 'PROCESS_TASK_INSTANCE_NOT_FOUND');
      if (!planInstanceId && instanceRows.rowCount) throw persistenceIntegrity('The generated human task instance ID already exists.');
      if (instanceRows.rowCount) {
        if (!control) throw persistenceIntegrity('An existing process instance has no durable control record.');
        requireActiveProcessTaskControl(control);
      } else {
        await client.query(`insert into orgward.process_task_instance_controls
          (tenant_id,project_id,process_plan_id,plan_revision,plan_instance_id,status,initiated_by,version,events)
          values ($1,$2,$3,$4,$5,'ACTIVE',$6,0,'[]'::jsonb)`,
        [tenantId, projectId, planId, revision, instanceId, principal]);
      }
      if (instanceRows.rows.some((row) => row.project_id !== projectId || row.process_plan_id !== planId
        || Number(row.plan_revision) !== revision || row.blueprint_id !== plan.source.blueprintId
        || Number(row.blueprint_version) !== plan.source.blueprintVersion)) {
        throw conflict('This instance is pinned to a different immutable graph revision.', null, 'PROCESS_TASK_INSTANCE_PIN_CONFLICT');
      }
      const byTask = new Map(instanceRows.rows.map((row) => [row.task_id, row]));
      for (const dependencyId of task.dependencies) {
        if (byTask.get(dependencyId)?.status !== 'SUCCEEDED') {
          throw conflict('Every dependency must be succeeded in this process instance before the human task can start.', null, 'PROCESS_TASK_DEPENDENCY_UNSATISFIED');
        }
      }
      const blueprint = project.blueprintVersions?.find((candidate) => candidate.id === plan.source.blueprintId
        && candidate.version === plan.source.blueprintVersion);
      const objects = Object.values(blueprint?.areas ?? {}).flatMap((area) => area.items ?? []);
      const actor = objects.find((item) => item.id === task.assignee?.actorId);
      const role = objects.find((item) => item.id === task.assignee?.roleId);
      const linkedRole = actor && role?.type === 'role'
        && ((actor.assignedRoles ?? []).includes(role.id)
          || (blueprint.relations ?? []).some((relation) => relation.source === actor.id
            && relation.target === role.id && relation.type === 'assigned-to'));
      if (!blueprint || actor?.type !== 'actor-human' || !role || !linkedRole) {
        throw conflict('The saved task must reference a human actor and its assigned blueprint role.', null, 'PROCESS_TASK_HUMAN_ASSIGNMENT_REQUIRED');
      }
      let runtime = byTask.get(taskId);
      if (runtime && (runtime.actor_type !== 'human' || runtime.actor_id !== actor.id || runtime.role_id !== role.id)) {
        throw conflict('The task runtime is not pinned to this human assignment.', null, 'PROCESS_TASK_ASSIGNMENT_CONFLICT');
      }
      if (!runtime) {
        const binding = await client.query(`
          select b.status, b.target_principal, b.target_membership_generation, b.target_authz_generation,
            identity.actor_type, identity.status as identity_status,
            identity.authz_generation as current_authz_generation,
            membership.access, membership.generation as current_membership_generation, membership.revoked_at
          from orgward.project_actor_binding_proposals b
          join orgward.oidc_principals identity
            on identity.tenant_id = b.tenant_id and identity.principal = b.target_principal
          join orgward.project_memberships membership
            on membership.tenant_id = b.tenant_id and membership.project_id = b.project_id
              and membership.principal = b.target_principal
          where b.tenant_id = $1 and b.project_id = $2 and b.blueprint_version = $3
            and b.actor_id = $4 and b.role_id = $5
          for update of b, identity, membership
        `, [tenantId, projectId, plan.source.blueprintVersion, actor.id, role.id]);
        if (!binding.rowCount || binding.rows[0].status !== 'enabled') {
          throw conflict('This human task requires an enabled binding for its pinned blueprint version.', null, 'PROCESS_TASK_ACTOR_BINDING_UNAVAILABLE');
        }
        const target = binding.rows[0];
        if (target.target_principal !== principal || target.actor_type !== 'human' || target.identity_status !== 'active'
          || target.revoked_at !== null || !['owner', 'editor'].includes(target.access)) throw projectAccessDenied();
        if (Number(target.target_authz_generation) !== Number(target.current_authz_generation)
          || Number(target.current_authz_generation) !== authzGeneration
          || Number(target.target_membership_generation) !== Number(target.current_membership_generation)
          || Number(target.current_membership_generation) !== callerMembership.generation) {
          throw conflict('The assigned human or project membership changed after binding approval.', null, 'PROCESS_TASK_ACTOR_BINDING_STALE');
        }
        await client.query(`
          insert into orgward.process_task_instances (
            tenant_id, project_id, process_plan_id, plan_revision, plan_instance_id, task_id,
            blueprint_id, blueprint_version, process_id, actor_id, role_id, actor_type,
            assigned_principal, assigned_membership_generation, assigned_authz_generation,
            status, version, created_at, updated_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'human',$12,$13,$14,'PLANNED',0,now(),now())
        `, [tenantId, projectId, plan.id, revision, instanceId, task.id, plan.source.blueprintId,
          plan.source.blueprintVersion, plan.source.processId, actor.id, role.id, principal,
          Number(target.current_membership_generation), Number(target.current_authz_generation)]);
        const inserted = await client.query(`
          select * from orgward.process_task_instances where tenant_id=$1 and plan_instance_id=$2 and task_id=$3 for update
        `, [tenantId, instanceId, taskId]);
        runtime = inserted.rows[0];
      } else if (runtime.assigned_principal !== principal
        || Number(runtime.assigned_authz_generation) !== authzGeneration
        || Number(runtime.assigned_membership_generation) !== callerMembership.generation) {
        throw conflict('The human assignment or membership changed after this task runtime was created.', null, 'PROCESS_TASK_ACTOR_BINDING_STALE');
      }
      if (runtime.status !== 'PLANNED') throw conflict('The human task must be planned before its assigned person can start it.', Number(runtime.version), 'PROCESS_TASK_STATE_CONFLICT');
      const event = processTaskRuntimeEvent('HumanTaskStarted', principal, { taskId, processPlanId: planId, revision, planInstanceId: instanceId });
      const updated = await client.query(`
        update orgward.process_task_instances
        set status='IN_PROGRESS', version=version+1, started_at=now(), updated_at=now(), events=events || $5::jsonb
        where tenant_id=$1 and plan_instance_id=$2 and task_id=$3 and version=$4
        returning *
      `, [tenantId, instanceId, taskId, Number(runtime.version), canonicalJson([event])]);
      if (!updated.rowCount) throw conflict('The human task changed before it could be started.', Number(runtime.version));
      await recordEvent(client, {
        tenantId, kind: 'process_task_instance', id: `${instanceId}:${taskId}`,
        version: Number(updated.rows[0].version), commandId, event,
      });
      const result = { projectId, planId, revision, planInstanceId: instanceId, taskId, version: Number(updated.rows[0].version) };
      await client.query(`
        insert into orgward.command_results
          (tenant_id, operation, command_id, payload_hash, aggregate_kind, aggregate_id, result, result_hash)
        values ($1,$2,$3,$4,'process_task_instance',$5,$6::jsonb,$7)
      `, [tenantId, operation, commandId, requestHash, `${instanceId}:${taskId}`, canonicalJson(result), contentHash(result)]);
      const visible = await selectProcessTaskRuntimeForPrincipal(client, {
        tenantId, projectId, planInstanceId: instanceId, taskId, principal, authzGeneration,
      });
      return { runtime: processTaskRuntimeView(visible.rows[0], principal), replayed: false };
    });
    if (outcome && !outcome.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return outcome;
  }

  async completeHumanProcessTask({
    tenantId, projectId, planId, revision, planInstanceId, taskId,
    principal, authzGeneration, commandId, requestHash, result, evidence,
  }) {
    if (!tenantId || !projectId || !planId || !planInstanceId || !taskId || !principal) throw projectAccessDenied();
    if (!['succeeded', 'failed'].includes(result)) {
      throw conflict('Choose a succeeded or failed outcome and provide up to 20 short evidence notes.', null, 'INVALID_HUMAN_TASK_OUTCOME');
    }
    const safeEvidence = validateHumanTaskNotes(evidence, { required: result === 'succeeded' });
    const operation = 'execution.process-task.human-complete';
    const outcome = await this.persistence.transaction(async (client) => {
      const callerMembership = await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
      await requirePrincipalAuthority(client, {
        tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human',
      });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      const prior = await client.query(`
        select * from orgward.command_results where tenant_id=$1 and operation=$2 and command_id=$3
      `, [tenantId, operation, commandId]);
      if (prior.rowCount) {
        if (prior.rows[0].payload_hash !== requestHash) throw conflict('This human task command ID was already used with different input.', null, 'IDEMPOTENCY_CONFLICT');
        const recorded = verifyCommandRow(prior.rows[0]);
        if (recorded.projectId !== projectId || recorded.planId !== planId || recorded.revision !== revision
          || recorded.planInstanceId !== planInstanceId || recorded.taskId !== taskId) {
          throw persistenceIntegrity('A human task completion command result has mismatched task references.');
        }
        const replay = await selectProcessTaskRuntimeForPrincipal(client, {
          tenantId, projectId, planInstanceId, taskId, principal, authzGeneration,
        });
        if (!replay.rowCount) throw persistenceIntegrity('A human task completion command has no assigned runtime record.');
        return { runtime: processTaskRuntimeView(replay.rows[0], principal), replayed: true };
      }
      const control = await lockProcessTaskControl(client, tenantId, planInstanceId);
      if (!control || control.project_id !== projectId) throw persistenceIntegrity('A human task has no matching process instance control.');
      requireProcessTaskControlNotAbandoned(control);
      if (control.status === 'PAUSED') throw conflict('The process instance is paused; an active human task cannot settle after its boundary.', null, 'PROCESS_INSTANCE_PAUSED');
      const selected = await client.query(`
        select * from orgward.process_task_instances
        where tenant_id=$1 and project_id=$2 and process_plan_id=$3 and plan_revision=$4
          and plan_instance_id=$5 and task_id=$6
        for update
      `, [tenantId, projectId, planId, revision, planInstanceId, taskId]);
      if (!selected.rowCount) throw conflict('The human task runtime was not found in this project instance.', null, 'PROCESS_TASK_INSTANCE_NOT_FOUND');
      const runtime = selected.rows[0];
      if (runtime.actor_type !== 'human' || runtime.assigned_principal !== principal) throw projectAccessDenied();
      if (Number(runtime.assigned_authz_generation) !== authzGeneration
        || Number(runtime.assigned_membership_generation) !== callerMembership.generation) {
        throw conflict('The human assignment or membership changed after this task runtime was created.', null, 'PROCESS_TASK_ACTOR_BINDING_STALE');
      }
      if (runtime.status === 'ESCALATED') {
        throw conflict('An escalated human task requires project owner resolution before it can be completed.', Number(runtime.version), 'PROCESS_TASK_ESCALATION_ACTIVE');
      }
      if (runtime.status !== 'IN_PROGRESS') throw conflict('Only an in-progress human task can be completed.', Number(runtime.version), 'PROCESS_TASK_STATE_CONFLICT');
      const taskOutcome = { result };
      const event = processTaskRuntimeEvent('HumanTaskCompleted', principal, {
        taskId, processPlanId: planId, revision, planInstanceId, result, evidence: safeEvidence,
      });
      const status = result === 'succeeded' ? 'SUCCEEDED' : 'FAILED';
      const updated = await client.query(`
        update orgward.process_task_instances
        set status=$5, outcome=$6::jsonb, evidence=$7::jsonb, version=version+1,
          completed_at=now(), updated_at=now(), events=events || $8::jsonb
        where tenant_id=$1 and plan_instance_id=$2 and task_id=$3 and version=$4
        returning *
      `, [tenantId, planInstanceId, taskId, Number(runtime.version), status,
        canonicalJson(taskOutcome), canonicalJson(safeEvidence), canonicalJson([event])]);
      if (!updated.rowCount) throw conflict('The human task changed before it could be completed.', Number(runtime.version));
      await recordEvent(client, {
        tenantId, kind: 'process_task_instance', id: `${planInstanceId}:${taskId}`,
        version: Number(updated.rows[0].version), commandId, event,
      });
      await settleProcessTaskPauseIfDrained(client, tenantId, planInstanceId);
      const commandResult = { projectId, planId, revision, planInstanceId, taskId, version: Number(updated.rows[0].version), status };
      await client.query(`
        insert into orgward.command_results
          (tenant_id, operation, command_id, payload_hash, aggregate_kind, aggregate_id, result, result_hash)
        values ($1,$2,$3,$4,'process_task_instance',$5,$6::jsonb,$7)
      `, [tenantId, operation, commandId, requestHash, `${planInstanceId}:${taskId}`, canonicalJson(commandResult), contentHash(commandResult)]);
      const visible = await selectProcessTaskRuntimeForPrincipal(client, {
        tenantId, projectId, planInstanceId, taskId, principal, authzGeneration,
      });
      return { runtime: processTaskRuntimeView(visible.rows[0], principal), replayed: false };
    });
    if (outcome && !outcome.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return outcome;
  }

  async escalateHumanProcessTask({
    tenantId, projectId, planId, revision, planInstanceId, taskId,
    principal, authzGeneration, commandId, requestHash, reason, evidence = [],
  }) {
    if (!tenantId || !projectId || !planId || !planInstanceId || !taskId || !principal) throw projectAccessDenied();
    const safeReason = validateHumanTaskReason(reason);
    const safeEvidence = validateHumanTaskNotes(evidence ?? []);
    const operation = 'execution.process-task.human-escalate';
    const outcome = await this.persistence.transaction(async (client) => {
      const callerMembership = await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
      await requirePrincipalAuthority(client, {
        tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human',
      });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      const prior = await client.query(`
        select * from orgward.command_results where tenant_id=$1 and operation=$2 and command_id=$3
      `, [tenantId, operation, commandId]);
      if (prior.rowCount) {
        if (prior.rows[0].payload_hash !== requestHash) throw conflict('This human task command ID was already used with different input.', null, 'IDEMPOTENCY_CONFLICT');
        const recorded = verifyCommandRow(prior.rows[0]);
        if (recorded.projectId !== projectId || recorded.planId !== planId || recorded.revision !== revision
          || recorded.planInstanceId !== planInstanceId || recorded.taskId !== taskId) {
          throw persistenceIntegrity('A human task escalation command result has mismatched task references.');
        }
        const replay = await selectProcessTaskRuntimeForPrincipal(client, {
          tenantId, projectId, planInstanceId, taskId, principal, authzGeneration,
        });
        if (!replay.rowCount) throw persistenceIntegrity('A human task escalation command has no runtime record.');
        return { runtime: processTaskRuntimeView(replay.rows[0], principal), replayed: true };
      }

      const control = await lockProcessTaskControl(client, tenantId, planInstanceId);
      if (!control || control.project_id !== projectId) throw persistenceIntegrity('A human task has no matching process instance control.');
      requireProcessTaskControlNotAbandoned(control);
      if (control.status === 'PAUSED') throw conflict('The process instance is paused; a late human escalation cannot change its boundary.', null, 'PROCESS_INSTANCE_PAUSED');

      const selected = await client.query(`
        select * from orgward.process_task_instances
        where tenant_id=$1 and project_id=$2 and process_plan_id=$3 and plan_revision=$4
          and plan_instance_id=$5 and task_id=$6
        for update
      `, [tenantId, projectId, planId, revision, planInstanceId, taskId]);
      if (!selected.rowCount) throw conflict('The human task runtime was not found in this project instance.', null, 'PROCESS_TASK_INSTANCE_NOT_FOUND');
      const runtime = selected.rows[0];
      if (runtime.actor_type !== 'human' || runtime.assigned_principal !== principal) throw projectAccessDenied();
      if (Number(runtime.assigned_authz_generation) !== authzGeneration
        || Number(runtime.assigned_membership_generation) !== callerMembership.generation) {
        throw conflict('The human assignment or membership changed after this task runtime was created.', null, 'PROCESS_TASK_ACTOR_BINDING_STALE');
      }
      if (runtime.status !== 'IN_PROGRESS') throw conflict('Only an in-progress human task can be escalated.', Number(runtime.version), 'PROCESS_TASK_STATE_CONFLICT');

      const event = processTaskRuntimeEvent('HumanTaskEscalated', principal, {
        taskId, processPlanId: planId, revision, planInstanceId, reason: safeReason, evidence: safeEvidence,
      });
      const updated = await client.query(`
        update orgward.process_task_instances
        set status='ESCALATED', version=version+1, updated_at=now(), events=events || $5::jsonb
        where tenant_id=$1 and plan_instance_id=$2 and task_id=$3 and version=$4
        returning *
      `, [tenantId, planInstanceId, taskId, Number(runtime.version), canonicalJson([event])]);
      if (!updated.rowCount) throw conflict('The human task changed before it could be escalated.', Number(runtime.version));
      await recordEvent(client, {
        tenantId, kind: 'process_task_instance', id: `${planInstanceId}:${taskId}`,
        version: Number(updated.rows[0].version), commandId, event,
      });
      const result = { projectId, planId, revision, planInstanceId, taskId, version: Number(updated.rows[0].version), status: 'ESCALATED' };
      await client.query(`
        insert into orgward.command_results
          (tenant_id, operation, command_id, payload_hash, aggregate_kind, aggregate_id, result, result_hash)
        values ($1,$2,$3,$4,'process_task_instance',$5,$6::jsonb,$7)
      `, [tenantId, operation, commandId, requestHash, `${planInstanceId}:${taskId}`, canonicalJson(result), contentHash(result)]);
      const visible = await selectProcessTaskRuntimeForPrincipal(client, {
        tenantId, projectId, planInstanceId, taskId, principal, authzGeneration,
      });
      return { runtime: processTaskRuntimeView(visible.rows[0], principal), replayed: false };
    });
    if (outcome && !outcome.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return outcome;
  }

  async resolveHumanProcessTaskEscalation({
    tenantId, projectId, planId, revision, planInstanceId, taskId,
    principal, authzGeneration, commandId, requestHash, disposition, reason, evidence = [],
  }) {
    if (!tenantId || !projectId || !planId || !planInstanceId || !taskId || !principal) throw projectAccessDenied();
    if (!['resume', 'succeeded', 'failed'].includes(disposition)) {
      throw conflict('Choose resume, succeeded, or failed as the owner resolution.', null, 'INVALID_HUMAN_TASK_ESCALATION');
    }
    const safeReason = validateHumanTaskReason(reason);
    const safeEvidence = validateHumanTaskNotes(evidence ?? [], { required: disposition === 'succeeded' });
    const operation = 'execution.process-task.human-escalation-resolve';
    const outcome = await this.persistence.transaction(async (client) => {
      await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'owner' });
      await requirePrincipalAuthority(client, {
        tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human',
      });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      const prior = await client.query(`
        select * from orgward.command_results where tenant_id=$1 and operation=$2 and command_id=$3
      `, [tenantId, operation, commandId]);
      if (prior.rowCount) {
        if (prior.rows[0].payload_hash !== requestHash) throw conflict('This owner resolution command ID was already used with different input.', null, 'IDEMPOTENCY_CONFLICT');
        const recorded = verifyCommandRow(prior.rows[0]);
        if (recorded.projectId !== projectId || recorded.planId !== planId || recorded.revision !== revision
          || recorded.planInstanceId !== planInstanceId || recorded.taskId !== taskId) {
          throw persistenceIntegrity('A human task resolution command result has mismatched task references.');
        }
        const replay = await selectProcessTaskRuntimeForPrincipal(client, {
          tenantId, projectId, planInstanceId, taskId, principal, authzGeneration,
        });
        if (!replay.rowCount) throw persistenceIntegrity('A human task resolution command has no runtime record.');
        return { runtime: processTaskRuntimeView(replay.rows[0], principal), replayed: true };
      }

      const control = await lockProcessTaskControl(client, tenantId, planInstanceId);
      if (!control || control.project_id !== projectId) throw persistenceIntegrity('A human task has no matching process instance control.');
      requireProcessTaskControlNotAbandoned(control);
      if (control.status === 'PAUSED') throw conflict('The process instance is paused; a late human resolution cannot change its boundary.', null, 'PROCESS_INSTANCE_PAUSED');
      if (disposition === 'resume') requireActiveProcessTaskControl(control);
      if (control.status === 'PAUSED' && disposition === 'resume') throw conflict('The process instance is paused; human work cannot resume until the instance resumes.', null, 'PROCESS_INSTANCE_PAUSED');

      const selected = await client.query(`
        select * from orgward.process_task_instances
        where tenant_id=$1 and project_id=$2 and process_plan_id=$3 and plan_revision=$4
          and plan_instance_id=$5 and task_id=$6
        for update
      `, [tenantId, projectId, planId, revision, planInstanceId, taskId]);
      if (!selected.rowCount) throw conflict('The human task runtime was not found in this project instance.', null, 'PROCESS_TASK_INSTANCE_NOT_FOUND');
      const runtime = selected.rows[0];
      if (runtime.actor_type !== 'human') throw conflict('Only a human task can be resolved through this path.', null, 'PROCESS_TASK_ASSIGNMENT_CONFLICT');
      if (runtime.status !== 'ESCALATED') throw conflict('Only an escalated human task can be resolved by its project owner.', Number(runtime.version), 'PROCESS_TASK_STATE_CONFLICT');

      if (disposition === 'resume') {
        const binding = await client.query(`
          select b.status, b.target_principal, b.target_membership_generation, b.target_authz_generation,
            identity.actor_type, identity.status as identity_status,
            identity.authz_generation as current_authz_generation,
            membership.access, membership.generation as current_membership_generation, membership.revoked_at
          from orgward.project_actor_binding_proposals b
          join orgward.oidc_principals identity
            on identity.tenant_id=b.tenant_id and identity.principal=b.target_principal
          join orgward.project_memberships membership
            on membership.tenant_id=b.tenant_id and membership.project_id=b.project_id
              and membership.principal=b.target_principal
          where b.tenant_id=$1 and b.project_id=$2 and b.blueprint_version=$3
            and b.actor_id=$4 and b.role_id=$5 and b.target_principal=$6
          for update of b, identity, membership
        `, [tenantId, projectId, runtime.blueprint_version, runtime.actor_id, runtime.role_id, runtime.assigned_principal]);
        if (!binding.rowCount) throw conflict('The original assignee no longer has a current enabled human binding; this task cannot resume.', null, 'PROCESS_TASK_ACTOR_BINDING_STALE');
        const target = binding.rows[0];
        if (target.status !== 'enabled' || target.actor_type !== 'human' || target.identity_status !== 'active'
          || target.revoked_at !== null || !['owner', 'editor'].includes(target.access)
          || Number(target.target_authz_generation) !== Number(target.current_authz_generation)
          || Number(target.target_membership_generation) !== Number(target.current_membership_generation)
          || Number(target.current_authz_generation) !== Number(runtime.assigned_authz_generation)
          || Number(target.current_membership_generation) !== Number(runtime.assigned_membership_generation)) {
          throw conflict('The original assignee identity, membership, generations, or pinned enabled binding changed; this task cannot resume.', null, 'PROCESS_TASK_ACTOR_BINDING_STALE');
        }
      }

      const status = disposition === 'resume' ? 'IN_PROGRESS' : disposition === 'succeeded' ? 'SUCCEEDED' : 'FAILED';
      const taskOutcome = disposition === 'resume' ? runtime.outcome : { result: disposition };
      const taskEvidence = disposition === 'resume' ? runtime.evidence : safeEvidence;
      const event = processTaskRuntimeEvent('HumanTaskEscalationResolved', principal, {
        taskId, processPlanId: planId, revision, planInstanceId,
        disposition, reason: safeReason, evidence: safeEvidence,
      });
      const updated = await client.query(`
        update orgward.process_task_instances
        set status=$5, outcome=$6::jsonb, evidence=$7::jsonb, version=version+1,
          completed_at=case when $5 in ('SUCCEEDED', 'FAILED') then now() else null end,
          updated_at=now(), events=events || $8::jsonb
        where tenant_id=$1 and plan_instance_id=$2 and task_id=$3 and version=$4
        returning *
      `, [tenantId, planInstanceId, taskId, Number(runtime.version), status,
        canonicalJson(taskOutcome), canonicalJson(taskEvidence), canonicalJson([event])]);
      if (!updated.rowCount) throw conflict('The escalated task changed before the owner resolution was saved.', Number(runtime.version));
      await recordEvent(client, {
        tenantId, kind: 'process_task_instance', id: `${planInstanceId}:${taskId}`,
        version: Number(updated.rows[0].version), commandId, event,
      });
      if (['SUCCEEDED', 'FAILED'].includes(status)) await settleProcessTaskPauseIfDrained(client, tenantId, planInstanceId);
      const result = { projectId, planId, revision, planInstanceId, taskId, version: Number(updated.rows[0].version), status, disposition };
      await client.query(`
        insert into orgward.command_results
          (tenant_id, operation, command_id, payload_hash, aggregate_kind, aggregate_id, result, result_hash)
        values ($1,$2,$3,$4,'process_task_instance',$5,$6::jsonb,$7)
      `, [tenantId, operation, commandId, requestHash, `${planInstanceId}:${taskId}`, canonicalJson(result), contentHash(result)]);
      const visible = await selectProcessTaskRuntimeForPrincipal(client, {
        tenantId, projectId, planInstanceId, taskId, principal, authzGeneration,
      });
      return { runtime: processTaskRuntimeView(visible.rows[0], principal), replayed: false };
    });
    if (outcome && !outcome.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return outcome;
  }

  async authorizeProjectForPrincipal({ tenantId, projectId, principal, authzGeneration } = {}) {
    if (!tenantId || !projectId || !principal) throw projectAccessDenied();
    return this.persistence.transaction(async (client) => {
      await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
      await requirePrincipalAuthority(client, {
        tenantId, principal, roles: ['workspace-write'], authzGeneration,
      });
      return true;
    });
  }

  async saveForPrincipal(run, {
    expectedVersion = null, principal, requiredPrincipalRoles = null, authzGeneration = null, validateCurrent = null,
  } = {}) {
    if (!principal) throw projectAccessDenied();
    return super.save(run, { expectedVersion, principal, requiredPrincipalRoles, authzGeneration, validateCurrent });
  }

  async recoverRunning(recover) {
    if (this.kind !== 'execution_run' || typeof recover !== 'function') throw new Error('Execution recovery requires a handler.');
    return this.persistence.transaction(async (client) => {
      const selected = await client.query(`
        select * from orgward.aggregates
        where aggregate_kind = 'execution_run' and state->>'status' = 'RUNNING'
        order by updated_at, aggregate_id
      `);
      let recovered = 0;
      for (const hintRow of selected.rows) {
        const hint = verifyAggregateRow(hintRow);
        let control = null;
        if (hint.processTaskRef) {
          control = await lockProcessTaskControl(client, hint.tenantId, hint.processTaskRef.planInstanceId);
          if (!control || ['PAUSED', 'ABANDONED_UNVERIFIED'].includes(control.status)) continue;
        }
        const locked = await client.query(`select * from orgward.aggregates
          where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2
            and version=$3 and state->>'status'='RUNNING'
          for update skip locked`, [hint.tenantId, hint.id, hint.version]);
        if (!locked.rowCount) continue;
        const row = locked.rows[0];
        const lease = await client.query(`
          select 1 from orgward.execution_worker_leases
          where tenant_id = $1 and run_id = $2 and lease_until > now()
          for share
        `, [row.tenant_id, row.aggregate_id]);
        if (lease.rowCount) continue;
        const run = verifyAggregateRow(row);
        const previousVersion = run.version;
        const previousEvents = Array.isArray(run.events) ? run.events.length : 0;
        await recover(run);
        await updateAggregate(client, run, 'execution_run', previousVersion);
        if (run.processTaskRef) {
          await syncProcessTaskRuntimeFromRun(client, run);
        }
        const newEvents = Array.isArray(run.events) ? run.events.slice(previousEvents) : [];
        for (const event of newEvents) {
          await recordEvent(client, {
            tenantId: run.tenantId, kind: 'execution_run', id: run.id,
            version: event.aggregateVersion ?? event.version ?? run.version,
            commandId: event.causationId ?? null, event,
          });
        }
        await client.query(`update orgward.provider_dispatch_attempts
          set status='outcome_unknown',handed_off_at=coalesce(handed_off_at,now()),finished_at=now(),updated_at=now()
          where tenant_id=$1 and run_id=$2 and status in ('reserved','handed_off')`, [row.tenant_id, row.aggregate_id]);
        await client.query(`
          delete from orgward.execution_worker_leases
          where tenant_id = $1 and run_id = $2 and lease_until <= now()
        `, [row.tenant_id, row.aggregate_id]);
        if (run.processTaskRef && control?.status === 'PAUSE_REQUESTED') {
          await settleProcessTaskPauseIfDrained(client, run.tenantId, run.processTaskRef.planInstanceId);
        }
        recovered += 1;
      }
      return recovered;
    });
  }
}

function normalizeLegacy(kind, value) {
  const state = structuredClone(value);
  if (kind === 'project') {
    state.tenantId ??= 'tenant-reference-bank';
    state.version ??= 1;
    state.schemaVersion ??= '1.0';
    state.events ??= [];
    delete state.commandRecords;
  }
  if (kind === 'change_case' || kind === 'execution_run') delete state.projectId;
  return state;
}

function validLegacy(kind, state, fileName, tenantId) {
  const common = state && typeof state === 'object' && !Array.isArray(state)
    && IDENTIFIERS[kind].test(state.id ?? '')
    && fileName === `${state.id}.json`
    && state.tenantId === tenantId
    && Number.isInteger(state.version) && state.version >= 0
    && typeof state.updatedAt === 'string' && !Number.isNaN(Date.parse(state.updatedAt));
  if (!common) return false;
  if (kind === 'project') {
    return typeof state.name === 'string' && typeof state.phase === 'string'
      && Array.isArray(state.conversation) && Array.isArray(state.blueprintVersions) && Array.isArray(state.events);
  }
  if (kind === 'change_case') {
    return typeof state.title === 'string' && typeof state.status === 'string' && typeof state.currentStage === 'string'
      && Array.isArray(state.events) && state.idempotency && typeof state.idempotency === 'object';
  }
  return typeof state.title === 'string' && typeof state.status === 'string'
    && state.profile && typeof state.profile === 'object' && state.workItem && typeof state.workItem === 'object'
    && Array.isArray(state.events);
}

export class LegacyImporter {
  constructor(persistence, directories = {}) {
    this.persistence = persistence;
    this.sources = [
      ['project', directories.projects ? path.resolve(directories.projects) : null],
      ['change_case', directories.changeCases ? path.resolve(directories.changeCases) : null],
      ['execution_run', directories.executionRuns ? path.resolve(directories.executionRuns) : null],
    ];
  }

  async scan(tenantId) {
    const items = [];
    for (const [kind, directory] of this.sources) {
      if (!directory) continue;
      let names;
      try { names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort(); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (items.length + names.length > 10_000) throw new Error('Legacy import is limited to 10,000 records per command.');
      for (const name of names) {
        const sourcePath = `${kind}/${name}`;
        const file = path.join(directory, name);
        const stat = await lstat(file);
        if (!stat.isFile()) {
          const target = stat.isSymbolicLink() ? await readlink(file) : stat.mode.toString(8);
          items.push({
            kind, sourcePath, sourceHash: contentHash(`unsafe:${name}:${target}`), state: null, stateHash: null,
            id: null, status: 'quarantined', errorCode: 'UNSAFE_SOURCE_FILE',
          });
          continue;
        }
        if (stat.size > 5_000_000) {
          items.push({
            kind, sourcePath, sourceHash: contentHash(`oversize:${name}:${stat.size}`), state: null, stateHash: null,
            id: null, status: 'quarantined', errorCode: 'SOURCE_FILE_TOO_LARGE',
          });
          continue;
        }
        const bytes = await readFile(file);
        const sourceHash = contentHash(bytes);
        try {
          const state = normalizeLegacy(kind, JSON.parse(bytes.toString('utf8')));
          if (!validLegacy(kind, state, name, tenantId)) throw new Error('INVALID_LEGACY_RECORD');
          items.push({ kind, sourcePath, sourceHash, state, stateHash: contentHash(state), id: state.id, status: 'importable' });
        } catch {
          items.push({ kind, sourcePath, sourceHash, state: null, stateHash: null, id: null, status: 'quarantined', errorCode: 'INVALID_LEGACY_RECORD' });
        }
      }
    }
    return items;
  }

  async run({ tenantId, commandId, payloadHash, mode, actor = null, authzGeneration = null, onResult = null }) {
    const scanned = await this.scan(tenantId);
    if (mode === 'dry-run') {
      return this.persistence.transaction(async (client) => {
        if (actor) await requirePrincipalAuthority(client, {
          tenantId, principal: actor, roles: ['tenant-admin'], actorType: 'human', authzGeneration,
        });
        for (const item of scanned) {
          if (item.status === 'quarantined') continue;
          const existing = await client.query(`
            select * from orgward.aggregates
            where tenant_id = $1 and aggregate_kind = $2 and aggregate_id = $3
          `, [tenantId, item.kind, item.id]);
          if (!existing.rowCount) continue;
          try {
            verifyAggregateRow(existing.rows[0]);
            item.status = item.stateHash === existing.rows[0].state_hash ? 'unchanged' : 'quarantined';
            item.errorCode = item.status === 'unchanged' ? null : 'TARGET_CONFLICT';
          } catch {
            item.status = 'quarantined';
            item.errorCode = 'TARGET_CORRUPT';
          }
        }
        const counts = {
          discovered: scanned.length,
          importable: scanned.filter((item) => item.status === 'importable').length,
          unchanged: scanned.filter((item) => item.status === 'unchanged').length,
          quarantined: scanned.filter((item) => item.status === 'quarantined').length,
        };
        const response = { result: { mode, counts, items: scanned.map(({ state: _state, ...item }) => item) }, replayed: false };
        await onResult?.(response);
        return response;
      });
    }
    const operation = 'persistence.legacy-import';
    const response = await this.persistence.transaction(async (client) => {
      if (actor) await requirePrincipalAuthority(client, {
        tenantId, principal: actor, roles: ['tenant-admin'], actorType: 'human', authzGeneration,
      });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      const prior = await client.query(`
        select * from orgward.command_results
        where tenant_id = $1 and operation = $2 and command_id = $3
      `, [tenantId, operation, commandId]);
      if (prior.rowCount) {
        if (prior.rows[0].payload_hash !== payloadHash) throw conflict('This command ID was already used with different input.', null, 'IDEMPOTENCY_CONFLICT');
        return { result: verifyCommandRow(prior.rows[0]), replayed: true };
      }

      const items = [];
      for (const item of scanned) {
        if (item.status === 'quarantined') {
          items.push(item);
          continue;
        }
        const existing = await client.query(`
          select * from orgward.aggregates
          where tenant_id = $1 and aggregate_kind = $2 and aggregate_id = $3
          for update
        `, [tenantId, item.kind, item.id]);
        if (existing.rowCount) {
          let unchanged = false;
          try {
            const state = verifyAggregateRow(existing.rows[0]);
            unchanged = state.tenantId === tenantId && item.stateHash === existing.rows[0].state_hash;
          } catch { /* Treat corrupt targets as a conflict; never overwrite them. */ }
          items.push({ ...item, status: unchanged ? 'unchanged' : 'quarantined', errorCode: unchanged ? null : 'TARGET_CONFLICT' });
          continue;
        }
        await insertAggregate(client, item.state, item.kind);
        items.push({ ...item, status: 'imported', errorCode: null });
      }
      const publicItems = items.map(({ state: _state, stateHash, errorCode, ...item }) => ({ ...item, stateHash, errorCode }));
      const result = {
        mode,
        counts: {
          discovered: items.length,
          imported: items.filter((item) => item.status === 'imported').length,
          unchanged: items.filter((item) => item.status === 'unchanged').length,
          quarantined: items.filter((item) => item.status === 'quarantined').length,
        },
        items: publicItems,
      };
      await client.query(`
        insert into orgward.legacy_imports (tenant_id, import_id, payload_hash, status, result)
        values ($1, $2, $3, 'completed', $4::jsonb)
      `, [tenantId, commandId, payloadHash, canonicalJson(result)]);
      for (const item of items) {
        await client.query(`
          insert into orgward.legacy_import_items
            (tenant_id, import_id, source_kind, source_path, source_hash, aggregate_id, state_hash, status, error_code)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [tenantId, commandId, item.kind, item.sourcePath, item.sourceHash, item.id, item.stateHash, item.status, item.errorCode]);
      }
      await client.query(`
        insert into orgward.command_results
          (tenant_id, operation, command_id, payload_hash, result, result_hash)
        values ($1, $2, $3, $4, $5::jsonb, $6)
      `, [tenantId, operation, commandId, payloadHash, canonicalJson(result), contentHash(result)]);
      const event = {
        eventId: `event-${randomUUID()}`, schemaVersion: '1.0', tenantId, aggregateId: commandId,
        aggregateVersion: 1, type: 'LegacyImportCompleted', actor: actor ?? 'platform-operator', occurredAt: new Date().toISOString(),
        correlationId: commandId, causationId: commandId, data: { ...result.counts }, evidenceRefs: [],
      };
      await recordEvent(client, { tenantId, kind: 'legacy_import', id: commandId, version: 1, commandId, event });
      return { result, replayed: false };
    });
    if (!response.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    await onResult?.(response);
    return response;
  }
}
