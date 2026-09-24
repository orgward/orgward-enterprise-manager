import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, realpath, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { digest, now } from './contracts.mjs';

const READ_ONLY_RUNTIME_ROOTS = ['/usr', '/lib', '/lib64'];
const DEFAULT_BWRAP = '/usr/bin/bwrap';
const PROC_FD = '/proc/self/fd';
const MAX_ARTIFACT_BYTES = 1_000_000;
const MAX_ARTIFACT_FILES = 2_000;
const MAX_ARTIFACT_TOTAL_BYTES = 25_000_000;

async function readBounded(handle, limit) {
  const chunks = [];
  let total = 0;
  while (total <= limit) {
    const buffer = Buffer.alloc(Math.min(64 * 1024, limit + 1 - total));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, total);
    if (!bytesRead) break;
    total += bytesRead;
    if (total > limit) throw new Error('Execution workspace file exceeds the artifact limit.');
    chunks.push(buffer.subarray(0, bytesRead));
  }
  return Buffer.concat(chunks, total);
}

async function snapshot(directoryHandle, {
  openFile = open, readDirectory = readdir, lstatEntry = lstat,
} = {}, relative = '', budget = { files: 0, bytes: 0 }) {
  const output = new Map();
  const directoryPath = `${PROC_FD}/${directoryHandle.fd}`;
  const directoryFlags = fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW;
  const fileFlags = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;
  for (const name of await readDirectory(directoryPath)) {
    const child = path.join(relative, name);
    const childPath = `${directoryPath}/${name}`;
    const info = await lstatEntry(childPath);
    if (info.isSymbolicLink()) throw new Error(`Execution workspace contains a symbolic link: ${child}`);
    if (info.isDirectory()) {
      const childDirectory = await openFile(childPath, directoryFlags);
      try {
        if (!(await childDirectory.stat()).isDirectory()) throw new Error(`Execution workspace directory changed during inspection: ${child}`);
        for (const [key, value] of await snapshot(childDirectory, { openFile, readDirectory, lstatEntry }, child, budget)) output.set(key, value);
      } finally { await childDirectory.close(); }
    } else if (info.isFile()) {
      const file = await openFile(childPath, fileFlags);
      try {
        const openedInfo = await file.stat();
        if (!openedInfo.isFile() || openedInfo.nlink !== 1) throw new Error(`Execution workspace file changed during inspection: ${child}`);
        if (openedInfo.size > MAX_ARTIFACT_BYTES) throw new Error(`Execution workspace file exceeds the artifact limit: ${child}`);
        budget.files += 1; budget.bytes += openedInfo.size;
        if (budget.files > MAX_ARTIFACT_FILES || budget.bytes > MAX_ARTIFACT_TOTAL_BYTES) throw new Error('Execution workspace exceeds the artifact inspection limit.');
        const contents = await readBounded(file, MAX_ARTIFACT_BYTES);
        const afterReadInfo = await file.stat();
        if (afterReadInfo.dev !== openedInfo.dev || afterReadInfo.ino !== openedInfo.ino
          || afterReadInfo.size !== openedInfo.size || afterReadInfo.mtimeMs !== openedInfo.mtimeMs
          || afterReadInfo.ctimeMs !== openedInfo.ctimeMs) {
          throw new Error(`Execution workspace file changed during inspection: ${child}`);
        }
        budget.bytes += contents.length - openedInfo.size;
        if (budget.bytes > MAX_ARTIFACT_TOTAL_BYTES) throw new Error('Execution workspace exceeds the artifact inspection limit.');
        output.set(child.split(path.sep).join('/'), createHash('sha256').update(contents).digest('hex'));
      } finally { await file.close(); }
    }
  }
  return output;
}

function isVisibleRuntimePath(target) {
  return READ_ONLY_RUNTIME_ROOTS.some((root) => target === root || target.startsWith(`${root}${path.sep}`));
}

function addSandboxDirectories(args, targets) {
  const directories = new Set();
  for (const target of targets) {
    let current = '';
    const segments = path.resolve(target).split(path.sep).filter(Boolean);
    for (const segment of segments.slice(0, -1)) {
      current = path.join(current || path.sep, segment);
      if (!isVisibleRuntimePath(current)) directories.add(current);
    }
  }
  for (const directory of [...directories].sort((left, right) => left.length - right.length)) args.push('--dir', directory);
}

export class CommandExecutionAdapter {
  constructor({ executable, args = [], timeoutMs = 30_000, name = 'command-coding-agent', version = '1.0.0', environment = {}, maxOutputBytes = 20_000, sandbox = {}, snapshotFileSystem = {} }) {
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
    this.snapshotFileSystem = snapshotFileSystem;
    this.bwrapExecutable = sandbox.executable ?? DEFAULT_BWRAP;
    this.readOnlyFiles = [...new Set(sandbox.readOnlyFiles ?? [])];
    this.allowedEnvironment = new Set(sandbox.allowedEnvironment ?? []);
    if (!path.isAbsolute(this.bwrapExecutable) || this.readOnlyFiles.some((file) => !path.isAbsolute(file))) {
      throw new Error('Execution sandbox paths must be absolute.');
    }
    const unapprovedEnvironment = Object.keys(this.environment).filter((key) => !this.allowedEnvironment.has(key));
    if (unapprovedEnvironment.length) throw new Error(`Execution sandbox environment is not allowlisted: ${unapprovedEnvironment.join(', ')}.`);
  }

  async start(workItem, contextPackage, { workspace, signal } = {}) {
    if (process.platform !== 'linux') throw new Error('Isolated command execution requires Linux bubblewrap support.');
    const root = path.resolve(workspace);
    if (signal?.aborted) throw Object.assign(new Error('Execution dispatch was cancelled before start.'), { code: 'EXECUTION_REVOKED' });
    await mkdir(root, { recursive: true, mode: 0o700 });
    if (await realpath(root) !== root) throw new Error('Execution workspace resolves through a symbolic-link path.');
    const workspaceInfo = await lstat(root);
    if (!workspaceInfo.isDirectory() || workspaceInfo.isSymbolicLink() || workspaceInfo.uid !== process.getuid()
      || (workspaceInfo.mode & 0o077) !== 0) {
      throw new Error('Execution workspace is not an owned, isolated directory.');
    }
    const workspaceHandle = await open(root, fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0) | (fsConstants.O_NOFOLLOW ?? 0));
    const openedWorkspaceInfo = await workspaceHandle.stat();
    let workspaceClosed = false;
    const closeWorkspace = async () => { if (!workspaceClosed) { workspaceClosed = true; await workspaceHandle.close(); } };
    if (!openedWorkspaceInfo.isDirectory() || openedWorkspaceInfo.dev !== workspaceInfo.dev
      || openedWorkspaceInfo.ino !== workspaceInfo.ino || openedWorkspaceInfo.uid !== process.getuid()
      || (openedWorkspaceInfo.mode & 0o077) !== 0) {
      await workspaceHandle.close();
      throw new Error('Execution workspace changed during secure open.');
    }
    let before;
    try { before = await snapshot(workspaceHandle, this.snapshotFileSystem); }
    catch (error) { await workspaceHandle.close(); throw error; }
    const context = { workItem, contextPackage, suppliedAt: now(), contentHash: digest({ workItem, contextPackage }) };
    const contextDirectory = await mkdtemp(path.join(os.tmpdir(), 'orgward-execution-context-'));
    const contextSource = path.join(contextDirectory, 'context.json');
    await writeFile(contextSource, `${JSON.stringify(context, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    const contextHandle = await open(contextSource, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const executable = await realpath(this.executable);
    const executableInfo = await lstat(executable);
    if (!executableInfo.isFile()) throw new Error('Execution adapter executable is not a regular file.');
    const fileHandles = [];
    const mountedFiles = [];
    const openReadOnlyFile = async (file) => {
      const resolved = await realpath(file);
      if (isVisibleRuntimePath(resolved)) return;
      const handle = await open(resolved, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
      if (!(await handle.stat()).isFile()) { await handle.close(); throw new Error(`Sandbox read-only mount is not a regular file: ${file}`); }
      fileHandles.push(handle);
      mountedFiles.push(resolved);
    };
    try {
      if (!isVisibleRuntimePath(executable)) await openReadOnlyFile(executable);
      for (const file of this.readOnlyFiles) await openReadOnlyFile(file);
    } catch (error) {
      await Promise.allSettled([workspaceHandle.close(), contextHandle.close(), ...fileHandles.map((handle) => handle.close()), rm(contextDirectory, { recursive: true, force: true })]);
      throw error;
    }
    if (signal?.aborted) {
      await Promise.all([workspaceHandle.close(), contextHandle.close(), ...fileHandles.map((handle) => handle.close())]);
      await rm(contextDirectory, { recursive: true, force: true });
      throw Object.assign(new Error('Execution dispatch was cancelled before start.'), { code: 'EXECUTION_REVOKED' });
    }
    const contextTarget = '/run/orgward/context.json';
    const args = [
      '--die-with-parent', '--unshare-all', '--unshare-user', '--disable-userns',
      '--ro-bind', '/usr', '/usr', '--ro-bind', '/lib', '/lib', '--ro-bind', '/lib64', '/lib64',
      '--proc', '/proc', '--dev', '/dev', '--size', '268435456', '--tmpfs', '/tmp',
    ];
    addSandboxDirectories(args, ['/workspace', contextTarget, executable, ...mountedFiles]);
    args.push('--bind-fd', String(3), '/workspace');
    let nextFd = 5;
    args.push('--ro-bind-fd', String(4), contextTarget);
    for (const file of mountedFiles) args.push('--ro-bind-fd', String(nextFd++), file);
    args.push('--chdir', '/workspace', '--clearenv', '--setenv', 'PATH', '', '--setenv', 'HOME', '/workspace', '--setenv', 'TMPDIR', '/tmp', '--setenv', 'ORGWARD_CONTEXT_PATH', contextTarget, '--uid', String(process.getuid()), '--gid', String(process.getgid()), '--cap-drop', 'ALL');
    for (const [key, value] of Object.entries(this.environment)) args.push('--setenv', key, value);
    args.push('--', executable, ...this.args);
    const startedAt = now();
    const stdio = ['ignore', 'pipe', 'pipe', workspaceHandle.fd, contextHandle.fd, ...fileHandles.map((handle) => handle.fd)];
    const child = spawn(this.bwrapExecutable, args, {
      cwd: root, shell: false, detached: true, stdio, env: {},
    });
    let stdout = ''; let stderr = ''; let settled = false; let termination = null;
    let timer = null; let killTimer = null;
    const terminate = (reason) => {
      termination ??= reason;
      const send = (signalName) => {
        if (!child.pid) return;
        if (process.platform !== 'win32') {
          try { process.kill(-child.pid, signalName); } catch { /* The wrapper may already have exited. */ }
          try { child.kill(signalName); } catch { /* The wrapper may already have exited. */ }
        } else {
          try { child.kill(signalName); } catch { /* The wrapper may already have exited. */ }
        }
      };
      send('SIGTERM');
      killTimer ??= setTimeout(() => send('SIGKILL'), 250);
      killTimer.unref?.();
    };
    const onAbort = () => terminate('revoked');
    signal?.addEventListener('abort', onAbort, { once: true });
    const result = new Promise((resolve, reject) => {
      child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-this.maxOutputBytes); });
      child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-this.maxOutputBytes); });
      child.on('spawn', () => { timer = setTimeout(() => terminate('timeout'), this.timeoutMs); timer.unref?.(); if (signal?.aborted) onAbort(); });
      child.on('error', (error) => {
        if (!settled) {
          settled = true; clearTimeout(timer); clearTimeout(killTimer);
          signal?.removeEventListener('abort', onAbort);
          void Promise.all([closeWorkspace(), contextHandle.close(), ...fileHandles.map((handle) => handle.close()), rm(contextDirectory, { recursive: true, force: true })]);
          reject(error);
        }
      });
      child.on('close', (code, exitSignal) => {
        if (settled) return;
        settled = true; clearTimeout(timer); clearTimeout(killTimer);
        signal?.removeEventListener('abort', onAbort);
        void Promise.all([contextHandle.close(), ...fileHandles.map((handle) => handle.close()), rm(contextDirectory, { recursive: true, force: true })]);
        if (termination) {
          const error = new Error(termination === 'revoked' ? 'Execution stopped because project access was revoked.' : `Execution adapter timed out after ${this.timeoutMs}ms.`);
          error.code = termination === 'revoked' ? 'EXECUTION_REVOKED' : 'EXECUTION_TIMEOUT';
          reject(error); return;
        }
        resolve({ code, signal: exitSignal, stdout, stderr });
      });
    });
    result.catch(() => {});
    await new Promise((resolve, reject) => {
      if (signal?.aborted) terminate('revoked');
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    return {
      child,
      terminate: () => terminate('revoked'),
      result: result.then(async (exit) => {
        const after = await snapshot(workspaceHandle, this.snapshotFileSystem);
        const changedArtifacts = [...after].filter(([file, hash]) => before.get(file) !== hash)
          .map(([file, contentHash]) => ({ path: file, contentHash, hashAlgorithm: 'sha256-raw' }));
        return {
          adapter: { port: 'ExecutionPort', implementation: this.name, version: this.version },
          status: exit.code === 0 ? 'COMPLETED' : 'FAILED', exitCode: exit.code, signal: exit.signal,
          startedAt, completedAt: now(), contextHash: context.contentHash, changedArtifacts,
          stdout: exit.stdout, stderr: exit.stderr, evidenceHash: digest({ code: exit.code, changedArtifacts, contextHash: context.contentHash }),
        };
      }).finally(() => closeWorkspace()),
    };
  }

  async execute(workItem, contextPackage, options) {
    const handle = await this.start(workItem, contextPackage, options);
    return handle.result;
  }
}
