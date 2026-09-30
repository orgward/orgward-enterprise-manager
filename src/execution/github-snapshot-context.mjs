import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';

const POLICY_VERSION = 'github-read-snapshot-v1';
const MAX_ID = Number.MAX_SAFE_INTEGER;
const MAX_FILES = 500;
const MAX_FILE_BYTES = 1_000_000;
const MAX_TOTAL_BYTES = 8_000_000;
const MAX_SELECTED_FILES = 8;
const MAX_SELECTED_FILE_BYTES = 8_000;
const MAX_SELECTED_BYTES = 8_000;
const FILE_KEYS = ['blobSha', 'contentBase64', 'contentHash', 'mode', 'path', 'size'];

function fail(message) {
  throw Object.assign(new Error(message), { statusCode: 409, code: 'GITHUB_SNAPSHOT_INTEGRITY_FAILED', retryable: false });
}

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function gitBlobSha(bytes) { return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'); }

function validExactId(value) {
  return /^[1-9][0-9]{0,15}$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) <= MAX_ID;
}

function safeRef(ref) {
  return typeof ref === 'string' && ref.length <= 255 && ref.startsWith('refs/heads/')
    && ref.split('/').every((part) => part && part !== '.' && part !== '..' && !part.startsWith('.')
      && !part.endsWith('.') && !part.endsWith('.lock') && !part.includes('..') && !part.includes('@{')
      && !/[\x00-\x20\x7f~^:?*\\[]/.test(part));
}

function safePath(value) {
  return typeof value === 'string' && value.length <= 1024 && !value.startsWith('/')
    && !value.includes('\\') && !/[\x00-\x1f\x7f:]/.test(value)
    && value.split('/').length <= 32 && value.split('/').every((part) => part && part !== '.' && part !== '..');
}

function decodeCanonicalBase64(value) {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail('A saved snapshot file has invalid base64 content.');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) fail('A saved snapshot file base64 value is not canonical.');
  return bytes;
}

function requireText(bytes) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail('A selected snapshot file is not valid UTF-8 text.'); }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) fail('A selected snapshot file contains binary control bytes.');
  return text;
}

/** Verify pinned source bytes and build bounded selected-file context without side effects. */
export function buildGitHubSnapshotTextContext({ binding, snapshot, snapshotId, selectedPaths }) {
  if (!binding || binding.provider !== 'github-app' || !validExactId(binding.installationId)
    || !validExactId(binding.repositoryId) || !safeRef(binding.branchRef)
    || !snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
    || !/^[a-f0-9]{64}$/.test(snapshotId ?? '') || snapshot.id !== snapshotId
    || String(snapshot.repositoryId) !== String(binding.repositoryId) || snapshot.branchRef !== binding.branchRef
    || snapshot.policyVersion !== POLICY_VERSION || !/^[a-f0-9]{40}$/.test(snapshot.commitOid ?? '')
    || !/^[a-f0-9]{40}$/.test(snapshot.treeOid ?? '') || !Array.isArray(snapshot.files)
    || !Number.isSafeInteger(snapshot.fileCount) || snapshot.fileCount !== snapshot.files.length || snapshot.files.length > MAX_FILES
    || !Number.isSafeInteger(snapshot.totalBytes) || snapshot.totalBytes < 0 || snapshot.totalBytes > MAX_TOTAL_BYTES
    || !/^[a-f0-9]{64}$/.test(snapshot.manifestDigest ?? '') || snapshot.treeDigest !== snapshot.manifestDigest) {
    fail('The saved GitHub snapshot identity or bounds are invalid.');
  }

  const expectedId = sha256(`${binding.repositoryId}\0${binding.branchRef}\0${snapshot.commitOid}\0${POLICY_VERSION}`);
  if (expectedId !== snapshotId) fail('The saved GitHub snapshot ID does not match its binding and pinned commit.');

  let totalBytes = 0;
  let previousPath = null;
  const verifiedFiles = new Map();
  const manifest = [];
  for (const file of snapshot.files) {
    if (!file || typeof file !== 'object' || Array.isArray(file)
      || Object.keys(file).sort().join(',') !== FILE_KEYS.join(',')
      || !safePath(file.path) || (previousPath !== null && previousPath.localeCompare(file.path) >= 0)
      || !['100644', '100755'].includes(file.mode) || !Number.isSafeInteger(file.size)
      || file.size < 0 || file.size > MAX_FILE_BYTES || !/^[a-f0-9]{64}$/.test(file.contentHash ?? '')
      || !/^[a-f0-9]{40}$/.test(file.blobSha ?? '')) fail('The saved GitHub snapshot manifest contains invalid file metadata.');
    previousPath = file.path;
    const bytes = decodeCanonicalBase64(file.contentBase64);
    if (bytes.length !== file.size || sha256(bytes) !== file.contentHash || gitBlobSha(bytes) !== file.blobSha) {
      fail('A saved GitHub snapshot file failed its content hash or Git blob identity check.');
    }
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_BYTES) fail('The saved GitHub snapshot exceeds its aggregate byte limit.');
    verifiedFiles.set(file.path, { metadata: file, bytes });
    manifest.push({ path: file.path, mode: file.mode, contentHash: file.contentHash, size: file.size, blobSha: file.blobSha });
  }
  const digest = sha256(JSON.stringify(manifest));
  if (totalBytes !== snapshot.totalBytes || digest !== snapshot.manifestDigest || digest !== snapshot.treeDigest) {
    fail('The saved GitHub snapshot manifest or aggregate byte count failed verification.');
  }

  if (!Array.isArray(selectedPaths) || selectedPaths.length < 1 || selectedPaths.length > MAX_SELECTED_FILES
    || selectedPaths.some((path) => !safePath(path)) || new Set(selectedPaths).size !== selectedPaths.length) {
    fail('Select between one and eight unique safe paths from the saved snapshot.');
  }
  let selectedBytes = 0;
  const files = selectedPaths.map((path) => {
    const verified = verifiedFiles.get(path);
    if (!verified) fail('A selected path is absent from the saved GitHub snapshot.');
    if (verified.bytes.length > MAX_SELECTED_FILE_BYTES) fail('A selected file exceeds the 8,000-byte context limit.');
    selectedBytes += verified.bytes.length;
    if (selectedBytes > MAX_SELECTED_BYTES) fail('Selected files exceed the 8,000-byte aggregate context limit.');
    return { path, mode: verified.metadata.mode, contentHash: verified.metadata.contentHash, text: requireText(verified.bytes) };
  });
  return {
    sourceSnapshot: {
      snapshotId, installationId: String(binding.installationId), repositoryId: String(binding.repositoryId),
      branchRef: binding.branchRef, commitOid: snapshot.commitOid, treeOid: snapshot.treeOid,
      policyVersion: snapshot.policyVersion, manifestDigest: snapshot.manifestDigest,
    },
    files,
  };
}

export const githubSnapshotTextLimits = Object.freeze({ maxFiles: MAX_SELECTED_FILES,
  maxFileBytes: MAX_SELECTED_FILE_BYTES, maxTotalBytes: MAX_SELECTED_BYTES });
