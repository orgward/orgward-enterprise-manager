import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { contentHash, verifyAggregateRow, verifyCommandRow } from './postgres.mjs';
import { executionApprovalRequestHash } from '../execution/contracts.mjs';
import { OpenAiManagedProvisioner } from './openai-managed-provisioning.mjs';
import { revokeOrgwardCreatedOpenAiServiceAccount } from './openai-admin-revocation.mjs';

function failure(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

function versionConflict(currentVersion) {
  return Object.assign(failure(409, 'VERSION_CONFLICT', 'Secret reference changed before this update.'), { currentVersion });
}

export function decodeSecretEncryptionKey(encoded) {
  if (encoded === undefined || encoded === null || encoded === '') return null;
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
    throw new Error('ORGWARD_SECRET_ENCRYPTION_KEY must be a canonical base64-encoded 32-byte key.');
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) {
    throw new Error('ORGWARD_SECRET_ENCRYPTION_KEY must be a canonical base64-encoded 32-byte key.');
  }
  return key;
}

function associatedData(tenantId, reference, version) {
  return Buffer.from(`${tenantId}\n${reference}\n${version}`, 'utf8');
}

function seal(key, tenantId, reference, version, value) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(associatedData(tenantId, reference, version));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { ciphertext, nonce, authTag: cipher.getAuthTag() };
}

async function requireTenantAdmin(client, { tenantId, actor, actorAuthzGeneration }) {
  const result = await client.query(`
    select status, actor_type, roles, authz_generation
    from orgward.oidc_principals
    where tenant_id = $1 and principal = $2
    for share
  `, [tenantId, actor]);
  const current = result.rows[0];
  if (!current || current.status !== 'active' || current.actor_type !== 'human'
    || !current.roles.includes('tenant-admin')) {
    throw failure(403, 'ACTION_FORBIDDEN', 'Current human tenant administrator authority is required.');
  }
  if (Number(current.authz_generation) !== actorAuthzGeneration) {
    throw failure(409, 'AUTHORITY_GENERATION_STALE', 'Identity authority changed before this operation completed.');
  }
}

function validateCommand({ tenantId, actor, actorAuthzGeneration, reference, reason, commandId }) {
  if (typeof tenantId !== 'string' || !tenantId || !actor || !Number.isSafeInteger(actorAuthzGeneration)) {
    throw failure(403, 'ACTION_FORBIDDEN', 'Current tenant administrator authority is required.');
  }
  if (typeof commandId !== 'string' || !/^[a-z0-9][a-z0-9_.:-]{0,159}$/i.test(commandId)) {
    throw failure(400, 'INVALID_COMMAND', 'A stable commandId is required.');
  }
  if (typeof reference !== 'string' || !/^secret-[a-z0-9][a-z0-9._-]{0,79}$/.test(reference)) {
    throw failure(400, 'INVALID_SECRET_REFERENCE', 'Secret reference must use secret- followed by a lowercase identifier.');
  }
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) {
    throw failure(400, 'INVALID_COMMAND', 'A reason of 1 to 500 characters is required.');
  }
}

function validateExpiry(expiresAt) {
  const parsed = typeof expiresAt === 'string' ? Date.parse(expiresAt) : NaN;
  if (typeof expiresAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(expiresAt)
    || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== expiresAt.slice(0, 10)) {
    throw failure(400, 'INVALID_CREDENTIAL_EXPIRY', 'A valid UTC credential expiry is required.');
  }
  return new Date(expiresAt).toISOString();
}

export class PostgresSecretStore {
  constructor(persistence, { encryptionKey = null, openAiValidationEndpoint = 'https://api.openai.com/v1/models',
    openAiAdminApiKey = null, openAiOrganizationId = null, openAiTenantProjects = null, openAiAdminEndpoint = 'https://api.openai.com' } = {}) {
    if (encryptionKey !== null && (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32)) {
      throw new Error('The secret encryption key must contain exactly 32 bytes.');
    }
    this.persistence = persistence;
    // Tests may inject a loopback fixture. Production construction uses the fixed OpenAI host.
    const validationUrl = new URL(openAiValidationEndpoint);
    const loopbackValidation = ['localhost', '127.0.0.1', '[::1]'].includes(validationUrl.hostname);
    if ((validationUrl.protocol !== 'https:' && !(validationUrl.protocol === 'http:' && loopbackValidation))
      || validationUrl.username || validationUrl.password || validationUrl.search || validationUrl.hash
      || validationUrl.pathname !== '/v1/models' || (!loopbackValidation && validationUrl.hostname !== 'api.openai.com')) {
      throw new Error('The OpenAI validation endpoint must use HTTPS (loopback HTTP is test-only).');
    }
    this.openAiValidationEndpoint = validationUrl.href.replace(/\/$/, '');
    this.encryptionKey = encryptionKey ? Buffer.from(encryptionKey) : null;
    this.openAiOrganizationId = openAiOrganizationId;
    this.openAiTenantProjects = openAiTenantProjects && Object.freeze({ ...openAiTenantProjects });
    this.openAiAdminApiKey = openAiAdminApiKey;
    this.openAiAdminEndpoint = openAiAdminEndpoint;
    this.openAiManagedProvisioner = openAiAdminApiKey && openAiOrganizationId
      ? new OpenAiManagedProvisioner({ adminApiKey: openAiAdminApiKey, organizationId: openAiOrganizationId, endpoint: openAiAdminEndpoint })
      : null;
    this.onCredentialInvalidated = null;
    this.onRevocationObligationsChanged = null;
    this.revocationTimer = null;
    this.revocationDrainActive = false;
  }

  startOpenAiRevocationReconciler({ intervalMs = 15_000 } = {}) {
    if (this.revocationTimer) return;
    const drain = () => { void this.reconcileOpenAiRevocationObligations().catch(() => {}); };
    this.revocationTimer = setInterval(drain, intervalMs);
    this.revocationTimer.unref?.();
    drain();
  }

  stopOpenAiRevocationReconciler() {
    if (this.revocationTimer) clearInterval(this.revocationTimer);
    this.revocationTimer = null;
  }

  #wakeOpenAiRevocationReconciler() {
    queueMicrotask(() => { void this.reconcileOpenAiRevocationObligations().catch(() => {}); });
  }

  async reconcileOpenAiRevocationObligations({ limit = 8, fetchImpl = fetch } = {}) {
    if (!this.openAiAdminApiKey || this.revocationDrainActive) return 0;
    this.revocationDrainActive = true;
    let completed = 0;
    try {
      for (let index = 0; index < limit; index += 1) {
        const claim = await this.#claimOpenAiRevocationObligation();
        if (!claim) break;
        const target = {
          organizationId: claim.provider_organization_id,
          projectId: claim.provider_project_id,
          serviceAccountId: claim.provider_service_account_id,
          apiKeyId: claim.provider_api_key_id,
          provenance: claim.target_provenance,
        };
        if (target.organizationId !== this.openAiOrganizationId) {
          await this.#releaseOpenAiRevocationClaim(claim);
          continue;
        }
        const result = await revokeOrgwardCreatedOpenAiServiceAccount({
          adminApiKey: this.openAiAdminApiKey, target, fetchImpl, endpoint: this.openAiAdminEndpoint,
          beforeDelete: () => this.#renewOpenAiRevocationClaim(claim),
        });
        if (result.status === 'confirmed') {
          await this.#confirmOpenAiRevocationObligation(claim, result);
          completed += 1;
        } else await this.#releaseOpenAiRevocationClaim(claim);
      }
    } finally {
      this.revocationDrainActive = false;
    }
    return completed;
  }

  async #claimOpenAiRevocationObligation() {
    const token = randomUUID();
    return this.persistence.transaction(async (client) => {
      const claimed = await client.query(`with due as (
        select tenant_id,reference,credential_version from orgward.secret_upstream_revocation_obligations
        where status='unconfirmed' and provider='openai'
          and target_provenance='orgward_created_exclusive_service_account'
          and provider_organization_id is not null and provider_project_id is not null
          and provider_service_account_id is not null and provider_api_key_id is not null
          and next_attempt_at <= clock_timestamp()
          and (claim_until is null or claim_until <= clock_timestamp())
        order by next_attempt_at,created_at
        for update skip locked limit 1
      ) update orgward.secret_upstream_revocation_obligations obligation
        set claim_token=$1,claim_until=clock_timestamp()+interval '30 seconds',
          attempt_count=attempt_count+1,last_attempt_at=clock_timestamp()
        from due where obligation.tenant_id=due.tenant_id and obligation.reference=due.reference
          and obligation.credential_version=due.credential_version
        returning obligation.*`, [token]);
      return claimed.rows[0] ?? null;
    });
  }

  async #confirmOpenAiRevocationObligation(claim, result) {
    await this.persistence.transaction(async (client) => {
      const updated = await client.query(`update orgward.secret_upstream_revocation_obligations
        set status='confirmed',confirmed_by=created_by,confirmed_at=clock_timestamp(),
          confirmation_evidence=$5,claim_token=null,claim_until=null
        where tenant_id=$1 and reference=$2 and credential_version=$3
          and status='unconfirmed' and claim_token=$4
        returning reference`, [claim.tenant_id, claim.reference, claim.credential_version, claim.claim_token,
        `${result.evidence}:${result.serviceAccountId}`]);
      if (updated.rowCount) await client.query(`update orgward.secret_references ref
        set upstream_revocation_status='confirmed',updated_at=clock_timestamp()
        where ref.tenant_id=$1 and ref.reference=$2 and ref.upstream_revocation_status='unconfirmed'
          and not exists (select 1 from orgward.secret_upstream_revocation_obligations pending
            where pending.tenant_id=ref.tenant_id and pending.reference=ref.reference and pending.status='unconfirmed')`,
      [claim.tenant_id, claim.reference]);
    });
  }

  async #releaseOpenAiRevocationClaim(claim) {
    await this.persistence.query(`update orgward.secret_upstream_revocation_obligations
      set claim_token=null,claim_until=null,
        next_attempt_at=clock_timestamp()+least(interval '15 minutes', interval '5 seconds' * power(2, least(attempt_count - 1, 7)))
      where tenant_id=$1 and reference=$2 and credential_version=$3
        and status='unconfirmed' and claim_token=$4`,
    [claim.tenant_id, claim.reference, claim.credential_version, claim.claim_token]);
  }

  async #renewOpenAiRevocationClaim(claim) {
    const renewed = await this.persistence.query(`update orgward.secret_upstream_revocation_obligations
      set claim_until=clock_timestamp()+interval '30 seconds'
      where tenant_id=$1 and reference=$2 and credential_version=$3 and status='unconfirmed'
        and claim_token=$4 and claim_until > clock_timestamp()
      returning claim_token`, [claim.tenant_id, claim.reference, claim.credential_version, claim.claim_token]);
    return renewed.rowCount === 1;
  }

  #requireEncryptionKey() {
    if (!this.encryptionKey) {
      throw failure(503, 'SECRET_ENCRYPTION_UNAVAILABLE', 'Configure the server-side secret encryption key before storing provider credentials.');
    }
  }

  #sanitizeRevocationReason({ tenantId, reference, row, reason }) {
    const envelopes = [];
    const hasActiveEnvelope = row.ciphertext != null && row.nonce != null && row.auth_tag != null;
    const hasCandidateEnvelope = row.candidate_ciphertext != null && row.candidate_nonce != null && row.candidate_auth_tag != null;
    if ((row.status === 'active' && !hasActiveEnvelope)
      || (row.candidate_status != null && !hasCandidateEnvelope)) return 'reason_unverified_redacted';
    if (row.ciphertext != null || row.nonce != null || row.auth_tag != null) {
      envelopes.push({ version: row.version, ciphertext: row.ciphertext, nonce: row.nonce, authTag: row.auth_tag });
    }
    if (row.candidate_ciphertext != null || row.candidate_nonce != null || row.candidate_auth_tag != null) {
      envelopes.push({ version: row.candidate_version, ciphertext: row.candidate_ciphertext, nonce: row.candidate_nonce, authTag: row.candidate_auth_tag });
    }
    if (envelopes.length === 0) return reason;
    if (!this.encryptionKey) return 'reason_unverified_redacted';
    let containsCredential = false;
    try {
      for (const envelope of envelopes) {
        if (!Number.isSafeInteger(envelope.version) || !envelope.ciphertext || !envelope.nonce || !envelope.authTag) {
          return 'reason_unverified_redacted';
        }
        const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, envelope.nonce);
        decipher.setAAD(associatedData(tenantId, reference, envelope.version));
        decipher.setAuthTag(envelope.authTag);
        const value = Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]).toString('utf8');
        if (value && reason.includes(value)) containsCredential = true;
      }
    } catch {
      return 'reason_unverified_redacted';
    }
    return containsCredential ? 'redacted_sensitive_reason' : reason;
  }

  async stageOpenAiCandidate({ tenantId, actor, actorAuthzGeneration, reference, commandId, expectedVersion, value, model, reason, expiresAt }) {
    validateCommand({ tenantId, actor, actorAuthzGeneration, reference, reason, commandId });
    this.#requireEncryptionKey();
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || typeof model !== 'string'
      || !/^[a-zA-Z0-9._:-]{1,100}$/.test(model) || typeof value !== 'string' || value.length < 8
      || Buffer.byteLength(value) > 65_536) throw failure(400, 'INVALID_CANDIDATE', 'A provider credential, model identifier and expected version are required.');
    const expiry = validateExpiry(expiresAt);
    const staged = await this.persistence.transaction(async (client) => {
      await requireTenantAdmin(client, { tenantId, actor, actorAuthzGeneration });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:secret-reference:${reference}`]);
      const payloadHash = this.#payloadHash(tenantId, actor, 'secret.openai-candidate.stage', { reference, expectedVersion, value, model, reason: reason.trim(), expiresAt: expiry });
      const prior = await this.#priorCommand(client, { tenantId, operation: 'secret.openai-candidate.stage', commandId, payloadHash });
      if (prior) return { ...prior, replayed: true };
      const current = await client.query('select version,status,candidate_generation,candidate_provider_target_provenance from orgward.secret_references where tenant_id=$1 and reference=$2 for update', [tenantId, reference]);
      if ((current.rows[0]?.version ?? 0) !== expectedVersion) throw versionConflict(current.rows[0]?.version ?? 0);
      if (current.rows[0]?.candidate_provider_target_provenance) throw failure(409, 'MANAGED_CANDIDATE_PRESENT', 'A managed OpenAI candidate must be activated or handled before another candidate can replace it.');
      const pendingProvision = await client.query(`select 1 from orgward.secret_openai_provisioning_commands
        where tenant_id=$1 and reference=$2 and status not in ('candidate_staged','candidate_activated','candidate_abandoned') limit 1`, [tenantId, reference]);
      if (pendingProvision.rowCount) throw failure(409, 'OPENAI_PROVISIONING_UNRESOLVED', 'A managed OpenAI provisioning command is unresolved; a new candidate cannot replace it.');
      const version = (current.rows[0]?.candidate_generation ?? 0) + 1;
      const envelope = seal(this.encryptionKey, tenantId, reference, version, value);
      if (current.rowCount) {
        await client.query(`update orgward.secret_references set candidate_version=$3,candidate_generation=$3,candidate_ciphertext=$4,candidate_nonce=$5,candidate_auth_tag=$6,candidate_model=$7,candidate_status='staged',candidate_validated_at=null,candidate_expires_at=$8,candidate_provider_organization_id=null,candidate_provider_project_id=null,candidate_provider_service_account_id=null,candidate_provider_api_key_id=null,candidate_provider_target_provenance=null,updated_by=$9,updated_at=now() where tenant_id=$1 and reference=$2`,
          [tenantId, reference, version, envelope.ciphertext, envelope.nonce, envelope.authTag, model, expiry, actor]);
      } else {
        await client.query(`insert into orgward.secret_references (tenant_id,reference,version,status,created_by,updated_by,expires_at,candidate_version,candidate_generation,candidate_ciphertext,candidate_nonce,candidate_auth_tag,candidate_model,candidate_status,candidate_expires_at) values ($1,$2,0,'revoked',$3,$3,$4,$5,$5,$6,$7,$8,$9,'staged',$4)`,
          [tenantId, reference, actor, expiry, version, envelope.ciphertext, envelope.nonce, envelope.authTag, model]);
      }
      const metadata = { reference, candidateVersion: version, candidateStatus: 'staged', model };
      await this.#recordCommand(client, { tenantId, operation: 'secret.openai-candidate.stage', commandId, payloadHash, result: metadata });
      return metadata;
    });
    return staged;
  }

  async provisionOpenAiCandidate({ tenantId, actor, actorAuthzGeneration, reference, commandId, expectedVersion, model, reason, expiresAt }) {
    validateCommand({ tenantId, actor, actorAuthzGeneration, reference, commandId, reason });
    this.#requireEncryptionKey();
    if (!this.openAiManagedProvisioner || !this.openAiOrganizationId || !this.openAiTenantProjects) {
      throw failure(503, 'OPENAI_MANAGED_PROVISIONING_DISABLED', 'Managed OpenAI credential provisioning is not configured for this installation.');
    }
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || typeof model !== 'string'
      || !/^[A-Za-z0-9._:-]{1,100}$/.test(model)) {
      throw failure(400, 'INVALID_COMMAND', 'A model and nonnegative expectedVersion are required.');
    }
    const projectId = this.openAiTenantProjects[tenantId];
    if (!projectId) throw failure(403, 'OPENAI_PROJECT_NOT_CONFIGURED', 'Managed OpenAI provisioning is unavailable for this tenant.');
    const expiry = validateExpiry(expiresAt);
    const expiresInSeconds = Math.floor((Date.parse(expiry) - Date.now()) / 1000);
    if (expiresInSeconds < 1 || expiresInSeconds > 31_536_000) {
      throw failure(400, 'INVALID_CREDENTIAL_EXPIRY', 'Managed OpenAI API keys must expire within 31,536,000 seconds.');
    }
    const cleanReason = reason.trim();
    const operation = 'secret.openai-managed-candidate.provision';
    const payloadHash = this.#payloadHash(tenantId, actor, operation, { reference, expectedVersion, model, reason: cleanReason, expiresAt: expiry });
    const providerResourceName = `orgward-${randomUUID()}`;
    const intent = await this.persistence.transaction(async (client) => {
      await requireTenantAdmin(client, { tenantId, actor, actorAuthzGeneration });
      const prior = await this.#priorCommand(client, { tenantId, operation, commandId, payloadHash });
      if (prior) {
        const state = await client.query(`select reference,status,candidate_version,failure_code from orgward.secret_openai_provisioning_commands where tenant_id=$1 and command_id=$2`, [tenantId, commandId]);
        return { replayed: true, ...(state.rows[0] ?? { status: 'unresolved', candidate_version: null, failure_code: 'persistence_failed' }) };
      }
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:secret-reference:${reference}`]);
      const current = await client.query('select * from orgward.secret_references where tenant_id=$1 and reference=$2 for update', [tenantId, reference]);
      const currentVersion = current.rows[0]?.version ?? 0;
      if (currentVersion !== expectedVersion) throw versionConflict(currentVersion);
      if (current.rows[0]?.candidate_version != null) throw failure(409, 'CANDIDATE_ALREADY_STAGED', 'Activate or revoke the existing candidate before provisioning another one.');
      const candidateVersion = (current.rows[0]?.candidate_generation ?? 0) + 1;
      const pending = await client.query(`select 1 from orgward.secret_openai_provisioning_commands
        where tenant_id=$1 and reference=$2 and status not in ('candidate_staged','candidate_activated','candidate_abandoned') limit 1`, [tenantId, reference]);
      if (pending.rowCount) throw failure(409, 'OPENAI_PROVISIONING_UNRESOLVED', 'A previous managed OpenAI provisioning command is unresolved; it cannot be retried automatically.');
      if (!current.rowCount) {
        await client.query(`insert into orgward.secret_references
          (tenant_id,reference,version,status,created_by,updated_by,expires_at)
          values ($1,$2,0,'revoked',$3,$3,$4)`, [tenantId, reference, actor, expiry]);
      }
      await client.query(`insert into orgward.secret_openai_provisioning_commands
        (tenant_id,reference,command_id,payload_hash,candidate_version,organization_id,project_id,model,expires_at,provider_resource_name,reason,actor,status)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'intent_recorded')`,
      [tenantId, reference, commandId, payloadHash, candidateVersion, this.openAiOrganizationId, projectId, model, expiry, providerResourceName, cleanReason, actor]);
      const metadata = { reference, status: 'provisioning', candidateVersion };
      await this.#recordCommand(client, { tenantId, operation, commandId, payloadHash, result: metadata });
      return { replayed: false, status: 'intent_recorded', candidate_version: candidateVersion };
    });
    if (intent.replayed) return this.#provisioningResult(intent, true);

    const job = { tenantId, actor, actorAuthzGeneration, reference, commandId, expectedVersion, projectId, model, expiry, expiresInSeconds,
      candidateVersion: intent.candidate_version, provisioningName: providerResourceName };
    let knownServiceAccountId = null;
    let knownApiKeyId = null;
    try {
      await this.#provisionStep(job, 'intent_recorded', 'service_account_create_sent', async () => {});
      const created = await this.openAiManagedProvisioner.createServiceAccount({ projectId, name: job.provisioningName });
      knownServiceAccountId = created.serviceAccountId;
      await this.persistence.transaction(async (client) => {
        await requireTenantAdmin(client, { tenantId, actor, actorAuthzGeneration });
        await this.#assertProvisioningReferenceCurrent(client, job);
        const updated = await client.query(`update orgward.secret_openai_provisioning_commands set service_account_id=$3,status='service_account_created',updated_at=now()
          where tenant_id=$1 and command_id=$2 and status='service_account_create_sent'`, [tenantId, commandId, created.serviceAccountId]);
        if (!updated.rowCount) throw failure(409, 'PROVISIONING_STATE_INVALID', 'Managed OpenAI provisioning state changed after service-account creation.');
      });

      await this.#provisionStep(job, 'service_account_created', 'role_update_sent', async () => {});
      await this.openAiManagedProvisioner.assignMemberRole({ projectId, serviceAccountId: created.serviceAccountId });
      await this.persistence.transaction(async (client) => {
        await requireTenantAdmin(client, { tenantId, actor, actorAuthzGeneration });
        await this.#assertProvisioningReferenceCurrent(client, job);
        const state = await client.query('select service_account_id from orgward.secret_openai_provisioning_commands where tenant_id=$1 and command_id=$2 and status=$3 for update', [tenantId, commandId, 'role_update_sent']);
        if (!state.rowCount || state.rows[0].service_account_id !== created.serviceAccountId) throw failure(409, 'PROVISIONING_STATE_INVALID', 'Managed OpenAI provisioning state is incomplete.');
        const updated = await client.query(`update orgward.secret_openai_provisioning_commands set status='service_account_ready',updated_at=now()
          where tenant_id=$1 and command_id=$2 and status='role_update_sent'`, [tenantId, commandId]);
        if (!updated.rowCount) throw failure(409, 'PROVISIONING_STATE_INVALID', 'Managed OpenAI provisioning state changed after role assignment.');
      });

      await this.#provisionStep(job, 'service_account_ready', 'api_key_create_sent', async () => {});
      const key = await this.openAiManagedProvisioner.createScopedApiKey({
        projectId, serviceAccountId: created.serviceAccountId, expiresInSeconds,
        name: job.provisioningName,
      });
      knownApiKeyId = key.apiKeyId;
      if (cleanReason.includes(key.value)) throw Object.assign(new Error('Audit reason conflicts with generated credential.'), { code: 'INVALID_COMMAND' });
      await this.persistence.transaction(async (client) => {
        await requireTenantAdmin(client, { tenantId, actor, actorAuthzGeneration });
        await this.#assertProvisioningReferenceCurrent(client, job);
        const state = await client.query(`select service_account_id,candidate_version,model,expires_at from orgward.secret_openai_provisioning_commands
          where tenant_id=$1 and command_id=$2 and status='api_key_create_sent' for update`, [tenantId, commandId]);
        if (!state.rowCount || state.rows[0].service_account_id !== created.serviceAccountId) throw failure(409, 'PROVISIONING_STATE_INVALID', 'Managed OpenAI provisioning state is incomplete.');
        const envelope = seal(this.encryptionKey, tenantId, reference, state.rows[0].candidate_version, key.value);
        const staged = await client.query(`update orgward.secret_references set candidate_version=$3,candidate_generation=$3,
          candidate_ciphertext=$4,candidate_nonce=$5,candidate_auth_tag=$6,candidate_model=$7,
          candidate_status='staged',candidate_validated_at=null,candidate_expires_at=least($8::timestamptz,to_timestamp($15::double precision)),
          candidate_provider_organization_id=$9,candidate_provider_project_id=$10,
          candidate_provider_service_account_id=$11,candidate_provider_api_key_id=$12,
          candidate_provider_target_provenance='orgward_created_exclusive_service_account',updated_by=$13,updated_at=now()
          where tenant_id=$1 and reference=$2 and version=$14 and candidate_version is null`,
        [tenantId, reference, state.rows[0].candidate_version, envelope.ciphertext, envelope.nonce, envelope.authTag,
          model, state.rows[0].expires_at, this.openAiOrganizationId, projectId, state.rows[0].service_account_id, key.apiKeyId,
          actor, expectedVersion, key.expiresAt]);
        if (!staged.rowCount) throw failure(409, 'CANDIDATE_STALE', 'The secret reference changed during managed credential provisioning.');
        const recorded = await client.query(`update orgward.secret_openai_provisioning_commands set api_key_id=$3,status='candidate_staged',updated_at=now()
          where tenant_id=$1 and command_id=$2 and status='api_key_create_sent'`, [tenantId, commandId, key.apiKeyId]);
        if (!recorded.rowCount) throw failure(409, 'PROVISIONING_STATE_INVALID', 'Managed OpenAI provisioning state changed before completion.');
      });
      return { status: 'candidate_staged', candidateVersion: job.candidateVersion, reference, replayed: false };
    } catch (error) {
      const safeCode = error.code === 'INVALID_COMMAND' ? 'provider_response_invalid' : error.invalidResponse ? 'provider_response_invalid' : 'provider_response_ambiguous';
      await this.persistence.transaction(async (client) => {
        await client.query(`update orgward.secret_openai_provisioning_commands set status='unresolved',failure_code=$3,
          service_account_id=coalesce(service_account_id,$4),api_key_id=coalesce(api_key_id,$5),updated_at=now()
          where tenant_id=$1 and command_id=$2 and status<>'candidate_staged'`, [tenantId, commandId, safeCode,
          error.serviceAccountId ?? knownServiceAccountId, error.apiKeyId ?? knownApiKeyId]);
      });
      return { status: 'unresolved', candidateVersion: job.candidateVersion, reference, replayed: false };
    }
  }

  async #provisionStep(job, expectedStatus, sentStatus) {
    await this.persistence.transaction(async (client) => {
      await requireTenantAdmin(client, { tenantId: job.tenantId, actor: job.actor, actorAuthzGeneration: job.actorAuthzGeneration });
      const updated = await client.query(`update orgward.secret_openai_provisioning_commands set status=$4,updated_at=now()
        where tenant_id=$1 and command_id=$2 and status=$3 returning command_id`, [job.tenantId, job.commandId, expectedStatus, sentStatus]);
      if (!updated.rowCount) throw failure(409, 'PROVISIONING_STATE_INVALID', 'Managed OpenAI provisioning cannot be resumed automatically.');
    });
  }

  async #assertProvisioningReferenceCurrent(client, job) {
    const current = await client.query(`select version,candidate_version from orgward.secret_references
      where tenant_id=$1 and reference=$2 for share`, [job.tenantId, job.reference]);
    if (!current.rowCount || current.rows[0].version !== job.expectedVersion || current.rows[0].candidate_version != null) {
      throw failure(409, 'VERSION_CONFLICT', 'The secret reference changed before managed provisioning completed.');
    }
  }

  #provisioningResult(row, replayed) {
    return { status: row.status === 'candidate_staged' ? 'candidate_staged' : row.status === 'unresolved' ? 'unresolved' : 'provisioning',
      reference: row.reference, candidateVersion: row.candidate_version, replayed };
  }

  async recoverManagedProvisioning() {
    await this.persistence.query(`update orgward.secret_openai_provisioning_commands
      set status='unresolved',failure_code=coalesce(failure_code,'provider_response_ambiguous'),updated_at=now()
      where status not in ('candidate_staged','candidate_activated','candidate_abandoned','unresolved')`);
  }

  async validateOpenAiCandidate({ tenantId, actor, actorAuthzGeneration, reference, candidateVersion }) {
    this.#requireEncryptionKey();
    const row = await this.persistence.transaction(async (client) => {
      await requireTenantAdmin(client, { tenantId, actor, actorAuthzGeneration });
      const result = await client.query(`select candidate_version,candidate_ciphertext,candidate_nonce,candidate_auth_tag,candidate_model,candidate_status from orgward.secret_references where tenant_id=$1 and reference=$2 for share`, [tenantId, reference]);
      if (!result.rowCount || result.rows[0].candidate_version !== candidateVersion || !['staged','validated'].includes(result.rows[0].candidate_status)) throw failure(409, 'CANDIDATE_STALE', 'The staged credential candidate changed. Stage it again.');
      const value = result.rows[0];
      const live = await client.query('select candidate_expires_at > clock_timestamp() as valid from orgward.secret_references where tenant_id=$1 and reference=$2', [tenantId, reference]);
      if (!live.rows[0]?.valid) throw failure(409, 'SECRET_CREDENTIAL_EXPIRED', 'The staged credential candidate expired. Stage a new candidate.');
      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, value.candidate_nonce);
      decipher.setAAD(associatedData(tenantId, reference, candidateVersion)); decipher.setAuthTag(value.candidate_auth_tag);
      return { credential: Buffer.concat([decipher.update(value.candidate_ciphertext), decipher.final()]).toString(), model: value.candidate_model };
    });
    let valid = false;
    let rejected = false;
    try {
      const response = await fetch(`${this.openAiValidationEndpoint}/${encodeURIComponent(row.model)}`, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8_000),
        headers: { authorization: `Bearer ${row.credential}`, accept: 'application/json' },
      });
      if (!response.ok) await response.body?.cancel();
      if (response.ok) {
        const reader = response.body?.getReader();
        if (!reader) throw new Error('missing response body');
        const chunks = []; let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 16_384) { await reader.cancel(); throw new Error('provider validation response too large'); }
          chunks.push(Buffer.from(value));
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        valid = body?.id === row.model;
        rejected = !valid;
      } else if ([401, 403, 404].includes(response.status)) rejected = true;
      else throw new Error('OpenAI validation service unavailable');
    } catch { throw Object.assign(new Error('OpenAI credential validation is temporarily unavailable; the staged candidate is unchanged.'), { statusCode: 503, code: 'OPENAI_VALIDATION_UNAVAILABLE', retryable: true }); }
    return await this.persistence.transaction(async (client) => {
      await requireTenantAdmin(client, { tenantId, actor, actorAuthzGeneration });
      const result = await client.query(`update orgward.secret_references set candidate_status=$4,candidate_validated_at=case when $4='validated' then now() else null end where tenant_id=$1 and reference=$2 and candidate_version=$3 and candidate_expires_at > clock_timestamp() returning candidate_status`, [tenantId, reference, candidateVersion, valid ? 'validated' : rejected ? 'rejected' : 'staged']);
      if (!result.rowCount) throw failure(409, 'CANDIDATE_STALE', 'The staged credential candidate changed during validation.');
      return { reference, candidateVersion, candidateStatus: result.rows[0].candidate_status, model: row.model };
    });
  }

  async activateOpenAiCandidate({ tenantId, actor, actorAuthzGeneration, reference, commandId, expectedVersion, candidateVersion, reason }) {
    validateCommand({ tenantId, actor, actorAuthzGeneration, reference, reason, commandId });
    this.#requireEncryptionKey();
    const result = await this.persistence.transaction(async (client) => {
      await requireTenantAdmin(client, { tenantId, actor, actorAuthzGeneration });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:secret-reference:${reference}`]);
      const payloadHash = this.#payloadHash(tenantId, actor, 'secret.openai-candidate.activate', { reference, expectedVersion, candidateVersion, reason: reason.trim() });
      const prior = await this.#priorCommand(client, { tenantId, operation: 'secret.openai-candidate.activate', commandId, payloadHash });
      if (prior) return { ...prior, replayed: true };
      const current = await client.query(`select * from orgward.secret_references where tenant_id=$1 and reference=$2 for update`, [tenantId, reference]);
      if (!current.rowCount || current.rows[0].version !== expectedVersion) throw versionConflict(current.rows[0]?.version ?? 0);
      const row = current.rows[0];
      if (row.candidate_version !== candidateVersion || row.candidate_status !== 'validated') throw failure(409, 'CANDIDATE_NOT_VALIDATED', 'Validate the current candidate before activation.');
      const candidateState = await client.query(`select candidate_expires_at > clock_timestamp() as unexpired,
        candidate_validated_at > clock_timestamp() - interval '15 minutes' as validation_fresh
        from orgward.secret_references where tenant_id=$1 and reference=$2`, [tenantId, reference]);
      if (!candidateState.rows[0]?.unexpired) throw failure(409, 'SECRET_CREDENTIAL_EXPIRED', 'The staged credential candidate expired. Stage a new candidate.');
      if (!candidateState.rows[0]?.validation_fresh) throw failure(409, 'CANDIDATE_VALIDATION_STALE', 'The model access validation is older than 15 minutes. Validate the staged candidate again.');
      const version = row.version + 1;
      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, row.candidate_nonce);
      decipher.setAAD(associatedData(tenantId, reference, candidateVersion)); decipher.setAuthTag(row.candidate_auth_tag);
      const clear = Buffer.concat([decipher.update(row.candidate_ciphertext), decipher.final()]).toString('utf8');
      if (reason.trim().includes(clear)) throw failure(400, 'INVALID_COMMAND', 'The activation reason cannot contain the credential value.');
      const activeEnvelope = seal(this.encryptionKey, tenantId, reference, version, clear);
      const hadOldCredential = row.version > 0 && (row.status === 'active' || row.upstream_revocation_status === 'unconfirmed');
      const upstreamStatus = hadOldCredential ? 'unconfirmed' : 'not_applicable';
      if (row.status === 'active') await this.#recordRevocationObligation(client, {
        tenantId, reference, credentialVersion: row.version, provider: row.active_provider, actor,
        target: row.active_provider_target_provenance ? {
          organizationId: row.active_provider_organization_id, projectId: row.active_provider_project_id,
          serviceAccountId: row.active_provider_service_account_id, apiKeyId: row.active_provider_api_key_id,
          provenance: row.active_provider_target_provenance,
        } : null,
        reason: 'Credential generation replaced in OrgWard; upstream revocation was not confirmed.',
      });
      await this.#cancelBoundLeases(client, { tenantId, reference, reason: 'credential_rotated' });
      const activated = await client.query(`update orgward.secret_references set version=$3,status='active',ciphertext=$4,nonce=$5,auth_tag=$6,expires_at=candidate_expires_at,active_provider='openai',active_model=candidate_model,
        active_provider_organization_id=candidate_provider_organization_id,active_provider_project_id=candidate_provider_project_id,
        active_provider_service_account_id=candidate_provider_service_account_id,active_provider_api_key_id=candidate_provider_api_key_id,
        active_provider_target_provenance=candidate_provider_target_provenance,
        candidate_version=null,candidate_ciphertext=null,candidate_nonce=null,candidate_auth_tag=null,candidate_model=null,candidate_status=null,candidate_validated_at=null,candidate_expires_at=null,
        candidate_provider_organization_id=null,candidate_provider_project_id=null,candidate_provider_service_account_id=null,candidate_provider_api_key_id=null,candidate_provider_target_provenance=null,
        upstream_revocation_status=$8,updated_by=$7,updated_at=now() where tenant_id=$1 and reference=$2 and candidate_expires_at > clock_timestamp() and candidate_validated_at > clock_timestamp() - interval '15 minutes' returning version`, [tenantId, reference, version, activeEnvelope.ciphertext, activeEnvelope.nonce, activeEnvelope.authTag, actor, upstreamStatus]);
      if (!activated.rowCount) throw failure(409, 'CANDIDATE_VALIDATION_STALE', 'The model access validation expired during activation. Validate the staged candidate again.');
      await client.query(`update orgward.secret_openai_provisioning_commands set status='candidate_activated',updated_at=now()
        where tenant_id=$1 and reference=$2 and candidate_version=$3 and status='candidate_staged'`, [tenantId, reference, candidateVersion]);
      const metadata = { reference, version, status: 'active', model: row.candidate_model, provider: 'openai', upstreamRevocationStatus: upstreamStatus, encryptionAvailable: true };
      const event = { eventId: `secret-event-${randomUUID()}`, tenantId, reference, version, type: hadOldCredential ? 'SecretReferenceRotated' : 'SecretReferenceCreated', actor, reason: reason.trim(), upstreamRevocationStatus: upstreamStatus, occurredAt: new Date().toISOString() };
      await client.query(`insert into orgward.secret_reference_events (event_id,tenant_id,reference,version,event_type,actor,reason,event,event_hash) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`, [event.eventId,tenantId,reference,version,event.type,actor,event.reason,JSON.stringify(event),contentHash(event)]);
      await this.#recordCommand(client, { tenantId, operation: 'secret.openai-candidate.activate', commandId, payloadHash, result: metadata });
      return { ...metadata, replayed: false };
    });
    try { await Promise.resolve(this.onCredentialInvalidated?.({ tenantId, reference, version: result.version, reason: 'credential_rotated' })); } catch { /* Lease cancellation committed. */ }
    if (result.version && expectedVersion > 0 && !result.replayed) this.#wakeOpenAiRevocationReconciler();
    return result;
  }

  async resolveOpenAiBinding({ tenantId, reference, model, client = null }) {
    if (!this.encryptionKey) throw failure(503, 'SECRET_ENCRYPTION_UNAVAILABLE', 'Provider credentials are unavailable.');
    const queryable = client ?? this.persistence;
    const lock = client ? ' for share' : '';
    const result = await queryable.query(`select version,active_model from orgward.secret_references where tenant_id=$1 and reference=$2 and status='active' and active_provider='openai' and expires_at > clock_timestamp()${lock}`, [tenantId, reference]);
    if (!result.rowCount || result.rows[0].active_model !== model) throw failure(409, 'OPENAI_CREDENTIAL_UNAVAILABLE', 'No current validated OpenAI credential is available for this profile model.');
    return { reference, version: result.rows[0].version, model };
  }

  #payloadHash(tenantId, actor, operation, payload) {
    const serialized = JSON.stringify({ tenantId, actor, operation, ...payload });
    return this.encryptionKey
      ? createHmac('sha256', this.encryptionKey).update(serialized).digest('hex')
      : contentHash(serialized);
  }

  async #priorCommand(client, { tenantId, operation, commandId, payloadHash }) {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
    const prior = await client.query(`
      select * from orgward.command_results
      where tenant_id = $1 and operation = $2 and command_id = $3
    `, [tenantId, operation, commandId]);
    if (!prior.rowCount) return null;
    if (prior.rows[0].payload_hash !== payloadHash) {
      throw failure(409, 'IDEMPOTENCY_CONFLICT', 'This command ID was already used with different input.');
    }
    return verifyCommandRow(prior.rows[0]);
  }

  async #recordCommand(client, { tenantId, operation, commandId, payloadHash, result }) {
    await client.query(`
      insert into orgward.command_results
        (tenant_id, operation, command_id, payload_hash, aggregate_kind, aggregate_id, result, result_hash)
      values ($1, $2, $3, $4, null, null, $5::jsonb, $6)
    `, [tenantId, operation, commandId, payloadHash, JSON.stringify(result), contentHash(result)]);
  }

  async #authorizeLease(client, { tenantId, reference, expectedVersion, runId, projectId, principal, workerId, authzGeneration, allowPauseRequested = false }) {
    if (!/^execution-run-[0-9a-f-]{36}$/.test(runId ?? '') || !/^project-[0-9a-f-]{36}$/.test(projectId ?? '')
      || !principal || !/^[a-f0-9-]{36}$/.test(workerId ?? '') || !Number.isSafeInteger(authzGeneration)) {
      throw failure(403, 'WORKER_LEASE_INVALID', 'The worker lease is no longer authorized.');
    }
    // Keep one lock order everywhere that touches both resources: secret first,
    // then run/identity/membership, then lease. Rotation uses the same order.
    const secret = await client.query(`
      select version, status, ciphertext, nonce, auth_tag, expires_at
      from orgward.secret_references where tenant_id = $1 and reference = $2
      for share
    `, [tenantId, reference]);
    if (!secret.rowCount || secret.rows[0].status !== 'active') throw failure(409, 'SECRET_REFERENCE_INACTIVE', 'The approved credential is unavailable or revoked.');
    const expiryCheck = await client.query('select $1::timestamptz > clock_timestamp() as credential_valid', [secret.rows[0].expires_at]);
    if (!expiryCheck.rows[0].credential_valid) throw failure(409, 'SECRET_CREDENTIAL_EXPIRED', 'The approved credential is expired or requires rotation.');
    if (secret.rows[0].version !== expectedVersion) throw failure(409, 'SECRET_GENERATION_STALE', 'The approved credential version changed. Reapprove this task.');
    const identity = await client.query(`
      select status, roles, authz_generation from orgward.oidc_principals
      where tenant_id = $1 and principal = $2 for share
    `, [tenantId, principal]);
    const actor = identity.rows[0];
    if (!actor || actor.status !== 'active' || !actor.roles.includes('workspace-write')
      || Number(actor.authz_generation) !== authzGeneration) {
      throw failure(403, 'WORKER_LEASE_INVALID', 'The worker lease is no longer authorized.');
    }
    const runHint = await client.query(`select state->'processTaskRef' as process_task_ref
      from orgward.aggregates where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2`, [tenantId, runId]);
    const processTaskRef = runHint.rows[0]?.process_task_ref;
    if (processTaskRef?.planInstanceId) {
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${tenantId}:process-plan-instance:${processTaskRef.planInstanceId}`,
      ]);
      const control = await client.query(`select status,project_id from orgward.process_task_instance_controls
        where tenant_id=$1 and plan_instance_id=$2 for update`, [tenantId, processTaskRef.planInstanceId]);
      if (!control.rowCount || control.rows[0].project_id !== projectId
        || (control.rows[0].status !== 'ACTIVE' && !(allowPauseRequested && control.rows[0].status === 'PAUSE_REQUESTED'))) {
        throw failure(409, 'PROCESS_INSTANCE_PAUSED', 'Provider dispatch is fenced while this process instance is paused or pausing.');
      }
    }
    const runRow = await client.query(`
      select * from orgward.aggregates
      where tenant_id = $1 and aggregate_kind = 'execution_run' and aggregate_id = $2
      for share
    `, [tenantId, runId]);
    if (!runRow.rowCount) throw failure(403, 'WORKER_LEASE_INVALID', 'The worker lease is no longer authorized.');
    const run = verifyAggregateRow(runRow.rows[0]);
    if (run.projectId !== projectId || run.status !== 'RUNNING'
      || run.profile?.credential?.reference !== reference || run.profile.credential.version !== expectedVersion
      || run.approval?.requestHash !== executionApprovalRequestHash(run)) {
      throw failure(409, 'SECRET_BINDING_STALE', 'The active run is not approved for this credential generation.');
    }
    const approver = await client.query(`
      select actor_type, status, roles, authz_generation from orgward.oidc_principals
      where tenant_id = $1 and principal = $2 for share
    `, [tenantId, run.approval?.principal]);
    const approverRow = approver.rows[0];
    const approverMembership = await client.query(`
      select access, generation from orgward.project_memberships
      where tenant_id = $1 and project_id = $2 and principal = $3 and revoked_at is null
      for share
    `, [tenantId, projectId, run.approval?.principal]);
    if (!approverRow || approverRow.status !== 'active' || approverRow.actor_type !== 'human'
      || !approverRow.roles.includes('execution-approver')
      || Number(approverRow.authz_generation) !== run.approval.authorityGeneration
      || !approverMembership.rowCount || !['owner', 'editor'].includes(approverMembership.rows[0].access)
      || Number(approverMembership.rows[0].generation) !== run.approval.projectMembershipGeneration) {
      throw failure(409, 'SECRET_BINDING_STALE', 'The execution approval is no longer current.');
    }
    const membership = await client.query(`
      select access from orgward.project_memberships
      where tenant_id = $1 and project_id = $2 and principal = $3 and revoked_at is null
      for share
    `, [tenantId, projectId, principal]);
    if (!membership.rowCount || !['owner', 'editor'].includes(membership.rows[0].access)) {
      throw failure(403, 'WORKER_LEASE_INVALID', 'The worker lease is no longer authorized.');
    }
    const lease = await client.query(`
      select 1 from orgward.execution_worker_leases
      where tenant_id = $1 and run_id = $2 and project_id = $3 and principal = $4 and worker_id = $5
      for update
    `, [tenantId, runId, projectId, principal, workerId]);
    if (!lease.rowCount) throw failure(403, 'WORKER_LEASE_INVALID', 'The worker lease is no longer authorized.');
    const leaseCheck = await client.query(`
      select lease_until > clock_timestamp() and cancel_requested_at is null as active
      from orgward.execution_worker_leases
      where tenant_id = $1 and run_id = $2 and project_id = $3 and principal = $4 and worker_id = $5
    `, [tenantId, runId, projectId, principal, workerId]);
    if (!leaseCheck.rows[0]?.active) throw failure(403, 'WORKER_LEASE_INVALID', 'The worker lease is no longer authorized.');
    const finalExpiryCheck = await client.query('select $1::timestamptz > clock_timestamp() as credential_valid', [secret.rows[0].expires_at]);
    if (!finalExpiryCheck.rows[0].credential_valid) throw failure(409, 'SECRET_CREDENTIAL_EXPIRED', 'The approved credential expired while authorizing provider use.');
    return { ...secret.rows[0], processTaskRef: processTaskRef ?? null };
  }

  async #cancelBoundLeases(client, { tenantId, reference, reason }) {
    await client.query(`
      update orgward.execution_worker_leases l
      set cancel_requested_at = coalesce(cancel_requested_at, now()),
        cancel_reason = coalesce(cancel_reason, $3), updated_at = now()
      where l.tenant_id = $1 and l.lease_until > now() and l.cancel_requested_at is null
        and exists (
          select 1 from orgward.aggregates a
          where a.tenant_id = l.tenant_id and a.aggregate_kind = 'execution_run'
            and a.aggregate_id = l.run_id
            and a.state #>> '{profile,credential,reference}' = $2
        )
    `, [tenantId, reference, reason]);
  }

  async #recordRevocationObligation(client, { tenantId, reference, credentialVersion, provider, actor, reason, target = null }) {
    if (!Number.isSafeInteger(credentialVersion) || credentialVersion < 1) return;
    await client.query(`insert into orgward.secret_upstream_revocation_obligations
      (tenant_id,reference,credential_version,provider,status,reason,created_by,
        provider_organization_id,provider_project_id,provider_service_account_id,provider_api_key_id,target_provenance)
      values ($1,$2,$3,$4,'unconfirmed',$5,$6,$7,$8,$9,$10,$11)
      on conflict (tenant_id,reference,credential_version) do nothing`,
    [tenantId, reference, credentialVersion, provider === 'openai' ? 'openai' : 'unspecified', reason.slice(0, 500), actor,
      target?.organizationId ?? null, target?.projectId ?? null, target?.serviceAccountId ?? null, target?.apiKeyId ?? null, target?.provenance ?? null]);
  }

  async listForTenantAdmin({ tenantId, actor, actorAuthzGeneration, operation = null }) {
    if (typeof tenantId !== 'string' || !tenantId || !actor || !Number.isSafeInteger(actorAuthzGeneration)) {
      throw failure(403, 'ACTION_FORBIDDEN', 'Current tenant administrator authority is required.');
    }
    const outcome = await this.persistence.transaction(async (client) => {
      await requireTenantAdmin(client, { tenantId, actor, actorAuthzGeneration });
      const result = await client.query(`
        select reference, version, status, created_by, updated_by, updated_at, expires_at,
          upstream_revocation_status, candidate_version, candidate_model, candidate_status, candidate_validated_at,
          (status = 'active' and (expires_at is null or expires_at <= clock_timestamp())) as requires_rotation
        from orgward.secret_references
        where tenant_id = $1
        order by reference
        for share
      `, [tenantId]);
      const obligations = await client.query(`select reference,credential_version,provider,status,created_at
        from orgward.secret_upstream_revocation_obligations where tenant_id=$1 order by reference,credential_version`, [tenantId]);
      const revocationsByReference = new Map();
      for (const item of obligations.rows) {
        const list = revocationsByReference.get(item.reference) ?? [];
        list.push({ credentialVersion: item.credential_version, provider: item.provider, status: item.status, createdAt: item.created_at.toISOString() });
        revocationsByReference.set(item.reference, list);
      }
      const provisioning = await client.query(`select reference,command_id,status,candidate_version,updated_at
        from orgward.secret_openai_provisioning_commands where tenant_id=$1 order by created_at`, [tenantId]);
      const provisioningByReference = new Map();
      for (const item of provisioning.rows) {
        const list = provisioningByReference.get(item.reference) ?? [];
        list.push({ commandId: item.command_id, status: item.status, candidateVersion: item.candidate_version, updatedAt: item.updated_at.toISOString() });
        provisioningByReference.set(item.reference, list);
      }
      const references = result.rows.map((row) => ({
        reference: row.reference, version: row.version, status: row.version === 0 && row.candidate_version != null ? 'candidate' : row.status,
        createdBy: row.created_by, updatedBy: row.updated_by,
        updatedAt: row.updated_at.toISOString(),
        expiresAt: row.expires_at?.toISOString() ?? null,
        requiresRotation: row.requires_rotation,
        candidate: row.candidate_version == null ? null : { version: row.candidate_version, model: row.candidate_model, status: row.candidate_status, validatedAt: row.candidate_validated_at?.toISOString() ?? null },
        upstreamRevocationStatus: row.upstream_revocation_status,
        upstreamRevocations: revocationsByReference.get(row.reference) ?? [],
        managedProvisioning: provisioningByReference.get(row.reference) ?? [],
        encryptionAvailable: Boolean(this.encryptionKey),
      }));
      return operation ? operation(references) : references;
    });
    return outcome;
  }

  async put({ tenantId, actor, actorAuthzGeneration, reference, commandId, expectedVersion, value, reason, expiresAt }) {
    validateCommand({ tenantId, actor, actorAuthzGeneration, reference, commandId, reason });
    this.#requireEncryptionKey();
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      throw failure(400, 'INVALID_COMMAND', 'expectedVersion must be a nonnegative integer.');
    }
    if (typeof value !== 'string' || value.length < 8 || Buffer.byteLength(value, 'utf8') > 65_536) {
      throw failure(400, 'INVALID_SECRET_VALUE', 'Credential value must contain 8 to 65,536 UTF-8 bytes.');
    }
    const cleanExpiresAt = validateExpiry(expiresAt);
    const cleanReason = reason.trim();
    if (cleanReason.includes(value)) throw failure(400, 'INVALID_COMMAND', 'The audit reason cannot contain the credential value.');

    const operation = 'secret-reference.put';
    const payloadHash = this.#payloadHash(tenantId, actor, operation, { reference, expectedVersion, value, reason: cleanReason, expiresAt: cleanExpiresAt });
    const outcome = await this.persistence.transaction(async (client) => {
      await requireTenantAdmin(client, { tenantId, actor, actorAuthzGeneration });
      const prior = await this.#priorCommand(client, { tenantId, operation, commandId, payloadHash });
      if (prior) return { reference: prior, replayed: true };
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:secret-reference:${reference}`]);
      const current = await client.query(`
        select version,status,active_provider,upstream_revocation_status,active_provider_organization_id,active_provider_project_id,
          active_provider_service_account_id,active_provider_api_key_id,active_provider_target_provenance,candidate_version,candidate_provider_target_provenance
        from orgward.secret_references
        where tenant_id = $1 and reference = $2 for update
      `, [tenantId, reference]);
      const currentVersion = current.rowCount ? current.rows[0].version : 0;
      if (currentVersion !== expectedVersion) throw versionConflict(currentVersion);
      if (current.rows[0]?.candidate_provider_target_provenance) throw failure(409, 'MANAGED_CANDIDATE_PRESENT', 'A managed OpenAI candidate must be activated or handled before raw-key rotation.');
      const futureExpiry = await client.query('select $1::timestamptz > clock_timestamp() as future', [cleanExpiresAt]);
      if (!futureExpiry.rows[0].future) throw failure(400, 'INVALID_CREDENTIAL_EXPIRY', 'A future UTC credential expiry is required.');
      if (currentVersion > 0) await this.#cancelBoundLeases(client, { tenantId, reference, reason: 'credential_rotated' });
      const version = currentVersion + 1;
      const upstreamStatus = current.rows[0]?.status === 'active' || current.rows[0]?.upstream_revocation_status === 'unconfirmed' ? 'unconfirmed' : 'not_applicable';
      if (current.rows[0]?.status === 'active') await this.#recordRevocationObligation(client, {
        tenantId, reference, credentialVersion: currentVersion, provider: current.rows[0].active_provider, actor,
        target: current.rows[0].active_provider_target_provenance ? {
          organizationId: current.rows[0].active_provider_organization_id, projectId: current.rows[0].active_provider_project_id,
          serviceAccountId: current.rows[0].active_provider_service_account_id, apiKeyId: current.rows[0].active_provider_api_key_id,
          provenance: current.rows[0].active_provider_target_provenance,
        } : null,
        reason: 'Credential generation replaced in OrgWard; upstream revocation was not confirmed.',
      });
      const encrypted = seal(this.encryptionKey, tenantId, reference, version, value);
      const stored = await client.query(`
        insert into orgward.secret_references
          (tenant_id, reference, version, status, ciphertext, nonce, auth_tag, created_by, updated_by, expires_at, active_provider, active_model, upstream_revocation_status, candidate_version, candidate_ciphertext, candidate_nonce, candidate_auth_tag, candidate_model, candidate_status, candidate_validated_at, candidate_expires_at)
        values ($1, $2, $3, 'active', $4, $5, $6, $7, $7, $8, null, null, $9, null, null, null, null, null, null, null, null)
        on conflict (tenant_id, reference) do update
        set version = excluded.version, status = 'active', ciphertext = excluded.ciphertext,
          nonce = excluded.nonce, auth_tag = excluded.auth_tag, expires_at = excluded.expires_at,
          active_provider = null, active_model = null, active_provider_organization_id=null, active_provider_project_id=null,
          active_provider_service_account_id=null, active_provider_api_key_id=null, active_provider_target_provenance=null,
          upstream_revocation_status = excluded.upstream_revocation_status,
          candidate_version = null, candidate_ciphertext = null, candidate_nonce = null, candidate_auth_tag = null,
          candidate_model = null, candidate_status = null, candidate_validated_at = null, candidate_expires_at = null,
          candidate_provider_organization_id=null,candidate_provider_project_id=null,candidate_provider_service_account_id=null,
          candidate_provider_api_key_id=null,candidate_provider_target_provenance=null,
          updated_by = excluded.updated_by, updated_at = now()
        returning reference, version, status, created_by, updated_by, updated_at, expires_at
      `, [tenantId, reference, version, encrypted.ciphertext, encrypted.nonce, encrypted.authTag, actor, cleanExpiresAt, upstreamStatus]);
      const row = stored.rows[0];
      const event = {
        eventId: `secret-event-${randomUUID()}`, tenantId, reference, version,
        type: current.rowCount ? 'SecretReferenceRotated' : 'SecretReferenceCreated',
        actor, reason: cleanReason, occurredAt: row.updated_at.toISOString(),
      };
      await client.query(`
        insert into orgward.secret_reference_events
          (event_id, tenant_id, reference, version, event_type, actor, reason, event, event_hash)
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
      `, [event.eventId, tenantId, reference, version, event.type, actor, cleanReason, JSON.stringify(event), contentHash(event)]);
      const metadata = {
        reference: row.reference, version: row.version, status: row.status,
        createdBy: row.created_by, updatedBy: row.updated_by, updatedAt: row.updated_at.toISOString(),
        expiresAt: row.expires_at.toISOString(), requiresRotation: false,
        encryptionAvailable: true,
      };
      await this.#recordCommand(client, { tenantId, operation, commandId, payloadHash, result: metadata });
      return { reference: metadata, replayed: false };
    });
    if (outcome && !outcome.replayed && expectedVersion > 0) {
      try { await Promise.resolve(this.onCredentialInvalidated?.({ tenantId, reference, version: outcome.reference.version, reason: 'credential_rotated' })); } catch { /* Durable lease cancellation already committed. */ }
      this.#wakeOpenAiRevocationReconciler();
    }
    return outcome;
  }

  async revoke({ tenantId, actor, actorAuthzGeneration, reference, commandId, expectedVersion, reason }) {
    validateCommand({ tenantId, actor, actorAuthzGeneration, reference, commandId, reason });
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw failure(400, 'INVALID_COMMAND', 'expectedVersion must be a positive integer.');
    }
    const cleanReason = reason.trim();
    const operation = 'secret-reference.revoke';
    const payloadHash = this.#payloadHash(tenantId, actor, operation, { reference, expectedVersion, reason: cleanReason });
    const outcome = await this.persistence.transaction(async (client) => {
      await requireTenantAdmin(client, { tenantId, actor, actorAuthzGeneration });
      const prior = await this.#priorCommand(client, { tenantId, operation, commandId, payloadHash });
      if (prior) return { reference: prior, replayed: true };
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:secret-reference:${reference}`]);
      const current = await client.query(`
        select version, status, active_provider, ciphertext, nonce, auth_tag,
          active_provider_organization_id,active_provider_project_id,active_provider_service_account_id,active_provider_api_key_id,active_provider_target_provenance,
          candidate_version, candidate_ciphertext, candidate_nonce, candidate_auth_tag, candidate_status,
          candidate_provider_target_provenance
        from orgward.secret_references
        where tenant_id = $1 and reference = $2 for update
      `, [tenantId, reference]);
      if (!current.rowCount) return null;
      if (current.rows[0].version !== expectedVersion) throw versionConflict(current.rows[0].version);
      if (current.rows[0].candidate_provider_target_provenance) {
        throw failure(409, 'MANAGED_CANDIDATE_PRESENT', 'A managed OpenAI candidate cannot be discarded until its provider target can be retained for confirmed revocation.');
      }
      if (current.rows[0].status === 'revoked') {
        const metadata = { reference, version: current.rows[0].version, status: 'revoked', encryptionAvailable: Boolean(this.encryptionKey) };
        await this.#recordCommand(client, { tenantId, operation, commandId, payloadHash, result: metadata });
        return { reference: metadata, replayed: false };
      }
      const auditReason = this.#sanitizeRevocationReason({ tenantId, reference, row: current.rows[0], reason: cleanReason });
      const version = current.rows[0].version + 1;
      if (current.rows[0].candidate_version != null) await client.query(`update orgward.secret_openai_provisioning_commands
        set status='candidate_abandoned',updated_at=now()
        where tenant_id=$1 and reference=$2 and candidate_version=$3 and status='candidate_staged'`, [tenantId, reference, current.rows[0].candidate_version]);
      if (current.rows[0].status === 'active') await this.#recordRevocationObligation(client, {
        tenantId, reference, credentialVersion: current.rows[0].version, provider: current.rows[0].active_provider, actor,
        target: current.rows[0].active_provider_target_provenance ? {
          organizationId: current.rows[0].active_provider_organization_id, projectId: current.rows[0].active_provider_project_id,
          serviceAccountId: current.rows[0].active_provider_service_account_id, apiKeyId: current.rows[0].active_provider_api_key_id,
          provenance: current.rows[0].active_provider_target_provenance,
        } : null,
        reason: 'Credential revoked in OrgWard; upstream revocation was not confirmed.',
      });
      await this.#cancelBoundLeases(client, { tenantId, reference, reason: 'credential_revoked' });
      const updated = await client.query(`
        update orgward.secret_references
        set version = $4, status = 'revoked', ciphertext = null, nonce = null, auth_tag = null,
          active_provider = null, active_model = null,
          active_provider_organization_id=null,active_provider_project_id=null,active_provider_service_account_id=null,
          active_provider_api_key_id=null,active_provider_target_provenance=null,
          upstream_revocation_status = 'unconfirmed',
          candidate_version = null, candidate_ciphertext = null, candidate_nonce = null, candidate_auth_tag = null,
          candidate_model = null, candidate_status = null, candidate_validated_at = null, candidate_expires_at = null,
          candidate_provider_organization_id=null,candidate_provider_project_id=null,candidate_provider_service_account_id=null,
          candidate_provider_api_key_id=null,candidate_provider_target_provenance=null,
          updated_by = $3, updated_at = now()
        where tenant_id = $1 and reference = $2
        returning updated_at
      `, [tenantId, reference, actor, version]);
      const event = {
        eventId: `secret-event-${randomUUID()}`, tenantId, reference, version,
        type: 'SecretReferenceRevoked', actor, reason: auditReason,
        occurredAt: updated.rows[0].updated_at.toISOString(),
      };
      await client.query(`
        insert into orgward.secret_reference_events
          (event_id, tenant_id, reference, version, event_type, actor, reason, event, event_hash)
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
      `, [event.eventId, tenantId, reference, version, event.type, actor, auditReason, JSON.stringify(event), contentHash(event)]);
      const metadata = { reference, version, status: 'revoked', encryptionAvailable: Boolean(this.encryptionKey) };
      await this.#recordCommand(client, { tenantId, operation, commandId, payloadHash, result: metadata });
      return { reference: metadata, replayed: false };
    });
    if (outcome && !outcome.replayed && outcome.reference?.status === 'revoked') {
      try { await Promise.resolve(this.onCredentialInvalidated?.({ tenantId, reference, version: outcome.reference.version, reason: 'credential_revoked' })); } catch { /* Durable lease cancellation already committed. */ }
      this.#wakeOpenAiRevocationReconciler();
    }
    return outcome;
  }

  // Provider callbacks are server-side only. Authorization comes from persisted
  // PostgreSQL state; a callback supplied by the caller cannot assert a lease.
  async useForAuthorizedLease({ tenantId, reference, expectedVersion, runId, projectId, principal, workerId, authzGeneration, signal, operation }) {
    if (!this.encryptionKey) throw failure(503, 'SECRET_ENCRYPTION_UNAVAILABLE', 'Provider credentials are unavailable.');
    if (typeof tenantId !== 'string' || !tenantId || typeof operation !== 'function') {
      throw failure(403, 'BROKER_AUTHORITY_REQUIRED', 'An authorized worker lease is required.');
    }
    if (!/^secret-[a-z0-9][a-z0-9._-]{0,79}$/.test(reference ?? '') || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw failure(400, 'INVALID_SECRET_BINDING', 'The approved credential reference and version are invalid.');
    }
    const attemptId = randomUUID();
    const reservation = await this.persistence.transaction(async (client) => {
      const row = await this.#authorizeLease(client, { tenantId, reference, expectedVersion, runId, projectId, principal, workerId, authzGeneration });
      const inserted = await client.query(`insert into orgward.provider_dispatch_attempts
        (tenant_id,run_id,project_id,principal,worker_id,attempt_id,credential_reference,credential_version,status)
        values ($1,$2,$3,$4,$5,$6,$7,$8,'reserved')
        on conflict (tenant_id,run_id) do nothing returning attempt_id`,
      [tenantId, runId, projectId, principal, workerId, attemptId, reference, expectedVersion]);
      if (!inserted.rowCount) throw failure(409, 'PROVIDER_ATTEMPT_EXISTS', 'This run already has a provider dispatch attempt. Create and approve a new run before retrying.');
      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, row.nonce);
      decipher.setAAD(associatedData(tenantId, reference, row.version));
      decipher.setAuthTag(row.auth_tag);
      return { credential: Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString('utf8'), expiresAt: row.expires_at };
    });
    await this.persistence.faults?.afterProviderDispatchReservation?.({ tenantId, runId, attemptId });
    const expiryMs = new Date(reservation.expiresAt).getTime();
    const controller = new AbortController();
    const relayAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) relayAbort();
    else signal?.addEventListener('abort', relayAbort, { once: true });
    let expiryTimer;
    const armExpiryTimer = () => {
      const remaining = expiryMs - Date.now();
      if (remaining <= 0) { controller.abort(); return; }
      expiryTimer = setTimeout(armExpiryTimer, Math.min(remaining, 2_147_000_000));
      expiryTimer.unref?.();
    };
    armExpiryTimer();
    let transport = null;
    let output;
    let transportStarted = false;
    try {
      if (Date.now() >= expiryMs) throw failure(409, 'SECRET_CREDENTIAL_EXPIRED', 'The approved credential has expired.');
      await this.persistence.transaction(async (client) => {
        const row = await this.#authorizeLease(client, { tenantId, reference, expectedVersion, runId, projectId, principal, workerId, authzGeneration });
        const attempt = await client.query(`select status from orgward.provider_dispatch_attempts
          where tenant_id=$1 and run_id=$2 and attempt_id=$3 for update`, [tenantId, runId, attemptId]);
        if (!attempt.rowCount || attempt.rows[0].status !== 'reserved') {
          throw failure(409, 'PROVIDER_ATTEMPT_CANCELLED', 'The provider dispatch reservation is no longer available.');
        }
        const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, row.nonce);
        decipher.setAAD(associatedData(tenantId, reference, row.version));
        decipher.setAuthTag(row.auth_tag);
        const credential = Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString('utf8');
        transport = operation(Object.freeze({ credential, reference, version: expectedVersion, signal: controller.signal }));
        if (!transport || typeof transport.abort !== 'function' || typeof transport.send !== 'function' || !transport.result
          || typeof transport.result.then !== 'function') {
          throw failure(503, 'PROVIDER_TRANSPORT_UNAVAILABLE', 'Provider dispatch requires a deferred, handoff-aware transport.');
        }
        const handedOff = await client.query(`update orgward.provider_dispatch_attempts
          set status='handed_off',handed_off_at=now(),updated_at=now()
          where tenant_id=$1 and run_id=$2 and attempt_id=$3 and status='reserved' returning attempt_id`, [tenantId, runId, attemptId]);
        if (!handedOff.rowCount) throw failure(409, 'PROVIDER_ATTEMPT_CANCELLED', 'The provider dispatch reservation is no longer available.');
      });
      transportStarted = true;
      transport.result.catch(() => {});
      await this.persistence.faults?.afterProviderDispatchHandoff?.({ tenantId, runId, attemptId });
      transport.send();
      output = await transport.result;
      if (Date.now() >= expiryMs) throw failure(409, 'SECRET_CREDENTIAL_EXPIRED', 'The approved credential expired during provider use.');
      if (containsSecret(output, reservation.credential)) throw failure(502, 'PROVIDER_OUTPUT_QUARANTINED', 'Provider output was quarantined by secret-leak detection.');
      await this.persistence.transaction(async (client) => {
        await this.#authorizeLease(client, { tenantId, reference, expectedVersion, runId, projectId, principal, workerId, authzGeneration, allowPauseRequested: true });
        await client.query(`update orgward.provider_dispatch_attempts
          set status='completed',finished_at=now(),updated_at=now()
          where tenant_id=$1 and run_id=$2 and attempt_id=$3 and status='handed_off'`, [tenantId, runId, attemptId]);
      });
    } catch (error) {
      transport?.abort?.();
      await this.persistence.transaction(async (client) => {
        await client.query(`select 1 from orgward.execution_worker_leases
          where tenant_id=$1 and run_id=$2 and worker_id=$3 for update`, [tenantId, runId, workerId]);
        if (transportStarted) {
          await client.query(`update orgward.provider_dispatch_attempts
            set status='outcome_unknown',handed_off_at=coalesce(handed_off_at,now()),finished_at=now(),updated_at=now()
            where tenant_id=$1 and run_id=$2 and attempt_id=$3 and status in ('reserved','handed_off','cancelled')`, [tenantId, runId, attemptId]);
        } else {
          await client.query(`update orgward.provider_dispatch_attempts
            set status='cancelled',finished_at=now(),updated_at=now()
            where tenant_id=$1 and run_id=$2 and attempt_id=$3 and status='reserved'`, [tenantId, runId, attemptId]);
        }
      }).catch(() => {});
      if (Date.now() >= expiryMs) throw failure(409, 'SECRET_CREDENTIAL_EXPIRED', 'The approved credential expired during provider use.');
      if (['PROVIDER_OUTPUT_QUARANTINED', 'SECRET_CREDENTIAL_EXPIRED'].includes(error?.code)) throw error;
      if (['PROVIDER_ATTEMPT_CANCELLED', 'PROCESS_INSTANCE_PAUSED', 'WORKER_LEASE_INVALID', 'SECRET_REFERENCE_INACTIVE', 'SECRET_CREDENTIAL_EXPIRED', 'SECRET_GENERATION_STALE', 'SECRET_BINDING_STALE'].includes(error?.code)) throw error;
      throw Object.assign(new Error('The authorized provider operation failed.'), {
        statusCode: 502, code: 'PROVIDER_OUTCOME_UNKNOWN', retryable: false,
      });
    } finally {
      clearTimeout(expiryTimer);
      signal?.removeEventListener('abort', relayAbort);
      // Best effort zeroing of the mutable buffer is not possible after the
      // string has entered the provider callback; minimize its lifetime here.
    }
    return output;
  }

}

function containsSecret(value, secret) {
  if (typeof value === 'string') return value.includes(secret);
  if (Buffer.isBuffer(value)) return value.includes(Buffer.from(secret));
  if (Array.isArray(value)) return value.some((entry) => containsSecret(entry, secret));
  if (value && typeof value === 'object') return Object.values(value).some((entry) => containsSecret(entry, secret));
  return false;
}
