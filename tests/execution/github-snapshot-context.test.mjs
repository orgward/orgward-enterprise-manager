import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buildGitHubSnapshotTextContext, githubSnapshotTextLimits } from '../../src/execution/github-snapshot-context.mjs';

const binding = { provider: 'github-app', installationId: '123', repositoryId: '987654', branchRef: 'refs/heads/main' };
const commitOid = 'c'.repeat(40);
const treeOid = 'd'.repeat(40);
const policyVersion = 'github-read-snapshot-v1';
const hash = (algorithm, value) => createHash(algorithm).update(value).digest('hex');

function fixture(entries = [{ path: 'README.md', text: '# Hello\n' }]) {
  const files = entries.map(({ path, text, bytes = Buffer.from(text, 'utf8'), mode = '100644' }) => ({
    path, mode, size: bytes.length, contentHash: hash('sha256', bytes),
    blobSha: hash('sha1', Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])),
    contentBase64: bytes.toString('base64'),
  })).sort((left, right) => left.path.localeCompare(right.path));
  const manifest = files.map(({ path, mode, contentHash, size, blobSha }) => ({ path, mode, contentHash, size, blobSha }));
  const manifestDigest = hash('sha256', JSON.stringify(manifest));
  const id = hash('sha256', `${binding.repositoryId}\0${binding.branchRef}\0${commitOid}\0${policyVersion}`);
  return { binding: { ...binding }, snapshot: { id, repositoryId: binding.repositoryId, branchRef: binding.branchRef,
    commitOid, treeOid, policyVersion, fileCount: files.length, totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    manifestDigest, treeDigest: manifestDigest, files }, snapshotId: id };
}

function rejects(fixtureValue, selectedPaths = ['README.md']) {
  assert.throws(() => buildGitHubSnapshotTextContext({ ...fixtureValue, selectedPaths }),
    { code: 'GITHUB_SNAPSHOT_INTEGRITY_FAILED' });
}

test('GitHub snapshot context verifies pinned identity and emits only selected text', () => {
  const value = fixture([{ path: 'README.md', text: '# Hello\n' }, { path: 'src/app.js', text: 'export {};\n' }]);
  const result = buildGitHubSnapshotTextContext({ ...value, selectedPaths: ['src/app.js'] });
  assert.deepEqual(result.sourceSnapshot, { snapshotId: value.snapshotId, installationId: '123', repositoryId: '987654',
    branchRef: 'refs/heads/main', commitOid, treeOid, policyVersion, manifestDigest: value.snapshot.manifestDigest });
  assert.deepEqual(result.files, [{ path: 'src/app.js', mode: '100644',
    contentHash: value.snapshot.files.find((file) => file.path === 'src/app.js').contentHash, text: 'export {};\n' }]);
  assert.deepEqual(githubSnapshotTextLimits, { maxFiles: 8, maxFileBytes: 8_000, maxTotalBytes: 8_000 });
});

test('GitHub snapshot context rejects binding, policy, commit, tree, manifest, order, path, mode and content tampering', () => {
  const valid = fixture();
  rejects({ ...valid, snapshotId: 'f'.repeat(64) });
  rejects({ ...valid, binding: { ...valid.binding, repositoryId: '987655' } });
  rejects({ ...valid, binding: { ...valid.binding, installationId: '9007199254740992' } });
  rejects({ ...valid, snapshot: { ...valid.snapshot, policyVersion: 'changed' } });
  rejects({ ...valid, snapshot: { ...valid.snapshot, commitOid: 'f'.repeat(40) } });
  rejects({ ...valid, snapshot: { ...valid.snapshot, treeOid: 'bad' } });
  rejects({ ...valid, snapshot: { ...valid.snapshot, manifestDigest: 'f'.repeat(64) } });

  const multiple = fixture([{ path: 'a.txt', text: 'a' }, { path: 'b.txt', text: 'b' }]);
  multiple.snapshot.files.reverse();
  rejects(multiple, ['a.txt']);
  const unsafe = fixture([{ path: '../secret', text: 'a' }]);
  rejects(unsafe, ['../secret']);
  const mode = fixture();
  mode.snapshot.files[0].mode = '120000';
  rejects(mode);
  const content = fixture();
  content.snapshot.files[0].contentBase64 = Buffer.from('tampered').toString('base64');
  rejects(content);
  const contentHash = fixture();
  contentHash.snapshot.files[0].contentHash = 'f'.repeat(64);
  rejects(contentHash);
  const blobHash = fixture();
  blobHash.snapshot.files[0].blobSha = 'f'.repeat(40);
  rejects(blobHash);
  const noncanonical = fixture();
  noncanonical.snapshot.files[0].contentBase64 += '\n';
  rejects(noncanonical);
});

test('GitHub snapshot context rejects absent, duplicate and over-limit selections', () => {
  const value = fixture([{ path: 'a.txt', text: 'a' }, { path: 'b.txt', text: 'b' }]);
  rejects(value, ['missing.txt']);
  rejects(value, ['a.txt', 'a.txt']);
  rejects(value, Array(9).fill('a.txt'));

  const fileTooLarge = fixture([{ path: 'large.txt', text: '', bytes: Buffer.alloc(8_001, 0x61) }]);
  rejects(fileTooLarge, ['large.txt']);
  const aggregateTooLarge = fixture([
    { path: 'a.txt', text: '', bytes: Buffer.alloc(4_001, 0x61) },
    { path: 'b.txt', text: '', bytes: Buffer.alloc(4_001, 0x62) },
  ]);
  rejects(aggregateTooLarge, ['a.txt', 'b.txt']);
});

test('GitHub snapshot context rejects binary controls and invalid UTF-8 selected bytes', () => {
  const nul = fixture([{ path: 'nul.txt', text: '', bytes: Buffer.from([0x61, 0, 0x62]) }]);
  rejects(nul, ['nul.txt']);
  const controls = fixture([{ path: 'control.txt', text: '', bytes: Buffer.from([0x61, 0x01, 0x62]) }]);
  rejects(controls, ['control.txt']);
  const invalidUtf8 = fixture([{ path: 'invalid.txt', text: '', bytes: Buffer.from([0xc3, 0x28]) }]);
  rejects(invalidUtf8, ['invalid.txt']);
});
