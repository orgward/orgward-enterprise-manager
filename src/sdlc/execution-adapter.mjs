import { spawn } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { digest, now } from './contracts.mjs';

async function snapshot(root, relative = '', budget = { files: 0, bytes: 0 }) {
  const output = new Map();
  for (const name of await readdir(path.join(root, relative)).catch(() => [])) {
    if (name === '.orgward-context.json') continue;
    const child = path.join(relative, name);
    const info = await lstat(path.join(root, child));
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) {
      for (const [key, value] of await snapshot(root, child, budget)) output.set(key, value);
    } else if (info.isFile() && info.size <= 1_000_000) {
      budget.files += 1; budget.bytes += info.size;
      if (budget.files > 2_000 || budget.bytes > 25_000_000) throw new Error('Execution workspace exceeds the artifact inspection limit.');
      output.set(child, digest(await readFile(path.join(root, child))));
    }
  }
  return output;
}

export class CommandExecutionAdapter {
  constructor({ executable, args = [], timeoutMs = 30_000, name = 'command-coding-agent', version = '1.0.0', environment = {}, maxOutputBytes = 20_000 }) {
    if (!path.isAbsolute(executable)) throw new Error('Execution adapter executable must be an absolute path.');
    if (!Array.isArray(args) || args.some((entry) => typeof entry !== 'string')) throw new Error('Execution adapter arguments must be a fixed string array.');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 3_600_000) throw new Error('Execution adapter timeout is outside the supported range.');
    this.executable = executable;
    this.args = args;
    this.timeoutMs = timeoutMs;
    this.name = name;
    this.version = version;
    this.environment = Object.fromEntries(Object.entries(environment).map(([key, value]) => [String(key), String(value)]));
    this.maxOutputBytes = maxOutputBytes;
  }

  async execute(workItem, contextPackage, { workspace }) {
    const root = path.resolve(workspace);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const before = await snapshot(root);
    const contextPath = path.join(root, '.orgward-context.json');
    const context = { workItem, contextPackage, suppliedAt: now(), contentHash: digest({ workItem, contextPackage }) };
    await writeFile(contextPath, `${JSON.stringify(context, null, 2)}\n`, { mode: 0o600 });
    const startedAt = now();
    const result = await new Promise((resolve, reject) => {
      const child = spawn(this.executable, this.args, {
        cwd: root, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH ?? '', NODE_ENV: process.env.NODE_ENV ?? 'production', ...this.environment, ORGWARD_CONTEXT_PATH: contextPath },
      });
      let stdout = ''; let stderr = ''; let settled = false;
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Execution adapter timed out after ${this.timeoutMs}ms.`)); }, this.timeoutMs);
      child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-this.maxOutputBytes); });
      child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-this.maxOutputBytes); });
      child.on('error', (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
      child.on('close', (code, signal) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ code, signal, stdout, stderr }); } });
    });
    const after = await snapshot(root);
    const changedArtifacts = [...after].filter(([file, hash]) => before.get(file) !== hash).map(([file, contentHash]) => ({ path: file, contentHash }));
    return {
      adapter: { port: 'ExecutionPort', implementation: this.name, version: this.version },
      status: result.code === 0 ? 'COMPLETED' : 'FAILED', exitCode: result.code, signal: result.signal,
      startedAt, completedAt: now(), contextHash: context.contentHash, changedArtifacts,
      stdout: result.stdout, stderr: result.stderr, evidenceHash: digest({ code: result.code, changedArtifacts, contextHash: context.contentHash }),
    };
  }
}
