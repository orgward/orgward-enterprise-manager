import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PROJECT_ID = /^project-[0-9a-f-]{36}$/;

export class ProjectStore {
  constructor(rootDirectory) {
    this.rootDirectory = path.resolve(rootDirectory);
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
  }

  fileFor(id) {
    if (!PROJECT_ID.test(id)) throw new Error('Invalid project id.');
    return path.join(this.rootDirectory, `${id}.json`);
  }

  async list(tenantId = null) {
    return (await this.listWithDiagnostics(tenantId)).records;
  }

  async listWithDiagnostics(tenantId = null) {
    await this.init();
    const files = (await readdir(this.rootDirectory)).filter((name) => name.endsWith('.json')).sort();
    const projects = [];
    let corruptRecords = 0;
    for (const file of files) {
      try {
        const project = JSON.parse(await readFile(path.join(this.rootDirectory, file), 'utf8'));
        const projectTenant = project.tenantId ?? 'tenant-reference-bank';
        if (tenantId && projectTenant !== tenantId) continue;
        projects.push({
          id: project.id,
          name: project.name,
          tenantId: projectTenant,
          version: project.version ?? 1,
          phase: project.phase,
          updatedAt: project.updatedAt,
          blueprintVersion: project.blueprintVersions?.at(-1)?.version ?? null,
        });
      } catch {
        // A corrupt record is isolated and not allowed to break unrelated projects.
        corruptRecords += 1;
      }
    }
    return { records: projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), corruptRecords };
  }

  async listWithDiagnosticsForPrincipal(tenantId, principal) {
    const result = await this.listWithDiagnostics(tenantId);
    const visible = [];
    for (const summary of result.records) {
      const project = await this.get(summary.id);
      if (project?.memberships?.some((member) => member.principal === principal && member.revokedAt === null)) visible.push(summary);
    }
    return { ...result, records: visible };
  }

  async listForPrincipal(tenantId, principal) {
    return (await this.listWithDiagnosticsForPrincipal(tenantId, principal)).records;
  }

  async getForPrincipal(id, tenantId, principal) {
    const project = await this.get(id);
    if (!project || (project.tenantId ?? 'tenant-reference-bank') !== tenantId
      || !project.memberships?.some((member) => member.principal === principal && member.revokedAt === null)) return null;
    return project;
  }

  async get(id) {
    try {
      return JSON.parse(await readFile(this.fileFor(id), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async withWriteLock(operation) {
    const prior = this.writeQueue;
    let release;
    this.writeQueue = new Promise((resolve) => { release = resolve; });
    await prior;
    try { return await operation(); }
    finally { release(); }
  }

  async write(project) {
    await this.init();
    const target = this.fileFor(project.id);
    const temporary = `${target}.${process.pid}.${project.version ?? 0}.tmp`;
    await writeFile(temporary, `${JSON.stringify(project, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, target);
  }

  async save(project) {
    return this.withWriteLock(async () => {
      await this.write(project);
      return project;
    });
  }

  async createWithCommand(project, commandId, payloadHash, principal = project.createdBy) {
    return this.withWriteLock(async () => {
      await this.init();
      const files = (await readdir(this.rootDirectory)).filter((name) => name.endsWith('.json'));
      for (const file of files) {
        let existing;
        try { existing = JSON.parse(await readFile(path.join(this.rootDirectory, file), 'utf8')); }
        catch {
          const error = new Error('Project storage contains an unreadable record; creation is paused to protect command idempotency.');
          error.statusCode = 503;
          error.code = 'PERSISTENCE_INTEGRITY';
          error.retryable = false;
          error.recoveryActions = [{ type: 'operator_repair', label: 'Ask an operator to repair storage' }];
          throw error;
        }
        if ((existing.tenantId ?? 'tenant-reference-bank') !== project.tenantId) continue;
        const prior = existing.commandRecords?.[commandId];
        if (!prior) continue;
        if (prior.payloadHash !== payloadHash) {
          const error = new Error('This command ID was already used with different input.');
          error.statusCode = 409;
          error.code = 'IDEMPOTENCY_CONFLICT';
          error.currentVersion = existing.version ?? 1;
          throw error;
        }
        const priorProject = await this.get(existing.id);
        if (!priorProject?.memberships?.some((member) => member.principal === principal && member.revokedAt === null)) return null;
        return { project: structuredClone(prior.result), replayed: true };
      }
      project.memberships = [{ principal, access: 'owner', generation: 1, grantedAt: new Date().toISOString(), revokedAt: null }];
      project.commandRecords ??= {};
      project.commandRecords[commandId] = { payloadHash, result: this.commandSnapshot(project) };
      await this.write(project);
      return { project, replayed: false };
    });
  }

  async createWithCommandForPrincipal(project, commandId, payloadHash, principal) {
    if (!principal || principal !== project.createdBy) {
      throw Object.assign(new Error('A verified project creator is required.'), { statusCode: 403, code: 'ACTION_FORBIDDEN' });
    }
    return this.createWithCommand(project, commandId, payloadHash, principal);
  }

  async updateWithCommand(id, tenantId, { commandId, operation = 'project.record-answer', payloadHash, expectedVersion, principal = null, apply }) {
    return this.withWriteLock(async () => {
      let project;
      try { project = JSON.parse(await readFile(this.fileFor(id), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      if ((project.tenantId ?? 'tenant-reference-bank') !== tenantId) return null;
      const membership = principal ? project.memberships?.find((member) => member.principal === principal && member.revokedAt === null) : null;
      if (principal && !membership) return null;
      if (membership && !['owner', 'editor'].includes(membership.access)) {
        const error = new Error('Project membership does not allow this action.');
        error.statusCode = 403;
        error.code = 'ACTION_FORBIDDEN';
        throw error;
      }
      project.commandRecords ??= {};
      const recordId = operation === 'project.record-answer' ? commandId : `@${operation}:${commandId}`;
      const prior = project.commandRecords[recordId];
      if (prior) {
        if (prior.payloadHash !== payloadHash) {
          const error = new Error('This command ID was already used with different input.');
          error.statusCode = 409;
          error.code = 'IDEMPOTENCY_CONFLICT';
          error.currentVersion = project.version ?? 1;
          throw error;
        }
        return { project: structuredClone(prior.result), replayed: true };
      }
      const currentVersion = project.version ?? 1;
      if (expectedVersion !== currentVersion) {
        const error = new Error(`Version conflict: the current version is ${currentVersion}. Reload before retrying.`);
        error.statusCode = 409;
        error.code = 'VERSION_CONFLICT';
        error.currentVersion = currentVersion;
        error.retryable = true;
        error.recoveryActions = [{ type: 'reload', label: 'Reload current version' }, { type: 'retry', label: 'Retry with retained input' }];
        throw error;
      }
      await apply(project);
      project.commandRecords[recordId] = { payloadHash, result: this.commandSnapshot(project) };
      await this.write(project);
      return { project, replayed: false };
    });
  }

  async updateWithCommandForPrincipal(id, tenantId, command, principal) {
    if (!principal) {
      throw Object.assign(new Error('A verified project member is required.'), { statusCode: 403, code: 'ACTION_FORBIDDEN' });
    }
    return this.updateWithCommand(id, tenantId, { ...command, principal });
  }

  async listMembers(tenantId, projectId, actor, { operation = null } = {}) {
    const project = await this.get(projectId);
    if (!project || (project.tenantId ?? 'tenant-reference-bank') !== tenantId
      || !project.memberships?.some((member) => member.principal === actor && member.revokedAt === null
        && ['owner', 'editor'].includes(member.access))) return null;
    const members = project.memberships.filter((member) => member.revokedAt === null).map((member) => ({
      principal: member.principal, displayName: member.principal, actorType: 'human', access: member.access,
      generation: member.generation, grantedAt: member.grantedAt,
    }));
    return operation ? operation(members) : members;
  }

  commandSnapshot(project) {
    const { commandRecords: _commandRecords, ...snapshot } = project;
    return structuredClone(snapshot);
  }
}
