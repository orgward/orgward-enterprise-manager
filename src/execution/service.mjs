import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { digest } from '../sdlc/contracts.mjs';
import { CommandExecutionAdapter } from '../sdlc/execution-adapter.mjs';
import { readWorkspaceArtifact } from './artifact-file.mjs';
import { buildBlueprintProposalPrompt, createGeneratedBlueprintProposal, createProcessTaskProposalContext } from './proposals.mjs';
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
  const result = new Promise((resolve, reject) => {
    request.once('response', async (response) => {
      try {
        if (response.statusCode < 200 || response.statusCode >= 300) throw new Error('provider rejected request');
        const chunks = []; let size = 0;
        for await (const chunk of response) {
          size += chunk.length;
          if (size > 32_768) { response.destroy(); throw new Error('provider response too large'); }
          chunks.push(chunk);
        }
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const output = parseResponse(parsed);
        if (typeof output !== 'string' || !output.trim() || Buffer.byteLength(output) > 8_000) throw new Error('invalid provider result');
        resolve(output);
      } catch (error) { reject(error); }
    });
    request.once('error', reject);
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
  if (!provider && !openAiProvider && (!path.isAbsolute(profile.executable ?? '') || !path.isAbsolute(profile.workspaceRoot ?? ''))) throw new Error(`Execution profile ${profile.id} must use an absolute executable and workspace root.`);
  let providerEndpoint = null;
  if (provider || openAiProvider) {
    if (openAiProvider) {
      if (profile.executable != null || (profile.args?.length ?? 0) || profile.workspaceRoot != null
        || Object.keys(profile.environment ?? {}).length || !/^secret-[a-z0-9][a-z0-9._-]{0,79}$/.test(profile.credentialReference ?? '')
        || !/^[A-Za-z0-9._:-]{1,100}$/.test(profile.model ?? '')) throw new Error(`Execution profile ${profile.id} has invalid OpenAI profile configuration.`);
      let endpoint;
      try { endpoint = new URL(profile.openAiEndpoint ?? 'https://api.openai.com/v1/responses'); } catch { throw new Error(`Execution profile ${profile.id} has invalid OpenAI endpoint configuration.`); }
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
      if ((endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback)) || endpoint.username || endpoint.password
        || endpoint.search || endpoint.hash || endpoint.pathname !== '/v1/responses'
        || (!loopback && endpoint.hostname !== 'api.openai.com')) throw new Error(`Execution profile ${profile.id} must use api.openai.com (loopback is test-only).`);
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
  if (!openAiProvider && (((profile.credentialReference == null) !== (profile.credentialVersion == null))
    || (profile.credentialReference != null && (!/^secret-[a-z0-9][a-z0-9._-]{0,79}$/.test(profile.credentialReference) || !Number.isSafeInteger(profile.credentialVersion) || profile.credentialVersion < 1)))) {
    throw new Error(`Execution profile ${profile.id} has an invalid approved credential binding.`);
  }
  return {
    id: profile.id, label: String(profile.label ?? profile.id), description: String(profile.description ?? ''),
    kind: String(profile.kind ?? 'command'), version: String(profile.version ?? '1.0.0'), executable: profile.executable,
    args: [...(profile.args ?? [])], workspaceRoot: profile.workspaceRoot ? path.resolve(profile.workspaceRoot) : null,
    timeoutMs: profile.timeoutMs ?? (provider || openAiProvider ? 20_000 : 120_000),
    environment: { ...(profile.environment ?? {}) },
    credentialReference: profile.credentialReference ?? null,
    credentialVersion: profile.credentialVersion ?? null,
    providerEndpoint,
    dynamicOpenAi: openAiProvider,
    model: openAiProvider ? profile.model : null,
    sandbox: {
      executable: profile.sandbox?.executable ?? '/usr/bin/bwrap',
      readOnlyFiles: [...(profile.sandbox?.readOnlyFiles ?? [])],
      allowedEnvironment: [...(profile.sandbox?.allowedEnvironment ?? [])],
    },
  };
}

function publicProfile(profile) {
  return { id: profile.id, label: profile.label, description: profile.description, kind: profile.kind, version: profile.version, approvalRequired: true };
}

function redact(value) {
  return String(value ?? '').replace(/(bearer\s+)[a-z0-9._~+\/-]+/gi, '$1[REDACTED]').replace(/(api[_-]?key|token|secret|password)\s*[=:]\s*\S+/gi, '$1=[REDACTED]');
}

export class ExecutionService {
  constructor({ runDirectory, store = null, profiles = [], secretStore = null, commandAdapterFactory = (options) => new CommandExecutionAdapter(options) }) {
    this.store = store ?? new ExecutionRunStore(runDirectory);
    this.secretStore = secretStore;
    this.commandAdapterFactory = commandAdapterFactory;
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
      const persistedVersion = run.version;
      run.status = 'INTERRUPTED'; run.version += 1;
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
    let profile = this.profiles.get(input.profileId);
    if (!profile) throw Object.assign(new Error('Choose an available configured execution profile.'), { statusCode: 400, code: 'EXECUTION_PROFILE_NOT_FOUND' });
    if (profile.dynamicOpenAi && (!this.secretStore || !input.tenantId)) {
      throw Object.assign(new Error('OpenAI profiles require the server-side credential broker.'), {
        statusCode: 503, code: 'BROKER_AUTHORITY_REQUIRED', retryable: false,
      });
    }
    const requestHash = digest({
      projectId: input.projectId, planId: input.planId, revision: input.revision,
      planInstanceId: input.planInstanceId ?? null, taskId: input.taskId, profileId: input.profileId,
      ...(profile.dynamicOpenAi ? {
        profileSnapshot: {
          kind: profile.kind, version: profile.version,
          credentialReference: profile.credentialReference,
          model: profile.model,
          providerEndpoint: profile.providerEndpoint,
        },
      } : {}),
    });
    const result = await this.store.createForProcessTask({
      tenantId: input.tenantId, projectId: input.projectId, principal: input.principal,
      authzGeneration: input.authzGeneration, planId: input.planId, revision: input.revision,
      planInstanceId: input.planInstanceId, taskId: input.taskId, commandId: input.commandId, requestHash,
      buildRun: async ({ project, plan, task, processTaskRef, client }) => {
        let runProfile = profile;
        let proposalContext = null;
        if (profile.dynamicOpenAi) {
          const binding = await this.secretStore.resolveOpenAiBinding({
            client, tenantId: input.tenantId, reference: profile.credentialReference, model: profile.model,
          });
          runProfile = { ...profile, credentialVersion: binding.version };
          const pinnedBlueprint = project.blueprintVersions?.find((candidate) => candidate.id === processTaskRef.blueprintId
            && candidate.version === processTaskRef.blueprintVersion);
          proposalContext = createProcessTaskProposalContext({ blueprint: pinnedBlueprint, task, processTaskRef });
        }
        return createExecutionRun({
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
        });
      },
    });
    return result ? { ...result, run: executionRunView(result.run) } : null;
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
      const profile = this.profiles.get(run.profile?.id);
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
    const profile = this.profiles.get(run.profile?.id);
    const validateCredentialBinding = profile?.dynamicOpenAi ? async (current, client) => {
      const credential = current.profile?.credential;
      const staleCredential = () => Object.assign(new Error('The OpenAI credential or profile changed before approval. Create a new execution request against the current binding.'), {
        statusCode: 409, code: 'EXECUTION_PROFILE_STALE', retryable: false,
      });
      if (!credential || credential.reference !== profile.credentialReference
        || current.profile?.providerModel !== profile.model || current.profile?.version !== profile.version
        || !this.secretStore || !client) {
        throw staleCredential();
      }
      let binding;
      try {
        binding = await this.secretStore.resolveOpenAiBinding({
          client, tenantId, reference: credential.reference, model: profile.model,
        });
      } catch {
        throw staleCredential();
      }
      if (binding.version !== credential.version) throw staleCredential();
    } : null;
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
    const profile = this.profiles.get(run.profile.id);
    if (!profile || profile.version !== run.profile.version) {
      throw Object.assign(new Error('The executor profile changed after approval. Create a new execution run against the current profile and approve it.'), {
        statusCode: 409, code: 'EXECUTION_PROFILE_STALE', retryable: false,
      });
    }
    if (profile.dynamicOpenAi && run.profile.providerModel !== profile.model) {
      throw Object.assign(new Error('The approved OpenAI model differs from the configured profile. Create a new execution run and approve the current model.'), { statusCode: 409, code: 'EXECUTION_PROFILE_STALE', retryable: false });
    }
    const configuredCredential = profile.credentialReference
      ? { reference: profile.credentialReference, version: profile.credentialVersion } : null;
    const approvedCredential = run.profile.credential ?? null;
    let dynamicBinding = null;
    if (profile.dynamicOpenAi && this.secretStore) {
      try { dynamicBinding = await this.secretStore.resolveOpenAiBinding({ tenantId, reference: profile.credentialReference, model: profile.model }); }
      catch { dynamicBinding = null; }
    }
    if ((configuredCredential?.reference ?? null) !== (approvedCredential?.reference ?? null)
      || (profile.dynamicOpenAi ? (dynamicBinding?.version ?? null) !== (approvedCredential?.version ?? null)
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
    if (run.profile.credential && profile.kind !== 'provider-http' && !profile.dynamicOpenAi) {
      throw Object.assign(new Error('This credential-bound profile has no broker-aware provider adapter; execution was not dispatched.'), {
        statusCode: 503, code: 'BROKER_PROVIDER_UNAVAILABLE', retryable: false,
      });
    }
    if (this.active.has(id)) throw Object.assign(new Error('Execution run is already active.'), { statusCode: 409 });
    const providerProfile = profile.kind === 'provider-http' || profile.dynamicOpenAi;
    const workerLeaseDurationMs = providerProfile ? PROVIDER_WORKER_LEASE_MS : WORKER_LEASE_MS;
    if (command.scopePrincipal
      && (typeof this.store.authorizeExecutionDispatch !== 'function'
        || typeof this.store.renewExecutionLease !== 'function'
        || typeof this.store.finalizeExecution !== 'function')) throw executionFenceUnavailable();
    if ((profile.kind === 'provider-http' || profile.dynamicOpenAi) && (!command.scopePrincipal || !this.secretStore)) {
      throw Object.assign(new Error('Provider execution requires current scoped authority and the server-side credential broker.'), { statusCode: 503, code: 'BROKER_AUTHORITY_REQUIRED', retryable: false });
    }
    const configuredProvider = profile.kind === 'provider-http' || profile.dynamicOpenAi ? profile.providerEndpoint : null;
    if ((run.profile.providerDestinationHash ?? null) !== (configuredProvider ? digest(configuredProvider) : null)) {
      throw Object.assign(new Error('The provider destination changed after approval. Create a new execution run and approve the current destination.'), { statusCode: 409, code: 'EXECUTION_PROFILE_STALE', retryable: false });
    }
    let settleActive;
    const active = {
      tenantId, projectId: run.projectId, principal: command.scopePrincipal ?? null,
      approvalPrincipal: run.approval?.principal ?? null,
      authzGeneration: command.authorityGeneration ?? null,
      workerId: randomUUID(), controller: new AbortController(), cancelReason: null, handle: null,
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
          });
          dispatchAcknowledged = true;
        } finally {
          if (dispatchAckTimer) clearTimeout(dispatchAckTimer);
          dispatchAckTimer = null;
          if (dispatchAcknowledged && dispatchLeaseTimer) {
            clearInterval(dispatchLeaseTimer);
            dispatchLeaseTimer = null;
          }
        }
      } else handle = await start();
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
      const result = await handle.result;
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
    const timeout = setTimeout(() => controller.abort(), Math.min(profile.timeoutMs ?? 20_000, 20_000));
    timeout.unref?.();
    try {
      return await this.useProviderCredential(run.id, { operation: ({ credential, signal }) => {
        const instructions = run.interventionRevisions?.at(-1) ?? run.workItem;
        const requestBody = profile.dynamicOpenAi
          ? { model: profile.model, input: run.workItem.proposalContext
            ? buildBlueprintProposalPrompt({ task: {
              id: run.processTaskRef.taskId, title: run.title, detail: instructions.objective,
            }, proposalContext: run.workItem.proposalContext, amendedRequirements: instructions.requirements })
            : `${instructions.objective}\n\nRequirements:\n${instructions.requirements.join('\n')}`,
          store: false, max_output_tokens: 2_000, tools: [] }
          : { objective: instructions.objective, requirements: instructions.requirements };
        return providerTransport(profile.providerEndpoint, {
          headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(requestBody), signal,
          parseResponse: (parsed) => {
            if (profile.dynamicOpenAi && parsed?.status !== 'completed') throw new Error('incomplete OpenAI response');
            return profile.dynamicOpenAi && Array.isArray(parsed?.output)
              ? parsed.output.flatMap((item) => item?.type === 'message' && Array.isArray(item.content)
                ? item.content.filter((part) => part?.type === 'output_text' && typeof part.text === 'string').map((part) => part.text) : []).join('\n')
              : parsed?.result;
          },
        });
      } });
    } catch (error) {
      if (error?.code === 'PROVIDER_OUTPUT_QUARANTINED') throw error;
      if (['PROCESS_INSTANCE_PAUSED', 'PROVIDER_ATTEMPT_CANCELLED'].includes(error?.code)) throw error;
      if (error?.code === 'PROVIDER_OUTCOME_UNKNOWN') {
        throw Object.assign(new Error('The provider may have received this request. This run will not send it again; check provider state before creating a new run.'), {
          code: 'PROVIDER_OUTCOME_UNKNOWN',
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
    }, 'ExecutionFailed', { error: redact(failure?.message ?? 'Execution failed.') });
    const interrupted = (interruptReason) => build('INTERRUPTED', {
      status: 'INTERRUPTED', error: redact(failure?.message ?? 'Execution authorization was revoked.'),
      completedAt: new Date().toISOString(), changedArtifacts: [],
    }, 'ExecutionInterrupted', {
      error: redact(failure?.message ?? 'Execution authorization was revoked.'), reason: interruptReason ?? reason ?? 'authorization_revoked',
    });

    if (principal) {
      const finalized = await this.store.finalizeExecution({
        tenantId, projectId: run.projectId, principal, runId: run.id, workerId,
        expectedVersion: run.version, dispatchStarted, forceInterruptionReason: reason,
        complete: () => {
          if (!complete) return failed();
          const candidate = complete(structuredClone(run));
          candidate.version += 1;
          candidate.updatedAt = new Date().toISOString();
          return candidate;
        },
        interrupt: interrupted,
      });
      return finalized.run;
    }
    const candidate = complete ? complete(structuredClone(run)) : (reason ? interrupted(reason) : failed());
    await this.store.save(candidate, { expectedVersion: run.version });
    return candidate;
  }
}
