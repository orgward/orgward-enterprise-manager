import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { digest } from '../sdlc/contracts.mjs';
import { CommandExecutionAdapter } from '../sdlc/execution-adapter.mjs';
import { approveExecutionRun, createExecutionRun, executionEvent, executionRunView } from './contracts.mjs';
import { ExecutionRunStore } from './store.mjs';

function validateProfile(profile) {
  if (!/^[a-z0-9][a-z0-9_-]{1,79}$/i.test(profile.id ?? '')) throw new Error('Execution profile id is invalid.');
  if (!path.isAbsolute(profile.executable ?? '')) throw new Error(`Execution profile ${profile.id} must use an absolute executable.`);
  if (!path.isAbsolute(profile.workspaceRoot ?? '')) throw new Error(`Execution profile ${profile.id} must use an absolute workspace root.`);
  return {
    id: profile.id, label: String(profile.label ?? profile.id), description: String(profile.description ?? ''),
    kind: String(profile.kind ?? 'command'), version: String(profile.version ?? '1.0.0'), executable: profile.executable,
    args: [...(profile.args ?? [])], workspaceRoot: path.resolve(profile.workspaceRoot), timeoutMs: profile.timeoutMs ?? 120_000,
    environment: { ...(profile.environment ?? {}) },
  };
}

function publicProfile(profile) {
  return { id: profile.id, label: profile.label, description: profile.description, kind: profile.kind, version: profile.version, approvalRequired: true };
}

function redact(value) {
  return String(value ?? '').replace(/(bearer\s+)[a-z0-9._~+\/-]+/gi, '$1[REDACTED]').replace(/(api[_-]?key|token|secret|password)\s*[=:]\s*\S+/gi, '$1=[REDACTED]');
}

export class ExecutionService {
  constructor({ runDirectory, profiles = [] }) {
    this.store = new ExecutionRunStore(runDirectory);
    this.profiles = new Map(profiles.map((profile) => { const valid = validateProfile(profile); return [valid.id, valid]; }));
    this.active = new Set();
  }
  async init() {
    await this.store.init();
    for (const run of await this.store.all()) {
      if (run.status !== 'RUNNING') continue;
      run.status = 'INTERRUPTED'; run.version += 1;
      executionEvent(run, 'ExecutionInterrupted', 'execution-recovery', { reason: 'Control plane restarted while the run was active.' });
      await this.store.save(run);
    }
  }
  capabilities() { return [...this.profiles.values()].map(publicProfile); }
  async list(tenantId) { return (await this.store.list(tenantId)).map(executionRunView); }
  async get(id, tenantId) {
    const run = await this.store.get(id);
    if (!run || run.tenantId !== tenantId) return null;
    return executionRunView(run);
  }
  async create(input) {
    const profile = this.profiles.get(input.profileId);
    const run = createExecutionRun({ ...input, profile });
    await this.store.save(run);
    return executionRunView(run);
  }
  async approve(id, tenantId, command) {
    const run = await this.store.get(id);
    if (!run || run.tenantId !== tenantId) return null;
    if (command.version !== run.version) throw Object.assign(new Error(`Version conflict: expected ${run.version}.`), { statusCode: 409 });
    approveExecutionRun(run, command);
    await this.store.save(run);
    return executionRunView(run);
  }
  async execute(id, tenantId, command) {
    const run = await this.store.get(id);
    if (!run || run.tenantId !== tenantId) return null;
    if (command.version !== run.version) throw Object.assign(new Error(`Version conflict: expected ${run.version}.`), { statusCode: 409 });
    if (run.status !== 'APPROVED') throw new Error('Execution run must be approved before it can execute.');
    if (run.approval.requestHash !== digest(run.workItem)) throw new Error('Approved request no longer matches the work item.');
    if (this.active.has(id)) throw Object.assign(new Error('Execution run is already active.'), { statusCode: 409 });
    const profile = this.profiles.get(run.profile.id);
    if (!profile) throw new Error('The approved execution profile is no longer available.');
    this.active.add(id);
    run.status = 'RUNNING'; run.version += 1;
    executionEvent(run, 'ExecutionStarted', command.principal ?? 'execution-worker', { profileId: profile.id });
    await this.store.save(run);
    try {
      const workspace = path.resolve(path.join(profile.workspaceRoot, run.id));
      if (!workspace.startsWith(`${profile.workspaceRoot}${path.sep}`)) throw new Error('Execution workspace escaped the configured root.');
      await mkdir(workspace, { recursive: true, mode: 0o700 });
      const adapter = new CommandExecutionAdapter({ executable: profile.executable, args: profile.args, timeoutMs: profile.timeoutMs, name: profile.id, version: profile.version, environment: profile.environment });
      const result = await adapter.execute(
        { id: run.workItem.id, objective: run.workItem.objective, acceptanceCriteria: run.workItem.requirements },
        { id: run.id, requirements: run.workItem.requirements, sourceRefs: run.workItem.sourceRefs, approval: run.approval },
        { workspace },
      );
      run.execution = { ...result, stdout: redact(result.stdout), stderr: redact(result.stderr), workspace };
      run.status = result.status === 'COMPLETED' ? 'SUCCEEDED' : 'FAILED';
      executionEvent(run, run.status === 'SUCCEEDED' ? 'ExecutionSucceeded' : 'ExecutionFailed', command.principal ?? 'execution-worker', { evidenceHash: result.evidenceHash, exitCode: result.exitCode });
    } catch (error) {
      run.status = 'FAILED';
      run.execution = { status: 'FAILED', error: redact(error.message), completedAt: new Date().toISOString(), changedArtifacts: [] };
      executionEvent(run, 'ExecutionFailed', command.principal ?? 'execution-worker', { error: run.execution.error });
    } finally {
      run.version += 1;
      await this.store.save(run);
      this.active.delete(id);
    }
    return executionRunView(run);
  }
}
