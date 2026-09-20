import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PROJECT_ID = /^project-[0-9a-f-]{36}$/;

export class ProjectStore {
  constructor(rootDirectory) {
    this.rootDirectory = path.resolve(rootDirectory);
  }

  async init() {
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
  }

  fileFor(id) {
    if (!PROJECT_ID.test(id)) throw new Error('Invalid project id.');
    return path.join(this.rootDirectory, `${id}.json`);
  }

  async list() {
    await this.init();
    const files = (await readdir(this.rootDirectory)).filter((name) => name.endsWith('.json')).sort();
    const projects = [];
    for (const file of files) {
      try {
        const project = JSON.parse(await readFile(path.join(this.rootDirectory, file), 'utf8'));
        projects.push({
          id: project.id,
          name: project.name,
          phase: project.phase,
          updatedAt: project.updatedAt,
          blueprintVersion: project.blueprintVersions?.at(-1)?.version ?? null,
        });
      } catch {
        // A corrupt record is isolated and not allowed to break unrelated projects.
      }
    }
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id) {
    try {
      return JSON.parse(await readFile(this.fileFor(id), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async save(project) {
    await this.init();
    const target = this.fileFor(project.id);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(project, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, target);
    return project;
  }
}
