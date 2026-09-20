import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const RUN_ID = /^execution-run-[0-9a-f-]{36}$/;

export class ExecutionRunStore {
  constructor(rootDirectory) { this.rootDirectory = path.resolve(rootDirectory); }
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
    await this.init();
    const runs = [];
    for (const name of (await readdir(this.rootDirectory)).filter((entry) => entry.endsWith('.json')).sort()) {
      try {
        const run = JSON.parse(await readFile(path.join(this.rootDirectory, name), 'utf8'));
        if (run.tenantId === tenantId) runs.push(run);
      } catch { /* Isolate corrupt run records. */ }
    }
    return runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
  async save(run) {
    await this.init();
    const target = this.fileFor(run.id);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, target);
    return run;
  }
}
