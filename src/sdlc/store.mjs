import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CASE_ID = /^change-case-[0-9a-f-]{36}$/;

export class ChangeCaseStore {
  constructor(rootDirectory, { projectAccessResolver = null } = {}) {
    this.rootDirectory = path.resolve(rootDirectory);
    this.writeQueue = Promise.resolve();
    this.projectAccessResolver = projectAccessResolver;
  }

  setProjectAccessResolver(resolver) { this.projectAccessResolver = resolver; }

  async canAccessProject(tenantId, projectId, principal, minimum = 'reader') {
    return typeof this.projectAccessResolver === 'function'
      && this.projectAccessResolver({ tenantId, projectId, principal, minimum });
  }

  async init() {
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
  }

  fileFor(id) {
    if (!CASE_ID.test(id)) throw new Error('Invalid change case id.');
    return path.join(this.rootDirectory, `${id}.json`);
  }

  async list(tenantId = null) {
    return (await this.listWithDiagnostics(tenantId)).records;
  }

  async listWithDiagnostics(tenantId = null) {
    await this.init();
    const files = (await readdir(this.rootDirectory)).filter((name) => name.endsWith('.json')).sort();
    const cases = [];
    let corruptRecords = 0;
    for (const file of files) {
      try {
        const value = JSON.parse(await readFile(path.join(this.rootDirectory, file), 'utf8'));
        if (!tenantId || value.tenantId === tenantId) cases.push({ id: value.id, tenantId: value.tenantId, title: value.title, status: value.status, currentStage: value.currentStage, mutation: value.mutation, riskClass: value.riskClass, version: value.version, updatedAt: value.updatedAt });
      } catch {
        // Corrupt aggregates remain isolated from unrelated tenant cases.
        corruptRecords += 1;
      }
    }
    return { records: cases.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), corruptRecords };
  }

  async listForPrincipal(tenantId, principal) {
    const { records } = await this.listWithDiagnostics(tenantId);
    const visible = [];
    for (const summary of records) {
      const value = await this.get(summary.id);
      if (value?.projectId && await this.canAccessProject(tenantId, value.projectId, principal)) visible.push(summary);
    }
    return visible;
  }

  async get(id) {
    try { return JSON.parse(await readFile(this.fileFor(id), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  async getForPrincipal(id, tenantId, principal) {
    const value = await this.get(id);
    if (!value || value.tenantId !== tenantId || !value.projectId
      || !await this.canAccessProject(tenantId, value.projectId, principal)) return null;
    return value;
  }

  async save(changeCase, { expectedVersion = null, principal = null } = {}) {
    const prior = this.writeQueue;
    let release;
    this.writeQueue = new Promise((resolve) => { release = resolve; });
    await prior;
    try {
      if (principal && !await this.canAccessProject(changeCase.tenantId, changeCase.projectId, principal, 'editor')) {
        throw Object.assign(new Error('Project membership does not allow this action.'), { statusCode: 403, code: 'ACTION_FORBIDDEN' });
      }
      await this.init();
      const target = this.fileFor(changeCase.id);
      if (expectedVersion !== null) {
        let current;
        try { current = JSON.parse(await readFile(target, 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (current && current.projectId !== (changeCase.projectId ?? null)) {
          throw Object.assign(new Error('The aggregate project scope cannot be changed by this command.'), { statusCode: 409, code: 'PROJECT_SCOPE_CONFLICT' });
        }
        if (!current || current.version !== expectedVersion) {
          const error = new Error(`Version conflict: expected persisted version ${expectedVersion}. Reload the case before retrying.`);
          error.statusCode = 409;
          throw error;
        }
      }
      const temporary = `${target}.${process.pid}.${changeCase.version}.tmp`;
      await writeFile(temporary, `${JSON.stringify(changeCase, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, target);
      return changeCase;
    } finally {
      release();
    }
  }

  async saveForPrincipal(changeCase, { expectedVersion = null, principal } = {}) {
    if (!principal) {
      throw Object.assign(new Error('A verified principal is required for scoped SDLC writes.'), {
        statusCode: 403,
        code: 'ACTION_FORBIDDEN',
      });
    }
    return this.save(changeCase, { expectedVersion, principal });
  }
}
