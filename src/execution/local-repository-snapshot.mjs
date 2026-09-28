import { constants as fsConstants } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, mkdir, open, realpath, readdir } from 'node:fs/promises';
import path from 'node:path';

const PROC_FD = '/proc/self/fd';
const DIRECTORY_FLAGS = fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW;
const READ_FLAGS = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;
const MAX_FILES = 500;
const MAX_DEPTH = 32;
const MAX_FILE_BYTES = 1_000_000;
const MAX_TOTAL_BYTES = 8_000_000;

function fail(message) {
  throw Object.assign(new Error(message), { statusCode: 400, code: 'LOCAL_REPOSITORY_INVALID', retryable: false });
}

function safeSegment(segment) {
  return typeof segment === 'string' && segment.length > 0 && segment !== '.' && segment !== '..'
    && !segment.includes('/') && !segment.includes('\\') && !segment.includes('\0');
}

function treeDigest(files) {
  return createHash('sha256').update(JSON.stringify(files.map(({ path: relativePath, mode, contentHash, size }) => ({
    path: relativePath, mode, contentHash, size,
  })))).digest('hex');
}

export async function captureLocalRepositorySnapshot(sourceDirectory, {
  openFile = open, readDirectory = readdir, lstatEntry = lstat, excludeGitDirectory = true,
} = {}) {
  if (typeof sourceDirectory !== 'string' || !path.isAbsolute(sourceDirectory)) fail('The configured local repository path must be absolute.');
  const rootPath = await realpath(sourceDirectory);
  const rootInfo = await lstatEntry(rootPath);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail('The configured local repository root must be a real directory.');
  const root = await openFile(rootPath, DIRECTORY_FLAGS);
  const rootOpened = await root.stat();
  if (!rootOpened.isDirectory() || rootOpened.dev !== rootInfo.dev || rootOpened.ino !== rootInfo.ino) {
    await root.close(); fail('The configured local repository changed while opening it.');
  }
  const files = [];
  let totalBytes = 0;
  let entriesSeen = 0;
  const visit = async (directory, prefix, depth) => {
    if (depth > MAX_DEPTH) fail('The local repository exceeds the directory depth limit.');
    const directoryBefore = await directory.stat();
    const entries = (await readDirectory(`${PROC_FD}/${directory.fd}`)).sort();
    for (const name of entries) {
      entriesSeen += 1;
      if (entriesSeen > MAX_FILES * 4) fail('The local repository exceeds the entry count limit.');
      if (!safeSegment(name)) fail('The local repository contains an unsafe path.');
      const relativePath = prefix ? `${prefix}/${name}` : name;
      const fullPath = `${PROC_FD}/${directory.fd}/${name}`;
      const info = await lstatEntry(fullPath);
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) fail(`The local repository contains an unsafe entry: ${relativePath}`);
      if (excludeGitDirectory && prefix === '' && name === '.git' && info.isDirectory()) continue;
      if (info.isDirectory()) {
        const child = await openFile(fullPath, DIRECTORY_FLAGS);
        try {
          const openedInfo = await child.stat();
          if (!openedInfo.isDirectory() || openedInfo.dev !== info.dev || openedInfo.ino !== info.ino) fail(`The local repository changed while reading ${relativePath}.`);
          await visit(child, relativePath, depth + 1);
        } finally { await child.close(); }
      } else {
        if (info.nlink !== 1) fail(`The local repository contains a hard-linked file: ${relativePath}`);
        if (info.size > MAX_FILE_BYTES || files.length >= MAX_FILES || totalBytes + info.size > MAX_TOTAL_BYTES) fail('The local repository exceeds the snapshot size limit.');
        const file = await openFile(fullPath, READ_FLAGS);
        try {
          const before = await file.stat();
          if (!before.isFile() || before.dev !== info.dev || before.ino !== info.ino || before.nlink !== 1) fail(`The local repository changed while reading ${relativePath}.`);
          const contents = await file.readFile();
          const after = await file.stat();
          if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size
            || after.mode !== before.mode || after.nlink !== before.nlink
            || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || contents.length !== before.size) {
            fail(`The local repository changed while reading ${relativePath}.`);
          }
          const mode = (before.mode & 0o111) ? '100755' : '100644';
          const contentHash = createHash('sha256').update(contents).digest('hex');
          files.push({ path: relativePath, mode, size: contents.length, contentHash, contentBase64: contents.toString('base64') });
          totalBytes += contents.length;
        } finally { await file.close(); }
      }
    }
    const directoryAfter = await directory.stat();
    if (directoryAfter.dev !== directoryBefore.dev || directoryAfter.ino !== directoryBefore.ino
      || directoryAfter.mtimeMs !== directoryBefore.mtimeMs || directoryAfter.ctimeMs !== directoryBefore.ctimeMs) {
      fail(`The local repository changed while reading ${prefix || 'the root directory'}.`);
    }
  };
  try { await visit(root, '', 0); }
  finally { await root.close(); }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const digest = treeDigest(files);
  return { snapshotId: `sha256:${digest}`, treeDigest: digest, fileCount: files.length, totalBytes, files };
}

export async function materializeLocalRepositorySnapshot(snapshot, workspace, { openFile = open, makeDirectory = mkdir } = {}) {
  if (!snapshot || !Array.isArray(snapshot.files) || treeDigest(snapshot.files) !== snapshot.treeDigest) fail('The pinned repository snapshot failed its integrity check.');
  const root = await openFile(workspace, DIRECTORY_FLAGS);
  const rootInfo = await root.stat();
  if (!rootInfo.isDirectory() || rootInfo.uid !== process.getuid() || (rootInfo.mode & 0o077) !== 0
    || (await readdir(`${PROC_FD}/${root.fd}`)).length !== 0) {
    await root.close(); fail('The candidate workspace must be a new owned private directory.');
  }
  const dirs = new Map([['', root]]);
  try {
    for (const entry of snapshot.files) {
      if (typeof entry.path !== 'string' || !entry.path.split('/').every(safeSegment)) fail('The pinned repository snapshot contains an unsafe path.');
      const bytes = Buffer.from(entry.contentBase64, 'base64');
      if (bytes.length !== entry.size || createHash('sha256').update(bytes).digest('hex') !== entry.contentHash
        || !['100644', '100755'].includes(entry.mode)) fail('The pinned repository snapshot contains invalid file data.');
      const segments = entry.path.split('/');
      let prefix = '';
      let parent = root;
      for (const segment of segments.slice(0, -1)) {
        const next = prefix ? `${prefix}/${segment}` : segment;
        if (!dirs.has(next)) {
          const directoryPath = `${PROC_FD}/${parent.fd}/${segment}`;
          await makeDirectory(directoryPath, { mode: 0o700 });
          const child = await openFile(directoryPath, DIRECTORY_FLAGS);
          if (!(await child.stat()).isDirectory()) { await child.close(); fail('A materialized repository directory changed unexpectedly.'); }
          dirs.set(next, child);
        }
        prefix = next;
        parent = dirs.get(prefix);
      }
      const target = `${PROC_FD}/${parent.fd}/${segments.at(-1)}`;
      const file = await openFile(target, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
        entry.mode === '100755' ? 0o700 : 0o600);
      try { await file.writeFile(bytes); } finally { await file.close(); }
    }
  } finally { await Promise.allSettled([...dirs.values()].slice(1).reverse().map((directory) => directory.close())); await root.close(); }
}

export function localRepositoryDiff(before, after) {
  const previous = new Map(before.files.map((entry) => [entry.path, entry]));
  const current = new Map(after.files.map((entry) => [entry.path, entry]));
  return [...new Set([...previous.keys(), ...current.keys()])].sort().flatMap((relativePath) => {
    const oldFile = previous.get(relativePath);
    const newFile = current.get(relativePath);
    if (!oldFile) return [{ path: relativePath, change: 'added', afterMode: newFile.mode, afterHash: newFile.contentHash }];
    if (!newFile) return [{ path: relativePath, change: 'deleted', beforeMode: oldFile.mode, beforeHash: oldFile.contentHash }];
    if (oldFile.contentHash === newFile.contentHash && oldFile.mode === newFile.mode) return [];
    return [{ path: relativePath, change: oldFile.contentHash === newFile.contentHash ? 'mode_changed' : 'modified',
      beforeMode: oldFile.mode, afterMode: newFile.mode, beforeHash: oldFile.contentHash, afterHash: newFile.contentHash }];
  });
}
