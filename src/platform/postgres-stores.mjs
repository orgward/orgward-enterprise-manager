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
import { executionApprovalRequestHash } from '../execution/contracts.mjs';

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

  async save(state, { expectedVersion = null, principal = null, requiredPrincipalRoles = null, authzGeneration = null } = {}) {
    return this.persistence.transaction((client) => this.saveInTransaction(client, state, {
      expectedVersion, principal, requiredPrincipalRoles, authzGeneration,
    }));
  }

  async saveInTransaction(client, state, {
    expectedVersion = null, principal = null, requiredPrincipalRoles = null,
    authzGeneration = null, workerFinalization = false, validateCurrent = null,
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
        if (validateCurrent) await validateCurrent(current);
        if (current.version !== expectedVersion) throw conflict(`Version conflict: expected persisted version ${expectedVersion}. Reload before retrying.`, current.version);
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
          && approval.requestHash !== contentHash(run.workItem))) {
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
    const result = await this.persistence.query(`
      delete from orgward.execution_worker_leases
      where tenant_id = $1 and run_id = $2 and worker_id = $3
    `, [tenantId, runId, workerId]);
    return result.rowCount === 1;
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
    requiredPrincipalRoles = ['workspace-write'], authzGeneration = null,
  } = {}) {
    if (!principal) throw projectAccessDenied();
    return this.updateWithCommand(id, tenantId, {
      ...command, principal, requiredPrincipalRoles, authzGeneration,
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
    requiredPrincipalRoles = null, authzGeneration = null, apply,
  }) {
    const result = await this.persistence.transaction(async (client) => {
      if (principal) {
        const member = await this.#membership(client, { tenantId, projectId: id, principal, lock: true });
        if (!member.rowCount) return null;
        if (!['owner', 'editor'].includes(member.rows[0].access)) throw projectAccessDenied();
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
    expectedVersion = null, principal, requiredPrincipalRoles = null, authzGeneration = null,
  } = {}) {
    if (!principal) throw projectAccessDenied();
    return super.save(run, { expectedVersion, principal, requiredPrincipalRoles, authzGeneration });
  }

  async recoverRunning(recover) {
    if (this.kind !== 'execution_run' || typeof recover !== 'function') throw new Error('Execution recovery requires a handler.');
    return this.persistence.transaction(async (client) => {
      const selected = await client.query(`
        select * from orgward.aggregates
        where aggregate_kind = 'execution_run' and state->>'status' = 'RUNNING'
        order by updated_at, aggregate_id
        for update skip locked
      `);
      let recovered = 0;
      for (const row of selected.rows) {
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
