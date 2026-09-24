import { createHash } from 'node:crypto';
import { constants as fsConstants, createReadStream, createWriteStream } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, realpath } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '../src/sdlc/contracts.mjs';

const PROC_FD = '/proc/self/fd';
const MAX_FILES = 100_000;
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_TREE_BYTES = 50 * 1024 * 1024 * 1024;
const DIR_FLAGS = fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW;
const FILE_FLAGS = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | (fsConstants.O_NONBLOCK ?? 0);

function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function pathSafe(name) {
  return typeof name === 'string' && name.length > 0 && name !== '.' && name !== '..'
    && !name.includes('/') && !name.includes('\\') && !name.includes('\0');
}
function sameSnapshot(before, after) {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size
    && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
}

async function copyFileFromHandle(file, destination, relative, rootName, state) {
  const before = await file.stat({ bigint: true });
  if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(MAX_FILE_BYTES)) fail('FILESYSTEM_UNSAFE', 'A recovery file is not a supported single-link regular file.');
  state.files += 1;
  if (state.files > MAX_FILES) fail('FILESYSTEM_LIMIT', 'A recovery file root contains too many files.');
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const hash = createHash('sha256');
  const legacyChunks = rootName === 'execution-workspaces' && before.size <= 1_000_000n ? [] : null;
  let size = 0;
  const meter = new Transform({ transform(chunk, encoding, callback) {
    size += chunk.length;
    state.bytes += chunk.length;
    if (size > MAX_FILE_BYTES || state.bytes > MAX_TREE_BYTES) return callback(Object.assign(new Error('Recovery file size limit exceeded.'), { code: 'FILESYSTEM_LIMIT' }));
    hash.update(chunk);
    if (legacyChunks) legacyChunks.push(Buffer.from(chunk));
    callback(null, chunk);
  } });
  await pipeline(file.createReadStream({ autoClose: false }), meter, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  await chmod(destination, 0o600);
  const after = await file.stat({ bigint: true });
  if (!sameSnapshot(before, after) || BigInt(size) !== before.size) fail('FILESYSTEM_CHANGED', 'A recovery file changed during snapshot.');
  const entry = { root: rootName, path: relative, size, sha256: hash.digest('hex') };
  if (legacyChunks) entry.legacySha256 = digest(Buffer.concat(legacyChunks));
  if (state.seen.has(`${rootName}\0${relative}`)) fail('FILESYSTEM_DUPLICATE', 'A recovery path appeared more than once.');
  state.seen.add(`${rootName}\0${relative}`);
  if (state.seen.size > MAX_FILES) fail('FILESYSTEM_LIMIT', 'A recovery tree contains too many entries.');
  state.entries.push(entry);
}

async function walkDirectory(directory, destination, rootName, prefix, rootDevice, state) {
  const before = await directory.stat({ bigint: true });
  if (!before.isDirectory() || before.dev !== rootDevice) fail('FILESYSTEM_UNSAFE', 'A recovery tree contains an unsupported directory.');
  const names = (await readdir(`${PROC_FD}/${directory.fd}`)).sort();
  for (const name of names) {
    if (!pathSafe(name)) fail('FILESYSTEM_UNSAFE', 'A recovery tree contains an unsafe path component.');
    const relative = prefix ? `${prefix}/${name}` : name;
    const anchoredPath = `${PROC_FD}/${directory.fd}/${name}`;
    const entryStat = await lstat(anchoredPath, { bigint: true });
    if (entryStat.isSymbolicLink()) fail('FILESYSTEM_UNSAFE', 'A recovery tree contains a symbolic link.');
    if (entryStat.isDirectory()) {
      if (entryStat.dev !== rootDevice) fail('FILESYSTEM_UNSAFE', 'A recovery tree crosses a filesystem boundary.');
      const key = `${rootName}\0${relative}`;
      if (state.seen.has(key)) fail('FILESYSTEM_DUPLICATE', 'A recovery path appeared more than once.');
      state.seen.add(key);
      state.directories.push({ root: rootName, path: relative });
      if (state.seen.size > MAX_FILES) fail('FILESYSTEM_LIMIT', 'A recovery tree contains too many entries.');
      const child = await open(anchoredPath, DIR_FLAGS);
      try {
        const opened = await child.stat({ bigint: true });
        if (!opened.isDirectory() || opened.dev !== entryStat.dev || opened.ino !== entryStat.ino) fail('FILESYSTEM_CHANGED', 'A recovery directory changed while being read.');
        const childDestination = path.join(destination, ...relative.split('/'));
        await mkdir(childDestination, { mode: 0o700 });
        await walkDirectory(child, destination, rootName, relative, rootDevice, state);
      } finally { await child.close(); }
      continue;
    }
    if (!entryStat.isFile() || entryStat.nlink !== 1n || entryStat.dev !== rootDevice) fail('FILESYSTEM_UNSAFE', 'A recovery tree contains a special or hard-linked file.');
    const file = await open(anchoredPath, FILE_FLAGS);
    try {
      const opened = await file.stat({ bigint: true });
      if (!opened.isFile() || opened.nlink !== 1n || opened.dev !== entryStat.dev || opened.ino !== entryStat.ino) fail('FILESYSTEM_CHANGED', 'A recovery file changed while being opened.');
      await copyFileFromHandle(file, path.join(destination, ...relative.split('/')), relative, rootName, state);
    } finally { await file.close(); }
  }
  const after = await directory.stat({ bigint: true });
  if (before.dev !== after.dev || before.ino !== after.ino || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
    fail('FILESYSTEM_CHANGED', 'A recovery directory changed during snapshot.');
  }
}

export async function copySafeRoot(sourceRoot, destinationRoot, rootName, state = null) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(rootName)) fail('FILESYSTEM_UNSAFE', 'A recovery root name is invalid.');
  const sharedState = state ?? { files: 0, bytes: 0, entries: [], directories: [], seen: new Set() };
  await mkdir(destinationRoot, { recursive: true, mode: 0o700 });
  const metadata = await lstat(sourceRoot, { bigint: true }).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!metadata) return { root: { name: rootName, present: false, fileCount: 0, bytes: 0 }, entries: sharedState.entries };
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail('FILESYSTEM_UNSAFE', 'A configured recovery root must be a real directory.');
  const canonical = await realpath(sourceRoot);
  const root = await open(canonical, DIR_FLAGS);
  try {
    const opened = await root.stat({ bigint: true });
    if (!opened.isDirectory() || opened.dev !== metadata.dev || opened.ino !== metadata.ino) fail('FILESYSTEM_CHANGED', 'A configured recovery root changed while opening.');
    const priorFiles = sharedState.files;
    const priorBytes = sharedState.bytes;
    await walkDirectory(root, destinationRoot, rootName, '', opened.dev, sharedState);
    return { root: { name: rootName, present: true, fileCount: sharedState.files - priorFiles, bytes: sharedState.bytes - priorBytes }, entries: sharedState.entries };
  } finally { await root.close(); }
}

export async function verifyManifestFiles(roots, entries, directories) {
  if (!Array.isArray(roots) || !Array.isArray(entries) || !Array.isArray(directories) || roots.length !== 4) fail('BACKUP_INVALID', 'The backup filesystem inventory is invalid.');
  const rootNames = new Set();
  for (const root of roots) {
    if (!root || !/^[a-z][a-z0-9-]{0,63}$/.test(root.name) || rootNames.has(root.name)
      || typeof root.present !== 'boolean' || !Number.isSafeInteger(root.fileCount) || root.fileCount < 0
      || !Number.isSafeInteger(root.bytes) || root.bytes < 0) fail('BACKUP_INVALID', 'The backup filesystem inventory is invalid.');
    rootNames.add(root.name);
  }
  const seen = new Set();
  const directorySet = new Set();
  let totalBytes = 0;
  for (const directory of directories) {
    if (!directory || !rootNames.has(directory.root) || typeof directory.path !== 'string'
      || directory.path.split('/').some((segment) => !pathSafe(segment))) fail('BACKUP_INVALID', 'The backup directory inventory is invalid.');
    const key = `${directory.root}\0${directory.path}`;
    if (directorySet.has(key)) fail('BACKUP_INVALID', 'The backup directory inventory contains duplicate paths.');
    directorySet.add(key);
  }
  const counts = new Map([...rootNames].map((name) => [name, { count: 0, bytes: 0 }]));
  for (const entry of entries) {
    if (!entry || !rootNames.has(entry.root) || typeof entry.path !== 'string'
      || entry.path.split('/').some((segment) => !pathSafe(segment))
      || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_FILE_BYTES
      || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || (entry.legacySha256 !== undefined && (entry.root !== 'execution-workspaces' || !Number.isSafeInteger(entry.size) || entry.size > 1_000_000 || !/^[a-f0-9]{64}$/.test(entry.legacySha256)))) fail('BACKUP_INVALID', 'The backup filesystem inventory is invalid.');
    const key = `${entry.root}\0${entry.path}`;
    if (seen.has(key) || directorySet.has(key)) fail('BACKUP_INVALID', 'The backup filesystem inventory contains duplicate paths.');
    seen.add(key);
    const stats = counts.get(entry.root);
    stats.count += 1;
    stats.bytes += entry.size;
    totalBytes += entry.size;
    if (stats.bytes > MAX_TREE_BYTES) fail('BACKUP_INVALID', 'The backup filesystem inventory exceeds supported size.');
    if (totalBytes > MAX_TREE_BYTES) fail('BACKUP_INVALID', 'The backup filesystem inventory exceeds the total supported tree size.');
  }
  if (seen.size + directorySet.size > MAX_FILES) fail('BACKUP_INVALID', 'The backup filesystem inventory contains too many entries.');
  for (const root of roots) {
    const stats = counts.get(root.name);
    if (stats.count !== root.fileCount || stats.bytes !== root.bytes
      || (!root.present && (stats.count || [...directorySet].some((key) => key.startsWith(`${root.name}\0`))))) fail('BACKUP_INVALID', 'The backup filesystem inventory does not match its root summary.');
  }
  for (const entry of [...entries, ...directories]) {
    const parts = entry.path.split('/');
    for (let length = 1; length < parts.length; length += 1) {
      if (!directorySet.has(`${entry.root}\0${parts.slice(0, length).join('/')}`)) fail('BACKUP_INVALID', 'The backup filesystem inventory has a non-directory ancestor.');
    }
  }
}

export async function verifyCopiedRoot(sourceRoot, stagingRoot, rootName, expectedEntries, expectedDirectories) {
  const state = { files: 0, bytes: 0, entries: [], directories: [], seen: new Set() };
  const summary = await copySafeRoot(sourceRoot, stagingRoot, rootName, state);
  const expected = expectedEntries.filter((entry) => entry.root === rootName).sort((a, b) => a.path.localeCompare(b.path));
  const actual = state.entries.filter((entry) => entry.root === rootName).sort((a, b) => a.path.localeCompare(b.path));
  const expectedDirs = expectedDirectories.filter((entry) => entry.root === rootName).map((entry) => entry.path).sort();
  const actualDirs = state.directories.filter((entry) => entry.root === rootName).map((entry) => entry.path).sort();
  if (summary.root.fileCount !== expected.length || actual.length !== expected.length
    || actual.some((entry, index) => entry.path !== expected[index].path || entry.size !== expected[index].size || entry.sha256 !== expected[index].sha256 || entry.legacySha256 !== expected[index].legacySha256)
    || actualDirs.length !== expectedDirs.length || actualDirs.some((entry, index) => entry !== expectedDirs[index])) {
    fail('BACKUP_INTEGRITY_FAILED', 'A filesystem root does not match the backup manifest.');
  }
  return summary.root;
}

export function configuredFileRoots(env = process.env, productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')) {
  return [
    { name: 'projects', sourcePath: path.resolve(env.ORGWARD_DATA_DIR || path.join(productRoot, 'data', 'projects')) },
    { name: 'sdlc', sourcePath: path.resolve(env.ORGWARD_SDLC_DATA_DIR || path.join(productRoot, 'data', 'sdlc')) },
    { name: 'execution-runs', sourcePath: path.resolve(env.ORGWARD_EXECUTION_DATA_DIR || path.join(productRoot, 'data', 'execution-runs')) },
    { name: 'execution-workspaces', sourcePath: path.resolve(env.ORGWARD_EXECUTION_WORKSPACE_DIR || path.join(productRoot, 'data', 'execution-workspaces')) },
  ];
}

export function assertRootsDisjoint(roots, targetPath, code = 'FILESYSTEM_TARGET_INVALID') {
  // Resolve existing ancestors so symlinked parent aliases cannot bypass the
  // lexical containment test. Missing leaves are allowed and remain anchored
  // to the canonical nearest existing parent.
  const canonical = async (input) => {
    let candidate = path.resolve(input);
    const suffix = [];
    while (true) {
      try {
        const real = await realpath(candidate);
        return path.join(real, ...suffix.reverse());
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
        const parent = path.dirname(candidate);
        if (parent === candidate) fail(code, 'A recovery path cannot be resolved safely.');
        suffix.push(path.basename(candidate));
        candidate = parent;
      }
    }
  };
  return Promise.all([...roots.map((root) => canonical(root.sourcePath)), canonical(targetPath)]).then((paths) => {
    const resolved = paths.slice(0, -1);
    const target = paths.at(-1);
    const overlaps = (left, right) => left === right || left.startsWith(`${right}${path.sep}`) || right.startsWith(`${left}${path.sep}`);
    for (let i = 0; i < resolved.length; i += 1) {
      for (let j = i + 1; j < resolved.length; j += 1) if (overlaps(resolved[i], resolved[j])) fail(code, 'Configured recovery roots overlap and cannot be snapshotted safely.');
    }
    if (resolved.some((root) => overlaps(root, target))) fail(code, 'The recovery filesystem path overlaps a configured service root.');
  });
}
