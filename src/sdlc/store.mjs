import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CASE_ID = /^change-case-[0-9a-f-]{36}$/;

export class ChangeCaseStore {
  constructor(rootDirectory) {
    this.rootDirectory = path.resolve(rootDirectory);
  }

  async init() {
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
  }

  fileFor(id) {
    if (!CASE_ID.test(id)) throw new Error('Invalid change case id.');
    return path.join(this.rootDirectory, `${id}.json`);
  }

  async list(tenantId = null) {
    await this.init();
    const files = (await readdir(this.rootDirectory)).filter((name) => name.endsWith('.json')).sort();
    const cases = [];
    for (const file of files) {
      try {
        const value = JSON.parse(await readFile(path.join(this.rootDirectory, file), 'utf8'));
        if (!tenantId || value.tenantId === tenantId) cases.push({ id: value.id, tenantId: value.tenantId, title: value.title, status: value.status, currentStage: value.currentStage, mutation: value.mutation, riskClass: value.riskClass, version: value.version, updatedAt: value.updatedAt });
      } catch {
        // Corrupt aggregates remain isolated from unrelated tenant cases.
      }
    }
    return cases.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id) {
    try { return JSON.parse(await readFile(this.fileFor(id), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  async save(changeCase) {
    await this.init();
    const target = this.fileFor(changeCase.id);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(changeCase, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, target);
    return changeCase;
  }
}
