import { randomUUID } from 'node:crypto';
import { canonicalJson, contentHash, persistenceIntegrity, recordEvent, verifyAggregateRow } from '../platform/postgres.mjs';
import { lockProjectAccess, requirePrincipalAuthority } from '../platform/postgres-stores.mjs';
import { digest } from '../sdlc/contracts.mjs';
import { releaseCandidateBinding, releaseEnvironmentSnapshot, releaseFailure } from './contracts.mjs';

const scope = (context) => [context.tenantId, context.projectId];
const conflict = (message) => releaseFailure('RELEASE_STATE_CONFLICT', message);
const emptyState = () => ({ generation: 0, current: null, previous: null, pendingActionId: null });

function verified(row) {
  if (!row || !row.state || contentHash(row.state) !== row.state_hash) throw persistenceIntegrity('A protected release record failed its stored hash check.');
  return structuredClone(row.state);
}

export class PostgresReleaseStore {
  constructor(persistence) { this.persistence = persistence; }

  async #authorize(client, context, environment = null, phase = 'read') {
    const membership = await lockProjectAccess(client, { ...context, minimum: phase === 'read' ? 'reader' : 'editor' });
    await requirePrincipalAuthority(client, { ...context,
      ...(phase === 'read' ? { anyRoleGroups: [['workspace-read', 'workspace-write', 'tenant-admin']] }
        : { roles: [phase === 'approve' ? 'release-approver' : 'workspace-write'] }),
      ...(phase === 'approve' ? { actorType: 'human' } : {}) });
    if (environment && phase !== 'read') {
      const key = phase === 'request' ? 'requesters' : phase === 'approve' ? 'approvers' : 'executors';
      if (environment.tenantId !== context.tenantId || environment.projectId !== context.projectId
        || !environment.authority[key].includes(context.principal)) throw releaseFailure('RELEASE_AUTHORITY_DENIED',
        'This principal is not configured for the protected environment action.', 403);
    }
    return membership;
  }

  async #environment(client, context, environmentId, write = false) {
    if (write) {
      const state = emptyState();
      await client.query(`insert into orgward.protected_release_environments
        (tenant_id,project_id,environment_id,state,state_hash) values ($1,$2,$3,$4::jsonb,$5)
        on conflict do nothing`, [...scope(context), environmentId, canonicalJson(state), contentHash(state)]);
    }
    const found = await client.query(`select state,state_hash from orgward.protected_release_environments
      where tenant_id=$1 and project_id=$2 and environment_id=$3 ${write ? 'for update' : ''}`,
    [...scope(context), environmentId]);
    return found.rowCount ? verified(found.rows[0]) : emptyState();
  }

  async #saveEnvironment(client, context, environmentId, state) {
    await client.query(`update orgward.protected_release_environments set state=$4::jsonb,state_hash=$5
      where tenant_id=$1 and project_id=$2 and environment_id=$3`,
    [...scope(context), environmentId, canonicalJson(state), contentHash(state)]);
  }

  async #action(client, context, actionId, write = false) {
    const found = await client.query(`select state,state_hash from orgward.protected_release_actions
      where tenant_id=$1 and project_id=$2 and action_id=$3 ${write ? 'for update' : ''}`, [...scope(context), actionId]);
    return found.rowCount ? verified(found.rows[0]) : null;
  }

  async #replay(client, context, operation, commandId, payloadHash) {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',
      [`protected-release:${context.tenantId}:${context.projectId}:${operation}:${commandId}`]);
    const prior = await client.query(`select payload_hash,action_id from orgward.protected_release_commands
      where tenant_id=$1 and project_id=$2 and operation=$3 and command_id=$4`,
    [...scope(context), operation, commandId]);
    if (!prior.rowCount) return null;
    if (prior.rows[0].payload_hash !== payloadHash) throw releaseFailure('IDEMPOTENCY_CONFLICT', 'This command ID is already bound to a different protected release request.');
    return this.#action(client, context, prior.rows[0].action_id);
  }

  async #command(client, context, operation, commandId, payloadHash, action) {
    await client.query(`insert into orgward.protected_release_commands
      (tenant_id,project_id,operation,command_id,payload_hash,action_id) values ($1,$2,$3,$4,$5,$6)`,
    [...scope(context), operation, commandId, payloadHash, action.id]);
  }

  #matching(action, environment, requestHash, expectedVersion) {
    if (!action) throw releaseFailure('RELEASE_ACTION_NOT_FOUND', 'The protected release action was not found.', 404);
    if (action.request.environment.configurationHash !== environment.configurationHash
      || action.requestHash !== requestHash || digest(action.request) !== action.requestHash) {
      throw releaseFailure('RELEASE_APPROVAL_BINDING_STALE', 'The exact candidate or environment authority changed. Request fresh approval.');
    }
    if (action.version !== expectedVersion) throw conflict('The protected action changed. Reload its saved outcome before continuing.');
  }

  async #candidate(client, context, candidate) {
    const found = await client.query(`select a.* from orgward.aggregates a
      join orgward.aggregate_project_scopes s on s.tenant_id=a.tenant_id and s.aggregate_kind=a.aggregate_kind and s.aggregate_id=a.aggregate_id
      where a.tenant_id=$1 and a.aggregate_kind='execution_run' and a.aggregate_id=$2 and s.project_id=$3
      for share of a`, [context.tenantId, candidate.runId, context.projectId]);
    if (!found.rowCount || digest(releaseCandidateBinding(verifyAggregateRow(found.rows[0]))) !== digest(candidate)) {
      throw releaseFailure('RELEASE_CANDIDATE_STALE', 'The exact saved candidate is unavailable or changed.');
    }
  }

  async #write(client, context, action, type, commandId = null, created = false) {
    if (!created) action.version += 1;
    const event = { id: `event-${randomUUID()}`, type, at: new Date().toISOString(), actor: context.principal ?? 'release-adapter',
      data: { requestHash: action.requestHash, status: action.status,
        candidateEvidenceHash: action.request.candidate.candidateEvidenceHash, environmentId: action.request.environment.id } };
    action.events.push(event);
    if (created) {
      await client.query(`insert into orgward.protected_release_actions
        (tenant_id,project_id,action_id,environment_id,state,state_hash) values ($1,$2,$3,$4,$5::jsonb,$6)`,
      [...scope(context), action.id, action.request.environment.id, canonicalJson(action), contentHash(action)]);
    } else {
      await client.query(`update orgward.protected_release_actions set state=$4::jsonb,state_hash=$5
        where tenant_id=$1 and project_id=$2 and action_id=$3`,
      [...scope(context), action.id, canonicalJson(action), contentHash(action)]);
    }
    await recordEvent(client, { tenantId: context.tenantId, kind: 'protected_release_action', id: action.id,
      version: action.version, commandId, event });
    return action;
  }

  async list(context, environmentId) {
    return this.persistence.transaction(async (client) => {
      await this.#authorize(client, context);
      const state = await this.#environment(client, context, environmentId);
      const found = await client.query(`select state,state_hash from orgward.protected_release_actions
        where tenant_id=$1 and project_id=$2 and environment_id=$3
        order by case when action_id=$4 then 0 else 1 end,created_at desc,action_id desc limit 50`,
      [...scope(context), environmentId, state.pendingActionId]);
      return { state, actions: found.rows.map(verified) };
    });
  }

  async read(context, actionId, environment = null, phase = 'read') {
    return this.persistence.transaction(async (client) => {
      await this.#authorize(client, context, environment, phase);
      return this.#action(client, context, actionId);
    });
  }

  async replayCommand(context, environment, operation, phase, commandId, payloadHash) {
    return this.persistence.transaction(async (client) => {
      await this.#authorize(client, context, environment, phase);
      const action = await this.#replay(client, context, operation, commandId, payloadHash);
      return action ? { action, replayed: true } : null;
    });
  }

  async create(context, environment, input, candidate, payloadHash) {
    return this.persistence.transaction(async (client) => {
      const membership = await this.#authorize(client, context, environment, 'request');
      const replay = await this.#replay(client, context, 'create', input.commandId, payloadHash);
      if (replay) return { action: replay, replayed: true };
      const state = await this.#environment(client, context, environment.id, true);
      const pending = state.pendingActionId ? await this.#action(client, context, state.pendingActionId) : null;
      const knownUnhealthy = pending?.status === 'UNHEALTHY' && pending.observations.at(-1)?.status === 'APPLIED'
        && pending.observations.at(-1)?.health === 'unhealthy';
      if (state.pendingActionId && !(input.kind === 'rollback' && knownUnhealthy && state.current)) {
        throw releaseFailure('RELEASE_RECONCILIATION_REQUIRED', 'This environment has an unresolved dispatch. Reconcile its saved action first.');
      }
      if (state.generation !== input.expectedGeneration) throw conflict('The environment changed. Review its current and rollback candidates.');
      if (!environment.actions.includes(input.kind)) throw releaseFailure('RELEASE_ACTION_DISABLED', 'This environment does not authorize the requested action.', 403);
      const rollbackTarget = knownUnhealthy ? state.current : state.previous;
      if (input.kind === 'rollback' && (!rollbackTarget || digest(rollbackTarget) !== digest(candidate))) {
        throw releaseFailure('RELEASE_ROLLBACK_UNAVAILABLE', 'This environment has no matching previous successful candidate to restore.');
      }
      await this.#candidate(client, context, candidate);
      const request = { version: 'protected-release-request-v1', kind: input.kind, tenantId: context.tenantId,
        projectId: context.projectId, environment: releaseEnvironmentSnapshot(environment), candidate,
        expectedGeneration: state.generation, fromCandidateEvidenceHash: state.current?.candidateEvidenceHash ?? null,
        recoveryOfActionId: knownUnhealthy ? pending.id : null, expectedPendingActionId: state.pendingActionId,
        reason: input.reason, requestedBy: context.principal, authorityGeneration: context.authzGeneration,
        membershipGeneration: membership.generation, createdAt: new Date().toISOString() };
      const action = { id: `release-action-${randomUUID()}`, version: 1, status: 'AWAITING_APPROVAL', request,
        requestHash: digest(request), approval: null, dispatch: null, observations: [], events: [] };
      await this.#write(client, context, action, 'ProtectedReleaseRequested', input.commandId, true);
      await this.#command(client, context, 'create', input.commandId, payloadHash, action);
      return { action, replayed: false };
    });
  }

  async approve(context, environment, actionId, input, payloadHash) {
    return this.persistence.transaction(async (client) => {
      const membership = await this.#authorize(client, context, environment, 'approve');
      const operation = `approve:${actionId}`;
      const replay = await this.#replay(client, context, operation, input.commandId, payloadHash);
      if (replay) return { action: replay, replayed: true };
      const state = await this.#environment(client, context, environment.id, true);
      const action = await this.#action(client, context, actionId, true);
      this.#matching(action, environment, input.requestHash, input.expectedVersion);
      if (action.status !== 'AWAITING_APPROVAL' || state.pendingActionId !== action.request.expectedPendingActionId
        || state.generation !== action.request.expectedGeneration) {
        throw conflict('The action or environment is no longer awaiting this exact approval.');
      }
      if (action.request.requestedBy === context.principal) throw releaseFailure('RELEASE_INDEPENDENT_APPROVAL_REQUIRED', 'A different configured human principal must approve the release.', 403);
      await this.#candidate(client, context, action.request.candidate);
      action.approval = { principal: context.principal, authorityGeneration: context.authzGeneration,
        membershipGeneration: membership.generation, requestHash: action.requestHash, approvedAt: new Date().toISOString() };
      action.status = 'APPROVED';
      await this.#write(client, context, action, 'ProtectedReleaseApproved', input.commandId);
      await this.#command(client, context, operation, input.commandId, payloadHash, action);
      return { action, replayed: false };
    });
  }

  async claim(context, environment, actionId, input, payloadHash) {
    return this.persistence.transaction(async (client) => {
      await this.#authorize(client, context, environment, 'execute');
      const operation = `execute:${actionId}`;
      const replay = await this.#replay(client, context, operation, input.commandId, payloadHash);
      if (replay) return { action: replay, replayed: true };
      const state = await this.#environment(client, context, environment.id, true);
      const action = await this.#action(client, context, actionId, true);
      this.#matching(action, environment, input.requestHash, input.expectedVersion);
      if (action.status !== 'APPROVED' || state.pendingActionId !== action.request.expectedPendingActionId
        || state.generation !== action.request.expectedGeneration
        || (state.current?.candidateEvidenceHash ?? null) !== action.request.fromCandidateEvidenceHash) {
        throw conflict('This approval no longer matches an available environment generation.');
      }
      if (action.request.recoveryOfActionId) {
        const failed = await this.#action(client, context, action.request.recoveryOfActionId);
        if (action.request.kind !== 'rollback' || failed?.status !== 'UNHEALTHY'
          || failed.observations.at(-1)?.status !== 'APPLIED' || failed.observations.at(-1)?.health !== 'unhealthy'
          || digest(state.current) !== digest(action.request.candidate)) {
          throw conflict('The confirmed unhealthy release no longer matches this approved rollback.');
        }
      }
      if (action.approval?.requestHash !== action.requestHash) throw conflict('The saved approval does not match the exact request.');
      for (const grant of [{ principal: action.request.requestedBy, authorityGeneration: action.request.authorityGeneration,
        membershipGeneration: action.request.membershipGeneration, phase: 'request' }, { ...action.approval, phase: 'approve' }]) {
        const membership = await this.#authorize(client, { ...context, principal: grant.principal,
          authzGeneration: grant.authorityGeneration }, environment, grant.phase);
        if (membership.generation !== grant.membershipGeneration) throw releaseFailure('RELEASE_APPROVAL_AUTHORITY_STALE', 'A saved authority grant changed. Request fresh approval.');
      }
      await this.#candidate(client, context, action.request.candidate);
      action.status = 'DISPATCHED';
      action.dispatch = { id: `release-dispatch-${randomUUID()}`, principal: context.principal,
        authorityGeneration: context.authzGeneration, dispatchedAt: new Date().toISOString(), requestHash: action.requestHash };
      state.pendingActionId = action.id;
      await this.#saveEnvironment(client, context, environment.id, state);
      await this.#write(client, context, action, 'ProtectedReleaseDispatchClaimed', input.commandId);
      await this.#command(client, context, operation, input.commandId, payloadHash, action);
      return { action, replayed: false };
    });
  }

  async settle(context, actionId, dispatchId, observation, command = null, environment = null) {
    return this.persistence.transaction(async (client) => {
      if (command) await this.#authorize(client, context, environment, 'execute');
      const existing = await this.#action(client, context, actionId);
      if (!existing) throw releaseFailure('RELEASE_ACTION_NOT_FOUND', 'The protected release action was not found.', 404);
      if (command) {
        const replay = await this.#replay(client, context, `reconcile:${actionId}`, command.commandId, command.payloadHash);
        if (replay) return { action: replay, replayed: true };
      }
      const state = await this.#environment(client, context, existing.request.environment.id, true);
      const action = await this.#action(client, context, actionId, true);
      if (action.dispatch?.id !== dispatchId || digest(action.request) !== action.requestHash) throw conflict('The dispatch identity changed.');
      if (['SUCCEEDED', 'FAILED', 'RECOVERED'].includes(action.status)) return { action, replayed: true };
      if (state.pendingActionId !== action.id || state.generation !== action.request.expectedGeneration) throw conflict('The environment dispatch claim changed.');
      action.observations.push({ ...observation, recordedAt: new Date().toISOString(), source: command ? 'reconciliation' : 'dispatch' });
      if (observation.status === 'APPLIED' && observation.health === 'healthy') {
        action.status = 'SUCCEEDED';
        if (!action.request.recoveryOfActionId) state.previous = state.current;
        state.current = structuredClone(action.request.candidate);
        state.generation += 1;
        state.pendingActionId = null;
        if (action.request.recoveryOfActionId) {
          const failed = await this.#action(client, context, action.request.recoveryOfActionId, true);
          if (!failed || failed.status !== 'UNHEALTHY') throw conflict('The unhealthy release recovery binding changed.');
          failed.status = 'RECOVERED'; failed.recoveredByActionId = action.id;
          await this.#write(client, context, failed, 'ProtectedReleaseRecovered', command?.commandId);
        }
      } else if (observation.status === 'REJECTED' && observation.noEffect === true) {
        action.status = 'FAILED'; state.pendingActionId = action.request.recoveryOfActionId ?? null;
      } else action.status = observation.status === 'APPLIED' && observation.health === 'unhealthy'
        ? 'UNHEALTHY' : 'OUTCOME_UNKNOWN';
      await this.#saveEnvironment(client, context, action.request.environment.id, state);
      await this.#write(client, context, action, command ? 'ProtectedReleaseReconciled' : 'ProtectedReleaseObserved', command?.commandId);
      if (command) await this.#command(client, context, `reconcile:${actionId}`, command.commandId, command.payloadHash, action);
      return { action, replayed: false };
    });
  }
}
