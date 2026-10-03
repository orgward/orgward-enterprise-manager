import { createHash } from 'node:crypto';
import { digest } from '../sdlc/contracts.mjs';
import { HttpReleaseAdapter } from './adapter.mjs';
import { parseReleaseEnvironments, releaseCandidateBinding, releaseFailure, validReleaseCommandId } from './contracts.mjs';

export class ReleaseService {
  constructor({ store, executionService, environments = [], fetchImpl = fetch }) {
    this.store = store; this.executionService = executionService; this.fetchImpl = fetchImpl;
    this.environments = parseReleaseEnvironments(environments);
  }
  #environment(context, id) {
    if (!this.store) throw releaseFailure('RELEASE_PERSISTENCE_REQUIRED', 'Protected releases require PostgreSQL persistence.', 503);
    const environment = this.environments.find((row) => row.tenantId === context.tenantId
      && row.projectId === context.projectId && row.id === id);
    if (!environment) throw releaseFailure('RELEASE_ENVIRONMENT_UNCONFIGURED', 'No protected release adapter and authority are configured for this environment.', 503);
    return environment;
  }
  #input(input, fields) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some((key) => !fields.includes(key)) || !validReleaseCommandId(input.commandId)) {
      throw releaseFailure('INVALID_RELEASE_COMMAND', 'Provide only the accepted protected release command fields and a stable commandId.', 400);
    }
  }
  #hash(context, input) { return digest({ principal: context.principal, input }); }
  async #candidate(context, runId) {
    if (!/^execution-run-[0-9a-f-]{36}$/.test(runId ?? '')) throw releaseFailure('INVALID_RELEASE_CANDIDATE', 'Select a saved exact GitHub candidate run.', 400);
    const raw = await this.executionService.store.withPrincipalAuthority({ id: runId, tenantId: context.tenantId,
      principal: context.principal, authzGeneration: context.authzGeneration,
      anyPrincipalRoleGroups: [['workspace-read', 'workspace-write', 'tenant-admin']], operation: (run) => run });
    if (!raw || raw.projectId !== context.projectId) throw releaseFailure('RELEASE_CANDIDATE_NOT_FOUND', 'The candidate was not found in this project.', 404);
    return releaseCandidateBinding(raw);
  }
  async #outputs(context, candidate) {
    const current = await this.#candidate(context, candidate.runId);
    if (digest(current) !== digest(candidate)) throw releaseFailure('RELEASE_CANDIDATE_STALE', 'The saved exact candidate changed. Request fresh approval.');
    const outputs = [];
    let total = 0;
    for (const file of candidate.outputManifest) {
      const sets = [];
      for (const artifactSetId of candidate.artifactSetIds) {
        const artifact = await this.executionService.readArtifact(candidate.runId, context.tenantId, context.principal,
          `builds/${artifactSetId}/${file.path}`, { authzGeneration: context.authzGeneration });
        if (!artifact || artifact.contents.length !== file.size || artifact.contentHash !== file.sha256
          || createHash('sha256').update(artifact.contents).digest('hex') !== file.sha256) {
          throw releaseFailure('RELEASE_OUTPUT_UNAVAILABLE', 'An approved build output is unavailable or failed its content hash check.');
        }
        sets.push(artifact.contents);
      }
      if (sets.length !== 2 || !sets[0].equals(sets[1])) throw releaseFailure('RELEASE_OUTPUT_MISMATCH', 'The two saved build output byte sets no longer match.');
      total += sets[0].length;
      if (total > 8_000_000) throw releaseFailure('RELEASE_OUTPUT_TOO_LARGE', 'The release output set exceeds the bounded transfer limit.', 413);
      outputs.push({ ...file, contentBase64: sets[0].toString('base64') });
    }
    return outputs;
  }
  async list(context, roles = []) {
    const environments = this.environments.filter((row) => row.tenantId === context.tenantId && row.projectId === context.projectId);
    // The API checks project access even when there is no configured environment.
    if (!this.store) return { available: false, environments: [] };
    if (!environments.length) await this.store.list(context, '__unconfigured__');
    const result = [];
    for (const environment of environments) {
      const saved = await this.store.list(context, environment.id);
      result.push({ id: environment.id, label: environment.label, assetIds: environment.assetIds,
        riskClass: environment.riskClass, actionsAllowed: environment.actions, configurationHash: environment.configurationHash,
        ...saved, permissions: { request: roles.includes('workspace-write') && environment.authority.requesters.includes(context.principal),
          approve: roles.includes('release-approver') && environment.authority.approvers.includes(context.principal),
          execute: roles.includes('workspace-write') && environment.authority.executors.includes(context.principal) } });
    }
    return { available: environments.length > 0, environments: result };
  }
  async create(context, input) {
    this.#input(input, ['commandId', 'environmentId', 'kind', 'runId', 'reason', 'expectedGeneration']);
    if (!['release', 'rollback'].includes(input.kind) || !Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 0
      || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500
      || (input.kind === 'rollback' && Object.hasOwn(input, 'runId'))) {
      throw releaseFailure('INVALID_RELEASE_COMMAND', 'Provide the action, reviewed reason and current environment generation. Rollback uses its saved previous candidate.', 400);
    }
    const environment = this.#environment(context, input.environmentId);
    const payloadHash = this.#hash(context, input);
    const replay = await this.store.replayCommand(context, environment, 'create', 'request', input.commandId, payloadHash);
    if (replay) return replay;
    const saved = input.kind === 'rollback' ? await this.store.list(context, environment.id) : null;
    const pending = saved?.actions.find((action) => action.id === saved.state.pendingActionId);
    const knownUnhealthy = pending?.status === 'UNHEALTHY' && pending.observations.at(-1)?.status === 'APPLIED'
      && pending.observations.at(-1)?.health === 'unhealthy';
    const rollbackTarget = knownUnhealthy ? saved.state.current : saved?.state.previous;
    if (input.kind === 'rollback' && !rollbackTarget) throw releaseFailure('RELEASE_ROLLBACK_UNAVAILABLE', 'No successful candidate is available for this rollback.');
    const candidate = input.kind === 'rollback' ? rollbackTarget : await this.#candidate(context, input.runId);
    await this.#outputs(context, candidate);
    return this.store.create(context, environment, { ...input, reason: input.reason.trim() }, candidate, payloadHash);
  }
  async command(context, actionId, operation, input) {
    this.#input(input, ['commandId', 'expectedVersion', 'requestHash']);
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 || !/^[a-f0-9]{64}$/.test(input.requestHash ?? '')) {
      throw releaseFailure('INVALID_RELEASE_COMMAND', 'Review the exact request hash and supply its current action version.', 400);
    }
    const saved = await this.store?.read(context, actionId);
    if (!saved) throw releaseFailure('RELEASE_ACTION_NOT_FOUND', 'The protected release action was not found.', 404);
    const environment = this.#environment(context, saved.request.environment.id);
    const payloadHash = this.#hash(context, input);
    if (operation === 'approve') return this.store.approve(context, environment, actionId, input, payloadHash);
    if (operation === 'execute') {
      const outputs = saved.status === 'APPROVED' ? await this.#outputs(context, saved.request.candidate) : null;
      const claimed = await this.store.claim(context, environment, actionId, input, payloadHash);
      if (claimed.replayed) return claimed;
      const adapter = new HttpReleaseAdapter(environment.adapter, this.fetchImpl);
      const observation = await adapter.execute(claimed.action, outputs);
      return this.store.settle({ tenantId: context.tenantId, projectId: context.projectId }, actionId,
        claimed.action.dispatch.id, observation);
    }
    if (operation === 'reconcile') {
      const replay = await this.store.replayCommand(context, environment, `reconcile:${actionId}`, 'execute', input.commandId, payloadHash);
      if (replay) return replay;
      await this.store.read(context, actionId, environment, 'execute');
      if (!saved.dispatch || saved.requestHash !== input.requestHash || saved.version !== input.expectedVersion
        || saved.request.environment.configurationHash !== environment.configurationHash) {
        throw releaseFailure('RELEASE_RECONCILIATION_STALE', 'Reload the exact saved dispatch before reconciling its outcome.');
      }
      if (['SUCCEEDED', 'FAILED', 'RECOVERED'].includes(saved.status)) return { action: saved, replayed: true };
      const observation = await new HttpReleaseAdapter(environment.adapter, this.fetchImpl).reconcile(saved);
      return this.store.settle(context, actionId, saved.dispatch.id, observation,
        { commandId: input.commandId, payloadHash }, environment);
    }
    throw releaseFailure('INVALID_RELEASE_COMMAND', 'This protected release action is unavailable.', 400);
  }
}
