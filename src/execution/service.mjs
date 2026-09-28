import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { digest } from '../sdlc/contracts.mjs';
import { CommandExecutionAdapter } from '../sdlc/execution-adapter.mjs';
import { captureLocalRepositorySnapshot, localRepositoryDiff, materializeLocalRepositorySnapshot } from './local-repository-snapshot.mjs';
import { captureGitRepositorySnapshot } from './git-repository-snapshot.mjs';
import { readWorkspaceArtifact } from './artifact-file.mjs';
import { linkedRunOutcomeCategory } from './linked-run-outcome-category.mjs';
import { allowlistedProviderTransportFailureClass, classifyProviderTransportFailure } from './provider-transport-diagnostic.mjs';
import { buildProcessTaskProposalPromptForRun, createGeneratedBlueprintProposal, createProcessTaskGuidanceSnapshot,
  createProcessTaskProposalContext } from './proposals.mjs';
import {
  approveExecutionRun,
  createExecutionRun,
  executionApprovalRequestHash,
  executionEvent,
  executionRunView,
} from './contracts.mjs';
import { ExecutionRunStore } from './store.mjs';

const WORKER_LEASE_MS = 5_000;
const PROVIDER_WORKER_LEASE_MS = 30_000;
const isModelProvider = (profile) => Boolean(profile?.dynamicOpenAi || profile?.dynamicDeepSeek);
const resolveModelCredentialBinding = (secretStore, profile, options) => profile.dynamicOpenAi
  ? secretStore.resolveOpenAiBinding({ ...options, reference: profile.credentialReference, model: profile.model })
  : secretStore.resolveGenericCredentialBinding({ ...options, reference: profile.credentialReference });
const WORKER_HEARTBEAT_MS = 1_000;
const PROVIDER_LEASE_RENEWAL_MS = 15_000;
const DISPATCH_ACK_WATCHDOG_MS = WORKER_LEASE_MS - WORKER_HEARTBEAT_MS;

export function waitForProviderSocketConnection(socket, protocol, onConnected) {
  if (protocol === 'https:') {
    if (socket.encrypted === true && socket.secureConnecting === false) onConnected();
    else socket.once('secureConnect', onConnected);
    return;
  }
  if (!socket.connecting) onConnected();
  else socket.once('connect', onConnected);
}

function providerTransport(endpoint, { headers, body, signal, parseResponse }) {
  const target = new URL(endpoint);
  const client = target.protocol === 'https:' ? https : http;
  const request = client.request(target, { method: 'POST', headers, agent: false });
  let sent = false;
  let diagnostic = null;
  const result = new Promise((resolve, reject) => {
    request.once('response', async (response) => {
      try {
        const upstreamHttpStatus = Number.isInteger(response.statusCode) && response.statusCode >= 100 && response.statusCode <= 599
          ? response.statusCode : null;
        diagnostic = upstreamHttpStatus === null ? null : { httpStatus: upstreamHttpStatus };
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = new Error('provider rejected request');
          if (upstreamHttpStatus) error.upstreamHttpStatus = upstreamHttpStatus;
          throw error;
        }
        const chunks = []; let size = 0;
        for await (const chunk of response) {
          size += chunk.length;
          if (size > 32_768) {
            response.destroy();
            throw Object.assign(new Error('provider response too large'), { parserFailureClass: 'body_too_large' });
          }
          chunks.push(chunk);
        }
        let parsed;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { throw Object.assign(new Error('invalid provider JSON'), { parserFailureClass: 'invalid_json' }); }
        let output;
        try { output = parseResponse(parsed); }
        catch (error) {
          if (error?.parserFailureClass) throw error;
          throw Object.assign(new Error('invalid provider response shape'), { parserFailureClass: 'incomplete_response' });
        }
        if (typeof output !== 'string' || !output.trim()) {
          throw Object.assign(new Error('missing provider output text'), { parserFailureClass: 'missing_output_text' });
        }
        if (Buffer.byteLength(output) > 8_000) {
          throw Object.assign(new Error('provider result too large'), { parserFailureClass: 'output_too_large' });
        }
        resolve(output);
      } catch (error) {
        if (Number.isInteger(response.statusCode) && response.statusCode >= 100 && response.statusCode <= 599) {
          error.upstreamHttpStatus = response.statusCode;
          const parserFailureClass = ['invalid_json', 'body_too_large', 'incomplete_response', 'missing_output_text', 'output_too_large'].includes(error?.parserFailureClass)
            ? error.parserFailureClass : null;
          diagnostic = { httpStatus: response.statusCode, ...(parserFailureClass ? { parserFailureClass } : {}) };
        }
        reject(error);
      }
    });
    request.once('error', (error) => {
      if (!diagnostic) {
        const transportFailureClass = classifyProviderTransportFailure(error);
        if (transportFailureClass) diagnostic = { transportFailureClass };
      }
      reject(error);
    });
  });
  const onAbort = () => request.destroy(new Error('provider request aborted'));
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  request.once('close', () => signal?.removeEventListener('abort', onAbort));
  return {
    send() {
      if (sent) throw new Error('provider request already sent');
      sent = true;
      request.end(body);
    },
    result,
    diagnostic: () => diagnostic,
    abort: () => request.destroy(new Error('provider request aborted')),
  };
}

function principalScopeUnavailable() {
  return Object.assign(new Error('The execution store cannot enforce principal-scoped access.'), {
    statusCode: 503,
    code: 'PROJECT_AUTHORIZATION_UNAVAILABLE',
    retryable: false,
    recoveryAction: 'Restore a store implementation with principal-scoped execution access.',
  });
}

function executionFenceUnavailable() {
  return Object.assign(new Error('The execution store cannot maintain authorization fencing for the worker lifetime.'), {
    statusCode: 503,
    code: 'DISPATCH_FENCE_UNAVAILABLE',
    retryable: false,
    recoveryAction: 'Restore a store implementation with atomic dispatch authorization and renewable worker leases.',
  });
}

function validateProfile(profile) {
  if (!/^[a-z0-9][a-z0-9_-]{1,79}$/i.test(profile.id ?? '')) throw new Error('Execution profile id is invalid.');
  const provider = profile.kind === 'provider-http';
  const openAiProvider = profile.kind === 'provider-openai';
  const deepSeekProvider = profile.kind === 'provider-deepseek';
  const modelProvider = openAiProvider || deepSeekProvider;
  const deepSeekMaxOutputTokens = profile.deepSeekMaxOutputTokens ?? 256;
  if (deepSeekProvider && (!Number.isSafeInteger(deepSeekMaxOutputTokens) || deepSeekMaxOutputTokens < 64 || deepSeekMaxOutputTokens > 512)) {
    throw new Error(`Execution profile ${profile.id} must cap DeepSeek output between 64 and 512 tokens.`);
  }
  if (!provider && !modelProvider && (!path.isAbsolute(profile.executable ?? '') || !path.isAbsolute(profile.workspaceRoot ?? ''))) throw new Error(`Execution profile ${profile.id} must use an absolute executable and workspace root.`);
  let providerEndpoint = null;
  if (provider || modelProvider) {
    if (modelProvider) {
      if (profile.executable != null || (profile.args?.length ?? 0) || profile.workspaceRoot != null
        || Object.keys(profile.environment ?? {}).length || !/^secret-[a-z0-9][a-z0-9._-]{0,79}$/.test(profile.credentialReference ?? '')
        || !/^[A-Za-z0-9._:-]{1,100}$/.test(profile.model ?? '')) throw new Error(`Execution profile ${profile.id} has invalid model provider configuration.`);
      let endpoint;
      const defaultEndpoint = openAiProvider ? 'https://api.openai.com/v1/responses' : 'https://api.deepseek.com/responses';
      const configuredEndpoint = openAiProvider ? profile.openAiEndpoint : profile.deepSeekEndpoint;
      try { endpoint = new URL(configuredEndpoint ?? defaultEndpoint); } catch { throw new Error(`Execution profile ${profile.id} has invalid model provider endpoint configuration.`); }
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
      const expectedPath = openAiProvider ? '/v1/responses' : '/responses';
      if ((endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback)) || endpoint.username || endpoint.password
        || endpoint.search || endpoint.hash || endpoint.pathname !== expectedPath
        || (!loopback && endpoint.hostname !== (openAiProvider ? 'api.openai.com' : 'api.deepseek.com'))) {
        throw new Error(`Execution profile ${profile.id} must use ${openAiProvider ? 'api.openai.com' : 'api.deepseek.com'} (loopback is test-only).`);
      }
      providerEndpoint = endpoint.href;
    } else {
    if (profile.executable != null || (profile.args?.length ?? 0) || profile.workspaceRoot != null
      || Object.keys(profile.environment ?? {}).length || (profile.method != null && profile.method !== 'POST')) {
      throw new Error(`Execution profile ${profile.id} cannot combine provider HTTP execution with command-worker options.`);
    }
    let parsed;
    try { parsed = new URL(profile.providerEndpoint); } catch { throw new Error(`Execution profile ${profile.id} has an invalid provider endpoint.`); }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) || parsed.username || parsed.password
      || parsed.hash || parsed.search || parsed.pathname !== '/v1/execute') {
      throw new Error(`Execution profile ${profile.id} must use a fixed HTTPS /v1/execute endpoint (loopback HTTP is allowed for fixtures).`);
    }
    providerEndpoint = parsed.href;
    if (!profile.credentialReference) throw new Error(`Execution profile ${profile.id} requires a provider credential binding.`);
    }
  }
  if (!modelProvider && (((profile.credentialReference == null) !== (profile.credentialVersion == null))
    || (profile.credentialReference != null && (!/^secret-[a-z0-9][a-z0-9._-]{0,79}$/.test(profile.credentialReference) || !Number.isSafeInteger(profile.credentialVersion) || profile.credentialVersion < 1)))) {
    throw new Error(`Execution profile ${profile.id} has an invalid approved credential binding.`);
  }
  return {
    id: profile.id, label: String(profile.label ?? profile.id), description: String(profile.description ?? ''),
    kind: String(profile.kind ?? 'command'), version: String(profile.version ?? '1.0.0'), executable: profile.executable,
    args: [...(profile.args ?? [])], workspaceRoot: profile.workspaceRoot ? path.resolve(profile.workspaceRoot) : null,
    timeoutMs: profile.timeoutMs ?? (provider || modelProvider ? 20_000 : 120_000),
    environment: { ...(profile.environment ?? {}) },
    credentialReference: profile.credentialReference ?? null,
    credentialVersion: profile.credentialVersion ?? null,
    providerEndpoint,
    dynamicOpenAi: openAiProvider,
    dynamicDeepSeek: deepSeekProvider,
    model: modelProvider ? profile.model : null,
    maxOutputTokens: deepSeekProvider ? deepSeekMaxOutputTokens : (openAiProvider ? 2_000 : null),
    managedCatalogRevision: Number.isSafeInteger(profile.managedCatalogRevision) ? profile.managedCatalogRevision : null,
    sandbox: {
      executable: profile.sandbox?.executable ?? '/usr/bin/bwrap',
      readOnlyFiles: [...(profile.sandbox?.readOnlyFiles ?? [])],
      allowedEnvironment: [...(profile.sandbox?.allowedEnvironment ?? [])],
    },
  };
}

function publicProfile(profile) {
  return { id: profile.id, label: profile.label, description: profile.description, kind: profile.kind, version: profile.version,
    ...(Number.isSafeInteger(profile.managedCatalogRevision) ? { catalogRevision: profile.managedCatalogRevision } : {}), approvalRequired: true };
}

function tenantDeepSeekProfileConfig(record) {
  return {
    id: record.id, label: record.label, kind: 'provider-deepseek', version: `tenant-deepseek-r${record.revision}`,
    credentialReference: record.credentialReference, model: record.model,
    deepSeekMaxOutputTokens: record.maxOutputTokens, managedCatalogRevision: record.revision,
  };
}

function redact(value) {
  return String(value ?? '').replace(/(bearer\s+)[a-z0-9._~+\/-]+/gi, '$1[REDACTED]').replace(/(api[_-]?key|token|secret|password)\s*[=:]\s*\S+/gi, '$1=[REDACTED]');
}

export class ExecutionService {
  constructor({ runDirectory, store = null, profiles = [], secretStore = null, localRepositories = [], commandAdapterFactory = (options) => new CommandExecutionAdapter(options) }) {
    this.store = store ?? new ExecutionRunStore(runDirectory);
    this.secretStore = secretStore;
    this.commandAdapterFactory = commandAdapterFactory;
    this.localRepositories = new Map();
    for (const repository of localRepositories) {
      const isGit = repository.kind === 'git';
      if (!/^[a-z0-9][a-z0-9_-]{1,79}$/i.test(repository.id ?? '')
        || !/^[a-z0-9][a-z0-9_-]{1,79}$/i.test(repository.tenantId ?? '')
        || !/^project-[0-9a-f-]{36}$/i.test(repository.projectId ?? '')
        || (isGit
          ? (!/^[a-z0-9][a-z0-9._-]{0,119}$/i.test(repository.identity ?? '')
            || typeof repository.gitDirectory !== 'string' || !path.isAbsolute(repository.gitDirectory)
            || !Array.isArray(repository.allowedRefs) || !repository.allowedRefs.length || repository.allowedRefs.length > 8
            || repository.allowedRefs.some((entry) => !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(entry.id ?? '')
              || typeof entry.ref !== 'string' || !entry.ref.startsWith('refs/heads/')
              || (entry.label !== undefined && (typeof entry.label !== 'string' || entry.label.length > 120))))
          : (typeof repository.directory !== 'string' || !path.isAbsolute(repository.directory)))
        || !repository.verification || !/^[a-z0-9][a-z0-9_-]{1,79}$/i.test(repository.verification.id ?? '')
        || !path.isAbsolute(repository.verification.executable ?? '')
        || !Array.isArray(repository.verification.args) || repository.verification.args.some((arg) => typeof arg !== 'string')) {
        throw new Error('A configured local repository or verification command has invalid server-side configuration.');
      }
      const key = `${repository.tenantId}\n${repository.projectId}\n${repository.id}`;
      if (this.localRepositories.has(key)) throw new Error('Configured local repository IDs must be unique within a project.');
      if (isGit && new Set(repository.allowedRefs.map((entry) => entry.id)).size !== repository.allowedRefs.length) {
        throw new Error('Configured Git repository ref IDs must be unique.');
      }
      this.localRepositories.set(key, structuredClone(repository));
    }
    if (this.secretStore) this.secretStore.onCredentialInvalidated = (change) => this.cancelCredentialReference(change);
    this.profiles = new Map(profiles.map((profile) => { const valid = validateProfile(profile); return [valid.id, valid]; }));
    this.active = new Map();
    this.recoveryTimer = null;
  }
  async init({ recoverRunning = true } = {}) {
    await this.store.init();
    if (!recoverRunning) return;
    const recover = async (run) => {
      if (run.status !== 'RUNNING') return false;
      // A RUNNING aggregate can briefly precede its worker lease while this
      // process is still authorizing dispatch. Keep startup owned by this
      // process; after authorization, normal lease-expiry recovery applies.
      if (this.active.get(run.id)?.dispatchAuthorizationPending) return false;
      const persistedVersion = run.version;
      run.status = 'INTERRUPTED'; run.version += 1;
      const category = linkedRunOutcomeCategory(run, { status: 'INTERRUPTED', reason: 'control_plane_restarted' });
      if (category) run.linkedOutcomeCategory = category;
      executionEvent(run, 'ExecutionInterrupted', 'execution-recovery', { reason: 'Control plane restarted while the run was active.' });
      if (!this.store.recoverRunning) await this.store.save(run, { expectedVersion: persistedVersion });
      return true;
    };
    if (typeof this.store.recoverRunning === 'function') {
      await this.store.recoverRunning(recover);
      this.recoveryTimer = setInterval(() => {
        void this.store.recoverRunning(recover).catch(() => {});
      }, WORKER_HEARTBEAT_MS);
      this.recoveryTimer.unref?.();
      return;
    }
    for (const run of await this.store.all()) {
      await recover(run);
    }
  }
  capabilities() { return [...this.profiles.values()].map(publicProfile); }
  async capabilitiesForPrincipal({ tenantId, principal, authzGeneration }) {
    if (typeof this.store.listTenantDeepSeekProfiles !== 'function') return this.capabilities();
    const managed = await this.store.listTenantDeepSeekProfiles({ tenantId, principal, authzGeneration });
    return [...this.profiles.values(), ...managed.filter((profile) => profile.enabled)
      .map((profile) => validateProfile(tenantDeepSeekProfileConfig(profile)))].map(publicProfile);
  }
  async tenantDeepSeekProfiles({ tenantId, principal, authzGeneration }) {
    if (typeof this.store.listTenantDeepSeekProfiles !== 'function') throw Object.assign(new Error('Tenant DeepSeek profile management requires PostgreSQL storage.'), {
      statusCode: 503, code: 'EXECUTION_PROFILE_CATALOG_UNAVAILABLE', retryable: false,
    });
    return this.store.listTenantDeepSeekProfiles({ tenantId, principal, authzGeneration, tenantAdminOnly: true });
  }
  async saveTenantDeepSeekProfile(input) {
    if (typeof this.store.saveTenantDeepSeekProfile !== 'function' || !this.secretStore) {
      throw Object.assign(new Error('Tenant DeepSeek profiles require PostgreSQL and the encrypted credential broker.'), {
        statusCode: 503, code: 'EXECUTION_PROFILE_CATALOG_UNAVAILABLE', retryable: false,
      });
    }
    return this.store.saveTenantDeepSeekProfile({ ...input, validateCredential: ({ client, tenantId, reference }) =>
      this.secretStore.resolveGenericCredentialBinding({ client, tenantId, reference }),
    assertProfileIdAvailable: ({ profileId }) => {
      if (this.profiles.has(profileId)) throw Object.assign(new Error('This profile ID is reserved by an installation profile.'), {
        statusCode: 409, code: 'EXECUTION_PROFILE_ID_RESERVED', retryable: false,
      });
    } });
  }
  async #profileForRun(run, tenantId, client = null) {
    if (!run?.profile?.id) return null;
    const configured = this.profiles.get(run.profile.id);
    if (configured) return configured;
    if (!/^tenant-deepseek-r[1-9][0-9]*$/.test(run.profile.version ?? '')
      || typeof this.store.getTenantDeepSeekProfile !== 'function') return null;
    const profile = await this.store.getTenantDeepSeekProfile({ client, tenantId, profileId: run.profile.id });
    if (!profile?.enabled || run.profile.version !== `tenant-deepseek-r${profile.revision}`) return null;
    return validateProfile(tenantDeepSeekProfileConfig(profile));
  }
  async #validateCurrentProviderProfile(run, tenantId, client) {
    const stale = () => Object.assign(new Error('The pinned model profile or credential is no longer current. Create a new request against the current profile and credential.'), {
      statusCode: 409, code: 'EXECUTION_PROFILE_STALE', retryable: false,
    });
    const profile = await this.#profileForRun(run, tenantId, client);
    if (!profile || !isModelProvider(profile) || profile.kind !== run.profile?.kind
      || profile.version !== run.profile?.version
      || (profile.providerEndpoint ? digest(profile.providerEndpoint) : null) !== (run.profile?.providerDestinationHash ?? null)
      || profile.model !== run.profile?.providerModel
      || (profile.dynamicDeepSeek && profile.maxOutputTokens !== run.profile?.providerMaxOutputTokens)
      || !run.profile?.credential || run.profile.credential.reference !== profile.credentialReference
      || !this.secretStore || !client) throw stale();
    let binding;
    try { binding = await resolveModelCredentialBinding(this.secretStore, profile, { client, tenantId }); }
    catch { throw stale(); }
    if (binding.version !== run.profile.credential.version) throw stale();
    return profile;
  }
  async #saveRun(run, { expectedVersion = null, principal = null, requiredPrincipalRoles = null, authzGeneration = null, validateCurrent = null } = {}) {
    if (principal) {
      if (typeof this.store.saveForPrincipal !== 'function') throw principalScopeUnavailable();
      return this.store.saveForPrincipal(run, { expectedVersion, principal, requiredPrincipalRoles, authzGeneration, validateCurrent });
    }
    return this.store.save(run, { expectedVersion, validateCurrent });
  }
  async cancelPrincipal({ tenantId, principal, projectId = null, reason = 'authorization_revoked' }) {
    const active = [...this.active.values()].filter((entry) => entry.tenantId === tenantId
      && (entry.principal === principal || entry.approvalPrincipal === principal)
      && (!projectId || entry.projectId === projectId));
    await Promise.all(active.map(async (entry) => {
      entry.cancelReason = reason;
      entry.controller.abort();
      if (!entry.handle) return;
      entry.handle.terminate();
      await entry.handle.result.catch(() => {});
    }));
    return active.length;
  }
  async cancelCredentialReference({ tenantId, reference, reason = 'credential_generation_changed' }) {
    const active = [...this.active.values()].filter((entry) => entry.tenantId === tenantId
      && entry.run?.profile?.credential?.reference === reference);
    await Promise.all(active.map(async (entry) => {
      entry.cancelReason = reason;
      entry.controller.abort();
      entry.handle?.terminate();
      if (entry.handle) await entry.handle.result.catch(() => {});
    }));
    return active.length;
  }
  async shutdown() {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    const active = [...this.active.values()];
    for (const entry of active) {
      entry.cancelReason ??= 'control_plane_shutdown';
      entry.controller.abort();
      entry.handle?.terminate();
    }
    await Promise.all(active.map((entry) => entry.done));
    return active.length;
  }
  async list(tenantId, principal = null, { authzGeneration = null, onRuns = null } = {}) {
    const readAndDeliver = async (result) => {
      const runs = result.records ?? result;
      const views = runs.map(executionRunView);
      await onRuns?.(views);
      return views;
    };
    if (principal) {
      if (typeof this.store.listWithPrincipalAuthority !== 'function') throw principalScopeUnavailable();
      return this.store.listWithPrincipalAuthority({
        tenantId, principal, anyPrincipalRoleGroups: [['workspace-read', 'workspace-write', 'tenant-admin']],
        authzGeneration, operation: readAndDeliver,
      });
    }
    const runs = await this.store.list(tenantId);
    return readAndDeliver(runs);
  }
  async listWithDiagnostics(tenantId, principal = null) {
    if (principal) throw principalScopeUnavailable();
    const result = await this.store.listWithDiagnostics(tenantId);
    return { records: result.records.map(executionRunView), corruptRecords: result.corruptRecords };
  }
  async get(id, tenantId, principal = null, { authzGeneration = null, onRun = null } = {}) {
    const readAndDeliver = async (run) => {
      if (!run || run.tenantId !== tenantId) return null;
      const view = executionRunView(run);
      await onRun?.(view);
      return view;
    };
    if (principal) {
      if (typeof this.store.withPrincipalAuthority === 'function') {
        return this.store.withPrincipalAuthority({
          id, tenantId, principal, anyPrincipalRoleGroups: [['workspace-read', 'workspace-write', 'tenant-admin']],
          authzGeneration, operation: readAndDeliver,
        });
      }
      throw principalScopeUnavailable();
    }
    return readAndDeliver(await this.store.get(id, tenantId));
  }
  async readArtifact(id, tenantId, principal, relativePath, { authzGeneration = null, onArtifact = null } = {}) {
    if (!/^execution-run-[0-9a-f-]{36}$/.test(id ?? '')
      || typeof relativePath !== 'string' || relativePath.length > 500
      || !relativePath || relativePath.includes('\\') || relativePath.includes('\0')) return null;
    const segments = relativePath.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
    const readAndDeliver = async (run) => {
      if (!run || run.tenantId !== tenantId || !Array.isArray(run.execution?.changedArtifacts)) return null;
      const record = run.execution.changedArtifacts.find((entry) => entry.path === relativePath);
      const profile = this.profiles.get(run.profile?.id);
      if (!record || !/^[a-f0-9]{64}$/.test(record.contentHash ?? '') || !profile) return null;
      const configuredRoot = path.resolve(profile.workspaceRoot);
      const workspace = path.resolve(configuredRoot, run.id);
      if (path.dirname(workspace) !== configuredRoot) return null;
      const contents = await readWorkspaceArtifact({
        configuredRoot, runId: run.id, segments, expectedHash: record.contentHash, hashAlgorithm: record.hashAlgorithm,
      });
      if (!contents) return null;
      const artifact = { contents, fileName: path.posix.basename(relativePath), contentHash: createHash('sha256').update(contents).digest('hex') };
      await onArtifact?.(artifact);
      return artifact;
    };
    if (principal) {
      if (typeof this.store.withPrincipalAuthority !== 'function') throw principalScopeUnavailable();
      return this.store.withPrincipalAuthority({
        id, tenantId, principal, anyPrincipalRoleGroups: [['workspace-read', 'workspace-write', 'tenant-admin']],
        authzGeneration, operation: readAndDeliver,
      });
    }
    const run = await this.store.get(id, tenantId);
    return readAndDeliver(run);
  }
  async readRepositorySource(id, tenantId, principal, relativePath, { authzGeneration = null, onArtifact = null } = {}) {
    if (!/^execution-run-[0-9a-f-]{36}$/.test(id ?? '') || typeof relativePath !== 'string'
      || relativePath.length > 500 || relativePath.includes('\\') || relativePath.includes('\0')
      || relativePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')) return null;
    const readAndDeliver = async (run) => {
      if (!run || run.tenantId !== tenantId || !run.processTaskRef?.repository
        || run.repositorySnapshot?.treeDigest !== run.processTaskRef.repository.treeDigest) return null;
      const record = run.repositorySnapshot.files.find((entry) => entry.path === relativePath);
      if (!record || !/^[a-f0-9]{64}$/.test(record.contentHash ?? '')) return null;
      const contents = Buffer.from(record.contentBase64, 'base64');
      if (contents.length !== record.size || createHash('sha256').update(contents).digest('hex') !== record.contentHash) return null;
      const artifact = { contents, fileName: path.posix.basename(relativePath), contentHash: record.contentHash };
      await onArtifact?.(artifact);
      return artifact;
    };
    if (principal) {
      if (typeof this.store.withPrincipalAuthority !== 'function') throw principalScopeUnavailable();
      return this.store.withPrincipalAuthority({ id, tenantId, principal,
        anyPrincipalRoleGroups: [['workspace-read', 'workspace-write', 'tenant-admin']], authzGeneration,
        operation: readAndDeliver });
    }
    return readAndDeliver(await this.store.get(id, tenantId));
  }
  async create(input) {
    if (input && (Object.hasOwn(input, 'processTaskRef') || Object.hasOwn(input, 'proposalContext'))) {
      throw Object.assign(new Error('Only a saved process-task request may establish immutable task linkage.'), {
        statusCode: 400, code: 'INVALID_COMMAND', retryable: false,
      });
    }
    let profile = this.profiles.get(input.profileId);
    if (profile?.dynamicOpenAi) {
      if (input.scopePrincipal) {
        if (typeof this.store.authorizeProjectForPrincipal !== 'function') throw principalScopeUnavailable();
        await this.store.authorizeProjectForPrincipal({
          tenantId: input.tenantId, projectId: input.projectId,
          principal: input.scopePrincipal, authzGeneration: input.authzGeneration,
        });
      }
      if (!this.secretStore || !input.tenantId) throw Object.assign(new Error('OpenAI profile requires the server-side credential broker.'), { statusCode: 503, code: 'BROKER_AUTHORITY_REQUIRED' });
      const binding = await this.secretStore.resolveOpenAiBinding({ tenantId: input.tenantId, reference: profile.credentialReference, model: profile.model });
      profile = { ...profile, credentialVersion: binding.version };
    } else if (profile?.dynamicDeepSeek) {
      if (input.scopePrincipal) {
        if (typeof this.store.authorizeProjectForPrincipal !== 'function') throw principalScopeUnavailable();
        await this.store.authorizeProjectForPrincipal({
          tenantId: input.tenantId, projectId: input.projectId,
          principal: input.scopePrincipal, authzGeneration: input.authzGeneration,
        });
      }
      if (!this.secretStore || !input.tenantId) throw Object.assign(new Error('DeepSeek profile requires the server-side credential broker.'), { statusCode: 503, code: 'BROKER_AUTHORITY_REQUIRED' });
      const binding = await resolveModelCredentialBinding(this.secretStore, profile, { tenantId: input.tenantId });
      profile = { ...profile, credentialVersion: binding.version };
    }
    const run = createExecutionRun({ ...input, profile });
    await this.#saveRun(run, {
      principal: input.scopePrincipal ?? null,
      requiredPrincipalRoles: input.scopePrincipal ? ['workspace-write'] : null,
      authzGeneration: input.scopePrincipal ? input.authzGeneration : null,
    });
    return executionRunView(run);
  }
  async createForProcessTask(input) {
    if (typeof this.store.createForProcessTask !== 'function') {
      throw Object.assign(new Error('Linked process task requests require PostgreSQL-backed execution storage.'), {
        statusCode: 503, code: 'PROCESS_TASK_EXECUTION_UNAVAILABLE', retryable: false,
      });
    }
    const configuredProfile = this.profiles.get(input.profileId);
    const managedDeepSeek = !configuredProfile;
    if (managedDeepSeek && (typeof this.store.getTenantDeepSeekProfile !== 'function'
      || !Number.isSafeInteger(input.profileRevision) || input.profileRevision < 1)) {
      throw Object.assign(new Error('Choose a current tenant execution profile and reload before requesting approval.'), {
        statusCode: 409, code: 'EXECUTION_PROFILE_STALE', retryable: false,
      });
    }
    const profile = configuredProfile;
    if (configuredProfile && input.profileRevision !== undefined) throw Object.assign(new Error('Installation profiles do not accept a tenant catalog revision.'), {
      statusCode: 400, code: 'INVALID_PROCESS_TASK_REQUEST', retryable: false,
    });
    if (((profile && isModelProvider(profile)) || managedDeepSeek) && (!this.secretStore || !input.tenantId)) {
      throw Object.assign(new Error('Model provider profiles require the server-side credential broker.'), {
        statusCode: 503, code: 'BROKER_AUTHORITY_REQUIRED', retryable: false,
      });
    }
    const repository = input.repositoryId
      ? this.localRepositories.get(`${input.tenantId}\n${input.projectId}\n${input.repositoryId}`) : null;
    if (input.repositoryId && !repository) throw Object.assign(new Error('This local repository is not configured for the selected project.'), {
      statusCode: 404, code: 'LOCAL_REPOSITORY_NOT_FOUND', retryable: false,
    });
    if (repository && (managedDeepSeek || isModelProvider(profile) || profile.kind === 'provider-http')) throw Object.assign(new Error('Local repository tasks require an approved local command profile.'), {
      statusCode: 400, code: 'LOCAL_REPOSITORY_PROFILE_INVALID', retryable: false,
    });
    if (repository && (repository.kind === 'git') !== Boolean(input.repositoryRefId)) throw Object.assign(new Error('Choose an explicitly allowed Git ref for this repository.'), {
      statusCode: 400, code: 'LOCAL_REPOSITORY_REF_REQUIRED', retryable: false,
    });
    if (repository?.kind === 'git' && !/^[a-f0-9]{40,64}$/.test(input.repositoryCommitOid ?? '')) throw Object.assign(new Error('Reload the selected Git ref to pin its exact commit.'), {
      statusCode: 409, code: 'LOCAL_REPOSITORY_SNAPSHOT_STALE', retryable: false,
    });
    const selectedGitRef = repository?.kind === 'git'
      ? repository.allowedRefs.find((entry) => entry.id === input.repositoryRefId) : null;
    if (repository?.kind === 'git' && !selectedGitRef) throw Object.assign(new Error('Choose an explicitly allowed Git ref.'), {
      statusCode: 400, code: 'LOCAL_REPOSITORY_INVALID', retryable: false,
    });
    if (repository?.kind !== 'git' && input.repositoryCommitOid !== undefined) throw Object.assign(new Error('A Git commit can be supplied only with a configured Git ref.'), {
      statusCode: 400, code: 'LOCAL_REPOSITORY_REF_INVALID', retryable: false,
    });
    if (repository && !/^[a-f0-9]{64}$/.test(input.snapshotDigest ?? '')) throw Object.assign(new Error('Reload the selected repository snapshot before requesting this task.'), {
      statusCode: 409, code: 'LOCAL_REPOSITORY_SNAPSHOT_STALE', retryable: false,
    });
    const repositoryRef = repository ? {
      id: repository.id, snapshotId: `sha256:${input.snapshotDigest}`, treeDigest: input.snapshotDigest,
      ...(repository.kind === 'git' ? { source: {
        type: 'git', identity: repository.identity, refId: input.repositoryRefId,
        ref: selectedGitRef.ref,
        label: selectedGitRef.label ?? input.repositoryRefId,
        commitOid: input.repositoryCommitOid,
      } } : {}),
      verification: { id: repository.verification.id, version: repository.verification.version ?? '1.0.0',
        commandHash: digest({ executable: repository.verification.executable, args: repository.verification.args }) },
    } : null;
    const requestHash = digest({
      projectId: input.projectId, planId: input.planId, revision: input.revision,
      planInstanceId: input.planInstanceId ?? null, taskId: input.taskId, profileId: input.profileId,
      ...(repositoryRef ? { repository: repositoryRef, repositoryRefId: input.repositoryRefId ?? null,
        repositoryCommitOid: input.repositoryCommitOid ?? null } : {}),
      ...(managedDeepSeek ? { managedProfileRevision: input.profileRevision } : {}),
      ...(isModelProvider(profile) ? {
        profileSnapshot: {
          kind: profile.kind, version: profile.version,
          credentialReference: profile.credentialReference,
          model: profile.model,
          ...(profile.dynamicDeepSeek ? { maxOutputTokens: profile.maxOutputTokens } : {}),
          providerEndpoint: profile.providerEndpoint,
        },
      } : {}),
    });
    const result = await this.store.createForProcessTask({
      tenantId: input.tenantId, projectId: input.projectId, principal: input.principal,
      authzGeneration: input.authzGeneration, planId: input.planId, revision: input.revision,
      planInstanceId: input.planInstanceId, taskId: input.taskId, commandId: input.commandId, requestHash,
      repositoryRef,
      buildRun: async ({ project, plan, task, processTaskRef, client }) => {
        let repositorySnapshot = null;
        if (repository) {
          repositorySnapshot = repository.kind === 'git'
            ? await captureGitRepositorySnapshot(repository, input.repositoryRefId)
            : await captureLocalRepositorySnapshot(repository.directory);
          if (repositorySnapshot.treeDigest !== input.snapshotDigest
            || (repository.kind === 'git' && repositorySnapshot.repositorySource.commitOid !== input.repositoryCommitOid)) throw Object.assign(new Error('The configured repository snapshot or Git commit changed after it was selected. Reload the repository and retry.'), {
            statusCode: 409, code: 'LOCAL_REPOSITORY_SNAPSHOT_STALE', retryable: false,
          });
        }
        let runProfile = profile;
        if (managedDeepSeek) {
          const managedProfile = await this.store.getTenantDeepSeekProfile({
            client, tenantId: input.tenantId, profileId: input.profileId,
          });
          if (!managedProfile?.enabled || managedProfile.revision !== input.profileRevision) {
            throw Object.assign(new Error('The tenant DeepSeek profile changed or was disabled. Reload the profile before requesting approval.'), {
              statusCode: 409, code: 'EXECUTION_PROFILE_STALE', retryable: false,
            });
          }
          runProfile = validateProfile(tenantDeepSeekProfileConfig(managedProfile));
        }
        let proposalContext = null;
        let taskGuidance = null;
        if (isModelProvider(runProfile)) {
          const binding = await resolveModelCredentialBinding(this.secretStore, runProfile, {
            client, tenantId: input.tenantId,
          });
          runProfile = { ...runProfile, credentialVersion: binding.version };
          const pinnedBlueprint = project.blueprintVersions?.find((candidate) => candidate.id === processTaskRef.blueprintId
            && candidate.version === processTaskRef.blueprintVersion);
          taskGuidance = createProcessTaskGuidanceSnapshot({ blueprint: pinnedBlueprint, plan, task, processTaskRef });
          proposalContext = createProcessTaskProposalContext({ blueprint: pinnedBlueprint, task, processTaskRef, taskGuidance });
        }
        const run = createExecutionRun({
          tenantId: input.tenantId, projectId: input.projectId, profile: runProfile, requestedBy: input.principal,
          title: task.title, objective: task.detail,
          requirements: [
            ...task.inputs.map((entry) => `Use input: ${entry.label}`),
            ...task.outputs.map((entry) => `Produce output: ${entry.label}`),
          ],
          sourceRefs: [
            `process-plan:${plan.id}:revision:${plan.revision}`,
            `task:${task.id}`,
            ...task.inputs.map((entry) => `input:${entry.objectId}`),
            ...task.outputs.map((entry) => `output:${entry.objectId}`),
          ],
          processTaskRef,
          proposalContext,
          taskGuidance,
        });
        if (repositorySnapshot) run.repositorySnapshot = repositorySnapshot;
        return run;
      },
    });
    return result ? { ...result, run: executionRunView(result.run) } : null;
  }
  async listLocalRepositories({ tenantId, projectId, principal, authzGeneration }) {
    if (typeof this.store.authorizeProjectForPrincipal !== 'function') throw principalScopeUnavailable();
    await this.store.authorizeProjectForPrincipal({ tenantId, projectId, principal, authzGeneration });
    const matches = [...this.localRepositories.values()].filter((repository) => repository.tenantId === tenantId && repository.projectId === projectId);
    const listed = [];
    for (const repository of matches) {
      if (repository.kind === 'git') {
        for (const allowedRef of repository.allowedRefs) {
          const snapshot = await captureGitRepositorySnapshot(repository, allowedRef.id);
          listed.push({ id: repository.id, selectionId: `${repository.id}:${allowedRef.id}`,
            label: repository.label ?? repository.id, kind: 'git', identity: repository.identity,
            refId: allowedRef.id, ref: snapshot.repositorySource.ref, refLabel: snapshot.repositorySource.label,
            commitOid: snapshot.repositorySource.commitOid, snapshotId: snapshot.snapshotId,
            treeDigest: snapshot.treeDigest, fileCount: snapshot.fileCount, totalBytes: snapshot.totalBytes,
            verification: { id: repository.verification.id, version: repository.verification.version ?? '1.0.0' } });
        }
      } else {
        const snapshot = await captureLocalRepositorySnapshot(repository.directory);
        listed.push({ id: repository.id, selectionId: repository.id, label: repository.label ?? repository.id,
          kind: 'directory', snapshotId: snapshot.snapshotId, treeDigest: snapshot.treeDigest,
          fileCount: snapshot.fileCount, totalBytes: snapshot.totalBytes,
          verification: { id: repository.verification.id, version: repository.verification.version ?? '1.0.0' } });
      }
    }
    return listed;
  }
  async cancelProcessTaskRun(input) {
    if (typeof this.store.cancelProcessTaskRun !== 'function') {
      throw Object.assign(new Error('Linked process task cancellation requires PostgreSQL-backed execution storage.'), {
        statusCode: 503, code: 'PROCESS_TASK_EXECUTION_UNAVAILABLE', retryable: false,
      });
    }
    const result = await this.store.cancelProcessTaskRun({
      tenantId: input.tenantId, projectId: input.projectId, runId: input.runId,
      principal: input.principal, authzGeneration: input.authzGeneration,
      version: input.version, commandId: input.commandId,
      requestHash: digest({
        tenantId: input.tenantId, projectId: input.projectId, runId: input.runId,
        principal: input.principal, version: input.version,
      }),
    });
    return result ? { ...result, run: executionRunView(result.run) } : null;
  }
  async pauseProcessTaskRun(input) {
    if (typeof this.store.pauseProcessTaskRun !== 'function') {
      throw Object.assign(new Error('Linked process-task pause requires PostgreSQL-backed execution storage.'), {
        statusCode: 503, code: 'PROCESS_TASK_EXECUTION_UNAVAILABLE', retryable: false,
      });
    }
    const result = await this.store.pauseProcessTaskRun({
      tenantId: input.tenantId, projectId: input.projectId, runId: input.runId,
      principal: input.principal, authzGeneration: input.authzGeneration,
      version: input.version, commandId: input.commandId,
      requestHash: digest({
        tenantId: input.tenantId, projectId: input.projectId, runId: input.runId,
        principal: input.principal, version: input.version,
      }),
    });
    return result ? { ...result, run: executionRunView(result.run) } : null;
  }
  async amendPausedProcessTaskRun(input) {
    if (typeof this.store.amendPausedProcessTaskRun !== 'function') {
      throw Object.assign(new Error('Linked process-task amendment requires PostgreSQL-backed execution storage.'), {
        statusCode: 503, code: 'PROCESS_TASK_EXECUTION_UNAVAILABLE', retryable: false,
      });
    }
    const { tenantId, projectId, runId, principal, authzGeneration, version, commandId, objective, requirements, reason } = input;
    const result = await this.store.amendPausedProcessTaskRun({
      tenantId, projectId, runId, principal, authzGeneration, version, commandId, objective, requirements, reason,
      requestHash: digest({ tenantId, projectId, runId, principal, version, objective, requirements, reason }),
    });
    return result ? { ...result, run: executionRunView(result.run) } : null;
  }
  async resumeProcessTaskRun(input) {
    if (typeof this.store.resumeProcessTaskRun !== 'function') {
      throw Object.assign(new Error('Linked process-task resume requires PostgreSQL-backed execution storage.'), {
        statusCode: 503, code: 'PROCESS_TASK_EXECUTION_UNAVAILABLE', retryable: false,
      });
    }
    const validateCurrentProfile = async (run, client) => {
      const stale = (message) => Object.assign(new Error(message), {
        statusCode: 409, code: 'EXECUTION_PROFILE_STALE', retryable: false,
      });
      const managed = /^tenant-deepseek-r[1-9][0-9]*$/.test(run.profile?.version ?? '');
      const profile = managed ? await this.#profileForRun(run, input.tenantId, client) : this.profiles.get(run.profile?.id);
      if (!profile || profile.kind !== run.profile?.kind || profile.version !== run.profile?.version) {
        throw stale('The configured execution profile changed while this request was paused. Keep it paused and create a new request.');
      }
      if ((profile.providerEndpoint ? digest(profile.providerEndpoint) : null)
        !== (run.profile.providerDestinationHash ?? null)) {
        throw stale('The configured provider destination changed while this request was paused. Keep it paused and create a new request.');
      }
      if (profile.dynamicOpenAi) {
        const credential = run.profile.credential;
        if (!credential || credential.reference !== profile.credentialReference
          || run.profile.providerModel !== profile.model || !this.secretStore || !client) {
          throw stale('The pinned OpenAI profile or credential is no longer available. Keep it paused and create a new request.');
        }
        let binding;
        try {
          binding = await this.secretStore.resolveOpenAiBinding({
            client, tenantId: input.tenantId, reference: credential.reference, model: profile.model,
          });
        } catch {
          throw stale('The pinned OpenAI credential is no longer active. Keep it paused and create a new request.');
        }
        if (binding.version !== credential.version) {
          throw stale('The OpenAI credential generation changed while this request was paused. Keep it paused and create a new request.');
        }
      } else if (profile.dynamicDeepSeek) {
        const credential = run.profile.credential;
        if (!credential || credential.reference !== profile.credentialReference
          || run.profile.providerModel !== profile.model
          || run.profile.providerMaxOutputTokens !== profile.maxOutputTokens || !this.secretStore || !client) {
          throw stale('The pinned DeepSeek profile or credential is no longer available. Keep it paused and create a new request.');
        }
        let binding;
        try { binding = await resolveModelCredentialBinding(this.secretStore, profile, { client, tenantId: input.tenantId }); }
        catch { throw stale('The pinned generic provider credential is no longer active. Keep it paused and create a new request.'); }
        if (binding.version !== credential.version) throw stale('The generic provider credential generation changed while this request was paused. Keep it paused and create a new request.');
      } else {
        const configured = profile.credentialReference
          ? { reference: profile.credentialReference, version: profile.credentialVersion } : null;
        const pinned = run.profile.credential ?? null;
        if ((configured?.reference ?? null) !== (pinned?.reference ?? null)
          || (configured?.version ?? null) !== (pinned?.version ?? null)) {
          throw stale('The configured credential binding changed while this request was paused. Keep it paused and create a new request.');
        }
      }
    };
    const result = await this.store.resumeProcessTaskRun({
      tenantId: input.tenantId, projectId: input.projectId, runId: input.runId,
      principal: input.principal, authzGeneration: input.authzGeneration,
      version: input.version, commandId: input.commandId,
      reason: input.reason ?? null,
      requestHash: digest({
        tenantId: input.tenantId, projectId: input.projectId, runId: input.runId,
        principal: input.principal, version: input.version, reason: input.reason ?? null,
      }),
      validateCurrentProfile,
    });
    return result ? { ...result, run: executionRunView(result.run) } : null;
  }
  async listProcessTaskInstances(input) {
    if (typeof this.store.listProcessTaskInstancesForPrincipal !== 'function') {
      throw Object.assign(new Error('Durable process task runtime storage is unavailable.'), {
        statusCode: 503, code: 'PROCESS_TASK_RUNTIME_UNAVAILABLE', retryable: false,
      });
    }
    return this.store.listProcessTaskInstancesForPrincipal(input);
  }
  async pauseProcessTaskInstance(input) {
    if (typeof this.store.pauseProcessTaskInstance !== 'function') throw Object.assign(new Error('Durable process-instance pause requires PostgreSQL-backed execution storage.'), {
      statusCode: 503, code: 'PROCESS_TASK_RUNTIME_UNAVAILABLE', retryable: false,
    });
    const { tenantId, projectId, planInstanceId, principal, authzGeneration, version, reason, commandId } = input;
    const result = await this.store.pauseProcessTaskInstance({ ...input, requestHash: digest({ tenantId, projectId, planInstanceId, principal, version, reason }) });
    return result;
  }
  async resumeProcessTaskInstance(input) {
    if (typeof this.store.resumeProcessTaskInstance !== 'function') throw Object.assign(new Error('Durable process-instance resume requires PostgreSQL-backed execution storage.'), {
      statusCode: 503, code: 'PROCESS_TASK_RUNTIME_UNAVAILABLE', retryable: false,
    });
    const { tenantId, projectId, planInstanceId, principal, version } = input;
    return this.store.resumeProcessTaskInstance({ ...input, requestHash: digest({ tenantId, projectId, planInstanceId, principal, version }) });
  }
  async abandonUnverifiedProcessTaskInstance(input) {
    if (typeof this.store.abandonUnverifiedProcessTaskInstance !== 'function') throw Object.assign(new Error('Unverified process-instance abandonment requires PostgreSQL-backed execution storage.'), {
      statusCode: 503, code: 'PROCESS_TASK_RUNTIME_UNAVAILABLE', retryable: false,
    });
    const { tenantId, projectId, planInstanceId, principal, version, reason, evidence, acknowledgeDuplicateCostWork } = input;
    return this.store.abandonUnverifiedProcessTaskInstance({ ...input, requestHash: digest({
      tenantId, projectId, planInstanceId, principal, version, reason, evidence, acknowledgeDuplicateCostWork,
    }) });
  }
  async cancelProcessTaskInstance(input) {
    if (typeof this.store.cancelProcessTaskInstance !== 'function') throw Object.assign(new Error('Terminal process-instance cancellation requires PostgreSQL-backed execution storage.'), {
      statusCode: 503, code: 'PROCESS_TASK_RUNTIME_UNAVAILABLE', retryable: false,
    });
    const { tenantId, projectId, planInstanceId, principal, version, reason } = input;
    return this.store.cancelProcessTaskInstance({ ...input, requestHash: digest({
      tenantId, projectId, planInstanceId, principal, version, reason,
    }) });
  }
  async startHumanProcessTask(input) {
    if (typeof this.store.startHumanProcessTask !== 'function') {
      throw Object.assign(new Error('Durable human task checkpoints require PostgreSQL-backed execution storage.'), {
        statusCode: 503, code: 'PROCESS_TASK_RUNTIME_UNAVAILABLE', retryable: false,
      });
    }
    return this.store.startHumanProcessTask({
      ...input,
      requestHash: digest({
        projectId: input.projectId, planId: input.planId, revision: input.revision,
        planInstanceId: input.planInstanceId, taskId: input.taskId, principal: input.principal,
      }),
    });
  }
  async completeHumanProcessTask(input) {
    if (typeof this.store.completeHumanProcessTask !== 'function') {
      throw Object.assign(new Error('Durable human task checkpoints require PostgreSQL-backed execution storage.'), {
        statusCode: 503, code: 'PROCESS_TASK_RUNTIME_UNAVAILABLE', retryable: false,
      });
    }
    return this.store.completeHumanProcessTask({
      ...input,
      requestHash: digest({
        projectId: input.projectId, planId: input.planId, revision: input.revision,
        planInstanceId: input.planInstanceId, taskId: input.taskId, principal: input.principal,
        result: input.result, evidence: input.evidence,
      }),
    });
  }
  async escalateHumanProcessTask(input) {
    if (typeof this.store.escalateHumanProcessTask !== 'function') {
      throw Object.assign(new Error('Durable human task escalation requires PostgreSQL-backed execution storage.'), {
        statusCode: 503, code: 'PROCESS_TASK_RUNTIME_UNAVAILABLE', retryable: false,
      });
    }
    return this.store.escalateHumanProcessTask({
      ...input,
      requestHash: digest({
        projectId: input.projectId, planId: input.planId, revision: input.revision,
        planInstanceId: input.planInstanceId, taskId: input.taskId, principal: input.principal,
        reason: input.reason, evidence: input.evidence ?? [],
      }),
    });
  }
  async resolveHumanProcessTaskEscalation(input) {
    if (typeof this.store.resolveHumanProcessTaskEscalation !== 'function') {
      throw Object.assign(new Error('Durable human task resolution requires PostgreSQL-backed execution storage.'), {
        statusCode: 503, code: 'PROCESS_TASK_RUNTIME_UNAVAILABLE', retryable: false,
      });
    }
    return this.store.resolveHumanProcessTaskEscalation({
      ...input,
      requestHash: digest({
        projectId: input.projectId, planId: input.planId, revision: input.revision,
        planInstanceId: input.planInstanceId, taskId: input.taskId, principal: input.principal,
        disposition: input.disposition, reason: input.reason, evidence: input.evidence ?? [],
        targetPrincipal: input.targetPrincipal ?? null, expectedVersion: input.expectedVersion ?? null,
      }),
    });
  }
  async approve(id, tenantId, command) {
    if (command.scopePrincipal && typeof this.store.withPrincipalAuthority !== 'function') throw principalScopeUnavailable();
    if (command.scopePrincipal && typeof this.store.saveForPrincipal !== 'function') throw principalScopeUnavailable();
    const run = command.scopePrincipal
      ? await this.store.withPrincipalAuthority({
        id, tenantId, principal: command.scopePrincipal,
        minimumProjectAccess: 'editor',
        requiredPrincipalRoles: ['execution-approver'], authzGeneration: command.authorityGeneration,
        operation: (current) => current,
      })
      : await this.store.get(id, tenantId);
    if (!run || run.tenantId !== tenantId) return null;
    if (command.version !== run.version) throw Object.assign(new Error(`Version conflict: expected ${run.version}.`), { statusCode: 409 });
    const persistedVersion = run.version;
    const managedProfile = /^tenant-deepseek-r[1-9][0-9]*$/.test(run.profile?.version ?? '');
    const configuredProfile = this.profiles.get(run.profile?.id);
    const validateCredentialBinding = isModelProvider(configuredProfile) || managedProfile
      ? async (current, client) => this.#validateCurrentProviderProfile(current, tenantId, client) : null;
    approveExecutionRun(run, command);
    await this.#saveRun(run, {
      expectedVersion: persistedVersion, principal: command.scopePrincipal ?? null,
      requiredPrincipalRoles: command.scopePrincipal ? ['execution-approver'] : null,
      authzGeneration: command.scopePrincipal ? command.authorityGeneration : null,
      validateCurrent: validateCredentialBinding,
    });
    return executionRunView(run);
  }
  async execute(id, tenantId, command) {
    if (command.scopePrincipal && typeof this.store.withPrincipalAuthority !== 'function') throw principalScopeUnavailable();
    if (command.scopePrincipal && typeof this.store.saveForPrincipal !== 'function') throw principalScopeUnavailable();
    const run = command.scopePrincipal
      ? await this.store.withPrincipalAuthority({
        id, tenantId, principal: command.scopePrincipal,
        minimumProjectAccess: 'editor',
        requiredPrincipalRoles: ['workspace-write'], authzGeneration: command.authorityGeneration,
        operation: (current) => current,
      })
      : await this.store.get(id, tenantId);
    if (!run || run.tenantId !== tenantId) return null;
    if (command.version !== run.version) throw Object.assign(new Error(`Version conflict: expected ${run.version}.`), { statusCode: 409 });
    if (run.status !== 'APPROVED') throw new Error('Execution run must be approved before it can execute.');
    let profile = await this.#profileForRun(run, tenantId);
    if (!profile || profile.version !== run.profile.version) {
      throw Object.assign(new Error('The executor profile changed after approval. Create a new execution run against the current profile and approve it.'), {
        statusCode: 409, code: 'EXECUTION_PROFILE_STALE', retryable: false,
      });
    }
    if (isModelProvider(profile) && (run.profile.providerModel !== profile.model
      || (profile.dynamicDeepSeek && run.profile.providerMaxOutputTokens !== profile.maxOutputTokens))) {
      throw Object.assign(new Error('The approved model provider settings differ from the configured profile. Create a new execution run and approve the current settings.'), { statusCode: 409, code: 'EXECUTION_PROFILE_STALE', retryable: false });
    }
    const configuredCredential = profile.credentialReference
      ? { reference: profile.credentialReference, version: profile.credentialVersion } : null;
    const approvedCredential = run.profile.credential ?? null;
    let dynamicBinding = null;
    if (isModelProvider(profile) && this.secretStore) {
      try { dynamicBinding = await resolveModelCredentialBinding(this.secretStore, profile, { tenantId }); }
      catch { dynamicBinding = null; }
    }
    if ((configuredCredential?.reference ?? null) !== (approvedCredential?.reference ?? null)
      || (isModelProvider(profile) ? (dynamicBinding?.version ?? null) !== (approvedCredential?.version ?? null)
        : (configuredCredential?.version ?? null) !== (approvedCredential?.version ?? null))) {
      throw Object.assign(new Error('The executor credential binding changed after approval. Create a new execution run and approve the current binding.'), {
        statusCode: 409, code: 'EXECUTION_PROFILE_STALE', retryable: false,
      });
    }
    const requestHash = executionApprovalRequestHash(run);
    const legacyRequestHash = digest(run.workItem);
    const validLegacyApproval = !run.interventionRevisions?.length && run.approval.requestHash === legacyRequestHash;
    if (run.approval.requestHash !== requestHash && !validLegacyApproval) {
      throw new Error('Approved request no longer matches the work item and executor profile.');
    }
    if (run.profile.credential && profile.kind !== 'provider-http' && !isModelProvider(profile)) {
      throw Object.assign(new Error('This credential-bound profile has no broker-aware provider adapter; execution was not dispatched.'), {
        statusCode: 503, code: 'BROKER_PROVIDER_UNAVAILABLE', retryable: false,
      });
    }
    if (this.active.has(id)) throw Object.assign(new Error('Execution run is already active.'), { statusCode: 409 });
    const providerProfile = profile.kind === 'provider-http' || isModelProvider(profile);
    const workerLeaseDurationMs = providerProfile ? PROVIDER_WORKER_LEASE_MS : WORKER_LEASE_MS;
    if (command.scopePrincipal
      && (typeof this.store.authorizeExecutionDispatch !== 'function'
        || typeof this.store.renewExecutionLease !== 'function'
        || typeof this.store.finalizeExecution !== 'function')) throw executionFenceUnavailable();
    if ((profile.kind === 'provider-http' || isModelProvider(profile)) && (!command.scopePrincipal || !this.secretStore)) {
      throw Object.assign(new Error('Provider execution requires current scoped authority and the server-side credential broker.'), { statusCode: 503, code: 'BROKER_AUTHORITY_REQUIRED', retryable: false });
    }
    const configuredProvider = profile.kind === 'provider-http' || isModelProvider(profile) ? profile.providerEndpoint : null;
    if ((run.profile.providerDestinationHash ?? null) !== (configuredProvider ? digest(configuredProvider) : null)) {
      throw Object.assign(new Error('The provider destination changed after approval. Create a new execution run and approve the current destination.'), { statusCode: 409, code: 'EXECUTION_PROFILE_STALE', retryable: false });
    }
    let settleActive;
    const active = {
      tenantId, projectId: run.projectId, principal: command.scopePrincipal ?? null,
      approvalPrincipal: run.approval?.principal ?? null,
      authzGeneration: command.authorityGeneration ?? null,
      workerId: randomUUID(), controller: new AbortController(), cancelReason: null, handle: null,
      dispatchAuthorizationPending: true,
      done: new Promise((resolve) => { settleActive = resolve; }),
    };
    active.run = run;
    let leaseTimer = null;
    let dispatchAckTimer = null;
    let dispatchLeaseTimer = null;
    let leaseRenewalBusy = false;
    let dispatchStarted = false;
    let dispatchAcknowledged = false;
    let preserveLeaseForRecovery = false;
    let terminalAttempted = false;
    let terminalRun = run;
    this.active.set(id, active);
    let runningCommitted = false;
    const renewDispatchLease = async () => {
      if (leaseRenewalBusy || dispatchStarted || !command.scopePrincipal
        || typeof this.store.renewExecutionLease !== 'function') return;
      leaseRenewalBusy = true;
      try {
        await this.store.renewExecutionLease({
          tenantId, projectId: run.projectId, principal: command.scopePrincipal,
          authzGeneration: command.authorityGeneration,
          runId: id, workerId: active.workerId, leaseDurationMs: workerLeaseDurationMs,
        });
      } catch {
        // Dispatch authorization still owns the outcome until its commit acknowledgment resolves.
        // The watchdog closes the child; terminal handling or recovery resolves uncertain persistence.
      } finally { leaseRenewalBusy = false; }
    };
    try {
      const approvedVersion = run.version;
      run.status = 'RUNNING'; run.version += 1;
      executionEvent(run, 'ExecutionStarted', command.principal ?? 'execution-worker', { profileId: profile.id });
      await this.#saveRun(run, {
        expectedVersion: approvedVersion, principal: command.scopePrincipal ?? null,
        requiredPrincipalRoles: command.scopePrincipal ? ['workspace-write'] : null,
        authzGeneration: command.scopePrincipal ? command.authorityGeneration : null,
      });
      runningCommitted = true;
      const workspace = providerProfile ? null : path.resolve(path.join(profile.workspaceRoot, run.id));
      if (!providerProfile && !workspace.startsWith(`${profile.workspaceRoot}${path.sep}`)) throw new Error('Execution workspace escaped the configured root.');
      if (!providerProfile) await mkdir(workspace, { recursive: true, mode: 0o700 });
      let repositoryBefore = null;
      if (run.processTaskRef?.repository) {
        if (!run.repositorySnapshot || run.repositorySnapshot.treeDigest !== run.processTaskRef.repository.treeDigest) {
          throw Object.assign(new Error('The pinned local repository snapshot is unavailable or invalid.'), { code: 'LOCAL_REPOSITORY_SNAPSHOT_INVALID' });
        }
        await materializeLocalRepositorySnapshot(run.repositorySnapshot, workspace);
        repositoryBefore = run.repositorySnapshot;
      }
      const adapter = providerProfile ? null : this.commandAdapterFactory({ executable: profile.executable, args: profile.args, timeoutMs: profile.timeoutMs, name: profile.id, version: profile.version, environment: profile.environment, sandbox: profile.sandbox });
      const start = async () => {
      if (providerProfile) return { providerDispatchAuthorized: true };
        const instructions = run.interventionRevisions?.at(-1) ?? run.workItem;
        const handle = await adapter.start(
          { id: run.workItem.id, objective: instructions.objective, acceptanceCriteria: instructions.requirements },
          { id: run.id, requirements: instructions.requirements, sourceRefs: run.workItem.sourceRefs, approval: run.approval,
            interventionRevision: run.interventionRevisions?.at(-1)?.revision ?? null },
          { workspace, signal: active.controller.signal },
        );
        active.handle = handle;
        handle.result.catch(() => {});
        if (command.scopePrincipal) {
          dispatchAckTimer = setTimeout(() => {
            if (dispatchStarted || active.cancelReason) return;
            active.cancelReason = 'dispatch_commit_unknown';
            active.controller.abort();
            active.handle?.terminate();
          }, DISPATCH_ACK_WATCHDOG_MS);
          dispatchAckTimer.unref?.();
          dispatchLeaseTimer = setInterval(() => { void renewDispatchLease(); }, WORKER_HEARTBEAT_MS);
          dispatchLeaseTimer.unref?.();
        }
        return handle;
      };
      let handle;
      if (command.scopePrincipal) {
        try {
          handle = await this.store.authorizeExecutionDispatch({
            tenantId, projectId: run.projectId, principal: command.scopePrincipal,
            authzGeneration: command.authorityGeneration,
            runId: id, expectedVersion: run.version, workerId: active.workerId,
            leaseDurationMs: workerLeaseDurationMs, start,
            validateCurrentProfile: isModelProvider(profile)
              ? (current, client) => this.#validateCurrentProviderProfile(current, tenantId, client) : null,
          });
          dispatchAcknowledged = true;
          active.dispatchAuthorizationPending = false;
        } finally {
          if (dispatchAckTimer) clearTimeout(dispatchAckTimer);
          dispatchAckTimer = null;
          if (dispatchAcknowledged && dispatchLeaseTimer) {
            clearInterval(dispatchLeaseTimer);
            dispatchLeaseTimer = null;
          }
        }
      } else {
        handle = await start();
        active.dispatchAuthorizationPending = false;
      }
      dispatchStarted = true;
      active.handle = providerProfile ? { terminate: () => active.controller.abort() } : handle;
      if (active.cancelReason === 'dispatch_commit_unknown') {
        await handle.result.catch(() => {});
        throw Object.assign(new Error('Execution dispatch acknowledgment exceeded the worker lease window.'), { code: 'DISPATCH_COMMIT_UNKNOWN' });
      }
      if (command.scopePrincipal && typeof this.store.renewExecutionLease === 'function') {
        const renewLease = async () => {
          if (leaseRenewalBusy || active.cancelReason) return;
          leaseRenewalBusy = true;
          try {
            const lease = await this.store.renewExecutionLease({
              tenantId, projectId: run.projectId, principal: command.scopePrincipal,
              authzGeneration: command.authorityGeneration,
              runId: id, workerId: active.workerId, leaseDurationMs: workerLeaseDurationMs,
            });
            if (!lease.active) {
              active.cancelReason = lease.reason ?? 'authorization_revoked';
              active.controller.abort();
              active.handle?.terminate();
            }
          } catch {
            active.cancelReason = 'worker_lease_unavailable';
            active.controller.abort();
            active.handle?.terminate();
          } finally { leaseRenewalBusy = false; }
        };
        leaseTimer = setInterval(() => { void renewLease(); }, providerProfile ? PROVIDER_LEASE_RENEWAL_MS : WORKER_HEARTBEAT_MS);
        leaseTimer.unref?.();
        await renewLease();
      }
      if (providerProfile) {
        const providerController = active.controller;
        const result = this.#executeProvider(profile, run, active).then((text) => ({
          status: 'COMPLETED', exitCode: 0, stdout: text, stderr: '', changedArtifacts: [], evidenceHash: digest(text),
        }));
        handle = { result, terminate: () => providerController.abort() };
        active.handle = handle;
        result.catch(() => {});
      }
      let result = await handle.result;
      if (repositoryBefore && result.status === 'COMPLETED') {
        const repositoryAfter = await captureLocalRepositorySnapshot(workspace, { excludeGitDirectory: false });
        const repositoryConfig = this.localRepositories.get(`${tenantId}\n${run.projectId}\n${run.processTaskRef.repository.id}`);
        if (!repositoryConfig) throw Object.assign(new Error('The pinned local repository binding is no longer configured.'), { code: 'LOCAL_REPOSITORY_NOT_FOUND' });
        const verificationCommandHash = digest({ executable: repositoryConfig.verification.executable, args: repositoryConfig.verification.args });
        if (repositoryConfig.verification.id !== run.processTaskRef.repository.verification?.id
          || (repositoryConfig.verification.version ?? '1.0.0') !== run.processTaskRef.repository.verification?.version
          || verificationCommandHash !== run.processTaskRef.repository.verification?.commandHash) {
          throw Object.assign(new Error('The local verification command changed after the task snapshot was pinned.'), {
            code: 'LOCAL_REPOSITORY_VERIFICATION_STALE', statusCode: 409, retryable: false,
          });
        }
        let verification = null;
        const candidateTreeDigest = repositoryAfter.treeDigest;
        if (repositoryConfig.verification) {
          const verificationConfig = repositoryConfig.verification;
          const verificationAdapter = this.commandAdapterFactory({ executable: verificationConfig.executable,
            args: verificationConfig.args, timeoutMs: verificationConfig.timeoutMs ?? profile.timeoutMs,
            name: verificationConfig.id, version: verificationConfig.version ?? '1.0.0', sandbox: profile.sandbox });
          const checked = await verificationAdapter.execute({ id: `verify-${run.workItem.id}`, objective: 'Verify the exact captured candidate tree.' },
            { id: run.id, candidateTreeDigest, repositoryId: repositoryConfig.id }, { workspace, signal: active.controller.signal });
          const redactedVerificationStdout = redact(checked.stdout);
          const redactedVerificationStderr = redact(checked.stderr);
          const verificationStdoutTruncated = checked.stdoutTruncated === true || redactedVerificationStdout.length > 20_000;
          const verificationStderrTruncated = checked.stderrTruncated === true || redactedVerificationStderr.length > 20_000;
          const verificationStdout = redactedVerificationStdout.slice(0, 20_000);
          const verificationStderr = redactedVerificationStderr.slice(0, 20_000);
          verification = { id: verificationConfig.id, version: verificationConfig.version ?? '1.0.0',
            commandHash: verificationCommandHash,
            treeDigest: candidateTreeDigest, status: checked.status, exitCode: checked.exitCode,
            stdout: verificationStdout, stderr: verificationStderr,
            stdoutTruncated: verificationStdoutTruncated, stderrTruncated: verificationStderrTruncated,
            outputHash: digest({ stdout: verificationStdout, stderr: verificationStderr }) };
          if (checked.status !== 'COMPLETED' || checked.exitCode !== 0) result = { ...result, status: 'FAILED', exitCode: checked.exitCode };
          const afterVerification = await captureLocalRepositorySnapshot(workspace, { excludeGitDirectory: false });
          if (afterVerification.treeDigest !== candidateTreeDigest) {
            verification.status = 'FAILED';
            verification.error = 'Verification modified the immutable candidate tree.';
            result = { ...result, status: 'FAILED', exitCode: verification.exitCode ?? 1 };
          }
        }
        result = { ...result, repositoryCandidate: {
          repositoryId: repositoryConfig.id, snapshotId: repositoryBefore.snapshotId,
          sourceTreeDigest: repositoryBefore.treeDigest, treeDigest: candidateTreeDigest,
          ...(repositoryBefore.repositorySource ? { source: repositoryBefore.repositorySource } : {}),
          changes: localRepositoryDiff(repositoryBefore, repositoryAfter), verification,
        } };
      }
      const generatedProposal = result.status === 'COMPLETED' && run.workItem?.proposalContext
        ? createGeneratedBlueprintProposal(run, result.stdout) : null;
      terminalAttempted = true;
      const execution = {
        ...result, stdout: redact(result.stdout), stderr: redact(result.stderr),
        ...(workspace ? { workspace } : {}), ...(generatedProposal ? { generatedProposal } : {}),
      };
      terminalRun = await this.#finalizeTerminal(run, {
        tenantId, principal: command.scopePrincipal ?? null, workerId: active.workerId,
        dispatchStarted, commandPrincipal: command.principal ?? 'execution-worker',
        complete: (candidate) => {
          candidate.execution = execution;
          candidate.status = result.status === 'COMPLETED' ? 'SUCCEEDED' : 'FAILED';
          executionEvent(candidate, candidate.status === 'SUCCEEDED' ? 'ExecutionSucceeded' : 'ExecutionFailed', command.principal ?? 'execution-worker', { evidenceHash: result.evidenceHash, exitCode: result.exitCode });
          return candidate;
        },
        reason: active.cancelReason,
      });
  } catch (error) {
      if (terminalAttempted || !runningCommitted || run.status !== 'RUNNING') throw error;
      if (command.scopePrincipal && ['PROCESS_INSTANCE_PAUSED', 'PROVIDER_ATTEMPT_CANCELLED'].includes(error.code)
        && typeof this.store.pauseUndispatchedProcessTaskRun === 'function') {
        try {
          terminalRun = await this.store.pauseUndispatchedProcessTaskRun({
            tenantId, projectId: run.projectId, runId: id, principal: command.scopePrincipal,
            authzGeneration: command.authorityGeneration, workerId: active.workerId, expectedVersion: run.version,
          });
          if (terminalRun) terminalAttempted = true;
        } catch { /* Fall through to ordinary failure handling; the store remains fail closed. */ }
      }
      if (terminalRun?.status === 'PAUSED') {
        // The run was known not to have crossed a provider handoff; release its worker lease below.
      } else if (command.scopePrincipal && active.handle && !dispatchStarted) {
        preserveLeaseForRecovery = true;
        active.cancelReason = 'dispatch_commit_unknown';
        active.controller.abort();
        active.handle.terminate();
        await active.handle.result.catch(() => {});
        preserveLeaseForRecovery = false;
        terminalAttempted = true;
        try {
          terminalRun = await this.#finalizeTerminal(run, {
            tenantId, principal: command.scopePrincipal, workerId: active.workerId,
            dispatchStarted: false, commandPrincipal: command.principal ?? 'execution-worker',
            failure: error, reason: 'dispatch_commit_unknown',
          });
        } catch (finalizeError) {
          preserveLeaseForRecovery = true;
          throw finalizeError;
        }
      } else {
        const interrupted = Boolean(active.cancelReason)
          || ['EXECUTION_REVOKED', 'ACTION_FORBIDDEN', 'EXECUTION_APPROVAL_STALE'].includes(error.code);
        terminalAttempted = true;
        try {
          terminalRun = await this.#finalizeTerminal(run, {
            tenantId, principal: command.scopePrincipal ?? null, workerId: active.workerId,
            dispatchStarted, commandPrincipal: command.principal ?? 'execution-worker',
            failure: error, reason: active.cancelReason ?? (error.code === 'EXECUTION_APPROVAL_STALE'
              ? 'execution_approval_stale' : interrupted ? 'authorization_revoked' : undefined),
          });
        } catch (finalizeError) {
          if (command.scopePrincipal && active.cancelReason === 'dispatch_commit_unknown') preserveLeaseForRecovery = true;
          throw finalizeError;
        }
      }
    } finally {
      if (dispatchAckTimer) clearTimeout(dispatchAckTimer);
      if (dispatchLeaseTimer) clearInterval(dispatchLeaseTimer);
      if (leaseTimer) clearInterval(leaseTimer);
      if (!preserveLeaseForRecovery && command.scopePrincipal && typeof this.store.releaseExecutionLease === 'function') {
        await this.store.releaseExecutionLease({ tenantId, runId: id, workerId: active.workerId }).catch(() => {});
      }
      this.active.delete(id);
      settleActive();
    }
    return executionRunView(terminalRun);
  }
  async useProviderCredential(id, { operation }) {
    const active = this.active.get(id);
    const run = active?.run;
    const binding = run?.profile?.credential;
    if (!active || !binding || typeof operation !== 'function' || !active.principal
      || typeof this.store.renewExecutionLease !== 'function' || !this.secretStore) {
      throw Object.assign(new Error('An approved, active provider lease is required.'), { statusCode: 403, code: 'BROKER_AUTHORITY_REQUIRED' });
    }
    return this.secretStore.useForAuthorizedLease({
      tenantId: active.tenantId, projectId: active.projectId, principal: active.principal,
      authzGeneration: active.authzGeneration, workerId: active.workerId, runId: id,
      reference: binding.reference, expectedVersion: binding.version, signal: active.controller.signal,
      operation,
    });
  }

  async #executeProvider(profile, run, active) {
    const controller = active.controller;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, Math.min(profile.timeoutMs ?? 20_000, 20_000));
    timeout.unref?.();
    try {
      return await this.useProviderCredential(run.id, { operation: ({ credential, signal }) => {
        const instructions = run.interventionRevisions?.at(-1) ?? run.workItem;
        const proposalTask = { id: run.processTaskRef?.taskId, title: run.title, detail: instructions.objective };
        const proposalInput = run.workItem.proposalContext
          ? buildProcessTaskProposalPromptForRun({ run, task: proposalTask, amendedRequirements: instructions.requirements })
          : `${instructions.objective}\n\nRequirements:\n${instructions.requirements.join('\n')}`;
        const requestBody = isModelProvider(profile)
          ? { model: profile.model, input: proposalInput,
          store: false, max_output_tokens: profile.maxOutputTokens, tools: [] }
          : { objective: instructions.objective, requirements: instructions.requirements };
        return providerTransport(profile.providerEndpoint, {
          headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(requestBody), signal,
          parseResponse: (parsed) => {
            if (isModelProvider(profile) && parsed?.status !== 'completed') throw Object.assign(new Error('incomplete model provider response'), { parserFailureClass: 'incomplete_response' });
            const output = isModelProvider(profile) && Array.isArray(parsed?.output)
              ? parsed.output.flatMap((item) => item?.type === 'message' && Array.isArray(item.content)
                ? item.content.filter((part) => part?.type === 'output_text' && typeof part.text === 'string').map((part) => part.text) : []).join('\n')
              : parsed?.result;
            if (isModelProvider(profile) && (typeof output !== 'string' || !output.trim())) throw Object.assign(new Error('missing model output text'), { parserFailureClass: 'missing_output_text' });
            return output;
          },
        });
      } });
    } catch (error) {
      if (error?.code === 'PROVIDER_OUTPUT_QUARANTINED') throw error;
      if (['PROCESS_INSTANCE_PAUSED', 'PROVIDER_ATTEMPT_CANCELLED'].includes(error?.code)) throw error;
      if (error?.code === 'PROVIDER_OUTCOME_UNKNOWN') {
        const upstreamHttpStatus = error.upstreamHttpStatus;
        const transportFailureClass = allowlistedProviderTransportFailureClass(
          classifyProviderTransportFailure(error, { timedOut }) ?? error.transportFailureClass);
        const parserFailureClass = ['invalid_json', 'body_too_large', 'incomplete_response', 'missing_output_text', 'output_too_large'].includes(error.parserFailureClass)
          ? error.parserFailureClass : null;
        const providerDiagnostic = profile.dynamicDeepSeek && (Number.isInteger(upstreamHttpStatus) || parserFailureClass || transportFailureClass)
          ? { provider: 'deepseek', ...(Number.isInteger(upstreamHttpStatus) ? { httpStatus: upstreamHttpStatus } : {}), ...(parserFailureClass ? { parserFailureClass } : {}), ...(transportFailureClass ? { transportFailureClass } : {}) } : null;
        throw Object.assign(new Error('The provider may have received this request. This run will not send it again; check provider state before creating a new run.'), {
          code: 'PROVIDER_OUTCOME_UNKNOWN',
          ...(providerDiagnostic ? { providerDiagnostic } : {}),
        });
      }
      if (error?.code === 'SECRET_CREDENTIAL_EXPIRED') {
        throw Object.assign(new Error('The configured provider credential expired. Rotate it before running this task again.'), { code: 'CREDENTIAL_EXPIRED' });
      }
      if (active.cancelReason || controller.signal.aborted) throw Object.assign(new Error('Provider execution was canceled or timed out.'), { code: 'PROVIDER_REQUEST_CANCELED' });
      throw Object.assign(new Error('The configured provider could not complete this bounded request.'), { code: 'PROVIDER_REQUEST_FAILED' });
    } finally { clearTimeout(timeout); }
  }

  async #finalizeTerminal(run, { tenantId, principal, workerId, dispatchStarted, commandPrincipal, complete, failure, reason }) {
    const diagnostic = run.profile?.kind === 'provider-deepseek' && failure?.code === 'PROVIDER_OUTCOME_UNKNOWN'
      && failure.providerDiagnostic?.provider === 'deepseek'
      && ((Number.isInteger(failure.providerDiagnostic?.httpStatus) && failure.providerDiagnostic.httpStatus >= 100 && failure.providerDiagnostic.httpStatus <= 599)
        || ['invalid_json', 'body_too_large', 'incomplete_response', 'missing_output_text', 'output_too_large'].includes(failure.providerDiagnostic?.parserFailureClass)
        || allowlistedProviderTransportFailureClass(failure.providerDiagnostic?.transportFailureClass))
      ? { provider: 'deepseek', ...(Number.isInteger(failure.providerDiagnostic.httpStatus) ? { httpStatus: failure.providerDiagnostic.httpStatus } : {}), ...(failure.providerDiagnostic.parserFailureClass ? { parserFailureClass: failure.providerDiagnostic.parserFailureClass } : {}), ...(allowlistedProviderTransportFailureClass(failure.providerDiagnostic.transportFailureClass) ? { transportFailureClass: failure.providerDiagnostic.transportFailureClass } : {}) } : null;
    const build = (terminalStatus, execution, eventType, details) => {
      const candidate = structuredClone(run);
      candidate.status = terminalStatus;
      candidate.execution = execution;
      candidate.version += 1;
      executionEvent(candidate, eventType, commandPrincipal, details);
      return candidate;
    };
    const failed = () => build('FAILED', {
      status: 'FAILED', error: redact(failure?.message ?? 'Execution failed.'),
      completedAt: new Date().toISOString(), changedArtifacts: [],
      ...(diagnostic ? { providerDiagnostic: diagnostic } : {}),
    }, 'ExecutionFailed', {
      error: redact(failure?.message ?? 'Execution failed.'),
      ...(diagnostic ? { providerDiagnostic: diagnostic } : {}),
    });
    const interrupted = (interruptReason) => {
      const category = linkedRunOutcomeCategory(run, { status: 'INTERRUPTED', reason: interruptReason ?? reason ?? 'authorization_revoked' });
      const candidate = build('INTERRUPTED', {
        status: 'INTERRUPTED', error: redact(failure?.message ?? 'Execution authorization was revoked.'),
        completedAt: new Date().toISOString(), changedArtifacts: [],
      }, 'ExecutionInterrupted', {
        error: redact(failure?.message ?? 'Execution authorization was revoked.'), reason: interruptReason ?? reason ?? 'authorization_revoked',
      });
      if (category) candidate.linkedOutcomeCategory = category;
      return candidate;
    };
    const failedRun = () => {
      const candidate = failed();
      const category = linkedRunOutcomeCategory(run, { status: 'FAILED', errorCode: failure?.code });
      if (category) candidate.linkedOutcomeCategory = category;
      return candidate;
    };

    if (principal) {
      const finalized = await this.store.finalizeExecution({
        tenantId, projectId: run.projectId, principal, runId: run.id, workerId,
        expectedVersion: run.version, dispatchStarted, forceInterruptionReason: reason,
        complete: () => {
          if (!complete) return failedRun();
          const candidate = complete(structuredClone(run));
          if (candidate.status === 'FAILED') {
            const category = linkedRunOutcomeCategory(candidate, {
              status: 'FAILED', errorCode: failure?.code,
            });
            if (category) candidate.linkedOutcomeCategory = category;
          }
          candidate.version += 1;
          candidate.updatedAt = new Date().toISOString();
          return candidate;
        },
        interrupt: interrupted,
      });
      return finalized.run;
    }
    const candidate = complete ? complete(structuredClone(run)) : (reason ? interrupted(reason) : failedRun());
    if (complete && candidate.status === 'FAILED') {
      const category = linkedRunOutcomeCategory(candidate, { status: 'FAILED', errorCode: failure?.code });
      if (category) candidate.linkedOutcomeCategory = category;
    }
    await this.store.save(candidate, { expectedVersion: run.version });
    return candidate;
  }
}
