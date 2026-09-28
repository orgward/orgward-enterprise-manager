import { spawn } from 'node:child_process';
import { lstat, realpath, readFile, opendir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const MAX_FILES = 500;
const MAX_DEPTH = 32;
const MAX_FILE_BYTES = 1_000_000;
const MAX_TOTAL_BYTES = 8_000_000;
const MAX_TREE_OUTPUT = 2_500_000;
const MAX_BATCH_OUTPUT = MAX_TOTAL_BYTES + MAX_FILES * 128;
const MAX_GIT_RUNTIME_MS = 10_000;
const MAX_GIT_ADDRESS_SPACE = 512 * 1024 * 1024;
const MAX_GIT_CPU_SECONDS = 5;
const MAX_GIT_CONFIG_BYTES = 64 * 1024;
const PRLIMIT_PATH = '/usr/bin/prlimit';
const GIT_PATH = '/usr/bin/git';

function invalid(message) {
  throw Object.assign(new Error(message), { statusCode: 400, code: 'LOCAL_REPOSITORY_INVALID', retryable: false });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function validRef(ref) {
  return typeof ref === 'string' && ref.startsWith('refs/heads/')
    && ref.split('/').every((segment) => segment && segment !== '.' && segment !== '..'
      && !segment.startsWith('.') && !segment.endsWith('.') && !segment.endsWith('.lock')
      && !segment.includes('..') && !segment.includes('@{') && !/[\x00-\x20\x7f~^:?*\\[]/.test(segment));
}

function validPath(relativePath) {
  if (!relativePath || relativePath.startsWith('/') || relativePath.includes('\\') || relativePath.includes('\0')
    || relativePath.includes(':') || /[\x00-\x1f\x7f]/.test(relativePath)) return false;
  const segments = relativePath.split('/');
  return segments.length <= MAX_DEPTH && segments.every((segment) => segment && segment !== '.' && segment !== '..');
}

export function gitResourceLimitedInvocation(repository, args) {
  return {
    file: PRLIMIT_PATH,
    args: [`--as=${MAX_GIT_ADDRESS_SPACE}`, `--cpu=${MAX_GIT_CPU_SECONDS}`, '--', GIT_PATH,
      '--no-pager', '--no-optional-locks', '--no-replace-objects', `--git-dir=${repository.gitDirectory}`,
      '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args],
    env: {
      PATH: '/usr/bin:/bin', HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C',
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_ATTR_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1',
      GIT_ALLOW_PROTOCOL: '', GIT_NO_LAZY_FETCH: '1',
    },
  };
}

function runGit(repository, args, { input = Buffer.alloc(0), maxOutput = MAX_TREE_OUTPUT } = {}) {
  return new Promise((resolve, reject) => {
    const invocation = gitResourceLimitedInvocation(repository, args);
    const child = spawn(invocation.file, invocation.args, {
      cwd: '/',
      env: invocation.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let errorBytes = 0;
    let settled = false;
    let exceeded = false;
    const timer = setTimeout(() => { exceeded = true; child.kill('SIGKILL'); }, MAX_GIT_RUNTIME_MS);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    child.on('error', (error) => finish(Object.assign(new Error('The Git reader resource limiter is unavailable.'), {
      code: 'LOCAL_GIT_LIMITER_UNAVAILABLE', cause: error,
    })));
    child.stdin.on('error', (error) => { if (error.code !== 'EPIPE') finish(error); });
    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutput) { exceeded = true; child.kill('SIGKILL'); return; }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      errorBytes += chunk.length;
      if (errorBytes <= 16_384) stderr.push(chunk.subarray(0, 16_384 - (errorBytes - chunk.length)));
    });
    child.on('close', (code) => {
      if (exceeded) return finish(Object.assign(new Error('The configured Git repository exceeded a bounded read limit.'), { code: 'LOCAL_GIT_LIMIT' }));
      if (code !== 0) return finish(Object.assign(new Error('The configured Git ref could not be read.'), { code: 'LOCAL_GIT_READ_FAILED' }));
      finish(null, Buffer.concat(stdout));
    });
    child.stdin.end(input);
  });
}

async function validateTrustedPath(resolved) {
  const uid = process.getuid?.();
  if (!Number.isInteger(uid)) invalid('The configured Git source requires a Unix process owner identity.');
  const parts = resolved.slice(path.parse(resolved).root.length).split(path.sep).filter(Boolean);
  const paths = [path.parse(resolved).root];
  let current = path.parse(resolved).root;
  for (const part of parts) { current = path.join(current, part); paths.push(current); }
  for (const entryPath of paths) {
    const info = await lstat(entryPath).catch(() => null);
    if (!info || info.isSymbolicLink() || (!info.isDirectory() && entryPath !== resolved)
      || (info.uid !== uid && info.uid !== 0) || (info.mode & 0o022) !== 0) {
      // A sticky world-writable ancestor such as /tmp may contain a private owned source.
      if (!(entryPath !== resolved && info?.isDirectory() && (info.mode & 0o1000) !== 0
        && (info.uid === 0 || info.uid === uid) && (info.mode & 0o022) === 0o022)) {
        invalid('The configured Git source must be owned by the service or root and inaccessible to untrusted writers.');
      }
    }
  }
}

async function validateTreeObjects(directory, depth = 0, counter = { entries: 0 }) {
  if (depth > 5) invalid('The configured Git object/ref layout exceeds its structural limit.');
  const entries = await opendir(directory).catch(() => invalid('The configured Git object/ref layout could not be read safely.'));
  for await (const entry of entries) {
    const { name } = entry;
    counter.entries += 1;
    if (counter.entries > 20_000) invalid('The configured Git object/ref layout exceeds its structural limit.');
    if (name === '.' || name === '..' || name.includes('/') || name.includes('\\')) invalid('The configured Git object/ref layout is invalid.');
    const child = path.join(directory, name);
    const info = await lstat(child).catch(() => null);
    if (!info || info.isSymbolicLink() || (info.isFile() && info.nlink !== 1) || (info.mode & 0o022) !== 0
      || (info.uid !== process.getuid?.() && info.uid !== 0)) invalid('The configured Git object/ref layout contains an unsafe entry.');
    if (info.isDirectory()) await validateTreeObjects(child, depth + 1, counter);
    else if (!info.isFile()) invalid('The configured Git object/ref layout contains a special entry.');
  }
}

async function validateBareRepository(repository, ref) {
  if (typeof repository.gitDirectory !== 'string' || !path.isAbsolute(repository.gitDirectory)
    || !validRef(ref)) invalid('The configured Git repository or allowed ref is invalid.');
  const resolved = await realpath(repository.gitDirectory);
  if (path.resolve(repository.gitDirectory) !== resolved) invalid('The configured Git repository path must not traverse symbolic links.');
  const rootInfo = await lstat(resolved);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) invalid('The configured Git repository must be a real bare repository directory.');
  await validateTrustedPath(resolved);
  for (const [relative, directory] of [['HEAD', false], ['config', false], ['objects', true], ['refs', true], ['info', true], ['objects/info', true]]) {
    const info = await lstat(path.join(resolved, relative)).catch(() => null);
    if (!info || info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) {
      invalid('The configured Git repository has an unsafe or incomplete bare-repository layout.');
    }
  }
  for (const relative of ['objects/info/alternates', 'objects/info/http-alternates', 'commondir']) {
    if (await lstat(path.join(resolved, relative)).then(() => true, () => false)) {
      invalid('Git alternates and linked worktree metadata are not supported.');
    }
  }
  const configPath = path.join(resolved, 'config');
  const configInfo = await lstat(configPath).catch(() => null);
  if (!configInfo?.isFile() || configInfo.isSymbolicLink() || configInfo.nlink !== 1
    || configInfo.size > MAX_GIT_CONFIG_BYTES || (configInfo.mode & 0o022) !== 0
    || (configInfo.uid !== process.getuid?.() && configInfo.uid !== 0)) {
    invalid('The configured Git repository config is unsafe or exceeds the size limit.');
  }
  const config = await readFile(configPath, 'utf8').catch(() => '');
  if (!config || /^\s*\[include(?:if\s+[^\]]+)?\]/im.test(config)
    || /^\s*(?:promisor|partialclone|alternate|objectdirectory)\s*=/im.test(config)) {
    invalid('Partial, promisor, included, or alternate Git configuration is not supported.');
  }
  await validateTreeObjects(path.join(resolved, 'refs'));
  await validateTreeObjects(path.join(resolved, 'objects'));
  await validateTreeObjects(path.join(resolved, 'info'));
  for (const relative of ['HEAD', 'config', 'description', 'packed-refs']) {
    const info = await lstat(path.join(resolved, relative)).catch(() => null);
    if (info && (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o022) !== 0
      || (info.uid !== process.getuid?.() && info.uid !== 0))) invalid('The configured Git metadata contains an unsafe entry.');
  }
  const refPath = path.join(resolved, ...ref.split('/'));
  let current = resolved;
  const refSegments = ref.split('/');
  for (const [index, segment] of refSegments.entries()) {
    current = path.join(current, segment);
    const info = await lstat(current).catch(() => null);
    if (info?.isSymbolicLink()) invalid('Symbolic Git refs are not supported.');
    if (info && (info.uid !== process.getuid?.() && info.uid !== 0 || (info.mode & 0o022) !== 0
      || (index < refSegments.length - 1 ? !info.isDirectory() : !info.isFile()))) {
      invalid('The configured Git ref has an unsafe filesystem entry.');
    }
  }
  const bare = (await runGit(repository, ['rev-parse', '--is-bare-repository'])).toString('utf8').trim();
  if (bare !== 'true') invalid('The configured Git source must be a bare repository.');
  return refPath;
}

function parseTree(output) {
  const records = [];
  const seen = new Set();
  const collisions = new Set();
  let offset = 0;
  while (offset < output.length) {
    const end = output.indexOf(0, offset);
    if (end < 0) invalid('The Git tree output was truncated.');
    const record = output.subarray(offset, end);
    offset = end + 1;
    const tab = record.indexOf(9);
    if (tab < 0) invalid('The Git tree contains a malformed record.');
    const header = record.subarray(0, tab).toString('ascii').split(' ');
    const [mode, type, oid] = header;
    let relativePath;
    try { relativePath = new TextDecoder('utf-8', { fatal: true }).decode(record.subarray(tab + 1)); }
    catch { invalid('The Git tree contains a non-UTF-8 path.'); }
    if (!['100644', '100755'].includes(mode) || type !== 'blob' || !/^[a-f0-9]{40,64}$/.test(oid ?? '')
      || !validPath(relativePath)) invalid(`The Git tree contains an unsafe path, type, or mode: ${relativePath ?? '[invalid]'}`);
    if (seen.has(relativePath)) invalid('The Git tree contains a duplicate path.');
    seen.add(relativePath);
    records.push({ path: relativePath, mode, oid });
    if (records.length > MAX_FILES) invalid('The Git tree exceeds the file count limit.');
    const segments = relativePath.split('/');
    for (let index = 1; index < segments.length; index += 1) collisions.add(segments.slice(0, index).join('/'));
  }
  if (records.some(({ path: relativePath }) => collisions.has(relativePath))) invalid('The Git tree contains a file/directory path collision.');
  return records.sort((left, right) => left.path.localeCompare(right.path));
}

function parseBatch(output, records) {
  const files = [];
  let offset = 0;
  let totalBytes = 0;
  for (const record of records) {
    const lineEnd = output.indexOf(10, offset);
    if (lineEnd < 0) invalid('Git returned a truncated blob header.');
    const [oid, type, sizeText] = output.subarray(offset, lineEnd).toString('ascii').split(' ');
    offset = lineEnd + 1;
    const size = Number(sizeText);
    if (oid !== record.oid || type !== 'blob' || !Number.isSafeInteger(size) || size < 0
      || size > MAX_FILE_BYTES || totalBytes + size > MAX_TOTAL_BYTES || offset + size >= output.length) {
      invalid('The Git tree exceeds the file size limit or returned an invalid blob.');
    }
    const bytes = output.subarray(offset, offset + size);
    offset += size;
    if (output[offset] !== 10) invalid('Git returned a malformed blob boundary.');
    offset += 1;
    files.push({ path: record.path, mode: record.mode, size, contentHash: sha256(bytes), contentBase64: bytes.toString('base64') });
    totalBytes += size;
  }
  if (offset !== output.length) invalid('Git returned unexpected data after the captured blobs.');
  const treeDigest = sha256(Buffer.from(JSON.stringify(files.map(({ path: relativePath, mode, contentHash, size }) => ({
    path: relativePath, mode, contentHash, size,
  })))));
  return { files, totalBytes, treeDigest };
}

export async function captureGitRepositorySnapshot(repository, refId) {
  const allowed = repository.allowedRefs?.find((entry) => entry.id === refId);
  if (!allowed || !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(allowed.id ?? '')) invalid('Choose an explicitly allowed Git ref.');
  const refPath = await validateBareRepository(repository, allowed.ref);
  const oid = (await runGit(repository, ['rev-parse', '--verify', '--end-of-options', `${allowed.ref}^{commit}`])).toString('ascii').trim();
  if (!/^[a-f0-9]{40,64}$/.test(oid)) invalid('The configured Git ref did not resolve to one exact commit.');
  const treeType = (await runGit(repository, ['cat-file', '-t', oid])).toString('ascii').trim();
  if (treeType !== 'commit') invalid('The configured Git ref did not resolve to a commit.');
  const records = parseTree(await runGit(repository, ['ls-tree', '-r', '-z', '--full-tree', oid], { maxOutput: MAX_TREE_OUTPUT }));
  const batchInput = Buffer.from(records.map(({ oid: blobOid }) => blobOid).join('\n') + (records.length ? '\n' : ''));
  const blobs = records.length ? await runGit(repository, ['cat-file', '--batch'], { input: batchInput, maxOutput: MAX_BATCH_OUTPUT }) : Buffer.alloc(0);
  const captured = parseBatch(blobs, records);
  return {
    snapshotId: `sha256:${captured.treeDigest}`,
    treeDigest: captured.treeDigest,
    fileCount: captured.files.length,
    totalBytes: captured.totalBytes,
    files: captured.files,
    repositorySource: { type: 'git', identity: repository.identity, refId: allowed.id, ref: allowed.ref,
      label: allowed.label ?? allowed.id, commitOid: oid },
  };
}
