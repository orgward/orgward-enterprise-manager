import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const RUN_ID = /^execution-run-[0-9a-f-]{36}$/;

export class ExecutionRunStore {
  constructor(rootDirectory, { projectAccessResolver = null } = {}) {
    this.rootDirectory = path.resolve(rootDirectory);
    this.projectAccessResolver = projectAccessResolver;
    this.writeQueue = Promise.resolve();
  }
  setProjectAccessResolver(resolver) { this.projectAccessResolver = resolver; }
  async canAccessProject(tenantId, projectId, principal, minimum = 'reader') {
    return typeof this.projectAccessResolver === 'function'
      && this.projectAccessResolver({ tenantId, projectId, principal, minimum });
  }
  async init() { await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 }); }
  fileFor(id) {
    if (!RUN_ID.test(id)) throw new Error('Invalid execution run id.');
    return path.join(this.rootDirectory, `${id}.json`);
  }
  async get(id) {
    try { return JSON.parse(await readFile(this.fileFor(id), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async list(tenantId) {
    return (await this.listWithDiagnostics(tenantId)).records;
  }
  async listWithDiagnostics(tenantId) {
    await this.init();
    const runs = [];
    let corruptRecords = 0;
    for (const name of (await readdir(this.rootDirectory)).filter((entry) => entry.endsWith('.json')).sort()) {
      try {
        const run = JSON.parse(await readFile(path.join(this.rootDirectory, name), 'utf8'));
        if (run.tenantId === tenantId) runs.push(run);
      } catch { corruptRecords += 1; /* Isolate corrupt run records. */ }
    }
    return { records: runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), corruptRecords };
  }
  async listForPrincipal(tenantId, principal) {
    const { records } = await this.listWithDiagnostics(tenantId);
    const visible = [];
    for (const run of records) {
      if (run.projectId && await this.canAccessProject(tenantId, run.projectId, principal)) visible.push(run);
    }
    return visible;
  }
  async getForPrincipal(id, tenantId, principal) {
    const run = await this.get(id);
    if (!run || run.tenantId !== tenantId || !run.projectId
      || !await this.canAccessProject(tenantId, run.projectId, principal)) return null;
    return run;
  }
  async all() {
    await this.init();
    const runs = [];
    for (const name of (await readdir(this.rootDirectory)).filter((entry) => entry.endsWith('.json')).sort()) {
      try { runs.push(JSON.parse(await readFile(path.join(this.rootDirectory, name), 'utf8'))); }
      catch { /* Isolate corrupt run records. */ }
    }
    return runs;
  }
  async save(run, { expectedVersion = null, principal = null } = {}) {
    const prior = this.writeQueue;
    let release;
    this.writeQueue = new Promise((resolve) => { release = resolve; });
    await prior;
    try {
      if (principal && !await this.canAccessProject(run.tenantId, run.projectId, principal, 'editor')) {
        throw Object.assign(new Error('Project membership does not allow this action.'), { statusCode: 403, code: 'ACTION_FORBIDDEN' });
      }
      await this.init();
      const target = this.fileFor(run.id);
      if (expectedVersion !== null) {
        let current;
        try { current = JSON.parse(await readFile(target, 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (!current || current.version !== expectedVersion) {
          throw Object.assign(new Error(`Version conflict: expected persisted version ${expectedVersion}.`), { statusCode: 409 });
        }
        if (current.projectId !== (run.projectId ?? null)) {
          throw Object.assign(new Error('The aggregate project scope cannot be changed by this command.'), { statusCode: 409, code: 'PROJECT_SCOPE_CONFLICT' });
        }
      }
      const temporary = `${target}.${process.pid}.${run.version}.tmp`;
      await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, target);
      return run;
    } finally { release(); }
  }
  async saveForPrincipal(run, { expectedVersion = null, principal } = {}) {
    if (!principal) throw Object.assign(new Error('A verified principal is required for scoped execution writes.'), { statusCode: 403, code: 'ACTION_FORBIDDEN' });
    return this.save(run, { expectedVersion, principal });
  }
  async authorizeExecutionDispatch({ tenantId, projectId, principal, start }) {
    if (!await this.canAccessProject(tenantId, projectId, principal, 'editor')) {
      throw Object.assign(new Error('Project membership does not allow execution dispatch.'), { statusCode: 403, code: 'ACTION_FORBIDDEN' });
    }
    return start();
  }
}
