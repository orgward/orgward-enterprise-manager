import { constants as fsConstants } from 'node:fs';
import { createHash } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { digest } from '../sdlc/contracts.mjs';

const PROC_FD = '/proc/self/fd';
const MAX_ARTIFACT_BYTES = 1_000_000;
const MISSING_PATH_CODES = new Set(['EACCES', 'ELOOP', 'ENAMETOOLONG', 'ENOENT', 'ENOTDIR', 'EOPNOTSUPP']);

// Resolve every component from an already-open parent directory. The optional
// openFile dependency keeps syscall-boundary races deterministic in unit tests.
export async function readWorkspaceArtifact({ configuredRoot, runId, segments, expectedHash, hashAlgorithm }, { openFile = open } = {}) {
  if (fsConstants.O_DIRECTORY == null || fsConstants.O_NOFOLLOW == null
    || typeof runId !== 'string' || !runId || runId === '.' || runId === '..'
    || runId.includes('/') || runId.includes('\\')
    || !Array.isArray(segments) || !segments.length
    || segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\'))
    || !/^[a-f0-9]{64}$/.test(expectedHash ?? '')) return null;

  const directoryFlags = fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW;
  const fileFlags = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;
  const handles = [];
  try {
    const canonicalRoot = await realpath(path.resolve(configuredRoot));
    let parent = await openFile(canonicalRoot, directoryFlags);
    handles.push(parent);
    parent = await openFile(`${PROC_FD}/${handles.at(-1).fd}/${runId}`, directoryFlags);
    handles.push(parent);

    for (const segment of segments.slice(0, -1)) {
      parent = await openFile(`${PROC_FD}/${parent.fd}/${segment}`, directoryFlags);
      handles.push(parent);
    }
    const file = await openFile(`${PROC_FD}/${parent.fd}/${segments.at(-1)}`, fileFlags);
    handles.push(file);
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.nlink !== 1 || metadata.size > MAX_ARTIFACT_BYTES) return null;
    const contents = await file.readFile();
    if (contents.length > MAX_ARTIFACT_BYTES) return null;
    const rawHash = createHash('sha256').update(contents).digest('hex');
    if (hashAlgorithm === 'sha256-raw') return rawHash === expectedHash ? contents : null;
    if (hashAlgorithm !== undefined) return null;
    if (rawHash === expectedHash || digest(contents) === expectedHash) return contents;
    return null;
  } catch (error) {
    if (MISSING_PATH_CODES.has(error?.code)) return null;
    throw error;
  } finally {
    await Promise.allSettled(handles.reverse().map((handle) => handle.close()));
  }
}
