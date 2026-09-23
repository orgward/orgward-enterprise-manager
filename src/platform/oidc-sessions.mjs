import { createHash } from 'node:crypto';

function digest(sessionId) {
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(sessionId)) return null;
  return createHash('sha256').update(sessionId).digest('hex');
}

const BOOTSTRAP_ROLES = ['tenant-admin', 'workspace-read', 'workspace-write'];
const ALLOWED_ROLES = new Set([
  'tenant-admin', 'workspace-read', 'workspace-write', 'execution-approver', 'release-approver', 'control-owner',
]);
const HUMAN_APPROVAL_ROLES = new Set(['execution-approver', 'release-approver', 'control-owner']);

function principalFor(issuer, subject) {
  return `oidc:${createHash('sha256').update(`${issuer}\n${subject}`).digest('hex')}`;
}

export class PostgresOidcSessionStore {
  constructor(persistence, { bootstrapPrincipals = [] } = {}) {
    if (!Array.isArray(bootstrapPrincipals)) throw new Error('Configured OIDC bootstrap principals must be an array.');
    this.persistence = persistence;
    this.bootstrapPrincipals = new Map();
    for (const entry of bootstrapPrincipals) {
      if (!entry || typeof entry.issuer !== 'string' || !entry.issuer.trim()
        || typeof entry.subject !== 'string' || !entry.subject.trim() || entry.subject.length > 512
        || typeof entry.tenantId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(entry.tenantId)) {
        throw new Error('Each OIDC bootstrap principal must specify an issuer, subject, and mapped tenant ID.');
      }
      const principal = principalFor(entry.issuer, entry.subject);
      const key = `${entry.tenantId}\n${entry.issuer}\n${principal}`;
      if (this.bootstrapPrincipals.has(key)) throw new Error('Duplicate OIDC bootstrap principal configuration.');
      this.bootstrapPrincipals.set(key, entry.subject);
    }
  }

  async create(sessionId, identity, expiresAt) {
    const sessionHash = digest(sessionId);
    if (!sessionHash || !identity?.principal || !identity?.issuer || !identity?.tenantId
      || !Number.isInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
      throw new Error('The OIDC session is invalid or expired.');
    }
    await this.persistence.transaction(async (client) => {
      const principal = await this.#bindPrincipal(client, identity, { recordAuthentication: true });
      if (!principal) throw new Error('This identity has been revoked or its tenant binding changed.');
      await client.query(`
        insert into orgward.oidc_sessions
          (session_hash, issuer, principal, tenant_id, roles, actor_type, expires_at)
        values ($1, $2, $3, $4, $5::text[], $6, to_timestamp($7))
      `, [sessionHash, principal.issuer, principal.principal, principal.tenant_id, principal.roles, principal.actor_type, expiresAt]);
    });
  }

  async #bindPrincipal(client, identity, { recordAuthentication = false } = {}) {
    const displayName = typeof identity.displayName === 'string' && identity.displayName.trim()
      ? identity.displayName.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) || identity.principal
      : identity.subject?.slice(0, 200) || identity.principal;
    const inserted = await client.query(`
      insert into orgward.oidc_principals (principal, issuer, tenant_id, actor_type, roles, display_name)
      values ($1, $2, $3, $4, $5::text[], $6)
      on conflict (principal, tenant_id) do nothing
      returning principal, issuer, tenant_id, actor_type, display_name, roles, status, authz_generation
    `, [identity.principal, identity.issuer, identity.tenantId, identity.actorType, [], displayName]);
    const selected = inserted.rowCount ? inserted : await client.query(`
      select principal, issuer, tenant_id, actor_type, display_name, roles, status, authz_generation
      from orgward.oidc_principals where principal = $1 and tenant_id = $2 for update
    `, [identity.principal, identity.tenantId]);
    if (!selected.rowCount) return null;
    let principal = selected.rows[0];
    if (principal.status !== 'active' || principal.issuer !== identity.issuer
      || principal.tenant_id !== identity.tenantId || principal.actor_type !== identity.actorType) return null;
    const displayChanged = principal.display_name !== displayName;
    if (displayChanged) {
      const updated = await client.query(`
        update orgward.oidc_principals
        set display_name = $2, updated_at = now()
        where principal = $1 and status = 'active' and tenant_id = $3
        returning principal, issuer, tenant_id, actor_type, display_name, roles, status, authz_generation
      `, [identity.principal, displayName, principal.tenant_id]);
      if (!updated.rowCount) return null;
      principal = updated.rows[0];
    }
    principal = await this.#applyConfiguredBootstrap(client, principal, identity);
    if (recordAuthentication) {
      await client.query(`
        update orgward.oidc_principals set last_authenticated_at = now(), updated_at = now()
        where principal = $1 and status = 'active' and tenant_id = $2
      `, [principal.principal, principal.tenant_id]);
    }
    if (recordAuthentication) {
      await client.query(`
        insert into orgward.oidc_principal_events
          (tenant_id, principal, event_type, actor, authz_generation)
        values ($1, $2, 'PrincipalAuthenticated', $2, $3)
      `, [principal.tenant_id, principal.principal, principal.authz_generation]);
    }
    return principal;
  }

  async #applyConfiguredBootstrap(client, principal, identity) {
    const key = `${principal.tenant_id}\n${principal.issuer}\n${principal.principal}`;
    const configuredSubject = this.bootstrapPrincipals.get(key);
    if (!configuredSubject || identity.actorType !== 'human' || identity.subject !== configuredSubject
      || principalFor(identity.issuer, identity.subject) !== principal.principal) return principal;
    const marker = await client.query(`
      insert into orgward.oidc_bootstrap_grants (tenant_id, principal, issuer, roles)
      values ($1, $2, $3, $4::text[])
      on conflict (tenant_id, principal) do nothing
      returning principal
    `, [principal.tenant_id, principal.principal, principal.issuer, BOOTSTRAP_ROLES]);
    if (!marker.rowCount) return principal;
    const nextRoles = [...new Set([...principal.roles, ...BOOTSTRAP_ROLES])].sort();
    const changed = JSON.stringify([...principal.roles].sort()) !== JSON.stringify(nextRoles);
    if (changed) {
      const updated = await client.query(`
        update orgward.oidc_principals
        set roles = $3::text[], authz_generation = authz_generation + 1, updated_at = now()
        where tenant_id = $1 and principal = $2 and status = 'active'
        returning principal, issuer, tenant_id, actor_type, display_name, roles, status, authz_generation
      `, [principal.tenant_id, principal.principal, nextRoles]);
      if (!updated.rowCount) return null;
      principal = updated.rows[0];
    }
    await client.query(`
      insert into orgward.oidc_principal_events
        (tenant_id, principal, event_type, actor, authz_generation, reason, roles)
      values ($1, $2, 'PrincipalBootstrapped', $2, $3, 'operator_configured_bootstrap', $4::text[])
    `, [principal.tenant_id, principal.principal, principal.authz_generation, principal.roles]);
    return principal;
  }

  async resolve(identity) {
    if (!identity?.principal || !identity?.issuer || !identity?.tenantId) return null;
    const outcome = await this.persistence.transaction(async (client) => {
      const principal = await this.#bindPrincipal(client, identity);
      if (!principal) return null;
      return Object.freeze({
        issuer: principal.issuer,
        principal: principal.principal,
        tenantId: principal.tenant_id,
        displayName: principal.display_name,
        roles: Object.freeze(principal.roles),
        actorType: principal.actor_type,
        authzGeneration: Number(principal.authz_generation),
        expiresAt: identity.expiresAt,
      });
    });
    return outcome;
  }

  async get(sessionId) {
    return this.getWithAuthority(sessionId);
  }

  async getWithAuthority(sessionId, { operation = null } = {}) {
    const sessionHash = digest(sessionId);
    if (!sessionHash) return operation ? operation(null) : null;
    return this.persistence.transaction(async (client) => {
      const result = await client.query(`
        select p.issuer, p.principal, p.tenant_id, p.display_name, p.roles, p.actor_type,
          p.authz_generation,
          floor(extract(epoch from s.expires_at))::bigint expires_at
        from orgward.oidc_sessions s
        join orgward.oidc_principals p
          on p.principal = s.principal and p.tenant_id = s.tenant_id and p.issuer = s.issuer
        where s.session_hash = $1 and s.revoked_at is null and s.expires_at > now()
          and p.status = 'active'
        for share of s, p
      `, [sessionHash]);
      const row = result.rows[0];
      const identity = row ? Object.freeze({
        issuer: row.issuer,
        principal: row.principal,
        tenantId: row.tenant_id,
        displayName: row.display_name,
        roles: Object.freeze(row.roles),
        actorType: row.actor_type,
        authzGeneration: Number(row.authz_generation),
        expiresAt: Number(row.expires_at),
      }) : null;
      return operation ? operation(identity) : identity;
    });
  }

  async revoke(sessionId) {
    const sessionHash = digest(sessionId);
    if (!sessionHash) return false;
    const result = await this.persistence.query(`
      update orgward.oidc_sessions set revoked_at = coalesce(revoked_at, now())
      where session_hash = $1 and revoked_at is null
    `, [sessionHash]);
    return result.rowCount > 0;
  }

  async listPrincipalsForAdmin({ tenantId, actor, actorAuthzGeneration, operation }) {
    if (typeof tenantId !== 'string' || !tenantId || !actor || !Number.isSafeInteger(actorAuthzGeneration)
      || typeof operation !== 'function') {
      throw Object.assign(new Error('A current tenant administrator is required.'), { statusCode: 403, code: 'ACTION_FORBIDDEN' });
    }
    return this.persistence.transaction(async (client) => {
      const administrator = await client.query(`
        select status, actor_type, roles, authz_generation from orgward.oidc_principals
        where tenant_id = $1 and principal = $2 for share
      `, [tenantId, actor]);
      const current = administrator.rows[0];
      if (!current || current.status !== 'active' || current.actor_type !== 'human' || !current.roles.includes('tenant-admin')) {
        throw Object.assign(new Error('Current tenant administrator authority is required.'), { statusCode: 403, code: 'ACTION_FORBIDDEN' });
      }
      if (Number(current.authz_generation) !== actorAuthzGeneration) {
        throw Object.assign(new Error('The identity authority changed before this operation was completed.'), {
          statusCode: 409, code: 'AUTHORITY_GENERATION_STALE',
        });
      }
      const result = await client.query(`
        select principal, actor_type, display_name, roles, status, authz_generation,
          created_at, updated_at, last_authenticated_at, revoked_at, revoked_by, revocation_reason
        from orgward.oidc_principals
        where tenant_id = $1
        order by status, principal
        for share
      `, [tenantId]);
      const identities = result.rows.map((row) => Object.freeze({
        principal: row.principal,
        displayName: row.display_name,
        actorType: row.actor_type,
        roles: Object.freeze(row.roles),
        status: row.status,
        authzGeneration: Number(row.authz_generation),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastAuthenticatedAt: row.last_authenticated_at,
        revokedAt: row.revoked_at,
        revokedBy: row.revoked_by,
        revocationReason: row.revocation_reason,
      }));
      return operation(identities);
    });
  }

  async listPrincipals(tenantId) {
    if (typeof tenantId !== 'string' || !tenantId) throw new Error('Tenant context is required for identity administration.');
    const result = await this.persistence.query(`
      select principal, actor_type, display_name, roles, status, authz_generation,
        created_at, updated_at, last_authenticated_at, revoked_at, revoked_by, revocation_reason
      from orgward.oidc_principals
      where tenant_id = $1
      order by status, principal
    `, [tenantId]);
    return result.rows.map((row) => Object.freeze({
      principal: row.principal,
      displayName: row.display_name,
      actorType: row.actor_type,
      roles: Object.freeze(row.roles),
      status: row.status,
      authzGeneration: Number(row.authz_generation),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastAuthenticatedAt: row.last_authenticated_at,
      revokedAt: row.revoked_at,
      revokedBy: row.revoked_by,
      revocationReason: row.revocation_reason,
    }));
  }

  async #lockAdminChange(client, { tenantId, actor, principal, actorAuthzGeneration, expectedAuthzGeneration }) {
    if (!tenantId || !/^oidc:[a-f0-9]{64}$/.test(principal ?? '') || !/^oidc:[a-f0-9]{64}$/.test(actor ?? '')
      || principal === actor || !Number.isSafeInteger(actorAuthzGeneration)) {
      throw Object.assign(new Error('A distinct authenticated tenant administrator and target are required.'), {
        statusCode: principal === actor ? 409 : 400,
        code: principal === actor ? 'SELF_IDENTITY_CHANGE_DENIED' : 'INVALID_COMMAND',
      });
    }
    const principals = [actor, principal].sort();
    const locked = await client.query(`
      select principal, status, actor_type, roles, authz_generation
      from orgward.oidc_principals
      where tenant_id = $1 and principal = any($2::text[])
      order by principal for update
    `, [tenantId, principals]);
    const byPrincipal = new Map(locked.rows.map((row) => [row.principal, row]));
    const administrator = byPrincipal.get(actor);
    const target = byPrincipal.get(principal);
    if (!administrator || administrator.status !== 'active' || administrator.actor_type !== 'human'
      || !administrator.roles.includes('tenant-admin')
      || Number(administrator.authz_generation) !== actorAuthzGeneration) {
      throw Object.assign(new Error('Current tenant administrator authority is required.'), { statusCode: 403, code: 'ACTION_FORBIDDEN' });
    }
    if (!target) return { administrator, target: null };
    if (target.status !== 'revoked' && expectedAuthzGeneration !== null && expectedAuthzGeneration !== undefined
      && (!Number.isSafeInteger(expectedAuthzGeneration)
        || Number(target.authz_generation) !== expectedAuthzGeneration)) {
      throw Object.assign(new Error('The target identity authority changed. Reload the current identity before retrying.'), {
        statusCode: 409, code: 'AUTHORITY_GENERATION_STALE', currentGeneration: Number(target.authz_generation),
      });
    }
    return { administrator, target };
  }

  async #cancelAffectedLeases(client, { tenantId, principal, reason }) {
    const result = await client.query(`
      update orgward.execution_worker_leases l
      set cancel_requested_at = coalesce(l.cancel_requested_at, now()),
        cancel_reason = coalesce(l.cancel_reason, $3), updated_at = now()
      where l.tenant_id = $1 and l.lease_until > now() and l.cancel_requested_at is null
        and (l.principal = $2 or exists (
          select 1 from orgward.aggregates a
          where a.tenant_id = l.tenant_id and a.aggregate_kind = 'execution_run'
            and a.aggregate_id = l.run_id and a.state #>> '{approval,principal}' = $2
        ))
      returning l.run_id, l.principal
    `, [tenantId, principal, reason]);
    return result.rows;
  }

  async updatePrincipalRoles({ tenantId, principal, actor, actorAuthzGeneration, expectedAuthzGeneration, roles, reason, afterChange = null }) {
    if (!Number.isSafeInteger(expectedAuthzGeneration)
      || !Array.isArray(roles) || roles.some((role) => typeof role !== 'string' || !ALLOWED_ROLES.has(role))
      || new Set(roles).size !== roles.length || typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) {
      throw Object.assign(new Error('Provide a unique allowlisted role set and a reason of 1 to 500 characters.'), { statusCode: 400, code: 'INVALID_COMMAND' });
    }
    const nextRoles = [...roles].sort();
    const outcome = await this.persistence.transaction(async (client) => {
      const { target } = await this.#lockAdminChange(client, {
        tenantId, principal, actor, actorAuthzGeneration, expectedAuthzGeneration,
      });
      if (!target || target.status !== 'active') return null;
      if (target.actor_type === 'workload' && nextRoles.includes('tenant-admin')) {
        throw Object.assign(new Error('Workload identities cannot receive tenant-admin authority.'), { statusCode: 403, code: 'WORKLOAD_TENANT_ADMIN_DENIED' });
      }
      if (target.actor_type === 'workload' && nextRoles.some((role) => HUMAN_APPROVAL_ROLES.has(role))) {
        throw Object.assign(new Error('Workload identities cannot receive human approval roles.'), { statusCode: 403, code: 'WORKLOAD_APPROVAL_ROLE_DENIED' });
      }
      const currentRoles = [...target.roles].sort();
      if (JSON.stringify(currentRoles) === JSON.stringify(nextRoles)) {
        return { principal, roles: currentRoles, authzGeneration: Number(target.authz_generation), changed: false, cancelledRuns: [] };
      }
      if (currentRoles.includes('tenant-admin') && !nextRoles.includes('tenant-admin')) {
        const otherAdmins = await client.query(`
          select count(*)::int count from orgward.oidc_principals
          where tenant_id = $1 and status = 'active' and principal <> $2 and 'tenant-admin' = any(roles)
        `, [tenantId, principal]);
        if (otherAdmins.rows[0].count === 0) {
          throw Object.assign(new Error('The last active tenant administrator cannot be demoted.'), { statusCode: 409, code: 'LAST_TENANT_ADMIN' });
        }
      }
      const updated = await client.query(`
        update orgward.oidc_principals set roles = $3::text[], authz_generation = authz_generation + 1, updated_at = now()
        where tenant_id = $1 and principal = $2 and status = 'active'
        returning authz_generation
      `, [tenantId, principal, nextRoles]);
      const generation = Number(updated.rows[0].authz_generation);
      const lostAuthority = currentRoles.some((role) => !nextRoles.includes(role));
      const cancelledRuns = lostAuthority
        ? await this.#cancelAffectedLeases(client, { tenantId, principal, reason: 'principal_authority_changed' })
        : [];
      await client.query(`
        insert into orgward.oidc_principal_events
          (tenant_id, principal, event_type, actor, authz_generation, reason, roles)
        values ($1, $2, 'PrincipalRolesChanged', $3, $4, $5, $6::text[])
      `, [tenantId, principal, actor, generation, reason.trim(), nextRoles]);
      return { principal, roles: nextRoles, authzGeneration: generation, changed: true, lostAuthority, cancelledRuns };
    });
    if (outcome?.lostAuthority) await afterChange?.({ tenantId, principal, cancelledRuns: outcome.cancelledRuns });
    if (outcome) delete outcome.cancelledRuns;
    return outcome;
  }

  async revokePrincipal({ tenantId, principal, actor, actorAuthzGeneration, expectedAuthzGeneration, reason, beforeRevoke = null }) {
    if (!Number.isSafeInteger(expectedAuthzGeneration)
      || typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) {
      throw Object.assign(new Error('Provide a revocation reason of 1 to 500 characters.'), { statusCode: 400, code: 'INVALID_COMMAND' });
    }
    const outcome = await this.persistence.transaction(async (client) => {
      const { target } = await this.#lockAdminChange(client, {
        tenantId, principal, actor, actorAuthzGeneration, expectedAuthzGeneration,
      });
      if (!target) return { result: false, revoked: false };
      if (target.status === 'revoked') return { result: true, revoked: false };
      if (target.roles.includes('tenant-admin')) {
        const otherAdmins = await client.query(`
          select count(*)::int count from orgward.oidc_principals
          where tenant_id = $1 and status = 'active' and principal <> $2 and 'tenant-admin' = any(roles)
        `, [tenantId, principal]);
        if (otherAdmins.rows[0].count === 0) {
          throw Object.assign(new Error('The last active tenant administrator cannot be revoked.'), { statusCode: 409, code: 'LAST_TENANT_ADMIN' });
        }
      }
      const updated = await client.query(`
        update orgward.oidc_principals
        set status = 'revoked', authz_generation = authz_generation + 1,
          updated_at = now(), revoked_at = now(), revoked_by = $3, revocation_reason = $4
        where tenant_id = $1 and principal = $2 and status = 'active'
        returning authz_generation
      `, [tenantId, principal, actor, reason.trim()]);
      if (!updated.rowCount) return { result: false, revoked: false };
      const generation = Number(updated.rows[0].authz_generation);
      await client.query(`
        update orgward.oidc_sessions set revoked_at = coalesce(revoked_at, now())
        where tenant_id = $1 and principal = $2 and revoked_at is null
      `, [tenantId, principal]);
      const cancelledRuns = await this.#cancelAffectedLeases(client, { tenantId, principal, reason: 'principal_revoked' });
      await client.query(`
        insert into orgward.oidc_principal_events
          (tenant_id, principal, event_type, actor, authz_generation, reason, roles)
        values ($1, $2, 'PrincipalRevoked', $3, $4, $5, $6::text[])
      `, [tenantId, principal, actor, generation, reason.trim(), target.roles]);
      return { result: true, revoked: true, cancelledRuns };
    });
    if (outcome?.revoked) await beforeRevoke?.({ tenantId, principal, cancelledRuns: outcome.cancelledRuns });
    if (outcome) delete outcome.cancelledRuns;
    return outcome?.result ?? false;
  }
}
